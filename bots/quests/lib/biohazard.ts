/**
 * Biohazard — Elena's distillator, over the West Ardougne wall, and her samples to Varrock.
 *
 * Content facts (quest_biohazard/scripts/*.rs2, areas/area_ardougne_{east,west}/scripts/
 * {elena,king_lathas,omart,kilron,nurse_sarah,mourner,doors}.rs2, area_varrock/scripts/
 * east_gate.rs2; npc/loc/obj ids from pack/*.pack; spawns from maps m39_51, m39_52,
 * m40_51, m45_50, m51_53):
 *   - Elena (2592,3336) starts it (-> 1). Jerico (2612,3324) -> 2. His cupboard (2611,3326,
 *     Open then Search) hands one bird feed from stage 2 when none is held or banked. Bird
 *     feed on the watch tower (locs 2559-2563,3301-3306, east of the wall) -> 3. The pigeon
 *     cages (obj 424, "Pigeon cage", the empty one 425 shares the name) spawn behind his house
 *     (2618,3323-3325); Open one inside x 2559-2565 z 3299-3307 at stage 3 -> 4.
 *   - Omart (2559,3266, east of the wall) at 4 calls Kilron and the rope ladder drops you at
 *     (2556,3267) in West Ardougne (-> 5); he does it again at 5-7. Biohazard fills in the
 *     Plague City tunnel (mud_patch.rs2: "packed hard" from stage 1), so Omart is the only
 *     way in; out is the manhole and the mud pile as before (lib/plague-city.ts).
 *   - Rotten apples (obj 1984) spawn at (2535,3333); one in the mourners' cauldron (2543,3332)
 *     at 5 -> 6. The nurse's cupboard (2517,3276) holds a doctors' gown (obj 430) from 6 when
 *     none is owned. Worn, the HQ's door (2551,3320) lets you in ("In you go doc"); spiral
 *     stairs (2542,3324) to L1; the door (2547,3325,L1) east only with the gown worn. The
 *     mourners upstairs (mournerstew2, lvl 13, 19hp, 2551,3324/3327 L1) are the key's
 *     holders: kill one -> "You search the mourner... and find a key." (obj 423). The key on
 *     the gate (2551,3325-3326,L1); the crate (2554,3327,L1) holds the distillator (-> 7).
 *     THE ONE FIGHT OF THE QUEST: not aggressive, not avoidable.
 *   - Elena takes the distillator (-> 10) and hands liquid honey, ethenea, sulphuric broline
 *     and the plague sample, one per free slot. At 10/12 "I'm afraid I've lost some of the
 *     stuff" replaces any that are gone.
 *   - The chemist (2934,3210, Rimmington): "It's ok, I'm Elena's friend" -> "...touch paper for
 *     a guy called Guidor" -> 12 + touch paper (the first choice takes the sample: never).
 *     His errand boys outside (2931-2935,3219) each carry one vial: Hops the sulphuric
 *     broline, Chancy the liquid honey, DeVinci the ethenea (any other vial is lost). They
 *     hand them back in the Dancing Donkey (3268-3274,3389-3391, south-east Varrock). The
 *     guard at the members' gate (3264,3405) takes any vial carried through it at 10-13.
 *   - Guidor's door (3282,3382) opens at 12 with a priest gown top AND bottom worn (both are
 *     named "Priest gown": objs 426 and 428, Thessalia's in Varrock). Guidor (3285,3381) ->
 *     14. Elena -> 15. King Lathas (2578,3293,L1, Ardougne castle) "I don't understand..." ->
 *     complete.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';
import { dialogText, findLoc, holds, inWestArdougne, leavePlagueCity, op, pickUp, pos, useOn, wearing, where } from './plague-city';

/** Obj ids (pack/obj.pack). Several share names: both pigeon cages, both priest gowns. */
export const OBJ = {
    ethenea: 415,
    liquidHoney: 416,
    sulphuricBroline: 417,
    plagueSample: 418,
    touchPaper: 419,
    distillator: 420,
    birdFeed: 422,
    key: 423,
    pigeons: 424,
    emptyCage: 425,
    priestGown: 426,
    priestRobe: 428,
    doctorsGown: 430,
    rottenApples: 1984,
} as const;

export const ELENA = { x: 2592, z: 3336 };
export const JERICO = { x: 2612, z: 3324 };
const JERICO_CUPBOARD = { x: 2611, z: 3326 };
const PIGEON_CAGES = [
    { x: 2618, z: 3324 },
    { x: 2618, z: 3323 },
    { x: 2618, z: 3325 },
];
const WATCH_TOWER = { x: 2561, z: 3301 };
/** Inside the pigeons' zone (x 2559-2565, z 3299-3307), south-east of the tower. */
const PIGEON_SPOT = { x: 2564, z: 3300 };
export const OMART = { x: 2559, z: 3266 };
const ROTTEN_APPLES = { x: 2535, z: 3333 };
const CAULDRON = { x: 2543, z: 3332 };
/** The yard's west railing has a Climb-over fence (general_use/scripts/fence.rs2); outside it, west. */
const STEW_FENCE = { x: 2541, z: 3331 };
const NURSE_CUPBOARD = { x: 2517, z: 3276 };
const HQ_DOOR = { x: 2551, z: 3320 };
/** South of the HQ's door, outside. */
const HQ_PORCH = { x: 2551, z: 3319 };
const HQ_STAIRS = { x: 2542, z: 3324 };
const HQ_INNER_DOOR = { x: 2546, z: 3325 };
const HQ_UP_DOOR = { x: 2547, z: 3325 };
const HQ_GATE = { x: 2551, z: 3325 };
const CRATE = { x: 2554, z: 3327 };
export const CHEMIST = { x: 2934, z: 3210 };
/** Outside the chemist's, among his errand boys (2931-2935,3219). */
export const ERRAND_BOYS = { x: 2933, z: 3218 };
/** The Dancing Donkey, south-east Varrock. */
export const DANCING_DONKEY = { x: 3271, z: 3390 };
const GUIDOR_DOOR = { x: 3282, z: 3382 };
/** West of Guidor's door, by his wife. */
const GUIDOR_HALL = { x: 3281, z: 3382 };
export const GUIDOR = { x: 3285, z: 3381 };
const CASTLE_STAIRS = { x: 2573, z: 3295 };
export const LATHAS = { x: 2578, z: 3293, level: 1 };

const inBox = (p: { x: number; z: number }, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
const inPigeonZone = (q: Quest) => pos(q).level === 0 && inBox(pos(q), 2559, 2565, 3299, 3307);
/** The mourners' HQ, both floors. */
const inHq = (q: Quest) => inBox(pos(q), 2540, 2557, 3321, 3327);
/** The stew yard north of the HQ (railings round x 2542-2550, z 3329-3333). */
const inStewYard = (q: Quest) => pos(q).level === 0 && inBox(pos(q), 2542, 2550, 3329, 3333);

const has = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id);
const slotOf = (q: Quest, id: number) => q.sdk.getInventory().find((i) => i.id === id);

// ── food: the HQ fight

/** Whatever the account carries that can be eaten. */
async function eatIfLow(q: Quest, below = 0.5): Promise<boolean> {
    const p = q.sdk.getState()?.player;
    if (!p || p.hp > (p.maxHp ?? 99) * below) return false;
    const food = q.sdk.getInventory().find((i) => i.optionsWithIndex.some((o) => /^eat$/i.test(o.text)));
    if (!food) return false;
    await q.bot.eatFood(food).catch(() => undefined);
    return true;
}

/**
 * Talk to an npc indoors: when the client cannot route to it (a shut house door — Jerico's,
 * 2026-11-01), open the closed door nearest the npc and try again.
 */
export async function talkIndoors(q: Quest, npc: RegExp, choices: Array<RegExp | string>, at: { x: number; z: number; level?: number }): Promise<string> {
    await q.goTo(at, 4);
    for (let d = 0; d < 3; d++) {
        const target = q.sdk.findNearbyNpc(npc);
        if (!target || target.reachable !== false) break;
        await q.sdk.scanNearbyLocs(12).catch(() => undefined);
        const door = (q.sdk.getNearbyLocs() ?? [])
            .filter((l) => /^(door|gate)$/i.test(l.name) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)) && l.reachable !== false)
            .sort((a, b) => Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z))[0];
        if (!door || Math.hypot(door.x - target.x, door.z - target.z) > 10) break;
        q.log(`biohazard: opening ${door.name} at (${door.x},${door.z}) toward ${target.name}`);
        await q.bot.openDoor(door).catch(() => undefined);
        await q.sdk.waitForTicks(2);
    }
    return q.talk(npc, choices);
}

// ── stage 2 -> 3 -> 4: bird feed on the tower, pigeons in the air

/** Jerico's cupboard: one bird feed from stage 2 (none held or banked). */
async function getBirdFeed(q: Quest): Promise<void> {
    if (has(q, OBJ.birdFeed)) return;
    await q.goTo({ x: JERICO_CUPBOARD.x + 1, z: JERICO_CUPBOARD.z }, 1);
    await q.reach(/^cupboard$/i).catch(() => undefined);
    const shut = await findLoc(q, JERICO_CUPBOARD, /^cupboard$/i, /^open$/i);
    if (shut) await op(q, JERICO_CUPBOARD, /^cupboard$/i, /^open$/i, () => !!q.sdk.findNearbyLoc(/^cupboard$/i, { withOption: /^search$/i }), "open Jerico's cupboard", [], 10).catch(() => undefined);
    await op(q, JERICO_CUPBOARD, /^cupboard$/i, /^search$/i, () => has(q, OBJ.birdFeed), "search Jerico's cupboard", [], 15);
    await driveDialog(q.sdk, [], { ticks: 6 });
    q.log('biohazard: took bird feed from Jerico\'s cupboard');
}

/** A full pigeon cage from behind Jerico's house. */
async function getPigeons(q: Quest): Promise<void> {
    if (has(q, OBJ.pigeons)) return;
    let last: unknown;
    for (const tile of PIGEON_CAGES) {
        try {
            await pickUp(q, tile, OBJ.pigeons, 'pigeon cage');
            return;
        } catch (e) {
            last = e;
        }
    }
    throw last instanceof Error ? last : new Error('biohazard: no pigeon cage');
}

export async function feedTower(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    await getBirdFeed(q);
    // The pigeons are on the way: take them now so the next stage starts at the tower.
    await getPigeons(q).catch((e) => q.log(`biohazard: ${(e as Error).message} — after the feed`));
    await q.goTo(PIGEON_SPOT, 2);
    await useOn(q, OBJ.birdFeed, WATCH_TOWER, /^watch ?tower$/i, () => !has(q, OBJ.birdFeed), 'bird feed on the watch tower', 20);
    q.log(`biohazard: fed the watch tower in ${tickNow(q.sdk) - t0}t`);
}

export async function releasePigeons(q: Quest): Promise<void> {
    await getPigeons(q);
    if (!inPigeonZone(q)) await q.goTo(PIGEON_SPOT, 1);
    if (!inPigeonZone(q)) throw new Error(`biohazard: not by the watch tower ${where(q)}`);
    for (let attempt = 1; attempt <= 3 && has(q, OBJ.pigeons); attempt++) {
        const cage = slotOf(q, OBJ.pigeons)!;
        await q.sdk.sendUseItem(cage.slot, 1);
        await untilTicks(q.sdk, () => !has(q, OBJ.pigeons), 10);
    }
    if (has(q, OBJ.pigeons)) throw new Error('biohazard: the pigeons would not leave the cage');
    q.log('biohazard: released the pigeons');
}

// ── over the wall (stages 4-7)

/** Omart's rope ladder into West Ardougne: stage 4 calls Kilron, 5-7 "Ok, lets do it.". */
export async function enterWestArdougne(q: Quest): Promise<void> {
    if (inWestArdougne(pos(q)) && pos(q).level === 0) return;
    if (inWestArdougne(pos(q))) return void (await q.climbTo(0));
    const t0 = tickNow(q.sdk);
    for (let attempt = 1; attempt <= 3 && !inWestArdougne(pos(q)); attempt++) {
        const seen = await q.talk(/^omart$/i, [/ok, lets do it/i], OMART);
        if (!(await untilTicks(q.sdk, () => inWestArdougne(pos(q)), 10))) q.log(`biohazard: Omart (attempt ${attempt}): ${seen.slice(-140)}`);
        await driveDialog(q.sdk, [], { ticks: 6 });
    }
    if (!inWestArdougne(pos(q))) throw new Error(`biohazard: Omart's ladder did not take us over the wall ${where(q)}`);
    q.log(`biohazard: over the wall at ${where(q)} in ${tickNow(q.sdk) - t0}t`);
}

// ── stage 5 -> 6: the stew

export async function poisonStew(q: Quest): Promise<void> {
    await enterWestArdougne(q);
    if (!has(q, OBJ.rottenApples)) await pickUp(q, ROTTEN_APPLES, OBJ.rottenApples, 'rotten apples');
    // The cauldron stands in the yard behind the HQ: over its west fence and back.
    if (!inStewYard(q)) {
        await q.goTo(STEW_FENCE, 1);
        await op(q, STEW_FENCE, /^fence$/i, /^climb-over$/i, () => inStewYard(q), 'over the stew yard fence', [], 10);
    }
    let seen = '';
    await useOn(q, OBJ.rottenApples, CAULDRON, /^cauldron$/i, () => !has(q, OBJ.rottenApples), 'rotten apples in the cauldron', 20);
    seen = dialogText(q) + (await driveDialog(q.sdk, [], { ticks: 8 }));
    q.log(`biohazard: rotten apples in the stew ${seen.slice(0, 80)}`);
    await leaveStewYard(q);
}

/** Back over the yard's fence: walkTo has no way out of it. */
async function leaveStewYard(q: Quest): Promise<void> {
    if (!inStewYard(q)) return;
    await q.goTo({ x: STEW_FENCE.x + 1, z: STEW_FENCE.z }, 0).catch(() => undefined);
    await op(q, STEW_FENCE, /^fence$/i, /^climb-over$/i, () => !inStewYard(q), 'back over the stew yard fence', [], 10);
}

// ── stage 6 -> 7: the gown, the HQ, the key, the crate

/** The nurse's cupboard: a doctors' gown from stage 6 (none owned). */
async function getDoctorsGown(q: Quest): Promise<void> {
    if (holds(q, OBJ.doctorsGown)) return;
    await q.goTo({ x: NURSE_CUPBOARD.x + 1, z: NURSE_CUPBOARD.z }, 1);
    await q.reach(/^cupboard$/i).catch(() => undefined);
    const shut = await findLoc(q, NURSE_CUPBOARD, /^cupboard$/i, /^open$/i);
    if (shut) await op(q, NURSE_CUPBOARD, /^cupboard$/i, /^open$/i, () => !!q.sdk.findNearbyLoc(/^cupboard$/i, { withOption: /^search$/i }), "open the nurse's cupboard", [], 10).catch(() => undefined);
    await op(q, NURSE_CUPBOARD, /^cupboard$/i, /^search$/i, () => holds(q, OBJ.doctorsGown), "search the nurse's cupboard", [], 15);
    q.log("biohazard: took the doctors' gown from the nurse's cupboard");
}

async function wear(q: Quest, id: number, label: string): Promise<void> {
    if (wearing(q, id)) return;
    const item = slotOf(q, id);
    if (!item) throw new Error(`biohazard: no ${label} to wear`);
    await q.bot.equipItem(item);
    if (!(await untilTicks(q.sdk, () => wearing(q, id), 6))) throw new Error(`biohazard: the ${label} did not go on`);
}

/** Into the HQ by its front door, gown worn ("In you go doc."). */
async function enterHq(q: Quest): Promise<void> {
    if (inHq(q)) return;
    await q.goTo(HQ_PORCH, 1);
    await op(q, HQ_DOOR, /^door$/i, /^open$/i, () => inHq(q), "into the mourners' HQ", [], 15);
}

/** Kill an upstairs mourner for the gate key ("You search the mourner... and find a key."). */
async function mournerKey(q: Quest): Promise<void> {
    if (has(q, OBJ.key)) return;
    const t0 = tickNow(q.sdk);
    const mourner = () =>
        (q.sdk.getNearbyNpcs() ?? [])
            .filter((n) => /^mourner$/i.test(n.name) && (n.hp ?? 1) > 0 && n.reachable !== false && (!n.inCombat || n.targetIndex >= 0))
            .sort((a, b) => a.distance - b.distance)[0];
    let attacks = 0;
    let fought: number | null = null;
    while (!has(q, OBJ.key) && tickNow(q.sdk) - t0 < 600) {
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 6 });
        await eatIfLow(q);
        const me = q.sdk.getState()?.player;
        if (me && me.hp <= (me.maxHp ?? 10) * 0.25 && !q.sdk.getInventory().some((i) => i.optionsWithIndex.some((o) => /^eat$/i.test(o.text)))) {
            throw new Error(`biohazard: hp ${me.hp}/${me.maxHp} and no food in the HQ fight — stopping before the mourner kills us`);
        }
        const target = fought !== null ? (q.sdk.getNearbyNpcs() ?? []).find((n) => n.index === fought && (n.hp ?? 1) > 0) : mourner();
        if (!target) {
            // Dead: the key arrives from a queue after its death.
            if (fought !== null && (await untilTicks(q.sdk, () => has(q, OBJ.key), 6))) break;
            fought = null;
            if (!(await untilTicks(q.sdk, () => !!mourner(), 20))) throw new Error(`biohazard: no mourner upstairs ${where(q)}`);
            continue;
        }
        fought = target.index;
        if (!me?.combat?.inCombat || me.combat.targetIndex !== target.index) {
            attacks++;
            const res = await q.bot.attack(target, 10_000).catch((e) => ({ success: false, message: (e as Error).message }));
            if (!res.success) q.log(`biohazard: attack #${attacks}: ${res.message}`);
        }
        await q.sdk.waitForTicks(2);
    }
    if (!has(q, OBJ.key)) throw new Error(`biohazard: no key after ${attacks} attacks (${tickNow(q.sdk) - t0}t)`);
    q.log(`biohazard: killed a mourner for the key in ${tickNow(q.sdk) - t0}t (${attacks} attacks, hp ${q.sdk.getState()?.player?.hp})`);
}

export async function findDistillator(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    await enterWestArdougne(q);
    await leaveStewYard(q);
    if (!holds(q, OBJ.doctorsGown)) {
        if (pos(q).level !== 0) await q.climbTo(0);
        await getDoctorsGown(q);
    }
    await wear(q, OBJ.doctorsGown, "doctors' gown");
    if (pos(q).level !== 1) {
        await enterHq(q);
        await q.goTo({ x: HQ_STAIRS.x + 1, z: HQ_STAIRS.z }, 1);
        await q.climbTo(1, HQ_STAIRS);
    }
    // East through the upstairs door (gown worn) to the sick mourners.
    // (findNearbyNpc's reachable flag said yes through the shut door: go by position.)
    if (pos(q).x < HQ_UP_DOOR.x) {
        const shut = async () => !!(await findLoc(q, HQ_UP_DOOR, /^door$/i, /^open$/i));
        if (await shut()) {
            await q.goTo({ x: HQ_UP_DOOR.x - 1, z: HQ_UP_DOOR.z, level: 1 }, 0).catch(() => undefined);
            const opened = () =>
                pos(q).x > HQ_UP_DOOR.x ||
                !(q.sdk.getNearbyLocs() ?? []).some((l) => l.x === HQ_UP_DOOR.x && l.z === HQ_UP_DOOR.z && /^door$/i.test(l.name) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)));
            await op(q, HQ_UP_DOOR, /^door$/i, /^open$/i, opened, 'through the upstairs door', [], 10);
        }
        await q.goTo({ x: HQ_UP_DOOR.x + 2, z: HQ_UP_DOOR.z, level: 1 }, 1);
    }
    await mournerKey(q);
    await driveDialog(q.sdk, [], { ticks: 6 });
    // The key on the gate (either leaf), then the crate behind it.
    const crateReachable = () => !!q.sdk.findNearbyLoc(/^crate$/i, { withOption: /^search$/i, reachable: true });
    if (!crateReachable()) {
        await useOn(q, OBJ.key, HQ_GATE, /^gate$/i, () => crateReachable() || pos(q).x > HQ_GATE.x, 'the key on the gate', 15).catch((e) => q.log(`biohazard: ${(e as Error).message}`));
    }
    await op(q, CRATE, /^crate$/i, /^search$/i, () => holds(q, OBJ.distillator), 'search the crate', [], 15);
    q.log(`biohazard: found the distillator in ${tickNow(q.sdk) - t0}t`);
    await leaveHq(q);
}

/**
 * Out of the HQ by its south door. walkTo treats the door as impassable from inside and
 * travelTo spun ~1500t against the wall (2026-11-01): downstairs, then the door by hand.
 */
export async function leaveHq(q: Quest): Promise<void> {
    const upstairs = () => pos(q).level === 1 && inBox(pos(q), 2540, 2557, 3321, 3331);
    if (!inHq(q) && !upstairs()) return;
    const t0 = tickNow(q.sdk);
    if (pos(q).level !== 0) {
        // Back through the gate if behind it; the upstairs door lets you out westward on foot.
        if (pos(q).x > HQ_GATE.x) {
            await op(q, HQ_GATE, /^gate$/i, /^open$/i, () => pos(q).x <= HQ_GATE.x, 'back through the gate', [], 10).catch((e) => q.log(`biohazard: ${(e as Error).message}`));
        }
        await q.climbTo(0, HQ_STAIRS);
    }
    // The stairs' room has its own door (2546,3325, east edge): walkTo opens it and gets as far
    // as the hall (2547,3325), then stalls.
    if (pos(q).x <= HQ_INNER_DOOR.x) await q.goTo({ x: HQ_INNER_DOOR.x + 1, z: HQ_INNER_DOOR.z }, 0).catch((e) => q.log(`biohazard: ${(e as Error).message}`));
    // Opened, that door swings onto the hall tile (2547,3325, "Close") and the client then routes
    // nowhere from it ("Failed to walk", 120+ ticks): shut it behind us first.
    for (let i = 0; i < 3; i++) {
        await q.sdk.scanNearbyLocs(3).catch(() => undefined);
        const open = (q.sdk.getNearbyLocs() ?? []).find((l) => /^door$/i.test(l.name) && Math.abs(l.x - (HQ_INNER_DOOR.x + 1)) <= 0 && l.z === HQ_INNER_DOOR.z && l.optionsWithIndex.some((o) => /^close$/i.test(o.text)));
        if (!open || pos(q).x <= HQ_INNER_DOOR.x) break;
        await q.sdk.sendInteractLoc(open.x, open.z, open.id, open.optionsWithIndex.find((o) => /^close$/i.test(o.text))!.opIndex);
        await q.sdk.waitForTicks(3);
    }
    // walkTo gave up inside the hall (it kept planning through the shut front doors, and the
    // sick mourners crowd it): plain walk clicks to the inside of the south door.
    const inside = { x: HQ_DOOR.x, z: HQ_DOOR.z + 1 };
    // The ten sick mourners wander the hall and block tiles: step by step, side-stepping.
    const steps = [inside, { x: 2550, z: 3322 }, { x: 2549, z: 3323 }, { x: 2548, z: 3324 }, { x: 2552, z: 3322 }, { x: 2550, z: 3324 }];
    for (let i = 0; i < 30 && Math.hypot(pos(q).x - inside.x, pos(q).z - inside.z) > 1; i++) {
        const step = i % 3 === 0 ? inside : steps[1 + (i % (steps.length - 1))]!;
        const res = await q.sdk.sendWalk(step.x, step.z);
        if (!res.success && i % 5 === 0) q.log(`biohazard: walk to (${step.x},${step.z}) in the HQ: ${res.message}`);
        await untilTicks(q.sdk, () => Math.hypot(pos(q).x - inside.x, pos(q).z - inside.z) <= 1, 5);
    }
    q.log(`biohazard: at the HQ's south door from inside ${where(q)}`);
    await op(q, HQ_DOOR, /^door$/i, /^open$/i, () => !inHq(q), "out of the mourners' HQ", [], 10);
    q.log(`biohazard: out of the HQ at ${where(q)} in ${tickNow(q.sdk) - t0}t`);
}

// ── stage 7 -> 10: Elena; 10 -> 12: the chemist

/** Elena: hand her the distillator (-> 10, the vials) — out of West Ardougne first. */
export async function returnDistillator(q: Quest): Promise<void> {
    if (!holds(q, OBJ.distillator)) throw new Error('biohazard: no distillator to return');
    await leaveHq(q);
    await talkIndoors(q, /^elena$/i, [], ELENA);
}

const VIALS = [OBJ.ethenea, OBJ.liquidHoney, OBJ.sulphuricBroline];
const kitHeld = (q: Quest) => [...VIALS, OBJ.plagueSample].every((id) => has(q, id));

/** Anything of Elena's kit missing: she replaces it at 10/12. */
export async function replaceKit(q: Quest): Promise<void> {
    if (kitHeld(q)) return;
    const seen = await talkIndoors(q, /^elena$/i, [/lost some of the stuff/i], ELENA);
    if (!kitHeld(q)) throw new Error(`biohazard: Elena did not replace the kit: ${seen.slice(-120)}`);
    q.log('biohazard: Elena replaced the kit');
}

export async function seeChemist(q: Quest): Promise<void> {
    await replaceKit(q);
    // The first choice ("I'm carrying a plague sample") loses the sample to him: only the friend route.
    const seen = await talkIndoors(q, /^chemist$/i, [/i'm elena's friend/i, /touch paper for a guy called guidor/i], CHEMIST);
    q.log(`biohazard: chemist: ${seen.slice(-120)}`);
}

// ── stage 12 -> 14: the errand boys, the Dancing Donkey, Guidor

/** Which boy carries which vial (hops.rs2, chancy.rs2, devinci.rs2: the rest are lost). */
const ERRANDS = [
    { vial: OBJ.sulphuricBroline, boy: /^hops$/i, choice: /vial of sulphuric broline/i },
    { vial: OBJ.liquidHoney, boy: /^chancy$/i, choice: /vial of liquid honey/i },
    { vial: OBJ.ethenea, boy: /^devinci$/i, choice: /vial of ethenea/i },
] as const;

/** Set once the inn has been visited: a vial still missing after it is lost, and Elena replaces it. */
let innVisited = false;

export async function smuggleVials(q: Quest, round = 1): Promise<void> {
    const t0 = tickNow(q.sdk);
    // A missing vial may be with a boy (a resumed run): the inn first. Only a missing sample,
    // or a vial no boy brought back, sends us to Elena for another.
    if (!has(q, OBJ.plagueSample) || (innVisited && !kitHeld(q))) await replaceKit(q);
    const toRimmington = !has(q, OBJ.touchPaper) || ERRANDS.some((e) => has(q, e.vial));
    if (toRimmington) await crossMembersGate(q, false);
    if (!has(q, OBJ.touchPaper)) await talkIndoors(q, /^chemist$/i, [/yes please/i], CHEMIST);
    for (const e of ERRANDS) {
        if (!has(q, e.vial)) continue;
        const said = await q.talk(e.boy, [e.choice], ERRAND_BOYS);
        // A boy who already carries one from an earlier run takes no second ("I've got your vial
        // but I'm not taking two", chancy.rs2/hops.rs2/devinci.rs2 *_given bit): his is on its way.
        // ABGARMY05 stopped here with a spare liquid honey (2026-11-02).
        if (has(q, e.vial) && /not taking two|contemplating the sublime|better get going/i.test(String(said ?? ''))) {
            q.log(`biohazard: ${e.boy.source} already carries a vial from an earlier run`);
            continue;
        }
        if (has(q, e.vial)) throw new Error(`biohazard: ${e.boy.source} did not take the vial (${String(said ?? '').slice(-120)})`);
    }
    q.log(`biohazard: vials with the errand boys in ${tickNow(q.sdk) - t0}t`);
    await crossMembersGate(q, true);
    // In the Dancing Donkey each hands his back; one with nothing "isn't in a fit state".
    for (const e of ERRANDS) {
        if (has(q, e.vial)) continue;
        await talkIndoors(q, e.boy, [/i'm getting a bad feeling/i, /nothing could be further/i], DANCING_DONKEY);
        await untilTicks(q.sdk, () => has(q, e.vial), 5);
        if (!has(q, e.vial)) q.log(`biohazard: no vial back from ${e.boy.source}`);
    }
    innVisited = true;
    if (!kitHeld(q) || !has(q, OBJ.touchPaper)) {
        // A vial no boy brought back is lost: Elena replaces the kit and the errands run again in
        // this run (innVisited is per process, so a retry never reached replaceKit; ABGARMY05
        // stopped twice on "kit incomplete at the inn", 2026-11-03).
        if (round < 3) {
            q.log(`biohazard: kit incomplete at the inn (round ${round}) — Elena for a new kit, then the errands again`);
            await replaceKit(q);
            return smuggleVials(q, round + 1);
        }
        throw new Error(`biohazard: kit incomplete at the inn (carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
    }
    q.log(`biohazard: vials back in Varrock in ${tickNow(q.sdk) - t0}t`);
}

export async function seeGuidor(q: Quest): Promise<void> {
    await crossMembersGate(q, true);
    await wear(q, OBJ.priestGown, 'priest gown');
    await wear(q, OBJ.priestRobe, 'priest gown (bottom)');
    const guidorHere = () => !!q.sdk.findNearbyNpc(/^guidor$/i, { reachable: true });
    if (!guidorHere()) {
        await q.goTo(GUIDOR_HALL, 1);
        await op(q, GUIDOR_DOOR, /^door$/i, /^open$/i, () => guidorHere() || pos(q).x > GUIDOR_DOOR.x, "into Guidor's room", [], 10);
    }
    const seen = await q.talk(/^guidor$/i, [/come to ask your assistance/i, /sent by your old pupil elena/i, /so what does that mean/i]);
    q.log(`biohazard: Guidor: ${seen.slice(-140)}`);
}

/**
 * South-east Varrock (the Dancing Donkey, Guidor) is walled off but for the members' gate
 * (3264,3405-3406): walkTo reports it cant_reach and travelTo spins at it, so open it by hand.
 * From the west it teleports you onto the gate tile (x 3264); from the east, to x 3263.
 */
const MEMBERS_GATE = { x: 3264, z: 3405 };
export const inSeVarrock = (p: { x: number; z: number; level?: number }) => (p.level ?? 0) === 0 && inBox(p, 3264, 3300, 3370, 3412);

export async function crossMembersGate(q: Quest, east: boolean): Promise<void> {
    if (inSeVarrock(pos(q)) === east) return;
    const t0 = tickNow(q.sdk);
    await q.goTo({ x: MEMBERS_GATE.x + (east ? -1 : 1), z: MEMBERS_GATE.z }, 1);
    await op(q, MEMBERS_GATE, /^gate$/i, /^open$/i, () => inSeVarrock(pos(q)) === east, `the members' gate (${east ? 'east' : 'west'})`, [], 12);
    await driveDialog(q.sdk, [], { ticks: 6 });
    q.log(`biohazard: through the members' gate ${east ? 'east' : 'west'} at ${where(q)} in ${tickNow(q.sdk) - t0}t`);
}

/** Elena (stage 14): out of south-east Varrock first. */
export async function reportToElena(q: Quest): Promise<void> {
    await crossMembersGate(q, false);
    await talkIndoors(q, /^elena$/i, [], ELENA);
}

// ── stage 15 -> complete: King Lathas

export async function seeLathas(q: Quest): Promise<void> {
    if (pos(q).level !== 1) await q.goTo(CASTLE_STAIRS, 2);
    const seen = await talkIndoors(q, /^king lathas$/i, [/i don't understand/i], LATHAS);
    q.log(`biohazard: Lathas: ${seen.slice(-120)}`);
}

export { leavePlagueCity };
