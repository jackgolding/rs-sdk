/**
 * Nature Spirit — the route and mechanics (bots/quests/nature-spirit.ts is the definition).
 *
 * Content facts (quest_druidspirit/scripts/{quest_druidspirit,filliman,ghast,swamp_decay}.rs2,
 * area_mausoleum/scripts/{drezel,holy_barrier}.rs2; placements m53_52/53_54/53_152/53_154); route cross-checked with
 * rs-stun-toolkit's q-nature-spirit.ts spec:
 *   - Drezel (3440,9895) is under Paterdomus. From the west the way down is Priest in Peril's mausoleum trapdoor
 *     (3405,3507) -> ladder (3405,9907) -> the metal gates east. The holy barrier (loc 3443, 3440,9886, Priest in Peril
 *     at 61) telejumps to (3423,3485), across the Salve; the east trapdoor (3432, 3422,3485) drops back to (3440,9887).
 *     No walk crosses the river, so every trip goes under it.
 *   - Drezel at %priestperil 61 offers "Is there anything else interesting..." -> "Well, what is it..." -> "Yes, I'll go
 *     and look for him." -> "Yes, I'm sure." (5; 3 meat + 3 apple pies). At 60 the first talk only moves him to 61.
 *   - Mort Myre gate (3443/3444,3458) from the north (10). Filliman's camp (3434-3446,3331-3342) is an island: the
 *     Jump loc (3522) at (3440,3329) from the south / (3440,3331) from the north, an agility roll (a fall still crosses).
 *   - The washing bowl on the ground (3437,3337), taken, drops a Mirror. The grotto tree (3517, 3439,3338) Search: the
 *     Journal. The grotto door (3516, 3440,3337) op1 spawns Filliman's spirit (1050) at (3440,3336) for 100 ticks and
 *     talks: with the ghostspeak amulet worn, "How long have you been a ghost?" (20); the mirror on him (25); the
 *     journal on him, "How can I help?" -> Druidic spell (35). Drezel blesses (40).
 *   - The spell (opheld1) cast in the swamp blooms one log_druidicspirit (3508) in the 3x3 around you (45); Pick (op2)
 *     the bloomed log (3509): Mort Myre fungi (50). The fungus on the nature stone (3439,3336), the used spell on the
 *     spirit stone (3441,3336); then, standing ON the faith stone (3440,3335), "I think I've solved the puzzle!" to the
 *     spirit (60). The grotto door then teleports into the grotto (65); the grotto (3520, 3441,9740) op1: the
 *     transformation (70); again with a silver sickle: blessed sickle + empty druid pouch (75).
 *   - The blessed sickle's Cast Bloom (op3, 1-7 prayer) blooms logs, branches and pear bushes around you (80); pick
 *     three (85); the empty pouch's Fill (opheld1) takes three (90). A ghast (invisible) that attacks while the pouch
 *     has charges turns visible (ghast_vis 1053, Attack); three kills (95/100/105). The spirit in the grotto: complete.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const OBJ = {
    ghostspeak: 552,
    wolfbane: 2952,
    pouchEmpty: 2957,
    pouch: 2958,
    sickle: 2961,
    sickleBlessed: 2963,
    bowl: 2964,
    mirror: 2966,
    journal: 2967,
    spell: 2968,
    usedSpell: 2969,
    fungus: 2970,
    stem: 2972,
    pear: 2974,
} as const;
const LOC = {
    barrier: 3443,
    eastTrapdoor: 3432,
    gateR: 3507,
    gateL: 3506,
    jump: 3522,
    door: 3516,
    tree: 3517,
    natureStone: 3527,
    spiritStone: 3529,
    grotto: 3520,
    grottoExit: 3525,
    grottoExitGreen: 3526,
    log: 3508,
    logBloomed: 3509,
    branchBloomed: 3511,
    pearBloomed: 3513,
} as const;
const NPC = { spirit: 1050, ns: 1051, ghastInvis: 1052, ghastVis: 1053 };

const MAUSOLEUM_TRAPDOOR = { x: 3405, z: 3507 };
const MAUSOLEUM_LADDER = { x: 3405, z: 9907 };
const GATE_DREZEL = { x: 3431, z: 9897 };
const DREZEL = { x: 3440, z: 9894 };
const BARRIER = { x: 3440, z: 9886 };
const EAST_LANDING = { x: 3423, z: 3485 };
const EAST_TRAPDOOR = { x: 3422, z: 3485 };
const MYRE_GATE = { x: 3443, z: 3458 };
const MYRE_GATE_NORTH = { x: 3443, z: 3459 };
const JUMP_SOUTH = { x: 3440, z: 3328 };
const JUMP_S_LOC = { x: 3440, z: 3329 };
const JUMP_N_LOC = { x: 3440, z: 3331 };
const BOWL = { x: 3437, z: 3337 };
const TREE = { x: 3439, z: 3338 };
const DOOR = { x: 3440, z: 3337 };
const NATURE_STONE = { x: 3439, z: 3336 };
const SPIRIT_STONE = { x: 3441, z: 3336 };
const FAITH_STONE = { x: 3440, z: 3335 };
const GROTTO = { x: 3441, z: 9740 };
const GROTTO_EXIT = { x: 3442, z: 9733 };
/** The only log cardinal-south of this tile is (3439,3348): the spell always blooms it (spec FUNGUS_AT). */
const FUNGUS_AT = { x: 3439, z: 3349 };
/** A pear bush (3437,3348) cardinal-south: every sickle cast blooms it first (spec PEAR_AT). */
const PEAR_AT = { x: 3437, z: 3349 };
/** Open ground north of the camp where ghasts find you. */
const GHAST_GROUND = { x: 3438, z: 3352 };

const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
export const holds = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id);
const countId = (q: Quest, id: number) => q.sdk.getInventory().filter((i) => i.id === id).reduce((n, i) => n + (i.count ?? 1), 0);

export const inCamp = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 3434, 3446, 3331, 3342);
export const inGrotto = (p: Tile) => inBox(p, 3420, 3470, 9700, 9760);
/** Mort Myre south of its fence (spec inSwamp), the camp excluded. */
export const inSwamp = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 3392, 3519, 3290, 3457) && !inCamp(p);
/** Morytania's bank of the Salve between the barrier landing and the Mort Myre fence. */
const onEastBank = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 3419, 3519, 3458, 3520);
/** The mausoleum under Paterdomus. */
const inMausoleum = (p: Tile) => inBox(p, 3395, 3460, 9870, 9920);
export const inNatureSpiritArea = (p: Tile) => inCamp(p) || inGrotto(p) || inSwamp(p) || onEastBank(p) || inMausoleum(p);

/** Game messages since `t0`. */
const heard = (q: Quest, t0: number, re: RegExp) => (q.sdk.getState()?.gameMessages ?? []).some((m) => m.tick >= t0 && re.test(m.text));

async function locById(q: Quest, id: number, at: Tile, within = 3) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? []).filter((l) => l.id === id).sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= within ? loc : undefined;
}

/** Op `op` on loc `id` near `at` until `done`, driving any dialog with `choices`. */
async function opLoc(q: Quest, id: number, at: Tile, op: number, done: () => boolean, label: string, choices: RegExp[] = [], tries = 4, ticks = 15): Promise<void> {
    for (let attempt = 1; attempt <= tries && !done(); attempt++) {
        if (Math.hypot(pos(q).x - at.x, pos(q).z - at.z) > 8) await q.bot.walkTo(at.x, at.z, 2).catch(() => undefined);
        // The camp's Jump locs sit on bridge-flagged tiles (map level 1) and never show in the loc scan: op them blind.
        const loc = id === LOC.jump ? { x: at.x, z: at.z, id } : await locById(q, id, at);
        if (!loc) {
            q.log(`ns: ${label}: loc ${id} not in view near (${at.x},${at.z}) from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, op);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await converse(q, choices, [], done);
        await untilTicks(q.sdk, done, 4);
    }
    if (!done()) throw new Error(`ns: ${label} failed at ${where(q)}`);
}

async function useOnLoc(q: Quest, item: number, id: number, at: Tile, done: () => boolean, label: string): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const inv = q.sdk.getInventory().find((i) => i.id === item);
        if (!inv) throw new Error(`ns: ${label}: item ${item} not held`);
        const loc = await locById(q, id, at);
        if (!loc) {
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendUseItemOnLoc(inv.slot, loc.x, loc.z, loc.id);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 12);
        if (q.sdk.getDialog()?.isOpen) await converse(q, [], [], done);
    }
    if (!done()) throw new Error(`ns: ${label} failed at ${where(q)}`);
}

/**
 * Drive the open dialog: `once` patterns are each picked at most once, in order; then `end` (e.g. "Ok, thanks.")
 * closes a menu that keeps coming back. Continue pages are clicked through.
 */
async function converse(q: Quest, once: RegExp[], end: RegExp[] = [/^ok,? thanks/i], done?: () => boolean, ticks = 120): Promise<string> {
    const queue = [...once];
    const seen: string[] = [];
    const t0 = tickNow(q.sdk);
    while (tickNow(q.sdk) - t0 < ticks && !done?.()) {
        const d = q.sdk.getDialog();
        if (!d?.isOpen) {
            if (!(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, seen.length ? 5 : 8))) break;
            continue;
        }
        const options = d.options ?? [];
        const cont = options.find((o) => /click here to continue/i.test(o.text));
        if (cont || !options.length) {
            const text = (d.allComponents ?? []).map((c) => c.text).filter(Boolean).join(' ');
            if (text && seen[seen.length - 1] !== text) seen.push(text);
            await driveDialog(q.sdk, [], { ticks: 3, done: () => !!q.sdk.getDialog()?.options?.some((o) => !/click here to continue/i.test(o.text)) });
            continue;
        }
        let pick = queue.length ? options.find((o) => queue[0]!.test(o.text)) : undefined;
        if (pick) queue.shift();
        else pick = end.map((p) => options.find((o) => p.test(o.text))).find(Boolean);
        if (!pick) {
            q.log(`ns: dialog: no choice for ${JSON.stringify(options.map((o) => o.text))}`);
            break;
        }
        seen.push(`> ${pick.text}`);
        const before = JSON.stringify(options.map((o) => o.text));
        await q.sdk.sendClickDialog(pick.index);
        await untilTicks(q.sdk, () => JSON.stringify(q.sdk.getDialog()?.options?.map((o) => o.text) ?? []) !== before, 8);
    }
    return seen.join(' || ');
}

// ── getting about

/** Wear the ghostspeak amulet (Filliman's dialog needs it). */
export async function wearAmulet(q: Quest): Promise<void> {
    if (q.sdk.getEquipment().some((i) => i.id === OBJ.ghostspeak)) return;
    const a = q.sdk.getInventory().find((i) => i.id === OBJ.ghostspeak);
    if (!a) throw new Error('ns: no amulet of ghostspeak (The Restless Ghost) held');
    await q.bot.equipItem(a).catch(() => undefined);
    await untilTicks(q.sdk, () => q.sdk.getEquipment().some((i) => i.id === OBJ.ghostspeak), 5);
}

/** Out of the grotto. */
async function leaveGrotto(q: Quest): Promise<void> {
    if (!inGrotto(pos(q))) return;
    // After the quest the grotto is the altar's upper floor (L1, quest_druidspirit.rs2): its exit is the green door.
    const exit = pos(q).level === 1 ? LOC.grottoExitGreen : LOC.grottoExit;
    await opLoc(q, exit, GROTTO_EXIT, 1, () => !inGrotto(pos(q)), 'out of the grotto');
}

/** Out of the camp over the jump. */
async function leaveCamp(q: Quest): Promise<void> {
    await leaveGrotto(q);
    if (!inCamp(pos(q))) return;
    await opLoc(q, LOC.jump, JUMP_N_LOC, 1, () => !inCamp(pos(q)), 'jump out of the camp', [], 6, 12);
}

/** Out of the swamp by its gate, onto the east bank. */
async function leaveSwamp(q: Quest): Promise<void> {
    await leaveCamp(q);
    if (!inSwamp(pos(q))) return;
    await q.bot.walkTo(MYRE_GATE.x, MYRE_GATE.z - 1, 1).catch(() => undefined);
    await opLoc(q, LOC.gateR, MYRE_GATE, 1, () => !inSwamp(pos(q)), 'out through the Mort Myre gate', [], 5);
}

/** Under Paterdomus, beside Drezel, from wherever we are. */
async function toDrezel(q: Quest): Promise<void> {
    await leaveSwamp(q);
    if (onEastBank(pos(q))) {
        await q.bot.walkTo(EAST_TRAPDOOR.x + 1, EAST_TRAPDOOR.z, 1).catch(() => undefined);
        const down = () => inMausoleum(pos(q));
        for (let attempt = 1; attempt <= 4 && !down(); attempt++) {
            const trap = (await locById(q, LOC.eastTrapdoor, EAST_TRAPDOOR, 2)) ?? (await locById(q, LOC.eastTrapdoor + 1, EAST_TRAPDOOR, 2));
            if (!trap) {
                await q.sdk.waitForTicks(3);
                continue;
            }
            await q.sdk.sendInteractLoc(trap.x, trap.z, trap.id, 1);
            await untilTicks(q.sdk, down, 8);
        }
        if (!down()) throw new Error(`ns: the east trapdoor did not take us down (at ${where(q)})`);
    }
    if (!inMausoleum(pos(q))) {
        await q.goTo(MAUSOLEUM_TRAPDOOR, 2);
        for (let i = 0; i < 4 && !inMausoleum(pos(q)); i++) {
            await q.sdk.scanNearbyLocs(6).catch(() => undefined);
            const trap = q.sdk.findNearbyLoc(/trapdoor/i);
            if (!trap) throw new Error(`ns: no mausoleum trapdoor near ${where(q)}`);
            if (trap.options.some((o) => /^open$/i.test(o))) {
                await q.bot.interactLoc(trap, /^open$/i).catch(() => undefined);
                await q.sdk.waitForTicks(2);
                continue;
            }
            await q.bot.interactLoc(trap, /climb-down|climb down/i).catch(() => undefined);
            await untilTicks(q.sdk, () => inMausoleum(pos(q)), 10);
        }
        if (!inMausoleum(pos(q))) throw new Error('ns: could not climb down into the mausoleum');
    }
    for (const t of [GATE_DREZEL, DREZEL]) {
        for (let i = 0; i < 3 && Math.max(Math.abs(pos(q).x - t.x), Math.abs(pos(q).z - t.z)) > 2; i++) await q.bot.walkTo(t.x, t.z, 2).catch(() => undefined);
    }
}

/** Through the holy barrier onto Morytania's bank. */
async function toEastBank(q: Quest): Promise<void> {
    if (onEastBank(pos(q)) || inSwamp(pos(q)) || inCamp(pos(q)) || inGrotto(pos(q))) return;
    await toDrezel(q);
    await opLoc(q, LOC.barrier, BARRIER, 1, () => onEastBank(pos(q)), 'through the holy barrier');
}

/** Into Mort Myre by its gate. */
export async function intoSwamp(q: Quest): Promise<void> {
    if (inSwamp(pos(q)) || inCamp(pos(q))) return;
    await leaveGrotto(q);
    if (inSwamp(pos(q)) || inCamp(pos(q))) return;
    await toEastBank(q);
    await q.bot.walkTo(MYRE_GATE_NORTH.x, MYRE_GATE_NORTH.z, 1).catch(() => undefined);
    await opLoc(q, LOC.gateR, MYRE_GATE, 1, () => inSwamp(pos(q)), 'into Mort Myre', [], 5);
}

/** Into Filliman's camp over the jump. */
async function intoCamp(q: Quest): Promise<void> {
    if (inCamp(pos(q))) return;
    if (inGrotto(pos(q))) return void (await leaveGrotto(q));
    await intoSwamp(q);
    for (let i = 0; i < 3 && Math.hypot(pos(q).x - JUMP_SOUTH.x, pos(q).z - JUMP_SOUTH.z) > 1; i++) await q.bot.walkTo(JUMP_SOUTH.x, JUMP_SOUTH.z, 0).catch(() => undefined);
    await opLoc(q, LOC.jump, JUMP_S_LOC, 1, () => inCamp(pos(q)), 'jump into the camp', [], 6, 12);
}

/** Into the grotto (from stage 60 the door teleports you in). */
async function intoGrotto(q: Quest): Promise<void> {
    if (inGrotto(pos(q))) return;
    await intoCamp(q);
    await opLoc(q, LOC.door, DOOR, 1, () => inGrotto(pos(q)), 'into the grotto');
}

/** run-quest's goTo/prologue: out of the swamp and back under the river to the Varrock side. */
export async function leaveNatureSpirit(q: Quest): Promise<void> {
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    await leaveSwamp(q);
    if (onEastBank(pos(q))) await toDrezel(q);
    if (inMausoleum(pos(q))) {
        for (const t of [GATE_DREZEL, { x: MAUSOLEUM_LADDER.x, z: MAUSOLEUM_LADDER.z - 1 }]) {
            for (let i = 0; i < 3 && Math.max(Math.abs(pos(q).x - t.x), Math.abs(pos(q).z - t.z)) > 2; i++) await q.bot.walkTo(t.x, t.z, 1).catch(() => undefined);
        }
        for (let i = 0; i < 4 && inMausoleum(pos(q)); i++) {
            await q.sdk.scanNearbyLocs(6).catch(() => undefined);
            const ladder = q.sdk.findNearbyLoc(/ladder/i, { withOption: /climb-up/i });
            if (ladder) await q.bot.interactLoc(ladder, /climb-up/i).catch(() => undefined);
            await untilTicks(q.sdk, () => !inMausoleum(pos(q)), 10);
        }
        if (inMausoleum(pos(q))) throw new Error(`ns: could not climb out of the mausoleum (at ${where(q)})`);
    }
}

// ── the spirit

const spiritNpc = (q: Quest) => (q.sdk.getNearbyNpcs() ?? []).find((n) => n.id === NPC.spirit);

/** Op the grotto door: the spirit appears and talks. */
async function summonSpirit(q: Quest, once: RegExp[], end: RegExp[] = [/^ok,? thanks/i]): Promise<string> {
    await intoCamp(q);
    for (let attempt = 1; attempt <= 3; attempt++) {
        const door = await locById(q, LOC.door, DOOR, 2);
        if (door) await q.sdk.sendInteractLoc(door.x, door.z, door.id, 1);
        if (await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 15)) return converse(q, once, end);
    }
    throw new Error(`ns: the grotto door brought no spirit (at ${where(q)})`);
}

/** Use `item` on the spirit (summoned first if gone), then drive the dialog. */
async function useOnSpirit(q: Quest, item: number, once: RegExp[], done: () => boolean, label: string): Promise<void> {
    for (let attempt = 1; attempt <= 3 && !done(); attempt++) {
        if (!spiritNpc(q)) await summonSpirit(q, []);
        const npc = spiritNpc(q);
        const inv = q.sdk.getInventory().find((i) => i.id === item);
        if (!npc || !inv) throw new Error(`ns: ${label}: ${!npc ? 'no spirit' : `item ${item} not held`}`);
        await q.sdk.sendUseItemOnNpc(inv.slot, npc.index);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 12);
        await converse(q, once, [/^ok,? thanks/i], done);
        await untilTicks(q.sdk, done, 5);
    }
    if (!done()) throw new Error(`ns: ${label} failed`);
}

/** Drezel: the quest from him (5). */
export async function start(q: Quest, started: () => Promise<boolean>): Promise<void> {
    await toDrezel(q);
    for (let attempt = 1; attempt <= 3 && !(await started()); attempt++) {
        await q.talk(/^drezel$/i, []);
        await converse(q, [/anything else interesting/i, /well, what is it/i, /yes, i'll go and look for him/i, /yes, i'm sure/i], []);
    }
}

/** Mirror, journal, then the spirit: "How long have you been a ghost?" (20). */
export async function meetSpirit(q: Quest): Promise<void> {
    await wearAmulet(q);
    await intoCamp(q);
    for (let i = 0; i < 4 && !holds(q, OBJ.mirror); i++) {
        if (!holds(q, OBJ.bowl)) {
            const bowl = (q.sdk.getState()?.groundItems ?? []).find((g) => g.id === OBJ.bowl);
            if (bowl) await q.bot.pickupItem(bowl).catch(() => undefined);
            await untilTicks(q.sdk, () => holds(q, OBJ.bowl), 8);
        }
        await untilTicks(q.sdk, () => (q.sdk.getState()?.groundItems ?? []).some((g) => g.id === OBJ.mirror), 4);
        const mirror = (q.sdk.getState()?.groundItems ?? []).find((g) => g.id === OBJ.mirror);
        if (mirror) await q.bot.pickupItem(mirror).catch(() => undefined);
        await untilTicks(q.sdk, () => holds(q, OBJ.mirror), 6);
    }
    if (!holds(q, OBJ.mirror)) throw new Error('ns: no mirror under the washing bowl');
    if (!holds(q, OBJ.journal)) await opLoc(q, LOC.tree, TREE, 2, () => holds(q, OBJ.journal), 'search the grotto tree for the journal');
    await summonSpirit(q, [/how long have you been a ghost/i]);
}

/** The mirror (25), then the journal and "How can I help?": the Druidic spell (35). */
export async function convinceSpirit(q: Quest, mirrorShown: () => Promise<boolean>): Promise<void> {
    await wearAmulet(q);
    await intoCamp(q);
    for (let attempt = 1; attempt <= 3 && !(await mirrorShown()); attempt++) {
        const t0 = tickNow(q.sdk);
        // The stage moves after the mirror's last page (filliman.rs2): let the dialog run out.
        await useOnSpirit(q, OBJ.mirror, [], () => tickNow(q.sdk) - t0 > 4 && !q.sdk.getDialog()?.isOpen, 'the mirror on the spirit');
    }
    await useOnSpirit(q, OBJ.journal, [/how can i help/i], () => holds(q, OBJ.spell) && !q.sdk.getDialog()?.isOpen, 'the journal on the spirit');
}

/** Drezel's blessing (40). */
export async function bless(q: Quest, blessed: () => Promise<boolean>): Promise<void> {
    await toDrezel(q);
    for (let attempt = 1; attempt <= 3 && !(await blessed()); attempt++) {
        await q.talk(/^drezel$/i, []);
        await converse(q, [], []);
        await q.sdk.waitForTicks(3);
    }
}

/** Cast the Druidic spell beside the log north of the camp and pick the fungus (50). */
export async function fungus(q: Quest): Promise<void> {
    if (holds(q, OBJ.fungus)) return;
    await leaveCamp(q);
    await intoSwamp(q);
    for (let i = 0; i < 3 && (pos(q).x !== FUNGUS_AT.x || pos(q).z !== FUNGUS_AT.z); i++) await q.bot.walkTo(FUNGUS_AT.x, FUNGUS_AT.z, 0).catch(() => undefined);
    for (let attempt = 1; attempt <= 4 && !holds(q, OBJ.fungus); attempt++) {
        let bloomed = await locById(q, LOC.logBloomed, FUNGUS_AT, 2);
        if (!bloomed) {
            const spell = q.sdk.getInventory().find((i) => i.id === OBJ.spell);
            if (!spell) throw new Error(`ns: no unused Druidic spell to cast (carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
            await q.sdk.sendUseItem(spell.slot, 1);
            await untilTicks(q.sdk, () => !holds(q, OBJ.spell), 8);
            bloomed = await locById(q, LOC.logBloomed, FUNGUS_AT, 2);
        }
        if (!bloomed) continue;
        await q.sdk.sendInteractLoc(bloomed.x, bloomed.z, bloomed.id, 2);
        await untilTicks(q.sdk, () => holds(q, OBJ.fungus), 8);
    }
    if (!holds(q, OBJ.fungus)) throw new Error(`ns: no Mort Myre fungi (at ${where(q)})`);
}

/** The fungus and the used spell on their stones, then the puzzle from the faith stone (60). */
export async function ritual(q: Quest, done: () => Promise<boolean>): Promise<void> {
    await wearAmulet(q);
    await intoCamp(q);
    if (holds(q, OBJ.fungus)) {
        await q.bot.walkTo(NATURE_STONE.x, NATURE_STONE.z - 1, 0).catch(() => undefined);
        await useOnLoc(q, OBJ.fungus, LOC.natureStone, NATURE_STONE, () => !holds(q, OBJ.fungus), 'the fungus on the nature stone');
    }
    const scroll = holds(q, OBJ.usedSpell) ? OBJ.usedSpell : holds(q, OBJ.spell) ? OBJ.spell : 0;
    if (scroll) {
        await q.bot.walkTo(SPIRIT_STONE.x, SPIRIT_STONE.z - 1, 0).catch(() => undefined);
        await useOnLoc(q, scroll, LOC.spiritStone, SPIRIT_STONE, () => !holds(q, scroll), 'the spell on the spirit stone');
    }
    // The spirit (stage 50 -> 55 on the first talk), then from ON the faith stone the puzzle answer.
    await summonSpirit(q, []);
    for (let attempt = 1; attempt <= 4 && !(await done()); attempt++) {
        for (let i = 0; i < 3 && (pos(q).x !== FAITH_STONE.x || pos(q).z !== FAITH_STONE.z); i++) await q.bot.walkTo(FAITH_STONE.x, FAITH_STONE.z, 0).catch(() => undefined);
        if (!spiritNpc(q)) {
            await summonSpirit(q, []);
            continue;
        }
        await q.sdk.sendInteractNpc(spiritNpc(q)!.index, 1, { route: false });
        if (!(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 8))) continue;
        const seen = await converse(q, [/i think i've solved the puzzle/i], [/^ok,? thanks/i]);
        q.log(`ns: puzzle from ${where(q)}: ${seen.slice(-160)}`);
    }
}

/** Into the grotto (65), the transformation (70), the silver sickle blessed and the pouch (75). */
export async function grotto(q: Quest, stage: () => Promise<string>): Promise<void> {
    await wearAmulet(q);
    await intoGrotto(q);
    for (let attempt = 1; attempt <= 4 && !holds(q, OBJ.sickleBlessed); attempt++) {
        const now = await stage();
        if (now === 'transform' && !holds(q, OBJ.sickle)) throw new Error('ns: Filliman wants a silver sickle (none held)');
        const g = await locById(q, LOC.grotto, GROTTO, 4);
        if (!g) throw new Error(`ns: no grotto loc in view (at ${where(q)})`);
        await q.sdk.sendInteractLoc(g.x, g.z, g.id, 1);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 15);
        await converse(q, [], [/^ok,? thanks/i], () => holds(q, OBJ.sickleBlessed) && !q.sdk.getDialog()?.isOpen);
        await q.sdk.waitForTicks(3);
    }
    if (!holds(q, OBJ.sickleBlessed)) throw new Error('ns: the nature spirit did not bless the sickle');
    await grottoPouch(q);
}

/**
 * An empty druid pouch lies on the grotto floor (m53_152 OBJ spawn at 3443,9741): the spirit's own is handed out only
 * once, so a lost one is replaced from there.
 */
async function grottoPouch(q: Quest): Promise<void> {
    if (holds(q, OBJ.pouchEmpty) || holds(q, OBJ.pouch)) return;
    await intoGrotto(q);
    for (let attempt = 1; attempt <= 3 && !holds(q, OBJ.pouchEmpty); attempt++) {
        const g = (q.sdk.getState()?.groundItems ?? []).find((i) => i.id === OBJ.pouchEmpty);
        if (!g) {
            await q.bot.walkTo(3443, 9741, 1).catch(() => undefined);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.bot.pickupItem(g).catch(() => undefined);
        await untilTicks(q.sdk, () => holds(q, OBJ.pouchEmpty), 8);
    }
    if (!holds(q, OBJ.pouchEmpty)) throw new Error('ns: no empty druid pouch (the grotto floor has none)');
}

const bloomedHarvest = (q: Quest) => countId(q, OBJ.pear) + countId(q, OBJ.stem) + countId(q, OBJ.fungus);

/** Bloom with the blessed sickle by the pear bush, pick three, fill the pouch (90). */
export async function fillPouch(q: Quest): Promise<void> {
    if (holds(q, OBJ.pouch)) return;
    await grottoPouch(q);
    await leaveCamp(q);
    await intoSwamp(q);
    for (let i = 0; i < 3 && (pos(q).x !== PEAR_AT.x || pos(q).z !== PEAR_AT.z); i++) await q.bot.walkTo(PEAR_AT.x, PEAR_AT.z, 0).catch(() => undefined);
    const t0 = tickNow(q.sdk);
    while (bloomedHarvest(q) < 3 && tickNow(q.sdk) - t0 < 400) {
        await q.sdk.scanNearbyLocs(3).catch(() => undefined);
        const ripe = (q.sdk.getNearbyLocs() ?? [])
            .filter((l) => [LOC.pearBloomed, LOC.branchBloomed, LOC.logBloomed].includes(l.id as 3513) && Math.max(Math.abs(l.x - pos(q).x), Math.abs(l.z - pos(q).z)) <= 1)
            .sort((a, b) => (a.distance ?? 9) - (b.distance ?? 9))[0];
        if (ripe) {
            const before = bloomedHarvest(q);
            await q.sdk.sendInteractLoc(ripe.x, ripe.z, ripe.id, 2);
            await untilTicks(q.sdk, () => bloomedHarvest(q) > before, 8);
            // Picking can step us off the tile: back onto it for the next cast.
            if (pos(q).x !== PEAR_AT.x || pos(q).z !== PEAR_AT.z) await q.bot.walkTo(PEAR_AT.x, PEAR_AT.z, 0).catch(() => undefined);
            continue;
        }
        if ((q.sdk.getSkill('prayer')?.level ?? 0) <= 0) throw new Error('ns: out of prayer points for the sickle');
        const sickle = q.sdk.getInventory().find((i) => i.id === OBJ.sickleBlessed);
        if (!sickle) throw new Error('ns: no blessed sickle in the pack');
        await q.sdk.sendUseItem(sickle.slot, 3);
        await q.sdk.waitForTicks(3);
    }
    if (bloomedHarvest(q) < 3) throw new Error(`ns: only ${bloomedHarvest(q)} bloomed items in ${tickNow(q.sdk) - t0}t`);
    const pouch = q.sdk.getInventory().find((i) => i.id === OBJ.pouchEmpty);
    if (!pouch) throw new Error('ns: no empty druid pouch');
    await q.sdk.sendUseItem(pouch.slot, 1);
    await untilTicks(q.sdk, () => holds(q, OBJ.pouch), 8);
    if (!holds(q, OBJ.pouch)) throw new Error('ns: the pouch did not fill');
    q.log(`ns: druid pouch filled (${countId(q, OBJ.pouch)} charges)`);
}

const FOOD = /^(shark|manta ray|monkfish|swordfish|lobster|meat pie|apple pie)$/i;
async function eatIfLow(q: Quest): Promise<void> {
    const p = q.sdk.getState()?.player;
    if (!p || p.hp > (p.maxHp ?? 10) * 0.5) return;
    const food = q.sdk.getInventory().find((i) => FOOD.test(i.name));
    if (food) await q.bot.eatFood(food).catch(() => undefined);
}

/** Three ghasts: the pouch shows one that attacks (or that the pouch is used on), then kill it (105). */
export async function ghasts(q: Quest, killed: () => Promise<number>): Promise<void> {
    await leaveCamp(q);
    await intoSwamp(q);
    const weapon = q.sdk.getInventory().find((i) => /scimitar|longsword|sword|whip|battleaxe|mace/i.test(i.name));
    if (weapon) await q.bot.equipItem(weapon).catch(() => undefined);
    const t0 = tickNow(q.sdk);
    let kills = await killed();
    const msg0 = t0;
    const killsHeard = () => (heard(q, msg0, /all three ghasts/i) ? 3 : heard(q, msg0, /that's two ghasts/i) ? 2 : heard(q, msg0, /that's one ghast/i) ? 1 : 0);
    let lastPouch = -99;
    while (kills < 3 && tickNow(q.sdk) - t0 < 1500) {
        await eatIfLow(q);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 4 });
        const npcs = q.sdk.getNearbyNpcs() ?? [];
        const vis = npcs.filter((n) => n.id === NPC.ghastVis).sort((a, b) => a.distance - b.distance)[0];
        if (vis) {
            await q.bot.attack(vis).catch(() => undefined);
            await untilTicks(q.sdk, () => !(q.sdk.getNearbyNpcs() ?? []).some((n) => n.index === vis.index && n.id === NPC.ghastVis), 25);
        } else {
            const inv = npcs.filter((n) => n.id === NPC.ghastInvis).sort((a, b) => a.distance - b.distance)[0];
            const pouch = q.sdk.getInventory().find((i) => i.id === OBJ.pouch);
            if (!pouch) throw new Error(`ns: the druid pouch is empty with ${kills}/3 ghasts`);
            if (inv && tickNow(q.sdk) - lastPouch >= 6) {
                await q.sdk.sendUseItemOnNpc(pouch.slot, inv.index);
                lastPouch = tickNow(q.sdk);
                await untilTicks(q.sdk, () => (q.sdk.getNearbyNpcs() ?? []).some((n) => n.id === NPC.ghastVis), 10);
            } else if (!inv) {
                await q.bot.walkTo(GHAST_GROUND.x + Math.round(Math.random() * 6 - 3), GHAST_GROUND.z + Math.round(Math.random() * 6 - 3), 1).catch(() => undefined);
                await q.sdk.waitForTicks(3);
            } else await q.sdk.waitForTicks(2);
        }
        kills = Math.max(kills, killsHeard());
    }
    if (kills < 3) throw new Error(`ns: ${kills}/3 ghasts in ${tickNow(q.sdk) - t0}t`);
    q.log(`ns: three ghasts in ${tickNow(q.sdk) - t0}t`);
}

/** Tell the nature spirit: quest complete. */
export async function finish(q: Quest, done: () => Promise<boolean>): Promise<void> {
    await wearAmulet(q);
    await intoGrotto(q);
    for (let attempt = 1; attempt <= 3 && !(await done()); attempt++) {
        const g = await locById(q, LOC.grotto, GROTTO, 4);
        if (g) await q.sdk.sendInteractLoc(g.x, g.z, g.id, 1);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 15);
        await converse(q, [], [/^ok,? thanks/i]);
        await q.sdk.waitForTicks(6);
    }
    // The finale lifts you to the grotto's L1, where run-quest's climbTo finds no stairs: out by its door.
    if (await done()) await leaveGrotto(q);
}
