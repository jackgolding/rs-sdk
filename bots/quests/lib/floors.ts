/**
 * Floors (planes) in quest logs and checks.
 *
 * Right x,z on the wrong floor is its own failure: ABGARMY05 searched the junk
 * cupboard on level 1, straight under Sir Vyvin's on level 2, fifteen times
 * (2026-10-30). Positions carry the plane in every log, and run-quest's goTo
 * throws when a tile with a level is reached on another floor.
 *
 * Not here: choosing a staircase by the pathfinder's view of the next plane.
 * Open air on upper planes reads as walkable, so a ladder in another building
 * "connects" while a building's own stairs do not (jacklove3 at the Blue Moon
 * Inn, 2026-10-30). climbTo takes the nearest stairs.
 */

export interface PlaneTile {
    x: number;
    z: number;
    level?: number;
}

/** (x,z,Ln): logs that carry the plane make a wrong-floor bug obvious. */
export function fmtTile(t: PlaneTile): string {
    return `(${t.x},${t.z},L${t.level ?? 0})`;
}
