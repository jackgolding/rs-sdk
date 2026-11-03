/**
 * Sheep Herder — prod Councillor Halgrive's four plague sheep into the pen north of
 * East Ardougne, poison them and burn their bones.
 *
 *   bun bots/quests/sheep-herder.ts {botname}
 *
 * Journal rules from quest_sheepherder/scripts/sheepherder_journal.rs2; dialog from
 * councillor_halgrive.rs2 and doctor_orbon.rs2; the herding is lib/sheep-herder.ts.
 * Items: 100 coins for Orbon's suit (the only cost). The feed, suit and prod are the
 * quest's own and are carried across a resume; Halgrive and Orbon replace lost ones.
 * Reward: 3100 coins, 4 QP.
 */
import { runQuest } from './lib/run-quest';
import { disposeAll, inPen, leavePen, OBJ, SHEEP } from './lib/sheep-herder';

/** Councillor Halgrive by the zoo (npc spawn 2617,3299). */
const HALGRIVE = { x: 2617, z: 3299 };
/** Doctor Orbon in the chapel north of the zoo (npc spawn 2614,3306). */
const ORBON = { x: 2614, z: 3306 };

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `sheepherder:${id}`, kind, all, none },
});

await runQuest({
    id: 'sheepherder',
    hub: 'ardougne',
    // Shared sheep and one prod spawn: a few at a time.
    maxConcurrent: 3,
    carry: [OBJ.feed, OBJ.jacket, OBJ.trousers, OBJ.prod, ...SHEEP.map((s) => s.bones)],
    journal: { label: 'Sheep Herder', title: 'Sheep Herder' },
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
        stage('orbon', 'active', ['I need to get some protective clothing']),
        stage('herding', 'active', ['I bought some protective clothing'], ['I should return to', 'QUEST COMPLETE']),
        stage('disposed', 'active', ['I should return to'], ['QUEST COMPLETE']),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        {
            from: 'unstarted',
            to: 'orbon',
            at: HALGRIVE,
            talk: { npc: /^councillor halgrive$/i, choices: [/what'?s wrong/i, /i can do that for you/i] },
        },
        {
            from: 'orbon',
            to: 'herding',
            at: ORBON,
            needs: [{ item: 'coins', count: 100 }],
            talk: { npc: /^doctor orbon$/i, choices: [/ok,? i'?ll take it/i] },
        },
        {
            from: 'herding',
            to: 'disposed',
            // A lost suit costs another 100 from Orbon.
            needs: (q) => (q.count(/^plague jacket$/i) && q.count(/^plague trousers$/i) ? [] : [{ item: 'coins', count: 100 }]),
            run: async (q) => {
                try {
                    await disposeAll(q, HALGRIVE, ORBON);
                } finally {
                    const p = q.sdk.getState()?.player;
                    if (p && inPen({ x: p.worldX, z: p.worldZ })) await leavePen(q);
                }
            },
        },
        { from: 'disposed', to: 'complete', at: HALGRIVE, talk: { npc: /^councillor halgrive$/i, choices: [] } },
    ],
});
