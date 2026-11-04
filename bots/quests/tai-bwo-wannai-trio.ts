/**
 * Tai Bwo Wannai Trio — Timfraku's three sons (and Lubufu's karambwan secret) back to the village.
 *
 *   bun bots/quests/tai-bwo-wannai-trio.ts {botname}
 *
 * Journal rules from quest_tbwt/scripts/tbwt_journal.rs2 (each brother's section persists, struck through, once
 * reached, so a later stage's text implies the earlier ones); the route is lib/tai-bwo-wannai-trio.ts. Order: start,
 * Lubufu (bait, apprentice, the vessel), Tiadeche (the loaded vessel), Tamayu (hunt, potions, the poisoned spear),
 * Tinsay (rum, sandwich, bones), the crafting manual for Tiadeche (completes the brothers), Timfraku's reward.
 *
 * Prerequisites: Jungle Potion. Skills: Cooking 30, Firemaking 30 (the jogre bones), Fishing 5, Herblore 34 (to brew
 * the agility potions; held potions skip it), Agility 15 (journal). Combat: jogres (53) for their bones and a spear.
 * Supplies: coins (Barnaby both ways, rum), a melee weapon, food, a bow and bronze arrows (monkeys dodge melee),
 * small fishing net, pestle and mortar, knife, tinderbox, logs, 2 agility potion(3) (toadflax from jackthief).
 * Reward: 2 QP, 2000 coins.
 */
import { runQuest, type Quest, type Transition } from './lib/run-quest';
import * as tb from './lib/tai-bwo-wannai-trio';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';
import { FARE, onIslandNow } from './lib/jungle-potion';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = []) => ({
    id,
    rule: { id: `tbwt:${id}`, kind, all, none },
});

const journal = { label: 'Tai Bwo Wannai Trio', title: 'Tai Bwo Wannai Trio' };
const stages = [
    stage('unstarted', 'unstarted', ['start this quest']),
    stage('started', 'active', ['three sons of']),
    stage('bait', 'active', ['shoal in a Holy']),
    stage('given', 'active', ['I have given Lubufu 20 Karambwanji']),
    stage('apprentice', 'active', ["I have accepted Lubufu's offer"]),
    stage('tiadeche', 'active', ['Tiadeche:']),
    // 3 (caught) still reads as 'tiadeche' plus this line; 4 asks for the manual.
    stage('caught', 'active', ['I must take a Karambwan vessel']),
    stage('tamayu', 'active', ['Tamayu:']),
    stage('hunt', 'active', ['having difficulty in the hunt']),
    stage('slain', 'active', ['Tamayu has slain the Shaikahan']),
    stage('tinsay', 'active', ['Tinsay:']),
    stage('rum', 'active', ['I have given him sliced banana in Karamja rum']),
    stage('sandwich', 'active', ['I have given him a seaweed in monkey skin sandwich']),
    stage('bones', 'active', ['I have given him a burnt Jogre bones marinated in']),
    { ...stage('manual', 'active', ['retrieved crafting instructions for Tiadeche']), optional: true },
    stage('brothers', 'active', ['I must speak with Timfraku']),
    stage('complete', 'complete', ['QUEST COMPLETE']),
];
type Sdk = Parameters<typeof readJournalCheckpoint>[0];
const read = async (sdk: Sdk, all: string[]) => (await readJournalCheckpoint(sdk, journal, { id: 'tbwt:probe', kind: 'active', all, none: [] })).verdict?.verdict === 'PASS';
/** Each stage's text persists once reached (struck through) until the quest completes, when the journal is rewritten. */
const passes = async (sdk: Sdk, id: string) => {
    const pass = async (sid: string) => (await readJournalCheckpoint(sdk, journal, stages.find((s) => s.id === sid)!.rule)).verdict?.verdict === 'PASS';
    return (await pass(id)) || (id !== 'complete' && (await pass('complete')));
};
/** Tiadeche waiting for the manual (4), or it is already in hand (5). */
const errand = (q: Quest) => async () => (await read(q.sdk, ['I must take a Karambwan vessel'])) || (await read(q.sdk, ['retrieved crafting instructions']));
const order = (id: string) => stages.findIndex((s) => s.id === id);
const atOrBefore = (q: Quest, id: string) => order(q.stage) <= order(id);

/** Taken at the open hub bank only, so eating them never stops a transition with NEEDS STOCK. */
const banked = (q: Quest, item: string, count: number, re: RegExp) => (q.sdk.isBankOpen() && q.sdk.findBankItem(re) ? [{ item, count }] : []);

/** Set when the first transition runs (the prologue and prepare are behind us). */
let underway = false;
const kit = (q: Quest) => [
    // Consumables are topped up at the open hub bank only: mid-quest, a shortfall must not send the run off the island
    // (staging: 70 coins after Zambo's rum went pickpocketing in Yanille; arrows spent on a monkey would buy more in Ardougne).
    { item: 'coins', count: q.sdk.isBankOpen() ? 2 * FARE + 100 : onIslandNow(q) ? FARE : 2 * FARE },
    { item: 'melee weapon', count: 1 },
    ...banked(q, 'shark', 6, /^shark$/i),
    ...(atOrBefore(q, 'caught') ? [{ item: 'small fishing net', count: 1 }] : []),
    // Tamayu: 4 doses (two 3-dose potions), until the journal says his agility matches.
    ...(atOrBefore(q, 'hunt') && (q.sdk.isBankOpen() || !underway) ? [{ item: 'agility potion(3)', count: 2 }] : []),
    ...(atOrBefore(q, 'hunt') ? [{ item: 'pestle and mortar', count: 1 }] : []),
    ...(atOrBefore(q, 'sandwich') ? [{ item: 'small fishing net', count: 1 }, { item: 'pestle and mortar', count: 1 }, { item: 'tinderbox', count: 1 }] : []),
    // Two fires: the karambwan (before the slaying) and the bones' marinade. One once the karambwan is cooked.
    ...(atOrBefore(q, 'sandwich') ? [{ item: 'logs', count: atOrBefore(q, 'hunt') ? 2 : 1 }] : []),
    ...(atOrBefore(q, 'tinsay') ? [{ item: 'knife', count: 1 }] : []),
    ...(atOrBefore(q, 'rum') ? [{ item: 'bow', count: 1 }, { item: 'bronze arrow', count: q.sdk.isBankOpen() || !underway ? 30 : 1 }] : []),
    ...(atOrBefore(q, 'bones') ? [{ item: 'small fishing net', count: 1 }] : []),
];

const underwayOnRun = (ts: Transition[]): Transition[] =>
    ts.map((t) => ({
        ...t,
        run: async (q: Quest) => {
            underway = true;
            await t.run?.(q);
        },
    }));

await runQuest({
    id: 'tbwt',
    hub: 'ardougne',
    journal,
    skills: { cooking: 30, firemaking: 30, fishing: 5 },
    carry: [
        tb.OBJ.vessel,
        tb.OBJ.vesselLoaded,
        tb.OBJ.rawKarambwan,
        tb.OBJ.poorKarambwan,
        tb.OBJ.poisonPaste,
        ...tb.KP_SPEARS,
        tb.OBJ.jogreBones,
        tb.OBJ.burntBones,
        tb.OBJ.burntBonesPaste,
        tb.OBJ.marinated,
        tb.OBJ.karambwanjiPaste,
        tb.OBJ.bananaRum,
        tb.OBJ.rum,
        tb.OBJ.monkeyCorpse,
        tb.OBJ.monkeySkin,
        tb.OBJ.sandwich,
        tb.OBJ.manual,
    ],
    // Lubufu, the fishing spots and the jogres are shared; the brothers' errands are per player.
    maxConcurrent: 2,
    stages,
    transitions: underwayOnRun([
        { from: 'unstarted', to: 'started', needs: kit, run: (q) => tb.startQuest(q, () => passes(q.sdk, 'started')) },
        { from: 'started', to: 'bait', needs: kit, run: (q) => tb.lubufuBait(q, () => passes(q.sdk, 'bait')) },
        { from: 'bait', to: 'given', needs: kit, run: (q) => tb.feedLubufu(q, () => passes(q.sdk, 'given')) },
        { from: 'given', to: 'apprentice', needs: kit, run: (q) => tb.apprentice(q, () => passes(q.sdk, 'apprentice')) },
        { from: 'apprentice', to: 'tiadeche', needs: kit, run: (q) => tb.meetTiadeche(q, () => passes(q.sdk, 'tiadeche')) },
        { from: 'tiadeche', to: 'caught', needs: kit, run: (q) => tb.vesselToTiadeche(q, () => passes(q.sdk, 'caught'), () => read(q.sdk, ['He has successfully caught a Karambwan'])) },
        { from: 'caught', to: 'tamayu', needs: kit, run: (q) => tb.meetTamayu(q, () => passes(q.sdk, 'tamayu')) },
        { from: 'tamayu', to: 'hunt', needs: kit, run: (q) => tb.firstHunt(q, () => passes(q.sdk, 'hunt')) },
        {
            from: 'hunt',
            to: 'slain',
            needs: kit,
            run: (q) =>
                tb.armTamayu(
                    q,
                    () => read(q.sdk, ['increased his agility to match']),
                    () => read(q.sdk, ['Karambwan poisoned spear']),
                    () => passes(q.sdk, 'slain')
                ),
        },
        { from: 'slain', to: 'tinsay', needs: kit, run: (q) => tb.meetTinsay(q, () => passes(q.sdk, 'tinsay')) },
        { from: 'tinsay', to: 'rum', needs: kit, run: (q) => tb.bananaRum(q, () => passes(q.sdk, 'rum')) },
        { from: 'rum', to: 'sandwich', needs: kit, run: (q) => tb.sandwich(q, () => passes(q.sdk, 'sandwich')) },
        { from: 'sandwich', to: 'bones', needs: kit, run: (q) => tb.marinatedBones(q, () => passes(q.sdk, 'bones')) },
        { from: 'bones', to: 'brothers', needs: kit, run: (q) => tb.manualToTiadeche(q, () => passes(q.sdk, 'brothers'), errand(q)) },
        { from: 'manual', to: 'brothers', needs: kit, run: (q) => tb.manualToTiadeche(q, () => passes(q.sdk, 'brothers'), errand(q)) },
        {
            from: 'brothers',
            to: 'complete',
            needs: kit,
            run: async (q) => {
                await tb.finishQuest(q, () => passes(q.sdk, 'complete'));
                const { homeFromJungle } = await import('./lib/jungle-potion');
                await homeFromJungle(q);
            },
        },
    ]),
});
