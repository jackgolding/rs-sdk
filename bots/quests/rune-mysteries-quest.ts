/**
 * Rune Mysteries — the Duke's talisman to Sedridor, his package to Aubury, Aubury's notes back.
 *
 *   bun bots/quests/rune-mysteries-quest.ts {botname}
 *
 * Journal rules from quest_runemysteries/scripts/runemysteries_journal.rs2 (the
 * quest list says "Rune Mysteries Quest", the journal heading "Rune Mysteries");
 * dialog from duke_horacio.rs2, sedridor.rs2 and aubury.rs2. Every item is handed
 * over by the quest itself, so there are no sources. Sedridor is in the Wizards'
 * Tower cellar.
 */
import type { Quest } from './lib/run-quest';
import { runQuest } from './lib/run-quest';
import { untilTicks } from './lib/ticks';

/** Lumbridge castle staircase; the Duke is on plane 1 at (3212,3220). */
const CASTLE_STAIRS = { x: 3205, z: 3208 };
/** Wizards' Tower ground floor, by the cellar ladder (3104,3162). */
const TOWER_INSIDE = { x: 3105, z: 3163 };
/** On the road east of the tower (old script's Lumbridge waypoint): proof the walk left the tower. */
const TOWER_OUTSIDE = { x: 3140, z: 3208 };
/** Aubury's rune shop, Varrock. */
const AUBURY = { x: 3253, z: 3402 };
const DUKE = /^duke horacio$/i;
const SEDRIDOR = /^sedridor$/i;

const inCellar = (q: Quest) => (q.sdk.getState()?.player?.worldZ ?? 0) > 6400;

/** Down into the tower cellar or back up, by its ladder. */
async function useCellarLadder(q: Quest, down: boolean): Promise<void> {
    const opt = down ? /climb-down/i : /climb-up/i;
    for (let i = 0; i < 4 && inCellar(q) !== down; i++) {
        if (down) {
            await q.goTo(TOWER_INSIDE, 2);
            // walkTo's tolerance can stop outside the ladder room ("I can't reach that!" x10).
            await q.reach(/^ladder$/i, opt).catch((err) => q.log(`ladder: ${err instanceof Error ? err.message : err}`));
        }
        await q.sdk.scanNearbyLocs(12).catch(() => undefined);
        const ladder = q.sdk.findNearbyLoc(/ladder/i, { withOption: opt, reachable: true }) ?? q.sdk.findNearbyLoc(/ladder/i, { withOption: opt });
        if (!ladder) throw new Error(`no ladder to ${down ? 'climb down' : 'climb up'} near (${q.sdk.getState()?.player?.worldX},${q.sdk.getState()?.player?.worldZ})`);
        await q.bot.interactLoc(ladder, opt);
        await untilTicks(q.sdk, () => inCellar(q) === down, 20);
    }
    if (inCellar(q) !== down) throw new Error(`could not ${down ? 'enter' : 'leave'} the Wizards' Tower cellar`);
}

/** Talk to Sedridor in the cellar, then climb back out and leave the tower so the next leg can walk. */
async function talkToSedridor(q: Quest, choices: RegExp[]): Promise<void> {
    if (!inCellar(q)) await useCellarLadder(q, true);
    await untilTicks(q.sdk, (s) => (s.nearbyNpcs ?? []).some((n) => SEDRIDOR.test(n.name)), 15);
    await q.talk(SEDRIDOR, choices);
    await useCellarLadder(q, false);
    // Out of the ladder room: q.goTo crosses its door by hand (lib/doors.ts STUCK_DOORS).
    await q.goTo(TOWER_OUTSIDE, 4);
}

const SEDRIDOR_START = [/looking for the head wizard/i, /ok, here you are/i, /yes, certainly/i];

await runQuest({
    id: 'runemysteries',
    hub: 'draynor',
    journal: { label: 'Rune Mysteries Quest', title: 'Rune Mysteries' },
    stages: [
        { id: 'unstarted', rule: { id: 'runemysteries:unstarted', kind: 'unstarted', all: ['I can start this quest by speaking to'] } },
        // Also given_talisman ("I should talk to the Head Wizard again"): the hand-in runs straight
        // on to the package offer, so that stage is never seen unless a run stops in between, and a
        // required checkpoint no run passes through fails the evidence gate. Sedridor's dialog from
        // either stage ends at "Yes, certainly".
        {
            id: 'started',
            rule: {
                id: 'runemysteries:started',
                kind: 'active',
                all: ['agreed to take it to the Wizards'],
                none: ['I should take this', 'again when he has finished examining', 'and see what he says', 'QUEST COMPLETE'],
            },
        },
        { id: 'received_package', rule: { id: 'runemysteries:received_package', kind: 'active', all: ['I should take this'] } },
        { id: 'given_package', rule: { id: 'runemysteries:given_package', kind: 'active', all: ['again when he has finished examining'] } },
        { id: 'received_notes', rule: { id: 'runemysteries:received_notes', kind: 'active', all: ['and see what he says'] } },
        { id: 'complete', rule: { id: 'runemysteries:complete', kind: 'complete', all: ['QUEST COMPLETE'] } },
    ],
    transitions: [
        {
            from: 'unstarted',
            to: 'started',
            run: async (q) => {
                if ((q.sdk.getState()?.player?.level ?? 0) !== 1) {
                    await q.goTo(CASTLE_STAIRS, 2);
                    await q.climbTo(1);
                }
                await untilTicks(q.sdk, (s) => (s.nearbyNpcs ?? []).some((n) => DUKE.test(n.name)), 15);
                await q.talk(DUKE, [/any quests for me/i, /sure, no problem/i]);
            },
        },
        // No `needs` for the air talisman: at given_talisman Sedridor already has it.
        { from: 'started', to: 'received_package', run: (q) => talkToSedridor(q, SEDRIDOR_START) },
        {
            from: 'received_package',
            to: 'given_package',
            needs: [{ item: 'research package', count: 1 }],
            at: AUBURY,
            talk: { npc: /^aubury$/i, choices: [/sent here with a package/i] },
        },
        { from: 'given_package', to: 'received_notes', at: AUBURY, talk: { npc: /^aubury$/i } },
        {
            from: 'received_notes',
            to: 'complete',
            needs: [{ item: 'notes', count: 1 }],
            run: (q) => talkToSedridor(q, [/nothing thanks/i]),
        },
    ],
});
