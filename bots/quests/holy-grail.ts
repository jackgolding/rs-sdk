/**
 * Holy Grail — King Arthur's quest after Merlin's Crystal.
 *
 *   bun bots/quests/holy-grail.ts {botname}
 *
 * Needs Merlin's Crystal (bots/quests/merlins-crystal.ts) and Attack 20 for Excalibur. Journal rules
 * from quest_grail/scripts/grail_journal.rs2; the route and the realm are lib/holy-grail.ts.
 * Stage 4 (the crone) goes straight to 8 (find Percival) when the Titan dies to Excalibur on the
 * first try: 7 ("I need to find a weapon") only shows after a fight without it.
 * Items: coins (Brimhaven fares, 500 for Excalibur when none is banked), sharks for the Titan.
 * Reward: 2 QP, Prayer and Defence XP.
 */
import { runQuest, type Quest } from './lib/run-quest';
import { ARTHUR, fetchGrail, freePercival, getNapkin, held, inRealm, OBJ, seeCrone, seeMerlin, toFisherKing } from './lib/holy-grail';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = [], optional = false) => ({
    id,
    rule: { id: `grail:${id}`, kind, all, none },
    ...(optional ? { optional } : {}),
});

/**
 * The Brimhaven fares and Excalibur's price. Food for the Titan comes out of the Draynor bank on the
 * way past (lib/holy-grail.ts getExcalibur): a need here would stop the run with NEEDS STOCK on
 * Entrana, where everything was banked for the monks.
 */
const realmKit = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    // Already in the realm: the fares are paid; re-sourcing coins there walked off to pickpocket.
    if (held(q, OBJ.grail) || (p && inRealm({ x: p.worldX, z: p.worldZ }))) return [];
    return [{ item: 'coins', count: 100 }];
};

await runQuest({
    id: 'grail',
    requires: ["Merlin's Crystal"],
    hub: 'seers',
    carry: [OBJ.napkin, OBJ.whistle, OBJ.excalibur, OBJ.grail, OBJ.bell],
    journal: { label: 'Holy Grail', title: 'Holy Grail' },
    // Excalibur for the Titan (levelrequire tier20).
    skills: { attack: 20 },
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
        stage('started', 'active', ['I should start my quest by speaking to']),
        stage('merlin', 'active', ['Merlin suggested two things']),
        stage('crone', 'active', ['According to a Crone on']),
        stage('titan', 'active', ['I need to find a weapon'], [], true),
        stage('percival', 'active', ['He has asked me to find his']),
        stage('whistled', 'active', ['I honoured the Fisher King'], ['QUEST COMPLETE']),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        { from: 'unstarted', to: 'started', at: ARTHUR, talk: { npc: /^king arthur$/i, choices: [/tell me of this quest/i, /i'?d enjoy trying that/i] } },
        { from: 'started', to: 'merlin', run: (q) => seeMerlin(q) },
        // Entrana: the monks search for weapons and armour; only coins go aboard.
        { from: 'merlin', to: 'crone', needs: [{ item: 'coins', count: 60 }], run: (q) => seeCrone(q) },
        {
            from: 'crone',
            to: 'percival',
            needs: realmKit,
            run: async (q) => {
                await getNapkin(q);
                await toFisherKing(q);
            },
        },
        { from: 'titan', to: 'percival', needs: realmKit, run: (q) => toFisherKing(q) },
        { from: 'percival', to: 'whistled', needs: realmKit, run: (q) => freePercival(q) },
        {
            from: 'whistled',
            to: 'complete',
            needs: realmKit,
            run: async (q) => {
                await fetchGrail(q);
                await q.talk(/^king arthur$/i, [], ARTHUR);
            },
        },
    ],
});
