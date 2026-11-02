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
/** ranarrvial: ranarr weed in a vial of water (all unfinished potions share one name). */
const RANARR_UNF_ID = 99;

function held(sdk: BotSDK, p: RegExp): number {
    return sdk.getInventory().filter((i) => p.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

export async function brewPrayerPotions(bot: BotActions, sdk: BotSDK, log: (m: string) => void, want: number): Promise<number> {
    if (want <= 0 || (sdk.getSkill('Herblore')?.baseLevel ?? 1) < 38) return 0;
    // Half-made ranarr potions banked from an interrupted brew first: snape grass finishes them
    // (Jackpoo1 sat on 23 with no ranarr left, "none to brew", 2026-11-02).
    const unf = (sdk.getBankItems() ?? []).find((b) => b.id === RANARR_UNF_ID && b.count > 0);
    const snapeBank = sdk.findBankItem(SNAPE);
    if (unf && snapeBank) {
        const free0 = 28 - sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
        const k = Math.min(want, unf.count, snapeBank.count, Math.floor(free0 / 2));
        if (k > 0) {
            await bot.withdrawItem(unf, k, { asNote: false });
            await bot.withdrawItem(snapeBank, k, { asNote: false });
            await bot.closeBank();
            const before0 = held(sdk, PRAYER_POT);
            for (let i = 0; i < k; i++) {
                const x = sdk.findInventoryItem(SNAPE);
                const y = sdk.getInventory().find((it) => it.id === RANARR_UNF_ID);
                if (!x || !y) break;
                const had = held(sdk, SNAPE);
                await sdk.sendUseItemOnItem(x.slot, y.slot);
                await sdk.waitForCondition(() => held(sdk, SNAPE) < had, 4_000).catch(() => {});
            }
            const made0 = held(sdk, PRAYER_POT) - before0;
            log(`Brewed ${made0} prayer potions from banked unfinished (herblore ${sdk.getSkill('Herblore')?.baseLevel})`);
            await bot.openBank();
            return made0;
        }
    }
    const free = 28 - sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
    const n = Math.min(want, sdk.findBankItem(RANARR)?.count ?? 0, sdk.findBankItem(VIAL_OF_WATER)?.count ?? 0, sdk.findBankItem(SNAPE)?.count ?? 0, Math.floor(free / 3));
    if (n <= 0) return 0;
    for (const p of [RANARR, VIAL_OF_WATER, SNAPE]) {
        const item = sdk.findBankItem(p);
        if (item) await bot.withdrawItem(item, n, { asNote: false });
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
