/**
 * Underground Pass — the route and mechanics (bots/quests/underground-pass.ts is the definition).
 *
 * Content: quest_upass/scripts/*.rs2 (every loc and npc below), area_ardougne_east/scripts/
 * king_lathas.rs2 (start, ranged 25, completion), area_ardougne_west/scripts/doors.rs2 (the city
 * wall doors open once Biohazard is complete), skill_firemaking/firemaking.rs2 (tinderbox lights a
 * cloth arrow), skill_smithing/smelting.rs2 (orbs into the furnace). Map facts are from the
 * client's own collision (sdk/pathfinding) and were walked on the fast engine (2026-11-02).
 *
 * The pass is a chain of pockets joined by one-way-ish obstacles. In order:
 *   ENTRANCE  (2494,9716) — the cave from the West Ardougne yard; the exit loc (2496,9713) leaves.
 *   KOFTIK    four rockslides west; Koftik hands a damp cloth (one per talk while none is held).
 *   WEST      over the chasm: a cloth arrow lit with a tinderbox, bow and arrow worn, Fire-at the
 *             guide rope from x > 2443, z >= 9720. The old lever (2436,9716) is the way back east.
 *   SWING     rope used on the rock (2460,9699) swings east (the rope is lost); the rope swing
 *             (2461,9692) swings back west.
 *   K, GRID   two rockslides south; the grid (x 2467-2476, z 9673-9682) is three columns of five
 *             2-tile rows, one safe row per column (setupassgrilltrap: adjacent columns differ by at
 *             most one row; not sent to the client). A wrong tile drops you in the spike pit
 *             (15 damage); the protruding rocks climb back to (2477,9677). The lever (2466,9672)
 *             opens the portcullis and walks you through.
 *   ORBS      orbs 2-4 lie on the ground, orb 1 is under the flat rock (2382,9668, Search: disarm).
 *             All four into the furnace (2454,9682), then down the well (2416,9674). Spear and
 *             spring traps line the paths (8-10% hp each): eat. The pipe (2451,9689) goes back
 *             north to WEST.
 *   A2        area 2. The cage gate (2393,9656 then 2393,9655, Pick-lock) into the cell, spade on
 *             the mud (2393,9650) -> MUD; the ledge (2374,9644) south (a fall lands in the rat pit,
 *             back in A2); five rock bridges east; the pipe (2417,9605) west into the unicorn pen.
 *   UNICORN   search the cage (railing), railing on the boulder -> stage 4, thrown 25 west (C4).
 *   C4        the cage remains give the horn; the tunnel (2375,9611) leads to area 1's west (C8).
 *   C8        Sir Jerro, Carl and Harry drop one badge each; badges and horn into the well
 *             (2373,9718); the double door (2368,9717) then opens into the cavern (MAIN).
 *   MAIN      level-1 platforms joined by collapsed bridges (Agility; a fall lands on level 0).
 *             The cave stairs (2150,4545) go down to the dwarfs (Nilhoof, the brew barrel, Iban's
 *             tomb, Kalrag). Witch Kardia's house is two bridges west; her cat is one more.
 *   Doll      shadow: the three demons drop amulets (only at found_doll), the chest takes them.
 *             conscience: the cage (2134,4702) holds the dove. ashes: brew on the tomb, then the
 *             tinderbox. blood: kill Kalrag with the doll held. The parts are varp bits, so a lost
 *             doll is replaced by Nilhoof.
 *   Temple    robes of Zamorak from an Iban disciple, worn with NOTHING else; the temple door
 *             from the east with the finished doll, the doll on the well inside -> thrown out by
 *             Koftik's cave (2438,9607); he leads you back to the entrance.
 */
import type { Quest } from './run-quest';
import type { NearbyLoc } from '../../../sdk/types';
import { readJournalCheckpoint } from '../../../quest-lab/journal-reader';
import { driveDialog, talkThrough } from './dialog';
import { tickNow, untilTicks } from './ticks';
import { LATHAS, seeLathas } from './biohazard';
import { PrayerFlicker } from '../prayer-flick';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const JOURNAL = { label: 'Underground Pass', title: 'Underground Pass' };
export { LATHAS };

/** The West Ardougne wall's double doors (doors.rs2 west_ardougne_open_city_doors), east and west of them. */
const WALL_DOOR = { east: { x: 2559, z: 3300 }, west: { x: 2555, z: 3300 }, x: 2558 };
/** Inside the cave's yard, north-east of the entrance (the dead-tree field south of it is a dead end). */
const YARD = { x: 2440, z: 3315 };
const CAVE_ENTRANCE = { x: 2433, z: 3313 };
const PASS_EXIT = { x: 2496, z: 9713, id: 3214 };

const LOC = {
    rockslide: 3309,
    rock: 2276,
    ropeSwing: 2274,
    gridLever: 3337,
    pipe4: 3235,
    furnace: 3294,
    well: 3264,
    cage2: 3266,
    mud: 3216,
    ledge: 3238,
    walkway: 3276,
    pipe6: 3237,
    cage3: 3267,
    cageRemains: 3308,
    tunnelL: 3219,
    bloodwell: 3305,
    templeDoor2: 3220,
    stairsDown: 3222,
    stairsUp: 3223,
    barrel: 3344,
    tomb: 3353,
    doveCage: 3351,
    chest: 3272,
    altar: 3359,
    lastOut: 3224,
    guideRope: 3340,
    rockpile: 3265,
    mudpile: 3307,
    oldLever: 3241,
    flatRock: 3339,
    shutChest: 3274,
    witchDoor: 3270,
    templeDoor: 3334,
} as const;

const ITEM = {
    cloth: /^damp cloth$/i,
    unlit: /^bronze fire arrows$/i,
    arrows: /^(bronze|iron|steel|mithril|adamant|rune) arrow$/i,
    orb: /^orb of light$/i,
    railing: /^piece of railing$/i,
    horn: /^unicorn horn$/i,
    badge: /^paladin's badge$/i,
    cat: /^witches cat$/i,
    doll: /^doll of iban$/i,
    shadow: /^iban's shadow$/i,
    dove: /^iban's dove$/i,
    ashes: /^iban's ashes$/i,
    brew: /^dwarf brew$/i,
    bucket: /^bucket$/i,
    amulet: /^amulet of (doomion|holthion|othanian)$/i,
    robe: /^robe of zamorak$/i,
    food: /^(shark|swordfish|monkfish|lobster|tuna|bass|salmon|trout|meat pie|meat pizza|stew|bread)$/i,
};

/** Bows a damp cloth arrow can be fired from (weapon_bow category; crossbows are not). */
export const BOWS = /^(magic|yew|maple|willow|oak)? ?(long|short)bow$/i;

/** Protect from Melee (prayer.rs2). */
const PROTECT_MELEE_LEVEL = 43;
const EAT_AT = 0.55;

// ── where we are

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;

/** Areas 1 and 2 and the pits under them (m37_149..151, m38_150..151). */
const inPassCaves = (p: Tile) => inBox(p, 2368, 2499, 9536, 9727) && (p.level ?? 0) === 0;
/** Iban's cavern: the level-1 platforms and the dwarfs' level below. */
const inCavernUpper = (p: Tile) => inBox(p, 2112, 2175, 4544, 4735) && (p.level ?? 0) === 1;
const inCavernLower = (p: Tile) => inBox(p, 2304, 2367, 9792, 9919) && (p.level ?? 0) === 0;
/** Anywhere goTo cannot walk out of: run-quest's goTo and prologue call leaveUpass from these. */
export const inUpassArea = (p: Tile) => inPassCaves(p) || inCavernUpper(p) || inCavernLower(p);

// ── small helpers

const held = (q: Quest, item: RegExp) => q.sdk.getInventory().find((i) => item.test(i.name));
const has = (q: Quest, item: RegExp) => !!held(q, item) || q.sdk.getEquipment().some((i) => item.test(i.name));
const count = (q: Quest, item: RegExp) => q.sdk.getInventory().filter((i) => item.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const hp = (q: Quest) => q.sdk.getState()?.player?.hp ?? 0;
const maxHp = (q: Quest) => q.sdk.getState()?.player?.maxHp ?? 1;
const messageId = (q: Quest) => (q.sdk.getState()?.gameMessages ?? []).at(-1)?.observationId ?? -1;
const messagesSince = (q: Quest, id: number) =>
    (q.sdk.getState()?.gameMessages ?? [])
        .filter((m) => (m.observationId ?? 0) > id)
        .map((m) => m.text)
        .join(' | ');
const said = (q: Quest, id: number, text: RegExp) => text.test(messagesSince(q, id));
const freeSlots = (q: Quest) => 28 - q.sdk.getInventory().length;

/** The journal's raw text, joined (element parts of the doll are separate lines). */
export async function journalText(q: Quest): Promise<string> {
    const read = await readJournalCheckpoint(q.sdk, JOURNAL, { id: 'upass:read', kind: 'active', all: [] });
    await q.sdk.sendCloseModal().catch(() => undefined);
    return read.rawLines.map((l) => l.rawText).join(' / ');
}

let eaten = 0;
export async function eatIfLow(q: Quest, frac = EAT_AT): Promise<void> {
    for (let i = 0; i < 3 && hp(q) > 0 && hp(q) < maxHp(q) * frac; i++) {
        const food = q.sdk.getInventory().find((it) => ITEM.food.test(it.name));
        if (!food) return;
        const before = hp(q);
        await q.bot.eatFood(food).catch(() => undefined);
        if (await untilTicks(q.sdk, () => hp(q) > before, 3)) eaten++;
    }
}

/** Eats in the background while inside: traps, falls, bolts and spiders hit through whatever a step waits on. */
let lifeguard = false;
function guardLife(q: Quest): void {
    if (lifeguard) return;
    lifeguard = true;
    void (async () => {
        try {
            while (inUpassArea(pos(q))) {
                if (hp(q) > 0 && hp(q) < maxHp(q) * 0.45) await eatIfLow(q, 0.45);
                await q.sdk.waitForTicks(1);
            }
        } catch {
            /* the guard must never break a step */
        } finally {
            lifeguard = false;
        }
    })();
}

/** Until the position holds still for 3 ticks: a forced move, fall or teleport is over. */
async function settle(q: Quest, ticks = 20): Promise<void> {
    let last = '';
    let still = 0;
    for (let i = 0; i < ticks && still < 3; i++) {
        await q.sdk.waitForTicks(1);
        const p = pos(q);
        const now = `${p.x},${p.z},${p.level}`;
        still = now === last ? still + 1 : 0;
        last = now;
    }
}

/** True when the client's collision can walk from here to `t` (same plane). */
function reachable(q: Quest, t: Tile): boolean {
    const p = pos(q);
    if (p.level !== (t.level ?? 0)) return false;
    if (p.x === t.x && p.z === t.z) return true;
    const path = q.sdk.findPath(t.x, t.z, 2000);
    const last = path.waypoints.at(-1);
    return path.reachedDestination === true || (!!last && last.x === t.x && last.z === t.z);
}

/** Walk within one pocket (bot.walkTo; no run-quest hooks). */
async function walk(q: Quest, tile: Tile, tolerance = 1): Promise<void> {
    for (let attempt = 1; attempt <= 4; attempt++) {
        const d = Math.hypot(pos(q).x - tile.x, pos(q).z - tile.z);
        if (d <= tolerance) return;
        if (d <= 2) {
            await q.sdk.sendWalk(tile.x, tile.z);
            await untilTicks(q.sdk, () => Math.hypot(pos(q).x - tile.x, pos(q).z - tile.z) <= tolerance, 4);
            continue;
        }
        const r = await q.bot.walkTo(tile.x, tile.z, tolerance);
        if (!r.success) q.log(`upass: walk to (${tile.x},${tile.z}) from ${where(q)}: ${r.message}`);
        await eatIfLow(q);
    }
    if (Math.hypot(pos(q).x - tile.x, pos(q).z - tile.z) > tolerance + 2) throw new Error(`upass: could not walk to (${tile.x},${tile.z}) from ${where(q)}`);
}

async function scanLoc(q: Quest, x: number, z: number, radius = 12): Promise<NearbyLoc | undefined> {
    await q.sdk.scanNearbyLocs(radius).catch(() => undefined);
    return (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === x && l.z === z);
}

/**
 * Op a loc by its map tile (some, the ledge and the rock bridges, are bridge-level scenery the
 * scan never lists). Waits for `done`; a send right after a walk can land before the server has
 * us on the tile ("I can't reach that!"), so it settles first and retries.
 */
async function opAt(q: Quest, x: number, z: number, id: number, op: number, done: () => boolean, label: string, ticks = 20, choices: Array<RegExp | string> = []): Promise<boolean> {
    for (let attempt = 1; attempt <= 3 && !done(); attempt++) {
        await settle(q, 6);
        const mark = messageId(q);
        // Several locs can share a tile (the flat rock and its orb): the given id wins.
        const seen = id ? undefined : await scanLoc(q, x, z, 8);
        await q.sdk.sendInteractLoc(x, z, id || seen?.id || 0, op);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { done: () => done() && !q.sdk.getDialog()?.isOpen, ticks: 60, log: q.log });
        if (await untilTicks(q.sdk, done, 4)) return true;
        q.log(`upass: ${label} attempt ${attempt} at ${where(q)}: ${messagesSince(q, mark).slice(0, 160) || 'no reply'}`);
    }
    return done();
}

/** Use an inventory item on a loc by its map tile; true once `done`. */
async function useAt(q: Quest, item: RegExp, x: number, z: number, id: number, done: () => boolean, label: string, ticks = 20): Promise<boolean> {
    for (let attempt = 1; attempt <= 3 && !done(); attempt++) {
        const it = held(q, item);
        if (!it) throw new Error(`upass: no ${item} for ${label} (carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
        await settle(q, 6);
        const mark = messageId(q);
        const seen = id ? undefined : await scanLoc(q, x, z, 8);
        await q.sdk.sendUseItemOnLoc(it.slot, x, z, id || seen?.id || 0);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 20 });
        if (await untilTicks(q.sdk, done, 4)) return true;
        q.log(`upass: ${label} attempt ${attempt} at ${where(q)}: ${messagesSince(q, mark).slice(0, 160) || 'no reply'}`);
    }
    return done();
}

/** One inventory item on another until `product` (or `done`). */
async function combine(q: Quest, a: RegExp, b: RegExp, done: () => boolean, label: string): Promise<boolean> {
    for (let attempt = 1; attempt <= 3 && !done(); attempt++) {
        const x = held(q, a);
        const y = held(q, b);
        if (!x || !y) return done();
        const mark = messageId(q);
        await q.sdk.sendUseItemOnItem(x.slot, y.slot);
        if (await untilTicks(q.sdk, done, 12)) return true;
        q.log(`upass: ${label}: ${messagesSince(q, mark).slice(0, 160) || 'no reply'}`);
    }
    return done();
}

async function dropAll(q: Quest, item: RegExp): Promise<void> {
    for (let i = 0; i < 6; i++) {
        const it = held(q, item);
        if (!it) return;
        await q.sdk.sendDropItem(it.slot);
        await untilTicks(q.sdk, () => !q.sdk.getInventory().some((x) => x.slot === it.slot && x.id === it.id), 3);
    }
}

/** Free pack slots for a hand-out (Kardia's chest is four items): junk first, then eat. */
async function makeRoom(q: Quest, slots: number): Promise<void> {
    for (const junk of [/^history of iban$/i, /^(super attack|restore potion|attack potion|prayer potion)\(\d\)$/i, /^bronze fire arrows$/i, ITEM.railing, /^(stew|bread|meat pie|meat pizza|salmon)$/i]) {
        if (freeSlots(q) >= slots) return;
        await dropAll(q, junk);
    }
    for (let i = 0; i < 6 && freeSlots(q) < slots; i++) {
        const food = held(q, ITEM.food);
        if (!food) break;
        await q.bot.eatFood(food).catch(() => undefined);
        await q.sdk.waitForTicks(2);
    }
}

// ── fights

let guard: PrayerFlicker | null = null;
function protect(q: Quest, on: boolean): void {
    if (q.level('prayer') < PROTECT_MELEE_LEVEL) return;
    guard ??= new PrayerFlicker(q.sdk, q.log, { flick: false });
    guard.set(on && (q.sdk.getPrayerState()?.prayerPoints ?? 0) > 5 ? 'protect_from_melee' : null);
}

/** The melee weapon back in hand (the bridge needs the bow, the temple an empty hand). */
async function wieldWeapon(q: Quest): Promise<void> {
    const weapon = q.sdk.getInventory().find((i) => i.optionsWithIndex.some((o) => /^wield$/i.test(o.text)) && !BOWS.test(i.name) && !/fire arrows?$|arrow$/i.test(i.name));
    if (!weapon) return;
    await q.bot.equipItem(weapon).catch(() => undefined);
    await q.sdk.waitForTicks(1);
}

/** Kill the nearest `npc` (re-attacking after cancels), eating; true once it is gone. */
async function kill(q: Quest, npc: RegExp, label: string, ticks = 400): Promise<boolean> {
    await untilTicks(q.sdk, () => !!q.sdk.findNearbyNpc(npc), 10);
    const target = q.sdk.findNearbyNpc(npc);
    if (!target) {
        q.log(`upass: no ${label} in view at ${where(q)}`);
        return false;
    }
    const index = target.index;
    const alive = () => q.sdk.getNearbyNpcs().find((n) => n.index === index);
    const t0 = tickNow(q.sdk);
    let sent = -99;
    protect(q, true);
    try {
        while (alive() && tickNow(q.sdk) - t0 < ticks) {
            await eatIfLow(q);
            const combat = q.sdk.getState()?.player?.combat;
            const swinging = combat?.targetType === 'npc' && combat.targetIndex === index;
            if ((!swinging || (guard && guard.toggledAt > sent)) && tickNow(q.sdk) - sent > 4) {
                const n = alive()!;
                await q.sdk.sendInteractNpc(n.index, n.optionsWithIndex.find((o) => /^attack$/i.test(o.text))?.opIndex ?? 2);
                sent = tickNow(q.sdk);
            }
            await q.sdk.waitForTicks(1);
        }
    } finally {
        protect(q, false);
    }
    const dead = !alive();
    q.log(`upass: ${dead ? 'killed' : 'gave up on'} ${label} in ${tickNow(q.sdk) - t0}t (hp ${hp(q)}/${maxHp(q)}, eaten ${eaten})`);
    return dead;
}

/** Pick up ground items named `item` within `radius` (drops land under the npc). */
async function pickUpNear(q: Quest, item: RegExp, radius = 6): Promise<number> {
    let got = 0;
    for (let i = 0; i < 4; i++) {
        await q.sdk.waitForTicks(1);
        const g = q.sdk.getGroundItems().filter((it) => item.test(it.name) && Math.hypot(it.x - pos(q).x, it.z - pos(q).z) <= radius)[0];
        if (!g) break;
        if (freeSlots(q) < 1) await makeRoom(q, 1);
        const before = q.sdk.getInventory().length;
        await q.bot.pickupItem(g).catch(() => undefined);
        if (await untilTicks(q.sdk, () => q.sdk.getInventory().length > before, 6)) got++;
    }
    return got;
}

// ── West Ardougne and the cave

const inWestArdougne = (p: Tile) => inBox(p, 2410, 2557, 3264, 3335) && (p.level ?? 0) === 0;

/** Through the city wall's double doors (open from either side once Biohazard is complete). */
export async function throughWallDoors(q: Quest, west: boolean): Promise<void> {
    const across = () => (west ? pos(q).x < WALL_DOOR.x - 1 : pos(q).x > WALL_DOOR.x) && pos(q).level === 0;
    if (across()) return;
    const side = west ? WALL_DOOR.east : WALL_DOOR.west;
    if (Math.hypot(pos(q).x - side.x, pos(q).z - side.z) > 6) await q.goTo(side, 2);
    for (let attempt = 1; attempt <= 4 && !across(); attempt++) {
        await q.sdk.scanNearbyLocs(6).catch(() => undefined);
        const door = (q.sdk.getNearbyLocs() ?? [])
            .filter((l) => /^door$/i.test(l.name) && (l.x === 2557 || l.x === 2558) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!door) {
            await walk(q, side, 1);
            continue;
        }
        await q.sdk.sendInteractLoc(door.x, door.z, door.id, door.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
        await untilTicks(q.sdk, across, 12);
        await settle(q, 6);
    }
    if (!across()) throw new Error(`upass: the West Ardougne wall doors did not let us ${west ? 'in' : 'out'} (at ${where(q)}) — Biohazard complete?`);
    q.log(`upass: through the wall doors to ${where(q)}`);
}

/** From anywhere on the surface into the cave yard (inside West Ardougne). */
async function toYard(q: Quest): Promise<void> {
    if (inUpassArea(pos(q))) return;
    if (!inWestArdougne(pos(q))) await throughWallDoors(q, true);
    // walkTo from inside the city: from the east side it routes to the dead-tree field instead.
    await walk(q, YARD, 2);
}

/** Into the cave. At stage 0 (Lathas spoken to) the entrance runs Koftik's first talk instead. */
async function enterCave(q: Quest): Promise<void> {
    await toYard(q);
    const t0 = tickNow(q.sdk);
    for (let attempt = 1; attempt <= 4 && !inPassCaves(pos(q)); attempt++) {
        const cave = await scanLoc(q, CAVE_ENTRANCE.x, CAVE_ENTRANCE.z, 12);
        if (!cave) {
            await walk(q, YARD, 2);
            continue;
        }
        await q.bot.interactLoc(cave, /^enter$/i).catch(() => undefined);
        await untilTicks(q.sdk, (s) => inPassCaves(pos(q)) || !!s.dialog?.isOpen, 20);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/i'll take my chances/i], { ticks: 60, log: q.log });
        await settle(q, 6);
    }
    if (!inPassCaves(pos(q))) throw new Error(`upass: the cave entrance did not take us in (at ${where(q)})`);
    q.log(`upass: into the pass at ${where(q)} in ${tickNow(q.sdk) - t0}t`);
    guardLife(q);
    await wieldWeapon(q);
}

// ── regions: the pass as a chain of pockets

type RegionName =
    | 'ENTRANCE'
    | 'KOFTIK'
    | 'WEST'
    | 'SWING'
    | 'K'
    | 'GRID'
    | 'ORBS'
    | 'A2'
    | 'MUD'
    | 'LEDGE_S'
    | 'BRIDGE1'
    | 'BRIDGE2'
    | 'BRIDGE3'
    | 'BRIDGE4'
    | 'EAST2'
    | 'PEN'
    | 'C4'
    | 'C8'
    | 'CAVERN'
    | 'DWARFS';

/** One tile per pocket (walked on the fast engine); a pocket is "where we are" when it is walkable to. */
const REGIONS: Array<{ name: RegionName; at: Tile }> = [
    { name: 'ENTRANCE', at: { x: 2494, z: 9716 } },
    { name: 'KOFTIK', at: { x: 2452, z: 9715 } },
    { name: 'WEST', at: { x: 2442, z: 9716 } },
    { name: 'SWING', at: { x: 2466, z: 9699 } },
    { name: 'K', at: { x: 2484, z: 9680 } },
    { name: 'GRID', at: { x: 2481, z: 9679 } },
    { name: 'ORBS', at: { x: 2464, z: 9677 } },
    { name: 'A2', at: { x: 2423, z: 9660 } },
    { name: 'MUD', at: { x: 2392, z: 9646 } },
    { name: 'LEDGE_S', at: { x: 2374, z: 9638 } },
    { name: 'BRIDGE1', at: { x: 2381, z: 9634 } },
    { name: 'BRIDGE2', at: { x: 2388, z: 9631 } },
    { name: 'BRIDGE3', at: { x: 2393, z: 9627 } },
    { name: 'BRIDGE4', at: { x: 2400, z: 9632 } },
    { name: 'EAST2', at: { x: 2407, z: 9637 } },
    { name: 'PEN', at: { x: 2412, z: 9605 } },
    { name: 'C4', at: { x: 2372, z: 9594 } },
    { name: 'C8', at: { x: 2371, z: 9666 } },
    { name: 'CAVERN', at: { x: 2173, z: 4725, level: 1 } },
    { name: 'DWARFS', at: { x: 2336, z: 9794 } },
];
const ORDER: RegionName[] = REGIONS.map((r) => r.name);

/** The pits and side pockets a fall or a trap leaves you in, and how each gets back on the chain. */
const GRID_PIT = (p: Tile) => inBox(p, 2380, 2410, 9540, 9575);
/** Under area 1 (the swing's and the swamps' falls): the mud pile climbs back up by the entrance. */
const UNDER_AREA1 = (p: Tile) => inBox(p, 2432, 2499, 9600, 9663) && (p.level ?? 0) === 0;
const ROCKPILE = { x: 2443, z: 9651 };

export function region(q: Quest): RegionName | null {
    for (const r of REGIONS) if (reachable(q, r.at)) return r.name;
    // Between two rockslides on the way to Koftik.
    if (inBox(pos(q), 2455, 2492, 9700, 9727) && pos(q).level === 0) return 'ENTRANCE';
    return null;
}

/** The rockslides between the entrance and Koftik, entrance side first (walked 2026-11-02). */
const ENTRANCE_ROCKS: Tile[] = [
    { x: 2485, z: 9721 },
    { x: 2478, z: 9724 },
    { x: 2467, z: 9723 },
    { x: 2460, z: 9720 },
];

/** Over every rockslide in `rocks` that is still between us and `goal`. */
async function rockslides(q: Quest, rocks: Tile[], goal: Tile): Promise<void> {
    for (let pass = 0; pass < 2 && !reachable(q, goal); pass++) {
        for (const r of rocks) {
            if (reachable(q, goal)) return;
            const loc = await scanLoc(q, r.x, r.z, 15);
            if (!loc || loc.reachable === false) continue;
            for (let attempt = 1; attempt <= 4; attempt++) {
                const before = pos(q);
                await opAt(q, r.x, r.z, LOC.rockslide, 1, () => Math.hypot(pos(q).x - before.x, pos(q).z - before.z) >= 2, `rockslide (${r.x},${r.z})`, 25);
                await settle(q, 6);
                if (Math.hypot(pos(q).x - before.x, pos(q).z - before.z) >= 2) break; // "...but you slip back down": again
            }
        }
    }
    if (!reachable(q, goal)) throw new Error(`upass: rockslides did not lead to (${goal.x},${goal.z}) (at ${where(q)})`);
}

/** A cloth arrow, lit, worn with a bow, fired at the guide rope until the bridge drops us west. */
async function shootTheRope(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    const bow = q.sdk.getInventory().find((i) => BOWS.test(i.name)) ?? q.sdk.getEquipment().find((e) => BOWS.test(e.name));
    if (!bow) throw new Error('upass: no bow to fire at the guide rope');
    const lit = () => q.sdk.getEquipment().find((e) => /fire arrows?$/i.test(e.name));
    for (let shot = 1; shot <= 4 && reachable(q, REGIONS[1]!.at) && !reachable(q, REGIONS[2]!.at); shot++) {
        // A damp cloth (Koftik has another while none is held), wrapped and lit.
        if (!has(q, /fire arrows?$/i) && !held(q, ITEM.cloth)) {
            await walk(q, { x: 2451, z: 9716 }, 3);
            const seen = await talkThrough(q.sdk, q.bot, /^koftik$/i, [/not to worry/i, /what does it say/i], q.log);
            await q.sdk.sendCloseModal().catch(() => undefined);
            if (!held(q, ITEM.cloth)) q.log(`upass: Koftik gave no cloth: ${seen.slice(-160)}`);
        }
        if (held(q, ITEM.cloth) && freeSlots(q) < 1) await makeRoom(q, 1);
        if (held(q, ITEM.cloth)) await combine(q, ITEM.arrows, ITEM.cloth, () => !held(q, ITEM.cloth), 'wrap an arrow in the damp cloth');
        // The unlit and lit cloth arrows share a name; the lit one is what the tinderbox makes.
        const unlit = q.sdk.getInventory().find((i) => /fire arrows$/i.test(i.name));
        const tb = held(q, /^tinderbox$/i);
        if (unlit && tb) {
            const ids = q.sdk.getInventory().map((i) => `${i.slot}:${i.id}`).join();
            await q.sdk.sendUseItemOnItem(unlit.slot, tb.slot);
            await untilTicks(q.sdk, () => q.sdk.getInventory().map((i) => `${i.slot}:${i.id}`).join() !== ids, 6);
        }
        const arrow = q.sdk.getInventory().find((i) => /fire arrows$/i.test(i.name));
        const bowHeld = q.sdk.getInventory().find((i) => BOWS.test(i.name));
        if (bowHeld) await q.bot.equipItem(bowHeld).catch(() => undefined);
        if (arrow) await q.bot.equipItem(arrow).catch(() => undefined);
        await q.sdk.waitForTicks(1);
        if (!lit()) {
            q.log(`upass: no lit arrow worn (worn ${q.sdk.getEquipment().map((e) => e.name).join(', ')})`);
        }
        await walk(q, { x: 2446, z: 9722 }, 0);
        const mark = messageId(q);
        await opAt(q, 2443, 9718, LOC.guideRope, 1, () => pos(q).x < 2443 || said(q, mark, /misses the rope|need something to fire|equip a bow/i), 'fire at the guide rope', 25);
        await untilTicks(q.sdk, () => pos(q).x <= 2442, 12);
        await settle(q, 6);
        q.log(`upass: shot ${shot}: ${messagesSince(q, mark).slice(0, 120)} -> ${where(q)}`);
    }
    if (!reachable(q, REGIONS[2]!.at)) throw new Error(`upass: could not shoot the bridge down (at ${where(q)})`);
    q.log(`upass: over the chasm in ${tickNow(q.sdk) - t0}t`);
    await wieldWeapon(q);
}

/** Solve and cross the grid trap, then the lever through the portcullis. */
async function crossGrid(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    const rowZ = (r: number) => 9673 + 2 * (r - 1);
    const fallen = () => GRID_PIT(pos(q));
    let falls = 0;
    const step = async (x: number, z: number): Promise<boolean> => {
        await q.sdk.sendWalk(x, z);
        for (let i = 0; i < 6; i++) {
            await q.sdk.waitForTicks(1);
            if (fallen()) return false;
            if (pos(q).x === x && pos(q).z === z) break;
        }
        // The trap is a 1-tick timer started on zone entry: give it time to fire.
        for (let i = 0; i < 3; i++) {
            await q.sdk.waitForTicks(1);
            if (fallen()) return false;
        }
        return pos(q).x === x && pos(q).z === z;
    };
    const line = async (to: Tile, zFirst: boolean): Promise<boolean> => {
        for (let i = 0; i < 30; i++) {
            const p = pos(q);
            if (p.x === to.x && p.z === to.z) return true;
            const moveZ = zFirst ? p.z !== to.z : p.x === to.x;
            if (!(await step(moveZ ? p.x : p.x + Math.sign(to.x - p.x), moveZ ? p.z + Math.sign(to.z - p.z) : p.z))) return false;
        }
        return false;
    };
    const climbOut = async () => {
        falls++;
        await settle(q, 8);
        await eatIfLow(q, 0.6);
        await q.sdk.scanNearbyLocs(6).catch(() => undefined);
        const rocks = (q.sdk.getNearbyLocs() ?? []).find((l) => /^protruding rocks$/i.test(l.name));
        if (!rocks) throw new Error(`upass: in the grid's spike pit with no rocks to climb (${where(q)})`);
        await opAt(q, rocks.x, rocks.z, rocks.id, 1, () => !fallen(), 'climb out of the spike pit', 15);
        await settle(q, 6);
    };
    const known: number[] = [];
    const tried = [new Set<number>(), new Set<number>(), new Set<number>()];
    const order = (prev?: number) => (prev === undefined ? [3, 2, 4, 1, 5] : [prev, prev - 1, prev + 1].filter((r) => r >= 1 && r <= 5));
    // Rows change outside the zone, then where two columns overlap; each column's own tile tests it.
    const change = [2477, 2473, 2469];
    const solo = [2476, 2472, 2468];
    for (let attempt = 0; attempt < 16 && known.length < 3; attempt++) {
        if (fallen()) await climbOut();
        const col = known.length;
        const cand = order(known[col - 1]).find((r) => !tried[col]!.has(r));
        if (cand === undefined) throw new Error(`upass: grid has no safe row left in column ${col + 1} (known ${known.join(',')})`);
        const r0 = known[0] ?? cand;
        await q.bot.walkTo(2478, rowZ(r0), 0);
        if (pos(q).x !== 2478 || pos(q).z !== rowZ(r0)) {
            await settle(q, 4);
            if (fallen()) continue;
            if (pos(q).x !== 2478 || pos(q).z !== rowZ(r0)) await walk(q, { x: 2478, z: rowZ(r0) }, 0).catch(() => undefined);
            if (pos(q).x !== 2478 || pos(q).z !== rowZ(r0)) continue;
        }
        let ok = true;
        for (let c = 0; c <= col && ok; c++) {
            const r = c < col ? known[c]! : cand;
            ok = (await line({ x: change[c]!, z: pos(q).z }, false)) && (await line({ x: change[c]!, z: rowZ(r) }, true)) && (await line({ x: solo[c]!, z: rowZ(r) }, false));
            if (c === col) tried[col]!.add(cand);
            else if (!ok) q.log(`upass: grid replay of column ${c + 1} row ${r} fell — a solved row is wrong`);
        }
        if (ok) known.push(cand);
    }
    if (known.length < 3) throw new Error(`upass: could not solve the grid (known ${known.join(',')}, ${falls} falls)`);
    await line({ x: 2466, z: pos(q).z }, false);
    await line({ x: 2466, z: 9673 }, true);
    await opAt(q, 2466, 9672, LOC.gridLever, 1, () => reachable(q, REGIONS[6]!.at), 'pull the portcullis lever', 15);
    await settle(q, 6);
    if (!reachable(q, REGIONS[6]!.at)) throw new Error(`upass: the portcullis lever did not take us through (at ${where(q)})`);
    q.log(`upass: grid rows ${known.join(',')} (${falls} falls) and the portcullis in ${tickNow(q.sdk) - t0}t`);
}

/** Through the jail cell into the dug-out tunnel under the mud. */
async function intoTheMud(q: Quest): Promise<void> {
    if (!held(q, /^spade$/i)) throw new Error('upass: no spade for the mud in the jail cell');
    await walk(q, { x: 2393, z: 9657 }, 1);
    for (let attempt = 1; attempt <= 6 && pos(q).z > 9654 && reachable(q, REGIONS[7]!.at); attempt++) {
        const z = pos(q).z >= 9657 ? 9656 : 9655;
        const z0 = pos(q).z;
        await opAt(q, 2393, z, LOC.cage2, 1, () => pos(q).z !== z0, `pick the cage lock (2393,${z})`, 15);
        await settle(q, 4);
    }
    await useAt(q, /^spade$/i, 2393, 9650, LOC.mud, () => reachable(q, REGIONS[8]!.at), 'dig the mud', 20);
    await settle(q, 6);
}

/** Leg from `from` to the next pocket on the chain. */
async function forward(q: Quest, from: RegionName): Promise<void> {
    switch (from) {
        case 'ENTRANCE':
            return rockslides(q, ENTRANCE_ROCKS, REGIONS[1]!.at);
        case 'KOFTIK':
            return shootTheRope(q);
        case 'WEST': {
            if (!held(q, /^rope$/i)) throw new Error('upass: no rope for the swing over the swamp');
            await walk(q, { x: 2459, z: 9699 }, 1);
            await useAt(q, /^rope$/i, 2460, 9699, LOC.rock, () => !reachable(q, REGIONS[2]!.at) || pos(q).x >= 2464, 'tie the rope to the rock', 15);
            await settle(q, 8);
            return;
        }
        case 'SWING':
            await walk(q, { x: 2491, z: 9694 }, 2);
            return rockslides(q, [{ x: 2491, z: 9691 }], REGIONS[4]!.at);
        case 'K':
            await walk(q, { x: 2484, z: 9680 }, 1);
            return rockslides(q, [{ x: 2482, z: 9679 }], REGIONS[5]!.at);
        case 'GRID':
            return crossGrid(q);
        case 'ORBS': {
            await walk(q, { x: 2418, z: 9676 }, 1);
            const mark = messageId(q);
            await opAt(q, 2416, 9674, LOC.well, 1, () => reachable(q, REGIONS[7]!.at) || said(q, mark, /blast you out/i), 'climb down the well', 15);
            if (said(q, mark, /blast you out/i)) throw new Error('upass: the well blasts us out — the four orbs are not all destroyed');
            await settle(q, 6);
            return;
        }
        case 'A2':
            return intoTheMud(q);
        case 'MUD':
            await walk(q, { x: 2374, z: 9645 }, 2).catch(() => undefined);
            await opAt(q, 2374, 9644, LOC.ledge, 1, () => pos(q).z <= 9639 || reachable(q, REGIONS[7]!.at), 'edge across the ledge', 25);
            await settle(q, 6);
            if (reachable(q, REGIONS[7]!.at)) q.log('upass: fell off the ledge into the rat pit — back through the cell');
            return;
        case 'LEDGE_S':
        case 'BRIDGE1':
        case 'BRIDGE2':
        case 'BRIDGE3':
        case 'BRIDGE4': {
            const at = { LEDGE_S: [2380, 9634], BRIDGE1: [2387, 9631], BRIDGE2: [2392, 9627], BRIDGE3: [2399, 9632], BRIDGE4: [2406, 9637] }[from] as [number, number];
            const x0 = pos(q).x;
            await opAt(q, at[0], at[1], LOC.walkway, 1, () => Math.abs(pos(q).x - x0) >= 3, `cross the rock bridge (${at[0]},${at[1]})`, 25);
            await settle(q, 6);
            return;
        }
        case 'EAST2':
            await walk(q, { x: 2419, z: 9605 }, 0);
            await opAt(q, 2417, 9605, LOC.pipe6, 1, () => pos(q).x < 2414, 'squeeze through the pipe', 30);
            await settle(q, 6);
            return;
        case 'PEN':
        case 'C4': {
            const door = from === 'PEN' ? { x: 2400, z: 9611 } : { x: 2375, z: 9611 };
            await walk(q, { x: door.x, z: door.z - 1 }, 1);
            await opAt(q, door.x, door.z, LOC.tunnelL, 1, () => reachable(q, REGIONS[17]!.at), 'pass through the tunnel', 15);
            await settle(q, 4);
            return;
        }
        case 'C8':
            await walk(q, { x: 2370, z: 9718 }, 2);
            await opAt(q, 2368, 9717, LOC.templeDoor2, 1, () => pos(q).level === 1, 'open the double door', 15);
            await settle(q, 4);
            return;
        default:
            throw new Error(`upass: no way on from ${from}`);
    }
}

/** Back onto the chain from a pit or the dwarfs' level. */
async function recover(q: Quest): Promise<boolean> {
    if (GRID_PIT(pos(q))) {
        await q.sdk.scanNearbyLocs(6).catch(() => undefined);
        const rocks = (q.sdk.getNearbyLocs() ?? []).find((l) => /^protruding rocks$/i.test(l.name));
        if (rocks) await opAt(q, rocks.x, rocks.z, rocks.id, 1, () => !GRID_PIT(pos(q)), 'climb out of the spike pit', 15);
        return true;
    }
    if (UNDER_AREA1(pos(q)) && reachable(q, { x: ROCKPILE.x + 1, z: ROCKPILE.z })) {
        await walk(q, { x: ROCKPILE.x + 1, z: ROCKPILE.z }, 2);
        await opAt(q, ROCKPILE.x, ROCKPILE.z, LOC.rockpile, 1, () => !UNDER_AREA1(pos(q)), 'climb the pile of mud', 15);
        return true;
    }
    return false;
}

/**
 * Along the chain to `goal`, from the surface or any pocket before it. Pockets past the goal are
 * not walked back (the chain is mostly one-way): that throws.
 */
export async function advance(q: Quest, goal: RegionName): Promise<void> {
    if (!inUpassArea(pos(q))) await enterCave(q);
    guardLife(q);
    const t0 = tickNow(q.sdk);
    for (let legs = 0; legs < 40; legs++) {
        let here = region(q);
        // Elsewhere on the cavern's platforms (or in Kardia's house): over the bridges to the arrival one.
        if (here === null && (inCavernUpper(pos(q)) || inWitchHouse(pos(q)))) {
            await toPlatform(q, 'CAVERN');
            here = region(q);
        }
        if (here === null && (await recover(q))) here = region(q);
        if (here === null) throw new Error(`upass: lost in the pass at ${where(q)}`);
        if (here === goal) return;
        if (goal === 'DWARFS' && here === 'CAVERN') return void (await stairs(q, false));
        if (goal === 'CAVERN' && here === 'DWARFS') return void (await stairs(q, true));
        if (ORDER.indexOf(here) > ORDER.indexOf(goal)) throw new Error(`upass: at ${here} ${where(q)}, past ${goal}`);
        // After the unicorn the pipe skips the pen.
        await eatIfLow(q);
        await forward(q, here);
        if (tickNow(q.sdk) - t0 > 6000) throw new Error(`upass: still short of ${goal} after ${tickNow(q.sdk) - t0}t (at ${where(q)})`);
    }
    throw new Error(`upass: too many legs toward ${goal} (at ${where(q)})`);
}

/** The cave stairs between the cavern's platforms and the dwarfs' level. */
async function stairs(q: Quest, up: boolean): Promise<void> {
    if (up) {
        await walk(q, { x: 2336, z: 9795 }, 1);
        await opAt(q, 2336, 9793, LOC.stairsUp, 1, () => pos(q).level === 1, 'ascend the cave stairs', 15);
    } else {
        await walk(q, { x: 2150, z: 4547, level: 1 }, 1);
        await opAt(q, 2150, 4545, LOC.stairsDown, 1, () => pos(q).level === 0, 'descend the cave stairs', 15);
        // Koftik, raving, the first time down.
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 4);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 60 });
    }
    await settle(q, 4);
    if (pos(q).level !== (up ? 1 : 0)) throw new Error(`upass: the cave stairs did not take us ${up ? 'up' : 'down'} (at ${where(q)})`);
}

// ── the cavern's collapsed bridges

interface Bridge {
    x: number;
    z: number;
    /** Footprint along z (angle 0/2) or along x (1/3); length 3. */
    ns: boolean;
    /** bridgecollapsed1 3254 / bridgecollapsed2 3255. */
    id: number;
}
const BR = {
    toWitch: { x: 2156, z: 4582, ns: false, id: 3255 },
    toCat: { x: 2147, z: 4583, ns: false, id: 3255 },
    toDemons: { x: 2142, z: 4562, ns: true, id: 3254 },
    toOthainian: { x: 2126, z: 4566, ns: false, id: 3255 },
    toCages: { x: 2121, z: 4686, ns: false, id: 3255 },
    toSouth: { x: 2143, z: 4604, ns: false, id: 3255 },
    toMonks: { x: 2160, z: 4625, ns: true, id: 3255 },
    toTemple: { x: 2161, z: 4637, ns: true, id: 3254 },
} satisfies Record<string, Bridge>;

/**
 * Over a collapsed bridge toward `side` ('N'/'S'/'E'/'W'). A slip drops us on the dwarfs' level:
 * back up the stairs, walk to the bridge again.
 */
async function crossBridge(q: Quest, b: Bridge, toward: 'N' | 'S' | 'E' | 'W', approach?: () => Promise<void>): Promise<void> {
    const sides = b.ns ? { S: { x: b.x, z: b.z - 1 }, N: { x: b.x, z: b.z + 3 } } : { W: { x: b.x - 1, z: b.z }, E: { x: b.x + 3, z: b.z } };
    const to = (sides as Record<string, Tile>)[toward]!;
    const from = (sides as Record<string, Tile>)[{ N: 'S', S: 'N', E: 'W', W: 'E' }[toward]]!;
    for (let attempt = 1; attempt <= 5; attempt++) {
        if (pos(q).x === to.x && pos(q).z === to.z && pos(q).level === 1) return;
        if (pos(q).level === 0) {
            q.log(`upass: fell off the bridge (${b.x},${b.z}) to ${where(q)} — back up`);
            await eatIfLow(q, 0.7);
            await stairs(q, true);
            if (approach) await approach();
        }
        await walk(q, { ...from, level: 1 }, 0);
        const p0 = pos(q);
        await opAt(q, b.x, b.z, b.id, 1, () => pos(q).level !== 1 || Math.hypot(pos(q).x - p0.x, pos(q).z - p0.z) >= 3, `cross the bridge (${b.x},${b.z})`, 20);
        await settle(q, 6);
    }
    if (pos(q).x !== to.x || pos(q).z !== to.z) throw new Error(`upass: could not cross the bridge (${b.x},${b.z}) toward ${toward} (at ${where(q)})`);
}

// ── the cavern's platforms (one tile on each; the graph of bridges between them)

type Platform = 'CAVERN' | 'WITCH' | 'CAT' | 'DEMONS' | 'OTHAINIAN' | 'SOUTH' | 'MONKS' | 'TEMPLE' | 'CAGES';
const PLATFORMS: Record<Platform, Tile> = {
    CAVERN: { x: 2173, z: 4725, level: 1 },
    WITCH: { x: 2155, z: 4582, level: 1 },
    CAT: { x: 2146, z: 4583, level: 1 },
    DEMONS: { x: 2142, z: 4561, level: 1 },
    OTHAINIAN: { x: 2125, z: 4566, level: 1 },
    SOUTH: { x: 2146, z: 4604, level: 1 },
    MONKS: { x: 2160, z: 4628, level: 1 },
    TEMPLE: { x: 2161, z: 4640, level: 1 },
    CAGES: { x: 2124, z: 4686, level: 1 },
};
/** [from, to, bridge, direction from -> to]; each is walked both ways. */
const LINKS: Array<[Platform, Platform, Bridge, 'N' | 'S' | 'E' | 'W']> = [
    ['CAVERN', 'WITCH', BR.toWitch, 'W'],
    ['WITCH', 'CAT', BR.toCat, 'W'],
    ['CAT', 'DEMONS', BR.toDemons, 'S'],
    ['DEMONS', 'OTHAINIAN', BR.toOthainian, 'W'],
    ['CAT', 'SOUTH', BR.toSouth, 'E'],
    ['SOUTH', 'MONKS', BR.toMonks, 'N'],
    ['MONKS', 'TEMPLE', BR.toTemple, 'N'],
    ['CAVERN', 'CAGES', BR.toCages, 'E'],
];
const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' } as const;
/** Inside Kardia's house: its door shuts behind you. */
const inWitchHouse = (p: Tile) => (p.level ?? 0) === 1 && inBox(p, 2150, 2158, 4562, 4566);

function platform(q: Quest): Platform | null {
    for (const [name, at] of Object.entries(PLATFORMS) as Array<[Platform, Tile]>) if (reachable(q, at)) return name;
    return null;
}

/** Over the cavern's bridges to `goal` (from the dwarfs' level, Kardia's house or any platform). */
async function toPlatform(q: Quest, goal: Platform): Promise<void> {
    for (let hops = 0; hops < 12; hops++) {
        if (pos(q).level === 0 && inCavernLower(pos(q))) await stairs(q, true);
        if (inWitchHouse(pos(q)) && !platform(q)) {
            await opAt(q, 2158, 4566, LOC.witchDoor, 1, () => !inWitchHouse(pos(q)) || !!platform(q), 'leave the witch\'s house', 15);
            await settle(q, 4);
        }
        const here = platform(q);
        if (!here) throw new Error(`upass: on no known platform at ${where(q)}`);
        if (here === goal) return;
        // Breadth-first over the links for the next hop.
        const prev = new Map<Platform, [Platform, Bridge, 'N' | 'S' | 'E' | 'W']>();
        const queue: Platform[] = [here];
        while (queue.length && !prev.has(goal)) {
            const at = queue.shift()!;
            for (const [a, b, br, dir] of LINKS) {
                const [next, d] = a === at ? [b, dir] : b === at ? [a, OPPOSITE[dir]] : [null, dir];
                if (!next || next === here || prev.has(next)) continue;
                prev.set(next, [at, br, d]);
                queue.push(next);
            }
        }
        let hop: Platform = goal;
        while (prev.get(hop)![0] !== here) hop = prev.get(hop)![0];
        const [, br, dir] = prev.get(hop)!;
        await crossBridge(q, br, dir, () => toPlatform(q, here));
    }
    throw new Error(`upass: too many bridges toward ${goal} (at ${where(q)})`);
}

// ── stage steps

/** King Lathas (East Ardougne castle, upstairs): needs Ranged 25 base. Sets the started bit. */
export async function startQuest(q: Quest): Promise<void> {
    await seeLathas(q);
}

/** Koftik's first talk at the cave entrance (stage 1). */
export async function meetKoftik(q: Quest): Promise<void> {
    await toYard(q);
    await enterCave(q);
}

/** Into the cave, Koftik's cloth, and the burning arrow at the guide rope (stage 2). */
export async function crossTheChasm(q: Quest): Promise<void> {
    await advance(q, 'WEST');
}

/** The four orbs into the furnace, then down the well (stage 3). */
export async function destroyOrbs(q: Quest): Promise<void> {
    await advance(q, 'ORBS');
    const t0 = tickNow(q.sdk);
    // The ground orbs (one of each per player), then the flat rock's.
    const ORB_SPOTS = [
        { x: 2386, z: 9677, stand: { x: 2387, z: 9676 } },
        { x: 2385, z: 9685, stand: { x: 2386, z: 9685 } },
        { x: 2416, z: 9698, stand: { x: 2416, z: 9696 } },
    ];
    for (const spot of ORB_SPOTS) {
        if (count(q, ITEM.orb) >= 4) break;
        await eatIfLow(q, 0.6);
        await walk(q, spot.stand, 2);
        await pickUpNear(q, ITEM.orb, 4);
    }
    if (count(q, ITEM.orb) < 4 && freeSlots(q) > 0) {
        await eatIfLow(q, 0.6);
        await walk(q, { x: 2383, z: 9668 }, 0);
        const before = count(q, ITEM.orb);
        await opAt(q, 2382, 9668, LOC.flatRock, 1, () => count(q, ITEM.orb) > before, 'disarm the flat rock for the orb', 25, [/yes, i'll give it a go/i]);
    }
    q.log(`upass: holding ${count(q, ITEM.orb)} orbs (hp ${hp(q)}/${maxHp(q)})`);
    await eatIfLow(q, 0.7);
    await walk(q, { x: 2453, z: 9681 }, 1);
    for (let i = 0; i < 8 && held(q, ITEM.orb); i++) {
        const before = count(q, ITEM.orb);
        await useAt(q, ITEM.orb, 2454, 9682, LOC.furnace, () => count(q, ITEM.orb) < before, 'throw an orb into the furnace', 12);
        await q.sdk.waitForTicks(3);
    }
    q.log(`upass: orbs into the furnace in ${tickNow(q.sdk) - t0}t`);
    await eatIfLow(q, 0.7);
    await forward(q, 'ORBS');
}

/** Area 2 to the unicorn pen; the cage's railing on the boulder (stage 4). */
export async function killUnicorn(q: Quest): Promise<void> {
    await advance(q, 'PEN');
    if (!held(q, ITEM.railing)) {
        await walk(q, { x: 2397, z: 9606 }, 1);
        await opAt(q, 2397, 9605, LOC.cage3, 2, () => !!held(q, ITEM.railing), 'search the cage for a railing', 12);
    }
    for (let attempt = 1; attempt <= 3 && reachable(q, REGIONS[15]!.at); attempt++) {
        const boulder = q.sdk.findNearbyNpc(/^boulder$/i);
        const rail = held(q, ITEM.railing);
        if (!boulder || !rail) throw new Error(`upass: boulder ${boulder ? 'seen' : 'missing'}, railing ${rail ? 'held' : 'missing'} (at ${where(q)})`);
        await q.sdk.sendUseItemOnNpc(rail.slot, boulder.index);
        await untilTicks(q.sdk, () => !reachable(q, REGIONS[15]!.at), 15);
        await settle(q, 6);
    }
    q.log(`upass: the boulder fell on the unicorn; at ${where(q)}`);
}

/** The horn, the paladins' badges, all into the well; through the double door (stage 5). */
export async function feedWell(q: Quest): Promise<void> {
    // After the unicorn the pipe from the east lands by the cage remains.
    await advance(q, 'C4').catch(async (e) => {
        if (region(q) !== 'C8') throw e;
    });
    if (region(q) === 'C4' && !held(q, ITEM.horn)) {
        await walk(q, { x: 2372, z: 9602 }, 2);
        await opAt(q, 2371, 9603, LOC.cageRemains, 1, () => !!held(q, ITEM.horn), 'search the cage remains for the horn', 15);
    }
    await advance(q, 'C8');
    await wieldWeapon(q);
    for (const name of ['Sir Jerro', 'Sir Carl', 'Sir Harry']) {
        if (count(q, ITEM.badge) >= 3) break;
        await walk(q, { x: 2421, z: 9720 }, 3);
        const before = count(q, ITEM.badge);
        if (!q.sdk.findNearbyNpc(new RegExp(`^${name}$`, 'i'))) continue;
        await kill(q, new RegExp(`^${name}$`, 'i'), name);
        await pickUpNear(q, ITEM.badge, 6);
        if (count(q, ITEM.badge) === before) q.log(`upass: ${name} dropped no badge we could take`);
    }
    if (count(q, ITEM.badge) < 3) throw new Error(`upass: only ${count(q, ITEM.badge)} paladin badges`);
    await walk(q, { x: 2375, z: 9719 }, 2);
    for (let i = 0; i < 6 && (held(q, ITEM.badge) || held(q, ITEM.horn)); i++) {
        const item = held(q, ITEM.horn) ? ITEM.horn : ITEM.badge;
        const before = q.sdk.getInventory().length;
        await useAt(q, item, 2373, 9718, LOC.bloodwell, () => q.sdk.getInventory().length < before, 'feed the well', 12);
    }
    await forward(q, 'C8');
}

/** Down to the dwarfs: Nilhoof (stage 6), and the bucket filled at their brew barrel. */
export async function meetDwarfs(q: Quest): Promise<void> {
    await advance(q, 'DWARFS');
    await walk(q, { x: 2317, z: 9806 }, 2);
    await makeRoom(q, 3);
    const seen = await talkThrough(q.sdk, q.bot, /^nilhoof$/i, [], q.log);
    if (!seen) q.log(`upass: Nilhoof said nothing (at ${where(q)})`);
    await fillBrew(q);
}

async function fillBrew(q: Quest): Promise<void> {
    if (held(q, ITEM.brew) || !held(q, ITEM.bucket)) return;
    if (pos(q).level !== 0) return;
    await walk(q, { x: 2326, z: 9800 }, 1);
    await q.reach(/^barrel$/i).catch(() => undefined);
    await useAt(q, ITEM.bucket, 2327, 9799, LOC.barrel, () => !!held(q, ITEM.brew), 'fill the bucket with dwarf brew', 15);
}

/** The witch's cat at her door, her chest: the doll (stage 7). */
export async function stealDoll(q: Quest): Promise<void> {
    if (pos(q).level === 0 && region(q) === 'DWARFS') await fillBrew(q);
    await advance(q, 'CAVERN');
    for (let attempt = 1; attempt <= 3 && !held(q, ITEM.cat); attempt++) {
        await toPlatform(q, 'CAT');
        await walk(q, { x: 2133, z: 4600, level: 1 }, 3);
        await untilTicks(q.sdk, () => !!q.sdk.findNearbyNpc(/^witches cat$/i), 30);
        const cat = q.sdk.findNearbyNpc(/^witches cat$/i);
        if (!cat) {
            q.log('upass: the witch\'s cat is not here (another player has it?) — waiting');
            await q.sdk.waitForTicks(30);
            continue;
        }
        if (freeSlots(q) < 1) await makeRoom(q, 1);
        await q.bot.interactNpc(cat, /^pick-up$/i).catch(() => undefined);
        await untilTicks(q.sdk, () => !!held(q, ITEM.cat), 15);
    }
    if (!held(q, ITEM.cat)) throw new Error('upass: could not pick up the witch\'s cat');
    await toPlatform(q, 'WITCH');
    await walk(q, { x: 2158, z: 4567, level: 1 }, 1);
    const mark = messageId(q);
    await useAt(q, ITEM.cat, 2158, 4566, LOC.witchDoor, () => said(q, mark, /takes the cat inside|busy playing/i), 'leave the cat at the witch\'s door', 20);
    await walk(q, { x: 2158, z: 4567, level: 1 }, 1);
    await opAt(q, 2158, 4566, LOC.witchDoor, 1, () => pos(q).z <= 4566, 'open the witch\'s door', 15);
    await makeRoom(q, 4);
    await opAt(q, 2157, 4564, LOC.chest, 1, () => !!held(q, ITEM.doll), 'search the witch\'s chest', 20);
    if (!held(q, ITEM.doll)) throw new Error(`upass: the witch's chest gave no doll (at ${where(q)})`);
    await dropAll(q, /^history of iban$/i);
}

/** A doll for the parts: lost (a death, a bank) means Nilhoof's spare. */
async function ensureDoll(q: Quest): Promise<void> {
    if (held(q, ITEM.doll)) return;
    q.log('upass: no doll held — Nilhoof has one');
    if (!inCavernUpper(pos(q)) && !inCavernLower(pos(q))) await advance(q, 'DWARFS');
    if (pos(q).level === 1) {
        await toPlatform(q, 'CAVERN');
        await stairs(q, false);
    }
    await walk(q, { x: 2317, z: 9806 }, 2);
    await makeRoom(q, 2);
    await talkThrough(q.sdk, q.bot, /^nilhoof$/i, [], q.log);
    if (!held(q, ITEM.doll)) throw new Error('upass: Nilhoof gave no doll');
}

/** The three demons' amulets open the chest: Iban's shadow on the doll. */
export async function shadowStep(q: Quest): Promise<void> {
    if ((await journalText(q)).includes('Collecting Shadow was tough')) return;
    await ensureDoll(q);
    if (!held(q, ITEM.shadow)) {
        if (!inCavernUpper(pos(q)) && !inCavernLower(pos(q))) await advance(q, 'CAVERN');
        await wieldWeapon(q);
        const onDemons = () => platform(q) === 'DEMONS';
        if (platform(q) !== 'OTHAINIAN') await toPlatform(q, 'DEMONS');
        const need = (re: RegExp) => !held(q, re);
        if (onDemons() && need(/^amulet of doomion$/i)) {
            await walk(q, { x: 2135, z: 4564, level: 1 }, 4);
            if (await kill(q, /^doomion$/i, 'Doomion')) await pickUpNear(q, /^amulet of doomion$/i, 8);
        }
        if (onDemons() && need(/^amulet of holthion$/i)) {
            await walk(q, { x: 2132, z: 4556, level: 1 }, 4);
            if (await kill(q, /^holthion$/i, 'Holthion')) await pickUpNear(q, /^amulet of holthion$/i, 8);
        }
        if (need(/^amulet of othanian$/i)) {
            await toPlatform(q, 'OTHAINIAN');
            await walk(q, { x: 2122, z: 4563, level: 1 }, 4);
            if (await kill(q, /^othainian$/i, 'Othainian')) await pickUpNear(q, /^amulet of othanian$/i, 8);
            await toPlatform(q, 'DEMONS');
        }
        if (count(q, ITEM.amulet) < 3) throw new Error(`upass: only ${count(q, ITEM.amulet)} demon amulets (${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
        await walk(q, { x: 2136, z: 4577, level: 1 }, 1);
        await opAt(q, 2136, 4578, LOC.shutChest, 1, () => !!held(q, ITEM.shadow), 'open the sealed chest', 15);
    }
    await combine(q, ITEM.shadow, ITEM.doll, () => !held(q, ITEM.shadow), 'pour the shadow over the doll');
    // Back toward the arrival platform for the next part.
}

/** The soulless man's cage holds Iban's dove: conscience on the doll. */
export async function doveStep(q: Quest): Promise<void> {
    if ((await journalText(q)).includes('After searching some cages I found')) return;
    await ensureDoll(q);
    if (!held(q, ITEM.dove)) {
        if (!inCavernUpper(pos(q)) && !inCavernLower(pos(q))) await advance(q, 'CAVERN');
        await toPlatform(q, 'CAGES');
        await walk(q, { x: 2134, z: 4700, level: 1 }, 1);
        await opAt(q, 2134, 4702, LOC.doveCage, 1, () => !!held(q, ITEM.dove), 'search the soulless man\'s cage', 20);
    }
    await combine(q, ITEM.dove, ITEM.doll, () => !held(q, ITEM.dove), 'crumble the dove into the doll');
}

/** Dwarf brew on Iban's tomb, then the tinderbox: his ashes on the doll. */
export async function ashesStep(q: Quest): Promise<void> {
    if ((await journalText(q)).includes('Having burned Iban')) return;
    await ensureDoll(q);
    if (!held(q, ITEM.ashes)) {
        await advance(q, 'DWARFS');
        await fillBrew(q);
        if (!held(q, /^tinderbox$/i)) {
            // Klank hands a tinderbox to anyone without one.
            await walk(q, { x: 2323, z: 9806 }, 2);
            await talkThrough(q.sdk, q.bot, /^klank$/i, [/what happened to them/i], q.log);
        }
        await walk(q, { x: 2357, z: 9802 }, 2);
        const mark = messageId(q);
        if (held(q, ITEM.brew)) await useAt(q, ITEM.brew, 2356, 9800, LOC.tomb, () => !held(q, ITEM.brew) || said(q, mark, /seems such a waste/i), 'pour the brew over the tomb', 12);
        await useAt(q, /^tinderbox$/i, 2356, 9800, LOC.tomb, () => !!held(q, ITEM.ashes) || said(q, mark, /will not light|find nothing/i), 'set light to the tomb', 15);
        if (!held(q, ITEM.ashes)) throw new Error(`upass: no ashes from the tomb: ${messagesSince(q, mark).slice(0, 200)}`);
    }
    await combine(q, ITEM.ashes, ITEM.doll, () => !held(q, ITEM.ashes), 'rub the ashes into the doll');
}

/** Kalrag, with the doll held: his blood on it. Then away from his spiders. */
export async function bloodStep(q: Quest): Promise<void> {
    if ((await journalText(q)).includes('blood-drinking spider')) return;
    await ensureDoll(q);
    await advance(q, 'DWARFS');
    await wieldWeapon(q);
    await eatIfLow(q, 0.8);
    await walk(q, { x: 2355, z: 9905 }, 3);
    const mark = messageId(q);
    if (!(await kill(q, /^kalrag$/i, 'Kalrag', 500))) throw new Error(`upass: Kalrag not killed (at ${where(q)})`);
    await untilTicks(q.sdk, () => said(q, mark, /smear the doll|already collected|dare not collect/i), 8);
    q.log(`upass: Kalrag: ${messagesSince(q, mark).slice(0, 160)}`);
    // His spiders all turn on us when he dies: up the stairs out of their reach.
    protect(q, true);
    try {
        await walk(q, { x: 2336, z: 9795 }, 2);
        await stairs(q, true);
    } finally {
        protect(q, false);
    }
}

/** Robes of Zamorak, worn alone; the temple; the doll into the well of the damned (stage 9). */
export async function defeatIban(q: Quest): Promise<void> {
    await ensureDoll(q);
    if (pos(q).level === 0) await advance(q, 'CAVERN');
    if (!inCavernUpper(pos(q)) && !inCavernLower(pos(q))) await advance(q, 'CAVERN');
    if (platform(q) !== 'TEMPLE') await toPlatform(q, 'MONKS');
    // Two robes from one disciple (iban_disciple.rs2 drops top and bottom on every kill).
    for (let attempt = 1; attempt <= 3 && count(q, ITEM.robe) + q.sdk.getEquipment().filter((e) => ITEM.robe.test(e.name)).length < 2; attempt++) {
        await wieldWeapon(q);
        if (!q.sdk.findNearbyNpc(/^iban disciple$/i)) await toPlatform(q, 'TEMPLE');
        await makeRoom(q, 3);
        if (await kill(q, /^iban disciple$/i, 'an Iban disciple', 200)) await pickUpNear(q, ITEM.robe, 6);
    }
    await toPlatform(q, 'TEMPLE');
    // Only the two robes worn: everything else off.
    for (const e of q.sdk.getEquipment().filter((it) => !ITEM.robe.test(it.name))) {
        if (freeSlots(q) < 1) await makeRoom(q, 1);
        await q.bot.unequipItem(e).catch(() => undefined);
        await q.sdk.waitForTicks(1);
    }
    for (let i = 0; i < 3 && held(q, ITEM.robe); i++) {
        await q.bot.equipItem(held(q, ITEM.robe)!).catch(() => undefined);
        await q.sdk.waitForTicks(1);
    }
    const worn = q.sdk.getEquipment().map((e) => e.name);
    if (worn.length !== 2 || !worn.every((n) => ITEM.robe.test(n))) throw new Error(`upass: the temple needs exactly the two robes worn (wearing ${worn.join(', ') || 'nothing'})`);
    // Full health into the temple: Iban's bolts hit a robed player hard.
    for (let i = 0; i < 4 && hp(q) < maxHp(q) - 15; i++) await eatIfLow(q, 1);
    await walk(q, { x: 2145, z: 4647, level: 1 }, 1);
    await opAt(q, 2143, 4647, LOC.templeDoor, 1, () => pos(q).x <= 2142, 'open the temple doors', 15);
    if (pos(q).x > 2142) throw new Error(`upass: the temple doors stayed shut (at ${where(q)})`);
    // Iban's bolts land in front of the altar (5-10 each, and a shove east): no settling in here,
    // eat between throws and throw again at once.
    for (let attempt = 1; attempt <= 10 && pos(q).level === 1; attempt++) {
        await eatIfLow(q, 0.7);
        const doll = held(q, ITEM.doll);
        if (!doll) break;
        const mark = messageId(q);
        await q.sdk.sendUseItemOnLoc(doll.slot, 2136, 4647, LOC.altar);
        await untilTicks(q.sdk, () => pos(q).level === 0, 12);
        if (pos(q).level === 1) q.log(`upass: doll throw ${attempt} at ${where(q)} (hp ${hp(q)}): ${messagesSince(q, mark).slice(0, 120) || 'no reply'}`);
    }
    await settle(q, 6);
    if (pos(q).level !== 0) throw new Error(`upass: the doll did not finish Iban (at ${where(q)})`);
    q.log(`upass: Iban is dead; thrown out to ${where(q)}`);
    // The robes off again (the run ends naked at the bank), the weapon back on.
    for (const robe of q.sdk.getEquipment().filter((e) => ITEM.robe.test(e.name))) {
        if (freeSlots(q) < 1) await makeRoom(q, 1);
        await q.bot.unequipItem(robe).catch(() => undefined);
        await q.sdk.waitForTicks(1);
    }
    await wieldWeapon(q);
}

/** Koftik's cave out (he leads you to the entrance), the pass exit, King Lathas (complete). */
export async function reportToLathas(q: Quest): Promise<void> {
    if (inUpassArea(pos(q))) await leaveUpass(q);
    await throughWallDoors(q, false);
    await seeLathas(q);
}

// ── out of the pass (run-quest's goTo and prologue)

/** Falador Teleport (Magic 37: 1 law, 3 air, 1 water) if the pack holds the runes. */
async function teleportOut(q: Quest): Promise<boolean> {
    const runes = q.count('law rune') >= 1 && q.count('air rune') >= 3 && q.count('water rune') >= 1;
    if (!runes || q.level('magic') < 37) return false;
    for (let attempt = 1; attempt <= 3 && inUpassArea(pos(q)); attempt++) {
        await q.sdk.sendSetTab(6).catch(() => undefined);
        await q.sdk.waitForTicks(1);
        await q.sdk.sendClickComponent(1170);
        await untilTicks(q.sdk, () => !inUpassArea(pos(q)), 8);
    }
    return !inUpassArea(pos(q));
}

/**
 * Out of the pass onto the West Ardougne yard. Walked back from area 1 (lever, swing, pipe),
 * area 2's well landing (the mud pile) and Koftik's cave after Iban; anywhere deeper needs the
 * teleport runes, or it throws.
 */
export async function leaveUpass(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    for (let legs = 0; legs < 20 && inUpassArea(pos(q)); legs++) {
        await eatIfLow(q);
        // Koftik's cave, after Iban (thrown out by it at 2482,9607).
        if (reachable(q, { x: 2440, z: 9607 })) {
            await walk(q, { x: 2440, z: 9607 }, 2);
            await opAt(q, 2438, 9607, LOC.lastOut, 1, () => reachable(q, REGIONS[0]!.at), 'enter Koftik\'s cave', 20);
            await driveDialog(q.sdk, [], { ticks: 40 });
            await settle(q, 6);
            continue;
        }
        if (await recover(q)) continue;
        const here = region(q);
        switch (here) {
            case 'ENTRANCE':
                await walk(q, { x: PASS_EXIT.x - 2, z: PASS_EXIT.z + 2 }, 2).catch(() => undefined);
                await opAt(q, PASS_EXIT.x, PASS_EXIT.z, PASS_EXIT.id, 1, () => !inUpassArea(pos(q)), 'leave by the pass exit', 15);
                break;
            case 'KOFTIK':
                await rockslides(q, [...ENTRANCE_ROCKS].reverse(), REGIONS[0]!.at);
                break;
            case 'WEST':
                await walk(q, { x: 2437, z: 9717 }, 2);
                await opAt(q, 2436, 9716, LOC.oldLever, 1, () => reachable(q, REGIONS[1]!.at), 'pull the old lever', 20);
                break;
            case 'SWING':
                await walk(q, { x: 2465, z: 9692 }, 1);
                await opAt(q, 2461, 9692, LOC.ropeSwing, 1, () => reachable(q, REGIONS[2]!.at), 'the rope swing back west', 20);
                break;
            case 'K':
                await rockslides(q, [{ x: 2491, z: 9691 }], REGIONS[3]!.at);
                break;
            case 'GRID':
                await rockslides(q, [{ x: 2482, z: 9679 }], REGIONS[4]!.at);
                break;
            case 'ORBS':
                await walk(q, { x: 2451, z: 9688 }, 1);
                await opAt(q, 2451, 9689, LOC.pipe4, 1, () => reachable(q, REGIONS[2]!.at), 'squeeze north through the pipe', 25);
                break;
            case 'A2':
                await walk(q, { x: 2423, z: 9662 }, 2);
                await opAt(q, 2423, 9661, LOC.mudpile, 1, () => reachable(q, REGIONS[6]!.at), 'climb the pipe out of area 2', 15);
                break;
            default:
                if (await teleportOut(q)) break;
                throw new Error(`upass: stranded at ${where(q)} (${here ?? 'unknown pocket'}) — no walk out from there and no teleport runes`);
        }
        await settle(q, 4);
    }
    if (inUpassArea(pos(q))) throw new Error(`upass: could not leave the pass (at ${where(q)})`);
    q.log(`upass: out of the pass to ${where(q)} in ${tickNow(q.sdk) - t0}t`);
}
