/**
 * Black Knights' Fortress — moving around inside it.
 *
 * The fortress is a stack of small rooms joined by ladders, doors that teleport
 * you through (quest_blackknight.rs2, open_and_close_doors.rs2) and two secret
 * walls. No client walk crosses a room boundary, so the interior is a graph of
 * rooms (ROOMS) and the one action that joins each pair (EDGES); `fortressTo`
 * finds where the player is and takes the edges toward the goal, so a retry
 * resumes from any room.
 *
 * Map facts (maps/m47_54, loc configs):
 *   - ladders land on the player's own tile one plane up/down (ladders.rs2
 *     climb_ladder(movecoord(coord, 0, ±1, 0))), and the `_directional` ones
 *     force the approach side (forceapproach=north, rotated by the loc angle)
 *   - L1's railing (east edge of x 3024, z 3513-3516) splits room CD from room E:
 *     the way across is up the ladder at (3023,3513), two tiles east on L2, and
 *     down the ladder at (3025,3513)
 *   - the grill (3025,3507) is in the ground-floor corridor under the L1 ladder (3021,3510)
 *   - the hole (3031,3507, L1) is behind the secret wall (3030,3510, L1), reached
 *     from the banquet hall's ladder (3022,3518) and the L1 corridor north of room E
 *   - the guard door (3016,3514) needs bronze med helm + iron chainbody worn; the
 *     banquet hall door (3020,3515) is a guard dialog ("I'm going in anyway"),
 *     after which the hall's black knights attack
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
}
interface Box {
    level: number;
    x0: number;
    x1: number;
    z0: number;
    z1: number;
}

/** Outside the guard door, south of it. */
export const FORTRESS_DOOR_OUTSIDE = { x: 3016, z: 3513 };

type Room = 'outside' | 'entrance' | 'secret' | 'hall' | 'grill' | 'a' | 'b' | 'cd' | 'e' | 'h' | 'g' | 'hole' | 'l2w' | 'l2m';

/** First match wins: E before H (x 3025 is H below z 3513), G's strips listed separately. */
const ROOMS: Array<[Room, Box]> = [
    ['entrance', { level: 0, x0: 3015, x1: 3019, z0: 3515, z1: 3516 }],
    ['secret', { level: 0, x0: 3014, x1: 3016, z0: 3517, z1: 3519 }],
    ['hall', { level: 0, x0: 3020, x1: 3030, z0: 3511, z1: 3518 }],
    // The grill corridor is z 3510 (x 3021-3024) and x 3025 (z 3506-3510) only: the tiles
    // south-west of it (3022-3024 x 3505-3509) are outdoors, outside the fortress wall.
    ['grill', { level: 0, x0: 3021, x1: 3024, z0: 3510, z1: 3510 }],
    ['grill', { level: 0, x0: 3025, x1: 3025, z0: 3506, z1: 3510 }],
    ['a', { level: 1, x0: 3015, x1: 3016, z0: 3517, z1: 3519 }],
    ['b', { level: 1, x0: 3015, x1: 3019, z0: 3515, z1: 3516 }],
    ['cd', { level: 1, x0: 3020, x1: 3024, z0: 3513, z1: 3516 }],
    ['e', { level: 1, x0: 3025, x1: 3029, z0: 3513, z1: 3516 }],
    ['e', { level: 1, x0: 3026, x1: 3029, z0: 3510, z1: 3512 }],
    ['h', { level: 1, x0: 3021, x1: 3025, z0: 3505, z1: 3512 }],
    ['g', { level: 1, x0: 3022, x1: 3029, z0: 3517, z1: 3518 }],
    ['g', { level: 1, x0: 3029, x1: 3030, z0: 3516, z1: 3516 }],
    ['g', { level: 1, x0: 3030, x1: 3030, z0: 3510, z1: 3515 }],
    ['hole', { level: 1, x0: 3026, x1: 3032, z0: 3504, z1: 3509 }],
    ['l2w', { level: 2, x0: 3015, x1: 3018, z0: 3515, z1: 3519 }],
    ['l2m', { level: 2, x0: 3021, x1: 3028, z0: 3513, z1: 3516 }],
];

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;

export function fortressRoom(q: Quest): Room | null {
    const p = pos(q);
    for (const [room, b] of ROOMS) if (p.level === b.level && p.x >= b.x0 && p.x <= b.x1 && p.z >= b.z0 && p.z <= b.z1) return room;
    // Anywhere else on the ground, or away from the fortress, is outside (q.goTo
    // climbs down first); an unknown upper-floor tile inside it is not.
    const far = Math.abs(p.x - 3022) > 15 || Math.abs(p.z - 3512) > 15;
    return (p.level === 0 || far) && p.z < 6400 ? 'outside' : null;
}

/** Walk to a tile in the current room (the client paths it like a click). */
async function walk(q: Quest, t: Tile): Promise<void> {
    for (let i = 0; i < 4; i++) {
        if (pos(q).x === t.x && pos(q).z === t.z) return;
        await q.sdk.sendWalk(t.x, t.z, true);
        if (await untilTicks(q.sdk, () => pos(q).x === t.x && pos(q).z === t.z, 20)) return;
    }
    throw new Error(`fortress: walk to (${t.x},${t.z}) stuck at ${where(q)}`);
}

/**
 * Op `opt` on the loc named `name` at `at` (current plane) until `done`. A dialog
 * that opens (the hall guard) is driven with `choices`.
 */
async function op(
    q: Quest,
    at: Tile,
    name: RegExp,
    opt: RegExp,
    done: () => boolean,
    label: string,
    choices: RegExp[] = [],
    dialogTicks = 80
): Promise<void> {
    const drive = async () => {
        // Drive what is open to its end; a long one (the grill's nine pages) gets the
        // whole budget again rather than a fresh click, which would restart it.
        for (let rounds = 0; rounds < 3 && q.sdk.getDialog()?.isOpen && !done(); rounds++) {
            await driveDialog(q.sdk, choices, { done, ticks: dialogTicks, log: q.log });
        }
    };
    for (let attempt = 1; attempt <= 4; attempt++) {
        if (done()) return;
        if (q.sdk.getDialog()?.isOpen) {
            await drive();
            if (await untilTicks(q.sdk, done, 5)) return;
        }
        await q.sdk.scanNearbyLocs(10).catch(() => undefined);
        const loc = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === at.x && l.z === at.z && name.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)));
        if (!loc) {
            // A secret wall is swapped out for 3 ticks after someone pushes it.
            q.log(`fortress: ${label}: no ${name} with ${opt} at (${at.x},${at.z}) from ${where(q)} (attempt ${attempt})`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        const index = loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex;
        const t0 = tickNow(q.sdk);
        await q.sdk.sendInteractLoc(at.x, at.z, loc.id, index);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 25);
        await drive();
        if (await untilTicks(q.sdk, done, 5)) return;
        q.log(`fortress: ${label} did not take from ${where(q)} (attempt ${attempt}, ${tickNow(q.sdk) - t0}t, dialog ${q.sdk.getDialog()?.isOpen ? 'still open' : 'closed'})`);
    }
    throw new Error(`fortress: ${label} failed at ${where(q)}`);
}

const inRoom = (q: Quest, room: Room) => () => fortressRoom(q) === room;

/** Climb the ladder at `at` (on the current plane) into `room`. */
async function climb(q: Quest, from: Tile, at: Tile, room: Room, label: string): Promise<void> {
    // The op walks to the ladder itself: a bot left elsewhere in the room (a failed run,
    // ABGARMY01/18 at 3025,3506) cannot always stand on `from` (stuck at 3022,3509).
    await walk(q, from).catch((e) => q.log(`${label}: ${(e as Error).message}; using the ladder from here`));
    const up = /climb-up/i.test(label);
    await op(q, at, /^ladder$/i, up ? /climb-up/i : /climb-down/i, inRoom(q, room), label);
}

/** Open the plain door at `at` if it is shut (another player may have opened it). */
async function openIfShut(q: Quest, at: Tile): Promise<void> {
    await q.sdk.scanNearbyLocs(6).catch(() => undefined);
    const shut = () => (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === at.x && l.z === at.z && /^door$/i.test(l.name) && l.options.some((o) => /^open$/i.test(o)));
    const door = shut();
    if (!door) return;
    await q.sdk.sendInteractLoc(at.x, at.z, door.id, door.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
    await untilTicks(q.sdk, () => !(q.sdk.getNearbyLocs() ?? []).some((l) => l.x === at.x && l.z === at.z && l.id === door.id), 10);
    await q.sdk.waitForTicks(1);
}

const STURDY = /^sturdy door$/i;
const WALL = /^wall$/i;

/** One move between adjacent rooms. */
const EDGES: Array<{ from: Room; to: Room; go: (q: Quest) => Promise<void> }> = [
    {
        from: 'outside',
        to: 'entrance',
        go: async (q) => {
            if (Math.hypot(pos(q).x - FORTRESS_DOOR_OUTSIDE.x, pos(q).z - FORTRESS_DOOR_OUTSIDE.z) > 3) await q.goTo(FORTRESS_DOOR_OUTSIDE, 2);
            await op(q, { x: 3016, z: 3514 }, STURDY, /^open$/i, inRoom(q, 'entrance'), 'guard door in');
        },
    },
    { from: 'entrance', to: 'outside', go: (q) => op(q, { x: 3016, z: 3514 }, STURDY, /^open$/i, inRoom(q, 'outside'), 'guard door out') },
    {
        from: 'entrance',
        to: 'secret',
        go: async (q) => {
            await walk(q, { x: 3016, z: 3516 });
            await op(q, { x: 3016, z: 3517 }, WALL, /^push$/i, inRoom(q, 'secret'), 'secret wall north');
        },
    },
    {
        from: 'secret',
        to: 'entrance',
        go: async (q) => {
            await walk(q, { x: 3016, z: 3517 });
            await op(q, { x: 3016, z: 3517 }, WALL, /^push$/i, inRoom(q, 'entrance'), 'secret wall south');
        },
    },
    { from: 'secret', to: 'a', go: (q) => climb(q, { x: 3015, z: 3518 }, { x: 3015, z: 3519 }, 'a', 'climb-up (3015,3519)') },
    { from: 'a', to: 'secret', go: (q) => climb(q, { x: 3015, z: 3518 }, { x: 3015, z: 3519 }, 'secret', 'climb-down (3015,3519)') },
    { from: 'a', to: 'l2w', go: (q) => climb(q, { x: 3016, z: 3518 }, { x: 3016, z: 3519 }, 'l2w', 'climb-up (3016,3519)') },
    { from: 'l2w', to: 'a', go: (q) => climb(q, { x: 3016, z: 3518 }, { x: 3016, z: 3519 }, 'a', 'climb-down (3016,3519)') },
    { from: 'l2w', to: 'b', go: (q) => climb(q, { x: 3016, z: 3516 }, { x: 3017, z: 3516 }, 'b', 'climb-down (3017,3516)') },
    { from: 'b', to: 'l2w', go: (q) => climb(q, { x: 3016, z: 3516 }, { x: 3017, z: 3516 }, 'l2w', 'climb-up (3017,3516)') },
    {
        from: 'b',
        to: 'cd',
        go: async (q) => {
            await walk(q, { x: 3019, z: 3515 });
            await openIfShut(q, { x: 3019, z: 3515 });
            await walk(q, { x: 3021, z: 3515 });
            await openIfShut(q, { x: 3021, z: 3515 });
            await walk(q, { x: 3023, z: 3514 });
        },
    },
    {
        from: 'cd',
        to: 'b',
        go: async (q) => {
            await walk(q, { x: 3022, z: 3515 });
            await openIfShut(q, { x: 3021, z: 3515 });
            await walk(q, { x: 3020, z: 3515 });
            await openIfShut(q, { x: 3019, z: 3515 });
            await walk(q, { x: 3016, z: 3516 });
        },
    },
    { from: 'cd', to: 'l2m', go: (q) => climb(q, { x: 3023, z: 3514 }, { x: 3023, z: 3513 }, 'l2m', 'climb-up (3023,3513)') },
    { from: 'l2m', to: 'cd', go: (q) => climb(q, { x: 3023, z: 3514 }, { x: 3023, z: 3513 }, 'cd', 'climb-down (3023,3513)') },
    { from: 'l2m', to: 'e', go: (q) => climb(q, { x: 3025, z: 3514 }, { x: 3025, z: 3513 }, 'e', 'climb-down (3025,3513)') },
    { from: 'e', to: 'l2m', go: (q) => climb(q, { x: 3025, z: 3514 }, { x: 3025, z: 3513 }, 'l2m', 'climb-up (3025,3513)') },
    {
        from: 'e',
        to: 'h',
        go: async (q) => {
            await walk(q, { x: 3026, z: 3511 });
            await op(q, { x: 3025, z: 3511 }, STURDY, /^open$/i, inRoom(q, 'h'), 'sturdy door west');
        },
    },
    {
        from: 'h',
        to: 'e',
        go: async (q) => {
            await walk(q, { x: 3025, z: 3511 });
            await op(q, { x: 3025, z: 3511 }, STURDY, /^open$/i, inRoom(q, 'e'), 'sturdy door east');
        },
    },
    { from: 'h', to: 'grill', go: (q) => climb(q, { x: 3022, z: 3510 }, { x: 3021, z: 3510 }, 'grill', 'climb-down (3021,3510)') },
    { from: 'grill', to: 'h', go: (q) => climb(q, { x: 3022, z: 3510 }, { x: 3021, z: 3510 }, 'h', 'climb-up (3021,3510)') },
    {
        from: 'entrance',
        to: 'hall',
        go: async (q) => {
            await walk(q, { x: 3019, z: 3515 });
            await op(q, { x: 3020, z: 3515 }, /^door$/i, /^open$/i, inRoom(q, 'hall'), 'banquet hall door in', [/going in anyway/i]);
        },
    },
    {
        from: 'hall',
        to: 'entrance',
        go: async (q) => {
            await walk(q, { x: 3020, z: 3515 });
            await op(q, { x: 3020, z: 3515 }, /^door$/i, /^open$/i, inRoom(q, 'entrance'), 'banquet hall door out');
        },
    },
    { from: 'hall', to: 'g', go: (q) => climb(q, { x: 3022, z: 3517 }, { x: 3022, z: 3518 }, 'g', 'climb-up (3022,3518)') },
    { from: 'g', to: 'hall', go: (q) => climb(q, { x: 3022, z: 3517 }, { x: 3022, z: 3518 }, 'hall', 'climb-down (3022,3518)') },
    {
        from: 'g',
        to: 'hole',
        go: async (q) => {
            if (pos(q).x < 3029) await walk(q, { x: 3029, z: 3517 });
            if (pos(q).x < 3030) await walk(q, { x: 3030, z: 3516 });
            await walk(q, { x: 3030, z: 3510 });
            await op(q, { x: 3030, z: 3510 }, WALL, /^push$/i, inRoom(q, 'hole'), 'secret wall to the hole');
        },
    },
    {
        from: 'hole',
        to: 'g',
        go: async (q) => {
            await walk(q, { x: 3030, z: 3509 });
            await op(q, { x: 3030, z: 3510 }, WALL, /^push$/i, inRoom(q, 'g'), 'secret wall from the hole');
        },
    },
];

/** Shortest room path (BFS over EDGES). */
function route(from: Room, to: Room): Room[] | null {
    const prev = new Map<Room, Room | null>([[from, null]]);
    const queue: Room[] = [from];
    while (queue.length) {
        const r = queue.shift()!;
        if (r === to) break;
        for (const e of EDGES) if (e.from === r && !prev.has(e.to)) {
            prev.set(e.to, r);
            queue.push(e.to);
        }
    }
    if (!prev.has(to)) return null;
    const path: Room[] = [];
    for (let r: Room | null = to; r; r = prev.get(r) ?? null) path.unshift(r);
    return path;
}

/** Move room by room to `goal`. Throws on an unknown tile or a move that does not land. */
export async function fortressTo(q: Quest, goal: Room): Promise<void> {
    for (let moves = 0; moves < 30; moves++) {
        const here = fortressRoom(q);
        if (here === goal) return;
        if (!here) throw new Error(`fortress: ${where(q)} is in no known room`);
        const path = route(here, goal)!;
        const next = path[1]!;
        const edge = EDGES.find((e) => e.from === here && e.to === next)!;
        q.log(`fortress: ${here} -> ${next} (toward ${goal}) from ${where(q)}`);
        await edge.go(q);
        if (fortressRoom(q) !== next) throw new Error(`fortress: ${here} -> ${next} landed at ${where(q)} (${fortressRoom(q) ?? 'unknown room'})`);
    }
    throw new Error(`fortress: no way to ${goal} from ${where(q)}`);
}

const HELM = /^bronze med helm$/i;
const CHAIN = /^iron chainbody$/i;

/** Wear the guard disguise the entrance door checks (bronze med helm + iron chainbody). */
export async function wearDisguise(q: Quest): Promise<void> {
    for (const item of [HELM, CHAIN]) {
        if (q.sdk.getEquipment().some((i) => item.test(i.name))) continue;
        const held = q.sdk.findInventoryItem(item);
        if (!held) throw new Error(`fortress: no ${item} to wear`);
        await q.bot.equipItem(held);
        if (!(await untilTicks(q.sdk, () => q.sdk.getEquipment().some((i) => item.test(i.name)), 5))) throw new Error(`fortress: could not wear ${held.name}`);
    }
}

/**
 * witchgrill op1 (quest_blackknight.rs2): the witch and the knight talk, and the
 * quest moves on after the last page. Done once a dialog was seen and closed;
 * the runner confirms the stage from the journal.
 */
export async function listenAtGrill(q: Quest): Promise<void> {
    await fortressTo(q, 'grill');
    await walk(q, { x: 3025, z: 3508 });
    let heard = false;
    const done = () => {
        heard ||= !!q.sdk.getDialog()?.isOpen;
        return heard && !q.sdk.getDialog()?.isOpen;
    };
    // Nine chatnpc pages; at 300-600ms ticks with latency they outran an 80-tick budget on
    // prod (jacklove2, ABGARMY10, 2026-10-29) and each retry restarted the conversation.
    await op(q, { x: 3025, z: 3507 }, /^grill$/i, /listen/i, done, 'listen at the grill', [], 400);
}

/** Use a cabbage on the hole above the witch's cauldron (blackknighthole, L1). */
export async function cabbageDownHole(q: Quest): Promise<void> {
    await fortressTo(q, 'hole');
    const start = q.count('cabbage');
    const done = () => q.count('cabbage') < start && !q.sdk.getDialog()?.isOpen;
    const HOLE = { x: 3031, z: 3507 };
    for (let attempt = 1; attempt <= 3 && !done(); attempt++) {
        const cabbage = q.sdk.findInventoryItem(/^cabbage$/i);
        if (!cabbage) throw new Error('fortress: no cabbage at the hole');
        await q.sdk.scanNearbyLocs(8).catch(() => undefined);
        const hole = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === HOLE.x && l.z === HOLE.z && /^hole$/i.test(l.name));
        if (!hole) throw new Error(`fortress: no hole at (${HOLE.x},${HOLE.z}) from ${where(q)}`);
        const before = q.count('cabbage');
        await q.sdk.sendUseItemOnLoc(cabbage.slot, HOLE.x, HOLE.z, hole.id);
        await untilTicks(q.sdk, (s) => q.count('cabbage') < before || !!s.dialog?.isOpen, 25);
        // "You drop a cabbage down the hole" ... then the player's line; the stage is set before it.
        await driveDialog(q.sdk, [], { done, ticks: 40, log: q.log });
        await untilTicks(q.sdk, done, 10);
        q.log(`fortress: cabbage down the hole (attempt ${attempt}): ${q.count('cabbage') < before ? 'dropped' : 'still held'}`);
    }
}

/** Out through the guard door from anywhere inside. */
export async function leaveFortress(q: Quest): Promise<void> {
    if (fortressRoom(q) === 'outside') return;
    await fortressTo(q, 'outside');
}
