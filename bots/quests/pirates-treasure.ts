/**
 * Pirate's Treasure — Redbeard Frank's Karamjan rum, smuggled in a banana crate.
 *
 *   bun bots/quests/pirates-treasure.ts {botname}
 *
 * Journal rules from quest_hunt/scripts/hunt_journal.rs2; dialog and mechanics
 * from redbeard_frank.rs2, luthas.rs2, banana_crate.rs2, food_store.rs2, dig.rs2,
 * area_port_sarim/scripts/{sailors,wydin}.rs2 and area_karamja/scripts/customs_officer.rs2.
 * Tiles are content placements (maps m45_49, m46_49, m47_50, m50_53, m46_52).
 * Items:
 *   - coins (two fares, the rum), white apron, spade   lib/sources.ts
 *   - Karamjan rum (Zambo, Karamja only), bananas (plantation trees), chest key,
 *     pirate message: taken in this script
 *
 * The customs officer confiscates rum from anyone boarding off Karamja, so the
 * rum rides in Luthas's banana crate to Wydin's back room (crate_rum 1 -> 2).
 * The Falador park gardener stands 3 tiles from the X; dig.rs2 aborts the dig
 * when he is within 10, so he is knocked out first (respawnrate 50).
 */
import type { Quest } from './lib/run-quest';
import { runQuest } from './lib/run-quest';
import { buyWaitingForRestock } from './lib/sources';
import { tickNow, ticksToMs, untilTicks } from './lib/ticks';

const FRANK = { x: 3053, z: 3250 };
const FRANK_NPC = /^redbeard frank$/i;
/** Port Sarim seamen to Karamja (sailors.rs2), on the jetty. */
const SEAMEN = { x: 3028, z: 3216 };
/** Karamja customs officers (2953,3147)/(2955,3146), sailing back to Port Sarim. */
const CUSTOMS = { x: 2954, z: 3147 };
/** Zambo's bar, Musa Point; he wanders the bar floor around (2925,3143). */
const ZAMBO = { x: 2925, z: 3143, npc: /^zambo$/i };
const LUTHAS = { x: 2939, z: 3154 };
/** Luthas's export crate (bananacrate). */
const BANANA_CRATE = { x: 2943, z: 3151 };
/** Banana trees of the plantation (bananatreefull placements, x 2906-2927, z 3155-3170). */
const PLANTATION = { x: 2916, z: 3162 };
const WYDIN = { x: 3014, z: 3204 };
/** Wydin's back room crate (grocerycrate), behind the employees-only door (3012,3204). */
const BACK_ROOM = { x: 3010, z: 3207 };
const GROCERY_CRATE = 2071;
/** Blue Moon Inn, Varrock: stairs, then Hector's chest (3218,3396) on plane 1. */
const BLUE_MOON_STAIRS = { x: 3222, z: 3396 };
const CHEST = { x: 3218, z: 3396, level: 1 };
/** spade.rs2: distance(coord, 0_46_52_55_55) <= 1. */
const DIG = { x: 2999, z: 3383 };

const RUM = 'karamjan rum';
/** bananatreefull, four, three, two, one (loc ids 2073-2077); 2078 is the empty stage. */
const BANANA_TREES = new Set([2073, 2074, 2075, 2076, 2077]);
const BANANAS = 10;

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const onKaramja = (q: Quest) => {
    const p = pos(q);
    return p.x >= 2880 && p.x <= 2990 && p.z >= 3120 && p.z <= 3200;
};
function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function linesSince(q: Quest, since: number): string[] {
    return (q.sdk.getState()?.gameMessages ?? []).filter((m) => (m.observationId ?? m.tick) > since).map((m) => m.text);
}

/** Pay a fare (set_sail lands on the ship's deck, plane 1) and walk down the gangplank. */
async function sail(q: Quest, toKaramja: boolean): Promise<void> {
    if (onKaramja(q) === toKaramja && pos(q).level === 0) return;
    if (onKaramja(q) !== toKaramja) {
        const t0 = tickNow(q.sdk);
        for (let i = 0; i < 3 && onKaramja(q) !== toKaramja; i++) {
            if (toKaramja) await q.talk(/^(captain tobias|seaman \w+)$/i, [/yes please/i], SEAMEN);
            else await q.talk(/^customs officer$/i, [/can i journey on this ship/i, /search away/i, /^ok\.?$/i], CUSTOMS);
            await untilTicks(q.sdk, () => onKaramja(q) === toKaramja, 30);
        }
        if (onKaramja(q) !== toKaramja) throw new Error(`the boat to ${toKaramja ? 'Karamja' : 'Port Sarim'} never sailed (at ${pos(q).x},${pos(q).z})`);
        q.log(`sailed to ${toKaramja ? 'Karamja' : 'Port Sarim'} in ${tickNow(q.sdk) - t0}t`);
    }
    for (let i = 0; i < 4 && pos(q).level !== 0; i++) {
        await q.sdk.scanNearbyLocs(8).catch(() => undefined);
        const plank = q.sdk.findNearbyLoc(/gangplank/i, { withOption: /cross/i });
        if (!plank) {
            await q.sdk.waitForTicks(2);
            continue;
        }
        await q.bot.interactLoc(plank, /cross/i);
        await untilTicks(q.sdk, (s) => (s.player?.level ?? 1) === 0, 10);
    }
    if (pos(q).level !== 0) throw new Error(`stuck on the ship deck at (${pos(q).x},${pos(q).z})`);
}

/** Use `item` on the loc matching `loc` near the player; wait for `effect`. */
async function useOn(q: Quest, item: RegExp, loc: RegExp, effect: () => boolean, ticks = 10): Promise<boolean> {
    await q.sdk.scanNearbyLocs(8).catch(() => undefined);
    await q.bot.useItemOnLoc(item, loc, { timeout: ticksToMs(20) });
    const ok = await untilTicks(q.sdk, effect, ticks);
    await q.bot.dismissBlockingUI();
    return ok;
}

/** Karamja: rum from Zambo, a job from Luthas, rum + 10 bananas in his crate, then ship it. */
async function smuggle(q: Quest): Promise<void> {
    await sail(q, true);
    if (q.count(RUM) < 1) await buyWaitingForRestock(q, ZAMBO, RUM, 1);
    if (q.count(RUM) < 1) throw new Error('no Karamjan rum from Zambo');
    await q.talk(/^luthas$/i, [/offer me employment/i], LUTHAS);

    await q.goTo(BANANA_CRATE, 2);
    let since = cursor(q);
    await useOn(q, /^karamjan rum$/i, /^crate$/i, () => q.count(RUM) === 0, 10);
    const stash = linesSince(q, since);
    if (q.count(RUM) > 0) throw new Error(`rum not stashed in the crate (${stash.join(' / ') || 'no messages'})`);

    // Pick the bananas (each pick changes the tree's stage; empty trees regrow in 500t).
    const t0 = tickNow(q.sdk);
    while (q.count('banana') < BANANAS && tickNow(q.sdk) - t0 < 1200) {
        const locs = await q.sdk.scanNearbyLocs(15).catch(() => q.sdk.getNearbyLocs() ?? []);
        // Op1 is "Search" on every stage (plantation.loc); only full..one still hold a banana.
        const tree = locs
            .filter((l) => BANANA_TREES.has(l.id) && l.reachable !== false)
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!tree) {
            q.log(`no banana tree to search near (${pos(q).x},${pos(q).z})`);
            await q.goTo(PLANTATION, 3);
            await q.sdk.waitForTicks(10);
            continue;
        }
        const before = q.count('banana');
        await q.bot.interactLoc(tree, /^search$/i);
        await untilTicks(q.sdk, () => q.count('banana') > before, 10);
    }
    q.log(`picked ${q.count('banana')} bananas in ${tickNow(q.sdk) - t0}t`);

    await q.goTo(BANANA_CRATE, 2);
    for (let misses = 0; misses < 3 && q.count('banana') > 0; ) {
        const before = q.count('banana');
        since = cursor(q);
        await useOn(q, /^banana$/i, /^crate$/i, () => q.count('banana') < before, 8);
        if (linesSince(q, since).some((t) => /already full/i.test(t))) break;
        misses = q.count('banana') < before ? 0 : misses + 1;
    }
    q.log(`packed the crate; ${q.count('banana')} bananas left over`);
    // "I've filled a crate with bananas." -> 30 coins, crate shipped.
    await q.talk(/^luthas$/i, [/i'll be on my way/i], LUTHAS);
}

/** Wydin's back room: apron on, through the door, search the crate (decline the banana). */
async function fetchRum(q: Quest): Promise<void> {
    if (!q.sdk.getEquipment().some((i) => /^white apron$/i.test(i.name))) {
        await q.bot.equipItem(/^white apron$/i);
        await untilTicks(q.sdk, () => q.sdk.getEquipment().some((i) => /^white apron$/i.test(i.name)), 5);
    }
    await q.goTo(BACK_ROOM, 1);
    for (let i = 0; i < 3 && q.count(RUM) < 1; i++) {
        // The shop is full of "Crate"s; only grocerycrate (2071) holds the rum.
        const locs = await q.sdk.scanNearbyLocs(8).catch(() => q.sdk.getNearbyLocs() ?? []);
        const crate = locs.find((l) => l.id === GROCERY_CRATE);
        if (!crate) throw new Error(`no back-room crate in view at (${pos(q).x},${pos(q).z})`);
        if (crate.reachable === false) q.log(`back-room crate at (${crate.x},${crate.z}) not reachable from (${pos(q).x},${pos(q).z})`);
        await q.bot.interactLoc(crate, /search/i);
        await untilTicks(q.sdk, () => q.count(RUM) > 0 || !!q.sdk.getDialog()?.isOpen, 12);
        await untilTicks(q.sdk, () => !!q.sdk.getDialog()?.isOpen, 4);
        if (q.sdk.getDialog()?.isOpen) await q.sdk.clickDialogByText(/^no$/i).catch(() => undefined);
        await q.bot.dismissBlockingUI();
    }
    if (q.count(RUM) < 1) throw new Error('no rum in Wydin\'s back-room crate');
    await q.bot.unequipItem(/^white apron$/i).catch(() => undefined);
}

/** Hector's chest upstairs at the Blue Moon: key on chest, then read the message. */
async function openChest(q: Quest): Promise<void> {
    if (q.count('pirate message') < 1) {
        if (pos(q).level === 0) await q.goTo(BLUE_MOON_STAIRS, 2);
        await q.goTo(CHEST, 1);
        // p_delay(1) + p_delay(7) before the message lands.
        if (!(await useOn(q, /^chest key$/i, /^chest$/i, () => q.count('pirate message') > 0, 20))) {
            throw new Error('the chest gave no pirate message');
        }
    }
    const msg = q.sdk.findInventoryItem(/^pirate message$/i)!;
    await q.sdk.sendUseItem(msg.slot, 1);
    await q.sdk.waitForTicks(3);
    await q.bot.closeInterface().catch(() => undefined);
}

/** Falador park: knock the gardener out (he stops any dig within 10 tiles), then dig on the X. */
async function dig(q: Quest): Promise<void> {
    const since = cursor(q);
    const done = () => linesSince(q, since).some((t) => /little bag of treasure/i.test(t));
    for (let attempt = 0; attempt < 4 && !done(); attempt++) {
        await q.goTo(DIG, 1);
        const gardener = q.sdk.findNearbyNpc(/^gardener$/i);
        if (gardener && gardener.distance <= 12) {
            await q.bot.attack(gardener, ticksToMs(10));
            await untilTicks(q.sdk, (s) => !(s.nearbyNpcs ?? []).some((n) => n.index === gardener.index && (n.hp ?? 1) > 0), 60);
            await q.sdk.waitForTicks(2);
            await q.goTo(DIG, 1);
        }
        const spade = q.sdk.findInventoryItem(/^spade$/i);
        if (!spade) throw new Error('no spade to dig with');
        await q.sdk.sendUseItem(spade.slot, 1);
        await untilTicks(q.sdk, done, 15);
        if (!done()) q.log(`dig ${attempt + 1} at (${pos(q).x},${pos(q).z}): ${linesSince(q, since).slice(-3).join(' / ') || 'no messages'}`);
    }
    if (!done()) throw new Error('no treasure from the dig');
    // queue(hunt_quest_complete) then the quest scroll: let it land before the journal read.
    await q.sdk.waitForTicks(4);
}

await runQuest({
    id: 'hunt',
    hub: 'draynor',
    journal: { label: "Pirate's Treasure", title: "Pirate's Treasure" },
    stages: [
        { id: 'unstarted', rule: { id: 'hunt:unstarted', kind: 'unstarted', all: ['I can start this quest by speaking to'] } },
        { id: 'fetch_rum', rule: { id: 'hunt:fetch_rum', kind: 'active', all: ['agreed to tell me the location'], none: ['QUEST COMPLETE'] } },
        { id: 'shipped', rule: { id: 'hunt:shipped', kind: 'active', all: ['crate has been shipped'], none: ['QUEST COMPLETE'] } },
        { id: 'store', rule: { id: 'hunt:store', kind: 'active', all: ["taken a job at Wydin's store"], none: ['QUEST COMPLETE'] } },
        { id: 'rum', rule: { id: 'hunt:rum', kind: 'active', all: ['I should take it to Redbeard Frank'], none: ['QUEST COMPLETE'] } },
        { id: 'key', rule: { id: 'hunt:key', kind: 'active', all: ['He has told me that the'], none: ['QUEST COMPLETE'] } },
        { id: 'note', rule: { id: 'hunt:note', kind: 'active', all: ['The note reads'], none: ['QUEST COMPLETE'] } },
        { id: 'complete', rule: { id: 'hunt:complete', kind: 'complete', all: ['QUEST COMPLETE'] } },
    ],
    transitions: [
        { from: 'unstarted', to: 'fetch_rum', at: FRANK, talk: { npc: FRANK_NPC, choices: [/in search of treasure/i] } },
        // Fare 30 + the rum 30; Luthas pays 30, the fare back.
        { from: 'fetch_rum', to: 'shipped', needs: [{ item: 'coins', count: 60 }], run: smuggle },
        {
            from: 'shipped',
            to: 'store',
            needs: [
                { item: 'white apron', count: 1 },
                { item: 'coins', count: 30 },
            ],
            run: async (q) => {
                await sail(q, false);
                await q.talk(/^wydin$/i, [/can i get a job/i], WYDIN);
            },
        },
        { from: 'store', to: 'rum', needs: [{ item: 'white apron', count: 1 }], run: fetchRum },
        { from: 'rum', to: 'key', at: FRANK, needs: [{ item: RUM, count: 1 }], talk: { npc: FRANK_NPC, choices: [/i'll go and get it/i] } },
        { from: 'key', to: 'note', needs: [{ item: 'chest key', count: 1 }], run: openChest },
        { from: 'note', to: 'complete', needs: [{ item: 'spade', count: 1 }], run: dig },
    ],
});
