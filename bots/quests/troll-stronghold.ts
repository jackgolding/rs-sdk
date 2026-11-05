/**
 * Troll Stronghold — Dad in the arena, a Troll General's prison key, Godric (and Eadgar) out of their cells.
 *
 *   bun bots/quests/troll-stronghold.ts {botname}
 *
 * Journal rules from quest_troll/scripts/troll_journal.rs2; the route and fights are lib/troll-stronghold.ts.
 * Needs Death Plateau done (Denulth only offers it then; Tenzing sells the climbing boots then). Gates: Agility 15
 * (every troll rock). Thieving 30 picks the cell guards' pockets; without it they are killed for the keys. Combat:
 * Dad (level 113) and a Troll General; Protect from Melee (Prayer 43) on the way when the account has it.
 * Supplies: coins (boots, 12gp), a melee weapon, sharks. Reward: 1 QP, the law talisman. Eadgar is freed too
 * (Eadgar's Ruse needs him home).
 */
import { runQuest, type Quest } from './lib/run-quest';
import * as troll from './lib/troll-stronghold';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `troll:${id}`, kind, all, none },
});

const journal = { label: 'Troll Stronghold', title: 'Troll Stronghold' };
const stages = [
    stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
    stage('started', 'active', ['that I would rescue']),
    stage('defeated_dad', 'active', ['I have defeated the Troll Champion']),
    stage('entered_prison', 'active', ['I have found my way into the prison']),
    stage('freed_godric', 'active', ['rescued Godric']),
    stage('complete', 'complete', ['QUEST COMPLETE']),
];
/** The background eat/drink guard (lib/troll-stronghold.ts survive) around a whole step. */
const guarded = (run: (q: Quest) => Promise<void>) => async (q: Quest) => {
    const stop = troll.survive(q, 0.55);
    try {
        await run(q);
    } finally {
        stop();
    }
};
type Sdk = Parameters<typeof readJournalCheckpoint>[0];
const passes = async (sdk: Sdk, id: string) => (await readJournalCheckpoint(sdk, journal, stages.find((s) => s.id === id)!.rule)).verdict?.verdict === 'PASS';

/** Taken at the open hub bank only, so eating them never stops a transition with NEEDS STOCK. */
const banked = (q: Quest, item: string, count: number) => (q.sdk.isBankOpen() ? [{ item, count }] : []);
// Prayer potions always (jackthief serves them when the bank has none): Dad drains the points, and jacklove7
// walked into the Troll Generals' hall at 0 points and died twice (2026-11-05).
const kit = (q: Quest) => [{ item: 'melee weapon', count: 1 }, ...banked(q, 'shark', 20), ...banked(q, 'prayer potion(3)', 4), ...(q.level('magic') >= 45 ? [{ item: 'law rune', count: 1 }, { item: 'air rune', count: 5 }] : [])];
/** Tenzing's boots (12gp) while none are held, worn or banked. */
const hasBoots = (q: Quest) => q.count(/^climbing boots$/i) > 0 || q.sdk.getEquipment().some((i) => /^climbing boots$/i.test(i.name)) || !!q.sdk.findBankItem(/^climbing boots$/i);
const bootKit = (q: Quest) => [...kit(q), ...(hasBoots(q) ? [] : [{ item: 'coins', count: 20 }])];

await runQuest({
    id: 'troll',
    requires: ["Death Plateau"],
    hub: 'falador-west',
    journal,
    skills: { agility: 15 },
    carry: ['climbing boots', 'prison key', 'cell key 1', 'cell key 2'],
    // Dad and the prison guards are per-player fights, but the Troll Generals and Twig/Berry are shared spawns.
    maxConcurrent: 2,
    stages,
    transitions: [
        {
            from: 'unstarted',
            to: 'started',
            needs: bootKit,
            run: guarded(async (q) => {
                await troll.start(q);
                if (!(await passes(q.sdk, 'started'))) throw new Error('troll: Denulth did not give the quest — is Death Plateau complete?');
            }),
        },
        {
            from: 'started',
            to: 'defeated_dad',
            needs: bootKit,
            run: guarded(async (q) => {
                await troll.ensureBoots(q);
                await troll.fightDad(q, () => passes(q.sdk, 'defeated_dad'));
            }),
        },
        {
            from: 'defeated_dad',
            to: 'entered_prison',
            needs: kit,
            run: guarded(async (q) => {
                await troll.ensureBoots(q);
                await troll.enterPrison(q, () => passes(q.sdk, 'entered_prison'));
            }),
        },
        {
            from: 'entered_prison',
            to: 'freed_godric',
            needs: kit,
            run: guarded(async (q) => {
                await troll.ensureBoots(q);
                await troll.freePrisoners(q, () => passes(q.sdk, 'freed_godric'));
            }),
        },
        {
            from: 'freed_godric',
            to: 'complete',
            needs: kit,
            run: guarded(async (q) => {
                await troll.ensureBoots(q);
                await troll.handIn(q);
            }),
        },
    ],
});
