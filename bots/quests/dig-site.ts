/**
 * The Dig Site — three Earth Science exams, the expert's talisman, the shafts' explosive and the Zarosian tablet.
 *
 *   bun bots/quests/dig-site.ts {botname}
 *
 * Journal rules from quest_itexam/scripts/itexam_journal.rs2; the route is lib/dig-site.ts. Skill gates (journal):
 * Thieving 25 (pickpocketing a workman), Agility 10 (the winches), Herblore 10 (the mixes). Supplies: a cup of tea,
 * a cut opal, two ropes, an empty vial, charcoal, a pestle and mortar, a tinderbox. Reward: 2 QP, Mining and
 * Herblore XP, two gold bars.
 */
import { runQuest } from './lib/run-quest';
import * as dig from './lib/dig-site';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `itexam:${id}`, kind, all, none },
});

const journal = { label: 'Digsite Quest', title: 'The Dig Site' };
const stages = [
    stage('unstarted', 'unstarted', ['I can start this quest by speaking to the Examiner']),
    stage('letter', 'active', ['has given me to the Curator of the Varrock Museum']),
    stage('exam1', 'active', ['I need to study for my first exam']),
    stage('exam2', 'active', ['I need to study for my second exam']),
    stage('exam3', 'active', ['I need to study for my third exam']),
    stage('expert', 'active', ['I need a find from the site to impress the archeological expert at the Exam Centre']),
    stage('permit', 'active', ['I need to find a way to move the rocks blocking the way in the shaft']),
    stage('poured', 'active', ['I need to ignite the explosive compound and blow up the rocks blocking the way']),
    stage('blown', 'active', ['I should look for an interesting find in the secret room I found, and show it to']),
    stage('complete', 'complete', ['QUEST COMPLETE']),
];
const passes = async (sdk: Parameters<typeof readJournalCheckpoint>[0], id: string) =>
    (await readJournalCheckpoint(sdk, journal, stages.find((s) => s.id === id)!.rule)).verdict?.verdict === 'PASS';
const O = dig.OBJ;

await runQuest({
    id: 'itexam',
    hub: 'varrock-west',
    journal,
    carry: [O.letter, O.stamped, O.s1, O.s2, O.s3, O.brush, O.trowel, O.tray, O.trayMud, O.jar, O.talisman, O.scroll, O.liquid, O.nitro, O.key, O.powder, O.nitrate, O.pre, O.ground, O.post, O.root, O.compound, O.tablet, O.cert2, O.cert3],
    skills: { thieving: 25, agility: 10, herblore: 10 },
    // The students and workmen are shared; the panning tray and talisman soil are per player.
    maxConcurrent: 2,
    stages,
    transitions: [
        { from: 'unstarted', to: 'letter', at: dig.EXAMINER, run: (q) => dig.takeLetter(q) },
        { from: 'letter', to: 'exam1', run: (q) => dig.stampLetter(q) },
        { from: 'exam1', to: 'exam2', needs: (q) => (q.count(/^trowel$/i) ? [] : [{ item: 'cup of tea', count: 1 }]), run: (q) => dig.examOne(q) },
        { from: 'exam2', to: 'exam3', run: (q) => dig.examTwo(q, () => passes(q.sdk, 'exam3')) },
        { from: 'exam3', to: 'expert', needs: [{ item: 'opal', count: 1 }], run: (q) => dig.examThree(q, () => passes(q.sdk, 'expert')) },
        { from: 'expert', to: 'permit', needs: [{ item: 'vial', count: 1 }], run: (q) => dig.permit(q) },
        {
            from: 'permit',
            to: 'poured',
            needs: [
                { item: 'rope', count: 2 },
                { item: 'charcoal', count: 1 },
                { item: 'pestle and mortar', count: 1 },
                { item: 'tinderbox', count: 1 },
            ],
            run: async (q) => {
                await dig.chestKey(q);
                await dig.pourCompound(q);
            },
        },
        { from: 'poured', to: 'blown', needs: [{ item: 'tinderbox', count: 1 }], run: (q) => dig.blast(q) },
        { from: 'blown', to: 'complete', run: (q) => dig.tabletToExpert(q, () => passes(q.sdk, 'complete')) },
    ],
});
