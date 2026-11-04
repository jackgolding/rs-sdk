/**
 * Dwarf Cannon — Commander Lawgof's railings, the watchtower, Lolk in the goblin cave, the broken
 * multicannon and Nulodion's mould.
 *
 *   bun bots/quests/dwarf-cannon.ts {botname}
 *
 * Journal rules from quest_mcannon/scripts/mcannon_journal.rs2; the route is lib/dwarf-cannon.ts. No
 * skill gates (the railings and the cannon parts are Crafting/Smithing rolls that only fail more at low
 * levels). Goblins in the cave: a melee weapon and a few sharks. Reward: 1 QP, Crafting XP, the right
 * to buy a cannon from Nulodion.
 */
import { runQuest } from './lib/run-quest';
import { fetchRemains, fixCannon, fixRailings, held, LAWGOF, leaveCave, NULODION, OBJ, rescueLolk, seeNulodion } from './lib/dwarf-cannon';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = [], optional = false) => ({
    id,
    rule: { id: `mcannon:${id}`, kind, all, none },
    ...(optional ? { optional } : {}),
});

const journal = { label: 'Dwarf Cannon', title: 'Dwarf Cannon' };
const lawgof = /^dwarf commander$/i;
const fight = [{ item: 'melee weapon', count: 1 }, { item: 'shark', count: 5 }];

await runQuest({
    id: 'mcannon',
    hub: 'seers',
    carry: [OBJ.railing, OBJ.remains, OBJ.toolkit, OBJ.notes, OBJ.mould],
    journal,
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
        // Every active page carries this line: the last stage that passes wins, so it only decides stage 1.
        stage('railings', 'active', ['asked me to help the dwarves']),
        stage('tower', 'active', ['check up on his guards at']),
        stage('remains', 'active', ['He sent me to find the']),
        stage('cave', 'active', ['Next I need to find the'], [], true),
        stage('lolk', 'active', ['rescued the dwarf child']),
        stage('cannon', 'active', ['asked me to fix the multicannon']),
        stage('fixed', 'active', ["I've fixed the broken multicannon"]),
        stage('nulodion', 'active', ['Nulodion the Cannon Engineer']),
        stage('notes', 'active', ["I've spoken to Nulodion"]),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        { from: 'unstarted', to: 'railings', at: LAWGOF, talk: { npc: lawgof, choices: [/yeah,? i'?d love to help/i] } },
        {
            from: 'railings',
            to: 'tower',
            run: async (q) => {
                await fixRailings(q);
                await q.talk(lawgof, [], LAWGOF);
            },
        },
        {
            from: 'tower',
            to: 'remains',
            run: async (q) => {
                await fetchRemains(q);
                await q.talk(lawgof, [], LAWGOF);
            },
        },
        // Entering the cave moves 3 -> 4 (passed through, never read); the crate frees Lolk (4 -> 5) in the same trip.
        {
            from: 'remains',
            to: 'lolk',
            needs: fight,
            run: async (q) => {
                await rescueLolk(q);
                await leaveCave(q);
            },
        },
        {
            from: 'cave',
            to: 'lolk',
            needs: fight,
            run: async (q) => {
                await rescueLolk(q);
                await leaveCave(q);
            },
        },
        { from: 'lolk', to: 'cannon', at: LAWGOF, talk: { npc: lawgof, choices: [/ok,? i'?ll see what i can do/i] } },
        {
            from: 'cannon',
            to: 'fixed',
            run: async (q) => {
                if (!held(q, OBJ.toolkit)) await q.talk(lawgof, [], LAWGOF);
                const fixedRule = stage('fixed', 'active', ["I've fixed the broken multicannon"]).rule;
                await fixCannon(q, async () => (await readJournalCheckpoint(q.sdk, journal, fixedRule)).verdict?.verdict === 'PASS');
            },
        },
        { from: 'fixed', to: 'nulodion', at: LAWGOF, talk: { npc: lawgof, choices: [/ok then,? just for you/i] } },
        { from: 'nulodion', to: 'notes', at: NULODION, run: (q) => seeNulodion(q) },
        { from: 'notes', to: 'complete', at: LAWGOF, talk: { npc: lawgof } },
    ],
});
