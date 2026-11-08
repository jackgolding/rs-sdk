/**
 * Family Crest — Boot's dwarven mine, the perfect-gold mine east of Ardougne, the
 * perfect jewellery, Johnathon's cure and Chronozon under the Edgeville dungeon.
 *
 * Content facts (quest_crest/scripts/*.rs2, maps m42_151, m47_53, m47_153, m48_54,
 * m48_154, m48_155):
 *   - Boot (2965,9811) is in the Dwarven Mine: the open trapdoor at (3019,3450)
 *     lands on (3019,9850), whose ladder climbs back up
 *   - the perfect-gold mine: ladder (2696,3282) -> (2696,9682). The rocks (2737-2740,
 *     9683-9693, two hellhounds beside them) are behind famcrest_doori2h1 (2727,9690),
 *     which opens on north bit UP + south bit DOWN + room bit UP. The bit each lever
 *     sets is NOT its tile's name: (2722,9710) sets crest_north_lever, (2724,9669)
 *     crest_south_lever, (2722,9718) crest_north_room_lever. The south lever is behind
 *     the z=9671 doors (2722,9671: north UP + south DOWN; 2719,9671: north UP + south UP)
 *     and the room lever behind (2723,9711: north DOWN + south UP), so the pulls are a
 *     forced sequence (MINE_PLAN). A pulled lever's loc reverts after 500 ticks but the
 *     bit stays, so each pull is judged by its own "The lever is now up/down." message,
 *     never by the loc id. Doors teleport you through; a refusal says "This door is locked."
 *   - 'perfect' gold ore smelts with no menu; a 'perfect' gold bar on a furnace opens the
 *     jewellery interface (4161), whose rows are inventory components: ruby is slot 3 of
 *     rings_inv (4233) and necklaces_inv (4239); the bar turns a ruby ring/necklace into
 *     the 'perfect' one
 *   - Johnathon is upstairs in the Jolly Boar Inn (3279,3503,L1; stairs 3285,3493); any
 *     antipoison dose used on him at spoken_johnathon cures him
 *   - Chronozon (3087,9937) is in the Edgeville dungeon's wilderness (z >= 9920, level 3),
 *     behind the gates at (3103,9909), (3105,9944) and his own (3089,9945). He dies only
 *     once Wind, Water, Earth and Fire Blast have each landed ("Chronozon weakens...");
 *     otherwise he regenerates at 0 hp. His death drops Johnathon's crest part.
 *     Wilderness: single-way, but hunt modes there ignore combat level, so the poison
 *     spiders at his gate, the black demons north of it and Chronozon himself all attack.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, ticksToMs, untilTicks } from './ticks';
import { PrayerFlicker } from '../prayer-flick';
import type { NearbyNpc } from '../../../sdk/types';

interface Tile {
    x: number;
    z: number;
}

/** Obj ids (pack/obj.pack). The three crest parts share the name "Crest part". */
export const OBJ = {
    perfectOre: 446,
    perfectBar: 2365,
    perfectRing: 773,
    perfectNecklace: 774,
    /** Caleb's piece (the content swaps the names: Caleb hands out avan_crest). */
    calebPiece: 779,
    /** Avan's piece. */
    avanPiece: 780,
    /** Chronozon's drop. */
    johnathonPiece: 781,
    crest: 782,
} as const;

export const DIMINTHEIS = { x: 3279, z: 3404 };
/**
 * East Varrock's street, through the gate (3264,3405) west of Dimintheis' yard. A long
 * walkTo from the yard plans past that gate and sticks at (3275,3405); a short one
 * opens it (probe 2026-11-01).
 */
const VARROCK_EAST_STREET = { x: 3260, z: 3420 };
export const CALEB = { x: 2819, z: 3451 };
export const GEM_TRADER = { x: 3288, z: 3212 };
/** Avan stands among the scorpions north of Al Kharid; his npc is named "Man". */
export const AVAN = { x: 3295, z: 3285 };
const BOOT = { x: 2966, z: 9811 };
const DWARVEN_TRAPDOOR = { x: 3019, z: 3450 };
const DWARVEN_LADDER = { x: 3019, z: 9850 };
const MINE_LADDER = { x: 2696, z: 3282 };
const MINE_LANDING = { x: 2696, z: 9682 };
const GOLD_ROCKS: Tile[] = [
    { x: 2737, z: 9683 },
    { x: 2737, z: 9689 },
    { x: 2738, z: 9693 },
    { x: 2740, z: 9684 },
];
/** Al Kharid's furnace, then north to Avan. */
const FURNACE = { x: 3274, z: 3186 };
/** Lumbridge's side of the Al Kharid toll gate (3268,3227). */
const TOLL_APPROACH = { x: 3255, z: 3228 };
const JOLLY_BOAR_STAIRS = { x: 3285, z: 3493 };
export const JOHNATHON = { x: 3279, z: 3503, level: 1 };
const EDGE_TRAPDOOR = { x: 3097, z: 3468 };
const EDGE_LADDER = { x: 3096, z: 9867 };
/** The dungeon's gates north to Chronozon: (gate tile, a tile south of it, a tile north of it). */
const DUNGEON_GATES = [
    { gate: { x: 3103, z: 9909 }, south: { x: 3103, z: 9906 }, north: { x: 3104, z: 9913 } },
    // The pocket past the wilderness gate only leads on through this members' gate: walkTo
    // opens it going north but sticks behind it going south (3132,9924; crest-chron 2026-11-01).
    { gate: { x: 3131, z: 9917 }, south: { x: 3129, z: 9915 }, north: { x: 3131, z: 9920 } },
    { gate: { x: 3105, z: 9944 }, south: { x: 3106, z: 9941 }, north: { x: 3105, z: 9948 } },
];
const CHRON_GATE = { x: 3089, z: 9945 };
/** Outside (north of) Chronozon's gate, and inside it. */
const CHRON_OUTSIDE = { x: 3090, z: 9948 };
const CHRON_INSIDE = { x: 3089, z: 9941 };
const CHRONOZON = { x: 3087, z: 9937 };
/** South of his spawn, ~11 tiles from the spiders' spawns by the gate. */
const CHRON_FIGHT = { x: 3087, z: 9932 };

const JEWELLERY_IFACE = 4161;
const RINGS_INV = 4233;
const NECKLACES_INV = 4239;
const RUBY_SLOT = 3;

/** Four blasts (sdk/spells.ts component ids) and the runes one cast takes. */
export const BLASTS = [
    { name: 'Wind Blast', component: 1172, runes: { 'air rune': 3, 'death rune': 1 } },
    { name: 'Water Blast', component: 1175, runes: { 'air rune': 3, 'water rune': 3, 'death rune': 1 } },
    { name: 'Earth Blast', component: 1177, runes: { 'air rune': 3, 'earth rune': 4, 'death rune': 1 } },
    { name: 'Fire Blast', component: 1181, runes: { 'air rune': 4, 'fire rune': 5, 'death rune': 1 } },
] as const;
/**
 * Each blast twice (splashes) plus fire blasts for 60 hp, twice over: 8 + 24 casts. The
 * second kill is for a Chronozon another player finished first (his drop is his aggressor's;
 * our weakness bits stay set) — parallel gate runs on one world (crest-resume 2026-11-01).
 */
export const RUNE_NEEDS = [
    { item: 'death rune', count: 32 },
    { item: 'air rune', count: 120 },
    { item: 'water rune', count: 6 },
    // The damage casts are Earth Blasts (15 max against Fire Blast's 16): 120 fire runes cost ABGARMY09 2,350 coins at
    // Aubury, whose price climbs as his stock falls, and still came up short; jackthief banks earth runes, not fire
    // (2026-11-08). Two Fire Blasts' worth stays for the fire weakness; the blast picker falls back to Earth when fire runs out.
    { item: 'earth rune', count: 104 },
    { item: 'fire rune', count: 10 },
];
export const FOOD = { item: 'shark', count: 8 };
export const FISH = ['shrimps', 'salmon', 'tuna', 'bass', 'swordfish'];

const UNDER = 6400;
const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const cheb = (q: Quest, t: Tile) => Math.max(Math.abs(pos(q).x - t.x), Math.abs(pos(q).z - t.z));
export const holds = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id) || q.sdk.getEquipment().some((i) => i.id === id);
const countId = (q: Quest, id: number) => q.sdk.getInventory().filter((i) => i.id === id).reduce((n, i) => n + (i.count ?? 1), 0);

const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
export const inPerfectMine = (p: Tile) => inBox(p, 2688, 2750, 9660, 9725);
/**
 * Boot's end of the Dwarven Mine, up to the Oracle's magic door (3051,9840: lib/dragon-slayer.ts).
 * Its west tile (3050,9840) is inside: at 3045 goTo climbed out to walk there from the surface,
 * and jacklove13 wandered into the wilderness to 2949,3900 (2026-11-02).
 */
export const inDwarvenMine = (p: Tile) => inBox(p, 2940, 3050, 9790, 9860);
/** The Edgeville dungeon, from its ladder north to Chronozon (its wilderness starts at z 9920). */
export const inEdgeDungeon = (p: Tile) => inBox(p, 3075, 3145, 9860, 9980);
/** Underground places of this quest whose way up is out of a generic climb's sight. */
export const inCrestUnderground = (p: Tile) => inPerfectMine(p) || inDwarvenMine(p) || inEdgeDungeon(p);

function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function saidSince(q: Quest, since: number, text: RegExp): string | undefined {
    return (q.sdk.getState()?.gameMessages ?? []).find((m) => (m.observationId ?? m.tick) > since && text.test(m.text))?.text;
}

/**
 * One eat in flight at a time: the fight loop, fightOff and the guard's timer all call
 * this, and at 400 ms a tick the hp update trails the click by a tick or two, so without
 * the lock two or three sharks went for one dip (crest gate 2026-11-01: 19 sharks gone).
 */
let eating: Promise<void> | null = null;
export async function eatIfLow(q: Quest, below = 0.5): Promise<void> {
    if (eating) return eating;
    const p = q.sdk.getState()?.player;
    if (!p || p.hp > (p.maxHp ?? 10) * below) return;
    const food = q.sdk.getInventory().find((i) => i.optionsWithIndex?.some((o) => /^eat$/i.test(o.text)));
    if (!food) return;
    eating = (async () => {
        await q.bot.eatFood(food).catch(() => undefined);
    })().finally(() => (eating = null));
    return eating;
}

/** The loc named `name` (with option `opt`) nearest `at`, within `within` tiles of it. */
async function findLoc(q: Quest, at: Tile, name: RegExp, opt?: RegExp, within = 3) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => name.test(l.name) && (!opt || l.optionsWithIndex.some((o) => opt.test(o.text))))
        .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= within ? loc : undefined;
}

/** Op on the loc named `name` near `at` until `done`. */
async function op(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string, ticks = 30): Promise<void> {
    for (let attempt = 1; attempt <= 4; attempt++) {
        if (done()) return;
        await eatIfLow(q);
        const loc = await findLoc(q, at, name, opt);
        if (!loc) {
            q.log(`crest: ${label}: no ${name} with ${opt} near (${at.x},${at.z}) from ${where(q)} (attempt ${attempt})`);
            if (cheb(q, at) > 3) await q.goTo(at, 2).catch(() => undefined);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 40, log: q.log });
        if (await untilTicks(q.sdk, done, 8)) return;
        q.log(`crest: ${label} did not take from ${where(q)} (attempt ${attempt})`);
    }
    throw new Error(`crest: ${label} failed at ${where(q)}`);
}

/** Down a ladder/trapdoor at `at` into the z+6400 band. A closed trapdoor is opened first. */
async function descend(q: Quest, at: Tile, label: string): Promise<void> {
    if (pos(q).z >= UNDER) return;
    await q.goTo(at, 3);
    const closed = await findLoc(q, at, /^trapdoor$/i, /^open$/i);
    if (closed) await op(q, at, /^trapdoor$/i, /^open$/i, () => !!q.sdk.findNearbyLoc(/^trapdoor$/i, { withOption: /climb-down/i }), `open the ${label}`, 10).catch(() => undefined);
    await op(q, at, /^(ladder|trapdoor)$/i, /^climb-down$/i, () => pos(q).z >= UNDER, `down the ${label}`);
    q.log(`crest: down the ${label} to ${where(q)}`);
}

/** Up the ladder at `at` (underground) to the surface. */
async function ascend(q: Quest, at: Tile, label: string): Promise<void> {
    if (pos(q).z < UNDER) return;
    if (cheb(q, at) > 3) await q.goTo(at, 2);
    await op(q, at, /^ladder$/i, /^climb-up$/i, () => pos(q).z < UNDER, `up the ${label}`);
    q.log(`crest: up the ${label} to ${where(q)}`);
}

/** Out of this quest's undergrounds by their own ladders (run-quest's goTo calls this). */
export async function leaveCrestUnderground(q: Quest): Promise<void> {
    if (inPerfectMine(pos(q))) {
        // From the rock room or the lever pockets the doors are masked to walkTo: hop them.
        if (cheb(q, MINE_LANDING) > 3) await mineWalk(q, MINE_LANDING, 'back to the mine ladder');
        await ascend(q, MINE_LANDING, 'perfect-gold mine ladder');
    } else if (inDwarvenMine(pos(q))) {
        await ascend(q, DWARVEN_LADDER, 'Dwarven Mine ladder');
    } else if (inEdgeDungeon(pos(q))) {
        await southThroughDungeon(q);
        await ascend(q, EDGE_LADDER, 'Edgeville dungeon ladder');
    }
}

/** Out of Dimintheis' yard onto the street, so the next long walk starts from a routable tile. */
export async function leaveDimintheis(q: Quest): Promise<void> {
    if (pos(q).x < 3265 || cheb(q, DIMINTHEIS) > 12) return;
    const res = await q.bot.walkTo(VARROCK_EAST_STREET.x, VARROCK_EAST_STREET.z, 3);
    q.log(`crest: out of Dimintheis' yard to ${where(q)}${res.success ? '' : ` (${res.message})`}`);
}

// ── Boot

export async function askBoot(q: Quest): Promise<void> {
    if (!inDwarvenMine(pos(q))) await descend(q, DWARVEN_TRAPDOOR, 'Dwarven Mine trapdoor');
    await q.talk(/^boot$/i, [/very high quality gold/i], BOOT);
    await leaveCrestUnderground(q);
}

// ── the perfect-gold mine

/** Walk inside the mine; the doors are masked, so a refused walk is finished by raw steps. */
async function mineWalk(q: Quest, t: Tile, label: string, tolerance = 1): Promise<void> {
    if (cheb(q, t) <= tolerance) return;
    const res = await q.bot.walkTo(t.x, t.z, tolerance).catch((e) => ({ success: false, message: String(e) }));
    if (cheb(q, t) <= tolerance) return;
    for (let step = 0; step < 60 && cheb(q, t) > tolerance; step++) {
        const before = pos(q);
        const nx = before.x + Math.sign(t.x - before.x);
        const nz = before.z + Math.sign(t.z - before.z);
        const tries = [
            { x: nx, z: nz },
            { x: nx, z: before.z },
            { x: before.x, z: nz },
        ].filter((a) => a.x !== before.x || a.z !== before.z);
        let moved = false;
        for (const a of tries) {
            await q.sdk.sendWalk(a.x, a.z).catch(() => undefined);
            moved = await untilTicks(q.sdk, () => pos(q).x !== before.x || pos(q).z !== before.z, 4);
            if (moved) break;
        }
        if (!moved) break;
    }
    if (cheb(q, t) > tolerance + 1) throw new Error(`crest mine: ${label}: stuck at ${where(q)} short of (${t.x},${t.z}) (walkTo: ${res.message})`);
}

/** Pull the lever at `t` until its own message says it is `want`. Stands on or beside it. */
async function setLever(q: Quest, t: Tile, want: 'up' | 'down', label: string): Promise<void> {
    const stands: Array<[number, number]> = [
        [0, 0],
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
    ];
    for (let attempt = 0; attempt < 8; attempt++) {
        const [dx, dz] = stands[attempt % stands.length]!;
        await mineWalk(q, { x: t.x + dx, z: t.z + dz }, `${label} stand`, 0).catch((e) => q.log(`crest mine: ${(e as Error).message}`));
        await eatIfLow(q);
        await q.sdk.scanNearbyLocs(6).catch(() => undefined);
        const lever = (q.sdk.getNearbyLocs() ?? []).find((l) => /^lever$/i.test(l.name) && l.x === t.x && l.z === t.z);
        if (!lever) {
            q.log(`crest mine: ${label}: no lever at (${t.x},${t.z}) in view from ${where(q)}`);
            continue;
        }
        const c = cursor(q);
        await q.sdk.sendInteractLoc(t.x, t.z, lever.id, 1);
        await untilTicks(q.sdk, () => !!saidSince(q, c, /the lever is now (up|down)/i), 10);
        const said = saidSince(q, c, /the lever is now (up|down)/i);
        if (!said) {
            q.log(`crest mine: ${label}: pull from ${where(q)} took no effect (id ${lever.id})`);
            continue;
        }
        if (new RegExp(`now ${want}`, 'i').test(said)) {
            q.log(`crest mine: ${label}: lever (${t.x},${t.z}) ${want}`);
            return;
        }
        // It was already the other way (a pull from an earlier pass or another player): pull again.
        await q.sdk.waitForTicks(2);
    }
    throw new Error(`crest mine: ${label}: lever (${t.x},${t.z}) would not go ${want} from ${where(q)}`);
}

/** Through the masked door at `t` (it teleports you across). `side` says which side you must end on. */
async function throughDoor(q: Quest, t: Tile, side: (p: Tile) => boolean, label: string): Promise<void> {
    if (side(pos(q))) return;
    for (let attempt = 1; attempt <= 4; attempt++) {
        await q.sdk.scanNearbyLocs(6).catch(() => undefined);
        const door = (q.sdk.getNearbyLocs() ?? []).find((l) => /door/i.test(l.name) && l.x === t.x && l.z === t.z);
        if (!door) {
            q.log(`crest mine: ${label}: door (${t.x},${t.z}) not in view from ${where(q)}`);
            await mineWalk(q, t, `${label} approach`, 2).catch(() => undefined);
            continue;
        }
        const c = cursor(q);
        await q.sdk.sendInteractLoc(t.x, t.z, door.id, 1);
        await untilTicks(q.sdk, () => side(pos(q)) || !!saidSince(q, c, /door is locked/i), 12);
        if (side(pos(q))) {
            q.log(`crest mine: ${label}: through (${t.x},${t.z}) to ${where(q)}`);
            return;
        }
        if (saidSince(q, c, /door is locked/i)) throw new Error(`crest mine: ${label}: door (${t.x},${t.z}) is locked — the lever bits are wrong`);
        q.log(`crest mine: ${label}: door click from ${where(q)} did not move us (attempt ${attempt})`);
        await q.sdk.waitForTicks(2);
    }
    throw new Error(`crest mine: ${label}: could not pass door (${t.x},${t.z}) from ${where(q)}`);
}

const NORTH_LEVER = { x: 2722, z: 9710 };
const SOUTH_LEVER = { x: 2724, z: 9669 };
const ROOM_LEVER = { x: 2722, z: 9718 };
const CORRIDOR_DOOR = { x: 2722, z: 9671 };
const H2_DOOR = { x: 2719, z: 9671 };
const ROOM_DOOR = { x: 2723, z: 9711 };
const ROCK_DOOR = { x: 2727, z: 9690 };
/**
 * Door sides (door_procs.rs2 check_axis): a door's own tile is on the far side of its
 * wall. The z=9671 doors' walls face north, so (x,9671) is in the south lever's pocket;
 * the lever room's (2723,9711) faces south, so 9711 is in the room; the rock door's
 * (2727,9690) faces east, so 2727 is the main cave and 2728 the rock room.
 */
const inSouthPocket = (p: Tile) => p.z <= 9671 && p.x >= 2714 && p.x <= 2730;
const inLeverRoom = (p: Tile) => p.z >= 9711 && p.x >= 2714 && p.x <= 2730;
const inRockRoom = (p: Tile) => p.x >= 2728 && p.z >= 9680 && p.z <= 9700;
const inMineMain = (p: Tile) => inPerfectMine(p) && !inSouthPocket(p) && !inLeverRoom(p) && !inRockRoom(p);

/**
 * Lever and door order, forced by the door conditions (quest_crest.rs2): the south
 * lever's pocket needs north UP, the lever room needs north DOWN + south UP, the rock
 * door north UP + south DOWN + room UP. Measured live with the old crest probes.
 */
async function solveMine(q: Quest): Promise<void> {
    if (inRockRoom(pos(q))) return;
    if (!inMineMain(pos(q))) {
        // Restarted in a pocket: out by whichever door lets us (bits unknown — try both ways).
        if (inLeverRoom(pos(q))) await throughDoor(q, ROOM_DOOR, inMineMain, 'out of the lever room').catch((e) => q.log((e as Error).message));
        if (inSouthPocket(pos(q))) {
            await throughDoor(q, CORRIDOR_DOOR, inMineMain, 'out of the south pocket').catch(() => throughDoor(q, H2_DOOR, inMineMain, 'out of the south pocket (west)'));
        }
    }
    await setLever(q, NORTH_LEVER, 'up', 'north UP');
    await mineWalk(q, { x: 2722, z: 9673 }, 'corridor, by the z=9671 doors');
    await throughDoor(q, CORRIDOR_DOOR, inSouthPocket, 'into the south pocket (north UP, south DOWN)');
    await setLever(q, SOUTH_LEVER, 'up', 'south UP');
    await throughDoor(q, H2_DOOR, (p) => !inSouthPocket(p), 'out of the south pocket (north UP, south UP)');
    await setLever(q, NORTH_LEVER, 'down', 'north DOWN');
    await throughDoor(q, ROOM_DOOR, inLeverRoom, 'into the lever room (north DOWN, south UP)');
    await setLever(q, ROOM_LEVER, 'up', 'room UP');
    await throughDoor(q, ROOM_DOOR, (p) => !inLeverRoom(p), 'out of the lever room');
    await setLever(q, NORTH_LEVER, 'up', 'north UP again');
    await mineWalk(q, { x: 2719, z: 9673 }, 'corridor, by the west z=9671 door');
    await throughDoor(q, H2_DOOR, inSouthPocket, 'into the south pocket (north UP, south UP)');
    await setLever(q, SOUTH_LEVER, 'down', 'south DOWN');
    await throughDoor(q, CORRIDOR_DOOR, (p) => !inSouthPocket(p), 'out of the south pocket (north UP, south DOWN)');
    await mineWalk(q, { x: 2727, z: 9692 }, 'by the rock door');
    await throughDoor(q, ROCK_DOOR, inRockRoom, 'into the rock room (north UP, south DOWN, room UP)');
}

/** Gold ore, bars and jewellery made so far count toward the two pieces. */
const goldMade = (q: Quest) => countId(q, OBJ.perfectOre) + countId(q, OBJ.perfectBar) + countId(q, OBJ.perfectRing) + countId(q, OBJ.perfectNecklace);

/** Two 'perfect' gold ores (fewer once bars or jewellery are held), then up the ladder. */
export async function minePerfectGold(q: Quest): Promise<void> {
    if (goldMade(q) >= 2) return;
    // Hellhounds (melee) by the rocks: at Mining 40 the rocks take many swings, so pray too.
    return withGuard(q, null, inPerfectMine, () => minePerfectGoldInner(q), true);
}

async function minePerfectGoldInner(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    if (!inPerfectMine(pos(q))) await descend(q, MINE_LADDER, 'perfect-gold mine ladder');
    await solveMine(q);
    for (let round = 0; round < 12 && goldMade(q) < 2; round++) {
        const rock = GOLD_ROCKS[round % GOLD_ROCKS.length]!;
        await eatIfLow(q);
        await q.sdk.scanNearbyLocs(10).catch(() => undefined);
        const loc = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === rock.x && l.z === rock.z && l.optionsWithIndex.some((o) => /^mine$/i.test(o.text)));
        if (!loc) {
            await q.sdk.waitForTicks(3);
            continue;
        }
        const before = countId(q, OBJ.perfectOre);
        await q.bot.interactLoc(loc, /^mine$/i).catch(() => undefined);
        await untilTicks(q.sdk, () => countId(q, OBJ.perfectOre) > before, 40);
        q.log(`crest mine: rock (${rock.x},${rock.z}): ore ${countId(q, OBJ.perfectOre)}`);
    }
    if (goldMade(q) < 2) throw new Error(`crest mine: only ${goldMade(q)} perfect gold after the rocks (at ${where(q)})`);
    q.log(`crest mine: ${countId(q, OBJ.perfectOre)} perfect gold ore in ${tickNow(q.sdk) - t0}t`);
    // Back through the rock door (the bits still hold) to the ladder.
    await throughDoor(q, ROCK_DOOR, (p) => !inRockRoom(p), 'out of the rock room');
    await leaveCrestUnderground(q);
}

/** Smelt the ores, then a perfect ring and necklace at Al Kharid's furnace. */
export async function makeJewellery(q: Quest): Promise<void> {
    if (holds(q, OBJ.perfectRing) && holds(q, OBJ.perfectNecklace)) return;
    // From the Ardougne mine the toll helper starts too far off to find the border guard
    // and walkTo then sticks at the fence (3267,3227): come to the gate first.
    if (pos(q).x < TOLL_APPROACH.x - 30) await q.goTo(TOLL_APPROACH, 5);
    await q.goTo(FURNACE, 3);
    const furnace = async () => {
        const f = await findLoc(q, FURNACE, /^furnace$/i, undefined, 6);
        if (!f) throw new Error(`crest: no furnace near (${FURNACE.x},${FURNACE.z}) from ${where(q)}`);
        return f;
    };
    for (let i = 0; i < 6 && countId(q, OBJ.perfectOre) > 0; i++) {
        const ore = q.sdk.getInventory().find((it) => it.id === OBJ.perfectOre)!;
        const f = await furnace();
        const before = countId(q, OBJ.perfectBar);
        await q.sdk.sendUseItemOnLoc(ore.slot, f.x, f.z, f.id);
        await untilTicks(q.sdk, () => countId(q, OBJ.perfectBar) > before, 20);
    }
    q.log(`crest: smelted — bars ${countId(q, OBJ.perfectBar)}, ore ${countId(q, OBJ.perfectOre)}`);
    for (const [product, component] of [
        [OBJ.perfectRing, RINGS_INV],
        [OBJ.perfectNecklace, NECKLACES_INV],
    ] as const) {
        for (let attempt = 1; attempt <= 3 && !holds(q, product); attempt++) {
            const bar = q.sdk.getInventory().find((it) => it.id === OBJ.perfectBar);
            if (!bar) throw new Error(`crest: no perfect gold bar left for obj ${product}`);
            const f = await furnace();
            await q.sdk.sendUseItemOnLoc(bar.slot, f.x, f.z, f.id);
            if (!(await untilTicks(q.sdk, (s) => !!s.interface?.isOpen && s.interface.interfaceId === JEWELLERY_IFACE, 15))) {
                q.log(`crest: jewellery interface did not open (attempt ${attempt})`);
                continue;
            }
            await q.sdk.sendClickComponentWithOption(component, 1, RUBY_SLOT);
            await untilTicks(q.sdk, () => holds(q, product), 15);
        }
        if (!holds(q, product)) throw new Error(`crest: could not craft obj ${product} (rubies ${q.count('ruby')}, bars ${countId(q, OBJ.perfectBar)})`);
    }
    await q.bot.closeInterface().catch(() => undefined);
    q.log('crest: made the perfect ring and necklace');
}

// ── Johnathon

export async function toJohnathon(q: Quest): Promise<void> {
    if (pos(q).level !== 1) {
        await q.goTo(JOLLY_BOAR_STAIRS, 2);
        await q.climbTo(1, JOHNATHON);
    }
    await q.goTo(JOHNATHON, 3);
}

/** An antipoison (any dose) on Johnathon, then his talk (Chronozon's lair). */
export async function cureJohnathon(q: Quest): Promise<void> {
    await toJohnathon(q);
    const potion = q.sdk.getInventory().find((i) => /^antipoison\(\d\)$/i.test(i.name));
    if (!potion) throw new Error(`crest: no antipoison to cure Johnathon (carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
    const john = q.sdk.findNearbyNpc(/^johnathon$/i);
    if (!john) throw new Error(`crest: Johnathon not in view at ${where(q)}`);
    const res = await q.bot.useItemOnNpc(potion, john);
    if (!res.success) q.log(`crest: antipoison on Johnathon: ${res.message}`);
    await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 10);
    await driveDialog(q.sdk, [/on my way now/i, /where can i find chronozon/i], { log: q.log });
}

// ── Chronozon

/** Through a dungeon gate toward `to` ('north' or 'south'): walkTo masks gates, so click it. */
async function gate(q: Quest, g: (typeof DUNGEON_GATES)[number], dir: 'north' | 'south'): Promise<void> {
    const past = (p: Tile) => (dir === 'north' ? p.z > g.gate.z : p.z < g.gate.z);
    if (past(pos(q))) return;
    const before = dir === 'north' ? g.south : g.north;
    const after = dir === 'north' ? g.north : g.south;
    await q.goTo(before, 2);
    const res = await q.bot.walkTo(after.x, after.z, 1).catch(() => ({ success: false }));
    if (res.success && past(pos(q))) return;
    for (let attempt = 1; attempt <= 4 && !past(pos(q)); attempt++) {
        const loc = await findLoc(q, g.gate, /^gate$/i, /^open$/i, 2);
        if (loc) {
            await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
            await q.sdk.waitForTicks(3);
        }
        await q.bot.walkTo(after.x, after.z, 1).catch(() => undefined);
    }
    if (!past(pos(q))) throw new Error(`crest: could not pass the dungeon gate (${g.gate.x},${g.gate.z}) going ${dir} (at ${where(q)})`);
}

/** Back from Chronozon's room to the dungeon's ladder. */
async function southThroughDungeon(q: Quest): Promise<void> {
    if (!inEdgeDungeon(pos(q))) return;
    if (pos(q).z <= CHRON_GATE.z && pos(q).x <= 3095 && pos(q).z >= 9925) await chronGate(q, 'out');
    for (const g of [...DUNGEON_GATES].reverse()) {
        // Died on the way (respawned on the surface): the caller restarts from there.
        if (!inEdgeDungeon(pos(q))) return;
        await gate(q, g, 'south');
    }
    if (inEdgeDungeon(pos(q))) await q.goTo(EDGE_LADDER, 2);
}

const inChronRoom = (p: Tile) => p.x <= 3095 && p.z >= 9925 && p.z < CHRON_GATE.z;

async function chronGate(q: Quest, dir: 'in' | 'out'): Promise<void> {
    const done = (p: Tile) => (dir === 'in' ? inChronRoom(p) : !inChronRoom(p));
    if (done(pos(q))) return;
    const from = dir === 'in' ? CHRON_OUTSIDE : CHRON_INSIDE;
    const to = dir === 'in' ? CHRON_INSIDE : CHRON_OUTSIDE;
    if (cheb(q, from) > 2) await q.goTo(from, 2);
    for (let attempt = 1; attempt <= 5 && !done(pos(q)); attempt++) {
        await eatIfLow(q);
        const loc = await findLoc(q, CHRON_GATE, /^gate$/i, /^open$/i, 2);
        if (loc) {
            await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
            await untilTicks(q.sdk, () => done(pos(q)), 6);
        }
        if (!done(pos(q))) await q.bot.walkTo(to.x, to.z, 1).catch(() => undefined);
    }
    if (!done(pos(q))) throw new Error(`crest: could not get ${dir} through Chronozon's gate (at ${where(q)})`);
    q.log(`crest: ${dir} through Chronozon's gate to ${where(q)}`);
}

/** Edgeville bank, beside the trapdoor. */
const EDGE_BANK = { x: 3094, z: 3492 };
/**
 * Sharks to go in with. The pack is the five rune stacks, CHRON_ANTIPOISON potions and
 * sharks — 20 fill it; the crest parts wait in Edgeville bank, and his drop takes the slot
 * of a shark eaten for it.
 */
export const CHRON_SHARKS = 20;
/** Antipoison potions (any dose) for the leg: one 400 ms fight was poisoned three times. */
export const CHRON_ANTIPOISON = 3;
/** Fewer than this after the Edgeville top-up and the leg is not walked: NEEDS STOCK instead. */
const CHRON_MIN_SHARKS = 14;
/** Chronozon and the spiders are melee: Protect from Melee zeroes their hits (npc_combat_melee.rs2). */
const PROTECT_MELEE_LEVEL = 43;
const POISONED = /you have been poisoned/i;
const DRANK_ANTIPOISON = /drink some of your antipoison/i;
const ANTIPOISON = /^antipoison\(\d\)$/i;
/**
 * What the Chronozon leg keeps in the pack at Edgeville bank. Everything else is banked —
 * Caleb's and Avan's crest parts too, so a death in the wilderness does not lose them.
 */
const LEG_KEEP = (name: string) => /^(shark|air rune|water rune|earth rune|fire rune|death rune)$/i.test(name) || ANTIPOISON.test(name);
/** Set once Caleb's and Avan's parts are seen into Edgeville bank this run. */
let partsBanked = false;

/** The Edgeville dungeon's wilderness (gate 3103,9909 north): poison spiders and Chronozon. */
const inDungeonWild = (p: Tile) => inEdgeDungeon(p) && p.z >= 9917;
const lifeId = (q: Quest) => q.sdk.getState()?.player?.lifeId ?? 0;
const hpFrac = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return p ? p.hp / (p.maxHp || 10) : 1;
};
const hpText = (q: Quest) => `${q.sdk.getState()?.player?.hp}/${q.sdk.getState()?.player?.maxHp} hp`;
const sharks = (q: Quest) => q.count('shark');
const potions = (q: Quest) => q.sdk.getInventory().filter((i) => ANTIPOISON.test(i.name));

/**
 * Poison is not in the state: the newer of "You have been poisoned!" (sent only when a
 * clean account is poisoned) and an antipoison sip decides. Severity 27 from a poison
 * spider deals 6 down to 1 a hit, 87 hp in all (poison.rs2) — lethal with no food.
 */
class PoisonWatch {
    seen: number;
    poisoned = false;
    constructor(private q: Quest) {
        this.seen = cursor(q);
    }
    update(): boolean {
        const msgs = (this.q.sdk.getState()?.gameMessages ?? []).filter((m) => (m.observationId ?? m.tick) > this.seen).sort((a, b) => (a.observationId ?? a.tick) - (b.observationId ?? b.tick));
        for (const m of msgs) {
            if (POISONED.test(m.text)) this.poisoned = true;
            else if (DRANK_ANTIPOISON.test(m.text)) this.poisoned = false;
            this.seen = Math.max(this.seen, m.observationId ?? m.tick);
        }
        return this.poisoned;
    }
}

let drinking = false;
/** The lowest-dose antipoison (keeps the slots down); true once its sip message arrives. One sip in flight. */
async function drinkAntipoison(q: Quest, why: string): Promise<boolean> {
    if (drinking) return false;
    const pot = potions(q).sort((a, b) => a.name.localeCompare(b.name))[0];
    if (!pot) return false;
    drinking = true;
    try {
        const opt = pot.optionsWithIndex?.find((o) => /^drink$/i.test(o.text));
        const c = cursor(q);
        await q.sdk.sendUseItem(pot.slot, opt?.opIndex ?? 1).catch(() => undefined);
        const ok = await untilTicks(q.sdk, () => !!saidSince(q, c, DRANK_ANTIPOISON), 5);
        q.log(`crest: ${pot.name} ${ok ? 'drunk' : 'NOT drunk'} (${why}) at ${hpText(q)}`);
        return ok;
    } finally {
        drinking = false;
    }
}

/**
 * Beside a fight leg: eat under 60%, drink antipoison while poisoned (when watched), and
 * keep Protect from Melee up inside `zone` (Prayer 43+), off outside it. The prayer is
 * re-flicked (bots/quests/prayer-flick.ts) so it costs no points: held on, a 99-prayer
 * account was at 0 points midway through Chronozon at 400 ms and ate his hits.
 */
async function withGuard<T>(q: Quest, poison: PoisonWatch | null, zone: (p: Tile) => boolean, fn: () => Promise<T>, hold = false): Promise<T> {
    const flick = q.level('prayer') >= PROTECT_MELEE_LEVEL ? new PrayerFlicker(q.sdk, q.log, { flick: true }) : null; // as gated: flicks while walking, held (steady) through casts and fights
    // A switch-on clears the pending action (the mine's pick swung 7 times for no ore): held there.
    if (flick && hold) flick.steady = true;
    guardFlick = flick;
    holdDepth = 0;
    let busy = false;
    const tick = async () => {
        const me = q.sdk.getState()?.player;
        if (!me || me.isDead || me.hp <= 0) return;
        flick?.set(zone(pos(q)) ? 'protect_from_melee' : null);
        poison?.update();
        if (hpFrac(q) <= 0.6) await eatIfLow(q, 0.6);
        else if (poison?.poisoned && (await drinkAntipoison(q, 'poisoned'))) poison.poisoned = false;
    };
    const timer = setInterval(() => {
        if (busy) return;
        busy = true;
        tick()
            .catch(() => undefined)
            .finally(() => (busy = false));
    }, 300);
    try {
        return await fn();
    } finally {
        clearInterval(timer);
        if (guardFlick === flick) guardFlick = null;
        flick?.set(null);
        await q.sdk.waitForTicks(2).catch(() => undefined);
        if (q.sdk.isPrayerActive('protect_from_melee')) await q.bot.deactivatePrayer('protect_from_melee').catch(() => undefined);
    }
}

/** The running guard's flicker, for {@link steadily}. */
let guardFlick: PrayerFlicker | null = null;
let holdDepth = 0;
let savedSteady = false;
/**
 * Hold the prayer on (no flicking) through `fn`. Every prayer switch-on runs
 * p_clearpendingaction (prayers/*.rs2): a flick cancels a pending blast, melee attack or
 * pick swing — half the casts showed "no evidence" and the mine's rocks gave nothing.
 */
async function steadily<T>(fn: () => Promise<T>): Promise<T> {
    const f = guardFlick;
    if (!f) return fn();
    if (holdDepth++ === 0) {
        savedSteady = f.steady;
        f.steady = true;
    }
    try {
        return await fn();
    } finally {
        if (--holdDepth === 0 && guardFlick === f) f.steady = savedSteady;
    }
}

/** Eat (bank shut) until `frac` of max hp or out of sharks. */
async function eatUpTo(q: Quest, frac: number, max = 10): Promise<void> {
    for (let i = 0; i < max && hpFrac(q) < frac && sharks(q) > 0; i++) {
        const before = sharks(q);
        await eatIfLow(q, frac);
        await untilTicks(q.sdk, () => sharks(q) < before, 4);
    }
}

/** Before a walk out: cured, and fed to ~90% (eating the pack down if it must). */
async function readyForWalkOut(q: Quest, poison: PoisonWatch): Promise<void> {
    if (poison.update()) {
        if (await drinkAntipoison(q, 'before the walk out')) poison.poisoned = false;
        else q.log('crest: WARN poisoned with no antipoison for the walk out');
    }
    await eatUpTo(q, 0.9);
    q.log(`crest: walking out at ${hpText(q)} with ${sharks(q)} sharks, ${potions(q).length} antipoison${poison.poisoned ? ', poisoned' : ''}`);
}

/**
 * At Edgeville bank before going down: eat up, bank whatever the leg does not use (the
 * crest parts included), top runes back up to RUNE_NEEDS, antipoison to CHRON_ANTIPOISON
 * potions and sharks to CHRON_SHARKS. Arriving hurt or poisoned (a retreat), it eats and
 * drinks with the bank shut and tops up again. Short of CHRON_MIN_SHARKS the leg is not
 * walked: NEEDS STOCK.
 */
async function stockForChronozon(q: Quest, poison: PoisonWatch): Promise<void> {
    await q.goTo(EDGE_BANK, 4);
    await eatUpTo(q, 0.8, 4);
    for (let pass = 1; pass <= 3; pass++) {
        const opened = await q.bot.openBank();
        if (!opened.success) throw new Error(`crest: Edgeville bank would not open: ${opened.message}`);
        for (const it of [...q.sdk.getInventory()]) {
            if (LEG_KEEP(it.name) || !q.sdk.getInventory().some((i) => i.slot === it.slot && i.id === it.id)) continue;
            await q.bot.depositItem(it, -1).catch(() => undefined);
        }
        await q.sdk.waitForTicks(2);
        if (!holds(q, OBJ.calebPiece) && !holds(q, OBJ.avanPiece) && q.sdk.getBankItems().some((b) => b.id === OBJ.calebPiece) && q.sdk.getBankItems().some((b) => b.id === OBJ.avanPiece)) {
            if (!partsBanked) q.log("crest: Caleb's and Avan's crest parts banked at Edgeville for the leg");
            partsBanked = true;
        }
        for (const need of RUNE_NEEDS) {
            const banked = q.sdk.findBankItem(new RegExp(`^${need.item}$`, 'i'));
            const take = Math.min(need.count - q.count(need.item), banked?.count ?? 0);
            if (banked && take > 0) await q.bot.withdrawItem(banked, take);
        }
        for (let i = 0; i < CHRON_ANTIPOISON && potions(q).length < CHRON_ANTIPOISON; i++) {
            // Fullest first: 3-dose potions are the mule's.
            const pot = q.sdk
                .getBankItems()
                .filter((b) => ANTIPOISON.test(b.name))
                .sort((a, b) => b.name.localeCompare(a.name))[0];
            if (!pot) break;
            const before = potions(q).length;
            await q.bot.withdrawItem(pot, 1);
            await untilTicks(q.sdk, () => potions(q).length > before, 4);
        }
        await q.sdk.waitForTicks(2);
        const want = Math.min(CHRON_SHARKS, sharks(q) + 28 - q.sdk.getInventory().length);
        const banked = q.sdk.findBankItem(/^shark$/i);
        if (banked && sharks(q) < want) {
            // Unstackable: withdrawItem takes them one slot each.
            await q.bot.withdrawItem(banked, Math.min(want - sharks(q), banked.count));
            await untilTicks(q.sdk, () => sharks(q) >= want, 6);
        }
        await q.bot.closeBank().catch(() => undefined);
        const hurt = hpFrac(q) < 0.85;
        const drank = poison.update() && (await drinkAntipoison(q, 'at Edgeville bank'));
        if (drank) poison.poisoned = false;
        if (hurt) await eatUpTo(q, 0.95);
        // Eaten or drunk with the bank shut: top up once more.
        if (!(hurt || drank) || pass === 3) break;
    }
    q.log(`crest: Edgeville bank — ${sharks(q)} sharks, ${potions(q).map((i) => i.name).join(', ') || 'no antipoison'} for Chronozon at ${hpText(q)}`);
    if (sharks(q) < CHRON_MIN_SHARKS) {
        const NeedsStock = (await import('./run-quest')).NeedsStock;
        throw new NeedsStock([{ item: 'shark', count: CHRON_SHARKS - sharks(q) }]);
    }
    const shortRune = RUNE_NEEDS.find((n) => q.count(n.item) < Math.min(n.count, 10));
    if (shortRune) throw new Error(`crest: only ${q.count(shortRune.item)} ${shortRune.item} for Chronozon after Edgeville bank`);
}

/** Caleb's and Avan's parts back out of Edgeville bank once Chronozon's is held. */
async function fetchCrestParts(q: Quest): Promise<void> {
    const missing = () => [OBJ.calebPiece, OBJ.avanPiece].filter((id) => !holds(q, id));
    if (!missing().length) return;
    await q.goTo(EDGE_BANK, 4);
    const opened = await q.bot.openBank();
    if (!opened.success) throw new Error(`crest: Edgeville bank would not open for the crest parts: ${opened.message}`);
    for (const id of missing()) {
        const banked = q.sdk.getBankItems().find((b) => b.id === id);
        if (!banked) continue;
        if (q.sdk.getInventory().length >= 28) {
            const shark = q.sdk.getInventory().find((i) => /^shark$/i.test(i.name));
            if (shark) await q.bot.depositItem(shark, -1).catch(() => undefined);
        }
        await q.bot.withdrawItem(banked, 1);
        await untilTicks(q.sdk, () => holds(q, id), 6);
    }
    await q.bot.closeBank().catch(() => undefined);
    if (missing().length) throw new Error(`crest: crest part(s) ${missing().join(', ')} neither held nor in Edgeville bank`);
    q.log("crest: Caleb's and Avan's crest parts back out of Edgeville bank");
}

async function toChronozon(q: Quest, poison: PoisonWatch): Promise<void> {
    if (!inEdgeDungeon(pos(q))) {
        await stockForChronozon(q, poison);
        await descend(q, EDGE_TRAPDOOR, 'Edgeville trapdoor');
    }
    for (const g of DUNGEON_GATES) {
        await eatIfLow(q);
        await gate(q, g, 'north');
    }
    await q.goTo(CHRON_OUTSIDE, 2);
    if (!inChronRoom(pos(q))) {
        // A spider on us out here would hold us (single-way, 8 ticks) through the gate.
        await fightOff(q, "outside Chronozon's gate");
        // The spiders round his gate poison on any landed bite, prayer or not: start immune.
        if (await drinkAntipoison(q, 'at the spiders round his gate')) poison.poisoned = false;
    }
    await chronGate(q, 'in');
    // The spiders spawn round the gate (m48_155: 3088,9945 3089,9943 3090,9944): fight from
    // the far side of his spawn, where he finds us first and holds them off.
    const res = await q.bot.walkTo(CHRON_FIGHT.x, CHRON_FIGHT.z, 2).catch((e) => ({ success: false, message: String(e) }));
    q.log(`crest: to the far side of Chronozon's room at ${where(q)}${res.success ? '' : ` (${res.message})`}`);
}

// ── single-way combat with Chronozon's spiders
//
// player_in_combat_check (player_combat.rs2): an npc that attacked us in the last 8 ticks
// holds us — any other npc is refused "I'm already under attack!" — until it dies (its
// death clears %lastcombat) or 8 ticks pass without its swing. npc_check_notcombat keeps
// every other npc off us the same way. So whichever of Chronozon and a spider swings
// first owns us: a spider has to be killed before a blast can go, and once Chronozon is
// on us the spiders cannot touch us.

const isChronozon = (n: NearbyNpc) => /^chronozon$/i.test(n.name);
/** Chebyshev distance from us to the nearest tile of the npc's footprint. */
function npcCheb(q: Quest, n: NearbyNpc): number {
    const p = pos(q);
    const x0 = n.tileX ?? n.x;
    const z0 = n.tileZ ?? n.z;
    const size = n.size ?? 1;
    const dx = p.x < x0 ? x0 - p.x : p.x > x0 + size - 1 ? p.x - (x0 + size - 1) : 0;
    const dz = p.z < z0 ? z0 - p.z : p.z > z0 + size - 1 ? p.z - (z0 + size - 1) : 0;
    return Math.max(dx, dz);
}
/** Face entities >= 32768 are players; in his room that is us (or a rival bot beside us). */
const facesPlayer = (n: NearbyNpc) => n.targetIndex >= 32768;
const facedNpc = (q: Quest) => {
    const c = q.sdk.getState()?.player?.combat;
    return c?.targetType === 'npc' ? c.targetIndex : -1;
};
/** Npcs other than Chronozon on us: the one we face, or one beside us facing a player. */
function attackers(q: Quest): NearbyNpc[] {
    const faced = facedNpc(q);
    return (q.sdk.getNearbyNpcs() ?? [])
        .filter((n) => !isChronozon(n) && n.hp !== 0 && (n.index === faced || (npcCheb(q, n) <= 1 && facesPlayer(n))))
        .sort((a, b) => npcCheb(q, a) - npcCheb(q, b));
}
function chronozonOnUs(q: Quest): boolean {
    const boss = (q.sdk.getNearbyNpcs() ?? []).find(isChronozon);
    return !!boss && (boss.index === facedNpc(q) || (npcCheb(q, boss) <= 1 && facesPlayer(boss)));
}
const npcText = (q: Quest, n: NearbyNpc) => `${n.name} #${n.index} at (${n.tileX ?? n.x},${n.tileZ ?? n.z}) ${npcCheb(q, n)} off, facing ${n.targetIndex}, hp ${n.hp ?? '?'}`;

type KillResult = 'killed' | 'gone' | 'refused' | 'unreachable' | 'low' | 'died' | 'timeout';

/**
 * Melee `foe` until it dies. The attack is re-sent whenever we are not facing it (a click
 * lost to lag or a walk), and the fight is given up once it is neither ours nor on us for
 * 12 ticks (it wandered off), or the server refuses (something else holds us).
 */
/** Prayer held through the fight: a flick would cancel each swing (see steadily). */
async function killNpc(q: Quest, foe: NearbyNpc): Promise<KillResult> {
    return steadily(() => killNpcInner(q, foe));
}
async function killNpcInner(q: Quest, foe: NearbyNpc): Promise<KillResult> {
    const t0 = tickNow(q.sdk);
    const life = lifeId(q);
    let lastAttack = -100;
    let lastEngaged = t0;
    while (tickNow(q.sdk) - t0 < 300) {
        const s = q.sdk.getState();
        if (!s || s.player?.isDead || lifeId(q) !== life) return 'died';
        const cur = s.nearbyNpcs.find((n) => n.index === foe.index);
        if (!cur || cur.hp === 0) return 'killed';
        const now = tickNow(q.sdk);
        const ours = facedNpc(q) === foe.index;
        if (ours || (npcCheb(q, cur) <= 1 && facesPlayer(cur))) lastEngaged = now;
        else if (now - lastEngaged > 12) return 'gone';
        if (hpFrac(q) < 0.35 && sharks(q) === 0) return 'low';
        if (!ours && now - lastAttack >= 6) {
            lastAttack = now;
            const c = cursor(q);
            const r = await q.bot.attack(cur, ticksToMs(6)).catch((e) => ({ success: false, message: String(e), reason: 'error' }));
            if (!r.success) {
                if (('reason' in r && r.reason === 'already_in_combat') || saidSince(q, c, /already under attack|someone else is fighting/i)) return 'refused';
                if ('reason' in r && r.reason === 'out_of_reach') return 'unreachable';
            }
            continue;
        }
        await q.sdk.waitForTicks(1);
    }
    return 'timeout';
}

/**
 * Kill whatever (not Chronozon) is on us. True once nothing is — or Chronozon himself
 * holds us, so a blast can go; false on a death or with no food left.
 */
async function fightOff(q: Quest, why: string): Promise<boolean> {
    const t0 = tickNow(q.sdk);
    for (let n = 0; n < 8 && tickNow(q.sdk) - t0 < 900; n++) {
        const foe = attackers(q)[0];
        if (!foe) return true;
        const t1 = tickNow(q.sdk);
        q.log(`crest: fighting off ${npcText(q, foe)} from ${where(q)} (${why}) at ${hpText(q)}`);
        const r = await killNpc(q, foe);
        q.log(`crest: ${foe.name} #${foe.index} ${r} in ${tickNow(q.sdk) - t1}t, ${hpText(q)}, ${sharks(q)} sharks`);
        if (r === 'died' || r === 'low') return false;
        if (r === 'refused' || r === 'unreachable') {
            if (chronozonOnUs(q)) return true;
            // Held by something we cannot see as an attacker: the 8-tick lock runs out.
            await q.sdk.waitForTicks(4);
        }
    }
    return attackers(q).length === 0;
}

/**
 * Before the first blast: kill any spider already on us (from the far side of the room
 * Chronozon usually gets to us first). Hunting the rest is not worth it: they respawn
 * in 60 ticks, and melee with the prayer held costs points (fast run: 300t, none killed).
 */
async function clearRoomSpiders(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    await untilTicks(q.sdk, () => chronozonOnUs(q) || attackers(q).length > 0, 8);
    if (attackers(q).length) await fightOff(q, 'before the first blast');
    q.log(`crest: room — ${chronozonOnUs(q) ? 'Chronozon on us' : 'no attacker'} after ${tickNow(q.sdk) - t0}t, ${hpText(q)}`);
}

const runesFor = (q: Quest, b: (typeof BLASTS)[number]) => Object.entries(b.runes).every(([r, n]) => q.count(r) >= n);

/**
 * Each blast until it lands ("Chronozon weakens..."), then Fire Blast (any blast left)
 * until he dies, and his crest part off the floor. A retreat (food low) or a death sends
 * the leg back to Edgeville bank once more; the other two parts wait in that bank, so a
 * death only costs the pack. The parts come back out once his is held.
 */
export async function killChronozon(q: Quest): Promise<void> {
    const poison = new PoisonWatch(q);
    for (let leg = 1; leg <= 3 && !holds(q, OBJ.johnathonPiece) && !holds(q, OBJ.crest); leg++) {
        const life = lifeId(q);
        let outcome: 'killed' | 'retreated' | 'died';
        try {
            outcome = await withGuard(q, poison, inDungeonWild, async () => {
                const r = await killChronozonInner(q, poison);
                if (lifeId(q) !== life) return 'died';
                // The way back passes the gate's spiders and the dungeon's druids: still guarded.
                await readyForWalkOut(q, poison);
                await leaveCrestUnderground(q);
                return lifeId(q) !== life ? 'died' : r;
            });
        } catch (e) {
            if (lifeId(q) === life && !q.sdk.getState()?.player?.isDead) throw e;
            q.log(`crest: died on the Chronozon leg (${(e as Error).message})`);
            outcome = 'died';
        }
        if (outcome === 'died') {
            await untilTicks(q.sdk, () => !q.sdk.getState()?.player?.isDead, 20);
            poison.poisoned = false;
            q.log(`crest: respawned at ${where(q)} carrying ${q.sdk.getInventory().map((i) => i.name).join(', ') || 'nothing'}`);
            const parts = [OBJ.calebPiece, OBJ.avanPiece].filter((id) => !holds(q, id));
            if (parts.length && !partsBanked && !holds(q, OBJ.johnathonPiece)) throw new Error(`crest: died on the Chronozon leg and lost crest part(s) ${parts.join(', ')}`);
        }
        if (outcome === 'killed' || holds(q, OBJ.johnathonPiece)) {
            q.log(`crest: Chronozon leg ${leg} done at ${where(q)}`);
            break;
        }
        q.log(`crest: Chronozon leg ${leg} ${outcome} — back to Edgeville bank`);
    }
    if (!holds(q, OBJ.johnathonPiece) && !holds(q, OBJ.crest)) throw new Error('crest: no crest part from Chronozon after 3 legs');
    if (!holds(q, OBJ.crest)) await fetchCrestParts(q);
}

async function killChronozonInner(q: Quest, poison: PoisonWatch): Promise<'killed' | 'retreated'> {
    await toChronozon(q, poison);
    return fightChronozon(q, poison);
}

async function fightChronozon(q: Quest, poison: PoisonWatch): Promise<'killed' | 'retreated'> {
    const t0 = tickNow(q.sdk);
    await clearRoomSpiders(q);
    const landed = new Set<string>();
    let casts = 0;
    let tries = 0;
    let refused = 0;
    let contested = 0;
    let unseen = 0;
    let dead = false;
    // After a kill that dropped nothing for us (another player's), wait for his respawn.
    let respawning = false;
    for (let kill = 1; ; kill++) {
        dead = false;
        while (!dead && tickNow(q.sdk) - t0 < 2400 && casts < 60 && tries < 150) {
            await eatIfLow(q, 0.6);
            if (q.sdk.getState()?.player?.isDead) throw new Error('crest: died to Chronozon');
            // Out while food remains (the gate, then the dungeon); the next leg restocks at Edgeville.
            const noCure = poison.update() && potions(q).length === 0;
            const noPrayer = q.level('prayer') >= PROTECT_MELEE_LEVEL && (q.sdk.getPrayerState()?.prayerPoints ?? 1) <= 0;
            if (sharks(q) <= 2 || (sharks(q) <= 5 && hpFrac(q) < 0.6) || ((noCure || noPrayer) && sharks(q) <= 8)) {
                q.log(`crest: retreating at ${hpText(q)}, ${sharks(q)} sharks, ${potions(q).length} antipoison, prayer ${q.sdk.getPrayerState()?.prayerPoints ?? '?'}, after ${casts} casts (landed ${[...landed].join(', ') || 'none'})${poison.poisoned ? ', poisoned' : ''}`);
                return 'retreated';
            }
            const boss = q.sdk.findNearbyNpc(/^chronozon$/i);
            if (boss) respawning = false;
            if (!boss) {
                // Dead, or not yet respawned (60 ticks): look for his drop, else wait.
                if (!respawning && (q.sdk.findGroundItem(/^crest part$/i) || landed.size === 4)) {
                    dead = true;
                    break;
                }
                await q.sdk.waitForTicks(5);
                continue;
            }
            // Never cast while a spider holds us: the server refuses it anyway.
            if (attackers(q).length) {
                await fightOff(q, 'before a blast');
                continue;
            }
            const next = BLASTS.find((b) => !landed.has(b.name) && runesFor(q, b)) ?? [...BLASTS].reverse().find((b) => runesFor(q, b));
            if (!next) throw new Error(`crest: out of runes for any blast after ${casts} casts (landed ${[...landed].join(', ') || 'none'})`);
            const c = cursor(q);
            tries++;
            // Held through the cast (a flick would cancel it), re-flicked once it has gone.
            const res = await steadily(() => q.bot.castSpell(boss, next.component, ticksToMs(15)));
            await q.sdk.waitForTicks(2);
            if (saidSince(q, c, /chronozon weakens/i)) landed.add(next.name);
            if (saidSince(q, c, /chronozon regenerates/i)) q.log(`crest: Chronozon regenerated (landed ${[...landed].join(', ')})`);
            if (res.success) {
                casts++;
            } else if (/already under attack/i.test(res.message) || saidSince(q, c, /already under attack/i)) {
                // Single-way: a spider got to us first and must die before Chronozon can be hit.
                refused++;
                q.log(`crest: ${next.name} refused (under attack, ${refused}x); attackers: ${attackers(q).map((n) => npcText(q, n)).join('; ') || 'none seen'}`);
                if (!attackers(q).length) await q.sdk.waitForTicks(4);
                else await fightOff(q, 'blast refused');
            } else if (saidSince(q, c, /someone else is fighting/i)) {
                // Another player has him (a parallel run on the same world): wait our turn.
                if (contested++ % 5 === 0) q.log(`crest: Chronozon is someone else's fight (${contested}x) — waiting`);
                await q.sdk.waitForTicks(10);
            } else {
                unseen++;
                const said = (q.sdk.getState()?.gameMessages ?? []).filter((m) => (m.observationId ?? m.tick) > c).map((m) => m.text);
                q.log(`crest: ${next.name}: ${res.message} (boss ${npcText(q, boss)}, reachable ${boss.reachable}; said: ${said.join(' | ') || 'nothing'})`);
                // Out of his line of sight from here: step back to the middle of the room.
                if (unseen % 2 === 0 && cheb(q, CHRON_INSIDE) > 2) await q.bot.walkTo(CHRON_INSIDE.x, CHRON_INSIDE.z, 1).catch(() => undefined);
            }
            // The blast's damage lands a few ticks after the cast.
            await untilTicks(q.sdk, () => !q.sdk.findNearbyNpc(/^chronozon$/i) || (q.sdk.findNearbyNpc(/^chronozon$/i)?.hp ?? 1) === 0, 4);
            if (!q.sdk.findNearbyNpc(/^chronozon$/i) && landed.size === 4) dead = true;
        }
        q.log(`crest: Chronozon — ${casts} casts (${refused} refused, ${contested} contested, ${unseen} unseen), landed ${[...landed].join(', ')}, ${tickNow(q.sdk) - t0}t, ${hpText(q)}, ${sharks(q)} sharks, prayer ${q.sdk.getPrayerState()?.prayerPoints ?? '?'}`);
        if (!dead) return 'retreated';
        for (let i = 0; i < 12 && !holds(q, OBJ.johnathonPiece); i++) {
            const drop = q.sdk.findGroundItem(/^crest part$/i) ?? (await q.sdk.scanFindGroundItem(/^crest part$/i, 10).catch(() => null));
            if (!drop) {
                await q.sdk.waitForTicks(3);
                continue;
            }
            // A full pack cannot take it: eat a shark for the slot.
            if (q.sdk.getInventory().length >= 28) {
                const before = sharks(q);
                await q.bot.eatFood(/^shark$/i).catch(() => undefined);
                await untilTicks(q.sdk, () => sharks(q) < before, 4);
            }
            await q.bot.pickupItem(drop).catch(() => undefined);
            await untilTicks(q.sdk, () => holds(q, OBJ.johnathonPiece), 8);
        }
        if (holds(q, OBJ.johnathonPiece)) break;
        const others = (q.sdk.getNearbyPlayers?.() ?? []).map((p) => p.name).join(', ');
        if (kill >= 3) throw new Error(`crest: no crest part from Chronozon after ${kill} kills (at ${where(q)}; players near: ${others || 'none'})`);
        // His drop is his aggressor's (crest_chronozon.rs2): someone else's kill. His weakness bits are ours and stay set.
        q.log(`crest: Chronozon gone with no crest part for us (players near: ${others || 'none'}) — waiting for his respawn`);
        respawning = true;
    }
    q.log("crest: picked up Johnathon's crest part");
    return 'killed';
}

/** The three parts into the Family crest (all three must be held). */
export async function assembleCrest(q: Quest): Promise<void> {
    if (holds(q, OBJ.crest)) return;
    const parts = [OBJ.calebPiece, OBJ.avanPiece, OBJ.johnathonPiece].map((id) => q.sdk.getInventory().find((i) => i.id === id));
    if (parts.some((p) => !p)) throw new Error(`crest: missing a crest part (held ids ${q.sdk.getInventory().map((i) => i.id).join(',')})`);
    await q.bot.closeInterface().catch(() => undefined);
    await q.sdk.sendUseItemOnItem(parts[0]!.slot, parts[1]!.slot);
    if (!(await untilTicks(q.sdk, () => holds(q, OBJ.crest), 10))) throw new Error('crest: the parts did not combine');
    q.log('crest: restored the Family crest');
}

export { southThroughDungeon };
