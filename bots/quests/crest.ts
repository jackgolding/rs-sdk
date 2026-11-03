/**
 * Family Crest — restore Dimintheis' crest from his three sons.
 *
 *   bun bots/quests/crest.ts {botname}
 *
 * Journal rules from quest_crest/scripts/crest_journal.rs2 (each stage's own lines;
 * earlier ones persist struck through). Dialog from quest_crest/scripts/*.rs2 and
 * area_alkharid/scripts/gem_trader.rs2. Caleb's hand-over offers "what happened to the
 * rest of it?" (which runs caleb_piece straight on to caleb_where) or "Thank you very
 * much": the run thanks him so caleb_piece is observed, then asks. Items:
 *   - shrimps, salmon, tuna, bass, swordfish   mule stock (cooked; Caleb's salad)
 *   - 2 rubies                                 mule stock (the gem stall restocks one a day)
 *   - ring mould, necklace mould               lib/sources.ts (Dommik, Al Kharid)
 *   - pickaxe                                  lib/sources.ts (Bob's bronze one at worst)
 *   - antipoison(3) ×4                         mule stock (Johnathon's cure; three for the poison spiders
 *                                              on the Chronozon leg)
 *   - air/water/earth/fire runes, death runes  lib/sources.ts (Betty; Aubury) — Chronozon's blasts
 *   - sharks ×28                               mule stock (8 for the mine, 20 for Chronozon) — hellhounds by the gold rocks; the
 *                                              Edgeville dungeon's wilderness (poison spiders,
 *                                              black demons, Chronozon)
 *   - perfect gold ore/bars/jewellery, the crest parts: the quest's own (carried on resume)
 * The mines, the furnace, Johnathon and Chronozon are lib/crest.ts.
 */
import { NeedsStock, runQuest, type Need, type Quest } from './lib/run-quest';
import { askBoot, assembleCrest, AVAN, CALEB, CHRON_ANTIPOISON, CHRON_SHARKS, cureJohnathon, DIMINTHEIS, FISH, FOOD, GEM_TRADER, holds, killChronozon, leaveDimintheis, makeJewellery, minePerfectGold, OBJ, RUNE_NEEDS, toJohnathon } from './lib/crest';

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', text: string, none: string[] = [], optional = false) => ({
    id,
    rule: { id: `crest:${id}`, kind, all: [text], none },
    optional,
});

const fish: Need[] = FISH.map((item) => ({ item, count: 1 }));
/**
 * Sharks from the bank at the prologue: FOOD for the mine, and the bank must also hold
 * CHRON_SHARKS for the Chronozon leg (topped up at Edgeville bank) or the run stops here
 * with NEEDS STOCK instead of walking in short. Mid-run (bank shut) nothing is claimed:
 * a claim would throw NeedsStock where the Edgeville top-up does the job.
 */
const food = (q: Quest, mine: boolean): Need[] => {
    if (!q.sdk.getState()?.bank?.isOpen) return [];
    const chron = holds(q, OBJ.johnathonPiece) || holds(q, OBJ.crest) ? 0 : CHRON_SHARKS;
    const want = chron + (mine ? FOOD.count : 0);
    const have = q.count('shark') + (q.sdk.findBankItem(/^shark$/i)?.count ?? 0);
    if (have < want) throw new NeedsStock([{ item: 'shark', count: want - have }]);
    return mine ? [FOOD] : [];
};
/** Rubies, moulds and a pickaxe until the perfect ring and necklace are made. */
const jewellery = (q: Quest): Need[] => {
    const ring = holds(q, OBJ.perfectRing);
    const necklace = holds(q, OBJ.perfectNecklace);
    if (ring && necklace) return [];
    const mined = q.count(/^'perfect' gold (ore|bar)$/i) + (ring ? 1 : 0) + (necklace ? 1 : 0);
    return [
        { item: 'ruby', count: (ring ? 0 : 1) + (necklace ? 0 : 1) },
        ...(ring ? [] : [{ item: 'ring mould', count: 1 }]),
        ...(necklace ? [] : [{ item: 'necklace mould', count: 1 }]),
        ...(mined >= 2 ? [] : [{ item: 'pickaxe', count: 1 }, ...food(q, true)]),
    ];
};
/**
 * Antipoison: one for Johnathon (he takes the whole potion) plus CHRON_ANTIPOISON for the
 * spiders round Chronozon. Only two ride from the prologue (the mine leg fills the pack:
 * its two ores need the slots); Edgeville bank tops the leg up to CHRON_ANTIPOISON. With
 * the bank open (the prologue) the whole count must be there or the run stops on NEEDS STOCK.
 */
const ANTIPOISON = { item: 'antipoison(3)', count: 2 };
const antipoisonStock = (q: Quest, want: number): void => {
    if (!q.sdk.getState()?.bank?.isOpen) return;
    const pots = /^antipoison\(\d\)$/i;
    const have = q.sdk.getInventory().filter((i) => pots.test(i.name)).length + q.sdk.getBankItems().filter((b) => pots.test(b.name)).reduce((n, b) => n + b.count, 0);
    if (have < want) throw new NeedsStock([{ item: ANTIPOISON.item, count: want - have }]);
};
/** The Chronozon leg's antipoison, checked (not withdrawn) at the prologue of a run past Johnathon. */
// Only Johnathon's antipoison is required (user, 2026-11-03: "it should be able to finish the quest
// with just 1"). The Chronozon leg runs under Protect from Melee, which zeroes the spiders' hits, and
// takes up to CHRON_ANTIPOISON only if the bank has them (lib/crest.ts stockForChronozon).
const legAntipoison = (_q: Quest): Need[] => [];
/**
 * Coins for the Al Kharid toll (four crossings), claimed only while the bank is open
 * (the prologue): a mid-run claim would pickpocket for coins the toll fetches itself.
 */
const coins = (q: Quest): Need[] => (q.sdk.getState()?.bank?.isOpen ? [{ item: 'coins', count: 100 }] : []);

await runQuest({
    id: 'crest',
    hub: 'varrock-west',
    skills: { mining: 40, crafting: 40, smithing: 40, magic: 59 },
    // The crest parts (779 Caleb's, 780 Avan's, 781 Johnathon's), the crest, and the
    // perfect gold made so far: a resumed run's naked prologue banks them.
    carry: [OBJ.calebPiece, OBJ.avanPiece, OBJ.johnathonPiece, OBJ.crest, OBJ.perfectRing, OBJ.perfectNecklace, OBJ.perfectBar, OBJ.perfectOre],
    journal: { label: 'Family Crest', title: 'Family Crest' },
    stages: [
        stage('unstarted', 'unstarted', 'I can start this quest by speaking to'),
        stage('spoken_dimintheis', 'active', 'I need to find his son'),
        stage('spoken_caleb', 'active', 'will let me have'),
        stage('caleb_piece', 'active', 'I need to find the other'),
        stage('caleb_where', 'active', 'is on a treasure hunt in the'),
        stage('spoken_gem_trader', 'active', 'Gem Trader told me that'),
        stage('spoken_avan', 'active', 'I should find a dwarf named'),
        stage('spoken_boot', 'active', 'will give me his crest piece if I can bring him'),
        stage('avan_piece', 'active', 'crest piece is with their brother'),
        // Struck through later as "Johnathan"; the live line spells it "Johnathon".
        stage('spoken_johnathon', 'active', 'Johnathon looking very ill'),
        stage('cured_johnathon', 'active', 'lost his piece of the family crest to a demon'),
        stage('complete', 'complete', 'QUEST COMPLETE'),
    ],
    transitions: [
        {
            from: 'unstarted',
            to: 'spoken_dimintheis',
            at: DIMINTHEIS,
            needs: coins,
            talk: { npc: /^dimintheis$/i, choices: [/ok, i will help you/i, /so where is this crest/i, /bold adventurer/i] },
            run: (q) => leaveDimintheis(q),
        },
        // The fish are carried from the start: "Ok, I will get those." ends this talk at spoken_caleb.
        { from: 'spoken_dimintheis', to: 'spoken_caleb', at: CALEB, needs: fish, talk: { npc: /^caleb$/i, choices: [/are you caleb/i, /can i have your bit/i, /ok, i will get those/i] } },
        { from: 'spoken_caleb', to: 'caleb_piece', at: CALEB, needs: fish, talk: { npc: /^caleb$/i, choices: [/thank you very much/i] } },
        { from: 'caleb_piece', to: 'caleb_where', at: CALEB, talk: { npc: /^caleb$/i, choices: [/what happened to the rest of it/i] } },
        { from: 'caleb_where', to: 'spoken_gem_trader', at: GEM_TRADER, needs: coins, talk: { npc: /^gem trader$/i, choices: [/avan fitzharmon/i] } },
        { from: 'spoken_gem_trader', to: 'spoken_avan', at: AVAN, talk: { npc: /^man$/i, choices: [/looking for a man named avan/i] } },
        { from: 'spoken_avan', to: 'spoken_boot', run: (q) => askBoot(q) },
        {
            from: 'spoken_boot',
            to: 'avan_piece',
            needs: (q) => [...coins(q), ...jewellery(q)],
            run: async (q) => {
                await minePerfectGold(q);
                await makeJewellery(q);
                await q.talk(/^man$/i, [], AVAN);
            },
        },
        {
            from: 'avan_piece',
            to: 'spoken_johnathon',
            needs: (q) => {
                antipoisonStock(q, 1);
                return [{ ...ANTIPOISON, count: 1 }, ...coins(q)];
            },
            run: async (q) => {
                await toJohnathon(q);
                await q.talk(/^johnathon$/i, []);
            },
        },
        { from: 'spoken_johnathon', to: 'cured_johnathon', needs: [{ item: ANTIPOISON.item, count: 1 }], run: (q) => cureJohnathon(q) },
        {
            from: 'cured_johnathon',
            to: 'complete',
            needs: (q) => (holds(q, OBJ.johnathonPiece) || holds(q, OBJ.crest) ? [] : [...RUNE_NEEDS, ...food(q, false), ...legAntipoison(q)]),
            run: async (q) => {
                await killChronozon(q);
                await assembleCrest(q);
                await q.talk(/^dimintheis$/i, [], DIMINTHEIS);
                await leaveDimintheis(q);
            },
        },
    ],
});
