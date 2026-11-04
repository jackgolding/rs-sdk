/**
 * Shilo Village — the route and mechanics (bots/quests/shilo-village.ts is the definition).
 *
 * Content: quest_zombiequeen/scripts/quest_zombiequeen.rs2 (every loc below), mosol_rei.rs2,
 * nazastarool.rs2, rashiliyia.rs2, area_karamja/scripts/trufitus.rs2 (the belt, the tribal
 * statue), skill_agility/scripts/shortcuts.rs2 (the log and the stepping stones).
 *
 * The map, as the client's collision sees it (probed on the fast engine, 2026-11-02):
 *   - Karamja's main jungle (Tai Bwo Wannai, Mosol Rei by Shilo's cart, Cairn's east bank) is
 *     walkable from the Brimhaven docks (lib/jungle-potion.ts brings us over).
 *   - The valley with the mound of earth and Rashiliyia's hidden doors is cut off by rivers: in by
 *     the log (2907/2909,3049; stat_random 90/250, a fall still lands across) or the stepping
 *     stones (2925,2948-2950; a fall washes you to the far bank). walkTo cannot plan either.
 *   - Cairn Isle: the rocks at 2792/2794,2979 (Agility 15) then a bridge whose 20-tick timer rolls
 *     stat_random 75/250 (half the crossings fail at Agility 35: thrown onto a bank, 3 × hp/11).
 *     Bervirius' tomb is under the well stacked rocks (2762,2990; Agility 32, needs the tattered
 *     scroll read); out by the climbing rocks (2765,9376) onto the island.
 *   - Ah Za Rhoon (m45_145/146): down the roped fissure, the cave-in (2887,9373 ↔ 2886,9283)
 *     between its halves, out by the waterfall path (2940,9349) to the river's south bank.
 *   - Rashiliyia's tomb (m45_148): the ancient gate (beads worn), the rocks, the bone door; out
 *     by the tomb exit (bone key used on it, or Open when no key is held).
 * Undead Ones (68/73, cowardly: aggressive to every prod account) crowd both dungeons and hit
 * through food fast: never idle down there. Nazastarool (zombie 91, skeleton 68, ghost 93) is
 * fought in melee under Protect from Melee when Prayer allows.
 */
import { NeedsStock, type Quest } from './run-quest';
import { SAFE_BANKS } from '../safe-stops';
import { requestFromMule } from '../supply';
import type { NearbyLoc } from '../../../sdk/types';
import { driveDialog } from './dialog';
import { tickNow, ticksToMs, untilTicks } from './ticks';
import { FARE, leaveJungle, onIsland, toJungle, TRUFITUS } from './jungle-potion';
import { PrayerFlicker } from '../prayer-flick';

interface Tile {
    x: number;
    z: number;
}

export const MOSOL = { x: 2880, z: 2949 };
export { TRUFITUS };
/** ahzarhoon_entrance (2921,2999): the mound, then the fissure. Stand south of it. */
const MOUND = { x: 2921, z: 2997 };
/** zq tribal statue zone 0_43_48_42_15..46_18: Zadimus is buried inside it. */
const STATUE = { x: 2796, z: 3088 };
/** The hidden doors (2916-2917,3090) behind the palm trees (2915-2916,3092). */
const TOMB_DOOR = { x: 2916, z: 3093 };

const LOG = { id: 2332, z: 3049, west: { x: 2905, z: 3049 }, east: { x: 2910, z: 3049 }, westLoc: 2907, eastLoc: 2909 };
const STONES = { x: 2925, south: 2947, north: 2951 };
const CAIRN = { rockId: 2231, z: 2979, eastStand: { x: 2795, z: 2979 }, eastRock: 2794, westRock: 2792, bridgeWest: { x: 2771, z: 2979 }, crawl: { x: 2762, z: 2989 } };
const BERV = { dolmen: { x: 2766, z: 9365 }, handholds: { x: 2764, z: 9375 } };
const AZR = {
    caveInNorth: { x: 2887, z: 9374 },
    caveInSouth: { x: 2887, z: 9284 },
    bookcase: { x: 2886, z: 9318 },
    sacks: { x: 2938, z: 9286 },
    gallows: { x: 2933, z: 9326 },
    /** The waterfall rocks' south placement: its path ends on the river's south bank. */
    waterfall: { x: 2939, z: 9349 },
};
const RASH = { rockId: 2257, below: { x: 2928, z: 9510 }, door: { x: 2892, z: 9478 }, doorZ: 9480 };

const LOC_NAME = {
    mound: /^mound of earth$/i,
    fissure: /^fissure$/i,
    caveIn: /^cave in$/i,
    bookcase: /^loose rocks$/i,
    sacks: /^old sacks$/i,
    gallows: /^ancient gallows$/i,
    waterfall: /^waterfall rocks$/i,
    crawl: /^well stacked rocks$/i,
    dolmen: /^tomb dolmen$/i,
    handholds: /^climbing rocks$/i,
    palm: /^palm tree$/i,
    carvedDoors: /^carved doors$/i,
    entrance: /^hillside entrance$/i,
    gate: /^ancient metal gate$/i,
    tombDoors: /^tomb doors$/i,
    tombExit: /^tomb exit$/i,
};

export const ITEM = {
    belt: /^wampum belt$/i,
    zadimus: /^zadimus corpse$/i,
    shard: /^bone shard$/i,
    key: /^bone key$/i,
    tattered: /^tattered scroll$/i,
    crumpled: /^crumpled scroll$/i,
    pommel: /^sword pommel$/i,
    boneBeads: /^bone beads$/i,
    deadBeads: /^beads of the dead$/i,
    corpse: /^rashiliya corpse$/i,
};

/** Protect from Melee (prayer.rs2): below this the fight is food only. */
const PROTECT_MELEE_LEVEL = 43;
/** Eat below this share of max HP; anywhere a fall or an undead can land on top. */
const EAT_AT = 0.55;

// ── where we are

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;

export const inAhZaRhoon = (p: Tile) => inBox(p, 2880, 2943, 9280, 9407);
/** Ah Za Rhoon's south half (m45_145): only the cave-in leads back north. */
const inAhZaRhoonSouth = (p: Tile) => inBox(p, 2880, 2943, 9280, 9343);
export const inRashTomb = (p: Tile) => inBox(p, 2880, 2943, 9472, 9535);
/** The dolmen room behind the bone door. */
const inDolmenRoom = (p: Tile) => inBox(p, 2884, 2902, 9481, 9496);
export const inBervTomb = (p: Tile) => inBox(p, 2752, 2815, 9344, 9407);
/** Cairn Isle, its bridge and the strip between the climbing rocks. */
export const onCairn = (p: Tile) => inBox(p, 2755, 2775, 2970, 2995) || inBox(p, 2776, 2791, 2978, 2980);
/** The river valley with the mound and Rashiliyia's doors (walkTo cannot get in or out). */
// x 2909: the log's fall from the west washes you up at (2909,3059), on the valley side.
export const inValley = (p: Tile) => inBox(p, 2909, 2965, 2951, 3100);
/**
 * Shilo Village inside its walls (probed offline: x 2818-2878, z 2945-3005, wider in the north). The
 * east gates (quest_zombiequeen.rs2) are fenced off from the jungle path: in and out by the carts.
 * The gem mine (gemrock, 2824-2829,2998-3003) is inside.
 */
export const inShiloVillage = (p: Tile) => inBox(p, 2817, 2874, 2944, 2975) || inBox(p, 2817, 2879, 2976, 3007);
/** Anywhere goTo cannot walk out of: run-quest's goTo calls leaveShilo from these. */
export const inShiloArea = (p: Tile) => inAhZaRhoon(p) || inRashTomb(p) || inBervTomb(p) || onCairn(p) || inValley(p) || inShiloVillage(p);

// ── small helpers

const held = (q: Quest, item: RegExp) => q.sdk.getInventory().find((i) => item.test(i.name));
const has = (q: Quest, item: RegExp) => !!held(q, item) || q.sdk.getEquipment().some((i) => item.test(i.name));
const hp = (q: Quest) => q.sdk.getState()?.player?.hp ?? 0;
const maxHp = (q: Quest) => q.sdk.getState()?.player?.maxHp ?? 1;
const messageId = (q: Quest) => (q.sdk.getState()?.gameMessages ?? []).at(-1)?.observationId ?? -1;
const messagesSince = (q: Quest, id: number) =>
    (q.sdk.getState()?.gameMessages ?? [])
        .filter((m) => (m.observationId ?? 0) > id)
        .map((m) => m.text)
        .join(' | ');

/** Food eaten this run, for the logs. */
let eaten = 0;
/** Eat a shark (or any food) when below `frac` of max HP. */
export async function eatIfLow(q: Quest, frac = EAT_AT): Promise<void> {
    for (let i = 0; i < 3 && hp(q) < maxHp(q) * frac; i++) {
        const food = held(q, /^(shark|swordfish|lobster|monkfish|tuna|bass)$/i);
        if (!food) return;
        const before = hp(q);
        await q.bot.eatFood(food).catch(() => undefined);
        if (await untilTicks(q.sdk, () => hp(q) > before, 3)) eaten++;
    }
}

async function locs(q: Quest, radius = 12): Promise<NearbyLoc[]> {
    await q.sdk.scanNearbyLocs(radius).catch(() => undefined);
    return q.sdk.getNearbyLocs() ?? [];
}

/** The nearest loc named `name` with option `opt` (reachable first). */
async function findLoc(q: Quest, name: RegExp, opt?: RegExp, near?: Tile, radius = 12): Promise<NearbyLoc | undefined> {
    const all = (await locs(q, radius)).filter((l) => name.test(l.name) && (!opt || l.optionsWithIndex.some((o) => opt.test(o.text))));
    const ref = near ?? pos(q);
    return all.sort((a, b) => Number(b.reachable !== false) - Number(a.reachable !== false) || Math.hypot(a.x - ref.x, a.z - ref.z) - Math.hypot(b.x - ref.x, b.z - ref.z))[0];
}

/**
 * Drop the current fight target: a loc op sent while our player is swinging at an Undead One is
 * refused (UNSET_MAP_FLAG, no message). A walk onto our own tile clears it.
 */
async function disengage(q: Quest): Promise<void> {
    const combat = q.sdk.getState()?.player?.combat;
    if (!combat || combat.targetType === 'none') return;
    await q.sdk.sendWalk(pos(q).x, pos(q).z);
    await untilTicks(q.sdk, (s) => s.player?.combat?.targetType === 'none', 3);
}

const lastCombatObs = (q: Quest) => Math.max(-1, ...(q.sdk.getState()?.combatEvents ?? []).map((e) => e.observationId ?? e.tick));
let guard: PrayerFlicker | null = null;
/** Protect from Melee while killing undead, when the account has it and points left. */
/** Prayer points kept for Nazastarool: his three forms take ~250 ticks of Protect from Melee. */
const PRAYER_RESERVE = 40;
function protect(q: Quest, on: boolean): void {
    if (q.level('prayer') < PROTECT_MELEE_LEVEL) return;
    guard ??= new PrayerFlicker(q.sdk, q.log, { flick: false });
    guard.set(on && (q.sdk.getPrayerState()?.prayerPoints ?? 0) > PRAYER_RESERVE ? 'protect_from_melee' : null);
}

/**
 * In the dungeons every Undead One swing runs if_close (npc_combat_melee.rs2 playerhit_n_melee),
 * so a mesbox or choice under attack never completes. Cowardly hunters only take a player who
 * is adjacent and out of combat for 8 ticks (Npc.ts checkNotCombat): kill whatever is next to us
 * or hitting us, then act at once, inside the quiet ticks before a new one may start.
 */
async function clearAttackers(q: Quest, radius = 1): Promise<void> {
    if (!inAhZaRhoon(pos(q)) && !inRashTomb(pos(q))) return;
    const t0 = tickNow(q.sdk);
    const mark = lastCombatObs(q);
    let kills = 0;
    const undead = /^undead one$/i;
    // Only undead that are on us: hitting us lately, or targeting a player (index + 32768) from beside us.
    // One beside a wall (the tomb room's) is not, and swinging at it burnt 150 ticks a try.
    const target = () => {
        const now = q.sdk.getState()?.tick ?? 0;
        const hitter = (q.sdk.getState()?.combatEvents ?? [])
            .filter((e) => ((e.observationId ?? e.tick) > mark || e.tick >= now - 8) && e.type === 'damage_taken' && e.sourceType === 'npc')
            .map((e) => e.sourceIndex);
        const near = q.sdk.getNearbyNpcs().filter((n) => undead.test(n.name) && (n.distance ?? 99) <= 1);
        // radius > 1 (the cave-in): also any reachable one close enough to step beside us mid-prompt.
        const around = radius > 1 ? q.sdk.getNearbyNpcs().filter((n) => undead.test(n.name) && (n.distance ?? 99) <= radius && n.reachable !== false) : [];
        return near.find((n) => hitter.includes(n.index)) ?? near.find((n) => n.targetIndex >= 32768) ?? around.sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    };
    try {
        while (tickNow(q.sdk) - t0 < 600) {
            const npc = target();
            if (!npc) break;
            protect(q, true);
            const index = npc.index;
            const alive = () => q.sdk.getNearbyNpcs().find((n) => n.index === index);
            const k0 = tickNow(q.sdk);
            let sent = -99;
            let landed = k0;
            const obs0 = lastCombatObs(q);
            while (alive() && (alive()!.distance ?? 99) <= Math.max(2, radius + 1) && tickNow(q.sdk) - k0 < 150 && tickNow(q.sdk) - landed < 20) {
                if ((q.sdk.getState()?.combatEvents ?? []).some((e) => (e.observationId ?? e.tick) > obs0 && e.targetType === 'npc' && e.targetIndex === index)) landed = tickNow(q.sdk);
                await eatIfLow(q);
                const combat = q.sdk.getState()?.player?.combat;
                const swinging = combat?.targetType === 'npc' && combat.targetIndex === index;
                if ((!swinging || (guard && guard.toggledAt > sent)) && tickNow(q.sdk) - sent > 2) {
                    const n = alive()!;
                    await q.sdk.sendInteractNpc(n.index, n.optionsWithIndex.find((o) => /^attack$/i.test(o.text))?.opIndex ?? 2);
                    sent = tickNow(q.sdk);
                }
                await q.sdk.waitForTicks(1);
            }
            if (!alive()) kills++;
            else break;
        }
    } finally {
        protect(q, false);
    }
    if (kills) q.log(`shilo: killed ${kills} undead beside us in ${tickNow(q.sdk) - t0}t at ${where(q)} (hp ${hp(q)}/${maxHp(q)}, prayer ${q.sdk.getPrayerState()?.prayerPoints})`);
}

/** Op `opt` on a loc and drive what it opens; true once `done`. */
async function opLoc(q: Quest, loc: NearbyLoc, opt: RegExp, choices: Array<RegExp | string>, done: () => boolean, ticks = 30, clear = true): Promise<boolean> {
    const option = loc.optionsWithIndex.find((o) => opt.test(o.text));
    if (!option) throw new Error(`shilo: ${loc.name} at (${loc.x},${loc.z}) has no ${opt} option`);
    if (clear) await clearAttackers(q);
    await disengage(q);
    await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, option.opIndex);
    await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { done: () => done() && !q.sdk.getDialog()?.isOpen, ticks: 60, log: q.log });
    return untilTicks(q.sdk, done, 5);
}

/** Use an inventory item on a loc and drive what it opens; true once `done`. */
async function useOnLoc(q: Quest, item: RegExp, loc: NearbyLoc, done: () => boolean, choices: Array<RegExp | string> = [], ticks = 30, clear = true): Promise<boolean> {
    const it = held(q, item);
    if (!it) throw new Error(`shilo: no ${item} to use on ${loc.name} (carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
    if (clear) await clearAttackers(q);
    await disengage(q);
    await q.sdk.sendUseItemOnLoc(it.slot, loc.x, loc.z, loc.id);
    await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { done: () => done() && !q.sdk.getDialog()?.isOpen, ticks: 60, log: q.log });
    return untilTicks(q.sdk, done, 5);
}

/** Use one inventory item on another (chisel on the pommel, wire on the beads). */
async function combine(q: Quest, a: RegExp, b: RegExp, product: RegExp): Promise<boolean> {
    for (let attempt = 1; attempt <= 3 && !has(q, product); attempt++) {
        const x = held(q, a);
        const y = held(q, b);
        if (!x || !y) return false;
        const mark = messageId(q);
        await disengage(q);
        await q.sdk.sendUseItemOnItem(x.slot, y.slot);
        await untilTicks(q.sdk, (s) => has(q, product) || !!s.dialog?.isOpen, 8);
        const text = q.sdk.getDialog()?.isOpen ? await driveDialog(q.sdk, [], { ticks: 20 }) : '';
        if (!has(q, product)) q.log(`shilo: ${a} on ${b}: ${(text || messagesSince(q, mark)).slice(0, 160)}`);
    }
    return has(q, product);
}

/** Walk on the surface or within one cave (bot.walkTo; no run-quest hooks). */
async function walk(q: Quest, tile: Tile, tolerance = 1): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt++) {
        if (Math.hypot(pos(q).x - tile.x, pos(q).z - tile.z) <= tolerance) return;
        const r = await q.bot.walkTo(tile.x, tile.z, tolerance);
        if (r.success) return;
        q.log(`shilo: walk to (${tile.x},${tile.z}) from ${where(q)}: ${r.message}`);
        await eatIfLow(q);
    }
    if (Math.hypot(pos(q).x - tile.x, pos(q).z - tile.z) > tolerance + 2) throw new Error(`shilo: could not walk to (${tile.x},${tile.z}) from ${where(q)}`);
}

/** Until the position holds still for 3 ticks: a fall's swim or a forced move is over. */
async function settle(q: Quest, ticks = 16): Promise<void> {
    let last = `${pos(q).x},${pos(q).z}`;
    let still = 0;
    for (let i = 0; i < ticks && still < 3; i++) {
        await q.sdk.waitForTicks(1);
        const now = `${pos(q).x},${pos(q).z}`;
        still = now === last ? still + 1 : 0;
        last = now;
    }
}

/**
 * Auto-retaliate off in the dungeons: an Undead One that lands a hit otherwise turns every op
 * (the cave-in, a search) into a fight, and a dying zombie's green mist chokes whoever is near.
 * controls.if com_2 (150) on, com_3 (151) off; the player's own setting comes back on the surface.
 */
let retaliateWas: boolean | null = null;
async function setRetaliate(q: Quest, on: boolean): Promise<void> {
    const now = q.sdk.getState()?.autoRetaliateEnabled;
    if (now === undefined || now === on) return;
    if (!on && retaliateWas === null) retaliateWas = now;
    for (let attempt = 1; attempt <= 3 && q.sdk.getState()?.autoRetaliateEnabled !== on; attempt++) {
        await q.sdk.sendSetTab(12).catch(() => undefined);
        await q.sdk.waitForTicks(1);
        await q.sdk.sendClickComponent(on ? 150 : 151);
        await untilTicks(q.sdk, (s) => s.autoRetaliateEnabled === on, 4);
    }
    await q.sdk.sendSetTab(3).catch(() => undefined);
    if (q.sdk.getState()?.autoRetaliateEnabled !== on) q.log(`shilo: auto-retaliate did not switch ${on ? 'on' : 'off'}`);
}
export async function dungeonMode(q: Quest): Promise<void> {
    await setRetaliate(q, false);
    if (!lifeguard) void guardLife(q);
}

/**
 * Eats in the background while we are in a dungeon: the undead hit through whatever the step is
 * waiting on (a dialog, a door, a walk) and two of them take ~1.3 hp a tick.
 */
let lifeguard = false;
async function guardLife(q: Quest): Promise<void> {
    lifeguard = true;
    let lastNote = tickNow(q.sdk);
    try {
        while (inAhZaRhoon(pos(q)) || inRashTomb(pos(q))) {
            if (hp(q) > 0 && hp(q) < maxHp(q) * 0.45) await eatIfLow(q, 0.45);
            await q.sdk.waitForTicks(1).catch(() => undefined);
            // A pulse every 100 ticks underground: where the food goes (two staging deaths at the bone door).
            if (tickNow(q.sdk) - lastNote >= 100) {
                lastNote = tickNow(q.sdk);
                const undead = q.sdk.getNearbyNpcs().filter((n) => /^undead one$/i.test(n.name) && (n.distance ?? 99) <= 3).length;
                q.log(`shilo: [below] ${where(q)} hp ${hp(q)}/${maxHp(q)}, ${foodHeld(q)} food, prayer ${q.sdk.getPrayerState()?.prayerPoints}, ${undead} undead within 3`);
            }
        }
    } catch {
        /* the guard must never break a step */
    } finally {
        lifeguard = false;
    }
}
async function restoreRetaliate(q: Quest): Promise<void> {
    if (retaliateWas === null) return;
    await setRetaliate(q, retaliateWas);
    retaliateWas = null;
}

// ── crossings

/** Over the log into the valley (`into`) or back out to the main jungle. */
async function crossLog(q: Quest, into: boolean): Promise<void> {
    for (let attempt = 1; attempt <= 4; attempt++) {
        const side = into ? LOG.west : LOG.east;
        const across = () => (into ? inValley(pos(q)) : pos(q).x <= 2906);
        if (across()) return;
        await walk(q, side, 0);
        const hp0 = hp(q);
        await q.sdk.sendInteractLoc(into ? LOG.westLoc : LOG.eastLoc, LOG.z, LOG.id, 1);
        // A fall is a swim down the river: about 8 ticks before the far bank.
        await untilTicks(q.sdk, across, 16);
        await settle(q);
        if (across()) {
            q.log(`shilo: over the log ${into ? 'into' : 'out of'} the valley at ${where(q)}${hp(q) < hp0 ? ` (fell, hp ${hp0} -> ${hp(q)})` : ''}`);
            await eatIfLow(q);
            return;
        }
        q.log(`shilo: log crossing attempt ${attempt} left us at ${where(q)}`);
    }
    throw new Error(`shilo: could not cross the log (at ${where(q)})`);
}

/** Over the stepping stones: north into the valley, south out of it. */
async function crossStones(q: Quest, north: boolean): Promise<void> {
    const across = () => (north ? inValley(pos(q)) : pos(q).z <= STONES.south && !inValley(pos(q)));
    for (let step = 0; step < 10 && !across(); step++) {
        const p = pos(q);
        if (p.x !== STONES.x || p.z < STONES.south || p.z > STONES.north) {
            await walk(q, { x: STONES.x, z: north ? STONES.south : STONES.north }, 0);
            continue;
        }
        const next = p.z + (north ? 1 : -1);
        const stone = (await locs(q, 4)).find((l) => /stepping stones/i.test(l.name) && l.x === STONES.x && l.z === next);
        if (!stone) {
            // Off the last stone: one step onto the bank.
            await q.sdk.sendWalk(STONES.x, next);
            await untilTicks(q.sdk, () => pos(q).z === next, 4);
            continue;
        }
        await q.sdk.sendInteractLoc(stone.x, stone.z, stone.id, 1);
        await untilTicks(q.sdk, () => pos(q).z !== p.z || pos(q).x !== p.x, 8);
        // A slip washes you to the far bank over ~6 ticks.
        await settle(q);
    }
    if (!across()) throw new Error(`shilo: could not cross the stepping stones (at ${where(q)})`);
    await eatIfLow(q);
    q.log(`shilo: over the stepping stones ${north ? 'into' : 'out of'} the valley at ${where(q)}`);
}

/** From the main jungle onto Cairn Isle: the climbing rocks, then the bridge (falls retried). */
async function toCairnIsland(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    let falls = 0;
    // stat_random 75/250 per crossing: ~half fail at Agility 35, and each fall is a walk back round.
    for (let attempt = 1; attempt <= 40 && !inBox(pos(q), 2755, 2775, 2970, 2995); attempt++) {
        await eatIfLow(q);
        const p = pos(q);
        if (p.z === CAIRN.z && p.x >= 2776 && p.x <= 2791) {
            // On the strip or the bridge: west to the island.
            const hp0 = hp(q);
            await q.bot.walkTo(CAIRN.bridgeWest.x, CAIRN.bridgeWest.z, 0);
            await settle(q);
            if (hp(q) < hp0 && !onCairn(pos(q))) q.log(`shilo: fell off Cairn's bridge (fall ${++falls}, hp ${hp0} -> ${hp(q)})`);
            continue;
        }
        await toJungle(q, CAIRN.eastStand, 0);
        await q.sdk.sendInteractLoc(CAIRN.eastRock, CAIRN.z, CAIRN.rockId, 1);
        await untilTicks(q.sdk, () => pos(q).x <= 2791, 10);
        await settle(q);
    }
    if (!inBox(pos(q), 2755, 2775, 2970, 2995)) throw new Error(`shilo: never got onto Cairn Isle (at ${where(q)}, ${falls} falls)`);
    q.log(`shilo: onto Cairn Isle in ${tickNow(q.sdk) - t0}t (${falls} bridge falls)`);
}

/** From Cairn Isle back to the main jungle by the bridge and the climbing rocks. */
async function offCairnIsland(q: Quest): Promise<void> {
    for (let attempt = 1; attempt <= 40 && onCairn(pos(q)); attempt++) {
        await eatIfLow(q);
        const p = pos(q);
        if (p.z === CAIRN.z && p.x >= 2789 && p.x <= 2791) {
            await q.sdk.sendInteractLoc(CAIRN.westRock, CAIRN.z, CAIRN.rockId, 1);
            await untilTicks(q.sdk, () => !onCairn(pos(q)), 10);
            await settle(q);
            continue;
        }
        const hp0 = hp(q);
        await q.bot.walkTo(2790, CAIRN.z, 0);
        await settle(q);
        // A fall throws you onto a river bank on the mainland side: off the island either way.
        if (hp(q) < hp0 && !onCairn(pos(q))) q.log(`shilo: fell off Cairn's bridge onto the bank at ${where(q)}`);
    }
    if (onCairn(pos(q))) throw new Error(`shilo: could not get off Cairn Isle (at ${where(q)})`);
}

// ── out of anywhere

/** Out of the dungeons and off Cairn Isle onto the surface (the valley is surface too). */
async function surface(q: Quest): Promise<void> {
    if (inRashTomb(pos(q))) await leaveRashTomb(q);
    if (inAhZaRhoon(pos(q))) await leaveAhZaRhoon(q);
    if (inBervTomb(pos(q))) await leaveBervTomb(q);
    if (onCairn(pos(q))) await offCairnIsland(q);
    if (!inAhZaRhoon(pos(q)) && !inRashTomb(pos(q)) && !inBervTomb(pos(q))) await restoreRetaliate(q);
}

/** Hajedy's cart (brimhavencartdriver, 2779,3211) to Shilo; Vigroy's (shilocartdriver, 2834,2954) back to (2776,3214). */
const HAJEDY = { x: 2779, z: 3211 };
const VIGROY = { x: 2834, z: 2954 };
/** The fare is 5% of the coins carried, 10 to 200 (hajedy.rs2 calc_shilocart_cost). */
const CART_MIN_COINS = 10;

/**
 * Into Shilo Village by Hajedy's cart from Brimhaven (from anywhere: Brimhaven's boat first). The
 * metal gate is no way in: barricades fence its outer side off from the jungle path ("I can't reach
 * that!" from Mosol's side, probed 2026-11-04). Throws when Hajedy will not take us: Shilo Village
 * not complete ("Since the troubles … we've had to stop them").
 */
export async function enterShiloVillage(q: Quest): Promise<void> {
    if (inShiloVillage(pos(q))) return;
    if (inShiloArea(pos(q))) await leaveShilo(q);
    if (q.count('coins') < CART_MIN_COINS) await q.ensure('coins', CART_MIN_COINS + 30);
    await toJungle(q, HAJEDY, 3);
    for (let attempt = 1; attempt <= 3 && !inShiloVillage(pos(q)); attempt++) {
        const seen = await q.talk(/^hajedy$/i, [/yes please, i'd like to go to shilo/i]);
        if (/had to stop them/i.test(seen)) throw new Error('shilo: Hajedy runs no carts — Shilo Village is not complete on this account');
        await untilTicks(q.sdk, () => inShiloVillage(pos(q)), 10);
        await driveDialog(q.sdk, [], { ticks: 10 });
    }
    if (!inShiloVillage(pos(q))) throw new Error(`shilo: Hajedy's cart did not take us to Shilo (at ${where(q)})`);
    q.log(`shilo: into Shilo Village by cart at ${where(q)}`);
}

/** Out of Shilo Village by Vigroy's cart to Brimhaven (the gates' outer side is fenced off). */
export async function leaveShiloVillage(q: Quest): Promise<void> {
    if (!inShiloVillage(pos(q))) return;
    if (q.count('coins') < CART_MIN_COINS) throw new Error(`shilo: ${q.count('coins')} coins — Vigroy's cart out costs ${CART_MIN_COINS}`);
    for (let attempt = 1; attempt <= 3 && inShiloVillage(pos(q)); attempt++) {
        await walk(q, VIGROY, 3);
        await q.talk(/^vigroy$/i, [/yes please, i'd like to go to brimhaven/i]);
        await untilTicks(q.sdk, () => !inShiloVillage(pos(q)), 10);
        await driveDialog(q.sdk, [], { ticks: 10 });
    }
    if (inShiloVillage(pos(q))) throw new Error(`shilo: Vigroy's cart did not take us out (at ${where(q)})`);
    q.log(`shilo: out of Shilo Village by cart at ${where(q)}`);
}

/** Out of the dungeons, Cairn Isle, the valley and the village onto the main jungle (or, given a tile off Karamja, home). */
export async function leaveShilo(q: Quest, tile?: Tile): Promise<void> {
    if (inShiloVillage(pos(q))) await leaveShiloVillage(q);
    await surface(q);
    if (inValley(pos(q))) {
        if (pos(q).z >= 3000) await crossLog(q, false);
        else await crossStones(q, false);
    }
    if (tile && !onIsland(tile)) await leaveJungle(q, tile);
}

async function leaveRashTomb(q: Quest): Promise<void> {
    await dungeonMode(q);
    const t0 = tickNow(q.sdk);
    for (let attempt = 1; attempt <= 14 && inRashTomb(pos(q)); attempt++) {
        await eatIfLow(q);
        const p = pos(q);
        if (inDolmenRoom(p)) {
            // From inside, the bone door puts you on its own tile (zq_enter_rashtomb).
            const door = await findLoc(q, LOC_NAME.tombDoors, /^open$/i, { x: 2892, z: RASH.doorZ });
            if (door) await opLoc(q, door, /^open$/i, [], () => !inDolmenRoom(pos(q)), 10, false);
            continue;
        }
        if (p.z <= 9512) {
            await walk(q, RASH.below, 1);
            const rock = (await locs(q, 5)).filter((l) => l.id === RASH.rockId && l.reachable !== false).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (rock) {
                await disengage(q);
                await q.sdk.sendInteractLoc(rock.x, rock.z, rock.id, 1);
                await untilTicks(q.sdk, () => pos(q).z > 9512, 10);
            }
            continue;
        }
        if (p.z <= 9516) {
            const gate = await findLoc(q, LOC_NAME.gate, /^open$/i);
            if (gate) await opLoc(q, gate, /^open$/i, [], () => pos(q).z > 9516, 10, false);
            continue;
        }
        const exit = await findLoc(q, LOC_NAME.tombExit, /^open$/i);
        if (!exit) {
            await walk(q, { x: 2929, z: 9525 }, 2);
            continue;
        }
        // With the key held the doors are "locked" until the key is used on them.
        if (held(q, ITEM.key)) await useOnLoc(q, ITEM.key, exit, () => !inRashTomb(pos(q)), [], 15, false);
        else await opLoc(q, exit, /^open$/i, [], () => !inRashTomb(pos(q)), 15, false);
    }
    if (inRashTomb(pos(q))) throw new Error(`shilo: stuck in Rashiliyia's tomb at ${where(q)}`);
    q.log(`shilo: out of Rashiliyia's tomb to ${where(q)} in ${tickNow(q.sdk) - t0}t`);
}

/** The cave-in between Ah Za Rhoon's halves. */
async function wriggle(q: Quest, toSouth: boolean): Promise<void> {
    const there = () => (toSouth ? inAhZaRhoonSouth(pos(q)) : inAhZaRhoon(pos(q)) && !inAhZaRhoonSouth(pos(q)));
    await dungeonMode(q);
    // oploc2 secretrubble is a mesbox then a choice, and every Undead One swing closes it
    // (if_close in playerhit): with one beside us the prompt never survives its two clicks. Clear
    // every undead within reach of the rubble first, then op at once (production: six tries all
    // closed at (2887,9374), 2026-11-03; staging: two of three on qlsh1).
    for (let attempt = 1; attempt <= 12 && !there(); attempt++) {
        await walk(q, toSouth ? AZR.caveInNorth : AZR.caveInSouth, 1);
        const rubble = await findLoc(q, LOC_NAME.caveIn, /^search$/i);
        if (!rubble) throw new Error(`shilo: no cave-in near ${where(q)}`);
        await eatIfLow(q);
        await clearAttackers(q, 4);
        const mark = messageId(q);
        await opLoc(q, rubble, /^search$/i, [/yes, i'll wriggle through/i], there, 30, false);
        if (!there()) {
            const st = q.sdk.getState();
            q.log(`shilo: cave-in attempt ${attempt} at ${where(q)}: ${messagesSince(q, mark).slice(0, 120)} [rubble ${rubble.x},${rubble.z} #${rubble.id} ${JSON.stringify(rubble.optionsWithIndex)}; autoret ${st?.autoRetaliateEnabled}; combat ${JSON.stringify(st?.player?.combat)}; rejected ${st?.opFeedback?.opRejectedCount}; dialog ${st?.dialog?.isOpen}; modal ${st?.modalOpen}]`);
        }
        await eatIfLow(q);
    }
    if (!there()) throw new Error(`shilo: could not wriggle through the cave-in (at ${where(q)})`);
}

async function leaveAhZaRhoon(q: Quest): Promise<void> {
    await dungeonMode(q);
    const t0 = tickNow(q.sdk);
    if (inAhZaRhoonSouth(pos(q))) await wriggle(q, false);
    for (let attempt = 1; attempt <= 4 && inAhZaRhoon(pos(q)); attempt++) {
        await walk(q, AZR.waterfall, 1);
        const rock = await findLoc(q, LOC_NAME.waterfall, /^search$/i, { x: 2940, z: 9349 });
        if (!rock) throw new Error(`shilo: no waterfall rocks near ${where(q)}`);
        await opLoc(q, rock, /^search$/i, [/yes, i'll follow the path/i], () => !inAhZaRhoon(pos(q)), 15);
        // A slip drags you along the river for ~6 ticks.
        await untilTicks(q.sdk, () => !inAhZaRhoon(pos(q)), 10);
        await settle(q);
        await eatIfLow(q);
    }
    if (inAhZaRhoon(pos(q))) throw new Error(`shilo: could not leave Ah Za Rhoon (at ${where(q)})`);
    q.log(`shilo: out of Ah Za Rhoon by the waterfall to ${where(q)} in ${tickNow(q.sdk) - t0}t`);
}

async function leaveBervTomb(q: Quest): Promise<void> {
    // stat_random 70/250 (~half fail at Agility 35); a fall costs 1-10 hp.
    for (let attempt = 1; attempt <= 25 && inBervTomb(pos(q)); attempt++) {
        await eatIfLow(q);
        await walk(q, BERV.handholds, 1);
        const rocks = await findLoc(q, LOC_NAME.handholds, /^climb$/i);
        if (!rocks) throw new Error(`shilo: no climbing rocks near ${where(q)}`);
        // stat_random 70/250: a fall costs 1-10 hp and leaves you below.
        await opLoc(q, rocks, /^climb$/i, [], () => !inBervTomb(pos(q)), 12);
        await settle(q);
        if (inBervTomb(pos(q)) && attempt % 5 === 0) q.log(`shilo: still in Bervirius' tomb after ${attempt} climbs (hp ${hp(q)})`);
    }
    if (inBervTomb(pos(q))) throw new Error(`shilo: could not climb out of Bervirius' tomb (at ${where(q)})`);
    q.log(`shilo: out of Bervirius' tomb to ${where(q)}`);
}

// ── getting to places

/** A tile in the valley: in by the log (north half) or the stepping stones (south half). */
export async function toValley(q: Quest, tile: Tile, tolerance = 1): Promise<void> {
    await surface(q);
    if (!inValley(pos(q))) {
        const north = tile.z >= 3000;
        await toJungle(q, north ? LOG.west : { x: STONES.x, z: STONES.south }, 0);
        if (north) await crossLog(q, true);
        else await crossStones(q, true);
    }
    await walk(q, tile, tolerance);
}

/** A tile on the main jungle (Mosol, Trufitus, the statue), from wherever we are. */
export async function toMainJungle(q: Quest, tile: Tile, tolerance = 3): Promise<void> {
    await leaveShilo(q);
    await toJungle(q, tile, tolerance);
}

/** Down the roped fissure into Ah Za Rhoon (stage roped and later). */
async function enterAhZaRhoon(q: Quest): Promise<void> {
    if (inAhZaRhoon(pos(q))) return;
    await toValley(q, MOUND, 1);
    // Any of the entrance's three forms: at stage roped and later, Search on each of them ends in
    // the crawl prompt (oploc2 ahzarhoon_entrance default / _fissure / _fissure_withrope).
    for (let attempt = 1; attempt <= 5 && !inAhZaRhoon(pos(q)); attempt++) {
        if (Math.hypot(pos(q).x - MOUND.x, pos(q).z - MOUND.z) > 3) await toValley(q, MOUND, 1);
        const fissure = await entranceLoc(q);
        if (!fissure) {
            q.log(`shilo: no fissure or mound by (2921,2999) from ${where(q)} (try ${attempt})`);
            await q.sdk.waitForTicks(5);
            continue;
        }
        await opLoc(q, fissure, /^search$/i, [/yes, i'll give it a go/i], () => inAhZaRhoon(pos(q)), 20);
    }
    if (inAhZaRhoon(pos(q))) await dungeonMode(q);
    if (!inAhZaRhoon(pos(q))) throw new Error(`shilo: did not get down the fissure (agility ${q.level('agility')}, at ${where(q)})`);
    q.log(`shilo: down the fissure into Ah Za Rhoon at ${where(q)}`);
}

/** Under the well stacked rocks into Bervirius' tomb. */
async function enterBervTomb(q: Quest): Promise<void> {
    if (inBervTomb(pos(q))) return;
    if (inShiloArea(pos(q)) && !onCairn(pos(q))) await leaveShilo(q);
    if (!onCairn(pos(q))) await toCairnIsland(q);
    for (let attempt = 1; attempt <= 6 && !inBervTomb(pos(q)); attempt++) {
        await eatIfLow(q);
        await walk(q, CAIRN.crawl, 0);
        const rocks = await findLoc(q, LOC_NAME.crawl, /^search$/i);
        if (!rocks) throw new Error(`shilo: no well stacked rocks near ${where(q)}`);
        const mark = messageId(q);
        const text = await (async () => {
            await opLoc(q, rocks, /^search$/i, [/yes please, i can think of nothing nicer/i], () => inBervTomb(pos(q)), 20);
            return messagesSince(q, mark);
        })();
        // "You find nothing of significance": the tattered scroll has not been read yet.
        if (!inBervTomb(pos(q)) && attempt >= 2) q.log(`shilo: crawl attempt ${attempt} failed at ${where(q)}: ${text.slice(0, 120)}`);
        if (!inBervTomb(pos(q))) await readScroll(q, ITEM.tattered);
    }
    if (!inBervTomb(pos(q))) throw new Error(`shilo: could not crawl into Bervirius' tomb (agility ${q.level('agility')}, at ${where(q)})`);
    q.log(`shilo: into Bervirius' tomb at ${where(q)}`);
}

/** Through the hidden doors into Rashiliyia's tomb (stage unlocked and later, beads worn). */
async function enterRashTomb(q: Quest): Promise<void> {
    if (inRashTomb(pos(q))) return;
    await toValley(q, TOMB_DOOR, 1);
    for (let attempt = 1; attempt <= 4 && !inRashTomb(pos(q)); attempt++) {
        await revealDoors(q);
        const doors = await findLoc(q, LOC_NAME.carvedDoors, /^open$/i);
        const mark = messageId(q);
        if (doors) await opLoc(q, doors, /^open$/i, [], () => /creak open/i.test(messagesSince(q, mark)), 8);
        const entrance = await findLoc(q, LOC_NAME.entrance, /^enter$/i);
        if (entrance) await opLoc(q, entrance, /^enter$/i, [], () => inRashTomb(pos(q)), 10);
    }
    if (inRashTomb(pos(q))) await dungeonMode(q);
    if (!inRashTomb(pos(q))) throw new Error(`shilo: could not get into Rashiliyia's tomb (at ${where(q)})`);
    await driveDialog(q.sdk, [], { ticks: 8 });
    q.log(`shilo: into Rashiliyia's tomb at ${where(q)}`);
}

/** The palm trees spring back 50 ticks after a search: search them right before every door step. */
async function revealDoors(q: Quest): Promise<void> {
    const shown = async () => {
        for (let i = 0; i < 3; i++) {
            if ((await locs(q, 5)).some((l) => LOC_NAME.carvedDoors.test(l.name) || LOC_NAME.entrance.test(l.name))) return true;
            await q.sdk.waitForTicks(1);
        }
        return false;
    };
    if (await shown()) return;
    const palm = await findLoc(q, LOC_NAME.palm, /^search$/i, { x: 2916, z: 3092 });
    if (!palm) throw new Error(`shilo: no palm trees near ${where(q)}`);
    const mark = messageId(q);
    await opLoc(q, palm, /^search$/i, [], () => /reveal an ancient doorway|already pulled apart/i.test(messagesSince(q, mark)), 10);
    if (!(await shown())) q.log(`shilo: the palm search showed no doors (${messagesSince(q, mark).slice(0, 120)})`);
}

/** Read a quest scroll (sets its bit); closes the scroll interface after. */
export async function readScroll(q: Quest, item: RegExp): Promise<void> {
    const it = held(q, item);
    if (!it) return;
    await disengage(q);
    await q.sdk.sendUseItem(it.slot, 1);
    await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 6);
    await driveDialog(q.sdk, [/^yes please/i], { ticks: 30 });
    await untilTicks(q.sdk, (s) => !!s.modalOpen, 4);
    await q.bot.closeInterface().catch(() => undefined);
}

// ── the quest steps

/** Mosol Rei's Wampum belt (needs Jungle Potion), shown to Trufitus: started. */
export async function startQuest(q: Quest): Promise<void> {
    if (!held(q, ITEM.belt)) {
        // Up to three talks, finishing any chain left open: jacklove2's ended with Mosol's dialog
        // still open (1 option) among 9 Undead Ones, and no belt (2026-11-02).
        const choices = [/yes, i'm sure and i'll take the wampum belt/i, /i'll go to see the shaman/i, /^what can we do/i, /who is she/i, /^why do i need to run/i];
        for (let attempt = 1; attempt <= 3 && !held(q, ITEM.belt); attempt++) {
            await toMainJungle(q, MOSOL, 4);
            await q.talk(/^mosol rei$/i, choices, MOSOL).catch((e) => q.log(`shilo: Mosol Rei talk ${attempt}: ${(e as Error).message}`));
            if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { done: () => !!held(q, ITEM.belt), ticks: 80, log: q.log });
            if (!held(q, ITEM.belt)) q.log(`shilo: no Wampum belt after Mosol Rei talk ${attempt} at ${where(q)}`);
        }
        if (!held(q, ITEM.belt)) throw new Error('shilo: Mosol Rei gave no Wampum belt');
    }
    await toMainJungle(q, TRUFITUS, 4);
    for (let attempt = 1; attempt <= 3 && held(q, ITEM.belt); attempt++) {
        const trufitus = q.sdk.findNearbyNpc(/^trufitus$/i);
        if (!trufitus) {
            await toMainJungle(q, TRUFITUS, 2);
            continue;
        }
        await q.bot.useItemOnNpc(held(q, ITEM.belt)!, trufitus).catch(() => undefined);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 10);
        await driveDialog(q.sdk, [/yes, i will seriously look/i, /i am going to search for ah za rhoon/i, /why was it called ah za rhoon/i, /said something about a legend/i], { ticks: 200, log: q.log });
    }
}

/** The spade on the mound: dug (from started or searched). */
export async function digMound(q: Quest): Promise<void> {
    await toValley(q, MOUND, 1);
    const mound = await findLoc(q, /^(mound of earth|fissure)$/i, undefined, { x: 2921, z: 2999 });
    if (!mound) throw new Error(`shilo: no mound of earth near ${where(q)}`);
    if (/fissure/i.test(mound.name)) return;
    const mark = messageId(q);
    // "You start digging..." then four 2-tick steps to "You might just be able to crawl through it...".
    await useOnLoc(q, /^spade$/i, mound, () => /crawl through it|already excavated/i.test(messagesSince(q, mark)), [], 20);
    await driveDialog(q.sdk, [], { ticks: 10 });
}

/** A light into the fissure (lit), then the rope (roped). */
export async function lightFissure(q: Quest): Promise<void> {
    await useFissure(q, /^lit candle$/i, 'the lit candle');
}
export async function ropeFissure(q: Quest): Promise<void> {
    await useFissure(q, /^rope$/i, 'the rope');
}
async function useFissure(q: Quest, item: RegExp, what: string): Promise<void> {
    await toValley(q, MOUND, 1);
    const before = q.count(item);
    // Up to three tries. From stage dug the mound's Look-at (op1) turns it into the Fissure for 50
    // ticks with one mesbox (quest_zombiequeen.rs2 oploc1,ahzarhoon_entrance), and the item goes
    // on at once. Search (op2) opens the crawl prompt instead; jacklove5's candle "did not go in"
    // and the next try found "no fissure" by the mound it had just searched (2026-11-02).
    // One player at the mound at a time: loc_change is world-wide, so a second account's op on
    // the mound/fissure turns it back for both (jacklove2's three tries failed with ABGARMY07 on
    // its tile, 2026-11-02). Wait (bounded) until nobody else is within 4 tiles.
    // Tie-break so two of ours never wait on each other: the name that sorts first goes ahead.
    const me = (q.sdk.getState()?.player?.name ?? '').toLowerCase();
    const crowded = () => (q.sdk.getNearbyPlayers() ?? []).some((pl) => Math.abs(pl.x - 2921) <= 4 && Math.abs(pl.z - 2999) <= 4 && pl.name.toLowerCase() < me);
    for (let attempt = 1; attempt <= 8 && q.count(item) >= before; attempt++) {
        const t0 = tickNow(q.sdk);
        let noted = false;
        while (crowded() && tickNow(q.sdk) - t0 < 300) {
            if (!noted) q.log(`shilo: another player at the mound — waiting (try ${attempt})`);
            noted = true;
            await q.sdk.waitForTicks(5);
        }
        // Only the bare fissure (2218) takes the candle or the rope. The mound (2217) and the roped
        // fissure (2219) share its name and its 3x3 tile, and either answers an item with "Nothing
        // interesting happens" (oplocu ahzarhoon_entrance / _fissure_withrope). Every account's
        // Look-at or Search flips the loc world-wide for 50 ticks, so a second account at another
        // stage leaves it as 2219 (roped and later) or 2217 (after the timer). Look-at (op1) on
        // either, at stage dug or lit, turns it into 2218 (oploc1 ahzarhoon_entrance and
        // ahzarhoon_entrance_fissure_withrope): then the item goes on at once.
        let fissure = await entranceLoc(q);
        for (let look = 0; look < 3 && fissure && fissure.id !== FISSURE_ID.bare; look++) {
            await opLoc(q, fissure, /^look-at$/i, [], () => false, 6);
            await driveDialog(q.sdk, [/no thanks/i], { ticks: 12 });
            fissure = await entranceLoc(q);
        }
        if (!fissure || fissure.id !== FISSURE_ID.bare) {
            const near = (await locs(q, 4)).map((l) => `${l.name}#${l.id}@${l.x},${l.z}`).join(' ');
            q.log(`shilo: no bare fissure by (2921,2999) from ${where(q)} (try ${attempt}); near: ${near.slice(0, 160)}`);
            await q.sdk.waitForTicks(5);
            continue;
        }
        const mark = messageId(q);
        await useOnLoc(q, item, fissure, () => q.count(item) < before, [], 20);
        await driveDialog(q.sdk, [], { ticks: 20 });
        const said = messagesSince(q, mark);
        // Already done on an earlier run (quest_zombiequeen.rs2 oplocu fissure): nothing to use up.
        if (/already a rope attached|already seen inside the fissure/i.test(said)) {
            q.log(`shilo: ${what}: ${said.slice(0, 80)} — already done`);
            return;
        }
        if (q.count(item) >= before) q.log(`shilo: ${what} did not go into the fissure (try ${attempt}; ${fissure.name}#${fissure.id} @${fissure.x},${fissure.z}): ${said.slice(0, 140)}`);
    }
    if (q.count(item) >= before) throw new Error(`shilo: ${what} did not go into the fissure near ${where(q)}`);
}

/** quest_zombiequeen.loc → content/pack/loc.pack: the mound and the fissure's two forms, all at (2921,2999). */
const FISSURE_ID = { mound: 2217, bare: 2218, roped: 2219 };
/** Whatever form the entrance is in right now (a scan can miss it for a tick after a walk or a loc_change). */
async function entranceLoc(q: Quest): Promise<NearbyLoc | undefined> {
    for (let i = 0; i < 4; i++) {
        const loc = (await locs(q, 6)).find((l) => Object.values(FISSURE_ID).includes(l.id) && Math.abs(l.x - 2921) <= 2 && Math.abs(l.z - 2999) <= 2);
        if (loc) return loc;
        await q.sdk.waitForTicks(1);
    }
    return undefined;
}

export async function descendFissure(q: Quest): Promise<void> {
    await enterAhZaRhoon(q);
}

/**
 * Ah Za Rhoon's three finds, read; Zadimus buried at the tribal statue; into Bervirius' tomb
 * for the dolmen's pommel, crystal and notes (notes). Each part is skipped when its item is
 * already held, so a resumed run picks up where the last stopped.
 */
export async function ahZaRhoonAndBervirius(q: Quest): Promise<void> {
    const needCorpse = !has(q, ITEM.zadimus) && !has(q, ITEM.shard) && !has(q, ITEM.key);
    const needTattered = !has(q, ITEM.tattered);
    const needCrumpled = !has(q, ITEM.crumpled);
    if (needCorpse || needTattered || needCrumpled || inAhZaRhoon(pos(q))) {
        await enterAhZaRhoon(q);
        const t0 = tickNow(q.sdk);
        if (!inAhZaRhoonSouth(pos(q))) await wriggle(q, true);
        if (!has(q, ITEM.crumpled)) await searchFor(q, AZR.sacks, LOC_NAME.sacks, ITEM.crumpled, []);
        if (!has(q, ITEM.zadimus) && !has(q, ITEM.shard) && !has(q, ITEM.key)) await searchFor(q, AZR.gallows, LOC_NAME.gallows, ITEM.zadimus, [/yes, i may find something else/i]);
        if (!has(q, ITEM.tattered)) await searchFor(q, AZR.bookcase, LOC_NAME.bookcase, ITEM.tattered, [/yes, i'm quite sure/i]);
        q.log(`shilo: Ah Za Rhoon finds in ${tickNow(q.sdk) - t0}t (hp ${hp(q)}/${maxHp(q)}, ${eaten} eaten so far)`);
        // Read on the surface: a reading's choice under an undead's swings is closed every time.
        await leaveAhZaRhoon(q);
        await readScroll(q, ITEM.crumpled);
    }
    if (has(q, ITEM.zadimus)) await buryZadimus(q);
    await readScroll(q, ITEM.tattered);
    await enterBervTomb(q);
    await walk(q, BERV.dolmen, 1);
    const dolmen = await findLoc(q, LOC_NAME.dolmen, /^search$/i);
    if (!dolmen) throw new Error(`shilo: no tomb dolmen near ${where(q)}`);
    await opLoc(q, dolmen, /^search$/i, [], () => has(q, ITEM.pommel) || has(q, ITEM.boneBeads) || has(q, ITEM.deadBeads), 20);
    await driveDialog(q.sdk, [], { ticks: 20 });
    // The notes are only for Trufitus and crumble when dropped: a slot back for food.
    const notes = held(q, /^bervirius notes$/i);
    if (notes) {
        await q.sdk.sendDropItem(notes.slot);
        await untilTicks(q.sdk, () => !held(q, /^bervirius notes$/i), 4);
        await driveDialog(q.sdk, [], { ticks: 6 });
    }
    q.log(`shilo: Bervirius' dolmen searched; carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')}`);
}

/** Search a loc (walking there first) until `item` is held; the bookcase can drop rocks on you. */
async function searchFor(q: Quest, at: Tile, name: RegExp, item: RegExp, choices: RegExp[]): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !has(q, item); attempt++) {
        await eatIfLow(q);
        await walk(q, at, 1);
        const loc = await findLoc(q, name, /^search$/i);
        if (!loc) throw new Error(`shilo: no ${name} near ${where(q)}`);
        await opLoc(q, loc, /^search$/i, choices, () => has(q, item), 20);
    }
    if (!has(q, item)) throw new Error(`shilo: found no ${item} at ${where(q)}`);
}

async function buryZadimus(q: Quest): Promise<void> {
    await toMainJungle(q, STATUE, 1);
    for (let attempt = 1; attempt <= 3 && has(q, ITEM.zadimus); attempt++) {
        if (!inBox(pos(q), 2794, 2798, 3087, 3090)) await walk(q, STATUE, 0);
        const corpse = held(q, ITEM.zadimus)!;
        await q.sdk.sendUseItem(corpse.slot, 1);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || has(q, ITEM.shard), 10);
        await driveDialog(q.sdk, [], { done: () => has(q, ITEM.shard) && !q.sdk.getDialog()?.isOpen, ticks: 60 });
    }
    if (!has(q, ITEM.shard)) throw new Error(`shilo: burying Zadimus gave no bone shard (at ${where(q)})`);
    q.log('shilo: Zadimus buried at the tribal statue; bone shard');
}

/** Bone beads from the pommel (Crafting 15), and the Beads of the Dead with the wire (16), worn. */
async function makeBeads(q: Quest): Promise<void> {
    if (has(q, ITEM.pommel)) await combine(q, /^chisel$/i, ITEM.pommel, ITEM.boneBeads);
    if (has(q, ITEM.boneBeads) && !has(q, ITEM.deadBeads)) {
        await readScroll(q, ITEM.crumpled);
        if (!(await combine(q, /^bronze wire$/i, ITEM.boneBeads, ITEM.deadBeads))) throw new Error(`shilo: could not make the Beads of the Dead (crafting ${q.level('crafting')})`);
        q.log('shilo: Beads of the Dead made');
    }
}

async function wearBeads(q: Quest): Promise<void> {
    // Lost (a death in the tomb drops the pack; only three items are kept): Bervirius' dolmen hands
    // out another pommel whenever none of the pommel, the bone beads or the Beads of the Dead is held
    // or banked (zqhaspommel, quest_zombiequeen.rs2). readyForTomb brought the chisel and the wire.
    if (!beadsInSomeForm(q)) {
        q.log('shilo: no beads in any form — back to Bervirius\' dolmen for another pommel');
        await enterBervTomb(q);
        await walk(q, BERV.dolmen, 1);
        const dolmen = await findLoc(q, LOC_NAME.dolmen, /^search$/i);
        if (!dolmen) throw new Error(`shilo: no tomb dolmen near ${where(q)}`);
        await opLoc(q, dolmen, /^search$/i, [/^no, i don't want/i], () => has(q, ITEM.pommel), 20);
        await driveDialog(q.sdk, [/^no, i don't want/i], { ticks: 20 });
        if (!has(q, ITEM.pommel)) throw new Error(`shilo: Bervirius' dolmen gave no pommel (carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
        await leaveBervTomb(q);
    }
    await makeBeads(q);
    if (q.sdk.getEquipment().some((i) => ITEM.deadBeads.test(i.name))) return;
    const beads = held(q, ITEM.deadBeads);
    if (!beads) throw new Error('shilo: no Beads of the Dead to wear');
    await q.bot.equipItem(beads);
    if (!(await untilTicks(q.sdk, () => q.sdk.getEquipment().some((i) => ITEM.deadBeads.test(i.name)), 5))) throw new Error('shilo: could not wear the Beads of the Dead');
}

/** The bone lock found (door), with the bone beads made on the way. */
export async function findBoneDoor(q: Quest): Promise<void> {
    await makeBeads(q);
    await toValley(q, TOMB_DOOR, 1);
    // The palms are shared: another account's 50-tick hide queue can close them right after our search.
    let doors: NearbyLoc | undefined;
    for (let attempt = 1; attempt <= 5 && !doors; attempt++) {
        await revealDoors(q);
        doors = await findLoc(q, LOC_NAME.carvedDoors, /^search$/i);
        if (!doors) await q.sdk.waitForTicks(3);
    }
    if (!doors) throw new Error(`shilo: no carved doors after the palm search (at ${where(q)})`);
    // "...it seems to be made out of bone!" (a mesbox): sets zq_found_door at stage 9.
    const text = await (async () => {
        await opLoc(q, doors, /^search$/i, [], () => false, 8);
        return driveDialog(q.sdk, [], { ticks: 10 });
    })();
    q.log(`shilo: searched the carved doors: ${text.slice(0, 100)}`);
}

/** The bone key (Crafting 20) into the lock: unlocked. */
export async function unlockDoor(q: Quest): Promise<void> {
    if (has(q, ITEM.shard)) await combine(q, /^chisel$/i, ITEM.shard, ITEM.key);
    if (!has(q, ITEM.key)) throw new Error(`shilo: no bone key (crafting ${q.level('crafting')})`);
    await wearBeads(q);
    await toValley(q, TOMB_DOOR, 1);
    for (let attempt = 1; attempt <= 3; attempt++) {
        await revealDoors(q);
        const doors = await findLoc(q, LOC_NAME.carvedDoors);
        if (!doors) continue;
        const mark = messageId(q);
        await useOnLoc(q, ITEM.key, doors, () => /creak open|shimmering light/i.test(messagesSince(q, mark)), [], 10);
        if (/creak open|shimmering light/i.test(messagesSince(q, mark))) return;
    }
}

// ── before Rashiliyia's tomb

const FOOD = /^(shark|swordfish|lobster|monkfish|tuna|bass)$/i;
const foodHeld = (q: Quest) => q.sdk.getInventory().filter((i) => FOOD.test(i.name)).length;
/** Fewer than this going into the tomb: home for more first. */
const TOMB_FOOD = 12;
/** Topped up to this (or the free slots). */
const TOMB_FOOD_FULL = 20;
const WEAPON = /^(dragon|rune|adamant|mithril|black|steel|iron) (scimitar|longsword)$/i;
const WEAPON_ORDER = ['dragon', 'rune', 'adamant', 'mithril', 'black', 'steel', 'iron'];
/** Done with by the tomb (the scrolls are read, the crystal is never used): banked on a restock. */
const TOMB_JUNK = /^(spade|tinderbox|tattered scroll|crumpled scroll|locating crystal|bervirius notes|rope|candle|lit candle)$/i;
/** The Fight Arena's altars, the nearest to the hub (lib/fight-arena.ts). */
const ALTAR = { x: 2605, z: 3209 };

/** Any form of the beads: the pommel and the bone beads still make them (makeBeads). */
const beadsInSomeForm = (q: Quest) => has(q, ITEM.deadBeads) || has(q, ITEM.boneBeads) || has(q, ITEM.pommel);

/**
 * Bank-stocked for Rashiliyia's tomb: food, the weapon, a prayer bar, the bones (before the bone
 * door) and a way to the beads. Nine Undead Ones and Nazastarool take ~10 sharks at 60 hp; the trip
 * from Ah Za Rhoon and Cairn Isle arrives with ~5. qlsh1 died at the bone door with 5 (staging,
 * 2026-11-04), as jacklove5 and ABGARMY07 did in production, and the respawn in Lumbridge is where
 * the next step's "could not get into the dolmen room (at (3221,3219))" came from. Also the
 * recovery after any death: the pack is gone, so the bank (then the mule) fills it again.
 */
export async function readyForTomb(q: Quest, bones: boolean): Promise<void> {
    if (inRashTomb(pos(q))) return;
    const weaponed = () => q.sdk.getEquipment().some((i) => WEAPON.test(i.name)) || !!held(q, WEAPON);
    const prayerLow = () => q.level('prayer') >= PROTECT_MELEE_LEVEL && (q.sdk.getPrayerState()?.prayerPoints ?? 0) < q.level('prayer') * 0.8;
    const bonesShort = () => bones && q.count(/^bones$/i) < 3;
    const beadKit = () => beadsInSomeForm(q) || (has(q, /^chisel$/i) && has(q, /^bronze wire$/i)) || (has(q, ITEM.boneBeads) && has(q, /^bronze wire$/i));
    const short = () => [foodHeld(q) < TOMB_FOOD && `food ${foodHeld(q)}`, !weaponed() && 'weapon', bonesShort() && `bones ${q.count(/^bones$/i)}`, !beadKit() && 'beads', prayerLow() && `prayer ${q.sdk.getPrayerState()?.prayerPoints}`].filter(Boolean);
    if (!short().length) return;
    q.log(`shilo: restocking for Rashiliyia's tomb (${short().join(', ')}) from ${where(q)}`);
    await q.goTo(SAFE_BANKS.ardougne, 4);
    const opened = q.sdk.getState()?.bank?.isOpen || (await q.bot.openBank()).success;
    if (!opened) throw new Error(`shilo: the Ardougne bank did not open for the tomb restock (at ${where(q)})`);
    for (const it of q.sdk.getInventory().filter((i) => TOMB_JUNK.test(i.name) || (beadsInSomeForm(q) && /^(bronze wire|chisel)$/i.test(i.name)))) {
        await q.bot.depositItem(it, -1).catch(() => undefined);
        await q.sdk.waitForTicks(1);
    }
    const take = async (pattern: RegExp, want: number) => {
        const have = q.count(pattern);
        if (have >= want) return;
        const banked = q.sdk.findBankItem(pattern);
        if (!banked) return;
        await q.bot.withdrawItem(banked, Math.min(want - have, banked.count ?? want)).catch(() => undefined);
        await untilTicks(q.sdk, () => q.count(pattern) > have, 4);
    };
    await take(/^coins$/i, 2 * FARE);
    if (!weaponed()) {
        const best = WEAPON_ORDER.map((m) => q.sdk.findBankItem(new RegExp(`^${m} (scimitar|longsword)$`, 'i'))).find(Boolean);
        if (best) await take(new RegExp(`^${best.name}$`, 'i'), 1);
    }
    if (bones) await take(/^bones$/i, 3);
    if (!beadsInSomeForm(q)) {
        // Banked by a naked prologue (QuestDef.carry withdraws them too); else the dolmen's pommel again.
        for (const it of [ITEM.deadBeads, ITEM.boneBeads, ITEM.pommel]) if (!beadsInSomeForm(q)) await take(it, 1);
        if (!beadsInSomeForm(q)) {
            await take(/^chisel$/i, 1);
            await take(/^bronze wire$/i, 1);
        }
    }
    const room = () => 28 - q.sdk.getInventory().length - 1;
    await take(/^shark$/i, Math.min(TOMB_FOOD_FULL, foodHeld(q) + room()));
    await q.bot.closeBank().catch(() => undefined);
    if (foodHeld(q) < TOMB_FOOD) {
        const want = Math.min(TOMB_FOOD_FULL, foodHeld(q) + room());
        const ok = await requestFromMule({ sdk: q.sdk, bot: q.bot, session: null, log: q.log }, [{ label: 'shark', pattern: /^shark$/i, count: want }], { mule: 'jackthief', timeoutMs: ticksToMs(600) }).catch(() => false);
        q.log(`shilo: mule jackthief for sharks: ${ok ? 'supplied' : 'not all supplied'} (${foodHeld(q)} food)`);
    }
    if (foodHeld(q) < TOMB_FOOD) throw new NeedsStock([{ item: 'shark', count: TOMB_FOOD - foodHeld(q) }]);
    if (!weaponed()) throw new NeedsStock([{ item: 'melee weapon', count: 1 }]);
    if (!has(q, ITEM.boneBeads) && !beadsInSomeForm(q)) {
        if (!has(q, /^chisel$/i)) await q.ensure('chisel', 1);
        if (!has(q, /^bronze wire$/i)) await q.ensure('bronze wire', 1);
    }
    if (bonesShort()) await q.ensure('bones', 3);
    if (prayerLow()) {
        await q.goTo(ALTAR, 2);
        await q.sdk.scanNearbyLocs(6).catch(() => undefined);
        const altar = q.sdk.findNearbyLoc(/^altar$/i, { withOption: /pray/i });
        if (altar) {
            await q.bot.interactLoc(altar, /pray/i).catch(() => undefined);
            await untilTicks(q.sdk, (s) => (s.prayers?.prayerPoints ?? 0) >= (s.prayers?.prayerLevel ?? 99), 10);
        }
    }
    await wieldWeapon(q);
    q.log(`shilo: restocked — ${foodHeld(q)} food, prayer ${q.sdk.getPrayerState()?.prayerPoints}/${q.level('prayer')}; carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')}`);
}

/** Beads worn, through the doors and the ancient gate: entered with beads. */
export async function enterWithBeads(q: Quest): Promise<void> {
    await readyForTomb(q, true);
    await wearBeads(q);
    await readyForTomb(q, true);
    await enterRashTomb(q);
    for (let attempt = 1; attempt <= 3 && pos(q).z > 9516; attempt++) {
        const gate = await findLoc(q, LOC_NAME.gate, /^open$/i);
        if (!gate) throw new Error(`shilo: no ancient gate near ${where(q)}`);
        await opLoc(q, gate, /^open$/i, [], () => pos(q).z <= 9515, 12, false);
    }
    q.log(`shilo: through the ancient gate at ${where(q)}`);
}

/** Down the rocks to the bone door (from anywhere in the tomb above it). */
async function toBoneDoor(q: Quest): Promise<void> {
    if (!inRashTomb(pos(q))) await enterRashTomb(q);
    for (let attempt = 1; attempt <= 4 && pos(q).z > 9516; attempt++) {
        const gate = await findLoc(q, LOC_NAME.gate, /^open$/i);
        if (gate) await opLoc(q, gate, /^open$/i, [], () => pos(q).z <= 9515, 12, false);
    }
    for (let attempt = 1; attempt <= 4 && pos(q).z > 9512; attempt++) {
        await eatIfLow(q);
        const rock = (await locs(q, 6)).filter((l) => l.id === RASH.rockId && l.reachable !== false).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!rock) throw new Error(`shilo: no rocks to climb down near ${where(q)}`);
        await disengage(q);
        await q.sdk.sendInteractLoc(rock.x, rock.z, rock.id, 1);
        await untilTicks(q.sdk, () => pos(q).z <= 9512, 10);
    }
    if (pos(q).z > 9512) throw new Error(`shilo: could not climb down the rocks (at ${where(q)})`);
    await walk(q, RASH.door, 1);
    await eatIfLow(q);
}

/** Three bones in the door's recesses: it opens and lets us in (unlocked tomb door). */
export async function fillBoneDoor(q: Quest): Promise<void> {
    await readyForTomb(q, true);
    await wearBeads(q);
    await readyForTomb(q, true);
    if (!inDolmenRoom(pos(q))) await toBoneDoor(q);
    await dungeonMode(q);
    // Prayed while the bones go in: the undead swing at us through every objbox here, and two
    // accounts died at this door (jacklove5, ABGARMY07, 2026-11-03).
    protect(q, true);
    for (let attempt = 1; attempt <= 5 && !inDolmenRoom(pos(q)) && q.count(/^bones$/i) > 0; attempt++) {
        await eatIfLow(q);
        const door = await findLoc(q, LOC_NAME.tombDoors, undefined, { x: 2892, z: RASH.doorZ });
        if (!door) throw new Error(`shilo: no tomb doors near ${where(q)}`);
        const before = q.count(/^bones$/i);
        // Each bone is taken before its objbox, so the boxes are left to the undead's swings: three
        // bones in ~10 ticks, not 30 a bone (all three 400 ms gate runs died here driving them).
        const bone = held(q, /^bones$/i)!;
        await disengage(q);
        await q.sdk.sendUseItemOnLoc(bone.slot, door.x, door.z, door.id);
        if (await untilTicks(q.sdk, () => q.count(/^bones$/i) < before || inDolmenRoom(pos(q)), 8)) attempt--;
    }
    // The last bone's mesbox walks you in; if a swing closed it, the door now opens (stage 12).
    await driveDialog(q.sdk, [], { ticks: 10 });
    // Inside before returning, never left at the door: the journal read that follows a step takes
    // ~600 ticks when the undead keep closing the quest interface, and four of them beat qlshb1 and
    // qlsh2 to death on (2892,9480) holding 13-20 sharks (staging, 2026-11-04). The dolmen room has
    // none of them.
    for (let attempt = 1; attempt <= 5 && !inDolmenRoom(pos(q)) && q.count(/^bones$/i) === 0 && inRashTomb(pos(q)); attempt++) {
        await eatIfLow(q);
        await clearAttackers(q);
        const door = await findLoc(q, LOC_NAME.tombDoors, /^open$/i, { x: 2892, z: RASH.doorZ });
        if (door) await opLoc(q, door, /^open$/i, [], () => inDolmenRoom(pos(q)), 10, false);
        else await q.sdk.waitForTicks(2);
    }
    q.log(`shilo: bone door — ${q.count(/^bones$/i)} bones left, ${inDolmenRoom(pos(q)) ? 'in the dolmen room' : 'outside'} at ${where(q)} (hp ${hp(q)}, ${foodHeld(q)} food)`);
}

/** Into the dolmen room once the door is unlocked. */
async function intoDolmenRoom(q: Quest): Promise<void> {
    if (inDolmenRoom(pos(q))) return;
    await toBoneDoor(q);
    for (let attempt = 1; attempt <= 3 && !inDolmenRoom(pos(q)); attempt++) {
        const door = await findLoc(q, LOC_NAME.tombDoors, /^open$/i, { x: 2892, z: RASH.doorZ });
        if (door) await opLoc(q, door, /^open$/i, [], () => inDolmenRoom(pos(q)), 10, false);
        if (!inDolmenRoom(pos(q))) q.log(`shilo: tomb door attempt ${attempt} left us at ${where(q)} (${door ? `${door.name}#${door.id}@${door.x},${door.z}` : 'no door with Open'}; hp ${hp(q)}, ${foodHeld(q)} food)`);
    }
    if (!inDolmenRoom(pos(q))) throw new Error(`shilo: could not get into the dolmen room (at ${where(q)})`);
}

/**
 * The dolmen room is shared: another account's Nazastarool is not ours to kill (its kill sets
 * nothing for us). Ours targets us; one targeting nobody yet counts only with nobody else here.
 */
function ourNazastarool(q: Quest) {
    const others = new Set((q.sdk.getNearbyPlayers?.() ?? []).map((p) => p.index));
    const all = q.sdk.getNearbyNpcs().filter((n) => /^nazastarool$/i.test(n.name));
    return (
        all.find((n) => n.targetIndex >= 32768 && !others.has(n.targetIndex - 32768)) ??
        (others.size === 0 ? all.find((n) => n.targetIndex < 0) : undefined)
    );
}

/**
 * The dolmen wakes Nazastarool three times (zombie, skeleton, ghost); the third leaves
 * Rashiliyia's remains, taken by searching the dolmen again (retrieved corpse).
 */
export async function fightNazastarool(q: Quest): Promise<void> {
    await readyForTomb(q, false);
    await wearBeads(q);
    await readyForTomb(q, false);
    await intoDolmenRoom(q);
    await dungeonMode(q);
    // Into the fight topped up: the ghost hits through a dry prayer book.
    await eatIfLow(q, 0.75);
    const melee = q.sdk.getEquipment().find((i) => /scimitar|longsword|sword|mace|axe|dagger/i.test(i.name));
    q.log(`shilo: Nazastarool — hp ${hp(q)}/${maxHp(q)}, prayer ${q.sdk.getPrayerState()?.prayerPoints}/${q.level('prayer')}, wielding ${melee?.name ?? 'nothing'}, ${q.count(/^shark$/i)} sharks (${eaten} eaten so far)`);
    const flicker = q.level('prayer') >= PROTECT_MELEE_LEVEL ? new PrayerFlicker(q.sdk, q.log, { flick: false }) : null;
    const t0 = tickNow(q.sdk);
    let woke = false;
    let lastSeen = -1;
    let lastAttack = -99;
    let kills = 0;
    let lastIndex = -1;
    try {
        while (!has(q, ITEM.corpse) && tickNow(q.sdk) - t0 < 2500) {
            await eatIfLow(q);
            if (hp(q) < maxHp(q) * 0.3 && !held(q, /^(shark|swordfish|lobster|monkfish|tuna|bass)$/i)) {
                // Out of the tomb alive (its undead kill an idle account), then fail the run.
                flicker?.set(null);
                await leaveRashTomb(q).catch((e) => q.log(`shilo: retreat from the tomb failed: ${(e as Error).message}`));
                throw new Error(`shilo: out of food fighting Nazastarool (hp ${hp(q)}); retreated to ${where(q)}`);
            }
            const naz = ourNazastarool(q);
            if (naz) {
                if (naz.index !== lastIndex) {
                    if (lastIndex !== -1) kills++;
                    lastIndex = naz.index;
                    q.log(`shilo: Nazastarool (level ${naz.combatLevel}) at ${tickNow(q.sdk) - t0}t, hp ${hp(q)}`);
                }
                woke = true;
                lastSeen = tickNow(q.sdk);
                flicker?.set('protect_from_melee');
                const combat = q.sdk.getState()?.player?.combat;
                const attacking = combat?.targetType === 'npc' && combat.targetIndex === naz.index;
                // Every prayer toggle cancels the attack (p_clearpendingaction): re-attack after one.
                if (!attacking || (flicker && flicker.toggledAt > lastAttack) || tickNow(q.sdk) - lastAttack > 12) {
                    const opt = naz.optionsWithIndex.find((o) => /^attack$/i.test(o.text));
                    await q.sdk.sendInteractNpc(naz.index, opt?.opIndex ?? 2);
                    lastAttack = tickNow(q.sdk);
                }
                await q.sdk.waitForTicks(1);
                continue;
            }
            if (q.sdk.getDialog()?.isOpen) {
                await driveDialog(q.sdk, [], { ticks: 10 });
                continue;
            }
            // Nothing up: search the dolmen. Before the first form it wakes him; after the third it gives the remains.
            // Between forms the next rises at once; only a long quiet means the dolmen wants searching.
            if (!woke || tickNow(q.sdk) - lastSeen > 25) {
                const dolmen = await findLoc(q, LOC_NAME.dolmen, /^search$/i, { x: 2892, z: 9487 });
                if (!dolmen) throw new Error(`shilo: no dolmen in the tomb room (at ${where(q)})`);
                flicker?.set(null);
                q.log(`shilo: searching the dolmen at ${tickNow(q.sdk) - t0}t (woke ${woke}, hp ${hp(q)})`);
                await opLoc(q, dolmen, /^search$/i, [], () => has(q, ITEM.corpse) || !!ourNazastarool(q), 12);
                // The ground shakes for 5-8 ticks before he rises.
                if (!has(q, ITEM.corpse)) await untilTicks(q.sdk, () => !!ourNazastarool(q), 14);
                woke = true;
                lastSeen = tickNow(q.sdk);
                continue;
            }
            await q.sdk.waitForTicks(1);
        }
    } finally {
        flicker?.set(null);
    }
    if (!has(q, ITEM.corpse)) throw new Error(`shilo: no remains after ${tickNow(q.sdk) - t0}t at the dolmen (hp ${hp(q)})`);
    q.log(`shilo: Nazastarool down (${kills + 1} forms) and Rashiliyia's remains taken in ${tickNow(q.sdk) - t0}t; hp ${hp(q)}/${maxHp(q)}, prayer ${q.sdk.getPrayerState()?.prayerPoints}, ${q.count(/^shark$/i)} sharks`);
}

/** Out of the tomb, over to Cairn Isle and the remains onto Bervirius' dolmen: complete. */
export async function layToRest(q: Quest): Promise<void> {
    // Lost to a death on the way (stage 14 stays): the tomb dolmen wakes Nazastarool again, since
    // taking the remains cleared his three bits (search_tombdolmen), and his third form leaves another.
    if (!has(q, ITEM.corpse)) {
        q.log('shilo: no Rashiliya corpse at stage corpse — back to the tomb dolmen for it');
        await fightNazastarool(q);
    }
    if (!has(q, ITEM.corpse)) throw new Error('shilo: no Rashiliya corpse to lay to rest');
    if (!inBervTomb(pos(q))) {
        await leaveShilo(q);
        await enterBervTomb(q);
    }
    await walk(q, BERV.dolmen, 1);
    const dolmen = await findLoc(q, LOC_NAME.dolmen);
    if (!dolmen) throw new Error(`shilo: no tomb dolmen near ${where(q)}`);
    const mark = messageId(q);
    await useOnLoc(q, ITEM.corpse, dolmen, () => !has(q, ITEM.corpse), [], 20);
    await driveDialog(q.sdk, [], { ticks: 30 });
    await untilTicks(q.sdk, () => /quest complete/i.test(messagesSince(q, mark)), 10);
    q.log(`shilo: remains laid on Bervirius' dolmen: ${messagesSince(q, mark).slice(0, 160)}`);
}

/** Wield the best weapon held (the prologue withdrew it). */
export async function wieldWeapon(q: Quest): Promise<void> {
    const weapon = held(q, /^(dragon|rune|adamant|mithril|black|steel|iron) (scimitar|longsword)$/i);
    if (!weapon) return;
    await q.bot.equipItem(weapon).catch(() => undefined);
    await untilTicks(q.sdk, () => !held(q, new RegExp(`^${weapon.name}$`, 'i')), 4);
}
