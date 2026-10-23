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
 * just slowly. This script never touches the quest — it kills imps, banks the
 * beads and the rest of the loot, and keeps only food in hand.
 *
 * Movement plans with the offline planner (`findLongPath`) and walks the
 * planner's TURN POINTS in order — see "route walking" below. It never uses
 * `bot.walkTo` for long legs: the client pathfinder has no graph for stretches
 * of the map and a blocked leg records itself in `travel-gaps.jsonl`.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { findLongPath, getDoorAt, initPathfinding, isTileWalkable } from '../../sdk/pathfinding';
import { installGracefulShutdown } from '../../sdk/runner';
import { playerPos } from './movement';
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
const BANK_FOUND = FLEET_BANKS.find((b) => b.name.toLowerCase().replace(/\s+/g, '-') === BANK_SLUG);
if (!BANK_FOUND) throw new Error(`unknown bank '${BANK_SLUG}' (have: ${FLEET_BANKS.map((b) => b.name.toLowerCase().replace(/\s+/g, '-')).join(', ')})`);
/** Narrowed once so the closure in bankTrip() keeps the non-null type. */
const BANK = BANK_FOUND;

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

// A camp is a stand-point: if the collision snapshot calls the camp tile blocked
// the walker can never arrive, so say so once at startup instead of parking
// silently. (The observatory tile (2845,3175) is inside a walled enclosure the
// snapshot cannot route into at all — a pre-existing camp-table problem.)
if (!isTileWalkable(0, IMP_CAMP.x, IMP_CAMP.z)) {
    console.warn(`[beads] WARN camp tile (${IMP_CAMP.x},${IMP_CAMP.z}) is NOT walkable in collision-data.json — expect the walker to park here`);
}

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
/**
 * Beads banked so far this run.
 *
 * Beads do NOT stack: 26 of them occupy all 26 inventory slots. A harvester that
 * keeps them in the bag therefore sets `bagFull` permanently, and every loop
 * iteration banks (depositing nothing) and walks back to the camp without ever
 * reaching the attack step — 0 attacks, 0 kills, forever, until the trip cap
 * ends the run. They go in the bank like the rest of the loot (imp-catcher.ts
 * withdraws them from there), and run progress is bag + bank.
 */
let beadsBanked = 0;
const beadsGathered = () => beadCount() + beadsBanked;
const dist = (x: number, z: number) => Math.hypot(pos().x - x, pos().z - z);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* ════════════════════════════════════════════════════════════════════════════
 *  ROUTE WALKING — follow the planner's turn points, never a decimated chord
 *
 *  Diagnosis (jacklove4, Ardougne, 600+ minutes with no effect):
 *
 *  The leg (2648,3265) -> (2635,3248) was never impassable. `findLongPath`
 *  returns a complete 18-point route from that tile to the camp (47 tiles,
 *  ending exactly on (2634,3220)). What was impossible was the CHORD the old
 *  walker kept sending: `travelTo` samples the planner path every 8th point
 *  (`path[i + 7]`) and `hopSend` then walks a STRAIGHT line to the sample — so
 *  an 18-point route becomes the "leg 1/3" in the box log, and leg 1 is
 *  path[7] = (2635,3248), around the corner of the Ardougne town block. The
 *  first walk was therefore a straight 10-tile bearing from (2648,3265) to
 *  (2642,3257), and the "6-tile shrink" retry was (2644,3260).
 *
 *  Collision data (sdk/collision-data.json, plane 0):
 *    (2642,3257) flags=2097152   blocked floor, inside a 1065-tile solid mass
 *    (2644,3260) flags=2097152   same mass, x2640..2684 / z3220..3274
 *    (2643..2656,3264) flags=2097152  the mass's south face, one row north
 *    (2641..2649,3265) flags=0   open: the one-tile lane the bot stands in
 *    (2650,3265) flags=2097152   the lane's east end is closed
 *  `findLongPath(2648,3265 -> 2642,3257)` is NOT a straight walk (the BFS
 *  detours); `findLongPath(2648,3265 -> 2641,3265)` is. Out of that lane the
 *  only way is WEST along z=3265 to (2641,3265), then south down x=2640/2639 —
 *  the corner the decimation threw away. A walk onto blocked floor is refused
 *  by the server, so the player moved 0.0 tiles; `walk-route` answered "hop
 *  refused" by re-sending the identical bearing into the same wall, twice, then
 *  reported BLOCKED. Re-planning from the same tile re-decimated to the same
 *  corner-cutting chord, hourly, forever.
 *
 *  So: walk the turn points in order, in sub-hops that stay on the route and
 *  are verified against the collision data before they are sent. Zero movement
 *  is a wall, not a slow walk — one sidestep, then a full re-plan from the live
 *  tile, then park (the process never exits on its own).
 *
 *  SECOND PASS (jacklove4, after the corner walker went live) — the corner
 *  walker is correct and stays, but it was never the whole story. The live log
 *  after the rewrite reads:
 *
 *    route 18 turn point(s) from (2648,3265) l0 to (2634,3220)
 *    plan 1/6 stuck at (2648,3265): zero movement at (2648,3265) toward
 *      (2641,3265) — same tile twice
 *
 *  The first sub-hop is SEVEN TILES WEST ON THE SAME ROW — no corner, no chord,
 *  `findLongPath(2648,3265 -> 2641,3265)` returns that single waypoint — and the
 *  server refuses it. Two corrections to the note above, from the flag enum:
 *  2097152 is `FLOOR` (a walkable floor tile), not "blocked floor"; in this
 *  engine `WALK_BLOCKED = FLOOR|FLOOR_DECORATION|LOC = 2359552`. Re-read with
 *  the right mask, collision-data.json calls (2641..2649,3265) open ground and
 *  an 8-way BFS from the stall tile reaches the BANK (4231 tiles) — so the
 *  snapshot does not merely say "walkable", it says "connected to the world".
 *  The server disagrees with every step from that tile, which is what a closed
 *  interior door, a scripted crossing or an export gap looks like from here.
 *  (2648,3265) is also NOT under a roof (no ROOF bit; the RPDT depot's roofed
 *  floor starts at z=3268), so the bot is on the depot's north side, in a 3-row
 *  pocket, with the nearest door tile 8 tiles away inside the building.
 *
 *  Nothing in the snapshot can settle that, so the walker must stop treating
 *  the snapshot as the authority on what the server will accept: when a plan
 *  dies twice on one tile it now (1) blind-probes all eight neighbours, one
 *  verified 1-tile walk each, ignoring the snapshot, and (2) force-scans for
 *  door/gate locs and tries to open one and cross the door line — judging both
 *  by actual displacement / plane change, never by an interact receipt (an open
 *  door returns no player-state evidence). Only if that fails does it park and
 *  re-scan later. It no longer falls back to `travelTo`: that helper samples
 *  the planner path (`path[i+7]`) and sends a straight chord, so against a
 *  closed door it re-issues the same refused bearing on a cadence forever —
 *  exactly the runbook's "repeating failure at one tile".
 * ════════════════════════════════════════════════════════════════════════════ */
const MAX_HOP = 9;
const HOP_WAIT_BASE_MS = 1_200;
const HOP_WAIT_PER_TILE_MS = 400;
const MAX_PLANS = 6;
const PARK_RETRY_MS = 120_000;
/** Non-camp destinations accept this many tiles short (banks are a radius too). */
const ARRIVE = 5;
/** Door locs are stale outside a scan; force a re-scan this wide before judging. */
const DOOR_SCAN_RADIUS = 10;
/** Doors tried per unstick — nearest first. More than a few is just packet churn. */
const DOOR_TRIES = 3;
/** A loc only appears in nearbyLocs this close (a door is interactable at 1-2). */
const DOOR_REACH = 2;

/**
 * Exact line-of-walk test: the planner returns the destination as its only
 * turn point iff it can walk there without turning. One BFS (~0.2ms) — cheap
 * enough to check every sub-hop, and it uses the same collision snapshot the
 * route came from instead of guessing which side of a wall a flag sits on.
 */
function canWalkStraight(level: number, from: Tile, to: Tile): boolean {
    if (from.x === to.x && from.z === to.z) return true;
    try {
        const p = findLongPath(level, from.x, from.z, to.x, to.z) ?? [];
        return p.length === 1 && p[0]!.x === to.x && p[0]!.z === to.z;
    } catch {
        return false;
    }
}

/**
 * Furthest tile on the straight bearing from `from` to `to`, capped at
 * `maxHop`, that is still walkable. Null when not even one tile is.
 * Planner turn points are axis-aligned or perfect diagonals; anything else is
 * a chord across a corner, which is exactly what must never be sent.
 */
function straightStop(level: number, from: Tile, to: Tile, maxHop: number): Tile | null {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const steps = Math.max(Math.abs(dx), Math.abs(dz));
    if (steps === 0) return null;
    if (dx !== 0 && dz !== 0 && Math.abs(dx) !== Math.abs(dz)) return null;
    const sx = Math.sign(dx);
    const sz = Math.sign(dz);
    let stop: Tile | null = null;
    for (let i = 1; i <= Math.min(steps, maxHop); i++) {
        const next = { x: from.x + sx * i, z: from.z + sz * i };
        if (!canWalkStraight(level, stop ?? from, next)) break;
        stop = next;
    }
    return stop;
}

/** A walkable neighbour "in another direction" than the one that was refused. */
function sidestep(here: { x: number; z: number; level: number }, point: Tile): Tile | null {
    const cands: Tile[] = [];
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue;
            const t = { x: here.x + dx, z: here.z + dz };
            if (!isTileWalkable(here.level, t.x, t.z)) continue;
            if (!canWalkStraight(here.level, here, t)) continue;
            cands.push(t);
        }
    }
    cands.sort((a, b) => Math.hypot(a.x - point.x, a.z - point.z) - Math.hypot(b.x - point.x, b.z - point.z));
    return cands[0] ?? null;
}

/**
 * Send one step to a walkable neighbour in another direction, and report where
 * the bot actually ends up (null = the neighbour was refused too, or there is
 * no neighbour to try). This is the honest answer to "hop refused": change the
 * bearing, do not re-send it.
 */
async function stepAside(here: { x: number; z: number; level: number }, point: Tile, why: string): Promise<Tile | null> {
    const side = sidestep(here, point);
    if (!side) {
        log(`   ${why} — and no walkable neighbour to try`);
        return null;
    }
    log(`   ${why} — trying neighbour (${side.x},${side.z})`);
    await sdk.sendWalk(side.x, side.z, true);
    await sdk.waitForTicks(3).catch(() => undefined);
    const now = playerPos(sdk);
    if (now.x === here.x && now.z === here.z) {
        log(`   neighbour (${side.x},${side.z}) refused too`);
        return null;
    }
    session.noteProgress('location', `sidestep ${now.x},${now.z}`);
    return { x: now.x, z: now.z };
}

type PlanOutcome = { kind: 'arrived' } | { kind: 'replan'; why: string } | { kind: 'stuck'; why: string };

/* ── Unstick: ask the SERVER what it allows, then try a door ───────────────── */

type DoorLoc = { name: string; id: number; x: number; z: number; distance: number; opIndex: number };
type Spot = { x: number; z: number; level: number };

/** Order matters: cards first, diagonals last — a diagonal is the easier refusal. */
const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
    [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1],
];

const moved = (a: Spot, b: Spot) => a.x !== b.x || a.z !== b.z || a.level !== b.level;

/**
 * One verified 1-tile walk onto each neighbour, ignoring the collision snapshot
 * entirely. The snapshot is exactly what was wrong at the stall tile (it called
 * eight refused neighbours walkable and reached the bank), so "isTileWalkable
 * said no" is not a reason to skip a direction — the server is the authority and
 * a refused step costs one packet. Returns the tile the server accepted.
 */
async function probeNeighbours(here: Spot): Promise<Spot | null> {
    let calledWalkable = 0;
    for (const [dx, dz] of NEIGHBOURS) {
        const tx = here.x + dx;
        const tz = here.z + dz;
        if (isTileWalkable(here.level, tx, tz)) calledWalkable++;
        await sdk.sendWalk(tx, tz, false).catch(() => undefined);
        await sdk.waitForTicks(2).catch(() => undefined);
        const now: Spot = playerPos(sdk);
        if (moved(here, now)) {
            log(`   server accepted a 1-tile (${dx},${dz}) step from (${here.x},${here.z}) -> (${now.x},${now.z}) l${now.level} — the collision snapshot was wrong about that tile`);
            session.noteProgress('location', `probe ${now.x},${now.z}`);
            return now;
        }
    }
    log(`   all 8 neighbours of (${here.x},${here.z}) l${here.level} refused (snapshot called ${calledWalkable} of them walkable) — not a per-tile collision problem`);
    return null;
}

type ScannedLoc = {
    name: string;
    id: number;
    x: number;
    z: number;
    distance?: number;
    optionsWithIndex?: Array<{ text: string; opIndex?: number }>;
};

/**
 * Door/gate locs in the given scan that advertise an Open option, nearest first.
 * Takes the list EXPLICITLY: `scanNearbyLocs` returns its result without updating
 * `state.nearbyLocs`, so re-reading `getNearbyLocs()` after a scan hands back the
 * stale list — and a door is only in the list when it was in range of the scan.
 */
function openableDoors(locs: ScannedLoc[]): DoorLoc[] {
    return locs
        .map((l) => {
            const open = (l.optionsWithIndex ?? []).find((o) => /^open$/i.test(o.text));
            if (!open || !/door|gate/i.test(l.name)) return null;
            return { name: l.name, id: l.id, x: l.x, z: l.z, distance: l.distance ?? 99, opIndex: open.opIndex ?? 1 };
        })
        .filter((d): d is DoorLoc => d !== null)
        .sort((a, b) => a.distance - b.distance);
}

/**
 * Get within interaction range of a door. Axis-aligned sub-hops first (verified
 * against collision data, which is cheap), then `bot.walkTo` — the local
 * primitive for "stand next to this thing", which also opens doors on its way
 * and handles the diagonal approach a straight sub-hop cannot express.
 */
async function approachDoor(door: DoorLoc): Promise<boolean> {
    const inRange = (s: Spot) => Math.max(Math.abs(s.x - door.x), Math.abs(s.z - door.z)) <= DOOR_REACH;
    let here: Spot = playerPos(sdk);
    if (inRange(here)) return true;

    for (let i = 0; i < 2; i++) {
        const stop = straightStop(here.level, here, { x: door.x, z: door.z }, 3);
        if (!stop) break;
        await sdk.sendWalk(stop.x, stop.z, false).catch(() => undefined);
        await sdk.waitForTicks(3).catch(() => undefined);
        const after: Spot = playerPos(sdk);
        if (inRange(after)) return true;
        if (!moved(here, after)) break;
        here = after;
    }

    log(`   not axis-aligned to (${door.x},${door.z}) from (${here.x},${here.z}) — approaching with walkTo`);
    await bot.walkTo(door.x, door.z, 1).catch(() => undefined);
    await sdk.waitForTicks(2).catch(() => undefined);
    return inRange(playerPos(sdk));
}

/**
 * Landings to try after bumping a door, best first: through the doorway on the
 * far side, then either shoulder, then the tile next to it. A door's wall edge
 * is known from the SDK's door index (angle 0/2 = a vertical wall, cross along
 * X; 1/3 = a horizontal wall, cross along Z), so the crossing axis is not a
 * guess — a straight tile walk along a wall is the first thing refused.
 */
function crossLandings(level: number, from: Spot, door: DoorLoc): Tile[] {
    const away = ([dx, dz]: [number, number]) =>
        Math.sign(door.x - from.x) * dx + Math.sign(door.z - from.z) * dz;
    const perpendicular: Array<[number, number]> =
        (getDoorAt(level, door.x, door.z)?.angle ?? 0) % 2 === 0
            ? [[1, 0], [-1, 0]] // vertical wall: cross east/west
            : [[0, 1], [0, -1]]; // horizontal wall: cross north/south
    const along: Array<[number, number]> = perpendicular[0]![0] !== 0 ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
    const dirs = [...perpendicular.sort((a, b) => away(b) - away(a)), ...along.sort((a, b) => away(b) - away(a))];

    const out: Tile[] = [];
    for (const [dx, dz] of dirs) {
        out.push({ x: door.x + dx * 2, z: door.z + dz * 2 }, { x: door.x + dx, z: door.z + dz });
    }
    const seen = new Set<string>();
    return out.filter((t) => {
        const k = `${t.x},${t.z}`;
        if ((t.x === from.x && t.z === from.z) || seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

/**
 * Open one door and cross it. Success is DISPLACEMENT (or a plane change) —
 * never `sendInteractLoc`'s return value: opening a door emits no player-state
 * evidence, so the client answers "nothing happened" for a door that opened.
 */
async function openDoorAndCross(door: DoorLoc): Promise<Spot | null> {
    const at = playerPos(sdk);
    log(`   door ${door.name} @ (${door.x},${door.z}) op=${door.opIndex} d=${Math.round(door.distance)} from (${at.x},${at.z})`);
    if (!(await approachDoor(door))) {
        const now = playerPos(sdk);
        if (moved(at, now)) {
            session.noteProgress('location', `door approach ${now.x},${now.z}`);
            return now;
        }
        log(`   could not approach (${door.x},${door.z}) — every step toward it was refused`);
        return null;
    }

    const pass = await sdk.sendInteractLoc(door.x, door.z, door.id, door.opIndex).catch(() => null);
    log(`   click ${pass?.success ? 'accepted' : (pass?.message ?? 'threw')} — receipt is not evidence, stepping across`);
    await sdk.waitForTicks(2).catch(() => undefined);

    // A dialog raised by a scripted door swallows the next walk silently.
    await bot.closeInterface().catch(() => undefined);

    const before: Spot = playerPos(sdk);
    for (const landing of crossLandings(before.level, before, door)) {
        await sdk.sendWalk(landing.x, landing.z, false).catch(() => undefined);
        await sdk.waitForTicks(3).catch(() => undefined);
        const now: Spot = playerPos(sdk);
        if (moved(before, now)) {
            session.noteProgress('location', `crossed ${now.x},${now.z}`);
            return now;
        }
    }
    log(`   bumped (${door.x},${door.z}) but no step across it was accepted — still at (${before.x},${before.z}) l${before.level}`);
    return null;
}

/**
 * The bot is refusing every walk from a tile its own snapshot calls open. Find
 * out what the SERVER will accept: a bare 1-tile step in any of 8 directions
 * first, then a door we can open and cross. Loud on every door tile it tried so
 * the ops log names the door next time it happens.
 */
async function unstickBox(why: string): Promise<boolean> {
    const here: Spot = playerPos(sdk);
    log(`stuck at (${here.x},${here.z}) l${here.level} — ${why}; testing the server before parking`);
    if (await probeNeighbours(here)) return true;

    // scanNearbyLocs does NOT refresh state.nearbyLocs — use its return value or
    // the door list is whatever the last push happened to contain.
    const scanned = (await sdk.scanNearbyLocs(DOOR_SCAN_RADIUS).catch(() => [] as ScannedLoc[])) as ScannedLoc[];
    const doors = openableDoors(scanned);
    if (!doors.length) {
        log(`   no door/gate with an Open option within ${DOOR_SCAN_RADIUS} tiles of (${here.x},${here.z}) (${scanned.length} locs scanned, attempted door tiles: none) — a door we cannot see cannot be opened; parking and re-scanning on the next attempt`);
        return false;
    }

    const tries = doors.slice(0, DOOR_TRIES);
    log(`   ${doors.length} openable door/gate(s) in scan; trying ${tries.map((d) => `${d.name}@${d.x},${d.z}`).join(', ')}`);
    for (const door of tries) {
        if (session.isStoppedOrRequested()) return false;
        const landed = await openDoorAndCross(door);
        if (landed) {
            log(`   out: ${door.name} @ (${door.x},${door.z}) -> (${landed.x},${landed.z}) l${landed.level}`);
            return true;
        }
    }
    log(`   door escape exhausted (attempted ${tries.map((d) => `${d.x},${d.z}`).join(', ')}) — parking at (${playerPos(sdk).x},${playerPos(sdk).z})`);
    return false;
}

/** Walk one planner route to `dest`. Never retries a bearing that moved nothing. */
async function walkPlan(dest: Tile): Promise<PlanOutcome> {
    const start = playerPos(sdk);
    let path: Array<{ x: number; z: number }>;
    try {
        path = (findLongPath(start.level, start.x, start.z, dest.x, dest.z) ?? []).map((p) => ({ x: p.x, z: p.z }));
    } catch (error) {
        return { kind: 'replan', why: `planner threw: ${(error as Error).message}` };
    }
    if (!path.length) return { kind: 'replan', why: `planner found no route from (${start.x},${start.z}) l${start.level}` };
    log(`   route ${path.length} turn point(s) from (${start.x},${start.z}) l${start.level} to (${dest.x},${dest.z})`);

    // The tile of the previous zero-move walk, NOT the start tile: seeding it with
    // the start tile made the very first refused hop at the spawn tile report
    // "same tile twice" and skip the sidestep entirely (live log, jacklove4).
    let lastTile = '';

    for (let idx = 0; idx < path.length; idx++) {
        const point = path[idx]!;
        const isLast = idx === path.length - 1;
        for (let guard = 0; guard < 160; guard++) {
            const here = playerPos(sdk);
            // Land ON each turn point: "within a tile" skips the corner and turns
            // the next step into a diagonal through it, which is the exact class
            // of chord this walker exists to avoid.
            if ((here.x === point.x && here.z === point.z) || (isLast && Math.hypot(here.x - point.x, here.z - point.z) <= 1)) break;
            const stop = straightStop(here.level, here, point, MAX_HOP);
            if (!stop) {
                // Nothing walkable on this bearing — as true of a stale route as of a
                // bot standing on a tile the snapshot calls blocked. Step off first.
                const why = `no collision-clear sub-hop from (${here.x},${here.z}) toward turn point (${point.x},${point.z})`;
                const off = await stepAside(here, point, why);
                return { kind: 'replan', why: off ? `${why}; stepped to (${off.x},${off.z})` : why };
            }
            const before = here;
            await sdk.sendWalk(stop.x, stop.z, true);
            const budget = HOP_WAIT_BASE_MS + Math.hypot(stop.x - before.x, stop.z - before.z) * HOP_WAIT_PER_TILE_MS;
            await sdk
                .waitForCondition((s) => {
                    const px = s.player?.worldX ?? 0;
                    const pz = s.player?.worldZ ?? 0;
                    return s.player?.isDead === true || Math.hypot(px - stop.x, pz - stop.z) <= 1;
                }, budget)
                .catch(() => undefined);
            await sdk.waitForTicks(1).catch(() => undefined);

            const after = playerPos(sdk);
            const moved = Math.hypot(after.x - before.x, after.z - before.z);
            if (moved < 1) {
                // Zero movement is a refused walk, not a slow one. Two zero-move
                // walks from the same tile means the route is wrong here; retrying
                // the identical bearing is what deadlocked Ardougne for 600+ min.
                const key = `${after.x},${after.z}`;
                const why = `zero movement at (${key}) toward (${point.x},${point.z})${isTileWalkable(after.level, after.x, after.z) ? ' [snapshot calls this tile walkable — the server is refusing it]' : ''}`;
                if (key === lastTile) return { kind: 'stuck', why: `${why} — same tile twice` };
                lastTile = key;
                const off = await stepAside(after, point, why);
                if (!off) return { kind: 'stuck', why: `${why}; could not step off` };
                return { kind: 'replan', why: `${why}; sidestepped to (${off.x},${off.z}) — re-planning the whole leg from the live tile` };
            }
            lastTile = `${after.x},${after.z}`;
            session.noteProgress('location', `walk ${after.x},${after.z}`);
        }
    }

    const at = playerPos(sdk);
    const short = Math.hypot(at.x - dest.x, at.z - dest.z);
    return short <= 1 ? { kind: 'arrived' } : { kind: 'replan', why: `plan ended ${Math.round(short)} tiles short at (${at.x},${at.z})` };
}

/**
 * Reach `dest`: the corner-aware turn-point walker, then — only when every plan
 * dies on one tile — the server probe + door escape (`unstickBox`), then park.
 * Returns false only when there is nothing left to try — never throws.
 */
async function travel(dest: Tile, what: string, accept?: (distance: number) => boolean): Promise<boolean> {
    // Two rounds at most: round 2 only runs if the unstick actually moved us out
    // of the box. The corner walker re-plans from the live tile on the way out.
    for (let round = 1; round <= 2; round++) {
        const stuckTiles = new Set<string>();
        for (let plan = 1; plan <= MAX_PLANS; plan++) {
            const at = playerPos(sdk);
            const d = Math.hypot(at.x - dest.x, at.z - dest.z);
            if (d <= ARRIVE || accept?.(d)) {
                log(`at ${what} (${at.x},${at.z}) l${at.level}${d > ARRIVE ? ' (accepted nearby)' : ''}`);
                return true;
            }
            const out = await walkPlan(dest);
            const now = playerPos(sdk);
            if (out.kind === 'arrived' || Math.hypot(now.x - dest.x, now.z - dest.z) <= ARRIVE) {
                log(`at ${what} (${now.x},${now.z}) l${now.level} after ${plan} plan(s)`);
                return true;
            }
            if (out.kind === 'replan') {
                log(`   plan ${plan}/${MAX_PLANS}: ${out.why}`);
            } else {
                // A second plan that dies on the same tile is not a new attempt: the
                // route out of here does not exist. Stop spending walk packets on it.
                const key = `${now.x},${now.z}`;
                log(`   plan ${plan}/${MAX_PLANS} stuck at (${key}): ${out.why}`);
                if (stuckTiles.has(key)) {
                    log(`   already stuck at (${key}) on an earlier plan — abandoning this leg`);
                    break;
                }
                stuckTiles.add(key);
            }
            if (accept?.(Math.hypot(now.x - dest.x, now.z - dest.z))) {
                log(`at ${what} (${now.x},${now.z}) l${now.level} (accepted short)`);
                return true;
            }
        }

        const at = playerPos(sdk);
        const short = Math.hypot(at.x - dest.x, at.z - dest.z);
        if (short <= ARRIVE || accept?.(short)) {
            log(`at ${what} (${at.x},${at.z}) l${at.level}`);
            return true;
        }
        if (round === 2) break;
        // Every plan died on one tile. Before parking, ask the server what it will
        // accept and try a door: a leg that starts inside an enclosure (or on a
        // tile the snapshot is wrong about) has no walkable route, only an exit.
        if (!(await unstickBox(`${what} unreachable from (${at.x},${at.z}) l${at.level}, ${Math.round(short)} tiles short`))) {
            break;
        }
        log(`   moved by the unstick to (${playerPos(sdk).x},${playerPos(sdk).z}) — re-planning ${what} from there`);
    }

    // No travelTo fallback: its sampled chord (path[i+7] + a straight hop) is the
    // exact deadlock the corner walker exists to avoid, so against a refused tile
    // it re-sends the same bearing forever. Park instead — reach() re-scans on a
    // slow cadence, so a door that opens later is still found.
    const at = playerPos(sdk);
    log(`could not reach ${what}: no walk moves and no door opened from (${at.x},${at.z}) l${at.level} — parking (no travelTo fallback by design)`);
    return false;
}

/**
 * travel() plus a park loop. A route that cannot be completed parks the bot
 * where it stands and retries on a slow cadence: the supervisor relaunches an
 * exited container, and a relaunch re-walks the same dead leg in a tight loop,
 * which is exactly the churn this replaces.
 */
async function reach(dest: Tile, what: string, accept?: (distance: number) => boolean): Promise<boolean> {
    for (let attempt = 1; ; attempt++) {
        if (session.isStoppedOrRequested()) return false;
        if (await travel(dest, what, accept)) return true;
        if (Date.now() > deadline) {
            log(`time budget spent before reaching ${what}`);
            return false;
        }
        const at = playerPos(sdk);
        log(`parked at (${at.x},${at.z}) l${at.level}: ${what} unreachable this attempt — retrying in ${PARK_RETRY_MS / 1000}s (attempt ${attempt}; process stays up)`);
        await sleep(PARK_RETRY_MS);
    }
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

/** A camp is a radius, not a tile: trees block the last few tiles, an imp is the point. */
const campAccept = (d: number) => d <= 12 || findImp() !== null;

async function bankTrip(): Promise<void> {
    session.setPhase('bank').catch(() => undefined);
    if (!(await reach({ x: BANK.x, z: BANK.z }, `${BANK.name} bank`))) {
        log('bank leg abandoned — keeping the loot and returning to the camp');
        return;
    }
    if (!(await bot.openBank()).success) {
        await bot.closeInterface();
        if (!(await bot.openBank()).success) {
            log('could not open the bank on a harvester trip — keeping the loot');
            return;
        }
    }
    await sdk.waitForTicks(2);
    // Beads go IN with the loot (imp-catcher.ts withdraws them from the bank):
    // they do not stack, so keeping them fills the bag and deadlocks the hunt.
    // Food stays — it is the only thing the camp needs in hand.
    const heldBefore = beadCount();
    for (const item of sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && !FOOD.test(i.name))) {
        await bot.depositItem(item, -1);
    }
    await sdk.waitForTicks(2);
    beadsBanked += Math.max(0, heldBefore - beadCount());
    await bot.closeInterface();
    session.noteProgress('bank', `banked loot; ${beadsBanked} bead(s) in the bank`);
    log(`bank trip done — ${beadsBanked} bead(s) banked${TARGET > 0 ? `, ${beadsGathered()}/${TARGET} gathered` : ''}`);
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
    const perKill = kills > 0 ? (beadsGathered() / kills).toFixed(3) : '—';
    const perHour = hours > 0.02 ? (beadsGathered() / hours).toFixed(1) : '—';
    log(
        `rate: ${kills} kills, ${attacks} attacks, ${beadsGathered()} bead(s) gathered (${beadCount()} in bag, ${beadsBanked} banked) (${perKill}/kill, ${perHour}/hour, ${trips} trip(s))`,
    );
}
const deadline = MINUTES > 0 ? Date.now() + MINUTES * 60_000 : Number.POSITIVE_INFINITY;

/**
 * Park forever. The script must never exit 0 on its own: `--target=0
 * --minutes=0` means "run until stopped", and a supervisor that sees a clean
 * exit relaunches into the same state in a tight loop. SIGTERM from the
 * supervisor still ends the process through installGracefulShutdown.
 */
async function parkForever(reason: string): Promise<never> {
    log(`${reason} — parking; this process stays up until it is stopped`);
    for (;;) {
        await sleep(60_000);
        await sdk.waitForTicks(1).catch(() => undefined);
    }
}

log(
    `harvesting ${TARGET > 0 ? `${TARGET} bead(s)` : 'continuously'} at '${CAMP_NAME}' (${IMP_CAMP.x},${IMP_CAMP.z}, ${CAMP.imps} static spawns) -> ${BANK.name} bank; ${MINUTES > 0 ? `budget ${MINUTES} min` : 'until stopped'}`,
);

// Reach the camp. Failure here parks and retries; it never ends the process.
if (!(await reach(IMP_CAMP, 'imp camp', campAccept))) {
    await parkForever('could not route to the imp camp');
}

while (TARGET <= 0 || beadsGathered() < TARGET) {
    if (session.isStoppedOrRequested()) {
        log('stop requested — banking and finishing');
        break;
    }
    if (Date.now() > deadline) {
        log(`time budget spent with ${beadsGathered()}/${TARGET} beads`);
        break;
    }
    if (!sdk.isConnected() || !sdk.getState()) {
        await sdk.waitForTicks(4).catch(() => undefined);
        continue;
    }
    if (session.needsRecovery()) {
        // Recover() stays up and switches approach; it never exits the process.
        await session.recover().catch((error: unknown) => log(`recovery error: ${(error as Error).message}`));
        continue;
    }

    try {
        if (dist(IMP_CAMP.x, IMP_CAMP.z) > 10) {
            if (!(await reach(IMP_CAMP, 'imp camp', campAccept))) break;
        }

        // Restock when the bag fills or the food runs out.
        const bagFull = sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length >= 26;
        if (foodCount() === 0 && vitals().hp <= Math.ceil(vitals().maxHp * 0.4)) {
            await bankTrip();
            trips++;
            sinceTrip = 0;
            continue;
        }
        if (bagFull || sinceTrip > TRIP_KILLS) {
            // The trip cap bounds a run that was given a target or a time budget.
            // A standing harvester (`--target=0 --minutes=0`) is "run until
            // stopped", so banking never ends it.
            if (trips >= MAX_TRIPS && (TARGET > 0 || MINUTES > 0)) {
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
            if (beadCount() > before) session.noteProgress('inventory', `bead ${beadsGathered()}/${TARGET}`);
        }
        sinceTrip++;
    } catch (error) {
        // A thrown hunt/bank step is a bad lap, not the end of the run.
        log(`loop error: ${(error as Error).message} — continuing (not exiting)`);
        await sleep(15_000);
    }
}

log(`finished with ${beadsGathered()} bead(s) after ${trips} trip(s)`);
reportRate();
await bankTrip().catch((error: unknown) => log(`final bank trip failed: ${(error as Error).message}`));
const reached = TARGET > 0 && beadsGathered() >= TARGET;
session.stop(reached ? 'done' : 'stopped', `harvester: ${beadsGathered()} bead(s), ${kills} kills`, { restartable: false });
await parkForever(`harvester loop finished (${beadsGathered()} bead(s), ${trips} trip(s))`);
