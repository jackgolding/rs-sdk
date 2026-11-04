/**
 * Sea Slug — rescue Kent and Kennith from the slug-ridden fishing platform.
 *
 *   bun bots/quests/sea-slug.ts {botname}
 *
 * Journal rules from quest_seaslug/scripts/seaslug_journal.rs2; the platform, the island and the
 * torch are lib/sea-slug.ts. Firemaking 30 (the dry sticks). Items: swamp paste (Port Khazard's
 * general store, or the bank). Nothing fights. Reward: 1 QP, Fishing XP, oyster pearls.
 */
import { runQuest } from './lib/run-quest';
import { CAROLINE, HOLGART_SHORE, kickPanel, lightTorch, OBJ, rotateCrane, rowAshore, rowOut, seeKent, shoutKennith } from './lib/sea-slug';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `seaslug:${id}`, kind, all, none },
});

await runQuest({
    id: 'seaslug',
    hub: 'ardougne',
    carry: [OBJ.paste, OBJ.torchUnlit, OBJ.torchLit, OBJ.dry],
    skills: { firemaking: 30 },
    journal: { label: 'Sea Slug Quest', title: 'Sea Slug' },
    // Nothing is banked after the swamp paste, and from Kennith on the platform's Holgart rows only to
    // Kent's island (holgart_platform.rs2) and the island's not back until Kent is seen: a resumed run
    // carries on from where it stands (offshore or ashore) rather than walking to the bank.
    noHubAt: ['repaired', 'kennith', 'kent', 'torch', 'panel', 'path'],
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
        stage('started', 'active', ["He'll take me to the"]),
        stage('holgart', 'active', ['Swamp Paste'], ['ready to take me to']),
        stage('repaired', 'active', ['find Kent and Kennith']),
        stage('kennith', 'active', ['hiding behind some boxes'], ['found Kent on a small island']),
        stage('kent', 'active', ['I should find a way of lighting this damp torch'], ["won't go near the"]),
        stage('torch', 'active', ["won't go near the"], ['created an opening', 'Kennith can\'t get downstairs']),
        stage('panel', 'active', ['created an opening'], ['Kennith can\'t get downstairs']),
        stage('path', 'active', ["Kennith can't get downstairs"], ['used the Crane']),
        stage('saved', 'active', ['used the Crane'], ['QUEST COMPLETE']),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        { from: 'unstarted', to: 'started', at: CAROLINE, talk: { npc: /^caroline$/i, choices: [/i suppose so/i] } },
        { from: 'started', to: 'holgart', at: HOLGART_SHORE, talk: { npc: /^holgart$/i } },
        {
            from: 'holgart',
            to: 'repaired',
            // Port Khazard's general store (lib/sources.ts 'swamp paste'), bought in the prepare phase.
            needs: [{ item: 'swamp paste', count: 1 }],
            run: (q) => rowOut(q),
        },
        { from: 'repaired', to: 'kennith', run: (q) => shoutKennith(q) },
        { from: 'kennith', to: 'kent', run: (q) => seeKent(q, true) },
        { from: 'kent', to: 'torch', run: (q) => lightTorch(q) },
        { from: 'torch', to: 'panel', run: (q) => shoutKennith(q) },
        {
            from: 'panel',
            to: 'path',
            run: async (q) => {
                // 8 and 9 share a journal page: a kick at 9 does nothing, the shout moves both on.
                await kickPanel(q);
                await shoutKennith(q);
            },
        },
        { from: 'path', to: 'saved', run: (q) => rotateCrane(q) },
        {
            from: 'saved',
            to: 'complete',
            run: async (q) => {
                await rowAshore(q);
                await q.talk(/^caroline$/i, [], CAROLINE);
            },
        },
    ],
});
