/**
 * Karamja errands for Monkey Madness's kit: bananas from the Musa Point plantation and Karamja monkey bones from the
 * plantation's monkeys, from the Ardougne hub and back (lib/sources.ts `banana` / `monkey bones`).
 *
 * Content:
 *   - area_karamja/scripts/banana_tree.rs2: Search (op1) a bananatreefull..one (locs 2073-2077) -> 1 banana, the tree
 *     steps down a stage for 500 ticks (loc_change, world-wide). 33 trees at the plantation (maps m45_49, x 2906-2930,
 *     z 3155-3170), 5 bananas each. No shop is nearer: Wydin (Port Sarim) holds 3 at a time.
 *   - quest_tbwt/scripts/monkey.rs2 [ai_queue3,monkey]: a monkey (npc 132, level 3, 6 hp, respawn 74t) drops
 *     mm_normal_monkey_bones (obj 3183, "Monkey bones") for its hero — unless Tai Bwo Wannai Trio is in progress
 *     (tbwt_started..complete): then it drops a monkey corpse and dodges melee. Spawns beside the plantation
 *     (2873,3148), (2877,3154), (2879,3161); more along Brimhaven's back street (2755,3170)..(2820,3193).
 *     Zooknock takes these for the Karamja greegree (quest_mm mm_zooknock.rs2, mm_bones_type 5).
 *
 * Route: Barnaby's boat (30gp) to Brimhaven, Brimhaven's back street to Musa Point (lib/tai-bwo-wannai-trio.ts go),
 * and back the same way to the Brimhaven boat (lib/jungle-potion.ts leaveJungle): 60gp a trip.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, ticksToMs, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
}

const BANANA = 1963;
const MONKEY_BONES = 3183;
const MONKEY_CORPSE = 3166;
const BANANA_TREES = new Set([2073, 2074, 2075, 2076, 2077]);
/** The middle of the plantation's trees. */
const PLANTATION: Tile = { x: 2916, z: 3162 };
/** The three monkeys west of the plantation. */
const MONKEYS: Tile = { x: 2876, z: 3154 };
/** Lubufu's beach: the west end of Brimhaven's back street, a straight walk south of the customs. */
const BRIMHAVEN_END: Tile = { x: 2772, z: 3174 };
/** The Ardougne hub bank (safe-stops SAFE_BANKS.ardougne): any mainland tile sends leaveJungle home. */
const ARDOUGNE: Tile = { x: 2655, z: 3283 };
export const KARAMJA_FARES = 60;

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const held = (q: Quest, id: number) => q.sdk.getInventory().filter((i) => i.id === id).reduce((n, i) => n + (i.count ?? 1), 0);
const free = (q: Quest) => 28 - q.sdk.getInventory().length;
const heard = (q: Quest, t0: number, re: RegExp) => (q.sdk.getState()?.gameMessages ?? []).some((m) => m.tick >= t0 && re.test(m.text));

async function closeDialogs(q: Quest): Promise<void> {
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
}

/** To `t` on Karamja (Barnaby's boat from the mainland, the back street to Musa Point). */
async function toKaramja(q: Quest, t: Tile): Promise<void> {
    if (q.count('coins') < KARAMJA_FARES) await q.ensure('coins', KARAMJA_FARES);
    const { go } = await import('./tai-bwo-wannai-trio');
    await go(q, t, 3);
}

/** Back west along the street and home by the Brimhaven boat. */
async function home(q: Quest): Promise<void> {
    const { go } = await import('./tai-bwo-wannai-trio');
    const { leaveJungle, onIsland } = await import('./jungle-potion');
    if (!onIsland(pos(q))) return;
    if (pos(q).x >= 2840) await go(q, BRIMHAVEN_END, 3);
    await leaveJungle(q, ARDOUGNE);
    if (onIsland(pos(q))) q.log(`karamja: still on the island at ${where(q)} — run-quest's goTo takes the Musa Point boat`);
}

/** Search plantation trees until holding `count` bananas. */
async function pickBananas(q: Quest, count: number): Promise<void> {
    await toKaramja(q, PLANTATION);
    const t0 = tickNow(q.sdk);
    let picks = 0;
    while (held(q, BANANA) < count && tickNow(q.sdk) - t0 < 1500) {
        if (free(q) === 0) throw new Error(`karamja: inventory full with ${held(q, BANANA)}/${count} bananas`);
        await closeDialogs(q);
        await q.sdk.scanNearbyLocs(16).catch(() => undefined);
        const tree = (q.sdk.getNearbyLocs() ?? [])
            .filter((l) => BANANA_TREES.has(l.id) && l.reachable !== false)
            .sort((a, b) => a.distance - b.distance)[0];
        if (!tree) {
            // Every tree near us picked bare (500t each): walk the plantation's other end, or wait one out.
            await q.bot.walkTo(PLANTATION.x + (picks % 2 ? 10 : -8), PLANTATION.z, 3).catch(() => undefined);
            await q.sdk.waitForTicks(10);
            continue;
        }
        const before = held(q, BANANA);
        await q.sdk.sendInteractLoc(tree.x, tree.z, tree.id, 1);
        if (await untilTicks(q.sdk, () => held(q, BANANA) > before, 20)) picks++;
    }
    if (held(q, BANANA) < count) throw new Error(`karamja: ${held(q, BANANA)}/${count} bananas after ${tickNow(q.sdk) - t0}t at ${where(q)}`);
    q.log(`karamja: ${held(q, BANANA)} bananas in ${tickNow(q.sdk) - t0}t`);
}

/** Kill the plantation's monkeys until holding `count` Karamja monkey bones (only those are picked up). */
async function killMonkeys(q: Quest, count: number): Promise<void> {
    await toKaramja(q, MONKEYS);
    const t0 = tickNow(q.sdk);
    let kills = 0;
    while (held(q, MONKEY_BONES) < count && tickNow(q.sdk) - t0 < 2000) {
        if (free(q) === 0) throw new Error(`karamja: inventory full with ${held(q, MONKEY_BONES)}/${count} monkey bones`);
        await closeDialogs(q);
        await q.sdk.scanGroundItems(12).catch(() => undefined);
        const items = q.sdk.getState()?.groundItems ?? [];
        if (items.some((g) => g.id === MONKEY_CORPSE && g.distance <= 12) || heard(q, t0, /deftly avoids your melee attack/i)) {
            throw new Error('karamja: monkeys drop corpses, not bones, while Tai Bwo Wannai Trio is in progress — finish it (or stock monkey bones from the mule)');
        }
        const bones = items.filter((g) => g.id === MONKEY_BONES && g.distance <= 12).sort((a, b) => a.distance - b.distance)[0];
        if (bones) {
            const before = held(q, MONKEY_BONES);
            await q.bot.pickupItem(bones).catch(() => undefined);
            await untilTicks(q.sdk, () => held(q, MONKEY_BONES) > before, 10);
            continue;
        }
        const m = (q.sdk.getNearbyNpcs() ?? [])
            .filter((n) => /^monkey$/i.test(n.name) && !n.inCombat && (n.hp ?? 1) > 0 && n.distance <= 16)
            .sort((a, b) => a.distance - b.distance)[0];
        if (!m) {
            // All three dead (74t respawn) or wandered off: back to the spawns and wait.
            if (Math.hypot(pos(q).x - MONKEYS.x, pos(q).z - MONKEYS.z) > 6) await q.bot.walkTo(MONKEYS.x, MONKEYS.z, 3).catch(() => undefined);
            await q.sdk.waitForTicks(5);
            continue;
        }
        await q.bot.attack(m, ticksToMs(20)).catch(() => undefined);
        const died = await untilTicks(q.sdk, (s) => !(s.nearbyNpcs ?? []).some((n) => n.index === m.index && (n.hp ?? 1) > 0), 30);
        if (died) {
            kills++;
            // The drop lands a tick or two after the death animation.
            await untilTicks(q.sdk, (s) => (s.groundItems ?? []).some((g) => (g.id === MONKEY_BONES || g.id === MONKEY_CORPSE) && g.distance <= 12), 6);
        }
    }
    if (held(q, MONKEY_BONES) < count) throw new Error(`karamja: ${held(q, MONKEY_BONES)}/${count} monkey bones after ${kills} kills, ${tickNow(q.sdk) - t0}t at ${where(q)}`);
    q.log(`karamja: ${held(q, MONKEY_BONES)} monkey bones from ${kills} kills in ${tickNow(q.sdk) - t0}t`);
}

/** Bananas from the plantation, then home to Ardougne. */
export async function karamjaBananas(q: Quest, count: number): Promise<void> {
    const t0 = tickNow(q.sdk);
    await pickBananas(q, count);
    await home(q);
    q.log(`karamja: banana errand ${tickNow(q.sdk) - t0}t door to door`);
}

/** Karamja monkey bones from the plantation's monkeys, then home to Ardougne. */
export async function karamjaMonkeyBones(q: Quest, count: number): Promise<void> {
    const t0 = tickNow(q.sdk);
    await killMonkeys(q, count);
    await home(q);
    q.log(`karamja: monkey bones errand ${tickNow(q.sdk) - t0}t door to door`);
}
