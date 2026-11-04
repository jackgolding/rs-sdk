/**
 * Watchtower — the Yanille Watchtower's four stolen crystals: the Feldip ogres' relic, Gu'Tanoth's
 * riddle, the skavid caves and the ogre shamans.
 *
 *   bun bots/quests/watchtower.ts {botname}
 *
 * Journal rules from quest_itwatchtower/scripts/itwatchtower_journal.rs2; the route is lib/watchtower.ts.
 * Skill gates (journal): Magic 14 (the potion), Mining 40 (the Rock of Dalgroth), Herblore 14 (the
 * potion), Agility 25 (rope swings), Thieving 15 (listed only: the rock cake is not needed via the west
 * gate). Gorad is level 68 and the enclave holds level-81 chieftains: a melee weapon and sharks.
 * Supplies: a rope (Grew's island), a dragon bone (Toban), a death rune (the riddle), guam leaf, vial of
 * water, pestle and mortar, a pickaxe. Reward: 4 QP, 5000 coins, Magic XP, the Watchtower Teleport.
 */
import { runQuest } from './lib/run-quest';
import * as wt from './lib/watchtower';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = [], optional = false) => ({
    id,
    rule: { id: `itwatchtower:${id}`, kind, all, none },
    ...(optional ? { optional } : {}),
});

const journal = { label: 'Watch Tower', title: 'Watch Tower' };
const fight = [{ item: 'melee weapon', count: 1 }, { item: 'shark', count: 8 }];
const O = wt.OBJ;

const stages = [
    stage('unstarted', 'unstarted', ['I can start this quest by speaking to the']),
    stage('started', 'active', ['I accepted the challenge of finding the lost']),
    // 2 and 3 (the relic made) share a page: 3 is passed through within the 'tribes' transition.
    stage('tribes', 'active', ['deal with the tribal ogres']),
    stage('relic', 'active', ['I gave the ogre relic to the north west guard']),
    stage('riddle', 'active', ['Some guards gave me a']),
    stage('map', 'active', ["I have solved the guard's puzzle"]),
    stage('crystal2', 'active', ['I have been told that the other crystals are in the']),
    stage('enclave', 'active', ['I used some cave nightshade to distract the guard']),
    stage('lesson', 'active', ['I tried to defeat the shamans, but they are protected']),
    stage('potion', 'active', ['He infused it into a magic ogre potion']),
    stage('crystals', 'active', ['I have taken the crystals to the Watchtower wizard']),
    stage('complete', 'complete', ['QUEST COMPLETE']),
];
const passes = async (sdk: Parameters<typeof readJournalCheckpoint>[0], id: string) =>
    (await readJournalCheckpoint(sdk, journal, stages.find((s) => s.id === id)!.rule)).verdict?.verdict === 'PASS';

await runQuest({
    id: 'itwatchtower',
    hub: 'yanille',
    journal,
    carry: [O.relic, O.part1, O.part2, O.part3, O.tooth, O.key, O.gold, O.map, O.crystal1, O.crystal2, O.crystal3, O.crystal4, O.nightshade, O.groundBones, O.guamvial, O.guamjanger, O.potion, O.magicPotion, O.litCandle, 'jangerberries', 'bat bones', O.fingernails],
    skills: { magic: 14, mining: 40, herblore: 14, agility: 25, thieving: 15 },
    // Gorad, the mad skavid and the six shamans are single spawns.
    maxConcurrent: 1,
    stages,
    transitions: [
        { from: 'unstarted', to: 'started', run: (q) => wt.start(q) },
        { from: 'started', to: 'tribes', run: (q) => wt.fingernails(q) },
        {
            from: 'tribes',
            to: 'relic',
            needs: (q) => [
                ...fight,
                ...(q.count(/^ogre relic$/i) || q.count(/^relic part 3$/i) ? [] : [{ item: 'dragon bones', count: 1 }]),
                ...(q.count(/^ogre relic$/i) || q.count(/^relic part 2$/i) ? [] : [{ item: 'rope', count: q.count(/^ogre tooth$/i) ? 1 : 2 }]),
            ],
            run: async (q) => {
                await wt.relicParts(q);
                await wt.relicToGuard(q, () => passes(q.sdk, 'relic'));
            },
        },
        { from: 'relic', to: 'riddle', needs: [{ item: 'coins', count: 100 }], run: (q) => wt.cityGuardRiddle(q) },
        { from: 'riddle', to: 'map', needs: [{ item: 'death rune', count: 1 }, { item: 'coins', count: 20 }], run: (q) => wt.deathRuneToGuard(q) },
        { from: 'map', to: 'crystal2', needs: [...fight, { item: 'gold bar', count: 1 }], run: (q) => wt.skavidCaves(q, () => false) },
        {
            from: 'crystal2',
            to: 'enclave',
            needs: fight,
            run: async (q) => {
                await wt.enclaveFirst(q);
            },
        },
        { from: 'enclave', to: 'lesson', run: (q) => wt.potionLesson(q) },
        {
            from: 'lesson',
            to: 'potion',
            needs: (q) =>
                q.count(/^potion$/i) || q.count(/^magic ogre potion$/i)
                    ? []
                    : [
                          { item: 'guam leaf', count: 1 },
                          { item: 'vial of water', count: 1 },
                          { item: 'pestle and mortar', count: 1 },
                      ],
            run: (q) => wt.enchantPotion(q),
        },
        {
            from: 'potion',
            to: 'crystals',
            needs: [...fight, { item: 'pickaxe', count: 1 }],
            run: async (q) => {
                if (!(q.count(/^crystal$/i) >= 4)) await wt.shamans(q);
                await wt.crystalsToWizard(q);
            },
        },
        { from: 'crystals', to: 'complete', run: (q) => wt.pullLever(q) },
    ],
});
