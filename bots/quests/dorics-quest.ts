/**
 * Doric's Quest — 6 clay, 4 copper ore, 2 iron ore for Doric.
 *
 *   bun bots/quests/dorics-quest.ts {botname}
 *
 * Journal rules from quest_doric/doric_journal.rs2 (heading "Dorics' Quest",
 * list label "Doric's Quest"); dialog from quest_doric.rs2 (%doricquest 0 ->
 * "I wanted to use your anvils." / "Yes, I will get you materials." sets 10).
 * The ores come from lib/sources.ts (Rimmington mine); iron needs Mining 15,
 * which the runner trains first (lib/training.ts) when the account is below it.
 */
import { runQuest, type Quest } from './lib/run-quest';

/** Doric stands inside his hut; collision masks its door, so walkTo the interior tile (it opens the door). */
const DORIC_INSIDE = { x: 2952, z: 3450 };

async function talkToDoric(q: Quest, choices: RegExp[]): Promise<void> {
    // Exactly the interior tile: a tolerance of 1 "arrives" outside the wall and the talk cannot reach.
    await q.goTo(DORIC_INSIDE, 0);
    await q.talk(/^doric$/i, choices);
}

await runQuest({
    id: 'doric',
    hub: 'falador-east',
    journal: { label: "Doric's Quest", title: "Dorics' Quest" },
    stages: [
        { id: 'unstarted', rule: { id: 'doric:not_started', kind: 'unstarted', all: ['I can start this quest by talking to Doric'] } },
        { id: 'active', rule: { id: 'doric:started', kind: 'active', all: ['I need to collect some items and bring them to Doric'] } },
        { id: 'complete', rule: { id: 'doric:complete', kind: 'complete', all: ['QUEST COMPLETE'] } },
    ],
    transitions: [
        {
            from: 'unstarted',
            to: 'active',
            at: DORIC_INSIDE,
            run: (q) => talkToDoric(q, [/i wanted to use your anvils/i, /yes, i will get you materials/i]),
        },
        {
            from: 'active',
            to: 'complete',
            at: DORIC_INSIDE,
            needs: [
                { item: 'clay', count: 6 },
                { item: 'copper ore', count: 4 },
                { item: 'iron ore', count: 2 },
            ],
            run: (q) => talkToDoric(q, [/i have everything you need/i]),
        },
    ],
});
