/**
 * Legends' Quest — the route and mechanics (bots/quests/legends-quest.ts is the definition).
 *
 * Content: quest_legends/scripts/*.rs2 (radimus_erkle, radimus_notes, jungle_tree, jungle_forester,
 * bullroarer, gujuo, ungadulu, quest_legends — the caves' trials, the pool, the Yommi tree —,
 * book_of_binding, echned_zekin, nezikchened, viyeldi, legends_boulder, the three heroes) and
 * skill_magic/scripts/spells/charge_orb.rs2 (the magic trial gate takes a Charge Orb cast on it).
 *
 * The map, as the client's collision sees it (probed on the fast engine, 2026-11-04):
 *   - The Kharazi jungle (south Karamja, z 2882-2939) is ringed by jungle trees and bushes. Its inside
 *     is one walkable region. The way in used here: stand at (2819,2940) beside the foresters and chop
 *     the bushes south twice (each chop that clears one teleports you 2 tiles on) to (2819,2936). Out:
 *     the reverse. Chopping needs the notes (or the finished map), an axe and a machete, and it boils
 *     the water out of a golden bowl: never chop while carrying sacred water you still need.
 *   - No bank is reachable on this side of Karamja (Shilo Village's sits behind gates the client
 *     cannot route to), so each phase carries its own kit from the Ardougne bank, by the Brimhaven boat.
 *     The sacred water forces the order: everything the octagram fight needs is packed before the bowl
 *     is filled, and the gems and runes are spent on the Book of Binding first to make room.
 *   - The shaman caves (m43_145) under the three rocks at (2780-2782,2935): Ungadulu's octagram
 *     room (A) → the bookcase crevice (B) → the lockpick gate (Thieving 50) → three boulders (Mining 52,
 *     each one teleports you two tiles past it) → the strength gate (Strength 50) → the deathwings' room
 *     (D) → the jagged wall (Agility 50) → a walled cavern (E) → the marked wall (Soul, Mind, Earth,
 *     Law, Law) → the gem room (F; seven cut gems on seven carved rocks summon the Book of Binding) →
 *     the magic trial gate (a Charge Orb spell on the gate; SDK sendSpellOnLoc) → the winch room (G).
 *     The SDK's pathfinder masks doors, so the gates do not show as walls in a reachability probe.
 *   - The Viyeldi caves (m37_73) at the foot of the winch rope: a chain of ledges and rocks from the
 *     landing pocket to the main cave (the three heroes, the lava furnace, the dragon's eye rock), the
 *     heart recess and its barrier, and behind it the boulders that stopper the source.
 *
 * Route choices:
 *   - Viyeldi is killed with the spirit's dagger and the glowing dagger handed back (echned_zekin.rs2):
 *     the demon appears there and then, in the Viyeldi caves, so the second fight needs no climb to
 *     Ungadulu for the Holy Force spell — and no second orb for the magic gate. The price is the final
 *     fight: Nezikchened sends the three heroes first (nezikchened.rs2 summon_nezi_part3).
 *   - Gujuo blesses the bowl with a Prayer roll that FAILS more often the higher the current Prayer
 *     (gujuo.rs2: stat_random(prayer, 80, 250) = true is the failure), each failure draining 5 points;
 *     below 42 he refuses. The step re-asks until blessed and drinks a prayer potion when refused.
 */
import type { Quest } from './run-quest';
import { NeedsStock } from './run-quest';
import type { NearbyLoc, NearbyNpc } from '../../../sdk/types';
import { driveDialog } from './dialog';
import { tickNow, ticksToMs, untilTicks } from './ticks';
import { HERBS, homeFromJungle, onIsland, pickHerb, toJungle } from './jungle-potion';
import { PrayerFlicker } from '../prayer-flick';
import { requestFromMule } from '../supply';
import { itemPattern } from './sources';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const JOURNAL = { label: 'Legends Quest', title: 'The Legends Quest' };

// ── places
const GUILD_GATE_OUT = { x: 2728, z: 3347 };
const RADIMUS_STUDY = { x: 2724, z: 3367 };
const CUPBOARD = { x: 2724, z: 3370 };
const GUILD_DOOR_OUT = { x: 2728, z: 3371 };
const RADIMUS_HALL = { x: 2724, z: 3377 };
/** Beside the jungle foresters; two bushes south of it lead into the jungle. */
const JUNGLE_OUT = { x: 2819, z: 2940 };
const JUNGLE_IN = { x: 2819, z: 2936 };
const ARDOUGNE_BANK = { x: 2655, z: 3283 };
/** One standing tile per map section (radimus_notes.rs2 / legends_zones.dbrow). */
const MAP_SPOTS: Record<'west' | 'middle' | 'east', Tile> = {
    middle: { x: 2830, z: 2925 },
    west: { x: 2800, z: 2925 },
    east: { x: 2890, z: 2925 },
};
const CAVE_ROCKS = { x: 2781, z: 2933 };
/** Where the cave entrance puts you (quest_legends.rs2 legends_cave_entrance). */
const CAVE_EXIT = { x: 2781, z: 2934 };
const POOL = { x: 2837, z: 2915 };
const REEDS = { x: 2836, z: 2916 };
const TAI_BWO_ANVIL = { x: 2790, z: 3101 };
/** The fertile soil nearest the cave mouth (get_yommi_planter's first spot). */
const SOIL = { x: 2778, z: 2916 };
/** The corrupted totem pole nearest the soil. */
const TOTEM = { x: 2793, z: 2908 };

// shaman caves (m43_145)
const CAVE = {
    entrance: { x: 2773, z: 9341 },
    nearOctagram: { x: 2785, z: 9330 },
    ungadulu: { x: 2792, z: 9327 },
    bookcase: { x: 2795, z: 9339 },
    crevice: { x: 2799, z: 9341 },
    lockGateNorth: { x: 2809, z: 9334 },
    boulderX: 2809,
    boulders: [9327, 9323, 9319],
    strengthGate: { x: 2809, z: 9314 },
    jaggedSouth: { x: 2790, z: 9294 },
    jaggedNorth: { x: 2789, z: 9296 },
    markedEast: { x: 2779, z: 9305 },
    markedWest: { x: 2776, z: 9303 },
    book: { x: 2765, z: 9297 },
    magicGateSouth: { x: 2762, z: 9313 },
    magicGateNorth: { x: 2762, z: 9317 },
    winch: { x: 2759, z: 9329 },
};
/** legends_gem_data.dbrow: each gem's carved rock. */
const GEM_ROCKS: Array<{ gem: string; x: number; z: number }> = [
    { gem: 'opal', x: 2764, z: 9309 },
    { gem: 'jade', x: 2771, z: 9303 },
    { gem: 'red topaz', x: 2772, z: 9295 },
    { gem: 'sapphire', x: 2781, z: 9291 },
    { gem: 'diamond', x: 2774, z: 9287 },
    { gem: 'ruby', x: 2767, z: 9289 },
    { gem: 'emerald', x: 2757, z: 9297 },
];
/** Rune order on the marked wall: S, M, E, L, L. */
const WALL_RUNES = ['soul rune', 'mind rune', 'earth rune', 'law rune', 'law rune'];

// Viyeldi caves (m37_73)
const VIY = {
    landing: { x: 2377, z: 4712 },
    rope: { x: 2377, z: 4711 },
    hat: { x: 2379, z: 4712 },
    /** Landing pocket → main cave, in order (probed 2026-11-04). */
    chain: [
        { name: /^rocky ledge$/i, x: 2377, z: 4717, yes: /yes, i can think of nothing more exciting/i },
        { name: /^rocky ledge$/i, x: 2377, z: 4728, yes: /yes, i can think of nothing more exciting/i },
        { name: /^rocky ledge$/i, x: 2382, z: 4729, yes: /yes, i can think of nothing more exciting/i },
        { name: /^rocks$/i, x: 2387, z: 4728, yes: /yes, i want to climb over the rocks/i },
        { name: /^rocks$/i, x: 2390, z: 4724, yes: /yes, i want to climb over the rocks/i },
        { name: /^rocks$/i, x: 2390, z: 4718, yes: /yes, i want to climb over the rocks/i },
    ],
    main: { x: 2395, z: 4721 },
    furnace: { x: 2426, z: 4726 },
    eyeRock: { x: 2410, z: 4715 },
    recess: { x: 2422, z: 4691 },
    barrier: { x: 2421, z: 4690 },
    /** Behind the barrier: the boulders' cave. */
    source: { x: 2395, z: 4685 },
};
/** Charge Water Orb (magic.if water_orb; Magic 56: 30 water, 3 cosmic). */
const CHARGE_WATER_ORB = 1179;
const MAGIC_TAB = 6;

// ── items (ids where names collide: four "Golden bowl"s, two "Radimus notes")
export const ID = {
    notes: 714,
    notesDone: 715,
    bullroarer: 716,
    bowl: 721,
    bowlBlessed: 722,
    bowlWater: 723,
    bowlPure: 724,
    bowlBlessedWater: 725,
    bowlBlessedPure: 726,
    reed: 727,
    book: 730,
    seeds: 735,
    seedsGerm: 736,
    snakeMix: 737,
    ardrigalMix: 738,
    bravery: 739,
    crystalA: 741,
    crystalB: 742,
    crystalC: 743,
    heart: 744,
    heartGlow: 745,
    dagger: 746,
    daggerDone: 747,
    holyForce: 748,
    totem: 749,
    gilded: 750,
    machete: 975,
    snakeWeed: 1526,
    ardrigal: 1528,
    vialWater: 227,
};
const FOOD = /^(shark|swordfish|lobster|monkfish|tuna|bass|karambwan)$/i;
const POTION = /^prayer potion\(\d\)$/i;
const PROTECT_MELEE_LEVEL = 43;

// ── where we are
const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
const dist = (a: Tile, b: Tile) => Math.hypot(a.x - b.x, a.z - b.z);

/** Inside the jungle ring (legends_zones kharazi_jungle, plus the inner edge up to z 2939). */
export const inKharazi = (p: Tile) => inBox(p, 2750, 2980, 2878, 2939);
export const inShamanCaves = (p: Tile) => inBox(p, 2752, 2815, 9280, 9343);
export const inViyeldi = (p: Tile) => inBox(p, 2368, 2431, 4672, 4735);
/** The foresters' clearing north of our way in (west of Shilo): home from here is the Brimhaven boat. */
const inClearing = (p: Tile) => inBox(p, 2750, 2890, 2940, 2950);
/** The Legends' Guild main hall, behind doors walkTo cannot open (legends_door.rs2). */
const inGuildHall = (p: Tile) => inBox(p, 2715, 2745, 3373, 3395) && (p.level ?? 0) === 0;
/** Anywhere goTo cannot walk out of: run-quest's goTo and prologue call leaveLegends from these. */
export const inLegendsArea = (p: Tile) => inKharazi(p) || inShamanCaves(p) || inViyeldi(p) || inClearing(p) || inGuildHall(p);

// ── small helpers
const inv = (q: Quest) => q.sdk.getInventory();
const heldId = (q: Quest, id: number) => inv(q).find((i) => i.id === id);
const countId = (q: Quest, id: number) => inv(q).filter((i) => i.id === id).reduce((n, i) => n + (i.count ?? 1), 0);
const held = (q: Quest, item: RegExp) => inv(q).find((i) => item.test(i.name));
const hp = (q: Quest) => q.sdk.getState()?.player?.hp ?? 0;
const maxHp = (q: Quest) => q.sdk.getState()?.player?.maxHp ?? 1;
const prayerPts = (q: Quest) => q.sdk.getPrayerState()?.prayerPoints ?? 0;
const lastMsgId = (q: Quest) => (q.sdk.getState()?.gameMessages ?? []).at(-1)?.observationId ?? -1;
const msgsSince = (q: Quest, id: number) =>
    (q.sdk.getState()?.gameMessages ?? [])
        .filter((m) => (m.observationId ?? 0) > id)
        .map((m) => m.text)
        .join(' | ');
const dialogOpen = (q: Quest) => !!q.sdk.getDialog()?.isOpen;
const stageNum = (q: Quest) => STAGE_VALUE[q.stage] ?? 0;

/** Journal stage id → %legendsquest (quest_legends.constant), for ordering checks. */
export const STAGE_VALUE: Record<string, number> = {
    unstarted: 0,
    started: 1,
    mapped: 2,
    bullroarer: 3,
    accepted: 5,
    entrance: 6,
    spoke: 7,
    asked: 8,
    filled: 10,
    summoned: 11,
    freed: 12,
    germinated: 13,
    dried: 14,
    recipe: 15,
    viyeldi: 16,
    smelted: 17,
    recess: 18,
    spirit: 19,
    dagger: 20,
    source: 22,
    water: 25,
    totem: 30,
    final: 32,
    slain: 35,
    gilded: 45,
    returned: 50,
    training: 55,
    complete: 75,
};

let eaten = 0;
export async function eatIfLow(q: Quest, frac = 0.55): Promise<void> {
    for (let i = 0; i < 3 && hp(q) > 0 && hp(q) < maxHp(q) * frac; i++) {
        const food = held(q, FOOD);
        if (!food) return;
        const before = hp(q);
        await q.bot.eatFood(food).catch(() => undefined);
        if (await untilTicks(q.sdk, () => hp(q) > before, 3)) eaten++;
    }
}

/** A prayer potion dose when below `points`. */
async function drinkPrayer(q: Quest, points: number): Promise<boolean> {
    if (prayerPts(q) >= points) return true;
    const pot = held(q, POTION);
    if (!pot) return false;
    const before = prayerPts(q);
    const opt = pot.optionsWithIndex.find((o) => /^drink$/i.test(o.text));
    await q.sdk.sendUseItem(pot.slot, opt?.opIndex ?? 1);
    await untilTicks(q.sdk, () => prayerPts(q) > before, 4);
    return prayerPts(q) > before;
}

async function locs(q: Quest, radius = 15): Promise<NearbyLoc[]> {
    await q.sdk.scanNearbyLocs(radius).catch(() => undefined);
    return q.sdk.getNearbyLocs() ?? [];
}

/** The loc named `name` (with option `opt`) nearest `near` (default: us). */
async function findLoc(q: Quest, name: RegExp, opt?: RegExp, near?: Tile, radius = 15): Promise<NearbyLoc | undefined> {
    const ref = near ?? pos(q);
    return (await locs(q, radius))
        .filter((l) => name.test(l.name) && (!opt || l.optionsWithIndex.some((o) => opt.test(o.text))))
        .sort((a, b) => dist(a, ref) - dist(b, ref))[0];
}

/** Op a loc and drive what it opens (pick `choices`); true once `done`. */
async function opLoc(q: Quest, loc: NearbyLoc, opt: RegExp, choices: Array<RegExp | string>, done: () => boolean, ticks = 30): Promise<boolean> {
    const option = loc.optionsWithIndex.find((o) => opt.test(o.text));
    if (!option) throw new Error(`legends: ${loc.name} at (${loc.x},${loc.z}) has no ${opt} option`);
    await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, option.opIndex);
    await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
    if (dialogOpen(q)) await driveDialog(q.sdk, choices, { done: () => done() && !dialogOpen(q), ticks: 80, log: q.log });
    return untilTicks(q.sdk, done, 5);
}

/** Use an inventory item (by id or pattern) on a loc, drive the dialog; true once `done`. */
async function useOnLoc(q: Quest, item: number | RegExp, loc: NearbyLoc, done: () => boolean, choices: Array<RegExp | string> = [], ticks = 30): Promise<boolean> {
    const it = typeof item === 'number' ? heldId(q, item) : held(q, item);
    if (!it) throw new Error(`legends: no ${item} to use on ${loc.name} (carrying ${describe(q)})`);
    await q.sdk.sendUseItemOnLoc(it.slot, loc.x, loc.z, loc.id);
    await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
    if (dialogOpen(q)) await driveDialog(q.sdk, choices, { done: () => done() && !dialogOpen(q), ticks: 80, log: q.log });
    return untilTicks(q.sdk, done, 5);
}

async function useOnNpc(q: Quest, item: number, npc: NearbyNpc, done: () => boolean, choices: Array<RegExp | string> = [], ticks = 30): Promise<boolean> {
    const it = heldId(q, item);
    if (!it) throw new Error(`legends: no item ${item} to use on ${npc.name} (carrying ${describe(q)})`);
    await q.sdk.sendUseItemOnNpc(it.slot, npc.index);
    await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
    if (dialogOpen(q)) await driveDialog(q.sdk, choices, { done: () => done() && !dialogOpen(q), ticks: 80, log: q.log });
    return untilTicks(q.sdk, done, 5);
}

/** Op an inventory item by its option text (Swing, Drink, Read...). */
async function opHeld(q: Quest, id: number, opt: RegExp, choices: Array<RegExp | string> = [], done: () => boolean = () => false, ticks = 12): Promise<boolean> {
    const it = heldId(q, id);
    if (!it) throw new Error(`legends: no item ${id} to op (carrying ${describe(q)})`);
    const o = it.optionsWithIndex.find((x) => opt.test(x.text));
    if (!o) throw new Error(`legends: ${it.name} has no ${opt} option (${it.optionsWithIndex.map((x) => x.text).join('/')})`);
    await q.sdk.sendUseItem(it.slot, o.opIndex);
    await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
    if (dialogOpen(q)) await driveDialog(q.sdk, choices, { done: () => done() && !dialogOpen(q), ticks: 60, log: q.log });
    return done();
}

async function combine(q: Quest, a: number, b: number, product: number, choices: Array<RegExp | string> = []): Promise<boolean> {
    for (let attempt = 1; attempt <= 3 && !heldId(q, product); attempt++) {
        const x = heldId(q, a);
        const y = heldId(q, b);
        if (!x || !y) return false;
        const mark = lastMsgId(q);
        await q.sdk.sendUseItemOnItem(x.slot, y.slot);
        await untilTicks(q.sdk, (s) => !!heldId(q, product) || !!s.dialog?.isOpen, 8);
        if (dialogOpen(q)) await driveDialog(q.sdk, choices, { ticks: 30, log: q.log });
        await untilTicks(q.sdk, () => !!heldId(q, product), 5);
        if (!heldId(q, product)) q.log(`legends: ${a} on ${b}: ${msgsSince(q, mark).slice(0, 160)}`);
    }
    return !!heldId(q, product);
}

/** Walk within one area (bot.walkTo; no run-quest hooks). */
async function walk(q: Quest, tile: Tile, tolerance = 1): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt++) {
        if (dist(pos(q), tile) <= tolerance) return;
        const r = await q.bot.walkTo(tile.x, tile.z, tolerance);
        if (r.success) return;
        q.log(`legends: walk to (${tile.x},${tile.z}) from ${where(q)}: ${r.message}`);
        await eatIfLow(q);
    }
    if (dist(pos(q), tile) > tolerance + 2) throw new Error(`legends: could not walk to (${tile.x},${tile.z}) from ${where(q)}`);
}

/** The client pathfinder reaches `tile` from here (doors masked). */
async function reaches(q: Quest, tile: Tile): Promise<boolean> {
    if (pos(q).x === tile.x && pos(q).z === tile.z) return true;
    const r = await q.sdk.sendFindPath(tile.x, tile.z, 400).catch(() => null);
    return !!r?.reachedDestination;
}

function describe(q: Quest): string {
    return inv(q).map((i) => `${i.name}${(i.count ?? 1) > 1 ? ` x${i.count}` : ''}`).join(', ') || 'nothing';
}

// ── the kit: what each phase carries, withdrawn at the Ardougne bank

export interface Want {
    label: string;
    /** Bank/inventory match: an obj id, a set of ids, or a name pattern. */
    id?: number;
    ids?: number[];
    pattern?: RegExp;
    count: number;
    /** Withdraw what the bank has, up to count; never a stop. */
    optional?: boolean;
    /** Not needed while this (held or banked) is had instead: two gold bars and a hammer, unless a bowl. */
    unless?: Want;
    /** Enough to skip a bank trip (food: 6 of 10 held is no reason to sail home); topped up to count at a bank. */
    min?: number;
}
const want = (label: string, count = 1, opts: Partial<Want> = {}): Want => ({ label, count, pattern: itemPattern(label), ...opts });
const quest = (label: string, id: number, count = 1): Want => ({ label, id, count });
const matches = (w: Want, it: { id: number; name: string }) => (w.ids ? w.ids.includes(it.id) : w.id !== undefined ? it.id === w.id : w.pattern!.test(it.name));
const heldOf = (q: Quest, w: Want) =>
    [...inv(q), ...q.sdk.getEquipment()].filter((i) => matches(w, i)).reduce((n, i) => n + (i.count ?? 1), 0);

/** Every quest item we may be holding: kept through every restock (never deposited). */
const QUEST_ITEMS = new Set<number>([
    ID.notes, ID.notesDone, ID.bullroarer, ID.bowl, ID.bowlBlessed, ID.bowlWater, ID.bowlPure, ID.bowlBlessedWater, ID.bowlBlessedPure,
    ID.book, ID.seeds, ID.seedsGerm, ID.snakeMix, ID.ardrigalMix, ID.bravery, ID.crystalA, ID.crystalB, ID.crystalC, ID.heart, ID.heartGlow,
    ID.dagger, ID.daggerDone, ID.holyForce, ID.totem, ID.gilded, ID.machete, ID.snakeWeed, ID.ardrigal,
]);

/** Quest items past their use (banked at a restock to make room): the book once the demon is slain, the bullroarer below ground. */
function spentQuestItem(q: Quest, id: number): boolean {
    const n = stageNum(q);
    if (id === ID.book) return n >= STAGE_VALUE.freed!;
    if (id === ID.bullroarer) return n >= STAGE_VALUE.recipe! && n < STAGE_VALUE.slain!;
    if (id === ID.reed) return n >= STAGE_VALUE.dried!;
    if (id === ID.snakeWeed || id === ID.ardrigal || id === ID.snakeMix || id === ID.ardrigalMix || id === ID.bravery) return n >= STAGE_VALUE.viyeldi!;
    if (id === ID.crystalA || id === ID.crystalB || id === ID.crystalC || id === ID.heart || id === ID.heartGlow) return n >= STAGE_VALUE.recess!;
    if (id === ID.dagger || id === ID.daggerDone || id === ID.holyForce) return n >= STAGE_VALUE.source!;
    if (id === ID.seeds || id === ID.seedsGerm) return n >= STAGE_VALUE.totem!;
    return false;
}

const FOOD_KIT = (n: number): Want => ({ label: 'shark', pattern: FOOD, count: n, min: Math.ceil(n / 2) });
const POTS = (n: number): Want => ({ label: 'prayer potion', pattern: POTION, count: n, optional: true });
const AXE = want('rune axe');
const MAP = (q: Quest): Want => (stageNum(q) >= 2 ? quest('radimus notes (complete)', ID.notesDone) : quest('radimus notes', ID.notes));
/** Coins: on the mainland both boats; on Karamja (or below it) the boat home. */
const BASE = (q: Quest): Want[] => [
    want('coins', onIsland(pos(q)) || inLegendsArea(pos(q)) ? 30 : 100),
    AXE,
    quest('machete', ID.machete),
    MAP(q),
    ...(stageNum(q) >= 3 && !spentQuestItem(q, ID.bullroarer) ? [quest('bullroarer', ID.bullroarer)] : []),
];

/** The trials' kit to the gem room (gems and runes only until the Book of Binding is held or used). */
const TRIALS = (q: Quest, toWinch: boolean): Want[] => {
    const needBook = stageNum(q) < STAGE_VALUE.freed! && !countId(q, ID.book);
    return [
        want('lockpick'),
        { label: 'pickaxe', pattern: /^(rune|adamant|mithril|steel|iron|bronze|dragon) pickaxe$/i, count: 1 },
        // Optional: a resumed run may have set them already (each rock and the wall keep their bit);
        // stockCheck stopped an unstocked account at the start.
        ...(needBook ? GEM_ROCKS.map((g) => want(g.gem, 1, { optional: true })) : []),
        ...(needBook ? [want('soul rune', 1, { optional: true }), want('mind rune', 1, { optional: true }), want('earth rune', 1, { optional: true }), want('law rune', 2, { optional: true })] : []),
        ...(toWinch ? [want('unpowered orb'), want('cosmic rune', 3), want('water rune', 30), want('rope')] : []),
    ];
};

/**
 * Hold `wants`: at the Ardougne bank (from Karamja: out of the jungle, the Brimhaven boat) deposit what is
 * neither wanted nor a quest item, withdraw what is short. A non-optional line the bank lacks stops
 * the run with NEEDS STOCK.
 */
export async function restock(q: Quest, wants: Want[], why: string): Promise<void> {
    // Optional lines (prayer potions, armour) are taken when we are at a bank anyway, never a trip of their own.
    const short = () => wants.filter((w) => !w.optional && heldOf(q, w) < (w.min ?? w.count) && !(w.unless && heldOf(q, w.unless) > 0));
    if (!short().length) return;
    q.log(`legends: restock for ${why}: short ${short().map((w) => `${w.label} ${heldOf(q, w)}/${w.count}`).join(', ')}`);
    if (onIsland(pos(q)) || inLegendsArea(pos(q))) {
        await leaveLegends(q, ARDOUGNE_BANK);
    }
    await q.goTo(ARDOUGNE_BANK, 4);
    let opened = false;
    for (let i = 0; i < 3 && !opened; i++) {
        opened = (await q.bot.openBank().catch(() => ({ success: false }))).success || !!q.sdk.getState()?.bank?.isOpen;
        if (!opened) await q.sdk.waitForTicks(3);
    }
    if (!opened) throw new Error(`legends: could not open a bank at ${where(q)}`);
    for (const it of [...inv(q)]) {
        if ((QUEST_ITEMS.has(it.id) && !spentQuestItem(q, it.id)) || wants.some((w) => matches(w, it))) continue;
        await q.bot.depositItem(it, -1).catch(() => undefined);
    }
    // Extra copies of a wanted unstackable (ten sharks held, four wanted) go back too: room for the next ones.
    for (const w of wants) {
        const copies = inv(q).filter((i) => matches(w, i) && (i.count ?? 1) === 1);
        for (const extra of copies.slice(w.count)) await q.bot.depositItem(extra, 1).catch(() => undefined);
    }
    await q.sdk.waitForTicks(2);
    const missing: Want[] = [];
    // An `unless` stand-in in the bank first (the bowl made last run): then its line is not needed.
    for (const alt of [...new Set(wants.map((w) => w.unless).filter((u): u is Want => !!u))]) {
        const banked = heldOf(q, alt) ? undefined : q.sdk.getBankItems().find((b) => matches(alt, b));
        if (banked) {
            await q.bot.withdrawItem(banked, 1);
            await untilTicks(q.sdk, () => heldOf(q, alt) > 0, 4);
        }
    }
    for (const w of wants) {
        if (w.unless && heldOf(q, w.unless) > 0) continue;
        const need = w.count - heldOf(q, w);
        if (need <= 0) continue;
        const banked = q.sdk.getBankItems().find((b) => matches(w, b));
        if (!banked) {
            if (!w.optional && heldOf(q, w) < (w.min ?? w.count)) missing.push(w);
            continue;
        }
        const r = await q.bot.withdrawItem(banked, Math.min(need, banked.count)).catch((e) => ({ success: false, message: String(e) }));
        if (!r.success) q.log(`legends: withdraw ${w.label} ×${need}: ${(r as { message?: string }).message ?? 'failed'}`);
        const target = heldOf(q, w) + Math.min(need, banked.count);
        await untilTicks(q.sdk, () => heldOf(q, w) >= target, 6);
        if (heldOf(q, w) < w.count && !w.optional) {
            // A second stack of the same pattern (shark/swordfish) may cover the rest.
            const more = q.sdk.getBankItems().find((b) => matches(w, b) && b.id !== banked.id);
            if (more) await q.bot.withdrawItem(more, w.count - heldOf(q, w));
            await q.sdk.waitForTicks(2);
            if (heldOf(q, w) < (w.min ?? w.count)) missing.push(w);
        }
    }
    // The quest's own items come back too: run-quest's prologue banks everything, and a step may need
    // the dagger, the bowl, a crystal or the seeds a banked run left behind. Only what is still of use.
    for (const b of q.sdk.getBankItems().filter((b) => QUEST_ITEMS.has(b.id) && !spentQuestItem(q, b.id))) {
        if (inv(q).some((i) => i.id === b.id) || inv(q).length >= 28) continue;
        await q.bot.withdrawItem(b, b.count).catch(() => undefined);
        await untilTicks(q.sdk, () => inv(q).some((i) => i.id === b.id), 4);
    }
    await q.bot.closeBank().catch(() => undefined);
    if (missing.length) throw new NeedsStock(missing.map((w) => ({ item: w.label, count: w.count - heldOf(q, w) })));
    q.log(`legends: restocked for ${why}; carrying ${describe(q)}`);
}

/**
 * At the hub before anything else: every mule-only line of the whole quest present (bank or pack),
 * jackthief asked once for whatever is short, NEEDS STOCK (exit 4) before a single step if still short.
 */
export async function stockCheck(q: Quest): Promise<void> {
    const lines: Want[] = [
        AXE,
        want('lockpick'),
        // Spent from stage 8 on (a resumed run may have set the rocks' and wall's bits already).
        ...(stageNum(q) < STAGE_VALUE.asked! ? GEM_ROCKS.map((g) => want(g.gem)) : []),
        ...(stageNum(q) < STAGE_VALUE.asked! ? [want('soul rune'), want('mind rune'), want('earth rune'), want('law rune', 2)] : []),
        ...(stageNum(q) < STAGE_VALUE.viyeldi! ? [want('unpowered orb'), want('cosmic rune', 3), want('water rune', 30)] : []),
        ...(stageNum(q) < STAGE_VALUE.asked! ? [want('gold bar', 2)] : []),
        FOOD_KIT(15),
    ];
    if (!(await q.bot.openBank().catch(() => ({ success: false }))).success) {
        q.log('legends: stock check skipped (no bank open here)');
        return;
    }
    const total = (w: Want) => heldOf(q, w) + q.sdk.getBankItems().filter((b) => matches(w, b)).reduce((n, b) => n + b.count, 0);
    let short = lines.filter((w) => total(w) < w.count);
    const pots = q.sdk.getBankItems().filter((b) => POTION.test(b.name)).reduce((n, b) => n + b.count, 0) + countPots(q);
    await q.bot.closeBank().catch(() => undefined);
    // Prayer potions ride along on a request that is going anyway; alone they are not worth the wait.
    const ask = short.length ? [...short, ...(pots < 4 ? [{ label: 'prayer potion(3)', pattern: /^prayer potion\(3\)$/i, count: 4 - pots }] : [])] : [];
    if (ask.length) {
        q.log(`legends: stock short ${ask.map((w) => `${w.label} ×${w.count}`).join(', ')} — asking jackthief`);
        await requestFromMule(
            { sdk: q.sdk, bot: q.bot, session: null, log: q.log } as never,
            ask.map((w) => ({ label: w.label, pattern: w.pattern ?? itemPattern(w.label), count: w.count })),
            { mule: 'jackthief', timeoutMs: ticksToMs(600) }
        ).catch((e) => q.log(`legends: mule request failed: ${(e as Error).message}`));
        if (!(await q.bot.openBank().catch(() => ({ success: false }))).success) return;
        short = lines.filter((w) => total(w) < w.count);
        await q.bot.closeBank().catch(() => undefined);
    }
    if (short.length) throw new NeedsStock(short.map((w) => ({ item: w.label, count: w.count - total(w) })));
}
const countPots = (q: Quest) => inv(q).filter((i) => POTION.test(i.name)).length;

// ── the jungle

/** Chop through the next jungle loc in our column toward `dz` (−1 south, +1 north); true once we moved. */
async function chopStep(q: Quest, dz: number): Promise<boolean> {
    let p = pos(q);
    const ahead = (l: NearbyLoc) => /^jungle (bush|tree)$/i.test(l.name) && l.x === p.x && (l.z - p.z) * dz >= 1 && (l.z - p.z) * dz <= 3;
    let loc = (await locs(q, 4)).filter(ahead).sort((a, b) => Math.abs(a.z - p.z) - Math.abs(b.z - p.z))[0];
    if (!loc) return false;
    if (Math.abs(loc.z - p.z) > 1) {
        await q.sdk.sendWalk(p.x, loc.z - dz);
        await untilTicks(q.sdk, () => pos(q).z === loc!.z - dz, 6);
        p = pos(q);
        loc = (await locs(q, 4)).filter(ahead).sort((a, b) => Math.abs(a.z - p.z) - Math.abs(b.z - p.z))[0];
        if (!loc) return false;
    }
    const opt = loc.optionsWithIndex.find((o) => /chop/i.test(o.text));
    if (!opt) return false;
    await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, opt.opIndex);
    return untilTicks(q.sdk, () => pos(q).z !== p.z || pos(q).x !== p.x, 60);
}

/** A tile in the middle of the jungle: inside means the pathfinder reaches it. */
const JUNGLE_HEART = { x: 2836, z: 2920 };
const insideJungle = async (q: Quest) => inKharazi(pos(q)) && (await reaches(q, JUNGLE_HEART));

/** Into the jungle from the foresters' clearing (on Karamja already, or sailing first). */
export async function enterJungle(q: Quest): Promise<void> {
    if (inShamanCaves(pos(q)) || inViyeldi(pos(q))) return leaveCaves(q);
    if (await insideJungle(q)) return;
    if (!inKharazi(pos(q))) {
        if (!onIsland(pos(q))) await toJungle(q, JUNGLE_OUT, 1);
        else await q.goTo(JUNGLE_OUT, 1);
        await walk(q, JUNGLE_OUT, 0);
    }
    const t0 = tickNow(q.sdk);
    for (let i = 0; i < 12 && !(await insideJungle(q)) && tickNow(q.sdk) - t0 < 600; i++) {
        if (pos(q).x !== JUNGLE_OUT.x) await q.sdk.sendWalk(JUNGLE_OUT.x, pos(q).z).then(() => q.sdk.waitForTicks(2));
        if (!(await chopStep(q, -1))) await q.sdk.waitForTicks(3);
    }
    if (!(await insideJungle(q))) throw new Error(`legends: could not chop into the jungle (at ${where(q)})`);
    q.log(`legends: into the Kharazi jungle in ${tickNow(q.sdk) - t0}t at ${where(q)}`);
}

/** Out of the jungle by the same two bushes, to the foresters' clearing. */
async function leaveJungle(q: Quest): Promise<void> {
    if (!inKharazi(pos(q))) return;
    if (await insideJungle(q)) await walk(q, JUNGLE_IN, 0);
    const t0 = tickNow(q.sdk);
    for (let i = 0; i < 12 && pos(q).z < JUNGLE_OUT.z && tickNow(q.sdk) - t0 < 600; i++) {
        if (pos(q).x !== JUNGLE_IN.x) await q.sdk.sendWalk(JUNGLE_IN.x, pos(q).z).then(() => q.sdk.waitForTicks(2));
        if (!(await chopStep(q, +1))) await q.sdk.waitForTicks(3);
    }
    if (inKharazi(pos(q))) throw new Error(`legends: could not chop out of the jungle (at ${where(q)})`);
    q.log(`legends: out of the jungle in ${tickNow(q.sdk) - t0}t at ${where(q)}`);
}

/**
 * run-quest's goTo/prologue: out of the Viyeldi caves, the shaman caves and the jungle, in that
 * order, to the foresters' clearing (walkable to Shilo and Brimhaven). `tile` inside the same area: nothing.
 */
export async function leaveLegends(q: Quest, tile: Tile): Promise<void> {
    if (inGuildHall(pos(q)) && !inGuildHall(tile)) await leaveHall(q);
    if (inViyeldi(pos(q)) && !inViyeldi(tile)) await viyeldiUp(q);
    if (inShamanCaves(pos(q)) && !inShamanCaves(tile)) await leaveCaves(q);
    if (inKharazi(pos(q)) && !inKharazi(tile)) await leaveJungle(q);
    // Bound for the mainland: the Brimhaven boat to Ardougne (run-quest's own Musa Point walk stalls
    // in Brimhaven's houses). Short of the fare, run-quest's customs boat pickpockets it.
    if (onIsland(pos(q)) && !onIsland(tile)) await homeFromJungle(q);
}

/** Into the jungle and to `tile` in it (from anywhere: the caves, the island, the mainland). */
async function toJungleTile(q: Quest, tile: Tile, tolerance = 2): Promise<void> {
    if (inViyeldi(pos(q))) await viyeldiUp(q);
    if (inShamanCaves(pos(q))) await leaveCaves(q);
    await enterJungle(q);
    await walk(q, tile, tolerance);
}

// ── Radimus and the start

async function throughGuildGate(q: Quest): Promise<void> {
    if (pos(q).z > 3349 && inBox(pos(q), 2700, 2760, 3349, 3390)) return;
    await q.goTo(GUILD_GATE_OUT, 2);
    for (let attempt = 1; attempt <= 3 && pos(q).z <= 3349; attempt++) {
        if (q.stage === 'unstarted') {
            // A guard lets us in once asked (legends_guard.rs2). Talked to directly, not through the gate:
            // from the gate (%temp > 0) his "open" looks for the gate beside our tile and opens nothing.
            await q.talk(/^legends guard$/i, [/can i speak to someone in charge/i, /can i go on the quest/i, /yes, i'd like to talk to grand vizier erkle/i]);
            await untilTicks(q.sdk, () => pos(q).z > 3349, 8);
            continue;
        }
        const gate = await findLoc(q, /^gate$/i, /^open$/i, { x: 2728, z: 3349 }, 6);
        if (!gate) throw new Error(`legends: no Legends Guild gate near ${where(q)}`);
        await opLoc(q, gate, /^open$/i, [], () => pos(q).z > 3349, 8);
        // The gate swings open for a few ticks (open_and_close_double_door): step through now,
        // with a plain walk — walkTo would "open" it again and fetch the guard.
        await q.sdk.sendWalk(2728, 3351);
        await untilTicks(q.sdk, () => pos(q).z > 3349, 8);
    }
    if (pos(q).z <= 3349) throw new Error(`legends: the guild gate did not let us in (at ${where(q)})`);
}

export async function startQuest(q: Quest): Promise<void> {
    await throughGuildGate(q);
    await walk(q, RADIMUS_STUDY, 2);
    const seen = await q.talk(/^radimus erkle$/i, [/yes actually, what's involved/i, /yes, it sounds great/i]);
    q.log(`legends: Radimus — ${seen.slice(0, 200)}`);
    await getMachete(q);
}

/** The machete from Radimus' cupboard (legends_cupboardopen, Radimus within 5). */
async function getMachete(q: Quest): Promise<void> {
    if (heldId(q, ID.machete)) return;
    await throughGuildGate(q);
    await walk(q, CUPBOARD, 2);
    for (let attempt = 1; attempt <= 3 && !heldId(q, ID.machete); attempt++) {
        let cup = await findLoc(q, /cupboard/i, /^search$/i, CUPBOARD, 6);
        if (!cup) {
            const shut = await findLoc(q, /cupboard/i, /^open$/i, CUPBOARD, 6);
            if (shut) await opLoc(q, shut, /^open$/i, [], () => false, 4);
            for (let i = 0; i < 6 && !cup; i++) {
                await q.sdk.waitForTicks(1);
                cup = await findLoc(q, /cupboard/i, /^search$/i, CUPBOARD, 6);
            }
        }
        if (!cup) continue;
        await q.sdk.sendInteractLoc(cup.x, cup.z, cup.id, cup.optionsWithIndex.find((o) => /^search$/i.test(o.text))!.opIndex);
        await untilTicks(q.sdk, () => !!heldId(q, ID.machete) || dialogOpen(q), 15);
        const said = dialogOpen(q) ? await driveDialog(q.sdk, [], { ticks: 20 }) : '';
        // A machete in the bank (a resumed run banked it): Radimus will not give another.
        if (/in your bank/i.test(said)) {
            await restock(q, [quest('machete', ID.machete)], 'the banked machete');
            return;
        }
    }
    if (!heldId(q, ID.machete)) throw new Error('legends: no machete from the cupboard');
}

// ── mapping

export async function mapJungle(q: Quest): Promise<void> {
    await restock(q, [...BASE(q), want('papyrus', 3), want('charcoal', 3), FOOD_KIT(4)], 'mapping');
    if (!heldId(q, ID.machete)) await getMachete(q);
    for (const section of ['middle', 'west', 'east'] as const) {
        if (heldId(q, ID.notesDone)) break;
        await toJungleTile(q, MAP_SPOTS[section], 3);
        for (let attempt = 1; attempt <= 6 && !heldId(q, ID.notesDone); attempt++) {
            const mark = lastMsgId(q);
            await defend(q);
            await opHeld(q, ID.notes, /^complete$/i, [], () => false, 8);
            const text = msgsSince(q, mark);
            if (/still have some sections|already completed this part/i.test(text) || heldId(q, ID.notesDone)) break;
            if (!countId(q, inv(q).find((i) => /^papyrus$/i.test(i.name))?.id ?? -1)) throw new Error('legends: out of papyrus mapping the jungle');
            q.log(`legends: mapping ${section} attempt ${attempt}: ${text.slice(0, 120)}`);
        }
        q.log(`legends: mapped the ${section} section at ${where(q)}`);
    }
    if (!heldId(q, ID.notesDone)) throw new Error('legends: the map is still incomplete after all three sections');
}

export async function getBullroarer(q: Quest): Promise<void> {
    if (!heldId(q, ID.notesDone)) await restock(q, BASE(q), 'the forester');
    await leaveLegends(q, JUNGLE_OUT);
    if (!onIsland(pos(q))) await toJungle(q, JUNGLE_OUT, 3);
    await q.goTo(JUNGLE_OUT, 4);
    for (let attempt = 1; attempt <= 3 && !heldId(q, ID.bullroarer); attempt++) {
        const forester = q.sdk.getNearbyNpcs().filter((n) => /^jungle forester$/i.test(n.name)).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!forester) {
            await q.sdk.waitForTicks(5);
            continue;
        }
        await useOnNpc(q, ID.notesDone, forester, () => !!heldId(q, ID.bullroarer), [/yes, go ahead make a copy/i], 30);
    }
    if (!heldId(q, ID.bullroarer)) throw new Error('legends: the forester gave no bullroarer');
}

// ── Gujuo

const gujuo = (q: Quest) => q.sdk.getNearbyNpcs().filter((n) => /^gujuo$/i.test(n.name)).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];

/**
 * Swing the bullroarer in the jungle until Gujuo turns up, then talk (he opens the dialog himself
 * when he reaches us, ai_opplayer2) and drive `choices`. Done once `done()` holds, or a dialog we
 * drove picked an option matching `goal`.
 */
async function withGujuo(q: Quest, choices: Array<RegExp | string>, goal: RegExp | null, done: () => boolean, label: string): Promise<string> {
    const t0 = tickNow(q.sdk);
    let all = '';
    const reached = () => done() || (goal !== null && goal.test(all));
    const talk = async () => {
        const seen = await driveDialog(q.sdk, choices, { done, ticks: 150, log: q.log });
        all += ` || ${seen}`;
    };
    for (let attempt = 1; attempt <= 10 && !reached() && tickNow(q.sdk) - t0 < 900; attempt++) {
        if (!dialogOpen(q)) {
            await enterJungle(q);
            // The bullroarer only calls inside legends_zones kharazi_jungle (z ≤ 2935): off the edge strip.
            if (pos(q).z > 2932 && !gujuo(q)) await walk(q, { x: 2828, z: 2928 }, 2);
            await defend(q);
        }
        if (dialogOpen(q)) {
            await talk();
            continue;
        }
        let g = gujuo(q);
        if (!g) {
            await opHeld(q, ID.bullroarer, /^swing$/i, [], () => !!gujuo(q), 4);
            await untilTicks(q.sdk, () => !!gujuo(q) || dialogOpen(q), 14);
            g = gujuo(q);
        }
        if (dialogOpen(q)) {
            await talk();
            continue;
        }
        if (!g) {
            await eatIfLow(q);
            await q.sdk.waitForTicks(6);
            continue;
        }
        // He walks to us and opens the dialog; if he cannot (no line of walk), talk to him.
        if (!(await untilTicks(q.sdk, () => dialogOpen(q), 10))) {
            g = gujuo(q);
            const opt = g?.optionsWithIndex.find((o) => /talk/i.test(o.text));
            if (g && opt) await q.sdk.sendInteractNpc(g.index, opt.opIndex);
            await untilTicks(q.sdk, () => dialogOpen(q), 15);
        }
        if (dialogOpen(q)) await talk();
    }
    if (!reached()) throw new Error(`legends: Gujuo (${label}) did not get us there in ${tickNow(q.sdk) - t0}t: ${all.slice(-300)}`);
    q.log(`legends: Gujuo — ${label} in ${tickNow(q.sdk) - t0}t`);
    return all;
}

export async function meetGujuo(q: Quest): Promise<void> {
    await restock(q, [...BASE(q), FOOD_KIT(4)], 'Gujuo');
    await toJungleTile(q, { x: 2830, z: 2925 }, 4);
    await withGujuo(
        q,
        [/hoping to attract the attention/i, /develop friendly relations/i, /can you get your people together/i, /what can we do instead/i, /how do we make the totem pole/i, /i will release ungadulu/i],
        /> I will release Ungadulu/i,
        () => false,
        'the totem pole'
    );
}

// ── the cave and Ungadulu

/** Search the three rocks and crawl in (Agility 50). */
async function enterCaves(q: Quest): Promise<void> {
    if (inShamanCaves(pos(q))) return;
    await toJungleTile(q, CAVE_ROCKS, 2);
    for (let attempt = 1; attempt <= 5 && !inShamanCaves(pos(q)); attempt++) {
        const rock = await findLoc(q, /^(mossy rock|rocks)$/i, /^search$/i, { x: 2781, z: 2935 }, 5);
        if (!rock) throw new Error(`legends: no shaman cave rocks near ${where(q)}`);
        await opLoc(q, rock, /^search$/i, [/yes, i'll crawl through/i], () => inShamanCaves(pos(q)), 20);
        await untilTicks(q.sdk, () => inShamanCaves(pos(q)), 10);
        await eatIfLow(q);
    }
    if (!inShamanCaves(pos(q))) throw new Error(`legends: could not crawl into the shaman caves (at ${where(q)})`);
    q.log(`legends: into the shaman caves at ${where(q)}`);
}

export async function findCave(q: Quest): Promise<void> {
    await restock(q, [...BASE(q), FOOD_KIT(4)], 'the cave');
    await enterCaves(q);
}

const inOctagram = (p: Tile) => inBox(p, 2789, 2796, 9325, 9332) || inBox(p, 2788, 2797, 9328, 9329) || inBox(p, 2792, 2793, 9324, 9333);

/** Investigate the flames: Ungadulu speaks (stage 7) and every question bit is set. */
export async function speakUngadulu(q: Quest): Promise<void> {
    await restock(q, [...BASE(q), FOOD_KIT(4)], 'Ungadulu');
    await enterCaves(q);
    await toCaveRegion(q, 'A');
    await walk(q, CAVE.nearOctagram, 2);
    for (let attempt = 1; attempt <= 3 && q.stage === 'entrance'; attempt++) {
        const wall = await findLoc(q, /^fire wall$/i, /^investigate$/i, pos(q), 8);
        if (!wall) throw new Error(`legends: no fire wall near ${where(q)}`);
        const seen = await (async () => {
            await q.sdk.sendInteractLoc(wall.x, wall.z, wall.id, wall.optionsWithIndex.find((o) => /investigate/i.test(o.text))!.opIndex);
            await untilTicks(q.sdk, () => dialogOpen(q), 20);
            return driveDialog(q.sdk, [/^who are you/i, /where do i get pure water from/i, /how can i extinguish the flames/i], { ticks: 150, log: q.log });
        })();
        q.log(`legends: the flames — ${seen.slice(0, 240)}`);
        if (/come no closer/i.test(seen)) return;
    }
}

export async function askGujuoWater(q: Quest): Promise<void> {
    await restock(q, [...BASE(q), FOOD_KIT(4)], 'Gujuo, the water');
    await leaveCaves(q);
    await withGujuo(
        q,
        [/i need some pure water to douse/i, /what kind of a vessel/i, /^ok thanks for your help/i, /^ok, thanks\.\.\. goodbye/i],
        /> I need some pure water to douse/i,
        () => false,
        'the sacred water'
    );
}

// ── the golden bowl and the pool

const BOWL: Want = { label: 'golden bowl', ids: [ID.bowl, ID.bowlWater, ID.bowlPure, ID.bowlBlessed, ID.bowlBlessedWater, ID.bowlBlessedPure], count: 1 };
const bowlAny = (q: Quest) => [ID.bowl, ID.bowlWater, ID.bowlPure, ID.bowlBlessed, ID.bowlBlessedWater, ID.bowlBlessedPure].some((id) => !!heldId(q, id));
const blessed = (q: Quest) => [ID.bowlBlessed, ID.bowlBlessedWater, ID.bowlBlessedPure].some((id) => !!heldId(q, id));

/** Two gold bars at Tai Bwo Wannai's anvil (Smithing 50, a hammer; stage ≥ 8). */
async function makeBowl(q: Quest): Promise<void> {
    if (bowlAny(q)) return;
    await leaveLegends(q, TAI_BWO_ANVIL);
    if (!onIsland(pos(q))) await toJungle(q, TAI_BWO_ANVIL, 3);
    else await q.goTo(TAI_BWO_ANVIL, 3);
    for (let attempt = 1; attempt <= 4 && !bowlAny(q); attempt++) {
        if (q.count('gold bar') < 2) throw new NeedsStock([{ item: 'gold bar', count: 2 - q.count('gold bar') }]);
        const anvil = await findLoc(q, /^anvil$/i, undefined, TAI_BWO_ANVIL, 6);
        if (!anvil) throw new Error(`legends: no anvil near ${where(q)}`);
        const mark = lastMsgId(q);
        await useOnLoc(q, /^gold bar$/i, anvil, () => bowlAny(q), [/^yes$/i], 20);
        await untilTicks(q.sdk, () => bowlAny(q), 8);
        q.log(`legends: the bowl, attempt ${attempt}: ${msgsSince(q, mark).slice(0, 140)}`);
    }
    if (!bowlAny(q)) throw new Error('legends: could not forge the golden bowl');
}

/** Gujuo blesses the bowl; his Prayer roll fails often and drains 5 points a try. */
async function blessBowl(q: Quest): Promise<void> {
    if (blessed(q)) return;
    const t0 = tickNow(q.sdk);
    for (let round = 1; round <= 6 && !blessed(q); round++) {
        if (prayerPts(q) < 42 && !(await drinkPrayer(q, 42))) throw new Error(`legends: prayer ${prayerPts(q)} < 42 and no prayer potion to bless the bowl`);
        await withGujuo(q, [/yes, i'd like (you )?to bless my gold bowl/i], /too inexperienced/i, () => blessed(q), 'the blessing').catch((e) =>
            q.log(`legends: blessing round ${round}: ${(e as Error).message}`)
        );
        if (dialogOpen(q)) await driveDialog(q.sdk, [/no thanks, i'll wait/i, /^ok, thanks\.\.\. goodbye/i], { ticks: 30 });
    }
    if (!blessed(q)) throw new Error(`legends: the bowl is still unblessed after ${tickNow(q.sdk) - t0}t (prayer ${prayerPts(q)})`);
    q.log(`legends: the bowl is blessed (prayer now ${prayerPts(q)})`);
}

/** Cut a hollow reed by the pool (machete on the tall reeds). */
async function cutReed(q: Quest): Promise<void> {
    if (heldId(q, ID.reed)) return;
    await toJungleTile(q, REEDS, 2);
    for (let attempt = 1; attempt <= 3 && !heldId(q, ID.reed); attempt++) {
        const reeds = await findLoc(q, /^tall reeds$/i, undefined, REEDS, 4);
        if (!reeds) throw new Error(`legends: no tall reeds near ${where(q)}`);
        await useOnLoc(q, ID.machete, reeds, () => !!heldId(q, ID.reed), [], 12);
    }
    if (!heldId(q, ID.reed)) throw new Error('legends: could not cut a reed');
}

/** The reed in the pool: fills the blessed bowl (stage 8 → 10), or dries the pool (13 → 14). */
async function reedInPool(q: Quest, done: () => boolean): Promise<void> {
    await cutReed(q);
    await walk(q, REEDS, 1);
    for (let attempt = 1; attempt <= 3 && !done(); attempt++) {
        const pool = await findLoc(q, /^(water pool|polluted water)$/i, undefined, POOL, 4);
        if (!pool) throw new Error(`legends: no water pool near ${where(q)}`);
        if (/polluted/i.test(pool.name)) return;
        await useOnLoc(q, ID.reed, pool, done, [], 15);
        await driveDialog(q.sdk, [], { ticks: 10 });
        if (/polluted/i.test((await findLoc(q, /^(water pool|polluted water)$/i, undefined, POOL, 4))?.name ?? '')) return;
    }
}

/**
 * Stage 8 → 10. The water boils off at the next jungle chop, so everything up to the octagram fight
 * is packed now: the trials' kit (spent on the Book of Binding before the bowl fills, freeing the
 * room), the fight's food and potions, the weapon worn.
 */
export async function fillBowl(q: Quest): Promise<void> {
    const book = !!heldId(q, ID.book);
    await gearUp(q);
    await restock(
        q,
        [
            ...BASE(q),
            want('gold bar', 2, { unless: BOWL }),
            want('hammer', 1, { unless: BOWL }),
            ...(book ? [] : TRIALS(q, false)),
            POTS(2),
            FOOD_KIT(4),
        ],
        'the bowl and the book'
    );
    await makeBowl(q);
    const hammer = held(q, /^hammer$/i);
    if (hammer) await q.sdk.sendDropItem(hammer.slot).catch(() => undefined);
    if (!heldId(q, ID.book)) {
        await enterCaves(q);
        await getBook(q);
        await leaveCaves(q);
    }
    await blessBowl(q);
    await reedInPool(q, () => !!heldId(q, ID.bowlBlessedPure));
    if (!heldId(q, ID.bowlBlessedPure)) throw new Error('legends: the blessed bowl did not fill');
}

// ── the caves' trials
// In the east column (gates, boulders) every move is a loc op: bot.walkTo plans through the gates
// (the pathfinder masks doors) and "opens" them, bouncing us back through the lockpick gate.

type Region = 'A' | 'octagram' | 'B' | 'east' | 'D' | 'E' | 'F' | 'G' | 'out';
const ANCHOR: Record<'A' | 'B' | 'D' | 'E' | 'F' | 'G', Tile> = {
    A: { x: 2778, z: 9336 },
    B: { x: 2806, z: 9338 },
    D: { x: 2801, z: 9300 },
    E: { x: 2785, z: 9305 },
    F: { x: 2765, z: 9300 },
    G: { x: 2765, z: 9330 },
};

/** Where in the shaman caves we are. The east column (gates, boulders) is told apart by z. */
async function caveRegion(q: Quest): Promise<Region> {
    const p = pos(q);
    if (!inShamanCaves(p)) return 'out';
    if (inOctagram(p)) return 'octagram';
    if (inBox(p, 2805, 2814, 9314, 9332)) return 'east';
    for (const r of ['A', 'B', 'D', 'E', 'F', 'G'] as const) if (await reaches(q, ANCHOR[r])) return r;
    return 'east';
}

/** One east-column step south (gate, boulder, boulder, boulder, gate) or north. */
async function eastStep(q: Quest, south: boolean): Promise<void> {
    const z = pos(q).z;
    const x0 = CAVE.boulderX;
    if (south) {
        if (z >= 9333) {
            await walk(q, CAVE.lockGateNorth, 1);
            const gate = await findLoc(q, /^ancient gate$/i, /^search$/i, { x: 2809, z: 9332 }, 4);
            if (!gate) throw new Error(`legends: no lockpick gate near ${where(q)}`);
            await opLoc(q, gate, /^search$/i, [], () => pos(q).z < 9332, 40);
            await driveDialog(q.sdk, [], { ticks: 20 });
            // The doors swing open for a moment: step through.
            if (pos(q).z >= 9332) await q.sdk.sendWalk(x0, 9330);
            await untilTicks(q.sdk, () => pos(q).z < 9332, 6);
            return;
        }
        if (z >= 9315) {
            const next = CAVE.boulders.find((bz) => bz < z);
            if (next !== undefined && z > next) {
                const b = await findLoc(q, /^boulder$/i, /smash/i, { x: x0, z: next }, 4);
                if (b) {
                    await opLoc(q, b, /smash/i, [], () => pos(q).z < next, 12);
                    await driveDialog(q.sdk, [], { ticks: 8 });
                    return;
                }
            }
            // Below boulder three: the strength gate.
            const gate = await findLoc(q, /^ancient gate$/i, /^open$/i, CAVE.strengthGate, 4);
            if (!gate) throw new Error(`legends: no strength gate near ${where(q)}`);
            await opLoc(q, gate, /^open$/i, [/yes, i'm very strong/i], () => pos(q).z < 9314, 30);
            if (pos(q).z >= 9314) await q.sdk.sendWalk(x0, 9312);
            await untilTicks(q.sdk, () => pos(q).z < 9314, 6);
            return;
        }
    } else {
        if (z <= 9313) {
            await walk(q, { x: x0, z: 9312 }, 1);
            const gate = await findLoc(q, /^ancient gate$/i, /^open$/i, CAVE.strengthGate, 4);
            if (!gate) throw new Error(`legends: no strength gate near ${where(q)}`);
            await opLoc(q, gate, /^open$/i, [/yes, i'm very strong/i], () => pos(q).z > 9314, 30);
            if (pos(q).z <= 9314) await q.sdk.sendWalk(x0, 9316);
            await untilTicks(q.sdk, () => pos(q).z > 9314, 6);
            return;
        }
        const next = [...CAVE.boulders].reverse().find((bz) => bz > z);
        if (next !== undefined) {
            const b = await findLoc(q, /^boulder$/i, /smash/i, { x: x0, z: next }, 4);
            if (b) {
                await opLoc(q, b, /smash/i, [], () => pos(q).z > next, 12);
                await driveDialog(q.sdk, [], { ticks: 8 });
                return;
            }
        }
        // Above the boulders, below the lockpick gate: its lever opens it from this side.
        const gate = await findLoc(q, /^ancient gate$/i, /^open$/i, { x: 2809, z: 9332 }, 4);
        if (!gate) throw new Error(`legends: no lockpick gate near ${where(q)}`);
        await opLoc(q, gate, /^open$/i, [], () => pos(q).z > 9332, 30);
        await driveDialog(q.sdk, [], { ticks: 10 });
        if (pos(q).z <= 9332) await q.sdk.sendWalk(x0, 9334);
        await untilTicks(q.sdk, () => pos(q).z > 9332, 6);
    }
}

/** Through the marked wall from the walled cavern (E) into the gem room (F). */
async function markedWallIn(q: Quest): Promise<void> {
    await walk(q, CAVE.markedEast, 2);
    const into = () => dist(pos(q), { x: 2774, z: 9301 }) <= 3 || dist(pos(q), ANCHOR.F) < 12;
    const wall = () => findLoc(q, /^marked wall$/i, undefined, { x: 2779, z: 9305 }, 4);
    // Already opened once (law rune two used): Use walks through.
    let w = await wall();
    if (!w) throw new Error(`legends: no marked wall near ${where(q)}`);
    await opLoc(q, w, /^use$/i, [/yes, i'll go through/i], into, 10);
    if (into()) return;
    for (const rune of WALL_RUNES) {
        if (into()) return;
        w = (await wall())!;
        const mark = lastMsgId(q);
        await useOnLoc(q, itemPattern(rune), w, () => into() || /merged with the wall|already/i.test(msgsSince(q, mark)), [/yes, i'll go through/i], 15);
        await driveDialog(q.sdk, [/yes, i'll go through/i], { ticks: 20 });
        q.log(`legends: ${rune} on the marked wall: ${msgsSince(q, mark).slice(0, 120)}`);
    }
    await untilTicks(q.sdk, into, 10);
    if (!into()) throw new Error(`legends: the marked wall did not open (at ${where(q)}, carrying ${describe(q)})`);
}

/** One step deeper (toward the winch) from `r`. */
async function deeper(q: Quest, r: Region): Promise<void> {
    switch (r) {
        case 'octagram':
            return leaveOctagram(q);
        case 'A': {
            await walk(q, { x: 2794, z: 9338 }, 1);
            const shelf = await findLoc(q, /^bookcase$/i, /^search$/i, CAVE.bookcase, 4);
            if (!shelf) throw new Error(`legends: no bookcase near ${where(q)}`);
            await opLoc(q, shelf, /^search$/i, [/^yes please/i], () => pos(q).x >= 2798, 30);
            await untilTicks(q.sdk, () => pos(q).x >= 2798, 10);
            return;
        }
        case 'B':
        case 'east':
            return eastStep(q, true);
        case 'D': {
            await walk(q, CAVE.jaggedSouth, 0);
            const wall = await findLoc(q, /^jagged wall$/i, /jump/i, { x: 2790, z: 9295 }, 4);
            if (!wall) throw new Error(`legends: no jagged wall near ${where(q)}`);
            await opLoc(q, wall, /jump/i, [], () => pos(q).z >= 9296, 15);
            await untilTicks(q.sdk, () => pos(q).z >= 9296, 6);
            return;
        }
        case 'E':
            return markedWallIn(q);
        case 'F':
            return magicGate(q);
        default:
            return;
    }
}

/** One step back toward the entrance from `r`. */
async function shallower(q: Quest, r: Region): Promise<void> {
    switch (r) {
        case 'octagram':
            return leaveOctagram(q);
        case 'G': {
            await walk(q, { x: 2763, z: 9318 }, 1);
            const gate = await findLoc(q, /^ancient gate$/i, /^open$/i, CAVE.magicGateNorth, 5);
            if (!gate) throw new Error(`legends: no magic gate near ${where(q)}`);
            await opLoc(q, gate, /^open$/i, [], () => pos(q).z <= 9312, 15);
            await untilTicks(q.sdk, () => pos(q).z <= 9312, 6);
            return;
        }
        case 'F': {
            await walk(q, { x: 2775, z: 9302 }, 2);
            const wall = await findLoc(q, /^marked wall$/i, /^use$/i, CAVE.markedWest, 4);
            if (!wall) throw new Error(`legends: no marked wall near ${where(q)}`);
            await opLoc(q, wall, /^use$/i, [/yes, i'll go through/i], () => dist(pos(q), { x: 2780, z: 9306 }) <= 2, 15);
            await driveDialog(q.sdk, [], { ticks: 10 });
            return;
        }
        case 'E': {
            await walk(q, CAVE.jaggedNorth, 0);
            const wall = await findLoc(q, /^jagged wall$/i, /jump/i, { x: 2790, z: 9296 }, 4);
            if (!wall) throw new Error(`legends: no jagged wall near ${where(q)}`);
            await opLoc(q, wall, /jump/i, [], () => pos(q).z <= 9295, 15);
            await untilTicks(q.sdk, () => pos(q).z <= 9295, 6);
            return;
        }
        case 'D':
        case 'east':
            return eastStep(q, false);
        case 'B': {
            await walk(q, { x: 2800, z: 9340 }, 1);
            const crevice = await findLoc(q, /^crevice$/i, /^search$/i, CAVE.crevice, 4);
            if (!crevice) throw new Error(`legends: no crevice near ${where(q)}`);
            await opLoc(q, crevice, /^search$/i, [/^yes please/i], () => pos(q).x <= 2796, 20);
            await untilTicks(q.sdk, () => pos(q).x <= 2796, 6);
            return;
        }
        case 'A': {
            await walk(q, CAVE.entrance, 1);
            const mouth = await findLoc(q, /^cave entrance$/i, /walk through/i, CAVE.entrance, 4);
            if (!mouth) throw new Error(`legends: no cave entrance near ${where(q)}`);
            await opLoc(q, mouth, /walk through/i, [], () => !inShamanCaves(pos(q)), 15);
            return;
        }
        default:
            return;
    }
}

const ORDER: Region[] = ['out', 'A', 'B', 'east', 'D', 'E', 'F', 'G'];

/** Walk the trials to region `target` (each step re-reads where we are). */
async function toCaveRegion(q: Quest, target: 'A' | 'D' | 'E' | 'F' | 'G'): Promise<void> {
    const t0 = tickNow(q.sdk);
    for (let step = 0; step < 24; step++) {
        await eatIfLow(q);
        let r = await caveRegion(q);
        if (r === 'out') {
            await enterCaves(q);
            continue;
        }
        if (r === target) return;
        if (r === 'octagram') {
            await leaveOctagram(q);
            continue;
        }
        const from = ORDER.indexOf(r);
        const to = ORDER.indexOf(target);
        const before = `${r}@${where(q)}`;
        if (to > from) await deeper(q, r);
        else await shallower(q, r);
        r = await caveRegion(q);
        q.log(`legends: caves ${before} → ${r}@${where(q)} (${tickNow(q.sdk) - t0}t)`);
    }
    throw new Error(`legends: could not reach cave region ${target} (at ${where(q)})`);
}

/** Out of the shaman caves (and the Viyeldi caves below them) to the jungle by the cave mouth. */
export async function leaveCaves(q: Quest): Promise<void> {
    if (inViyeldi(pos(q))) await viyeldiUp(q);
    for (let step = 0; step < 24 && inShamanCaves(pos(q)); step++) {
        await eatIfLow(q);
        const r = await caveRegion(q);
        await shallower(q, r);
    }
    if (inShamanCaves(pos(q))) throw new Error(`legends: still in the shaman caves at ${where(q)}`);
}

/** Out of the flaming octagram: walk through once the demon is gone, else leap (burns). */
async function leaveOctagram(q: Quest): Promise<void> {
    const wall = await findLoc(q, /^fire wall$/i, undefined, pos(q), 4);
    if (!wall) throw new Error(`legends: no fire wall near ${where(q)} to leave the octagram`);
    if (stageNum(q) >= STAGE_VALUE.freed!) await opLoc(q, wall, /^touch$/i, [], () => !inOctagram(pos(q)), 10);
    else await opLoc(q, wall, /^investigate$/i, [/leap out of the flaming octagram/i], () => !inOctagram(pos(q)), 20);
    await untilTicks(q.sdk, () => !inOctagram(pos(q)), 6);
}

/** Into the octagram: sacred water on the flames until the demon is slain; after, the flames part. */
async function enterOctagram(q: Quest): Promise<void> {
    if (inOctagram(pos(q))) return;
    await toCaveRegion(q, 'A');
    await walk(q, CAVE.nearOctagram, 1);
    for (let attempt = 1; attempt <= 4 && !inOctagram(pos(q)); attempt++) {
        const wall = await findLoc(q, /^fire wall$/i, undefined, CAVE.ungadulu, 8).then(async () =>
            (await locs(q, 6)).filter((l) => /^fire wall$/i.test(l.name)).sort((a, b) => dist(a, pos(q)) - dist(b, pos(q)))[0]
        );
        if (!wall) throw new Error(`legends: no fire wall near ${where(q)}`);
        if (stageNum(q) >= STAGE_VALUE.freed!) await opLoc(q, wall, /^touch$/i, [], () => inOctagram(pos(q)), 10);
        else {
            if (!heldId(q, ID.bowlBlessedPure)) throw new Error('legends: no sacred water to douse the flames');
            await useOnLoc(q, ID.bowlBlessedPure, wall, () => inOctagram(pos(q)), [], 12);
        }
        await untilTicks(q.sdk, () => inOctagram(pos(q)), 4);
    }
    if (!inOctagram(pos(q))) throw new Error(`legends: could not get into the octagram (at ${where(q)})`);
}

/** The gem room's seven rocks, then the book. */
async function getBook(q: Quest): Promise<void> {
    if (heldId(q, ID.book)) return;
    await toCaveRegion(q, 'F');
    const book = () => q.sdk.getGroundItems().find((g) => /^book of binding$/i.test(g.name));
    for (const g of GEM_ROCKS) {
        if (heldId(q, ID.book) || book()) break;
        if (!held(q, itemPattern(g.gem))) continue; // already placed (the rock keeps it while its bit is set)
        await walk(q, { x: g.x, z: g.z + (g.z > 9300 ? -1 : 1) }, 1).catch(() => walk(q, g, 2));
        const rock = await findLoc(q, /^carved rock$/i, undefined, g, 2);
        if (!rock) throw new Error(`legends: no carved rock at (${g.x},${g.z})`);
        const mark = lastMsgId(q);
        await useOnLoc(q, itemPattern(g.gem), rock, () => !held(q, itemPattern(g.gem)), [], 15);
        q.log(`legends: ${g.gem} on the rock at (${g.x},${g.z}): ${msgsSince(q, mark).slice(0, 100)}`);
    }
    // Every gem placed on an earlier run (the rocks keep their bits): searching a rock re-runs the
    // puzzle's finish and the book appears again (quest_legends.rs2 oploc2,lg_gemplacerock).
    if (!book() && !GEM_ROCKS.some((g) => held(q, itemPattern(g.gem)))) {
        await q.sdk.scanGroundItems(12).catch(() => undefined);
        if (!book()) {
            const rock = await findLoc(q, /^carved rock$/i, /^search$/i, pos(q), 15);
            if (rock) await opLoc(q, rock, /^search$/i, [], () => !!book(), 10);
        }
    }
    for (let i = 0; i < 40 && !book(); i++) {
        await q.sdk.scanGroundItems(12).catch(() => undefined);
        await q.sdk.waitForTicks(3);
    }
    const b = book();
    if (!b) throw new Error(`legends: no Book of Binding appeared (carrying ${describe(q)})`);
    for (let attempt = 1; attempt <= 3 && !heldId(q, ID.book); attempt++) {
        await q.bot.pickupItem(b as never).catch(() => undefined);
        await untilTicks(q.sdk, () => !!heldId(q, ID.book), 10);
    }
    if (!heldId(q, ID.book)) throw new Error('legends: could not pick up the Book of Binding');
    q.log('legends: the Book of Binding is ours');
}

type SpellOnLoc = (x: number, z: number, id: number, spell: number) => Promise<unknown>;
const spellOnLoc = (q: Quest): SpellOnLoc | null => {
    const f = (q.sdk as unknown as { sendSpellOnLoc?: SpellOnLoc }).sendSpellOnLoc;
    return typeof f === 'function' ? f : null;
};
/** Thrown before any walk toward the magic gate when the SDK cannot cast on a loc. */
export const GATE_BLOCKED =
    'BLOCKED at the magic trial gate: it opens only to a Charge Orb spell cast on it (charge_orb.rs2), and this SDK has no sendSpellOnLoc (OPLOCT) — deploy the sdk/lite-client spell-on-loc change, then rerun';
export function assertGateCastable(q: Quest): void {
    if (spellOnLoc(q)) return;
    const line = `${GATE_BLOCKED} (stopped before the gate at journal stage ${q.stage})`;
    q.log(`legends: ${line}`);
    throw new Error(`legends: ${line}`);
}

/** Charge Water Orb on the magic trial gate (F → G). Needs sdk.sendSpellOnLoc (OPLOCT). */
async function magicGate(q: Quest): Promise<void> {
    assertGateCastable(q);
    const cast = spellOnLoc(q)!;
    await walk(q, { x: 2763, z: 9311 }, 1);
    for (let attempt = 1; attempt <= 3 && pos(q).z < 9318; attempt++) {
        const gate = await findLoc(q, /^ancient gate$/i, undefined, CAVE.magicGateSouth, 4);
        if (!gate) throw new Error(`legends: no magic gate near ${where(q)}`);
        if (!held(q, /^unpowered orb$/i)) throw new Error('legends: no unpowered orb for the magic gate');
        await q.sdk.sendSetTab(MAGIC_TAB).catch(() => undefined);
        await q.sdk.waitForTicks(1);
        const mark = lastMsgId(q);
        await cast.call(q.sdk, gate.x, gate.z, gate.id, CHARGE_WATER_ORB);
        await untilTicks(q.sdk, () => pos(q).z >= 9318 || dialogOpen(q), 20);
        await driveDialog(q.sdk, [], { ticks: 15 });
        await untilTicks(q.sdk, () => pos(q).z >= 9318, 8);
        q.log(`legends: Charge Water Orb on the gate: ${msgsSince(q, mark).slice(0, 140)}`);
    }
    if (pos(q).z < 9318) throw new Error(`legends: the magic gate did not let us through (at ${where(q)})`);
}

// ── Nezikchened and the heroes

/** Our Nezikchened (or hero): targeting us, or targeting nobody with no other player near. */
function ours(q: Quest, name: RegExp): NearbyNpc | undefined {
    const others = new Set((q.sdk.getNearbyPlayers?.() ?? []).map((p) => p.index));
    const all = q.sdk.getNearbyNpcs().filter((n) => name.test(n.name));
    return all.find((n) => n.targetIndex >= 32768 && !others.has(n.targetIndex - 32768)) ?? (others.size === 0 ? all.sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] : undefined);
}

/**
 * Melee `name` to death under Protect from Melee, eating and drinking. Returns when `done` holds or
 * no such npc has been seen for `quietTicks`. Throws out of food at 30% hp.
 */
async function fight(q: Quest, name: RegExp, done: () => boolean, label: string, opts: { maxTicks?: number; quietTicks?: number } = {}): Promise<void> {
    const flicker = q.level('prayer') >= PROTECT_MELEE_LEVEL ? new PrayerFlicker(q.sdk, q.log, { flick: false }) : null;
    const t0 = tickNow(q.sdk);
    let lastSeen = tickNow(q.sdk);
    let lastAttack = -99;
    let lastIndex = -1;
    try {
        while (!done() && tickNow(q.sdk) - t0 < (opts.maxTicks ?? 1500)) {
            await eatIfLow(q);
            if (hp(q) < maxHp(q) * 0.3 && !held(q, FOOD)) throw new Error(`legends: out of food fighting ${label} (hp ${hp(q)})`);
            if (dialogOpen(q)) {
                await driveDialog(q.sdk, [], { ticks: 10 });
                continue;
            }
            const npc = ours(q, name);
            if (!npc) {
                flicker?.set(null);
                if (tickNow(q.sdk) - lastSeen > (opts.quietTicks ?? 20)) break;
                await q.sdk.waitForTicks(1);
                continue;
            }
            if (npc.index !== lastIndex) {
                lastIndex = npc.index;
                q.log(`legends: ${label}: ${npc.name} (level ${npc.combatLevel}) at ${tickNow(q.sdk) - t0}t, hp ${hp(q)}, prayer ${prayerPts(q)}`);
            }
            lastSeen = tickNow(q.sdk);
            if (flicker) {
                if (prayerPts(q) < 10) await drinkPrayer(q, 10);
                flicker.set(prayerPts(q) > 0 ? 'protect_from_melee' : null);
            }
            const combat = q.sdk.getState()?.player?.combat;
            const attacking = combat?.targetType === 'npc' && combat.targetIndex === npc.index;
            if (!attacking || (flicker && flicker.toggledAt > lastAttack) || tickNow(q.sdk) - lastAttack > 12) {
                const opt = npc.optionsWithIndex.find((o) => /^attack$/i.test(o.text));
                await q.sdk.sendInteractNpc(npc.index, opt?.opIndex ?? 2);
                lastAttack = tickNow(q.sdk);
            }
            await q.sdk.waitForTicks(1);
        }
    } finally {
        flicker?.set(null);
    }
    q.log(`legends: ${label} over in ${tickNow(q.sdk) - t0}t (done ${done()}); hp ${hp(q)}/${maxHp(q)}, prayer ${prayerPts(q)}, ${q.count(FOOD)} food, ${eaten} eaten`);
}

/** The jungle's and the caves' aggressive locals: a hit closes any open dialog (the map, Gujuo's blessing). */
const LOCALS = /^(jungle savage|jungle wolf|oomlie bird|jungle spider|snake|deathwing|lesser demon)$/i;
/** Kill whatever local is on us (targeting a player from beside us) before a dialog step. */
async function defend(q: Quest): Promise<void> {
    const onUs = () =>
        q.sdk
            .getNearbyNpcs()
            .filter((n) => LOCALS.test(n.name) && n.targetIndex >= 32768 && (n.distance ?? 99) <= 2)
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    for (let i = 0; i < 4 && onUs(); i++) {
        const npc = onUs()!;
        const idx = npc.index;
        await fight(q, new RegExp(`^${npc.name}$`, 'i'), () => !q.sdk.getNearbyNpcs().some((n) => n.index === idx), `a ${npc.name} on us`, { maxTicks: 200, quietTicks: 3 });
    }
}

/** Wield the best melee weapon held, wear any armour held. */
async function armUp(q: Quest): Promise<void> {
    for (const it of inv(q).filter((i) => /^(dragon|rune|adamant) (scimitar|longsword|battleaxe|mace)$|^(dragonhide (body|chaps)|dragon vambraces|berserker helm|dragon med helm|amulet of strength|dragonfire shield)$/i.test(i.name))) {
        await q.bot.equipItem(it).catch(() => undefined);
        await q.sdk.waitForTicks(1);
    }
}
const WEAPON: Want = { label: 'melee weapon', pattern: /^(dragon|rune|adamant) (scimitar|longsword)$/i, count: 1 };
const ARMOUR: Want[] = ['dragonhide body', 'dragonhide chaps', 'dragon vambraces', 'berserker helm', 'dragon med helm', 'amulet of strength', 'dragonfire shield'].map((a) =>
    want(a, 1, { optional: true })
);
const FIGHT_KIT = (q: Quest): Want[] => [WEAPON, FOOD_KIT(10), POTS(3)];

/** The weapon (and whatever armour is banked) worn before a fight phase's own restock fills the pack. */
async function gearUp(q: Quest): Promise<void> {
    if (heldOf(q, WEAPON) < 1) await restock(q, [WEAPON, ...ARMOUR], 'weapon and armour');
    await armUp(q);
}

/** Into the octagram with the book; the demon rises (stage 11). */
export async function bindUngadulu(q: Quest): Promise<void> {
    // No restock here: a bank trip chops the jungle and boils the sacred water (fillBowl packed for this).
    await armUp(q);
    if (!heldId(q, ID.bowlBlessedPure) || !heldId(q, ID.book)) await fillBowl(q);
    await enterCaves(q);
    await toCaveRegion(q, 'A');
    await summonFirst(q);
    // The demon swings at once and hits hard (attack 165): fight in this step, not after the journal reads.
    await fightFirst(q);
}

async function fightFirst(q: Quest): Promise<void> {
    await drinkPrayer(q, 30);
    await fight(q, /^nezikchened$/i, () => false, 'Nezikchened (the octagram)', { quietTicks: 15 });
    await driveDialog(q.sdk, [], { ticks: 20 });
}

async function summonFirst(q: Quest): Promise<void> {
    await enterOctagram(q);
    for (let attempt = 1; attempt <= 3 && !ours(q, /^nezikchened$/i); attempt++) {
        const ung = q.sdk.getNearbyNpcs().find((n) => /^ungadulu$/i.test(n.name));
        if (!ung) throw new Error(`legends: no Ungadulu near ${where(q)}`);
        await useOnNpc(q, ID.book, ung, () => !!ours(q, /^nezikchened$/i), [], 20);
        await driveDialog(q.sdk, [], { ticks: 30 });
        await untilTicks(q.sdk, () => !!ours(q, /^nezikchened$/i), 8);
    }
}

export async function slayFirst(q: Quest): Promise<void> {
    await armUp(q);
    if (!heldId(q, ID.bowlBlessedPure) && !inOctagram(pos(q))) {
        await gearUp(q);
        await restock(q, [...BASE(q), ...FIGHT_KIT(q), quest('book of binding', ID.book)], 'Nezikchened');
    }
    if (!ours(q, /^nezikchened$/i)) {
        if (!inOctagram(pos(q)) && !heldId(q, ID.bowlBlessedPure)) await fillBowl(q);
        await enterCaves(q);
        await summonFirst(q);
    }
    await fightFirst(q);
}

/** Ungadulu, freed, gives the seeds; the sacred water germinates them. */
export async function germinate(q: Quest): Promise<void> {
    if (!countId(q, ID.seeds) && !countId(q, ID.seedsGerm)) {
        await restock(q, [...BASE(q), FOOD_KIT(4)], 'the seeds');
        await enterCaves(q);
        await enterOctagram(q);
        await q.talk(/^ungadulu$/i, [/i need to collect some yommi tree seeds/i, /^ok, thanks/i]);
    }
    if (!countId(q, ID.seedsGerm)) {
        if (!heldId(q, ID.bowlBlessedPure)) throw new Error('legends: the bowl has no sacred water left to germinate the seeds');
        await combine(q, ID.seeds, ID.bowlBlessedPure, ID.seedsGerm);
        await driveDialog(q.sdk, [], { ticks: 15 });
    }
    if (!countId(q, ID.seedsGerm)) throw new Error('legends: the seeds did not germinate');
}

export async function dryPool(q: Quest): Promise<void> {
    await restock(q, [...BASE(q), quest('yommi seeds', ID.seedsGerm), FOOD_KIT(4)], 'the pool');
    await leaveCaves(q);
    await reedInPool(q, () => false);
}

export async function askSource(q: Quest): Promise<void> {
    await restock(q, [...BASE(q), FOOD_KIT(4)], 'Gujuo, the source');
    await withGujuo(q, [/water pool has dried up/i, /if i went, could you help me/i, /^ok thanks for your help/i, /where is the source of the spring/i], /> If I went, could you help me/i, () => false, 'the source');
}

/** The bravery potion (Gujuo's recipe), drunk, then the trials to the winch and down the rope. */
export async function descend(q: Quest): Promise<void> {
    // Before any restock or walk: a fleet image without spell-on-loc cannot pass the magic gate.
    assertGateCastable(q);
    // Stage 16 means the potion was drunk (its bit is permanent): later descents need none.
    const brave = !!heldId(q, ID.bravery) || stageNum(q) >= STAGE_VALUE.viyeldi!;
    const mixed = brave || !!heldId(q, ID.snakeMix);
    await gearUp(q);
    await restock(
        q,
        [
            ...BASE(q),
            ...TRIALS(q, true),
            quest('yommi seeds', ID.seedsGerm),
            ...(mixed ? [] : [want('vial of water')]),
            WEAPON,
            POTS(3),
            FOOD_KIT(8),
        ],
        'the Viyeldi caves'
    );
    // The herbs grow round Tai Bwo Wannai (Jungle Potion's spots, live once that quest is done).
    if (!brave) {
        if (!mixed && !heldId(q, ID.snakeWeed)) await pickHerb(q, HERBS.snake!);
        if (!heldId(q, ID.ardrigal)) await pickHerb(q, HERBS.ardrigal!);
        if (!heldId(q, ID.snakeMix)) await combine(q, ID.snakeWeed, ID.vialWater, ID.snakeMix, [/snake/i, /^1$/]);
        await combine(q, ID.ardrigal, ID.snakeMix, ID.bravery);
        if (!heldId(q, ID.bravery)) throw new Error(`legends: could not brew the bravery potion (carrying ${describe(q)})`);
    }
    if (heldId(q, ID.bravery)) {
        await opHeld(q, ID.bravery, /^drink$/i, [/yes, i'll bravely drink/i], () => !heldId(q, ID.bravery), 8);
        await driveDialog(q.sdk, [], { ticks: 10 });
    }
    await enterCaves(q);
    await toCaveRegion(q, 'G');
    await walk(q, { x: 2760, z: 9328 }, 1);
    for (let attempt = 1; attempt <= 4 && !inViyeldi(pos(q)); attempt++) {
        let winch = await findLoc(q, /^winch$/i, /climb-down/i, CAVE.winch, 5);
        if (!winch) {
            const bare = await findLoc(q, /^winch$/i, undefined, CAVE.winch, 5);
            if (!bare) throw new Error(`legends: no winch near ${where(q)}`);
            // Searched: a rope we tied before reappears; else tie ours.
            if (held(q, /^rope$/i)) await useOnLoc(q, /^rope$/i, bare, () => false, [], 6);
            else await opLoc(q, bare, /^(operate|search)$/i, [], () => false, 6);
            await q.sdk.waitForTicks(2);
            winch = await findLoc(q, /^winch$/i, /climb-down/i, CAVE.winch, 5);
        }
        if (!winch) continue;
        await opLoc(q, winch, /climb-down/i, [/yes, i'll shimmy down/i], () => inViyeldi(pos(q)), 25);
        await untilTicks(q.sdk, () => inViyeldi(pos(q)), 10);
    }
    if (!inViyeldi(pos(q))) throw new Error(`legends: could not climb down the winch (at ${where(q)})`);
    q.log(`legends: down into the Viyeldi caves at ${where(q)}`);
}

// ── the Viyeldi caves

const inLanding = (p: Tile) => inBox(p, 2377, 2380, 4711, 4717);

/** A tile beside obstacle `c` we can walk to (our own if already beside it), or null. */
async function besideTile(q: Quest, c: Tile): Promise<Tile | null> {
    if (dist(pos(q), c) <= 1.5) return pos(q);
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const t = { x: c.x + dx, z: c.z + dz };
        if (await reaches(q, t)) return t;
    }
    return null;
}
const besideObstacle = async (q: Quest, c: Tile) => (await besideTile(q, c)) !== null;

/**
 * Cross the ledge/rock chain in `order`: each round ops the furthest link we stand beside (a slip
 * throws us back a link or two, with damage and an Agility point; the next round picks up from there).
 */
async function crossChain(q: Quest, order: typeof VIY.chain, done: () => Promise<boolean>, label: string): Promise<void> {
    const t0 = tickNow(q.sdk);
    let last = -1;
    let repeats = 0;
    for (let round = 0; round < 20 && !(await done()); round++) {
        let i = -1;
        for (let k = 0; k < order.length; k++) if (await besideObstacle(q, order[k]!)) i = k;
        if (i < 0) throw new Error(`legends: no ledge or rock to climb from ${where(q)} (${label})`);
        repeats = i === last ? repeats + 1 : 0;
        last = i;
        if (repeats >= 4) throw new Error(`legends: stuck at the ${order[i]!.name} (${order[i]!.x},${order[i]!.z}) from ${where(q)} (${label})`);
        const c = order[i]!;
        const at = await besideTile(q, c);
        if (at && dist(pos(q), at) > 1.5) await walk(q, at, 0);
        const loc = await findLoc(q, c.name, /climb/i, c, 15).then((l) => (l && dist(l, c) <= 1 ? l : undefined));
        if (!loc) throw new Error(`legends: no ${c.name} at (${c.x},${c.z})`);
        const before = `${pos(q).x},${pos(q).z}`;
        await opLoc(q, loc, /climb/i, [c.yes], () => `${pos(q).x},${pos(q).z}` !== before, 20);
        await driveDialog(q.sdk, [], { ticks: 10 });
        await q.sdk.waitForTicks(3);
        await eatIfLow(q);
    }
    if (!(await done())) throw new Error(`legends: the ledges did not get us there (at ${where(q)}, ${label})`);
    q.log(`legends: Viyeldi ledges (${label}) in ${tickNow(q.sdk) - t0}t`);
}

/** The landing pocket to the main cave by the ledges and rocks. */
async function viyeldiDown(q: Quest): Promise<void> {
    if (await reaches(q, VIY.main)) return;
    await crossChain(q, VIY.chain, () => reaches(q, VIY.main), 'down');
}

/** From the main cave back to the rope's foot (the hat lies there). */
async function walkToLanding(q: Quest): Promise<void> {
    if (!inLanding(pos(q)) && !(await reaches(q, VIY.hat))) {
        await crossChain(q, [...VIY.chain].reverse(), async () => inLanding(pos(q)) || (await reaches(q, VIY.hat)), 'up');
    }
    await walk(q, { x: 2379, z: 4713 }, 1);
}

/** Behind the barrier (the boulders' cave, z <= 4690): back through it to the main cave. */
async function outOfSource(q: Quest): Promise<void> {
    if (!(await reaches(q, VIY.source))) return;
    await walk(q, { x: 2421, z: 4689 }, 1);
    for (let attempt = 1; attempt <= 3 && pos(q).z <= 4690; attempt++) {
        const barrier = await findLoc(q, /^shimmering field$/i, /walk-through/i, VIY.barrier, 4);
        if (!barrier) throw new Error(`legends: no barrier near ${where(q)}`);
        await opLoc(q, barrier, /walk-through/i, [], () => pos(q).z >= 4691, 10);
    }
    if (pos(q).z <= 4690) throw new Error(`legends: could not get back through the barrier (at ${where(q)})`);
}

/** Back up to the winch room: through the barrier if behind it, the chain in reverse, the climbing rope. */
async function viyeldiUp(q: Quest): Promise<void> {
    if (!inViyeldi(pos(q))) return;
    const t0 = tickNow(q.sdk);
    await outOfSource(q);
    await walkToLanding(q);
    const rope = await findLoc(q, /^climbing rope$/i, /^climb$/i, VIY.rope, 4);
    if (!rope) throw new Error(`legends: no climbing rope near ${where(q)}`);
    await opLoc(q, rope, /^climb$/i, [], () => !inViyeldi(pos(q)), 15);
    if (inViyeldi(pos(q))) throw new Error(`legends: could not climb the rope (at ${where(q)})`);
    q.log(`legends: back up the rope in ${tickNow(q.sdk) - t0}t at ${where(q)}`);
}

const HEROES: Array<{ name: RegExp; crystal: number }> = [
    { name: /^san tojalon$/i, crystal: ID.crystalA },
    { name: /^irvig senay$/i, crystal: ID.crystalB },
    { name: /^ranalph devere$/i, crystal: ID.crystalC },
];

/** Each hero's crystal, then all three in the lava furnace (Crafting 50): the heart (stage 17). */
export async function forgeHeart(q: Quest): Promise<void> {
    if (!inViyeldi(pos(q))) await descend(q);
    await armUp(q);
    await viyeldiDown(q);
    for (const h of HEROES) {
        if (heldId(q, h.crystal) || heldId(q, ID.heart)) continue;
        for (let round = 1; round <= 3 && !heldId(q, h.crystal); round++) {
            let npc = q.sdk.getNearbyNpcs().filter((n) => h.name.test(n.name)).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (!npc) {
                await walk(q, VIY.main, 3);
                npc = q.sdk.getNearbyNpcs().filter((n) => h.name.test(n.name)).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            }
            if (!npc) {
                await walk(q, { x: 2410, z: 4712 }, 3);
                await q.sdk.waitForTicks(5);
                continue;
            }
            await fight(q, h.name, () => !!heldId(q, h.crystal), String(h.name), { quietTicks: 12, maxTicks: 600 });
            await driveDialog(q.sdk, [], { ticks: 15 });
        }
        if (!heldId(q, h.crystal)) throw new Error(`legends: no crystal from ${h.name}`);
    }
    if (!heldId(q, ID.heart)) {
        await walk(q, { x: 2425, z: 4725 }, 2);
        const furnace = await findLoc(q, /furnace/i, undefined, VIY.furnace, 5);
        if (!furnace) throw new Error(`legends: no lava furnace near ${where(q)}`);
        for (const piece of [ID.crystalA, ID.crystalB, ID.crystalC]) {
            if (!heldId(q, piece) || heldId(q, ID.heart)) continue;
            await useOnLoc(q, piece, furnace, () => !heldId(q, piece), [], 15);
            await driveDialog(q.sdk, [], { ticks: 30 });
        }
    }
    if (!heldId(q, ID.heart)) throw new Error('legends: the furnace made no heart crystal');
}

/** The heart on the dragon's eye rock (it glows), then into the recess (stage 18). */
export async function setHeart(q: Quest): Promise<void> {
    if (!inViyeldi(pos(q))) await descend(q);
    await viyeldiDown(q);
    if (heldId(q, ID.heart)) {
        await walk(q, { x: 2410, z: 4714 }, 2);
        const rock = await findLoc(q, /^mossy rock$/i, undefined, VIY.eyeRock, 3);
        if (!rock) throw new Error(`legends: no dragon's eye rock near ${where(q)}`);
        await useOnLoc(q, ID.heart, rock, () => !!heldId(q, ID.heartGlow), [], 15);
        await driveDialog(q.sdk, [], { ticks: 15 });
    }
    if (!heldId(q, ID.heartGlow)) throw new Error('legends: the heart crystal does not glow');
    await walk(q, { x: 2422, z: 4692 }, 1);
    const recess = await findLoc(q, /^recess$/i, undefined, VIY.recess, 3);
    if (!recess) throw new Error(`legends: no recess near ${where(q)}`);
    await useOnLoc(q, ID.heartGlow, recess, () => !heldId(q, ID.heartGlow), [], 15);
    await driveDialog(q.sdk, [], { ticks: 15 });
}

const boulderNpc = (q: Quest) => q.sdk.getNearbyNpcs().filter((n) => /^boulder$/i.test(n.name)).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];

/** Through the barrier to the boulders' cave. */
async function toSource(q: Quest): Promise<void> {
    if (!inViyeldi(pos(q))) await descend(q);
    if (await reaches(q, VIY.source)) return;
    await viyeldiDown(q);
    await walk(q, { x: 2421, z: 4691 }, 1);
    for (let attempt = 1; attempt <= 3 && !(await reaches(q, VIY.source)); attempt++) {
        const barrier = await findLoc(q, /^shimmering field$/i, /walk-through/i, VIY.barrier, 4);
        if (!barrier) throw new Error(`legends: no barrier near ${where(q)}`);
        await opLoc(q, barrier, /walk-through/i, [], () => pos(q).z <= 4690, 10);
        await q.sdk.waitForTicks(2);
    }
    if (!(await reaches(q, VIY.source))) throw new Error(`legends: could not pass the barrier (at ${where(q)})`);
}

const ECHNED_CHOICES = [/^er\.\.\. me\?/i, /yes, i need it for my quest/i, /what can i do about that/i, /i'll do what i must to get the water/i, /ok, i'll do it/i];

/** Push a boulder: Echned Zekin rises, tells his tale and hands over the dagger (19 → 20). */
export async function meetSpirit(q: Quest): Promise<void> {
    await toSource(q);
    for (let attempt = 1; attempt <= 3 && !heldId(q, ID.dagger) && !heldId(q, ID.daggerDone); attempt++) {
        const b = boulderNpc(q);
        if (!b) {
            await walk(q, VIY.source, 3);
            continue;
        }
        const opt = b.optionsWithIndex.find((o) => /push/i.test(o.text)) ?? b.optionsWithIndex[0];
        await q.sdk.sendInteractNpc(b.index, opt?.opIndex ?? 1);
        await untilTicks(q.sdk, () => dialogOpen(q), 20);
        await driveDialog(q.sdk, ECHNED_CHOICES, { ticks: 150, log: q.log });
    }
    if (!heldId(q, ID.dagger) && !heldId(q, ID.daggerDone)) throw new Error('legends: Echned Zekin gave no dagger');
}

/** Viyeldi (raised from his hat by the rope) takes the dagger; the glowing dagger back to the spirit; the demon. */
export async function slaySecond(q: Quest): Promise<void> {
    if (!inViyeldi(pos(q))) await descend(q);
    await armUp(q);
    if (heldId(q, ID.dagger)) {
        // The hat lies by the rope's foot.
        await outOfSource(q);
        if (!inLanding(pos(q))) await walkToLanding(q);
        // Taking his hat raises Viyeldi and starts his speech, which ends with npc_del: close it at
        // once (the script stops there, he stays up for his 100 ticks) and use the dagger on him.
        const viyeldi = () => q.sdk.getNearbyNpcs().find((n) => /^viyeldi$/i.test(n.name));
        for (let attempt = 1; attempt <= 4 && heldId(q, ID.dagger); attempt++) {
            if (!viyeldi()) {
                await q.sdk.scanGroundItems(6).catch(() => undefined);
                const hat = q.sdk.getGroundItems().find((g) => /^blue hat$/i.test(g.name));
                if (!hat) {
                    q.log(`legends: no blue hat near ${where(q)}`);
                    await q.sdk.waitForTicks(5);
                    continue;
                }
                await q.sdk.sendPickup(hat.x, hat.z, hat.id);
                await untilTicks(q.sdk, () => dialogOpen(q) || !!viyeldi(), 15);
            }
            if (dialogOpen(q)) {
                await q.sdk.sendCloseModal().catch(() => undefined);
                await untilTicks(q.sdk, () => !dialogOpen(q), 3);
            }
            const v = viyeldi();
            if (v) await useOnNpc(q, ID.dagger, v, () => !!heldId(q, ID.daggerDone), [], 10);
            await driveDialog(q.sdk, [], { done: () => !!heldId(q, ID.daggerDone), ticks: 20 });
            await untilTicks(q.sdk, () => !!heldId(q, ID.daggerDone), 10);
        }
        if (!heldId(q, ID.daggerDone)) throw new Error('legends: Viyeldi was not slain with the dagger');
    }
    await toSource(q);
    const demon = () => ours(q, /^nezikchened$/i);
    for (let attempt = 1; attempt <= 3 && !demon(); attempt++) {
        const b = boulderNpc(q);
        if (!b) {
            await walk(q, VIY.source, 3);
            continue;
        }
        const opt = b.optionsWithIndex.find((o) => /push/i.test(o.text)) ?? b.optionsWithIndex[0];
        await q.sdk.sendInteractNpc(b.index, opt?.opIndex ?? 1);
        await untilTicks(q.sdk, () => dialogOpen(q) || !!demon(), 20);
        await driveDialog(q.sdk, [], { done: () => !!demon(), ticks: 60 });
        await untilTicks(q.sdk, () => !!demon(), 6);
    }
    await drinkPrayer(q, 40);
    await fight(q, /^nezikchened$/i, () => false, 'Nezikchened (the source)', { quietTicks: 15 });
    await driveDialog(q.sdk, [], { ticks: 20 });
}

/** Push the boulder from its east side: the source flows; the blessed bowl fills (22 → 25). */
export async function collectWater(q: Quest): Promise<void> {
    if (!inViyeldi(pos(q))) await descend(q);
    await toSource(q);
    for (let attempt = 1; attempt <= 4 && !heldId(q, ID.bowlBlessedPure); attempt++) {
        let pool = await findLoc(q, /^sacred water$/i, undefined, pos(q), 15);
        if (!pool) {
            const b = boulderNpc(q);
            if (!b) throw new Error(`legends: no boulder near ${where(q)}`);
            await walk(q, { x: b.x + 2, z: b.z }, 0).catch(() => undefined);
            const opt = b.optionsWithIndex.find((o) => /push/i.test(o.text)) ?? b.optionsWithIndex[0];
            await q.sdk.sendInteractNpc(b.index, opt?.opIndex ?? 1);
            await q.sdk.waitForTicks(4);
            pool = await findLoc(q, /^sacred water$/i, undefined, pos(q), 15);
        }
        if (!pool) continue;
        await useOnLoc(q, ID.bowlBlessed, pool, () => !!heldId(q, ID.bowlBlessedPure), [], 15);
        await driveDialog(q.sdk, [], { ticks: 10 });
    }
    if (!heldId(q, ID.bowlBlessedPure)) throw new Error('legends: the bowl did not fill at the source');
}

// ── the Yommi tree and the totem

/** Plant, water, fell, trim, carve and lift — each stage rots in ~50 ticks, so no detours (25 → 30). */
export async function growTotem(q: Quest): Promise<void> {
    if (!heldId(q, ID.bowlBlessedPure)) throw new Error('legends: no sacred water for the Yommi tree (the source must be revisited)');
    // Out by the caves only: chopping jungle would boil the water away.
    await leaveCaves(q);
    if (!inKharazi(pos(q))) throw new Error(`legends: not in the jungle after the caves (at ${where(q)})`);
    await walk(q, { x: SOIL.x + 1, z: SOIL.z }, 1);
    const at = () => findLoc(q, /yommi|totem pole|fertile soil/i, undefined, SOIL, 6).then((l) => (l && l.x === SOIL.x && l.z === SOIL.z ? l : undefined));
    const t0 = tickNow(q.sdk);
    // Each op changes the loc; a step that leaves it unchanged for 3 tries (or 600 ticks) stops.
    let lastName = '';
    let same = 0;
    while (!heldId(q, ID.totem) && tickNow(q.sdk) - t0 < 600 && same < 3) {
        const loc = await at();
        if (!loc) throw new Error(`legends: nothing at the fertile soil (${SOIL.x},${SOIL.z})`);
        const n = loc.name.toLowerCase();
        same = n === lastName ? same + 1 : 0;
        lastName = n;
        const mark = lastMsgId(q);
        if (n === 'fertile soil' || n === 'totem pole') await defend(q);
        const changed = async () => ((await at())?.name.toLowerCase() ?? '') !== n;
        if (n === 'fertile soil') {
            if (!countId(q, ID.seedsGerm)) throw new Error('legends: no germinated seeds to plant');
            await useOnLoc(q, ID.seedsGerm, loc, () => false, [], 4).catch(() => undefined);
            await driveDialog(q.sdk, [], { ticks: 8 });
        } else if (n === 'yommi tree sapling') {
            if (!heldId(q, ID.bowlBlessedPure)) throw new Error('legends: the sapling needs sacred water and the bowl is empty');
            await useOnLoc(q, ID.bowlBlessedPure, loc, () => !heldId(q, ID.bowlBlessedPure), [], 6);
        } else if (n === 'adult yommi tree' || n === 'felled yommi tree' || n === 'trimmed yommi') {
            await useOnLoc(q, /^rune axe$/i, loc, () => false, [], 3).catch(() => undefined);
            await driveDialog(q.sdk, [], { ticks: 6 });
        } else if (n === 'totem pole') {
            await opLoc(q, loc, /^lift$/i, [], () => !!heldId(q, ID.totem), 8);
        } else if (n === 'yommi tree baby') {
            // Growing: it turns sapling within a few ticks.
        } else {
            // A dead sapling or a rotten tree: the rune axe clears it back to soil (a second seed then).
            q.log(`legends: the Yommi tree is ${n} — clearing it`);
            await useOnLoc(q, /^rune axe$/i, loc, () => false, [], 4).catch(() => undefined);
            await driveDialog(q.sdk, [], { ticks: 6 });
        }
        for (let i = 0; i < 6 && !heldId(q, ID.totem) && !(await changed()); i++) await q.sdk.waitForTicks(1);
        q.log(`legends: Yommi ${n} → ${(await at())?.name ?? '?'} (${tickNow(q.sdk) - t0}t): ${msgsSince(q, mark).slice(0, 120)}`);
    }
    if (!heldId(q, ID.totem)) throw new Error(`legends: no totem pole after ${tickNow(q.sdk) - t0}t`);
}

/** The totem on the corrupted pole: Nezikchened again, this time behind the three heroes (30 → 35). */
export async function slayFinal(q: Quest): Promise<void> {
    await gearUp(q);
    await restock(q, [...BASE(q), quest('totem', ID.totem), ...FIGHT_KIT(q)], 'the last fight');
    await toJungleTile(q, { x: TOTEM.x + 1, z: TOTEM.z + 1 }, 1);
    const pole = await findLoc(q, /^totem pole$/i, undefined, TOTEM, 2);
    if (!pole) throw new Error(`legends: no totem pole near ${where(q)}`);
    const foe = /^(nezikchened|san tojalon|irvig senay|ranalph devere)$/i;
    if (!ours(q, foe)) await useOnLoc(q, ID.totem, pole, () => !!ours(q, foe), [], 15);
    await driveDialog(q.sdk, [], { ticks: 15 });
    await drinkPrayer(q, 40);
    await fight(q, foe, () => false, 'Nezikchened (the totem)', { quietTicks: 25, maxTicks: 2500 });
    await driveDialog(q.sdk, [], { ticks: 20 });
}

/** The good totem in place, then Gujuo's gift (35 → 40 → 45). */
export async function replaceTotem(q: Quest): Promise<void> {
    if (!heldId(q, ID.gilded)) {
        // The prologue banked the totem (and the bullroarer): both back first.
        await restock(q, [...BASE(q), { ...quest('totem', ID.totem), optional: true }, FOOD_KIT(4)], 'the good totem');
        if (heldId(q, ID.totem)) {
            await toJungleTile(q, { x: TOTEM.x + 1, z: TOTEM.z + 1 }, 1);
            const pole = await findLoc(q, /^totem pole$/i, undefined, TOTEM, 2);
            if (!pole) throw new Error(`legends: no totem pole near ${where(q)}`);
            await useOnLoc(q, ID.totem, pole, () => !heldId(q, ID.totem), [], 15);
            await driveDialog(q.sdk, [], { ticks: 15 });
        }
        // Gujuo walks up with the gift (or comes to the bullroarer).
        const gotGift = () => !!heldId(q, ID.gilded);
        await untilTicks(q.sdk, () => dialogOpen(q) || gotGift(), 20);
        await withGujuo(q, [/^ok thanks for your help/i], null, gotGift, 'the gilded totem');
    }
    if (!heldId(q, ID.gilded)) throw new Error('legends: no gilded totem from Gujuo');
}

// ── back to Radimus

export async function handIn(q: Quest): Promise<void> {
    await restock(q, [want('coins', 60), quest('radimus notes (complete)', ID.notesDone), quest('gilded totem', ID.gilded), AXE, quest('machete', ID.machete)], 'Radimus');
    await leaveLegends(q, RADIMUS_STUDY);
    await throughGuildGate(q);
    await walk(q, RADIMUS_STUDY, 2);
    await q.talk(/^radimus erkle$/i, []);
}

/** Out of the main hall by its doors (they open for a member, legends_door.rs2). */
async function leaveHall(q: Quest): Promise<void> {
    await walk(q, { x: 2728, z: 3374 }, 1).catch(() => undefined);
    for (let attempt = 1; attempt <= 3 && inGuildHall(pos(q)); attempt++) {
        const door = await findLoc(q, /^legends guild door$/i, /^open$/i, { x: 2728, z: 3373 }, 6);
        if (!door) throw new Error(`legends: no hall door near ${where(q)}`);
        await opLoc(q, door, /^open$/i, [], () => !inGuildHall(pos(q)), 10);
        if (inGuildHall(pos(q))) await q.sdk.sendWalk(2728, 3371);
        await untilTicks(q.sdk, () => !inGuildHall(pos(q)), 6);
    }
    if (inGuildHall(pos(q))) throw new Error(`legends: could not leave the guild hall (at ${where(q)})`);
}

export async function train(q: Quest): Promise<void> {
    await throughGuildGate(q);
    if (pos(q).z < 3373) {
        await walk(q, GUILD_DOOR_OUT, 1);
        const door = await findLoc(q, /^legends guild door$/i, /^open$/i, { x: 2728, z: 3373 }, 4);
        if (door) await opLoc(q, door, /^open$/i, [], () => pos(q).z > 3373, 10);
        if (pos(q).z <= 3373) await q.sdk.sendWalk(2728, 3375);
        await untilTicks(q.sdk, () => pos(q).z > 3373, 6);
    }
    await walk(q, RADIMUS_HALL, 2);
    const skill = (process.env.LEGENDS_TRAIN ?? 'prayer').toLowerCase();
    const menu: Record<string, RegExp[]> = {
        attack: [/\* attack \*/i],
        defence: [/\* defence \*/i],
        strength: [/\* strength \*/i],
        hitpoints: [/\* hitpoints \*/i, /go to skill menu 2/i],
        prayer: [/\* prayer \*/i, /go to skill menu 2/i],
        magic: [/\* magic \*/i, /go to skill menu 2/i],
    };
    const picks = menu[skill] ?? menu.prayer!;
    await q.talk(/^radimus erkle$/i, [/yes, i'll train now/i, ...picks]);
    await untilTicks(q.sdk, () => false, 4);
}

export { HERBS, STAGE_VALUE as STAGES, ticksToMs };
