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
 * Serum budget: dosesWanted (below) is what the rest of the quest spends from each stage (6 from the start: Herbi
 * Flax's two tarromin, exactly). A resumed run short of it withdraws every banked serum and tarromin, asks jackthief
 * for tarromin (sources.ts, NEEDS STOCK when it cannot), and carries a vial of water and ashes per brew; serumTalk
 * brews when the pack runs dry. Herblore 15.
 *
 * STAGING (2026-11-04, local fast engine): qlmrt1 fresh unstarted -> QUEST COMPLETE in one run (5 doses spent);
 * qlmrt2 SIGTERM mid-altar, resumed -> QUEST COMPLETE; qlmrt4 at 47 with no serum and 2 banked tarromin -> withdrew
 * them, sourced vials, brewed twice on demand -> QUEST COMPLETE.
 */
import { runQuest, type Quest, type Transition } from './lib/run-quest';
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

// ── the Serum 207 budget
//
// Razmire and Ulsquire are cleared per player for 200 ticks by one dose (razmire_keelgan.rs2 / ulsquire_shauncy.rs2:
// longqueue *_reset 200). Herbi Flax's table gives two tarromin once (6 doses); no shop sells tarromin and no spawn places
// it. dosesWanted is what the rest of the quest spends from a stage on: a resumed run short of it withdraws banked serum
// and tarromin, asks the mule for the rest (sources.ts tarromin: jackthief) before walking anywhere, and takes a vial of
// water and ashes per brew; serumTalk brews when the pack runs dry.

/** Inventory plus, while the hub bank is open, the bank. */
const bankCount = (q: Quest, match: (b: { id: number; name: string }) => boolean) =>
    q.sdk.isBankOpen() ? q.sdk.getBankItems().filter(match).reduce((n, b) => n + b.count, 0) : 0;
const held = (q: Quest, re: RegExp) => q.count(re) + bankCount(q, (b) => re.test(b.name));
const SERUM_RE = /^serum 207 \((\d)\)$/i;
const dosesHeld = (q: Quest) => {
    const inv = q.sdk.getInventory().filter((i) => SERUM_RE.test(i.name));
    const bank = q.sdk.isBankOpen() ? q.sdk.getBankItems().filter((b) => SERUM_RE.test(b.name)) : [];
    return [...inv, ...bank].reduce((n, i) => n + Number(SERUM_RE.exec(i.name)![1]) * (i.count ?? 1), 0);
};
/** Herbi Flax's unidentified tarromin (by id: the rogue's purse from the same table shares the name). */
const rawHeld = (q: Quest) => q.sdk.getInventory().filter((i) => i.id === sm.OBJ.herb).length + bankCount(q, (b) => b.id === sm.OBJ.herb);
const unfHeld = (q: Quest) => q.sdk.getInventory().filter((i) => i.id === sm.OBJ.unf).length + bankCount(q, (b) => b.id === sm.OBJ.unf);
const order = (id: string) => stages.findIndex((s) => s.id === id);
const atOrBefore = (q: Quest, id: string) => order(q.stage) <= order(id);
/**
 * Doses the rest of the quest spends from the current stage: Razmire (15), Razmire with the remains (45), Ulsquire (47;
 * 50 rides that window), the temple's two stores (one window) and one spare for a restock, the altar's tinderbox and oil
 * when not held, Ulsquire at the end. 6 from the start: Herbi Flax's table, exactly.
 */
function dosesWanted(q: Quest): number {
    if (q.stage === 'complete') return 0;
    let n = 1;
    if (atOrBefore(q, 'serum')) n++;
    if (atOrBefore(q, 'killed')) n++;
    if (atOrBefore(q, 'ulsquire')) n++;
    if (atOrBefore(q, 'rebuild')) n += 2;
    else if (q.stage === 'altar') n += held(q, /^olive oil\([234]\)$/i) && held(q, /^tinderbox$/i) ? 0 : 1;
    else if (atOrBefore(q, 'logs') && !held(q, /^tinderbox$/i)) n++;
    return n;
}
/** Set when the first transition runs: a shortfall found mid-quest fails its step (the restart's prologue restocks). */
let underway = false;
const serumNeeds = (q: Quest) => {
    const out: Array<{ item: string; count: number }> = [];
    // Every banked serum, not carry's one per name: the budget counts them all.
    if (q.sdk.isBankOpen()) {
        for (const b of q.sdk.getBankItems().filter((b) => SERUM_RE.test(b.name))) {
            out.push({ item: b.name.toLowerCase(), count: b.count + q.count(b.name.toLowerCase()) });
        }
    }
    if (underway && !q.sdk.isBankOpen()) return out;
    const doses = dosesHeld(q);
    const unf = unfHeld(q);
    const brews = Math.max(0, Math.ceil((dosesWanted(q) - doses) / 3) - unf);
    // Herbi Flax's table, not searched yet: nothing brewed, banked or held from it.
    const table = (q.stage === 'unstarted' || q.stage === 'diary') && doses === 0 && unf === 0 && !held(q, /^tarromin$/i) && !rawHeld(q) ? 2 : 0;
    const herbs = Math.min(rawHeld(q), brews);
    if (brews - table - herbs > 0) out.push({ item: 'tarromin', count: brews - table - herbs });
    if (brews + unf > 0) out.push({ item: 'vial of water', count: brews }, { item: 'ashes', count: brews + unf });
    return out.filter((n) => n.count > 0);
};
/** Herbi Flax's tarromin, banked unidentified by an earlier run: withdrawn at the open hub bank. */
const bankedHerbs = (q: Quest) => {
    if (!q.sdk.isBankOpen()) return [];
    const raw = q.sdk.getBankItems().find((b) => b.id === sm.OBJ.herb);
    return raw ? [{ item: raw.name.toLowerCase(), count: Math.min(3, raw.count) }] : [];
};

const kit = (q: Quest) => [
    { item: 'melee weapon', count: 1 },
    // Store money, taken at the open hub bank only: a transition that finds it spent must not walk off to pickpocket.
    ...banked(q, 'coins', 3000, /^coins$/i),
    ...banked(q, 'shark', 10, /^shark$/i),
    ...banked(q, 'prayer potion', 2, /^prayer potion\(\d\)$/i),
    ...serumNeeds(q),
    ...bankedHerbs(q),
    // The shades' remains (carry takes one): Razmire 2, Ulsquire 1, the pyre 1.
    ...(q.sdk.isBankOpen() && q.sdk.findBankItem(/^loar remains$/i) ? [{ item: 'loar remains', count: Math.min(5, held(q, /^loar remains$/i)) }] : []),
];
const serumKit = (q: Quest) => [...kit(q), { item: 'logs', count: 1 }];
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
const buySets = async (q: Quest, max: number, enough = Infinity) => {
    // A resumed temple step that still holds sets (banked and withdrawn by templeKit) starts on them: a store visit is a dose.
    if (Math.min(q.count(/^plank$/i), q.count(/^limestone brick$/i), Math.floor(q.count(/^swamp paste$/i) / 5)) >= enough) return;
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

/** Marks the run underway when a transition starts (serumNeeds: the budget is the prologue's and prepare's). */
const underwayOnRun = (ts: Transition[]): Transition[] =>
    ts.map((t) => ({
        ...t,
        run: async (q: Quest) => {
            underway = true;
            await t.run?.(q);
        },
    }));

await runQuest({
    id: 'mortton',
    hub: 'varrock-east',
    // Mort Myre's gate: Nature Spirit begun. Its 2-account slot cap made the runner skip on to this and
    // walk to the gate for nothing (jacklove2, ABGARMY17, 2026-11-05).
    requires: ['Nature Spirit (started)'],
    journal,
    skills: { herblore: 15, crafting: 20, firemaking: 5 },
    carry: ['diary', 'serum 207 (4)', 'serum 207 (3)', 'serum 207 (2)', 'serum 207 (1)', 'loar remains', 'hammer', 'tinderbox', 'olive oil(4)', 'olive oil(3)', 'olive oil(2)', 'sacred oil(3)', 'sacred oil(2)', 'pyre logs', sm.OBJ.unf],
    // Razmire, Ulsquire and the temple are per player; the shades are shared spawns.
    maxConcurrent: 2,
    stages,
    transitions: underwayOnRun([
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
                    [/^olive oil\([234]\)$/i, 1],
                ]);
                await buySets(q, 7, 3);
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
                    [/^olive oil\([234]\)$/i, 1],
                ]);
                await buySets(q, 7, 3);
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
                    [/^olive oil\([234]\)$/i, 1],
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
    ]),
});
