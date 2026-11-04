/**
 * Horror from the Deep — Larrissa's lighthouse, Jossik, the Dagannoth and its mother.
 *
 *   bun bots/quests/horror-from-the-deep.ts {botname}
 *
 * Journal rules from quest_horror/scripts/horror_journal.rs2; the route is lib/horror.ts. Gates: Alfred Grimhand's
 * Barcrawl (the outpost gate to Gunnjorn; bots/quests/barcrawl.ts), Agility 35 (the course pipe), Magic 59 (Fire
 * Blast; the mother's elemental forms take only their own element), Prayer 40 (Protect from Missiles). Supplies: 2
 * planks (outpost spawns), 8 nails (mule), a hammer, swamp tar (Lumbridge swamp), molten glass (mule), a tinderbox,
 * a bronze dagger and a bronze arrow for the strange wall, blast runes (death runes from the mule; air/water/earth/fire
 * from Aubury), sharks, and 2 law + 10 air for Camelot Teleport out of the lighthouse. Reward: 2 QP, Magic/Strength/
 * Ranged XP, the casket.
 */
import { runQuest } from './lib/run-quest';
import * as horror from './lib/horror';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `horror:${id}`, kind, all, none },
});

const journal = { label: 'Horror from the Deep', title: 'Horror from the Deep' };
const stages = [
    stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
    stage('started', 'active', ['Larrissa is very worried']),
    // Both bridge halves planked: the journal strikes its line (@str@), which the prose rules cannot see.
    { id: 'bridged', rule: { id: 'horror:bridged', kind: 'active' as const, all: ['Larrissa is very worried'], none: [], rawAll: ['@str@(@[a-z]{3}@)*I need to repair the bridge'] } },
    stage('entered', 'active', ['repaired the bridge leading to Rellekka'], ['managed to repair the lighthouse light']),
    stage('repaired', 'active', ['search this place']),
    stage('dagjr', 'active', ['defeat these sea monsters']),
    stage('complete', 'complete', ['QUEST COMPLETE']),
];
type Sdk = Parameters<typeof readJournalCheckpoint>[0];
const passes = async (sdk: Sdk, id: string) => (await readJournalCheckpoint(sdk, journal, stages.find((s) => s.id === id)!.rule)).verdict?.verdict === 'PASS';
/** The journal's raw lines (colour tags kept): a struck line is the done half of the bridge/key. */
const rawJournal = async (sdk: Sdk) => (await readJournalCheckpoint(sdk, journal, stages[1]!.rule)).rawLines.map((l) => l.rawText).join('\n');

/** Camelot Teleport out of the lighthouse/caves (the epilogue; a resumed run's prologue casts one too). */
const camelot = [
    { item: 'law rune', count: 1 },
    { item: 'air rune', count: 5 },
];
/**
 * The torch's three parts. The tar and the glass are used up as they go in: a resumed run that already placed one
 * holds none, so each is asked for only while the account still has one anywhere (lib/horror.ts fixLight names any
 * part still missing at the cog).
 */
const light = (q: Parameters<NonNullable<Parameters<typeof runQuest>[0]['task']>>[0]) =>
    ['swamp tar', 'molten glass', 'tinderbox']
        .filter((item) => item === 'tinderbox' || q.count(item) > 0 || !!q.sdk.findBankItem(new RegExp(`^${item}$`, 'i')))
        .map((item) => ({ item, count: 1 }));
const wall = [
    { item: 'fire rune', count: 1 },
    { item: 'water rune', count: 1 },
    { item: 'earth rune', count: 1 },
    { item: 'bronze dagger', count: 1 },
    { item: 'bronze arrow', count: 1 },
];
/** Blasts for the mother (~10 casts per element form) plus the wall's and Camelot's runes. */
const fight = [
    { item: 'melee weapon', count: 1 },
    { item: 'shark', count: 10 },
    { item: 'death rune', count: 45 },
    { item: 'air rune', count: 200 },
    { item: 'water rune', count: 45 },
    { item: 'earth rune', count: 55 },
    { item: 'fire rune', count: 65 },
    { item: 'law rune', count: 1 },
];

await runQuest({
    id: 'horror',
    hub: 'seers',
    journal,
    carry: [horror.OBJ.key],
    skills: { agility: 35, magic: 59, prayer: 40 },
    // The Dagannoth and its mother are per player; Larrissa, Gunnjorn and the causeway are shared.
    maxConcurrent: 3,
    stages,
    transitions: [
        { from: 'unstarted', to: 'started', needs: camelot, run: (q) => horror.start(q) },
        {
            from: 'started',
            to: 'bridged',
            needs: [{ item: 'plank', count: 2 }, { item: 'nails', count: 8 }, { item: 'hammer', count: 1 }, ...camelot],
            run: async (q) => {
                const raw = await rawJournal(q.sdk);
                if (!/use the key I got from Gunnjorn/i.test(raw)) await horror.getKey(q);
                await horror.bridge(q, async () => /@str@(@[a-z]{3}@)*I need to repair the bridge/i.test(await rawJournal(q.sdk)));
            },
        },
        {
            from: 'bridged',
            to: 'entered',
            needs: camelot,
            run: async (q) => {
                try {
                    await horror.enterLighthouse(q);
                } catch (e) {
                    // A lost key with the door still locked: Gunnjorn hands out another.
                    if (q.sdk.getInventory().some((i) => i.id === horror.OBJ.key)) throw e;
                    q.log(`horror: ${(e as Error).message} — fetching the key again`);
                    await horror.getKey(q);
                    await horror.enterLighthouse(q);
                }
            },
        },
        { from: 'entered', to: 'repaired', needs: (q) => [...light(q), ...wall, ...fight], run: (q) => horror.fixLight(q) },
        { from: 'repaired', to: 'dagjr', needs: [...wall, ...fight], run: (q) => horror.killDagannoth(q, () => passes(q.sdk, 'dagjr')) },
        {
            from: 'dagjr',
            to: 'complete',
            needs: [{ item: 'melee weapon', count: 1 }, { item: 'death rune', count: 30 }, { item: 'law rune', count: 1 }],
            run: async (q) => {
                await horror.killMother(q, () => q.sdk.getInventory().some((i) => i.id === horror.OBJ.casket) || (q.sdk.getState()?.player?.worldZ ?? 0) > 9900);
                // Read the journal before leaving: run-quest checks the stage after this run, and Camelot comes in the epilogue.
                if (await passes(q.sdk, 'complete')) await horror.leaveHorror(q);
            },
        },
    ],
});
