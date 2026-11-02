/**
 * Waterfall Quest — the raft, the tourist centre's book, Golrie's cave, Glarial's
 * tomb and Baxtorian's home under the falls.
 *
 * Content facts (quest_waterfall/scripts/*.rs2, maps m39_53, m39_54, m39_149,
 * m39_153, m40_154):
 *   - the log raft behind Almera's house (2509,3493) drops you on the island
 *     (2512,3481); at `started` Hudon's lines run there on their own (stage 2)
 *   - from the island (zone 2510-2514 x 3476-3481) "Swim to" the rock (2512,3468)
 *     washes you ashore at (2527,3413), by the tourist centre; rope on the rock
 *     wades you across to (2513,3468), rope on the dead tree (2512,3465) lowers you
 *     onto the ledge (2511,3463); the ledge door (2511,3464) lets you in with
 *     Glarial's amulet held or worn (else 8 damage and back ashore). The dead
 *     tree cannot be reached from the ledge (its Climb is for the bank above)
 *   - the 'Bookcase' upstairs in the tourist centre (2520,3426,L1) gives the book
 *     from stage 2; reading it sets stage 3
 *   - Golrie's cave is under the Tree Gnome Village (ladder 2533,3155): the crate
 *     (2548,9565) holds his key from stage 3; the key on his gate (2515,9575) lets
 *     you in; talking to him gives the pebble (and takes the key)
 *   - the pebble on Glarial's tombstone (2558,3444) opens the tomb only with no
 *     weapon, armour, rune, arrow, logs... held or worn (stage 4 on entry). The
 *     closed chest (2530,9844) holds the amulet, the tomb (2542,9811) the urn
 *   - in the falls: the crate (2589,9888) holds Baxtorian's key; the key on the
 *     door (2566,9901) opens the pillar room (stage 6); an air, earth and water rune
 *     on each of the six pillars, then the amulet on Glarial's statue (2565,9916)
 *     raises the floor (stage 8, to 2603,9914); the urn on the chalice (2603,9910)
 *     with 5 free slots completes the quest. Nothing leads out on foot: the elf
 *     door (2575,9861) only returns you to the ledge, and from the ledge the dead
 *     tree is out of reach — the run teleports out (leaveWaterfall).
 *
 * Aggressive npcs on the legs: hobgoblins (Golrie's cave), moss giants and
 * skeletons (the tomb — entered with no armour or weapon), fire giants and
 * skeletons (the falls). The run eats sharks below half health.
 */
import type { Quest } from './run-quest';
import { depositAllInventory } from '../quest-supplies';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
}

/** Obj ids (pack/obj.pack): the two keys share the name "A key". */
export const OBJ = {
    book: 292,
    golrieKey: 293,
    pebble: 294,
    amulet: 295,
    urnFull: 296,
    urnEmpty: 297,
    baxtorianKey: 298,
} as const;

export const ALMERA = { x: 2522, z: 3497 };
const RAFT = { x: 2509, z: 3493 };
/** Where the raft lands, and the zone the rock can be roped / swum from. */
const ISLAND = { x: 2512, z: 3480 };
const CROSSING_ROCK = { x: 2512, z: 3468 };
/** The island's south edge, inside the zone and within the rock's approach range. */
const ISLAND_EDGE = { x: 2512, z: 3477 };
const DEAD_TREE = { x: 2512, z: 3465 };
const LEDGE_DOOR = { x: 2511, z: 3464 };
/** ^waterfall_fail_coord: where the river washes you up. */
const ASHORE = { x: 2527, z: 3413 };
const TOURIST_CENTRE = { x: 2516, z: 3428 };
const BOOKCASE = { x: 2520, z: 3426 };
const GNOME_LADDER = { x: 2533, z: 3155 };
const GOLRIE_CRATE = { x: 2548, z: 9565 };
const GOLRIE_GATE = { x: 2515, z: 9575 };
const GOLRIE = { x: 2515, z: 9580 };
const TOMBSTONE = { x: 2558, z: 3444 };
const TOMB_CHEST = { x: 2530, z: 9844 };
const TOMB_COFFIN = { x: 2542, z: 9811 };
const TOMB_LADDER = { x: 2556, z: 9844 };
const BAXTORIAN_CRATE = { x: 2589, z: 9888 };
const PUZZLE_DOOR = { x: 2566, z: 9901 };
const INNER_DOOR = { x: 2568, z: 9893 };
const PILLARS: Tile[] = [
    { x: 2562, z: 9910 },
    { x: 2562, z: 9912 },
    { x: 2562, z: 9914 },
    { x: 2569, z: 9910 },
    { x: 2569, z: 9912 },
    { x: 2569, z: 9914 },
];
const QUEEN_STATUE = { x: 2565, z: 9916 };
const CHALICE = { x: 2603, z: 9910 };
/** Ardougne's north bank: the nearest to the tombstone, where the tomb's forbidden items wait. */
const ARDOUGNE_NORTH_BANK = { x: 2615, z: 3332 };

/** The pillar puzzle's runes: one of each on six pillars. */
export const RUNES = ['air rune', 'earth rune', 'water rune'] as const;
export const RUNE_NEEDS = RUNES.map((item) => ({ item, count: 6 }));
/** Food for the aggressive legs. */
export const FOOD = { item: 'shark', count: 10 };
/** What the tomb lets in: everything else waits in the bank (no weapon, armour, runes...). */
const TOMB_SAFE = [/^rope$/i, /^shark$/i, /^coins$/i, /^glarial/i, /^book on baxtorian$/i];

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const near = (q: Quest, t: Tile, r: number) => Math.hypot(pos(q).x - t.x, pos(q).z - t.z) <= r;
export const holds = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id) || q.sdk.getEquipment().some((i) => i.id === id);

const inBox = (p: { x: number; z: number }, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
/** The raft's island and the rock beyond it. */
const onIsland = (p: { x: number; z: number }) => inBox(p, 2508, 2516, 3466, 3483);
const onLedge = (p: { x: number; z: number }) => inBox(p, 2508, 2514, 3460, 3465);
export const inFalls = (p: { x: number; z: number }) => inBox(p, 2555, 2615, 9855, 9920);
const inTomb = (p: { x: number; z: number }) => inBox(p, 2515, 2565, 9800, 9855);
const inGolrieCave = (p: { x: number; z: number }) => inBox(p, 2500, 2560, 9540, 9590);
/** Anywhere the runner's goTo cannot walk out of on its own. */
export const inWaterfallArea = (p: { x: number; z: number; level?: number }) => onIsland(p) || onLedge(p) || inFalls(p);

/** Newest game-message cursor, taken before an action so only replies to it match. */
function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
/** Game messages since `since`, newest last (for "did not take" lines). */
function said(q: Quest, since: number): string[] {
    return (q.sdk.getState()?.gameMessages ?? []).filter((m) => (m.observationId ?? m.tick) > since).map((m) => m.text).slice(-3);
}
function saidSince(q: Quest, since: number, text: RegExp): boolean {
    return (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > since && text.test(m.text));
}

export async function eatIfLow(q: Quest, below = 0.5): Promise<void> {
    const p = q.sdk.getState()?.player;
    if (!p || p.isDead || p.hp <= 0 || p.hp > (p.maxHp ?? 10) * below) return;
    const food = q.sdk.getInventory().find((i) => i.optionsWithIndex?.some((o) => /^eat$/i.test(o.text)));
    if (food) await q.bot.eatFood(food).catch(() => undefined);
}

/** The loc named `name` with option `opt` nearest `at`, within 3 tiles of it. */
async function findLoc(q: Quest, at: Tile, name: RegExp, opt?: RegExp) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => name.test(l.name) && (!opt || l.optionsWithIndex.some((o) => opt.test(o.text))))
        .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= 3 ? loc : undefined;
}

/** Op on the loc named `name` near `at` until `done`, driving any dialog through. */
async function op(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string, ticks = 30): Promise<void> {
    for (let attempt = 1; attempt <= 4; attempt++) {
        if (done()) return;
        await eatIfLow(q);
        const loc = await findLoc(q, at, name, opt);
        if (!loc) {
            q.log(`waterfall: ${label}: no ${name} with ${opt} near (${at.x},${at.z}) from ${where(q)} (attempt ${attempt})`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 60, log: q.log });
        if (await untilTicks(q.sdk, done, 8)) return;
        q.log(`waterfall: ${label} did not take from ${where(q)} (attempt ${attempt})`);
    }
    throw new Error(`waterfall: ${label} failed at ${where(q)}`);
}

/** Use the held item `objId` on the loc named `name` near `at` until `done`. */
async function useOn(q: Quest, objId: number, at: Tile, name: RegExp, done: () => boolean, label: string, ticks = 30): Promise<void> {
    for (let attempt = 1; attempt <= 4; attempt++) {
        if (done()) return;
        await eatIfLow(q);
        const item = q.sdk.getInventory().find((i) => i.id === objId);
        if (!item) throw new Error(`waterfall: ${label}: not holding obj ${objId} (carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
        const loc = await findLoc(q, at, name);
        if (!loc) {
            q.log(`waterfall: ${label}: no ${name} near (${at.x},${at.z}) from ${where(q)} (attempt ${attempt})`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        const since = cursor(q);
        const sent = await q.sdk.sendUseItemOnLoc(item.slot, loc.x, loc.z, loc.id);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 60, log: q.log });
        if (await untilTicks(q.sdk, done, 8)) return;
        q.log(`waterfall: ${label} did not take from ${where(q)} (attempt ${attempt}; ${sent.success ? 'sent' : `not sent: ${sent.message}`}; said ${JSON.stringify(said(q, since))})`);
    }
    throw new Error(`waterfall: ${label} failed at ${where(q)}`);
}

/** Up or down a ladder near `at` until the player's z leaves/enters the underground band. */
async function ladder(q: Quest, at: Tile, opt: RegExp, done: () => boolean, label: string): Promise<void> {
    await op(q, at, /^ladder$/i, opt, done, label);
}

// ── stage 1 -> 2: the raft and Hudon

/** Board the raft behind Almera's house; at `started` Hudon's lines run on landing. */
export async function raftToIsland(q: Quest, done: () => boolean = () => onIsland(pos(q))): Promise<void> {
    if (onIsland(pos(q)) && done()) return;
    if (!onIsland(pos(q))) {
        await q.goTo(RAFT, 3);
        await op(q, RAFT, /^log raft$/i, /^board$/i, () => onIsland(pos(q)), 'board the raft', 20);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || done(), 8);
    }
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 60, log: q.log });
}

export async function meetHudon(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    // Hudon's lines set the stage before his last line; done = the dialog has closed.
    let seen = '';
    await raftToIsland(q, () => /fine alone/i.test(seen));
    seen += await driveDialog(q.sdk, [], { ticks: 40, log: q.log });
    const recent = (q.sdk.getState()?.recentDialogs ?? []).map((d) => JSON.stringify(d)).join(' ');
    if (!/fine alone|refusing to leave/i.test(seen + recent + (q.sdk.getState()?.gameMessages ?? []).map((m) => m.text).join(' '))) {
        // Not beside the raft's landing (wandered): talk to him from the island.
        await q.sdk.waitForTicks(2);
        await q.talk(/^hudon$/i, []).catch((e) => q.log(`waterfall: talk to Hudon: ${(e as Error).message}`));
    }
    q.log(`waterfall: raft + Hudon in ${tickNow(q.sdk) - t0}t`);
}

/** Off the island or the ledge without the rope: swim (island) or climb the dead tree (ledge) and wash ashore. */
export async function leaveRiver(q: Quest): Promise<void> {
    for (let i = 0; i < 3 && (onIsland(pos(q)) || onLedge(pos(q))); i++) {
        if (onLedge(pos(q))) {
            await leaveWaterfall(q);
        } else {
            // An approach op (aploc): it fires within ~10 tiles of the rock, and the landing
            // (z 3481) is 13 off. The throwing zone runs down to z 3476.
            await q.bot.walkTo(ISLAND_EDGE.x, ISLAND_EDGE.z, 1).catch(() => undefined);
            await op(q, CROSSING_ROCK, /^rock$/i, /^swim to$/i, () => !onIsland(pos(q)), 'swim for the rock', 20);
        }
        await untilTicks(q.sdk, () => !onIsland(pos(q)) && !onLedge(pos(q)), 15);
    }
    if (onIsland(pos(q)) || onLedge(pos(q))) throw new Error(`waterfall: stuck on the river at ${where(q)}`);
    await driveDialog(q.sdk, [], { ticks: 5 });
    q.log(`waterfall: washed ashore at ${where(q)}`);
}

// ── stage 2 -> 3: the book

export async function readBook(q: Quest): Promise<void> {
    if (onIsland(pos(q)) || onLedge(pos(q))) await leaveRiver(q);
    if (!holds(q, OBJ.book)) {
        await q.goTo(TOURIST_CENTRE, 3);
        await q.goTo({ ...BOOKCASE, level: 1 }, 2);
        await op(q, BOOKCASE, /^bookcase$/i, /^search$/i, () => holds(q, OBJ.book), 'search the archive bookcase', 20);
    }
    const book = q.sdk.getInventory().find((i) => i.id === OBJ.book)!;
    const read = book.optionsWithIndex.find((o) => /^read$/i.test(o.text));
    await q.sdk.sendUseItem(book.slot, read?.opIndex ?? 1);
    await untilTicks(q.sdk, (s) => !!s.interface?.isOpen, 6);
    await q.sdk.waitForTicks(2);
    await q.bot.closeInterface().catch(() => undefined);
}

// ── stage 3 -> 4: the pebble and the tomb

export async function getPebble(q: Quest): Promise<void> {
    if (holds(q, OBJ.pebble)) return;
    const t0 = tickNow(q.sdk);
    if (!inGolrieCave(pos(q))) {
        await q.goTo(GNOME_LADDER, 2);
        await ladder(q, GNOME_LADDER, /^climb-down$/i, () => inGolrieCave(pos(q)), 'down to Golrie\'s cave');
    }
    const insideGolrie = () => pos(q).z > GOLRIE_GATE.z && inGolrieCave(pos(q));
    if (!insideGolrie()) {
        if (!holds(q, OBJ.golrieKey)) {
            await q.goTo({ x: GOLRIE_CRATE.x - 1, z: GOLRIE_CRATE.z }, 2);
            await op(q, GOLRIE_CRATE, /^crate$/i, /^search$/i, () => holds(q, OBJ.golrieKey), 'search the crate for Golrie\'s key', 20);
        }
        await q.goTo({ x: GOLRIE_GATE.x, z: GOLRIE_GATE.z - 1 }, 2);
        await useOn(q, OBJ.golrieKey, GOLRIE_GATE, /^door$/i, insideGolrie, 'unlock Golrie\'s gate', 20);
    }
    // His script closes the chat to search the junk (p_delay), then talks on: keep driving it.
    await q.talk(/^golrie$/i, []);
    for (let i = 0; i < 3 && !holds(q, OBJ.pebble); i++) {
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || holds(q, OBJ.pebble), 8);
        await driveDialog(q.sdk, [], { ticks: 40, log: q.log });
    }
    await driveDialog(q.sdk, [], { ticks: 10 });
    if (!holds(q, OBJ.pebble)) throw new Error('waterfall: Golrie gave no pebble');
    // Out through his gate (it opens from inside), and up the ladder.
    await op(q, GOLRIE_GATE, /^door$/i, /^open$/i, () => !insideGolrie(), 'out of Golrie\'s room', 20);
    await q.goTo({ x: GNOME_LADDER.x, z: GNOME_LADDER.z + 6400 + 1 }, 2);
    await ladder(q, { x: GNOME_LADDER.x, z: GNOME_LADDER.z + 6400 }, /^climb-up$/i, () => !inGolrieCave(pos(q)), 'up from Golrie\'s cave');
    q.log(`waterfall: Glarial's pebble in ${tickNow(q.sdk) - t0}t`);
}

/** Bank what the tomb refuses (runes above all) at Ardougne's north bank. */
async function bankForTomb(q: Quest): Promise<void> {
    const forbidden = () => q.sdk.getInventory().filter((i) => !TOMB_SAFE.some((p) => p.test(i.name)));
    if (!forbidden().length && !q.sdk.getEquipment().length) return;
    q.log(`waterfall: banking ${forbidden().map((i) => i.name).join(', ')} before the tomb`);
    await q.goTo(ARDOUGNE_NORTH_BANK, 4);
    await depositAllInventory(q.supply, TOMB_SAFE);
    await q.bot.closeBank().catch(() => undefined);
    if (forbidden().length || q.sdk.getEquipment().length) throw new Error(`waterfall: still holding ${forbidden().map((i) => i.name).join(', ')} for the tomb`);
}

/** The pebble on Glarial's tombstone: down into the tomb (stage 4 on the first entry). */
export async function enterTomb(q: Quest): Promise<void> {
    if (inTomb(pos(q))) return;
    await bankForTomb(q);
    if (!holds(q, OBJ.pebble)) await withdrawQuestItems(q);
    // Not banked either (lost): Golrie hands out another (jackquests, prod, 2026-11-02).
    if (!holds(q, OBJ.pebble)) {
        q.log('waterfall: no pebble held or banked — back to Golrie for another');
        await getPebble(q);
        await bankForTomb(q);
    }
    await q.goTo({ x: TOMBSTONE.x, z: TOMBSTONE.z - 1 }, 2);
    const since = cursor(q);
    await useOn(q, OBJ.pebble, TOMBSTONE, /^tombstone of glarial$/i, () => inTomb(pos(q)) || saidSince(q, since, /nothing happens/i), 'pebble on the tombstone', 20);
    if (!inTomb(pos(q))) throw new Error(`waterfall: the tombstone refused us (carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
    q.log(`waterfall: in Glarial's tomb at ${where(q)}`);
}

/**
 * The quest's own items back from the bank: a restarted run's prologue banks everything, and a
 * resume past the tomb then hunted a pebble it had banked (jackquests, prod, 2026-11-02).
 */
async function withdrawQuestItems(q: Quest): Promise<void> {
    const ids: number[] = Object.values(OBJ);
    if (ids.every((id) => holds(q, id))) return;
    await q.goTo(ARDOUGNE_NORTH_BANK, 4);
    const opened = await q.bot.openBank();
    if (!opened.success) return;
    for (const id of ids) {
        if (holds(q, id)) continue;
        const b = (q.sdk.getBankItems() ?? []).find((x) => x.id === id && x.count > 0);
        if (b) await q.bot.withdrawItem(b, 1, { asNote: false });
    }
    await untilTicks(q.sdk, () => false, 2);
    await q.bot.closeBank().catch(() => undefined);
    const back = ids.filter((id) => holds(q, id));
    if (back.length) q.log(`waterfall: quest items back from the bank: ${back.join(', ')}`);
}

// ── stage 4 -> 5: the amulet, the urn, into the falls

export async function tombItems(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    if (holds(q, OBJ.amulet) && (holds(q, OBJ.urnFull) || holds(q, OBJ.urnEmpty))) return;
    if (!inTomb(pos(q))) await withdrawQuestItems(q);
    if (holds(q, OBJ.amulet) && (holds(q, OBJ.urnFull) || holds(q, OBJ.urnEmpty))) return;
    await enterTomb(q);
    if (!holds(q, OBJ.amulet)) {
        await q.goTo({ x: TOMB_CHEST.x, z: TOMB_CHEST.z + 1 }, 2);
        const amulet = () => holds(q, OBJ.amulet);
        const chestOpen = () => (q.sdk.getNearbyLocs() ?? []).some((l) => /^open chest$/i.test(l.name) && Math.hypot(l.x - TOMB_CHEST.x, l.z - TOMB_CHEST.z) <= 1);
        if (!(await findLoc(q, TOMB_CHEST, /^open chest$/i))) {
            await op(q, TOMB_CHEST, /^closed chest$/i, /^open$/i, () => chestOpen() || amulet(), 'open the chest', 15);
        }
        await op(q, TOMB_CHEST, /^open chest$/i, /^search$/i, amulet, 'search the chest', 15);
    }
    if (!holds(q, OBJ.urnFull)) {
        await q.goTo(TOMB_COFFIN, 3);
        await op(q, TOMB_COFFIN, /^tomb of glarial$/i, /^search$/i, () => holds(q, OBJ.urnFull), 'search the coffin', 15);
    }
    await q.goTo({ x: TOMB_LADDER.x, z: TOMB_LADDER.z }, 3);
    await ladder(q, TOMB_LADDER, /^climb-up$/i, () => !inTomb(pos(q)), 'up from the tomb');
    q.log(`waterfall: amulet and urn in ${tickNow(q.sdk) - t0}t; up at ${where(q)}`);
}

/** The runes banked before the tomb, back from Ardougne's north bank. */
async function withdrawRunes(q: Quest): Promise<void> {
    // From stage 8 (a resumed run walking back in for the chalice) the pillars are done.
    const needs = runeNeeds(q);
    if (needs.every((n) => q.count(n.item) >= n.count)) return;
    await q.goTo(ARDOUGNE_NORTH_BANK, 4);
    const opened = await q.bot.openBank();
    if (!opened.success) throw new Error(`waterfall: bank: ${opened.message}`);
    for (const n of needs) {
        const short = n.count - q.count(n.item);
        const banked = q.sdk.findBankItem(new RegExp(`^${n.item}$`, 'i'));
        if (short > 0 && banked) {
            await q.bot.withdrawItem(banked, Math.min(short, banked.count));
            await untilTicks(q.sdk, () => q.count(n.item) >= n.count, 5);
        }
    }
    await q.bot.closeBank().catch(() => undefined);
    q.log(`waterfall: runes back: ${needs.map((n) => `${q.count(n.item)} ${n.item}`).join(', ')}`);
}

/** Raft, rope on the rock, rope on the dead tree, the ledge door with the amulet. */
export async function enterFalls(q: Quest): Promise<void> {
    if (inFalls(pos(q))) return;
    await withdrawRunes(q);
    const t0 = tickNow(q.sdk);
    if (!onLedge(pos(q))) {
        if (!onIsland(pos(q))) await raftToIsland(q);
        // The landing tile is in the throwing zone; from the rock's far side (z 3468) the tree is next.
        const across = () => pos(q).z <= 3469 || onLedge(pos(q));
        if (!across()) {
            await q.bot.walkTo(ISLAND_EDGE.x, ISLAND_EDGE.z, 1).catch(() => undefined);
            await useOn(q, idOf(q, /^rope$/i), CROSSING_ROCK, /^rock$/i, across, 'rope on the rock', 20);
        }
        await untilTicks(q.sdk, () => pos(q).z <= 3468, 10);
        await useOn(q, idOf(q, /^rope$/i), DEAD_TREE, /^dead tree$/i, () => onLedge(pos(q)), 'rope on the dead tree', 20);
    }
    await op(q, LEDGE_DOOR, /^ledge$/i, /^open$/i, () => inFalls(pos(q)) || !onLedge(pos(q)), 'the ledge door', 20);
    if (!inFalls(pos(q))) throw new Error(`waterfall: the ledge door washed us out (amulet held: ${holds(q, OBJ.amulet)}) at ${where(q)}`);
    q.log(`waterfall: into the falls in ${tickNow(q.sdk) - t0}t`);
}

function idOf(q: Quest, name: RegExp): number {
    const it = q.sdk.getInventory().find((i) => name.test(i.name));
    if (!it) throw new Error(`waterfall: not holding ${name}`);
    return it.id;
}

// ── stage 5 -> 6: Baxtorian's key and the pillar room

const inPuzzleRoom = (q: Quest) => inBox(pos(q), 2560, 2571, 9902, 9918);
const inRaisedRoom = (q: Quest) => inBox(pos(q), 2598, 2610, 9902, 9918);
/**
 * In the fire giants' west room, 3 tiles short of the inner door (a wall on the north edge of
 * 2568,9893). Not next to it: walkTo tries the Open of any door beside its path ("The door is
 * locked") and a key used straight after that is answered "I can't reach that!"; the key's own
 * interaction walks the last tiles.
 */
const INNER_DOOR_APPROACH = { x: 2567, z: 9890 };
/** The corridor between the inner door and the pillar room's door (the key's ground spawn is in it, 2569,9897). */
const pastInnerDoor = (p: { x: number; z: number }) => inBox(p, 2564, 2569, 9894, 9901);

/**
 * Eat at 60% while `fn` runs: the way from the crate (skeletons) to the inner door crosses the
 * fire giants' room, and they hit through every walk and door. A 40-combat account with no
 * armour died there in one unguarded walk (production, 2026-11-02). Same pattern as lib/crest.ts.
 * Walks only: eating clears a pending interaction (OpHeldHandler -> clearPendingAction) but
 * keeps the walk queue, so around a search or a key-on-door it cost an attempt each time;
 * op/useOn eat before each attempt instead.
 */
async function fed<T>(q: Quest, fn: () => Promise<T>): Promise<T> {
    let busy = false;
    const timer = setInterval(() => {
        if (busy) return;
        busy = true;
        eatIfLow(q, 0.6)
            .catch(() => undefined)
            .finally(() => (busy = false));
    }, 300);
    try {
        return await fn();
    } finally {
        clearInterval(timer);
        // A bite still in flight would land on the next op and clear it.
        for (let i = 0; busy && i < 20; i++) await q.sdk.waitForTicks(1);
    }
}

/** Throws once the account has died (or otherwise left the falls) since `life` was taken. */
function lifeCheck(q: Quest) {
    const life = q.sdk.getState()?.player?.lifeId;
    return (what: string) => {
        const p = q.sdk.getState()?.player;
        const died = !!p && (p.isDead || (life !== undefined && p.lifeId !== undefined && p.lifeId !== life));
        if (died || !inFalls(pos(q))) {
            throw new Error(`waterfall: ${died ? 'died' : 'left the falls'} ${what} (now at ${where(q)}, carrying ${q.sdk.getInventory().map((i) => i.name).join(', ') || 'nothing'})`);
        }
    };
}

/** walkTo inside the falls; a death on the way is an error, not a failed walk to retry from Lumbridge. */
async function walkFalls(q: Quest, to: Tile, tolerance: number, label: string): Promise<boolean> {
    const res = await fed(q, () => q.bot.walkTo(to.x, to.z, tolerance)).catch((e: Error) => ({ success: false, message: e.message }));
    if (!res.success) q.log(`waterfall: walk to ${label} (${to.x},${to.z}) from ${where(q)}: ${res.message}`);
    // walkTo reports arrival within tolerance while the last step is still being taken: settle.
    for (let i = 0, last = where(q); i < 6; i++) {
        await q.sdk.waitForTicks(1);
        if (where(q) === last) break;
        last = where(q);
    }
    return res.success;
}

/**
 * Into the pillar room (from stage 8 on, the same key and door lead into the raised
 * room instead). From outside the falls the way in is the whole river route again;
 * at stage 8 the statue has kept the amulet, so the tomb's chest gives another.
 *
 * Inside: Baxtorian's crate (2589,9888, searched from its south tile) gives the key; the
 * pillar room's door (2566,9901) is behind a second elf door (2568,9893), locked from both
 * sides (its Open says so), which the key opens from the fire giants' room. Every leg is
 * planned from which side of that inner door the account stands on — a walk at the pillar
 * room's door from the giants' side has no route (the pathfinder keeps trying loc 2002,
 * "cant_reach ... no route") and wandered the giants' room until the account died.
 */
export async function enterPuzzleRoom(q: Quest): Promise<void> {
    if (inPuzzleRoom(q) || inRaisedRoom(q)) return;
    if (!inFalls(pos(q))) {
        if (!holds(q, OBJ.amulet)) await tombItems(q);
        await enterFalls(q);
    }
    const t0 = tickNow(q.sdk);
    const alive = lifeCheck(q);
    const inside = () => inPuzzleRoom(q) || inRaisedRoom(q);
    // A death inside op/useOn surfaces as their "failed at (Lumbridge)": say what happened instead.
    const steps = async () => {
        for (let lap = 1; lap <= 3 && !inside(); lap++) {
            if (lap > 1) q.log(`waterfall: the pillar room's door, lap ${lap}, from ${where(q)}`);
            if (!holds(q, OBJ.baxtorianKey)) {
                if (pastInnerDoor(pos(q))) {
                    // Shut in the corridor without the key: the inner door is locked this side too;
                    // the key spawns on its floor.
                    const ground = q.sdk.findGroundItem(/^a key$/i);
                    if (!ground) throw new Error(`waterfall: past the inner door at ${where(q)} without Baxtorian's key, and none on the floor`);
                    await q.bot.pickupItem(ground).catch(() => undefined);
                    await untilTicks(q.sdk, () => holds(q, OBJ.baxtorianKey), 10);
                } else {
                    await walkFalls(q, { x: BAXTORIAN_CRATE.x, z: BAXTORIAN_CRATE.z - 1 }, 1, "Baxtorian's crate");
                    alive('on the way to Baxtorian\'s crate');
                    await op(q, BAXTORIAN_CRATE, /^crate$/i, /^search$/i, () => holds(q, OBJ.baxtorianKey), 'search the crate for Baxtorian\'s key', 20);
                }
                alive('fetching Baxtorian\'s key');
                if (!holds(q, OBJ.baxtorianKey)) continue;
                q.log(`waterfall: Baxtorian's key in hand at ${where(q)}`);
            }
            if (!pastInnerDoor(pos(q))) {
                await walkFalls(q, INNER_DOOR_APPROACH, 1, 'the inner door');
                alive('on the way to the inner door');
                if (!holds(q, OBJ.baxtorianKey)) continue;
                await useOn(q, OBJ.baxtorianKey, INNER_DOOR, /^door$/i, () => pastInnerDoor(pos(q)), "Baxtorian's key on the inner door", 20);
                alive('at the inner door');
                if (!pastInnerDoor(pos(q))) continue;
            }
            // The corridor is 7 tiles long: the key's interaction walks it (see INNER_DOOR_APPROACH).
            if (!holds(q, OBJ.baxtorianKey)) continue;
            await useOn(q, OBJ.baxtorianKey, PUZZLE_DOOR, /^door$/i, inside, "Baxtorian's key on the pillar room's door", 20);
            if (!inside()) alive("at the pillar room's door");
        }
    };
    await steps().catch((e: Error) => {
        if (!/^waterfall: (died|left the falls)/.test(e.message)) alive(`(${e.message})`);
        throw e;
    });
    if (!inside()) throw new Error(`waterfall: not into the pillar room after 3 laps (at ${where(q)}, key held: ${holds(q, OBJ.baxtorianKey)})`);
    q.log(`waterfall: in the pillar room at ${where(q)} in ${tickNow(q.sdk) - t0}t`);
}

// ── stage 6 -> 8: the pillars and Glarial's statue

export async function pillarsAndStatue(q: Quest): Promise<void> {
    if (inRaisedRoom(q)) return;
    if (!inPuzzleRoom(q)) await enterPuzzleRoom(q);
    const t0 = tickNow(q.sdk);
    for (const pillar of PILLARS) {
        for (const rune of RUNES) {
            const runeItem = q.sdk.getInventory().find((i) => new RegExp(`^${rune}$`, 'i').test(i.name));
            if (!runeItem) throw new Error(`waterfall: out of ${rune} at pillar (${pillar.x},${pillar.z})`);
            const since = cursor(q);
            const before = q.count(rune);
            // Placed (the rune is used up), or placed on an earlier run ("You remember putting...").
            const placed = () => q.count(rune) < before || saidSince(q, since, /remember putting that type of rune/i);
            await useOn(q, runeItem.id, pillar, /^pillar$/i, placed, `${rune} on the pillar at (${pillar.x},${pillar.z})`, 15);
        }
    }
    q.log(`waterfall: 18 runes on the pillars in ${tickNow(q.sdk) - t0}t`);
    // The statue takes the amulet from the pack, not the neck.
    const worn = q.sdk.getEquipment().find((i) => i.id === OBJ.amulet);
    if (worn) {
        await q.bot.unequipItem(worn).catch(() => undefined);
        await untilTicks(q.sdk, () => q.sdk.getInventory().some((i) => i.id === OBJ.amulet), 5);
    }
    await q.goTo({ x: QUEEN_STATUE.x, z: QUEEN_STATUE.z - 1 }, 1);
    await useOn(q, OBJ.amulet, QUEEN_STATUE, /^statue of glarial$/i, () => inRaisedRoom(q), 'the amulet on Glarial\'s statue', 20);
    q.log(`waterfall: the floor rose; at ${where(q)}`);
}

// ── stage 8 -> complete: the chalice, and out

export async function takeTreasure(q: Quest): Promise<void> {
    if (!inRaisedRoom(q)) await enterPuzzleRoom(q);
    if (!inRaisedRoom(q)) throw new Error(`waterfall: not in the raised room for the chalice (at ${where(q)})`);
    // The reward takes five slots.
    for (let i = 0; q.sdk.getInventory().length > 23 && i < 10; i++) {
        const food = q.sdk.getInventory().find((it) => /^shark$/i.test(it.name));
        if (!food) break;
        await q.sdk.sendDropItem(food.slot);
        await q.sdk.waitForTicks(1);
    }
    await useOn(q, OBJ.urnFull, CHALICE, /^chalice of eternity$/i, () => holds(q, OBJ.urnEmpty), 'the urn on the chalice', 20);
    await untilTicks(q.sdk, () => q.count('gold bar') >= 2, 10);
    await driveDialog(q.sdk, [], { ticks: 10 });
    await q.bot.closeInterface().catch(() => undefined);
    q.log(`waterfall: Baxtorian's treasure taken (${q.count('diamond')} diamonds, ${q.count('gold bar')} gold bars)`);
    await leaveWaterfall(q);
}

/**
 * Out of the falls or off the ledge. Neither has a way out on foot: the ledge's dead tree
 * is out of reach from it ("I can't reach that!") and the barrel sits on the upper ledge.
 * So: a teleport (TELEPORTS, the best the account can cast with the runes it holds); before
 * the treasure is taken, the chalice's "Take treasure" floods the cave and washes you ashore.
 * The raft's island is left by swimming.
 */
export async function leaveWaterfall(q: Quest): Promise<void> {
    const stuck = () => inFalls(pos(q)) || onLedge(pos(q));
    if (onIsland(pos(q))) await leaveRiver(q);
    if (stuck() && teleportFor(q, true)) await teleportOut(q);
    if (stuck() && inRaisedRoom(q) && !holds(q, OBJ.urnEmpty) && q.stage !== 'complete') {
        await op(q, CHALICE, /^chalice of eternity$/i, /^take treasure$/i, () => !stuck(), 'the chalice (flood out)', 30);
        await untilTicks(q.sdk, () => !stuck(), 20);
    }
    if (stuck()) throw new Error(`waterfall: no way out of the falls from ${where(q)} without teleport runes (carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
    await driveDialog(q.sdk, [], { ticks: 5 });
    q.log(`waterfall: out of the falls at ${where(q)}`);
}

/** Standard-spellbook teleports, best (nearest Ardougne) first. Component ids: sdk/spells.ts. */
export const TELEPORTS = [
    { name: 'Camelot', level: 45, component: 1174, runes: [{ item: 'law rune', count: 1 }, { item: 'air rune', count: 5 }] },
    { name: 'Falador', level: 37, component: 1170, runes: [{ item: 'law rune', count: 1 }, { item: 'air rune', count: 3 }, { item: 'water rune', count: 1 }] },
    { name: 'Lumbridge', level: 31, component: 1167, runes: [{ item: 'law rune', count: 1 }, { item: 'air rune', count: 3 }, { item: 'earth rune', count: 1 }] },
    { name: 'Varrock', level: 25, component: 1164, runes: [{ item: 'law rune', count: 1 }, { item: 'air rune', count: 3 }, { item: 'fire rune', count: 1 }] },
];
const MAGIC_TAB = 6;

/** The best teleport the account can cast (and, with `held`, has the runes for beyond the pillars' share). */
export function teleportFor(q: Quest, held = false) {
    return TELEPORTS.find((t) => q.level('magic') >= t.level && (!held || t.runes.every((r) => q.count(r.item) >= r.count)));
}

/**
 * Runes the rest of the quest needs: the pillars' 6 air, earth and water (until the floor
 * has risen) plus the way out's teleport.
 */
export function runeNeeds(q: Quest): Array<{ item: string; count: number }> {
    const out = new Map<string, number>();
    if (q.stage !== 'raised') for (const n of RUNE_NEEDS) out.set(n.item, n.count);
    for (const r of teleportFor(q)?.runes ?? []) out.set(r.item, (out.get(r.item) ?? 0) + r.count);
    return [...out].map(([item, count]) => ({ item, count }));
}

async function teleportOut(q: Quest): Promise<void> {
    const tele = teleportFor(q, true);
    if (!tele) return;
    const from = pos(q);
    const away = () => Math.hypot(pos(q).x - from.x, pos(q).z - from.z) > 30;
    for (let attempt = 1; attempt <= 3 && !away(); attempt++) {
        await driveDialog(q.sdk, [], { ticks: 5 });
        await q.bot.closeInterface().catch(() => undefined);
        // The spell button only takes once the magic tab is open (lib/lost-city.ts).
        await q.sdk.sendSetTab(MAGIC_TAB).catch(() => undefined);
        await q.sdk.waitForTicks(1);
        await q.sdk.sendClickComponent(tele.component);
        if (await untilTicks(q.sdk, away, 12)) break;
        q.log(`waterfall: ${tele.name} Teleport attempt ${attempt} did not take at ${where(q)}`);
    }
    if (away()) q.log(`waterfall: ${tele.name} Teleport out to ${where(q)}`);
    await q.sdk.waitForTicks(3);
}

export { ASHORE };
