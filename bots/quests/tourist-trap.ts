/**
 * Tourist Trap — Irena's daughter Ana, smuggled out of the desert mining camp in a barrel.
 *
 *   bun bots/quests/tourist-trap.ts {botname}
 *
 * Journal rules from quest_desertrescue/scripts/desertrescue_journal.rs2; the route is
 * lib/tourist-trap.ts. Skill gates (journal): Fletching 10, Smithing 20 (the prototype dart);
 * Thieving (the slave's locks) and Agility (the mine cart) are rolls that only fail more at low
 * levels. Everything bought from Shantay (pass, waterskins, desert clothes, bronze bars, feathers,
 * hammer): coins only. The camp guards jail anyone wearing a weapon or armour, so nothing is worn;
 * the Mercenary Captain is fought bare-handed. Reward: 2 QP, 4 x 4650 XP (Agility, Thieving here).
 */
import { runQuest } from './lib/run-quest';
import * as tt from './lib/tourist-trap';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = [], optional = false) => ({
    id,
    rule: { id: `desertrescue:${id}`, kind, all, none },
    ...(optional ? { optional } : {}),
});

const journal = { label: 'The Tourist Trap', title: 'Tourist Trap' };
const stages = [
    stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
    stage('started', 'active', ['I need to head into the desert and search for']),
    stage('approached', 'active', ['must be around here somewhere'], [], true),
    stage('killed', 'active', ["I've killed the Mercenary Captain"]),
    stage('camp', 'active', ['The key I took from the mercenary captain allowed me to']),
    stage('spoken', 'active', ["I've found a slave who says he's going to escape"], [], true),
    stage('freed', 'active', ['I managed to pick the locks on the slaves chains'], [], true),
    stage('clothes', 'active', ["I've managed to swap the desert robes for slave robes"]),
    stage('mine', 'active', ["I've managed to into the underground mine area"]),
    stage('pineapple', 'active', ['I tried to enter the mines but my way was blocked']),
    stage('key', 'active', ["will give me a 'Tenti' pineapple if I can steal the"]),
    stage('plans', 'active', ['I managed to distract captain Siad']),
    stage('shown', 'active', ['prototype of the new secret throwing weapon']),
    stage('tip', 'active', ["I've made the prototype dart tip"], [], true),
    stage('dart', 'active', ["I've made a prototype dart"], [], true),
    stage('darts', 'active', ['I managed to distract captain Siad', 'I need to get the mine guard a'], ['will give me a']),
    stage('bribed', 'active', ['gave me a pineapple which I used to bribe']),
    stage('deeper', 'active', ['I have to find some way of getting'], [], true),
    stage('ana', 'active', ['I found Ana working as a slave in the mine'], [], true),
    stage('saved', 'active', ['I managed to smuggle her out'], [], true),
    stage('complete', 'complete', ['QUEST COMPLETE']),
];
const passes = async (sdk: Parameters<typeof readJournalCheckpoint>[0], id: string) =>
    (await readJournalCheckpoint(sdk, journal, stages.find((s) => s.id === id)!.rule)).verdict?.verdict === 'PASS';
const O = tt.OBJ;
const kit = [{ item: 'coins', count: 30 }, { item: 'shark', count: 6 }];
// Shantay's prices: the pass and clothes at the start, the dart's bars, feathers and hammer later.
const shopping = (coins: number) => [{ item: 'coins', count: coins }, { item: 'shark', count: 6 }];
// The dart's bars, feathers and hammer were bought in the plans transition: only top up coins when they are not held.
const dartShopping = (q: { count: (i: string | RegExp) => number }) =>
    q.count(/^bronze bar$/i) && q.count(/^feather$/i) >= 10 && q.count(/^hammer$/i) ? kit : shopping(300);

await runQuest({
    id: 'desertrescue',
    hub: 'al-kharid',
    journal,
    carry: [O.pass, O.waterskin, O.shirt, O.robe, O.boots, O.metalKey, O.slaveShirt, O.slaveRobe, O.slaveBoots, O.bedobinKey, O.plans, O.dartTip, O.dart, O.pineapple, O.bronzeBar, O.feather, O.hammer, O.anaBarrel],
    skills: { fletching: 10, smithing: 20 },
    // One Mercenary Captain, one chained slave per spot, one Ana.
    maxConcurrent: 1,
    stages,
    transitions: [
        { from: 'unstarted', to: 'started', needs: shopping(500), run: (q) => tt.startQuest(q) },
        { from: 'started', to: 'killed', needs: kit, run: (q) => tt.killCaptain(q) },
        { from: 'approached', to: 'killed', needs: kit, run: (q) => tt.killCaptain(q) },
        {
            from: 'killed',
            to: 'camp',
            needs: kit,
            run: async (q) => {
                await tt.kit(q, { clothes: true });
                await tt.intoCamp(q);
            },
        },
        {
            from: 'camp',
            to: 'clothes',
            needs: kit,
            run: async (q) => {
                await tt.kit(q, { clothes: true });
                await tt.slaveClothesTrade(q);
            },
        },
        { from: 'spoken', to: 'clothes', needs: kit, run: (q) => tt.slaveClothesTrade(q) },
        { from: 'freed', to: 'clothes', needs: kit, run: (q) => tt.slaveClothesTrade(q) },
        { from: 'clothes', to: 'mine', needs: kit, run: (q) => tt.intoMine(q) },
        { from: 'mine', to: 'pineapple', needs: kit, run: (q) => tt.caveGuardPineappleTalk(q) },
        { from: 'pineapple', to: 'key', needs: kit, run: (q) => tt.shabimKey(q) },
        { from: 'key', to: 'plans', needs: kit, run: (q) => tt.siadPlans(q) },
        {
            from: 'plans',
            to: 'shown',
            needs: shopping(400),
            run: async (q) => {
                await tt.leaveTouristTrap(q);
                await tt.kit(q, { dart: true });
                await tt.plansToShabim(q);
            },
        },
        {
            from: 'shown',
            to: 'darts',
            needs: dartShopping,
            run: async (q) => {
                await tt.kit(q, { dart: true });
                await tt.makeDart(q, () => passes(q.sdk, 'dart'));
                await tt.dartToShabim(q);
            },
        },
        { from: 'tip', to: 'darts', needs: dartShopping, run: async (q) => { await tt.kit(q, { dart: true }); await tt.makeDart(q, () => passes(q.sdk, 'dart')); await tt.dartToShabim(q); } },
        { from: 'dart', to: 'darts', needs: kit, run: (q) => tt.dartToShabim(q) },
        { from: 'darts', to: 'bribed', needs: kit, run: (q) => tt.pineappleToGuard(q) },
        {
            from: 'bribed',
            to: 'complete',
            needs: kit,
            // 19-26 share one journal page (the cart ride out leaves it there): rescue to Irena in one go.
            run: async (q) => {
                await tt.rescueAna(q);
                await tt.anaUpTop(q);
                await tt.cartEscape(q);
                await tt.anaToIrena(q, () => passes(q.sdk, 'complete'));
            },
        },
        { from: 'deeper', to: 'complete', needs: kit, run: async (q) => { await tt.rescueAna(q); await tt.anaUpTop(q); await tt.cartEscape(q); await tt.anaToIrena(q, () => passes(q.sdk, 'complete')); } },
        { from: 'ana', to: 'complete', needs: kit, run: async (q) => { if (!tt.held(q, O.anaBarrel)) { await tt.rescueAna(q); await tt.anaUpTop(q); await tt.cartEscape(q); } await tt.anaToIrena(q, () => passes(q.sdk, 'complete')); } },
        { from: 'saved', to: 'complete', run: (q) => tt.anaToIrena(q, () => passes(q.sdk, 'complete')) },
    ],
});
