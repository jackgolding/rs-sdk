/**
 * Observatory Quest — the professor's telescope: three planks, a bronze bar, molten glass, the lens
 * mould from the goblin cavern, the lens, and a look at the sky from the dome.
 *
 *   bun bots/quests/observatory.ts {botname}
 *
 * Journal rules from quest_itgronigen/scripts/itgronigen_journal.rs2; the route is lib/observatory.ts.
 * No skill gates (the lens is made without a Crafting roll in this build). A goblin guard at the keep
 * gate and poison spiders in the other chests: a melee weapon and a few sharks. Reward: 2 QP, Crafting
 * XP, an uncut sapphire and a constellation's gift.
 */
import { runQuest } from './lib/run-quest';
import * as obs from './lib/observatory';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `itgronigen:${id}`, kind, all, none },
});

const journal = { label: 'Observatory Quest', title: 'Observatory Quest' };
const stages = [
    stage('unstarted', 'unstarted', ['I can start this quest by talking to the']),
    stage('planks', 'active', ['3 wooden planks']),
    stage('bronze', 'active', ['1 bronze bar']),
    stage('glass', 'active', ['1 molten glass']),
    stage('mould', 'active', ['1 lens mould']),
    stage('lens', 'active', ['create the lens by using the molten glass']),
    stage('telescope', 'active', ['meet him there by travelling through the']),
    stage('complete', 'complete', ['QUEST COMPLETE']),
];
const fight = [{ item: 'melee weapon', count: 1 }, { item: 'shark', count: 3 }];

await runQuest({
    id: 'itgronigen',
    hub: 'ardougne',
    journal,
    carry: [obs.OBJ.mould, obs.OBJ.lens],
    stages,
    transitions: [
        {
            from: 'unstarted',
            to: 'planks',
            run: async (q) => void (await obs.talkProfessor(q, [/i'?d like to have a look through that telescope/i, /sounds interesting,? what can i do for you/i])),
        },
        { from: 'planks', to: 'bronze', needs: [{ item: 'plank', count: 3 }], run: async (q) => void (await obs.talkProfessor(q)) },
        { from: 'bronze', to: 'glass', needs: [{ item: 'bronze bar', count: 1 }], run: async (q) => void (await obs.talkProfessor(q)) },
        { from: 'glass', to: 'mould', needs: [{ item: 'molten glass', count: 1 }], run: async (q) => void (await obs.talkProfessor(q)) },
        {
            from: 'mould',
            to: 'lens',
            needs: fight,
            run: async (q) => {
                await obs.fetchMould(q);
                await obs.leaveObservatory(q);
                await obs.talkProfessor(q);
            },
        },
        {
            from: 'lens',
            to: 'telescope',
            needs: (q) => (q.stage !== 'lens' || q.count(/^lens$/i) ? [] : [{ item: 'molten glass', count: 1 }]),
            run: async (q) => {
                // The mould went back to the bank on a resumed run's naked prologue (carry withdraws it).
                if (!obs.held(q, obs.OBJ.lens) && !obs.held(q, obs.OBJ.mould)) await obs.fetchMould(q);
                await obs.makeLens(q);
                await obs.leaveObservatory(q);
                await obs.talkProfessor(q);
            },
        },
        {
            from: 'telescope',
            to: 'complete',
            needs: fight,
            run: (q) => obs.telescope(q, async () => (await readJournalCheckpoint(q.sdk, journal, stages[stages.length - 1]!.rule)).verdict?.verdict === 'PASS'),
        },
    ],
});
