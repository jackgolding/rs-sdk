/**
 * Shades of Mort'ton — Herbi Flax's diary, Serum 207, five Loar shades, the Flamtaer temple, a shade on the pyre.
 *
 *   bun bots/quests/shades-of-mortton.ts {botname}
 *
 * Journal rules from quest_mortton/scripts/mortton_journal.rs2; the route is lib/shades-of-mortton.ts. Prerequisites:
 * Priest in Peril (Morytania) and Nature Spirit started (Mort Myre's gate). Gates: Herblore 15 (the serum), Crafting 20
 * (the temple), Firemaking 5 (pyre logs). Prayer 43 is used when present (Protect from Melee nulls the shades).
 * Supplies: a melee weapon, 2 vials of water and 2 ashes (the serum; the tarromin is Herbi Flax's), logs (the pyre),
 * coins (Razmire's stores: a hammer, a tinderbox, olive oil, and the temple's planks, limestone bricks and swamp paste),
 * banked sharks and prayer potions. Reward: 3 QP.
 *
 * STATUS (2026-11-04): NOT staging-passed end to end in one run — do not promote to todo.json yet. Every stage is
 * proven on staging: qlqfsm4 (fresh) unstarted -> rebuild (55) in one run; qlqfsm2 rebuild -> QUEST COMPLETE
 * (journal-verified, END STATE OK). Known blocker: Serum 207 doses. Razmire and Ulsquire must be cleared with a dose
 * (each lasts 200 ticks) for every talk and every store visit, and Herbi Flax's table gives only 2 tarromin (6 doses,
 * no other source). A clean run needs ~5 (Razmire 15 and 45, Ulsquire 47 — 50 and the first store visit ride on those
 * windows — one restock if the temple runs dry, Ulsquire at the end); every failed/restarted step that re-talks costs
 * one more, and an account that runs out cannot finish without tarromin from elsewhere.
 */
import { runQuest, type Quest } from './lib/run-quest';
import * as sm from './lib/shades-of-mortton';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `mortton:${id}`, kind, all, none },
});

const journal = { label: 'Shades of Mortton', title: "Shades of Mort'ton" };
const stages = [
    stage('unstarted', 'unstarted', ['I can start this quest by exploring']),
    stage('diary', 'active', ['I made my way down through']),
    stage('serum', 'active', ['from tarromin, water and ashes']),
    stage('kill', 'active', ['he asked me to kill']),
    // 20..40: the kills count up in the journal; one step (killShades) covers them.
    { ...stage('killed', 'active', ['should return to']), optional: true },
    stage('razmire', 'active', ['show the remains to Ulsquire']),
    stage('ulsquire', 'active', ['I showed Ulsquire the shade remains']),
    stage('temple', 'active', ['wishes he could']),
    // 55: the first repair action; the repair step runs on to 60.
    { ...stage('rebuild', 'active', ["started rebuilding"]), optional: true },
    stage('altar', 'active', ['I helped rebuild the temple']),
    stage('oil', 'active', ['placed a flask of olive oil']),
    stage('pyrelogs', 'active', ['I used sacred oil on logs']),
    { ...stage('logs', 'active', ['I placed some pyre logs onto']), optional: true },
    stage('lit', 'active', ['set it on fire']),
    stage('complete', 'complete', ['QUEST COMPLETE']),
];
type Sdk = Parameters<typeof readJournalCheckpoint>[0];
const passes = async (sdk: Sdk, id: string) => (await readJournalCheckpoint(sdk, journal, stages.find((s) => s.id === id)!.rule)).verdict?.verdict === 'PASS';

/** Taken at the open hub bank only, so eating them never stops a transition with NEEDS STOCK. */
const banked = (q: Quest, item: string, count: number, re: RegExp) => (q.sdk.isBankOpen() && q.sdk.findBankItem(re) ? [{ item, count }] : []);
const kit = (q: Quest) => [
    { item: 'melee weapon', count: 1 },
    // Store money, taken at the open hub bank only: a transition that finds it spent must not walk off to pickpocket.
    ...banked(q, 'coins', 3000, /^coins$/i),
    ...banked(q, 'shark', 10, /^shark$/i),
    ...banked(q, 'prayer potion', 2, /^prayer potion\(\d\)$/i),
];
/** Herbi Flax's tarromin, banked by an earlier run's prologue (the table gives it once): withdrawn at the open hub bank. */
const bankedHerbs = (q: Quest) => {
    if (!q.sdk.isBankOpen()) return [];
    const clean = q.sdk.findBankItem(/^tarromin$/i);
    const raw = q.sdk.findBankItem(/^herb$/i);
    return [...(clean ? [{ item: 'tarromin', count: Math.min(2, clean.count) }] : []), ...(raw ? [{ item: 'herb', count: Math.min(3, raw.count) }] : [])];
};
const serumKit = (q: Quest) => [...kit(q), { item: 'vial of water', count: 2 }, { item: 'ashes', count: 2 }, { item: 'logs', count: 1 }, ...bankedHerbs(q)];
const pyreKit = (q: Quest) => [...kit(q), { item: 'logs', count: 1 }];
/**
 * Repair sets an earlier run bought (its prologue banked them): back out at the open hub bank, so a resumed temple step
 * does not spend a serum dose on Razmire's store for what the bank holds.
 */
const templeKit = (q: Quest) => [
    ...pyreKit(q),
    ...banked(q, 'plank', 7, /^plank$/i),
    ...banked(q, 'limestone brick', 7, /^limestone brick$/i),
    ...banked(q, 'swamp paste', 35, /^swamp paste$/i),
];

/**
 * Razmire's builders' store: as many repair sets (1 plank, 1 limestone brick, 5 swamp paste each) as the pack holds, up
 * to `max`. The temple takes ~5 sets at Crafting 55 and ~9 at 99 (high Crafting spends more per action), and every store
 * visit can cost a serum dose (Razmire is afflicted again 200 ticks after one; Herbi Flax's herbs make only 6 doses), so
 * each visit fills the pack: empty vials go, and sharks down to 4 (Protect from Melee nulls the shades).
 */
const buySets = async (q: Quest, max: number) => {
    const free = () => 28 - q.sdk.getInventory().length;
    for (const vial of q.sdk.getInventory().filter((i) => /^vial$/i.test(i.name))) await q.bot.dropItem(vial, 'all').catch(() => undefined);
    while (free() < 2 * max + 1 && q.count(/^shark$/i) > 4) {
        const before = q.count(/^shark$/i);
        await q.bot.dropItem(/^shark$/i, 1).catch(() => undefined);
        await q.sdk.waitForTicks(1);
        if (q.count(/^shark$/i) === before) break;
    }
    const have = Math.min(q.count(/^plank$/i), q.count(/^limestone brick$/i));
    const room = Math.floor((free() - (q.count(/^swamp paste$/i) ? 0 : 1)) / 2);
    const sets = Math.min(max, have + room);
    q.log(`mortton: buying up to ${sets} repair sets (${free()} free slots)`);
    await sm.buyFromRazmire(q, 'building', [
        [/^plank$/i, sets],
        [/^limestone brick$/i, sets],
        [/^swamp paste$/i, 5 * sets],
    ]);
};

await runQuest({
    id: 'mortton',
    hub: 'varrock-east',
    journal,
    skills: { herblore: 15, crafting: 20, firemaking: 5 },
    carry: ['diary', 'serum 207 (4)', 'serum 207 (3)', 'serum 207 (2)', 'serum 207 (1)', 'loar remains', 'hammer', 'tinderbox', 'olive oil(3)', 'sacred oil(3)', 'sacred oil(2)', 'pyre logs'],
    // Razmire, Ulsquire and the temple are per player; the shades are shared spawns.
    maxConcurrent: 2,
    stages,
    transitions: [
        { from: 'unstarted', to: 'diary', needs: serumKit, run: (q) => sm.readDiary(q, () => passes(q.sdk, 'diary')) },
        {
            from: 'diary',
            to: 'serum',
            needs: serumKit,
            run: async (q) => {
                await sm.readDiary(q, () => passes(q.sdk, 'diary'));
                await sm.brewSerum(q, 2);
            },
        },
        {
            from: 'serum',
            to: 'kill',
            needs: kit,
            run: async (q) => {
                if (sm.serumDoses(q) < 1) await sm.brewSerum(q, 1);
                await sm.serumTalk(q, 'razmire', [/what are all these shadow creatures/i, /yes, i'll dispatch/i], () => passes(q.sdk, 'kill'), 'Razmire (shades)');
            },
        },
        {
            from: 'kill',
            to: 'razmire',
            needs: kit,
            run: async (q) => {
                await sm.killShades(q, () => passes(q.sdk, 'killed'));
                await sm.serumTalk(q, 'razmire', [/^ok,? thanks/i], () => passes(q.sdk, 'razmire'), 'Razmire (remains)');
            },
        },
        {
            from: 'killed',
            to: 'razmire',
            needs: kit,
            run: async (q) => {
                await sm.killShades(q, () => passes(q.sdk, 'killed'));
                await sm.serumTalk(q, 'razmire', [/^ok,? thanks/i], () => passes(q.sdk, 'razmire'), 'Razmire (remains)');
            },
        },
        { from: 'razmire', to: 'ulsquire', needs: kit, run: (q) => sm.serumTalk(q, 'ulsquire', [], () => passes(q.sdk, 'ulsquire'), 'Ulsquire (remains)').then(() => undefined) },
        {
            from: 'ulsquire',
            to: 'temple',
            needs: kit,
            run: (q) => sm.serumTalk(q, 'ulsquire', [/what can you tell me about that temple/i, /^ok,? thanks/i], () => passes(q.sdk, 'temple'), 'Ulsquire (temple)').then(() => undefined),
        },
        {
            from: 'temple',
            to: 'altar',
            needs: templeKit,
            run: async (q) => {
                await sm.buyFromRazmire(q, 'general', [
                    [/^hammer$/i, 1],
                    [/^tinderbox$/i, 1],
                    [/^olive oil\(3\)$/i, 1],
                ]);
                await buySets(q, 7);
                await sm.repairTemple(q, () => passes(q.sdk, 'altar'), () => buySets(q, 7));
            },
        },
        {
            from: 'rebuild',
            to: 'altar',
            needs: templeKit,
            run: async (q) => {
                await sm.buyFromRazmire(q, 'general', [
                    [/^hammer$/i, 1],
                    [/^tinderbox$/i, 1],
                    [/^olive oil\(3\)$/i, 1],
                ]);
                await buySets(q, 7);
                await sm.repairTemple(q, () => passes(q.sdk, 'altar'), () => buySets(q, 7));
            },
        },
        {
            from: 'altar',
            to: 'oil',
            needs: templeKit,
            run: async (q) => {
                await sm.buyFromRazmire(q, 'general', [
                    [/^tinderbox$/i, 1],
                    [/^olive oil\(3\)$/i, 1],
                ]);
                await sm.sacredOil(q, () => buySets(q, 2));
            },
        },
        { from: 'oil', to: 'pyrelogs', needs: pyreKit, run: (q) => sm.pyreLogs(q) },
        {
            from: 'pyrelogs',
            to: 'lit',
            needs: kit,
            run: async (q) => {
                await sm.buyFromRazmire(q, 'general', [[/^tinderbox$/i, 1]]);
                await sm.burnShade(q, () => passes(q.sdk, 'lit'));
            },
        },
        {
            from: 'logs',
            to: 'lit',
            needs: kit,
            run: async (q) => {
                await sm.buyFromRazmire(q, 'general', [[/^tinderbox$/i, 1]]);
                await sm.burnShade(q, () => passes(q.sdk, 'lit'));
            },
        },
        {
            from: 'lit',
            to: 'complete',
            needs: kit,
            run: async (q) => {
                await sm.serumTalk(q, 'ulsquire', [], () => passes(q.sdk, 'complete'), 'Ulsquire (complete)');
                await sm.prayMelee(q, false);
            },
        },
    ],
});
