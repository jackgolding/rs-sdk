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

/**
 * Eat to full during a bank visit, after the loot is in and before the kit comes out (user,
 * 2026-11-01: jacklove1 teleported out of the KBD lair low and poisoned, and died at the bank).
 * The bank must be open; it is closed to eat (the bank modal hides the inventory and the server
 * rejects inventory packets under it) and opened again. Food comes from the pack first, then the bank.
 */
export async function healAtBank(
    bot: import('../../sdk/actions').BotActions,
    sdk: import('../../sdk/index').BotSDK,
    log: (msg: string) => void,
    food: RegExp = /^shark$/i
): Promise<void> {
    const player = () => sdk.getState()?.player;
    const deficit = () => (player()?.maxHp ?? 0) - (player()?.hp ?? 0);
    if (deficit() < 10) return;
    const before = player()?.hp ?? 0;
    const need = Math.ceil(deficit() / Math.max(1, foodHeal('Shark') || 20));
    const held = sdk.getInventory().filter((i) => food.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    if (held < need) {
        const banked = sdk.findBankItem(food);
        if (banked) await bot.withdrawItem(banked, Math.min(banked.count, need - held));
        await sdk.waitForTicks(2).catch(() => {});
    }
    await bot.closeBank().catch(() => undefined);
    for (let i = 0; i < need + 3 && deficit() >= 10; i++) {
        const item = sdk.getInventory().find((it) => food.test(it.name));
        if (!item) break;
        await bot.eatFood(item).catch(() => undefined);
    }
    log(`Healed at the bank ${before} -> ${player()?.hp}/${player()?.maxHp}`);
    await bot.openBank();
}
