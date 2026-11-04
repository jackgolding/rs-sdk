/**
 * Gertrude's Cat — find Fluffs in the lumber mill, feed her, return her kitten.
 *
 *   bun bots/quests/gertrudes-cat.ts {botname}
 *
 * Journal rules from quest_fluffs/scripts/fluffs_journal.rs2; the mill and the supplies are
 * lib/gertrudes-cat.ts. No skill gates. Items: 100 coins for the boys, a bucket of milk (a bucket and
 * the cows), a seasoned sardine (doogle leaves + Gerrant's raw sardine). Reward: 1 QP, Cooking XP, a
 * kitten, chocolate cake and stew.
 */
import { runQuest } from './lib/run-quest';
import { BOYS, feedFluffs, findKitten, GERTRUDE, getMilk, getSeasonedSardine, held, leaveMill, OBJ } from './lib/gertrudes-cat';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `fluffs:${id}`, kind, all, none },
});

await runQuest({
    id: 'fluffs',
    hub: 'varrock-west',
    carry: [OBJ.milk, OBJ.seasoned, OBJ.kitten, OBJ.doogle, OBJ.sardine],
    journal: { label: "Gertrude's Cat", title: "Gertrude's Cat" },
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by talking to']),
        stage('started', 'active', ['speak to Shilop and Wilough']),
        stage('paid', 'active', ['go to their play area']),
        stage('milk', 'active', ['get her to follow me home'], ['milk and sardines']),
        stage('sardine', 'active', ['milk and sardines'], ['kitten back']),
        stage('rescued', 'active', ['She ran off home']),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        { from: 'unstarted', to: 'started', at: GERTRUDE, talk: { npc: /^gertrude$/i, choices: [/well,? i suppose i could/i] } },
        {
            from: 'started',
            to: 'paid',
            needs: [{ item: 'coins', count: 150 }],
            at: BOYS,
            talk: { npc: /^shilop$/i, choices: [/what will make you tell me/i, /okay then,? i'?ll pay/i] },
        },
        {
            from: 'paid',
            to: 'milk',
            needs: [{ item: 'coins', count: 50 }],
            run: async (q) => {
                // Both supplies before the mill: the sardine is only accepted after the milk.
                await getMilk(q);
                await getSeasonedSardine(q);
                await feedFluffs(q, OBJ.milk, () => !held(q, OBJ.milk), 'gave Fluffs the milk');
            },
        },
        {
            from: 'milk',
            to: 'sardine',
            needs: [{ item: 'coins', count: 50 }],
            run: async (q) => {
                await getSeasonedSardine(q);
                await feedFluffs(q, OBJ.seasoned, () => !held(q, OBJ.seasoned), 'gave Fluffs the sardine');
            },
        },
        {
            from: 'sardine',
            to: 'rescued',
            run: async (q) => {
                await findKitten(q);
                await feedFluffs(q, OBJ.kitten, () => !held(q, OBJ.kitten), 'gave Fluffs her kitten');
            },
        },
        {
            from: 'rescued',
            to: 'complete',
            run: async (q) => {
                await leaveMill(q);
                await q.talk(/^gertrude$/i, [], GERTRUDE);
                await q.sdk.waitForTicks(8);
            },
        },
    ],
});
