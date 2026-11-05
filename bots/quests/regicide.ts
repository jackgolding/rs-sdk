/**
 * Regicide — King Lathas sends you back through the Underground Pass to the elves' land to kill his brother Tyras.
 *
 *   bun bots/quests/regicide.ts {botname}
 *
 * Journal rules from quest_regicide/scripts/regicide_journal.rs2; the route is lib/regicide.ts over lib/underground-pass.ts
 * (the pass to Iban's temple doors). Needs Underground Pass; gates Agility 56 (the dense wood), Crafting 10 (the loom).
 * Pass kit: a bow, 5 bronze arrows, a tinderbox (Koftik's damp cloth arrow at the chasm), 2 ropes, a spade, a melee
 * weapon, sharks, and Falador Teleport runes (Magic 37) out of Tirannwn: its only walk out (the Arandar gate) is past
 * the dense wood, which needs stage 8.
 *
 * The bomb (stage 11 -> 12) runs in three phases with a hub restock between them (lib/regicide.ts bombAndCatapult):
 *   gather   through the pass: two barrels and the loom's cloth (4 balls of wool) in Iorwerth's camp, coal tar and
 *            ground sulphur (pestle) by the old camp, two raw rabbits, limestone (a pickaxe) past the north-east pitfall
 *   outside  Falador Teleport out; 16 coal (mined at the Coal Trucks if not banked), the Rimmington chemist's still
 *            (a blind valve/coal minigame driven by a lockstep model, .ql/still.ts), a rabbit cooked on Rimmington's
 *            range, quicklime at the Falador furnace ground into a pot, both dusts into the naphtha, the cloth fuse
 *   final    back through the pass: the cooked rabbit to the catapult's guard, the bomb on the catapult (12)
 * Every phase re-derives what is left from the items held and banked (`carry` keeps them across restarts).
 * Then Iorwerth's letter (13), Arianwyn in Ardougne's market zone east of the castle (14), Lathas (complete).
 *
 * Staging (2026-11-04, qlqhrg1): QUEST COMPLETE (journal-verified), every stage journal-verified across several
 * resumed runs (restarts in Tirannwn and in the pass: out by Falador Teleport or the pass's own exits, back in).
 */
import { runQuest, type Quest, type Need } from './lib/run-quest';
import * as reg from './lib/regicide';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = [], optional = false) => ({
    id,
    rule: { id: `regicide:${id}`, kind, all, none },
    ...(optional ? { optional } : {}),
});

const journal = { label: 'Regicide', title: 'Regicide' };
const stages = [
    stage('unstarted', 'unstarted', ['(will send word when I can start|I can start this quest by speaking to)']),
    stage('received', 'active', ['A courier has given me a message']),
    stage('lathas', 'active', ['King Lathas has asked me to re-enter']),
    stage('scouts', 'active', ['I have met a elvish scout party']),
    stage('iorwerth', 'active', ['Lord Iorwerth has offered the help of one of his']),
    // 5: the tracker without the pendant; passed through in one step when Iorwerth's pendant is already held.
    stage('tracker', 'active', ["(The tracker didn't trust me|has given me his pendant as proof)"], [], true),
    stage('pendant', 'active', ['After proving that I was not a bandit']),
    stage('footprints', 'active', ['I have found some tracks leading off']),
    stage('tracker2', 'active', ['I asked the tracker about the tracks']),
    stage('guard', 'active', ['Pushing my way through the undergrowth']),
    stage('camp', 'active', ['I have found the camp of King Tyras']),
    stage('book', 'active', ['has given me a', 'talks of things that go bang']),
    stage('killed', 'active', ['The catapult provided a great way']),
    stage('reported', 'active', ['has given me a', 'message', 'to carry to']),
    stage('arianwyn', 'active', ['I met an elf who showed me the truth']),
    stage('complete', 'complete', ['QUEST COMPLETE']),
];
type Sdk = Parameters<typeof readJournalCheckpoint>[0];
const passes = async (sdk: Sdk, id: string) => (await readJournalCheckpoint(sdk, journal, stages.find((s) => s.id === id)!.rule)).verdict?.verdict === 'PASS';
const ORDER = stages.map((s) => s.id);
const passesAny = async (sdk: Sdk, from: string) => {
    for (const id of ORDER.slice(ORDER.indexOf(from)).reverse()) if (await passes(sdk, id)) return true;
    return false;
};

/**
 * The pass kit until a step has begun (as underground-pass.ts): a spent rope or an eaten shark never sends a run from
 * Tirannwn back to a shop. Every restart walks in from the pass entrance, so a new process needs it all again.
 */
let underway = false;
// 10 sharks, not 14: the pass kit (14 slots) + weapon, coins and runes left 1 free slot, so the second rope
// never fit (ABGARMY17/20 "source for rope left 1/2", 2026-11-05).
const passKit = (q: Quest): Need[] => (underway ? [] : [...reg.passKitNeeds(), ...(q.sdk.isBankOpen() ? [{ item: 'shark', count: 10 }] : [])]);
const step = (fn: (q: Quest) => Promise<void>) => async (q: Quest) => {
    underway = true;
    await fn(q);
};
/**
 * Stage 11: the kit for the bomb's next phase. The phase is decided at the hub with the bank open (the prologue's
 * withdrawal) and remembered for the prepare phase, which reads needs with the bank closed; reg.restock covers the
 * later phases in-run. Sharks only while the bank is open (mule stock, never sourced mid-run).
 */
let kitPhase: ReturnType<typeof reg.bombPhase> | null = null;
const phaseNeeds = (q: Quest, phase: ReturnType<typeof reg.bombPhase>) =>
    (phase === 'gather' ? reg.gatherNeeds(q) : phase === 'outside' ? reg.outsideNeeds(q) : reg.finalNeeds()).filter((n) => q.sdk.isBankOpen() || n.item !== 'shark');
const bombKit = (q: Quest): Need[] => {
    if (underway) return [];
    if (q.sdk.isBankOpen()) kitPhase = reg.bombPhase(q);
    return kitPhase ? phaseNeeds(q, kitPhase) : [];
};
/** Stage 12: back to Iorwerth through the pass when the run starts outside Tirannwn. */
const letterKit = (q: Quest): Need[] => (underway ? [] : reg.finalNeeds().filter((n) => q.sdk.isBankOpen() || n.item !== 'shark'));

await runQuest({
    id: 'regicide',
    hub: 'ardougne',
    journal,
    skills: { agility: 56, crafting: 10, magic: 37 },
    // The bomb's parts and Iorwerth's letter: the naked prologue banks them (reg.restock withdraws every one by id).
    carry: Object.values(reg.BOMB),
    // Isafdar, the scouts and Iorwerth are shared; the pass's traps too.
    maxConcurrent: 2,
    stages,
    transitions: [
        { from: 'unstarted', to: 'received', run: (q) => reg.messenger(q, () => passesAny(q.sdk, 'received')) },
        { from: 'received', to: 'lathas', run: (q) => reg.lathas(q, () => passesAny(q.sdk, 'lathas')) },
        { from: 'lathas', to: 'scouts', needs: passKit, run: step((q) => reg.scouts(q, () => passesAny(q.sdk, 'scouts'))) },
        { from: 'scouts', to: 'iorwerth', needs: passKit, run: step((q) => reg.iorwerth(q, () => passesAny(q.sdk, 'iorwerth'))) },
        { from: 'iorwerth', to: 'pendant', needs: passKit, run: step((q) => reg.pendant(q, () => passesAny(q.sdk, 'pendant'))) },
        { from: 'tracker', to: 'pendant', needs: passKit, run: step((q) => reg.pendant(q, () => passesAny(q.sdk, 'pendant'))) },
        { from: 'pendant', to: 'footprints', needs: passKit, run: step((q) => reg.footprints(q, () => passesAny(q.sdk, 'footprints'))) },
        { from: 'footprints', to: 'tracker2', needs: passKit, run: step((q) => reg.trackerTracks(q, () => passesAny(q.sdk, 'tracker2'))) },
        { from: 'tracker2', to: 'guard', needs: passKit, run: step((q) => reg.guard(q, () => passesAny(q.sdk, 'guard'))) },
        { from: 'guard', to: 'camp', needs: passKit, run: step((q) => reg.intoCamp(q, () => passesAny(q.sdk, 'camp'))) },
        { from: 'camp', to: 'book', needs: passKit, run: step((q) => reg.book(q, () => passesAny(q.sdk, 'book'))) },
        { from: 'book', to: 'killed', needs: bombKit, run: step((q) => reg.bombAndCatapult(q, () => passesAny(q.sdk, 'killed'))) },
        { from: 'killed', to: 'reported', needs: letterKit, run: step((q) => reg.letter(q, () => passesAny(q.sdk, 'reported'))) },
        { from: 'reported', to: 'arianwyn', run: (q) => reg.arianwyn(q, () => passesAny(q.sdk, 'arianwyn')) },
        { from: 'arianwyn', to: 'complete', run: (q) => reg.reportLathas(q, () => passes(q.sdk, 'complete')) },
    ],
});
