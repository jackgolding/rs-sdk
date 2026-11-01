/**
 * Merlin's Crystal — free Merlin from Morgan Le Faye's crystal in Camelot.
 *
 *   bun bots/quests/merlins-crystal.ts {botname}
 *
 * Journal rules from quest_arthur/scripts/arthur_journal.rs2: each stage's own
 * line (earlier ones persist struck through, so every rule is a line no later
 * stage prints). Dialog and mechanics from quest_arthur/scripts/*.rs2 and the
 * Camelot, Catherby and Taverley npc scripts; the route is lib/merlins-crystal.ts.
 * Items:
 *   - shark ×6          mule stock — renegade knights (37) and Sir Mordred (39) in the keep
 *   - bread             mule stock — the beggar at the Port Sarim jeweller's (the Lady's test)
 *   - bat bones         lib/sources.ts (giant bats west of the keep) — summon Thrantax
 *   - bucket of wax     lib/sources.ts (insect repellent spawn + Catherby beehive, bucket from Arhein)
 *   - tinderbox         lib/sources.ts (Arhein) — light the black candle
 *   - black candle, Excalibur: the quest's own (the candle maker, the Lady of the Lake)
 * A sword the bank holds (rune → bronze scimitar/longsword/sword) is wielded for the keep.
 */
import { runQuest, type Need, type Quest } from './lib/run-quest';
import { ARTHUR, askLancelot, blackCandle, defeatMordred, FOOD, GAWAIN, getExcalibur, holdsName, JOURNAL, learnWords, shatterCrystal, summonThrantax } from './lib/merlins-crystal';
import { readJournalCheckpoint } from '../../quest-lab/journal-reader';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', text: string) => ({
    id,
    rule: { id: `arthur:${id}`, kind, all: [text] },
});

/** Stage 4's kit: what is not yet turned into the candle, the sword or the words. */
function thrantaxNeeds(q: Quest): Need[] {
    const lit = holdsName(q, /^lit black candle$/i);
    const candle = lit || holdsName(q, /^black candle$/i);
    return [
        { item: 'bat bones', count: 1 },
        ...(candle ? [] : [{ item: 'bucket of wax', count: 1 }]),
        ...(lit ? [] : [{ item: 'tinderbox', count: 1 }]),
        ...(holdsName(q, /^excalibur$/i) ? [] : [{ item: 'bread', count: 1 }]),
    ];
}

const boundRule = { id: 'arthur:bound', kind: 'active' as const, all: ['by using Excalibur on the crystal'] };

await runQuest({
    id: 'arthur',
    hub: 'catherby',
    carry: ['excalibur', 'black candle', 'lit black candle'],
    journal: JOURNAL,
    stages: [
        stage('unstarted', 'unstarted', 'I can start this quest by speaking to'),
        stage('started', 'active', 'I should ask the other Knights'),
        stage('gawain', 'active', 'think this was the work of'),
        stage('lancelot', 'active', 'way to enter with a delivery by sea'),
        stage('morgan', 'active', 'To bind Thrantax to my will'),
        { id: 'bound', rule: boundRule },
        stage('freed', 'active', 'Now that Merlin is freed'),
        stage('complete', 'complete', 'QUEST COMPLETE'),
    ],
    transitions: [
        { from: 'unstarted', to: 'started', at: ARTHUR, talk: { npc: /^king arthur$/i, choices: [/i want to become a knight of the round table/i] } },
        { from: 'started', to: 'gawain', at: GAWAIN, talk: { npc: /^sir gawain$/i, choices: [/how merlin got trapped/i, /thank you for the information/i] } },
        { from: 'gawain', to: 'lancelot', run: (q) => askLancelot(q) },
        { from: 'lancelot', to: 'morgan', needs: (q) => (q.count('shark') >= 2 ? [] : [FOOD]), run: (q) => defeatMordred(q) },
        {
            from: 'morgan',
            to: 'bound',
            needs: thrantaxNeeds,
            run: async (q) => {
                await blackCandle(q);
                await getExcalibur(q);
                await learnWords(q);
                await summonThrantax(q, async () => (await readJournalCheckpoint(q.sdk, JOURNAL, boundRule)).verdict?.verdict === 'PASS');
            },
        },
        { from: 'bound', to: 'freed', run: (q) => shatterCrystal(q) },
        { from: 'freed', to: 'complete', at: ARTHUR, talk: { npc: /^king arthur$/i } },
    ],
});
