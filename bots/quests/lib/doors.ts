/**
 * Doors the client pathfinder cannot route through: its collision map disagrees
 * with the game there, so bot.walkTo "arrives" at a dead end inside and never
 * plans through the real doorway. q.goTo crosses these by hand — walk to the
 * inside tile, open the door, step through — before it walks on.
 *
 * Add a door here (not a per-quest workaround) when a walkTo out of a building
 * fails with "unroutable from here" / "Stuck at" while the game's door is right there.
 */
import type { BotActions } from '../../../sdk/actions';
import type { BotSDK } from '../../../sdk/index';
import { untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
}

export interface StuckDoor {
    name: string;
    /** The door loc's tile (closed). */
    door: Tile;
    /** Walkable tiles either side of the doorway. */
    inside: Tile;
    outside: Tile;
    /** Plane-0 box the walk cannot leave without this door. */
    area: { x1: number; z1: number; x2: number; z2: number };
}

export const STUCK_DOORS: StuckDoor[] = [
    {
        // walkTo out heads east to (3164,3435), a wall, with the door open or closed
        // (Romeo & Juliet port, 2026-10-29). Entering through it works.
        name: "Juliet's house front door",
        door: { x: 3160, z: 3440 },
        inside: { x: 3160, z: 3439 },
        outside: { x: 3160, z: 3441 },
        area: { x1: 3155, z1: 3427, x2: 3164, z2: 3439 },
    },
];

const within = (t: Tile, a: StuckDoor['area']) => t.x >= a.x1 && t.x <= a.x2 && t.z >= a.z1 && t.z <= a.z2;

/**
 * If the player is on plane 0 inside a STUCK_DOORS area and `dest` is outside it,
 * go out through its door. Returns true when it crossed one.
 */
export async function leaveStuckArea(sdk: BotSDK, bot: BotActions, dest: Tile, log: (msg: string) => void): Promise<boolean> {
    const p = sdk.getState()?.player;
    if (!p || p.level !== 0) return false;
    const here = { x: p.worldX, z: p.worldZ };
    const door = STUCK_DOORS.find((d) => within(here, d.area) && !within(dest, d.area));
    if (!door) return false;
    await bot.walkTo(door.inside.x, door.inside.z, 0);
    await sdk.scanNearbyLocs(3).catch(() => undefined);
    const closed = (sdk.getNearbyLocs() ?? []).find(
        (l) => l.x === door.door.x && l.z === door.door.z && /door|gate/i.test(l.name) && l.options?.some((o) => /^open$/i.test(o))
    );
    if (closed) {
        await bot.openDoor(closed);
        await sdk.waitForTicks(1);
    }
    await sdk.sendWalk(door.outside.x, door.outside.z);
    const out = await untilTicks(sdk, (s) => !within({ x: s.player?.worldX ?? 0, z: s.player?.worldZ ?? 0 }, door.area), 10);
    const now = sdk.getState()?.player;
    log(`${door.name}: ${out ? 'out' : 'STILL INSIDE'} at (${now?.worldX},${now?.worldZ})${closed ? ' (opened it)' : ''}`);
    return out;
}
