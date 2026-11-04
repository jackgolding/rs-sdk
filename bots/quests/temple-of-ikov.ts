/**
 * Temple of Ikov — Lucien's errand under Hemenster, finished for the Guardians of Armadyl.
 *
 *   bun bots/quests/temple-of-ikov.ts {botname}
 *
 * Journal rules from quest_ikov/scripts/ikov_journal.rs2; the route is lib/temple-of-ikov.ts. Skill gates: Thieving
 * 42 (the trap lever), Ranged 40 (ice arrows fire only from a yew bow or better). Supplies: a yew shortbow, a lit
 * candle, a knife, 20 limpwurt roots (Winelda counts them unnoted), a few sharks. The lava bridge needs total
 * weight below zero with the Boots of lightness worn: no armour, no coins. Magic 45 and 1 law + 5 air runes: Camelot
 * Teleport out of the temple (its only walk out is behind the shiny-key door). Reward: 1 QP, Ranged and Fletching XP.
 */
import { runQuest } from './lib/run-quest';
import * as ikov from './lib/temple-of-ikov';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], none: string[] = [], optional = false) => ({
    id,
    rule: { id: `ikov:${id}`, kind, all, none },
    ...(optional ? { optional } : {}),
});

const journal = { label: 'Temple of Ikov', title: 'Temple of Ikov' };
const stages = [
    stage('unstarted', 'unstarted', ['I can start this quest at the']),
    stage('started', 'active', ['Lucien has asked me to retrieve the Staff of Armadyl']),
    stage('lever', 'active', ['I have found some boots of lightness'], [], true),
    stage('warrior', 'active', ['killed it using arrows made of ice']),
    stage('winelda', 'active', ['will teleport me across if I first get her'], [], true),
    stage('paid', 'active', ['Winelda teleported me across']),
    stage('helping', 'active', ['I agreed to help the Guardians of Armadyl, I will kill Lucien']),
    stage('complete', 'complete', ['QUEST COMPLETE']),
];
const passes = async (sdk: Parameters<typeof readJournalCheckpoint>[0], id: string) =>
    (await readJournalCheckpoint(sdk, journal, stages.find((s) => s.id === id)!.rule)).verdict?.verdict === 'PASS';
const O = ikov.OBJ;
// Light: three sharks and nothing else heavy (the bridge).
const dungeon = [
    { item: 'bow', count: 1 },
    { item: 'shark', count: 3 },
    { item: 'limpwurt root', count: 20 },
    // Past the lava the only walk out is a cellar room behind the shiny-key door: Camelot Teleport out.
    { item: 'law rune', count: 1 },
    { item: 'air rune', count: 5 },
];

await runQuest({
    id: 'ikov',
    hub: 'ardougne',
    journal,
    carry: [O.pendantL, O.pendantA, O.boots, O.lever, O.iceArrow],
    skills: { thieving: 42, ranged: 40 },
    // The Fire Warrior and the chests' arrows are per player; Lucien is a shared npc.
    maxConcurrent: 2,
    stages,
    transitions: [
        { from: 'unstarted', to: 'started', run: (q) => ikov.start(q) },
        { from: 'started', to: 'warrior', needs: [...dungeon, { item: 'lit candle', count: 1 }, { item: 'knife', count: 1 }], run: (q) => ikov.toFireWarrior(q) },
        { from: 'lever', to: 'warrior', needs: [...dungeon, { item: 'lit candle', count: 1 }, { item: 'knife', count: 1 }], run: (q) => ikov.toFireWarrior(q) },
        { from: 'warrior', to: 'paid', needs: dungeon, run: (q) => ikov.winelda(q) },
        { from: 'winelda', to: 'paid', needs: dungeon, run: (q) => ikov.winelda(q) },
        { from: 'paid', to: 'helping', needs: [{ item: 'law rune', count: 1 }, { item: 'air rune', count: 5 }], run: (q) => ikov.guardian(q) },
        { from: 'helping', to: 'complete', needs: [{ item: 'shark', count: 3 }], run: (q) => ikov.killLucien(q, () => passes(q.sdk, 'complete')) },
    ],
});
