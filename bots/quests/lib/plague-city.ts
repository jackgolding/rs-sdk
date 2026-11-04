/**
 * Plague City — Edmond's garden, the Ardougne sewer and West Ardougne.
 *
 * Content facts (quest_elena/scripts/*.rs2, configs/quest_elena.constant, maps
 * m39_51, m39_52, m39_151, m40_52, m40_152; npc and loc ids from pack/*.pack):
 *   - Edmond (2568,3334) and Alrena (2573,3333) in their house, East Ardougne. The
 *     garden's mud patch (2566,3331-3333, no op of its own) takes buckets of water
 *     from stage 3 (4 pours: 3 -> 7) and a spade from stage 7: "Suddenly it
 *     crumbles away!" drops you in the sewer by the mud pile (2562,9737). A spade
 *     spawns in the garden (2574,3331); the picture Jethick asks about lies in the
 *     house (2576,3334); Alrena's cupboard (2574,3334) holds a spare gas mask from
 *     stage 2 when the account has none anywhere (bank included).
 *   - The sewer: the mud pile (2561,9738) Climb goes back to the garden; the grill
 *     on the sewer pipe (2530,9701) takes the rope at stage 8; the sewer's own Edmond
 *     (2535,9719) pulls it off at stage 9 (-> 10). From 10 the pipe's Search, with
 *     the gas mask WORN, squeezes you into West Ardougne at (2529,3304), beside the
 *     manhole (2529,3303) whose Climb-down lands at the pipe (2530,9703). The mud
 *     patch is the only way back down from the east side: every crossing digs.
 *   - West Ardougne: Jethick (2540,3305) takes the picture (-> 20) and hands over the
 *     Rehnisons' book; the Rehnisons' door (2531,3328) lets you in with it (-> 21);
 *     Ted or Martha inside (-> 22); Milli upstairs (2531,3330,L1, stairs 2527,3332)
 *     (-> 23). The plague house's real door is (2533,3272) (the one at 2540,3273 is
 *     "locked" for ever); a mourner within 14 tiles (spawns 2531-2541,3272-3273)
 *     answers it: "I fear not a mere plague." -> 24. The clerk (2528,3317) in the
 *     civic office: permission -> "This is urgent though!" with Bravek within 7
 *     tiles of the player (-> 25); Bravek (2536,3314) behind his door (2530,3314):
 *     really important -> what is in the cure (-> 26, the recipe). The hangover cure
 *     is chocolate dust on a bucket of milk, then snape grass on the chocolatey milk
 *     (cakes.rs2); Bravek drinks it (-> 27) and "They won't listen to me!" gets the
 *     warrant. With it the mourner lets you sneak in (2533,3272); the barrel
 *     (2534,3268) holds the small key from 27; the Spooky stairs (2536,3268) go down
 *     to (2537,9670); the key opens Elena's cell door (2539,9672); Elena (2541,9672)
 *     -> 28; Edmond -> complete (A magic scroll).
 * No aggressive npcs on these legs; the gas mask matters only for the pipe.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
}

/** Obj ids (pack/obj.pack): "Book" and "Picture" are names other items share. */
export const OBJ = {
    warrant: 1503,
    hangoverCure: 1504,
    gasMask: 1506,
    smallKey: 1507,
    book: 1509,
    picture: 1510,
    chocolateyMilk: 1977,
} as const;

export const EDMOND = { x: 2568, z: 3333 };
export const ALRENA = { x: 2572, z: 3333 };
const MUD_PATCH = { x: 2566, z: 3332 };
/** Beside the patch, in the garden. */
const GARDEN = { x: 2567, z: 3332 };
const SPADE_SPAWN = { x: 2574, z: 3331 };
const PICTURE_SPAWN = { x: 2576, z: 3334 };
const CUPBOARD = { x: 2574, z: 3334 };
const MUD_PILE = { x: 2561, z: 9738 };
const SEWER_PIPE = { x: 2530, z: 9701 };
/** The pipe's approach tile (the climb forcewalks here first). */
const PIPE_FRONT = { x: 2530, z: 9702 };
const SEWER_EDMOND = { x: 2535, z: 9719 };
const MANHOLE = { x: 2529, z: 3303 };
export const JETHICK = { x: 2540, z: 3305 };
const REHNISON_DOOR = { x: 2531, z: 3328 };
const REHNISON_PORCH = { x: 2531, z: 3327 };
/** Inside the Rehnisons' house, ground floor (Ted 2531,3331, Martha 2531,3333). */
const REHNISONS = { x: 2530, z: 3331 };
const MILLI = { x: 2531, z: 3330, level: 1 };
const PLAGUE_DOOR = { x: 2533, z: 3272 };
/** North of the plague house door, outside. */
const PLAGUE_PORCH = { x: 2533, z: 3273 };
const BARREL = { x: 2534, z: 3268 };
const CELLAR_STAIRS_DOWN = { x: 2536, z: 3268 };
const CELL_DOOR = { x: 2539, z: 9672 };
const ELENA = { x: 2541, z: 9672 };
const CELLAR_STAIRS_UP = { x: 2536, z: 9671 };
export const CLERK = { x: 2528, z: 3317 };
export const BRAVEK = { x: 2536, z: 3314 };
const BRAVEK_DOOR = { x: 2530, z: 3314 };
/** Inside the clerk's office, west of Bravek's door. */
const BRAVEK_DOOR_WEST = { x: 2529, z: 3314 };

export const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
export const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;

/** Inside the West Ardougne wall (the east wall runs at x 2557-2558; Edmond's garden is 2566). */
// Less the strips outside its west wall (x 2459-2460, z <= 3306) and south wall (z 3279-3280, x <= 2508):
// the Khazard battlefield and Tree Gnome Village's warlord (2457,3302) — leavePlagueCity's manhole
// walk from there ended at the east gate (qlqbtg1, 2026-11-03).
export const inWestArdougne = (p: Tile) => inBox(p, 2410, 2557, 3264, 3335) && !inBox(p, 2410, 2458, 3264, 3304) && !inBox(p, 2410, 2508, 3264, 3278);
/** The plague sewer under the wall: manhole/pipe (2530,9703) to the mud pile (2561,9738). */
export const inPlagueSewer = (p: Tile) => inBox(p, 2500, 2580, 9690, 9760);
/** The plague house's cellar (Elena's cell). */
export const inPlagueCellar = (p: Tile) => inBox(p, 2530, 2546, 9664, 9680);
/** Anywhere the runner's goTo cannot walk out of: West Ardougne is walled until Biohazard. */
export const inPlagueArea = (p: Tile) => inWestArdougne(p) || inPlagueSewer(p) || inPlagueCellar(p);

export const holds = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id) || q.sdk.getEquipment().some((i) => i.id === id);
export const wearing = (q: Quest, id: number) => q.sdk.getEquipment().some((i) => i.id === id);

/** Newest game-message cursor, taken before an action so only replies to it match. */
export function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
export function saidSince(q: Quest, since: number, text: RegExp): boolean {
    return (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > since && text.test(m.text));
}
/** Text of the open dialog (objbox/mesbox pages carry the content's own words). */
export function dialogText(q: Quest): string {
    const d = q.sdk.getDialog();
    return d?.isOpen ? (d.allComponents ?? []).map((c) => c.text).filter(Boolean).join(' ') : '';
}

/** The loc named `name` (with option `opt`) nearest `at`, within 3 tiles of it. */
export async function findLoc(q: Quest, at: Tile, name: RegExp, opt?: RegExp) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => name.test(l.name) && (!opt || l.optionsWithIndex.some((o) => opt.test(o.text))))
        .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= 3 ? loc : undefined;
}

/** Op on the loc named `name` near `at` until `done`, driving any dialog through with `choices`. */
export async function op(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string, choices: Array<RegExp | string> = [], ticks = 30): Promise<string> {
    let seen = '';
    for (let attempt = 1; attempt <= 4; attempt++) {
        if (done()) return seen;
        const loc = await findLoc(q, at, name, opt);
        if (!loc) {
            q.log(`plague: ${label}: no ${name} with ${opt} near (${at.x},${at.z}) from ${where(q)} (attempt ${attempt})`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) seen += await driveDialog(q.sdk, choices, { done, ticks: 80, log: q.log });
        if (await untilTicks(q.sdk, done, 8)) return seen;
        q.log(`plague: ${label} did not take from ${where(q)} (attempt ${attempt}): ${seen.slice(0, 160)}`);
    }
    throw new Error(`plague: ${label} failed at ${where(q)}`);
}

/** Use the held item matching `item` (an obj id or a name) on the loc named `name` near `at` until `done`. */
export async function useOn(q: Quest, item: number | RegExp, at: Tile, name: RegExp, done: () => boolean, label: string, ticks = 30): Promise<string> {
    let seen = '';
    for (let attempt = 1; attempt <= 4; attempt++) {
        if (done()) return seen;
        const held = q.sdk.getInventory().find((i) => (typeof item === 'number' ? i.id === item : item.test(i.name)));
        if (!held) throw new Error(`plague: ${label}: not holding ${item} (carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
        const loc = await findLoc(q, at, name);
        if (!loc) {
            q.log(`plague: ${label}: no ${name} near (${at.x},${at.z}) from ${where(q)} (attempt ${attempt})`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendUseItemOnLoc(held.slot, loc.x, loc.z, loc.id);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) seen += await driveDialog(q.sdk, [], { done, ticks: 60, log: q.log });
        if (await untilTicks(q.sdk, done, 8)) return seen;
        q.log(`plague: ${label} did not take from ${where(q)} (attempt ${attempt}): ${seen.slice(0, 160)}`);
    }
    throw new Error(`plague: ${label} failed at ${where(q)}`);
}

/** Pick up the ground item `id` at `tile` (a respawning spawn): waits out a respawn, bounded. */
export async function pickUp(q: Quest, tile: Tile, id: number, label: string): Promise<void> {
    if (holds(q, id)) return;
    await q.goTo(tile, 2);
    for (let i = 0; i < 20 && !holds(q, id); i++) {
        await q.sdk.scanGroundItems(6).catch(() => undefined);
        const ground = (q.sdk.getState()?.groundItems ?? []).find((g) => g.id === id && Math.abs(g.x - tile.x) <= 1 && Math.abs(g.z - tile.z) <= 1);
        if (!ground) {
            await q.sdk.waitForTicks(10);
            continue;
        }
        await q.bot.pickupItem(ground).catch(() => undefined);
        await untilTicks(q.sdk, () => holds(q, id), 8);
    }
    if (!holds(q, id)) throw new Error(`plague: no ${label} at (${tile.x},${tile.z})`);
    q.log(`plague: picked up the ${label}`);
}

// ── getting around: East Ardougne <-> the sewer <-> West Ardougne

/** A spade: the garden's spawn when none is carried (the patch is dug on every crossing). */
async function gardenSpade(q: Quest): Promise<void> {
    if (q.count('spade') > 0) return;
    const id = 952;
    await pickUp(q, SPADE_SPAWN, id, 'spade');
}

/** The gas mask: held/worn, else Alrena's spare from her cupboard (stage 2+, none owned). */
export async function getMask(q: Quest): Promise<void> {
    if (holds(q, OBJ.gasMask)) return;
    await q.goTo(CUPBOARD, 2);
    const shut = await findLoc(q, CUPBOARD, /^cupboard$/i, /^open$/i);
    if (shut) await op(q, CUPBOARD, /^cupboard$/i, /^open$/i, () => !!q.sdk.findNearbyLoc(/^cupboard$/i, { withOption: /^search$/i }), 'open Alrena\'s cupboard', [], 10).catch(() => undefined);
    await op(q, CUPBOARD, /^cupboard$/i, /^search$/i, () => holds(q, OBJ.gasMask), 'search Alrena\'s cupboard for the spare mask', [], 15);
    q.log('plague: took the spare gas mask from Alrena\'s cupboard');
}

async function wearMask(q: Quest): Promise<void> {
    if (wearing(q, OBJ.gasMask)) return;
    const mask = q.sdk.getInventory().find((i) => i.id === OBJ.gasMask);
    if (!mask) throw new Error('plague: no gas mask to wear');
    await q.bot.equipItem(mask);
    if (!(await untilTicks(q.sdk, () => wearing(q, OBJ.gasMask), 6))) throw new Error('plague: the gas mask did not go on');
}

/** Dig through the softened mud patch into the sewer (stage 7+). */
export async function digIntoSewer(q: Quest): Promise<void> {
    if (inPlagueSewer(pos(q))) return;
    const t0 = tickNow(q.sdk);
    await gardenSpade(q);
    await q.goTo(GARDEN, 1);
    await useOn(q, /^spade$/i, MUD_PATCH, /^mud patch$/i, () => inPlagueSewer(pos(q)), 'dig the mud patch', 20);
    // "You fall through... Edmond follows you down the hole."
    await driveDialog(q.sdk, [], { ticks: 10 });
    q.log(`plague: dug into the sewer in ${tickNow(q.sdk) - t0}t`);
}

/** From East Ardougne (or the sewer) into West Ardougne through the sewer pipe, mask on. */
export async function enterWestArdougne(q: Quest): Promise<void> {
    if (inWestArdougne(pos(q))) return;
    if (inPlagueCellar(pos(q))) return void (await upFromCellar(q));
    const t0 = tickNow(q.sdk);
    if (!holds(q, OBJ.gasMask) && !inPlagueSewer(pos(q))) await getMask(q);
    if (!inPlagueSewer(pos(q))) await digIntoSewer(q);
    await wearMask(q);
    await q.goTo(PIPE_FRONT, 1);
    // "The pipe is being used" while someone else squeezes through: the retries wait it out.
    await op(q, SEWER_PIPE, /^sewer pipe$/i, /^search$/i, () => inWestArdougne(pos(q)), 'climb through the sewer pipe', [], 20);
    q.log(`plague: into West Ardougne at ${where(q)} in ${tickNow(q.sdk) - t0}t`);
}

async function upFromCellar(q: Quest): Promise<void> {
    if (!inPlagueCellar(pos(q))) return;
    // Elena's cell door shuts behind you; from inside it opens without the key.
    if (pos(q).x > CELL_DOOR.x) await op(q, CELL_DOOR, /^door$/i, /^open$/i, () => pos(q).x <= CELL_DOOR.x || !!q.sdk.findNearbyLoc(/^spooky stairs$/i, { reachable: true }), 'out of Elena\'s cell', [], 15);
    await op(q, CELLAR_STAIRS_UP, /^spooky stairs$/i, /^walk-up$/i, () => !inPlagueCellar(pos(q)), 'up the plague house stairs', [], 15);
}

/** Out of the cellar, West Ardougne or the sewer, back to Edmond's garden. */
export async function leavePlagueCity(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    await upFromCellar(q);
    if (inWestArdougne(pos(q))) {
        if (pos(q).level !== 0) await q.climbTo(0);
        await q.goTo(MANHOLE, 1);
        const closed = await findLoc(q, MANHOLE, /^manhole$/i, /^open$/i);
        if (closed) await op(q, MANHOLE, /^manhole$/i, /^open$/i, () => !!q.sdk.findNearbyLoc(/^manhole$/i, { withOption: /^climb-down$/i }), 'open the manhole', [], 10);
        await op(q, MANHOLE, /^manhole$/i, /^climb-down$/i, () => inPlagueSewer(pos(q)), 'down the manhole', [], 15);
    }
    if (inPlagueSewer(pos(q))) {
        await q.goTo({ x: MUD_PILE.x + 1, z: MUD_PILE.z - 1 }, 2);
        await op(q, MUD_PILE, /^mud pile$/i, /^climb$/i, () => !inPlagueSewer(pos(q)), 'climb the mud pile', [], 15);
    }
    if (inPlagueArea(pos(q))) throw new Error(`plague: could not get out of West Ardougne/the sewer (at ${where(q)})`);
    q.log(`plague: back in Edmond's garden ${where(q)} in ${tickNow(q.sdk) - t0}t`);
}

// ── stage 2 -> 3: the picture, then Edmond

/** The picture of Elena, from Edmond's house (East Ardougne). */
export async function getPicture(q: Quest): Promise<void> {
    if (holds(q, OBJ.picture)) return;
    if (inPlagueArea(pos(q))) await leavePlagueCity(q);
    await pickUp(q, PICTURE_SPAWN, OBJ.picture, 'picture of Elena');
}

// ── stages 3..6 -> 7: four buckets of water on the patch

export async function softenSoil(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    await q.goTo(GARDEN, 1);
    let soft = false;
    for (let pour = 0; pour < 6 && !soft && q.count('bucket of water') > 0; pour++) {
        const before = q.count('bucket of water');
        const since = cursor(q);
        let seen = '';
        const done = () => q.count('bucket of water') < before || /enough already/i.test(dialogText(q));
        seen = await useOn(q, /^bucket of water$/i, MUD_PATCH, /^mud patch$/i, done, `pour water ${pour + 1}`, 20);
        seen += dialogText(q) + (await driveDialog(q.sdk, [], { ticks: 10 }));
        soft = /soft enough/i.test(seen) || saidSince(q, since, /soft enough/i);
    }
    q.log(`plague: soil ${soft ? 'soft enough to dig' : 'poured out'} in ${tickNow(q.sdk) - t0}t (water left ${q.count('bucket of water')})`);
}

// ── stage 8 -> 9 -> 10: the grill

export async function tieRope(q: Quest): Promise<void> {
    if (!inPlagueSewer(pos(q))) {
        if (inPlagueArea(pos(q))) await leavePlagueCity(q);
        await digIntoSewer(q);
    }
    await q.goTo(PIPE_FRONT, 1);
    const before = q.count('rope');
    await useOn(q, /^rope$/i, SEWER_PIPE, /^sewer pipe$/i, () => q.count('rope') < before, 'tie the rope to the grill', 20);
    await driveDialog(q.sdk, [], { ticks: 10 });
}

export async function pullGrill(q: Quest): Promise<void> {
    if (!inPlagueSewer(pos(q))) {
        if (inPlagueArea(pos(q))) await leavePlagueCity(q);
        await digIntoSewer(q);
    }
    await q.talk(/^edmond$/i, [], SEWER_EDMOND);
}

// ── stage 10 -> 20 -> 21 -> 22 -> 23: Jethick, the Rehnisons, Milli

export async function showPicture(q: Quest): Promise<void> {
    await getPicture(q);
    await enterWestArdougne(q);
    await q.talk(/^jethick$/i, [/looking for a woman from east ardougne/i], JETHICK);
}

export async function returnBook(q: Quest): Promise<void> {
    await enterWestArdougne(q);
    if (!holds(q, OBJ.book)) {
        // Stage 20 and 21 share a journal. Jethick hands another book at 20 to someone without
        // one (jethick.rs2); at 21 (returned) he only says hello, and the door is open to us.
        const seen = await q.talk(/^jethick$/i, [/looking for a woman from east ardougne/i], JETHICK);
        if (!holds(q, OBJ.book)) {
            q.log(`plague: no book from Jethick (${seen.slice(0, 80)}) — the Rehnisons have it already`);
            return;
        }
    }
    await q.goTo(REHNISON_PORCH, 1);
    // Ted answers the door ("Go away. We don't want any.") and lets the book's bearer in.
    await op(q, REHNISON_DOOR, /^door$/i, /^open$/i, () => !holds(q, OBJ.book), 'knock at the Rehnisons\' door', [], 20);
    await driveDialog(q.sdk, [], { ticks: 15 });
    q.log('plague: returned the Rehnisons\' book');
}

export async function askRehnisons(q: Quest): Promise<void> {
    await enterWestArdougne(q);
    await q.goTo(REHNISONS, 2);
    await q.talk(/^(ted|martha) rehnison$/i, []);
}

export async function askMilli(q: Quest): Promise<void> {
    await enterWestArdougne(q);
    if (pos(q).level !== 1) await q.goTo(REHNISONS, 2);
    await q.goTo(MILLI, 2);
    await q.talk(/^milli/i, []);
}

// ── stage 23 -> 24: the plague house door; 24/25 -> 26: the clerk and Bravek

export async function tryPlagueHouse(q: Quest): Promise<void> {
    await enterWestArdougne(q);
    if (pos(q).level !== 0) await q.climbTo(0);
    await q.goTo(PLAGUE_PORCH, 1);
    // The door only advances the quest with a Mourner within 14 tiles (doors.rs2
    // west_ardougne_plague_house_doors: npc_find(coord, mournertwb, 14, 0)); without one it is
    // just "a black cross on the door" (Jackpoo5 failed 2/2, 2026-11-03). They wander: wait.
    for (let w = 0; w < 40; w++) {
        const m = q.sdk.findNearbyNpc(/^mourner$/i);
        if (m && (m.distance ?? 99) <= 12) break;
        if (w === 0) q.log('plague: waiting for a Mourner near the plague house door');
        await q.sdk.waitForTicks(5);
    }
    let cleared = false;
    const done = () => (cleared ||= /hopes up|apply to the head mourner/i.test(dialogText(q)));
    const seen = await op(q, PLAGUE_DOOR, /^door$/i, /^open$/i, done, 'the plague house door', [/i fear not a mere plague/i, /how do i get clearance/i], 20).catch((e) => {
        q.log(`plague: ${(e as Error).message}`);
        return '';
    });
    await driveDialog(q.sdk, [/i fear not a mere plague/i], { ticks: 15 });
    q.log(`plague: plague house door: ${seen.slice(0, 200)}`);
}

export async function seeBravek(q: Quest): Promise<void> {
    await enterWestArdougne(q);
    if (pos(q).level !== 0) await q.climbTo(0);
    // Stage 24 -> 25 (no journal change): the clerk calls through to Bravek, who must be
    // within 7 tiles of the player. At 25 the clerk only says Bravek will see you.
    // Bravek wanders his room; out of range, the clerk's call goes unanswered: ask again.
    for (let attempt = 1; attempt <= 6; attempt++) {
        // Wait (bounded) for Bravek to wander within 6 tiles of the clerk's spot before asking: every
        // call made from the clerk with him at the far wall went unanswered (ABGARMY06/14, 2026-11-04).
        await q.goTo(CLERK, 2);
        for (let w = 0; w < 40; w++) {
            const b = q.sdk.findNearbyNpc(/^bravek$/i);
            if (b && Math.max(Math.abs(b.x - pos(q).x), Math.abs(b.z - pos(q).z)) <= 6) break;
            await q.sdk.waitForTicks(3);
        }
        const clerk = await q.talk(/^clerk$/i, [/i need permission to enter a plague house/i, /this is urgent though/i], CLERK);
        if (/they can come in|will see you now/i.test(clerk)) break;
        q.log(`plague: clerk (attempt ${attempt}): Bravek did not answer — ${clerk.slice(-100)}`);
        await q.sdk.waitForTicks(5);
    }
    await intoBraveksRoom(q);
    const bravek = await q.talk(/^bravek$/i, [/this is really important though/i, /do you know what is in the cure/i]);
    q.log(`plague: Bravek: ${bravek.slice(-160)}`);
}

/**
 * Through Bravek's door (2530,3314) from the clerk's office (stage 25+). walkTo does not open
 * it, and talkTo walked out of the office looking for another way round.
 */
async function intoBraveksRoom(q: Quest): Promise<void> {
    const reachable = () => !!q.sdk.findNearbyNpc(/^bravek$/i, { reachable: true });
    if (reachable()) return;
    await q.goTo(BRAVEK_DOOR_WEST, 1);
    await op(q, BRAVEK_DOOR, /^door$/i, /^open$/i, () => reachable() || pos(q).x > BRAVEK_DOOR.x, 'through Bravek\'s door', [], 10);
}

// ── stage 26 -> 27: the hangover cure

export async function makeHangoverCure(q: Quest): Promise<void> {
    if (holds(q, OBJ.hangoverCure)) return;
    const combine = async (a: RegExp | number, b: RegExp | number, product: number, label: string) => {
        if (holds(q, product)) return;
        for (let attempt = 1; attempt <= 3 && !holds(q, product); attempt++) {
            const inv = q.sdk.getInventory();
            const match = (p: RegExp | number) => inv.find((i) => (typeof p === 'number' ? i.id === p : p.test(i.name)));
            const src = match(a);
            const dst = match(b);
            if (!src || !dst) throw new Error(`plague: ${label}: missing ${src ? b : a} (carrying ${inv.map((i) => i.name).join(', ')})`);
            await q.sdk.sendUseItemOnItem(src.slot, dst.slot);
            await untilTicks(q.sdk, (s) => holds(q, product) || !!s.dialog?.isOpen, 8);
            await driveDialog(q.sdk, [], { ticks: 8 });
        }
        if (!holds(q, product)) throw new Error(`plague: ${label} did not work`);
    };
    await combine(/^chocolate dust$/i, /^bucket of milk$/i, OBJ.chocolateyMilk, 'chocolate dust on the milk');
    await combine(/^snape grass$/i, OBJ.chocolateyMilk, OBJ.hangoverCure, 'snape grass in the chocolatey milk');
    q.log('plague: made the hangover cure');
}

export async function cureBravek(q: Quest): Promise<void> {
    await makeHangoverCure(q);
    await enterWestArdougne(q);
    if (pos(q).level !== 0) await q.climbTo(0);
    await intoBraveksRoom(q);
    const seen = await q.talk(/^bravek$/i, [/they won't listen to me/i]);
    q.log(`plague: Bravek: ${seen.slice(-200)}`);
}

// ── stage 27 -> 28: the warrant, the key, Elena

/** Bravek's warrant: he hands another at 27 if it was lost ("Ah now what was it you wanted"). */
async function getWarrant(q: Quest): Promise<void> {
    if (holds(q, OBJ.warrant)) return;
    // bravek.rs2: at 27 with no warrant he re-asks, then the same multi3 ("They won't listen to me!")
    // hands it over. On a slow server the talk returned mid-dialog ("...I need permission to
    // enter. Click here to continue") before the choice came up (jacklove20, 2026-11-03): keep
    // driving any dialog still open, and talk again up to three times.
    const seen: string[] = [];
    for (let attempt = 1; attempt <= 3 && !holds(q, OBJ.warrant); attempt++) {
        await intoBraveksRoom(q);
        let s = await q.talk(/^bravek$/i, [/they won't listen to me/i]);
        if (!holds(q, OBJ.warrant) && (await untilTicks(q.sdk, (st) => !!st.dialog?.isOpen, 6))) {
            s += await driveDialog(q.sdk, [/they won't listen to me/i], { done: () => holds(q, OBJ.warrant), ticks: 80, log: q.log });
        }
        await untilTicks(q.sdk, () => holds(q, OBJ.warrant), 5);
        seen.push(`#${attempt}: ${s.slice(-160)}`);
    }
    if (!holds(q, OBJ.warrant)) throw new Error(`plague: Bravek gave no warrant (${seen.join(' | ')})`);
}

export async function rescueElena(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    await enterWestArdougne(q);
    const inHouse = () => inBox(pos(q), 2532, 2541, 3268, 3271) || inPlagueCellar(pos(q));
    if (!inPlagueCellar(pos(q))) {
        if (pos(q).level !== 0) await q.climbTo(0);
        await getWarrant(q);
        if (!inHouse()) {
            await q.goTo(PLAGUE_PORCH, 1);
            // A mourner must be within 14 tiles to hear about the warrant; they wander.
            await op(q, PLAGUE_DOOR, /^door$/i, /^open$/i, inHouse, 'into the plague house with the warrant', [], 20);
            await driveDialog(q.sdk, [], { ticks: 10 });
        }
        if (!holds(q, OBJ.smallKey)) await op(q, BARREL, /^barrel$/i, /^search$/i, () => holds(q, OBJ.smallKey), 'search the barrel for the key', [], 15);
        await driveDialog(q.sdk, [], { ticks: 6 });
        await op(q, CELLAR_STAIRS_DOWN, /^spooky stairs$/i, /^walk-down$/i, () => inPlagueCellar(pos(q)), 'down the plague house stairs', [], 15);
    }
    // The key opens the cell door ("You unlock the door."); Elena is inside, east of it.
    const inCell = () => pos(q).x > CELL_DOOR.x;
    if (!inCell()) {
        await op(q, CELL_DOOR, /^door$/i, /^open$/i, () => inCell() || !!q.sdk.findNearbyNpc(/^elena$/i, { reachable: true }), 'open Elena\'s cell', [], 15);
    }
    await q.talk(/^elena$/i, []);
    q.log(`plague: Elena freed in ${tickNow(q.sdk) - t0}t`);
}
