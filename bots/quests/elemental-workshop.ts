/**
 * Elemental Workshop I — the battered book's workshop under the Seers' smithy, and its Elemental shield.
 *
 *   bun bots/quests/elemental-workshop.ts {botname}
 *
 * Journal rules from quest_elemental_workshop/scripts/elemental_workshop_journal.rs2; the route is
 * lib/elemental-workshop.ts. Skill gates: Crafting 20 (bellows), Mining 20 (the elemental rock; 30 if the coal is
 * mined), Smithing 20 (workbench). Supplies: a knife, thread, a hammer, a pickaxe, 4 coal (mined at the Coal Trucks
 * when none is banked), a melee weapon and a few sharks for the earth elemental (35 hp). The needle and leather come
 * from the workshop's boxes. Reward: 1 QP, Crafting and Smithing XP, the Elemental shield.
 */
import { runQuest } from './lib/run-quest';
import * as ew from './lib/elemental-workshop';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = [], optional = false) => ({
    id,
    rule: { id: `ew:${id}`, kind, all, none },
    ...(optional ? { optional } : {}),
});

const journal = { label: 'Elemental Workshop', title: 'Elemental Workshop' };
const stages = [
    stage('unstarted', 'unstarted', ['I can start this quest by reading a']),
    stage('read', 'active', ['battered book in a house'], ['Cutting open the spine']),
    stage('slashed', 'active', ['Cutting open the spine'], ['secret door in the Seers Village smithy']),
    stage('entered', 'active', ['secret door in the Seers Village smithy'], ['waterwheel in the northern water']),
    stage('water', 'active', ['waterwheel in the northern water'], ['bellows in the eastern air area are now fixed']),
    stage('bellows', 'active', ['bellows in the eastern air area are now fixed'], ['lit the furnace with lava'], true),
    stage('furnace', 'active', ['lit the furnace with lava'], ['made a bar from the elemental ore']),
    stage('bar', 'active', ['made a bar from the elemental ore']),
    stage('complete', 'complete', ['QUEST COMPLETE']),
];
const passes = async (sdk: Parameters<typeof readJournalCheckpoint>[0], id: string) =>
    (await readJournalCheckpoint(sdk, journal, stages.find((s) => s.id === id)!.rule)).verdict?.verdict === 'PASS';
const O = ew.OBJ;

const fight = [
    { item: 'melee weapon', count: 1 },
    { item: 'shark', count: 4 },
    { item: 'pickaxe', count: 1 },
];
const smelt = [{ item: 'coal', count: 4 }];

await runQuest({
    id: 'elemental_workshop',
    hub: 'seers',
    journal,
    carry: [O.book, O.key, O.bowl, O.bowlFull, O.ore, O.bar],
    skills: { crafting: 20, mining: 20, smithing: 20 },
    // The workshop's levers and valves are per player (varbits); the rock's elemental is spawned per player.
    maxConcurrent: 3,
    stages,
    transitions: [
        { from: 'unstarted', to: 'read', run: (q) => ew.findBook(q) },
        { from: 'read', to: 'slashed', needs: [{ item: 'knife', count: 1 }], run: (q) => ew.slashBook(q) },
        {
            from: 'slashed',
            to: 'entered',
            needs: [...fight, ...smelt, { item: 'thread', count: 1 }, { item: 'hammer', count: 1 }],
            run: (q) => ew.enterWorkshop(q),
        },
        {
            from: 'entered',
            to: 'water',
            needs: [...fight, ...smelt, { item: 'thread', count: 1 }, { item: 'hammer', count: 1 }],
            run: async (q) => {
                await ew.enterWorkshop(q);
                await ew.startWater(q);
            },
        },
        {
            from: 'water',
            to: 'furnace',
            needs: [...fight, ...smelt, { item: 'thread', count: 1 }, { item: 'hammer', count: 1 }],
            run: async (q) => {
                await ew.enterWorkshop(q);
                await ew.elementalOre(q);
                await ew.bellowsAndFurnace(q);
            },
        },
        {
            from: 'bellows',
            to: 'furnace',
            needs: [...fight, ...smelt, { item: 'hammer', count: 1 }],
            run: async (q) => {
                await ew.enterWorkshop(q);
                await ew.elementalOre(q);
                await ew.bellowsAndFurnace(q);
            },
        },
        {
            from: 'furnace',
            to: 'bar',
            needs: [...fight, ...smelt, { item: 'hammer', count: 1 }],
            run: async (q) => {
                await ew.enterWorkshop(q);
                await ew.elementalOre(q);
                await ew.smeltBar(q);
            },
        },
        {
            from: 'bar',
            to: 'complete',
            needs: [{ item: 'hammer', count: 1 }],
            run: async (q) => {
                await ew.enterWorkshop(q);
                await ew.makeShield(q, () => passes(q.sdk, 'complete'));
            },
        },
    ],
});
