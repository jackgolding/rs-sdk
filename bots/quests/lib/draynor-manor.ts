/**
 * Draynor Manor — getting in and out, and the three machine parts Ernest the
 * Chicken needs (rubber tube, pressure gauge, oil can). None of them checks the
 * quest stage (quest_haunted.rs2), so lib/sources.ts produces them in prepare.
 *
 * Map facts (quest-lab-locfind / objfind, and the old ernest-chicken.ts runs):
 *   - front door (3108,3353)/(3109,3353) opens from the south only ("The doors
 *     won't open" from inside); out is the east wing: door (3123,3360)
 *   - compost heap (3084,3360) west of the manor: spade on it gives the Key
 *   - closet door (3107,3367): the Key teleports you east through it, onto the
 *     rubber tube's spawn (3111,3367); out the same way
 *   - poison spawn (3097,3366) ground floor; fish food (3108,3356) plane 1;
 *     spade spawn (3120,3359)
 *   - fountain (3087,3334) south-west of the manor
 *   - basement: secret bookcase (3097,3358) from its east face teleports to
 *     (3096,3358); ladder (3092,3362) down to the lever maze (3116,9754); the
 *     ladder up (3117,9754) lands back in that nook and resets every lever;
 *     the nook's lever (3096,3357) teleports you east out of it
 */
import type { NearbyLoc } from '../../../sdk/types';
import type { Quest } from './run-quest';
import { tickNow, ticksToMs, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
}

const FRONT_DOOR_OUTSIDE = { x: 3108, z: 3351 };
const MANOR_HALL = { x: 3108, z: 3360 };
/** Inside the east wing by its door (3123,3360); the door teleports you to (3123,3361). */
const EAST_DOOR = { x: 3123, z: 3360 };
const EAST_WING_INSIDE = { x: 3121, z: 3358 };
const OUTSIDE_EAST = { x: 3124, z: 3364 };
const COMPOST = { x: 3084, z: 3360 };
const CLOSET_DOOR = { x: 3107, z: 3367 };
const SPADE_SPAWN = { x: 3120, z: 3359 };
const POISON_SPAWN = { x: 3097, z: 3366 };
const FISH_FOOD_SPAWN = { x: 3108, z: 3356 };
const FOUNTAIN = { x: 3087, z: 3334 };
const BOOKCASE_EAST_FACE = { x: 3098, z: 3358 };
const NOOK_LADDER = { x: 3092, z: 3362 };
const NOOK_LEVER = { x: 3096, z: 3357 };
const MAZE_LADDER = { x: 3117, z: 9754 };
const OIL_CAN_SPAWN = { x: 3092, z: 9755 };

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const inBox = (p: Tile, b: { x0: number; x1: number; z0: number; z1: number }) => p.x >= b.x0 && p.x <= b.x1 && p.z >= b.z0 && p.z <= b.z1;
/** The house; its east-wing warehouse (x 3120-3122) only reaches z 3360 — north of that is the courtyard. */
const MANOR_BOX = { x0: 3091, x1: 3119, z0: 3354, z1: 3374 };
const WAREHOUSE_BOX = { x0: 3120, x1: 3122, z0: 3354, z1: 3360 };
const NOOK_BOX = { x0: 3088, x1: 3096, z0: 3354, z1: 3366 };
const CLOSET_BOX = { x0: 3108, x1: 3114, z0: 3365, z1: 3369 };

/** A plane-0 tile inside the manor's ground floor: house, warehouse or the bookcase nook. */
export const onManorGround = (t: Tile & { level?: number }) =>
    (t.level ?? 0) === 0 && t.z < 6400 && (inBox(t, MANOR_BOX) || inBox(t, WAREHOUSE_BOX) || inBox(t, NOOK_BOX));
export const inManor = (q: Quest) => pos(q).z < 6400 && (pos(q).level > 0 || inBox(pos(q), MANOR_BOX) || inBox(pos(q), WAREHOUSE_BOX));
/**
 * The vampire crypt (Vampire Slayer): stairs.rs2 cryptstairsdown (3115,3357)
 * Walk-Down lands at (3077,9771); cryptstairsup (3077,9768) Walk-Up lands at
 * (3115,3356) in the manor. West of the lever maze (x >= 3088), so disjoint from it.
 */
const CRYPT_STAIRS_DOWN = { x: 3115, z: 3357 };
const CRYPT_STAIRS_UP = { x: 3077, z: 9768 };
const CRYPT_BOX = { x0: 3066, x1: 3087, z0: 9758, z1: 9792 };
export const inCrypt = (q: Quest) => inBox(pos(q), CRYPT_BOX);
const inMaze = (q: Quest) => inBox(pos(q), MAZE_BOX);
/** True when the player stands in the basement lever maze (run-quest's goTo escapes it first). */
export const inLeverMaze = inMaze;

/** Newest game-message cursor: only lines after it answer an action sent now. */
function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function linesSince(q: Quest, since: number): string[] {
    return (q.sdk.getState()?.gameMessages ?? []).filter((m) => (m.observationId ?? m.tick) > since).map((m) => m.text);
}

/** The loc at an exact tile (names repeat: every manor door is "Door"). */
async function locAt(q: Quest, tile: Tile, option?: RegExp): Promise<NearbyLoc | undefined> {
    const locs = await q.sdk.scanNearbyLocs(15).catch(() => q.sdk.getNearbyLocs() ?? []);
    return locs.find((l) => l.x === tile.x && l.z === tile.z && (!option || l.options?.some((o) => option.test(o))));
}

async function walk(q: Quest, tile: Tile, tolerance = 1): Promise<boolean> {
    const res = await q.bot.walkTo(tile.x, tile.z, tolerance);
    if (!res.success) q.log(`manor walk to (${tile.x},${tile.z}) from (${pos(q).x},${pos(q).z}): ${res.message}`);
    return res.success;
}

// ── in and out

/** Into the ground floor through the front door (from outside only). */
export async function enterManor(q: Quest): Promise<void> {
    if (inManor(q)) return;
    await q.goTo(FRONT_DOOR_OUTSIDE, 1);
    for (let i = 0; i < 3 && !inManor(q); i++) {
        const door = await locAt(q, { x: 3108, z: 3353 }, /^open$/i);
        if (door) await q.bot.interactLoc(door, /^open$/i);
        await untilTicks(q.sdk, () => inManor(q), 6);
        if (!inManor(q)) await walk(q, MANOR_HALL, 1);
    }
    if (!inManor(q)) throw new Error(`could not get into Draynor Manor from (${pos(q).x},${pos(q).z})`);
    // Into the hall by the staircase (3108,3363): from the doormat climbTo finds no stairs.
    await walk(q, MANOR_HALL, 1);
    q.log(`in Draynor Manor at (${pos(q).x},${pos(q).z})`);
}

/** Out of the nook west of the secret bookcase: its lever teleports you east. */
async function leaveNook(q: Quest): Promise<void> {
    for (let i = 0; i < 3 && inBox(pos(q), NOOK_BOX) && pos(q).level === 0; i++) {
        const lever = await locAt(q, NOOK_LEVER, /pull/i);
        if (!lever) throw new Error(`no secret-room lever near (${pos(q).x},${pos(q).z})`);
        await q.bot.interactLoc(lever, /pull/i);
        await untilTicks(q.sdk, () => !inBox(pos(q), NOOK_BOX), 8);
    }
    if (inBox(pos(q), NOOK_BOX)) throw new Error(`still in the secret room at (${pos(q).x},${pos(q).z})`);
}

/** Out of the closet (east of its door): the key opens it, then walk west through. */
async function leaveCloset(q: Quest): Promise<void> {
    for (let i = 0; i < 3 && inBox(pos(q), CLOSET_BOX) && pos(q).level === 0; i++) {
        const door = await locAt(q, CLOSET_DOOR);
        const key = q.sdk.findInventoryItem(/^key$/i);
        if (door && key) await q.bot.useItemOnLoc(key, door, { timeout: ticksToMs(15) });
        await q.sdk.sendWalk(CLOSET_DOOR.x - 1, CLOSET_DOOR.z, true).catch(() => undefined);
        await untilTicks(q.sdk, () => !inBox(pos(q), CLOSET_BOX), 6);
    }
    if (inBox(pos(q), CLOSET_BOX)) throw new Error(`still in the closet at (${pos(q).x},${pos(q).z})`);
}

/** Down the crypt stairs from inside the manor (enters it first). */
export async function enterCrypt(q: Quest): Promise<void> {
    if (inCrypt(q)) return;
    await enterManor(q);
    if (pos(q).level !== 0) await q.climbTo(0);
    for (let i = 0; i < 3 && !inCrypt(q); i++) {
        await walk(q, { x: CRYPT_STAIRS_DOWN.x, z: CRYPT_STAIRS_DOWN.z - 1 }, 1);
        const stairs = await locAt(q, CRYPT_STAIRS_DOWN, /walk-down/i);
        if (!stairs) {
            q.log(`crypt: no Walk-Down stairs at (${CRYPT_STAIRS_DOWN.x},${CRYPT_STAIRS_DOWN.z}) from (${pos(q).x},${pos(q).z})`);
            await q.sdk.waitForTicks(2);
            continue;
        }
        await q.bot.interactLoc(stairs, /walk-down/i);
        await untilTicks(q.sdk, () => inCrypt(q), 10);
    }
    if (!inCrypt(q)) throw new Error(`could not walk down to the crypt from (${pos(q).x},${pos(q).z})`);
    q.log(`in the crypt at (${pos(q).x},${pos(q).z})`);
}

/** Up the crypt stairs into the manor's ground floor. */
export async function leaveCrypt(q: Quest): Promise<void> {
    for (let i = 0; i < 3 && inCrypt(q); i++) {
        const stairs = await locAt(q, CRYPT_STAIRS_UP, /walk-up/i);
        if (!stairs) throw new Error(`crypt: no Walk-Up stairs from (${pos(q).x},${pos(q).z})`);
        await q.bot.interactLoc(stairs, /walk-up/i);
        await untilTicks(q.sdk, () => !inCrypt(q), 10);
    }
    if (inCrypt(q)) throw new Error('could not walk up out of the crypt');
}

/** Out of the manor (any floor, the nook, the closet, the maze, the crypt) through the east wing. */
export async function leaveManor(q: Quest): Promise<void> {
    if (inCrypt(q)) await leaveCrypt(q);
    if (inMaze(q)) await leaveMaze(q);
    if (!inManor(q)) return;
    if (pos(q).level !== 0) await q.climbTo(0);
    await leaveNook(q);
    await leaveCloset(q);
    for (let i = 0; i < 3 && inManor(q); i++) {
        await walk(q, EAST_WING_INSIDE, 1);
        const door = await locAt(q, EAST_DOOR, /^open$/i);
        if (door) await q.bot.interactLoc(door, /^open$/i);
        await untilTicks(q.sdk, () => !inManor(q), 6);
        if (!inManor(q)) await walk(q, OUTSIDE_EAST, 2);
    }
    if (inManor(q)) throw new Error(`could not leave Draynor Manor from (${pos(q).x},${pos(q).z})`);
    q.log(`out of Draynor Manor at (${pos(q).x},${pos(q).z})`);
}

/** Pick up `name` at its spawn tile (respawns are quick), waiting for it to land. */
async function pickUp(q: Quest, name: RegExp, tile: Tile): Promise<void> {
    for (let i = 0; i < 20 && q.count(name) === 0; i++) {
        await q.sdk.scanGroundItems(10).catch(() => undefined);
        const item = (q.sdk.getState()?.groundItems ?? []).find((g) => name.test(g.name) && g.x === tile.x && g.z === tile.z) ?? q.sdk.findGroundItem(name);
        if (!item) {
            if (i === 0) q.log(`waiting for ${name} to spawn at (${tile.x},${tile.z})`);
            await q.sdk.waitForTicks(5);
            continue;
        }
        await q.bot.pickupItem(item);
        await untilTicks(q.sdk, () => q.count(name) > 0, 10);
    }
    if (q.count(name) === 0) throw new Error(`no ${name} at (${tile.x},${tile.z})`);
}

// ── the parts

/** The spade spawn in the east wing. */
export async function manorSpade(q: Quest): Promise<void> {
    await enterManor(q);
    await walk(q, SPADE_SPAWN, 1);
    await pickUp(q, /^spade$/i, SPADE_SPAWN);
}

/** Spade on the compost heap → Key → closet → rubber tube. */
export async function rubberTube(q: Quest): Promise<void> {
    if (q.count(/^key$/i) === 0) {
        await q.ensure('spade', 1);
        await leaveManor(q);
        await q.goTo({ x: COMPOST.x + 2, z: COMPOST.z }, 1);
        for (let i = 0; i < 3 && q.count(/^key$/i) === 0; i++) {
            await q.bot.useItemOnLoc(/^spade$/i, /^compost heap$/i, { timeout: ticksToMs(20) });
            await untilTicks(q.sdk, () => q.count(/^key$/i) > 0, 8);
        }
        if (q.count(/^key$/i) === 0) throw new Error('dug the compost heap but found no key');
    }
    await enterManor(q);
    await walk(q, { x: CLOSET_DOOR.x, z: CLOSET_DOOR.z - 1 }, 0);
    for (let i = 0; i < 3 && !inBox(pos(q), CLOSET_BOX); i++) {
        const door = await locAt(q, CLOSET_DOOR);
        if (!door) throw new Error(`no closet door near (${pos(q).x},${pos(q).z})`);
        await q.bot.useItemOnLoc(/^key$/i, door, { timeout: ticksToMs(20) });
        await untilTicks(q.sdk, () => inBox(pos(q), CLOSET_BOX), 6);
    }
    if (!inBox(pos(q), CLOSET_BOX)) throw new Error(`the key did not take us through the closet door (at ${pos(q).x},${pos(q).z})`);
    await pickUp(q, /^rubber tube$/i, { x: 3111, z: 3367 });
    await leaveCloset(q);
}

/** Poison + fish food → poisoned fish food in the fountain → search it for the gauge. */
export async function pressureGauge(q: Quest): Promise<void> {
    if (q.count(/^poisoned fish food$/i) === 0) {
        await enterManor(q);
        if (q.count(/^poison$/i) === 0) {
            await walk(q, POISON_SPAWN, 1);
            await pickUp(q, /^poison$/i, POISON_SPAWN);
        }
        if (q.count(/^fish food$/i) === 0) {
            await q.climbTo(1);
            await walk(q, FISH_FOOD_SPAWN, 1);
            await pickUp(q, /^fish food$/i, FISH_FOOD_SPAWN);
            await q.climbTo(0);
        }
        const a = q.sdk.findInventoryItem(/^poison$/i);
        const b = q.sdk.findInventoryItem(/^fish food$/i);
        if (a && b) await q.sdk.sendUseItemOnItem(a.slot, b.slot);
        await untilTicks(q.sdk, () => q.count(/^poisoned fish food$/i) > 0, 6);
        if (q.count(/^poisoned fish food$/i) === 0) throw new Error('poison on fish food made nothing');
    }
    await leaveManor(q);
    await q.goTo({ x: FOUNTAIN.x, z: FOUNTAIN.z + 3 }, 1);
    const poured = cursor(q);
    await q.bot.useItemOnLoc(/^poisoned fish food$/i, /^fountain$/i, { timeout: ticksToMs(20) });
    // The piranhas die on server delays after the pour; the flag is set with the last line.
    if (!(await untilTicks(q.sdk, () => linesSince(q, poured).some((t) => /then die and float/i.test(t)), 15))) {
        q.log('fountain: no "then die" line after the pour');
    }
    for (let i = 0; i < 4 && q.count(/^pressure gauge$/i) === 0; i++) {
        await q.bot.interactLoc(/^fountain$/i, /search/i);
        await untilTicks(q.sdk, () => q.count(/^pressure gauge$/i) > 0 || !!q.sdk.getState()?.dialog?.isOpen, 8);
        await q.bot.dismissBlockingUI();
    }
    if (q.count(/^pressure gauge$/i) === 0) throw new Error('searched the poisoned fountain but found no pressure gauge');
}

// ── the oil can: the basement lever maze

/**
 * Maze levers; a lever's bit set (down) is what doors test (_haunted_door in
 * quest_haunted.rs2: A=0 … F=5). The up-ladder resets them all to up; nothing
 * else does, so a run that starts down here knows none of them.
 */
const LEVERS = {
    A: { x: 3108, z: 9745 },
    B: { x: 3118, z: 9752 },
    C: { x: 3112, z: 9760 },
    D: { x: 3108, z: 9767 },
    E: { x: 3097, z: 9767 },
    F: { x: 3096, z: 9765 },
} as const;
type Lever = keyof typeof LEVERS;
const LEVER_BIT: Record<Lever, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };
type Box = { x0: number; x1: number; z0: number; z1: number };

/**
 * Rooms, flood-filled from the walls of m48_152 (doors closed). The wiki's 1/4
 * and 7/8 are one floor each here. r78 is not a rectangle: everything at
 * z <= 9757, x >= 3100 in the maze is it (the ladder, levers A and B).
 */
type Room = 'r14' | 'r2' | 'r3' | 'r5' | 'r6' | 'r78' | 'r9';
const ROOMS: Record<Room, Box> = {
    r14: { x0: 3105, x1: 3112, z0: 9758, z1: 9767 },
    r2: { x0: 3100, x1: 3104, z0: 9763, z1: 9767 },
    r3: { x0: 3096, x1: 3099, z0: 9763, z1: 9767 },
    r5: { x0: 3100, x1: 3104, z0: 9758, z1: 9762 },
    r6: { x0: 3096, x1: 3099, z0: 9758, z1: 9762 },
    r78: { x0: 3100, x1: 3120, z0: 9740, z1: 9757 },
    r9: { x0: 3088, x1: 3099, z0: 9750, z1: 9757 },
};
const LEVER_ROOM: Record<Lever, Room> = { A: 'r78', B: 'r78', C: 'r14', D: 'r14', E: 'r3', F: 'r3' };
/** The whole maze: underground in here and walkTo cannot leave (closed doors, one ladder). */
const MAZE_BOX: Box = { x0: 3088, x1: 3122, z0: 9738, z1: 9770 };
const roomOf = (t: Tile): Room | undefined => (Object.keys(ROOMS) as Room[]).find((r) => inBox(t, ROOMS[r]));

const on = (b: number, l: Lever) => ((b >> LEVER_BIT[l]) & 1) === 1;
/** A maze door: its loc tile (the `a` side) and the tiles either side of it, with the rule that unlocks it. */
interface MazeDoor {
    name: string;
    a: Room;
    aTile: Tile;
    b: Room;
    bTile: Tile;
    open: (bits: number) => boolean;
}
const DOORS: MazeDoor[] = [
    { name: '1to2', a: 'r14', aTile: { x: 3105, z: 9765 }, b: 'r2', bTile: { x: 3104, z: 9765 }, open: (b) => !on(b, 'A') && !on(b, 'B') && on(b, 'D') && on(b, 'E') && on(b, 'F') },
    { name: '2to3', a: 'r2', aTile: { x: 3100, z: 9765 }, b: 'r3', bTile: { x: 3099, z: 9765 }, open: (b) => !on(b, 'B') && on(b, 'D') && on(b, 'F') },
    { name: '2to5', a: 'r2', aTile: { x: 3102, z: 9763 }, b: 'r5', bTile: { x: 3102, z: 9762 }, open: (b) => !on(b, 'A') && !on(b, 'B') && on(b, 'C') && on(b, 'D') && !on(b, 'E') && on(b, 'F') },
    { name: '3to6', a: 'r3', aTile: { x: 3097, z: 9763 }, b: 'r6', bTile: { x: 3097, z: 9762 }, open: (b) => !on(b, 'B') && on(b, 'D') && !on(b, 'F') },
    { name: '4to5', a: 'r14', aTile: { x: 3105, z: 9760 }, b: 'r5', bTile: { x: 3104, z: 9760 }, open: (b) => on(b, 'A') && on(b, 'B') && on(b, 'D') },
    { name: '4to7', a: 'r14', aTile: { x: 3108, z: 9758 }, b: 'r78', bTile: { x: 3108, z: 9757 }, open: (b) => on(b, 'A') && on(b, 'B') && !on(b, 'C') && !on(b, 'D') && !on(b, 'E') && !on(b, 'F') },
    { name: '5to6', a: 'r5', aTile: { x: 3100, z: 9760 }, b: 'r6', bTile: { x: 3099, z: 9760 }, open: (b) => on(b, 'D') },
    {
        name: '5to8',
        a: 'r5',
        aTile: { x: 3102, z: 9758 },
        b: 'r78',
        bTile: { x: 3102, z: 9757 },
        open: (b) => (!on(b, 'C') && on(b, 'D')) || (!on(b, 'A') && !on(b, 'B') && on(b, 'C') && on(b, 'D') && !on(b, 'E') && on(b, 'F')),
    },
    { name: '8to9', a: 'r78', aTile: { x: 3100, z: 9755 }, b: 'r9', bTile: { x: 3099, z: 9755 }, open: (b) => !on(b, 'E') && on(b, 'F') },
];

type Move = { lever: Lever } | { door: MazeDoor };

/** Shortest lever/door plan from (room, bits) to `goal`, assuming `bits` are the real lever states. */
function planMaze(room: Room, bits: number, goal: Room): Move[] | null {
    const key = (r: Room, b: number) => `${r}:${b}`;
    const prev = new Map<string, { from: string; move: Move } | null>([[key(room, bits), null]]);
    const queue: Array<[Room, number]> = [[room, bits]];
    while (queue.length) {
        const [r, b] = queue.shift()!;
        if (r === goal) {
            const moves: Move[] = [];
            for (let k = key(r, b); prev.get(k); k = prev.get(k)!.from) moves.unshift(prev.get(k)!.move);
            return moves;
        }
        const next: Array<[Room, number, Move]> = [];
        for (const l of Object.keys(LEVERS) as Lever[]) if (LEVER_ROOM[l] === r) next.push([r, b ^ (1 << LEVER_BIT[l]), { lever: l }]);
        for (const d of DOORS) {
            if (!d.open(b)) continue;
            if (d.a === r) next.push([d.b, b, { door: d }]);
            else if (d.b === r) next.push([d.a, b, { door: d }]);
        }
        for (const [nr, nb, move] of next) {
            const k = key(nr, nb);
            if (prev.has(k)) continue;
            prev.set(k, { from: key(r, b), move });
            queue.push([nr, nb]);
        }
    }
    return null;
}

/** Lever states consistent with everything seen this descent (bitmasks). Reset by the up-ladder. */
let candidates: number[] = [...Array(64).keys()];
const leverKnown = (l: Lever) => new Set(candidates.map((b) => on(b, l))).size === 1;
const describeLevers = () =>
    (Object.keys(LEVERS) as Lever[]).map((l) => (leverKnown(l) ? `${l}${on(candidates[0]!, l) ? 'v' : '^'}` : `${l}?`)).join(' ');

/** Inspect (unknown) or pull a lever in our room; the game line tells its state either way. */
async function useLever(q: Quest, l: Lever, pull: boolean): Promise<void> {
    for (let i = 0; i < 3; i++) {
        const lever = await locAt(q, LEVERS[l]);
        if (!lever) throw new Error(`maze: lever ${l} not in view from (${pos(q).x},${pos(q).z})`);
        const since = cursor(q);
        await q.bot.interactLoc(lever, pull ? /pull/i : /inspect/i);
        const re = pull ? /you pull lever \w+ (up|down)/i : /the lever is (up|down)/i;
        await untilTicks(q.sdk, () => linesSince(q, since).some((t) => re.test(t)), 12);
        const line = linesSince(q, since).filter((t) => re.test(t)).pop();
        if (!line) {
            q.log(`maze: lever ${l} ${pull ? 'pull' : 'inspect'} gave no line`);
            continue;
        }
        const down = /down\.?\s*$/i.test(line);
        q.log(`maze: lever ${l}: ${line}`);
        if (pull) candidates = candidates.map((b) => b ^ (1 << LEVER_BIT[l]));
        candidates = candidates.filter((b) => on(b, l) === down);
        return;
    }
    throw new Error(`maze: lever ${l} gave no reply`);
}

/**
 * Through a maze door. Up to 5 fleet bots share these doors: an opened one is an
 * inviswall (no Open op) for 3 ticks, so a missing door is waited out, never an error.
 * Returns whether the door let us through (and so what it says about the levers).
 */
async function tryDoor(q: Quest, d: MazeDoor, from: Room): Promise<'open' | 'locked' | 'busy'> {
    const to = from === d.a ? d.b : d.a;
    const side = from === d.a ? d.aTile : d.bTile;
    for (let i = 0; i < 12; i++) {
        if (roomOf(pos(q)) === to) return 'open';
        if (pos(q).x !== side.x || pos(q).z !== side.z) await walk(q, side, 0);
        const door = await locAt(q, d.aTile, /^open$/i);
        if (!door) {
            await q.sdk.waitForTicks(2);
            continue;
        }
        const since = cursor(q);
        await q.bot.interactLoc(door, /^open$/i);
        await untilTicks(q.sdk, () => roomOf(pos(q)) === to || linesSince(q, since).some((t) => /door is locked/i.test(t)), 8);
        if (roomOf(pos(q)) === to) return 'open';
        if (linesSince(q, since).some((t) => /door is locked/i.test(t))) return 'locked';
    }
    return 'busy';
}

/**
 * Walk the maze to `goal` from any room with any lever states: inspect the levers
 * of each room we are in, plan on a state still consistent with what has been
 * seen, and let every door outcome (through, or "This door is locked.") cut the
 * candidates down. Each wrong guess removes at least the guessed state.
 */
async function mazeTo(q: Quest, goal: Room): Promise<void> {
    const t0 = tickNow(q.sdk);
    for (let step = 0; step < 80; step++) {
        let room = roomOf(pos(q));
        if (!room) {
            await q.sdk.waitForTicks(2);
            room = roomOf(pos(q));
            if (!room) throw new Error(`maze: (${pos(q).x},${pos(q).z}) is in no known room`);
        }
        if (room === goal) {
            q.log(`maze: in ${goal} after ${step} steps (levers ${describeLevers()}, ${tickNow(q.sdk) - t0}t)`);
            return;
        }
        for (const l of Object.keys(LEVERS) as Lever[]) if (LEVER_ROOM[l] === room && !leverKnown(l)) await useLever(q, l, false);
        if (!candidates.length) {
            q.log('maze: no lever state fits what was seen — starting over');
            candidates = [...Array(64).keys()];
            continue;
        }
        // A room without levers has no way out under some states (r5 with D up), but we
        // walked in through a door that still opens: plan on a state that has a way out.
        let plan: Move[] | null = null;
        for (const b of candidates) if ((plan = planMaze(room, b, goal))?.length) break;
        if (!plan?.length) throw new Error(`maze: no plan from ${room} to ${goal} (levers ${describeLevers()})`);
        const move = plan[0]!;
        if ('lever' in move) {
            await useLever(q, move.lever, true);
            continue;
        }
        const d = move.door;
        const res = await tryDoor(q, d, room);
        q.log(`maze: ${room} door ${d.name} ${res} (levers ${describeLevers()})`);
        if (res === 'open') candidates = candidates.filter((b) => d.open(b));
        else if (res === 'locked') candidates = candidates.filter((b) => !d.open(b));
    }
    throw new Error(`maze: not in ${goal} after 80 steps, at (${pos(q).x},${pos(q).z}) (levers ${describeLevers()})`);
}

/** Up the maze ladder (resets the levers) and out of the nook. */
async function leaveMaze(q: Quest): Promise<void> {
    if (inMaze(q)) await mazeTo(q, 'r78');
    for (let i = 0; i < 3 && inMaze(q); i++) {
        if (Math.hypot(pos(q).x - MAZE_LADDER.x, pos(q).z - MAZE_LADDER.z) > 3) await walk(q, { x: MAZE_LADDER.x - 1, z: MAZE_LADDER.z }, 1);
        const ladder = await locAt(q, MAZE_LADDER, /climb-up/i);
        if (!ladder) throw new Error(`maze: no up ladder from (${pos(q).x},${pos(q).z})`);
        await q.bot.interactLoc(ladder, /climb-up/i);
        await untilTicks(q.sdk, () => !inMaze(q), 10);
    }
    if (inMaze(q)) throw new Error('could not climb out of the maze');
    candidates = [0];
    await leaveNook(q);
}

/**
 * Out of the lever maze from any room and any lever states (a run that died in
 * it, or a resumed one), then out of the manor unless `dest` is inside it.
 * run-quest's goTo calls this before its generic underground climb, which
 * cannot reach the ladder past closed maze doors.
 */
export async function escapeMaze(q: Quest, dest?: Tile): Promise<void> {
    if (!inMaze(q)) return;
    q.log(`maze: escaping from (${pos(q).x},${pos(q).z})`);
    candidates = [...Array(64).keys()];
    await leaveMaze(q);
    if (!dest || !(inBox(dest, MANOR_BOX) || inBox(dest, NOOK_BOX))) await leaveManor(q);
}

/** Into the nook by the secret bookcase, down its ladder, through the maze to the can, and out. */
export async function oilCan(q: Quest): Promise<void> {
    if (!inMaze(q)) {
        await enterManor(q);
        if (!inBox(pos(q), NOOK_BOX)) {
            await walk(q, BOOKCASE_EAST_FACE, 0);
            for (let i = 0; i < 3 && !inBox(pos(q), NOOK_BOX); i++) {
                await q.bot.interactLoc(/^bookcase$/i, /search/i);
                await untilTicks(q.sdk, () => inBox(pos(q), NOOK_BOX), 8);
            }
            if (!inBox(pos(q), NOOK_BOX)) throw new Error(`the bookcase did not open at (${pos(q).x},${pos(q).z})`);
        }
        for (let i = 0; i < 3 && !inMaze(q); i++) {
            const ladder = await locAt(q, NOOK_LADDER, /climb-down/i);
            if (!ladder) throw new Error(`no basement ladder near (${pos(q).x},${pos(q).z})`);
            await q.bot.interactLoc(ladder, /climb-down/i);
            await untilTicks(q.sdk, () => inMaze(q), 10);
        }
        if (!inMaze(q)) throw new Error('could not climb down to the lever maze');
    }
    // Whatever the last visit left, the levers are only known once seen (A and B are by the ladder).
    candidates = [...Array(64).keys()];
    try {
        await mazeTo(q, 'r9');
        await pickUp(q, /^oil can$/i, OIL_CAN_SPAWN);
    } finally {
        // Never leave a run inside the maze: every later walk would start in a closed room.
        await leaveMaze(q);
    }
}
