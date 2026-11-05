/**
 * Underground Pass — through the pass under the mountains to Iban, and back to King Lathas (quest id upass).
 *
 *   bun bots/quests/underground-pass.ts {botname}
 *
 * Needs Biohazard (the cave refuses you before it; the West Ardougne wall doors open after it) and
 * Ranged 25 base (king_lathas.rs2). A Legends' Quest prerequisite. Journal rules from
 * quest_upass/scripts/upass_journal.rs2: every finished stage persists struck through (@str@), so
 * each stage keys on the newest struck line. Stage 0 has two texts (the started bit, ibanmulti 11).
 * confronted_iban (8) prints the same text as a finished doll, so it is not a stage here; the doll's
 * four parts are separate journal lines and are taken in a fixed order (shadow, dove, ashes, blood),
 * each step skipping a part the journal already shows.
 * Items:
 *   - bow, bronze arrow ×5   lib/sources.ts (Chadwell's longbow in West Ardougne; Aemad's arrows)
 *   - tinderbox, rope ×2, spade, bucket   lib/sources.ts — arrow light, the swing, the mud, the brew
 *   - melee weapon           mule stock — paladins, demons, Kalrag, a disciple
 *   - shark ×19              mule stock — traps, falls, the fights, Iban's bolts
 *   - the cloth, orbs, railing, horn, badges, cat, doll and its parts, robes: the quest's own
 * Route and mechanics: lib/underground-pass.ts.
 */
import { runQuest, type Need, type Quest } from './lib/run-quest';
import {
    ashesStep,
    bloodStep,
    crossTheChasm,
    defeatIban,
    destroyOrbs,
    doveStep,
    feedWell,
    JOURNAL,
    killUnicorn,
    meetDwarfs,
    meetKoftik,
    reportToLathas,
    shadowStep,
    startQuest,
    stealDoll,
} from './lib/underground-pass';

const stage = (
    id: string,
    kind: 'unstarted' | 'active' | 'complete',
    all: string[],
    more: { none?: string[]; rawAll?: string[]; rawNone?: string[] } = {}
) => ({ id, rule: { id: `upass:${id}`, kind, all, ...more } });

/** 19 leaves room for the quest's hand-outs (Kardia's chest is four items) beside the kit. */
const FOOD = 19;
/**
 * The kit is gathered before the first in-pass step; once a step has begun the needs fall away, so
 * a spent rope or an eaten shark never sends a run from Iban's cavern to a shop. Every in-pass
 * stage walks in from the entrance (bridge, swing, grid, mud), so a resumed run needs it all again.
 */
let underway = false;
const step = (fn: (q: Quest) => Promise<void>) => async (q: Quest) => {
    underway = true;
    await fn(q);
};
const kit = (q: Quest): Need[] =>
    underway
        ? []
        : [
              { item: 'bow', count: 1 },
              { item: 'bronze arrow', count: 5 },
              { item: 'tinderbox', count: 1 },
              { item: 'rope', count: 2 },
              { item: 'spade', count: 1 },
              // The brew's bucket, until the ashes are on the doll.
              ...(['ashes', 'blood', 'defeated'].includes(q.stage) ? [] : [{ item: 'bucket', count: 1, or: 'dwarf brew' }]),
              { item: 'melee weapon', count: 1 },
              { item: 'shark', count: q.level('magic') >= 37 ? FOOD - 6 : FOOD - 3 }, // teleport runes, plus carried quest items (dwarf brew, doll of Iban) and the weapon: 16 left no slot for the water rune (jacklove7, 2026-11-05); Jackpoo5 overflowed at 28 (2026-11-04)
              // Falador Teleport (lib/underground-pass.ts teleportOut): a resumed run in a pocket with no
              // walk out (C8, by the paladins' well) is otherwise stranded (jacklove2, 2026-11-04).
              ...(q.level('magic') >= 37
                  ? [
                        { item: 'law rune', count: 1 },
                        { item: 'air rune', count: 3 },
                        { item: 'water rune', count: 1 },
                    ]
                  : []),
          ];

await runQuest({
    id: 'upass',
    hub: 'ardougne',
    skills: { ranged: 25 },
    maxConcurrent: 2,
    carry: ['doll of iban', 'dwarf brew', "iban's shadow", "iban's dove", "iban's ashes"],
    journal: JOURNAL,
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
        stage('started', 'active', [], { rawAll: ['@dbl@King Lathas asked me to meet a tracker named'] }),
        stage('koftik', 'active', [], { rawAll: ['@str@King Lathas asked me to meet a tracker named'] }),
        stage('bridge', 'active', [], { rawAll: ['@str@I managed to cross the bridge by shooting'] }),
        stage('well', 'active', [], { rawAll: ['@str@After destroying four orbs'] }),
        stage('unicorn', 'active', [], { rawAll: ['@str@Something is watching me'] }),
        stage('cavern', 'active', [], { rawAll: ['@str@I have found yet another well'] }),
        stage('dwarfs', 'active', [], { rawAll: ['@str@I have seen Koftik again'] }),
        stage('doll', 'active', [], { rawAll: ['@str@I have met some dwarfs living here'] }),
        stage('shadow', 'active', ['Collecting Shadow was tough']),
        stage('dove', 'active', ['Collecting Shadow was tough', 'After searching some cages I found']),
        stage('ashes', 'active', ['Collecting Shadow was tough', 'After searching some cages I found', 'Having burned Iban']),
        stage('blood', 'active', ['I have completed the doll']),
        stage('defeated', 'active', ['into the Well of the Damned']),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        { from: 'unstarted', to: 'started', run: startQuest },
        { from: 'started', to: 'koftik', needs: kit, run: meetKoftik },
        { from: 'koftik', to: 'bridge', needs: kit, run: step(crossTheChasm) },
        { from: 'bridge', to: 'well', needs: kit, run: step(destroyOrbs) },
        { from: 'well', to: 'unicorn', needs: kit, run: step(killUnicorn) },
        { from: 'unicorn', to: 'cavern', needs: kit, run: step(feedWell) },
        { from: 'cavern', to: 'dwarfs', needs: kit, run: step(meetDwarfs) },
        { from: 'dwarfs', to: 'doll', needs: kit, run: step(stealDoll) },
        { from: 'doll', to: 'shadow', needs: kit, run: step(shadowStep) },
        { from: 'shadow', to: 'dove', needs: kit, run: step(doveStep) },
        { from: 'dove', to: 'ashes', needs: kit, run: step(ashesStep) },
        { from: 'ashes', to: 'blood', needs: kit, run: step(bloodStep) },
        { from: 'blood', to: 'defeated', needs: kit, run: step(defeatIban) },
        { from: 'defeated', to: 'complete', run: step(reportToLathas) },
    ],
});
