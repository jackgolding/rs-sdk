/**
 * Item sources — how any quest gets an ordinary item it needs.
 *
 * One entry per item, shared by every quest. `inputs` lets the hub prologue
 * withdraw what a source consumes (shears to make wool) in the same bank visit;
 * `get` is the procedure that produces the item when the bank had none.
 * Items a quest must obtain through its own step (e.g. a quest key the game
 * records you picking up) are not sources — leave them to the transition, or
 * mark them `spawnable: false` so assisted runs never fake them.
 */
import type { Quest } from './run-quest';
import { combine, cookAtPalaceRange, fetchJugOfWater, makeDough } from './cooking';
import { mineAtRimmington, mineBlurite, mineRuneEssence, ROCKS, type Ore } from './mining';
import { tickNow, ticksToMs, untilTicks } from './ticks';
import { closeUi } from '../movement';
import { driveDialog } from './dialog';
import { manorSpade, oilCan, pressureGauge, rubberTube } from './draynor-manor';
import { dramenStaff } from './lost-city';
import { buyGroceries, HECKEL_FUNCH } from './gnome-stronghold';
import { beehiveWax } from './merlins-crystal';

export interface Need {
    /** Item name as the game shows it, e.g. 'ball of wool'. */
    item: string;
    count: number;
    /**
     * The quest-processed form of `item` that also satisfies the need, e.g.
     * 'enchanted beef' for 'raw beef'. A resumed run holding it must not go
     * hunting for the raw item again; the prologue withdraws it like the item.
     */
    or?: string;
    /** How many of `or` satisfy the need, when not `count` (three balls of wool or one wig). */
    orCount?: number;
}

export function needMet(q: Pick<Quest, 'count'>, need: Need): boolean {
    return q.count(need.item) >= need.count || (need.or != null && q.count(need.or) >= (need.orCount ?? need.count));
}

export interface Source {
    /** Obj debugname for assisted spawns when it differs from the snake_cased item name. */
    obj?: string;
    /** False for items whose acquisition the quest itself tracks. Default true. */
    spawnable?: boolean;
    /**
     * A tool: held once however many sources list it as an input (shears, a
     * pickaxe). Every other input is consumed, so the prologue adds up what
     * each source claims (two dyes at 5 coins each withdraw 10, not 5).
     */
    tool?: boolean;
    /** What producing `count` consumes, for the prologue's bank withdrawal. */
    inputs?: (count: number) => Need[];
    /**
     * Supplied to the account's bank by a mule before the quest runs (a separate
     * stocking job: bots/quests/give-item.ts / quest-mule.ts), never produced by a
     * source. The prologue withdraws it like any banked need; a shortfall stops the
     * run with NEEDS STOCK (exit 4) before any walking — the account needs stock,
     * the quest script did not fail. Assisted runs still spawn it.
     */
    mule?: boolean;
    /**
     * A mule account running quest-mule.ts that serves this item, at its bank
     * (supply.ts muleBank: Draynor, jackthief at Ardougne). The prepare phase DMs it
     * once for every short line it serves and takes the trade; whatever it has not
     * handed over in time is sourced by `get` as usual. A list is tried in order:
     * what the first mule could not hand over is asked of the next.
     */
    muleSupply?: string | string[];
    /** Skill levels `get` needs; the runner trains them first (lib/training.ts). */
    levels?: Record<string, number>;
    /** Produce until holding `count` in total. */
    get?: (q: Quest, count: number) => Promise<void>;
}

/** Source.muleSupply as a list, in the order the prepare phase asks them. */
export function mulesFor(item: string): string[] {
    const by = SOURCES[item]?.muleSupply;
    return by ? (Array.isArray(by) ? by : [by]) : [];
}

/**
 * Mule-only lines Jackpoo2 runs out of: jackthief (the max-stat mule at the Ardougne bank)
 * banks them in bulk (bots/quests/mule-produce.ts smiths the nails and buys the bread, and
 * restocks Jackpoo2 by trade), so a quester Jackpoo2 cannot serve asks jackthief next instead
 * of stopping with NEEDS STOCK. Draynor first: most of these quests start there.
 */
// jackthief took over Jackpoo2's mule stock (2026-11-02); Jackpoo2 went thieving.
const JACKPOO2_THEN_JACKTHIEF = ['jackthief'];

/** Exact, case-insensitive name match ('wool' must not match 'ball of wool'). */
export function itemPattern(item: string): RegExp {
    return new RegExp(`^${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

/**
 * Needs any one of several items will satisfy, best first, each with the skill
 * level it takes to use. `q.count('pickaxe')` counts the usable ones held or worn;
 * the prologue withdraws the best usable one the bank has.
 */
export const GROUPS: Record<string, Array<{ item: string; skill: string; level: number }>> = {
    pickaxe: [
        { item: 'rune pickaxe', skill: 'mining', level: 41 },
        { item: 'adamant pickaxe', skill: 'mining', level: 31 },
        { item: 'mithril pickaxe', skill: 'mining', level: 21 },
        { item: 'steel pickaxe', skill: 'mining', level: 6 },
        { item: 'iron pickaxe', skill: 'mining', level: 1 },
        { item: 'bronze pickaxe', skill: 'mining', level: 1 },
    ],
    /** Nature Spirit: worn for Filliman, so a worn one counts. */
    'ghostspeak amulet': [{ item: 'ghostspeak amulet', skill: 'defence', level: 1 }],
    /** Witch's House: worn for the cellar's shock gate, so worn ones count. */
    'leather gloves': [{ item: 'leather gloves', skill: 'defence', level: 1 }],
    /** Lost City: wielded for the shed door, so a worn staff counts. */
    'dramen staff': [{ item: 'dramen staff', skill: 'attack', level: 1 }],
    /** Fight Arena's magic kit: a staff that is an endless fire rune source. */
    'fire staff': [
        { item: 'fire battlestaff', skill: 'magic', level: 30 },
        { item: 'staff of fire', skill: 'magic', level: 1 },
    ],
    /** Woodcutting: the best axe the account can use (axes.dbrow levels). Lost City also chops with one. */
    axe: [
        { item: 'rune axe', skill: 'woodcutting', level: 41 },
        { item: 'adamant axe', skill: 'woodcutting', level: 31 },
        { item: 'mithril axe', skill: 'woodcutting', level: 21 },
        { item: 'black axe', skill: 'woodcutting', level: 11 },
        { item: 'steel axe', skill: 'woodcutting', level: 6 },
        { item: 'iron axe', skill: 'woodcutting', level: 1 },
        { item: 'bronze axe', skill: 'woodcutting', level: 1 },
    ],
    /** Pirate's Treasure: worn into Wydin's back room, so worn ones count. */
    'white apron': [{ item: 'white apron', skill: 'defence', level: 1 }],
    /** Underground Pass: a bow to fire the burning cloth arrow at the guide rope (weapon_bow category). */
    bow: [
        { item: 'magic longbow', skill: 'ranged', level: 50 },
        { item: 'magic shortbow', skill: 'ranged', level: 50 },
        { item: 'yew longbow', skill: 'ranged', level: 40 },
        { item: 'yew shortbow', skill: 'ranged', level: 40 },
        { item: 'maple longbow', skill: 'ranged', level: 30 },
        { item: 'maple shortbow', skill: 'ranged', level: 30 },
        { item: 'willow longbow', skill: 'ranged', level: 20 },
        { item: 'willow shortbow', skill: 'ranged', level: 20 },
        { item: 'oak longbow', skill: 'ranged', level: 5 },
        { item: 'oak shortbow', skill: 'ranged', level: 5 },
        { item: 'longbow', skill: 'ranged', level: 1 },
        { item: 'shortbow', skill: 'ranged', level: 1 },
    ],
    /** Black Knights' Fortress: the guard disguise is worn, so worn ones count. */
    'bronze med helm': [{ item: 'bronze med helm', skill: 'defence', level: 1 }],
    'iron chainbody': [{ item: 'iron chainbody', skill: 'defence', level: 1 }],
    /**
     * Heroes' Quest, Taverley's blue dragons: either shield, worn. Not keyed 'dragonfire shield':
     * Dragon Slayer, Shilo and the KBD scripts count that name as an item.
     */
    'dragonbreath shield': [
        { item: 'dragonfire shield', skill: 'defence', level: 1 },
        { item: 'anti-dragon shield', skill: 'defence', level: 1 },
    ],
    /** Any dose: Legends' Quest drinks them under Nezikchened. */
    'prayer potion': [
        { item: 'prayer potion(4)', skill: 'prayer', level: 1 },
        { item: 'prayer potion(3)', skill: 'prayer', level: 1 },
        { item: 'prayer potion(2)', skill: 'prayer', level: 1 },
        { item: 'prayer potion(1)', skill: 'prayer', level: 1 },
    ],
    /** Shilo Village's Nazastarool: the best melee weapon banked, wielded for the fight. */
    'melee weapon': [
        { item: 'dragon scimitar', skill: 'attack', level: 60 },
        { item: 'dragon longsword', skill: 'attack', level: 60 },
        { item: 'rune scimitar', skill: 'attack', level: 40 },
        { item: 'rune longsword', skill: 'attack', level: 40 },
        { item: 'adamant scimitar', skill: 'attack', level: 30 },
        { item: 'adamant longsword', skill: 'attack', level: 30 },
        { item: 'mithril scimitar', skill: 'attack', level: 20 },
        { item: 'black scimitar', skill: 'attack', level: 10 },
        { item: 'steel scimitar', skill: 'attack', level: 5 },
        { item: 'iron scimitar', skill: 'attack', level: 1 },
    ],
};

const LUMBRIDGE_GENERAL_STORE = { x: 3211, z: 3246, npc: /shop\s*(keeper|assistant)/i };
/** Bob's Brilliant Axes: bronze pickaxe 1gp, stock 5 (wiki/shops/bobs-brilliant-axes.md). */
const BOBS_AXES = { x: 3232, z: 3203, npc: /^bob$/i };
/** Zaff's Superior Staffs, Varrock (varrock.inv staffshop): staff of fire 1500gp, stock 2. */
const ZAFF = { x: 3203, z: 3433, npc: /^zaff$/i };
/** Knife ground spawn, Lumbridge castle (m50_50 obj placement). */
const LUMBRIDGE_KNIFE = { x: 3224, z: 3202 };
/** Dommik's Crafting Store, Al Kharid: needle and thread 1gp. */
const DOMMIK = { x: 3322, z: 3194, npc: /^dommik$/i };
/** The Baker's stall, East Ardougne market (mule-produce.ts BAKERY). */
const ARDOUGNE_BAKER = { x: 2662, z: 3307, npc: /^baker$/i };
/** Arhein's store, Catherby: tinderbox. */
/** Aemad's Adventuring Supplies, East Ardougne (ardougne_east.inv). */
const AEMAD = { x: 2614, z: 3293, npc: /^(aemad|kortan)$/i };
/** Chadwell's general store, West Ardougne (walled until Biohazard; the wall doors open after it). */
const CHADWELL = { x: 2464, z: 3287, npc: /^chadwell$/i };
const ARHEIN = { x: 2803, z: 3430, npc: /^arhein$/i };
/** Jiminua's Jungle Store, Karamja (wiki/shops/jiminuas-jungle-store.md): charcoal 67gp, papyrus 15gp. */
const JIMINUA = { x: 2767, z: 3122, npc: /^jiminua$/i };
/** The Catherby candle maker (catherby.inv candleshop): candles 3gp. */
const CANDLE_MAKER = { x: 2800, z: 3439, npc: /^candle maker$/i };
/** Varrock Swords (varrock.inv swordshop), by the Varrock west bank. */
const VARROCK_SWORDS = { x: 3204, z: 3399, npc: /^shop (keeper|assistant)$/i };
/** A steel weapon bought for In Search of the Myreque, `price` coins a piece (a margin over the shop's price). */
function steelFromShop(item: string, price: number, shop: { x: number; z: number; npc: RegExp }): Source {
    return {
        obj: item.replace(/ /g, '_'),
        inputs: (count) => [{ item: 'coins', count: price * count }],
        get: async (q, count) => {
            await q.ensure('coins', price * (count - q.count(item)));
            await buyWaitingForRestock(q, shop, item, count);
        },
    };
}
/** Harry's Fishing Shop, Catherby: harpoon 5gp (fishing-route.ts HARRY). */
const HARRY = { x: 2834, z: 3445, npc: /^harry$/i };
/** Catherby pier, where the Net/Harpoon (shark) spots move between (fishing-route.ts PIER). */
const CATHERBY_PIER = [
    { x: 2845, z: 3429 },
    { x: 2837, z: 3431 },
    { x: 2854, z: 3423 },
    { x: 2860, z: 3426 },
];
/** Rellekka's potato patch, south of the longhall (maps m41_57 potato locs 2674-2680,3653). */
const RELLEKKA_POTATOES = [{ x: 2677, z: 3652 }];
/** Betty's Magic Emporium, Port Sarim: elemental and chaos runes. */
const BETTY = { x: 3012, z: 3259, npc: /^betty$/i };
/**
 * Aubury's Rune Shop, Varrock (wiki/shops/auburys-rune-shop.md): 2000 of each elemental rune,
 * 1000 mind/chaos/death. Betty stocks a handful, and two questers emptied her earth and fire
 * runes for an hour (Lost City, Waterfall; 2026-11-01).
 */
const AUBURY = { x: 3253, z: 3402, npc: /^aubury$/i };
const LUMBRIDGE_CASTLE_STAIRS = { x: 3205, z: 3208 };
/** Wydin's Food Store, Port Sarim: pot of flour 10gp (stock 3), redberries 3gp (stock 1). */
const WYDIN = { x: 3014, z: 3204, npc: /^wydin$/i };
/** Thessalia's clothes shop, Varrock (varrock.inv clotheshop: leather gloves). */
const THESSALIA_CLOTHES = { x: 3204, z: 3417, npc: /^thessalia$/i };
/** Peksa's helmet shop, Barbarian Village: bronze med helm 24gp (wiki/shops/helmet-shop.md). */
const PEKSA_HELMETS = { x: 3076, z: 3429, npc: /^peksa$/i };
/** Wayne's Chains, Falador: iron chainbody 210gp, stock 2 (wiki/shops/waynes-chains-chainmail-specialist.md). */
const WAYNE_CHAINS = { x: 2973, z: 3312, npc: /^wayne$/i };
/**
 * The Edgeville monastery garden's cabbage patch (maps/m47_54: 3050-3053 x 3503-3505),
 * entered through the gap in its north fence at x 3051-3052. Not a Draynor Manor
 * (magic) cabbage, which Black Knights' Fortress rejects.
 */
const MONASTERY_CABBAGES = [{ x: 3051, z: 3506 }];
/** Tostig, behind the Toad and Chicken's ground-floor bar (Burthorpe). */
const TOSTIG_BAR = { x: 2906, z: 3540, npc: /^tostig$/i };
/** Lowe's Archery Emporium, Varrock (npc 550 spawn 3232,3423). */
const LOWE = { x: 3232, z: 3423, npc: /^lowe$/i };
const GERRANT = { x: 3013, z: 3225, npc: /^gerrant$/i };
/** Barbarian Village (m48_53: potterywheel at 3087,3409 and 3087,3410). */
const POTTERS_WHEEL = { x: 3087, z: 3409 };
/** Barbarian Outpost plank spawns (m39_55 obj 960). */
const PLANK_SPAWNS = [
    { x: 2553, z: 3574 },
    { x: 2552, z: 3574 },
    { x: 2553, z: 3575 },
    { x: 2554, z: 3574 },
    { x: 2556, z: 3573 },
];
/** Pie dish ground spawn in the Varrock palace kitchen. */
const PIE_DISH_SPAWN = { x: 3222, z: 3494 };
/** Redberry pie burns often near Cooking 10; each attempt costs one dough + one berry portion. */
const PIE_ATTEMPTS = 4;
const FRED_SHEEP_PEN = { x: 3203, z: 3266 };
/** Npc id of a sheep that still has wool; a shorn one changes id. */
const UNSHEARED_SHEEP = 43;

/** An ore mined at Rimmington: needs a usable pickaxe and the rock's Mining level. */
function ore(name: Ore): Source {
    return {
        levels: { mining: ROCKS[name].level },
        inputs: () => [{ item: 'pickaxe', count: 1 }],
        get: async (q, count) => {
            await q.ensure('pickaxe', 1);
            await mineAtRimmington(q, name, { count });
        },
    };
}

/** Where an npc that always drops `item` can be killed for it. */
export interface HuntSpot {
    x: number;
    z: number;
    npc: RegExp;
}
/** Every kill drops the meat. Spots from the old druidic-ritual.ts, south-west of Falador up to Taverley. */
const FALADOR_FARM_COWS: HuntSpot = { x: 3027, z: 3307, npc: /^cow$/i };
const FALADOR_FARM_CHICKENS: HuntSpot = { x: 3015, z: 3287, npc: /^chicken$/i };
const PORT_SARIM_GIANT_RATS: HuntSpot = { x: 2995, z: 3191, npc: /^giant rat$/i };
/** Swamp toad ground spawns south of Taverley (m45_53 obj 2150). */
const TAVERLEY_SWAMP_TOADS = [
    { x: 2903, z: 3400 },
    { x: 2907, z: 3394 },
    { x: 2908, z: 3410 },
];
/** toadflaxvial: the unfinished agility potion ("Unfinished potion", a name every unf shares). */
const TOADFLAX_UNF = 3002;
const TAVERLEY_BEARS: HuntSpot = { x: 2965, z: 3465, npc: /^bear$/i };
/** Every chicken drops bones (Demon Slayer's 25 for Traiborn). East Lumbridge coop, old demon-slayer.ts. */
const LUMBRIDGE_EAST_CHICKENS: HuntSpot = { x: 3228, z: 3300, npc: /^chicken$/i };
/** Varrock general store (wiki/shops/varrock-general-store.md): bucket 2gp, stock 2. */
const VARROCK_GENERAL_STORE = { x: 3218, z: 3415, npc: /shop\s*(keeper|assistant)/i };
/** Varrock palace kitchen sink (north wing); the sink has no ops, use the bucket on it. */
/** Logs ground spawns, m38_49 (0 26 55 / 30 51 / 32 55), west of the Ardougne monastery. */
const SEERS_MAPLES = { x: 2672, z: 3538 };
/**
 * The open wheat patch north of Seers' Village (m42_55: loc 313 x13 at 2731-2733,3567-3572; respawns in 20 ticks). The big
 * field north of East Ardougne is fenced in, with only a stile (walkTo has no way in).
 */
const SEERS_WHEAT = [
    { x: 2732, z: 3569 },
    { x: 2732, z: 3571 },
];
const LOGS_SPAWNS_SW_ARDOUGNE = [
    { x: 2458, z: 3191 },
    { x: 2462, z: 3187 },
    { x: 2464, z: 3191 },
];
const PALACE_KITCHEN_SINK = { x: 3224, z: 3494 };
/** Snape grass ground spawns, m45_51 (0 26 33 / 27 31 / 37 10): the hobgoblin peninsula. */
const SNAPE_GRASS_SPAWNS = [
    { x: 2906, z: 3297 },
    { x: 2907, z: 3295 },
    { x: 2917, z: 3274 },
];
/** Giant bats on the shore west of Keep Le Faye (m43_53: 2752,3409 / 2753,3396 / 2759,3401). */
const KEEP_GIANT_BATS: HuntSpot = { x: 2756, z: 3402, npc: /^giant bat$/i };
/** Insect repellent ground spawn, Catherby (m43_53 obj 28 at 55,58). */
const CATHERBY_INSECT_REPELLENT = { x: 2807, z: 3450 };

export const SOURCES: Record<string, Source> = {
    /**
     * The prologue withdraws coins first; this only runs on a broke account (ABGARMY19 had
     * none for the Fortress disguise, 2026-10-29): pickpocket the men outside Lumbridge castle.
     */
    // jackthief first (prepare's mule round), pickpocketing only what it did not hand over:
    // jacklove20 walked ~4800 ticks to Lumbridge to pickpocket 15 coins for Plague City (2026-11-03).
    coins: { muleSupply: 'jackthief', get: (q, count) => pickpocketCoins(q, count) },

    pickaxe: {
        obj: 'bronze_pickaxe',
        tool: true,
        inputs: () => [{ item: 'coins', count: 5 }],
        get: async (q) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, BOBS_AXES, 'bronze pickaxe', 1);
        },
    },

    'blurite ore': {
        levels: { mining: 10 },
        inputs: () => [{ item: 'pickaxe', count: 1 }],
        get: async (q, count) => {
            await q.ensure('pickaxe', 1);
            await mineBlurite(q, count);
        },
    },

    /** Jackpoo2 holds the fleet's iron bars (121 in its bank snapshot, 2026-10-29) and serves them. */
    'iron bar': { mule: true, muleSupply: 'jackthief' },

    'pot of flour': {
        inputs: () => [{ item: 'coins', count: 30 }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, WYDIN, 'pot of flour', count);
        },
    },
    'pie dish': { get: (q, count) => pickUpSpawn(q, PIE_DISH_SPAWN, 'pie dish', count) },
    'jug of water': { get: (q) => fetchJugOfWater(q) },

    'redberry pie': {
        levels: { cooking: 10 },
        inputs: () => [
            { item: 'pot of flour', count: 1 },
            { item: 'redberries', count: 1 },
            { item: 'pie dish', count: 1 },
            { item: 'coins', count: 40 },
        ],
        get: async (q, count) => {
            for (let attempt = 1; attempt <= PIE_ATTEMPTS && q.count('redberry pie') < count; attempt++) {
                if (q.count('uncooked berry pie') < 1) {
                    if (q.count('pie shell') < 1) {
                        await q.ensure('pie dish', 1);
                        if (q.count('pastry dough') < 1) {
                            await q.ensure('pot of flour', 1);
                            await q.ensure('jug of water', 1);
                            await makeDough(q, /^pastry dough$/i, /pastry dough/i);
                        }
                        await combine(q, /^pastry dough$/i, /^pie dish$/i, /^pie shell$/i);
                    }
                    await q.ensure('redberries', 1);
                    await combine(q, /^pie shell$/i, /^redberries$/i, /^uncooked berry pie$/i);
                }
                const result = await cookAtPalaceRange(q, /^uncooked berry pie$/i, /^redberry pie$/i);
                q.log(`redberry pie attempt ${attempt}: ${result}`);
                if (result === 'burnt') {
                    // A burnt pie's first op ("Empty dish") gives the pie dish back for the next try.
                    const burnt = q.sdk.findInventoryItem(/^burnt pie$/i);
                    if (burnt) await q.sdk.sendUseItem(burnt.slot, 1).catch(() => undefined);
                    await q.sdk.waitForTicks(3);
                    await q.bot.dismissBlockingUI();
                }
            }
        },
    },

    clay: ore('clay'),
    'copper ore': ore('copper ore'),
    'iron ore': ore('iron ore'),

    'raw beef': { get: (q, count) => huntDrop(q, FALADOR_FARM_COWS, 'raw beef', count) },
    'raw chicken': { get: (q, count) => huntDrop(q, FALADOR_FARM_CHICKENS, 'raw chicken', count) },
    'raw rat meat': { get: (q, count) => huntDrop(q, PORT_SARIM_GIANT_RATS, 'raw rat meat', count) },
    'raw bear meat': { get: (q, count) => huntDrop(q, TAVERLEY_BEARS, 'raw bear meat', count) },

    // ── Imp Catcher: each imp kill drops one bead colour at 5/128 (drop tables/imp.rs2)
    'black bead': impBead('black'),
    'red bead': impBead('red'),
    'white bead': impBead('white'),
    'yellow bead': impBead('yellow'),

    // ── Ernest the Chicken: the machine parts, all from Draynor Manor (lib/draynor-manor.ts)
    spade: { tool: true, get: (q) => manorSpade(q) },
    'rubber tube': { inputs: () => [{ item: 'spade', count: 1 }], get: (q) => rubberTube(q) },
    'pressure gauge': { get: (q) => pressureGauge(q) },
    'oil can': { get: (q) => oilCan(q) },

    // ── Vampire Slayer: hammer, beer for Dr Harlow, garlic; the stake is Harlow's (quest-tracked)
    hammer: {
        tool: true,
        inputs: () => [{ item: 'coins', count: 5 }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, LUMBRIDGE_GENERAL_STORE, 'hammer', count);
        },
    },
    beer: {
        inputs: (count) => [{ item: 'coins', count: 2 * count }],
        get: async (q, count) => {
            for (let misses = 0; misses < 3 && q.count('beer') < count; ) {
                const before = q.count('beer');
                await q.ensure('coins', 2);
                // area_port_sarim/scripts/bartender.rs2: "Could I buy a beer please?" -> 2gp, one beer.
                await q.talk(/^bartender$/i, [/buy a beer/i], RUSTY_ANCHOR);
                await untilTicks(q.sdk, () => q.count('beer') > before, 5);
                await closeUi(q.bot, q.sdk);
                misses = q.count('beer') > before ? 0 : misses + 1;
            }
        },
    },
    garlic: { get: (q, count) => morganGarlic(q, count) },
    /** Dr Harlow hands it over for a beer (harlow.rs2); untradeable, never spawned. */
    stake: { spawnable: false },

    // ── Demon Slayer: a bucket of water for the palace drain, 25 bones for Traiborn
    bucket: {
        inputs: (count) => [{ item: 'coins', count: 3 * count }],
        get: async (q, count) => {
            // Coins for every bucket, at the store's rising price: 1 coin was "enough" and
            // ABGARMY05 (2 coins) bought one then failed 10 buys, "source for bucket left 3/4" (2026-11-02).
            await q.ensure('coins', 3 * (count - q.count('bucket')) + 2);
            await buyWaitingForRestock(q, VARROCK_GENERAL_STORE, 'bucket', count);
        },
    },
    'bucket of water': {
        obj: 'bucket_water',
        inputs: (count) => [{ item: 'bucket', count }],
        get: async (q, count) => {
            await q.ensure('bucket', count - q.count('bucket of water'));
            await q.goTo(PALACE_KITCHEN_SINK, 2);
            for (let misses = 0; misses < 3 && q.count('bucket of water') < count; ) {
                const before = q.count('bucket of water');
                await q.bot.useItemOnLoc(/^bucket$/i, /^sink$/i, { timeout: ticksToMs(20) });
                await untilTicks(q.sdk, () => q.count('bucket of water') > before, 8);
                misses = q.count('bucket of water') > before ? 0 : misses + 1;
            }
        },
    },
    bones: { get: (q, count) => huntDrop(q, LUMBRIDGE_EAST_CHICKENS, 'bones', count) },

    // ── Pirate's Treasure: Wydin only hires you with a white apron (wydin.rs2)
    'white apron': {
        tool: true,
        inputs: () => [{ item: 'coins', count: 5 }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, THESSALIA_CLOTHES, 'white apron', count);
        },
    },

    // ── Monk's Friend: one set of logs for Cedric's cart. Ground spawns south-west of
    // the monastery (m38_49 obj placements), so no axe or Woodcutting level is needed.
    logs: { get: (q, count) => pickSpawns(q, 'logs', count, LOGS_SPAWNS_SW_ARDOUGNE) },

    // ── Witch's House
    cheese: {
        inputs: (count) => [{ item: 'coins', count: 5 * count }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, WYDIN, 'cheese', count);
        },
    },
    'leather gloves': {
        tool: true,
        inputs: () => [{ item: 'coins', count: 10 }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, THESSALIA_CLOTHES, 'leather gloves', count);
        },
    },

    // ── Black Knights' Fortress: the guard disguise and a cabbage for the witch's cauldron
    'bronze med helm': {
        tool: true,
        inputs: () => [{ item: 'coins', count: 24 }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, PEKSA_HELMETS, 'bronze med helm', count);
        },
    },
    'iron chainbody': {
        tool: true,
        inputs: () => [{ item: 'coins', count: 210 }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, WAYNE_CHAINS, 'iron chainbody', count);
        },
    },
    cabbage: { get: (q, count) => pickLocs(q, 'cabbage', /^cabbage$/i, MONASTERY_CABBAGES, count) },

    // ── Death Plateau
    /** Tostig's bar, the Toad and Chicken's ground floor, Burthorpe (the-toad-and-chicken.md). */
    'asgarnian ale': {
        inputs: (count) => [{ item: 'coins', count: 5 * count }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, TOSTIG_BAR, 'asgarnian ale', count);
        },
    },
    /**
     * Harold only gets drunk on this (death_guard_equiproom.rs2 harold_drink2). The
     * premade one is what a bank holds; the bar is in the Gnome Stronghold, so a mule stocks it.
     */
    'blurberry special': { obj: 'premade_blurberry_special', mule: true, muleSupply: 'jackthief' },
    /** Tenzing's winter supplies; no shop near Burthorpe sells either, so the mule stocks them
     * (jacklove4 gathered 50 of each with death-plateau-stock.ts, 2026-10-30). */
    /**
     * Mule first; otherwise the Ardougne Baker's stall (ardougne_east.inv bakery: bread 10 at
     * 12gp, +1 per 100 ticks — mule-produce.ts buys from it). A mule-only bread failed Merlin's
     * Crystal 2/2 on jacklove13, ABGARMY17 and ABGARMY20 when jackthief's trade timed out (2026-11-03).
     */
    bread: {
        muleSupply: JACKPOO2_THEN_JACKTHIEF,
        inputs: (count) => [{ item: 'coins', count: 12 * count }],
        get: async (q, count) => {
            await q.ensure('coins', 12 * count);
            await buyWaitingForRestock(q, ARDOUGNE_BAKER, 'bread', count);
        },
    },
    trout: { mule: true, muleSupply: 'jackthief' },

    // ── Fight Arena: the pen fights (ogre 63, scorpion 44, Bouncer 137) are ranged; a mule stocks the kit
    'magic shortbow': { mule: true, muleSupply: 'jackthief' },
    'rune arrow': { mule: true, muleSupply: 'jackthief' },
    // jackthief banks thousands (restocks from the ABGARMY grinders); with no muleSupply nobody asked it, and
    // Heroes' Quest stopped on NEEDS STOCK shark x1/x4 on jacklove13 and ABGARMY20 (2026-11-04).
    shark: { mule: true, muleSupply: 'jackthief' },
    /** khazard_barman.rs2 only sells it once the bored guard has talked: bought inside the quest step. */
    'khali brew': { spawnable: false },

    // ── Fight Arena's magic kit
    'fire staff': {
        obj: 'staff_of_fire',
        tool: true,
        inputs: () => [{ item: 'coins', count: 1500 }],
        get: async (q) => {
            await q.ensure('coins', 1500);
            await buyWaitingForRestock(q, ZAFF, 'staff of fire', 1);
        },
    },
    // Shops are emptied by other players' bots (jackquests waited hours on Aubury's chaos, 2026-11-01): the mule first.
    'air rune': { ...runes('air rune', 4, AUBURY), muleSupply: 'jackthief' },
    // Shops are emptied by other players' bots (jackquests waited hours on Aubury's chaos, 2026-11-01): the mule first.
    'chaos rune': { ...runes('chaos rune', 15, AUBURY), muleSupply: 'jackthief' },
    // ── Tools for the skill trainers (lib/training.ts) and Lost City
    axe: {
        obj: 'bronze_axe',
        tool: true,
        // Bob asks more than the 16 base as his stock falls: 15-16 coins bought nothing (jackquests, 2026-10-30).
        inputs: () => [{ item: 'coins', count: 50 }],
        get: async (q) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, BOBS_AXES, 'bronze axe', 1);
        },
    },
    // The Lumbridge spawn is contested (jacklove11's Lost City failed twice on it, 2026-11-01): the mule first.
    knife: { tool: true, muleSupply: 'jackthief', get: (q, count) => pickUpSpawn(q, LUMBRIDGE_KNIFE, 'knife', count) },
    needle: {
        tool: true,
        inputs: () => [{ item: 'coins', count: 1 }],
        get: async (q) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, DOMMIK, 'needle', 1);
        },
    },
    /**
     * process-bank.ts: gem cutting. Dommik stocks two (alkharid.inv craftingshop2); so does Arhein's
     * Catherby store (catherby.inv arheinstore), the one to use west of Al Kharid: Shilo Village's
     * Ardougne restart walked to Dommik and looped at the toll gate (3268,3227) (staging, 2026-11-04).
     */
    chisel: {
        tool: true,
        inputs: () => [{ item: 'coins', count: 5 }],
        get: async (q) => {
            await q.ensure('coins', 1);
            const x = q.sdk.getState()?.player?.worldX ?? 0;
            await buyWaitingForRestock(q, x < 3100 ? ARHEIN : DOMMIK, 'chisel', 1);
        },
    },
    /** process-bank.ts: emerald rings. Dommik stocks four (alkharid.inv craftingshop2). */
    /** Family Crest's perfect necklace. Dommik stocks two (alkharid.inv craftingshop2); Jackpoo5 stopped on
     * "need 1 necklace mould … no source procedure" (2026-11-04). */
    'necklace mould': {
        tool: true,
        inputs: () => [{ item: 'coins', count: 5 }],
        get: async (q) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, DOMMIK, 'necklace mould', 1);
        },
    },
    'ring mould': {
        tool: true,
        inputs: () => [{ item: 'coins', count: 5 }],
        get: async (q) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, DOMMIK, 'ring mould', 1);
        },
    },
    thread: {
        inputs: (count) => [{ item: 'coins', count }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, DOMMIK, 'thread', count);
        },
    },
    'fire rune': { ...runes('fire rune', 4, AUBURY), muleSupply: 'jackthief' },
    'earth rune': { ...runes('earth rune', 4, AUBURY), muleSupply: 'jackthief' },
    /** Waterfall Quest's pillars. Betty: stock 1000. */
    'water rune': { ...runes('water rune', 4, AUBURY), muleSupply: 'jackthief' },
    /** Not sold near any hub (the Magic Guild store needs 66 Magic): mule stock, like the Telegrab laws. */
    'law rune': { obj: 'lawrune', mule: true, muleSupply: 'jackthief' },
    /** Lost City past the spirit with the staff lost: back to Entrana for another branch (lib/lost-city.ts). */
    'dramen staff': {
        obj: 'dramen_staff',
        // Made inside its transition only: prepare must not send an unstarted account to Entrana.
        spawnable: false,
        inputs: () => [
            { item: 'knife', count: 1 },
            { item: 'law rune', count: 1 },
            { item: 'air rune', count: 3 },
            { item: 'earth rune', count: 1 },
            { item: 'shark', count: 4 },
        ],
        get: (q) => dramenStaff(q),
    },

    // ── The Fremennik Trials
    tinderbox: {
        tool: true,
        inputs: () => [{ item: 'coins', count: 5 }],
        get: async (q) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, ARHEIN, 'tinderbox', 1);
        },
    },
    /** Murder Mystery's flour barrel fills an empty pot. Arhein's store, Catherby (catherby.inv: stock 2). */
    pot: {
        obj: 'pot_empty',
        inputs: (count) => [{ item: 'coins', count: 20 + 5 * count }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, ARHEIN, 'pot', count);
        },
    },
    potato: { get: (q, count) => pickLocs(q, 'potato', /^potato$/i, RELLEKKA_POTATOES, count) },

    // ── Shilo Village: a light dropped into the fissure, the beads' wire, a weapon for Nazastarool
    candle: {
        obj: 'unlit_candle',
        inputs: (count) => [{ item: 'coins', count: 5 * count }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, CANDLE_MAKER, 'candle', count);
        },
    },
    'lit candle': {
        obj: 'lit_candle',
        inputs: (count) => [
            { item: 'candle', count },
            { item: 'tinderbox', count: 1 },
        ],
        get: async (q, count) => {
            await q.ensure('candle', count - q.count('lit candle'));
            await q.ensure('tinderbox', 1);
            for (let misses = 0; misses < 3 && q.count('lit candle') < count; ) {
                const before = q.count('lit candle');
                const tinder = q.sdk.findInventoryItem(/^tinderbox$/i);
                const candle = q.sdk.findInventoryItem(/^candle$/i);
                if (!tinder || !candle) break;
                await q.sdk.sendUseItemOnItem(tinder.slot, candle.slot);
                await untilTicks(q.sdk, () => q.count('lit candle') > before, 6);
                misses = q.count('lit candle') > before ? 0 : misses + 1;
            }
        },
    },
    /** Smithed from a bronze bar (Smithing 4): mule stock, like the iron bars. */
    /**
     * Shilo Village's Bronze wire: a bronze bar smithed at the Seers' anvil (Smithing 4). No mule
     * stocks it, and the port's mule-only line stopped every run (2026-11-02).
     */
    'bronze wire': {
        obj: 'bronzecraftwire',
        levels: { smithing: 4 },
        inputs: () => [
            { item: 'bronze bar', count: 1 },
            { item: 'hammer', count: 1 },
        ],
        get: async (q, count) => {
            for (let i = 0; i < count && q.count('bronze wire') < count; i++) {
                await q.ensure('bronze bar', 1);
                await q.ensure('hammer', 1);
                // mule-produce's proven Seers anvil routine (reach, use the bar, wait for
                // interface 994), not smithAtAnvil: it has no 'wire', and as 'bronze nails' its
                // interface "did not open" for ABGARMY07 (2026-11-02). Bronze's fourth button in
                // column 1123 (smithing.inv smithing_bronze5 stock4=bronzecraftwire), Make 1.
                await q.goTo({ x: 2713, z: 3493 }, 1);
                await q.reach(/^anvil$/i).catch(() => undefined);
                for (let miss = 0; miss < 4 && q.count('bronze wire') < 1; miss++) {
                    await closeUi(q.bot, q.sdk);
                    const anvil = q.sdk.findNearbyLoc(/^anvil$/i);
                    const bar = q.sdk.findInventoryItem(/^bronze bar$/i);
                    if (!anvil || !bar) {
                        q.log(`bronze wire: no ${anvil ? 'bronze bar' : 'anvil'} at ${q.sdk.getState()?.player?.worldX},${q.sdk.getState()?.player?.worldZ}`);
                        break;
                    }
                    await q.sdk.sendUseItemOnLoc(bar.slot, anvil.x, anvil.z, anvil.id);
                    if (!(await untilTicks(q.sdk, (s) => !!s.interface?.isOpen && s.interface.interfaceId === 994, 12))) {
                        q.log(`bronze wire: the anvil interface did not open (miss ${miss + 1})`);
                        continue;
                    }
                    await q.sdk.sendClickComponentWithOption(1123, 1, 3);
                    await untilTicks(q.sdk, () => q.count('bronze wire') > 0, 10);
                }
            }
        },
    },
    /** GROUPS 'melee weapon': nothing to buy near a hub, so a bank without one stops with NEEDS STOCK. */
    'melee weapon': { obj: 'rune_scimitar', mule: true },
    /** Lalli's altar step (raw shark on the Strange altar): harpooned off Catherby's pier at Fishing 76. */
    'raw shark': {
        levels: { fishing: 76 },
        inputs: () => [{ item: 'harpoon', count: 1 }],
        get: async (q, count) => {
            await q.ensure('harpoon', 1);
            await harpoonSharks(q, count);
        },
    },
    harpoon: {
        tool: true,
        inputs: () => [{ item: 'coins', count: 5 }],
        get: async (q) => {
            await q.ensure('coins', 5);
            await buyWaitingForRestock(q, HARRY, 'harpoon', 1);
        },
    },

    // ── Dragon Slayer: the Ice Mountain door's four items, the ship's repairs, Elvarg's sword
    // (all QUEST_STOCK lines in bots/quests/supply.ts: a mule stocks them)
    /** Burthorpe's Toad and Chicken (burthorpe.inv death_pub) is the only shop that stocks it. */
    "wizard's mind bomb": {
        obj: 'wizards_mind_bomb',
        inputs: (count) => [{ item: 'coins', count: 10 * count }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, TOSTIG_BAR, "wizard's mind bomb", count);
        },
    },
    /** Gerrant's Fishy Business, Port Sarim (port_sarim.inv fishingshop). */
    /** Gerrant's Fishy Business, Port Sarim (port_sarim.inv: net 5gp). The karambwanji in Tai Bwo Wannai Trio. */
    'small fishing net': {
        obj: 'net',
        tool: true,
        inputs: () => [{ item: 'coins', count: 10 }],
        get: async (q) => {
            await q.ensure('coins', 10);
            await buyWaitingForRestock(q, GERRANT, 'small fishing net', 1);
        },
    },
    /**
     * Tai Bwo Wannai Trio: Tamayu drinks 4 doses. No shop sells agility potions; brewed here (Herblore 34,
     * brew_potion.struct 3dose1agility: toadflax into a vial of water, toad's legs in), else jackthief's stock.
     */
    'agility potion(3)': {
        obj: '3dose1agility',
        muleSupply: 'jackthief',
        levels: { herblore: 34 },
        inputs: (count) => [
            { item: 'toadflax', count },
            { item: "toad's legs", count },
            { item: 'vial of water', count },
        ],
        get: async (q, count) => {
            for (let i = 0; i < 2 * count && q.count('agility potion(3)') < count; i++) {
                // Whole batch at once: one trip to the toads, not one per potion.
                const short = count - q.count('agility potion(3)');
                const unfHeld = q.sdk.getInventory().filter((x) => x.id === TOADFLAX_UNF).length;
                await q.ensure('toadflax', Math.max(0, short - unfHeld));
                await q.ensure("toad's legs", short);
                await q.ensure('vial of water', Math.max(0, short - unfHeld));
                const unf = () => q.sdk.getInventory().find((x) => x.id === TOADFLAX_UNF);
                if (!unf()) {
                    const herb = q.sdk.findInventoryItem(/^toadflax$/i)!;
                    const vial = q.sdk.findInventoryItem(/^vial of water$/i)!;
                    await q.sdk.sendUseItemOnItem(herb.slot, vial.slot).catch(() => undefined);
                    await untilTicks(q.sdk, (s) => !!unf() || !!s.dialog?.isOpen, 8);
                    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/^make 1|^1$|toadflax|unfinished/i], { done: () => !!unf(), ticks: 8 });
                    if (!unf()) continue;
                }
                const before = q.count('agility potion(3)');
                const legs = q.sdk.findInventoryItem(/^toad's legs$/i)!;
                await q.sdk.sendUseItemOnItem(legs.slot, unf()!.slot).catch(() => undefined);
                await untilTicks(q.sdk, (s) => q.count('agility potion(3)') > before || !!s.dialog?.isOpen, 8);
                if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/^make 1|^1$|agility/i], { done: () => q.count('agility potion(3)') > before, ticks: 8 });
            }
        },
    },
    /**
     * Agility potion herb (clean). In no herb drop table (shared_droptables randomherb), no shop, no spawn:
     * the one source is the Brimhaven Agility Arena's Jack o' Tickets, 3 tickets each
     * (agilityarena_tickettrader.rs2), a ticket per pillar tagged under the moving arrow. Not scripted:
     * the mule's herb stock.
     */
    toadflax: { mule: true, muleSupply: 'jackthief' },
    /** Swamp toads south of Taverley (m45_53 obj 2150 x3, ~100t respawn), legs pulled off (gnome_cooking swamp_toad.rs2). */
    "toad's legs": {
        obj: 'toads_legs',
        get: async (q, count) => {
            if (q.sdk.getInventory().length >= 28) throw new Error("toad's legs: the pack is full — no room to pick up a swamp toad");
            for (let round = 0; round < 4 && q.count("toad's legs") < count; round++) {
                const toads = q.count(/^swamp toad$/i);
                if (q.count("toad's legs") + toads < count) await pickSpawns(q, 'swamp toad', count - q.count("toad's legs"), TAVERLEY_SWAMP_TOADS);
                for (const toad of q.sdk.getInventory().filter((i) => /^swamp toad$/i.test(i.name))) {
                    const op = toad.optionsWithIndex.find((o) => /remove-legs/i.test(o.text));
                    await q.sdk.sendUseItem(toad.slot, op?.opIndex ?? 1).catch(() => undefined);
                    await untilTicks(q.sdk, () => !q.sdk.getInventory().some((i) => i.slot === toad.slot && /^swamp toad$/i.test(i.name)), 4);
                }
            }
        },
    },
    'lobster pot': {
        obj: 'lobster_pot',
        inputs: (count) => [{ item: 'coins', count: 40 * count }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, GERRANT, 'lobster pot', count);
        },
    },
    /** Thessalia, Varrock (varrock.inv clotheshop). */
    silk: {
        inputs: (count) => [{ item: 'coins', count: 50 * count }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, THESSALIA_CLOTHES, 'silk', count);
        },
    },
    /** Soft clay on Barbarian Village's potter's wheel (pottery.rs2 skill_multi3: the "Bowl" button). */
    'unfired bowl': {
        obj: 'bowl_unfired',
        levels: { crafting: 8 },
        inputs: (count) => [{ item: 'soft clay', count }],
        get: async (q, count) => {
            for (let misses = 0; misses < 3 && q.count('unfired bowl') < count; ) {
                const before = q.count('unfired bowl');
                await q.ensure('soft clay', 1);
                await q.goTo({ x: POTTERS_WHEEL.x + 1, z: POTTERS_WHEEL.z }, 2);
                await q.sdk.scanNearbyLocs(8).catch(() => undefined);
                const wheel = q.sdk.findNearbyLoc(/potter'?s wheel/i);
                const clay = q.sdk.findInventoryItem(/^soft clay$/i);
                if (wheel && clay) {
                    await q.bot.useItemOnLoc(clay, wheel);
                    await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 10);
                    await driveDialog(q.sdk, [/^bowl$/i, /bowl/i], { done: () => q.count('unfired bowl') > before, ticks: 30, log: q.log });
                    await untilTicks(q.sdk, () => q.count('unfired bowl') > before, 10);
                }
                misses = q.count('unfired bowl') > before ? 0 : misses + 1;
            }
        },
    },
    /**
     * No shop sells planks (Razmire's needs Shades of Mort'ton): the Barbarian Outpost's four
     * spawns (m39_55), waited on when another account has taken them. The deep-wilderness
     * spawns are left alone.
     */
    plank: {
        obj: 'woodplank',
        get: async (q, count) => {
            await q.goTo(PLANK_SPAWNS[0]!, 3);
            // Timed from arrival: the walk from Draynor alone is ~2750 ticks (Jackpoo5, 2026-10-31).
            const t0 = tickNow(q.sdk);
            while (q.count('plank') < count && tickNow(q.sdk) - t0 < 1500) {
                const plank = q.sdk.findGroundItem(/^plank$/i, { reachable: true });
                if (!plank || plank.distance > 10) {
                    await q.sdk.waitForTicks(5);
                    continue;
                }
                const before = q.count('plank');
                await q.bot.pickupItem(plank);
                await untilTicks(q.sdk, () => q.count('plank') > before, 10);
            }
        },
    },
    /** Smithed from steel bars only (Smithing 34, two a bar): jackthief smiths them (mule-produce.ts). */
    nails: { mule: true, muleSupply: JACKPOO2_THEN_JACKTHIEF },
    /** Attack 60 and Lost City complete to wield; no shop sells it. jackthief banks ~95. */
    'dragon longsword': { obj: 'dragon_longsword', mule: true, muleSupply: JACKPOO2_THEN_JACKTHIEF },

    shears: {
        tool: true,
        inputs: () => [{ item: 'coins', count: 5 }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, LUMBRIDGE_GENERAL_STORE, 'shears', count);
        },
    },

    wool: {
        inputs: () => [{ item: 'shears', count: 1 }],
        get: async (q, count) => {
            await q.ensure('shears', 1);
            if (q.sdk.getState()?.player?.level) await q.climbTo(0);
            await q.goTo(FRED_SHEEP_PEN, 4);
            const t0 = tickNow(q.sdk);
            let tries = 0;
            for (let misses = 0; misses < 40 && q.count('wool') < count; ) {
                const sheep = (q.sdk.getNearbyNpcs() ?? [])
                    .filter((n) => n.id === UNSHEARED_SHEEP && n.reachable !== false)
                    .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
                const before = q.count('wool');
                if (sheep) {
                    tries++;
                    const sent = messageCursor(q);
                    await q.bot.useItemOnNpc(/^shears$/i, sheep, { timeout: ticksToMs(20) });
                    // Returns on the send, before the wool lands (same as spinning). An escape
                    // or a sheep shorn by someone else ends the attempt early.
                    await untilTicks(
                        q.sdk,
                        (st) =>
                            (st.inventory ?? []).filter((i) => /^wool$/i.test(i.name)).length > before ||
                            (st.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > sent && /get away|already been shorn/i.test(m.text)),
                        12
                    );
                } else await q.sdk.waitForTicks(3);
                misses = q.count('wool') > before ? 0 : misses + 1;
            }
            q.log(`sheared ${q.count('wool')} wool in ${tickNow(q.sdk) - t0}t (${tries} attempts)`);
        },
    },

    // jackthief first: Fred's pen gave jacklove13 1 wool in 40 shears on prod (Regicide, 2026-11-04).
    'ball of wool': {
        mule: true,
        muleSupply: 'jackthief',
        inputs: (count) => [{ item: 'wool', count }],
        get: async (q, count) => {
            await q.ensure('wool', count - q.count('ball of wool'));
            if ((q.sdk.getState()?.player?.level ?? 0) !== 1) {
                await q.goTo(LUMBRIDGE_CASTLE_STAIRS, 2);
                await q.climbTo(1);
            }
            // The wheel is behind a door; useItemOnLoc does not open it ("I can't reach that!").
            await q.reach(/spinning wheel/i);
            // The wheel's Spin option batches (Make 10 at ~4 ticks a ball). Using wool on the
            // wheel spins one, and a use sent mid-spin is dropped: ~14s a ball (2026-10-28).
            for (let misses = 0; misses < 3 && q.count('ball of wool') < count && q.count('wool') > 0; ) {
                const before = q.count('wool');
                await spinBatch(q);
                misses = q.count('wool') < before ? 0 : misses + 1;
            }
            await q.climbTo(0);
        },
    },

    // ── Goblin Diplomacy: goblin mail and the dyes for it
    'goblin mail': {
        // Asked of the Jackpoo2 mule first (jackquests' stock moved to jacklove4, 2026-10-29,
        // then everything to Jackpoo2, the one mule, 2026-10-30): bots crowding the goblin camps got no drop. Killed for if it does not trade.
        muleSupply: 'jackthief',
        get: async (q, count) => {
            await killForDrop(q, 'goblin mail', count, GOBLIN_CAMPS, /^goblin$/i);
        },
    },
    'orange goblin mail': dyedMail('orange'),
    'blue goblin mail': dyedMail('blue'),

    'orange dye': {
        inputs: (count) => [
            { item: 'red dye', count },
            { item: 'yellow dye', count },
        ],
        get: async (q, count) => {
            const more = count - q.count('orange dye');
            await q.ensure('red dye', more);
            await q.ensure('yellow dye', more);
            // dye_cape.rs2 craft_dyes: red on yellow makes orange at once, no dialog.
            await useUntil(q, 'red dye', 'yellow dye', 'orange dye', count);
        },
    },
    'red dye': aggieDye('red', 'redberries', 3),
    'yellow dye': aggieDye('yellow', 'onion', 2),
    'blue dye': aggieDye('blue', 'woad leaf', 2),

    redberries: {
        inputs: () => [{ item: 'coins', count: 10 }],
        get: async (q, count) => {
            await pickSpawns(q, 'redberries', count, REDBERRY_SPAWNS);
            if (q.count('redberries') >= count) return;
            // Wydin stocks one per restock (port_sarim.inv), shared with every account.
            q.log(`redberries: ${q.count('redberries')}/${count} from the spawns; buying the rest at Wydin's`);
            await q.ensure('coins', 3 * (count - q.count('redberries')));
            await buyWaitingForRestock(q, WYDIN, 'redberries', count);
        },
    },

    /** Romeo & Juliet: static ground spawns west of Varrock's south-east mine. */
    'cadava berries': { obj: 'cadavaberries', get: (q, count) => pickSpawns(q, 'cadava berries', count, CADAVA_SPAWNS) },

    /**
     * Onions grow only in the field south of Rellekka in this revision
     * (quest-lab-locfind onion: all 14 surface plants at 2674-2684,3649-3708;
     * no shop or ground spawn in reach). Prod is a members world, so pick them.
     */
    onion: { get: (q, count) => pickLocs(q, 'onion', /^onion$/i, ONION_FIELD, count) },

    'woad leaf': {
        inputs: (count) => [{ item: 'coins', count: 10 * count }],
        get: async (q, count) => {
            // wyson_the_gardener.rs2: "How about 20 coins?" -> two leaves.
            for (let misses = 0; misses < 3 && q.count('woad leaf') < count; ) {
                const before = q.count('woad leaf');
                await q.ensure('coins', 20);
                await q.talk(/^wyson/i, [/looking for woad/i, /20 coins/i], WYSON);
                await untilTicks(q.sdk, () => q.count('woad leaf') > before, 10);
                await closeUi(q.bot, q.sdk);
                misses = q.count('woad leaf') > before ? 0 : misses + 1;
            }
        },
    },

    // ── Prince Ali Rescue: the disguise, the key copy and the guard's beer
    /**
     * Water used on clay (pottery.rs2 make_softclay). A jug from the Lumbridge
     * kitchen, so a bucket of water bought for something else is not used up.
     */
    'soft clay': {
        inputs: (count) => [
            { item: 'clay', count },
            { item: 'jug of water', count },
        ],
        get: async (q, count) => {
            for (let misses = 0; misses < 3 && q.count('soft clay') < count; ) {
                const before = q.count('soft clay');
                await q.ensure('clay', 1);
                await q.ensure('jug of water', 1);
                await useUntil(q, 'jug of water', 'clay', 'soft clay', before + 1);
                misses = q.count('soft clay') > before ? 0 : misses + 1;
            }
        },
    },
    'bronze bar': {
        inputs: (count) => [{ item: 'coins', count: 20 * count + SHANTAY_TOLLS }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, SHANTAY, 'bronze bar', count);
        },
    },
    'pink skirt': {
        inputs: (count) => [{ item: 'coins', count: 5 * count }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, THESSALIA, 'pink skirt', count);
        },
    },
    /** Imps always drop ashes (wiki/items/ashes.md); the spot west of Draynor first. */
    ashes: {
        get: async (q, count) => {
            for (let visit = 0; visit < ASHES_IMP_SPOTS.length && q.count('ashes') < count; visit++) {
                await huntDrop(q, ASHES_IMP_SPOTS[visit]!, 'ashes', count);
            }
        },
    },
    /** Ned, Draynor (ned.rs2): 15 coins a coil. */
    // ── Underground Pass: a bow and arrows for the guide rope (one cloth arrow, a few spare for misses)
    /** Chadwell's West Ardougne general store (ardougne_west.inv: longbow 96gp), through the city wall doors. */
    bow: {
        obj: 'longbow',
        tool: true,
        inputs: () => [{ item: 'coins', count: 150 }],
        get: async (q) => {
            await q.ensure('coins', 150);
            const { throughWallDoors } = await import('./underground-pass');
            try {
                await throughWallDoors(q, true);
                await buyWaitingForRestock(q, CHADWELL, 'longbow', 1);
                await throughWallDoors(q, false);
            } catch (e) {
                // West Ardougne's wall doors want Biohazard (qltb2, staging 2026-11-04): Lowe's Archery Emporium,
                // Varrock (varrock.inv: longbow 4, shortbow 4).
                q.log(`bow: Chadwell failed (${(e as Error).message}) — Lowe's in Varrock`);
                await buyWaitingForRestock(q, LOWE, 'longbow', 1);
            }
        },
    },
    /** Aemad's Adventuring Supplies, East Ardougne (bronze arrows 1gp, stock 500). */
    'bronze arrow': {
        obj: 'bronze_arrow',
        inputs: (count) => [{ item: 'coins', count: 2 * count }],
        get: async (q, count) => {
            await q.ensure('coins', 2 * count);
            await buyWaitingForRestock(q, AEMAD, 'bronze arrow', count);
        },
    },
    rope: {
        inputs: (count) => [{ item: 'coins', count: 15 * count }],
        get: async (q, count) => {
            for (let misses = 0; misses < 3 && q.count('rope') < count; ) {
                const before = q.count('rope');
                await q.ensure('coins', 15);
                await q.talk(/^ned$/i, [/i would like some rope/i, /please sell me some rope/i], NED);
                await untilTicks(q.sdk, () => q.count('rope') > before, 5);
                misses = q.count('rope') > before ? 0 : misses + 1;
            }
        },
    },

    // ── Plague City: Alrena's dwellberries and Bravek's hangover cure (milk, chocolate dust, snape grass)
    /** Hudo's Grand Tree Groceries (gnome.inv gnomeshop_hudo: dwellberries 3, chocolate dust 5, milk 5). */
    dwellberries: { inputs: (count) => [{ item: 'coins', count: 40 * count }], get: (q, count) => buyGroceries(q, /^dwellberries$/i, 'dwellberries', count) },
    'chocolate dust': { inputs: (count) => [{ item: 'coins', count: 40 * count }], get: (q, count) => buyGroceries(q, /^chocolate dust$/i, 'chocolate dust', count) },
    'bucket of milk': {
        obj: 'bucket_milk',
        inputs: (count) => [{ item: 'coins', count: 40 * count }],
        get: async (q, count) => {
            // Coins first: listed as an input but never ensured, so a coinless account looped at Hudo.
            await q.ensure('coins', 40 * (count - q.count('bucket of milk')));
            await buyGroceries(q, /^bucket of milk$/i, 'bucket of milk', count);
        },
    },
    /** No shop stocks it: three ground spawns among the hobgoblins (level 28) south-west of the Crafting Guild. */
    'snape grass': { get: (q, count) => pickSpawns(q, 'snape grass', count, SNAPE_GRASS_SPAWNS) },

    // ── Biohazard: Guidor's wife lets in a priest — top and bottom worn
    /**
     * Both halves are named "Priest gown" (objs 426 top, 428 bottom), so the need is
     * 'priest gown' x2 and this buys whichever id is missing. Thessalia (varrock.inv
     * clotheshop: 3 of each, 5gp).
     */
    'priest gown': {
        obj: 'priest_gown',
        inputs: () => [{ item: 'coins', count: 12 }],
        get: async (q) => {
            const ids = [426, 428];
            const held = (id: number) => [...q.sdk.getInventory(), ...q.sdk.getEquipment()].some((i) => i.id === id);
            if (ids.every(held)) return;
            await q.ensure('coins', 10);
            for (let attempt = 1; attempt <= 3 && !ids.every(held); attempt++) {
                await q.goTo(THESSALIA_CLOTHES, 3);
                if (!q.sdk.getState()?.shop?.isOpen) await q.bot.openShop(THESSALIA_CLOTHES.npc);
                for (const id of ids.filter((i) => !held(i))) {
                    const line = q.sdk.getState()?.shop?.shopItems.find((i) => i.id === id);
                    if (!line) continue;
                    const res = await q.bot.buyFromShop(line, 1);
                    if (!res.success) q.log(`priest gown ${id}: ${res.message}`);
                }
                await q.bot.closeShop().catch(() => undefined);
            }
            if (!ids.every(held)) throw new Error('priest gown: Thessalia did not sell both halves');
        },
    },
    // ── Merlin's Crystal: bat bones for Thrantax, wax for the black candle
    /** Giant bats (level 27, always bat bones) on the shore west of Keep Le Faye (m43_53 npc spawns). */
    'bat bones': { get: (q, count) => huntDrop(q, KEEP_GIANT_BATS, 'bat bones', count) },
    /** Ground spawn in Catherby (m43_53 obj 28); poured on the hive, never used up. */
    'insect repellent': { tool: true, get: (q, count) => pickUpSpawn(q, CATHERBY_INSECT_REPELLENT, 'insect repellent', count) },
    /** Repellent then a bucket on a Catherby beehive (bees.rs2); buckets from Arhein (lib/merlins-crystal.ts). */
    'bucket of wax': {
        obj: 'bucket_wax',
        inputs: (count) => [
            { item: 'bucket', count },
            { item: 'insect repellent', count: 1 },
        ],
        get: (q, count) => beehiveWax(q, count),
    },

    // ── Priest in Peril
    /**
     * Unstackable, one slot each, so a quest asks for a pack's worth at a time.
     * The Varrock east bank first, then the Rune Essence mine (lib/mining.ts
     * mineRuneEssence: Aubury's teleport, needs Rune Mysteries complete).
     */
    'rune essence': {
        obj: 'blankrune',
        inputs: () => [{ item: 'pickaxe', count: 1 }],
        get: async (q, count) => {
            await withdrawUnstackable(q, 'rune essence', count, VARROCK_EAST_BANK);
            for (let trip = 0; trip < 3 && q.count('rune essence') < count; trip++) {
                await q.ensure('pickaxe', 1);
                await mineRuneEssence(q, count);
            }
        },
    },

    // ── Heroes' Quest (lib/heroes-quest.ts)
    /**
     * The Black Arm side's Hartigen disguise for Garv: Varrock's armourers (that side is in
     * Varrock for Katrine anyway; a mule ask means a walk to jackthief's Ardougne bank).
     */
    /** Valaine only (stock 1, restocks in ~1000 ticks): waits upstairs for it. */
    'black full helm': {
        inputs: () => [{ item: 'coins', count: 2500 }],
        get: async (q, count) => {
            await buyAtValaine(q, 'black full helm', count, 1200);
            if (q.count('black full helm') < count) throw new Error(`Valaine had no black full helm (have ${q.count('black full helm')}/${count})`);
        },
    },
    /**
     * Valaine's (stock 1) restocks only every ~20000 ticks: an empty shelf there sends us to
     * Louie's in Al Kharid (stock 1, ~1200 ticks), which the next fleet buyer then waits on.
     */
    'black platelegs': {
        inputs: () => [{ item: 'coins', count: 4000 }],
        get: async (q, count) => {
            await buyAtValaine(q, 'black platelegs', count, 0);
            if (q.count('black platelegs') < count) await buyWaitingForRestock(q, LOUIE_LEGS, 'black platelegs', count);
        },
    },
    'black platebody': {
        inputs: () => [{ item: 'coins', count: 8000 }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, HORVIK, 'black platebody', count);
        },
    },
    /** Blamish oil's herb (clean; Herblore 25 for the oil). No shop sells it: the mule's herb stock. */
    harralander: { mule: true, muleSupply: 'jackthief' },
    /**
     * Shades of Mort'ton's Serum 207 herb (clean; one per 3 doses). No shop stocks it and no spawn places it: Herbi
     * Flax's table gives two once, cured Mort'ton villagers sometimes hand back 1-3 (afflicted.rs2), monsters' random
     * herb drops (shared_droptables.rs2). Asked only when the serum budget is short: the mule's herb stock.
     */
    tarromin: { mule: true, muleSupply: 'jackthief' },
    /** Jatix's vials (Taverley), filled at Falador's fountain. */
    'vial of water': {
        obj: 'vial_water',
        // Not mule-served: jackthief's ~480 went into prayer brewing and it answered "out of vial
        // of water" four times (2026-11-03), each a 4-minute wait. Jatix, then Aemad (below).
        inputs: (count) => [{ item: 'coins', count: 5 * count }],
        get: (q, count) => vialsOfWater(q, count),
    },
    'fishing rod': {
        tool: true,
        inputs: () => [{ item: 'coins', count: 10 }],
        get: async (q) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, GERRANT, 'fishing rod', 1);
        },
    },
    /** Fishing Contest's carp bait: a spade on the vines in McGrubor's Wood (lib/fishing-contest.ts). */
    'red vine worm': {
        obj: 'red_vine_worm',
        inputs: () => [{ item: 'spade', count: 1 }],
        get: async (q, count) => {
            const { digVineWorms } = await import('./fishing-contest');
            await digVineWorms(q, count);
        },
    },
    // ── Family Crest: Caleb wants one of each cooked fish (lib/crest.ts FISH). jackthief banks tuna and
    // shrimps; Jackpoo5 stopped on "need 1 salmon … no source procedure" (2026-11-04), so salmon also
    // has a source of its own: lure at Barbarian Village (Fishing 30), cook on the palace range.
    shrimps: { muleSupply: 'jackthief', mule: true },
    tuna: { muleSupply: 'jackthief', mule: true },
    bass: { muleSupply: 'jackthief', mule: true },
    swordfish: { muleSupply: 'jackthief', mule: true },
    salmon: {
        muleSupply: 'jackthief',
        levels: { fishing: 30, cooking: 25 },
        inputs: () => [{ item: 'coins', count: 40 }],
        get: (q, count) => lureSalmon(q, count),
    },
    /** Big Chompy Bird Hunting's ogre arrows (4 a shaft). Gerrant stocks 1000 (port_sarim.inv fishingshop), 2gp base. */
    feather: {
        inputs: (count) => [{ item: 'coins', count: 4 * count + 20 }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, GERRANT, 'feather', count);
        },
    },
    'fishing bait': {
        inputs: (count) => [{ item: 'coins', count: 5 * count }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, GERRANT, 'fishing bait', count);
        },
    },
    // ── Legends' Quest (lib/legends-quest.ts). Bought in East Ardougne where Aemad stocks it; the
    // rest is mule stock (jackthief at the Ardougne bank, the quest's hub) — the Magic Guild store's
    // soul rune needs Magic 66 to walk in, cosmic runes are Mage Arena-only. The gems, orb and
    // lockpick are nobody's shop stock: still jackthief first, else made (lib/legends-supplies.ts).
    /** Radimus' map: one papyrus a section (three), a botched attempt can ruin one. Aemad: 13gp, stock 50. */
    papyrus: {
        inputs: (count) => [{ item: 'coins', count: 15 * count }],
        get: async (q, count) => {
            await q.ensure('coins', 15 * count);
            await buyWaitingForRestock(q, AEMAD, 'papyrus', count);
        },
    },
    /** Only Jiminua (Karamja) and Obli (Shilo) sell it: mule stock first, else Jiminua's store on the island. */
    charcoal: {
        muleSupply: 'jackthief',
        inputs: (count) => [{ item: 'coins', count: 70 * count + 60 }],
        get: async (q, count) => {
            const { toJungle } = await import('./jungle-potion');
            await q.ensure('coins', 70 * count + 30);
            await toJungle(q, JIMINUA, 4);
            await buyWaitingForRestock(q, JIMINUA, 'charcoal', count);
        },
    },
    /**
     * Family Crest's cure for Johnathon. jackthief first; it ran out (2026-11-03), so else Jiminua's
     * Jungle Store (karamja.inv junglestore: 3doseantipoison, stock 10).
     */
    'antipoison(3)': {
        muleSupply: 'jackthief',
        inputs: (count) => [{ item: 'coins', count: 300 * count + 60 }],
        get: async (q, count) => {
            const { toJungle } = await import('./jungle-potion');
            await q.ensure('coins', 300 * count + 30);
            await toJungle(q, JIMINUA, 4);
            await buyWaitingForRestock(q, JIMINUA, 'antipoison(3)', count);
        },
    },
    /** The Yommi tree takes nothing but a rune axe (quest_legends.rs2 yommitree_*): the Woodcutting group's best is not enough. */
    'rune axe': { tool: true, mule: true, muleSupply: 'jackthief' },
    /**
     * The shaman caves' ancient gate (Thieving 50). No shop; rogues (pickpocket 5/128) spawn only in
     * deep wilderness. A ground spawn in the Yanille dungeon's spider room (2615,9571), reached by the
     * ledge and the monkey bars (Agility 57) without the town door's Thieving 82 and lockpick.
     */
    lockpick: {
        tool: true,
        muleSupply: 'jackthief',
        levels: { agility: 57 },
        inputs: () => [{ item: 'knife', count: 1 }],
        get: async (q, count) => {
            const { yanilleLockpicks } = await import('./legends-supplies');
            await yanilleLockpicks(q, count);
        },
    },
    /** The marked wall's S-M-E-L-L. */
    'soul rune': { obj: 'soulrune', mule: true, muleSupply: 'jackthief' },
    'mind rune': { obj: 'mindrune', mule: true, muleSupply: 'jackthief' },
    /** Charge Water Orb (Magic 56: 30 water, 3 cosmic, an unpowered orb) on the magic trial gate. */
    'cosmic rune': { obj: 'cosmicrune', mule: true, muleSupply: 'jackthief' },
    /** Blown on Entrana from molten glass (Crafting 46): every input is on the island but the buckets. */
    'unpowered orb': {
        obj: 'stafforb',
        muleSupply: 'jackthief',
        levels: { crafting: 46 },
        inputs: (count) => [{ item: 'bucket', count }],
        get: async (q, count) => {
            const { entranaGlass } = await import('./legends-supplies');
            await entranaGlass(q, { orbs: count });
        },
    },
    /**
     * The gem room's seven carved rocks (cut gems). Opal, jade and red topaz come only from Shilo
     * Village's gem rocks (Shilo Village done for Hajedy's cart, Mining 40), cut with a chisel.
     */
    opal: {
        muleSupply: 'jackthief',
        levels: { mining: 40 },
        inputs: () => [{ item: 'coins', count: 60 }],
        get: (q, count) => shiloGems(q, 'opal', count),
    },
    jade: {
        muleSupply: 'jackthief',
        levels: { mining: 40, crafting: 13 },
        inputs: () => [{ item: 'coins', count: 60 }],
        get: (q, count) => shiloGems(q, 'jade', count),
    },
    'red topaz': {
        obj: 'red_topaz',
        muleSupply: 'jackthief',
        levels: { mining: 40, crafting: 16 },
        inputs: () => [{ item: 'coins', count: 60 }],
        get: (q, count) => shiloGems(q, 'red topaz', count),
    },
    sapphire: { mule: true, muleSupply: 'jackthief' },
    emerald: { mule: true, muleSupply: 'jackthief' },
    ruby: { mule: true, muleSupply: 'jackthief' },
    diamond: { mule: true, muleSupply: 'jackthief' },
    /** The golden bowl (Smithing 50, two bars at an anvil). */
    'gold bar': { obj: 'gold_bar', mule: true, muleSupply: 'jackthief' },
    // ── Watchtower: Toban's dragon bone, the city guard's death rune, the ogre potion's guam and pestle
    'dragon bones': { obj: 'dragon_bones', mule: true, muleSupply: 'jackthief' },
    'death rune': { ...runes('death rune', 180), muleSupply: 'jackthief' },
    'guam leaf': { obj: 'guam_leaf', mule: true, muleSupply: 'jackthief' },
    /** Temple of Ikov: Winelda's twenty roots (unnoted). */
    'limpwurt root': { obj: 'limpwurt_root', mule: true, muleSupply: 'jackthief' },
    // ── The Dig Site: the panning guide's tea and the barrel's vial
    'cup of tea': {
        inputs: (count) => [{ item: 'coins', count: 20 * count }],
        get: async (q, count) => {
            await q.ensure('coins', 20 * count);
            await buyWaitingForRestock(q, { x: 3271, z: 3411, npc: /^tea seller$/i }, 'cup of tea', count);
        },
    },
    vial: {
        obj: 'vial_empty',
        inputs: (count) => [{ item: 'coins', count: 5 * count }],
        get: async (q, count) => {
            await q.ensure('coins', 5 * count);
            await buyWaitingForRestock(q, JATIX, 'vial', count);
        },
    },
    /** Observatory: the professor's lens (no shop sells it; sand and soda ash are a Crafting trip). */
    'molten glass': {
        obj: 'molten_glass',
        muleSupply: 'jackthief',
        inputs: (count) => [{ item: 'bucket', count }],
        get: async (q, count) => {
            const { entranaGlass } = await import('./legends-supplies');
            await entranaGlass(q, { glass: count });
        },
    },
    'pestle and mortar': {
        tool: true,
        inputs: () => [{ item: 'coins', count: 20 }],
        get: async (q) => {
            await q.ensure('coins', 20);
            await buyWaitingForRestock(q, JATIX, 'pestle and mortar', 1);
        },
    },
    /** Nezikchened's three fights drain prayer (90%, 18, 75%): whatever doses the bank or jackthief holds. */
    'prayer potion': { obj: '4doseprayerrestore', muleSupply: 'jackthief' },
    /** Taverley's blue dragons on the way to the lava: Duke Horacio replaces one for a Dragon Slayer. */
    'dragonbreath shield': {
        obj: 'antidragonbreathshield',
        tool: true,
        get: async (q) => {
            const { fetchDukeShield } = await import('../duke-shield');
            await fetchDukeShield(q.bot, q.sdk, q.log);
        },
    },
    /** Horror from the Deep's lighthouse torch: the Lumbridge swamp's ground spawns (m49_49, e.g. 3164,3169 / 3170,3167). */
    'swamp tar': { obj: 'swamp_tar', get: (q, count) => pickUpSpawn(q, { x: 3167, z: 3169 }, 'swamp tar', count) },
    /** Horror from the Deep's strange wall eats a stab/slash weapon: the Varrock sword shop's (varrock.inv swordshop). */
    'bronze dagger': {
        obj: 'bronze_dagger',
        inputs: (count) => [{ item: 'coins', count: 10 * count }],
        get: async (q, count) => {
            await q.ensure('coins', 10 * count);
            await buyWaitingForRestock(q, { x: 3204, z: 3399, npc: /^shop (keeper|assistant)$/i }, 'bronze dagger', count);
        },
    },
    // ── In Search of the Myreque: six steel weapons for the Myreque, counted in the pack (quest_routequest.rs2)
    /** Varrock Swords (varrock.inv swordshop): longsword 500gp, stock 3. */
    'steel longsword': steelFromShop('steel longsword', 650, VARROCK_SWORDS),
    /** Varrock Swords: 325gp, stock 4. */
    'steel sword': steelFromShop('steel sword', 420, VARROCK_SWORDS),
    /** Varrock Swords: 125gp, stock 5. */
    'steel dagger': steelFromShop('steel dagger', 160, VARROCK_SWORDS),
    /** Flynn's Mace Market, Falador (falador.inv maceshop): 225gp, stock 4. */
    'steel mace': steelFromShop('steel mace', 290, { x: 2950, z: 3386, npc: /^flynn$/i }),
    /** Smithed from the mule's steel bars (jackthief smiths nails from them); Smithing 34+, one bar each. */
    'steel bar': { obj: 'steel_bar', mule: true, muleSupply: 'jackthief' },
    /**
     * No shop sells one but Skulgrimen in Rellekka (Fremennik Trials only): smithed from 3 steel bars (Smithing 39)
     * at the Varrock west anvils (3188,3424), 15 tiles from the Varrock west bank.
     */
    'steel warhammer': {
        obj: 'steel_warhammer',
        levels: { smithing: 39 },
        inputs: (count) => [
            { item: 'steel bar', count: 3 * count },
            { item: 'hammer', count: 1 },
        ],
        get: async (q, count) => {
            await q.ensure('steel bar', 3 * count);
            await q.ensure('hammer', 1);
            await q.goTo({ x: 3190, z: 3424 }, 2);
            for (let i = 0; i < count * 2 && q.count('steel warhammer') < count; i++) {
                const r = await q.bot.smithAtAnvil('warhammer', { barPattern: /^steel bar$/i, timeout: ticksToMs(40) });
                if (!r.success) q.log(`steel warhammer: ${r.message}`);
                await q.sdk.waitForTicks(2);
            }
        },
    },
    /** Nature Spirit: The Restless Ghost's amulet (Father Urhney replaces a lost one) — bank stock, not sourced here. */
    'ghostspeak amulet': { obj: 'amulet_of_ghostspeak', mule: true, tool: true },
    /** Nature Spirit: silver bar + sickle mould (Crafting 18) — bank/mule stock, not sourced here. */
    'silver sickle': { obj: 'silver_sickle', mule: true, tool: true },
    /** Elemental Workshop's 4 coal: mined at the Coal Trucks west of Seers (lib/elemental-workshop.ts). */
    coal: {
        levels: { mining: 30 },
        inputs: () => [{ item: 'pickaxe', count: 1 }],
        get: async (q, count) => {
            await q.ensure('pickaxe', 1);
            const { mineCoal } = await import('./elemental-workshop');
            await mineCoal(q, count);
        },
    },
    // ── Eadgar's Ruse: the zoo parrot's alco-chunks, the scarecrow's grain, the troll truth potion's ranarr
    /** Heckel Funch, Grand Tree L1 (gnomeshop_heck: vodka 5, pineapple 5, knife 5). */
    vodka: {
        inputs: (count) => [{ item: 'coins', count: 10 * count + 10 }],
        get: async (q, count) => {
            await q.ensure('coins', 10);
            await buyGroceries(q, /^vodka$/i, 'vodka', count, HECKEL_FUNCH);
        },
    },
    pineapple: {
        inputs: (count) => [{ item: 'coins', count: 10 * count + 10 }],
        get: async (q, count) => {
            await q.ensure('coins', 10);
            await buyGroceries(q, /^pineapple$/i, 'pineapple', count, HECKEL_FUNCH);
        },
    },
    /** A knife on a pineapple: "Dice the pineapple" (cutting_fruit.rs2 slice_or_dice_interface). */
    'pineapple chunks': {
        inputs: (count) => [
            { item: 'pineapple', count: Math.ceil(count / 4) },
            { item: 'knife', count: 1 },
        ],
        get: async (q, count) => {
            const hadKnife = q.count('knife') > 0;
            for (let tries = 0; tries < 4 && q.count('pineapple chunks') < count; tries++) {
                await q.ensure('pineapple', 1);
                // Heckel sells knives beside the pineapples (the knife source's own spawn is in Lumbridge).
                if (q.count('knife') < 1) await buyGroceries(q, /^knife$/i, 'knife', 1, HECKEL_FUNCH);
                const before = q.count('pineapple chunks');
                const knife = q.sdk.findInventoryItem(/^knife$/i);
                const fruit = q.sdk.findInventoryItem(/^pineapple$/i);
                if (!knife || !fruit) continue;
                await q.sdk.sendUseItemOnItem(knife.slot, fruit.slot);
                await untilTicks(q.sdk, (st) => !!st.dialog?.isOpen || q.count('pineapple chunks') > before, 8);
                if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/dice/i, /chunk/i], { done: () => q.count('pineapple chunks') > before, ticks: 15 });
                await untilTicks(q.sdk, () => q.count('pineapple chunks') > before, 5);
            }
            // A knife bought for this is dropped: Eadgar's Ruse starts with a full pack.
            if (!hadKnife) await q.bot.dropItem(/^knife$/i, 'all').catch(() => undefined);
        },
    },
    /** Wheat, Pick (pickables.rs2). */
    grain: { get: (q, count) => pickLocs(q, 'grain', /^wheat$/i, SEERS_WHEAT, count) },
    /** The fleet's banks hold ~1,250 (prayer brewing); jackthief brews from it too. */
    'ranarr weed': { obj: 'ranarr_weed', mule: true, muleSupply: 'jackthief' },
    // ── Troll Romance: Dunstan's sled (maple logs) and the sled wax's cake tin
    /** Arhein's store, Catherby (arheinstore: cake tin 2). */
    'cake tin': {
        inputs: () => [{ item: 'coins', count: 30 }],
        get: async (q, count) => {
            await q.ensure('coins', 10);
            await buyWaitingForRestock(q, ARHEIN, 'cake tin', count);
        },
    },
    /** The maples north-east of Seers (loc mapletree, m41_55: 2651-2683,3521-3559); Woodcutting 45 with an axe. */
    'maple logs': {
        levels: { woodcutting: 45 },
        inputs: () => [{ item: 'axe', count: 1 }],
        get: async (q, count) => {
            await q.ensure('axe', 1);
            const t0 = tickNow(q.sdk);
            while (q.count('maple logs') < count && tickNow(q.sdk) - t0 < 1500) {
                const p = q.sdk.getState()?.player;
                if (Math.hypot((p?.worldX ?? 0) - SEERS_MAPLES.x, (p?.worldZ ?? 0) - SEERS_MAPLES.z) > 14) await q.goTo(SEERS_MAPLES, 4);
                await q.sdk.scanNearbyLocs(14).catch(() => undefined);
                const tree = (q.sdk.getNearbyLocs() ?? [])
                    .filter((l) => /^maple tree$/i.test(l.name) && l.reachable !== false && l.options.some((o) => /chop/i.test(o)))
                    .sort((a, b) => a.distance - b.distance)[0];
                if (!tree) {
                    await q.sdk.waitForTicks(5);
                    continue;
                }
                await q.bot.chopTree(tree).catch(() => undefined);
            }
        },
    },
    // ── Throne of Miscellania: Princess Astrid's ring (a gem ring banked is taken instead; no shop sells a gold ring)
    'gold ring': { obj: 'gold_ring', mule: true, muleSupply: 'jackthief' },
};

/** Horvik's armour shop, Varrock (varrock.inv armourshop): black platebody, stock 1. */
const HORVIK = { x: 3229, z: 3438, npc: /^horvik$/i };
/** Valaine's shop, upstairs in the Champions' Guild (champions_guild.inv championshop; 32 QP door). */
const VALAINE = { x: 3193, z: 3361, level: 1 };
const CHAMPIONS_STAIRS_FOOT = { x: 3189, z: 3356 };

/** Louie's Armoured Legs Bazaar, Al Kharid (alkharid.inv): black platelegs, stock 1. */
const LOUIE_LEGS = { x: 3316, z: 3175, npc: /^louie legs$/i };

/** Buy upstairs at Valaine's, waiting up to `waitTicks` for an empty shelf to restock. Never throws. */
async function buyAtValaine(q: Quest, item: string, count: number, waitTicks: number): Promise<void> {
    await q.ensure('coins', 1);
    // Through the guild door on the ground floor first: a climb from the street takes any stairs.
    await q.goTo(CHAMPIONS_STAIRS_FOOT, 2);
    await q.goTo(VALAINE, 4);
    const pattern = itemPattern(item);
    const stock = () => q.sdk.getState()?.shop?.shopItems.find((i) => pattern.test(i.name))?.count ?? 0;
    const t0 = tickNow(q.sdk);
    for (let tries = 0; tries < 6 && q.count(item) < count; tries++) {
        if (!q.sdk.getState()?.shop?.isOpen) await q.bot.openShop(/^valaine$/i).catch(() => undefined);
        if (stock() > 0) await q.bot.buyFromShop(pattern, count - q.count(item)).catch(() => undefined);
        await q.sdk.waitForTicks(2);
        if (q.count(item) >= count) break;
        const left = waitTicks - (tickNow(q.sdk) - t0);
        if (left <= 0) break;
        q.log(`${item} out of stock at Valaine's — waiting for restock`);
        await untilTicks(q.sdk, (s) => !s.shop?.isOpen || stock() > 0, left);
    }
    await q.bot.closeShop().catch(() => undefined);
    await q.climbTo(0);
}

const JATIX = { x: 2899, z: 3427, npc: /^jatix$/i };
const FALADOR_FOUNTAIN = { x: 2950, z: 3379 };

/** Empty vials from Jatix, then each filled at the Falador fountain. */
/** Barbarian Village's river: rod (Lure/Bait) fishing spots along x 3100-3110, z 3424-3434. */
const BARBARIAN_FISH = { x: 3104, z: 3428 };

/**
 * Cooked salmon: a fly fishing rod and feathers from Gerrant (port_sarim.inv: fly_fishing_rod 5,
 * feather 1000), lure at Barbarian Village until `count` raw salmon (trout are dropped), then the
 * Varrock palace range. A burnt one is fished again; bounded in ticks.
 */
async function lureSalmon(q: Quest, count: number): Promise<void> {
    const RAW = /^raw salmon$/i;
    const COOKED = /^salmon$/i;
    const cooked = () => q.sdk.getInventory().filter((i) => COOKED.test(i.name)).length;
    const raw = () => q.sdk.getInventory().filter((i) => RAW.test(i.name)).length;
    const t0 = tickNow(q.sdk);
    for (let round = 1; round <= 3 && cooked() < count; round++) {
        if (!q.sdk.findInventoryItem(/^fly fishing rod$/i)) {
            await q.ensure('coins', 10);
            await buyWaitingForRestock(q, GERRANT, 'fly fishing rod', 1);
        }
        const want = count - cooked();
        if (q.count('feather') < want * 2 + 5) {
            await q.ensure('coins', want * 2 + 10);
            await buyWaitingForRestock(q, GERRANT, 'feather', want * 2 + 5);
        }
        await q.goTo(BARBARIAN_FISH, 6);
        const tf = tickNow(q.sdk);
        while (raw() < want && tickNow(q.sdk) - tf < 1500) {
            for (const t of q.sdk.getInventory().filter((i) => /^raw trout$/i.test(i.name))) await q.sdk.sendDropItem(t.slot).catch(() => undefined);
            const spot = q.sdk.findNearbyNpc(/^fishing spot$/i);
            if (!spot) {
                await q.goTo(BARBARIAN_FISH, 3);
                await q.sdk.waitForTicks(5);
                continue;
            }
            const before = raw();
            await q.bot.interactNpc(spot, /lure/i).catch(() => undefined);
            await untilTicks(q.sdk, () => raw() > before, 30);
        }
        q.log(`salmon: ${raw()} raw after ${tickNow(q.sdk) - tf}t at Barbarian Village`);
        while (raw() > 0 && cooked() < count) await cookAtPalaceRange(q, RAW, COOKED);
    }
    if (cooked() < count) throw new Error(`salmon: ${cooked()}/${count} cooked after ${tickNow(q.sdk) - t0}t`);
}

async function vialsOfWater(q: Quest, count: number): Promise<void> {
    const need = count - q.count('vial of water');
    if (need <= 0) return;
    if (q.count('vial') < need) {
        await q.ensure('coins', 1);
        // Jatix once, no restock wait: he sat at 0 for 2000 ticks and failed three Heroes'
        // runs (2026-11-03). Aemad (East Ardougne) sells vials of water outright, stock 500.
        const { buyAtShop } = await import('../quest-supplies');
        await buyAtShop(q.supply, JATIX, [{ pattern: /^vial$/i, amount: need, label: 'vial' }]).catch((e) => q.log(`vial at Jatix: ${(e as Error).message}`));
        await q.bot.closeShop().catch(() => undefined);
        if (q.count('vial') < need) {
            q.log('vial: Jatix is out — buying vials of water from Aemad');
            await buyWaitingForRestock(q, AEMAD, 'vial of water', count);
            if (q.count('vial of water') >= count) return;
        }
    }
    await q.goTo(FALADOR_FOUNTAIN, 3);
    for (let i = 0; i < need * 2 && q.count('vial of water') < count; i++) {
        await q.sdk.scanNearbyLocs(8).catch(() => undefined);
        const fountain = q.sdk.findNearbyLoc(/^fountain$/i);
        const vial = q.sdk.findInventoryItem(/^vial$/i);
        if (!fountain || !vial) break;
        const before = q.count('vial of water');
        await q.bot.useItemOnLoc(vial, fountain).catch(() => undefined);
        await untilTicks(q.sdk, () => q.count('vial of water') > before, 10);
    }
    if (q.count('vial of water') < count) throw new Error(`filled ${q.count('vial of water')}/${count} vials at the Falador fountain`);
}

// ── Priest in Peril helpers

const VARROCK_EAST_BANK = { x: 3253, z: 3420 };

/** Withdraw up to `count` held of an unstackable item from `bank`, as many as the bank and pack allow. */
async function withdrawUnstackable(q: Quest, item: string, count: number, bank: { x: number; z: number }): Promise<void> {
    const pattern = itemPattern(item);
    const want = Math.min(count - q.count(item), 28 - q.sdk.getInventory().length);
    if (want <= 0) return;
    await q.goTo(bank, 3);
    if (!(q.sdk.getState()?.bank?.isOpen || (await q.bot.openBank()).success)) return q.log(`${item}: bank would not open`);
    const stock = q.sdk.findBankItem(pattern);
    if (stock) {
        const before = q.count(item);
        await q.bot.withdrawItem(stock, Math.min(want, stock.count ?? want));
        await untilTicks(q.sdk, () => q.count(item) > before, 5);
        q.log(`withdrew ${q.count(item) - before} ${item} (bank had ${stock.count ?? '?'})`);
    }
    await q.bot.closeBank().catch(() => undefined);
}

// ── Coins

/** Men outside Lumbridge castle (npc spawns 3223,3240 and 3216,3219). */
const LUMBRIDGE_MEN = { x: 3223, z: 3240 };
/**
 * Clusters of Man spawns (npc ids 1-3, name "Man") from the map files, surface only. The nearest
 * one is used: jacklove13 walked Ardougne→Lumbridge (~an hour) for 12 coins (2026-11-03).
 */
const MEN_SPOTS = [
    LUMBRIDGE_MEN,
    { x: 2697, z: 3492 }, // Seers' Village (m42_54: 2693,3489 / 2694,3497 / 2698,3491)
    { x: 2804, z: 3430 }, // Catherby (m43_53: 2803,3431 / 2805,3428)
    { x: 2596, z: 3105 }, // Yanille (m40_48: 2596,3104 / 2596,3106)
    { x: 3240, z: 3402 }, // Varrock east of the square (m50_53)
    { x: 3097, z: 3510 }, // Edgeville (m48_54, seven spawns)
    { x: 2974, z: 3375 }, // Falador north (m46_52: 2967,3373 / 2981,3378)
];

function nearestMen(q: Quest): { x: number; z: number } {
    const p = q.sdk.getState()?.player;
    if (!p || p.worldZ > 6000) return LUMBRIDGE_MEN;
    const d = (s: { x: number; z: number }) => Math.max(Math.abs(s.x - p.worldX), Math.abs(s.z - p.worldZ));
    return MEN_SPOTS.reduce((a, b) => (d(b) < d(a) ? b : a));
}

/** Shop sources ask for 1 coin (the prologue normally withdrew the real amount); a broke account earns a working float. */
const COIN_FLOAT = 300;

async function pickpocketCoins(q: Quest, asked: number): Promise<void> {
    // A real amount (Baraek's 20gp bribe) is just that: the 300 float took ABGARMY08 3016 ticks
    // in Varrock for a 20gp ask (2026-11-03). Only a 1-coin shop placeholder earns the float.
    const count = asked > 1 ? asked : COIN_FLOAT;
    const spot = nearestMen(q);
    q.log(`coins: pickpocketing men at ${spot.x},${spot.z}`);
    await q.goTo(spot, 6);
    const t0 = tickNow(q.sdk);
    for (let tries = 0; q.count('coins') < count && tickNow(q.sdk) - t0 < 3000; tries++) {
        const man = q.sdk.findNearbyNpc(/^man$/i);
        if (!man) {
            await q.goTo(spot, 3);
            await q.sdk.waitForTicks(5);
            continue;
        }
        const r = await q.bot.pickpocketNpc(man).catch((e) => ({ success: false, message: String(e) }));
        if (!r.success && tries % 10 === 0) q.log(`coins pickpocket: ${r.message}`);
        await q.sdk.waitForTicks(1);
    }
    q.log(`pickpocketed ${q.count('coins')} coins in ${tickNow(q.sdk) - t0}t`);
}

// ── Prince Ali Rescue helpers

/** Shantay's shop, by the desert pass (shantaypass.inv: bucket of water, bronze bar). */
const SHANTAY = { x: 3304, z: 3127, npc: /^shantay$/i };
/** Shantay is behind the Al Kharid toll: 10gp in, 10gp out. */
const SHANTAY_TOLLS = 20;
/** Thessalia's clothes shop, Varrock (varrock.inv: pink skirt). */
const THESSALIA = { x: 3207, z: 3416, npc: /^thessalia$/i };
/** Ned's house, Draynor. */
const NED = { x: 3101, z: 3258 };

// ── Goblin Diplomacy helpers

/** Aggie's house, Draynor (aggie.rs2). */
const AGGIE = { x: 3086, z: 3259 };
/** Wyson the gardener, Falador park. */
const WYSON = { x: 3027, z: 3379 };
/** Static ground spawns, one each, respawning in 100 ticks (quest-lab-objfind redberries). */
/**
 * Onion plants: the Rimmington patch beside Melzar's Maze first (12 plants at x 2946-2952,
 * z 3249-3253, in game 2026-10-29; locfind misses them under another loc id), then the
 * Rellekka field, an hour's walk from the Lumbridge side.
 */
const ONION_FIELD = [
    { x: 2949, z: 3251 },
    { x: 2681, z: 3666 },
    { x: 2677, z: 3674 },
    { x: 2684, z: 3683 },
    { x: 2680, z: 3689 },
    { x: 2675, z: 3696 },
    { x: 2678, z: 3649 },
];
const REDBERRY_SPAWNS = [
    { x: 3267, z: 3371 },
    { x: 3271, z: 3366 },
    { x: 3278, z: 3374 },
];
/** Cadava berry ground spawns, one each (quest-lab-objfind cadavaberries); the redberry patch is the same field. */
const CADAVA_SPAWNS = [
    { x: 3266, z: 3361 },
    { x: 3273, z: 3375 },
    { x: 3277, z: 3370 },
];
/** The Rusty Anchor, Port Sarim (the Goblin Diplomacy bartender). */
const RUSTY_ANCHOR = { x: 3045, z: 3257 };
/** Morgan's house, Draynor: the foot of his stairs (3099,3266), and the garlic cupboard (3096,3268) on plane 1. */
const MORGAN_STAIRS_FOOT = { x: 3099, z: 3267 };
const GARLIC_CUPBOARD = { x: 3096, z: 3268 };

/** cupboards.rs2: Morgan's cupboard opens (op1) and then gives one garlic per Search. */
async function morganGarlic(q: Quest, count: number): Promise<void> {
    if ((q.sdk.getState()?.player?.level ?? 0) !== 1) {
        await q.goTo(MORGAN_STAIRS_FOOT, 1);
        await q.climbTo(1);
    }
    for (let misses = 0; misses < 4 && q.count('garlic') < count; ) {
        await q.sdk.scanNearbyLocs(8).catch(() => undefined);
        const cupboard = (q.sdk.getNearbyLocs() ?? [])
            .filter((l) => /^cupboard$/i.test(l.name))
            .sort((a, b) => Math.hypot(a.x - GARLIC_CUPBOARD.x, a.z - GARLIC_CUPBOARD.z) - Math.hypot(b.x - GARLIC_CUPBOARD.x, b.z - GARLIC_CUPBOARD.z))[0];
        if (!cupboard) throw new Error(`no cupboard near (${q.sdk.getState()?.player?.worldX},${q.sdk.getState()?.player?.worldZ}) upstairs in Morgan's house`);
        const before = q.count('garlic');
        if (cupboard.options?.some((o) => /^search$/i.test(o))) {
            await q.bot.interactLoc(cupboard, /^search$/i);
            await untilTicks(q.sdk, () => q.count('garlic') > before, 8);
        } else {
            await q.bot.interactLoc(cupboard, /^open$/i);
            // The shut cupboard changes into the open one; wait for its Search option.
            const opened = await untilTicks(q.sdk, () => (q.sdk.getNearbyLocs() ?? []).some((l) => l.x === cupboard.x && l.z === cupboard.z && l.options?.some((o) => /^search$/i.test(o))), 6);
            if (!opened) misses++;
            continue;
        }
        await q.bot.dismissBlockingUI();
        misses = q.count('garlic') > before ? 0 : misses + 1;
    }
    await q.climbTo(0);
}

/** Goblin camps east of Lumbridge and north of Port Sarim (the old script's npcfind-verified camps). */
const GOBLIN_CAMPS = [
    { x: 3252, z: 3230 },
    { x: 3001, z: 3207 },
];

/** Plain goblin mail dyed `colour` (goblin_mail.rs2: use the dye on the mail). */
function dyedMail(colour: string): Source {
    const dye = `${colour} dye`;
    const product = `${colour} goblin mail`;
    return {
        inputs: (count) => [
            { item: 'goblin mail', count },
            { item: dye, count },
        ],
        get: async (q, count) => {
            const more = count - q.count(product);
            await q.ensure(dye, more);
            await q.ensure('goblin mail', more);
            await useUntil(q, dye, 'goblin mail', product, count);
        },
    };
}

/** Use `src` on `dst` (both held) until holding `count` of `product`; each use waits for its result. */
async function useUntil(q: Quest, src: string, dst: string, product: string, count: number): Promise<void> {
    for (let misses = 0; misses < 3 && q.count(product) < count; ) {
        const a = q.sdk.findInventoryItem(itemPattern(src));
        const b = q.sdk.findInventoryItem(itemPattern(dst));
        if (!a || !b) break;
        const before = q.count(product);
        await q.sdk.sendUseItemOnItem(a.slot, b.slot);
        await untilTicks(q.sdk, () => q.count(product) > before, 5);
        misses = q.count(product) > before ? 0 : misses + 1;
    }
}

/**
 * Aggie makes one dye per use of its ingredient on her ([opnpcu,aggie] in
 * aggie.rs2): `per` of the ingredient and 5 coins. The dye lands after the
 * player's "make me some" page is continued, so pump continues until it does.
 */
function aggieDye(colour: string, ingredient: string, per: number): Source {
    const dye = `${colour} dye`;
    return {
        inputs: (count) => [
            { item: ingredient, count: per * count },
            { item: 'coins', count: 5 * count },
        ],
        get: async (q, count) => {
            const more = count - q.count(dye);
            await q.ensure(ingredient, per * more);
            await q.ensure('coins', 5 * more);
            for (let misses = 0; misses < 3 && q.count(dye) < count; ) {
                const before = q.count(dye);
                await closeUi(q.bot, q.sdk);
                await q.goTo(AGGIE, 3);
                await q.bot.useItemOnNpc(itemPattern(ingredient), /^aggie$/i, { timeout: ticksToMs(20) });
                await driveDialog(q.sdk, [], { done: () => q.count(dye) > before, ticks: 40, log: q.log });
                await closeUi(q.bot, q.sdk);
                misses = q.count(dye) > before ? 0 : misses + 1;
            }
        },
    };
}

/** Pick `item` from its static ground spawns until holding `count`, waiting out respawns (bounded). */
/** Cut legends gems from Shilo Village's gem rocks (lib/legends-supplies.ts). */
async function shiloGems(q: Quest, gem: 'opal' | 'jade' | 'red topaz', count: number): Promise<void> {
    const { mineShiloGems } = await import('./legends-supplies');
    await mineShiloGems(q, gem, count);
}

async function pickSpawns(q: Quest, item: string, count: number, spawns: Array<{ x: number; z: number }>): Promise<void> {
    const pattern = itemPattern(item);
    const t0 = tickNow(q.sdk);
    // Two respawn cycles (100t each) plus the walks between spawns.
    while (q.count(item) < count && tickNow(q.sdk) - t0 < 400) {
        let took = false;
        for (const spot of spawns) {
            if (q.count(item) >= count) break;
            const p = q.sdk.getState()?.player;
            if (Math.hypot((p?.worldX ?? 0) - spot.x, (p?.worldZ ?? 0) - spot.z) > 6) await q.goTo(spot, 3);
            const ground = (q.sdk.getState()?.groundItems ?? []).find((g) => pattern.test(g.name) && g.x === spot.x && g.z === spot.z);
            if (!ground) continue;
            const before = q.count(item);
            await q.bot.pickupItem(ground);
            await untilTicks(q.sdk, () => q.count(item) > before, 10);
            took ||= q.count(item) > before;
        }
        if (!took && q.count(item) < count) await q.sdk.waitForTicks(10);
    }
    q.log(`picked ${q.count(item)}/${count} ${item} in ${tickNow(q.sdk) - t0}t`);
}

/** Pick `item` from `loc` plants (op "Pick") around the spots until holding `count`; plants respawn. */
async function pickLocs(q: Quest, item: string, loc: RegExp, spots: Array<{ x: number; z: number }>, count: number): Promise<void> {
    const t0 = tickNow(q.sdk);
    while (q.count(item) < count && tickNow(q.sdk) - t0 < 600) {
        let took = false;
        for (const spot of spots) {
            if (q.count(item) >= count) break;
            const p = q.sdk.getState()?.player;
            if (Math.hypot((p?.worldX ?? 0) - spot.x, (p?.worldZ ?? 0) - spot.z) > 6) {
                // A spot inside a fenced patch can be unroutable from where we stand: try the
                // next spot rather than failing the quest (prod, jacklove3, Stuck at 2675,3655).
                try {
                    await q.goTo(spot, 6);
                } catch (err) {
                    q.log(`${item}: skipping spot (${spot.x},${spot.z}) — ${err instanceof Error ? err.message : String(err)}`);
                    continue;
                }
            }
            await q.sdk.scanNearbyLocs(8).catch(() => undefined);
            // The Rellekka plants sit in fenced patches: open the gate toward one first
            // (seen 7 onions, "I can't reach that!", 0 picked in 704t without this).
            if (q.sdk.findNearbyLoc(loc, { withOption: /pick/i })?.reachable === false) await q.reach(loc, /pick/i).catch(() => undefined);
            const plant = q.sdk.findNearbyLoc(loc, { withOption: /pick/i, reachable: true });
            if (!plant) continue;
            const before = q.count(item);
            await q.bot.interactLoc(plant, /pick/i);
            await untilTicks(q.sdk, () => q.count(item) > before, 10);
            took ||= q.count(item) > before;
        }
        if (!took && q.count(item) < count) await q.sdk.waitForTicks(10);
    }
    q.log(`picked ${q.count(item)}/${count} ${item} in ${tickNow(q.sdk) - t0}t`);
}

/** Harpoon the Net/Harpoon spots off Catherby's pier until holding `count` raw sharks. */
async function harpoonSharks(q: Quest, count: number): Promise<void> {
    const t0 = tickNow(q.sdk);
    let pier = 0;
    while (q.count('raw shark') < count && tickNow(q.sdk) - t0 < 3_000) {
        const spot = (q.sdk.getNearbyNpcs() ?? [])
            .filter((n) => /fishing spot/i.test(n.name) && n.optionsWithIndex.some((o) => /^net$/i.test(o.text)) && n.optionsWithIndex.some((o) => /^harpoon$/i.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!spot || (spot.distance ?? 99) > 8) {
            await q.goTo(CATHERBY_PIER[pier++ % CATHERBY_PIER.length]!, 2);
            continue;
        }
        const op = spot.optionsWithIndex.find((o) => /^harpoon$/i.test(o.text))!;
        const before = q.count('raw shark');
        await q.sdk.sendInteractNpc(spot.index, op.opIndex);
        // A catch takes many casts at 76-99; the spot moving away ends the wait early.
        await untilTicks(q.sdk, () => q.count('raw shark') > before || !q.sdk.getNearbyNpcs()?.some((n) => n.index === spot.index), 100);
    }
    q.log(`harpooned ${q.count('raw shark')}/${count} raw shark in ${tickNow(q.sdk) - t0}t`);
}

/** Kill `npc` at the camps and loot `item` until holding `count`: a rare drop, so budgeted in ticks. */
async function killForDrop(q: Quest, item: string, count: number, camps: Array<{ x: number; z: number }>, npc: RegExp): Promise<void> {
    const pattern = itemPattern(item);
    const t0 = tickNow(q.sdk);
    let camp = 0;
    let lastGain = t0;
    let kills = 0;
    while (q.count(item) < count && tickNow(q.sdk) - t0 < 6_000) {
        // Other accounts grind the same camp and take the drops: move on after a dry spell.
        if (tickNow(q.sdk) - lastGain > 500) {
            camp = (camp + 1) % camps.length;
            lastGain = tickNow(q.sdk);
            q.log(`no ${item} for 500t, moving to camp (${camps[camp]!.x},${camps[camp]!.z})`);
        }
        const drop = q.sdk.findGroundItem(pattern, { reachable: true });
        if (drop) {
            const before = q.count(item);
            await q.bot.pickupItem(drop);
            await untilTicks(q.sdk, () => q.count(item) > before, 10);
            if (q.count(item) > before) lastGain = tickNow(q.sdk);
            continue;
        }
        const here = camps[camp]!;
        const p = q.sdk.getState()?.player;
        if (Math.hypot((p?.worldX ?? 0) - here.x, (p?.worldZ ?? 0) - here.z) > 15) await q.goTo(here, 6);
        const target = q.sdk.findNearbyNpc(npc, { reachable: true });
        if (!target) {
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.bot.attack(target, ticksToMs(20));
        // Until it dies (gone, or hp 0); the drop lands on its tile a tick later.
        await untilTicks(q.sdk, (s) => !s.nearbyNpcs.some((n) => n.index === target.index && (n.hp ?? 1) > 0), 60);
        await q.sdk.waitForTicks(2);
        kills++;
    }
    q.log(`${item}: ${q.count(item)}/${count} after ${kills} kills in ${tickNow(q.sdk) - t0}t`);
}

/** Spin → Make 10 (wool) at the reachable wheel; returns once the wool stops going down. */
async function spinBatch(q: Quest): Promise<void> {
    await q.bot.interactLoc(/spinning wheel/i, /spin/i);
    await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 15);
    // Each product publishes Make X / Make 10 / Make 5, then its own label.
    const options = q.sdk.getDialog()?.options ?? [];
    // Labels carry literal backslash-n padding, so a \b before the name never matches.
    const label = options.findIndex((o) => /wool\s*$/i.test(o.text));
    const make10 = options.slice(0, Math.max(label, 0)).reverse().find((o) => /make 10/i.test(o.text));
    if (!make10) {
        q.log(`spin: no Make 10 for wool in ${JSON.stringify(options.map((o) => o.text.trim()))}`);
        await q.bot.closeInterface().catch(() => undefined);
        return;
    }
    await q.sdk.sendClickDialog(make10.index);
    let last = q.count('wool');
    for (let still = 0; still < 8 && last > 0; ) {
        await q.sdk.waitForTicks(1);
        const now = q.count('wool');
        still = now < last ? 0 : still + 1;
        last = now;
    }
    await q.bot.dismissBlockingUI();
}

/** Runes from Betty's (Port Sarim), `price` each. */
function runes(item: string, price: number, shop: { x: number; z: number; npc: RegExp } = BETTY): Source {
    return {
        obj: item.replace(/ /g, ''),
        // Shop prices climb as the stock runs down: half again over list price covers a big order.
        inputs: (count) => [{ item: 'coins', count: Math.ceil(price * count * 1.5) }],
        get: async (q, count) => {
            // In batches, topping coins up before each: a 30-rune chaos order ran out of
            // coins at 29 as the price climbed (2026-10-29).
            for (let batch = 0; batch < 40 && q.count(item) < count; batch++) {
                const want = Math.min(count, q.count(item) + 25);
                await q.ensure('coins', Math.ceil(price * (want - q.count(item)) * 2));
                await buyWaitingForRestock(q, shop, item, want);
            }
        },
    };
}

/**
 * Newest game-message cursor, taken before an action so only replies to it match.
 * Message ticks are not state.tick: comparing the two matched stale escapes and
 * ended every shear instantly (43 attempts in 7s, 2026-10-28).
 */
function messageCursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}

/** Shops restock slowly; a bot that finds the shelf empty waits at the counter rather than failing. */
const RESTOCK_WAIT_TICKS = 2_000;

/**
 * Buy until holding `count` of `item`. When the shop has none in stock, keep the
 * shop open and wait for the restock (up to RESTOCK_WAIT_TICKS), then buy.
 */
export async function buyWaitingForRestock(q: Quest, shop: { x: number; z: number; npc: RegExp }, item: string, count: number): Promise<void> {
    const { buyAtShop } = await import('../quest-supplies');
    const pattern = itemPattern(item);
    // The restock budget starts at the first "out of stock", not at the call: the walk to the shop
    // alone used it up and ABGARMY05 gave up the moment Varrock's buckets ran out (2026-11-02).
    let deadline = Number.POSITIVE_INFINITY;
    // A buy refused while the shop HAS stock (coins, pack) is not a restock wait: ABGARMY10
    // looped 201 times in an hour at Aubury with 850 air runes listed and 18 coins (2026-11-03).
    let refusedWithStock = 0;
    while (q.count(item) < count && tickNow(q.sdk) < deadline) {
        // A full pack reads as 'out of stock' below and waited the whole restock budget.
        if (q.sdk.getInventory().length >= 28 && q.count(item) === 0) throw new Error(`pack is full — no room to buy ${item}`);
        await buyAtShop(q.supply, shop, [{ pattern, amount: count, label: item }]);
        if (q.count(item) >= count) return;

        if (!q.sdk.getState()?.shop?.isOpen) await q.bot.openShop(shop.npc);
        const stock = () => q.sdk.getState()?.shop?.shopItems.find((i) => pattern.test(i.name));
        if (q.sdk.getState()?.shop?.isOpen && !stock()) throw new Error(`shop at (${shop.x},${shop.z}) does not sell ${item}`);
        const listed = stock();
        if ((listed?.count ?? 0) > 0) {
            // Shop buys go in batches (Buy 10): 3 air runes short with 18 coins at 4gp was refused
            // every time (ABGARMY10, 2026-11-03). Carry enough for a whole batch of ten, then retry.
            const batch = Math.max(10, Math.ceil((count - q.count(item)) / 10) * 10);
            const wanted = batch * (listed!.buyPrice ?? 1) + 5;
            if (q.count('coins') < wanted && refusedWithStock < 5) {
                await q.bot.closeShop().catch(() => undefined);
                q.log(`${item}: buy refused with ${q.count('coins')} coins — topping up to ${wanted} for a batch of ${batch}`);
                await q.ensure('coins', wanted);
                refusedWithStock = 5; // one top-up; a refusal after it is real
                continue;
            }
            if (++refusedWithStock >= 6) {
                await q.bot.closeShop().catch(() => undefined);
                throw new Error(
                    `${item}: buy refused 5x with ${listed!.count} in stock at (${shop.x},${shop.z}) — coins ${q.count('coins')}, price ${listed!.buyPrice ?? '?'}, pack ${q.sdk.getInventory().length}/28`
                );
            }
            await q.sdk.waitForTicks(3);
            continue;
        }
        q.log(`${item} out of stock at (${shop.x},${shop.z}) — waiting for restock`);
        const t0 = tickNow(q.sdk);
        if (!Number.isFinite(deadline)) deadline = t0 + RESTOCK_WAIT_TICKS;
        await untilTicks(q.sdk, (s) => !s.shop?.isOpen || (s.shop.shopItems.find((i) => pattern.test(i.name))?.count ?? 0) > 0, Math.max(1, deadline - t0));
        q.log(`restock wait ${tickNow(q.sdk) - t0}t (stock now ${stock()?.count ?? '?'})`);
    }
    await q.bot.closeShop().catch(() => undefined);
}

/**
 * Ticks without a new item before a hunt gives up. Long enough to sit out
 * respawns while other players clear the spot: three hunters on the Port
 * Sarim giant rats ran a 12-attempt budget dry in ~70 ticks (2026-10-28).
 */
const HUNT_PATIENCE_TICKS = 400;

interface HuntOptions {
    /** Other drops worth taking while hunting (the rest of a set); picking one up counts as progress. */
    alsoLoot?: RegExp;
    /** Ticks without progress before giving up; default HUNT_PATIENCE_TICKS. */
    patience?: number;
}

/**
 * Kill `spot.npc` and pick up `item` until holding `count`. Loot already on the
 * ground is taken first. Npcs someone else is fighting are skipped ("Someone
 * else is fighting that"). attack() returns once combat starts, so each kill is
 * waited out by its drop appearing or the npc leaving.
 */
export async function huntDrop(q: Quest, spot: HuntSpot, item: string, count: number, opts: HuntOptions = {}): Promise<void> {
    const pattern = opts.alsoLoot ? new RegExp(`${itemPattern(item).source}|${opts.alsoLoot.source}`, 'i') : itemPattern(item);
    const looted = () => (opts.alsoLoot ? q.count(opts.alsoLoot) : 0) + q.count(item);
    const patience = opts.patience ?? HUNT_PATIENCE_TICKS;
    await q.goTo(spot, 6);
    const t0 = tickNow(q.sdk);
    let progressAt = t0;
    let kills = 0;
    while (q.count(item) < count && tickNow(q.sdk) - progressAt < patience) {
        const before = looted();
        const loot = q.sdk.findGroundItem(pattern, { reachable: true });
        const npc = (q.sdk.getNearbyNpcs() ?? [])
            .filter((n) => spot.npc.test(n.name) && !n.inCombat && n.reachable !== false)
            .sort((a, b) => a.distance - b.distance)[0];
        if (loot) {
            await q.bot.pickupItem(loot);
            await untilTicks(q.sdk, () => looted() > before, 8);
        } else if (npc) {
            const res = await q.bot.attack(npc, ticksToMs(20));
            if (res.success) {
                kills++;
                await untilTicks(
                    q.sdk,
                    (s) =>
                        (s.groundItems ?? []).some((g) => pattern.test(g.name)) ||
                        // Gone, or teleported off (imps do, mid-fight): a fought npc stays adjacent.
                        !(s.nearbyNpcs ?? []).some((n) => n.index === npc.index && n.distance <= 6),
                    60
                );
            }
        } else {
            // Nothing free to fight: back to the spot (if wandered off) and wait for a respawn.
            const p = q.sdk.getState()?.player;
            if (Math.hypot((p?.worldX ?? 0) - spot.x, (p?.worldZ ?? 0) - spot.z) > 6) await q.goTo(spot, 3);
            await q.sdk.waitForTicks(5);
        }
        if (looted() > before) progressAt = tickNow(q.sdk);
    }
    q.log(`hunted ${q.count(item)} ${item} in ${tickNow(q.sdk) - t0}t (${kills} kills) at (${spot.x},${spot.z})`);
}

/**
 * Imp spawns nearest the Draynor hub (quest-lab-npcfind.ts imp): three south of
 * Falador by the farm, one west of Draynor, one south-west of Falador. Imps wander
 * 25 tiles and teleport up to 20 when hit or idle, so a spot is a neighbourhood.
 * The Wizards' Tower itself has none within 40 tiles.
 */
const IMP_SPOTS: HuntSpot[] = [
    { x: 3012, z: 3311, npc: /^imp$/i },
    { x: 3073, z: 3250, npc: /^imp$/i },
    { x: 2941, z: 3236, npc: /^imp$/i },
];
const IMP_BEADS = ['black', 'red', 'white', 'yellow'];
/** Imp spots for ashes, nearest the Draynor hub first. */
const ASHES_IMP_SPOTS: HuntSpot[] = [IMP_SPOTS[1]!, IMP_SPOTS[0]!, IMP_SPOTS[2]!];
/** A bead is ~25 kills on average; a spot gets this long without any bead before the next one. */
const IMP_SPOT_PATIENCE_TICKS = 1_200;
const IMP_SPOT_VISITS = 6;

/** One bead colour: from the bead mule, else hunted; every other bead still missing is looted on the way. */
function impBead(colour: string): Source {
    const item = `${colour} bead`;
    return {
        // Jackpoo2 (the one mule) banks hundreds of each colour and serves them at Draynor bank
        // (moved from jacklove4, 2026-10-30).
        // Inline: SOURCES calls impBead before a module const down here is initialised.
        muleSupply: 'jackthief',
        get: async (q, count) => {
            for (let visit = 0; visit < IMP_SPOT_VISITS && q.count(item) < count; visit++) {
                const missing = IMP_BEADS.filter((c) => c !== colour && q.count(`${c} bead`) === 0);
                const alsoLoot = missing.length ? new RegExp(`^(${missing.join('|')}) bead$`, 'i') : undefined;
                await huntDrop(q, IMP_SPOTS[visit % IMP_SPOTS.length]!, item, count, { alsoLoot, patience: IMP_SPOT_PATIENCE_TICKS });
            }
        },
    };
}

/** Pick up a respawning ground item at `tile` until holding `count`. */
async function pickUpSpawn(q: Quest, tile: { x: number; z: number }, item: string, count: number): Promise<void> {
    await q.goTo(tile, 2);
    const pattern = itemPattern(item);
    for (let i = 0; i < 30 && q.count(item) < count; i++) {
        await q.sdk.scanGroundItems(8).catch(() => undefined);
        const ground = q.sdk.findGroundItem(pattern);
        if (!ground) {
            await q.sdk.waitForTicks(5);
            continue;
        }
        const before = q.count(item);
        await q.bot.pickupItem(ground).catch(() => undefined);
        await untilTicks(q.sdk, (s) => s.inventory.filter((it) => pattern.test(it.name)).length > before, 6);
    }
    if (q.count(item) < count) throw new Error(`no ${item} spawned at (${tile.x},${tile.z})`);
}
