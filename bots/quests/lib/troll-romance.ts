/**
 * Troll Romance — the route and mechanics (bots/quests/troll-romance.ts is the definition).
 *
 * Content facts (quest_troll_love/scripts/*.rs2, quest_death/scripts/{death_sherpa,death_smithy}.rs2; maps m42_58, m43_58..60,
 * m43_158, m43_159, m44_58, m44_157):
 *   - Ug (2827,10064 L1) and Aga (2828,10104 L1) in the stronghold; Arrg (2828,10095 L1) behind the interior door (2828,10091).
 *   - Tenzing (his hut) "Do you know where I can find Trollweiss?" -> "What would I need to make such a sled?" (15); Dunstan
 *     (Burthorpe) "I need a sled!!" (20); again with maple/yew logs, an iron bar and rope -> toboggan (22). Swamp tar on a
 *     bucket of wax with a cake tin held -> sled wax; the wax on the toboggan -> waxed (25).
 *   - Trollheim's cave entrance 5007 (2820,3743) -> the ice cave (2803,10187); its crevasse 5025 (2772,10233) -> Trollweiss
 *     (2778,3869). Back: piste top 5009 (2779,3868) -> ice cave; tunnel 5011 (2802,10185) -> Trollheim (2822,3744).
 *   - Wield the waxed sled, op the piste barrier 5015 (2772,3835; Agility 28) -> ride to (2790,3794); Trollweiss 5006 (op2 Pick,
 *     2775-2781,3780-3785) -> 30. The second barrier (2785,3771) -> (2794,3719); the exit tunnel 5012 (2795,3717) -> the
 *     Rellekka cave (2799,10134); its bottom tunnel 5014 (2771,10161) -> outside Rellekka (2730,3713).
 *   - Ug with the flower -> 35; Arrg "I am here to kill you!" -> the arena (2914,3611), Arrg (140 hp, melee and poisoned
 *     rocks) killed -> 40; Ug -> complete (an uncut diamond, 2 QP).
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';
import * as troll from './troll-stronghold';
import { inHut, leaveAnywhere, toTenzing } from './death-plateau';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

const UG = { x: 2828, z: 10066 };
const AGA = { x: 2828, z: 10102 };
const ARRG_DOOR = { x: 2828, z: 10091 };
const DUNSTAN = { x: 2919, z: 3574 };
const LOC = {
    caveEntrance: { id: 5007, x: 2820, z: 3743 },
    crevasse: { id: 5025, x: 2772, z: 10233 },
    pisteTop: { id: 5009, x: 2779, z: 3868 },
    iceTunnel: { id: 5011, x: 2802, z: 10185 },
    barrier1: { id: 5015, x: 2772, z: 3835 },
    barrier2: { id: 5015, x: 2785, z: 3771 },
    exitTunnel: { id: 5012, x: 2795, z: 3717 },
    caveBottom: { id: 5014, x: 2771, z: 10161 },
};
const FLOWER = /^trollweiss$/i;
/** Both sleds are named "Sled": by obj id (trollromance_toboggon / _waxed / _wax). */
export const OBJ = { sled: 4083, waxed: 4084, wax: 4085 } as const;
const FOOD = /^(shark|manta ray|monkfish|swordfish|lobster|bass|tuna)$/i;

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const held = (q: Quest, re: RegExp) => q.sdk.getInventory().some((i) => re.test(i.name));
const heldId = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id);
const wornId = (q: Quest, id: number) => q.sdk.getEquipment().some((i) => i.id === id);
const invId = (q: Quest, id: number) => q.sdk.getInventory().find((i) => i.id === id);
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;

export type Zone = 'icecave' | 'top' | 'plateau' | 'pocket' | 'rcave' | 'other';
export function zoneOf(p: Tile): Zone {
    if ((p.level ?? 0) !== 0) return 'other';
    if (inBox(p, 2745, 2815, 10175, 10245)) return 'icecave';
    if (inBox(p, 2755, 2815, 10120, 10174)) return 'rcave';
    if (inBox(p, 2755, 2800, 3805, 3885)) return 'top';
    if (inBox(p, 2765, 2805, 3761, 3804)) return 'plateau';
    if (inBox(p, 2778, 2803, 3714, 3735)) return 'pocket';
    return 'other';
}
/** run-quest hook: the ice cave, Trollweiss Mountain (top and plateau), the landing pocket and the Rellekka cave. */
export const inRomanceArea = (p: Tile) => zoneOf(p) !== 'other';

async function finishDialog(q: Quest, choices: RegExp[] = [], done?: () => boolean): Promise<string> {
    let text = '';
    for (let i = 0; i < 6 && q.sdk.getDialog()?.isOpen && !done?.(); i++) text += await driveDialog(q.sdk, choices, { done, ticks: 40, log: q.log });
    return text;
}

async function walk(q: Quest, to: Tile, tolerance = 1): Promise<void> {
    for (let attempt = 1; attempt <= 3 && cheb(pos(q), to) > tolerance; attempt++) {
        if (q.sdk.getDialog()?.isOpen) await finishDialog(q);
        const res = await q.bot.walkTo(to.x, to.z, tolerance).catch((e) => ({ success: false, message: String(e) }));
        if (res.success || cheb(pos(q), to) <= tolerance + 1) return;
        q.log(`romance: walk to (${to.x},${to.z}) from ${where(q)}: ${res.message}`);
        await q.sdk.waitForTicks(2);
    }
}

/** Op1 a loc (by id, nearest its spot) until `done`. */
async function opLoc(q: Quest, loc: { id: number; x: number; z: number }, done: () => boolean, label: string, op = 1, tries = 4): Promise<void> {
    for (let i = 1; i <= tries && !done(); i++) {
        await q.sdk.scanNearbyLocs(12).catch(() => undefined);
        const seen = (q.sdk.getNearbyLocs() ?? []).filter((l) => l.id === loc.id && cheb(l, loc) <= 2).sort((a, b) => cheb(a, loc) - cheb(b, loc))[0];
        await q.sdk.sendInteractLoc(seen?.x ?? loc.x, seen?.z ?? loc.z, loc.id, op);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 20);
        if (q.sdk.getDialog()?.isOpen) await finishDialog(q, [], done);
        await untilTicks(q.sdk, done, 4);
        if (!done()) q.log(`romance: ${label}: attempt ${i} did not take at ${where(q)}`);
    }
    if (!done()) throw new Error(`romance: ${label} failed at ${where(q)}`);
}

/** The waxed sled's "Ride" (iop2; it wields it, only inside the sled zone and out of combat: can_ride_sled). */
async function ride(q: Quest, sled: { slot: number; optionsWithIndex: Array<{ text: string; opIndex: number }> }): Promise<void> {
    const op = sled.optionsWithIndex.find((o) => /^ride$/i.test(o.text));
    await q.sdk.sendUseItem(sled.slot, op?.opIndex ?? 2).catch(() => undefined);
    await untilTicks(q.sdk, () => wornId(q, OBJ.waxed), 4);
}

/** Eat in the background while walking (the ice trolls and the plateau's trolls hit through a blocking walkTo). */
function guard(q: Quest): () => void {
    return troll.survive(q, 0.6);
}

async function talkHere(q: Quest, npc: RegExp, choices: RegExp[], label: string, done?: () => boolean): Promise<string> {
    await untilTicks(q.sdk, () => !!q.sdk.findNearbyNpc(npc), 10);
    const target = q.sdk.findNearbyNpc(npc);
    if (!target) throw new Error(`romance: no ${label} in view at ${where(q)}`);
    const res = await q.bot.talkTo(target).catch((e) => ({ success: false, message: String(e) }));
    if (!res.success && !q.sdk.getDialog()?.isOpen) q.log(`romance: talk to ${label}: ${res.message}`);
    await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 10);
    const text = await finishDialog(q, choices, done);
    q.log(`romance: ${label}: ${text.slice(0, 240)}`);
    return text;
}

// ── the stronghold

export async function talkUg(q: Quest, label: string, choices: RegExp[] = []): Promise<string> {
    await troll.goToArea(q, 'l1w');
    await troll.walkL1w(q, UG, 2);
    try {
        return await talkHere(q, /^ug$/i, choices, `Ug (${label})`);
    } finally {
        await troll.prayMelee(q, false);
    }
}
export async function talkAga(q: Quest): Promise<string> {
    await troll.goToArea(q, 'l1w');
    await troll.walkL1w(q, AGA, 2);
    try {
        return await talkHere(q, /^aga$/i, [/how's your\.\.\. um\.\.\. love life|love life/i, /i've got to go/i], 'Aga');
    } finally {
        await troll.prayMelee(q, false);
    }
}

/** Arrg's challenge, then the fight in the arena (his death -> 40). */
export async function fightArrg(q: Quest, done: () => Promise<boolean>): Promise<void> {
    await troll.wieldWeapon(q);
    await troll.goToArea(q, 'l1w');
    await troll.walkL1w(q, { x: ARRG_DOOR.x, z: ARRG_DOOR.z - 1 }, 1);
    await walk(q, { x: ARRG_DOOR.x, z: ARRG_DOOR.z + 2 }, 1);
    const stop = troll.survive(q, 0.65);
    try {
        await talkHere(q, /^arrg$/i, [/i am here to kill you/i], 'Arrg', () => pos(q).z < 6400);
        await untilTicks(q.sdk, () => pos(q).z < 6400, 10);
        const t0 = tickNow(q.sdk);
        let seen = false;
        let lastAttack = -99;
        while (tickNow(q.sdk) - t0 < 900) {
            if (q.sdk.getDialog()?.isOpen) await finishDialog(q);
            await troll.prayMelee(q, true);
            const arrg = (q.sdk.getNearbyNpcs() ?? []).find((n) => /^arrg$/i.test(n.name) && (n.hp ?? 1) > 0);
            if (arrg) {
                seen = true;
                if (tickNow(q.sdk) - lastAttack >= 5) {
                    await q.sdk.sendInteractNpc(arrg.index, 2);
                    lastAttack = tickNow(q.sdk);
                }
            } else if (seen || tickNow(q.sdk) - t0 > 40) {
                if (await done()) break;
            }
            await q.sdk.waitForTicks(1);
        }
    } finally {
        stop();
        await troll.prayMelee(q, false);
    }
    if (!(await done())) throw new Error(`romance: Arrg not defeated (at ${where(q)})`);
}

// ── Burthorpe

/** Tenzing: Trollweiss and the sled (15). */
export async function askTenzing(q: Quest): Promise<void> {
    // Out of the troll country first: death-plateau's Saba-cave check reads the stronghold's L1 as the cave.
    if (troll.inTrollArea(pos(q))) await troll.leaveTrollArea(q);
    await toTenzing(q);
    if (!inHut(q)) throw new Error(`romance: not in Tenzing's hut (${where(q)})`);
    await talkHere(q, /^tenzing$/i, [/where i can find trollweiss/i, /what would i need to make such a sled/i, /nothing, thanks/i], 'Tenzing');
    await leaveAnywhere(q);
}

/** Dunstan: "I need a sled!!" (20), and the sled itself once the materials are held (22). */
export async function dunstan(q: Quest, label: string, done: () => boolean): Promise<void> {
    if (troll.inTrollArea(pos(q))) await troll.leaveTrollArea(q);
    else await leaveAnywhere(q);
    await q.goTo(DUNSTAN, 3);
    await talkHere(q, /^dunstan$/i, [/i need a sled/i, /^yes\.?$/i, /see you/i, /what else do i need/i], `Dunstan (${label})`, done);
    await finishDialog(q, [/see you/i, /what else do i need/i, /nothing, thanks/i]);
}

/** Swamp tar on the bucket of wax (cake tin held) -> sled wax; the wax on the sled -> waxed sled (25). */
export async function waxSled(q: Quest): Promise<void> {
    if (heldId(q, OBJ.waxed)) return;
    for (let i = 0; i < 3 && !heldId(q, OBJ.wax); i++) {
        const tar = q.sdk.findInventoryItem(/^swamp tar$/i);
        const wax = q.sdk.findInventoryItem(/^bucket of wax$/i);
        if (!tar || !wax) throw new Error('romance: swamp tar and a bucket of wax needed (and a cake tin)');
        await q.sdk.sendUseItemOnItem(tar.slot, wax.slot);
        await untilTicks(q.sdk, () => heldId(q, OBJ.wax), 4);
    }
    for (let i = 0; i < 3 && !heldId(q, OBJ.waxed); i++) {
        const sled = invId(q, OBJ.sled);
        const wax = invId(q, OBJ.wax);
        if (!sled || !wax) throw new Error('romance: the sled and the sled wax needed');
        await q.sdk.sendUseItemOnItem(sled.slot, wax.slot);
        await untilTicks(q.sdk, () => heldId(q, OBJ.waxed), 4);
    }
    if (!heldId(q, OBJ.waxed)) throw new Error('romance: the sled is not waxed');
}

// ── Trollweiss

/** Trollheim -> the ice cave -> Trollweiss -> the sled down -> the flower (30). */
export async function pickTrollweiss(q: Quest): Promise<void> {
    if (held(q, FLOWER)) return;
    const stop = guard(q);
    try {
        if (zoneOf(pos(q)) === 'other') {
            await troll.goToArea(q, 'trollheim');
            await troll.prayMelee(q, true);
            await walk(q, { x: 2821, z: 3741 }, 2);
            await opLoc(q, LOC.caveEntrance, () => zoneOf(pos(q)) === 'icecave', 'ice cave entrance');
        }
        if (zoneOf(pos(q)) === 'icecave') {
            await troll.prayMelee(q, true);
            await walk(q, { x: 2773, z: 10232 }, 2);
            await opLoc(q, LOC.crevasse, () => zoneOf(pos(q)) === 'top', 'crevasse');
        }
        if (zoneOf(pos(q)) === 'top') {
            await troll.prayMelee(q, false);
            await walk(q, { x: LOC.barrier1.x, z: LOC.barrier1.z + 1 }, 1);
            const sled = invId(q, OBJ.waxed);
            if (sled && !wornId(q, OBJ.waxed)) await ride(q, sled);
            if (!(await untilTicks(q.sdk, () => wornId(q, OBJ.waxed), 4))) throw new Error('romance: could not wield the waxed sled');
            await opLoc(q, LOC.barrier1, () => zoneOf(pos(q)) === 'plateau' && cheb(pos(q), { x: 2790, z: 3794 }) <= 3, 'sled ride', 1, 3);
        }
        if (zoneOf(pos(q)) !== 'plateau') throw new Error(`romance: not on the Trollweiss plateau (at ${where(q)})`);
        for (let i = 0; i < 4 && !held(q, FLOWER); i++) {
            await q.sdk.scanNearbyLocs(15).catch(() => undefined);
            const f = (q.sdk.getNearbyLocs() ?? []).filter((l) => /^rare flowers$/i.test(l.name)).sort((a, b) => cheb(a, pos(q)) - cheb(b, pos(q)))[0];
            if (f) await q.bot.interactLoc(f, /pick/i).catch(() => undefined);
            else await q.sdk.sendInteractLoc(2779, 3784, 5006, 2);
            await untilTicks(q.sdk, () => held(q, FLOWER), 8);
        }
        if (!held(q, FLOWER)) throw new Error(`romance: no Trollweiss picked (at ${where(q)})`);
        q.log('romance: picked the Trollweiss');
    } finally {
        stop();
        await troll.prayMelee(q, false);
    }
}

/** run-quest hook (and the way back with the flower): out of Trollweiss to Trollheim or Rellekka, whichever side we are on. */
export async function leaveRomanceArea(q: Quest): Promise<void> {
    const stop = guard(q);
    try {
        for (let k = 0; k < 8 && inRomanceArea(pos(q)); k++) {
            const z = zoneOf(pos(q));
            q.log(`romance: leaving ${z} at ${where(q)}`);
            if (z === 'top') {
                await walk(q, { x: LOC.pisteTop.x, z: LOC.pisteTop.z - 1 }, 1);
                await opLoc(q, LOC.pisteTop, () => zoneOf(pos(q)) === 'icecave', 'piste top tunnel');
            } else if (z === 'icecave') {
                await troll.prayMelee(q, true);
                await walk(q, { x: LOC.iceTunnel.x, z: LOC.iceTunnel.z + 2 }, 2);
                await opLoc(q, LOC.iceTunnel, () => pos(q).z < 6400, 'ice cave tunnel to Trollheim');
            } else if (z === 'plateau') {
                // No way back up: the second slope (the sled worn) to the pocket above the Rellekka cave.
                const sled = invId(q, OBJ.waxed);
                if (sled && !wornId(q, OBJ.waxed)) await ride(q, sled);
                await walk(q, { x: LOC.barrier2.x, z: LOC.barrier2.z + 1 }, 1);
                await opLoc(q, LOC.barrier2, () => zoneOf(pos(q)) === 'pocket', 'second sled ride', 1, 3);
            } else if (z === 'pocket') {
                await walk(q, { x: LOC.exitTunnel.x, z: LOC.exitTunnel.z + 1 }, 1);
                await opLoc(q, LOC.exitTunnel, () => zoneOf(pos(q)) === 'rcave', 'exit tunnel');
            } else if (z === 'rcave') {
                await walk(q, { x: LOC.caveBottom.x + 1, z: LOC.caveBottom.z + 1 }, 2);
                await opLoc(q, LOC.caveBottom, () => pos(q).z < 6400, 'Rellekka cave tunnel');
            }
        }
    } finally {
        stop();
        await troll.prayMelee(q, false);
    }
    // The sled rides back in the pack (the tunnels unequip it anyway).
    const sled = q.sdk.getEquipment().find((i) => i.id === OBJ.waxed);
    if (sled) await q.bot.unequipItem(sled).catch(() => undefined);
    if (inRomanceArea(pos(q))) throw new Error(`romance: still in the Trollweiss area at ${where(q)}`);
}

export { FOOD };
