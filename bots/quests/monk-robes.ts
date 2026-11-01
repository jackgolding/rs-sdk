/**
 * Monk's robes (top + bottom) from the Edgeville monastery, banked at Edgeville.
 * Prayer drain resistance here is 60 + 2 x prayer bonus (player/scripts/equip.rs2,
 * skill_prayer/scripts/prayer.rs2): top +6, bottom +5 — a free, PK-proof prayer set.
 *
 *   bun bots/quests/monk-robes.ts {botname} [--target=N] [--bank-at=N] [--max-skew=N]
 *
 *   --target=N     stop (terminal, exit 0, parked at the bank) once bank + pack hold
 *                  N full pairs. Counted from bank stock, so a restart parks again.
 *   --bank-at=N    bank once the pack holds N robes of either kind (default: when
 *                  fewer than 2 slots are free, i.e. 13 pairs on an empty pack).
 *   --max-skew=N   skip the over-represented half while it leads by N (default 3),
 *                  leaving it for other players instead of hoarding one kind.
 *
 * Source (server content, the only one in the game):
 *   skill_prayer/configs/robes.obj   monkrobetop (obj 544, prayer +6), monkrobebottom
 *                                    (obj 542, +5); both named "Monk's robe" — match ids.
 *   maps/m47_54.jm2 OBJ              1 51 31: 544 / 1 51 32: 542 -> (3059,3487,L1) and
 *                                    (3059,3488,L1), on the 2-wide table (bigtable2) in the
 *                                    monastery's east upstairs room. No other map, shop,
 *                                    drop table or script gives them (only cheat_bank).
 *   respawn                          neither obj sets respawnrate, so ObjType's default
 *                                    100 ticks (60 s at 600 ms) from the pickup.
 *   areas/monastery/scripts/prayer_guild.rs2
 *                                    the ladder (monasteryladder, (3057,3483) and
 *                                    (3046,3483) L0) needs %prayer_guild; joining is the
 *                                    Abbot's "Well can I join your order?" with base
 *                                    Prayer >= 31. The ladder itself offers the join when
 *                                    Abbot Langley stands within 5 tiles.
 *
 * Wilderness: area_wilderness wilderness_zones.dbrow starts at z 3520 (x 2944..3391);
 * the monastery (z 3483-3500) and Edgeville bank (3094,3492) are south of it, and the
 * route between them never goes north of z ~3500. A guard stops the script if it ever
 * reads z >= 3515 in that x band.
 *
 * Contention: one spawn of each exists in the world. A robe that vanishes while we
 * stand at the table (or that was already gone on arrival) is logged as taken; we wait
 * at the table for the respawn either way — there is nowhere better to be.
 *
 * SIGTERM finishes the current pickup and banks (exit 0). --target and a Prayer < 31
 * account are terminal stops (exit 0, parked). Otherwise it never exits 0: recovery
 * exhaust is restartable (70).
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { ActivitySession, BotSDK, deriveGatewayUrl, inWilderness } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { installGracefulShutdown } from '../../sdk/runner';
import { SAFE_BANKS } from './safe-stops';
import { closeUi, installWaitForTicksGuard, walkNear } from './movement';
import { travelTo } from './travel';
import { driveDialog, talkThrough } from './lib/dialog';
import { tickNow, untilTicks } from './lib/ticks';

const TOP = { id: 544, label: 'top', x: 3059, z: 3487 };
const BOTTOM = { id: 542, label: 'bottom', x: 3059, z: 3488 };
type Robe = typeof TOP;
const ROBES: Robe[] = [TOP, BOTTOM];
const RESPAWN_TICKS = 100;
/** Stand west of the table, between the two spawns. */
const TABLE_STAND = { x: 3058, z: 3488 };
const LADDER = { x: 3057, z: 3483 };
const BANK = SAFE_BANKS.edgeville;
const PRAYER_REQUIRED = 31;
const ABBOT = /^abbot langley$/i;

const argv = process.argv.slice(2);
const thenIdx = argv.indexOf('--then');
const ownArgs = thenIdx >= 0 ? argv.slice(0, thenIdx) : argv;
const botArg = ownArgs.find((a) => !a.startsWith('-') && !a.endsWith('.ts'));
function numFlag(name: string, dflt: number): number {
    const v = ownArgs.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
    const n = v === undefined ? dflt : Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`--${name}=${v} is not a non-negative number`);
    return Math.floor(n);
}
const TARGET = numFlag('target', 0);
const BANK_AT = numFlag('bank-at', 0);
const MAX_SKEW = Math.max(1, numFlag('max-skew', 3));

function loadBotEnv(): void {
    const envPath = botArg ? join(process.cwd(), 'bots', botArg, 'bot.env') : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/monk-robes.ts {botname}`);
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
    }
}

loadBotEnv();
const username = process.env.BOT_USERNAME!;
initPathfinding();
const sdk = new BotSDK({
    botUsername: username,
    password: process.env.PASSWORD!,
    gatewayUrl: deriveGatewayUrl(process.env.SERVER),
    autoLaunchBrowser: false,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false
});
await sdk.connect();
const bot = new BotActions(sdk);
const session = new ActivitySession(sdk, bot, {
    name: 'monk-robes',
    grindLogPath: join(process.cwd(), 'bots', username, 'grind.log'),
    // A contended spawn can mean 100+ ticks with nothing to show; 60 ms ticks make
    // that short locally, but on prod 3 min is well past one respawn.
    stallMs: 240_000,
    maxRecoveryTactics: 8
});
installGracefulShutdown({ graceMs: 30_000 });
installWaitForTicksGuard(sdk, session);

/** Bank stock as last seen open (null until the first bank visit). */
let banked: { top: number; bottom: number } | null = null;
let pickedTop = 0;
let pickedBottom = 0;
let taken = 0;
let joined = false;
const readyAt = new Map<number, number>([
    [TOP.id, 0],
    [BOTTOM.id, 0]
]);
/** Robes we saw on the table during the current visit (to tell "taken" from "not back yet"). */
const seenUp = new Set<number>();
const startTick = tickNow(sdk);

function log(msg: string): void {
    session.log('log', msg);
}

function intent(msg: string): void {
    void session.showIntent(msg);
}

function pos() {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0, isDead: p?.isDead ?? false };
}

/** The game's zone (wilderness_zones.dbrow), not the SDK's z-only approximation. */
function wildy(x: number, z: number): boolean {
    return inWilderness(x, z) && x >= 46 * 64 && x < 53 * 64;
}

function nearWildy(): boolean {
    const p = pos();
    return p.level === 0 && p.x >= 46 * 64 && p.x < 53 * 64 && p.z >= 3515 && p.z < 6400;
}

function dist(x: number, z: number): number {
    return Math.hypot(pos().x - x, pos().z - z);
}

function occupied(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function packCount(id: number): number {
    return sdk
        .getInventory()
        .filter((i) => i.id === id)
        .reduce((n, i) => n + Math.max(1, i.count ?? 1), 0);
}

function total(robe: Robe): number {
    const inBank = banked ? (robe === TOP ? banked.top : banked.bottom) : 0;
    return inBank + packCount(robe.id);
}

function pairs(): number {
    return Math.min(total(TOP), total(BOTTOM));
}

function prayerLevel(): number {
    return sdk.getSkill('Prayer')?.baseLevel ?? 1;
}

function elapsedTicks(): number {
    return Math.max(1, tickNow(sdk) - startTick);
}

function summary(): string {
    const picked = pickedTop + pickedBottom;
    // Robes per hour on prod: per tick here x 6000 ticks/hour at 600 ms.
    const perHour = ((picked * 6000) / elapsedTicks()).toFixed(0);
    const bankText = banked ? `bank ${banked.top}/${banked.bottom}` : 'bank ?';
    return (
        `pairs ${pairs()}${TARGET ? `/${TARGET}` : ''} | top ${total(TOP)} bottom ${total(BOTTOM)} ` +
        `(pack ${packCount(TOP.id)}/${packCount(BOTTOM.id)} ${bankText}) | picked ${pickedTop}+${pickedBottom} ` +
        `taken-by-others ${taken} | ${perHour} robes/h @600ms | ${elapsedTicks()}t`
    );
}

function packFull(): boolean {
    if (28 - occupied() < 1) return true;
    if (BANK_AT > 0 && (packCount(TOP.id) >= BANK_AT || packCount(BOTTOM.id) >= BANK_AT)) return true;
    return false;
}

function shouldBank(): boolean {
    if (packFull()) return true;
    // Stop at the target from the bank, where the count is exact.
    if (TARGET > 0 && pairs() >= TARGET && packCount(TOP.id) + packCount(BOTTOM.id) > 0) return true;
    return false;
}

function targetReached(): boolean {
    return TARGET > 0 && banked !== null && pairs() >= TARGET;
}

/** Skip the half that already leads by MAX_SKEW (counts include the bank). */
function wanted(robe: Robe): boolean {
    const other = robe === TOP ? BOTTOM : TOP;
    return total(robe) - total(other) < MAX_SKEW;
}

// ---------------------------------------------------------------- travel

async function walkTo(x: number, z: number, tolerance: number): Promise<boolean> {
    if (dist(x, z) <= tolerance) return true;
    await closeUi(bot, sdk);
    if (await walkNear(bot, sdk, x, z, tolerance)) return true;
    if (pos().level === 0 && dist(x, z) > tolerance) {
        const r = await travelTo(sdk, bot, { x, z }, { tolerance, log: (m) => log(`travel: ${m}`) });
        if (r.ok) return true;
        await closeUi(bot, sdk);
        await walkNear(bot, sdk, x, z, tolerance);
    }
    return dist(x, z) <= tolerance + 2;
}

function ladderUp() {
    return (
        (sdk.getNearbyLocs() ?? [])
            .filter((l) => /^ladder$/i.test(l.name) && l.optionsWithIndex.some((o) => /climb-up/i.test(o.text)))
            .sort((a, b) => Math.hypot(a.x - LADDER.x, a.z - LADDER.z) - Math.hypot(b.x - LADDER.x, b.z - LADDER.z))[0] ?? null
    );
}

function ladderDown() {
    return (
        (sdk.getNearbyLocs() ?? [])
            .filter((l) => /^ladder$/i.test(l.name) && l.optionsWithIndex.some((o) => /climb-down/i.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null
    );
}

/**
 * Join the order: the ladder's own dialog (Abbot within 5 tiles) or the Abbot's
 * "How do I get further into the monastery?". Returns false when the game refuses
 * (Prayer below 31) — the caller stops.
 */
async function joinOrder(firstText: string): Promise<boolean> {
    let seen = firstText;
    if (sdk.getDialog()?.isOpen) seen += ' ' + (await driveDialog(sdk, [/can i join your order/i], { log }));
    if (!/you may join|suitable for our order/i.test(seen) && !/not devout enough/i.test(seen)) {
        intent('Asking Abbot Langley to join the order');
        seen += ' ' + (await talkThrough(sdk, bot, ABBOT, [/further into the monastery/i, /can i join your order/i], log));
    }
    await closeUi(bot, sdk);
    if (/not devout enough/i.test(seen)) return false;
    if (/you may join|suitable for our order/i.test(seen)) {
        joined = true;
        log(`Joined the monastery order (Prayer ${prayerLevel()})`);
    } else {
        log(`join: no answer yet (${seen.slice(0, 160)})`);
    }
    return true;
}

async function climbUp(): Promise<boolean> {
    for (let attempt = 0; attempt < 4 && pos().level === 0; attempt++) {
        if (!(await walkTo(LADDER.x, LADDER.z + 1, 3))) continue;
        const ladder = ladderUp();
        if (!ladder) {
            await sdk.waitForTicks(2).catch(() => {});
            continue;
        }
        intent('Climbing the monastery ladder');
        await bot.interactLoc(ladder, /climb-up/i);
        if (await untilTicks(sdk, () => pos().level === 1 || !!sdk.getDialog()?.isOpen, 10)) {
            if (pos().level === 1) return true;
        }
        // Not a member: the ladder answers with a monk's line or the join offer.
        const text = (sdk.getDialog()?.allComponents ?? []).map((c) => c.text).join(' ');
        if (!(await joinOrder(text))) {
            session.stop('requirement', `Abbot Langley refused: Prayer ${prayerLevel()} < ${PRAYER_REQUIRED}`, { restartable: false });
            return false;
        }
    }
    return pos().level === 1;
}

async function climbDown(): Promise<boolean> {
    for (let attempt = 0; attempt < 4 && pos().level === 1; attempt++) {
        await closeUi(bot, sdk);
        const ladder = ladderDown();
        if (!ladder) {
            await walkTo(LADDER.x, LADDER.z + 1, 2);
            await sdk.waitForTicks(1).catch(() => {});
            continue;
        }
        intent('Climbing down the monastery ladder');
        await bot.interactLoc(ladder, /climb-down/i);
        await untilTicks(sdk, () => pos().level === 0, 10);
    }
    return pos().level === 0;
}

async function goToTable(): Promise<boolean> {
    if (pos().level === 1 && dist(TABLE_STAND.x, TABLE_STAND.z) <= 2) return true;
    if (session.metrics().phase !== 'travel') await session.setPhase('travel');
    if (pos().level === 0) {
        intent('Walking to the Edgeville monastery');
        session.setAnchor(LADDER.x, LADDER.z);
        if (!(await climbUp())) return false;
    }
    if (pos().level !== 1) return false;
    session.setAnchor(TABLE_STAND.x, TABLE_STAND.z);
    await walkTo(TABLE_STAND.x, TABLE_STAND.z, 1);
    return dist(TABLE_STAND.x, TABLE_STAND.z) <= 2;
}

// ---------------------------------------------------------------- bank

async function goToBank(): Promise<boolean> {
    await closeUi(bot, sdk);
    if (pos().level === 1 && !(await climbDown())) return false;
    intent('Walking to Edgeville bank');
    session.setAnchor(BANK.x, BANK.z);
    await walkTo(BANK.x, BANK.z, 4);
    return pos().level === 0 && dist(BANK.x, BANK.z) <= 10;
}

function readBank(): void {
    const items = sdk.getState()?.bank?.items ?? [];
    const sum = (id: number) => items.filter((b) => b.id === id).reduce((n, b) => n + (b.count ?? 0), 0);
    banked = { top: sum(TOP.id), bottom: sum(BOTTOM.id) };
}

async function bankTrip(): Promise<boolean> {
    if (session.metrics().phase !== 'bank') await session.setPhase('bank');
    if (!(await goToBank())) {
        session.noteFailure('bank_walk', `Could not reach Edgeville bank from ${pos().x},${pos().z},L${pos().level}`);
        return false;
    }
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        session.noteFailure('bank_open', 'Edgeville bank open failed');
        return false;
    }
    await untilTicks(sdk, () => (sdk.getState()?.bank?.items?.length ?? 0) > 0 || occupied() > 0, 4);
    const before = { top: packCount(TOP.id), bottom: packCount(BOTTOM.id) };
    // Deposit everything: the job needs no tools, so the next job starts clean.
    for (let i = 0; i < 30; i++) {
        const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0);
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success && !r.partial) break;
    }
    const depTop = before.top - packCount(TOP.id);
    const depBottom = before.bottom - packCount(BOTTOM.id);
    if (depTop > 0) session.recordGain("Monk's robe (top)", depTop);
    if (depBottom > 0) session.recordGain("Monk's robe (bottom)", depBottom);
    if (depTop + depBottom > 0) session.recordTrip(depTop + depBottom);
    await untilTicks(sdk, () => true, 1);
    readBank();
    session.captureBankStock();
    await bot.closeBank();
    await closeUi(bot, sdk);
    session.noteProgress('bank', 'edgeville');
    log(`Banked ${depTop} tops + ${depBottom} bottoms | trip ${session.metrics().trips} | ${summary()}`);
    return occupied() === 0;
}

// ---------------------------------------------------------------- collecting

function onTable(robe: Robe) {
    return (sdk.getGroundItems() ?? []).find((g) => g.id === robe.id && g.x === robe.x && g.z === robe.z) ?? null;
}

function otherPlayersNear(): string[] {
    return (sdk.getNearbyPlayers?.() ?? []).filter((p) => (p.distance ?? 99) <= 12).map((p) => p.name);
}

async function pick(robe: Robe): Promise<boolean> {
    const item = onTable(robe);
    if (!item) return false;
    const before = packCount(robe.id);
    intent(`Take monk's robe ${robe.label} @ ${robe.x},${robe.z}`);
    const r = await bot.pickupItem(item);
    const got = packCount(robe.id) > before || (await untilTicks(sdk, () => packCount(robe.id) > before, 4));
    if (got) {
        readyAt.set(robe.id, tickNow(sdk) + RESPAWN_TICKS);
        seenUp.delete(robe.id);
        if (robe === TOP) pickedTop++;
        else pickedBottom++;
        session.noteProgress('inventory', `robe ${robe.label}`);
        log(`Robe ${robe.label} | ${summary()}`);
        return true;
    }
    if (!onTable(robe)) {
        // Gone without reaching our pack: someone else won it this tick.
        taken++;
        readyAt.set(robe.id, tickNow(sdk) + RESPAWN_TICKS);
        seenUp.delete(robe.id);
        const near = otherPlayersNear();
        log(`Robe ${robe.label} taken by someone else${near.length ? ` (${near.join(', ')})` : ''} | ${summary()}`);
    } else if (!r.success) {
        session.noteFailure('pickup', `${robe.label}: ${r.message}`);
    }
    return false;
}

/** One visit at the table: take what's up, then wait for the next respawn we want. */
async function collect(): Promise<void> {
    if (!(await goToTable())) {
        if (!session.isStopped()) session.noteFailure('table_walk', `Could not reach the robe table from ${pos().x},${pos().z},L${pos().level}`);
        return;
    }
    if (session.metrics().phase !== 'collect') await session.setPhase('collect');
    // The ground list fills a tick or two after the climb.
    await untilTicks(sdk, () => ROBES.some((r) => onTable(r)), 3);
    for (const robe of ROBES) {
        if (session.isStoppedOrRequested() || packFull()) return;
        if (onTable(robe)) {
            seenUp.add(robe.id);
            if (wanted(robe)) await pick(robe);
        } else if (seenUp.has(robe.id)) {
            // Was up while we stood here and is gone, and not into our pack.
            taken++;
            seenUp.delete(robe.id);
            readyAt.set(robe.id, tickNow(sdk) + RESPAWN_TICKS);
            const near = otherPlayersNear();
            log(`Robe ${robe.label} taken by someone else${near.length ? ` (${near.join(', ')})` : ''}`);
        }
    }
    if (packFull() || shouldBank() || session.isStoppedOrRequested()) return;
    // Wait for whichever wanted robe is due first; a robe someone else took has an
    // unknown timer, so poll in slices of at most a quarter respawn.
    const want = ROBES.filter((r) => wanted(r));
    if (!want.length) return;
    const now = tickNow(sdk);
    const due = Math.min(...want.map((r) => readyAt.get(r.id)! - now));
    const slice = Math.max(4, Math.min(RESPAWN_TICKS / 4, due > 0 ? due + 2 : RESPAWN_TICKS / 4));
    intent(`Waiting for robes (${Math.max(0, due)}t)`);
    const appeared = await untilTicks(sdk, () => want.some((r) => !!onTable(r)) || pos().level !== 1, slice);
    if (!appeared) {
        // Overdue by a whole respawn and still nothing: someone is camping it.
        for (const r of want) {
            if (tickNow(sdk) - readyAt.get(r.id)! > RESPAWN_TICKS && !onTable(r)) {
                readyAt.set(r.id, tickNow(sdk));
            }
        }
    }
    session.noteProgress('location', 'table');
}

/** Terminal stops end banked, so park.json tells the next job it starts at Edgeville bank. */
async function park(): Promise<void> {
    const r = await session.drainToBank(async () => (await bankTrip()) && pos().level === 0);
    if (r !== 'banked') log(`park: drain ${r} @ ${pos().x},${pos().z},L${pos().level}`);
}

session.registerRecovery([
    {
        name: 'bank_if_full',
        run: async () => {
            if (!shouldBank()) return false;
            return bankTrip();
        }
    },
    {
        name: 'walk_bank',
        run: async () => goToBank()
    }
]);

try {
    await bot.skipTutorial();
    await closeUi(bot, sdk);
    log(
        `Monk robes start @ ${pos().x},${pos().z},L${pos().level} Prayer ${prayerLevel()} ` +
            `target=${TARGET || 'none'} bank-at=${BANK_AT || 'full'} max-skew=${MAX_SKEW} | ${summary()}`
    );
    if (wildy(pos().x, pos().z)) session.stop('wilderness', `started in the wilderness @ ${pos().x},${pos().z}`, { restartable: true });
    if (!session.isStopped() && prayerLevel() < PRAYER_REQUIRED) {
        // The ladder needs the order, the order needs base Prayer 31: nothing to do.
        await park();
        session.stop('requirement', `Prayer ${prayerLevel()} < ${PRAYER_REQUIRED}: cannot join the monastery order`, { restartable: false });
    }
    // Start from the bank: empties the pack and reads the stock the target counts.
    if (!session.isStopped()) await bankTrip();

    while (!session.isStoppedOrRequested()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        session.maybeHeartbeat();
        if (pos().isDead) {
            await untilTicks(sdk, () => !pos().isDead, 100);
            await sdk.waitForTicks(3).catch(() => {});
            log(`Respawned @ ${pos().x},${pos().z}`);
            continue;
        }
        await closeUi(bot, sdk);
        if (wildy(pos().x, pos().z) || nearWildy()) {
            session.stop('wilderness', `at the wilderness edge @ ${pos().x},${pos().z}`, { restartable: true });
            break;
        }
        if (targetReached()) {
            log(`Target reached | ${summary()}`);
            await park();
            session.stop('goal_reached', `${pairs()} monk's robe pairs banked (target ${TARGET})`, { restartable: false });
            break;
        }
        if (shouldBank()) {
            log(`Banking | ${summary()}`);
            if (!(await bankTrip())) await sdk.waitForTicks(5).catch(() => {});
            continue;
        }
        await collect();
    }
    if (session.stopRequested) {
        log(`Stop requested — banking | ${summary()}`);
        await park();
        session.stop('stopped', 'stop requested (SIGTERM), parked at Edgeville bank', { restartable: false });
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    log(`stopped | ${summary()} joined-this-run=${joined}`);
    await session.finalizeStop();
    await sdk.disconnect();
}
