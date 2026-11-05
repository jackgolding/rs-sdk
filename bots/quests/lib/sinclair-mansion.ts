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
    // A door walkTo will not open (jacklove8 "Stuck at (2744,3578)", 2026-11-05): open the nearest closed door, retry.
    for (let attempt = 1; attempt <= 4; attempt++) {
        const walk = await q.bot.walkTo(LADDER_TOP_SIDE.x, LADDER_TOP_SIDE.z, 1);
        if (walk.success) break;
        q.log(`mansion: walk to the upstairs ladder (attempt ${attempt}): ${walk.message}`);
        await q.sdk.scanNearbyLocs(6).catch(() => undefined);
        const me = q.sdk.getState()?.player;
        const door = (q.sdk.getNearbyLocs() ?? [])
            .filter((l) => /door/i.test(l.name) && l.options.some((o) => /^open$/i.test(o)))
            .sort((a, b) => Math.hypot(a.x - (me?.worldX ?? 0), a.z - (me?.worldZ ?? 0)) - Math.hypot(b.x - (me?.worldX ?? 0), b.z - (me?.worldZ ?? 0)))[0];
        if (!door) break;
        await q.bot.openDoor(door).catch(() => undefined);
        await q.sdk.waitForTicks(2);
    }
    await q.climbTo(0);
}
