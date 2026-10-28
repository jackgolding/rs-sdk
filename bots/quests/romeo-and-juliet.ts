/**
 * Romeo & Juliet — messages between the lovers, then a cadava potion for Juliet.
 *
 *   bun bots/quests/romeo-and-juliet.ts {botname}
 *
 * Journal rules from quest_romeojuliet/romeojuliet_journal.rs2: every stage
 * keeps the earlier ones struck through, so each rule keys on the stage's own
 * "@dbl@" instruction and the runner tries the later rules first. Dialog from
 * areas/area_varrock/scripts/{romeo,juliet,father_lawrence,apothecary}.rs2:
 * Romeo's start menu "Can I help find her for you?" goes straight to the
 * agreement; every later talk is choice-free. Juliet is upstairs in her house
 * west of Varrock. The Apothecary turns one cadava berries into the potion
 * (lib/sources.ts picks the berries from their ground spawns).
 */
import { runQuest, type Quest } from './lib/run-quest';
import { untilTicks } from './lib/ticks';

/** Varrock Square (Romeo wanders around it). */
const ROMEO = { x: 3211, z: 3425 };
/**
 * Inside Juliet's house by its staircase (3156,3435; the front door is 3160,3440).
 * A looser arrival stops outside and climbTo takes the guard house's stairs at
 * 3175,3420 instead. Upstairs, talkTo opens the doors to Juliet (3159,3425 l1).
 */
const JULIET_STAIRS = { x: 3157, z: 3434 };
const FATHER_LAWRENCE = { x: 3254, z: 3475 };
const APOTHECARY = { x: 3195, z: 3404 };

async function talkToJuliet(q: Quest): Promise<void> {
    await q.goTo(JULIET_STAIRS, 1);
    await q.climbTo(1);
    await q.talk(/^juliet$/i);
}

await runQuest({
    id: 'romeojuliet',
    hub: 'varrock-west',
    journal: { label: 'Romeo & Juliet', title: 'Romeo & Juliet' },
    stages: [
        { id: 'unstarted', rule: { id: 'rj:unstarted', kind: 'unstarted', all: ['I can start this quest by talking to'] } },
        { id: 'spoken_romeo', rule: { id: 'rj:spoken_romeo', kind: 'active', all: ['I should go and speak to Juliet'] } },
        { id: 'spoken_juliet', rule: { id: 'rj:spoken_juliet', kind: 'active', all: ['message from Juliet to Romeo'] } },
        { id: 'passed_message', rule: { id: 'rj:passed_message', kind: 'active', all: ['I should find Father Lawrence'] } },
        { id: 'spoken_father', rule: { id: 'rj:spoken_father', kind: 'active', all: ['I need to find the Apothecary'] } },
        {
            id: 'spoken_apothecary',
            rule: { id: 'rj:spoken_apothecary', kind: 'active', all: ['bring him some cadava berries'], none: ['After the Apothecary made me', 'QUEST COMPLETE'] },
        },
        { id: 'juliet_crypt', rule: { id: 'rj:juliet_crypt', kind: 'active', all: ['find Romeo and tell him'] } },
        { id: 'complete', rule: { id: 'rj:complete', kind: 'complete', all: ['QUEST COMPLETE'] } },
    ],
    transitions: [
        { from: 'unstarted', to: 'spoken_romeo', at: ROMEO, talk: { npc: /^romeo$/i, choices: [/can i help find her/i] } },
        // Juliet hands over the message (julietmessage) and the stage moves in the same dialog.
        { from: 'spoken_romeo', to: 'spoken_juliet', run: talkToJuliet },
        { from: 'spoken_juliet', to: 'passed_message', at: ROMEO, talk: { npc: /^romeo$/i } },
        { from: 'passed_message', to: 'spoken_father', at: FATHER_LAWRENCE, talk: { npc: /^father lawrence$/i } },
        // Holding the berries here does not use them: apothecary_lawrence_sent only moves the stage.
        { from: 'spoken_father', to: 'spoken_apothecary', at: APOTHECARY, talk: { npc: /^apothecary$/i } },
        {
            from: 'spoken_apothecary',
            to: 'juliet_crypt',
            // The stage only moves at Juliet; the potion is the Apothecary's swap for one berry.
            needs: [{ item: 'cadava berries', count: 1, or: 'cadava potion' }],
            run: async (q) => {
                if (q.count('cadava potion') < 1) {
                    await q.talk(/^apothecary$/i, [], APOTHECARY);
                    await untilTicks(q.sdk, () => q.count('cadava potion') > 0, 10);
                    // The runner retries the transition; going on to Juliet without it wastes the walk.
                    if (q.count('cadava potion') < 1) return q.log('apothecary: no cadava potion yet');
                    q.log('apothecary: cadava potion made');
                }
                await talkToJuliet(q);
            },
        },
        { from: 'juliet_crypt', to: 'complete', at: ROMEO, talk: { npc: /^romeo$/i } },
    ],
});
