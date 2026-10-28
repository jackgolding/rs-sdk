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
import { ticksToMs, untilTicks } from './ticks';

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

export const inManor = (q: Quest) => pos(q).z < 6400 && (pos(q).level > 0 || inBox(pos(q), MANOR_BOX) || inBox(pos(q), WAREHOUSE_BOX));
const inMaze = (q: Quest) => pos(q).z > 9000;

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

/** Out of the manor (any floor, the nook, the closet, the maze) through the east wing. */
export async function leaveManor(q: Quest): Promise<void> {
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
 * quest_haunted.rs2: A=0 … F=5). All are up after the up-ladder.
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
type Box = { x0: number; x1: number; z0: number; z1: number };

/** Rooms by the wiki's numbers; 7 (ladder) and 8 are one open floor, as are 1 and 4. */
const ROOM: Record<string, Box> = {
    r1: { x0: 3104, x1: 3113, z0: 9762, z1: 9768 },
    r2: { x0: 3099, x1: 3106, z0: 9762, z1: 9768 },
    r3: { x0: 3094, x1: 3100, z0: 9762, z1: 9768 },
    r4: { x0: 3104, x1: 3114, z0: 9757, z1: 9764 },
    r5: { x0: 3099, x1: 3106, z0: 9757, z1: 9764 },
    r6: { x0: 3093, x1: 3101, z0: 9757, z1: 9764 },
    r8: { x0: 3099, x1: 3106, z0: 9752, z1: 9759 },
    r9: { x0: 3088, x1: 3101, z0: 9752, z1: 9758 },
};

/** A door, a tile beside it on the side we come from, and the room on the far side. */
interface Crossing {
    name: string;
    door: Tile;
    from: Tile;
    to: Box;
}
const cross = (name: string, door: Tile, from: Tile, to: Box): Crossing => ({ name, door, from, to });
const D1 = { x: 3108, z: 9758 }; // 4to7
const D2 = { x: 3105, z: 9760 }; // 4to5
const D3 = { x: 3102, z: 9758 }; // 5to8
const D4 = { x: 3100, z: 9760 }; // 5to6
const D5 = { x: 3097, z: 9763 }; // 3to6
const D6 = { x: 3100, z: 9765 }; // 2to3
const D7 = { x: 3105, z: 9765 }; // 1to2
const D8 = { x: 3102, z: 9763 }; // 2to5
const D9 = { x: 3100, z: 9755 }; // 8to9

/**
 * One solution, re-derived from the door rules (start all up):
 * A,B down → 4to7; D down → 4to5, 5to8; A,B up → 5to8, 5to6, 3to6; E,F down →
 * 2to3, 1to2; C down → 1to2, 2to3; E up → 2to3, 2to5, 5to8 (its second clause),
 * 8to9 (E up, F down) → the can, and back out through 8to9.
 */
type Step = { lever: Lever; down: boolean } | { door: Crossing } | { walk: Tile };
const SOLUTION: Step[] = [
    { lever: 'A', down: true },
    { lever: 'B', down: true },
    { door: cross('4to7', D1, { x: 3110, z: 9758 }, ROOM.r4!) },
    { lever: 'D', down: true },
    { door: cross('4to5', D2, { x: 3107, z: 9760 }, ROOM.r5!) },
    { door: cross('5to8', D3, { x: 3102, z: 9760 }, ROOM.r8!) },
    { lever: 'A', down: false },
    { lever: 'B', down: false },
    { door: cross('8to5', D3, { x: 3102, z: 9756 }, ROOM.r5!) },
    { door: cross('5to6', D4, { x: 3102, z: 9760 }, ROOM.r6!) },
    { door: cross('6to3', D5, { x: 3097, z: 9761 }, ROOM.r3!) },
    { lever: 'E', down: true },
    { lever: 'F', down: true },
    { door: cross('3to2', D6, { x: 3098, z: 9765 }, ROOM.r2!) },
    { door: cross('2to1', D7, { x: 3103, z: 9765 }, ROOM.r1!) },
    { lever: 'C', down: true },
    { door: cross('1to2', D7, { x: 3107, z: 9765 }, ROOM.r2!) },
    { door: cross('2to3', D6, { x: 3102, z: 9765 }, ROOM.r3!) },
    { lever: 'E', down: false },
    { door: cross('3to2', D6, { x: 3098, z: 9765 }, ROOM.r2!) },
    { door: cross('2to5', D8, { x: 3102, z: 9765 }, ROOM.r5!) },
    { door: cross('5to8', D3, { x: 3102, z: 9760 }, ROOM.r8!) },
    { door: cross('8to9', D9, { x: 3102, z: 9755 }, ROOM.r9!) },
    { walk: OIL_CAN_SPAWN },
];

/** Lever positions read this descent (the up-ladder resets them all to up). */
const leverDown = new Map<Lever, boolean>();

async function setLever(q: Quest, name: Lever, down: boolean): Promise<void> {
    const at = LEVERS[name];
    for (let i = 0; i < 4; i++) {
        if (leverDown.get(name) === down) return;
        if (Math.max(Math.abs(pos(q).x - at.x), Math.abs(pos(q).z - at.z)) > 2) await walk(q, at, 1);
        const lever = await locAt(q, at);
        if (!lever) throw new Error(`maze: lever ${name} not in view from (${pos(q).x},${pos(q).z})`);
        const since = cursor(q);
        // Unknown: Inspect ("The lever is up/down."); known and wrong: Pull ("You pull lever A down.").
        const known = leverDown.has(name);
        await q.bot.interactLoc(lever, known ? /pull/i : /inspect/i);
        const re = known ? /you pull lever \w+ (up|down)/i : /the lever is (up|down)/i;
        await untilTicks(q.sdk, () => linesSince(q, since).some((t) => re.test(t)), 12);
        const line = linesSince(q, since).filter((t) => re.test(t)).pop();
        if (!line) {
            q.log(`maze: lever ${name} ${known ? 'pull' : 'inspect'} gave no line`);
            leverDown.delete(name);
            continue;
        }
        leverDown.set(name, /down\.?\s*$/i.test(line));
        q.log(`maze: lever ${name} ${line}`);
    }
    if (leverDown.get(name) !== down) throw new Error(`maze: lever ${name} never went ${down ? 'down' : 'up'}`);
}

async function crossDoor(q: Quest, c: Crossing): Promise<void> {
    for (let i = 0; i < 3 && !inBox(pos(q), c.to); i++) {
        await walk(q, c.from, 0);
        const door = await locAt(q, c.door, /^open$/i);
        if (!door) throw new Error(`maze: door ${c.name} not at (${c.door.x},${c.door.z}) from (${pos(q).x},${pos(q).z})`);
        const since = cursor(q);
        await q.bot.interactLoc(door, /^open$/i);
        await untilTicks(q.sdk, () => inBox(pos(q), c.to) || linesSince(q, since).some((t) => /door is locked/i.test(t)), 8);
        if (linesSince(q, since).some((t) => /door is locked/i.test(t))) {
            throw new Error(`maze: door ${c.name} locked (levers ${JSON.stringify(Object.fromEntries(leverDown))})`);
        }
    }
    if (!inBox(pos(q), c.to)) throw new Error(`maze: not through ${c.name} (at ${pos(q).x},${pos(q).z})`);
}

/** Up the maze ladder (resets the levers) and out of the nook. */
async function leaveMaze(q: Quest): Promise<void> {
    for (let i = 0; i < 3 && inMaze(q); i++) {
        if (Math.hypot(pos(q).x - MAZE_LADDER.x, pos(q).z - MAZE_LADDER.z) > 3) await walk(q, { x: MAZE_LADDER.x - 1, z: MAZE_LADDER.z }, 1);
        const ladder = await locAt(q, MAZE_LADDER, /climb-up/i);
        if (!ladder) throw new Error(`maze: no up ladder from (${pos(q).x},${pos(q).z})`);
        await q.bot.interactLoc(ladder, /climb-up/i);
        await untilTicks(q.sdk, () => !inMaze(q), 10);
    }
    if (inMaze(q)) throw new Error('could not climb out of the maze');
    leverDown.clear();
    await leaveNook(q);
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
        leverDown.clear();
    }
    let done = 0;
    for (const step of SOLUTION) {
        if ('lever' in step) await setLever(q, step.lever, step.down);
        else if ('door' in step) await crossDoor(q, step.door);
        else await walk(q, step.walk, 1);
        done++;
    }
    q.log(`maze: ${done} steps to the oil can`);
    await pickUp(q, /^oil can$/i, OIL_CAN_SPAWN);
    // 8to9 still holds (E up, F down); room 8 is open floor to the ladder.
    await crossDoor(q, cross('9to8', D9, { x: 3098, z: 9755 }, ROOM.r8!));
    await leaveMaze(q);
}
