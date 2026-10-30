/**
 * Bank-processing tables and the smelting coal plan (bots/quests/process-bank.ts).
 *
 * Everything is keyed by obj id: every grimy herb is named "Herb", so names cannot
 * tell them apart. Levels and base XP (tenths, before the world's XP rate) come from
 * server content:
 *   gems    skill_crafting/configs/gem/gem.dbrow (one chisel use = one cut, no delay)
 *   herbs   skill_herblore/configs/herbs.obj identified_herb_level (default 3), op1 Identify
 *   food    skill_cooking/configs/cooking_source/cooking_generic.dbrow levelrequired
 *   bars    skill_smithing/configs/smelting/smelting.struct levelrequired / productexp
 */

export interface Material {
    id: number;
    name: string;
    level: number;
}

/** Uncut gems, lowest Crafting level first. */
export const GEMS: Material[] = [
    { id: 1625, name: 'uncut opal', level: 1 },
    { id: 1627, name: 'uncut jade', level: 13 },
    { id: 1629, name: 'uncut red topaz', level: 16 },
    { id: 1623, name: 'uncut sapphire', level: 20 },
    { id: 1621, name: 'uncut emerald', level: 27 },
    { id: 1619, name: 'uncut ruby', level: 34 },
    { id: 1617, name: 'uncut diamond', level: 43 },
    { id: 1631, name: 'uncut dragonstone', level: 55 },
];

/** Grimy ("Herb", op1 Identify) herbs, lowest Herblore level first. Quest-only herbs left out. */
export const HERBS: Material[] = [
    { id: 199, name: 'grimy guam', level: 3 },
    { id: 201, name: 'grimy marrentill', level: 5 },
    { id: 203, name: 'grimy tarromin', level: 11 },
    { id: 205, name: 'grimy harralander', level: 20 },
    { id: 207, name: 'grimy ranarr', level: 25 },
    { id: 3049, name: 'grimy toadflax', level: 30 },
    { id: 209, name: 'grimy irit', level: 40 },
    { id: 211, name: 'grimy avantoe', level: 48 },
    { id: 213, name: 'grimy kwuarm', level: 54 },
    { id: 3051, name: 'grimy snapdragon', level: 59 },
    { id: 215, name: 'grimy cadantine', level: 65 },
    { id: 2485, name: 'grimy lantadyme', level: 67 },
    { id: 217, name: 'grimy dwarf weed', level: 70 },
    { id: 219, name: 'grimy torstol', level: 75 },
];

/** Raw food a range cooks in one use, lowest Cooking level first. */
export const FOODS: Material[] = [
    { id: 317, name: 'raw shrimps', level: 1 },
    { id: 321, name: 'raw anchovies', level: 1 },
    { id: 327, name: 'raw sardine', level: 1 },
    { id: 2132, name: 'raw beef', level: 1 },
    { id: 2138, name: 'raw chicken', level: 1 },
    { id: 2134, name: 'raw rat meat', level: 1 },
    { id: 2136, name: 'raw bear meat', level: 1 },
    { id: 3226, name: 'raw rabbit', level: 1 },
    { id: 1859, name: 'raw ugthanki meat', level: 1 },
    { id: 345, name: 'raw herring', level: 5 },
    { id: 353, name: 'raw mackerel', level: 10 },
    { id: 338, name: 'raw giant carp', level: 10 },
    { id: 335, name: 'raw trout', level: 15 },
    { id: 341, name: 'raw cod', level: 18 },
    { id: 349, name: 'raw pike', level: 20 },
    { id: 331, name: 'raw salmon', level: 25 },
    { id: 359, name: 'raw tuna', level: 30 },
    { id: 377, name: 'raw lobster', level: 40 },
    { id: 363, name: 'raw bass', level: 43 },
    { id: 371, name: 'raw swordfish', level: 45 },
    { id: 383, name: 'raw shark', level: 80 },
    { id: 395, name: 'raw sea turtle', level: 82 },
    { id: 389, name: 'raw manta ray', level: 91 },
];

export const COAL_ID = 453;

export interface Bar {
    key: string;
    /** The bar's obj id. */
    id: number;
    level: number;
    /** Base XP per bar in tenths (productexp). */
    xp10: number;
    ore: number;
    oreName: string;
    /** Second ingredient: tin for bronze, coal for the rest. */
    second?: { id: number; per: number };
}

/**
 * Bars in level order (the execution order). Plain iron is not here: iron ore is only
 * ever smelted into steel, and with no coal left for it, it stays in the bank.
 */
export const BARS: Bar[] = [
    { key: 'bronze', id: 2349, level: 1, xp10: 62, ore: 436, oreName: 'copper ore', second: { id: 438, per: 1 } },
    { key: 'silver', id: 2355, level: 20, xp10: 137, ore: 442, oreName: 'silver ore' },
    { key: 'steel', id: 2353, level: 30, xp10: 175, ore: 440, oreName: 'iron ore', second: { id: COAL_ID, per: 2 } },
    { key: 'gold', id: 2357, level: 40, xp10: 225, ore: 444, oreName: 'gold ore' },
    { key: 'mithril', id: 2359, level: 50, xp10: 300, ore: 447, oreName: 'mithril ore', second: { id: COAL_ID, per: 4 } },
    { key: 'adamant', id: 2361, level: 70, xp10: 375, ore: 449, oreName: 'adamantite ore', second: { id: COAL_ID, per: 6 } },
    { key: 'rune', id: 2363, level: 85, xp10: 500, ore: 451, oreName: 'runite ore', second: { id: COAL_ID, per: 8 } },
];

/** Inventory slots one bar takes (ore + its second ingredient). */
export const slotsPerBar = (bar: Bar) => 1 + (bar.second?.per ?? 0);

/**
 * XP for a level on this engine. Not the classic 2^(l/7) table: Player.ts levelExperience
 * sums floor(l + 300 * 2^(l/10)), so level 99 is 998,458 xp (what the SDK reports).
 */
export function xpForLevel(level: number): number {
    let points = 0;
    for (let l = 1; l < level; l++) points += Math.floor(l + 300 * Math.pow(2, l / 10));
    return Math.floor(points / 4);
}

export function levelForXp(xp: number): number {
    let level = 1;
    while (level < 99 && xpForLevel(level + 1) <= xp) level++;
    return level;
}

/**
 * Bars to smelt from what the bank holds. Coal goes to the highest bar first
 * (rune > adamant > mithril > steel), but only to bars the account will be able to
 * smelt: smelting runs lowest level first, so the XP of the bars below a tier counts
 * toward reaching it. A coal tier that would still be out of reach when its turn comes
 * gives its coal back to the tiers below, highest unreachable tier first. Whatever has
 * no coal (iron ore) stays in the bank.
 *
 * `xp` is the current Smithing XP, `rate` the world's XP multiplier.
 */
export function planSmelting(bank: Map<number, number>, xp: number, rate: number): Map<string, number> {
    const have = (id: number) => bank.get(id) ?? 0;
    const coalTiers = BARS.filter((b) => b.second?.id === COAL_ID).reverse(); // rune first
    const excluded = new Set<string>();
    for (let round = 0; round <= coalTiers.length; round++) {
        const bars = new Map<string, number>();
        let coal = have(COAL_ID);
        for (const bar of coalTiers) {
            const n = excluded.has(bar.key) ? 0 : Math.min(have(bar.ore), Math.floor(coal / bar.second!.per));
            bars.set(bar.key, n);
            coal -= n * bar.second!.per;
        }
        for (const bar of BARS.filter((b) => b.second?.id !== COAL_ID)) {
            bars.set(bar.key, bar.second ? Math.min(have(bar.ore), Math.floor(have(bar.second.id) / bar.second.per)) : have(bar.ore));
        }
        // Lowest level first, as the run will do it.
        let projected = xp;
        const unreached: Bar[] = [];
        for (const bar of BARS) {
            const n = bars.get(bar.key) ?? 0;
            if (!n) continue;
            if (levelForXp(projected) >= bar.level) projected += (n * bar.xp10 * rate) / 10;
            else unreached.push(bar);
        }
        const drop = unreached.filter((b) => b.second?.id === COAL_ID).pop(); // the highest
        if (!drop) {
            for (const bar of unreached) bars.set(bar.key, 0);
            return bars;
        }
        excluded.add(drop.key);
    }
    return new Map();
}
