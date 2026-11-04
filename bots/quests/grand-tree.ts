/**
 * The Grand Tree — King Narnode's dying tree, Glough's plot and the Daconia rock.
 *
 *   bun bots/quests/grand-tree.ts {botname}
 *
 * Journal rules from quest_grandtree/scripts/grandtree_journal.rs2; the route is lib/grand-tree.ts.
 * Agility 25 (the tree in Glough's house); a level 172 black demon, so a melee weapon and 10 sharks come
 * out of the bank, and Protect from Melee goes up at Prayer 43. Items: coins (Femi's cart 1000 when her boxes were declined, the Karamja boat home).
 * Reward: 5 QP, Attack/Agility/Magic XP.
 */
import { runQuest } from './lib/run-quest';
import {
    femiCart,
    fightDemon,
    findDaconia,
    getPlans,
    leaveShipyard,
    OBJ,
    placeTwigs,
    searchCupboard,
    seeHazelmere,
    talkCharlie,
    talkGlough,
    escapeJail,
    talkNarnode,
    toShipyardForeman,
    TRANSLATION,
} from './lib/grand-tree';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `grandtree:${id}`, kind, all, none },
});

const coins = [{ item: 'coins', count: 1100 }];
// 18: ten ran out at hp 7 on jacklove4 even with Prayer 78 (2026-11-04); the demon hits through when prayer drains.
const fight = [{ item: 'melee weapon', count: 1 }, { item: 'shark', count: 18 }];

await runQuest({
    id: 'grandtree',
    hub: 'ardougne',
    carry: Object.values(OBJ),
    skills: { agility: 25 },
    journal: { label: 'The Grand Tree', title: 'The Grand Tree' },
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest at the']),
        stage('started', 'active', ['Narnode gave me']),
        stage('hazelmere', 'active', ['need to give the message to']),
        stage('relayed', 'active', ['The King wants me to tell']),
        stage('glough', 'active', ['Maybe I should have a chat with']),
        stage('prisoner', 'active', ['the prisoner at']),
        stage('charlie', 'active', ['agreed to search'], ["found Glough's journal", 'threw me in prison']),
        stage('journal', 'active', ["found Glough's journal"], ['threw me in prison']),
        stage('released', 'active', ['to use the glider']),
        stage('order', 'active', ['more proof of Glough'], ['Anita']),
        stage('clue', 'active', ['has suggested I ask']),
        stage('plans', 'active', ['see what he says']),
        stage('twigs', 'active', ["isn't convinced but gave me"]),
        stage('trapdoor', 'active', ["investigate what's behind the"]),
        stage('demon', 'active', ['He should be in these caves somewhere']),
        stage('daconia', 'active', ['has seen the light'], ['QUEST COMPLETE']),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        { from: 'unstarted', to: 'started', run: (q) => talkNarnode(q, [/you seem worried/i, /i'?d be happy to help/i]).then(() => undefined) },
        { from: 'started', to: 'hazelmere', run: (q) => seeHazelmere(q) },
        { from: 'hazelmere', to: 'relayed', run: (q) => talkNarnode(q, TRANSLATION).then(() => undefined) },
        { from: 'relayed', to: 'glough', run: (q) => talkGlough(q).then(() => undefined) },
        { from: 'glough', to: 'prisoner', run: (q) => talkNarnode(q, []).then(() => undefined) },
        { from: 'prisoner', to: 'charlie', run: (q) => talkCharlie(q) },
        { from: 'charlie', to: 'journal', run: (q) => searchCupboard(q) },
        // Glough cages us; Charlie talks, then Narnode lets us out (one dialog).
        {
            from: 'journal',
            to: 'released',
            run: async (q) => {
                await talkGlough(q);
                // If the cage dialogs did not run to Narnode's release, talk to Charlie from the cell.
                await escapeJail(q);
            },
        },
        { from: 'released', to: 'order', needs: coins, run: (q) => toShipyardForeman(q) },
        {
            from: 'order',
            to: 'clue',
            needs: coins,
            run: async (q) => {
                await leaveShipyard(q);
                await femiCart(q);
                await talkCharlie(q);
            },
        },
        { from: 'clue', to: 'plans', run: (q) => getPlans(q) },
        { from: 'plans', to: 'twigs', run: (q) => talkNarnode(q, []).then(() => undefined) },
        { from: 'twigs', to: 'trapdoor', run: (q) => placeTwigs(q) },
        { from: 'trapdoor', to: 'demon', needs: fight, run: (q) => fightDemon(q) },
        { from: 'demon', to: 'daconia', run: (q) => talkNarnode(q, []).then(() => undefined) },
        {
            from: 'daconia',
            to: 'complete',
            run: async (q) => {
                await findDaconia(q);
                await talkNarnode(q, []);
            },
        },
    ],
});
