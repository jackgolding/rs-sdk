/**
 * Floors (planes): which staircase or ladder to take toward a tile on another plane.
 *
 * walkTo routes on one plane only, so run-quest's goTo changes plane first. Taking
 * the nearest stairs is wrong in any building with more than one: in the White
 * Knights' castle it put ABGARMY05 on level 1, straight under Sir Vyvin's cupboard,
 * searching the junk cupboard below it 15 times (2026-10-30). Here a staircase is
 * judged by where it lands: the pathfinder holds collision for every plane, so the
 * landing (beside the loc, one plane over) either connects to the destination there
 * or it does not.
 */
import type { NearbyLoc } from '../../../sdk/types';
import { findLongPath, nearestWalkableTile } from '../../../sdk/pathfinding';

export interface PlaneTile {
    x: number;
    z: number;
    level?: number;
}

/** (x,z,Ln): logs that carry the plane make a wrong-floor bug obvious. */
export function fmtTile(t: PlaneTile): string {
    return `(${t.x},${t.z},L${t.level ?? 0})`;
}

/**
 * How far from `toward` a walk on `level` from beside `loc` can get: 0 when the
 * landing connects to it, Infinity when there is no walkable landing at all.
 */
export function landingMiss(loc: { x: number; z: number }, level: number, toward: { x: number; z: number }): number {
    const start = nearestWalkableTile(level, loc.x, loc.z, 3);
    if (!start) return Infinity;
    const goal = nearestWalkableTile(level, toward.x, toward.z, 3) ?? toward;
    const path = findLongPath(level, start.x, start.z, goal.x, goal.z);
    const end = path.length ? path[path.length - 1]! : start;
    const miss = Math.max(Math.abs(end.x - goal.x), Math.abs(end.z - goal.z));
    return miss <= 1 ? 0 : miss;
}

/**
 * Of the climbable locs in view (already filtered to the right direction and
 * reachable), the one whose landing on `nextLevel` gets closest to `toward`;
 * ties go to the nearer loc. Undefined when none lands anywhere walkable.
 */
export function pickConnector(locs: NearbyLoc[], nextLevel: number, toward: { x: number; z: number }): NearbyLoc | undefined {
    let best: { loc: NearbyLoc; miss: number } | undefined;
    for (const loc of locs) {
        let miss: number;
        try {
            miss = landingMiss(loc, nextLevel, toward);
        } catch {
            continue; // no collision data there: leave it to the nearest-stairs fallback
        }
        if (!Number.isFinite(miss)) continue;
        if (!best || miss < best.miss || (miss === best.miss && (loc.distance ?? 99) < (best.loc.distance ?? 99))) best = { loc, miss };
    }
    return best?.loc;
}
