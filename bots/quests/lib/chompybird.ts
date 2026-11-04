/**
 * Big Chompy Bird Hunting — the route and mechanics (bots/quests/chompybird.ts is the definition).
 *
 * Content facts (quest_chompybird/scripts/*.rs2, skill_fletching/scripts/ogre_arrows.rs2, skill_firemaking/scripts/
 * achey.rs2); route cross-checked with rs-stun-toolkit's q-big-chompy-bird-hunting.ts spec:
 *   - Rantz (1010, 2630,2981) east of Gu'Tanoth. His cave (entrance 3379 at 2629,2998 -> 2647,9379; exit 3381 at
 *     2647,9377) holds Bugs (1012, 2640,9391), Fycie (1011, 2650,9393) and the Locked Ogre chest (3377, 2637,9398).
 *   - Ogre arrows: knife on achey logs (2-6 shafts), chisel on wolf bones (2-6 tips; Fletching 5, Crafting 5), 4 feathers
 *     per shaft (up to 6 at once), tips on the flighted arrows (up to 6). Making ONE yourself sets the "made" bit Rantz
 *     checks before taking 6. Bugs sells a knife and chisel for 10gp at stage 5 when you lack both.
 *   - Achey trees ring Rantz's clearing; the wolves (95, cl64, 69 hp, always drop wolf bones) and swamp toads (1013) are at
 *     the swamp pool west of it (bubbles 684, the reachable one at 2598,2963 from 2598,2962).
 *   - The chest (op1 Unlock): a strength roll lifts the rock (stage 15 -> 20), op1 Search on the open chest (3378) gives the
 *     bellows unless one is held or banked. Bellows on the bubbles -> 3 charges; bellows on a swamp toad -> a bloated toad
 *     (3 held at most).
 *   - TALKING to Rantz with a toad -> 25 (using it on him does not). The toad's op1 (Drop) inside his clearing
 *     (2631-2639, 2962-2971) places it -> 30; each placed toad rolls 1/5 every 25 ticks, 4 times, for a chompy (-> 35),
 *     which Rantz shoots at and misses 15-30 ticks later (-> 40). Rantz then lends the ogre bow (-> 45).
 *   - The ogre bow (Ranged 30 base) and ogre arrows kill only a chompy our own toad called (op5 Attack, ranged only; walk
 *     within 2 tiles and it flees). Its death -> 50; the corpse (1016) op4 Pluck drops the raw chompy.
 *   - Showing Rantz the raw chompy -> 55 and names his seasoning; Bugs and Fycie name theirs when asked at 55. The engine's
 *     random(1) is always 0 (NumberOps RANDOM: nextDouble()*n truncated), so it is onion / equa leaves / tomato; the dialog
 *     is still read and any other pick is gathered. Raw chompy on the spit-roast (3375, 2630,2990) with all three held
 *     -> 60 (a burn eats the seasonings and the chompy); talking to Rantz with the seasoned chompy completes it.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const NPC = { rantz: 1010, fycie: 1011, bugs: 1012, toad: 1013, baitToad: 1014, chompy: 1015, dead: 1016, wolf: 95 } as const;
const LOC = { entrance: 3379, exit: 3381, chest: 3377, chestOpen: 3378, spit: 3375, bubbles: 684, achey: 2023 } as const;

export const RANTZ = { x: 2630, z: 2983 };
const CAVE_STAND = { x: 2630, z: 2997 };
const ENTRANCE = { x: 2629, z: 2998 };
const CAVE_IN = { x: 2647, z: 9379 };
const EXIT = { x: 2647, z: 9377 };
const CHEST = { x: 2637, z: 9398 };
const CHEST_STAND = { x: 2637, z: 9397 };
const BUGS = { x: 2640, z: 9391 };
const FYCIE = { x: 2650, z: 9393 };
const SPIT = { x: 2630, z: 2990 };
const BUBBLE = { x: 2598, z: 2963 };
const BUBBLE_STAND = { x: 2598, z: 2962 };
const SWAMP = { x: 2600, z: 2966 };
const WOLVES = { x: 2607, z: 2962 };
const ACHEY = { x: 2620, z: 2970 };
const DROP = { x: 2635, z: 2966 };
/** Seasoning ground spawns in the Feldip Hills (maps m40_46, m41_46). */
const SPAWNS: Record<string, Tile[]> = {
    'equa leaves': [
        { x: 2639, z: 2952 },
        { x: 2649, z: 2956 },
        { x: 2648, z: 2963 },
    ],
    tomato: [{ x: 2584, z: 2966 }],
    'doogle leaves': [
        { x: 2560, z: 2971 },
        { x: 2563, z: 2971 },
        { x: 2562, z: 2973 },
        { x: 2565, z: 2972 },
    ],
};

/** Ogre arrows wanted from the fletching: 6 for Rantz plus shots for the hunt (spent arrows are picked up again). */
export const ARROWS = 12;
export const FEATHERS = 4 * ARROWS;
const LOGS = 4;
const BONES = 4;

const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const near = (q: Quest, t: Tile, d: number) => Math.max(Math.abs(pos(q).x - t.x), Math.abs(pos(q).z - t.z)) <= d;

/** Rantz's cave (m41_146). */
export const inChompyCave = (p: Tile) => inBox(p, 2620, 2670, 9360, 9420);
export const inChompyArea = (p: Tile) => inChompyCave(p);
const inDropZone = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2631, 2639, 2962, 2971);

const inv = (q: Quest) => q.sdk.getInventory();
const held = (q: Quest, re: RegExp) => inv(q).filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const worn = (q: Quest, re: RegExp) => q.sdk.getEquipment().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const item = (q: Quest, re: RegExp) => inv(q).find((i) => re.test(i.name));

const RE = {
    logs: /^achey tree logs$/i,
    bones: /^wolf bones$/i,
    feather: /^feather$/i,
    shaft: /^ogre arrow shaft$/i,
    flighted: /^flighted ogre arrow$/i,
    tips: /^wolfbone arrowtips$/i,
    arrow: /^ogre arrow$/i,
    knife: /^knife$/i,
    chisel: /^chisel$/i,
    bellows: /^ogre bellows( \(\d\))?$/i,
    fullBellows: /^ogre bellows \(\d\)$/i,
    toad: /^bloated toad$/i,
    bow: /^ogre bow$/i,
    raw: /^raw chompy$/i,
    seasoned: /^seasoned chompy$/i,
    ruined: /^ruined chompy$/i,
    melee: /scimitar|longsword|sword|battleaxe|mace|warhammer|dagger|whip|axe$/i,
    food: /^(shark|manta ray|monkfish|swordfish|lobster|bass|tuna|trout|salmon)$/i,
};
export const hasBellows = (q: Quest) => held(q, RE.bellows) > 0;
export const hasBow = (q: Quest) => held(q, RE.bow) + worn(q, RE.bow) > 0;
export const hasRawChompy = (q: Quest) => held(q, RE.raw) > 0;
export const arrowsHeld = (q: Quest) => held(q, RE.arrow) + worn(q, RE.arrow);

const messagesSince = (q: Quest, t0: number) => (q.sdk.getState()?.gameMessages ?? []).filter((m) => m.tick >= t0).map((m) => m.text);
const heard = (q: Quest, t0: number, re: RegExp) => messagesSince(q, t0).some((m) => re.test(m));

async function locById(q: Quest, id: number, at: Tile, within = 3) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? []).filter((l) => l.id === id).sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= within ? loc : undefined;
}
const npcsById = (q: Quest, id: number) => (q.sdk.getNearbyNpcs() ?? []).filter((n) => n.id === id).sort((a, b) => a.distance - b.distance);

async function eatIfLow(q: Quest, below = 0.55): Promise<void> {
    const p = q.sdk.getState()?.player;
    const hp = q.sdk.getSkill('hitpoints');
    if (!p || !hp || hp.level > hp.baseLevel * below) return;
    const food = item(q, RE.food);
    if (food) await q.bot.eatFood(food).catch(() => undefined);
}
async function protect(q: Quest, on: boolean): Promise<void> {
    if (q.level('prayer') < 43) return;
    const active = q.sdk.isPrayerActive('protect_from_melee');
    if (on && !active && (q.sdk.getSkill('prayer')?.level ?? 0) > 0) await q.bot.activatePrayer('protect_from_melee').catch(() => undefined);
    if (!on && active) await q.bot.deactivatePrayer('protect_from_melee').catch(() => undefined);
}

async function useOn(q: Quest, a: RegExp, b: RegExp, done: () => boolean, label: string): Promise<void> {
    for (let attempt = 0; attempt < 4 && !done(); attempt++) {
        const x = item(q, a);
        const y = item(q, b);
        if (!x || !y) throw new Error(`chompy: ${label}: missing ${!x ? a : b} (at ${where(q)})`);
        await q.sdk.sendUseItemOnItem(x.slot, y.slot);
        await untilTicks(q.sdk, done, 6);
    }
    if (!done()) throw new Error(`chompy: ${label} did nothing (at ${where(q)})`);
}

// ── the cave

export async function enterCave(q: Quest): Promise<void> {
    if (inChompyCave(pos(q))) return;
    if (!near(q, CAVE_STAND, 2)) await q.goTo(CAVE_STAND, 1);
    for (let attempt = 0; attempt < 4 && !inChompyCave(pos(q)); attempt++) {
        const loc = await locById(q, LOC.entrance, ENTRANCE, 2);
        await q.sdk.sendInteractLoc(loc?.x ?? ENTRANCE.x, loc?.z ?? ENTRANCE.z, LOC.entrance, 1);
        await untilTicks(q.sdk, () => inChompyCave(pos(q)), 12);
    }
    if (!inChompyCave(pos(q))) throw new Error(`chompy: the cave entrance did not take us in (at ${where(q)})`);
    await q.sdk.waitForTicks(1);
}

export async function leaveChompyCave(q: Quest): Promise<void> {
    if (!inChompyCave(pos(q))) return;
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    for (let attempt = 0; attempt < 5 && inChompyCave(pos(q)); attempt++) {
        if (!near(q, EXIT, 3)) await q.bot.walkTo(CAVE_IN.x, CAVE_IN.z, 1).catch(() => undefined);
        const loc = await locById(q, LOC.exit, EXIT, 2);
        await q.sdk.sendInteractLoc(loc?.x ?? EXIT.x, loc?.z ?? EXIT.z, LOC.exit, 1);
        await untilTicks(q.sdk, () => !inChompyCave(pos(q)), 15);
    }
    if (inChompyCave(pos(q))) throw new Error(`chompy: could not leave Rantz's cave (at ${where(q)})`);
    q.log(`chompy: out of the cave at ${where(q)}`);
}

// ── talking

const pageText = (q: Quest) => (q.sdk.getDialog()?.allComponents ?? []).map((c) => c.text).filter(Boolean).join(' ');

/** Open a talk with `id` near `at` and drive it; `done` stops early on a page. Returns the text seen. */
async function talkNpc(q: Quest, id: number, at: Tile, choices: RegExp[], done?: () => boolean): Promise<string> {
    if (!near(q, at, 10)) await q.goTo(at, 4);
    for (let attempt = 1; attempt <= 3; attempt++) {
        await untilTicks(q.sdk, () => npcsById(q, id).length > 0, 10);
        const npc = npcsById(q, id)[0];
        if (!npc) throw new Error(`chompy: npc ${id} not in view near (${at.x},${at.z}) (at ${where(q)})`);
        const r = await q.bot.talkTo(npc);
        if (!r.success && !(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 5))) {
            q.log(`chompy: talk ${npc.name}: ${r.message}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        return driveDialog(q.sdk, choices, { done, log: q.log });
    }
    throw new Error(`chompy: no dialog with npc ${id} (at ${where(q)})`);
}

export async function start(q: Quest): Promise<void> {
    await talkNpc(q, NPC.rantz, RANTZ, [/^ok,? i'll make you some/i]);
}

/** Rantz's toadies questions: "How do we make the chompys come?" (-> 15) once, then "Ok, thanks." */
async function toadiesTalk(q: Quest, opening: RegExp[] = []): Promise<string> {
    let asked = false;
    const first = await talkNpc(q, NPC.rantz, RANTZ, [...opening, /make the chompys come/i], () => {
        if (/fussie eaters/i.test(pageText(q))) asked = true;
        return asked && (q.sdk.getDialog()?.options ?? []).some((o) => /^ok,? thanks/i.test(o.text));
    });
    const rest = q.sdk.getDialog()?.isOpen ? await driveDialog(q.sdk, [/^ok,? thanks/i], { log: q.log }) : '';
    return `${first} ${rest}`;
}

// ── fletching

/** Kill wolves at the swamp until `n` wolf bones are held. */
async function wolfBones(q: Quest, n: number): Promise<void> {
    if (held(q, RE.bones) >= n) return;
    const weapon = item(q, RE.melee);
    if (weapon && !q.sdk.getEquipment().some((e) => RE.melee.test(e.name))) await q.bot.equipItem(weapon).catch(() => undefined);
    await q.goTo(WOLVES, 4);
    const t0 = tickNow(q.sdk);
    while (held(q, RE.bones) < n && tickNow(q.sdk) - t0 < 600) {
        await eatIfLow(q);
        const bones = (q.sdk.getState()?.groundItems ?? []).filter((g) => RE.bones.test(g.name) && g.distance <= 12).sort((a, b) => a.distance - b.distance)[0];
        if (bones) {
            const before = held(q, RE.bones);
            await q.bot.pickupItem(bones).catch(() => undefined);
            await untilTicks(q.sdk, () => held(q, RE.bones) > before, 8);
            continue;
        }
        const wolf = npcsById(q, NPC.wolf).filter((w) => w.reachable !== false && (!w.inCombat || w.targetIndex >= 0))[0];
        if (!wolf) {
            if (!near(q, WOLVES, 6)) await q.goTo(WOLVES, 3);
            await q.sdk.waitForTicks(4);
            continue;
        }
        const r = await q.bot.attack(wolf).catch((e) => ({ success: false, message: String(e) }));
        if (!r.success) {
            await q.sdk.waitForTicks(2);
            continue;
        }
        await untilTicks(
            q.sdk,
            (s) => (s.groundItems ?? []).some((g) => RE.bones.test(g.name) && g.distance <= 12) || !(s.nearbyNpcs ?? []).some((x) => x.index === wolf.index && (x.hp ?? 1) > 0),
            60
        );
        await eatIfLow(q);
    }
    if (held(q, RE.bones) < n) throw new Error(`chompy: only ${held(q, RE.bones)}/${n} wolf bones in ${tickNow(q.sdk) - t0}t`);
    q.log(`chompy: ${held(q, RE.bones)} wolf bones in ${tickNow(q.sdk) - t0}t`);
}

/** Chop achey trees until `n` achey logs are held. */
async function acheyLogs(q: Quest, n: number): Promise<void> {
    if (held(q, RE.logs) >= n) return;
    if (!near(q, ACHEY, 10)) await q.goTo(ACHEY, 4);
    const t0 = tickNow(q.sdk);
    // A tree that yields nothing is rested: the nearest one reads reachable from beside it and every chop on it failed
    // for 510 ticks in staging (qlqecb2, 2026-11-04) while one 13 tiles off chopped at once.
    const failed = new Map<string, number>();
    while (held(q, RE.logs) < n && tickNow(q.sdk) - t0 < 400) {
        await q.sdk.scanNearbyLocs(15).catch(() => undefined);
        const tree = (q.sdk.getNearbyLocs() ?? [])
            .filter((l) => l.id === LOC.achey && l.reachable !== false && (failed.get(`${l.x},${l.z}`) ?? -999) < tickNow(q.sdk) - 100)
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!tree) {
            failed.clear();
            await q.sdk.waitForTicks(5);
            continue;
        }
        const before = held(q, RE.logs);
        const r = await q.bot.chopTree(tree).catch((e) => ({ success: false, message: String(e) }));
        if (held(q, RE.logs) <= before) await untilTicks(q.sdk, () => held(q, RE.logs) > before, 10);
        if (held(q, RE.logs) <= before) {
            failed.set(`${tree.x},${tree.z}`, tickNow(q.sdk));
            q.log(`chompy: achey tree (${tree.x},${tree.z}) gave nothing (${r.message}); trying another`);
        }
    }
    if (held(q, RE.logs) < n) throw new Error(`chompy: only ${held(q, RE.logs)}/${n} achey logs in ${tickNow(q.sdk) - t0}t`);
    q.log(`chompy: ${held(q, RE.logs)} achey logs in ${tickNow(q.sdk) - t0}t`);
}

/** Bugs' knife and chisel (10gp at stage 5, only while lacking both). */
async function tools(q: Quest): Promise<void> {
    if (held(q, RE.knife) && held(q, RE.chisel)) return;
    await enterCave(q);
    await talkNpc(q, NPC.bugs, BUGS, [/^ok,? i'll give you 10/i]);
    if (!held(q, RE.knife) || !held(q, RE.chisel)) {
        // Bought before (the bit is set) and since lost: the shared sources.
        await leaveChompyCave(q);
        if (!held(q, RE.knife)) await q.ensure('knife', 1);
        if (!held(q, RE.chisel)) await q.ensure('chisel', 1);
    }
}

/** Fletch ogre arrows from logs, bones and feathers until `ARROWS` are held (at least one made here, for Rantz's bit). */
export async function fletchArrows(q: Quest): Promise<void> {
    const a0 = arrowsHeld(q);
    const feathers = held(q, RE.feather);
    const target = Math.max(7, Math.min(ARROWS, a0 + Math.floor(feathers / 4)));
    q.log(`chompy: fletching toward ${target} ogre arrows (${a0} held, ${feathers} feathers)`);
    await tools(q);
    if (inChompyCave(pos(q))) await leaveChompyCave(q);
    for (let round = 0; round < 3 && arrowsHeld(q) < target; round++) {
        const want = target - arrowsHeld(q);
        const needParts = (have: number) => Math.max(0, want - have);
        if (held(q, RE.shaft) + held(q, RE.flighted) < want && held(q, RE.logs) === 0) await acheyLogs(q, Math.min(LOGS, Math.ceil(needParts(held(q, RE.shaft) + held(q, RE.flighted)) / 2)));
        if (held(q, RE.tips) < want && held(q, RE.bones) === 0) await wolfBones(q, Math.min(BONES, Math.ceil(needParts(held(q, RE.tips)) / 2)));
        await protect(q, false);
        while (held(q, RE.logs) > 0 && held(q, RE.shaft) + held(q, RE.flighted) < want) {
            const n = held(q, RE.logs);
            await useOn(q, RE.knife, RE.logs, () => held(q, RE.logs) < n, 'knife on achey logs');
        }
        while (held(q, RE.bones) > 0 && held(q, RE.tips) < want) {
            const n = held(q, RE.bones);
            await useOn(q, RE.chisel, RE.bones, () => held(q, RE.bones) < n, 'chisel on wolf bones');
        }
        for (let k = 0; k < 12 && arrowsHeld(q) < target; k++) {
            if (held(q, RE.flighted) > 0 && held(q, RE.tips) > 0) {
                const n = arrowsHeld(q);
                await useOn(q, RE.tips, RE.flighted, () => arrowsHeld(q) > n, 'arrowtips on flighted arrows');
            } else if (held(q, RE.shaft) > 0 && held(q, RE.feather) >= 4) {
                const n = held(q, RE.flighted);
                await useOn(q, RE.feather, RE.shaft, () => held(q, RE.flighted) > n, 'feathers on shafts');
            } else break;
        }
        q.log(`chompy: round ${round + 1}: ${arrowsHeld(q)} ogre arrows (shafts ${held(q, RE.shaft)}, flighted ${held(q, RE.flighted)}, tips ${held(q, RE.tips)}, feathers ${held(q, RE.feather)})`);
        if (held(q, RE.feather) < 4 && held(q, RE.flighted) === 0) break;
    }
    if (arrowsHeld(q) <= a0) throw new Error(`chompy: no ogre arrow fletched (at ${where(q)})`);
    if (arrowsHeld(q) < 7) throw new Error(`chompy: only ${arrowsHeld(q)} ogre arrows (6 for Rantz and at least one to shoot)`);
    // Leftovers only cost pack slots.
    for (const re of [RE.logs, RE.bones, RE.shaft, RE.tips]) if (held(q, re)) await q.bot.dropItem(re, 'all').catch(() => undefined);
}

/** Give Rantz six arrows and ask how to call the chompys (5 -> 10 -> 15 in one dialog; or 10 -> 15 on a resume). */
export async function giveArrows(q: Quest): Promise<void> {
    await toadiesTalk(q, [/^ok,? i'll make the 'stabbers'/i]);
}

// ── bellows, toads and the bait

/** The ogre chest's bellows (Strength roll on the rock; retried). */
export async function getBellows(q: Quest): Promise<void> {
    if (hasBellows(q)) return;
    await enterCave(q);
    for (let attempt = 0; attempt < 10 && !hasBellows(q); attempt++) {
        if (!near(q, CHEST_STAND, 2)) await q.bot.walkTo(CHEST_STAND.x, CHEST_STAND.z, 1).catch(() => undefined);
        const open = await locById(q, LOC.chestOpen, CHEST, 1);
        if (open) {
            await q.sdk.sendInteractLoc(open.x, open.z, open.id, 1);
            await untilTicks(q.sdk, (s) => hasBellows(q) || !!s.dialog?.isOpen, 10);
            if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done: () => hasBellows(q), ticks: 10 });
            continue;
        }
        const t0 = tickNow(q.sdk);
        await q.sdk.sendInteractLoc(CHEST.x, CHEST.z, LOC.chest, 1);
        await untilTicks(q.sdk, () => heard(q, t0, /lift the huge rock|too heavy|ask permission/i), 10);
        if (heard(q, t0, /ask permission/i)) throw new Error('chompy: the chest wants stage 15 (ask Rantz how to call the chompys)');
        await q.sdk.waitForTicks(1);
    }
    if (!hasBellows(q)) throw new Error(`chompy: no ogre bellows from the chest (at ${where(q)})`);
    q.log('chompy: ogre bellows');
    await leaveChompyCave(q);
}

/** Fill the bellows at the swamp bubbles and inflate swamp toads until `n` bloated toads are held. */
export async function getToads(q: Quest, n = 3): Promise<void> {
    if (held(q, RE.toad) >= n) return;
    if (!hasBellows(q)) await getBellows(q);
    if (!near(q, SWAMP, 8)) await q.goTo(SWAMP, 4);
    await protect(q, true);
    const t0 = tickNow(q.sdk);
    while (held(q, RE.toad) < n && tickNow(q.sdk) - t0 < 300) {
        await eatIfLow(q);
        if (!held(q, RE.fullBellows)) {
            if (!near(q, BUBBLE_STAND, 0)) await q.bot.walkTo(BUBBLE_STAND.x, BUBBLE_STAND.z, 0).catch(() => undefined);
            const bellows = item(q, RE.bellows)!;
            await q.sdk.sendUseItemOnLoc(bellows.slot, BUBBLE.x, BUBBLE.z, LOC.bubbles);
            await untilTicks(q.sdk, () => held(q, RE.fullBellows) > 0, 8);
            continue;
        }
        const toad = npcsById(q, NPC.toad).filter((t) => t.distance <= 14 && t.reachable !== false)[0];
        if (!toad) {
            await q.sdk.waitForTicks(3);
            continue;
        }
        const before = held(q, RE.toad);
        await q.bot.useItemOnNpc(item(q, RE.fullBellows)!, toad).catch(() => undefined);
        await untilTicks(q.sdk, () => held(q, RE.toad) > before, 10);
    }
    await protect(q, false);
    if (held(q, RE.toad) < n) throw new Error(`chompy: only ${held(q, RE.toad)}/${n} bloated toads in ${tickNow(q.sdk) - t0}t`);
    q.log(`chompy: ${held(q, RE.toad)} bloated toads in ${tickNow(q.sdk) - t0}t`);
}

/** Show Rantz a toad by talking (-> 25). */
export async function showToad(q: Quest): Promise<void> {
    await getToads(q, 3);
    await talkNpc(q, NPC.rantz, RANTZ, []);
}

/** Place every held toad in Rantz's clearing, each on its own tile (a placement pushes us a tile). */
async function dropToads(q: Quest): Promise<number> {
    if (!inDropZone(pos(q)) || !near(q, DROP, 2)) await q.bot.walkTo(DROP.x, DROP.z, 1).catch(() => undefined);
    let placed = 0;
    for (let k = 0; k < 10 && held(q, RE.toad) > 0; k++) {
        if (!inDropZone(pos(q))) await q.bot.walkTo(DROP.x, DROP.z, 1).catch(() => undefined);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 6 });
        const toad = item(q, RE.toad)!;
        const before = held(q, RE.toad);
        const t0 = tickNow(q.sdk);
        await q.sdk.sendUseItem(toad.slot, 1);
        await untilTicks(q.sdk, () => held(q, RE.toad) < before || heard(q, t0, /already placed|too far away|not sure where/i), 5);
        if (held(q, RE.toad) < before) placed++;
        else if (heard(q, t0, /already placed/i)) {
            const p = pos(q);
            await q.bot.walkTo(p.x + (p.x < 2638 ? 1 : -1), p.z, 0).catch(() => undefined);
        } else if (heard(q, t0, /not sure where/i)) {
            if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 6 });
            throw new Error('chompy: the toad has no place yet (stage < 25: show Rantz the toad by talking)');
        }
        await q.sdk.waitForTicks(1);
    }
    q.log(`chompy: placed ${placed} toads (${held(q, RE.toad)} left) at ${where(q)}`);
    return placed;
}

/** Bait until Rantz has shot at our chompy and missed (-> 40). */
export async function watchRantz(q: Quest, missed: () => Promise<boolean>): Promise<void> {
    for (let round = 0; round < 5; round++) {
        await getToads(q, 3);
        await dropToads(q);
        const t0 = tickNow(q.sdk);
        // A toad lives four 25-tick rolls; Rantz shoots 15-30 ticks after the chompy lands.
        while (tickNow(q.sdk) - t0 < 140) {
            if (heard(q, t0, /keeps missing the chompy/i)) break;
            if (tickNow(q.sdk) - t0 > 30 && !npcsById(q, NPC.baitToad).length && !npcsById(q, NPC.chompy).length) break;
            await q.sdk.waitForTicks(2);
        }
        if (heard(q, t0, /keeps missing the chompy/i) || (await missed())) {
            q.log(`chompy: Rantz missed (round ${round + 1}, ${tickNow(q.sdk) - t0}t)`);
            return;
        }
        q.log(`chompy: no chompy came (round ${round + 1}); baiting again`);
    }
    throw new Error('chompy: five bait rounds and Rantz never shot at a chompy');
}

/** "Come on, let me have a go..." / "I'm actually quite strong..." -> the ogre bow (45). Lost it later: buy another. */
export async function borrowBow(q: Quest): Promise<void> {
    await talkNpc(q, NPC.rantz, RANTZ, [/let me have a go/i, /quite strong/i, /yes,? i'll buy the bow/i], () => hasBow(q) && !q.sdk.getDialog()?.isOpen);
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 15 });
}

async function wieldBow(q: Quest): Promise<void> {
    for (let attempt = 0; attempt < 3 && !worn(q, RE.bow); attempt++) {
        const bow = item(q, RE.bow);
        if (!bow) throw new Error('chompy: no ogre bow to wield');
        await q.bot.equipItem(bow).catch(() => undefined);
        await untilTicks(q.sdk, () => worn(q, RE.bow) > 0, 5);
    }
    if (!worn(q, RE.bow)) throw new Error(`chompy: could not wield the ogre bow (Ranged ${q.level('ranged')}; 30 needed)`);
    await wieldArrows(q);
}
async function wieldArrows(q: Quest): Promise<void> {
    for (let attempt = 0; attempt < 3 && held(q, RE.arrow) > 0; attempt++) {
        const before = worn(q, RE.arrow);
        await q.bot.equipItem(item(q, RE.arrow)!).catch(() => undefined);
        await untilTicks(q.sdk, () => worn(q, RE.arrow) > before || held(q, RE.arrow) === 0, 5);
    }
}
/** Our spent ogre arrows on the ground near the bird. */
async function collectArrows(q: Quest): Promise<void> {
    for (let k = 0; k < 8; k++) {
        await q.sdk.scanGroundItems(10).catch(() => undefined);
        const pile = (q.sdk.getState()?.groundItems ?? []).filter((g) => RE.arrow.test(g.name) && g.distance <= 10 && g.reachable !== false).sort((a, b) => a.distance - b.distance)[0];
        if (!pile) break;
        const before = arrowsHeld(q);
        await q.bot.pickupItem(pile).catch(() => undefined);
        await untilTicks(q.sdk, () => arrowsHeld(q) > before, 6);
    }
    if (worn(q, RE.bow)) await wieldArrows(q);
}

/** Bait, shoot our own chompy with the ogre bow, pluck it and take the raw chompy. */
export async function huntChompy(q: Quest): Promise<void> {
    if (hasRawChompy(q)) return;
    for (let round = 0; round < 5 && !hasRawChompy(q); round++) {
        await getToads(q, 3);
        await wieldBow(q);
        if (!worn(q, RE.arrow)) await collectArrows(q);
        if (!worn(q, RE.arrow)) throw new Error('chompy: no ogre arrows left to shoot');
        await dropToads(q);
        const t0 = tickNow(q.sdk);
        let target = -1;
        let lastShot = -100;
        while (tickNow(q.sdk) - t0 < 200 && !hasRawChompy(q)) {
            await eatIfLow(q);
            if (q.sdk.getDialog()?.isOpen && !(q.sdk.getDialog()?.options ?? []).some((o) => !/continue/i.test(o.text))) await driveDialog(q.sdk, [], { ticks: 4 });
            const corpse = npcsById(q, NPC.dead)[0];
            const rawPile = (q.sdk.getState()?.groundItems ?? []).find((g) => RE.raw.test(g.name) && g.distance <= 12);
            if (rawPile) {
                await q.bot.pickupItem(rawPile).catch(() => undefined);
                await untilTicks(q.sdk, () => hasRawChompy(q), 8);
                continue;
            }
            if (corpse) {
                await q.sdk.sendInteractNpc(corpse.index, 4);
                await untilTicks(q.sdk, (s) => (s.groundItems ?? []).some((g) => RE.raw.test(g.name)) || hasRawChompy(q), 10);
                continue;
            }
            if (!worn(q, RE.arrow)) {
                await collectArrows(q);
                if (!worn(q, RE.arrow)) throw new Error('chompy: out of ogre arrows mid-hunt');
            }
            const birds = npcsById(q, NPC.chompy);
            const bird = birds.find((b) => b.index === target) ?? birds[0];
            if (!bird) {
                if (tickNow(q.sdk) - t0 > 30 && !npcsById(q, NPC.baitToad).length) break;
                if (!near(q, DROP, 6)) await q.bot.walkTo(DROP.x, DROP.z, 2).catch(() => undefined);
                await q.sdk.waitForTicks(1);
                continue;
            }
            if (bird.index !== target) {
                target = bird.index;
                lastShot = -100;
            }
            if (tickNow(q.sdk) - lastShot >= 5) {
                // Ogre bow range 10; within 2 tiles the bird screeches and flees.
                if (bird.distance > 9) {
                    const p = pos(q);
                    const step = { x: p.x + Math.sign(bird.x - p.x) * Math.max(0, Math.abs(bird.x - p.x) - 6), z: p.z + Math.sign(bird.z - p.z) * Math.max(0, Math.abs(bird.z - p.z) - 6) };
                    await q.sdk.sendWalk(step.x, step.z).catch(() => undefined);
                    await q.sdk.waitForTicks(2);
                }
                await q.sdk.sendInteractNpc(bird.index, 5, { route: false });
                lastShot = tickNow(q.sdk);
            }
            await q.sdk.waitForTicks(1);
        }
        await q.sdk.waitForTicks(2);
        await collectArrows(q);
        if (!hasRawChompy(q)) q.log(`chompy: no raw chompy from hunt round ${round + 1} (${tickNow(q.sdk) - t0}t)`);
    }
    if (!hasRawChompy(q)) throw new Error('chompy: five hunt rounds and no raw chompy');
    q.log(`chompy: raw chompy (${arrowsHeld(q)} ogre arrows left)`);
}

// ── the seasonings and the roast

export interface Wishes {
    rantz?: string;
    bugs?: string;
    fycie?: string;
}

/** Show Rantz the raw chompy (-> 55); his wish is in the dialog. */
export async function showChompy(q: Quest): Promise<string | undefined> {
    await huntChompy(q);
    const seen = await talkNpc(q, NPC.rantz, RANTZ, []);
    return /wants (potato|onion)/i.exec(seen)?.[1]?.toLowerCase();
}

/** Ask Bugs and Fycie in the cave what they want (their wishes are set when first asked at 55). */
export async function askFamily(q: Quest): Promise<Wishes> {
    await enterCave(q);
    const bugs = /has to have (equa leaves|cabbage)/i.exec(await talkNpc(q, NPC.bugs, BUGS, []))?.[1]?.toLowerCase();
    const fycie = /wants (tomato|doogle leaves) wiv mine/i.exec(await talkNpc(q, NPC.fycie, FYCIE, []))?.[1]?.toLowerCase();
    await leaveChompyCave(q);
    q.log(`chompy: Bugs wants ${bugs ?? '?'}, Fycie wants ${fycie ?? '?'}`);
    return { bugs, fycie };
}

async function pickSpawn(q: Quest, name: string, count: number): Promise<void> {
    const re = new RegExp(`^${name}$`, 'i');
    const spots = SPAWNS[name];
    if (!spots) return q.ensure(name, count);
    const t0 = tickNow(q.sdk);
    while (held(q, re) < count && tickNow(q.sdk) - t0 < 400) {
        for (const spot of spots) {
            if (held(q, re) >= count) break;
            if (!near(q, spot, 5)) await q.goTo(spot, 3);
            const g = (q.sdk.getState()?.groundItems ?? []).find((x) => re.test(x.name) && x.x === spot.x && x.z === spot.z);
            if (!g) continue;
            const before = held(q, re);
            await q.bot.pickupItem(g).catch(() => undefined);
            await untilTicks(q.sdk, () => held(q, re) > before, 8);
        }
        if (held(q, re) < count) await q.sdk.waitForTicks(10);
    }
    if (held(q, re) < count) throw new Error(`chompy: only ${held(q, re)}/${count} ${name} from the Feldip spawns`);
}

/** Hold one of each wish: the Feldip spawns, else the shared sources. */
export async function gatherSeasonings(q: Quest, wishes: Wishes): Promise<void> {
    const want = [wishes.rantz ?? 'onion', wishes.bugs ?? 'equa leaves', wishes.fycie ?? 'tomato'];
    for (const name of want) if (held(q, new RegExp(`^${name}$`, 'i')) < 1) await pickSpawn(q, name, 1);
}

/** Raw chompy on the spit-roast (-> 60). A burn loses the chompy: hunt another and cook again. */
export async function roast(q: Quest, wishes: Wishes, cooked: () => Promise<boolean>): Promise<void> {
    for (let attempt = 1; attempt <= 3 && !held(q, RE.seasoned); attempt++) {
        if (held(q, RE.ruined)) await q.bot.dropItem(RE.ruined, 'all').catch(() => undefined);
        await gatherSeasonings(q, wishes);
        if (!hasRawChompy(q)) await huntChompy(q);
        if (worn(q, RE.bow)) await q.bot.unequipItem(q.sdk.getEquipment().find((e) => RE.bow.test(e.name))!).catch(() => undefined);
        if (!near(q, SPIT, 3)) await q.goTo(SPIT, 2);
        const t0 = tickNow(q.sdk);
        const spit = await locById(q, LOC.spit, SPIT, 1);
        await q.bot.useItemOnLoc(item(q, RE.raw)!, spit ?? /ogre spit-roast/i).catch(() => undefined);
        await untilTicks(q.sdk, (s) => held(q, RE.seasoned) > 0 || held(q, RE.ruined) > 0 || heard(q, t0, /burn the chompy/i) || !!s.dialog?.isOpen, 15);
        if (q.sdk.getDialog()?.isOpen) {
            const text = await driveDialog(q.sdk, [], { ticks: 15 });
            if (/don't have all the ingredients|need to find what/i.test(text)) q.log(`chompy: spit refused: ${text.slice(0, 200)}`);
        }
        await untilTicks(q.sdk, () => held(q, RE.seasoned) > 0, 4);
        if (held(q, RE.seasoned)) break;
        if (await cooked()) break;
        q.log(`chompy: roast attempt ${attempt} burnt or refused (${messagesSince(q, t0).slice(-3).join(' / ')})`);
    }
    if (!held(q, RE.seasoned) && !(await cooked())) throw new Error('chompy: no seasoned chompy after 3 roasts');
}

export async function handIn(q: Quest): Promise<void> {
    await talkNpc(q, NPC.rantz, RANTZ, []);
}
