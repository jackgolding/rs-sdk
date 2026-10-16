import { findLongPath, isTileWalkable } from '../../sdk/pathfinding';

/**
 * Wilderness rune-rock waypoints.
 *
 * Rune rocks walks the west side of the lava maze, past the KBD ladder,
 * in 3-tile hops. The east list stays for callers that only need a way
 * south (air runes). Green dragons sit on that east road at z 3770–3835.
 */

export type Tile = { x: number; z: number };

export const ROCKS: Tile = { x: 3058, z: 3884 };
export const HOBGOBLIN: Tile = { x: 3080, z: 3762 };

/**
 * Stay on the east road past Bandit Camp (~3035,3700). Cutting west
 * at z≈3700 pulls sendWalk into the camp and stalls on bandits.
 */
export const WILDY_TO_ROCKS: Tile[] = [
    { x: 3088, z: 3525 },
    { x: 3102, z: 3610 },
    { x: 3110, z: 3700 },
    { x: 3115, z: 3780 },
    { x: 3128, z: 3833 },
    { x: 3130, z: 3879 },
    { x: 3060, z: 3885 }
];

/**
 * East road down to hobgoblin addy, then west off the road. Stay at
 * z≈3760 — cutting west at z≈3700 is Bandit Camp.
 */
export const TO_HOBGOBLIN: Tile[] = [
    { x: 3130, z: 3879 },
    { x: 3128, z: 3833 },
    { x: 3115, z: 3780 },
    { x: 3080, z: 3762 }
];

/** First hop out of the lava-maze south pocket onto the east road. */
export const LAVA_MAZE_EAST: Tile = { x: 3128, z: 3833 };

/** Bandit Camp pocket — north edge stops short of the hobgoblin mine. */
export const BANDIT_CAMP = { xMin: 3008, xMax: 3095, zMin: 3650, zMax: 3732 };
export const EAST_OF_BANDITS: Tile = { x: 3110, z: 3700 };

/**
 * West of the east road and south of the rune rocks. Euclidean skip
 * then sendWalks straight north into lava walls.
 */
export function southOfLavaMaze(x: number, z: number): boolean {
    return x < 3118 && z >= 3760 && z < 3880;
}

export function skipIfFarther(from: Tile, wp: Tile, dest: Tile): boolean {
    return Math.hypot(dest.x - wp.x, dest.z - wp.z) >= Math.hypot(from.x - dest.x, from.z - dest.z) - 4;
}

function dist(a: Tile, b: Tile): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Remaining sendWalk hops toward the lava-maze rune rocks.
 * From the south/west pocket this is east to the road, then north, then west.
 */
export function waypointsToRuneRocks(from: Tile): Tile[] {
    const points = southOfLavaMaze(from.x, from.z)
        ? [LAVA_MAZE_EAST, { x: 3130, z: 3879 }, { x: 3060, z: 3885 }]
        : WILDY_TO_ROCKS;
    const out: Tile[] = [];
    for (const wp of points) {
        if (wp.x < 3100 && from.z < 3780 && wp.z <= 3780) continue;
        if (!southOfLavaMaze(from.x, from.z) && skipIfFarther(from, wp, ROCKS)) continue;
        if (dist(from, wp) <= 6) continue;
        out.push(wp);
    }
    return out;
}

/** Green dragons south of the lava maze. The west route stays out of this box. */
export const GREEN_DRAGONS = { minX: 3048, maxX: 3125, minZ: 3770, maxZ: 3835 };
/** Surface KBD ladder. The west route passes just outside the lesser-demon gate. */
export const KBD_LADDER: Tile = { x: 3017, z: 3849 };

const LESSER_DEMONS = { minX: 3009, maxX: 3028, minZ: 3842, maxZ: 3858 };

/** Ditch → west of Bandit Camp → KBD ladder → north rim → rune rocks. */
const WEST_CORNERS: Tile[] = [
    { x: 3088, z: 3525 },
    { x: 3045, z: 3545 },
    { x: 3010, z: 3575 },
    { x: 2990, z: 3610 },
    { x: 2984, z: 3660 },
    { x: 2984, z: 3720 },
    { x: 2984, z: 3760 },
    { x: 2984, z: 3805 },
    { x: 2984, z: 3840 },
    { x: 3004, z: 3846 },
    { x: 3004, z: 3886 },
    { x: 3030, z: 3886 },
    { x: 3058, z: 3886 },
    { x: 3060, z: 3885 }
];

/** Rocks → back past the KBD ladder → south of the dragons → hobgoblin mine. */
const RETURN_CORNERS: Tile[] = [
    { x: 3060, z: 3885 },
    { x: 3058, z: 3886 },
    { x: 3004, z: 3886 },
    { x: 3004, z: 3846 },
    { x: 2984, z: 3840 },
    { x: 2984, z: 3760 },
    { x: 3040, z: 3760 },
    HOBGOBLIN
];

/** Hobgoblin mine → east of Bandit Camp → Edgeville ditch. Stays south of the dragons. */
const SOUTH_CORNERS: Tile[] = [
    HOBGOBLIN,
    { x: 3110, z: 3755 },
    { x: 3110, z: 3680 },
    { x: 3110, z: 3610 },
    { x: 3094, z: 3560 },
    { x: 3088, z: 3525 }
];

export function inGreenDragons(x: number, z: number): boolean {
    return x >= GREEN_DRAGONS.minX && x <= GREEN_DRAGONS.maxX && z >= GREEN_DRAGONS.minZ && z <= GREEN_DRAGONS.maxZ;
}

function inBox(
    tile: Tile,
    box: { minX?: number; maxX?: number; minZ?: number; maxZ?: number; xMin?: number; xMax?: number; zMin?: number; zMax?: number }
): boolean {
    const minX = box.minX ?? box.xMin ?? 0;
    const maxX = box.maxX ?? box.xMax ?? 0;
    const minZ = box.minZ ?? box.zMin ?? 0;
    const maxZ = box.maxZ ?? box.zMax ?? 0;
    return tile.x >= minX && tile.x <= maxX && tile.z >= minZ && tile.z <= maxZ;
}

function inRouteDanger(tile: Tile): boolean {
    return inBox(tile, GREEN_DRAGONS) || inBox(tile, BANDIT_CAMP) || inBox(tile, LESSER_DEMONS);
}

/** Client MOVE packets carry at most 25 turns. Stay under that. */
const CLICK_AHEAD = 18;

function chebyshev(a: Tile, b: Tile): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

/** Straight line the client will actually walk: no corner cuts, walls, or danger. */
function segmentClear(from: Tile, to: Tile, extra?: (x: number, z: number) => boolean): boolean {
    const ok = (x: number, z: number) =>
        !extra?.(x, z) && isTileWalkable(0, x, z) && !inRouteDanger({ x, z });
    let x = from.x;
    let z = from.z;
    const dx = Math.abs(to.x - from.x);
    const dz = Math.abs(to.z - from.z);
    const sx = from.x < to.x ? 1 : -1;
    const sz = from.z < to.z ? 1 : -1;
    let err = dx - dz;
    while (x !== to.x || z !== to.z) {
        const e2 = 2 * err;
        const stepX = e2 > -dz;
        const stepZ = e2 < dx;
        if (stepX && stepZ && (!ok(x + sx, z) || !ok(x, z + sz))) return false;
        if (stepX) {
            err -= dz;
            x += sx;
        }
        if (stepZ) {
            err += dx;
            z += sz;
        }
        if (!ok(x, z)) return false;
    }
    return true;
}

/**
 * Furthest hop a single sendWalk can take. Long clicks only where the
 * straight line stays on walkable ground. A bend, wall, door, or danger
 * box ends the click so the client cannot scenic-route.
 */
export function clickAhead(
    from: Tile,
    hops: Tile[],
    start: number,
    extra?: (x: number, z: number) => boolean
): { tile: Tile; index: number; straight: boolean } {
    if (start >= hops.length) return { tile: from, index: start, straight: true };
    let aim = start;
    while (aim < hops.length - 1 && chebyshev(from, hops[aim]!) <= 2) aim++;
    const first = hops[aim]!;
    if (chebyshev(from, first) === 0) return { tile: first, index: aim, straight: true };
    if (!segmentClear(from, first, extra)) return { tile: first, index: aim, straight: false };
    let tile = first;
    let index = aim;
    for (let i = aim + 1; i < hops.length; i++) {
        const hop = hops[i]!;
        if (chebyshev(from, hop) > CLICK_AHEAD) break;
        if (!segmentClear(from, hop, extra)) break;
        tile = hop;
        index = i;
    }
    return { tile, index, straight: true };
}

function tileKey(tile: Tile): string {
    return `${tile.x},${tile.z}`;
}

/** Shortest walkable path that stays out of dragons, bandits, and the demon pen. */
function safePath(from: Tile, to: Tile, walkable: (x: number, z: number) => boolean): Tile[] | null {
    if (from.x === to.x && from.z === to.z) return [from];
    const prev = new Map<string, string | null>();
    const queue: Tile[] = [from];
    prev.set(tileKey(from), null);
    const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1]
    ];
    let qi = 0;
    while (qi < queue.length) {
        const cur = queue[qi++]!;
        if (cur.x === to.x && cur.z === to.z) {
            const out: Tile[] = [];
            let key: string | null = tileKey(cur);
            while (key) {
                const [x, z] = key.split(',').map(Number);
                out.push({ x: x!, z: z! });
                key = prev.get(key) ?? null;
            }
            return out.reverse();
        }
        if (dist(cur, from) > 60) continue;
        for (const [dx, dz] of dirs) {
            const next = { x: cur.x + dx!, z: cur.z + dz! };
            const key = tileKey(next);
            if (prev.has(key) || !walkable(next.x, next.z) || inRouteDanger(next)) continue;
            prev.set(key, tileKey(cur));
            queue.push(next);
        }
    }
    return null;
}

/** Deep-wildy chaos altar, west of the KBD ladder (m46_59 loc chaosaltar). */
export const CHAOS_ALTAR: Tile = { x: 2947, z: 3820 };
/** Walkable tile beside that altar. */
export const CHAOS_ALTAR_STAND: Tile = { x: 2949, z: 3818 };

const ALTAR_CORNERS: Tile[] = [
    { x: 2984, z: 3820 },
    { x: 2964, z: 3820 },
    CHAOS_ALTAR_STAND
];

function densify(corners: Tile[]): Tile[] {
    const tiles: Tile[] = [];
    for (let i = 0; i < corners.length - 1; i++) {
        const from = corners[i]!;
        const to = corners[i + 1]!;
        const sparse = findLongPath(0, from.x, from.z, to.x, to.z, 800).map((p) => ({ x: p.x, z: p.z }));
        if (!sparse.length || sparse[0]!.x !== from.x || sparse[0]!.z !== from.z) sparse.unshift(from);
        const end = sparse[sparse.length - 1]!;
        if (end.x !== to.x || end.z !== to.z) {
            throw new Error(`rune-rocks route missed ${to.x},${to.z} from ${from.x},${from.z} (ended ${end.x},${end.z})`);
        }
        let cur = from;
        for (const goal of sparse.slice(1)) {
            const leg = safePath(cur, goal, (x, z) => isTileWalkable(0, x, z));
            if (!leg) throw new Error(`rune-rocks route blocked ${cur.x},${cur.z} -> ${goal.x},${goal.z}`);
            tiles.push(...(tiles.length ? leg.slice(1) : leg));
            cur = goal;
        }
    }
    const hops: Tile[] = [];
    for (let i = 0; i < tiles.length; i += 3) hops.push(tiles[i]!);
    const last = tiles[tiles.length - 1]!;
    const tail = hops[hops.length - 1]!;
    if (tail.x !== last.x || tail.z !== last.z) hops.push(last);
    return hops;
}

let westHops: Tile[] | null = null;
let returnHops: Tile[] | null = null;
let southHops: Tile[] | null = null;
let altarHops: Tile[] | null = null;

/** 3-tile hops. West of the lava maze, within 15 tiles of the KBD ladder. */
export function westToRocksHops(): Tile[] {
    westHops ??= densify(WEST_CORNERS);
    return westHops;
}

/** 3-tile hops from the rocks to the hobgoblin mine, still west of the dragons. */
export function returnToHobHops(): Tile[] {
    returnHops ??= densify(RETURN_CORNERS);
    return returnHops;
}

/** 3-tile hops from the hobgoblin mine to the Edgeville ditch. */
export function hobToDitchHops(): Tile[] {
    southHops ??= densify(SOUTH_CORNERS);
    return southHops;
}

/** 3-tile hops from the west road to the chaos altar. */
export function chaosAltarHops(): Tile[] {
    altarHops ??= densify(ALTAR_CORNERS);
    return altarHops;
}
