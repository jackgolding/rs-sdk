/**
 * Brew prayer potions from the account's own bank, at the bank (Herblore 38):
 * ranarr weed into a vial of water -> "Unfinished potion", snape grass into it -> Prayer potion(3)
 * (brew_potion.struct 3doseprayerrestore). The fleet's banks hold ~1,250 ranarr and ~1,100 snape
 * grass. Call with the bank open; it is open again on return.
 */
import type { BotSDK } from '../../sdk/index';
import type { BotActions } from '../../sdk/actions';

const RANARR = /^ranarr weed$/i;
const VIAL_OF_WATER = /^vial of water$/i;
const SNAPE = /^snape grass$/i;
const UNFINISHED = /^unfinished potion$/i;
const PRAYER_POT = /^prayer potion\(\d\)$/i;

function held(sdk: BotSDK, p: RegExp): number {
    return sdk.getInventory().filter((i) => p.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

export async function brewPrayerPotions(bot: BotActions, sdk: BotSDK, log: (m: string) => void, want: number): Promise<number> {
    if (want <= 0 || (sdk.getSkill('Herblore')?.baseLevel ?? 1) < 38) return 0;
    const free = 28 - sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
    const n = Math.min(want, sdk.findBankItem(RANARR)?.count ?? 0, sdk.findBankItem(VIAL_OF_WATER)?.count ?? 0, sdk.findBankItem(SNAPE)?.count ?? 0, Math.floor(free / 3));
    if (n <= 0) return 0;
    for (const p of [RANARR, VIAL_OF_WATER, SNAPE]) {
        const item = sdk.findBankItem(p);
        if (item) await bot.withdrawItem(item, n);
    }
    await bot.closeBank();
    const before = held(sdk, PRAYER_POT);
    const combine = async (a: RegExp, b: RegExp) => {
        for (let i = 0; i < n; i++) {
            const x = sdk.findInventoryItem(a);
            const y = sdk.findInventoryItem(b);
            if (!x || !y) return;
            const had = held(sdk, b);
            await sdk.sendUseItemOnItem(x.slot, y.slot);
            await sdk.waitForCondition(() => held(sdk, b) < had, 4_000).catch(() => {});
        }
    };
    await combine(RANARR, VIAL_OF_WATER);
    await combine(SNAPE, UNFINISHED);
    const made = held(sdk, PRAYER_POT) - before;
    log(`Brewed ${made} prayer potions (herblore ${sdk.getSkill('Herblore')?.baseLevel})`);
    await bot.openBank();
    return made;
}
