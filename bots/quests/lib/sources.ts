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
     * A mule account parked at Draynor bank running quest-mule.ts that serves this
     * item. The prepare phase DMs it once for every short line it serves and takes
     * the trade; whatever it has not handed over in time is sourced by `get` as usual.
     */
    muleSupply?: string;
    /** Skill levels `get` needs; the runner trains them first (lib/training.ts). */
    levels?: Record<string, number>;
    /** Produce until holding `count` in total. */
    get?: (q: Quest, count: number) => Promise<void>;
}

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
    /** Black Knights' Fortress: the guard disguise is worn, so worn ones count. */
    'bronze med helm': [{ item: 'bronze med helm', skill: 'defence', level: 1 }],
    'iron chainbody': [{ item: 'iron chainbody', skill: 'defence', level: 1 }],
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
/** Arhein's store, Catherby: tinderbox. */
const ARHEIN = { x: 2803, z: 3430, npc: /^arhein$/i };
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
const TAVERLEY_BEARS: HuntSpot = { x: 2965, z: 3465, npc: /^bear$/i };
/** Every chicken drops bones (Demon Slayer's 25 for Traiborn). East Lumbridge coop, old demon-slayer.ts. */
const LUMBRIDGE_EAST_CHICKENS: HuntSpot = { x: 3228, z: 3300, npc: /^chicken$/i };
/** Varrock general store (wiki/shops/varrock-general-store.md): bucket 2gp, stock 2. */
const VARROCK_GENERAL_STORE = { x: 3218, z: 3415, npc: /shop\s*(keeper|assistant)/i };
/** Varrock palace kitchen sink (north wing); the sink has no ops, use the bucket on it. */
/** Logs ground spawns, m38_49 (0 26 55 / 30 51 / 32 55), west of the Ardougne monastery. */
const LOGS_SPAWNS_SW_ARDOUGNE = [
    { x: 2458, z: 3191 },
    { x: 2462, z: 3187 },
    { x: 2464, z: 3191 },
];
const PALACE_KITCHEN_SINK = { x: 3224, z: 3494 };

export const SOURCES: Record<string, Source> = {
    /**
     * The prologue withdraws coins first; this only runs on a broke account (ABGARMY19 had
     * none for the Fortress disguise, 2026-10-29): pickpocket the men outside Lumbridge castle.
     */
    coins: { get: (q, count) => pickpocketCoins(q, count) },

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
    'iron bar': { mule: true, muleSupply: 'Jackpoo2' },

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
        inputs: () => [{ item: 'coins', count: 2 }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
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
    'blurberry special': { obj: 'premade_blurberry_special', mule: true, muleSupply: 'Jackpoo2' },
    /** Tenzing's winter supplies; no shop near Burthorpe sells either, so the mule stocks them
     * (jacklove4 gathered 50 of each with death-plateau-stock.ts, 2026-10-30). */
    bread: { mule: true, muleSupply: 'Jackpoo2' },
    trout: { mule: true, muleSupply: 'Jackpoo2' },

    // ── Fight Arena: the pen fights (ogre 63, scorpion 44, Bouncer 137) are ranged; a mule stocks the kit
    'magic shortbow': { mule: true },
    'rune arrow': { mule: true },
    shark: { mule: true },
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
    'air rune': runes('air rune', 4),
    'chaos rune': runes('chaos rune', 15),
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
    knife: { tool: true, get: (q, count) => pickUpSpawn(q, LUMBRIDGE_KNIFE, 'knife', count) },
    needle: {
        tool: true,
        inputs: () => [{ item: 'coins', count: 1 }],
        get: async (q) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, DOMMIK, 'needle', 1);
        },
    },
    /** process-bank.ts: gem cutting. Dommik stocks two (alkharid.inv craftingshop2). */
    chisel: {
        tool: true,
        inputs: () => [{ item: 'coins', count: 5 }],
        get: async (q) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, DOMMIK, 'chisel', 1);
        },
    },
    /** process-bank.ts: emerald rings. Dommik stocks four (alkharid.inv craftingshop2). */
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
    'fire rune': runes('fire rune', 4),
    'earth rune': runes('earth rune', 4),
    /** Not sold near any hub (the Magic Guild store needs 66 Magic): mule stock, like the Telegrab laws. */
    'law rune': { obj: 'lawrune', mule: true },
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
    potato: { get: (q, count) => pickLocs(q, 'potato', /^potato$/i, RELLEKKA_POTATOES, count) },
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
    /** Smithed from steel bars only (Smithing 34, two a bar): the Jackpoo2 mule smiths and serves them. */
    nails: { mule: true, muleSupply: 'Jackpoo2' },
    /** Attack 60 and Lost City complete to wield; no shop sells it. Asked of the Jackpoo2 mule first. */
    'dragon longsword': { obj: 'dragon_longsword', mule: true, muleSupply: 'Jackpoo2' },

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

    'ball of wool': {
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
        muleSupply: 'Jackpoo2',
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

};

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

/** Shop sources ask for 1 coin (the prologue normally withdrew the real amount); a broke account earns a working float. */
const COIN_FLOAT = 300;

async function pickpocketCoins(q: Quest, asked: number): Promise<void> {
    const count = Math.max(asked, COIN_FLOAT);
    await q.goTo(LUMBRIDGE_MEN, 6);
    const t0 = tickNow(q.sdk);
    for (let tries = 0; q.count('coins') < count && tickNow(q.sdk) - t0 < 3000; tries++) {
        const man = q.sdk.findNearbyNpc(/^man$/i);
        if (!man) {
            await q.goTo(LUMBRIDGE_MEN, 3);
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
function runes(item: string, price: number): Source {
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
                await buyWaitingForRestock(q, BETTY, item, want);
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
    const deadline = tickNow(q.sdk) + RESTOCK_WAIT_TICKS;
    while (q.count(item) < count && tickNow(q.sdk) < deadline) {
        // A full pack reads as 'out of stock' below and waited the whole restock budget.
        if (q.sdk.getInventory().length >= 28 && q.count(item) === 0) throw new Error(`pack is full — no room to buy ${item}`);
        await buyAtShop(q.supply, shop, [{ pattern, amount: count, label: item }]);
        if (q.count(item) >= count) return;

        if (!q.sdk.getState()?.shop?.isOpen) await q.bot.openShop(shop.npc);
        const stock = () => q.sdk.getState()?.shop?.shopItems.find((i) => pattern.test(i.name));
        if (q.sdk.getState()?.shop?.isOpen && !stock()) throw new Error(`shop at (${shop.x},${shop.z}) does not sell ${item}`);
        q.log(`${item} out of stock at (${shop.x},${shop.z}) — waiting for restock`);
        const t0 = tickNow(q.sdk);
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
        muleSupply: 'Jackpoo2',
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
