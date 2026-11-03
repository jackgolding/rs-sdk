/**
 * Hazeel Cult — recover Sir Ceril Carnillean's armour and expose Butler Jones (the Carnilleans' side).
 *
 *   bun bots/quests/hazeel-cult.ts {botname}
 *
 * Journal rules from quest_hazeelcult/scripts/hazeelcult_journal.rs2 (the good side's lines; an
 * account that already sided with the cult reads differently and is not handled). Mechanics in
 * lib/hazeel-cult.ts. No items needed; Alomone is level 13. Reward: 1 QP, Thieving XP, 2000 coins.
 */
import { runQuest, type Quest } from './lib/run-quest';
import { CERIL, hasArmour, inCultCave, killAlomone, leaveCave, refuseClivet, returnArmour, searchCupboard, setValves } from './lib/hazeel-cult';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = [], optional = false) => ({
    id,
    rule: { id: `hazeelcult:${id}`, kind, all, none },
    ...(optional ? { optional } : {}),
});

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0 };
};

function completed(q: Quest): () => boolean {
    const since = Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
    return () => (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > since && /quest complete|completed the/i.test(m.text));
}

await runQuest({
    id: 'hazeelcult',
    hub: 'ardougne',
    carry: ['carnillean armour'],
    journal: { label: 'Hazeel Cult', title: 'Hazeel Cult' },
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by talking to']),
        stage('started', 'active', ['live in a cave']),
        // Passed through inside Clivet's one talk (3 then 4); seen only when a run stopped between.
        stage('clivet', 'active', ['I was still no closer'], ['find a way to follow', 'I managed to enter the hideout', 'told me the truth'], true),
        stage('follow', 'active', ['find a way to follow']),
        stage('armour', 'active', ['I should return'], ['QUEST COMPLETE']),
        stage('evidence', 'active', ['I have to find some'], ['QUEST COMPLETE']),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        { from: 'unstarted', to: 'started', at: CERIL, talk: { npc: /^ceril carnillean$/i, choices: [/what'?s wrong/i, /yes,? of course,? i'?d be happy to help/i] } },
        // Clivet's first talk only moves the stage to 3; the refusal is a second choice in the same talk.
        { from: 'started', to: 'follow', run: (q) => refuseClivet(q) },
        { from: 'clivet', to: 'follow', run: (q) => refuseClivet(q) },
        {
            from: 'follow',
            to: 'armour',
            run: async (q) => {
                try {
                    await setValves(q);
                    await killAlomone(q);
                } finally {
                    if (inCultCave(pos(q))) await leaveCave(q);
                }
            },
        },
        {
            from: 'armour',
            to: 'evidence',
            run: async (q) => {
                if (!hasArmour(q)) {
                    // Lost on the way (a resumed run banks it; `carry` takes it back out).
                    await killAlomone(q);
                    await leaveCave(q);
                }
                await returnArmour(q);
            },
        },
        { from: 'evidence', to: 'complete', run: (q) => searchCupboard(q, completed(q)) },
    ],
});
