/**
 * Fishing Contest — win the Hemenster trophy for the Mountain Dwarf.
 *
 *   bun bots/quests/fishing-contest.ts {botname}
 *
 * Journal rules from quest_fishingcompo/scripts/fishingcompo_journal.rs2; dialog from
 * area_white_wolf_mountain/scripts/mountain_dwarf.rs2 and hemenster/bonzo.rs2; the yard, the pipe
 * and the vines are lib/fishing-contest.ts. Fishing 10 to catch anything.
 * Items (lib/sources.ts): garlic (Morgan's cupboard, Draynor), a spade (Draynor Manor), a fishing
 * rod (Gerrant), three red vine worms (dug in McGrubor's Wood with the spade), 5 coins for Bonzo.
 * The pass is the dwarves' (a spare from them if lost). Reward: 1 QP, Fishing XP, the dwarf tunnel.
 */
import { runQuest, type Quest } from './lib/run-quest';
import { enterContest, enterRound, fishCarp, inContest, leaveContest, stashGarlic } from './lib/fishing-contest';

/** The Catherby-side tunnel dwarf (npc spawns 2820-2821,3487). */
const DWARF = { x: 2820, z: 3487 };

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = [], optional = false) => ({
    id,
    rule: { id: `fishingcompo:${id}`, kind, all, none },
    ...(optional ? { optional } : {}),
});

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0 };
};
const hasTrophy = (q: Quest) => q.count(/^fishing trophy$/i) > 0;

/** Pass in hand (a spare from the dwarf if lost) and into the yard. */
async function intoYard(q: Quest): Promise<void> {
    if (inContest(pos(q))) return;
    if (q.count(/^fishing pass$/i) < 1) await q.talk(/^mountain dwarf$/i, [/i need another competition pass/i], DWARF);
    await enterContest(q);
}

const catchKit = [
    { item: 'fishing rod', count: 1 },
    { item: 'red vine worm', count: 3 },
];

await runQuest({
    id: 'fishingcompo',
    hub: 'seers',
    // One pipes' spot, one stranger: a run's garlic moves him for everyone fishing then.
    maxConcurrent: 2,
    carry: ['fishing pass', 'fishing trophy'],
    skills: { fishing: 10 },
    journal: { label: 'Fishing Contest', title: 'Fishing Contest' },
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
        stage('started', 'active', ['They gave me a']),
        // Seated by the willow (no garlic stashed before Bonzo seated us): garlic now moves the stranger.
        stage('willow', 'active', ['next to the willow tree'], [], true),
        stage('pipes', 'active', ['next to the pipes']),
        stage('won', 'active', ['I easily won the contest']),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        {
            from: 'unstarted',
            to: 'started',
            at: DWARF,
            needs: [{ item: 'garlic', count: 1 }, { item: 'coins', count: 5 }, ...catchKit],
            talk: {
                npc: /^mountain dwarf$/i,
                choices: [
                    /what was down those stairs/i,
                    /^why not\??$/i,
                    /if you were my friend/i,
                    /well,? let'?s be friends/i,
                    /how am i meant to do that/i,
                    /fortunately i'?m alright at fishing/i,
                ],
            },
        },
        {
            from: 'started',
            to: 'pipes',
            needs: [{ item: 'garlic', count: 1 }, { item: 'coins', count: 5 }, ...catchKit],
            run: async (q) => {
                await intoYard(q);
                // Stashed first, Bonzo's seating moves the stranger at once (bonzo_set_places).
                await stashGarlic(q);
                await enterRound(q);
            },
        },
        {
            from: 'willow',
            to: 'pipes',
            needs: [{ item: 'garlic', count: 1 }, ...catchKit],
            run: async (q) => {
                await intoYard(q);
                await stashGarlic(q);
            },
        },
        {
            from: 'pipes',
            to: 'won',
            needs: catchKit,
            run: async (q) => {
                await intoYard(q);
                await fishCarp(q, () => hasTrophy(q));
            },
        },
        {
            from: 'won',
            to: 'complete',
            run: async (q) => {
                if (inContest(pos(q))) await leaveContest(q);
                // Lost the trophy: Bonzo keeps a spare for the champ.
                if (!hasTrophy(q)) {
                    await intoYard(q);
                    await q.talk(/^bonzo$/i, []);
                    await leaveContest(q);
                }
                await q.talk(/^mountain dwarf$/i, [/yes i have/i], DWARF);
            },
        },
    ],
});
