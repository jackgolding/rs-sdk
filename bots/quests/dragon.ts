/**
 * Dragon Slayer — Oziach's three map pieces, the Lady Lumbridge, Elvarg.
 *
 *   bun bots/quests/dragon.ts {botname}
 *
 * Journal rules from quest_dragon/scripts/dragon_journal.rs2 (each stage's own
 * line; the map-piece and shield lines follow the inventory, so they are not
 * stages). Needs 32 QP for the Champions' Guild door. Elvarg (level 83): Attack 60
 * and Lost City complete for the dragon longsword, Prayer 43 for Protect from
 * Melee, Magic 31 for Lumbridge Teleport home — none of these has a trainer, so
 * the run stops on a skill gate before walking anywhere. Items:
 *   - mind bomb, lobster pot, silk, unfired bowl   lib/sources.ts (Tostig, Gerrant, Thessalia; clay on
 *                                                  Barbarian Village's wheel) — the Ice Mountain door
 *   - plank                                        lib/sources.ts (Barbarian Outpost spawns); hammer too
 *   - nails                                        the Jackpoo2 mule (smithed from steel bars)
 *   - dragon longsword                             own bank, else the jacklove4 mule
 *   - 20 sharks, law rune                          own bank (mule lines), checked at the hub up front
 *   - air/earth runes                              lib/sources.ts (Betty)
 *   - coins                                        2000 for the ship, 10,000 for Wormbrain's piece
 *   - Dragonfire shield                            banked, else the Duke (Lumbridge castle)
 *   - Maze key, map parts                          quest items, carried on resume
 * The fight is its own phase: ned → sailed kits up at the hub bank (sword and
 * shield worn, sharks, teleport runes), then sails; sailed → complete is Elvarg.
 * Locations and the maze route are lib/dragon-slayer.ts.
 */
import { NeedsStock, runQuest, type Quest } from './lib/run-quest';
import { SOURCES, type Need } from './lib/sources';
import {
    ELVARG_KIT,
    MAZE_PART,
    ORACLE_PART,
    OZIACH,
    SHIP_REPAIR,
    WORMBRAIN_PART,
    buyShip,
    crandorMap,
    hireNed,
    kitUp,
    onCrandor,
    repairShip,
    sailToCrandor,
    slayElvarg,
    talkGuildmaster,
    talkOziach,
} from './lib/dragon-slayer';

const ORDER = ['unstarted', 'guildmaster', 'oziach', 'instructed', 'bought_ship', 'repaired', 'ned', 'sailed', 'complete'];
const before = (q: Quest, stage: string) => ORDER.indexOf(q.stage) < ORDER.indexOf(stage);
const bankOpen = (q: Quest) => !!q.sdk.getState()?.bank?.isOpen;

/** Held, worn or (the prologue's bank open) banked. */
function stock(q: Quest, item: string | number): number {
    const match = (i: { id: number; name: string }) => (typeof item === 'number' ? i.id === item : i.name.toLowerCase() === item.toLowerCase());
    const bank = bankOpen(q) ? q.sdk.getBankItems().filter(match).reduce((n, i) => n + i.count, 0) : 0;
    return bank + q.sdk.getInventory().filter(match).reduce((n, i) => n + i.count, 0) + q.sdk.getEquipment().filter(match).length;
}

const MAP_DOOR_ITEMS: Need[] = [
    { item: "wizard's mind bomb", count: 1 },
    { item: 'unfired bowl', count: 1 },
    { item: 'lobster pot', count: 1 },
    { item: 'silk', count: 1 },
];

/** Every mule-stocked line the rest of the quest uses, from the journal stage and what is held or banked. */
function muleStock(q: Quest): Map<string, number> {
    const want = new Map<string, number>();
    const add = (n: Need) => want.set(n.item, (want.get(n.item) ?? 0) + n.count);
    [...ELVARG_KIT, { item: 'dragon longsword', count: 1 }].forEach(add);
    if (before(q, 'repaired') || (q.stage === 'sailed' && !onCrandor(q))) SHIP_REPAIR.forEach(add);
    if (before(q, 'ned') && stock(q, 'crandor map') < 1) {
        // The maze's food comes on top of Elvarg's 20.
        if (stock(q, MAZE_PART) < 1) add({ item: 'shark', count: 10 });
        if (stock(q, ORACLE_PART) < 1) MAP_DOOR_ITEMS.forEach(add);
    }
    return new Map([...want].filter(([item]) => SOURCES[item]?.mule));
}

/**
 * Mule-stocked needs are claimed only by the prologue (the bank open), where the
 * whole quest's mule stock is checked first: a short account stops with NEEDS
 * STOCK at the hub, not on Crandor. Mid-quest (a retry after the door or the hole
 * has eaten some) they are not claimed again. Sourced needs always count.
 */
function live(q: Quest, needs: Need[]): Need[] {
    // A line a serving mule supplies (Source.muleSupply) stays: the prepare phase asks that mule.
    const asked = (item: string) => !!SOURCES[item]?.muleSupply;
    if (!bankOpen(q)) return needs.filter((n) => !SOURCES[n.item]?.mule || asked(n.item));
    const short = [...muleStock(q)]
        .filter(([item, count]) => !asked(item) && stock(q, item) < count)
        .map(([item, count]) => ({ item, count: count - stock(q, item) }));
    if (short.length) throw new NeedsStock(short);
    return needs;
}

/** The longsword, unless worn (the maze's fights wear it; kitUp takes it off the bank again). */
const sword = (q: Quest): Need[] => (q.sdk.getEquipment().some((e) => /^dragon longsword$/i.test(e.name)) ? [] : [{ item: 'dragon longsword', count: 1 }]);

/** The map: each piece's own needs until it is held (or the map is). */
function mapNeeds(q: Quest): Need[] {
    if (stock(q, 'crandor map') > 0) return live(q, []);
    const needs: Need[] = [];
    // Worn through the maze; the fight's kit takes it from the bank again.
    if (stock(q, MAZE_PART) < 1) needs.push({ item: 'shark', count: 10 }, ...sword(q));
    if (stock(q, WORMBRAIN_PART) < 1) needs.push({ item: 'coins', count: 10_000 + (before(q, 'bought_ship') ? 2000 : 0) });
    if (stock(q, ORACLE_PART) < 1) needs.push(...MAP_DOOR_ITEMS);
    return live(q, needs);
}

const stage = (id: string, kind: 'unstarted' | 'active' | 'complete', all: string[], optional = false) => ({
    id,
    rule: { id: `dragon:${id}`, kind, all },
    optional,
});

await runQuest({
    id: 'dragon',
    hub: 'draynor',
    skills: { attack: 60, prayer: 43, magic: 31 },
    carry: ['maze key', MAZE_PART, WORMBRAIN_PART, ORACLE_PART, 'crandor map', 'dragonfire shield'],
    journal: { label: 'Dragon Slayer', title: 'Dragon Slayer' },
    stages: [
        stage('unstarted', 'unstarted', ['I can start this quest by speaking to the']),
        stage('guildmaster', 'active', ['who lives by the cliffs to the']),
        // Oziach's one dialog runs through this into "instructed" when every question is asked.
        stage('oziach', 'active', ['for more detailed instructions'], true),
        stage('instructed', 'active', ['for sale in']),
        stage('bought_ship', 'active', ['before it is seaworthy again', 'I still need to find a']),
        stage('repaired', 'active', ['I have repaired my ship', 'I still need to find a']),
        stage('ned', 'active', ['Now I should go to my ship in']),
        stage('sailed', 'active', ['Now all I need to do is kill the']),
        stage('complete', 'complete', ['QUEST COMPLETE']),
    ],
    transitions: [
        { from: 'unstarted', to: 'guildmaster', needs: (q) => live(q, []), run: talkGuildmaster },
        { from: 'guildmaster', to: 'oziach', needs: (q) => live(q, []), run: talkOziach },
        { from: 'oziach', to: 'instructed', at: OZIACH, needs: (q) => live(q, []), run: talkOziach },
        { from: 'instructed', to: 'bought_ship', needs: (q) => live(q, [{ item: 'coins', count: 2000 }]), run: buyShip },
        { from: 'bought_ship', to: 'repaired', needs: (q) => live(q, SHIP_REPAIR), run: repairShip },
        {
            from: 'repaired',
            to: 'ned',
            needs: mapNeeds,
            run: async (q) => {
                await crandorMap(q);
                await hireNed(q);
            },
        },
        // The fight's phase: kit up at the hub bank, then sail.
        {
            from: 'ned',
            to: 'sailed',
            needs: (q) => live(q, sword(q)),
            run: async (q) => {
                await kitUp(q);
                await sailToCrandor(q);
            },
        },
        {
            from: 'sailed',
            to: 'complete',
            // Off Crandor (a teleport or a death after the wreck): the repairs and Ned's hire reset with the trip.
            needs: (q) => live(q, q.stage !== 'sailed' || onCrandor(q) ? [] : [...SHIP_REPAIR, ...sword(q)]),
            run: async (q) => {
                if (!onCrandor(q)) {
                    await kitUp(q, [/^plank$/i, /^nails$/i, /^hammer$/i]);
                    await hireNed(q);
                    await repairShip(q, true);
                    await sailToCrandor(q);
                }
                await slayElvarg(q);
            },
        },
    ],
});
