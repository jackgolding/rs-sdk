/**
 * Goblin Diplomacy — orange, blue, then plain goblin mail for the generals.
 *
 *   bun bots/quests/goblin-diplomacy.ts {botname}
 *
 * Journal rules from quest_gobdip/gobdip_journal.rs2; dialog from quest_gobdip.rs2
 * (the bartender's "Not very busy in here today, is it?" starts it; General
 * Wartface's stage-1 menu "pick an armour colour" asks for orange; each later
 * talk takes the next armour). Mail, dyes and their ingredients are in
 * lib/sources.ts; prepare makes all three armours before the bartender. Each journal text keeps the earlier ones struck through, so
 * the runner tries the later rules first.
 */
import { runQuest } from './lib/run-quest';

/** The Rusty Anchor, Port Sarim. */
const BARTENDER = { x: 3045, z: 3257 };
/** Generals Wartface and Bentnoze, Goblin Village. */
const GENERALS = { x: 2957, z: 3511 };
const WARTFACE = /^general wartface$/i;

await runQuest({
    id: 'gobdip',
    hub: 'draynor',
    journal: { label: 'Goblin Diplomacy', title: 'Goblin Diplomacy' },
    stages: [
        { id: 'unstarted', rule: { id: 'gobdip:not_started', kind: 'unstarted', all: ['I can start this quest by talking to'] } },
        { id: 'started', rule: { id: 'gobdip:started', kind: 'active', all: ['before it turns into a full blown war'] } },
        { id: 'will_bring', rule: { id: 'gobdip:will_bring', kind: 'active', all: ['I should bring the goblins some'] } },
        { id: 'gave_orange', rule: { id: 'gobdip:gave_orange', kind: 'active', all: ['to try out instead'], none: ['I gave some Blue'] } },
        // Also matches gave_brown (varp 5), the one-tick stage before the completion
        // queue runs; talking to the generals there completes the quest, as here.
        { id: 'gave_blue', rule: { id: 'gobdip:gave_blue', kind: 'active', all: ['some of their original'], none: ['QUEST COMPLETE'] } },
        { id: 'complete', rule: { id: 'gobdip:complete', kind: 'complete', all: ['QUEST COMPLETE'] } },
    ],
    transitions: [
        { from: 'unstarted', to: 'started', at: BARTENDER, talk: { npc: /^bartender$/i, choices: [/not very busy/i] } },
        { from: 'started', to: 'will_bring', at: GENERALS, talk: { npc: WARTFACE, choices: [/pick an armour colour/i] } },
        {
            from: 'will_bring',
            to: 'gave_orange',
            at: GENERALS,
            needs: [{ item: 'orange goblin mail', count: 1 }],
            talk: { npc: WARTFACE },
        },
        { from: 'gave_orange', to: 'gave_blue', at: GENERALS, needs: [{ item: 'blue goblin mail', count: 1 }], talk: { npc: WARTFACE } },
        { from: 'gave_blue', to: 'complete', at: GENERALS, needs: [{ item: 'goblin mail', count: 1 }], talk: { npc: WARTFACE } },
    ],
});
