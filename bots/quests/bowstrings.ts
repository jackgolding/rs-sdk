/**
 * Seers flax → bowstrings → bank. Spins banked flax before picking more.
 * Flax needs Crafting 10 (sheep-shearer --until=10). Lost City needs 31.
 *
 *   bun bots/quests/bowstrings.ts {botname}
 *   bun bots/quests/bowstrings.ts {botname} --until=31
 *   bun bots/quests/bowstrings.ts {botname} --until=31 --park
 *
 * The wheel is upstairs in the Seers wheel house (~2715,3471): the script
 * walks inside on the ground floor first, climbs only a staircase inside
 * that house, and verifies the wheel is in the scan on the wheel floor.
 *
 * With no --until and Crafting 99 there is nothing left to grind, so the
 * script parks (sleeps in place, never exits). An --until run still exits 2
 * when the floor is met, because craft-to-31 reads that as "level done";
 * --park parks instead of exiting there too.
 */
import { ActivitySession, BotSDK, atSeersFlax, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { resolveSkillDialogProduct } from '../../sdk/action-quantity';
import { nextWalkStep } from '../../sdk/activity';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { travelToSeersFlax } from '../Jackpoo1/travel-to-flax';
import { installGracefulShutdown } from '../../sdk/runner';

const FLAX_FIELD = { x: 2744, z: 3444 };
const SEERS_BANK = { x: 2726, z: 3485 };
/** Seers spinning wheel — upstairs (plane 1) in the wheel house at ~2715,3471. */
const WHEEL = { x: 2715, z: 3471 };
const WHEEL_FLOOR = 1;
const MAX_CRAFT = 99;
/**
 * Wheel-house footprint, walls included. The house next door (doors at
 * 2706,3472 and 2709,3472 on plane 1) has its own staircase: climbing that
 * one lands the bot upstairs with no wheel anywhere in the scan, which is how
 * every bot at 2728,3462 burned the whole recovery ladder and spun 0.
 */
const WHEEL_HOUSE_BOX = { x0: 2710, x1: 2719, z0: 3466, z1: 3478 };
/** Ground-floor tiles inside the wheel house, tried in order. */
const WHEEL_APPROACH = [
    { x: 2715, z: 3471 },
    { x: 2716, z: 3472 },
    { x: 2713, z: 3471 },
    { x: 2715, z: 3469 }
];

const UP = /climb-up|climb\.up|go-up|go\.up/i;
const DOWN = /climb-down|climb\.down|go-down|go\.down/i;
const STAIRS = /stair|ladder/i;


const FLAX = /^flax$/i;
const BOWSTRING = /^bow\s*string$/i;
const KEEP = /^(coins|(bronze|iron|steel|black|mithril|adamant|rune) axe)$/i;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const untilArg = argv.find((a) => a.startsWith('--until='));
const untilCraft = Number(untilArg?.split('=')[1]);
const CRAFT_UNTIL = Number.isFinite(untilCraft) && untilCraft > 0 ? untilCraft : 0;
/** Floor this launch is working toward: --until, else the 99 cap. */
const GOAL_LEVEL = CRAFT_UNTIL > 0 ? CRAFT_UNTIL : MAX_CRAFT;
/**
 * A maxed account with no --until has nothing left to do, and exiting is not
 * an option: the box supervisor restarts the container even on exit 0, so the
 * process re-enters the identical state forever (15 bots, ~200 restarts/hour,
 * box nearly down). Park instead. `--until` runs stay one-shots so craft-to-31
 * can still read exit code 2 as "level met"; `--park` forces parking there too.
 */
const PARK_WHEN_DONE = CRAFT_UNTIL === 0 || argv.includes('--park');

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/bowstrings.ts {botname} [--until=31]`);
    }
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
}

loadBotEnv();

const username = process.env.BOT_USERNAME!;
const password = process.env.PASSWORD!;
const server = process.env.SERVER;
const GRIND_LOG = join(process.cwd(), 'bots', username, 'grind.log');

console.log('Warming pathfinder...');
initPathfinding();

const sdk = new BotSDK({
    botUsername: username,
    password,
    gatewayUrl: deriveGatewayUrl(server),
    autoLaunchBrowser: false,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false
});

console.log('Opening/attaching the game client...');
await sdk.connect();
const bot = new BotActions(sdk);
const session = new ActivitySession(sdk, bot, {
    name: 'bowstrings',
    grindLogPath: GRIND_LOG,
    // Default tactics (close_ui, step_off, rewalk, climb_floor) plus
    // wheel_approach: the wheel route needs its own slot, and skipped
    // tactics no longer spend one.
    maxRecoveryTactics: 6
});

installGracefulShutdown();

let lastLoggedCraft = 0;
/** Once the bank is empty of flax, skip the withdraw check until a restart. */
let bankFlaxDrained = false;
/** Set once the goal is met and the process is idling instead of exiting. */
let parked = false;

function log(msg: string): void {
    session.log('log', msg);
}

function intent(msg: string): void {
    void session.showIntent(msg);
}

function pos() {
    const p = sdk.getState()?.player;
    return {
        x: p?.worldX ?? 0,
        z: p?.worldZ ?? 0,
        level: p?.level ?? 0,
        hp: p?.hp ?? 10,
        maxHp: p?.maxHp ?? 10,
        isDead: p?.isDead ?? false
    };
}

function distTo(x: number, z: number): number {
    return Math.hypot(pos().x - x, pos().z - z);
}

function craft(): number {
    return sdk.getSkill('Crafting')?.baseLevel ?? 1;
}

function craftXp(): number {
    return sdk.getSkill('Crafting')?.experience ?? 0;
}

/** True when there is no work left: --until reached, or Crafting capped with no goal. */
function goalReached(): boolean {
    return craft() >= GOAL_LEVEL;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Idle in place instead of exiting. Keeps the pid and the client alive so
 * nothing relaunches the grind into the same no-op, and refreshes the
 * progress clock so fleet triage does not read a parked bot as stalled.
 */
async function park(reason: string): Promise<void> {
    if (!parked) {
        parked = true;
        await session.setPhase('parked');
        session.setAnchor(pos().x, pos().z, pos().level);
        log(`PARKED ${reason} — idling in place (no exit: a relaunch re-enters this state)`);
    }
    let lastLog = Date.now();
    let waited = false;
    while (!session.stopRequested && !session.isStopped()) {
        await sleep(60_000);
        waited = true;
        session.noteProgress('phase', 'parked');
        if (Date.now() - lastLog >= 30 * 60_000) {
            lastLog = Date.now();
            log(`Parked — Crafting ${craft()} (${craftXp()} xp) @ ${pos().x},${pos().z}, nothing to grind`);
        }
    }
    if (waited) log('Parked bot received a stop request — shutting down');
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function count(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function bankCount(pattern: RegExp): number {
    return sdk.getBankItems().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
}

async function openSeersBank(): Promise<boolean> {
    if (pos().level > 0) await descendTo(0);
    await closeUi();
    await bot.walkTo(SEERS_BANK.x, SEERS_BANK.z, 2);
    await closeUi();
    if (sdk.getState()?.bank?.isOpen) return true;
    const r = await bot.openBank();
    if (r.success || sdk.getState()?.bank?.isOpen) return true;
    session.noteFailure('bank_open', r.message || 'Could not open Seers bank');
    return false;
}

/** Field, wheel house, or Seers bank — grind from here; do not re-run wildy travel. */
function inFlaxCircuit(): boolean {
    const p = pos();
    if (atSeersFlax(p.x, p.z)) return true;
    if (sdk.findNearbyLoc(/^flax$/i) || sdk.findNearbyLoc(/spinning wheel/i)) return true;
    if (distTo(WHEEL.x, WHEEL.z) <= 24) return true;
    if (distTo(SEERS_BANK.x, SEERS_BANK.z) <= 24) return true;
    return p.x >= 2690 && p.x <= 2770 && p.z >= 3430 && p.z <= 3510;
}

async function closeUi(): Promise<void> {
    for (let i = 0; i < 25; i++) {
        const dialog = sdk.getDialog();
        const st = sdk.getState();
        if (dialog?.isOpen) {
            const opts = dialog.options ?? [];
            const skillDlg = opts.some((o) => /make \d+|make x|^wool$|^flax$/i.test(o.text));
            if (skillDlg) {
                await sdk.sendCloseModal();
                await sdk.waitForTicks(1);
                continue;
            }
            const cont = opts.find((o) => /continue|click here/i.test(o.text)) ?? (opts.length <= 1 ? opts[0] : undefined);
            if (cont) {
                await sdk.sendClickDialog(cont.index);
                await sdk.waitForTicks(1);
                continue;
            }
            await sdk.sendCloseModal();
            await sdk.waitForTicks(1);
            continue;
        }
        if (st?.interface?.isOpen && !st.bank?.isOpen && !st.shop?.isOpen) {
            await sdk.sendCloseModal();
            await sdk.waitForTicks(1);
            continue;
        }
        break;
    }
    await bot.dismissBlockingUI();
    if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen) {
        await bot.closeInterface();
    }
}

function inWheelHouse(l: { x: number; z: number }): boolean {
    return l.x >= WHEEL_HOUSE_BOX.x0 && l.x <= WHEEL_HOUSE_BOX.x1 && l.z >= WHEEL_HOUSE_BOX.z0 && l.z <= WHEEL_HOUSE_BOX.z1;
}

/** Stairs that move through `dir`: in-house first, then nearest reachable. */
function stairsFor(dir: RegExp) {
    return (sdk.getNearbyLocs() ?? [])
        .filter((l) => STAIRS.test(l.name) && l.optionsWithIndex.some((o) => dir.test(o.text)))
        .sort(
            (a, b) =>
                (inWheelHouse(b) ? 1 : 0) - (inWheelHouse(a) ? 1 : 0) ||
                (a.reachable === false ? 1 : 0) - (b.reachable === false ? 1 : 0) ||
                (a.distance ?? 99) - (b.distance ?? 99)
        );
}

/** Interact with one staircase and wait for the plane to actually change. */
async function useStairs(stair: ReturnType<typeof stairsFor>[number], dir: RegExp): Promise<boolean> {
    const before = pos().level;
    const match = stair.optionsWithIndex.find((o) => dir.test(o.text));
    intent(`${dir === UP ? 'Climbing up' : 'Climbing down'} ${stair.name} @ ${stair.x},${stair.z}`);
    if ((stair.distance ?? 99) <= 2 && match) {
        await sdk.sendInteractLoc(stair.x, stair.z, stair.id, match.opIndex);
    } else {
        const r = await bot.interactLoc(stair, dir);
        if (!r.success) session.noteFailure('climb', r.message);
    }
    await sdk.waitForCondition((s) => (s.player?.level ?? before) !== before, 8_000).catch(() => {});
    await bot.dismissBlockingUI();
    return pos().level !== before;
}

/**
 * Descend toward `target` floor. In-house stairs are preferred, but any
 * climb-down is correct when the bot is stuck a floor up in the wrong
 * building — that is the exit, not another wrong turn.
 */
async function descendTo(target = 0): Promise<boolean> {
    for (let i = 0; i < 6 && pos().level > target && !session.isStopped(); i++) {
        const stair = stairsFor(DOWN)[0];
        if (!stair) {
            await bot.walkTo(WHEEL.x, WHEEL.z, 3).catch(() => {});
            await sdk.scanNearbyLocs(10).catch(() => {});
            continue;
        }
        const moved = await useStairs(stair, DOWN);
        if (!moved && (stair.distance ?? 99) > 2) {
            await bot.walkTo(stair.x, stair.z, 2).catch(() => {});
            continue;
        }
        if (!moved) break;
    }
    return pos().level <= target;
}

/**
 * The wheel on this floor, from the pushed locs or a fresh scan.
 * `reachable` is a hint here, not a gate: upstairs collision data is thin
 * enough that a wheel two tiles away can read reachable:false, and the old
 * `{ reachable: true }` lookup then reported "no spinning wheel" forever.
 */
function wheelHere() {
    const wheels = (sdk.getNearbyLocs() ?? []).filter((l) => /spinning wheel/i.test(l.name));
    if (!wheels.length) return null;
    const spinnable = wheels.filter((l) => l.optionsWithIndex.some((o) => /spin/i.test(o.text)));
    const pool = spinnable.length ? spinnable : wheels;
    return (
        pool.sort(
            (a, b) =>
                (a.reachable === false ? 1 : 0) - (b.reachable === false ? 1 : 0) ||
                (a.distance ?? 99) - (b.distance ?? 99)
        )[0] ?? null
    );
}

async function findWheel() {
    const cached = wheelHere();
    if (cached) return cached;
    await sdk.scanNearbyLocs(10).catch(() => {});
    return wheelHere();
}

/** Short chord steps for upstairs, where bot.walkTo can refuse the wheel as unreachable. */
async function stepTo(x: number, z: number, tol = 1): Promise<boolean> {
    for (let i = 0; i < 10 && !session.isStopped(); i++) {
        const p = pos();
        if (Math.hypot(p.x - x, p.z - z) <= tol) return true;
        const step = nextWalkStep(p, { x, z }, 3);
        if (step.x === p.x && step.z === p.z) return true;
        await sdk.sendWalk(step.x, step.z, true);
        await sdk
            .waitForCondition(
                (s) => (s.player?.worldX ?? p.x) !== p.x || (s.player?.worldZ ?? p.z) !== p.z,
                2_500
            )
            .catch(() => {});
    }
    return Math.hypot(pos().x - x, pos().z - z) <= tol;
}

/** Open the wheel-house door (only one within reach of the house). */
async function openWheelHouseDoor(): Promise<void> {
    const door = (sdk.getNearbyLocs() ?? [])
        .filter((l) => /door/i.test(l.name) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)))
        .sort((a, b) => Math.hypot(a.x - WHEEL.x, a.z - WHEEL.z) - Math.hypot(b.x - WHEEL.x, b.z - WHEEL.z))[0];
    if (!door || Math.hypot(door.x - WHEEL.x, door.z - WHEEL.z) > 6) return;
    try {
        await bot.openDoor(door);
    } catch {
        /* already open, or the client rejected it — the walk below proves it */
    }
    await sdk.waitForTicks(1).catch(() => {});
}

/**
 * Ground floor, standing inside the wheel house. The old code stopped at
 * `walkTo(WHEEL_HOUSE, 2)` on the doorstep, so the nearest climb-up was the
 * neighbour's staircase — the bot then climbed the wrong building and the
 * recovery ladder could not get it back down.
 */
async function walkIntoWheelHouse(attempt: number): Promise<boolean> {
    const tile = WHEEL_APPROACH[attempt % WHEEL_APPROACH.length]!;
    for (let i = 0; i < 3 && !session.isStopped(); i++) {
        if (Math.hypot(pos().x - tile.x, pos().z - tile.z) <= 1) break;
        intent(`Walking into the wheel house @ ${tile.x},${tile.z}`);
        await openWheelHouseDoor();
        const r = await bot.walkTo(tile.x, tile.z, 1).catch(() => null);
        if (!r?.success) {
            await openWheelHouseDoor();
            await bot.walkTo(tile.x, tile.z, 2).catch(() => {});
        }
        if (Math.hypot(pos().x - tile.x, pos().z - tile.z) <= 2) break;
        await sdk.scanNearbyLocs(10).catch(() => {});
    }
    return inWheelHouse(pos());
}

/**
 * Deterministic wheel route: ground floor first, walk inside the house,
 * climb ONLY a staircase inside its footprint, then prove the wheel is in
 * the scan on the wheel floor. A climb that lands with no wheel is undone
 * here — not handed to the recovery ladder to burn.
 */
async function reachWheel(): Promise<boolean> {
    for (let attempt = 0; attempt < 3 && !session.isStopped(); attempt++) {
        await closeUi();
        if (pos().level === WHEEL_FLOOR) {
            if (await findWheel()) return true;
            log(`Upstairs with no wheel @ ${pos().x},${pos().z} — descending to re-approach from the door`);
            await descendTo(0);
            continue;
        }
        if (pos().level > WHEEL_FLOOR) {
            await descendTo(0);
            continue;
        }
        if (!(await walkIntoWheelHouse(attempt))) {
            log(`Could not get inside the wheel house @ ${pos().x},${pos().z} (attempt ${attempt + 1})`);
            continue;
        }
        let stair = stairsFor(UP).filter(inWheelHouse)[0];
        if (!stair) {
            // The staircase is in this house but outside the push radius: step in and rescan.
            await bot.walkTo(WHEEL.x, WHEEL.z, 2).catch(() => {});
            await sdk.scanNearbyLocs(10).catch(() => {});
            stair = stairsFor(UP).filter(inWheelHouse)[0];
        }
        if (!stair) {
            log(`No climb-up staircase inside the wheel house @ ${pos().x},${pos().z}`);
            continue;
        }
        if (!(await useStairs(stair, UP))) continue;
        if (pos().level !== WHEEL_FLOOR) continue;
        const wheel = await findWheel();
        if (wheel) {
            await closeUi();
            if (!(await stepTo(wheel.x, wheel.z, 1))) await bot.walkTo(wheel.x, wheel.z, 1).catch(() => {});
            return true;
        }
        log(`Climbed ${stair.name} @ ${stair.x},${stair.z} — no wheel on floor ${pos().level}; wrong building, descending`);
        await descendTo(0);
    }
    return false;
}

session.registerRecovery([
    {
        // Re-runs the deterministic wheel route. Silent outside the spin
        // phase, so it never spends a recovery slot when it cannot act.
        name: 'wheel_approach',
        applicable: () => session.metrics().phase === 'spin',
        run: async () => reachWheel()
    }
]);

async function pickFlax(): Promise<boolean> {
    await closeUi();
    const before = count(FLAX);
    let plant =
        sdk.findNearbyLoc(/^flax$/i, { reachable: true, withOption: /pick/i }) ??
        sdk.findNearbyLoc(/^flax$/i, { reachable: true });
    if (!plant) {
        await bot.walkTo(FLAX_FIELD.x, FLAX_FIELD.z, 3);
        await sdk.scanNearbyLocs(8).catch(() => {});
        plant =
            sdk.findNearbyLoc(/^flax$/i, { reachable: true, withOption: /pick/i }) ??
            sdk.findNearbyLoc(/^flax$/i, { reachable: true });
    }
    if (!plant) return false;
    const r = await bot.interactLoc(plant, /pick/i);
    await bot.dismissBlockingUI();
    if (count(FLAX) > before) {
        session.noteProgress('inventory', 'flax');
        return true;
    }
    if (!r.success) return false;
    await sdk.waitForCondition(() => count(FLAX) > before, 4_000).catch(() => {});
    if (count(FLAX) > before) {
        session.noteProgress('inventory', 'flax');
        return true;
    }
    return false;
}

async function fillFlax(): Promise<void> {
    if (pos().level > 0) await descendTo(0);
    if (distTo(FLAX_FIELD.x, FLAX_FIELD.z) > 12) {
        intent(`Walking to flax field @ ${FLAX_FIELD.x},${FLAX_FIELD.z}`);
        await bot.walkTo(FLAX_FIELD.x, FLAX_FIELD.z, 3);
    }
    let misses = 0;
    while (occupiedSlots() < 28 && misses < 40 && !session.isStopped()) {
        intent(`Picking flax ${count(FLAX)}/28`);
        if (await pickFlax()) misses = 0;
        else {
            misses++;
            if (misses % 5 === 0) session.noteFailure('pick', `no flax (${misses} misses)`);
            await bot.walkTo(
                FLAX_FIELD.x + ((misses * 2) % 7) - 3,
                FLAX_FIELD.z + ((misses * 3) % 7) - 3,
                2
            );
            await sdk.waitForTicks(1);
        }
    }
    log(`Picked ${count(FLAX)} flax`);
}

async function clickFlaxSpin(): Promise<boolean> {
    const dialog = sdk.getDialog();
    if (!dialog?.isOpen) return false;
    const opts = dialog.options ?? [];
    const flaxBtn = resolveSkillDialogProduct(opts, 'flax');
    if (!flaxBtn) return false;
    const make10 = opts.find((o) => o.index === flaxBtn.index - 2 && /make 10/i.test(o.text));
    const make5 = opts.find((o) => o.index === flaxBtn.index - 1 && /make 5/i.test(o.text));
    const click = count(FLAX) >= 10 ? make10 : count(FLAX) >= 5 ? make5 : flaxBtn;
    await sdk.sendClickDialog((click ?? flaxBtn).index);
    return true;
}

async function spinAllFlax(): Promise<number> {
    if (count(FLAX) < 1) return 0;
    await closeUi();
    if (!(await reachWheel())) {
        session.noteFailure('wheel', `could not reach the wheel (floor ${pos().level} @ ${pos().x},${pos().z})`);
        // Backoff so a blocked house does not spin the loop (and the box) hot.
        await sleep(5_000);
        return 0;
    }

    let spun = 0;
    let misses = 0;
    while (count(FLAX) > 0 && misses < 3 && !session.isStopped()) {
        await bot.dismissBlockingUI();
        const wheel = wheelHere();
        if (!wheel) {
            // Lost the wheel mid-inventory: re-run the deterministic route once,
            // then hand it to recovery instead of walking into the wall.
            misses++;
            if (misses === 1) {
                log(`Wheel gone from the scan @ ${pos().x},${pos().z} floor ${pos().level} — re-approaching`);
                if (await reachWheel()) continue;
            }
            session.noteFailure('wheel', `no spinning wheel (${misses}) on floor ${pos().level}`);
            break;
        }
        misses = 0;
        const before = count(FLAX);
        const xpBefore = craftXp();
        intent(`Spinning flax (${before} left)`);

        const spunOpt = wheel.optionsWithIndex.find((o) => /spin/i.test(o.text));
        if (spunOpt) {
            if ((wheel.distance ?? 99) > 2 && !(await stepTo(wheel.x, wheel.z, 1))) {
                await bot.walkTo(wheel.x, wheel.z, 1).catch(() => {});
            }
            await sdk.sendInteractLoc(wheel.x, wheel.z, wheel.id, spunOpt.opIndex);
            await sdk.waitForCondition((s) => s.dialog?.isOpen, 5_000).catch(() => {});
            if (sdk.getDialog()?.isOpen) {
                const clicked = await clickFlaxSpin();
                if (clicked) {
                    await sdk.waitForCondition(() => count(FLAX) < before || craftXp() > xpBefore, 20_000).catch(() => {});
                    if (count(FLAX) < before || craftXp() > xpBefore) {
                        spun += Math.max(1, before - count(FLAX));
                        session.noteProgress('xp', 'spin');
                        continue;
                    }
                }
            }
        }

        const r = await bot.useItemOnLoc(FLAX, /spinning wheel/i, { timeout: 8_000 });
        await bot.dismissBlockingUI();
        if (count(FLAX) < before || craftXp() > xpBefore) {
            spun += Math.max(1, before - count(FLAX));
            session.noteProgress('xp', 'spin');
            continue;
        }
        if (!r.success) {
            session.noteFailure('spin', r.message);
            await sdk.waitForTicks(1);
        }
    }
    await closeUi();
    log(`Spun ${spun} | bowstrings ${count(BOWSTRING)} | Crafting ${craft()} (${craftXp()} xp)`);
    return spun;
}

async function bankStrings(): Promise<void> {
    if (count(BOWSTRING) < 1 && occupiedSlots() < 28) return;
    intent('Banking bowstrings at Seers');
    if (!(await openSeersBank())) return;
    let deposited = 0;
    for (const item of [...sdk.getInventory()]) {
        // Leave flax in the bag — it still needs spinning, not re-banking.
        if (KEEP.test(item.name) || FLAX.test(item.name)) continue;
        const n = item.count ?? 1;
        await bot.depositItem(item, -1);
        if (BOWSTRING.test(item.name)) deposited += n;
    }
    await bot.closeBank();
    session.recordTrip(deposited);
    session.noteProgress('bank', 'seers');
    log(`Crafting ${craft()} (${craftXp()} xp)`);
}

/** Withdraw one inventory of banked flax. Returns inv flax count, or -1 if the bank did not open. */
async function withdrawBankFlaxLoad(): Promise<number> {
    intent('Withdrawing banked flax to spin before picking');
    if (!(await openSeersBank())) return -1;
    for (const item of [...sdk.getInventory()]) {
        if (KEEP.test(item.name) || FLAX.test(item.name)) continue;
        await bot.depositItem(item, -1);
    }
    const space = 28 - occupiedSlots();
    const inBank = bankCount(FLAX);
    if (space > 0 && inBank > 0) {
        const take = Math.min(inBank, space);
        const r = await bot.withdrawItem(FLAX, take, { asNote: false });
        log(`Withdraw flax x${take} ${r.success ? 'ok' : r.message} | inv ${count(FLAX)} bank ${bankCount(FLAX)}`);
    } else {
        log(`Bank flax ${inBank} | inv flax ${count(FLAX)} space ${space}`);
    }
    await bot.closeBank();
    return count(FLAX);
}

try {
    lastLoggedCraft = craft();
    await bot.skipTutorial();
    await closeUi();
    log(`Bowstrings start Crafting ${lastLoggedCraft} (${craftXp()} xp) until=${CRAFT_UNTIL || 'none'} @ ${pos().x},${pos().z}`);

    if (craft() < 10) {
        session.stop('setup', `Crafting ${craft()} — flax needs 10. Run sheep-shearer.ts ${username} --until=10 first`);
    } else if (goalReached()) {
        if (PARK_WHEN_DONE) {
            await park(`Crafting ${craft()} — goal ${GOAL_LEVEL} already met`);
        } else {
            session.stop('done', `Crafting ${craft()} — until ${CRAFT_UNTIL}`);
        }
    }

    if (!parked && !session.isStopped() && !inFlaxCircuit()) {
        await session.setPhase('travel');
        const travel = await travelToSeersFlax({ sdk, bot, log, session });
        if (travel !== 'arrived' && !inFlaxCircuit()) {
            if (!session.isStopped()) session.stop(travel, `travel ended ${travel}`);
        }
    }

    while (!session.isStopped()) {
        if (goalReached()) {
            if (PARK_WHEN_DONE) {
                await park(`Crafting ${craft()} — goal ${GOAL_LEVEL} met`);
                break;
            }
            session.stop('done', `Crafting ${craft()} — until ${CRAFT_UNTIL}`);
            break;
        }
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        await closeUi();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }
        if (craft() !== lastLoggedCraft) {
            log(`LEVEL UP Crafting ${craft()}`);
            lastLoggedCraft = craft();
        }

        if (count(FLAX) > 0) {
            if (session.metrics().phase !== 'spin') await session.setPhase('spin');
            session.setAnchor(WHEEL.x, WHEEL.z, WHEEL_FLOOR);
            await spinAllFlax();
            continue;
        }
        if (count(BOWSTRING) > 0 || (occupiedSlots() >= 28 && count(FLAX) === 0)) {
            if (session.metrics().phase !== 'bank') await session.setPhase('bank');
            session.setAnchor(SEERS_BANK.x, SEERS_BANK.z, 0);
            await bankStrings();
            continue;
        }
        if (!bankFlaxDrained) {
            if (session.metrics().phase !== 'bank') await session.setPhase('bank');
            session.setAnchor(SEERS_BANK.x, SEERS_BANK.z, 0);
            const got = await withdrawBankFlaxLoad();
            if (got < 0) {
                await sdk.waitForTicks(2);
                continue;
            }
            if (got > 0) continue;
            bankFlaxDrained = true;
            log('Bank is empty of flax — picking from the field');
        }
        if (occupiedSlots() < 28 && count(BOWSTRING) === 0) {
            if (session.metrics().phase !== 'pick') await session.setPhase('pick');
            session.setAnchor(FLAX_FIELD.x, FLAX_FIELD.z, 0);
            await fillFlax();
        }
    }

    const stop = session.metrics().stopReason;
    if (stop) log(`stopped ${stop.code} @ ${stop.location.x},${stop.location.z}`);
} catch (err) {
    session.stopRestartable('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    const reachedUntil =
        CRAFT_UNTIL > 0 && craft() >= CRAFT_UNTIL && session.metrics().stopReason?.code === 'done';
    await session.finalizeStop();
    // 2 tells craft-to-31 the level goal was met (0 is also setup failure / no goal).
    if (reachedUntil) process.exitCode = 2;
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
