/**
 * Bead harvester — farm imp beads for the quest accounts.
 *
 *   bun bots/quests/beads-harvester.ts <bot> [--target=8] [--minutes=90] [--bank=draynor]
 *
 * Why this exists: Imp Catcher needs one of each of four beads, and the drop rate
 * makes a fresh account hunt for tens of minutes. Beads are tradeable, so the
 * sane split is a dedicated harvester that fills a bank and a quest script that
 * withdraws one of each (`imp-catcher.ts` takes banked beads before hunting).
 *
 * The quest script keeps its own hunt path: if the bank is empty it still works,
 * just slowly. This script never touches the quest — it kills imps, keeps beads,
 * banks the rest.
 *
 * Movement uses the offline planner + hop walker (`walk-route`), never
 * `bot.walkTo` for long legs: the client pathfinder has no graph for stretches of
 * the map and a blocked leg records itself in `travel-gaps.jsonl`.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { findLongPath, initPathfinding } from '../../sdk/pathfinding';
import { installGracefulShutdown } from '../../sdk/runner';
import { hopSend, playerPos, waitForPlayerState } from './movement';
import { walkRoute } from './walk-route';
import { FLEET_BANKS, type Tile } from './tiles';

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const flag = (name: string, fallback: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
if (!botArg) throw new Error('usage: beads-harvester.ts <bot> [--camp=ardougne] [--target=8|0] [--minutes=0] [--trip-kills=60] [--bank=<slug>]');

/**
 * Camps, from the map data (`quest-lab-npcfind.ts imp`), not from habit:
 *
 *   9 imps  (2632,3218)  Ardougne Monastery / Tower of Life   <- best single camp
 *   8 imps  (2610,3126)  Ardougne south coast
 *   8 imps  (2845,3175)  Observatory
 *   0 imps  (3108,3154)  Wizards' Tower  <- what the quest script had inherited
 *
 * The quest's camp has NO static imp spawns within 40 tiles; a "hunt" there is
 * waiting for wanderers, which is why a 30-minute hunt produced under four beads.
 */
const CAMPS = {
    // (2632,3218) is inside a tree cluster (probe-camp.ts walkability grid); the
    // camp tile must be open ground, and the hunt radius covers the spawns.
    ardougne: { tile: { x: 2634, z: 3220 }, bank: 'ardougne', imps: 9 },
    'ardougne-south': { tile: { x: 2610, z: 3126 }, bank: 'yanille', imps: 8 },
    observatory: { tile: { x: 2845, z: 3175 }, bank: 'yanille', imps: 8 },
    'wizards-tower': { tile: { x: 3108, z: 3154 }, bank: 'draynor', imps: 0 },
} as const;
type CampName = keyof typeof CAMPS;
const CAMP_NAME = flag('camp', 'ardougne') as CampName;
if (!(CAMP_NAME in CAMPS)) throw new Error(`unknown camp '${CAMP_NAME}' (have: ${Object.keys(CAMPS).join(', ')})`);
const CAMP = CAMPS[CAMP_NAME];
const IMP_CAMP = CAMP.tile;

const TARGET = Math.max(0, Number(flag('target', '0')));
// 0 = run until stopped (a standing harvester); >0 = give up after that long.
const MINUTES = Math.max(0, Number(flag('minutes', '0')));
const TRIP_KILLS = Math.max(10, Number(flag('trip-kills', '60')));
const BANK_SLUG = flag('bank', CAMP.bank);
const BANK = FLEET_BANKS.find((b) => b.name.toLowerCase().replace(/\s+/g, '-') === BANK_SLUG);
if (!BANK) throw new Error(`unknown bank '${BANK_SLUG}' (have: ${FLEET_BANKS.map((b) => b.name.toLowerCase().replace(/\s+/g, '-')).join(', ')})`);

const envPath = join(process.cwd(), 'bots', botArg, 'bot.env');
if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}`);
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}
const username = process.env.BOT_USERNAME!;

const IMP = /^imp$/i;
const BEAD = /bead$/i;
const FOOD = /shark|lobster|swordfish|trout|salmon|tuna|bass|monkfish/i;
const HUNT_RADIUS = 18;
const MAX_TRIPS = 40;

initPathfinding();

const sdk = new BotSDK({
    botUsername: username,
    password: process.env.PASSWORD!,
    gatewayUrl: deriveGatewayUrl(process.env.SERVER),
    autoLaunchBrowser: false,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    autoReconnect: false,
    showChat: false,
});
await sdk.connect();
const bot = new BotActions(sdk);
const GRIND_LOG = join(process.cwd(), 'bots', username, 'grind.log');
const session = new ActivitySession(sdk, bot, { name: 'bead-harvester', grindLogPath: GRIND_LOG, stallMs: 300_000, maxRecoveryTactics: 8 });
installGracefulShutdown({ graceMs: 120_000 });

const log = (message: string): void => {
    session.log('log', message);
    void session.showIntent(message).catch(() => undefined);
    console.log(`[beads] ${message}`);
};
const pos = () => playerPos(sdk);
/** hp/maxHp/inCombat live on the player state, not in the position helper. */
const vitals = () => {
    const p = sdk.getState()?.player as { hp?: number; maxHp?: number; inCombat?: boolean } | undefined;
    return { hp: p?.hp ?? 99, maxHp: p?.maxHp ?? 99, inCombat: p?.inCombat === true };
};
const beadCount = () => sdk.getInventory().filter((i) => BEAD.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const foodCount = () => sdk.getInventory().filter((i) => FOOD.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const dist = (x: number, z: number) => Math.hypot(pos().x - x, pos().z - z);

/**
 * Plan one hop of the journey.
 *
 * `findLongPath` returns a TRUNCATED path when the destination is beyond what
 * its search reaches — silently, with no indication (prod: Ardougne from the
 * gnome stronghold returned 2 points ending 215 tiles short). Appending the
 * destination to that gave the walker a 215-tile leg, which the client refuses
 * to start, so the bot stood still forever. So a plan is reported as COMPLETE or
 * PARTIAL, and the caller walks a partial and re-plans from its end.
 */
function planRoute(dest: Tile): { waypoints: Tile[]; complete: boolean } {
    try {
        const p = pos();
        const path = findLongPath(p.level, p.x, p.z, dest.x, dest.z) as Tile[] | null;
        if (!path || !path.length) {
            // No plan at all: only a short direct step is safe to attempt.
            const d = Math.hypot(dest.x - p.x, dest.z - p.z);
            return { waypoints: d <= 10 ? [{ x: dest.x, z: dest.z }] : [], complete: false };
        }
        const out: Tile[] = [];
        for (let i = 0; i < path.length; i += 8) {
            const t = path[Math.min(i + 7, path.length - 1)]!;
            out.push({ x: t.x, z: t.z });
        }
        const last = path[path.length - 1]!;
        const complete = Math.hypot(last.x - dest.x, last.z - dest.z) <= 8;
        if (complete && (out[out.length - 1]!.x !== dest.x || out[out.length - 1]!.z !== dest.z)) {
            out.push({ x: dest.x, z: dest.z });
        }
        return { waypoints: out, complete };
    } catch {
        return { waypoints: [], complete: false };
    }
}

const host = {
    getPos: () => pos(),
    walk: (x: number, z: number) => hopSend(sdk, x, z, 10),
    waitTicks: (n: number) => sdk.waitForTicks(n),
};

/**
 * Get back to the ground plane before planning.
 *
 * `findLongPath` only plans within a plane, so a bot parked on an upstairs level
 * (an agility course platform, a guild floor) has no route anywhere: prod showed
 * `plan frontier stuck at (2483,3420) l2, 251 tiles short`. Climb down first,
 * then plan.
 */
async function normalisePlane(): Promise<void> {
    for (let attempt = 0; attempt < 3 && pos().level > 0; attempt++) {
        const level = pos().level;
        await sdk.scanNearbyLocs(12).catch(() => undefined);
        const down = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /stair|ladder/i.test(l.name) && (l.optionsWithIndex ?? []).some((o) => /climb-down|climb down|down/i.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!down) {
            log(`on plane ${level} with no climbable loc in range — cannot normalise`);
            return;
        }
        const res = await bot.interactLoc(down, /climb-down|climb down|down/i).catch((e: unknown) => ({ success: false, message: String(e) }));
        log(`climb-down ${down.name} (${down.x},${down.z}) from l${level}: ok=${res.success}`);
        for (let wait = 0; wait < 20 && pos().level === level; wait++) await sdk.waitForTicks(1);
        log(`  plane now l${pos().level} at (${pos().x},${pos().z})`);
    }
}

async function travel(dest: Tile, what: string): Promise<void> {
    // A route only exists within a plane; get to the ground first.
    if (pos().level > 0) await normalisePlane();
    const plan = (): { waypoints: Tile[]; complete: boolean } => planRoute(dest);
    let frontier: string | null = null;
    let res: Awaited<ReturnType<typeof walkRoute>> | null = null;

    for (let attempt = 0; attempt < 24; attempt++) {
        const d = Math.hypot(pos().x - dest.x, pos().z - dest.z);
        if (d <= 8) {
            log(`at ${what} (${pos().x},${pos().z}) l${pos().level}`);
            return;
        }

        const { waypoints, complete } = plan();
        if (!waypoints.length) {
            // The planner cannot reach the destination from here at all.
            if (what.includes('camp') && (d <= 12 || findImp())) {
                log(`no plan the last ${Math.round(d)} tiles to ${what} — hunting from here`);
                return;
            }
            throw new Error(`no route to ${what} from (${pos().x},${pos().z}) l${pos().level} — ${Math.round(d)} tiles away`);
        }

        res = await walkRoute(host, waypoints, { maxHop: 10, tolerance: 3, log: (l) => log(`   ${l}`) });
        if (complete && Math.hypot(pos().x - dest.x, pos().z - dest.z) <= 8) {
            log(`at ${what} (${pos().x},${pos().z}) l${pos().level}`);
            return;
        }

        const now = `${pos().x},${pos().z}`;
        if (now === frontier) {
            // Walked a partial plan and ended where the last one ended: the
            // planner's frontier is not advancing, so another lap is pointless.
            if (what.includes('camp') && (d <= 12 || findImp())) {
                log(`stuck ${Math.round(d)} tiles from ${what} at the plan frontier — hunting from here`);
                return;
            }
            throw new Error(`no progress toward ${what}: plan frontier stuck at (${now}) l${pos().level}, ${Math.round(d)} tiles short`);
        }
        frontier = now;
        if (!res.ok && !complete) {
            log(`   blocked at (${now}) — re-planning from here (${Math.round(d)} tiles to go)`);
        } else {
            log(`   ${Math.round(d)} tiles from ${what} — re-planning from (${now})`);
        }
    }

    throw new Error(`could not reach ${what} in 24 plans: ended ${Math.round(Math.hypot(pos().x - dest.x, pos().z - dest.z))} tiles short${res && !res.ok ? ` (${res.blocked})` : ''}`);
}

function findImp() {
    return (sdk.getNearbyNpcs() ?? [])
        .filter(
            (n) =>
                IMP.test(n.name) &&
                (n.hp === null || n.hp > 0) &&
                n.optionsWithIndex.some((o) => /attack/i.test(o.text)) &&
                (n.reachable !== false || (n.distance ?? 99) <= 9) &&
                Math.hypot(n.x - pos().x, n.z - pos().z) <= HUNT_RADIUS + 8,
        )
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null;
}

async function bankTrip(): Promise<void> {
    session.setPhase('bank').catch(() => undefined);
    await travel({ x: BANK.x, z: BANK.z }, `${BANK.name} bank`);
    if (!(await bot.openBank()).success) {
        await bot.closeInterface();
        if (!(await bot.openBank()).success) throw new Error('could not open the bank on a harvester trip');
    }
    await sdk.waitForTicks(2);
    // Keep beads and food; everything else (loot) goes in.
    for (const item of sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && !BEAD.test(i.name) && !FOOD.test(i.name))) {
        await bot.depositItem(item, -1);
    }
    await bot.closeInterface();
    session.noteProgress('bank', `banked loot; beads held ${beadCount()}`);
    log(`bank trip done — beads held ${beadCount()}${TARGET > 0 ? `/${TARGET}` : ''}`);
    reportRate();
}

let trips = 0;
let sinceTrip = 0;
let attacks = 0;
let kills = 0;
const startedAt = Date.now();

/** An imp is dead when nothing with its name stands within 2 tiles of where it was. */
function stillAlive(x: number, z: number): boolean {
    return (sdk.getNearbyNpcs() ?? []).some(
        (n) => IMP.test(n.name) && (n.hp === null || n.hp > 0) && Math.hypot(n.x - x, n.z - z) <= 2,
    );
}

/** One line of measured rate, not a guess: beads per kill and per hour. */
function reportRate(): void {
    const hours = (Date.now() - startedAt) / 3_600_000;
    const perKill = kills > 0 ? (beadCount() / kills).toFixed(3) : '—';
    const perHour = hours > 0.02 ? (beadCount() / hours).toFixed(1) : '—';
    log(`rate: ${kills} kills, ${attacks} attacks, ${beadCount()} beads held (${perKill}/kill, ${perHour}/hour, ${trips} trip(s))`);
}
const deadline = MINUTES > 0 ? Date.now() + MINUTES * 60_000 : Number.POSITIVE_INFINITY;

log(
    `harvesting ${TARGET > 0 ? `${TARGET} bead(s)` : 'continuously'} at '${CAMP_NAME}' (${IMP_CAMP.x},${IMP_CAMP.z}, ${CAMP.imps} static spawns) -> ${BANK.name} bank; ${MINUTES > 0 ? `budget ${MINUTES} min` : 'until stopped'}`,
);
await travel(IMP_CAMP, 'imp camp');

while (TARGET <= 0 || beadCount() < TARGET) {
    if (session.isStoppedOrRequested()) {
        log('stop requested — banking and finishing');
        break;
    }
    if (Date.now() > deadline) {
        log(`time budget spent with ${beadCount()}/${TARGET} beads`);
        break;
    }
    if (!sdk.isConnected() || !sdk.getState()) {
        await sdk.waitForTicks(4);
        continue;
    }
    if (dist(IMP_CAMP.x, IMP_CAMP.z) > 10) await travel(IMP_CAMP, 'imp camp');

    // Restock when the bag fills or the food runs out.
    const bagFull = sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length >= 26;
    if (foodCount() === 0 && vitals().hp <= Math.ceil(vitals().maxHp * 0.4)) {
        await bankTrip();
        trips++;
        sinceTrip = 0;
        continue;
    }
    if (bagFull || sinceTrip > TRIP_KILLS) {
        if (trips >= MAX_TRIPS) {
            log('trip budget spent');
            break;
        }
        await bankTrip();
        trips++;
        sinceTrip = 0;
        continue;
    }

    const imp = findImp();
    if (!imp) {
        await sdk.waitForTicks(3);
        sinceTrip++;
        continue;
    }
    if ((imp.distance ?? 99) > 6) {
        await bot.walkTo(imp.x, imp.z, 3).catch(() => undefined);
        await sdk.waitForTicks(1);
        continue;
    }
    const attack = await bot.attack(imp);
    if (!attack.success) {
        await sdk.waitForTicks(1);
        continue;
    }
    attacks++;
    const targetX = imp.x;
    const targetZ = imp.z;
    for (let i = 0; i < 40 && vitals().inCombat; i++) await sdk.waitForTicks(1);
    await sdk.waitForTicks(2);
    if (!stillAlive(targetX, targetZ)) kills++;
    for (let i = 0; i < 6; i++) {
        const drop = [...(sdk.getGroundItems() ?? [])]
            .filter((g) => BEAD.test(g.name) && g.reachable !== false && (g.distance ?? 99) <= 12)
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!drop) break;
        const before = beadCount();
        await bot.pickupItem(drop);
        await sdk.waitForTicks(1);
        if (beadCount() > before) session.noteProgress('inventory', `bead ${beadCount()}/${TARGET}`);
    }
    sinceTrip++;
}

log(`finished with ${beadCount()} bead(s) after ${trips} trip(s)`);
reportRate();
await bankTrip().catch((error: unknown) => log(`final bank trip failed: ${(error as Error).message}`));
const reached = TARGET > 0 && beadCount() >= TARGET;
session.stop(reached ? 'done' : 'stopped', `harvester: ${beadCount()} bead(s), ${kills} kills`, { restartable: false });
while (true) await sdk.waitForTicks(100).catch(() => undefined);
