/**
 * Eat heal per inventory/bank item. Values from consume_table / wine_effect.
 * Multi-bite foods use remaining HP (cake 12 → 2/3 cake 8 → slice 4).
 * Noted stacks use `count`.
 */
const FOOD_HEAL: Record<string, number> = {
    shrimp: 3,
    anchovies: 3,
    bread: 4,
    sardine: 4,
    herring: 5,
    mackerel: 6,
    trout: 7,
    cod: 7,
    pike: 8,
    salmon: 9,
    stew: 9,
    tuna: 10,
    lobster: 12,
    bass: 13,
    swordfish: 14,
    shark: 20,
    'jug of wine': 11,
    cake: 12,
    '2/3 cake': 8,
    'slice of cake': 4,
    'chocolate cake': 15,
    '2/3 chocolate cake': 10,
    'chocolate slice': 5
};

export function foodHeal(name: string): number {
    return FOOD_HEAL[name.trim().toLowerCase()] ?? 0;
}

export function foodHp(items: { name: string; count?: number }[]): number {
    return items.reduce((sum, item) => {
        const n = item.count ?? 0;
        if (n <= 0) return sum;
        return sum + foodHeal(item.name) * n;
    }, 0);
}

/** Walk out and eat at the bank — too hurt to stay in the wilderness. */
export function needsBankHeal(hp: number, maxHp: number): boolean {
    if (maxHp <= 0) return false;
    return hp <= Math.max(20, Math.floor(maxHp * 0.35));
}
