/**
 * Demon Slayer — Gypsy Aris, Sir Prysin's three keys, Silverlight, Delrith.
 *
 *   bun bots/quests/demon-slayer.ts {botname}
 *
 * Journal rules from quest_demon/scripts/demon_journal.rs2; dialog from
 * area_varrock/scripts/{gypsy,sir_prysin,captain_rovin}.rs2 and
 * area_draynor/scripts/traiborn.rs2; drain + sewer key from demon_slayer.rs2;
 * the fight from delrith.rs2. Items:
 *   - coins (Aris takes 1), bucket of water, 25 bones   lib/sources.ts
 *   - the three keys (all named "Key", told apart by obj id) and Silverlight: quest items
 *
 * The key-hunt journal text depends on the inventory: holding all three keys
 * reads "Now I have all 3 keys", which is the `keys` stage.
 */
import type { Quest } from './lib/run-quest';
import { runQuest } from './lib/run-quest';
import { driveDialog } from './lib/dialog';
import { tickNow, ticksToMs, untilTicks } from './lib/ticks';

const GYPSY = { x: 3203, z: 3424 };
/** Sir Prysin's room, palace west wing (old script, verified live). */
const PRYSIN = { x: 3204, z: 3474 };
/** Palace kitchen drain beside the sink. */
const DRAIN = { x: 3225, z: 3494 };
/** Palace-east manhole: Open, then Climb down. */
const MANHOLE = { x: 3237, z: 3458 };
/** Where the washed-down key lands: obj_add(0_50_154_25_41), 300 ticks. */
const SEWER_KEY = { x: 3225, z: 9897 };
const SEWER_LADDER = { x: 3237, z: 9858 };
/** Staircase base below Captain Rovin's room (the SE shaft; other palace stairs are decoys). */
const ROVIN_STAIRS = { x: 3203, z: 3497 };
/** Wizards' Tower ground floor by the staircase; Traiborn is on plane 1. */
const TOWER_INSIDE = { x: 3105, z: 3163 };
const STONE_CIRCLE = { x: 3227, z: 3367 };

/** demon.obj: Traiborn's, Rovin's, the drain's. */
const KEY = { traiborn: 2399, rovin: 2400, drain: 2401 } as const;
const BONES = 25;
const INCANTATION = /carlem aber camerinthum purchai gabindo/i;

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const hasKey = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id);
function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function linesSince(q: Quest, since: number): string[] {
    return (q.sdk.getState()?.gameMessages ?? []).filter((m) => (m.observationId ?? m.tick) > since).map((m) => m.text);
}

/** Pour water down the drain, go down the manhole and take the key before it despawns. */
async function drainKey(q: Quest): Promise<void> {
    if (hasKey(q, KEY.drain)) return;
    await q.goTo(DRAIN, 2);
    const since = cursor(q);
    await q.bot.useItemOnLoc(/^bucket of water$/i, /^drain$/i, { timeout: ticksToMs(20) });
    if (!(await untilTicks(q.sdk, () => linesSince(q, since).some((t) => /washed the key|pour the liquid/i.test(t)), 15))) {
        throw new Error(`drain: no pour (${linesSince(q, since).join(' / ') || 'no messages'})`);
    }
    // The empty bucket is dead weight: 25 bones + 3 keys fill the pack.
    const bucket = q.sdk.findInventoryItem(/^bucket$/i);
    if (bucket) await q.sdk.sendDropItem(bucket.slot);
    const t0 = tickNow(q.sdk);
    await q.goTo(MANHOLE, 3);
    for (let i = 0; i < 4 && pos(q).z < 9000; i++) {
        await q.sdk.scanNearbyLocs(6).catch(() => undefined);
        const hole = q.sdk.findNearbyLoc(/^manhole$/i);
        if (!hole) throw new Error(`no manhole near (${pos(q).x},${pos(q).z})`);
        if (hole.options?.some((o) => /^open$/i.test(o))) {
            await q.bot.interactLoc(hole, /^open$/i);
            await untilTicks(q.sdk, () => !!q.sdk.findNearbyLoc(/^manhole$/i, { withOption: /climb/i }), 8);
            continue;
        }
        await q.bot.interactLoc(hole, /climb/i);
        await untilTicks(q.sdk, (s) => (s.player?.worldZ ?? 0) > 9000, 10);
    }
    if (pos(q).z < 9000) throw new Error('could not climb down the palace manhole');
    await q.bot.walkTo(SEWER_KEY.x, SEWER_KEY.z, 2);
    for (let i = 0; i < 8 && !hasKey(q, KEY.drain); i++) {
        await q.sdk.scanGroundItems(10).catch(() => undefined);
        const key = q.sdk.findGroundItem(/^key$/i);
        if (!key) {
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.bot.pickupItem(key);
        await untilTicks(q.sdk, () => hasKey(q, KEY.drain), 10);
    }
    q.log(`drain key ${hasKey(q, KEY.drain) ? 'taken' : 'NOT FOUND'} ${tickNow(q.sdk) - t0}t after the pour at (${pos(q).x},${pos(q).z})`);
    await leaveSewer(q);
    if (!hasKey(q, KEY.drain)) throw new Error('drain key not on the sewer floor');
}

async function leaveSewer(q: Quest): Promise<void> {
    if (pos(q).z < 9000) return;
    await q.bot.walkTo(SEWER_LADDER.x, SEWER_LADDER.z, 2);
    for (let i = 0; i < 3 && pos(q).z > 9000; i++) {
        await q.sdk.scanNearbyLocs(6).catch(() => undefined);
        const ladder = q.sdk.findNearbyLoc(/ladder/i, { withOption: /climb-up|climb up/i });
        if (!ladder) throw new Error(`no sewer ladder near (${pos(q).x},${pos(q).z})`);
        await q.bot.interactLoc(ladder, /climb-up|climb up/i);
        await untilTicks(q.sdk, (s) => (s.player?.worldZ ?? 0) < 9000, 10);
    }
    if (pos(q).z > 9000) throw new Error('could not climb out of the sewer');
}

async function rovinKey(q: Quest): Promise<void> {
    if (hasKey(q, KEY.rovin)) return;
    if (pos(q).level === 0) await q.goTo(ROVIN_STAIRS, 1);
    await q.climbTo(2);
    try {
        await untilTicks(q.sdk, () => !!q.sdk.findNearbyNpc(/^captain rovin$/i), 15);
        for (let i = 0; i < 3 && !hasKey(q, KEY.rovin); i++) {
            await q.talk(/^captain rovin$/i, [/but this is important/i, /demon who wants to invade/i]);
            // if_close; p_delay(2); inv_add — the key lands after the last page.
            await untilTicks(q.sdk, () => hasKey(q, KEY.rovin), 8);
        }
    } finally {
        await q.climbTo(0);
    }
    if (!hasKey(q, KEY.rovin)) throw new Error('Captain Rovin never handed over his key');
}

async function traibornKey(q: Quest): Promise<void> {
    if (hasKey(q, KEY.traiborn)) return;
    if (pos(q).level === 0) await q.goTo(TOWER_INSIDE, 2);
    await q.climbTo(1);
    try {
        // First talk arms the ritual (find_bones); later talks hand bones one per p_delay.
        for (let talk = 0; talk < 4 && !hasKey(q, KEY.traiborn); talk++) {
            const bones = q.count('bones');
            await q.talk(/^traiborn$/i, [/key given to you by sir prysin/i, /keys knocking around/i, /get the bones/i]);
            // The handover closes the dialog for ~25 p_delays, then reopens at "Hurrah!".
            const t0 = tickNow(q.sdk);
            let last = q.count('bones');
            while (!hasKey(q, KEY.traiborn) && tickNow(q.sdk) - t0 < 200) {
                if (q.sdk.getDialog()?.isOpen) {
                    await driveDialog(q.sdk, [], { done: () => hasKey(q, KEY.traiborn), ticks: 60, log: q.log });
                    continue;
                }
                const now = q.count('bones');
                if (now === last && !(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || q.count('bones') !== last || hasKey(q, KEY.traiborn), 12))) break;
                last = q.count('bones');
            }
            q.log(`Traiborn talk ${talk + 1}: bones ${bones} -> ${q.count('bones')}, key ${hasKey(q, KEY.traiborn)}`);
        }
    } finally {
        await q.climbTo(0);
    }
    if (!hasKey(q, KEY.traiborn)) throw new Error('Traiborn never handed over his key');
}

/** Wield Silverlight, beat Delrith down, then say the incantation (option 4). */
async function slayDelrith(q: Quest): Promise<void> {
    await q.goTo(STONE_CIRCLE, 4);
    if (!q.sdk.getEquipment().some((i) => /^silverlight$/i.test(i.name))) {
        await q.bot.equipItem(/^silverlight$/i);
        await untilTicks(q.sdk, () => q.sdk.getEquipment().some((i) => /^silverlight$/i.test(i.name)), 5);
    }
    const since = cursor(q);
    const done = () => linesSince(q, since).some((t) => /completed the|quest complete|congratulations/i.test(t));
    const banished = () => linesSince(q, since).some((t) => /back to the dark dimension/i.test(t)) || done();
    const t0 = tickNow(q.sdk);
    let attacks = 0;
    while (!banished() && tickNow(q.sdk) - t0 < 1500) {
        if (q.sdk.getDialog()?.isOpen) {
            await driveDialog(q.sdk, [INCANTATION], { done: banished, ticks: 60, log: q.log });
            continue;
        }
        if (q.sdk.getState()?.player?.combat?.inCombat) {
            await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || !s.player?.combat?.inCombat, 6);
            continue;
        }
        const delrith = q.sdk.findNearbyNpc(/^delrith$/i);
        if (!delrith) {
            // Another account's banishing: he respawns.
            await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || !!q.sdk.findNearbyNpc(/^delrith$/i), 10);
            continue;
        }
        attacks++;
        const res = await q.bot.attack(delrith, ticksToMs(10));
        if (!res.success) q.log(`attack #${attacks} on Delrith: ${res.message}`);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || !!s.player?.combat?.inCombat, 6);
    }
    if (!banished()) throw new Error(`Delrith not banished after ${tickNow(q.sdk) - t0}t (${attacks} attacks; ${linesSince(q, since).slice(-4).join(' / ') || 'no messages'})`);
    q.log(`banished Delrith in ${tickNow(q.sdk) - t0}t (${attacks} attacks)`);
    // demon_slayer_complete is queued after the mesbox: a journal read before it lands kills it.
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 20 });
    await untilTicks(q.sdk, done, 15);
    await q.sdk.waitForTicks(2);
}

await runQuest({
    id: 'demon',
    hub: 'varrock-west',
    // The three Silverlight keys are all "Key" (ids below). A resumed run's naked prologue
    // banked a drain key already picked up, and the sewer floor stays empty after that
    // (jacklove15, ABGARMY05: "drain key not on the sewer floor", 2026-10-29).
    carry: [KEY.traiborn, KEY.rovin, KEY.drain, 'silverlight'],
    journal: { label: 'Demon Slayer', title: 'Demon Slayer' },
    stages: [
        { id: 'unstarted', rule: { id: 'demon:unstarted', kind: 'unstarted', all: ['I can start this quest by speaking to'] } },
        { id: 'aris', rule: { id: 'demon:aris', kind: 'active', all: ['where it is'], none: ['QUEST COMPLETE'] } },
        { id: 'key_hunt', rule: { id: 'demon:key_hunt', kind: 'active', all: ['needs 3 keys'], none: ['QUEST COMPLETE'] } },
        { id: 'keys', rule: { id: 'demon:keys', kind: 'active', all: ['all 3 keys'], none: ['QUEST COMPLETE'] } },
        { id: 'silverlight', rule: { id: 'demon:silverlight', kind: 'active', all: ['stone circle south of the city'], none: ['QUEST COMPLETE'] } },
        { id: 'complete', rule: { id: 'demon:complete', kind: 'complete', all: ['QUEST COMPLETE'] } },
    ],
    transitions: [
        {
            from: 'unstarted',
            to: 'aris',
            at: GYPSY,
            needs: [{ item: 'coins', count: 1 }],
            talk: { npc: /^gypsy$/i, choices: [/^ok, here you go/i, /aaargh bit mean/i, /who's delrith/i, /okay, where is he/i, /where can i find silverlight/i, /okay, thanks/i] },
        },
        {
            from: 'aris',
            to: 'key_hunt',
            at: PRYSIN,
            talk: { npc: /^sir prysin$/i, choices: [/gypsy aris said/i, /i need to find silverlight/i, /crystal ball/i, /so give me the keys/i, /better go key hunting/i, /where can i find captain rovin/i] },
        },
        {
            from: 'key_hunt',
            to: 'keys',
            needs: [
                { item: 'bucket of water', count: 1 },
                { item: 'bones', count: BONES },
            ],
            run: async (q) => {
                await drainKey(q);
                await rovinKey(q);
                await traibornKey(q);
            },
        },
        {
            from: 'keys',
            to: 'silverlight',
            at: PRYSIN,
            // All three are "Key"; quest items, withdrawn by the prologue on a resumed run.
            needs: [{ item: 'key', count: 3 }],
            talk: { npc: /^sir prysin$/i },
            run: async (q) => {
                // if_close; mes; p_delay(2); mes; p_delay(2); inv_add(silverlight).
                await untilTicks(q.sdk, () => q.count('silverlight') > 0, 12);
            },
        },
        {
            from: 'silverlight',
            to: 'complete',
            needs: [{ item: 'silverlight', count: 1 }],
            run: slayDelrith,
        },
    ],
});
