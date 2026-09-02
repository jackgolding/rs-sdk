/** Wilderness rune-rock waypoints. Keep sendWalk on the east road around lava. */

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
