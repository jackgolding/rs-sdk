/**
 * An axe again after a death: Bob's Brilliant Axes, Lumbridge (bob at 3232,3203).
 *
 * The Brimhaven vines need an axe, and a death keeps only the three most valuable items, so
 * the axe is often the one lost (jacklove2 stood at the bank with none). A death respawns in
 * Lumbridge, next to Bob. Buy out his bronze axe stock (5) so the spares go to the bank, and
 * pickpocket Lumbridge men first when the pack has no coins for it (user, 2026-11-01).
 */
import type { BotSDK } from '../../sdk/index';
import type { BotActions } from '../../sdk/actions';
import { closeUi, walkNear } from './movement';

const BOB = { x: 3232, z: 3203, npc: /^bob$/i };
const LUMBRIDGE_MEN = { x: 3222, z: 3218 };
const ANY_AXE = /^(bronze|iron|steel|black|mithril|adamant|rune) axe$/i;
const BRONZE_AXE = /^bronze axe$/i;
const COINS = /^coins$/i;
/** Bob raises the price as his stock falls (16 at full stock): enough for all five. */
const COINS_FOR_STOCK = 150;
const BOB_STOCK = 5;

function held(sdk: BotSDK, p: RegExp): number {
    return sdk.getInventory().filter((i) => p.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

export function hasAxe(sdk: BotSDK): boolean {
    return held(sdk, ANY_AXE) > 0 || !!sdk.findEquipmentItem(ANY_AXE);
}

async function pickpocketForCoins(bot: BotActions, sdk: BotSDK, log: (m: string) => void, want: number): Promise<void> {
    if (held(sdk, COINS) >= want) return;
    log(`Bob's axes: ${held(sdk, COINS)} coins — pickpocketing Lumbridge men for ${want}`);
    await walkNear(bot, sdk, LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z, 4);
    const started = Date.now();
    while (held(sdk, COINS) < want && Date.now() - started < 300_000) {
        const man = sdk.findNearbyNpc(/^(man|woman)$/i, { reachable: true }) ?? sdk.findNearbyNpc(/^(man|woman)$/i);
        if (!man) {
            await walkNear(bot, sdk, LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z, 3);
            await sdk.waitForTicks(3).catch(() => {});
            continue;
        }
        const r = await bot.pickpocketNpc(man);
        if (r.reason === 'stunned') await sdk.waitForTicks(6).catch(() => {});
    }
}

/** True when an axe is held afterwards. Buys Bob's whole bronze stock; the caller banks the spares. */
export async function ensureAxeFromBob(bot: BotActions, sdk: BotSDK, log: (m: string) => void): Promise<boolean> {
    if (hasAxe(sdk)) return true;
    await pickpocketForCoins(bot, sdk, log, COINS_FOR_STOCK);
    const { buyAtShop } = await import('./quest-supplies');
    await buyAtShop(
        {
            bot,
            sdk,
            log,
            intent: () => undefined,
            walkNear: (x, z, t = 3) => walkNear(bot, sdk, x, z, t),
            closeUi: () => closeUi(bot, sdk)
        },
        BOB,
        [{ pattern: BRONZE_AXE, amount: BOB_STOCK, label: 'bronze axe' }]
    ).catch((e) => log(`Bob's axes: ${e instanceof Error ? e.message : String(e)}`));
    await closeUi(bot, sdk);
    log(`Bob's axes: ${held(sdk, BRONZE_AXE)} bronze axes bought (coins ${held(sdk, COINS)})`);
    return hasAxe(sdk);
}
