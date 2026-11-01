/**
 * Out of Melzar's Maze from any room, any floor, the basement included.
 *
 * Content (quest_dragon/scripts/melzars_maze.rs2, maps m45_50 / m45_150, ladders.rs2):
 *   - the east door (2941,3248) only opens to the Maze key, from either side; its plain
 *     op is always "securely locked", so walkTo can never leave through it.
 *   - the coloured doors take their key from either side (it disintegrates); the rat
 *     (npc 748, entrance room) drops a red key on every death.
 *   - `funexit` doors (2938,3252; basement 2924,9654 / 2927,9649 / 2931,9640) open only
 *     from their own tile and put you on the far side.
 *   - every ladder lands on the tile you climbed from, one plane up/down (or z ±6400), so
 *     which side you stand on decides the room you arrive in.
 * Two keyless exits come out of that: the basement's west corridor ladder (2928,9658),
 * climbed from its north/west/east side, lands outside the maze's north wall; and the
 * ghost floor's north door (2926,3258) leads to a ladder (2925,3258) down to the outside.
 * Every room's next hop toward one of them is in HOPS (checked offline by flood-filling the
 * collision map with every maze door shut). The entrance room has neither: the Maze key
 * on the east door, else a red key from the rat through the red door (2926,3248) into
 * the ladder room down to the corridor.
 */
import type { BotActions } from '../../../sdk/actions';
import type { BotSDK } from '../../../sdk/index';
import { isFlagged } from '../../../sdk/pathfinding';
import { ticksToMs, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
}
interface Pos extends Tile {
    level: number;
}
type Log = (msg: string) => void;

const RAT = 748;
const MAZE_DOOR = { x: 2941, z: 3248 };

/** Every door in the maze as [level, x, z, angle]; sdk/pathfinding unmasks them, the flood shuts them again. */
const DOORS: Array<[number, number, number, number]> = [
    [0, 2941, 3248, 0], [0, 2926, 3244, 0], [0, 2926, 3248, 0], [0, 2926, 3253, 0], [0, 2928, 3242, 1], [0, 2938, 3252, 0],
    [1, 2924, 3242, 3], [1, 2925, 3243, 1], [1, 2926, 3258, 3], [1, 2935, 3256, 1], [1, 2938, 3244, 1], [1, 2928, 3246, 1],
    [1, 2931, 3247, 0], [1, 2931, 3250, 0], [1, 2931, 3253, 0], [1, 2931, 3256, 0],
    [2, 2926, 3258, 3], [2, 2934, 3252, 1], [2, 2924, 3249, 1], [2, 2928, 3249, 1], [2, 2931, 3249, 1], [2, 2936, 3256, 0],
    [0, 2931, 9643, 0], [0, 2929, 9652, 3], [0, 2936, 9655, 1], [0, 2924, 9654, 0], [0, 2927, 9649, 0], [0, 2931, 9640, 0],
];
const ANGLE_STEP: Array<[number, number]> = [[-1, 0], [0, 1], [1, 0], [0, -1]];
const shut = new Set<string>();
for (const [l, x, z, a] of DOORS) {
    const [dx, dz] = ANGLE_STEP[a]!;
    shut.add(`${l},${x},${z},${x + dx},${z + dz}`);
    shut.add(`${l},${x + dx},${z + dz},${x},${z}`);
}

type Hop =
    | { kind: 'ladder'; loc: Tile; stand: Tile; op: RegExp; label: string }
    | { kind: 'door'; loc: Tile; to: Tile; label: string }
    | { kind: 'oneway'; loc: Tile; label: string }
    | { kind: 'entrance' };

const up = /^climb-up$/i;
const down = /^climb-down$/i;
/** A tile in each room (the room is whatever the flood from it reaches) and its next hop out. */
const HOPS: Array<{ room: string; at: Pos; hop: Hop }> = [
    // ground floor
    { room: 'G1 red-door north', at: { x: 2927, z: 3256, level: 0 }, hop: { kind: 'ladder', loc: { x: 2928, z: 3256 }, stand: { x: 2927, z: 3256 }, op: up, label: 'up (2928,3256)' } },
    { room: 'G2 red-door south', at: { x: 2924, z: 3241, level: 0 }, hop: { kind: 'ladder', loc: { x: 2923, z: 3240 }, stand: { x: 2924, z: 3240 }, op: up, label: 'up (2923,3240)' } },
    { room: 'G3 red-door middle', at: { x: 2924, z: 3248, level: 0 }, hop: { kind: 'ladder', loc: { x: 2924, z: 3250 }, stand: { x: 2925, z: 3250 }, op: down, label: 'down to the basement (2924,3250)' } },
    { room: 'G4 south-west', at: { x: 2928, z: 3241, level: 0 }, hop: { kind: 'door', loc: { x: 2928, z: 3242 }, to: { x: 2928, z: 3244 }, label: 'door (2928,3242)' } },
    { room: 'G5 entrance', at: { x: 2930, z: 3250, level: 0 }, hop: { kind: 'entrance' } },
    { room: 'G6 south-east', at: { x: 2933, z: 3240, level: 0 }, hop: { kind: 'ladder', loc: { x: 2932, z: 3240 }, stand: { x: 2933, z: 3240 }, op: down, label: 'down to the basement (2932,3240)' } },
    { room: 'G7 chest-ladder', at: { x: 2939, z: 3255, level: 0 }, hop: { kind: 'oneway', loc: { x: 2938, z: 3252 }, label: 'exit door (2938,3252)' } },
    // first floor
    { room: 'U1 ghosts', at: { x: 2927, z: 3255, level: 1 }, hop: { kind: 'door', loc: { x: 2926, z: 3258 }, to: { x: 2927, z: 3258 }, label: 'north door (2926,3258)' } },
    { room: 'U2', at: { x: 2924, z: 3240, level: 1 }, hop: { kind: 'door', loc: { x: 2924, z: 3242 }, to: { x: 2924, z: 3242 }, label: 'door (2924,3242)' } },
    { room: 'U3', at: { x: 2929, z: 3241, level: 1 }, hop: { kind: 'door', loc: { x: 2925, z: 3243 }, to: { x: 2925, z: 3244 }, label: 'door (2925,3243)' } },
    { room: 'U4', at: { x: 2924, z: 3248, level: 1 }, hop: { kind: 'ladder', loc: { x: 2923, z: 3248 }, stand: { x: 2924, z: 3248 }, op: down, label: 'down (2923,3248)' } },
    { room: 'U5 north passage', at: { x: 2927, z: 3258, level: 1 }, hop: { kind: 'ladder', loc: { x: 2925, z: 3258 }, stand: { x: 2926, z: 3258 }, op: down, label: 'down and out (2925,3258)' } },
    { room: 'U6', at: { x: 2928, z: 3245, level: 1 }, hop: { kind: 'door', loc: { x: 2928, z: 3246 }, to: { x: 2928, z: 3248 }, label: 'door (2928,3246)' } },
    { room: 'U7', at: { x: 2935, z: 3242, level: 1 }, hop: { kind: 'door', loc: { x: 2938, z: 3244 }, to: { x: 2938, z: 3246 }, label: 'door (2938,3244)' } },
    { room: 'U8', at: { x: 2931, z: 3244, level: 1 }, hop: { kind: 'ladder', loc: { x: 2932, z: 3244 }, stand: { x: 2931, z: 3244 }, op: up, label: 'up (2932,3244)' } },
    { room: 'U9', at: { x: 2935, z: 3244, level: 1 }, hop: { kind: 'ladder', loc: { x: 2934, z: 3244 }, stand: { x: 2935, z: 3244 }, op: up, label: 'up (2934,3244)' } },
    { room: 'U10', at: { x: 2933, z: 3254, level: 1 }, hop: { kind: 'ladder', loc: { x: 2934, z: 3254 }, stand: { x: 2933, z: 3254 }, op: up, label: 'up (2934,3254)' } },
    { room: 'U11', at: { x: 2939, z: 3257, level: 1 }, hop: { kind: 'ladder', loc: { x: 2940, z: 3257 }, stand: { x: 2939, z: 3257 }, op: up, label: 'up (2940,3257)' } },
    { room: 'U12', at: { x: 2937, z: 3250, level: 1 }, hop: { kind: 'ladder', loc: { x: 2938, z: 3250 }, stand: { x: 2937, z: 3250 }, op: up, label: 'up (2938,3250)' } },
    { room: 'U13', at: { x: 2938, z: 3240, level: 1 }, hop: { kind: 'ladder', loc: { x: 2937, z: 3240 }, stand: { x: 2938, z: 3240 }, op: down, label: 'down (2937,3240)' } },
    // second floor
    { room: 'T1 skeletons', at: { x: 2930, z: 3254, level: 2 }, hop: { kind: 'door', loc: { x: 2926, z: 3258 }, to: { x: 2927, z: 3258 }, label: 'north door (2926,3258)' } },
    { room: 'T3', at: { x: 2939, z: 3240, level: 2 }, hop: { kind: 'ladder', loc: { x: 2940, z: 3240 }, stand: { x: 2939, z: 3240 }, op: down, label: 'down (2940,3240)' } },
    { room: 'T4 north passage', at: { x: 2929, z: 3258, level: 2 }, hop: { kind: 'ladder', loc: { x: 2930, z: 3258 }, stand: { x: 2929, z: 3258 }, op: down, label: 'down (2930,3258)' } },
    { room: 'T5', at: { x: 2933, z: 3243, level: 2 }, hop: { kind: 'ladder', loc: { x: 2934, z: 3243 }, stand: { x: 2933, z: 3243 }, op: down, label: 'down (2934,3243)' } },
    { room: 'T6', at: { x: 2930, z: 3245, level: 2 }, hop: { kind: 'ladder', loc: { x: 2929, z: 3245 }, stand: { x: 2930, z: 3245 }, op: down, label: 'down (2929,3245)' } },
    { room: 'T7', at: { x: 2938, z: 3247, level: 2 }, hop: { kind: 'ladder', loc: { x: 2937, z: 3247 }, stand: { x: 2938, z: 3247 }, op: down, label: 'down (2937,3247)' } },
    { room: 'T8', at: { x: 2937, z: 3250, level: 2 }, hop: { kind: 'door', loc: { x: 2934, z: 3252 }, to: { x: 2933, z: 3253 }, label: 'door (2934,3252)' } },
    { room: 'T9', at: { x: 2937, z: 3255, level: 2 }, hop: { kind: 'ladder', loc: { x: 2938, z: 3255 }, stand: { x: 2937, z: 3255 }, op: down, label: 'down (2938,3255)' } },
    // basement
    { room: 'B1 west corridor', at: { x: 2922, z: 9645, level: 0 }, hop: { kind: 'ladder', loc: { x: 2928, z: 9658 }, stand: { x: 2928, z: 9659 }, op: up, label: 'up and out (2928,9658)' } },
    { room: 'B4 demon', at: { x: 2930, z: 9654, level: 0 }, hop: { kind: 'oneway', loc: { x: 2924, z: 9654 }, label: 'exit door (2924,9654)' } },
    { room: 'B6 Melzar', at: { x: 2929, z: 9647, level: 0 }, hop: { kind: 'oneway', loc: { x: 2927, z: 9649 }, label: 'exit door (2927,9649)' } },
    { room: 'B7 chest', at: { x: 2932, z: 9657, level: 0 }, hop: { kind: 'ladder', loc: { x: 2939, z: 9657 }, stand: { x: 2938, z: 9657 }, op: up, label: 'up (2939,9657)' } },
    { room: 'B8 zombie', at: { x: 2932, z: 9642, level: 0 }, hop: { kind: 'oneway', loc: { x: 2931, z: 9640 }, label: 'exit door (2931,9640)' } },
];

const WALL_N = 2, WALL_E = 8, WALL_S = 32, WALL_W = 128, BLOCKED = 256 | 2097152;
const X0 = 2912, X1 = 2944;
const inBox = (p: Pos) =>
    p.x >= X0 && p.x <= X1 && ((p.level <= 2 && p.z >= 3232 && p.z <= 3264) || (p.level === 0 && p.z >= 9630 && p.z <= 9666));

function step(l: number, x: number, z: number, dx: number, dz: number): boolean {
    const nx = x + dx, nz = z + dz;
    if (isFlagged(nx, nz, l, BLOCKED)) return false;
    if (shut.has(`${l},${x},${z},${nx},${nz}`)) return false;
    if (dx === 1 && (isFlagged(x, z, l, WALL_E) || isFlagged(nx, nz, l, WALL_W))) return false;
    if (dx === -1 && (isFlagged(x, z, l, WALL_W) || isFlagged(nx, nz, l, WALL_E))) return false;
    if (dz === 1 && (isFlagged(x, z, l, WALL_N) || isFlagged(nx, nz, l, WALL_S))) return false;
    if (dz === -1 && (isFlagged(x, z, l, WALL_S) || isFlagged(nx, nz, l, WALL_N))) return false;
    return true;
}

/** Tiles reachable from `p` with every maze door shut, within the maze's box ('out' if it leaves the box). */
function flood(p: Pos): Set<string> | 'out' {
    const zlo = p.z > 9000 ? 9630 : 3232, zhi = p.z > 9000 ? 9666 : 3264;
    const seen = new Set<string>([`${p.x},${p.z}`]);
    const q: Array<[number, number]> = [[p.x, p.z]];
    while (q.length) {
        const [x, z] = q.pop()!;
        for (const [dx, dz] of ANGLE_STEP) {
            if (!step(p.level, x, z, dx, dz)) continue;
            const nx = x + dx, nz = z + dz;
            if (nx < X0 || nx > X1 || nz < zlo || nz > zhi) return 'out';
            const k = `${nx},${nz}`;
            if (!seen.has(k)) {
                seen.add(k);
                q.push([nx, nz]);
            }
        }
    }
    return seen;
}

const roomCache = new Map<string, (typeof HOPS)[number] | null>();
function roomOf(p: Pos): (typeof HOPS)[number] | null {
    if (!inBox(p)) return null;
    const key = `${p.level},${p.x},${p.z}`;
    if (roomCache.has(key)) return roomCache.get(key)!;
    const tiles = flood(p);
    const room = tiles === 'out' ? null : (HOPS.find((h) => h.at.level === p.level && tiles.has(`${h.at.x},${h.at.z}`)) ?? null);
    roomCache.set(key, room);
    return room;
}

/** The maze room `p` is in (e.g. 'G5 entrance'), or null outside it. */
export function melzarsMazeRoom(p: { x: number; z: number; level?: number }): string | null {
    return roomOf({ x: p.x, z: p.z, level: p.level ?? 0 })?.room ?? null;
}

/** True when `p` is in a room of Melzar's Maze (any floor or the basement) rather than outside its walls. */
export function inMelzarsMaze(p: { x: number; z: number; level?: number }): boolean {
    return roomOf({ x: p.x, z: p.z, level: p.level ?? 0 }) !== null;
}

function here(sdk: BotSDK): Pos {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
}
const where = (p: Pos) => `(${p.x},${p.z},${p.level})`;

async function locAt(sdk: BotSDK, t: Tile, opt: RegExp) {
    await sdk.scanNearbyLocs(12).catch(() => undefined);
    return (sdk.getNearbyLocs() ?? []).find((l) => l.x === t.x && l.z === t.z && l.optionsWithIndex.some((o) => opt.test(o.text)));
}

/** Walk to an exact tile inside one room (the client's own pathing sees the shut doors). */
async function stepTo(sdk: BotSDK, t: Tile): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const p = here(sdk);
        if (p.x === t.x && p.z === t.z) return true;
        await sdk.sendWalk(t.x, t.z, true).catch(() => undefined);
        await untilTicks(sdk, (s) => s.player?.worldX === t.x && s.player?.worldZ === t.z, 20);
    }
    const p = here(sdk);
    return p.x === t.x && p.z === t.z;
}

function moved(from: Pos) {
    return (s: { player?: { worldX: number; worldZ: number; level: number } | null }) =>
        !!s.player && (s.player.worldX !== from.x || s.player.worldZ !== from.z || s.player.level !== from.level);
}

async function opLoc(sdk: BotSDK, t: Tile, opt: RegExp, label: string): Promise<boolean> {
    const loc = await locAt(sdk, t, opt);
    if (!loc) throw new Error(`maze: no ${label} at (${t.x},${t.z}) from ${where(here(sdk))}`);
    const o = loc.optionsWithIndex.find((x) => opt.test(x.text))!;
    const from = here(sdk);
    await sdk.sendInteractLoc(loc.x, loc.z, loc.id, o.opIndex);
    return untilTicks(sdk, moved(from), 12);
}

/** Kill the rat in the entrance room for its red key. */
async function redKey(bot: BotActions, sdk: BotSDK, log: Log): Promise<boolean> {
    const keys = () => sdk.getInventory().filter((i) => /^key$/i.test(i.name)).length;
    const before = keys();
    for (let round = 0; round < 60 && keys() <= before && inMelzarsMaze(here(sdk)); round++) {
        const drop = sdk.findGroundItem(/^key$/i);
        if (drop && drop.distance <= 15) {
            await bot.pickupItem(drop).catch(() => undefined);
            await untilTicks(sdk, () => keys() > before, 10);
            continue;
        }
        const me = sdk.getState()?.player;
        const pest = (sdk.getNearbyNpcs() ?? []).find((n) => n.id !== RAT && n.inCombat && n.distance <= 1 && (n.hp ?? 1) > 0);
        const rat = (sdk.getNearbyNpcs() ?? []).find((n) => n.id === RAT && (n.hp ?? 1) > 0);
        const target = pest ?? rat;
        if (!target) {
            await sdk.waitForTicks(5);
            continue;
        }
        if (me?.combat?.targetIndex !== target.index) await bot.attack(target, ticksToMs(10)).catch(() => undefined);
        await sdk.waitForTicks(3);
    }
    const got = keys() > before;
    log(`maze: rat's red key ${got ? 'taken' : 'NOT found'}`);
    return got;
}

async function doHop(bot: BotActions, sdk: BotSDK, log: Log, room: (typeof HOPS)[number]): Promise<void> {
    const hop = room.hop;
    if (hop.kind === 'ladder') {
        if (!(await stepTo(sdk, hop.stand))) log(`maze: ${room.room}: short of (${hop.stand.x},${hop.stand.z}) at ${where(here(sdk))}`);
        await opLoc(sdk, hop.loc, hop.op, `ladder ${hop.label}`);
        await sdk.waitForTicks(1);
    } else if (hop.kind === 'door') {
        const door = await locAt(sdk, hop.loc, /^open$/i);
        if (door) await bot.openDoor(door).catch(() => undefined);
        await stepTo(sdk, hop.to);
    } else if (hop.kind === 'oneway') {
        // Opens only from its own tile, and carries you through.
        await stepTo(sdk, hop.loc);
        await opLoc(sdk, hop.loc, /^open$/i, hop.label);
        await sdk.waitForTicks(1);
    } else {
        const mazeKey = sdk.findInventoryItem(/^maze key$/i);
        const door = mazeKey ? MAZE_DOOR : { x: 2926, z: 3248 };
        const key = mazeKey ?? sdk.findInventoryItem(/^key$/i) ?? ((await redKey(bot, sdk, log)) ? sdk.findInventoryItem(/^key$/i) : null);
        if (!key) throw new Error(`maze: entrance room ${where(here(sdk))} without the Maze key and no red key from the rat`);
        const loc = await locAt(sdk, door, /^open$/i);
        if (!loc) throw new Error(`maze: no door at (${door.x},${door.z})`);
        // The server walks us to the door; the key carries us through it (open_and_close_door).
        await sdk.sendUseItemOnLoc(key.slot, loc.x, loc.z, loc.id);
        await untilTicks(sdk, () => roomOf(here(sdk)) !== room, 40);
        await sdk.waitForTicks(1);
    }
}

/**
 * From anywhere inside Melzar's Maze to outside it. No-op outside. Throws when stuck.
 * Ends on the ground just outside the maze (north wall ~2927,3258 or the east door 2941,3248).
 */
export async function leaveMelzarsMaze(bot: BotActions, sdk: BotSDK, log: Log = console.log): Promise<boolean> {
    if (!inMelzarsMaze(here(sdk))) return false;
    log(`maze: in Melzar's Maze at ${where(here(sdk))} — leaving`);
    let last = '';
    let repeats = 0;
    for (let hops = 0; hops < 24; hops++) {
        await bot.dismissBlockingUI().catch(() => undefined);
        const p = here(sdk);
        const room = roomOf(p);
        if (!room) {
            if (inBox(p) && flood(p) !== 'out') throw new Error(`maze: unmapped room at ${where(p)}`);
            log(`maze: out at ${where(p)} after ${hops} hops`);
            return true;
        }
        repeats = room.room === last ? repeats + 1 : 0;
        if (repeats >= 3) throw new Error(`maze: stuck in ${room.room} at ${where(p)}`);
        last = room.room;
        log(`maze: ${room.room} ${where(p)} -> ${room.hop.kind === 'entrance' ? 'entrance door' : room.hop.label}`);
        const hp = sdk.getState()?.player;
        if (hp && hp.hp < (hp.maxHp || 10) * 0.5) {
            const food = sdk.getInventory().find((i) => i.optionsWithIndex?.some((o) => /^eat$/i.test(o.text)));
            if (food) await bot.eatFood(food).catch(() => undefined);
        }
        await doHop(bot, sdk, log, room);
    }
    throw new Error(`maze: still inside at ${where(here(sdk))} after 24 hops`);
}
