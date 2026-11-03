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
    /**
     * Also cross it on the way IN (enterStuckArea). Only where walking in fails too:
     * forcing the door into the Wizards' Tower ladder room, which walkTo enters fine,
     * left the bot on the door tile unable to reach Sedridor.
     */
    enter?: boolean;
}

export const STUCK_DOORS: StuckDoor[] = [
    {
        // Wizards' Tower basement, the side room south of the corridor: walkTo and the
        // ladder scan see no way out with this door shut (ABGARMY03/ABGARMY20 stranded
        // at 3111,9556 after Rune Mysteries, 2026-10-29). Open it, walk north to the ladder.
        name: "Wizards' Tower basement side-room door",
        door: { x: 3111, z: 9559 },
        inside: { x: 3111, z: 9558 },
        outside: { x: 3111, z: 9560 },
        area: { x1: 3107, z1: 9550, x2: 3115, z2: 9558 },
    },
    {
        // ...and the corridor north of it, shut by a second door; the ladder up
        // (3103,9576) only comes into view past this one (probe 2026-10-29).
        name: "Wizards' Tower basement corridor door",
        door: { x: 3108, z: 9570 },
        inside: { x: 3108, z: 9569 },
        outside: { x: 3108, z: 9571 },
        area: { x1: 3106, z1: 9559, x2: 3115, z2: 9569 },
    },
    {
        // walkTo out heads east to (3164,3435), a wall, with the door open or closed
        // (Romeo & Juliet port, 2026-10-29). Entering through it works.
        name: "Juliet's house front door",
        enter: true,
        door: { x: 3160, z: 3440 },
        inside: { x: 3160, z: 3439 },
        outside: { x: 3160, z: 3441 },
        area: { x1: 3155, z1: 3427, x2: 3164, z2: 3439 },
    },
    {
        // With this door open (another player, or our own way in) walkTo out of the
        // ladder room finds no path at all ("stops 45 tiles short at (3105,3162)");
        // with it shut it walks out. Three concurrent Rune Mysteries runs toggled it
        // against each other until one timed out (2026-10-29).
        name: "Wizards' Tower ladder-room door",
        door: { x: 3107, z: 3162 },
        inside: { x: 3106, z: 3162 },
        outside: { x: 3108, z: 3162 },
        area: { x1: 3100, z1: 3157, x2: 3106, z2: 3166 },
    },
    {
        // The Sinclair Mansion grounds' wrought iron gate (loc_1557/1558, m42_55) in the dry stone
        // wall: walkTo stops at it both ways ("Stuck at (2741,3555)" in, "Stuck at (2741,3576)"
        // out) and travelTo pins itself on the hedges west of it (Murder Mystery port, 2026-11-03).
        name: 'Sinclair Mansion gate',
        enter: true,
        door: { x: 2741, z: 3555 },
        inside: { x: 2741, z: 3556 },
        outside: { x: 2741, z: 3554 },
        area: { x1: 2726, z1: 3556, x2: 2752, z2: 3590 },
    },
    {
        // Lord Handelmort's garden, East Ardougne (the same wrought iron gate, loc_1557/1558 at
        // 2635-2636,3307): out of the mansion, walkTo and travelTo stalled at (2641,3308) (Tribal
        // Totem port, 2026-11-03). Cromperty's teleport is the only way in, so out only.
        name: "Handelmort's garden gate",
        door: { x: 2635, z: 3307 },
        inside: { x: 2635, z: 3308 },
        outside: { x: 2635, z: 3306 },
        area: { x1: 2626, z1: 3308, x2: 2646, z2: 3319 },
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
    // Other players open and close the same door: re-read it every try, step through
    // when it is already open, and back off a little longer each time.
    let out = false;
    let opened = false;
    for (let attempt = 0; attempt < 4 && !out; attempt++) {
        if (attempt) await sdk.waitForTicks(1 + attempt);
        await bot.walkTo(door.inside.x, door.inside.z, 1);
        await sdk.scanNearbyLocs(3).catch(() => undefined);
        const closed = (sdk.getNearbyLocs() ?? []).find(
            (l) => l.x === door.door.x && l.z === door.door.z && /door|gate/i.test(l.name) && l.options?.some((o) => /^open$/i.test(o))
        );
        if (closed) {
            await bot.openDoor(closed);
            opened = true;
            await sdk.waitForTicks(1);
        }
        await sdk.sendWalk(door.outside.x, door.outside.z);
        // On the outside tile, not merely off the area's edge: "out" at (3107,3161), beside
        // the Wizards' Tower door, let walkTo plan straight back into the ladder room
        // (Imp Catcher epilogues on jacklove5/15/19, Jackpoo4, 2026-10-29).
        out = await untilTicks(sdk, (s) => {
            const at = { x: s.player?.worldX ?? 0, z: s.player?.worldZ ?? 0 };
            const fromDoor = Math.max(Math.abs(at.x - door.door.x), Math.abs(at.z - door.door.z));
            return !within(at, door.area) && ((at.x === door.outside.x && at.z === door.outside.z) || fromDoor >= 2);
        }, 10);
    }
    const now = sdk.getState()?.player;
    log(`${door.name}: ${out ? 'out' : 'STILL INSIDE'} at (${now?.worldX},${now?.worldZ})${opened ? ' (opened it)' : ''}`);
    return out;
}

/**
 * The way in: if `dest` is inside a STUCK_DOORS area and the player (plane 0) is
 * outside it, step in through its door. On prod the walk into Juliet's house
 * found "No path … no waypoints" from just outside the front door, with the door
 * in whatever state another player left it (2026-10-29). Returns true when it crossed.
 */
export async function enterStuckArea(sdk: BotSDK, bot: BotActions, dest: Tile, log: (msg: string) => void): Promise<boolean> {
    const p = sdk.getState()?.player;
    if (!p || p.level !== 0) return false;
    const here = { x: p.worldX, z: p.worldZ };
    const door = STUCK_DOORS.find((d) => d.enter && within(dest, d.area) && !within(here, d.area));
    if (!door) return false;
    let inside = false;
    let opened = false;
    for (let attempt = 0; attempt < 4 && !inside; attempt++) {
        if (attempt) await sdk.waitForTicks(1 + attempt);
        await bot.walkTo(door.outside.x, door.outside.z, 1);
        await sdk.scanNearbyLocs(3).catch(() => undefined);
        const closed = (sdk.getNearbyLocs() ?? []).find(
            (l) => l.x === door.door.x && l.z === door.door.z && /door|gate/i.test(l.name) && l.options?.some((o) => /^open$/i.test(o))
        );
        if (closed) {
            await bot.openDoor(closed);
            opened = true;
            await sdk.waitForTicks(1);
        }
        await sdk.sendWalk(door.inside.x, door.inside.z);
        inside = await untilTicks(sdk, (s) => within({ x: s.player?.worldX ?? 0, z: s.player?.worldZ ?? 0 }, door.area), 10);
    }
    const now = sdk.getState()?.player;
    log(`${door.name}: ${inside ? 'in' : 'STILL OUTSIDE'} at (${now?.worldX},${now?.worldZ})${opened ? ' (opened it)' : ''}`);
    return inside;
}
