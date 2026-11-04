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
 * WORK IN PROGRESS. Staging (2026-11-04, qlqhrg1): unstarted -> received -> lathas -> scouts -> iorwerth -> pendant ->
 * footprints -> tracker2 journal-verified (two restarts in Tirannwn: out by Falador Teleport, back through the pass).
 * Written after that: the guard (9), Tyras's camp (10), Iorwerth's book (11). Not written: the bomb (coal tar through
 * the Rimmington chemist's still, quicklime, sulphur, the loom's cloth fuse) and the catapult (12), Iorwerth's
 * letter (13), Arianwyn (14), Lathas (complete).
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
 * Pack: bow, arrows, tinderbox, 2 ropes, spade, weapon, 3 rune stacks = 10, 14 sharks, Koftik's 3 foods, the cloth arrow.
 */
let underway = false;
const passKit = (q: Quest): Need[] =>
    underway
        ? []
        : [
              { item: 'bow', count: 1 },
              { item: 'bronze arrow', count: 5 },
              { item: 'tinderbox', count: 1 },
              { item: 'rope', count: 2 },
              { item: 'spade', count: 1 },
              { item: 'melee weapon', count: 1 },
              ...(q.sdk.isBankOpen() ? [{ item: 'shark', count: 14 }] : []),
              { item: 'law rune', count: 2 },
              { item: 'air rune', count: 6 },
              { item: 'water rune', count: 2 },
          ];
const step = (fn: (q: Quest) => Promise<void>) => async (q: Quest) => {
    underway = true;
    await fn(q);
};

await runQuest({
    id: 'regicide',
    hub: 'ardougne',
    journal,
    skills: { agility: 56, crafting: 10, magic: 37 },
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
    ],
});
