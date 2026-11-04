/**
 * Troll Romance — Ug loves Aga: the Trollweiss flower by sled from Trollweiss Mountain, and Arrg beaten in the arena.
 *
 *   bun bots/quests/troll-romance.ts {botname}
 *
 * Journal rules from quest_troll_love/scripts/troll_love_journal.rs2; the route is lib/troll-romance.ts over
 * lib/troll-stronghold.ts's troll-country hops. Needs Death Plateau and Troll Stronghold. Gates: Agility 28 (the sled), a level
 * 113 troll (Arrg: 140 hp, melee and poisoned rocks; Protect from Melee at Prayer 43 when the account has it). Supplies:
 * maple logs (chopped at Seers), an iron bar, rope, a bucket of wax, swamp tar, a cake tin, coins (climbing boots), a melee
 * weapon, sharks. Reward: 2 QP, an uncut diamond. The way back with the flower is the second sled ride and the Rellekka cave.
 *
 * Staging (2026-11-04): QUEST COMPLETE (journal-verified) on a fresh account (qlqgtr2; maple logs
 * chopped and the cake tin bought in prepare) and on qlqgtr1 (restarted on Trollweiss Mountain's top: out by the ice cave).
 */
import { runQuest, type Quest, type Need } from './lib/run-quest';
import * as tr from './lib/troll-romance';
import * as troll from './lib/troll-stronghold';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';

troll.assumeTrollStrongholdDone();

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `troll_love:${id}`, kind, all, none },
});

const journal = { label: 'Troll Romance', title: 'Troll Romance' };
const stages = [
    stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
    stage('started', 'active', ['I have spoken to Ug and found out']),
    stage('aga', 'active', ['I have spoken to Aga and found out']),
    stage('tenzing', 'active', ['I have spoken to Tenzing who told me']),
    stage('materials', 'active', ['Dunstan told me what he needs']),
    stage('sled', 'active', ['an iron bar and rope and gave them to']),
    stage('waxed', 'active', ['I have made some sled wax']),
    stage('picked', 'active', ['I got the Trollweiss']),
    stage('given', 'active', ['I have given the Trollweiss to Ug']),
    stage('defeated', 'active', ['I have defeated Arrg']),
    stage('complete', 'complete', ['QUEST COMPLETE']),
];
const ORDER = stages.map((s) => s.id);
const before = (q: Quest, id: string) => ORDER.indexOf(q.stage) < ORDER.indexOf(id);
type Sdk = Parameters<typeof readJournalCheckpoint>[0];
const passes = async (sdk: Sdk, id: string) => (await readJournalCheckpoint(sdk, journal, stages.find((s) => s.id === id)!.rule)).verdict?.verdict === 'PASS';

const hasId = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id) || (q.sdk.isBankOpen() && q.sdk.getBankItems().some((b) => b.id === id));
const hasBoots = (q: Quest) => q.count(/^climbing boots$/i) > 0 || q.sdk.getEquipment().some((i) => /^climbing boots$/i.test(i.name)) || !!q.sdk.findBankItem(/^climbing boots$/i);
const banked = (q: Quest, item: string, count: number) => (q.sdk.isBankOpen() ? [{ item, count }] : []);

function kit(q: Quest): Need[] {
    const needs: Need[] = [{ item: 'melee weapon', count: 1 }, ...banked(q, 'coins', hasBoots(q) ? 30 : 60)];
    const sledMade = hasId(q, tr.OBJ.sled) || hasId(q, tr.OBJ.waxed);
    // Dunstan's materials until he has made the sled (22).
    if (before(q, 'sled') && !sledMade) needs.push({ item: 'maple logs', count: 1 }, { item: 'iron bar', count: 1 }, { item: 'rope', count: 1 });
    // The wax until the sled is waxed (25).
    if (before(q, 'waxed') && !hasId(q, tr.OBJ.waxed) && !hasId(q, tr.OBJ.wax)) needs.push({ item: 'bucket of wax', count: 1 }, { item: 'swamp tar', count: 1 }, { item: 'cake tin', count: 1 });
    // Food at the bank only: Arrg and the ice trolls hit; prayer potions when banked.
    needs.push(...banked(q, 'shark', 14));
    if (q.sdk.isBankOpen() && q.sdk.findBankItem(/^prayer potion\(\d\)$/i)) needs.push({ item: 'prayer potion', count: 2 });
    return needs;
}

/** The boots and the weapon on; the background eater around the step. */
const go = (run: (q: Quest) => Promise<void>) => async (q: Quest) => {
    await troll.ensureBoots(q);
    const boots = q.sdk.findInventoryItem(/^climbing boots$/i);
    if (boots) await q.bot.equipItem(boots).catch(() => undefined);
    await troll.wieldWeapon(q);
    const stop = troll.survive(q, 0.6);
    try {
        await run(q);
    } finally {
        stop();
    }
};

await runQuest({
    id: 'troll_love',
    hub: 'falador-west',
    journal,
    skills: { agility: 28 },
    carry: ['climbing boots', tr.OBJ.sled, tr.OBJ.waxed, tr.OBJ.wax, 'trollweiss'],
    // Ug, Aga and Arrg are per player; the ice cave's trolls and the slope are shared.
    maxConcurrent: 2,
    stages,
    transitions: [
        { from: 'unstarted', to: 'started', needs: kit, run: go(async (q) => void (await tr.talkUg(q, 'start', [/awww, you poor troll/i, /don't worry now/i]))) },
        { from: 'started', to: 'aga', needs: kit, run: go(async (q) => void (await tr.talkAga(q))) },
        { from: 'aga', to: 'tenzing', needs: kit, run: go((q) => tr.askTenzing(q)) },
        { from: 'tenzing', to: 'materials', needs: kit, run: go((q) => tr.dunstan(q, 'a sled', () => false)) },
        {
            from: 'materials',
            to: 'sled',
            needs: kit,
            run: go((q) => tr.dunstan(q, 'the materials', () => q.sdk.getInventory().some((i) => i.id === tr.OBJ.sled))),
        },
        { from: 'sled', to: 'waxed', needs: kit, run: go((q) => tr.waxSled(q)) },
        { from: 'waxed', to: 'picked', needs: kit, run: go((q) => tr.pickTrollweiss(q)) },
        {
            from: 'picked',
            to: 'given',
            needs: kit,
            run: go(async (q) => {
                await tr.leaveRomanceArea(q);
                await tr.talkUg(q, 'the flower');
            }),
        },
        { from: 'given', to: 'defeated', needs: kit, run: go((q) => tr.fightArrg(q, () => passes(q.sdk, 'defeated'))) },
        {
            from: 'defeated',
            to: 'complete',
            needs: kit,
            run: go(async (q) => {
                // His reward talk once stopped after two pages (qlqgtr2): talk again before walking out for a whole retry.
                for (let i = 0; i < 3 && !(await passes(q.sdk, 'complete')); i++) await tr.talkUg(q, 'the reward');
                // The epilogue only climbs: out of the stronghold to Burthorpe's side first.
                await troll.leaveTrollArea(q);
            }),
        },
    ],
});
