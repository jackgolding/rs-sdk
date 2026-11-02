/**
 * The Fremennik Trials — seven council votes for Chieftain Brundt.
 *
 *   bun bots/quests/fremennik-trials.ts {botname}
 *
 * Journal rules from quest_viking/scripts/viking_journal.rs2: each trial adds an
 * "I now have the <role>'s vote at the council" line, and the stages below are
 * cumulative (a stage needs every earlier vote too), so an account that did some
 * trials out of this order resumes at the first one missing. Needs Woodcutting 40,
 * Crafting 40 and Fletching 25 (trained in the prologue, lib/training.ts). Items:
 *   - axe, knife, cabbage, potato, onion, tinderbox, beer   lib/sources.ts
 *   - raw shark, sharks                                      mule stock
 *   - coins                                                  the Reveller's keg, Askeladden's note
 *   - trial items (pet rock, fleece, lyre, talisman, kegs, the merchant's goods): carried on resume
 * The trials themselves are lib/fremennik.ts (ported from the verified pre-runner script).
 */
import { runQuest } from './lib/run-quest';
import { runStage } from './lib/fremennik';

const VOTE = {
    peer: "I now have the Seer's vote at the council",
    olaf: "I now have the Bard's vote at the council",
    sigli: "I now have the Hunter's vote at the council",
    reveller: "I now have the Reveller's vote at the council",
    swensen: "I now have the Navigator's vote at the council",
    sigmund: "I now have the Merchant's vote at the council",
    thorvald: "I now have the Warrior's vote at the council",
};
/** The merchant chain's goods (viking.obj): holding any means the note is already bought. */
const MERCHANT_GOODS = /promissory note|legendary cocktail|champions token|sturdy boots|fremennik ballad|exotic flower|weather forecast|sea fishing map|custom bow string|unusual fish|hunters map|fiscal statement|warriors' contract/i;
const ORDER = ['peer', 'olaf', 'sigli', 'reveller', 'swensen', 'sigmund', 'thorvald'] as const;
const votesThrough = (trial: (typeof ORDER)[number]) => ORDER.slice(0, ORDER.indexOf(trial) + 1).map((t) => VOTE[t]);

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[]) => ({ id, rule: { id: `viking:${id}`, kind, all } });

const trial = (from: string, to: (typeof ORDER)[number], needs: Array<{ item: string; count: number }> = []) => ({
    from,
    to,
    needs,
    run: (q: Parameters<typeof runStage>[0]) => runStage(q, to),
});

await runQuest({
    id: 'viking',
    // Swarm accounts rotating through the trials held all 3 default slots (2026-11-02).
    maxConcurrent: 5,
    hub: 'catherby',
    skills: { woodcutting: 40, crafting: 40, fletching: 25 },
    retries: 6,
    carry: [
        'pet rock',
        'golden fleece',
        'golden wool',
        'branch',
        'unstrung lyre',
        'lyre',
        'enchanted lyre',
        "hunters' talisman",
        'keg of beer',
        'low alcohol keg',
        'strange object',
        // The merchant chain's goods, so a resumed trade-back still has its next item.
        'promissory note',
        'legendary cocktail',
        'champions token',
        'warriors\' contract',
        'weather forecast',
        'sea fishing map',
        'unusual fish',
        'custom bow string',
        'hunters map',
        'sturdy boots',
        'fremennik ballad',
        'exotic flower',
        'fiscal statement',
    ],
    journal: { label: 'The Fremennik Trials', title: 'The Fremennik Trials' },
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by speaking to Chieftain Brundt']),
        stage('started', 'active', ['I spoke to Brundt the Fremennik chieftan']),
        ...ORDER.map((t) => stage(t, 'active', votesThrough(t))),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        { from: 'unstarted', to: 'started', run: (q) => runStage(q, 'start') },
        trial('started', 'peer'),
        {
            ...trial('peer', 'olaf'),
            // What is still ahead of Olaf's chain: a resumed run that holds the fleece
            // must not go back for stew vegetables.
            needs: (q) => {
                const has = (...items: string[]) => items.some((i) => q.count(i) > 0);
                const lyreDone = has('lyre', 'enchanted lyre');
                return [
                    ...(lyreDone ? [] : [{ item: 'axe', count: 1 }, { item: 'knife', count: 1 }]),
                    ...(has('golden fleece', 'golden wool', 'unstrung lyre') || lyreDone ? [] : [{ item: 'cabbage', count: 1 }, { item: 'potato', count: 1 }, { item: 'onion', count: 1 }]),
                    ...(has('enchanted lyre') ? [] : [{ item: 'raw shark', count: 1 }]),
                ];
            },
        },
        {
            ...trial('olaf', 'sigli'),
            // Stocked at the prologue; the Draugen hunt tops its food up from the bank itself.
            needs: (q) => (q.sdk.getState()?.bank?.isOpen ? [{ item: 'shark', count: 6 }] : []),
        },
        trial('sigli', 'reveller', [
            { item: 'beer', count: 1 },
            { item: 'tinderbox', count: 1 },
            { item: 'coins', count: 300 },
        ]),
        trial('reveller', 'swensen'),
        {
            ...trial('swensen', 'sigmund'),
            // Askeladden's note is 5000; at the prologue take enough for the Reveller's keg
            // on top, or the run is short at Sigmund and pickpockets the difference.
            // A retry that already bought the note (the trade-back is what is left, the note
            // itself possibly traded on already) needs no coins.
            needs: (q) =>
                q.sdk.getInventory().some((i) => MERCHANT_GOODS.test(i.name)) ? [] : [{ item: 'coins', count: q.sdk.getState()?.bank?.isOpen ? 5600 : 5000 }],
        },
        trial('sigmund', 'thorvald'),
        {
            from: 'thorvald',
            to: 'complete',
            run: async (q) => {
                await q.talk(/^brundt the chieftain$|brundt/i, [], { x: 2658, z: 3669 });
            },
        },
    ],
});
