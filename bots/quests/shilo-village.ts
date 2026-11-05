/**
 * Shilo Village — Rashiliyia's remains laid to rest beside her son's (quest id zombiequeen).
 *
 *   bun bots/quests/shilo-village.ts {botname}
 *
 * Needs Jungle Potion (mosol_rei.rs2), Agility 32 (the fissure, the crawl), Crafting 20 (the bone
 * key; the beads need 15/16) and Prayer 10 (only for the locating crystal, which this route never
 * uses). Journal rules from quest_zombiequeen/scripts/zombiequeen_journal.rs2: each stage's own
 * @dbl@ line, since every earlier one persists struck through (`raw*` patterns tell them apart).
 * Varps 7-9 print one block until Bervirius' dolmen is searched ('cavern'), so that transition
 * keys its parts on the items held. Stage 3 (mound searched) is optional: the spade digs from 1.
 * Items:
 *   - coins           lib/sources.ts — the Brimhaven boats both ways (lib/jungle-potion.ts)
 *   - spade, chisel   lib/sources.ts — the mound; the pommel, the bone shard
 *   - lit candle      lib/sources.ts (Catherby candle maker + tinderbox) — dropped into the fissure
 *   - rope            lib/sources.ts (Ned) — tied in the fissure
 *   - bones ×3        lib/sources.ts (chickens) — the tomb door's recesses
 *   - bronze wire     mule stock (Smithing 4 from a bronze bar) — the Beads of the Dead
 *   - shark ×14       mule stock — Ah Za Rhoon's undead, Cairn's bridge; before Rashiliyia's tomb
 *                     lib readyForTomb sails home and tops up to 20 (bank, then jackthief) when
 *                     under 12 are left, and re-prays at the arena altar (Prayer 43+)
 *   - lost on a death  the beads: Bervirius' dolmen hands out another pommel (chisel + wire from the
 *                     bank); the remains: the tomb dolmen wakes Nazastarool again
 *   - melee weapon    the best banked (lib/sources.ts GROUPS), else NEEDS STOCK
 *   - the belt, scrolls, Zadimus, the shard/key, pommel/beads, the corpse: the quest's own
 * Route and mechanics: lib/shilo-village.ts.
 */
import { runQuest, type Need, type Quest } from './lib/run-quest';
import { FARE, onIslandNow } from './lib/jungle-potion';
import {
    ahZaRhoonAndBervirius,
    descendFissure,
    digMound,
    enterWithBeads,
    fightNazastarool,
    fillBoneDoor,
    findBoneDoor,
    layToRest,
    lightFissure,
    ropeFissure,
    startQuest,
    unlockDoor,
    wieldWeapon,
} from './lib/shilo-village';

const stage = (
    id: string,
    kind: 'unstarted' | 'active' | 'complete',
    all: string[],
    more: { none?: string[]; rawAll?: string[]; rawNone?: string[] } = {}
) => ({ id, rule: { id: `zombiequeen:${id}`, kind, all, ...more } });

/** 14 leaves one slot free at the pack's fullest (Bervirius' dolmen adds three items at once). */
const FOOD = 14;
/**
 * Everything is gathered before the first transition (prologue, prepare, its ensure); once a step
 * has begun the needs fall away, so eaten sharks, used bones and spent candles never send a run
 * from inside a dungeon to a shop. A step missing an item it needs says so itself.
 */
let underway = false;
const ARMOUR = /^(dragonhide body|dragonhide chaps|dragon vambraces|berserker helm|dragonfire shield|amulet of strength)$/i;
const begin = async (q: Quest) => {
    underway = true;
    await wieldWeapon(q);
    for (const it of q.sdk.getInventory().filter((i) => ARMOUR.test(i.name))) {
        await q.bot.equipItem(it).catch(() => undefined);
    }
};

/** Both fares from the mainland; once on Karamja, the fare home. */
const coins = (q: Quest): Need[] => [{ item: 'coins', count: onIslandNow(q) ? FARE : 2 * FARE }];
const kit = (q: Quest, ...more: Need[]): Need[] =>
    underway ? [] : [...coins(q), { item: 'melee weapon', count: 1 }, { item: 'shark', count: FOOD }, ...more];
const SPADE: Need = { item: 'spade', count: 1 };
const CANDLE: Need = { item: 'lit candle', count: 1 };
const ROPE: Need = { item: 'rope', count: 1 };
const CHISEL: Need = { item: 'chisel', count: 1 };
/** A resumed run holding (or banking) the finished beads needs no wire. */
const WIRE: Need = { item: 'bronze wire', count: 1, or: 'beads of the dead' };
const BONES: Need = { item: 'bones', count: 3 };

const step = (fn: (q: Quest) => Promise<void>) => async (q: Quest) => {
    await begin(q);
    await fn(q);
};

await runQuest({
    id: 'zombiequeen',
    hub: 'ardougne',
    // Mosol Rei hands out the Wampum belt only after Jungle Potion (ABGARMY17 talked to him 3× for nothing, 2026-11-05).
    requires: ['Jungle Potion'],
    skills: { agility: 32, crafting: 20 },
    carry: [
        'wampum belt',
        'zadimus corpse',
        'bone shard',
        'bone key',
        'tattered scroll',
        'crumpled scroll',
        'sword pommel',
        'bone beads',
        'beads of the dead',
        'rashiliya corpse',
        // Armour, worn at the first step (the guide: "wear all your armour"; jacklove5 and
        // ABGARMY07 died at the tomb door in only a longsword, 2026-11-03). Whatever is banked.
        'dragonhide body',
        'dragonhide chaps',
        'dragon vambraces',
        'berserker helm',
        'dragonfire shield',
        'amulet of strength',
    ],
    journal: { label: 'Shilo Village', title: 'Shilo Village' },
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by speaking to']),
        stage('started', 'active', [], { rawAll: ["@dbl@I need to find the location of '"] }),
        { ...stage('searched', 'active', [], { rawAll: ["@dbl@I've found a @dre@mound of earth"] }), optional: true },
        stage('dug', 'active', [], { rawAll: ['@dbl@After using the spade'] }),
        stage('lit', 'active', ['perhaps this fissure could be the way in']),
        stage('roped', 'active', ['perhaps this rope down this fissure']),
        stage('cavern', 'active', ['if I could identify the cavern it would help a lot']),
        stage('notes', 'active', [], { rawAll: ["@dbl@I need to look for @dre@Rashiliyia's@dbl@ final @dre@resting place"], rawNone: ['suitable @dre@key'] }),
        stage('door', 'active', [], { rawAll: ['suitable @dre@key'] }),
        stage('unlocked', 'active', ["I'd better search it thoroughly"], { rawNone: ["@str@I've made a necklace"] }),
        stage('beads', 'active', ["I'd better search it thoroughly"], { rawAll: ["@str@I've made a necklace"] }),
        stage('tombdoor', 'active', ['placed three bones in each of the'], { rawNone: ['@str@after an epic battle'] }),
        stage('corpse', 'active', [], { rawAll: ['@str@after an epic battle'] }),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        { from: 'unstarted', to: 'started', needs: (q) => kit(q, SPADE, CANDLE, ROPE, CHISEL, WIRE, BONES), run: step(startQuest) },
        { from: 'started', to: 'dug', needs: (q) => kit(q, SPADE, CANDLE, ROPE, CHISEL, WIRE, BONES), run: step(digMound) },
        { from: 'searched', to: 'dug', needs: (q) => kit(q, SPADE, CANDLE, ROPE, CHISEL, WIRE, BONES), run: step(digMound) },
        { from: 'dug', to: 'lit', needs: (q) => kit(q, CANDLE, ROPE, CHISEL, WIRE, BONES), run: step(lightFissure) },
        { from: 'lit', to: 'roped', needs: (q) => kit(q, ROPE, CHISEL, WIRE, BONES), run: step(ropeFissure) },
        { from: 'roped', to: 'cavern', needs: (q) => kit(q, CHISEL, WIRE, BONES), run: step(descendFissure) },
        { from: 'cavern', to: 'notes', needs: (q) => kit(q, CHISEL, WIRE, BONES), run: step(ahZaRhoonAndBervirius) },
        { from: 'notes', to: 'door', needs: (q) => kit(q, CHISEL, WIRE, BONES), run: step(findBoneDoor) },
        { from: 'door', to: 'unlocked', needs: (q) => kit(q, CHISEL, WIRE, BONES), run: step(unlockDoor) },
        { from: 'unlocked', to: 'beads', needs: (q) => kit(q, CHISEL, WIRE, BONES), run: step(enterWithBeads) },
        { from: 'beads', to: 'tombdoor', needs: (q) => kit(q, BONES), run: step(fillBoneDoor) },
        { from: 'tombdoor', to: 'corpse', needs: (q) => kit(q), run: step(fightNazastarool) },
        { from: 'corpse', to: 'complete', needs: (q) => kit(q), run: step(layToRest) },
    ],
});
