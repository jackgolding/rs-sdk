/**
 * Eadgar's Ruse — the route and mechanics (bots/quests/eadgars-ruse.ts is the definition).
 *
 * Content facts (quest_eadgar/scripts/*.rs2, quest_troll/scripts/troll_eadgar.rs2 + quest_troll.rs2, area_taverly/sanfew.rs2;
 * maps m40_51, m44_157, m45_157, m45_57):
 *   - Sanfew (Taverley, upstairs 2899,3428 L1): "Have you any more work for me..." -> "I'll do it." (10). Needs Druidic
 *     Ritual, Death Plateau, Troll Stronghold and base Herblore 31.
 *   - Parroty Pete (zoo, 2611,3285): "When did you add it?" and "What do you feed them?" set the two dialog bits that let
 *     pineapple chunks used on vodka become alco-chunks; alco-chunks on the Aviary Hatch (4043, 2611,3287) catch the drunk
 *     parrot. Allowed before the quest, never at >= 50 (then Eadgar hands a lost one back).
 *   - Burntmeat (1151, kitchen 2844,10057 L1): at 10 -> 20 (15 -> 25). With the fake man (87) -> burnt meat, 90.
 *   - Eadgar (home L2, Trollheim cave 3759 at 2892,3672 once freed): 20/25 -> 30; with the parrot -> 50; at 60 -> 70 and he
 *     takes logs, 5 raw chickens, 10 grain, the dirty robe (-> 80 once all four are in); the troll potion -> 85; at 86 ->
 *     the fake man (queued: it lands when his menu closes), 87. Every talk ends on "No thanks, Eadgar."
 *   - The torture rack (3821, 2828,10096 prison L0): the parrot used on it at 50 -> 60; searched at 85 -> parrot back, 86.
 *   - Tegid (Taverley lake 2913,3417) at 70: "Sanfew won't be happy..." -> dirty robe.
 *   - Troll thistle (npc "Thistle", Trollheim 2883-2902,3670-3686): Pick; dried on a fire, ground with a pestle and mortar,
 *     mixed into a ranarr unfinished potion (only at 80) -> Troll potion.
 *   - Kitchen drawers (3816, 2852,10049 L1): Open, then Search the open drawer (3817) at 90 -> storeroom key. The storeroom
 *     door (3810, 2869,10085 L0) takes it -> 100. The goutweed crate (3822, 2857,10074): Search -> goutweed; the patrolling
 *     guards (and the sleeping one, after the take) knock you out to (2865,10088) for 0-6 damage. Sanfew with goutweed -> 110.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';
import * as troll from './troll-stronghold';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const SANFEW_HOUSE = { x: 2899, z: 3428 };
export const TEGID = { x: 2912, z: 3418 };
export const ZOO = { x: 2611, z: 3284 };
const HATCH = { id: 4043, x: 2611, z: 3287 };
const RACK = { id: 3821, x: 2828, z: 10096 };
const DRAWERS = { id: 3816, open: 3817, x: 2852, z: 10049 };
const STORE_DOOR = { id: 3810, x: 2869, z: 10085 };
const CRATE = { id: 3822, x: 2857, z: 10074 };
const CRATE_STAND = { x: 2858, z: 10074 };
/** Where the guards' knock-out drops you (quest_eadgar.rs2 troll_guard_teleport 0_44_157_49_40). */
const KO_TILE = { x: 2865, z: 10088 };
const BURNTMEAT = { x: 2846, z: 10058 };
const THISTLE_FIELD = { x: 2888, z: 3676 };
const FIRE_SPOTS: Tile[] = [
    { x: 2886, z: 3676 },
    { x: 2885, z: 3677 },
    { x: 2887, z: 3678 },
    { x: 2884, z: 3675 },
];
/** ranarrvial: every herb's unfinished potion is named "Unfinished potion". */
export const RANARR_UNF = 99;

export const RE = {
    parrot: /^drunk parrot$/i,
    alco: /^alco-chunks$/i,
    chunks: /^pineapple chunks$/i,
    vodka: /^vodka$/i,
    robe: /^dirty robe$/i,
    thistle: /^troll thistle$/i,
    dried: /^dried thistle$/i,
    ground: /^ground thistle$/i,
    potion: /^troll potion$/i,
    fakeMan: /^fake man$/i,
    key: /^storeroom key$/i,
    goutweed: /^goutweed$/i,
    ranarr: /^ranarr weed$/i,
    vial: /^vial of water$/i,
    logs: /^logs$/i,
};

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const messagesSince = (q: Quest, t0: number) => (q.sdk.getState()?.gameMessages ?? []).filter((m) => m.tick >= t0).map((m) => m.text);
const heard = (q: Quest, t0: number, re: RegExp) => messagesSince(q, t0).some((m) => re.test(m));
const held = (q: Quest, re: RegExp) => q.sdk.getInventory().some((i) => re.test(i.name));
export const hasUnf = (q: Quest) => q.sdk.getInventory().some((i) => i.id === RANARR_UNF);

/** Walk inside one area (no goTo: it would leave the troll country first). */
async function walk(q: Quest, to: Tile, tolerance = 1): Promise<void> {
    for (let attempt = 1; attempt <= 3 && cheb(pos(q), to) > tolerance; attempt++) {
        const res = await q.bot.walkTo(to.x, to.z, tolerance).catch((e) => ({ success: false, message: String(e) }));
        if (res.success || cheb(pos(q), to) <= tolerance + 1) return;
        q.log(`eadgar: walk to (${to.x},${to.z}) from ${where(q)}: ${res.message}`);
        await q.sdk.waitForTicks(2);
    }
}

/** Finish an open dialog, taking `choices` where offered; "No thanks, Eadgar." closes his menus. */
async function finishDialog(q: Quest, choices: RegExp[] = [], done?: () => boolean): Promise<string> {
    let text = '';
    for (let i = 0; i < 6 && q.sdk.getDialog()?.isOpen && !done?.(); i++) text += await driveDialog(q.sdk, choices, { done, ticks: 40, log: q.log });
    return text;
}

/** Talk to the nearest `npc` here (no travel) and drive the dialog. */
async function talkHere(q: Quest, npc: RegExp, choices: RegExp[], label: string, done?: () => boolean): Promise<string> {
    await untilTicks(q.sdk, () => !!q.sdk.findNearbyNpc(npc), 10);
    const target = q.sdk.findNearbyNpc(npc);
    if (!target) throw new Error(`eadgar: no ${label} in view at ${where(q)}`);
    const res = await q.bot.talkTo(target).catch((e) => ({ success: false, message: String(e) }));
    if (!res.success && !q.sdk.getDialog()?.isOpen) q.log(`eadgar: talk to ${label}: ${res.message}`);
    await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 10);
    const text = await finishDialog(q, choices, done);
    q.log(`eadgar: ${label}: ${text.slice(0, 300)}`);
    return text;
}

// ── Taverley

/** Up to Sanfew (plane 1), waiting for the new plane's npcs. */
export async function toSanfew(q: Quest): Promise<void> {
    if (pos(q).level !== 1 || cheb(pos(q), SANFEW_HOUSE) > 8) {
        await q.goTo(SANFEW_HOUSE, 3);
        await q.climbTo(1, SANFEW_HOUSE);
    }
    await untilTicks(q.sdk, (s) => (s.nearbyNpcs ?? []).some((n) => /^sanfew$/i.test(n.name)), 15);
}

/** Sanfew: "Have you any more work for me..." -> "I'll do it." (10). */
export async function start(q: Quest): Promise<void> {
    await toSanfew(q);
    const text = await talkHere(q, /^sanfew$/i, [/any more work for me/i, /^i'll do it/i], 'Sanfew');
    if (/not yet learned enough/i.test(text)) throw new Error('eadgar: Sanfew wants base Herblore 31');
    if (/not right now/i.test(text)) throw new Error('eadgar: Sanfew has no work — Death Plateau and Troll Stronghold done?');
}

/** Sanfew with the goutweed: QUEST COMPLETE. */
export async function handIn(q: Quest): Promise<void> {
    if (!held(q, RE.goutweed)) throw new Error('eadgar: no goutweed for Sanfew');
    await toSanfew(q);
    await talkHere(q, /^sanfew$/i, [], 'Sanfew (goutweed)');
    await q.climbTo(0, SANFEW_HOUSE).catch(() => undefined);
}

/** Tegid's dirty robe (only at 70, and only while none is held or banked). */
export async function robe(q: Quest): Promise<void> {
    if (held(q, RE.robe)) return;
    await q.goTo(TEGID, 3);
    await talkHere(q, /^tegid$/i, [/sanfew won't be happy/i], 'Tegid', () => held(q, RE.robe));
    await untilTicks(q.sdk, () => held(q, RE.robe), 4);
    if (!held(q, RE.robe)) throw new Error('eadgar: Tegid gave no dirty robe');
}

// ── the zoo

/** Pete's two dialog bits, alco-chunks, and the aviary's drunk parrot. */
export async function catchParrot(q: Quest): Promise<void> {
    if (held(q, RE.parrot)) return;
    if (!held(q, RE.alco)) {
        if (!held(q, RE.chunks) || !held(q, RE.vodka)) throw new Error('eadgar: pineapple chunks and vodka needed for the parrot');
        await q.goTo(ZOO, 3);
        await talkHere(q, /^parroty pete$/i, [/when did you add it/i], 'Parroty Pete (1)');
        await talkHere(q, /^parroty pete$/i, [/what do you feed them/i], 'Parroty Pete (2)');
        for (let i = 0; i < 3 && !held(q, RE.alco); i++) {
            const chunks = q.sdk.findInventoryItem(RE.chunks);
            const vodka = q.sdk.findInventoryItem(RE.vodka);
            if (!chunks || !vodka) break;
            const t0 = tickNow(q.sdk);
            await q.sdk.sendUseItemOnItem(chunks.slot, vodka.slot);
            await untilTicks(q.sdk, () => held(q, RE.alco) || heard(q, t0, /why would you|don't need to make/i), 6);
            if (heard(q, t0, /don't need to make/i)) throw new Error('eadgar: "You don\'t need to make any more" — a parrot is held or banked');
        }
        if (!held(q, RE.alco)) throw new Error('eadgar: no alco-chunks (Pete\'s dialog bits not set?)');
    }
    await q.goTo(ZOO, 3);
    for (let i = 0; i < 4 && !held(q, RE.parrot); i++) {
        const t0 = tickNow(q.sdk);
        await q.sdk.scanNearbyLocs(8).catch(() => undefined);
        const hatch = (q.sdk.getNearbyLocs() ?? []).find((l) => l.id === HATCH.id);
        const alco = q.sdk.findInventoryItem(RE.alco);
        if (!alco) break;
        if (hatch) await q.bot.useItemOnLoc(alco, hatch).catch(() => undefined);
        else await q.sdk.sendUseItemOnLoc(alco.slot, HATCH.x, HATCH.z, HATCH.id);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || held(q, RE.parrot), 10);
        await finishDialog(q, [], undefined);
        await untilTicks(q.sdk, () => held(q, RE.parrot), 4);
        if (heard(q, t0, /flew off/i)) throw new Error('eadgar: the parrot flew off — the quest is past 50 (ask Eadgar for it)');
    }
    if (!held(q, RE.parrot)) throw new Error('eadgar: no drunk parrot from the aviary');
    q.log('eadgar: caught the drunk parrot');
}

// ── the troll country

/** Into Eadgar's home; frees him from the prison first when the cave is empty (an older Troll Stronghold left him jailed). */
export async function toEadgar(q: Quest): Promise<void> {
    await troll.goToArea(q, 'eadgar');
    if (pos(q).level === 2) return;
    q.log(`eadgar: Eadgar's cave is empty at ${where(q)} — freeing him from the prison`);
    await troll.freeEadgar(q).catch((e: Error) => q.log(`eadgar: ${e.message}`));
    await troll.goToArea(q, 'eadgar');
    if (pos(q).level !== 2) throw new Error(`eadgar: Eadgar is not home (cave at ${where(q)})`);
}

/** Talk to Eadgar at home, closing his menus. `done` stops early (an item handed over). */
export async function talkEadgar(q: Quest, label: string, done?: () => boolean): Promise<string> {
    await toEadgar(q);
    const text = await talkHere(q, /^eadgar$/i, [/no thanks, eadgar/i], `Eadgar (${label})`, done);
    // The fake man and the potion hand-over are queued: they land a tick after the dialog.
    await q.sdk.waitForTicks(2);
    return text;
}

/**
 * L1 west to the kitchen: from the prison-door side the client will not plan through the shut interior door (2837,10063)
 * ("Stuck" from 30 tiles off); from its doorstep walkTo opens it.
 */
async function toKitchen(q: Quest, to: Tile, tolerance: number): Promise<void> {
    await troll.goToArea(q, 'l1w');
    await troll.walkL1w(q, to, tolerance);
}

/** Burntmeat in the stronghold kitchen; at 90 he gives the goutweed secret. */
export async function talkCook(q: Quest, label: string): Promise<string> {
    await toKitchen(q, BURNTMEAT, 2);
    return talkHere(q, /^burntmeat$/i, [/where can i get some goutweed/i], `Burntmeat (${label})`);
}

/** The parrot under the torture rack (50 -> 60). */
export async function hideParrot(q: Quest): Promise<void> {
    await troll.goToArea(q, 'prison');
    await walk(q, { x: RACK.x + 1, z: RACK.z }, 2);
    for (let i = 0; i < 4 && held(q, RE.parrot); i++) {
        const parrot = q.sdk.findInventoryItem(RE.parrot);
        if (!parrot) break;
        await q.sdk.sendUseItemOnLoc(parrot.slot, RACK.x, RACK.z, RACK.id);
        await untilTicks(q.sdk, () => !held(q, RE.parrot), 10);
    }
    if (held(q, RE.parrot)) throw new Error(`eadgar: could not hide the parrot under the rack (at ${where(q)})`);
}

/** Search the rack for the parrot (85 -> 86). */
export async function fetchParrot(q: Quest): Promise<void> {
    await troll.goToArea(q, 'prison');
    await walk(q, { x: RACK.x + 1, z: RACK.z }, 2);
    for (let i = 0; i < 4 && !held(q, RE.parrot); i++) {
        await q.sdk.sendInteractLoc(RACK.x, RACK.z, RACK.id, 1);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || held(q, RE.parrot), 10);
        await finishDialog(q);
        await untilTicks(q.sdk, () => held(q, RE.parrot), 4);
    }
    if (!held(q, RE.parrot)) throw new Error(`eadgar: no parrot under the rack (at ${where(q)})`);
}

/**
 * Troll thistle picked on Trollheim, dried on a fire of our own and ground: anytime in the quest. Leaves the ground
 * thistle in the pack; drops the tinderbox and the pestle and mortar afterwards (nothing else uses them).
 */
export async function groundThistle(q: Quest): Promise<void> {
    if (held(q, RE.ground) || held(q, RE.potion)) return;
    if (!held(q, RE.dried)) {
        if (!held(q, RE.thistle)) {
            await troll.goToArea(q, 'trollheim');
            await walk(q, THISTLE_FIELD, 3);
            const t0 = tickNow(q.sdk);
            while (!held(q, RE.thistle) && tickNow(q.sdk) - t0 < 150) {
                const t = (q.sdk.getNearbyNpcs() ?? []).filter((n) => /^thistle$/i.test(n.name)).sort((a, b) => a.distance - b.distance)[0];
                if (!t) {
                    await walk(q, THISTLE_FIELD, 3);
                    await q.sdk.waitForTicks(2);
                    continue;
                }
                await q.bot.interactNpc(t, /^pick$/i).catch(() => undefined);
                await untilTicks(q.sdk, () => held(q, RE.thistle), 6);
            }
            if (!held(q, RE.thistle)) throw new Error(`eadgar: no troll thistle picked (at ${where(q)})`);
        }
        await dryThistle(q);
    }
    for (let i = 0; i < 4 && !held(q, RE.ground); i++) {
        const pestle = q.sdk.findInventoryItem(/^pestle and mortar$/i);
        const dried = q.sdk.findInventoryItem(RE.dried);
        if (!pestle || !dried) throw new Error('eadgar: a pestle and mortar and the dried thistle needed');
        await q.sdk.sendUseItemOnItem(pestle.slot, dried.slot);
        await untilTicks(q.sdk, () => held(q, RE.ground), 5);
    }
    if (!held(q, RE.ground)) throw new Error('eadgar: could not grind the dried thistle');
    for (const tool of [/^tinderbox$/i, /^pestle and mortar$/i]) await q.bot.dropItem(tool, 'all').catch(() => undefined);
    q.log('eadgar: ground thistle ready');
}

/** A fire of our own (one log, tinderbox), the thistle used on it. */
async function dryThistle(q: Quest): Promise<void> {
    const fireNear = () =>
        (q.sdk.getNearbyLocs() ?? []).filter((l) => /^fire$/i.test(l.name) && cheb(l, pos(q)) <= 6).sort((a, b) => cheb(a, pos(q)) - cheb(b, pos(q)))[0];
    await q.sdk.scanNearbyLocs(8).catch(() => undefined);
    let fire = fireNear();
    for (let i = 0; i < FIRE_SPOTS.length * 2 && !fire; i++) {
        if (!held(q, RE.logs)) throw new Error('eadgar: no logs left for a fire');
        await walk(q, FIRE_SPOTS[i % FIRE_SPOTS.length]!, 0);
        const r = await q.bot.burnLogs(RE.logs).catch((e) => ({ success: false, message: String(e) }));
        q.log(`eadgar: fire at ${where(q)}: ${r.message}`);
        await q.sdk.scanNearbyLocs(8).catch(() => undefined);
        fire = fireNear();
    }
    if (!fire) throw new Error(`eadgar: could not light a fire (at ${where(q)})`);
    for (let i = 0; i < 4 && !held(q, RE.dried); i++) {
        const thistle = q.sdk.findInventoryItem(RE.thistle);
        if (!thistle) break;
        await q.sdk.sendUseItemOnLoc(thistle.slot, fire.x, fire.z, fire.id);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || held(q, RE.dried), 8);
        if (q.sdk.getDialog()?.isOpen) await finishDialog(q, [/^(cook|dry|make)\b.*(1|one|all)?/i, /^1$/, /./], () => held(q, RE.dried));
        await untilTicks(q.sdk, () => held(q, RE.dried), 6);
    }
    if (!held(q, RE.dried)) throw new Error('eadgar: the thistle did not dry on the fire');
}

/** Ranarr weed into a vial of water: the unfinished potion (Herblore 25). */
export async function makeUnf(q: Quest): Promise<void> {
    if (hasUnf(q) || held(q, RE.potion)) return;
    const herb = q.sdk.findInventoryItem(RE.ranarr);
    const vial = q.sdk.findInventoryItem(RE.vial);
    if (!herb || !vial) throw new Error('eadgar: ranarr weed and a vial of water needed');
    await q.sdk.sendUseItemOnItem(herb.slot, vial.slot);
    await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || hasUnf(q), 6);
    if (q.sdk.getDialog()?.isOpen) await finishDialog(q, [/./], () => hasUnf(q));
    await untilTicks(q.sdk, () => hasUnf(q), 4);
    if (!hasUnf(q)) throw new Error('eadgar: no unfinished ranarr potion');
}

/** Ground thistle into the ranarr potion (only at 80). */
export async function mixPotion(q: Quest): Promise<void> {
    if (held(q, RE.potion)) return;
    await makeUnf(q);
    for (let i = 0; i < 3 && !held(q, RE.potion); i++) {
        const ground = q.sdk.findInventoryItem(RE.ground);
        const unf = q.sdk.getInventory().find((it) => it.id === RANARR_UNF);
        if (!ground || !unf) throw new Error('eadgar: the ground thistle and the ranarr potion needed');
        await q.sdk.sendUseItemOnItem(ground.slot, unf.slot);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || held(q, RE.potion), 6);
        if (q.sdk.getDialog()?.isOpen) await finishDialog(q, [/./], () => held(q, RE.potion));
        await untilTicks(q.sdk, () => held(q, RE.potion), 4);
    }
    if (!held(q, RE.potion)) throw new Error('eadgar: could not mix the troll potion');
}

// ── the storeroom

const inStoreroom = troll.inStoreroom;

/** The kitchen drawers' false bottom (90): open, then search. */
export async function storeroomKey(q: Quest): Promise<void> {
    if (held(q, RE.key)) return;
    await toKitchen(q, { x: DRAWERS.x, z: DRAWERS.z + 2 }, 1);
    for (let i = 0; i < 4 && !held(q, RE.key); i++) {
        await q.sdk.scanNearbyLocs(6).catch(() => undefined);
        const open = (q.sdk.getNearbyLocs() ?? []).find((l) => l.id === DRAWERS.open && cheb(l, DRAWERS) <= 2);
        const t0 = tickNow(q.sdk);
        if (!open) {
            const shut = (q.sdk.getNearbyLocs() ?? []).find((l) => l.id === DRAWERS.id && cheb(l, DRAWERS) <= 2);
            await q.sdk.sendInteractLoc(shut?.x ?? DRAWERS.x, shut?.z ?? DRAWERS.z, DRAWERS.id, 1);
            await untilTicks(q.sdk, () => (q.sdk.getNearbyLocs() ?? []).some((l) => l.id === DRAWERS.open), 6);
            await q.sdk.scanNearbyLocs(6).catch(() => undefined);
            continue;
        }
        await q.sdk.sendInteractLoc(open.x, open.z, DRAWERS.open, 2);
        await untilTicks(q.sdk, () => held(q, RE.key) || heard(q, t0, /don't find anything|don't have space/i), 8);
        if (heard(q, t0, /don't find anything/i)) throw new Error('eadgar: the drawers are empty (not at stage 90, or a key is banked)');
    }
    if (!held(q, RE.key)) throw new Error(`eadgar: no storeroom key from the drawers (at ${where(q)})`);
}

/** Into the storeroom: the key unlocks it once (-> 100), then it opens freely. */
export async function intoStoreroom(q: Quest): Promise<void> {
    if (inStoreroom(pos(q))) return;
    await troll.goToArea(q, 'l0east');
    await walk(q, { x: STORE_DOOR.x, z: STORE_DOOR.z - 1 }, 0);
    for (let i = 0; i < 4 && !inStoreroom(pos(q)); i++) {
        const t0 = tickNow(q.sdk);
        await q.sdk.sendInteractLoc(STORE_DOOR.x, STORE_DOOR.z, STORE_DOOR.id, 1);
        await untilTicks(q.sdk, () => heard(q, t0, /unlock the door|need to find the right key/i) || inStoreroom(pos(q)), 6);
        if (heard(q, t0, /need to find the right key/i)) throw new Error('eadgar: the storeroom door wants its key');
        // The door swings open and shuts itself again: step through while it is open.
        if (!inStoreroom(pos(q))) {
            await q.sdk.sendWalk(STORE_DOOR.x, STORE_DOOR.z + 1);
            await untilTicks(q.sdk, () => inStoreroom(pos(q)), 4);
        }
    }
    if (!inStoreroom(pos(q))) throw new Error(`eadgar: could not get into the storeroom (at ${where(q)})`);
}

/**
 * The goutweed crate past the patrolling guards (troll_sguard1-8: each hunts its own tile and the next 1-2 toward its
 * patrol waypoint every tick). Walk a step at a time toward the crate, holding while a guard is within 3 tiles of the next
 * step; a knock-out lands us on KO_TILE and we go again.
 */
export async function takeGoutweed(q: Quest): Promise<void> {
    if (held(q, RE.goutweed)) return;
    await intoStoreroom(q);
    const t0 = tickNow(q.sdk);
    let kos = 0;
    let lastLog = -99;
    let lastPos = pos(q);
    while (!held(q, RE.goutweed) && tickNow(q.sdk) - t0 < 600) {
        const me = pos(q);
        if (cheb(me, KO_TILE) === 0 && cheb(lastPos, KO_TILE) > 1) {
            kos++;
            q.log(`eadgar: knocked out (${kos}) — hp ${q.sdk.getState()?.player?.hp}`);
        }
        lastPos = me;
        if (tickNow(q.sdk) - lastLog >= 50) {
            lastLog = tickNow(q.sdk);
            const gs = (q.sdk.getNearbyNpcs() ?? []).filter((n) => /^guard$/i.test(n.name)).map((n) => `${n.tileX ?? n.x},${n.tileZ ?? n.z}`);
            q.log(`eadgar: storeroom at ${where(q)}, ${tickNow(q.sdk) - t0}t, guards ${gs.join(' ')}`);
        }
        const p = q.sdk.getState()?.player;
        if (p && p.hp <= (p.maxHp ?? 10) * 0.5) {
            const food = q.sdk.getInventory().find((i) => /^(shark|manta ray|monkfish|swordfish|lobster|bass|tuna)$/i.test(i.name));
            if (food) await q.bot.eatFood(food).catch(() => undefined);
        }
        if (!inStoreroom(me)) {
            await intoStoreroom(q);
            continue;
        }
        if (cheb(me, CRATE_STAND) === 0) {
            await q.sdk.sendInteractLoc(CRATE.x, CRATE.z, CRATE.id, 1);
            await untilTicks(q.sdk, (s) => held(q, RE.goutweed) || !!s.dialog?.isOpen || cheb(pos(q), CRATE_STAND) > 0, 4);
            continue;
        }
        const guards = (q.sdk.getNearbyNpcs() ?? []).filter((n) => /^guard$/i.test(n.name));
        const close = guards.filter((g) => cheb({ x: g.tileX ?? g.x, z: g.tileZ ?? g.z }, me) <= 1);
        if (close.length) {
            // A guard alongside: wait for it to pass (it only hunts ahead along its own leg).
            await q.sdk.waitForTicks(1);
            continue;
        }
        await q.bot.walkTo(CRATE_STAND.x, CRATE_STAND.z, 0).catch(() => undefined);
        await q.sdk.waitForTicks(1);
    }
    if (!held(q, RE.goutweed)) throw new Error(`eadgar: no goutweed after ${tickNow(q.sdk) - t0}t (${kos} knock-outs)`);
    q.log(`eadgar: goutweed in ${tickNow(q.sdk) - t0}t (${kos} knock-outs)`);
    // The sleeping guard's knock-out follows the take: let it land before walking out.
    await untilTicks(q.sdk, () => cheb(pos(q), KO_TILE) === 0, 6);
    await q.sdk.waitForTicks(2);
    await finishDialog(q);
}

