/**
 * Tourist Trap — Irena's daughter Ana in the desert mining camp south of the Shantay Pass.
 *
 * Content facts (quest_desertrescue/scripts/*.rs2, shantaypass.inv, desert_heat.rs2; placements
 * m49..52_46..48, m51_147):
 *   - Shantay's shop (3304,3127) sells the pass, waterskins, desert shirt/robe/boots, bronze bars,
 *     feathers and a hammer. The pass: the gate guard by (3304,3119). Waterskins drink themselves.
 *   - Irena (3303,3113), south of the pass: "What's the matter?", "What did she go into the desert
 *     for?", "I'll look for your daughter.", "Okay Irena, calm down…" (0 -> 1).
 *   - Mercenary Captain (3270,3029) outside the camp gate: the talk tree to "It's a funny captain who
 *     can't fight his own battles!" starts his fight (1 -> 3); his death gives the metal key (-> 4).
 *   - Camp gate (3273,3028-3029): the key in the pack opens it (-> 5). Inside, the guards jail anyone
 *     wearing a weapon (not a pickaxe) or armour: the pack is carried, nothing worn.
 *   - A chained slave (3287-3303,3016): "I've just arrived.", "Oh yes, that sounds interesting.",
 *     "What's that then?", "I can try to undo them for you." (-> 6), "It's funny you should say
 *     that...", "Yeah, okay, let's give it a go." (a Thieving roll, "Yeah I'll give it another go."),
 *     freed (-> 7), "Yes, I'll trade." with the desert clothes -> slave clothes (-> 8). Worn, they open
 *     the mine doors (3301,3036) -> underground (3278,9426) (-> 9).
 *   - Cave guard (3279,9415): "I'd like to mine in a different area.", "Yes sir, you're quite right
 *     sir.", "Yes sir, we understand each other perfectly." (-> 10).
 *   - Al Shabim (3171,3025), Bedabin camp: "I am looking for a pineapple.", "Yes, I'm interested."
 *     -> Bedobin key (-> 11). Captain Siad upstairs (ladder 3290,3036): search the bookcase (3284,3032)
 *     for sailing books, then "I wanted to have a chat?", "You seem to have a lot of books!", "So,
 *     you're interested in sailing?", "I could tell by the cut of your jib." distracts him; the chest
 *     (3292,3033) with the key -> plans (-> 12). Al Shabim: "Yes, I'm very interested.", "Yes, I'm kind
 *     of curious." (-> 13). The tent guard (3170,3045) lets the plans in; the anvil (3171,3048) with a
 *     bronze bar and hammer -> dart tip (Smithing 20, can waste the bar; -> 14); 10 feathers on it ->
 *     prototype dart (Fletching 10, can waste feathers; -> 15). Al Shabim takes it -> Tenti pineapple
 *     (-> 16). The cave guard takes it (-> 17); the cave mouth (3281,9415) leads deeper.
 *   - Barrel room: an empty barrel (3303,9418), the mine cart (3303,9417, Agility roll) to the lower
 *     mine (-> 18); the barrel on Ana (3302,9466) (-> 19); Ana's barrel on the cart there (3318,9430)
 *     (-> 20); ride back, search the barrels by the cart for her (-> 21); her barrel on the lift
 *     (3292,9423), the guard helps: "Yes please.", "I said you were very gregarious!" (-> 22).
 *   - Surface: the winch (3279,3017) (-> 23), the barrel (3278,3017) (-> 24), onto the cart
 *     (3287,3023) (-> 25); the cart driver's jokes end in "You can't leave me here, I'll get killed!";
 *     the cart: "Yes, I'll get on." -> outside the camp with Ana (-> 26). Irena (-> 27), two skills.
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
    feather: 314,
    waterskin: 1823,
    shirt: 1833,
    robe: 1835,
    boots: 1837,
    metalKey: 1839,
    emptyBarrel: 1841,
    anaBarrel: 1842,
    slaveShirt: 1844,
    slaveRobe: 1845,
    slaveBoots: 1846,
    dart: 1849,
    plans: 1850,
    pineapple: 1851,
    bedobinKey: 1852,
    dartTip: 1853,
    pass: 1854,
    hammer: 2347,
    bronzeBar: 2349,
} as const;

const SHANTAY = { x: 3304, z: 3127, npc: /^shantay$/i };
const SHANTAY_GATE = { x: 3304, z: 3119 };
export const IRENA = { x: 3303, z: 3113 };
const CAPTAIN = { x: 3270, z: 3029 };
const CAMP_GATE = { x: 3273, z: 3029 };
const SLAVES = { x: 3293, z: 3017 };
const MINE_DOOR = { x: 3301, z: 3036 };
const MINE_EXIT = { x: 3278, z: 9426 };
const CAVE_GUARD = { x: 3279, z: 9415 };
const MINE_CAVE = { x: 3281, z: 9415 };
const SIAD_LADDER = { x: 3290, z: 3036 };
const BOOKCASE = { x: 3284, z: 3032, level: 1 };
const SIAD_CHEST = { x: 3292, z: 3033, level: 1 };
const AL_SHABIM = { x: 3171, z: 3025 };
const TENT_GUARD = { x: 3170, z: 3045 };
const TENT_DOOR = { x: 3169, z: 3046 };
const ANVIL = { x: 3171, z: 3048 };
const LIFT = { x: 3292, z: 9423 };
const LOWER_CART = { x: 3303, z: 9417 };
const UPPER_CART = { x: 3318, z: 9430 };
const BARREL_SPOT = { x: 3303, z: 9418 };
const ANA = { x: 3302, z: 9466 };
const WINCH = { x: 3279, z: 3017 };
const UPPER_BARREL = { x: 3278, z: 3017 };
const ESCAPE_CART = { x: 3287, z: 3023 };
const CART_DRIVER = { x: 3287, z: 3022 };

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
export const held = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id);
const worn = (q: Quest, id: number) => q.sdk.getEquipment().some((i) => i.id === id);
const has = (q: Quest, id: number) => held(q, id) || worn(q, id);
const inv = (q: Quest, id: number) => q.sdk.getInventory().find((i) => i.id === id);
const countOf = (q: Quest, id: number) => q.sdk.getInventory().filter((i) => i.id === id).reduce((n, i) => n + (i.count ?? 1), 0);

/** South of the Shantay Pass (the Kharidian desert this quest uses). */
export const inDesert = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 3150, 3400, 2900, 3116);
/** The mining camp inside its fence (both floors). */
export const inCamp = (p: Tile) => inBox(p, 3274, 3310, 3010, 3045);
/** The mine under the camp. */
export const inMine = (p: Tile) => inBox(p, 3255, 3335, 9395, 9480);
export const inTouristTrapArea = (p: Tile) => inDesert(p) || inMine(p) || inCamp(p);

function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function said(q: Quest, since: number, text: RegExp): boolean {
    return (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > since && text.test(m.text));
}

async function locNear(q: Quest, at: Tile, name: RegExp, opt?: RegExp, within = 2) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => name.test(l.name) && (!opt || l.optionsWithIndex.some((o) => opt.test(o.text))))
        .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= within ? loc : undefined;
}

async function op(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string, choices: RegExp[] = [], ticks = 20): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const loc = await locNear(q, at, name, opt);
        if (!loc) {
            q.log(`tourist: ${label}: no ${name} with ${opt} near (${at.x},${at.z}) from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { done, ticks: 60, log: q.log });
        await untilTicks(q.sdk, done, 6);
    }
    if (!done()) throw new Error(`tourist: ${label} failed at ${where(q)}`);
}

const EMPTY_BARREL_LOC = 2681;
const FULL_BARREL_LOC = 2680;
/** Search (op2) the loc of type `id` nearest `at` (full and empty barrels share the name "Barrel"). */
async function opId(q: Quest, id: number, at: Tile, done: () => boolean, label: string, choices: RegExp[]): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        await q.sdk.scanNearbyLocs(10).catch(() => undefined);
        const loc = (q.sdk.getNearbyLocs() ?? []).filter((l) => l.id === id).sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
        if (!loc) {
            await q.sdk.waitForTicks(3);
            continue;
        }
        const o = loc.optionsWithIndex.find((x) => /search/i.test(x.text));
        if (!o) break;
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, o.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 15);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { ticks: 40, done, log: q.log });
        await untilTicks(q.sdk, done, 6);
    }
    if (!done()) throw new Error(`tourist: ${label} failed at ${where(q)}`);
}

async function npcNear(q: Quest, name: RegExp, at: Tile) {
    await untilTicks(q.sdk, () => !!q.sdk.findNearbyNpc(name), 8);
    return (q.sdk.getNearbyNpcs() ?? [])
        .filter((n) => name.test(n.name))
        .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
}

/** Talk to the npc nearest `at` (walking close first), driving `choices`. */
async function talkNear(q: Quest, name: RegExp, at: Tile, choices: RegExp[], done?: () => boolean): Promise<string> {
    if (Math.hypot(pos(q).x - at.x, pos(q).z - at.z) > 6) await q.bot.walkTo(at.x, at.z, 3).catch(() => undefined);
    const npc = await npcNear(q, name, at);
    if (!npc) throw new Error(`tourist: no ${name} near (${at.x},${at.z}) from ${where(q)}`);
    const r = await q.bot.talkTo(npc).catch((e) => ({ success: false, message: String(e) }));
    if (!r.success) q.log(`tourist: talk ${npc.name}: ${r.message}`);
    return driveDialog(q.sdk, choices, { ticks: 200, done, log: q.log });
}

async function useOnNpc(q: Quest, id: number, name: RegExp, at: Tile, done: () => boolean, label: string, choices: RegExp[] = []): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const item = inv(q, id);
        if (!item) throw new Error(`tourist: ${label}: no item ${id} held`);
        const npc = await npcNear(q, name, at);
        if (!npc) {
            await q.bot.walkTo(at.x, at.z, 2).catch(() => undefined);
            continue;
        }
        await q.bot.useItemOnNpc(item, npc).catch(() => undefined);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 12);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { ticks: 80, done, log: q.log });
        await untilTicks(q.sdk, done, 6);
    }
    if (!done()) throw new Error(`tourist: ${label} failed at ${where(q)}`);
}

async function useOnLoc(q: Quest, id: number, at: Tile, name: RegExp, done: () => boolean, label: string, choices: RegExp[] = []): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const item = inv(q, id);
        const loc = await locNear(q, at, name, undefined, 2);
        if (!item || !loc) throw new Error(`tourist: ${label}: item ${!!item}, loc ${!!loc} at ${where(q)}`);
        await q.bot.useItemOnLoc(item, loc).catch(() => undefined);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 12);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { ticks: 60, done, log: q.log });
        await untilTicks(q.sdk, done, 6);
    }
    if (!done()) throw new Error(`tourist: ${label} failed at ${where(q)}`);
}

// ── Kit: Shantay's shop and the pass

async function buy(q: Quest, items: Array<{ pattern: RegExp; amount: number; label: string }>): Promise<void> {
    if (!items.length) return;
    const { buyAtShop } = await import('../quest-supplies');
    await q.goTo(SHANTAY, 4);
    await buyAtShop(q.supply, SHANTAY, items).catch((e) => q.log(`tourist: Shantay's shop: ${(e as Error).message}`));
    await q.bot.closeShop().catch(() => undefined);
}

/** Before crossing south: the pass, waterskins, desert clothes (until traded), the dart's makings. */
export async function kit(q: Quest, opts: { clothes?: boolean; dart?: boolean } = {}): Promise<void> {
    if (inDesert(pos(q)) || inCamp(pos(q)) || inMine(pos(q))) return;
    const want: Array<{ pattern: RegExp; amount: number; label: string }> = [];
    if (!has(q, OBJ.pass)) want.push({ pattern: /^shantay pass$/i, amount: 1, label: 'shantay pass' });
    if (countOf(q, OBJ.waterskin) < 2) want.push({ pattern: /^waterskin\(4\)$/i, amount: 2, label: 'waterskin' });
    if (opts.clothes) {
        if (!has(q, OBJ.shirt)) want.push({ pattern: /^desert shirt$/i, amount: 1, label: 'desert shirt' });
        if (!has(q, OBJ.robe)) want.push({ pattern: /^desert robe$/i, amount: 1, label: 'desert robe' });
        if (!has(q, OBJ.boots)) want.push({ pattern: /^desert boots$/i, amount: 1, label: 'desert boots' });
    }
    if (opts.dart && !held(q, OBJ.dartTip) && !held(q, OBJ.dart)) {
        // The anvil and the feathers can each waste their input: spares.
        if (countOf(q, OBJ.bronzeBar) < 3) want.push({ pattern: /^bronze bar$/i, amount: 3, label: 'bronze bar' });
        if (!held(q, OBJ.hammer)) want.push({ pattern: /^hammer$/i, amount: 1, label: 'hammer' });
    }
    if (opts.dart && !held(q, OBJ.dart) && countOf(q, OBJ.feather) < 20) want.push({ pattern: /^feather$/i, amount: 20, label: 'feather' });
    await buy(q, want);
}

export async function intoDesert(q: Quest): Promise<void> {
    if (inDesert(pos(q)) || inCamp(pos(q)) || inMine(pos(q))) return;
    if (!has(q, OBJ.pass)) await kit(q);
    await q.goTo({ x: SHANTAY_GATE.x, z: SHANTAY_GATE.z + 2 }, 2);
    for (let attempt = 0; attempt < 3 && !inDesert(pos(q)); attempt++) {
        // The gate guard (Talk-to only), not the gate: kalphite-queen.ts's probed route.
        const guard = (q.sdk.getNearbyNpcs() ?? [])
            .filter((n) => /^shantay guard$/i.test(n.name) && !n.optionsWithIndex.some((o) => /attack/i.test(o.text)))
            .sort((a, b) => Math.hypot(a.x - SHANTAY_GATE.x, a.z - SHANTAY_GATE.z) - Math.hypot(b.x - SHANTAY_GATE.x, b.z - SHANTAY_GATE.z))[0];
        if (guard) {
            const talk = guard.optionsWithIndex.find((o) => /talk/i.test(o.text));
            if (talk) await q.sdk.sendInteractNpc(guard.index, talk.opIndex);
        } else {
            await q.sdk.scanNearbyLocs(6).catch(() => undefined);
            const gate = q.sdk.findNearbyLoc(/^shantay pass$/i, { withOption: /go-through/i });
            if (gate) await q.sdk.sendInteractLoc(gate.x, gate.z, gate.id, gate.optionsWithIndex.find((o) => /go-through/i.test(o.text))!.opIndex);
        }
        for (let i = 0; i < 30 && !inDesert(pos(q)); i++) {
            const d = q.sdk.getDialog();
            if (d?.isOpen && !d.isWaiting) {
                const pick = d.options.find((o) => /doesn't scare me|go into the desert/i.test(o.text)) ?? d.options.find((o) => /continue/i.test(o.text)) ?? d.options[0];
                if (pick) await q.sdk.sendClickDialog(pick.index);
            }
            await q.sdk.waitForTicks(1);
        }
        // From the desert side a replayed Go-through sends you north again: step away south.
        if (inDesert(pos(q))) await q.sdk.sendWalk(SHANTAY_GATE.x - 3, SHANTAY_GATE.z - 8, true).catch(() => undefined);
        await q.sdk.waitForTicks(3);
    }
    if (!inDesert(pos(q))) throw new Error(`tourist: not through the Shantay Pass (at ${where(q)})`);
}

const inTent = (q: Quest) => pos(q).z >= TENT_DOOR.z && Math.hypot(pos(q).x - ANVIL.x, pos(q).z - ANVIL.z) < 6;
/** Out of the Bedabin anvil tent: its door teleports you (bedabin_tentdoor). */
async function leaveTent(q: Quest): Promise<void> {
    if (!inTent(q)) return;
    await op(q, TENT_DOOR, /tent door/i, /./, () => !inTent(q), 'out of the tent', [], 10).catch((e) => q.log(`tourist: ${(e as Error).message}`));
}

/** Back north through the pass (free from the desert side). */
async function outOfDesert(q: Quest): Promise<void> {
    if (!inDesert(pos(q))) return;
    await leaveTent(q);
    await q.bot.walkTo(3303, 3114, 2).catch(() => undefined);
    for (let attempt = 0; attempt < 4 && inDesert(pos(q)); attempt++) {
        await q.sdk.scanNearbyLocs(8).catch(() => undefined);
        const gate = q.sdk.findNearbyLoc(/^shantay pass$/i, { withOption: /go-through/i });
        if (!gate) {
            await q.bot.walkTo(3303, 3114, 1).catch(() => undefined);
            continue;
        }
        await q.sdk.sendInteractLoc(gate.x, gate.z, gate.id, gate.optionsWithIndex.find((o) => /go-through/i.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => !inDesert(pos(q)) || !!s.dialog?.isOpen, 15);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/./], { ticks: 20, done: () => !inDesert(pos(q)) });
        await untilTicks(q.sdk, () => !inDesert(pos(q)), 8);
    }
    if (!inDesert(pos(q))) await q.sdk.sendWalk(SHANTAY_GATE.x, SHANTAY_GATE.z + 6, true).catch(() => undefined);
}

/** Nothing worn the camp guards object to: weapons (not a pickaxe) and armour off, into the pack. */
async function strip(q: Quest, keep: number[] = []): Promise<void> {
    for (const item of q.sdk.getEquipment()) {
        if (keep.includes(item.id) || /pickaxe/i.test(item.name)) continue;
        await q.bot.unequipItem(item).catch(() => undefined);
        await q.sdk.waitForTicks(1);
    }
}

async function wear(q: Quest, ids: number[]): Promise<void> {
    for (const id of ids) {
        const item = inv(q, id);
        if (!item) continue;
        await q.bot.equipItem(item).catch(() => undefined);
        await untilTicks(q.sdk, () => worn(q, id), 4);
    }
}
const slaveClothes = [OBJ.slaveShirt, OBJ.slaveRobe, OBJ.slaveBoots];
const wearingSlave = (q: Quest) => slaveClothes.every((id) => worn(q, id));

// ── 0 -> 1 -> 4

export async function startQuest(q: Quest): Promise<void> {
    await kit(q, { clothes: true });
    await intoDesert(q);
    await talkNear(q, /^irena$/i, IRENA, [/what'?s the matter/i, /what did she go into the desert for/i, /i'?ll look for your daughter/i, /okay irena,? calm down/i]);
}

const hp = (q: Quest) => q.sdk.getSkill('hitpoints')?.level ?? 99;
async function eatIfLow(q: Quest, below = 50): Promise<void> {
    for (let i = 0; i < 3 && hp(q) < below; i++) {
        const food = q.sdk.getInventory().find((it) => /^(shark|lobster|swordfish|monkfish|trout|salmon|tuna|bass)$/i.test(it.name));
        if (!food) return;
        await q.bot.eatFood(food).catch(() => undefined);
        await q.sdk.waitForTicks(2);
    }
}

/** Provoke the Mercenary Captain and kill him for the metal key. */
export async function killCaptain(q: Quest): Promise<void> {
    if (held(q, OBJ.metalKey)) return;
    await intoDesert(q);
    await q.goTo({ x: CAPTAIN.x - 3, z: CAPTAIN.z }, 3);
    const t0 = tickNow(q.sdk);
    while (!held(q, OBJ.metalKey) && tickNow(q.sdk) - t0 < 600) {
        await eatIfLow(q);
        const capt = await npcNear(q, /^mercenary captain$/i, CAPTAIN);
        if (!capt) {
            await q.sdk.waitForTicks(5);
            continue;
        }
        if (!q.sdk.getState()?.player?.combat?.inCombat) {
            await talkNear(q, /^mercenary captain$/i, { x: capt.x, z: capt.z }, [
                /wow! a real captain/i,
                /i'?d love to work for a tough guy like you/i,
                /can'?t i do something for a strong captain/i,
                /sorry sir,? i don'?t think i can do that/i,
                /it'?s a funny captain who can'?t fight his own battles/i,
            ]);
        }
        const again = await npcNear(q, /^mercenary captain$/i, CAPTAIN);
        if (again) await q.bot.attack(again).catch(() => undefined);
        await untilTicks(q.sdk, (s) => held(q, OBJ.metalKey) || !!s.dialog?.isOpen || hp(q) < 40, 60);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/yes,? i can take him on/i], { ticks: 20 });
    }
    if (!held(q, OBJ.metalKey)) throw new Error(`tourist: no metal key from the captain (at ${where(q)})`);
    q.log(`tourist: captain dead, metal key (${tickNow(q.sdk) - t0}t)`);
}

// ── the camp's cell (a failed lock-pick or a guard's search ends there)

/** The surface cell west of Siad's cell door (3287,3034): prison coord (3285,3034). */
const inCell = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 3284, 3287, 3032, 3036);

/**
 * Out of the surface cell: bend the window bar (3284,3032, a Strength roll, "Yes, I'll bend the bar."), then
 * down the rocky escarpment (ttcellclimbrock1-4, Agility rolls) to the desert west of the camp (qlqctt2 was
 * jailed at the slave's locks).
 */
export async function escapeCell(q: Quest): Promise<void> {
    if (!inCell(pos(q))) return;
    q.log(`tourist: in the camp's cell at ${where(q)} — bending the window bar`);
    for (let attempt = 1; attempt <= 8 && inCell(pos(q)); attempt++) {
        await q.sdk.sendInteractLoc(3284, 3032, 2683, 2);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 10);
        await driveDialog(q.sdk, [/yes,? i'?ll bend the bar again/i, /yes,? i'?ll bend the bar/i], { ticks: 60, done: () => !inCell(pos(q)), log: q.log });
        await untilTicks(q.sdk, () => !inCell(pos(q)), 6);
    }
    if (inCell(pos(q))) throw new Error(`tourist: still in the cell (at ${where(q)})`);
    const rocks: Array<[number, number, number]> = [[3280, 3038, 2694], [3278, 3039, 2695], [3274, 3039, 2697]];
    for (let attempt = 1; attempt <= 12 && pos(q).x > 3271; attempt++) {
        const next = rocks.find(([x]) => x < pos(q).x) ?? rocks[rocks.length - 1]!;
        await q.sdk.sendInteractLoc(next[0], next[1], next[2], 2);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || pos(q).x < next[0], 12);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/yes,? i'?ll give it a try/i], { ticks: 30, log: q.log });
        await untilTicks(q.sdk, () => pos(q).x < next[0], 8);
    }
    q.log(`tourist: out of the cell to ${where(q)}`);
}

// ── into and out of the camp

export async function intoCamp(q: Quest): Promise<void> {
    await escapeCell(q);
    if (inCamp(pos(q)) || inMine(pos(q))) return;
    // The guards' search can take the key (1 in 5): the captain drops another (mercenary_captain.rs2 defeat_merc_capt).
    if (!held(q, OBJ.metalKey)) await killCaptain(q);
    await intoDesert(q);
    await strip(q, [OBJ.shirt, OBJ.robe, OBJ.boots]);
    await q.goTo({ x: CAMP_GATE.x - 2, z: CAMP_GATE.z }, 1);
    await op(q, CAMP_GATE, /gate/i, /open/i, () => inCamp(pos(q)), 'into the mining camp', [], 15);
    await q.bot.walkTo(CAMP_GATE.x + 4, CAMP_GATE.z, 1).catch(() => undefined);
}

/** Out of the mine (slave clothes worn) and the camp (slave clothes off, key held). */
export async function leaveCamp(q: Quest): Promise<void> {
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 15 });
    await escapeCell(q);
    if (inMine(pos(q))) {
        if (!wearingSlave(q)) await wear(q, slaveClothes);
        if (pos(q).x > MINE_CAVE.x + 1 && pos(q).z < 9425) {
            // Deeper in: back through the cave mouth.
            await q.bot.walkTo(MINE_CAVE.x + 4, MINE_CAVE.z, 2).catch(() => undefined);
            await op(q, { x: 3283, z: 9415 }, /cave/i, /enter|go|walk/i, () => pos(q).x < MINE_CAVE.x, 'back through the cave mouth', [], 15).catch((e) => q.log(`tourist: ${(e as Error).message}`));
        }
        await q.bot.walkTo(MINE_EXIT.x, MINE_EXIT.z + 1, 1).catch(() => undefined);
        await op(q, MINE_EXIT, /door/i, /open/i, () => !inMine(pos(q)), 'out of the mine', [], 15);
    }
    if (inCamp(pos(q)) && pos(q).level > 0) {
        await op(q, SIAD_LADDER, /ladder/i, /climb-down/i, () => pos(q).level === 0, 'down from Siad\'s office');
    }
    if (inCamp(pos(q))) {
        // The gate guard arrests a "slave" walking out.
        for (const item of q.sdk.getEquipment()) if (slaveClothes.includes(item.id as never)) await q.bot.unequipItem(item).catch(() => undefined);
        if (!held(q, OBJ.metalKey)) throw new Error('tourist: in the camp without the metal key');
        await q.bot.walkTo(CAMP_GATE.x + 1, CAMP_GATE.z, 1).catch(() => undefined);
        await op(q, CAMP_GATE, /gate/i, /open/i, () => !inCamp(pos(q)), 'out of the mining camp', [], 15);
    }
}

export async function leaveTouristTrap(q: Quest): Promise<void> {
    await leaveCamp(q);
    await outOfDesert(q);
}

// ── 5 -> 8: the slave's clothes

export async function slaveClothesTrade(q: Quest): Promise<void> {
    if (has(q, OBJ.slaveShirt) && has(q, OBJ.slaveRobe) && has(q, OBJ.slaveBoots)) return;
    await intoCamp(q);
    await q.bot.walkTo(SLAVES.x, SLAVES.z + 1, 2).catch(() => undefined);
    const done = () => has(q, OBJ.slaveShirt) && has(q, OBJ.slaveRobe) && has(q, OBJ.slaveBoots);
    for (let attempt = 1; attempt <= 6 && !done(); attempt++) {
        // Caught at the locks: out of the cell and back in through the gate.
        if (inCell(pos(q))) {
            await escapeCell(q);
            if (!held(q, OBJ.metalKey)) await killCaptain(q);
            await intoCamp(q);
        }
        await talkNear(q, /^male slave$/i, SLAVES, [
            /i'?ve just arrived/i,
            /oh yes,? that sounds interesting/i,
            /what'?s that then/i,
            /i can try to undo them for you/i,
            /it'?s funny you should say that/i,
            /yeah,? okay,? let'?s give it a go/i,
            /yeah i'?ll give it another go/i,
            /yes,? i'?ll trade/i,
        ], done);
    }
    if (!done()) throw new Error(`tourist: no slave clothes (at ${where(q)})`);
}

export async function intoMine(q: Quest): Promise<void> {
    if (inMine(pos(q))) return;
    await intoCamp(q);
    await wear(q, slaveClothes);
    if (!wearingSlave(q)) throw new Error('tourist: slave clothes not worn');
    await q.bot.walkTo(MINE_DOOR.x, MINE_DOOR.z - 1, 1).catch(() => undefined);
    await op(q, MINE_DOOR, /door/i, /open/i, () => inMine(pos(q)), 'the mine doors', [], 15);
}

export async function caveGuardPineappleTalk(q: Quest): Promise<void> {
    await intoMine(q);
    await talkNear(q, /^mercenary$/i, CAVE_GUARD, [/i'?d like to mine in a different area/i, /yes sir,? you'?re quite right sir/i, /yes sir,? we understand each other perfectly/i]);
}

// ── 10 -> 16: Al Shabim, Siad's plans, the dart

export async function shabimKey(q: Quest): Promise<void> {
    await leaveCamp(q);
    await intoDesert(q);
    await talkNear(q, /^al shabim$/i, AL_SHABIM, [/i am looking for a pineapple/i, /yes,? i'?m interested/i]);
}

export async function siadPlans(q: Quest): Promise<void> {
    if (held(q, OBJ.plans)) return;
    await intoCamp(q);
    if (pos(q).level === 0) {
        await q.bot.walkTo(SIAD_LADDER.x, SIAD_LADDER.z - 1, 1).catch(() => undefined);
        await op(q, SIAD_LADDER, /ladder/i, /climb-up/i, () => pos(q).level === 1, 'up to Siad\'s office');
    }
    // The sailing books (a mesbox) unlock Siad's sailing talk: wait for the box, not just the click.
    await q.bot.walkTo(BOOKCASE.x + 1, BOOKCASE.z, 1).catch(() => undefined);
    await op(q, BOOKCASE, /bookcase/i, /search/i, () => !!q.sdk.getDialog()?.isOpen, 'the sailing books', [], 15).catch((e) => q.log(`tourist: ${(e as Error).message}`));
    await driveDialog(q.sdk, [], { ticks: 10 });
    for (let attempt = 1; attempt <= 4 && !held(q, OBJ.plans); attempt++) {
        await talkNear(q, /^captain siad$/i, { x: 3291, z: 3032 }, [
            /i wanted to have a chat/i,
            /you seem to have a lot of books/i,
            /so,? you'?re interested in sailing/i,
            /i could tell by the cut of your jib/i,
        ]);
        await op(q, SIAD_CHEST, /^chest$/i, /open/i, () => held(q, OBJ.plans) || !!q.sdk.getDialog()?.isOpen, 'Siad\'s chest', [], 10).catch(() => undefined);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 20 });
        if (!held(q, OBJ.plans) && held(q, OBJ.bedobinKey)) {
            // Distracted again, then the key on the chest.
            await talkNear(q, /^captain siad$/i, { x: 3291, z: 3032 }, [/i wanted to have a chat/i, /you seem to have a lot of books/i, /so,? you'?re interested in sailing/i, /i could tell by the cut of your jib/i]);
            await useOnLoc(q, OBJ.bedobinKey, SIAD_CHEST, /^chest$/i, () => held(q, OBJ.plans) || !!q.sdk.getDialog()?.isOpen, 'the Bedobin key on the chest').catch(() => undefined);
            if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 20 });
        }
    }
    if (!held(q, OBJ.plans)) throw new Error(`tourist: no plans from Siad's chest (at ${where(q)})`);
}

export async function plansToShabim(q: Quest): Promise<void> {
    await leaveCamp(q);
    await intoDesert(q);
    await talkNear(q, /^al shabim$/i, AL_SHABIM, [/yes,? i'?m very interested/i, /yes,? i'?m kind of curious/i]);
}

export async function makeDart(q: Quest, stageMoved: () => Promise<boolean>): Promise<void> {
    if (held(q, OBJ.dart)) return;
    await intoDesert(q);
    if (!held(q, OBJ.dartTip)) {
        const inTent = () => pos(q).z >= TENT_DOOR.z && Math.hypot(pos(q).x - ANVIL.x, pos(q).z - ANVIL.z) < 6;
        if (!inTent()) {
            await useOnNpc(q, OBJ.plans, /^bedabin nomad guard$/i, TENT_GUARD, inTent, 'the plans to the tent guard').catch(async () => {
                await talkNear(q, /^bedabin nomad guard$/i, TENT_GUARD, [], inTent);
            });
        }
        for (let attempt = 1; attempt <= 4 && !held(q, OBJ.dartTip); attempt++) {
            if (!held(q, OBJ.bronzeBar)) throw new Error('tourist: out of bronze bars for the dart tip');
            const bar = inv(q, OBJ.bronzeBar)!;
            const anvil = await locNear(q, ANVIL, /anvil/i, undefined, 3);
            if (!anvil) throw new Error(`tourist: no anvil in the tent (at ${where(q)})`);
            await q.bot.useItemOnLoc(bar, anvil).catch(() => undefined);
            // "Do you want to follow the technical plans?" then "Yes, I'd like to try."; ~10 ticks of smithing.
            await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 12);
            await driveDialog(q.sdk, [/yes,? i'?d like to try/i], { ticks: 60, done: () => held(q, OBJ.dartTip), log: q.log });
            await untilTicks(q.sdk, () => held(q, OBJ.dartTip), 20);
            if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 15 });
        }
        if (!held(q, OBJ.dartTip)) throw new Error('tourist: no dart tip from the anvil');
    }
    // Feathers short (a run resumed in the camp skips kit(); wasted feathers): Shantay's shop sells them
    // (shantaypass.inv stock 500), else the usual feather source (ABGARMY05, 2026-11-05).
    if (!held(q, OBJ.dart) && countOf(q, OBJ.feather) < 10) {
        q.log(`tourist: ${countOf(q, OBJ.feather)} feathers for the dart — buying 20 at Shantay's`);
        await buy(q, [{ pattern: /^feather$/i, amount: 20 - countOf(q, OBJ.feather), label: 'feather' }]);
        if (countOf(q, OBJ.feather) < 10) await q.ensure('feather', 20).catch((e) => q.log(`tourist: feathers: ${(e as Error).message}`));
    }
    for (let attempt = 1; attempt <= 4 && !held(q, OBJ.dart); attempt++) {
        const f = inv(q, OBJ.feather);
        const tip = inv(q, OBJ.dartTip);
        if (!f || !tip || countOf(q, OBJ.feather) < 10) throw new Error('tourist: no feathers or tip for the dart');
        await q.sdk.sendUseItemOnItem(f.slot, tip.slot);
        await untilTicks(q.sdk, (s) => held(q, OBJ.dart) || !!s.dialog?.isOpen, 10);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 20 });
        await untilTicks(q.sdk, () => held(q, OBJ.dart), 6);
    }
    if (!held(q, OBJ.dart)) throw new Error('tourist: the feathers would not go on');
    void stageMoved;
}

export async function dartToShabim(q: Quest): Promise<void> {
    await intoDesert(q);
    // Out of the tent first (its door teleports).
    if (pos(q).z >= TENT_DOOR.z && Math.hypot(pos(q).x - ANVIL.x, pos(q).z - ANVIL.z) < 6) {
        await op(q, TENT_DOOR, /./, /open|walk|enter|go/i, () => pos(q).z < TENT_DOOR.z, 'out of the tent', [], 10).catch(() => undefined);
    }
    await talkNear(q, /^al shabim$/i, AL_SHABIM, [/i am looking for a pineapple/i], () => held(q, OBJ.pineapple));
    if (!held(q, OBJ.pineapple)) await talkNear(q, /^al shabim$/i, AL_SHABIM, [/i am looking for a pineapple/i], () => held(q, OBJ.pineapple));
}

export async function pineappleToGuard(q: Quest): Promise<void> {
    if (!held(q, OBJ.pineapple)) {
        await leaveCamp(q);
        await intoDesert(q);
        await talkNear(q, /^al shabim$/i, AL_SHABIM, [/i am looking for a pineapple/i], () => held(q, OBJ.pineapple));
    }
    await intoMine(q);
    await talkNear(q, /^mercenary$/i, CAVE_GUARD, [], () => !held(q, OBJ.pineapple));
}

// ── 17 -> 26: Ana

async function deeper(q: Quest): Promise<void> {
    await intoMine(q);
    if (pos(q).x > MINE_CAVE.x + 1) return;
    await q.bot.walkTo(MINE_CAVE.x - 1, MINE_CAVE.z, 1).catch(() => undefined);
    const cave = await locNear(q, MINE_CAVE, /.+/, /enter|go|walk/i, 3);
    if (!cave) throw new Error(`tourist: no cave mouth at ${where(q)}`);
    await op(q, { x: cave.x, z: cave.z }, new RegExp(`^${cave.name}$`, 'i'), /enter|go|walk/i, () => pos(q).x > MINE_CAVE.x + 1, 'into the deeper mine', [], 15);
}

async function rideCart(q: Quest, cart: Tile, done: () => boolean): Promise<void> {
    for (let attempt = 1; attempt <= 8 && !done(); attempt++) {
        await q.bot.walkTo(cart.x, cart.z + 1, 1).catch(() => undefined);
        await op(q, cart, /mine cart/i, /search/i, () => done() || !!q.sdk.getDialog()?.isOpen, 'the mine cart', [], 10).catch(() => undefined);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/yes,? of course/i], { ticks: 40, done });
        await untilTicks(q.sdk, done, 6);
    }
    if (!done()) throw new Error(`tourist: the mine cart ride failed at ${where(q)}`);
}

const nearLowerCart = (q: Quest) => Math.hypot(pos(q).x - LOWER_CART.x, pos(q).z - LOWER_CART.z) < 12;
const inAnaRoom = (q: Quest) => pos(q).x >= 3296 && pos(q).z >= 9425 && inMine(pos(q));

export async function rescueAna(q: Quest): Promise<void> {
    await deeper(q);
    let s = held(q, OBJ.anaBarrel) ? 'caught' : 'deeper';
    q.log(`tourist: rescue from stage ${s} at ${where(q)}`);
    if (s === 'deeper' || s === 'cart' || s === 'caught') {
        if (s !== 'caught' && !held(q, OBJ.anaBarrel)) {
            if (!held(q, OBJ.emptyBarrel)) {
                if (inAnaRoom(q)) throw new Error('tourist: in the lower mine without a barrel');
                await q.bot.walkTo(BARREL_SPOT.x - 1, BARREL_SPOT.z, 1).catch(() => undefined);
                await opId(q, EMPTY_BARREL_LOC, BARREL_SPOT, () => held(q, OBJ.emptyBarrel), 'an empty barrel', [/yeah,? cool/i]);
            }
            if (!inAnaRoom(q)) await rideCart(q, LOWER_CART, () => inAnaRoom(q));
            await q.bot.walkTo(ANA.x, ANA.z - 2, 3).catch(() => undefined);
            await useOnNpc(q, OBJ.emptyBarrel, /^ana$/i, ANA, () => held(q, OBJ.anaBarrel), 'the barrel on Ana', []);
        }
        // Her barrel on the cart that runs back to the barrel room.
        if (!inAnaRoom(q)) throw new Error(`tourist: Ana's barrel held outside the lower mine (${where(q)})`);
        await q.bot.walkTo(UPPER_CART.x, UPPER_CART.z + 1, 1).catch(() => undefined);
        await useOnLoc(q, OBJ.anaBarrel, UPPER_CART, /mine cart/i, () => !held(q, OBJ.anaBarrel), 'Ana on the mine cart');
        s = 'minecart';
    }
    if (s === 'minecart' || s === 'retrieved') {
        if (inAnaRoom(q)) await rideCart(q, UPPER_CART, () => nearLowerCart(q) && !inAnaRoom(q));
        if (!held(q, OBJ.anaBarrel)) {
            // Any empty barrel within 3 of the cart (3303,9417) hands her back.
            await opId(q, EMPTY_BARREL_LOC, BARREL_SPOT, () => held(q, OBJ.anaBarrel), 'Ana\'s barrel by the cart', []).catch((e) => q.log(`tourist: ${(e as Error).message}`));
        }
        if (!held(q, OBJ.anaBarrel)) throw new Error('tourist: Ana\'s barrel not found by the cart');
        await q.bot.walkTo(LIFT.x - 1, LIFT.z, 2).catch(() => undefined);
        await useOnLoc(q, OBJ.anaBarrel, LIFT, /winch bucket/i, () => !held(q, OBJ.anaBarrel), 'Ana on the lift', [/yes please/i, /i said you were very gregarious/i]);
    }
}

export async function anaUpTop(q: Quest): Promise<void> {
    // Up and out of the mine (back through the cave mouth and the doors), slave clothes still worn.
    if (inMine(pos(q))) await leaveMineToCamp(q);
    if (!held(q, OBJ.anaBarrel)) {
        await q.bot.walkTo(WINCH.x + 1, WINCH.z + 1, 1).catch(() => undefined);
        const since = cursor(q);
        await op(q, WINCH, /winch/i, /operate|pull|use/i, () => said(q, since, /pull on the winch/i) || !!q.sdk.getDialog()?.isOpen, 'the winch', [], 12).catch(() => undefined);
        await driveDialog(q.sdk, [], { ticks: 30 });
        await opId(q, FULL_BARREL_LOC, UPPER_BARREL, () => held(q, OBJ.anaBarrel), 'Ana\'s barrel by the winch', []);
    }
    await q.bot.walkTo(ESCAPE_CART.x - 1, ESCAPE_CART.z, 1).catch(() => undefined);
    await useOnLoc(q, OBJ.anaBarrel, ESCAPE_CART, /cart/i, () => !held(q, OBJ.anaBarrel), 'Ana on the camp cart');
}

async function leaveMineToCamp(q: Quest): Promise<void> {
    if (!wearingSlave(q)) await wear(q, slaveClothes);
    if (pos(q).x > MINE_CAVE.x + 1) {
        await q.bot.walkTo(3285, 9415, 1).catch(() => undefined);
        const cave = await locNear(q, { x: 3283, z: 9415 }, /.+/, /enter|go|walk/i, 3);
        if (cave) await op(q, { x: cave.x, z: cave.z }, new RegExp(`^${cave.name}$`, 'i'), /enter|go|walk/i, () => pos(q).x <= MINE_CAVE.x, 'back through the cave mouth', [], 15);
    }
    await q.bot.walkTo(MINE_EXIT.x, MINE_EXIT.z + 1, 1).catch(() => undefined);
    await op(q, MINE_EXIT, /door/i, /open/i, () => !inMine(pos(q)), 'out of the mine', [], 15);
}

export async function cartEscape(q: Quest): Promise<void> {
    if (held(q, OBJ.anaBarrel) && !inCamp(pos(q))) return;
    await talkNear(q, /^mine cart driver$/i, CART_DRIVER, [
        /nice cart/i,
        /one wagon wheel says to the other/i,
        /'?one good turn deserves another'?/i,
        /fired\.\.\. no,? shot perhaps/i,
        /in for a penny in for a pound/i,
        /well,? you see,? it'?s like this/i,
        /prison riot in ten minutes/i,
        /you can'?t leave me here,? i'?ll get killed/i,
    ]);
    await op(q, ESCAPE_CART, /cart/i, /search/i, () => !inCamp(pos(q)), 'onto the cart', [/yes,? i'?ll get on/i], 15);
}

export async function anaToIrena(q: Quest, done: () => Promise<boolean>): Promise<void> {
    await strip(q, []);
    if (!inDesert(pos(q))) {
        await kit(q);
        await intoDesert(q);
    }
    await talkNear(q, /^irena$/i, IRENA, [/^agility\.?$/i, /^thieving\.?$/i, /^fletching\.?$/i, /^smithing\.?$/i]);
    for (let i = 0; i < 2 && !(await done()); i++) await talkNear(q, /^irena$/i, IRENA, [/^agility\.?$/i, /^thieving\.?$/i]);
}
