/**
 * Monk's Friend — Brother Omad's blanket, then Brother Cedric's water and wood.
 *
 *   bun bots/quests/drunkmonk.ts {botname}
 *
 * Journal rules from quest_drunkmonk/scripts/drunkmonk_journal.rs2; dialog from
 * area_ardougne_east/scripts/{brother_omad,brother_cedric}.rs2; the cave from
 * quest_drunkmonk.rs2 (a timer adds the hidden ladder at 0_40_50_1_22 while the
 * player stands within 2 tiles, once Omad has asked) and ladders.rs2 (it drops
 * to 0_40_150_1_21). Items:
 *   - jug of water, logs   lib/sources.ts
 *   - child's blanket: ground spawn in the cave, taken here
 * given_water and fixing_cart share one journal text ("He needs some wood").
 */
import type { Quest } from './lib/run-quest';
import { runQuest } from './lib/run-quest';
import { tickNow, untilTicks } from './lib/ticks';

const OMAD = { x: 2604, z: 3209 };
const OMAD_NPC = /^brother omad$/i;
const CEDRIC = { x: 2614, z: 3259 };
const CEDRIC_NPC = /^brother cedric$/i;
/** The ring of stones: the hidden ladder appears on this tile. */
const RING = { x: 2561, z: 3222 };
/** The cave: landing (2561,9621), ladder up at (2561,9622), blanket on the table (old candidate probe). */
const BLANKET = { x: 2570, z: 9604 };

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const inCave = (q: Quest) => pos(q).z > 9000;
function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function linesSince(q: Quest, since: number): string[] {
    return (q.sdk.getState()?.gameMessages ?? []).filter((m) => (m.observationId ?? m.tick) > since).map((m) => m.text);
}

/** Stand by the ring until the ladder is added, climb down, take the blanket, climb out. */
async function fetchBlanket(q: Quest): Promise<void> {
    if (q.count("child's blanket") < 1) {
        if (!inCave(q)) {
            await q.goTo(RING, 1);
            let ladder;
            for (let i = 0; i < 10 && !ladder; i++) {
                const locs = await q.sdk.scanNearbyLocs(4).catch(() => q.sdk.getNearbyLocs() ?? []);
                ladder = locs.find((l) => /^ladder$/i.test(l.name) && l.x === RING.x && l.z === RING.z);
                if (!ladder) await q.sdk.waitForTicks(2);
            }
            if (!ladder) throw new Error(`the hidden ladder never appeared at (${RING.x},${RING.z}) from (${pos(q).x},${pos(q).z})`);
            await q.bot.interactLoc(ladder, /climb/i);
            if (!(await untilTicks(q.sdk, () => inCave(q), 10))) throw new Error('climbing the hidden ladder did not enter the cave');
        }
        await q.bot.walkTo(BLANKET.x, BLANKET.z, 2);
        // One shared ground spawn (respawnrate 50): concurrent accounts take turns, so
        // wait out a few respawns rather than leaving empty-handed.
        const t0 = tickNow(q.sdk);
        while (q.count("child's blanket") < 1 && tickNow(q.sdk) - t0 < 300) {
            await q.sdk.scanGroundItems(10).catch(() => undefined);
            const blanket = q.sdk.findGroundItem(/^child's blanket$/i);
            if (!blanket) {
                await q.sdk.waitForTicks(5);
                continue;
            }
            await q.bot.pickupItem(blanket);
            await untilTicks(q.sdk, () => q.count("child's blanket") > 0, 10);
        }
        q.log(`blanket ${q.count("child's blanket") ? 'taken' : 'NOT FOUND'} after ${tickNow(q.sdk) - t0}t at (${pos(q).x},${pos(q).z})`);
    }
    await leaveCave(q);
    if (q.count("child's blanket") < 1) throw new Error("no child's blanket in the cave");
}

async function leaveCave(q: Quest): Promise<void> {
    if (!inCave(q)) return;
    await q.bot.walkTo(2561, 9621, 2);
    for (let i = 0; i < 3 && inCave(q); i++) {
        const locs = await q.sdk.scanNearbyLocs(6).catch(() => q.sdk.getNearbyLocs() ?? []);
        const ladder = locs.filter((l) => /^ladder$/i.test(l.name) && l.options?.some((o) => /climb/i.test(o))).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!ladder) throw new Error(`no ladder out of the cave near (${pos(q).x},${pos(q).z})`);
        await q.bot.interactLoc(ladder, /climb/i);
        await untilTicks(q.sdk, () => !inCave(q), 10);
    }
    if (inCave(q)) throw new Error('could not climb out of the cave');
}

/** The party: p_delay'd dances, then queue(drunkmonk_complete). No clicks or journal reads until it lands. */
async function party(q: Quest): Promise<void> {
    const since = cursor(q);
    const t0 = tickNow(q.sdk);
    await q.talk(OMAD_NPC, [], OMAD);
    const done = await untilTicks(q.sdk, () => linesSince(q, since).some((t) => /completed|quest complete/i.test(t)), 60);
    q.log(`party ${done ? 'over' : 'NO completion message'} after ${tickNow(q.sdk) - t0}t`);
    await q.sdk.waitForTicks(3);
}

await runQuest({
    id: 'drunkmonk',
    hub: 'ardougne',
    journal: { label: "Monk's Friend", title: "Monk's Friend" },
    stages: [
        { id: 'unstarted', rule: { id: 'drunkmonk:unstarted', kind: 'unstarted', all: ['I can start this quest by speaking to'] } },
        { id: 'omad', rule: { id: 'drunkmonk:omad', kind: 'active', all: ['secret cave'], none: ['QUEST COMPLETE'] } },
        { id: 'blanket', rule: { id: 'drunkmonk:blanket', kind: 'active', all: ['gave back the blanket'], none: ['QUEST COMPLETE'] } },
        { id: 'cedric', rule: { id: 'drunkmonk:cedric', kind: 'active', all: ['agreed to find'], none: ['QUEST COMPLETE'] } },
        { id: 'water', rule: { id: 'drunkmonk:water', kind: 'active', all: ['I need to take him a'], none: ['QUEST COMPLETE'] } },
        { id: 'wood', rule: { id: 'drunkmonk:wood', kind: 'active', all: ['He needs some'], none: ['QUEST COMPLETE'] } },
        { id: 'cart', rule: { id: 'drunkmonk:cart', kind: 'active', all: ['on the way'], none: ['QUEST COMPLETE'] } },
        { id: 'complete', rule: { id: 'drunkmonk:complete', kind: 'complete', all: ['QUEST COMPLETE'] } },
    ],
    transitions: [
        { from: 'unstarted', to: 'omad', at: OMAD, talk: { npc: OMAD_NPC, choices: [/why can't you sleep/i, /can i help at all/i] } },
        {
            from: 'omad',
            to: 'blanket',
            run: async (q) => {
                await fetchBlanket(q);
                await q.talk(OMAD_NPC, [], OMAD);
            },
        },
        { from: 'blanket', to: 'cedric', at: OMAD, talk: { npc: OMAD_NPC, choices: [/who's brother cedric/i, /where should i look/i] } },
        { from: 'cedric', to: 'water', at: CEDRIC, talk: { npc: CEDRIC_NPC } },
        // The water hand-over runs straight on into "Could you help?" with the cart.
        { from: 'water', to: 'wood', at: CEDRIC, needs: [{ item: 'jug of water', count: 1 }], talk: { npc: CEDRIC_NPC, choices: [/happy to/i] } },
        { from: 'wood', to: 'cart', at: CEDRIC, needs: [{ item: 'logs', count: 1 }], talk: { npc: CEDRIC_NPC, choices: [/happy to/i] } },
        { from: 'cart', to: 'complete', run: party },
    ],
});
