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
//   guild    Ranging Guild archery from Seers' bank (a strung shortbow, 200 coins a round).
//            At { until: N } (default 99): all tickets into rune arrows, the coins it carries
//            into rune arrows and arrowheads, everything banked at Seers including worn gear, park.
//   essence  Rune essence via Aubury (Rune Mysteries, a pickaxe), banking at Varrock east.

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
const KNIGHT_RADIUS = 12;
/** Smallest ground coin stack worth stopping a pickpocket for (user, 2026-11-02). */
const LOOSE_GOLD_MIN = 1000; // only knights near the market; never chase one into a house
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

// --- guild (Ranging Guild archery: game_ranging/scripts/competition_judge.rs2, target.rs2)
const SEERS_BANK: Tile = { x: 2726, z: 3491 };
/** The guild door (2658,3438) is the compound's only way in: outside to the north-west, inside to the south-east. */
const GUILD_OUTSIDE: Tile = { x: 2657, z: 3439 };
const GUILD_INSIDE: Tile = { x: 2659, z: 3437 };
const GUILD_MIN_RANGED = 40; // ranging_guild_door.rs2
const inGuild = (t: Tile) => t.x >= 2659 && t.x <= 2695 && t.z >= 3400 && t.z <= 3437;
/** sdk findLongPath Seers' bank -> the door passes here; both legs are in one build area. */
const GUILD_MIDWAY: Tile = { x: 2674, z: 3460 };
const GUILD_STAND: Tile = { x: 2670, z: 3417 };
const JUDGE_RE = /^competition judge$/i;
const GUILD_ENTRY_FEE = 200;
const GUILD_SHOTS = 10;
const GUILD_COINS_TAKE = 20_000; // 100 rounds
const GUILD_SHOT_GAP = 4; // target.rs2 p_delay(2) plus the op landing
const GUILD_SHOT_TIMEOUT = 8;
/** Strung shortbows by obj id, best first, with the Ranged level each needs. */
const GUILD_BOWS: Array<[number, number]> = [[861, 50], [857, 40], [853, 30], [849, 20], [843, 5], [841, 1]];
const BOW_WORN_RE = /(short|long)bow$/i;
const ARROW_RE = /^bronze arrow$/i;
const TICKET_RE = /^archery ticket$/i;
// End of the job: tickets, then what coins are left, into rune arrows (ticket_merchant.rs2).
const TICKET_MERCHANT: Tile = { x: 2659, z: 3431 };
const TICKET_MERCHANT_RE = /^ticket merchant$/i;
const TICKET_SHOP_IF = 4461;
const TICKET_RUNE_ARROWS_BUTTON = 4552; // tickets_shop:com_90, 50 rune arrows
const TICKET_RUNE_ARROWS_COST = 2000;
const BOW_SHOP: Tile = { x: 2672, z: 3433 };
const BOW_SALESMAN_RE = /^bow and arrow salesman$/i;
const SHOP_BUYS = [/^rune arrow$/i, /^rune arrowheads?$/i];

// --- essence (essence.ts routes; the swarm walks them leg by leg)
const VARROCK_EAST_BANK: Tile = { x: 3253, z: 3420 };
const ESSENCE_LEGS: Tile[] = [
    { x: 3260, z: 3428 }, // street outside the bank
    { x: 3260, z: 3405 }, // north end of the run, outside the shop
    { x: 3259, z: 3402 }, // bend to the shop door at 3260,3400
    { x: 3253, z: 3403 } // beside Aubury, inside the shop
];
const AUBURY_RE = /^aubury$/i;
const ESSENCE_RE = /^(rune|pure) essence$/i;
const ESSENCE_ROCK_RE = /rune essence/i;
const PICK_RE = /^(rune|adamant|mithril|steel|iron|bronze|dragon) pickaxe$/i;
const PICKS: Array<[RegExp, number]> = [
    [/^rune pickaxe$/i, 41], [/^adamant pickaxe$/i, 31], [/^mithril pickaxe$/i, 21],
    [/^steel pickaxe$/i, 6], [/^iron pickaxe$/i, 1], [/^bronze pickaxe$/i, 1]
];
const MINE_IDLE_TICKS = 4;
const inEssenceMine = (t: Tile) => t.x >= 2860 && t.x <= 3040 && t.z >= 4760 && t.z <= 4940;

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
    withdraw: Array<{
        match: (name: string) => boolean;
        label: string;
        count: number;
        required: boolean;
        /** Match this obj id instead of the name (unstrung bows share the strung bow's name). */
        id?: number;
        /** Withdraw exactly what is short through the count dialog, not in 1/5/10 steps (coins). */
        exact?: boolean;
    }>;
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
    private doorTick = -99;
    private routeKey = '';
    private routeAt = 0;
    private routePos: Tile = { x: 0, z: 0 };
    private routeStuck = 0;

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
    /** A job whose work is somewhere else entirely (the essence mine) is not stranded there. */
    protected farFromHubOk(_s: BotWorldState): boolean {
        return false;
    }
    /** Level-ups and NPC chatter block every op server-side: answer whatever is open. */
    protected handleDialog(_s: BotWorldState): void {
        this.exec({ type: 'clickDialogOption', optionIndex: 0, reason: 'continue dialog' });
        this.wait(1);
    }
    /** A job that means to use a modal (a shop) answers true; anything else open gets closed. */
    protected handleModal(_s: BotWorldState): boolean {
        return false;
    }
    /** How the bank visit gets back to the hub; a job behind a door or a portal overrides this. */
    protected travelToHub(_s: BotWorldState, hub: Tile): void {
        this.walk(hub, 'to bank');
    }
    /**
     * Walk a fixed list of legs, remembering the leg between ticks: picking the nearest leg each
     * tick turns back whenever the previous leg is still the closest one. A new route starts from
     * its nearest leg, so a run can resume mid-way. Opens a door in the way once stuck.
     */
    protected walkRoute(s: BotWorldState, key: string, legs: Tile[], reason: string): void {
        const me = here(s);
        if (this.routeKey !== key) {
            this.routeKey = key;
            this.routeAt = 0;
            let best = Infinity;
            legs.forEach((l, i) => {
                const d = dist(me, l);
                if (d < best) {
                    best = d;
                    this.routeAt = i;
                }
            });
        }
        while (this.routeAt < legs.length - 1 && dist(me, legs[this.routeAt]!) <= 2) this.routeAt++;
        if (me.x === this.routePos.x && me.z === this.routePos.z) this.routeStuck++;
        else this.routeStuck = 0;
        this.routePos = me;
        if (this.routeStuck >= 6 && this.openDoorNear(s, 4)) {
            this.routeStuck = 0;
            return;
        }
        this.walk(legs[this.routeAt]!, reason);
    }
    /** Click a closed door/gate within `radius`, when a walk has stopped making progress. */
    protected openDoorNear(s: BotWorldState, radius: number, name: RegExp = /^(door|large door|gate)$/i): boolean {
        if (this.tick - this.doorTick < 6) return false;
        const door = s.nearbyLocs
            .filter(l => name.test(l.name) && l.distance <= radius)
            .filter(l => l.optionsWithIndex.some(o => /^open$/i.test(o.text)))
            .sort((a, b) => a.distance - b.distance)[0];
        if (!door) return false;
        const op = door.optionsWithIndex.find(o => /^open$/i.test(o.text))!;
        this.exec({ type: 'interactLoc', x: door.x, z: door.z, locId: door.id, optionIndex: op.opIndex, reason: 'open door' });
        this.doorTick = this.tick;
        return true;
    }

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

        if (s.dialog.isOpen) {
            this.handleDialog(s);
            return;
        }

        if (dist(here(s), this.hub) > STRANDED_DIST && !this.farFromHubOk(s)) {
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
            if (this.handleModal(s)) return;
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
                    .filter(w => s.inventory.filter(i => (w.id ? i.id === w.id : w.match(i.name))).reduce((a, i) => a + i.count, 0) < w.count)
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
                this.travelToHub(s, plan.hub);
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
            const have = s.inventory.filter(i => (w.id ? i.id === w.id : w.match(i.name))).reduce((a, i) => a + i.count, 0);
            if (have >= w.count || this.bankSkip.has(w.label.toLowerCase())) continue;
            const item = s.bank.items.find(i => (w.id ? i.id === w.id : w.match(i.name)) && i.count > 0);
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
            const amount = w.exact ? Math.min(w.count - have, item.count) : need >= 10 ? 10 : need >= 5 ? 5 : 1;
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
    /** Coin piles that would not route, by "x,z", skipped until the tick stored. */
    private badPiles = new Map<string, number>();
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

        // Loose coins: a stack of LOOSE_GOLD_MIN+ within 6 tiles is taken between pickpockets
        // (other players' drops show once public; user, 2026-11-02).
        const pile = (s.groundItems ?? [])
            .filter(g => /^coins$/i.test(g.name) && g.count >= LOOSE_GOLD_MIN && g.distance <= 6 && g.reachable !== false)
            .filter(g => (this.badPiles.get(`${g.x},${g.z}`) ?? 0) < this.tick)
            .filter(() => s.inventory.length < 28 || s.inventory.some(i => /^coins$/i.test(i.name)))
            .sort((a, b) => b.count - a.count)[0];
        if (pile) {
            const r = this.exec({ type: 'pickupItem', x: pile.x, z: pile.z, itemId: pile.id, reason: 'loose gold' });
            if (!r.ok) {
                this.badPiles.set(`${pile.x},${pile.z}`, this.tick + 50);
            } else {
                this.log.log('LOG', `Picking up ${pile.count} loose coins at ${pile.x},${pile.z}`);
                this.wait(3);
            }
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

// ------------------------------------------------------------------ ranging guild

/**
 * Pay the Competition Judge, fire 10 arrows from behind the hay, collect the tickets, repeat.
 * XP is points / 2 per shot before the world's XP rate; a round costs 200 coins. Ops are fired
 * from range, so nobody walks once at the stand. Stops at `until` (default 99) and parks.
 */
class GuildBot extends JobBot {
    readonly hub = SEERS_BANK;
    private readonly until: number;
    private round: 'talk' | 'shoot' = 'talk';
    private fired = 0;
    private refused = 0;
    private shotPendingSince = -1;
    private wornAtShot = 0;
    private lastShotTick = -99;
    private talkTick = -99;
    private lastXp = -1;
    private lastTickets = -1;
    /** After the target level: spend the tickets, spend the coins, bank everything, park. */
    private finish: 'no' | 'tickets' | 'shop' | 'bank' | 'strip' = 'no';
    private finishClickTick = -99;
    private readonly wornTries = new Map<number, number>();
    private readonly stuckWorn = new Set<number>();
    private doorClickTick = -99;
    private shopPick = 0;
    private shopCoins = -1;
    private shopStall = 0;
    readonly stats = { rounds: 0, shots: 0, xp: 0, tickets: 0 };
    private window = { rounds: 0, xp: 0, tickets: 0 };

    constructor(name: string, botsDir: string, heartbeatMs: number, opts: JobOptions = {}) {
        super(name, 'swarm-guild', botsDir, heartbeatMs);
        this.until = opts.until ?? 99;
    }

    override attach(session: LiteSession): void {
        super.attach(session);
        this.round = 'talk';
        this.shotPendingSince = -1;
        this.lastXp = this.lastTickets = -1;
    }

    protected kit(s: BotWorldState): BankPlan {
        const lvl = skill(s, 'Ranged')?.baseLevel ?? 1;
        // Already at the target on login (a swarm restart): no coins out, or each restart spends them again.
        if (this.finish !== 'no' || (lvl >= this.until && this.stats.rounds === 0)) return { hub: SEERS_BANK, keep: null, withdraw: [] };
        const withdraw: BankPlan['withdraw'] = [
            { match: n => /^coins$/i.test(n), label: 'coins', count: GUILD_COINS_TAKE, required: true, exact: true }
        ];
        if (!s.equipment.some(i => BOW_WORN_RE.test(i.name))) {
            const usable = GUILD_BOWS.filter(([, need]) => need <= lvl);
            const best = usable.find(([id]) => s.bank.items.some(i => i.id === id) || s.inventory.some(i => i.id === id)) ?? usable[0]!;
            withdraw.push({ match: () => false, label: 'strung shortbow', count: 1, required: true, id: best[0] });
        }
        // Tickets stay in the pack between coin trips: the end of the job spends them all.
        return { hub: SEERS_BANK, keep: /^coins$|bow$|^archery ticket$/i, withdraw };
    }

    protected override afterBank(r: { missing: string[]; deposited: number }): void {
        if (r.missing.length) this.log.log('WARN', `kit short: ${r.missing.join(', ')}`);
        this.log.event({ type: 'progress', kind: 'inventory', message: `trip ${this.trips}` });
    }

    protected summary(): string {
        const w = this.window;
        this.window = { rounds: 0, xp: 0, tickets: 0 };
        return `guild 60s: ${w.rounds} rounds +${w.xp}xp +${w.tickets} tickets | total ${this.stats.rounds} rounds ${this.stats.shots} shots ${this.stats.tickets} tickets`;
    }

    /** The judge's menus: enter, buy arrows if short, and skip the rules when mid-round. */
    protected override handleDialog(s: BotWorldState): void {
        const pick = (re: RegExp) => s.dialog.options.find(o => re.test(o.text));
        const enter = pick(/^sure, i'?ll give it a go/i);
        const arrows = pick(/^sure, i'?ll take some/i);
        const midRound = pick(/^no thanks, i'?ve got it/i);
        const wares = this.finish === 'shop' ? pick(/^yes please/i) : undefined;
        const choice = enter ?? arrows ?? midRound ?? wares;
        if (choice) {
            if (enter || midRound) {
                this.round = 'shoot';
                this.fired = 0;
                this.refused = 0;
                this.shotPendingSince = -1;
            }
            this.exec({ type: 'clickDialogOption', optionIndex: choice.index, reason: 'judge' });
            this.wait(1);
            return;
        }
        super.handleDialog(s);
    }

    private judge(s: BotWorldState): NearbyNpc | undefined {
        return s.nearbyNpcs.find(n => JUDGE_RE.test(n.name) && n.reachable !== false);
    }

    private clickGuildDoor(s: BotWorldState): void {
        if (this.tick - this.doorClickTick < 6) return;
        const door = s.nearbyLocs.find(l => /^guild door$/i.test(l.name) && l.optionsWithIndex.length > 0);
        if (!door) return;
        const op = door.optionsWithIndex.find(o => /^open$/i.test(o.text)) ?? door.optionsWithIndex[0]!;
        this.exec({ type: 'interactLoc', x: door.x, z: door.z, locId: door.id, optionIndex: op.opIndex, reason: 'guild door' });
        this.doorClickTick = this.tick;
    }

    protected override travelToHub(s: BotWorldState, hub: Tile): void {
        if (inGuild(here(s))) {
            if (dist(here(s), GUILD_INSIDE) > 1) this.walkRoute(s, 'guild-exit', [GUILD_INSIDE], 'guild door, inside');
            else this.clickGuildDoor(s);
            return;
        }
        this.walkRoute(s, 'guild-out', [GUILD_OUTSIDE, GUILD_MIDWAY, hub], 'to Seers');
    }

    /** The ticket shop and the bow salesman's shop are modals: buy, then let the base close them. */
    protected override handleModal(s: BotWorldState): boolean {
        if (this.finish === 'tickets' && s.modalInterface === TICKET_SHOP_IF) {
            if (countIn(s, TICKET_RE) < TICKET_RUNE_ARROWS_COST) return false;
            if (this.tick - this.finishClickTick < 2) return true;
            this.finishClickTick = this.tick;
            this.exec({ type: 'clickComponent', componentId: TICKET_RUNE_ARROWS_BUTTON, reason: '50 rune arrows' });
            return true;
        }
        if (this.finish === 'shop' && s.shop.isOpen) {
            const coins = coinsIn(s);
            if (coins === this.shopCoins) this.shopStall++;
            else this.shopStall = 0;
            this.shopCoins = coins;
            if (this.shopStall >= 5) {
                this.shopStall = 0;
                this.shopPick++;
            }
            const re = SHOP_BUYS[this.shopPick];
            const item = re ? s.shop.shopItems.find(i => re.test(i.name) && i.count > 0) : undefined;
            if (!re) {
                this.log.log('LOG', `Shop done, ${coins} coins left`);
                this.finish = 'bank';
                return false;
            }
            if (!item || coins < (item.buyPrice || 1)) {
                this.shopPick++;
                return true;
            }
            const can = Math.min(item.count, Math.floor(coins / (item.buyPrice || 1)));
            const amount = can >= 10 ? 10 : can >= 5 ? 5 : 1;
            this.exec({ type: 'shopBuy', slot: item.slot, amount, reason: `buy ${item.name}` });
            this.effect();
            return true;
        }
        return false;
    }

    /** At the target level: spend everything, bank everything including what is worn, then park. */
    private finishStep(s: BotWorldState): void {
        const talkTo = (npc: NearbyNpc | undefined, at: Tile, why: string) => {
            if (!npc || npc.distance > 8) {
                this.walkRoute(s, `finish-${why}`, [at], why);
                return;
            }
            if (this.tick - this.finishClickTick < 8) return;
            this.finishClickTick = this.tick;
            this.exec({ type: 'talkToNpc', npcIndex: npc.index, reason: why });
        };
        if (this.finish === 'tickets') {
            if (countIn(s, TICKET_RE) < TICKET_RUNE_ARROWS_COST) {
                this.log.log('LOG', `Tickets spent: ${countIn(s, TICKET_RE)} left, ${countIn(s, /^rune arrow$/i)} rune arrows`);
                this.finish = 'shop';
                this.shopPick = 0;
                return;
            }
            talkTo(s.nearbyNpcs.find(n => TICKET_MERCHANT_RE.test(n.name)), TICKET_MERCHANT, 'ticket merchant');
            return;
        }
        if (this.finish === 'shop') {
            if (coinsIn(s) <= 0) {
                this.finish = 'bank';
                return;
            }
            talkTo(s.nearbyNpcs.find(n => BOW_SALESMAN_RE.test(n.name)), BOW_SHOP, 'bow salesman');
            return;
        }
        if (this.finish === 'bank') {
            this.log.log('LOG', `Walking back to Seers with ${countIn(s, /^rune arrow$/i)} rune arrows, ${countIn(s, /^rune arrowheads?$/i)} arrowheads`);
            this.finish = 'strip';
            this.phase = 'hub';
            return;
        }
        // Back from the hub with an empty pack: take off what is worn, one piece a tick.
        const worn = s.equipment.find(i => !this.stuckWorn.has(i.id));
        if (worn) {
            if (s.inventory.length >= 28) {
                this.phase = 'hub'; // the pack filled with what came off: bank it and carry on
                return;
            }
            if (this.wornTries.get(worn.id) === undefined) this.wornTries.set(worn.id, 0);
            const tries = this.wornTries.get(worn.id)! + 1;
            this.wornTries.set(worn.id, tries);
            if (tries > 10) {
                this.log.log('WARN', `${worn.name} would not come off: leaving it worn`);
                this.stuckWorn.add(worn.id);
                return;
            }
            // Slot op 1 is Remove (inv_button1); the option list on worn items does not apply here.
            this.exec({ type: 'useEquipmentItem', slot: worn.slot, optionIndex: 1, reason: `remove ${worn.name}` });
            this.wait(1);
            return;
        }
        if (s.inventory.length > 0) {
            this.phase = 'hub'; // bank what came off
            return;
        }
        this.log.log('LOG', `Job finished, all banked (Ranged ${skill(s, 'Ranged')?.baseLevel}): parking`);
        this.stopping = true;
    }

    private wield(s: BotWorldState, item: InventoryItem): void {
        const op = item.optionsWithIndex.find(o => /^(wield|wear|equip)$/i.test(o.text));
        if (op) this.exec({ type: 'useInventoryItem', slot: item.slot, optionIndex: op.opIndex, reason: `wield ${item.name}` });
        this.wait(1);
    }

    protected work(s: BotWorldState): void {
        const lvl = skill(s, 'Ranged')?.baseLevel ?? 1;
        if (this.finish !== 'no') {
            this.finishStep(s);
            return;
        }
        if (lvl < GUILD_MIN_RANGED) {
            this.fail('level', `Ranged ${lvl} < ${GUILD_MIN_RANGED}: the guild door stays shut`);
            return;
        }
        if (lvl >= this.until && this.stats.rounds === 0) {
            this.log.log('LOG', `Ranged ${lvl} is already at the target ${this.until}: nothing to do, parking`);
            this.stopping = true;
            return;
        }
        const xp = skill(s, 'Ranged')?.experience ?? 0;
        if (this.lastXp >= 0 && xp > this.lastXp) {
            this.stats.xp += xp - this.lastXp;
            this.window.xp += xp - this.lastXp;
            this.effect();
        }
        this.lastXp = xp;
        const tickets = countIn(s, TICKET_RE);
        if (this.lastTickets >= 0 && tickets > this.lastTickets) {
            const got = tickets - this.lastTickets;
            this.stats.tickets += got;
            this.window.tickets += got;
            this.stats.rounds++;
            this.window.rounds++;
            this.effect();
        }
        this.lastTickets = tickets;

        const packBow = s.inventory.find(i => BOW_WORN_RE.test(i.name));
        if (!s.equipment.some(i => BOW_WORN_RE.test(i.name))) {
            if (packBow) this.wield(s, packBow);
            else {
                this.log.log('WARN', 'No bow: back to the bank');
                this.phase = 'hub';
            }
            return;
        }
        const packArrows = s.inventory.find(i => ARROW_RE.test(i.name));
        if (packArrows) {
            this.wield(s, packArrows);
            return;
        }

        if (!inGuild(here(s))) {
            if (dist(here(s), GUILD_OUTSIDE) > 1) this.walkRoute(s, 'guild-in', [GUILD_MIDWAY, GUILD_OUTSIDE], 'to the guild');
            else this.clickGuildDoor(s);
            return;
        }
        if (dist(here(s), GUILD_STAND) > 3) {
            this.walkRoute(s, 'guild-stand', [GUILD_STAND], 'to the stand');
            return;
        }
        const judge = this.judge(s);
        if (!judge) {
            this.log.log('WARN', `No judge in view @ ${s.player!.worldX},${s.player!.worldZ}`);
            this.wait(4);
            return;
        }

        if (this.round === 'talk') {
            // Only between rounds, so the last round's tickets are in the pack first.
            if (lvl >= this.until) {
                this.log.log('LOG', `Ranged ${lvl} reached the target ${this.until}: spending ${countIn(s, TICKET_RE)} tickets and ${coinsIn(s)} coins`);
                this.finish = 'tickets';
                return;
            }
            if (coinsIn(s) < GUILD_ENTRY_FEE) {
                this.log.log('LOG', `Out of entry coins (${coinsIn(s)}): banking`);
                this.phase = 'hub';
                return;
            }
            if (this.tick - this.talkTick < 8) return;
            this.exec({ type: 'talkToNpc', npcIndex: judge.index, reason: 'judge' });
            this.talkTick = this.tick;
            return;
        }

        const worn = s.equipment.find(i => ARROW_RE.test(i.name))?.count ?? 0;
        if (this.shotPendingSince >= 0) {
            if (worn < this.wornAtShot) {
                this.fired++;
                this.stats.shots++;
                this.refused = 0;
                this.shotPendingSince = -1;
            } else if (this.tick - this.shotPendingSince >= GUILD_SHOT_TIMEOUT) {
                this.shotPendingSince = -1;
                if (++this.refused >= 3) {
                    this.log.log('WARN', `Targets refused ${this.refused} shots after ${this.fired}: back to the judge`);
                    this.round = 'talk';
                }
            }
            return;
        }
        if (this.fired >= GUILD_SHOTS || worn === 0) {
            this.round = 'talk';
            return;
        }
        if (this.tick - this.lastShotTick < GUILD_SHOT_GAP) return;
        const target = s.nearbyLocs
            .filter(l => /^target$/i.test(l.name) && l.distance >= 5)
            .filter(l => l.optionsWithIndex.some(o => /^fire/i.test(o.text)))
            .sort((a, b) => a.distance - b.distance)[0];
        if (!target) {
            this.log.log('WARN', `No target in view @ ${s.player!.worldX},${s.player!.worldZ}`);
            this.wait(4);
            return;
        }
        const op = target.optionsWithIndex.find(o => /^fire/i.test(o.text))!;
        const r = this.exec({ type: 'interactLoc', x: target.x, z: target.z, locId: target.id, optionIndex: op.opIndex, reason: 'fire' });
        if (!r.ok) this.log.log('WARN', `fire failed: ${r.reason}`);
        this.wornAtShot = worn;
        this.shotPendingSince = this.tick;
        this.lastShotTick = this.tick;
    }
}

// ------------------------------------------------------------------ rune essence

/** Aubury's teleport to the mine, a full pack through the portal, Varrock east bank, repeat. */
class EssenceBot extends JobBot {
    readonly hub = VARROCK_EAST_BANK;
    private lastActiveTick = 0;
    private lastSlots = -1;
    private lastXp = -1;
    private clickTick = -99;
    private refusedTeleports = 0;
    readonly stats = { essence: 0, xp: 0, trips: 0 };
    private window = { essence: 0, xp: 0 };

    constructor(name: string, botsDir: string, heartbeatMs: number, _opts: JobOptions = {}) {
        super(name, 'swarm-essence', botsDir, heartbeatMs);
    }

    override attach(session: LiteSession): void {
        super.attach(session);
        this.lastSlots = this.lastXp = -1;
    }

    protected override farFromHubOk(s: BotWorldState): boolean {
        return inEssenceMine(here(s));
    }

    protected kit(s: BotWorldState): BankPlan {
        const withdraw: BankPlan['withdraw'] = [];
        if (!s.equipment.some(i => PICK_RE.test(i.name))) {
            const lvl = skill(s, 'Mining')?.baseLevel ?? 1;
            const usable = PICKS.filter(([, need]) => need <= lvl);
            const best = usable.find(([re]) => s.bank.items.some(i => re.test(i.name)) || s.inventory.some(i => re.test(i.name))) ?? usable[0]!;
            withdraw.push({ match: n => best[0].test(n), label: 'pickaxe', count: 1, required: true });
        }
        return { hub: VARROCK_EAST_BANK, keep: PICK_RE, withdraw };
    }

    protected override afterBank(r: { missing: string[]; deposited: number }): void {
        this.stats.essence += r.deposited;
        this.window.essence += r.deposited;
        this.stats.trips++;
        this.log.log('LOG', `Banked ${r.deposited} | trip ${this.trips} total ${this.stats.essence}`);
        this.log.event({ type: 'progress', kind: 'inventory', message: `trip ${this.trips}` });
    }

    protected summary(): string {
        const w = this.window;
        this.window = { essence: 0, xp: 0 };
        return `essence 60s: +${w.essence} banked +${w.xp}xp | total ${this.stats.essence} over ${this.stats.trips} trips`;
    }

    protected override travelToHub(s: BotWorldState, hub: Tile): void {
        const me = here(s);
        if (inEssenceMine(me)) {
            this.takePortal(s);
            return;
        }
        this.walkRoute(s, 'essence-out', [...ESSENCE_LEGS].reverse().concat(hub), 'to bank');
    }

    private takePortal(s: BotWorldState): void {
        const portal = s.nearbyLocs
            .filter(l => /portal/i.test(l.name) && l.optionsWithIndex.length > 0)
            .sort((a, b) => a.distance - b.distance)[0];
        if (!portal) {
            this.walk({ x: 2911, z: 4832 }, 'find portal', 8);
            return;
        }
        if (this.tick - this.clickTick < 8) return;
        this.clickTick = this.tick;
        const op = portal.optionsWithIndex.find(o => /use|enter|exit|climb/i.test(o.text)) ?? portal.optionsWithIndex[0]!;
        const r = this.exec({ type: 'interactLoc', x: portal.x, z: portal.z, locId: portal.id, optionIndex: op.opIndex, reason: 'portal' });
        if (!r.ok) this.log.log('WARN', `portal click failed: ${r.reason}`);
    }

    protected override handleDialog(s: BotWorldState): void {
        const tele = s.dialog.options.find(o => /teleport me to the rune essence/i.test(o.text));
        if (tele) {
            this.exec({ type: 'clickDialogOption', optionIndex: tele.index, reason: 'teleport' });
            this.wait(1);
            return;
        }
        super.handleDialog(s);
    }

    protected work(s: BotWorldState): void {
        const xp = skill(s, 'Mining')?.experience ?? 0;
        if (this.lastXp >= 0 && xp > this.lastXp) {
            this.stats.xp += xp - this.lastXp;
            this.window.xp += xp - this.lastXp;
            this.effect();
            this.lastActiveTick = this.tick;
        }
        this.lastXp = xp;
        if (this.lastSlots >= 0 && s.inventory.length > this.lastSlots) this.lastActiveTick = this.tick;
        this.lastSlots = s.inventory.length;

        if (!s.equipment.some(i => PICK_RE.test(i.name)) && !s.inventory.some(i => PICK_RE.test(i.name))) {
            this.log.log('WARN', 'No pickaxe: back to the bank');
            this.phase = 'hub';
            return;
        }
        if (s.inventory.length >= 28) {
            this.phase = 'hub';
            return;
        }

        if (!inEssenceMine(here(s))) {
            const aubury = s.nearbyNpcs.find(n => AUBURY_RE.test(n.name) && n.reachable !== false && n.distance <= 6);
            if (!aubury) {
                this.walkRoute(s, 'essence-in', ESSENCE_LEGS, 'to Aubury');
                return;
            }
            if (this.tick - this.clickTick < 10) return;
            this.clickTick = this.tick;
            if (++this.refusedTeleports > 12) {
                this.fail('teleport', `Aubury never teleported us from ${s.player!.worldX},${s.player!.worldZ}: is Rune Mysteries done?`);
                return;
            }
            const op = aubury.optionsWithIndex.find(o => /^teleport$/i.test(o.text));
            const r = op
                ? this.exec({ type: 'interactNpc', npcIndex: aubury.index, optionIndex: op.opIndex, reason: 'teleport' })
                : this.exec({ type: 'talkToNpc', npcIndex: aubury.index, reason: 'teleport' });
            if (!r.ok) this.log.log('WARN', `Aubury click failed: ${r.reason}`);
            return;
        }
        this.refusedTeleports = 0;

        if (s.player!.animId !== -1) {
            this.lastActiveTick = this.tick;
            return;
        }
        if (this.tick - Math.max(this.lastActiveTick, this.clickTick) < MINE_IDLE_TICKS) return;
        const rock = s.nearbyLocs
            .filter(l => ESSENCE_ROCK_RE.test(l.name) && l.optionsWithIndex.some(o => /^mine$/i.test(o.text)))
            .sort((a, b) => a.distance - b.distance)[0];
        if (!rock) {
            this.walk({ x: 2911, z: 4832 }, 'find a rock', 8);
            return;
        }
        const op = rock.optionsWithIndex.find(o => /^mine$/i.test(o.text))!;
        const r = this.exec({ type: 'interactLoc', x: rock.x, z: rock.z, locId: rock.id, optionIndex: op.opIndex, reason: 'mine' });
        if (!r.ok) this.log.log('WARN', `mine failed: ${r.reason}`);
        this.clickTick = this.tick;
    }
}

function has(n: NearbyNpc, re: RegExp): boolean {
    return n.optionsWithIndex.some(o => re.test(o.text));
}

interface JobOptions {
    bankFish?: boolean;
    /** guild: park once Ranged reaches this level (default 99). */
    until?: number;
}

const JOBS: Record<string, new (name: string, botsDir: string, heartbeatMs: number, opts?: JobOptions) => JobBot> = {
    knights: KnightsBot,
    bignet: BigNetBot,
    guild: GuildBot,
    essence: EssenceBot
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
