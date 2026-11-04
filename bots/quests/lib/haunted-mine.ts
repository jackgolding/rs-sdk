/**
 * Haunted Mine — the route and mechanics (bots/quests/haunted-mine.ts is the definition).
 *
 * Content facts (quest_hauntedmine/scripts/*.rs2, configs/hauntedmine.constant); the in-mine route and its loc
 * coordinates follow rs-stun-toolkit's q-haunted-mine.ts spec, every id and tile re-checked against the maps:
 *   - The Zealot (1528, 3444,3258) south of Mort'ton: "I follow the path of Saradomin." / "I come seeking challenges
 *     and quests." / "What quest is that then?" (-> 1) / "Is there any other way into the mines?" (the heard-about-key
 *     bit); then Pickpocket (op3, no roll) for the Zealot's key.
 *   - Surface: the obstacle cart (4918, 3445,3236) from the east lands west; the secondary entrance (4913, 3440,3232)
 *     -> 53_150 east (-> 3); out at back entrance 1 (4921, 3404,9631 -> 3429,3233), in at back entrance 2 (4915,
 *     3429,3225 -> 3409,9623); ladder 4965 (3422,9625) -> 43_71; ladder 4969 (2798,4567) -> 42_70; the cart corridor
 *     (cart 1545 on x=2727) south; ladder 4967 (2725,4486) -> region A (43_70) with the fungus pool and the points.
 *   - Points: 8 lever bits start random. Success needs b=1 d=0 a=1 c=0 j=0 (hauntedmine_points.rs2): !b sinks, d sinks,
 *     !a comes right back, c sinks, j sinks. The controls (loc 4949, 2769,4522; interface 11485) Test button (11708)
 *     runs the empty cart; the messages say sunk / came back / nothing (through). Levers: loc 4949+k toggles bit k.
 *   - The glowing fungus crumbles in daylight: it rides the cart (4974, 2778,4506) to the end cart (4974, 2774,4537)
 *     in region C, reached round by the surface. Region C -> 42_70 (cart 1548 at x=2739) -> region B: the Zealot's key
 *     on the valve (4924, 2808,4496; -> 4), the lift (4937, 2807,4494; -> 5) drops into the flooded level 42_69.
 *   - The dark stairs (4971, 2746,4436) WITH the fungus -> the boss level (-> 7). The key (npc 1543, 2788,4455) Take:
 *     Treus Dayth (1540 solid / 1541 faded, 100 hp, defence 100, undead) appears (-> 8); he hops between six spots and
 *     only his death as the solid type runs boss_death (-> 9, "As you make the killing strike..."). Take the key again.
 *   - The reward doors (4963/4964, 2773/2772,4450) face the west landing: out the boss door (4962, 2799,4453), up the
 *     east light stairs (4973, 2812,4452), along 42_69 to the west dark stairs (4971, 2692,4436) -> through (-> 10).
 *     Op a crystal (4928, 2788,4428) with a chisel: the salve shard, quest complete.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

const NPC = { zealot: 1528, boss: 1540, bossFaded: 1541, key: 1543, cart1545: 1545, cart1548: 1548 } as const;
const CONTROLS = 11485;
const TEST_BUTTON = 11708;
const CRUMBLE_UNDEAD = 1171;
const VARROCK_TELEPORT = 1164;
const FALADOR_TELEPORT = 1170;
const CAMELOT_TELEPORT = 1174;
const LUMBRIDGE_TELEPORT = 1167;
const MAGIC_TAB = 6;

export const ZEALOT = { x: 3444, z: 3257 };
const LEVERS: Record<number, Tile> = {
    1: { x: 2785, z: 4517 },
    2: { x: 2784, z: 4517 },
    3: { x: 2786, z: 4517 },
    4: { x: 2786, z: 4515 },
    5: { x: 2785, z: 4515 },
    6: { x: 2768, z: 4533 },
    7: { x: 2769, z: 4533 },
    8: { x: 2770, z: 4533 },
};
/** Bit (lever number) of each state letter that matters. */
const BIT = { b: 1, a: 2, c: 3, d: 4, j: 7 } as const;
type Letter = keyof typeof BIT;
const LETTERS = Object.keys(BIT) as Letter[];

const RE = {
    liftKey: /^zealot's key$/i,
    rewardKey: /^crystal-mine key$/i,
    fungus: /^glowing fungus$/i,
    chisel: /^chisel$/i,
    food: /^(shark|manta ray|monkfish|swordfish|lobster|bass|tuna|trout|salmon)$/i,
    junk: /^(rotten food|ashes|damp tinderbox|bones)$/i,
};

const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

// ── regions
/** Mort'ton's surface south of Mort Myre: the Zealot, the carts, the tunnels. */
const onMorttonSurface = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 3400, 3470, 3200, 3289);
const southOfCarts = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 3436, 3444, 3229, 3238);
const in53 = (p: Tile) => inBox(p, 3392, 3455, 9600, 9663);
const in53W = (p: Tile) => in53(p) && p.x >= 3405 && p.z <= 9628;
const in4371 = (p: Tile) => inBox(p, 2752, 2815, 4544, 4607);
const in4270 = (p: Tile) => inBox(p, 2688, 2751, 4480, 4543);
const in4370 = (p: Tile) => inBox(p, 2752, 2815, 4480, 4543);
const inRegionC = (p: Tile) => inBox(p, 2765, 2785, 4534, 4543);
/** The flooded lift level (42_69). */
const inLiftLevel = (p: Tile) => inBox(p, 2688, 2751, 4416, 4479);
/** Treus Dayth's level (43_69). */
const inBossLevel = (p: Tile) => inBox(p, 2752, 2815, 4416, 4479);
const inBossRoom = (p: Tile) => inBox(p, 2775, 2798, 4439, 4470);
/** The dark landing a lightless trip down the dark stairs sends you to (hauntedmine_darkstairs.rs2: 42_71). */
const inDarkLanding = (p: Tile) => inBox(p, 2688, 2751, 4544, 4607);
const inMine = (p: Tile) => in53(p) || in4371(p) || in4270(p) || in4370(p) || inLiftLevel(p) || inBossLevel(p) || inDarkLanding(p);
export const inHauntedMineArea = (p: Tile) => inMine(p) || onMorttonSurface(p);

const inv = (q: Quest) => q.sdk.getInventory();
const held = (q: Quest, re: RegExp) => inv(q).filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const item = (q: Quest, re: RegExp) => inv(q).find((i) => re.test(i.name));
export const hasFungus = (q: Quest) => held(q, RE.fungus) > 0;
export const hasLiftKey = (q: Quest) => held(q, RE.liftKey) > 0;
export const hasRewardKey = (q: Quest) => held(q, RE.rewardKey) > 0;

const messagesSince = (q: Quest, t0: number) => (q.sdk.getState()?.gameMessages ?? []).filter((m) => m.tick >= t0).map((m) => m.text);
const heard = (q: Quest, t0: number, re: RegExp) => messagesSince(q, t0).some((m) => re.test(m));
/** Message cursor by publication revision: a repeated message (the lever's, the cart's) is still seen as new. */
const msgCursor = (q: Quest) => Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
const heardAfter = (q: Quest, cursor: number, re: RegExp) => (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > cursor && re.test(m.text));
const npcsById = (q: Quest, ...ids: number[]) => (q.sdk.getNearbyNpcs() ?? []).filter((n) => ids.includes(n.id)).sort((a, b) => a.distance - b.distance);
const npcTile = (n: { x: number; z: number; tileX?: number; tileZ?: number }) => ({ x: n.tileX ?? n.x, z: n.tileZ ?? n.z });

async function locById(q: Quest, id: number, at: Tile, within = 2) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? []).filter((l) => l.id === id).sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= within ? loc : undefined;
}

async function closeDialogs(q: Quest): Promise<void> {
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    if (q.sdk.getState()?.interface?.isOpen) await q.sdk.sendCloseModal().catch(() => undefined);
}

async function walk(q: Quest, t: Tile, tolerance = 1): Promise<boolean> {
    for (let i = 0; i < 3 && cheb(pos(q), t) > tolerance; i++) {
        await q.bot.walkTo(t.x, t.z, tolerance).catch(() => undefined);
        if (cheb(pos(q), t) > tolerance) await q.sdk.waitForTicks(2);
    }
    return cheb(pos(q), t) <= tolerance;
}

/** Op1 loc `id` at (x,z) until `done` (blind when the scan does not show it; the client routes to it). */
async function opLoc(q: Quest, id: number, at: Tile, done: () => boolean, label: string, opts: { stand?: Tile; tries?: number; ticks?: number } = {}): Promise<void> {
    for (let attempt = 1; attempt <= (opts.tries ?? 5) && !done(); attempt++) {
        await closeDialogs(q);
        if (opts.stand) await walk(q, opts.stand, 0);
        else if (cheb(pos(q), at) > 12) await walk(q, at, 2);
        const loc = await locById(q, id, at);
        await q.sdk.sendInteractLoc(loc?.x ?? at.x, loc?.z ?? at.z, id, 1);
        await untilTicks(q.sdk, done, opts.ticks ?? 20);
    }
    await closeDialogs(q).catch(() => undefined);
    if (!done()) throw new Error(`hm: ${label} failed at ${where(q)}`);
}

async function eatIfLow(q: Quest, below = 0.55): Promise<void> {
    const hp = q.sdk.getSkill('hitpoints');
    if (!hp || hp.level > hp.baseLevel * below) return;
    const food = item(q, RE.food);
    if (food) await q.bot.eatFood(food).catch(() => undefined);
}

/** Wielded, the weapon frees the pack slot the fungus, the keys and the shard need. */
async function wieldWeapon(q: Quest): Promise<void> {
    const w = item(q, /scimitar|longsword|sword|battleaxe|mace|warhammer|whip/i);
    if (w) await q.bot.equipItem(w).catch(() => undefined);
}

async function setRetaliate(q: Quest, on: boolean): Promise<void> {
    const now = q.sdk.getState()?.autoRetaliateEnabled;
    if (now === undefined || now === on) return;
    for (let attempt = 1; attempt <= 3 && q.sdk.getState()?.autoRetaliateEnabled !== on; attempt++) {
        await q.sdk.sendSetTab(12).catch(() => undefined);
        await q.sdk.waitForTicks(1);
        await q.sdk.sendClickComponent(on ? 150 : 151);
        await untilTicks(q.sdk, (s) => s.autoRetaliateEnabled === on, 4);
    }
    await q.sdk.sendSetTab(3).catch(() => undefined);
}

// ── getting there and away

/** From the Varrock side: under the Salve, through Mort Myre, south to the Zealot (lib/nature-spirit.ts intoSwamp). */
export async function toMortton(q: Quest): Promise<void> {
    if (onMorttonSurface(pos(q)) || inMine(pos(q))) return;
    const { intoSwamp } = await import('./nature-spirit');
    // The Mort Myre gate opens only once Nature Spirit is started (quest_druidspirit.rs2 open_mortmyre_gate).
    await intoSwamp(q).catch((e: Error) => {
        throw new Error(`hm: ${e.message} — Mort Myre's gate needs Nature Spirit started (bots/quests/nature-spirit.ts)`);
    });
    // walkTo, not goTo: goTo leaves Nature Spirit's swamp for the Varrock side first.
    for (let i = 0; i < 4 && !onMorttonSurface(pos(q)); i++) await q.bot.walkTo(ZEALOT.x, ZEALOT.z, 3).catch(() => undefined);
    if (!onMorttonSurface(pos(q))) throw new Error(`hm: could not cross Mort Myre to Mort'ton (at ${where(q)})`);
    q.log(`hm: at Mort'ton ${where(q)}`);
}

/** Teleport out (Varrock, else Falador/Camelot/Lumbridge) from the mine or Mort'ton. */
export async function leaveHauntedMine(q: Quest): Promise<void> {
    if (!inHauntedMineArea(pos(q))) return;
    await closeDialogs(q);
    await setRetaliate(q, true);
    if (q.sdk.isPrayerActive('protect_from_missiles')) await q.bot.deactivatePrayer('protect_from_missiles').catch(() => undefined);
    const magic = q.level('magic');
    const c = (re: RegExp) => held(q, re);
    const law = c(/^law rune$/i);
    const air = c(/^air rune$/i);
    const options = [
        { name: 'Varrock', id: VARROCK_TELEPORT, ok: magic >= 25 && law >= 1 && air >= 3 && c(/^fire rune$/i) >= 1 },
        { name: 'Falador', id: FALADOR_TELEPORT, ok: magic >= 37 && law >= 1 && air >= 3 && c(/^water rune$/i) >= 1 },
        { name: 'Camelot', id: CAMELOT_TELEPORT, ok: magic >= 45 && law >= 1 && air >= 5 },
        { name: 'Lumbridge', id: LUMBRIDGE_TELEPORT, ok: magic >= 31 && law >= 1 && air >= 3 && c(/^earth rune$/i) >= 1 },
    ].filter((o) => o.ok);
    for (const spell of options) {
        for (let attempt = 1; attempt <= 3 && inHauntedMineArea(pos(q)); attempt++) {
            await q.sdk.sendSetTab(MAGIC_TAB).catch(() => undefined);
            await q.sdk.waitForTicks(1);
            await q.sdk.sendClickComponent(spell.id);
            await untilTicks(q.sdk, () => !inHauntedMineArea(pos(q)), 8);
        }
        if (!inHauntedMineArea(pos(q))) {
            q.log(`hm: ${spell.name} Teleport out to ${where(q)}`);
            return;
        }
    }
    if (inHauntedMineArea(pos(q)) && onMorttonSurface(pos(q))) {
        // No runes: north into Mort Myre; run-quest's Nature Spirit hook takes it from the swamp.
        await q.bot.walkTo(3429, 3330, 3).catch(() => undefined);
        if (!inHauntedMineArea(pos(q))) {
            // run-quest's Nature Spirit hook has already run for this walk: the swamp's own way out now.
            const { leaveNatureSpirit } = await import('./nature-spirit');
            await leaveNatureSpirit(q);
            return;
        }
    }
    throw new Error(`hm: no teleport out of the mine (law ${law}, air ${air}; at ${where(q)})`);
}

// ── the Zealot

export async function start(q: Quest): Promise<void> {
    await toMortton(q);
    await q.talk(/^zealot$/i, [/^i follow the path of saradomin/i, /^i come seeking challenges/i, /^what quest is that then/i, /^is there any other way into the mines/i], ZEALOT);
    await closeDialogs(q);
}

/** Hear about the key (the bit), then pick his pocket for it. */
export async function liftKey(q: Quest): Promise<void> {
    if (hasLiftKey(q)) return;
    await toMortton(q);
    await q.talk(/^zealot$/i, [/^is there any other way into the mines/i, /^i follow the path of saradomin/i], ZEALOT);
    await closeDialogs(q);
    for (let attempt = 0; attempt < 5 && !hasLiftKey(q); attempt++) {
        const z = npcsById(q, NPC.zealot)[0];
        if (!z) {
            await q.goTo(ZEALOT, 3);
            continue;
        }
        const t0 = tickNow(q.sdk);
        await q.sdk.sendInteractNpc(z.index, 3);
        await untilTicks(q.sdk, () => hasLiftKey(q) || heard(q, t0, /doubt he's got much|already picked/i), 12);
        if (heard(q, t0, /doubt he's got much/i)) {
            await q.talk(/^zealot$/i, [/^is there any other way into the mines/i], ZEALOT);
            await closeDialogs(q);
        }
    }
    if (!hasLiftKey(q)) throw new Error(`hm: no Zealot's key from his pocket (at ${where(q)})`);
    q.log('hm: Zealot\'s key');
}

/** Over the obstacle cart and through the secondary entrance (-> 3). */
export async function intoMine(q: Quest): Promise<void> {
    await toMortton(q);
    if (onMorttonSurface(pos(q)) && !southOfCarts(pos(q))) {
        await walk(q, { x: 3446, z: 3236 }, 1);
        await opLoc(q, 4918, { x: 3445, z: 3236 }, () => southOfCarts(pos(q)), 'the obstacle cart', { ticks: 12 });
    }
    if (onMorttonSurface(pos(q))) await opLoc(q, 4913, { x: 3440, z: 3232 }, () => in53(pos(q)), 'the secondary entrance');
}

// ── the cart corridors

/**
 * Cart 1545 shuttles x=2727 z 4491..4509 in the single-file corridor to region A; whoever stands before it is pushed
 * along. Hop alcove to alcove (2726,4489) (2726,4496) (2728,4503) (2728,4510) when it is behind us, or beyond the hop
 * and moving away or far enough.
 */
const CORRIDOR = [
    { x: 2726, z: 4489 },
    { x: 2726, z: 4496 },
    { x: 2728, z: 4503 },
    { x: 2728, z: 4510 },
];
async function crossCorridor(q: Quest, south: boolean): Promise<void> {
    const stops = south ? [...CORRIDOR].reverse() : [...CORRIDOR];
    await walk(q, stops[0]!, 0);
    for (let i = 1, guard = 0; i < stops.length && guard < 12; i++, guard++) {
        const from = stops[i - 1]!;
        const to = stops[i]!;
        const s = south ? -1 : 1;
        const need = Math.ceil(Math.abs(to.z - from.z) / 2) + 2;
        let prev = -1;
        for (let k = 0; k < 80; k++) {
            const c = npcsById(q, NPC.cart1545)[0];
            if (!c) break;
            const cz = npcTile(c).z;
            const dir = prev < 0 ? 0 : Math.sign(cz - prev);
            prev = cz;
            const behind = (cz - from.z) * s < 0;
            const beyond = (cz - to.z) * s > 0;
            if (k > 0 && (behind || (beyond && (dir === s || (cz - to.z) * s >= need + 1)))) break;
            await q.sdk.waitForTicks(1);
        }
        await q.bot.walkTo(to.x, to.z, 0).catch(() => undefined);
        if (cheb(pos(q), to) > 0) i = Math.max(0, i - 2); // pushed back: again from the stop before
    }
    if (cheb(pos(q), stops[stops.length - 1]!) > 1) throw new Error(`hm: the cart corridor beat us (at ${where(q)})`);
}

/**
 * Cart 1548 shuttles x=2739 z 4528..4531 across the way from 42_70 north to the ladder down to region B (2732,4529).
 * Go when it sits at its south end (or is stepping onto it): we run 2 tiles a tick behind it. A push just costs a
 * tile and 0-2 hp, so keep trying (the spec's one-shot timing failed locally at (2739,4532), qlqehm3).
 */
async function passCart1548(q: Quest): Promise<void> {
    const past = () => pos(q).z <= 4528 && pos(q).x <= 2738;
    const seen: number[] = [];
    for (let attempt = 0; attempt < 12 && !past(); attempt++) {
        if (cheb(pos(q), { x: 2738, z: 4533 }) > 2 && pos(q).z > 4528) await walk(q, { x: 2738, z: 4533 }, 0);
        let prev = -1;
        for (let k = 0; k < 30; k++) {
            const c = npcsById(q, NPC.cart1548)[0];
            if (!c) break;
            const cz = npcTile(c).z;
            if (seen.length < 40) seen.push(cz);
            if (cz <= 4528 || (prev > cz && cz <= 4529)) break;
            prev = cz;
            await q.sdk.waitForTicks(1);
        }
        await q.sdk.sendWalk(2738, 4528).catch(() => undefined);
        await untilTicks(q.sdk, past, 6);
        await eatIfLow(q);
    }
    if (!past()) throw new Error(`hm: cart 1548 corridor (at ${where(q)}; cart z ${seen.join(',')})`);
}

// ── region A: the fungus and the points

/** From the surface or the upper mine down to region A (the fungus pool, the points). */
export async function toRegionA(q: Quest): Promise<void> {
    await setRetaliate(q, false);
    await wieldWeapon(q);
    if (in4370(pos(q)) && !inRegionC(pos(q)) && pos(q).z < 4530) return;
    if (inRegionC(pos(q))) await opLoc(q, 4968, { x: 2774, z: 4540 }, () => in4270(pos(q)), 'ladder C up');
    if (inLiftLevel(pos(q)) || inBossLevel(pos(q))) throw new Error(`hm: below the lift at ${where(q)}; the way up is the lift's water (not routed)`);
    if (onMorttonSurface(pos(q)) || !inMine(pos(q))) await intoMine(q);
    if (in53(pos(q)) && !in53W(pos(q))) await opLoc(q, 4921, { x: 3404, z: 9631 }, () => onMorttonSurface(pos(q)), 'back entrance 1 out');
    if (onMorttonSurface(pos(q))) await opLoc(q, 4915, { x: 3429, z: 3225 }, () => in53(pos(q)), 'back entrance 2');
    if (in53(pos(q))) await opLoc(q, 4965, { x: 3422, z: 9625 }, () => in4371(pos(q)), 'ladder 53_150 west');
    if (in4371(pos(q))) await opLoc(q, 4969, { x: 2798, z: 4567 }, () => in4270(pos(q)), 'ladder 43_71 west');
    if (in4270(pos(q))) {
        if (pos(q).z > 4489) await crossCorridor(q, true);
        await opLoc(q, 4967, { x: 2725, z: 4486 }, () => in4370(pos(q)), 'ladder 42_70 south');
    }
    if (!in4370(pos(q))) throw new Error(`hm: not in region A (at ${where(q)})`);
    q.log(`hm: region A ${where(q)}`);
}

/** A free slot: junk first, else eat (or drop) a shark. */
async function freeSlot(q: Quest): Promise<void> {
    if (inv(q).length < 28) return;
    const junk = item(q, RE.junk);
    if (junk) await q.bot.dropItem(junk, 1).catch(() => undefined);
    else {
        const food = item(q, RE.food);
        const hp = q.sdk.getSkill('hitpoints');
        if (food && hp && hp.level < hp.baseLevel - 20) await q.bot.eatFood(food).catch(() => undefined);
        else if (food) await q.bot.dropItem(food, 1).catch(() => undefined);
    }
    await untilTicks(q.sdk, () => inv(q).length < 28, 4);
}

/**
 * Mort Myre's rotten food and crumbled fungus (ashes) off the pack. A full pack made the SDK's walkTo, boxed in by the
 * fungus pool, drop our glowing fungus to clear a tile (qlqehm4).
 */
async function dropJunk(q: Quest): Promise<void> {
    for (let i = 0; i < 8 && item(q, RE.junk); i++) {
        const before = inv(q).length;
        await q.bot.dropItem(item(q, RE.junk)!, 'all').catch(() => undefined);
        await untilTicks(q.sdk, () => inv(q).length < before, 3);
    }
}

async function pickFungus(q: Quest): Promise<void> {
    if (hasFungus(q)) return;
    await dropJunk(q);
    await freeSlot(q);
    for (const c of [
        { id: 4933, x: 2792, z: 4494 },
        { id: 4932, x: 2793, z: 4494 },
        { id: 4933, x: 2793, z: 4493 },
    ]) {
        if (hasFungus(q)) break;
        const loc = await locById(q, c.id, c, 0);
        if (!loc) continue;
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, 1);
        await untilTicks(q.sdk, () => hasFungus(q), 10);
    }
    for (let wait = 0; wait < 6 && !hasFungus(q); wait++) {
        // All three picked by someone: they grow back.
        await q.sdk.waitForTicks(10);
        await q.sdk.scanNearbyLocs(6).catch(() => undefined);
        const loc = (q.sdk.getNearbyLocs() ?? []).find((l) => (l.id === 4932 || l.id === 4933) && cheb(l, { x: 2792, z: 4494 }) <= 1);
        if (loc) {
            await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, 1);
            await untilTicks(q.sdk, () => hasFungus(q), 10);
        }
    }
    if (!hasFungus(q)) throw new Error(`hm: no glowing fungus at the pool (at ${where(q)})`);
    q.log('hm: glowing fungus');
}

const controlsOpen = (q: Quest) => q.sdk.getState()?.interface?.isOpen === true && q.sdk.getState()?.interface?.interfaceId === CONTROLS;
async function openControls(q: Quest): Promise<void> {
    if (controlsOpen(q)) return;
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    for (let attempt = 0; attempt < 4 && !controlsOpen(q); attempt++) {
        const loc = await locById(q, 4949, { x: 2769, z: 4522 }, 1);
        await q.sdk.sendInteractLoc(loc?.x ?? 2769, loc?.z ?? 4522, 4949, 1);
        await untilTicks(q.sdk, () => controlsOpen(q), 25);
    }
    if (!controlsOpen(q)) throw new Error(`hm: the points controls did not open (at ${where(q)})`);
}

async function pullLever(q: Quest, k: number): Promise<void> {
    const at = LEVERS[k]!;
    if (q.sdk.getState()?.interface?.isOpen) await q.sdk.sendCloseModal().catch(() => undefined);
    for (let attempt = 0; attempt < 4; attempt++) {
        const c0 = msgCursor(q);
        await q.sdk.waitForTicks(1);
        await q.sdk.sendInteractLoc(at.x, at.z, 4949 + k, 1);
        if (await untilTicks(q.sdk, () => heardAfter(q, c0, /you pull the lever/i), 15)) {
            q.log(`hm: lever ${k} pulled`);
            await q.sdk.waitForTicks(1);
            return;
        }
        q.log(`hm: lever ${k}: no pull message (attempt ${attempt + 1}, at ${where(q)})`);
        await q.sdk.waitForTicks(2);
    }
    throw new Error(`hm: lever ${k} did not pull (at ${where(q)})`);
}

/** 'sink' when the sunk cart was not seen; else where it sank says which point is wrong. */
type Outcome = 'sink' | 'b0' | 'dj' | 'c1' | 'returned' | 'success';
/** Where the flooded cart (loc 4945) appears (hauntedmine_points.rs2 animate_sink coords, 0_43_70_x_z). */
const SINKS: Record<string, Outcome> = { '2790,4522': 'b0', '2789,4527': 'b0', '2791,4530': 'b0', '2787,4539': 'dj', '2790,4524': 'c1' };
/** Run the cart once from the controls, watching for the flooded cart while it runs. */
async function testCart(q: Quest): Promise<Outcome> {
    // The run closes the controls (animate_start if_close) before it reopens them: a click that never closed them
    // never ran the cart, and its silence must not read as "through" (qlqehm3: a phantom success, then the fungus sank).
    let ran = false;
    let c0 = 0;
    for (let attempt = 1; attempt <= 4 && !ran; attempt++) {
        await openControls(q);
        await q.sdk.waitForTicks(1);
        c0 = msgCursor(q);
        await q.sdk.sendClickComponent(TEST_BUTTON);
        ran = await untilTicks(q.sdk, () => !controlsOpen(q) || heardAfter(q, c0, /sunk|come right back/i), 6);
        if (!ran) q.log(`hm: the Test button did not run the cart (attempt ${attempt})`);
    }
    if (!ran) throw new Error(`hm: the points Test never ran (at ${where(q)})`);
    let sunkAt = '';
    const t0 = tickNow(q.sdk);
    while (tickNow(q.sdk) - t0 < 18 && !heardAfter(q, c0, /sunk|come right back/i)) {
        if (!sunkAt) {
            const locs = (await q.sdk.scanNearbyLocs(25).catch(() => undefined)) ?? q.sdk.getNearbyLocs() ?? [];
            const cart = (Array.isArray(locs) ? locs : []).find((l) => l.id === 4945);
            if (cart) sunkAt = `${cart.x},${cart.z}`;
        } else await q.sdk.waitForTicks(1);
    }
    if (heardAfter(q, c0, /come right back/i)) return 'returned';
    if (heardAfter(q, c0, /sunk/i)) return SINKS[sunkAt] ?? 'sink';
    return 'success';
}

type State = Record<Letter, number>;
const fineOutcome = (x: State): Outcome => (!x.b ? 'b0' : x.d ? 'dj' : !x.a ? 'returned' : x.c ? 'c1' : x.j ? 'dj' : 'success');
const coarse = (o: Outcome): Outcome => (o === 'b0' || o === 'dj' || o === 'c1' ? 'sink' : o);
const outcomeOf = (x: State): Outcome => coarse(fineOutcome(x));
const explains = (x: State, r: Outcome) => (r === 'sink' ? outcomeOf(x) === 'sink' : fineOutcome(x) === r);
const flip = (x: State, f: number): State => {
    const y = { ...x };
    LETTERS.forEach((l, i) => {
        if (f & (1 << i)) y[l] ^= 1;
    });
    return y;
};

/** Solve the points with the empty cart, then send the fungus through (it lands in the end cart). */
export async function solvePoints(q: Quest): Promise<void> {
    await pickFungus(q);
    let cands: State[] = [];
    for (let m = 0; m < 32; m++) cands.push({ b: m & 1, a: (m >> 1) & 1, c: (m >> 2) & 1, d: (m >> 3) & 1, j: (m >> 4) & 1 });
    for (let tests = 1; ; tests++) {
        if (tests > 12) throw new Error('hm: points puzzle unsolved after 12 tests');
        const r = await testCart(q);
        cands = cands.filter((x) => explains(x, r));
        q.log(`hm: points test ${tests}: ${r} (${cands.length} states left)`);
        if (r === 'success') break;
        if (!cands.length) throw new Error(`hm: no lever state explains "${r}"`);
        // The flip set whose worst outcome bucket is smallest; a set that makes every candidate succeed wins outright.
        let best = { f: 0, score: Infinity };
        for (let f = 1; f < 32; f++) {
            const buckets = new Map<Outcome, number>();
            for (const x of cands) buckets.set(fineOutcome(flip(x, f)), (buckets.get(fineOutcome(flip(x, f))) ?? 0) + 1);
            const allSuccess = buckets.size === 1 && buckets.has('success');
            const worst = Math.max(...buckets.values()) - (buckets.get('success') ? 0.5 : 0);
            const score = allSuccess ? -1 : worst + 0.01 * [...LETTERS.keys()].filter((i) => f & (1 << i)).length;
            if (score < best.score) best = { f, score };
        }
        for (const [i, l] of LETTERS.entries()) if (best.f & (1 << i)) await pullLever(q, BIT[l]);
        cands = cands.map((x) => flip(x, best.f));
    }
    // The fungus in the begin cart, then one more run.
    await closeDialogs(q);
    for (let attempt = 0; attempt < 4 && hasFungus(q); attempt++) {
        const f = item(q, RE.fungus)!;
        await q.sdk.sendUseItemOnLoc(f.slot, 2778, 4506, 4974);
        await untilTicks(q.sdk, () => !hasFungus(q), 25);
    }
    if (hasFungus(q)) throw new Error(`hm: the fungus did not go into the cart (at ${where(q)})`);
    const r = await testCart(q);
    await closeDialogs(q);
    if (r !== 'success') throw new Error(`hm: the fungus run gave "${r}"`);
    q.log('hm: the fungus is on its way to the end cart');
}

/** Region A (or the surface, or the upper mine) -> round by the surface -> region C. */
async function toRegionC(q: Quest): Promise<void> {
    if (inRegionC(pos(q))) return;
    // From the north surface (the Zealot's side): over the obstacle cart, in by the secondary entrance; the back entrances
    // are pockets reached only from inside the mine.
    if (onMorttonSurface(pos(q)) || !inMine(pos(q))) await intoMine(q);
    if (in4370(pos(q)) && !inRegionC(pos(q))) await opLoc(q, 4968, { x: 2789, z: 4486 }, () => in4270(pos(q)), 'ladder A up');
    if (in4270(pos(q)) && pos(q).z < 4515) {
        await crossCorridor(q, false);
        await opLoc(q, 4970, { x: 2734, z: 4503 }, () => in4371(pos(q)), 'ladder 42_70 S up');
    }
    if (in4371(pos(q)) && pos(q).z < 4585) await opLoc(q, 4966, { x: 2782, z: 4569 }, () => in53(pos(q)), 'ladder 43_71 W up');
    if (in53(pos(q)) && in53W(pos(q))) await opLoc(q, 4922, { x: 3408, z: 9623 }, () => onMorttonSurface(pos(q)), 'back entrance 2 out');
    if (onMorttonSurface(pos(q))) await opLoc(q, 4914, { x: 3430, z: 3233 }, () => in53(pos(q)), 'back entrance 1');
    if (in53(pos(q))) await opLoc(q, 4965, { x: 3413, z: 9633 }, () => in4371(pos(q)), 'ladder 53_150 east');
    if (in4371(pos(q))) await opLoc(q, 4969, { x: 2797, z: 4599 }, () => in4270(pos(q)), 'ladder 43_71 east');
    if (in4270(pos(q)) && !inRegionC(pos(q))) await opLoc(q, 4967, { x: 2710, z: 4540 }, () => inRegionC(pos(q)), 'ladder to C');
    if (!inRegionC(pos(q))) throw new Error(`hm: not in region C (at ${where(q)})`);
}

/** Region A -> round by the surface -> region C; take the fungus out of the end cart. */
export async function fungusFromEndCart(q: Quest): Promise<void> {
    await toRegionC(q);
    for (let attempt = 0; attempt < 4 && !hasFungus(q); attempt++) {
        const t0 = tickNow(q.sdk);
        await q.sdk.sendInteractLoc(2774, 4537, 4974, 1);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || heard(q, t0, /cart is empty/i), 20);
        if (heard(q, t0, /cart is empty/i)) throw new Error('hm: the end cart is empty (the fungus run did not arrive)');
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/^take it/i], { done: () => hasFungus(q), ticks: 15 });
    }
    await closeDialogs(q);
    if (!hasFungus(q)) throw new Error(`hm: no fungus from the end cart (at ${where(q)})`);
    q.log('hm: fungus from the end cart');
}

/** Region C -> region B: the key on the valve (-> 4), the lift (-> 5). */
export async function rideLift(q: Quest): Promise<void> {
    await dropJunk(q);
    await setRun(q);
    if (inRegionC(pos(q))) await opLoc(q, 4968, { x: 2774, z: 4540 }, () => in4270(pos(q)), 'ladder C up');
    if (in4270(pos(q))) {
        if (pos(q).z > 4528) await passCart1548(q);
        await opLoc(q, 4967, { x: 2732, z: 4529 }, () => in4370(pos(q)), 'ladder to B');
    }
    if (!in4370(pos(q))) throw new Error(`hm: not in region B (at ${where(q)})`);
    // The valve's pocket and the lift's mouth (2807,4493) are joined only by a loop north through the cheeky ghost's
    // zone (inner 2800-2803,4512-4516): crossing it with the valve open sets him off, and 25 ticks later the valve is
    // shut again (hauntedmine_lift.rs2). Open the valve, then RUN round to the mouth and op the lift's back wall (4940)
    // inside that window. A valve left open by an earlier run trips him on the walk down from the ladder: wait that
    // turn out first. (walkTo reads the valve's tile (2808,4495) as blocked: stand at (2807,4496).)
    const arrived = tickNow(q.sdk);
    await walk(q, { x: 2807, z: 4496 }, 0);
    await untilTicks(q.sdk, () => false, Math.max(0, 40 - (tickNow(q.sdk) - arrived)));
    for (let round = 1; round <= 4 && !inLiftLevel(pos(q)); round++) {
        const c0 = msgCursor(q);
        const opened = () => heardAfter(q, c0, /you open the valve|already open/i);
        for (let attempt = 0; attempt < 4 && !opened(); attempt++) {
            await closeDialogs(q);
            await walk(q, { x: 2807, z: 4496 }, 0);
            const key = item(q, RE.liftKey);
            if (!key) throw new Error("hm: no Zealot's key for the valve");
            await q.sdk.sendUseItemOnLoc(key.slot, 2808, 4496, 4924);
            await untilTicks(q.sdk, opened, 15);
        }
        if (!opened()) throw new Error(`hm: the lift valve did not open (at ${where(q)})`);
        const tOpen = tickNow(q.sdk);
        await setRun(q);
        await q.sdk.sendWalk(2807, 4493, true).catch(() => undefined);
        const trail: string[] = [];
        await untilTicks(q.sdk, () => {
            const k = `${pos(q).x},${pos(q).z}`;
            if (!trail[trail.length - 1]?.endsWith(`:${k}`)) trail.push(`${tickNow(q.sdk) - tOpen}:${k}`);
            // Staging: the run reaches (2805,4493) 33 ticks after the valve and the ghost shuts it at ~42: op from there.
            return cheb(pos(q), { x: 2807, z: 4493 }) <= 2 && pos(q).z <= 4494;
        }, 45);
        if (round === 1) q.log(`hm: valve -> mouth ${trail.join(' ')}`);
        await q.sdk.sendInteractLoc(2808, 4493, 4940, 1);
        await untilTicks(q.sdk, (s) => inLiftLevel(pos(q)) || !!s.dialog?.isOpen, 8);
        const text = q.sdk.getDialog()?.isOpen ? await driveDialog(q.sdk, [], { ticks: 8 }) : '';
        await untilTicks(q.sdk, () => inLiftLevel(pos(q)), 8);
        if (!inLiftLevel(pos(q))) {
            q.log(`hm: the lift (round ${round}, ${tickNow(q.sdk) - tOpen}t after the valve, run ${q.sdk.getState()?.player?.runEnergy}): ${text.slice(0, 80)}`);
            await closeDialogs(q);
            await q.sdk.waitForTicks(3);
        }
    }
    if (!inLiftLevel(pos(q))) throw new Error(`hm: the lift did not take us down (at ${where(q)})`);
    q.log(`hm: down the lift to ${where(q)}`);
}

/** Run mode on (controls com_5, player_controls.rs2): the lift's 25-tick window needs it. */
async function setRun(q: Quest): Promise<void> {
    await q.sdk.sendSetTab(12).catch(() => undefined);
    await q.sdk.waitForTicks(1);
    await q.sdk.sendClickComponent(153).catch(() => undefined);
    await q.sdk.waitForTicks(1);
    await q.sdk.sendSetTab(3).catch(() => undefined);
}

/** The full fungus run from wherever we are to the bottom of the lift with the fungus in hand. */
export async function fungusToLift(q: Quest): Promise<void> {
    if (inLiftLevel(pos(q)) && hasFungus(q)) return;
    if (!hasLiftKey(q)) await liftKey(q);
    if (!hasFungus(q)) {
        await toRegionA(q);
        await solvePoints(q);
        await fungusFromEndCart(q);
    }
    await rideLift(q);
}

/** Set once the bare dark stairs said "too dark": this process's retries do the fungus run. */
let needsLight = false;

/** Down the dark stairs with the fungus for light (-> 7). From stage 8 (Treus once taken) they need no light. */
export async function darkStairs(q: Quest): Promise<void> {
    if (inBossLevel(pos(q))) return;
    if (!hasFungus(q) && !needsLight) {
        // A retry after the key was taken (stage 8): no fungus run (points puzzle, end cart) — try the stairs bare first.
        // At stage 7 that lands in the dark: remember it, and the retry (teleported out by go()) does the fungus run.
        if (!inLiftLevel(pos(q))) {
            if (!hasLiftKey(q)) await liftKey(q);
            await toRegionC(q);
            await rideLift(q);
        }
        const t0 = tickNow(q.sdk);
        await opLoc(q, 4971, { x: 2746, z: 4436 }, () => inBossLevel(pos(q)) || heard(q, t0, /kind of dark down here/i) || /kind of dark/i.test((q.sdk.getDialog()?.allComponents ?? []).map((c) => c.text).join(' ')), 'the dark stairs (no light)', { stand: { x: 2750, z: 4437 } });
        if (inBossLevel(pos(q))) {
            q.log(`hm: the boss level ${where(q)} (no light needed)`);
            return;
        }
        await closeDialogs(q);
        needsLight = true;
        throw new Error('hm: too dark without the fungus (stage 7) — out, then the fungus run');
    }
    if (!inLiftLevel(pos(q)) || !hasFungus(q)) await fungusToLift(q);
    await opLoc(q, 4971, { x: 2746, z: 4436 }, () => inBossLevel(pos(q)), 'the dark stairs', { stand: { x: 2750, z: 4437 } });
    q.log(`hm: the boss level ${where(q)}`);
}

// ── Treus Dayth

const foodLeft = (q: Quest) => held(q, RE.food);
/** Melee xp (attack + strength + defence): 4 per damage point dealt, whichever style is set. */
const meleeXp = (q: Quest) => ['attack', 'strength', 'defence'].reduce((n, k) => n + (q.sdk.getSkill(k)?.experience ?? 0), 0);
const magicXp = (q: Quest) => q.sdk.getSkill('magic')?.experience ?? 0;
const canCrumble = (q: Quest) => q.level('magic') >= 39 && held(q, /^chaos rune$/i) >= 1 && held(q, /^earth rune$/i) >= 2 && held(q, /^air rune$/i) >= 2;
const hasMelee = (q: Quest) => q.sdk.getEquipment().some((i) => /scimitar|longsword|sword|battleaxe|mace|warhammer|whip|dagger|halberd|spear/i.test(i.name));

/** Protect from Missiles (Prayer 40) against the possessed pickaxes (max 15 -> 10); prayer potions below 15 points. */
async function prayMissiles(q: Quest, on: boolean): Promise<void> {
    const active = q.sdk.isPrayerActive('protect_from_missiles');
    const pr = q.sdk.getPrayerState();
    if (on && pr && pr.prayerPoints < 15) {
        const pot = inv(q).find((i) => /^prayer potion\(\d\)$/i.test(i.name));
        const op = pot?.optionsWithIndex.find((o) => /^drink$/i.test(o.text));
        if (pot && op) await q.sdk.sendUseItem(pot.slot, op.opIndex).catch(() => undefined);
    }
    if (on && !active && pr && pr.prayerLevel >= 40 && pr.prayerPoints > 0) await q.bot.activatePrayer('protect_from_missiles').catch(() => undefined);
    if (!on && active) await q.bot.deactivatePrayer('protect_from_missiles').catch(() => undefined);
}

/**
 * Take the key; kill Treus Dayth; re-engage and recheck until the boss_death stage (9).
 *
 * His death only counts as the solid type (1540): a fatal hit whose retaliation roll (1 in 2 per attack, hit or miss) starts
 * a hop kills him as the faded type (default death, stage stays 8 — take the key again for a fresh 100-hp Treus) or leaves a
 * 0-hp "zombie" that ignores hits until his +1 hp regen (100 ticks), when the next hit is lethal again
 * (hauntedmine_boss_ghost.rs2 boss_move/ai_queue3; rs-stun-toolkit fix 403). NearbyNpc.hp stays null for him, so his hp
 * is estimated from our combat xp (melee: 4 a damage point; Crumble Undead: 24.5 a cast + 2 a point). Melee when a weapon
 * is worn (about twice Crumble Undead's damage, and no air runes); the room's hazards hit at most 10-15 a third of the
 * time, Protect from Missiles takes the pickaxes to 10.
 */
export async function fightTreus(q: Quest, defeated: () => Promise<boolean>): Promise<void> {
    if (!inBossLevel(pos(q))) await darkStairs(q);
    await setRetaliate(q, false);
    await wieldWeapon(q);
    const melee = hasMelee(q);
    const CENTRE = { x: 2788, z: 4456 };
    const STAND = { x: 2788, z: 4454 };
    if (pos(q).x > 2798) {
        await walk(q, { x: 2801, z: 4453 }, 1);
        if (pos(q).x > 2798) await opLoc(q, 4962, { x: 2799, z: 4453 }, () => pos(q).x <= 2798, 'the boss door', { ticks: 10 });
        if (pos(q).x > 2798) await walk(q, { x: 2796, z: 4453 }, 1);
    }
    const t0 = tickNow(q.sdk);
    const killed = () => heard(q, t0, /killing strike|machinery/i) || /killing strike|falls silent/i.test((q.sdk.getDialog()?.allComponents ?? []).map((c) => c.text).join(' '));
    let lastSeen = tickNow(q.sdk);
    let lastProbe = -999;
    let lastAttack = -999;
    let lastReport = tickNow(q.sdk);
    let keyTakes = 0;
    // Damage dealt to the current Treus, and when he appeared (his +1 hp per 100 ticks regen).
    let dealt = 0;
    let spawnedAt = tickNow(q.sdk);
    let mxp = meleeXp(q);
    let gxp = magicXp(q);
    let lastDamageAt = tickNow(q.sdk);
    let lastClose = -999;
    let closes = 0;
    const estHp = () => 100 - dealt + Math.floor((tickNow(q.sdk) - spawnedAt) / 100);
    const takeKey = async () => {
        await closeDialogs(q);
        const k = npcsById(q, NPC.key)[0];
        if (!k) {
            await walk(q, STAND, 1);
            return;
        }
        const tk = tickNow(q.sdk);
        await q.sdk.sendInteractNpc(k.index, 1);
        await untilTicks(q.sdk, (s) => npcsById(q, NPC.boss, NPC.bossFaded).length > 0 || !!s.dialog?.isOpen || hasRewardKey(q) || heard(q, tk, /deal with that ghost/i), 12);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 15 });
        if (heard(q, tk, /deal with that ghost/i)) {
            q.log('hm: the key says Treus is still up (out of view) — back to the centre');
            await walk(q, CENTRE, 1);
            return;
        }
        keyTakes++;
        dealt = 0;
        spawnedAt = tickNow(q.sdk);
        lastDamageAt = tickNow(q.sdk);
        q.log(`hm: took the key (${keyTakes}) — a fresh Treus`);
    };
    try {
        while (!killed() && !hasRewardKey(q)) {
            if (tickNow(q.sdk) - t0 > 2400) throw new Error(`hm: Treus Dayth not dead after 2400 ticks (${keyTakes} key takes)`);
            if (!inBossLevel(pos(q))) throw new Error(`hm: left Treus Dayth's level mid-fight (dead? at ${where(q)})`);
            await prayMissiles(q, true);
            await eatIfLow(q, 0.6);
            const hp = q.sdk.getSkill('hitpoints');
            // Out of food and low: out through the boss door alive (the room's hazards only hurt inside it); the retry tops
            // up from the bank. An account that dies here loses its pack.
            if (foodLeft(q) === 0 && hp && hp.level < hp.baseLevel * 0.5) {
                await walk(q, { x: 2801, z: 4453 }, 1).catch(() => false);
                throw new Error(`hm: out of food against Treus Dayth (hp ${hp.level}, ${keyTakes} key takes)`);
            }
            if (q.sdk.getDialog()?.isOpen && !(q.sdk.getDialog()?.options ?? []).some((o) => !/continue/i.test(o.text))) await driveDialog(q.sdk, [], { ticks: 4 });
            // Damage dealt since the last look, from our xp.
            const m = meleeXp(q);
            const g = magicXp(q);
            if (m > mxp) {
                dealt += Math.round((m - mxp) / 4);
                lastDamageAt = tickNow(q.sdk);
                closes = 0;
            }
            if (g > gxp) {
                dealt += Math.max(0, Math.round((g - gxp - 24.5) / 2));
                lastDamageAt = tickNow(q.sdk);
            }
            mxp = m;
            gxp = g;
            const boss = npcsById(q, NPC.boss)[0];
            const any = npcsById(q, NPC.boss, NPC.bossFaded)[0];
            if (any) lastSeen = tickNow(q.sdk);
            const unseen = tickNow(q.sdk) - lastSeen;
            if (!any) {
                // Not up yet, hopped out of view, or dead (solid: the killing-strike box; faded: gone, stage unchanged).
                if (cheb(pos(q), CENTRE) > 2 && unseen > 4) await walk(q, CENTRE, 2);
                // He hops out of view for a few ticks at a time; gone longer than that is a death (solid: the journal moves).
                const probeAfter = 6;
                if ((keyTakes === 0 || unseen > probeAfter) && tickNow(q.sdk) - lastProbe > 20 && cheb(pos(q), CENTRE) <= 3) {
                    lastProbe = tickNow(q.sdk);
                    if (keyTakes > 0 && (await defeated())) break;
                    if (keyTakes > 0) q.log(`hm: Treus gone ${unseen}t with no kill (a faded death: the stage stays 8) — taking the key again`);
                    await takeKey();
                } else await q.sdk.waitForTicks(1);
                continue;
            }
            // A zombie (est hp <= 0, still up, nothing landing): hits do nothing until his regen. One attack every 10 ticks
            // keeps us on him so the first hit after the regen kills him again.
            // The xp-per-damage rate depends on the server's xp multiplier, so "dealt" is in xp units, not hp: a zombie is
            // just "in view, attacked, nothing landing" — handled by re-sending (his regen lets the next hit through).
            const zombie = false;
            // Alive and in view but nothing landing (a cart in his corridor, a wall on the attack's short route: qlqfhm1
            // stood 400t at (2793,4454) with him at (2794,4451)): walk up to him; if that does not help, cast.
            const stuck = !zombie && !!boss && tickNow(q.sdk) - lastDamageAt > 12 && tickNow(q.sdk) - lastAttack < 6;
            if (stuck && boss && tickNow(q.sdk) - lastClose > 12) {
                lastClose = tickNow(q.sdk);
                closes++;
                const t = npcTile(boss);
                q.log(`hm: nothing landing for ${tickNow(q.sdk) - lastDamageAt}t — closing in on Treus at (${t.x},${t.z}) from ${where(q)}`);
                await q.bot.walkTo(t.x, t.z, 1).catch(() => undefined);
                lastAttack = -999;
            }
            const cast = canCrumble(q) && (!melee || (stuck && closes >= 2));
            // The boss timer if_close()s us every 5 ticks, which drops the attack: re-send often.
            const every = zombie ? 10 : 3;
            if (boss && tickNow(q.sdk) - lastAttack >= every) {
                if (cast) await q.sdk.sendSpellOnNpc(boss.index, CRUMBLE_UNDEAD);
                else await q.sdk.sendInteractNpc(boss.index, 2);
                lastAttack = tickNow(q.sdk);
            }
            if (tickNow(q.sdk) - lastReport >= 50) {
                lastReport = tickNow(q.sdk);
                const t = npcTile(any);
                q.log(`hm: fight +${tickNow(q.sdk) - t0}t: Treus ${any.id}@${t.x},${t.z}, ${tickNow(q.sdk) - lastDamageAt}t since a hit landed; me ${where(q)} hp ${q.sdk.getSkill('hitpoints')?.level}; food ${foodLeft(q)}; prayer ${q.sdk.getPrayerState()?.prayerPoints}`);
            }
            await q.sdk.waitForTicks(1);
        }
    } finally {
        await closeDialogs(q);
    }
    q.log(`hm: Treus Dayth down after ${tickNow(q.sdk) - t0}t (${keyTakes} key takes, ${foodLeft(q)} food left)`);
}

/** Take the Crystal-mine key from the crate spot (stage 9 hands it over). */
async function rewardKey(q: Quest): Promise<void> {
    for (let attempt = 0; attempt < 6 && !hasRewardKey(q); attempt++) {
        await closeDialogs(q);
        if (inv(q).length >= 28) {
            const junk = item(q, RE.junk) ?? item(q, RE.food);
            if (junk) await q.bot.dropItem(junk, 1).catch(() => undefined);
        }
        const floor = (q.sdk.getState()?.groundItems ?? []).find((g) => RE.rewardKey.test(g.name) && g.distance <= 6);
        if (floor) {
            await q.bot.pickupItem(floor).catch(() => undefined);
            await untilTicks(q.sdk, () => hasRewardKey(q), 8);
            continue;
        }
        const k = npcsById(q, NPC.key)[0];
        if (!k) {
            await walk(q, { x: 2788, z: 4454 }, 0);
            await q.sdk.waitForTicks(2);
            continue;
        }
        await walk(q, { x: 2788, z: 4454 }, 0);
        await q.sdk.sendInteractNpc(k.index, 1);
        await untilTicks(q.sdk, (s) => hasRewardKey(q) || !!s.dialog?.isOpen, 10);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 8 });
    }
    if (!hasRewardKey(q)) throw new Error(`hm: no Crystal-mine key (at ${where(q)})`);
}

/** The key, then round by the lift level to the west landing and through the reward doors (-> 10). */
export async function rewardDoor(q: Quest): Promise<void> {
    if (!inBossLevel(pos(q)) && !inLiftLevel(pos(q))) await darkStairs(q);
    if (inBossLevel(pos(q)) && !hasRewardKey(q)) await rewardKey(q);
    if (inBossLevel(pos(q)) && pos(q).x >= 2775) {
        if (pos(q).x <= 2798) {
            await walk(q, { x: 2801, z: 4453 }, 1);
            if (pos(q).x <= 2798) await opLoc(q, 4962, { x: 2799, z: 4453 }, () => pos(q).x >= 2799, 'the boss door (out)', { ticks: 10 });
        }
        await opLoc(q, 4973, { x: 2812, z: 4452 }, () => inLiftLevel(pos(q)), 'the east light stairs');
    }
    if (inLiftLevel(pos(q))) await opLoc(q, 4971, { x: 2692, z: 4436 }, () => inBossLevel(pos(q)), 'the west dark stairs', { stand: { x: 2691, z: 4437 } });
    await opLoc(q, 4963, { x: 2773, z: 4450 }, () => pos(q).z < 4450, 'the reward door', { ticks: 15 });
    q.log(`hm: through the reward doors ${where(q)}`);
}

/** Cut a crystal with the chisel: the salve shard and the quest. */
export async function cutCrystal(q: Quest, done: () => Promise<boolean>): Promise<void> {
    if (!(inBossLevel(pos(q)) && pos(q).z < 4450)) await rewardDoor(q);
    if (!held(q, RE.chisel)) throw new Error('hm: no chisel for the crystals');
    if (inv(q).length >= 28) {
        const junk = item(q, RE.junk) ?? item(q, RE.liftKey) ?? item(q, RE.food);
        if (junk) await q.bot.dropItem(junk, 1).catch(() => undefined);
    }
    for (let attempt = 0; attempt < 4; attempt++) {
        await closeDialogs(q);
        const loc = await locById(q, 4928, { x: 2788, z: 4428 }, 1);
        await q.sdk.sendInteractLoc(loc?.x ?? 2788, loc?.z ?? 4428, 4928, 1);
        await untilTicks(q.sdk, (s) => held(q, /^salve shard$/i) > 0 || !!s.dialog?.isOpen, 20);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
        if (held(q, /^salve shard$/i) > 0 || (await done())) break;
    }
    await setRetaliate(q, true);
    if (q.sdk.isPrayerActive('protect_from_missiles')) await q.bot.deactivatePrayer('protect_from_missiles').catch(() => undefined);
}
