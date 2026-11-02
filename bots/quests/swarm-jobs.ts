// Many simple, unobserved grind loops in ONE process.
//
//   cd server/webclient
//   bun src/lite/swarm-jobs.ts --config=/path/swarm.json [--minutes=N]
//   bun src/lite/swarm-jobs.ts knights:acctA knights:acctB bignet:acctC [--minutes=N]
//
// Config file:
//   { "botsDir": "/opt/fleet/bots",          // optional; default <repo>/bots
//     "heartbeatSec": 300,                    // optional
//     "accounts": [ { "name": "acctA", "job": "knights" },
//                   { "name": "acctC", "job": "bignet" } ] }
//
// Why: a fleet account today costs a lite-runner container (~60 MiB) plus a
// gateway-SDK script container (~340 MiB). For loops that need no observer -
// pickpocket, fish, bank, repeat - the same BotStateCollector/ActionExecutor
// can run in-process on the game-tick callback (see swarm.ts), so one Bun
// process carries many accounts at a few MiB each.
//
// Contract per account (same files ActivitySession writes, so fleet tooling
// can read them):
//   bots/<name>/grind.log      "<ISO> LOG|WARN|ERROR <text>"
//   bots/<name>/heartbeat.log  JSONL snapshot {t, session, pid, job, xp, levels, coins, x, z, phase, ...}
//   bots/<name>/events.log     JSONL {type: start|progress|failure|stop, ...}
//   bots/<name>/swarm-status.json  overwritten every 15s: {t, online, x, z, hp, phase} (no gateway exists)
//
// Hub rule: every account starts by walking to its job's bank and depositing
// EVERYTHING, then withdraws its kit; on stop (SIGINT/SIGTERM/--minutes) it
// walks back, deposits everything, and only then logs out. An account that
// cannot reach its hub within PARK_TIMEOUT_MS is logged out where it stands.
//
// Jobs:
//   knights  Ardougne market knights (Thieving 55). Eats bank food under
//            EAT_BELOW, never pickpockets at <= MIN_PICK_HP (a stun does 3), waits
//            out the 8-tick stun, banks coins at BANK_COINS_AT or when food runs out.
//   bignet   Catherby Net/Harpoon spots with a big fishing net (Fishing 16).
//            Drops the fleet's big-net junk, banks the rest at Catherby when full.

import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LiteSession, SessionEnd } from '../../server/webclient/src/lite/session.js';
// Loaded at run time from the image's web client: the deploy preflight bundles bots/quests
// in a bare container without server/webclient's node_modules (fflate), so these must not
// be static imports.
const LITE = '../../server/webclient/src/lite/';
const { OutdatedClientError } = (await import(LITE + 'net/GameConnection.js')) as typeof import('../../server/webclient/src/lite/net/GameConnection.js');
const { startSession } = (await import(LITE + 'session.js')) as typeof import('../../server/webclient/src/lite/session.js');
import type { BotAction, BotWorldState, InventoryItem, NearbyNpc } from '../../server/webclient/src/bot/types.js';
import type { LiteClient } from '../../server/webclient/src/lite/LiteClient.js';
import { appendGrindLog } from '../../sdk/grind-log.js';

// ------------------------------------------------------------------ constants

type Tile = { x: number; z: number };

const RELOGIN_MS = 5_000;
const RELOGIN_MAX_MS = 60_000;
const LOGIN_STAGGER_MS = 1_500;
const PARK_TIMEOUT_MS = 120_000;
const STATUS_EVERY_MS = 15_000;
const SUMMARY_EVERY_MS = 60_000;
/** A bot whose tile is this far from its hub was teleported/killed; do not wander. */
const STRANDED_DIST = 250;
const BANK_ITEM_MODE_COMPONENT = 5387; // bank_main: "item" (un-note) button

// --- knights
const ARDOUGNE_BANK: Tile = { x: 2655, z: 3283 };
const KNIGHTS: Tile = { x: 2652, z: 3318 };
const KNIGHT_RE = /^knight of ardougne$/i;
const KNIGHT_RADIUS = 12; // only knights near the market; never chase one into a house
const STUN_TICKS = 8; // pickpocket.dbrow stun_ticks for knights
const PICK_RETRY_TICKS = 6;
const MIN_PICK_HP = 5; // a failed knight pick is exactly 3 damage
const BANK_COINS_AT = 20_000;
const FOOD_TAKE = 10;
/** Withdraw the lowest-heal fish the bank holds first (the fleet's thieving rule). */
const FOOD_PREF = [/^cod$/i, /^tuna$/i, /^lobster$/i, /^bass$/i, /^swordfish$/i, /^(bread|cake|meat pie|cooked meat|cooked chicken)$/i];
const FOOD_RE = /^(cod|tuna|lobster|bass|swordfish|shark|salmon|trout|pike|bread|cake|2\/3 cake|slice of cake|meat pie|cooked meat|cooked chicken)$/i;

// --- bignet
const CATHERBY_BANK: Tile = { x: 2809, z: 3440 };
const CATHERBY_PIER: Tile[] = [
    { x: 2854, z: 3423 },
    { x: 2860, z: 3426 },
    { x: 2845, z: 3429 },
    { x: 2837, z: 3431 }
];
const BIG_NET_RE = /^big fishing net$/i;
/** fishing-route.ts BIG_NET_DROP: everything else (bass, gems, caskets, keys) is banked. */
const BIG_NET_DROP =
    /^(seaweed|edible seaweed|raw mackerel|mackerel|leather boots|leather gloves|boots|raw cod|cod|burnt cod|oyster|oysters|clam|clams)$/i;
const BIG_NET_JUNK_ONLY = /^(seaweed|edible seaweed|leather boots|leather gloves|boots|oyster|oysters|clam|clams)$/i;
const FISH_IDLE_TICKS = 4; // re-cast once the player has stood idle this long

// ------------------------------------------------------------------ fleet log files

class FleetLog {
    private readonly dir: string;
    private readonly session = Date.now();
    private samples = new Map<string, number>();

    constructor(
        botsDir: string,
        readonly name: string,
        readonly job: string
    ) {
        this.dir = join(botsDir, name);
        mkdirSync(this.dir, { recursive: true });
    }

    log(level: 'LOG' | 'WARN' | 'ERROR', text: string): void {
        // Same sampling as ActivitySession: a repeated line is written 1st, 10th, 20th...
        const key = `${level}:${text}`;
        const n = (this.samples.get(key) ?? 0) + 1;
        this.samples.set(key, n);
        if (level !== 'ERROR' && n > 1 && n % 10 !== 0) return;
        const line = `${new Date().toISOString()} ${level} ${text}${n > 1 ? ` (×${n})` : ''}`;
        console.log(`[${this.name}] ${line}`);
        appendGrindLog(join(this.dir, 'grind.log'), line);
    }

    event(e: Record<string, unknown>): void {
        appendGrindLog(join(this.dir, 'events.log'), JSON.stringify({ t: Date.now(), pid: process.pid, session: this.session, ...e }));
    }

    heartbeat(rec: Record<string, unknown>): void {
        appendGrindLog(
            join(this.dir, 'heartbeat.log'),
            JSON.stringify({ t: Date.now(), session: this.session, pid: process.pid, job: this.job, jobKey: `swarm:${this.job}`, ...rec })
        );
    }

    status(rec: Record<string, unknown>): void {
        const path = join(this.dir, 'swarm-status.json');
        try {
            writeFileSync(`${path}.tmp`, JSON.stringify({ t: Date.now(), pid: process.pid, job: this.job, ...rec }) + '\n');
            renameSync(`${path}.tmp`, path);
        } catch {
            /* status is advisory */
        }
    }
}

// ------------------------------------------------------------------ helpers

const dist = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const here = (s: BotWorldState): Tile => ({ x: s.player!.worldX, z: s.player!.worldZ });
const skill = (s: BotWorldState, name: string) => s.skills.find(k => k.name === name);
const coinsIn = (s: BotWorldState) => s.inventory.filter(i => /^coins$/i.test(i.name)).reduce((a, i) => a + i.count, 0);
const countIn = (s: BotWorldState, re: RegExp) => s.inventory.filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);

type Phase = 'hub' | 'work' | 'park' | 'parked' | 'stopped';

interface BankPlan {
    hub: Tile;
    /** Items left in the pack on deposit. Everything else goes in the bank. */
    keep: RegExp | null;
    /** What to have in the pack when the visit ends. */
    withdraw: Array<{ match: (name: string) => boolean; label: string; count: number; required: boolean }>;
}

type BankResult = { status: 'busy' } | { status: 'done'; missing: string[]; deposited: number } | { status: 'failed'; reason: string };

// ------------------------------------------------------------------ one account

abstract class JobBot {
    session: LiteSession | null = null;
    client: LiteClient | null = null;
    readonly log: FleetLog;

    tick = 0;
    phase: Phase = 'hub';
    stopping = false;
    lastState: BotWorldState | null = null;
    private waitTicks = 0;
    private heartbeatAt = 0;
    private statusAt = 0;
    private summaryAt = Date.now();
    lastEffectAt: number | null = null;
    lastProgressAt: number | null = null;
    trips = 0;
    relogins = 0;
    rejected = 0;
    stopReason: string | null = null;
    onParked: (() => void) | null = null;

    // bank sub-machine
    private bankOpenTick = -99;
    private bankOpenTries = 0;
    private bankSeenOpenTick = -1;
    private bankDeposited = 0;
    private bankClosing = false;
    private bankLastMoveTick = -99;
    private bankMoveTries = 0;
    /** Items whose bank move never landed this visit (bank full, stock gone): skipped, not fatal. */
    private bankSkip = new Set<string>();
    private lastWalkTick = -99;

    constructor(
        readonly name: string,
        readonly jobName: string,
        botsDir: string,
        readonly heartbeatMs: number
    ) {
        this.log = new FleetLog(botsDir, name, jobName);
    }

    abstract readonly hub: Tile;
    /** One decision per game tick while phase === 'work'. */
    protected abstract work(s: BotWorldState): void;
    /** What the hub visit leaves in the pack before work starts. */
    protected abstract kit(s: BotWorldState): BankPlan;
    /** One line for the per-minute summary. */
    protected abstract summary(): string;
    /** Called when a hub visit finishes, before returning to work. */
    protected afterBank(_r: { missing: string[]; deposited: number }, _s: BotWorldState): void {}

    get online(): boolean {
        return this.client !== null && this.client.isInGame();
    }

    attach(session: LiteSession): void {
        this.session = session;
        this.client = session.client;
        this.tick = 0;
        this.waitTicks = 0;
        this.resetBank();
        // A fresh session always re-runs the hub visit: we do not know what
        // happened to the pack while we were away.
        if (this.phase === 'work') this.phase = 'hub';
        this.client.setOnGameTickCallback(() => {
            this.tick++;
            try {
                this.onTick();
            } catch (e) {
                console.error(`[${this.name}] tick error:`, e);
            }
        });
    }

    detach(): void {
        this.client?.setOnGameTickCallback(null);
        this.session?.stop();
        this.session = null;
        this.client = null;
    }

    wait(n: number): void {
        this.waitTicks = Math.max(this.waitTicks, n);
    }

    exec(action: BotAction): { ok: boolean; reason?: string } {
        if (!this.client) return { ok: false, reason: 'offline' };
        const res = this.client.executeBotAction(action);
        if (res instanceof Promise) {
            // Only count-dialog submits go async; nothing here uses them, but do
            // not double-send while one is in flight.
            this.wait(3);
            res.catch(() => undefined);
            return { ok: true };
        }
        return res.success ? { ok: true } : { ok: false, reason: res.reason ?? res.message };
    }

    walk(to: Tile, reason: string, everyTicks = 4): void {
        if (this.tick - this.lastWalkTick < everyTicks) return;
        this.lastWalkTick = this.tick;
        const r = this.exec({ type: 'walkTo', x: to.x, z: to.z, running: true, reason });
        if (!r.ok) this.log.log('WARN', `walk ${reason} to ${to.x},${to.z} failed: ${r.reason}`);
    }

    effect(): void {
        this.lastEffectAt = Date.now();
        this.lastProgressAt = this.lastEffectAt;
    }

    private onTick(): void {
        if (!this.client) return;
        if (this.waitTicks > 0) {
            this.waitTicks--;
            return;
        }
        const s = this.client.collectBotState(this.tick);
        if (!s?.player || (s.player.worldX === 0 && s.player.worldZ === 0)) return;
        if ((skill(s, 'Hitpoints')?.baseLevel ?? 0) === 0) return; // skills arrive a tick after login
        this.lastState = s;
        this.periodic(s);

        if (this.phase === 'parked' || this.phase === 'stopped') return;

        // Level-ups and NPC chatter block every op server-side.
        if (s.dialog.isOpen) {
            this.exec({ type: 'clickDialogOption', optionIndex: 0, reason: 'continue dialog' });
            this.wait(1);
            return;
        }

        if (dist(here(s), this.hub) > STRANDED_DIST) {
            this.fail('stranded', `stranded ${dist(here(s), this.hub)} tiles from hub @ ${s.player.worldX},${s.player.worldZ} (death or random event teleport)`);
            return;
        }

        if (this.stopping && this.phase !== 'park') {
            this.log.log('LOG', 'Stopping: walking to hub to park with an empty pack');
            this.phase = 'park';
            this.resetBank();
        }

        if (this.phase === 'hub' || this.phase === 'park') {
            const plan = this.phase === 'park' ? { hub: this.hub, keep: null, withdraw: [] } : this.kit(s);
            const r = this.bankStep(s, plan);
            if (r.status === 'busy') return;
            if (r.status === 'failed') {
                if (this.phase === 'park') {
                    this.log.log('WARN', `park bank visit failed (${r.reason}); logging out where we stand`);
                    this.finishPark();
                } else {
                    this.fail('bank', r.reason);
                }
                return;
            }
            if (this.phase === 'park') {
                this.log.log('LOG', `Parked at hub with an empty pack (${s.inventory.length} items) @ ${s.player.worldX},${s.player.worldZ}`);
                this.finishPark();
                return;
            }
            this.trips++;
            this.afterBank(r, s);
            if (this.phase === 'hub') this.phase = 'work';
            return;
        }

        // Anything modal left open (bank after a relog, a random-event window)
        // hides the inventory and swallows ops.
        if (s.modalOpen) {
            this.exec({ type: 'closeModal', reason: 'unblock' });
            this.wait(1);
            return;
        }
        this.work(s);
    }

    private finishPark(): void {
        this.phase = 'parked';
        this.writeHeartbeat(this.lastState);
        this.log.event({ type: 'stop', code: 'parked', restartable: true, message: 'parked at hub' });
        this.onParked?.();
    }

    fail(code: string, message: string): void {
        this.stopReason = code;
        this.phase = 'stopped';
        this.log.log('ERROR', message);
        this.log.event({ type: 'stop', code, restartable: false, message });
        this.writeHeartbeat(this.lastState);
        this.onParked?.();
    }

    resetBank(): void {
        this.bankOpenTick = -99;
        this.bankOpenTries = 0;
        this.bankSeenOpenTick = -1;
        this.bankDeposited = 0;
        this.bankClosing = false;
        this.bankLastMoveTick = -99;
        this.bankMoveTries = 0;
        this.bankSkip.clear();
    }

    /**
     * Walk to the hub, open a booth, deposit everything not in `keep`, withdraw
     * the kit, close. One packet per tick at most; every step is gated on the
     * state change it should cause, not on a timer.
     */
    bankStep(s: BotWorldState, plan: BankPlan): BankResult {
        const bankOpen = s.bank.isOpen;
        if (this.bankClosing) {
            if (!bankOpen && !s.modalOpen) {
                const missing = plan.withdraw
                    .filter(w => s.inventory.filter(i => w.match(i.name)).reduce((a, i) => a + i.count, 0) < w.count)
                    .map(w => w.label);
                const deposited = this.bankDeposited;
                this.resetBank();
                return { status: 'done', missing, deposited };
            }
            this.exec({ type: 'closeModal', reason: 'close bank' });
            this.wait(1);
            return { status: 'busy' };
        }

        if (!bankOpen) {
            if (s.modalOpen) {
                this.exec({ type: 'closeModal', reason: 'not the bank' });
                return { status: 'busy' };
            }
            const booth = s.nearbyLocs
                .filter(l => /^bank booth$/i.test(l.name) && l.reachable !== false && l.optionsWithIndex.length > 0)
                .sort((a, b) => a.distance - b.distance)[0];
            if (!booth || dist(here(s), plan.hub) > 8) {
                this.walk(plan.hub, 'to bank');
                return { status: 'busy' };
            }
            if (this.tick - this.bankOpenTick < 10) return { status: 'busy' }; // routing to the booth
            if (++this.bankOpenTries > 6) return { status: 'failed', reason: `bank booth never opened @ ${s.player!.worldX},${s.player!.worldZ}` };
            const op =
                booth.optionsWithIndex.find(o => /use.quickly/i.test(o.text)) ??
                booth.optionsWithIndex.find(o => /^bank$/i.test(o.text)) ??
                booth.optionsWithIndex.find(o => /^use$/i.test(o.text));
            if (!op) return { status: 'failed', reason: `bank booth has no use option: ${booth.optionsWithIndex.map(o => o.text).join('/')}` };
            const r = this.exec({ type: 'interactLoc', x: booth.x, z: booth.z, locId: booth.id, optionIndex: op.opIndex, reason: 'open bank' });
            if (!r.ok) this.log.log('WARN', `bank booth click failed: ${r.reason}`);
            this.bankOpenTick = this.tick;
            return { status: 'busy' };
        }

        if (this.bankSeenOpenTick < 0) this.bankSeenOpenTick = this.tick;
        if (s.bank.noteMode) {
            this.exec({ type: 'clickComponent', componentId: BANK_ITEM_MODE_COMPONENT, reason: 'withdraw as items' });
            this.wait(1);
            return { status: 'busy' };
        }
        // Give the bank's item list a tick to arrive after the modal opens.
        if (this.tick - this.bankSeenOpenTick < 2) return { status: 'busy' };

        // Wait for the previous move to land before sending another.
        if (this.tick - this.bankLastMoveTick < 2) return { status: 'busy' };

        // Kit held far past the plan goes back too, or a pack full of it reads as "bank" forever
        // (jacklove7 held 28 tuna: 920 empty bank trips, 2026-11-02); the withdraw below tops back up to `count`.
        // Kept items count too: the bank's preferred food can differ from the one held (jacklove7's tuna vs a cod plan).
        const held = (m: (n: string) => boolean) => s.inventory.filter(j => m(j.name)).reduce((a, j) => a + j.count, 0);
        const planned = plan.withdraw.reduce((a, w) => a + w.count, 0);
        const overHeld = s.inventory.find(i => !this.bankSkip.has(i.name.toLowerCase()) && (
            plan.withdraw.some(w => w.match(i.name) && held(w.match) > w.count * 2) ||
            (!!plan.keep && plan.keep.test(i.name) && planned > 0 && held(n => plan.keep!.test(n)) > planned * 2)));
        const deposit = overHeld ?? s.inventory.find(i => !this.bankSkip.has(i.name.toLowerCase()) && !(plan.keep && plan.keep.test(i.name)) && !plan.withdraw.some(w => w.match(i.name)));
        // Over-held kit (e.g. 14 food left from last trip, plan wants 10) stays: the next withdraw tops up to `count`.
        if (deposit) {
            if (++this.bankMoveTries > 40) {
                // Bank full or the item is stuck: carry it rather than stop the account.
                this.log.log('WARN', `deposit of ${deposit.name} never landed — keeping it`);
                this.bankSkip.add(deposit.name.toLowerCase());
                this.bankMoveTries = 0;
                return { status: 'busy' };
            }
            this.exec({ type: 'bankDeposit', slot: deposit.slot, amount: -1, reason: `deposit ${deposit.name}` });
            this.bankDeposited += s.inventory.filter(i => i.id === deposit.id).reduce((a, i) => a + i.count, 0); // "All" takes every slot of that id
            this.bankLastMoveTick = this.tick;
            return { status: 'busy' };
        }

        const free = 28 - s.inventory.length;
        for (const w of plan.withdraw) {
            const have = s.inventory.filter(i => w.match(i.name)).reduce((a, i) => a + i.count, 0);
            if (have >= w.count || this.bankSkip.has(w.label.toLowerCase())) continue;
            const item = s.bank.items.find(i => w.match(i.name) && i.count > 0);
            if (!item) {
                if (w.required) return { status: 'failed', reason: `NEEDS STOCK: ${w.label} ×${w.count - have}` };
                continue;
            }
            if (free <= 0) break;
            if (++this.bankMoveTries > 40) {
                this.log.log('WARN', `withdraw of ${w.label} never landed — going with what is held`);
                this.bankSkip.add(w.label.toLowerCase());
                this.bankMoveTries = 0;
                continue;
            }
            const need = Math.min(w.count - have, free);
            const amount = need >= 10 ? 10 : need >= 5 ? 5 : 1;
            this.exec({ type: 'bankWithdraw', slot: item.slot, amount, reason: `withdraw ${item.name}` });
            this.bankLastMoveTick = this.tick;
            return { status: 'busy' };
        }

        this.bankClosing = true;
        this.exec({ type: 'closeModal', reason: 'close bank' });
        this.wait(1);
        return { status: 'busy' };
    }

    private periodic(s: BotWorldState): void {
        const now = Date.now();
        if (now - this.heartbeatAt >= this.heartbeatMs) this.writeHeartbeat(s);
        if (now - this.statusAt >= STATUS_EVERY_MS) {
            this.statusAt = now;
            this.log.status({
                online: true,
                x: s.player!.worldX,
                z: s.player!.worldZ,
                hp: s.player!.hp,
                phase: this.phase,
                lastEffectAt: this.lastEffectAt
            });
        }
        if (now - this.summaryAt >= SUMMARY_EVERY_MS) {
            this.summaryAt = now;
            this.log.log('LOG', `${this.summary()} | phase ${this.phase} trips ${this.trips} hp ${s.player!.hp}/${s.player!.maxHp}`);
        }
    }

    writeHeartbeat(s: BotWorldState | null): void {
        if (!s?.player) return;
        this.heartbeatAt = Date.now();
        const xp: Record<string, number> = {};
        const levels: Record<string, number> = {};
        for (const k of s.skills) {
            if (k.experience > 0) xp[k.name] = k.experience;
            const lvl = k.baseLevel || k.level;
            if (lvl > 0) levels[k.name] = lvl;
        }
        this.log.heartbeat({
            xp,
            levels,
            coins: coinsIn(s),
            x: s.player.worldX,
            z: s.player.worldZ,
            phase: this.phase,
            lastProgressAt: this.lastProgressAt,
            lastEffectAt: this.lastEffectAt,
            recoveries: this.relogins,
            stopped: this.stopReason
        });
    }
}

// ------------------------------------------------------------------ knights

class KnightsBot extends JobBot {
    readonly hub = ARDOUGNE_BANK;
    private food: string | null = null;
    private bankHasFood = true;
    private lastHp = -1;
    private lastXp = -1;
    private lastCoins = -1;
    private awaiting = false;
    private pickTick = -99;
    private rejectCursor = 0;
    private unreachable = new Map<number, number>();
    private lowHpWarned = false;
    readonly stats = { picks: 0, stuns: 0, eats: 0, gp: 0, xp: 0 };
    private window = { picks: 0, stuns: 0, xp: 0, gp: 0 };

    constructor(name: string, botsDir: string, heartbeatMs: number) {
        super(name, 'swarm-knights', botsDir, heartbeatMs);
    }

    override attach(session: LiteSession): void {
        super.attach(session);
        this.lastHp = this.lastXp = this.lastCoins = -1;
        this.awaiting = false;
        this.unreachable.clear();
    }

    protected kit(s: BotWorldState): BankPlan {
        // Pick the food once per visit: the lowest-heal fish the bank still has.
        if (s.bank.isOpen && s.bank.items.length > 0) {
            const inPack = s.inventory.find(i => FOOD_RE.test(i.name))?.name;
            // Lowest-heal food with a full pack's worth banked first, then any left (jacklove6,
            // ABGARMY19, ABGARMY02 stopped when the bank ran low on cod, 2026-11-01).
            const pref =
                FOOD_PREF.map(re => s.bank.items.find(i => re.test(i.name) && i.count >= FOOD_TAKE)?.name).find(Boolean) ??
                FOOD_PREF.map(re => s.bank.items.find(i => re.test(i.name) && i.count > 0)?.name).find(Boolean);
            this.food = pref ?? inPack ?? null;
        }
        const food = this.food;
        return {
            hub: ARDOUGNE_BANK,
            // Food already held is never banked back (a full bank refused the cod deposit).
            keep: FOOD_RE,
            withdraw: food ? [{ match: n => n.toLowerCase() === food.toLowerCase(), label: food, count: FOOD_TAKE, required: false }] : []
        };
    }

    protected override afterBank(r: { missing: string[]; deposited: number }, s: BotWorldState): void {
        const held = countIn(s, FOOD_RE);
        this.bankHasFood = held > 0;
        if (!this.bankHasFood) this.log.log('WARN', 'No food in bank: thieving without food, idling to regen under the hp floor');
        this.log.log('LOG', `Banked ${r.deposited} | trip ${this.trips} | food ${held}× ${this.food ?? 'none'}`);
        this.log.event({ type: 'progress', kind: 'inventory', message: `trip ${this.trips}` });
    }

    protected summary(): string {
        const w = this.window;
        this.window = { picks: 0, stuns: 0, xp: 0, gp: 0 };
        return `knights 60s: ${w.picks} picks ${w.stuns} stuns +${w.xp}xp +${w.gp}gp | total ${this.stats.picks} picks ${this.stats.stuns} stuns ${this.stats.eats} eats ${this.stats.gp}gp`;
    }

    protected work(s: BotWorldState): void {
        const lvl = skill(s, 'Thieving')?.baseLevel ?? 1;
        if (lvl < 55) {
            this.fail('level', `Thieving ${lvl} < 55: cannot pickpocket knights`);
            return;
        }
        const hp = s.player!.hp;
        const maxHp = s.player!.maxHp;
        const xp = skill(s, 'Thieving')?.experience ?? 0;
        const coins = coinsIn(s);

        // Score from deltas (swarm.ts): XP up = pick, hp down = stun.
        if (this.lastXp >= 0) {
            if (xp > this.lastXp) {
                this.stats.picks++;
                this.window.picks++;
                this.stats.xp += xp - this.lastXp;
                this.window.xp += xp - this.lastXp;
                this.awaiting = false;
                this.effect();
            }
            if (coins > this.lastCoins) {
                this.stats.gp += coins - this.lastCoins;
                this.window.gp += coins - this.lastCoins;
            }
            if (hp < this.lastHp && this.awaiting) {
                this.stats.stuns++;
                this.window.stuns++;
                this.awaiting = false;
                this.lastHp = hp;
                this.lastXp = xp;
                this.lastCoins = coins;
                this.wait(STUN_TICKS); // %stunned drops every opnpc until it clears
                return;
            }
        }
        this.lastHp = hp;
        this.lastXp = xp;
        this.lastCoins = coins;
        if (this.awaiting && s.opFeedback.opRejectedCount > this.rejectCursor) {
            this.rejected++;
            this.awaiting = false;
        }

        // --- eat / restock
        const eatBelow = Math.max(MIN_PICK_HP + 3, maxHp - 12);
        if (hp <= eatBelow) {
            const food = s.inventory.find(i => FOOD_RE.test(i.name));
            const eat = food?.optionsWithIndex.find(o => /^eat$/i.test(o.text));
            if (food && eat) {
                this.exec({ type: 'useInventoryItem', slot: food.slot, optionIndex: eat.opIndex, reason: 'eat' });
                this.stats.eats++;
                this.wait(2);
                return;
            }
            if (this.bankHasFood) {
                this.log.log('LOG', `Out of food at ${hp}/${maxHp}: restocking`);
                this.phase = 'hub';
                return;
            }
            if (hp <= MIN_PICK_HP) {
                if (!this.lowHpWarned) this.log.log('WARN', `hp ${hp} <= ${MIN_PICK_HP} and no food: regenerating`);
                this.lowHpWarned = true;
                this.wait(10);
                return;
            }
        }
        this.lowHpWarned = false;

        if (coins >= BANK_COINS_AT || s.inventory.length >= 28) {
            this.log.log('LOG', `Banking ${coins} coins`);
            this.phase = 'hub';
            return;
        }

        const me = here(s);
        if (dist(me, KNIGHTS) > KNIGHT_RADIUS) {
            this.walk(KNIGHTS, 'to knights');
            return;
        }

        const knight = s.nearbyNpcs
            .filter(n => KNIGHT_RE.test(n.name))
            .filter(n => dist({ x: n.tileX, z: n.tileZ }, KNIGHTS) <= KNIGHT_RADIUS)
            .filter(n => n.reachable !== false)
            .filter(n => (this.unreachable.get(n.index) ?? 0) < this.tick)
            .filter(n => n.optionsWithIndex.some(o => /pickpocket/i.test(o.text)))
            .sort((a, b) => a.distance - b.distance)[0];
        if (!knight) {
            this.walk(KNIGHTS, 'find knights', 8);
            return;
        }
        if (this.awaiting && this.tick - this.pickTick < PICK_RETRY_TICKS) return;
        const op = knight.optionsWithIndex.find(o => /pickpocket/i.test(o.text))!;
        const r = this.exec({ type: 'interactNpc', npcIndex: knight.index, optionIndex: op.opIndex, reason: 'pickpocket' });
        if (!r.ok) {
            if (/cant_reach/.test(r.reason ?? '')) this.unreachable.set(knight.index, this.tick + 50);
            return;
        }
        this.pickTick = this.tick;
        this.awaiting = true;
        this.rejectCursor = s.opFeedback.opRejectedCount;
    }
}

// ------------------------------------------------------------------ big net

class BigNetBot extends JobBot {
    readonly hub = CATHERBY_BANK;
    private hunt = 0;
    private lastXp = -1;
    private lastSlots = -1;
    private lastActiveTick = 0;
    private castTick = -99;
    private noSpotTicks = 0;
    readonly stats = { catches: 0, xp: 0, dropped: 0, banked: 0 };
    private window = { catches: 0, xp: 0 };

    private readonly drop: RegExp;

    constructor(name: string, botsDir: string, heartbeatMs: number, opts: JobOptions = {}) {
        super(name, 'swarm-bignet', botsDir, heartbeatMs);
        // bankFish: keep mackerel/cod for the bank instead of the fleet's drop-on-catch.
        this.drop = opts.bankFish ? BIG_NET_JUNK_ONLY : BIG_NET_DROP;
    }

    override attach(session: LiteSession): void {
        super.attach(session);
        this.lastXp = this.lastSlots = -1;
    }

    protected kit(): BankPlan {
        return {
            hub: CATHERBY_BANK,
            keep: null,
            withdraw: [{ match: n => BIG_NET_RE.test(n), label: 'big fishing net', count: 1, required: true }]
        };
    }

    protected override afterBank(r: { missing: string[]; deposited: number }): void {
        this.stats.banked += r.deposited;
        this.log.log('LOG', `Banked ${r.deposited} | trip ${this.trips} total ${this.stats.banked}`);
        this.log.event({ type: 'progress', kind: 'inventory', message: `trip ${this.trips}` });
    }

    protected summary(): string {
        const w = this.window;
        this.window = { catches: 0, xp: 0 };
        return `bignet 60s: ${w.catches} catches +${w.xp}xp | total ${this.stats.catches} catches ${this.stats.dropped} dropped ${this.stats.banked} banked`;
    }

    protected work(s: BotWorldState): void {
        const lvl = skill(s, 'Fishing')?.baseLevel ?? 1;
        if (lvl < 16) {
            this.fail('level', `Fishing ${lvl} < 16: cannot use a big net`);
            return;
        }
        const xp = skill(s, 'Fishing')?.experience ?? 0;
        if (this.lastXp >= 0 && xp > this.lastXp) {
            this.stats.catches++;
            this.window.catches++;
            this.stats.xp += xp - this.lastXp;
            this.window.xp += xp - this.lastXp;
            this.effect();
            this.lastActiveTick = this.tick;
        }
        // Junk (seaweed, boots) gives no XP; count a new slot as activity too.
        if (this.lastSlots >= 0 && s.inventory.length > this.lastSlots) this.lastActiveTick = this.tick;
        this.lastXp = xp;
        this.lastSlots = s.inventory.length;

        if (!s.inventory.some(i => BIG_NET_RE.test(i.name))) {
            this.log.log('WARN', 'No big net in pack: back to the bank');
            this.phase = 'hub';
            return;
        }

        const junk: InventoryItem | undefined = s.inventory.find(i => this.drop.test(i.name));
        if (junk && s.inventory.length >= 27) {
            this.exec({ type: 'dropItem', slot: junk.slot, reason: `drop ${junk.name}` });
            this.stats.dropped++;
            this.wait(1);
            return;
        }
        if (s.inventory.length >= 28) {
            this.log.log('LOG', `Pack full (${s.inventory.length}): banking`);
            this.phase = 'hub';
            return;
        }

        if (s.player!.animId !== -1) {
            this.lastActiveTick = this.tick;
            return;
        }
        const spot = s.nearbyNpcs
            .filter(n => /^fishing spot$/i.test(n.name))
            .filter(n => has(n, /^net$/i) && has(n, /^harpoon$/i) && !has(n, /^cage$/i) && !has(n, /^bait$/i))
            .filter(n => n.reachable !== false)
            .sort((a, b) => a.distance - b.distance)[0];
        const pier = CATHERBY_PIER[this.hunt % CATHERBY_PIER.length]!;
        if (!spot || spot.distance > 10) {
            if (spot) {
                this.walk({ x: spot.tileX, z: spot.tileZ }, 'to spot');
            } else {
                if (dist(here(s), pier) <= 3 && ++this.noSpotTicks > 10) {
                    this.hunt++;
                    this.noSpotTicks = 0;
                }
                this.walk(pier, 'hunt spot');
            }
            return;
        }
        this.noSpotTicks = 0;
        if (this.tick - Math.max(this.lastActiveTick, this.castTick) < FISH_IDLE_TICKS) return;
        const op = spot.optionsWithIndex.find(o => /^net$/i.test(o.text))!;
        const r = this.exec({ type: 'interactNpc', npcIndex: spot.index, optionIndex: op.opIndex, reason: 'big net' });
        if (!r.ok) this.log.log('WARN', `cast failed: ${r.reason}`);
        this.castTick = this.tick;
    }
}

function has(n: NearbyNpc, re: RegExp): boolean {
    return n.optionsWithIndex.some(o => re.test(o.text));
}

interface JobOptions {
    bankFish?: boolean;
}

const JOBS: Record<string, new (name: string, botsDir: string, heartbeatMs: number, opts?: JobOptions) => JobBot> = {
    knights: KnightsBot,
    bignet: BigNetBot
};

// ------------------------------------------------------------------ CLI + supervision

const argv = process.argv.slice(2);
const flag = (k: string) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
// Lives in bots/quests/ on the fleet (mounted; no image rebuild): the repo root is two up.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

interface SwarmConfig {
    botsDir?: string;
    heartbeatSec?: number;
    accounts: Array<{ name: string; job: string; options?: JobOptions }>;
}

function loadConfig(): SwarmConfig {
    const path = flag('config');
    const cfg: SwarmConfig = path ? JSON.parse(readFileSync(path, 'utf-8')) : { accounts: [] };
    for (const a of argv.filter(a => !a.startsWith('-'))) {
        const [job, name] = a.split(':');
        if (!job || !name) throw new Error(`expected job:account, got ${a}`);
        cfg.accounts.push({ name, job });
    }
    if (flag('bots-dir')) cfg.botsDir = flag('bots-dir');
    if (flag('heartbeat-sec')) cfg.heartbeatSec = Number(flag('heartbeat-sec'));
    return cfg;
}

const cfg = loadConfig();
if (cfg.accounts.length === 0) {
    console.error('Usage: bun src/lite/swarm-jobs.ts [--config=swarm.json] [job:account ...] [--minutes=N] [--bots-dir=DIR]');
    console.error(`jobs: ${Object.keys(JOBS).join(', ')}`);
    process.exit(1);
}
const botsDir = cfg.botsDir ?? join(repoRoot, 'bots');
const heartbeatMs = (cfg.heartbeatSec ?? 300) * 1000;
const minutes = Number(flag('minutes') ?? 0);

function readEnv(bot: string): Record<string, string> {
    const path = join(botsDir, bot, 'bot.env');
    if (!existsSync(path)) throw new Error(`no ${path}`);
    return Object.fromEntries(
        readFileSync(path, 'utf-8')
            .split('\n')
            .filter(l => l.includes('=') && !l.startsWith('#'))
            .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
    );
}

let shuttingDown = false;

async function login(bot: JobBot): Promise<void> {
    const env = readEnv(bot.name);
    const session = await startSession({
        host: env.SERVER || 'localhost',
        username: env.BOT_USERNAME!,
        password: env.PASSWORD!,
        quiet: true,
        onEnd: (end: SessionEnd) => onSessionEnd(bot, end)
    });
    bot.attach(session);
}

function onSessionEnd(bot: JobBot, end: SessionEnd): void {
    bot.log.status({ online: false, phase: bot.phase, reason: end.reason });
    if (shuttingDown || end.reason === 'stopped' || bot.phase === 'parked' || bot.phase === 'stopped') return;
    bot.log.log('WARN', `session ended (${end.reason}): re-logging in`);
    bot.log.event({ type: 'failure', code: 'session_end', message: end.reason });
    void relogin(bot);
}

function exitIfOutdated(e: unknown): void {
    if (e instanceof OutdatedClientError) {
        console.error(`[swarm-jobs] ${e.message}`);
        process.exit(3);
    }
}

async function relogin(bot: JobBot): Promise<void> {
    let delay = RELOGIN_MS;
    while (!shuttingDown) {
        await Bun.sleep(delay);
        if (shuttingDown) return;
        try {
            await login(bot);
            bot.relogins++;
            bot.log.log('LOG', `back online (${bot.relogins} re-logins)`);
            bot.log.event({ type: 'recovery', tactic: 'relogin', message: 'relogin' });
            return;
        } catch (e) {
            exitIfOutdated(e);
            bot.log.log('WARN', `re-login failed (${e}); retry in ${Math.round(delay / 1000)}s`);
            delay = Math.min(delay * 2, RELOGIN_MAX_MS);
        }
    }
}

const bots: JobBot[] = [];
for (const a of cfg.accounts) {
    const Job = JOBS[a.job];
    if (!Job) {
        console.error(`[swarm-jobs] unknown job '${a.job}' for ${a.name}; jobs: ${Object.keys(JOBS).join(', ')}`);
        process.exit(1);
    }
    const bot = new Job(a.name, botsDir, heartbeatMs, a.options ?? {});
    bot.onParked = () => bot.detach();
    bots.push(bot);
    bot.log.event({ type: 'start', message: `swarm-jobs ${a.job}` });
    bot.log.log('LOG', `swarm-jobs start: ${a.job} (pid ${process.pid}, ${cfg.accounts.length} accounts in process)`);
    try {
        await login(bot);
    } catch (e) {
        exitIfOutdated(e);
        bot.log.log('WARN', `login failed (${e}); retrying in background`);
        void relogin(bot);
    }
    await Bun.sleep(LOGIN_STAGGER_MS);
}

const startedAt = Date.now();
const rssLine = () => `rss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MiB heap ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)} MiB`;
const report = setInterval(() => {
    const online = bots.filter(b => b.online).length;
    console.log(`[swarm-jobs] ${((Date.now() - startedAt) / 60_000).toFixed(1)}m | ${online}/${bots.length} online | ${rssLine()}`);
}, 30_000);

async function shutdown(why: string): Promise<void> {
    if (shuttingDown) return;
    console.log(`[swarm-jobs] ${why}: parking ${bots.length} accounts at their hubs`);
    for (const b of bots) b.stopping = true;
    const deadline = Date.now() + PARK_TIMEOUT_MS;
    while (Date.now() < deadline && bots.some(b => b.online && b.phase !== 'parked' && b.phase !== 'stopped')) {
        await Bun.sleep(500);
    }
    shuttingDown = true;
    clearInterval(report);
    for (const b of bots) {
        if (b.phase !== 'parked' && b.phase !== 'stopped') {
            b.log.log('WARN', `not parked after ${PARK_TIMEOUT_MS / 1000}s (phase ${b.phase}); logging out in place`);
            b.writeHeartbeat(b.lastState);
            b.log.event({ type: 'stop', code: 'park_timeout', restartable: true, message: 'logged out without parking' });
        }
        b.detach();
    }
    console.log(`[swarm-jobs] stopped | ${rssLine()}`);
    // Let the sockets close so the engine saves each account.
    await Bun.sleep(1000);
    process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
if (minutes > 0) setTimeout(() => void shutdown(`--minutes=${minutes} elapsed`), minutes * 60_000);
