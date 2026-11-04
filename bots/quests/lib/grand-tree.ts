/**
 * The Grand Tree — King Narnode, Hazelmere, Glough's house, the prison, the glider to Karamja, the
 * shipyard, Femi's cart, Anita, the twig pillars, the black demon and the Daconia roots.
 *
 * Content facts (quest_grandtree/scripts/*.rs2, area_gnome/scripts/{hazelmere,gnome_glider,gnome_gate}.rs2;
 * placements m38_53/54, m38_154, m41_48, m45/46_47):
 *   - King Narnode (2466,3497) is in the Grand Tree's trunk, behind the Tree Door. His start dialog
 *     walks you down a trapdoor and back up by telejump. Underground he is at (2464,9897), by the
 *     ladder_from_cellar (2463,9897) up into the trunk.
 *   - Hazelmere (2678,3086,L1) on the island east of Yanille, up the ladder (2677,3087). He takes the
 *     bark sample and writes the scroll in one dialog (-> 20).
 *   - Narnode's translation (-> 30): "I think so!", "None of the above." twice, "A man came to me with
 *     the King's seal.", "I gave the man Daconia rocks.", "And Daconia rocks will kill the tree!".
 *   - Glough's house: ladder (2476,3463) to L1 — Glough (2478,3463), the cupboard (2476,3465: Open,
 *     Search -> his journal, 60 -> 70), the chest (2482,3462: use Glough's key -> invasion plans),
 *     the tree (2484,3464, Agility 25) up to L2: four pillars (2485..2488,3467) take twigs T,U,Z,O
 *     (obj 789..792) in that order (-> 130), then the trapdoor (2487,3464,L2) drops to (2491,9864):
 *     Glough's speech, then a black demon (lvl 172) to kill (-> 140).
 *   - Talking to Glough at 70 jails you (2464,3496,L3); Charlie's dialog, then Narnode frees you (-> 80).
 *   - Charlie (L3 cell by the middle ladder, 2464,3495): 50 -> 60, and 90 -> 100.
 *   - The glider pilot (2464,3501,L3) at 80: "Take me to Karamja please!" -> (2917,3058).
 *   - The shipyard gate (2945,3041): "Glough sent me.", password Ka / Lu / Min. The foreman (2999,3043):
 *     "Sadly his wife is no longer with us!", "He loves worm holes.", "Anita." -> lumber order (-> 90).
 *   - At 90 the stronghold gate refuses entry: Femi (2459,3382) carts you in — free if you lifted her
 *     boxes, else 1000 coins (run-quest's gate crossing declines her boxes).
 *   - Anita (2390,3514,L1, stairs 2389,3512) gives Glough's key at 100/110.
 *   - Underground at 150 one of fifteen roots (daconia_coords.enum, random) holds the Daconia rock.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { crossGnomeGate, inStronghold, throughTreeDoor } from './gnome-stronghold';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const OBJ = {
    bark: 783,
    book: 784,
    journal: 785,
    scroll: 786,
    order: 787,
    key: 788,
    twigT: 789,
    twigU: 790,
    twigZ: 791,
    twigO: 792,
    rock: 793,
    plans: 794,
} as const;

const NARNODE = { x: 2466, z: 3497 };
const NARNODE_UNDER = { x: 2464, z: 9897 };
const TREE_OUTSIDE = { x: 2465, z: 3489 };
const TRUNK = { x: 2466, z: 3494 };
const HAZEL_LADDER = { x: 2677, z: 3087 };
const HAZELMERE = { x: 2678, z: 3086, level: 1 };
const GLOUGH_LADDER = { x: 2476, z: 3463 };
const GLOUGH_FOOT = { x: 2477, z: 3463 };
const CUPBOARD = { x: 2476, z: 3465, level: 1 };
const CHEST = { x: 2482, z: 3462, level: 1 };
const CLIMB_TREE = { x: 2484, z: 3464, level: 1 };
const DOWN_TREE = { x: 2485, z: 3464, level: 2 };
const TRAPDOOR = { x: 2487, z: 3464, level: 2 };
const PILLARS: Array<{ x: number; z: number; twig: number }> = [
    { x: 2485, z: 3467, twig: OBJ.twigT },
    { x: 2486, z: 3467, twig: OBJ.twigU },
    { x: 2487, z: 3467, twig: OBJ.twigZ },
    { x: 2488, z: 3467, twig: OBJ.twigO },
];
const MIDDLE_LADDER = { x: 2466, z: 3495 };
const CHARLIE = { x: 2464, z: 3495, level: 3 };
const PILOT = { x: 2464, z: 3501, level: 3 };
const SHIPYARD_GATE = { x: 2945, z: 3041 };
const FOREMAN = { x: 2999, z: 3043 };
const FEMI = { x: 2459, z: 3382 };
const ANITA_STAIRS = { x: 2389, z: 3512 };
const ANITA = { x: 2390, z: 3514, level: 1 };
const LADDER_FROM_CELLAR = { x: 2463, z: 9897 };
/** daconia_coords.enum, values 1..15 (0 and 1 share a root). */
const ROOTS: Tile[] = [
    { x: 2456, z: 9886 },
    { x: 2457, z: 9881 },
    { x: 2455, z: 9874 },
    { x: 2443, z: 9878 },
    { x: 2439, z: 9881 },
    { x: 2444, z: 9893 },
    { x: 2452, z: 9893 },
    { x: 2465, z: 9891 },
    { x: 2468, z: 9890 },
    { x: 2467, z: 9896 },
    { x: 2473, z: 9897 },
    { x: 2481, z: 9904 },
    { x: 2485, z: 9885 },
    { x: 2490, z: 9889 },
    { x: 2467, z: 9872 },
];

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
export const held = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id);

/** The Grand Tree's roots under the stronghold (Glough's passage and Narnode's cave). */
export const inTreeRoots = (p: Tile) => inBox(p, 2420, 2500, 9850, 9915);
/** Glough's house, L1 and L2 (the tree up from L1 is not a ladder climbTo knows). */
const inGloughUpstairs = (p: Tile) => (p.level ?? 0) >= 1 && inBox(p, 2470, 2492, 3455, 3472);
/** The Shipyard behind its gate (east of x 2945), Karamja. */
export const inShipyard = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2945, 3010, 3015, 3070);
/** The Grand Tree's upper floors around the middle ladder (L2/L3: the prison and the glider). */
const inTreeTop = (p: Tile) => (p.level ?? 0) >= 2 && inBox(p, 2440, 2490, 3480, 3515);
/** Anywhere run-quest's goTo has no way out of on its own. */
export const inGrandTreeArea = (p: Tile) => inTreeRoots(p) || inGloughUpstairs(p) || inShipyard(p) || inTreeTop(p);

function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function said(q: Quest, since: number, text: RegExp): boolean {
    return (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > since && text.test(m.text));
}

async function locNear(q: Quest, at: Tile, name: RegExp, opt?: RegExp, within = 3) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => name.test(l.name) && (!opt || l.optionsWithIndex.some((o) => opt.test(o.text))))
        .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= within ? loc : undefined;
}

/** Op a loc near `at` until `done`; dialogs it opens are driven with `choices`. */
async function op(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string, choices: RegExp[] = [], ticks = 20): Promise<string> {
    let seen = '';
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const loc = await locNear(q, at, name, opt);
        if (!loc) {
            q.log(`grandtree: ${label}: no ${name} with ${opt} near (${at.x},${at.z}) from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) seen += await driveDialog(q.sdk, choices, { done, ticks: 120, log: q.log });
        await untilTicks(q.sdk, done, 6);
    }
    if (!done()) throw new Error(`grandtree: ${label} failed at ${where(q)}`);
    return seen;
}

/** Use held item `id` on the loc `name` near `at` until `done`. */
async function useOn(q: Quest, id: number, at: Tile, name: RegExp, done: () => boolean, label: string, within = 1): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const item = q.sdk.getInventory().find((i) => i.id === id);
        if (!item) throw new Error(`grandtree: ${label}: not holding obj ${id}`);
        const loc = await locNear(q, at, name, undefined, within);
        if (!loc) {
            q.log(`grandtree: ${label}: no ${name} at (${at.x},${at.z}) from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendUseItemOnLoc(item.slot, loc.x, loc.z, loc.id);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 20);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 30, log: q.log });
        await untilTicks(q.sdk, done, 4);
    }
    if (!done()) throw new Error(`grandtree: ${label} failed at ${where(q)}`);
}

/** Drive dialogs that reopen after cutscene delays (walks, telejumps) until none opens for `gap` ticks. */
async function settle(q: Quest, choices: RegExp[], ticks: number, gap = 25): Promise<string> {
    const t0 = tickNow(q.sdk);
    let seen = '';
    while (tickNow(q.sdk) - t0 < ticks) {
        if (!q.sdk.getDialog()?.isOpen && !(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, gap))) break;
        seen += await driveDialog(q.sdk, choices, { ticks: ticks - (tickNow(q.sdk) - t0), log: q.log });
    }
    return seen;
}

// ── getting around the stronghold

/** Up or down the Grand Tree's middle ladder to `level` (L1-L3 all share it). */
async function treeLevel(q: Quest, level: number): Promise<void> {
    for (let i = 0; i < 8 && pos(q).level !== level; i++) {
        const up = pos(q).level < level;
        const opt = up ? /^climb-up$/i : /^climb-down$/i;
        const now = pos(q).level;
        const ladder = await locNear(q, MIDDLE_LADDER, /ladder/i, opt, 4);
        if (!ladder) throw new Error(`grandtree: no ladder ${up ? 'up' : 'down'} at the tree's middle (at ${where(q)})`);
        await q.sdk.sendInteractLoc(ladder.x, ladder.z, ladder.id, ladder.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        await untilTicks(q.sdk, () => pos(q).level !== now, 15);
    }
    if (pos(q).level !== level) throw new Error(`grandtree: could not reach L${level} of the Grand Tree (at ${where(q)})`);
}

/** Inside the trunk on L0 (Narnode, the ladder's foot). */
const inTrunk = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2462, 2469, 3493, 3500);

/** Into the stronghold and the Grand Tree's trunk. */
async function toTrunk(q: Quest): Promise<void> {
    if (inTrunk(pos(q))) return;
    if (inGrandTreeArea(pos(q))) await leaveGrandTreeArea(q);
    if (inStronghold(pos(q)) && pos(q).level > 0 && inBox(pos(q), 2440, 2490, 3480, 3515)) await treeLevel(q, 0);
    if (pos(q).level > 0) await q.climbTo(0);
    if (!inStronghold(pos(q))) await crossGnomeGate(q, true);
    if (inTrunk(pos(q))) return;
    await q.goTo(TREE_OUTSIDE, 3);
    await throughTreeDoor(q, TRUNK);
}

/** Up the Grand Tree to L`level` (the prison and the glider are on L3). */
async function upTree(q: Quest, level: number): Promise<void> {
    if (pos(q).level === level && inBox(pos(q), 2440, 2490, 3480, 3515)) return;
    await toTrunk(q);
    await treeLevel(q, level);
}

export async function talkNarnode(q: Quest, choices: RegExp[]): Promise<string> {
    if (inTreeRoots(pos(q))) {
        await q.bot.walkTo(NARNODE_UNDER.x + 1, NARNODE_UNDER.z, 2).catch(() => undefined);
        return (await q.talk(/^king narnode shareen$/i, choices)) + (await settle(q, choices, 60));
    }
    await toTrunk(q);
    // The start dialog telejumps down and back up between pages.
    return (await q.talk(/^king narnode shareen$/i, choices)) + (await settle(q, choices, 60));
}

/** Glough's house, L1 (up its ladder). */
async function toGloughL1(q: Quest): Promise<void> {
    if (pos(q).level === 2 && inGloughUpstairs(pos(q))) {
        await op(q, DOWN_TREE, /^tree$/i, /climb-down/i, () => pos(q).level === 1, 'down the tree in Glough\'s house');
    }
    if (pos(q).level === 1 && inGloughUpstairs(pos(q))) return;
    if (!inStronghold(pos(q))) await crossGnomeGate(q, true);
    if (pos(q).level > 0) await toTrunk(q);
    if (inTrunk(pos(q))) await throughTreeDoor(q, TREE_OUTSIDE);
    await q.goTo(GLOUGH_FOOT, 1);
    await op(q, GLOUGH_LADDER, /^ladder$/i, /climb-up/i, () => pos(q).level === 1, 'up Glough\'s ladder');
}

export async function talkGlough(q: Quest, choices: RegExp[] = []): Promise<string> {
    await toGloughL1(q);
    // At 70 he walks you to the cage: Charlie and then Narnode talk between delays.
    return (await q.talk(/^glough$/i, choices)) + (await settle(q, choices, 80));
}

export async function talkCharlie(q: Quest): Promise<void> {
    await upTree(q, 3);
    // Charlie is behind his cell's bars: bot.talkTo refuses an unreachable npc, the raw op talks
    // through them (apnpc1, no range).
    await q.bot.walkTo(CHARLIE.x + 2, CHARLIE.z, 1).catch(() => undefined);
    for (let attempt = 1; attempt <= 3; attempt++) {
        const charlie = q.sdk.findNearbyNpc(/^charlie$/i);
        if (!charlie) {
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractNpc(charlie.index, 1, { route: false });
        if (await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 12)) break;
        await q.sdk.sendTalkToNpc(charlie.index);
        if (await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 12)) break;
    }
    await settle(q, [], 60);
}

// ── 10 -> 20: Hazelmere

export async function seeHazelmere(q: Quest): Promise<void> {
    if (!held(q, OBJ.bark) && !held(q, OBJ.scroll)) throw new Error('grandtree: no bark sample for Hazelmere');
    if (inStronghold(pos(q))) await crossGnomeGate(q, false);
    await q.goTo({ x: HAZEL_LADDER.x, z: HAZEL_LADDER.z + 1 }, 2);
    await op(q, HAZEL_LADDER, /^ladder$/i, /climb-up/i, () => pos(q).level === 1, 'up Hazelmere\'s ladder');
    await q.talk(/^hazelmere$/i, []);
    await driveDialog(q.sdk, [], { ticks: 20, log: q.log });
    if (!held(q, OBJ.scroll)) q.log('grandtree: no scroll from Hazelmere');
    await op(q, { ...HAZEL_LADDER }, /^ladder$/i, /climb-down/i, () => pos(q).level === 0, 'down Hazelmere\'s ladder');
    void HAZELMERE;
}

/** Narnode's translation quiz, most specific answers first (driveDialog takes the first pattern that matches). */
export const TRANSLATION = [
    /^i think so!?$/i,
    /a man came to me with the king'?s seal/i,
    /i gave the man daconia rocks/i,
    /and daconia rocks will kill the tree/i,
    /^none of the above\.?$/i,
];

// ── 60 -> 70: the cupboard

export async function searchCupboard(q: Quest): Promise<void> {
    if (held(q, OBJ.journal)) return;
    await toGloughL1(q);
    const open = () => !!q.sdk.getNearbyLocs()?.some((l) => /^cupboard$/i.test(l.name) && l.optionsWithIndex.some((o) => /^search$/i.test(o.text)));
    if (!(await locNear(q, CUPBOARD, /^cupboard$/i, /^search$/i))) await op(q, CUPBOARD, /^cupboard$/i, /^open$/i, open, 'open Glough\'s cupboard');
    await op(q, CUPBOARD, /^cupboard$/i, /^search$/i, () => held(q, OBJ.journal), 'search Glough\'s cupboard');
    q.log('grandtree: found Glough\'s journal');
}

// ── 80 -> 90: the glider, the shipyard, the foreman

export async function toShipyardForeman(q: Quest): Promise<void> {
    if (held(q, OBJ.order)) return;
    if (!inShipyard(pos(q)) && !(pos(q).x > 2880 && pos(q).z < 3080)) {
        await upTree(q, 3);
        await q.talk(/^gnome pilot$/i, [/take me to karamja/i], PILOT);
        await driveDialog(q.sdk, [], { ticks: 30, log: q.log });
        if (!(await untilTicks(q.sdk, () => pos(q).x > 2880, 10))) throw new Error(`grandtree: the glider did not leave (at ${where(q)})`);
        q.log(`grandtree: glider crash-landed at ${where(q)}`);
    }
    if (!inShipyard(pos(q))) {
        await q.goTo({ x: SHIPYARD_GATE.x - 2, z: SHIPYARD_GATE.z }, 2);
        await op(q, SHIPYARD_GATE, /^gate$/i, /^open$/i, () => inShipyard(pos(q)), 'the shipyard gate', [/glough sent me/i, /^ka\.$/i, /^lu\.$/i, /^min\.$/i], 30);
        q.log(`grandtree: through the shipyard gate at ${where(q)}`);
    }
    // goTo would sail us off Karamja for a tile east of x 2990: walk and talk directly.
    const walk = await q.bot.walkTo(FOREMAN.x - 2, FOREMAN.z, 4);
    if (!walk.success) q.log(`grandtree: walk to the foreman: ${walk.message}`);
    await q.talk(/^foreman$/i, [/sadly his wife is no longer with us/i, /he loves worm holes/i, /^anita\.?$/i]);
    await settle(q, [/sadly his wife is no longer with us/i, /he loves worm holes/i, /^anita\.?$/i], 80);
    if (!held(q, OBJ.order)) throw new Error('grandtree: no lumber order from the foreman');
    q.log('grandtree: holding the lumber order');
}

/** Out of the shipyard by its gate (it opens from inside without the guard's quiz). */
export async function leaveShipyard(q: Quest): Promise<void> {
    if (!inShipyard(pos(q))) return;
    await q.bot.walkTo(SHIPYARD_GATE.x, SHIPYARD_GATE.z, 1).catch(() => undefined);
    await op(q, SHIPYARD_GATE, /^gate$/i, /^open$/i, () => !inShipyard(pos(q)), 'out of the shipyard gate', [], 15);
}

// ── 90 -> 100: Femi's cart into the stronghold, then Charlie

export async function femiCart(q: Quest): Promise<void> {
    if (inStronghold(pos(q))) return;
    await q.talk(/^femi$/i, [/ok then,? i'?ll pay/i], FEMI);
    await driveDialog(q.sdk, [/ok then,? i'?ll pay/i], { ticks: 30, log: q.log });
    if (!(await untilTicks(q.sdk, () => inStronghold(pos(q)), 10))) throw new Error(`grandtree: Femi's cart did not take us in (at ${where(q)}; coins ${q.count('coins')})`);
    q.log(`grandtree: in on Femi's cart at ${where(q)}`);
}

// ── 100 -> 110: Anita's key, Glough's chest

export async function getPlans(q: Quest): Promise<void> {
    if (held(q, OBJ.plans)) return;
    if (!held(q, OBJ.key)) {
        if (inGrandTreeArea(pos(q))) await leaveGrandTreeArea(q);
        if (pos(q).level > 0) await toTrunk(q);
        if (inTrunk(pos(q))) await throughTreeDoor(q, TREE_OUTSIDE);
        if (!inStronghold(pos(q))) await crossGnomeGate(q, true);
        await q.goTo({ x: ANITA_STAIRS.x, z: ANITA_STAIRS.z - 1 }, 2);
        await op(q, ANITA_STAIRS, /stair/i, /climb-up/i, () => pos(q).level === 1, 'up Anita\'s stairs');
        await q.talk(/^anita$/i, []);
        if (!held(q, OBJ.key)) throw new Error('grandtree: Anita kept the key');
        await q.climbTo(0);
        void ANITA;
    }
    await toGloughL1(q);
    await useOn(q, OBJ.key, CHEST, /chest/i, () => held(q, OBJ.plans), 'Glough\'s key on his chest');
    q.log('grandtree: found the invasion plans');
}

// ── 120 -> 130: the twigs on the pillars

export async function placeTwigs(q: Quest): Promise<void> {
    await toGloughL1(q);
    if (pos(q).level === 1) {
        await op(q, CLIMB_TREE, /^tree$/i, /climb-up/i, () => pos(q).level === 2, 'up the tree in Glough\'s house');
    }
    const since = cursor(q);
    for (const pillar of PILLARS) {
        if (!held(q, pillar.twig)) continue;
        await useOn(q, pillar.twig, pillar, /^pillar$/i, () => !held(q, pillar.twig), `twig ${pillar.twig} on the pillar at ${pillar.x}`, 0);
    }
    await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || said(q, since, /grinding/i), 6);
    const seen = await driveDialog(q.sdk, [], { ticks: 15, log: q.log });
    q.log(`grandtree: twigs on the pillars${/grinding/i.test(seen) ? ' — the pulley ground' : ''}`);
}

// ── 130 -> 140: the trapdoor and the black demon

async function eatIfLow(q: Quest): Promise<void> {
    const hp = q.sdk.getSkill('hitpoints');
    if (!hp || hp.level >= hp.baseLevel * 0.55) return;
    const food = q.sdk.getInventory().find((i) => i.optionsWithIndex?.some((o) => /^eat$/i.test(o.text)));
    if (food) await q.bot.eatFood(food).catch(() => undefined);
}

/** Up the tree in Glough's house and down his trapdoor into the roots (>= 130). */
async function downTrapdoor(q: Quest): Promise<void> {
    if (inTreeRoots(pos(q))) return;
    await toGloughL1(q);
    if (pos(q).level === 1) await op(q, CLIMB_TREE, /^tree$/i, /climb-up/i, () => pos(q).level === 2, 'up the tree in Glough\'s house');
    await op(q, TRAPDOOR, /^trapdoor$/i, /^open$/i, () => inTreeRoots(pos(q)), 'Glough\'s trapdoor', [], 15);
    q.log(`grandtree: down the trapdoor to ${where(q)}`);
}

/** Glough's speech, then his black demon: fight until it has been seen and is gone (130 -> 140). */
export async function fightDemon(q: Quest): Promise<void> {
    await downTrapdoor(q);
    const weapon = q.sdk.getInventory().find((i) => /(scimitar|longsword)$/i.test(i.name));
    if (weapon) await q.bot.equipItem(weapon).catch(() => undefined);
    const t0 = tickNow(q.sdk);
    let seenDemon = false;
    let gone = 0;
    while (tickNow(q.sdk) - t0 < 900) {
        if (q.sdk.getDialog()?.isOpen) {
            await driveDialog(q.sdk, [], { ticks: 40, log: q.log });
            continue;
        }
        await eatIfLow(q);
        const hp = q.sdk.getSkill('hitpoints');
        if (hp && hp.level < 25 && !q.sdk.getInventory().some((i) => i.optionsWithIndex?.some((o) => /^eat$/i.test(o.text)))) {
            throw new Error(`grandtree: out of food against the black demon (hp ${hp.level})`);
        }
        const demon = q.sdk.findNearbyNpc(/^black demon$/i);
        if (!demon) {
            if (seenDemon && ++gone >= 3) break;
            // Not spawned yet (the cutscene), or a resumed run past it: give up after a while.
            if (!seenDemon && tickNow(q.sdk) - t0 > 60) break;
            await q.sdk.waitForTicks(2);
            continue;
        }
        seenDemon = true;
        gone = 0;
        // Protect from Melee (Prayer 43): unarmoured, ten sharks ran out at hp 21 with the demon
        // still up (qlqbgt1, 2026-11-04).
        const prayer = q.sdk.getPrayerState();
        if (prayer && prayer.prayerLevel >= 43 && prayer.prayerPoints > 0 && !prayer.activePrayers[14]) await q.bot.activatePrayer('protect_from_melee').catch(() => undefined);
        if (!q.sdk.getState()?.player?.combat?.inCombat) {
            const res = await q.bot.attack(demon);
            if (!res.success) q.log(`grandtree: attack the demon: ${res.message}`);
        }
        await untilTicks(q.sdk, () => !q.sdk.findNearbyNpc(/^black demon$/i) || !q.sdk.getState()?.player?.combat?.inCombat || !!q.sdk.getDialog()?.isOpen, 8);
    }
    if (q.sdk.getPrayerState()?.activePrayers.some(Boolean)) await q.bot.deactivateAllPrayers().catch(() => undefined);
    q.log(`grandtree: ${seenDemon ? 'the black demon is dead' : 'no black demon came'} (${tickNow(q.sdk) - t0}t, hp ${q.sdk.getSkill('hitpoints')?.level})`);
}

// ── 150: the Daconia rock in the roots

export async function findDaconia(q: Quest): Promise<void> {
    if (held(q, OBJ.rock)) return;
    if (!inTreeRoots(pos(q))) {
        // The trapdoor under the trunk only opens after the quest: go by Glough's passage instead.
        await downTrapdoor(q);
    }
    const t0 = tickNow(q.sdk);
    const todo = [...ROOTS];
    while (todo.length && !held(q, OBJ.rock) && tickNow(q.sdk) - t0 < 1500) {
        todo.sort((a, b) => Math.hypot(a.x - pos(q).x, a.z - pos(q).z) - Math.hypot(b.x - pos(q).x, b.z - pos(q).z));
        const root = todo.shift()!;
        const loc = await locNear(q, root, /^root$/i, /^search$/i, 1);
        if (!loc) {
            await q.bot.walkTo(root.x, root.z, 3).catch(() => undefined);
            const again = await locNear(q, root, /^root$/i, /^search$/i, 1);
            if (!again) {
                q.log(`grandtree: no root at (${root.x},${root.z}) from ${where(q)}`);
                continue;
            }
        }
        const target = (await locNear(q, root, /^root$/i, /^search$/i, 1))!;
        const since = cursor(q);
        await q.sdk.sendInteractLoc(target.x, target.z, target.id, target.optionsWithIndex.find((o) => /^search$/i.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => held(q, OBJ.rock) || !!s.dialog?.isOpen || said(q, since, /search the root|anything interesting|turns out to be nothing|can't reach/i), 30);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
        if (said(q, since, /can't reach/i)) q.log(`grandtree: can't reach the root at (${root.x},${root.z})`);
    }
    if (!held(q, OBJ.rock)) throw new Error(`grandtree: no Daconia rock in any root (${tickNow(q.sdk) - t0}t)`);
    q.log(`grandtree: found the Daconia rock at ${where(q)} (${tickNow(q.sdk) - t0}t)`);
}

// ── getting out

/** Out of the roots (ladder up into the trunk), Glough's upstairs, the shipyard, the tree's top floors. */
/** Glough's cell: ^grandtree_jail_coord 3_38_54_32_40 = (2464,3496,L3); its door is one tile east (charlie.rs2). */
const JAIL = { x: 2464, z: 3496, level: 3 };
const inJail = (p: Tile) => (p.level ?? 0) === 3 && p.x === JAIL.x && p.z === JAIL.z;

/**
 * Out of Glough's cell. charlie.rs2 at found_journal: talking to Charlie from the cell brings Narnode,
 * who opens the door for ~7 ticks (loc_add prisondoor dur 7) — walk east through it at once. A run
 * restarted in the cell had every goTo fail with "could not reach L1" (jacklove16, 2026-11-04).
 */
export async function escapeJail(q: Quest): Promise<void> {
    for (let attempt = 1; attempt <= 4 && inJail(pos(q)); attempt++) {
        const charlie = q.sdk.findNearbyNpc(/^charlie$/i);
        let opened = false;
        if (charlie) {
            const r = await q.sdk.sendInteractNpc(charlie.index, 1, { route: false });
            opened = await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 12);
            if (!opened) {
                await q.sdk.sendTalkToNpc(charlie.index);
                opened = await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 12);
            }
            if (!opened) opened = (await q.talk(/^charlie$/i, []).catch(() => '')).length > 0;
            q.log(`grandtree: jail — Charlie #${charlie.index} at (${charlie.x},${charlie.z}) d${charlie.distance}, op ${r?.success ? 'sent' : r?.message}, dialog ${opened ? 'opened' : 'never opened'}`);
        } else {
            q.log(`grandtree: jail — no Charlie in view (npcs: ${(q.sdk.getNearbyNpcs() ?? []).map((n) => n.name).slice(0, 8).join(', ')})`);
        }
        const seen: string[] = [];
        // Charlie's lines, then Narnode's apology; the door opens as his dialog closes.
        for (let t = 0; t < 80 && inJail(pos(q)); t += 2) {
            if (q.sdk.getDialog()?.isOpen) seen.push(await driveDialog(q.sdk, [], { ticks: 4 }));
            else await q.sdk.sendWalk(JAIL.x + 2, JAIL.z).catch(() => undefined);
            await q.sdk.waitForTicks(2);
        }
        q.log(`grandtree: jail attempt ${attempt} — now at ${where(q)}; dialog: ${seen.join(' ').slice(-200) || '(none)'}`);
    }
    if (inJail(pos(q))) throw new Error(`grandtree: still in Glough's cell after 4 tries (Charlie's dialog did not free it)`);
}

export async function leaveGrandTreeArea(q: Quest): Promise<void> {
    if (inJail(pos(q))) await escapeJail(q);
    if (inShipyard(pos(q))) await leaveShipyard(q);
    if (inTreeRoots(pos(q))) {
        await q.bot.walkTo(LADDER_FROM_CELLAR.x + 1, LADDER_FROM_CELLAR.z, 2).catch(() => undefined);
        await op(q, LADDER_FROM_CELLAR, /ladder/i, /climb-up/i, () => !inTreeRoots(pos(q)), 'up the ladder from the roots', [], 15);
        q.log(`grandtree: up out of the roots to ${where(q)}`);
    }
    if (inGloughUpstairs(pos(q))) {
        if (pos(q).level === 2) await op(q, DOWN_TREE, /^tree$/i, /climb-down/i, () => pos(q).level === 1, 'down the tree in Glough\'s house');
        await op(q, GLOUGH_LADDER, /ladder/i, /climb-down/i, () => pos(q).level === 0, 'down Glough\'s ladder');
    }
    if (inTreeTop(pos(q))) await treeLevel(q, 1);
}
