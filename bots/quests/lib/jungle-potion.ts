/**
 * Jungle Potion — the route and mechanics (bots/quests/jungle-potion.ts is the definition).
 *
 * Content: quest_junglepotion/scripts/quest_junglepotion.rs2 (the five herb locs, the cave),
 * area_karamja/scripts/trufitus.rs2 (dialog), skill_herblore identify.rs2 (Herblore 3 for
 * the quest herbs), captain_barnaby.rs2 / customs_officer.rs2 (the Brimhaven boats, 30gp).
 *
 * Each herb loc only yields while its stage is current (`%junglepotion < get_X` → "nothing of
 * interest"), comes out grimy ("Unidentified herb", iop1 Identify) and Trufitus refuses it
 * until cleaned. A searched loc turns empty for 100 ticks (loc_change), so every herb has the
 * content's full list of placements. The Rogues Purse fungus never empties.
 *
 * Getting there: Ardougne docks → Captain Barnaby → Brimhaven, then on foot through the jungle.
 * Back: Brimhaven customs → Ardougne. run-quest's goTo calls leaveJungle so a run resumed in the
 * cave or the jungle sails home this way, not by the Musa Point boat and a walk across Asgarnia.
 *
 * Combat (low-level accounts): jungle spiders (44, poison) and snakes around Tai Bwo Wannai,
 * jogres (53) in the cave, all `cowardly` hunters — aggressive to accounts under twice their level.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
}

export const TRUFITUS = { x: 2809, z: 3086 };
const BARNABY = { x: 2679, z: 3275 };
const BRIMHAVEN_CUSTOMS = { x: 2772, z: 3225 };
/** pothole_cave_entrance (2x2, m44_48 0 8 46), the "secret entrance … in the northern cliffs". */
const POTHOLE = { x: 2824, z: 3118 };
/** Where p_telejump lands in the cave (0_44_148_14_48), beside the hand holds (2830,9522). */
const CAVE_LANDING = { x: 2830, z: 9520 };
const LOC = { pothole: 2584, handHolds: 2585 };
export const FARE = 30;

export interface Herb {
    id: string;
    /** Clean herb name (what Trufitus takes). */
    name: string;
    /** The searchable "full" loc id. */
    loc: number;
    tiles: Tile[];
    cave?: boolean;
}

/** Loc placements from maps/m43_47, m44_47, m44_48 and m44_148. */
export const HERBS: Record<string, Herb> = {
    snake: { id: 'snake', name: 'snake weed', loc: 2575, tiles: [{ x: 2760, z: 3014 }, { x: 2761, z: 3017 }] },
    ardrigal: { id: 'ardrigal', name: 'ardrigal', loc: 2577, tiles: [{ x: 2870, z: 3115 }, { x: 2877, z: 3120 }, { x: 2874, z: 3124 }] },
    sito: { id: 'sito', name: 'sito foil', loc: 2579, tiles: [{ x: 2789, z: 3047 }, { x: 2790, z: 3049 }, { x: 2791, z: 3047 }, { x: 2784, z: 3067 }] },
    moss: { id: 'moss', name: 'volencia moss', loc: 2581, tiles: [{ x: 2850, z: 3035 }, { x: 2851, z: 3033 }, { x: 2851, z: 3036 }] },
    purse: { id: 'purse', name: 'rogues purse', loc: 2583, tiles: [{ x: 2869, z: 9517 }, { x: 2869, z: 9492 }, { x: 2850, z: 9476 }], cave: true },
};

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;

/** Karamja, Brimhaven's docks included (run-quest's own box stops at z 3200). */
export const onIsland = (p: Tile) => inBox(p, 2740, 2990, 2880, 3240);
/** On Karamja's surface (or the cave) now: the fare home is all a transition still needs. */
export const onIslandNow = (q: Quest) => onIsland(pos(q)) || inJungleCave(pos(q));
/** The Rogues Purse cave (m44_148). */
export const inJungleCave = (p: Tile) => inBox(p, 2816, 2879, 9472, 9535);
/** Tai Bwo Wannai and the herb spots around it, and the cave. */
export const inJungleArea = (p: Tile) => inBox(p, 2745, 2890, 3000, 3135) || inJungleCave(p);

function dialogOpen(q: Quest): boolean {
    return !!q.sdk.getDialog()?.isOpen;
}

/** The nearest loc with id `id` and option `opt` within 15 tiles. */
async function findLocId(q: Quest, id: number, opt: RegExp) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    return (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => l.id === id && l.optionsWithIndex.some((o) => opt.test(o.text)))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
}

/** Op `opt` on loc `id` (near where we stand) until `done`, driving any dialog with `choices`. */
async function opLoc(q: Quest, id: number, opt: RegExp, done: () => boolean, label: string, choices: Array<RegExp | string> = []): Promise<void> {
    for (let attempt = 1; attempt <= 4; attempt++) {
        if (done()) return;
        const loc = await findLocId(q, id, opt);
        if (!loc) {
            q.log(`jungle: ${label}: no loc ${id} near ${where(q)} (attempt ${attempt})`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 30);
        if (dialogOpen(q)) await driveDialog(q.sdk, choices, { done, ticks: 60, log: q.log });
        if (await untilTicks(q.sdk, done, 10)) return;
        q.log(`jungle: ${label} did not take from ${where(q)} (attempt ${attempt})`);
    }
    throw new Error(`jungle: ${label} failed at ${where(q)}`);
}

// ── the boats

/** Ardougne docks → Brimhaven (Captain Barnaby, 30gp), down the gangplank. */
async function sailToBrimhaven(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    if (q.count('coins') < FARE) throw new Error(`jungle: ${q.count('coins')} coins, Barnaby's fare is ${FARE}`);
    for (let i = 0; i < 3 && !onIsland(pos(q)); i++) {
        await q.talk(/^captain barnaby$/i, [/^yes please/i], BARNABY);
        await untilTicks(q.sdk, () => onIsland(pos(q)), 30);
    }
    if (!onIsland(pos(q))) throw new Error(`jungle: Barnaby never sailed (at ${where(q)}, coins ${q.count('coins')})`);
    await downGangplank(q);
    q.log(`jungle: sailed Ardougne → Brimhaven in ${tickNow(q.sdk) - t0}t`);
}

/** Brimhaven customs → Ardougne (30gp), down the gangplank. */
async function sailToArdougne(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    if (pos(q).level !== 0) await downGangplank(q);
    // bot.walkTo, not q.goTo: run-quest's Karamja box ends at z 3200, so goTo would take the
    // customs tile for the mainland and sail from Musa Point instead.
    const walk = await q.bot.walkTo(BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z, 4);
    if (!walk.success) q.log(`jungle: walk to the Brimhaven customs: ${walk.message}`);
    for (let i = 0; i < 3 && onIsland(pos(q)); i++) {
        await q.talk(/^customs officer$/i, [/can i journey on this ship/i, /search away/i, /^ok\.?$/i]);
        await untilTicks(q.sdk, () => !onIsland(pos(q)), 30);
    }
    if (onIsland(pos(q))) throw new Error(`jungle: the Brimhaven boat never sailed (at ${where(q)}, coins ${q.count('coins')})`);
    await downGangplank(q);
    q.log(`jungle: sailed Brimhaven → Ardougne in ${tickNow(q.sdk) - t0}t`);
}

/** set_sail lands on the ship's deck (plane 1). */
async function downGangplank(q: Quest): Promise<void> {
    for (let i = 0; i < 5 && pos(q).level !== 0; i++) {
        await q.sdk.scanNearbyLocs(8).catch(() => undefined);
        const plank = q.sdk.findNearbyLoc(/gangplank/i, { withOption: /cross/i });
        if (!plank) {
            await q.sdk.waitForTicks(2);
            continue;
        }
        await q.bot.interactLoc(plank, /cross/i).catch(() => undefined);
        await untilTicks(q.sdk, (s) => (s.player?.level ?? 1) === 0, 10);
    }
    if (pos(q).level !== 0) throw new Error(`jungle: stuck on the ship's deck at ${where(q)}`);
}

// ── the cave

async function enterCave(q: Quest): Promise<void> {
    if (inJungleCave(pos(q))) return;
    await toJungle(q, { x: POTHOLE.x, z: POTHOLE.z - 1 }, 3);
    // "You search the rocks... You find an entrance" → "Yes, I'll enter the cave." → p_telejump.
    await opLoc(q, LOC.pothole, /^search$/i, () => inJungleCave(pos(q)), 'enter the cave', [/yes, i'll enter the cave/i]);
    await driveDialog(q.sdk, [], { ticks: 5 });
    q.log(`jungle: into the cave at ${where(q)}`);
}

async function leaveCave(q: Quest): Promise<void> {
    if (!inJungleCave(pos(q))) return;
    await q.goTo(CAVE_LANDING, 2);
    await opLoc(q, LOC.handHolds, /^climb$/i, () => !inJungleCave(pos(q)), 'climb out of the cave');
    await driveDialog(q.sdk, [], { ticks: 5 });
    q.log(`jungle: out of the cave at ${where(q)}`);
}

/**
 * run-quest's goTo, from anywhere in the jungle or the cave: out of the cave unless `tile` is in
 * it, and off the island by the Brimhaven boat when `tile` is on the mainland.
 */
export async function leaveJungle(q: Quest, tile: Tile): Promise<void> {
    if (inJungleCave(pos(q)) && !inJungleCave(tile)) await leaveCave(q);
    if (pos(q).level !== 0 || !onIsland(pos(q)) || onIsland(tile) || inJungleCave(tile)) return;
    // Broke (a fixture started naked in the cave; a real resume still holds the return fare): no
    // coins on this side of the island, so run-quest's Musa Point boat, which pickpockets the fare.
    // Known gap: its walk east stalled in a Brimhaven house at (2804,3181) (local, 2026-11-01).
    if (q.count('coins') < FARE) return void q.log(`jungle: ${q.count('coins')} coins, short of the Brimhaven fare: leaving by Musa Point`);
    await sailToArdougne(q);
}

/** Walk to a Karamja tile from wherever we are (the mainland: Barnaby's boat first). */
export async function toJungle(q: Quest, tile: Tile, tolerance = 3): Promise<void> {
    if (inJungleCave(pos(q))) await leaveCave(q);
    if (!onIsland(pos(q))) {
        if (pos(q).level !== 0) await q.climbTo(0);
        await sailToBrimhaven(q);
    }
    await q.goTo(tile, tolerance);
}

/** Home from the island: run-quest's epilogue goes on to the bank from the Ardougne docks. */
export async function homeFromJungle(q: Quest): Promise<void> {
    await leaveJungle(q, BARNABY);
}

// ── herbs

const holdsClean = (q: Quest, herb: Herb) => q.count(herb.name) > 0;
const grimy = (q: Quest) => q.sdk.getInventory().find((i) => /^unidentified herb$/i.test(i.name));

/** Clean every "Unidentified herb" held (Herblore 3). */
async function identifyAll(q: Quest): Promise<void> {
    for (let i = 0; i < 6; i++) {
        const herb = grimy(q);
        if (!herb) return;
        const before = q.sdk.getInventory().filter((x) => /^unidentified herb$/i.test(x.name)).length;
        await q.sdk.sendUseItem(herb.slot, 1);
        const ok = await untilTicks(q.sdk, () => q.sdk.getInventory().filter((x) => /^unidentified herb$/i.test(x.name)).length < before, 8);
        if (dialogOpen(q)) await driveDialog(q.sdk, [], { ticks: 5 });
        if (!ok) q.log(`jungle: identify did not take (herblore ${q.level('herblore')})`);
    }
    if (grimy(q)) throw new Error(`jungle: could not identify the herb (herblore ${q.level('herblore')})`);
}

/** Pick `herb` fresh (its stage must be current) and clean it. */
export async function pickHerb(q: Quest, herb: Herb): Promise<void> {
    if (holdsClean(q, herb)) return;
    if (grimy(q)) {
        await identifyAll(q);
        if (holdsClean(q, herb)) return;
    }
    const t0 = tickNow(q.sdk);
    if (herb.cave) await enterCave(q);
    // Nearest placement first; an emptied loc regrows in 100 ticks.
    for (let round = 0; round < 8 && !grimy(q); round++) {
        for (const tile of herb.tiles) {
            if (grimy(q)) break;
            if (herb.cave) await q.goTo(tile, 3);
            else await toJungle(q, tile, 3);
            const loc = await findLocId(q, herb.loc, /^search$/i);
            if (!loc || Math.hypot(loc.x - tile.x, loc.z - tile.z) > 2) continue;
            await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => /^search$/i.test(o.text))!.opIndex);
            await untilTicks(q.sdk, (s) => !!grimy(q) || !!s.dialog?.isOpen, 30);
            if (dialogOpen(q)) await driveDialog(q.sdk, [], { done: () => !!grimy(q) && !dialogOpen(q), ticks: 20 });
            await untilTicks(q.sdk, () => !!grimy(q), 5);
        }
        if (!grimy(q)) {
            q.log(`jungle: no ${herb.name} to pick at any placement (round ${round + 1}); waiting for regrowth`);
            await q.sdk.waitForTicks(25);
        }
    }
    if (!grimy(q)) throw new Error(`jungle: picked no ${herb.name} in ${tickNow(q.sdk) - t0}t`);
    await identifyAll(q);
    if (!holdsClean(q, herb)) throw new Error(`jungle: identified the herb but hold no ${herb.name} (carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
    q.log(`jungle: picked and cleaned ${herb.name} in ${tickNow(q.sdk) - t0}t`);
}

/** Pick, clean and hand `herb` to Trufitus. */
export async function deliverHerb(q: Quest, herb: Herb): Promise<void> {
    await pickHerb(q, herb);
    if (herb.cave) await leaveCave(q);
    await toJungle(q, TRUFITUS, 6);
    await q.talk(/^trufitus$/i, [/^of course!?$/i], TRUFITUS);
}
