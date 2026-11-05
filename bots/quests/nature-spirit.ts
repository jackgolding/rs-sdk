/**
 * Nature Spirit — Filliman Tarlock's ghost in Mort Myre, made a nature spirit, and three ghasts.
 *
 *   bun bots/quests/nature-spirit.ts {botname}
 *
 * Journal rules from quest_druidspirit/scripts/druidspirit_journal.rs2; the route is lib/nature-spirit.ts.
 * Prerequisites: Priest in Peril (Drezel at 60/61 — the holy barrier), The Restless Ghost (its amulet of ghostspeak,
 * worn for Filliman). Stock: a silver sickle (Crafting 18: silver bar + sickle mould; mule/bank stock, no source here)
 * and the amulet. A melee weapon for the ghasts (they rot carried food and drain hp until the pouch shows them). Prayer > 0 for the blessed sickle's blooms. Reward: 2 QP, Crafting/Hitpoints/Defence XP, the blessed sickle.
 */
import { runQuest } from './lib/run-quest';
import * as ns from './lib/nature-spirit';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = [], optional = false) => ({
    id,
    rule: { id: `ns:${id}`, kind, all, none },
    ...(optional ? { optional } : {}),
});

const journal = { label: 'Nature Spirit', title: 'Nature Spirit' };
const stages = [
    stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
    stage('started', 'active', ['agreed to look for a Druid called Filliman'], ['found a spirit in the swamp']),
    stage('failed', 'active', ["I can't really communicate with this"], [], true),
    stage('spoken', 'active', ['I think I need to convince this poor fellow']),
    stage('mirror', 'active', ['Filliman is looking for his journal'], ["I've given Filliman his journal"], true),
    stage('journal', 'active', ['with his plan'], ['agreed to help Filliman become'], true),
    stage('spell', 'active', ['spell but I need to be'], ['been blessed at the temple']),
    stage('blessed', 'active', ['been blessed at the temple by Drezel'], ["I've cast the bloom spell"]),
    stage('cast', 'active', ["I've cast the bloom spell in the swamp"], ['collected a Mort Myre Fungi'], true),
    stage('fungi', 'active', ['I collected a Mort Myre Fungi'], ['to get all the required items']),
    stage('ritual', 'active', ['asked me to meet him in his'], ['entered Fillimans grotto']),
    stage('grotto', 'active', ['entered Fillimans grotto'], ['turned into a nature spirit'], true),
    // Passed through in one grotto visit (the transformation, then the sickle) when the sickle is held.
    stage('transform', 'active', ['turned into a nature spirit'], ['blessed the silver sickle'], true),
    stage('sickle', 'active', ['blessed the silver sickle for me'], ['I cast the bloom spell in the swamp']),
    stage('bloom', 'active', ['natures bounty'], [], true),
    stage('picked', 'active', ['perhaps this'], [], true),
    // A ghast can attack (and die) before the journal is read after the pouch fills.
    stage('pouch', 'active', ['asked me to kill three ghasts'], ["I've killed"], true),
    stage('ghast1', 'active', ["I've killed one ghast"], [], true),
    stage('ghast2', 'active', ["I've killed two ghasts now"], ['killed three ghasts now'], true),
    stage('ghast3', 'active', ["I've killed three ghasts now"]),
    stage('complete', 'complete', ['QUEST COMPLETE']),
];
type Sdk = Parameters<typeof readJournalCheckpoint>[0];
const passes = async (sdk: Sdk, id: string) => (await readJournalCheckpoint(sdk, journal, stages.find((s) => s.id === id)!.rule)).verdict?.verdict === 'PASS';
const anyPasses = async (sdk: Sdk, ids: string[]) => {
    for (const id of ids) if (await passes(sdk, id)) return true;
    return false;
};
const after = (id: string) => stages.slice(stages.findIndex((s) => s.id === id)).map((s) => s.id);
const O = ns.OBJ;

const amulet = { item: 'ghostspeak amulet', count: 1 };
const sickle = { item: 'silver sickle', count: 1 };
// No food in the needs: ghasts rot whatever food is carried until the pouch is filled (ghast.rs2), so a counted food
// need would read as missing stock mid-run. Drezel's six pies are eaten if hp runs low.
const fight = [{ item: 'melee weapon', count: 1 }];

await runQuest({
    id: 'druidspirit',
    hub: 'varrock-east',
    journal,
    carry: [O.mirror, O.journal, O.spell, O.usedSpell, O.fungus, O.sickleBlessed, O.pouchEmpty, O.pouch, O.pear, O.stem],
    // Filliman's spirit and the bloom locs are per world: two accounts at the camp trip over each other.
    maxConcurrent: 2,
    stages,
    transitions: [
        { from: 'unstarted', to: 'started', needs: [amulet, sickle], run: (q) => ns.start(q, () => anyPasses(q.sdk, after('started'))) },
        { from: 'started', to: 'spoken', needs: [amulet, sickle, ...fight], run: (q) => ns.meetSpirit(q) },
        { from: 'failed', to: 'spoken', needs: [amulet, sickle, ...fight], run: (q) => ns.meetSpirit(q) },
        { from: 'spoken', to: 'spell', needs: [amulet, sickle, ...fight], run: (q) => ns.convinceSpirit(q, () => anyPasses(q.sdk, after('mirror'))) },
        { from: 'mirror', to: 'spell', needs: [amulet, sickle, ...fight], run: (q) => ns.convinceSpirit(q, async () => true) },
        { from: 'journal', to: 'spell', needs: [amulet, sickle, ...fight], run: (q) => ns.convinceSpirit(q, async () => true) },
        { from: 'spell', to: 'blessed', needs: [amulet, sickle, ...fight], run: (q) => ns.bless(q, () => anyPasses(q.sdk, after('blessed'))) },
        { from: 'blessed', to: 'fungi', needs: [amulet, sickle, ...fight], run: (q) => ns.fungus(q) },
        { from: 'cast', to: 'fungi', needs: [amulet, sickle, ...fight], run: (q) => ns.fungus(q) },
        { from: 'fungi', to: 'ritual', needs: [amulet, sickle, ...fight], run: (q) => ns.ritual(q, () => anyPasses(q.sdk, after('ritual'))) },
        {
            from: 'ritual',
            to: 'sickle',
            needs: [amulet, sickle, ...fight],
            run: (q) =>
                ns.grotto(q, async () => ((await passes(q.sdk, 'transform')) ? 'transform' : 'other')),
        },
        {
            from: 'grotto',
            to: 'sickle',
            needs: [amulet, sickle, ...fight],
            run: (q) => ns.grotto(q, async () => ((await passes(q.sdk, 'transform')) ? 'transform' : 'other')),
        },
        { from: 'transform', to: 'sickle', needs: [amulet, sickle, ...fight], run: (q) => ns.grotto(q, async () => 'transform') },
        { from: 'sickle', to: 'pouch', needs: [amulet, ...fight, { item: 'prayer potion', count: 2 }], run: (q) => ns.fillPouch(q) },
        { from: 'bloom', to: 'pouch', needs: [amulet, ...fight, { item: 'prayer potion', count: 2 }], run: (q) => ns.fillPouch(q) },
        { from: 'picked', to: 'pouch', needs: [amulet, ...fight, { item: 'prayer potion', count: 2 }], run: (q) => ns.fillPouch(q) },
        {
            from: 'pouch',
            to: 'ghast3',
            needs: [amulet, ...fight],
            run: (q) =>
                ns.ghasts(q, async () => ((await passes(q.sdk, 'ghast3')) ? 3 : (await passes(q.sdk, 'ghast2')) ? 2 : (await passes(q.sdk, 'ghast1')) ? 1 : 0)),
        },
        { from: 'ghast1', to: 'ghast3', needs: [amulet, ...fight], run: (q) => ns.ghasts(q, async () => 1) },
        { from: 'ghast2', to: 'ghast3', needs: [amulet, ...fight], run: (q) => ns.ghasts(q, async () => 2) },
        { from: 'ghast3', to: 'complete', needs: [amulet], run: (q) => ns.finish(q, () => passes(q.sdk, 'complete')) },
    ],
});
