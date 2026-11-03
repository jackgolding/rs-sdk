/**
 * The Sinclair Mansion's first floor (Murder Mystery): its rooms are shut off from the one ladder
 * (laddertop 2737,3582,L1, m42_55) by doors that climbTo's door-opening does not pick — a run was
 * left at (2744,3578,L1) after the spiders' nest with "no stairs/ladder to climb down". bot.walkTo
 * opens the doors on its way to the ladder; then the climb.
 */
import type { Quest } from './run-quest';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

/** Beside the laddertop. */
const LADDER_TOP_SIDE = { x: 2737, z: 3581 };

export const inMansionUpstairs = (p: Tile) => (p.level ?? 0) === 1 && p.x >= 2726 && p.x <= 2752 && p.z >= 3568 && p.z <= 3590;

export async function leaveMansionUpstairs(q: Quest): Promise<void> {
    const p = q.sdk.getState()?.player;
    if (!p || !inMansionUpstairs({ x: p.worldX, z: p.worldZ, level: p.level })) return;
    const walk = await q.bot.walkTo(LADDER_TOP_SIDE.x, LADDER_TOP_SIDE.z, 1);
    if (!walk.success) q.log(`mansion: walk to the upstairs ladder: ${walk.message}`);
    await q.climbTo(0);
}
