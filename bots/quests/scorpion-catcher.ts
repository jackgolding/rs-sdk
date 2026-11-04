/**
 * Scorpion Catcher — Thormac's three lesser Kharid scorpions.
 *
 *   bun bots/quests/scorpion-catcher.ts {botname}
 *
 * Journal rules from quest_scorpcatcher/scripts/scorpcatcher_journal.rs2; the route is lib/scorpion-catcher.ts.
 * Gates: Prayer 31 (the monastery's order, scorpion C) and Alfred Grimhand's Barcrawl done (the Barbarian Outpost's
 * gate, scorpion B; bots/quests/barcrawl.ts). Scorpion A is behind the Dusty-key gate in Taverley dungeon: a
 * dragonfire/anti-dragon shield (Duke Horacio's when none is banked), a melee weapon and sharks. Teleports: Camelot
 * (Magic 45, 1 law + 5 air each) out of the dungeon after A and back west from the monastery after C; without the
 * runes it walks out under Protect from Melee. The journal reads the cage in the pack, so the cage is always carried.
 * Reward: 1 QP, Strength XP.
 */
import { runQuest } from './lib/run-quest';
import { CAGES, leaveSorcererTower, scorpionA, scorpionB, scorpionC, talkSeer, talkThormac, toCamelot } from './lib/scorpion-catcher';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `scorp:${id}`, kind, all, none },
});

const camelot = [
    { item: 'law rune', count: 1 },
    { item: 'air rune', count: 5 },
];

await runQuest({
    id: 'scorpcatcher',
    hub: 'seers',
    carry: CAGES,
    skills: { prayer: 31 },
    // One scorpion of each per world (npc_del on catch, 100-tick respawn): accounts in together wait on each other.
    maxConcurrent: 2,
    journal: { label: 'Scorpion Catcher', title: 'Scorpion Catcher' },
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
        stage('started', 'active', ['talk to the Seers about the lost']),
        stage('hint1', 'active', ['talk to a Seer again']),
        stage('hint2', 'active', ['The second Kharid Scorpion'], ['take the Kharid Scorpions to Thormac']),
        stage('caught', 'active', ['take the Kharid Scorpions to Thormac']),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        {
            from: 'unstarted',
            to: 'started',
            run: async (q) => {
                await talkThormac(q, [/what do you need assistance with/i, /what'?s in it for me/i, /ok,? i will do it then/i, /so how would i go about catching them/i, /i'?ve lost my cage/i]);
                await leaveSorcererTower(q);
            },
        },
        { from: 'started', to: 'hint1', run: (q) => talkSeer(q) },
        {
            from: 'hint1',
            to: 'hint2',
            // Taverley's inner dungeon: the Jailer, blue dragons (the shield), poison spiders, a lesser demon.
            // Two Camelot casts: out of the dungeon after A, and back west from the monastery after C.
            needs: [{ item: 'melee weapon', count: 1 }, { item: 'shark', count: 10 }, { item: 'dragonbreath shield', count: 1 }, { item: 'law rune', count: 2 }, { item: 'air rune', count: 10 }],
            run: async (q) => {
                await scorpionA(q);
                await talkSeer(q);
            },
        },
        {
            from: 'hint2',
            to: 'caught',
            needs: [{ item: 'shark', count: 3 }, ...camelot],
            run: async (q) => {
                await scorpionC(q);
                await toCamelot(q);
                await scorpionB(q);
            },
        },
        { from: 'caught', to: 'complete', run: (q) => talkThormac(q, []) },
    ],
});
