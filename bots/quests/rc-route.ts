/**
 * Shortest bank-to-altar route on the collision map.
 *
 * A stand tile has to open a bank booth and is scored by outbound steps to
 * the ruins plus return steps from the portal's exit tile. Step count is
 * chebyshev along the pathfinder polyline, which is one walk tick per step
 * and one run tick per two steps.
 */
import { findLongPath, initPathfinding, isTileWalkable } from '../../sdk/pathfinding';
import * as rsmod from '../../server/vendor/rsmod-pathfinder';

export interface Tile {
    x: number;
    z: number;
}

export interface LocFootprint extends Tile {
    width: number;
    length: number;
    angle: number;
    shape: number;
}

/** `level_mx_mz_lx_lz` from a runecraft dbrow, as a world tile. */
export function worldTile(packed: string): Tile {
    const parts = packed.split('_').map((n) => parseInt(n, 10));
    const mx = parts[1] ?? 0;
    const mz = parts[2] ?? 0;
    const lx = parts[3] ?? 0;
    const lz = parts[4] ?? 0;
    return { x: (mx << 6) + lx, z: (mz << 6) + lz };
}

export function pathSteps(waypoints: Tile[]): number {
    let steps = 0;
    for (let i = 1; i < waypoints.length; i++) {
        const prev = waypoints[i - 1]!;
        const next = waypoints[i]!;
        steps += Math.max(Math.abs(next.x - prev.x), Math.abs(next.z - prev.z));
    }
    return steps;
}

/** Air ruins, from `m46_51.jm2` loc 2452 (3×3, angle 0). Centre is the dbrow altar coord. */
export const AIR_RUINS: LocFootprint = { x: 2984, z: 3291, width: 3, length: 3, angle: 0, shape: 10 };
export const AIR_RUINS_ID = 2452;
/** `runecraft_air` enter_coord `0_44_75_25_30`. */
export const AIR_ENTER: Tile = { x: 2841, z: 4830 };
/** `runecraft_air` exit_coord `0_46_51_39_24`. */
export const AIR_EXIT: Tile = { x: 2983, z: 3288 };
/** Air altar, from `m44_75.jm2` loc 2478 (3×3, angle 1 = north). */
export const AIR_ALTAR: LocFootprint = { x: 2843, z: 4833, width: 3, length: 3, angle: 1, shape: 10 };
export const AIR_ALTAR_ID = 2478;
/** Exit portal, from `m44_75.jm2` loc 2465. */
export const AIR_PORTAL: LocFootprint = { x: 2841, z: 4828, width: 1, length: 1, angle: 0, shape: 10 };
export const AIR_PORTAL_ID = 2465;

/** Falador east booths, `m47_52.jm2` loc 2213. The building is south of them. */
export const FALADOR_EAST_BOOTHS: Tile[] = [3011, 3012, 3013, 3014, 3015].map((x) => ({ x, z: 3354 }));

const LOC_SHAPE = 10;

function reachedLoc(from: Tile, loc: LocFootprint): boolean {
    return rsmod.reached(
        0,
        from.x,
        from.z,
        loc.x,
        loc.z,
        loc.width,
        loc.length,
        1,
        loc.angle,
        loc.shape,
        0
    );
}

function unpack(raw: Uint32Array): Tile[] {
    const out: Tile[] = [];
    for (let i = 0; i < raw.length; i++) {
        const packed = raw[i]!;
        out.push({ x: (packed >> 14) & 0x3fff, z: packed & 0x3fff });
    }
    return out;
}

export interface LocPath {
    steps: number;
    end: Tile | null;
    reached: boolean;
}

/** Path that stops on a tile which can operate `loc`. */
export function pathOntoLoc(from: Tile, loc: LocFootprint): LocPath {
    initPathfinding();
    const raw = unpack(
        rsmod.findLongPath(
            0,
            from.x,
            from.z,
            loc.x,
            loc.z,
            1,
            loc.width,
            loc.length,
            loc.angle,
            loc.shape,
            true,
            0,
            800,
            0
        )
    );
    const end = raw.at(-1) ?? null;
    return { steps: pathSteps(raw), end, reached: !!end && reachedLoc(end, loc) };
}

export function pathOntoTile(from: Tile, dest: Tile): LocPath {
    initPathfinding();
    const raw = findLongPath(0, from.x, from.z, dest.x, dest.z, 800);
    const end = raw.at(-1) ?? null;
    const reached = !!end && end.x === dest.x && end.z === dest.z;
    return { steps: pathSteps(raw), end, reached };
}

export interface BankStand {
    stand: Tile;
    approach: Tile;
    outboundSteps: number;
    returnSteps: number;
    totalSteps: number;
}

function boothStands(booths: Tile[]): Tile[] {
    initPathfinding();
    const stands: Tile[] = [];
    const seen = new Set<string>();
    for (const booth of booths) {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dz === 0) continue;
                const stand = { x: booth.x + dx, z: booth.z + dz };
                const key = `${stand.x},${stand.z}`;
                if (seen.has(key) || !isTileWalkable(0, stand.x, stand.z)) continue;
                const boothLoc: LocFootprint = { ...booth, width: 1, length: 1, angle: 0, shape: LOC_SHAPE };
                if (!reachedLoc(stand, boothLoc)) continue;
                seen.add(key);
                stands.push(stand);
            }
        }
    }
    return stands;
}

/** Booth-adjacent tiles whose path actually reaches the ruins and returns. */
export function rankBankStands(booths: Tile[], ruins: LocFootprint, exit: Tile): BankStand[] {
    const ranked: BankStand[] = [];
    for (const stand of boothStands(booths)) {
        const out = pathOntoLoc(stand, ruins);
        const back = pathOntoTile(exit, stand);
        if (!out.reached || !out.end || !back.reached) continue;
        ranked.push({
            stand,
            approach: out.end,
            outboundSteps: out.steps,
            returnSteps: back.steps,
            totalSteps: out.steps + back.steps
        });
    }
    ranked.sort((a, b) => a.totalSteps - b.totalSteps || a.outboundSteps - b.outboundSteps);
    return ranked;
}

export interface AltarRoute extends BankStand {
    altarStand: Tile;
    toAltarSteps: number;
    portalStand: Tile;
    toPortalSteps: number;
}

export function planAltarRoute(opts: {
    booths: Tile[];
    ruins: LocFootprint;
    enter: Tile;
    exit: Tile;
    altar: LocFootprint;
    portal: LocFootprint;
}): AltarRoute {
    const stands = rankBankStands(opts.booths, opts.ruins, opts.exit);
    const best = stands[0];
    if (!best) throw new Error('No bank tile can reach the ruins and return');
    const toAltar = pathOntoLoc(opts.enter, opts.altar);
    if (!toAltar.reached || !toAltar.end) throw new Error('No path from the altar entrance to the altar');
    const toPortal = pathOntoLoc(toAltar.end, opts.portal);
    if (!toPortal.reached || !toPortal.end) throw new Error('No path from the altar to the exit portal');
    return {
        ...best,
        altarStand: toAltar.end,
        toAltarSteps: toAltar.steps,
        portalStand: toPortal.end,
        toPortalSteps: toPortal.steps
    };
}

export function planAirRoute(): AltarRoute {
    return planAltarRoute({
        booths: FALADOR_EAST_BOOTHS,
        ruins: AIR_RUINS,
        enter: AIR_ENTER,
        exit: AIR_EXIT,
        altar: AIR_ALTAR,
        portal: AIR_PORTAL
    });
}

/**
 * Water: `runecraft_water` altar_coord `0_49_49_49_29` (ruins centre 3185,3165),
 * enter `0_42_75_37_32`, exit `0_49_49_46_26`. Ruins `m49_49.jm2` loc 2454 at
 * 3184,3164 (SW corner). Altar `m42_75.jm2` loc 2480 (angle 3), portal loc 2467.
 */
export const WATER_RUINS: LocFootprint = { x: 3184, z: 3164, width: 3, length: 3, angle: 0, shape: 10 };
export const WATER_RUINS_ID = 2454;
export const WATER_ENTER: Tile = { x: 2725, z: 4832 };
export const WATER_EXIT: Tile = { x: 3182, z: 3162 };
export const WATER_ALTAR: LocFootprint = { x: 2715, z: 4835, width: 3, length: 3, angle: 3, shape: 10 };
export const WATER_ALTAR_ID = 2480;
export const WATER_PORTAL: LocFootprint = { x: 2727, z: 4832, width: 1, length: 1, angle: 0, shape: 10 };
export const WATER_PORTAL_ID = 2467;
/** Draynor booths, `m48_50.jm2` loc 2213 (angle 1). The bank floor is east of them. */
export const DRAYNOR_BOOTHS: Tile[] = [3242, 3243, 3245].map((z) => ({ x: 3091, z }));

/**
 * Earth: `runecraft_earth` altar_coord `0_51_54_42_18` (ruins centre 3306,3474),
 * enter `0_41_75_33_30`, exit `0_51_54_39_21`. Ruins `m51_54.jm2` loc 2455 at
 * 3305,3473. Altar `m41_75.jm2` loc 2481 (angle 2), portal loc 2468.
 */
export const EARTH_RUINS: LocFootprint = { x: 3305, z: 3473, width: 3, length: 3, angle: 0, shape: 10 };
export const EARTH_RUINS_ID = 2455;
export const EARTH_ENTER: Tile = { x: 2657, z: 4830 };
export const EARTH_EXIT: Tile = { x: 3303, z: 3477 };
export const EARTH_ALTAR: LocFootprint = { x: 2657, z: 4840, width: 3, length: 3, angle: 2, shape: 10 };
export const EARTH_ALTAR_ID = 2481;
export const EARTH_PORTAL: LocFootprint = { x: 2655, z: 4829, width: 1, length: 1, angle: 0, shape: 10 };
export const EARTH_PORTAL_ID = 2468;
/** Varrock east booths, `m50_53.jm2` loc 2213. The bank floor is north of them. */
export const VARROCK_EAST_BOOTHS: Tile[] = [3252, 3253, 3254, 3256].map((x) => ({ x, z: 3419 }));

export function planWaterRoute(): AltarRoute {
    return planAltarRoute({
        booths: DRAYNOR_BOOTHS,
        ruins: WATER_RUINS,
        enter: WATER_ENTER,
        exit: WATER_EXIT,
        altar: WATER_ALTAR,
        portal: WATER_PORTAL
    });
}

export function planEarthRoute(): AltarRoute {
    return planAltarRoute({
        booths: VARROCK_EAST_BOOTHS,
        ruins: EARTH_RUINS,
        enter: EARTH_ENTER,
        exit: EARTH_EXIT,
        altar: EARTH_ALTAR,
        portal: EARTH_PORTAL
    });
}
