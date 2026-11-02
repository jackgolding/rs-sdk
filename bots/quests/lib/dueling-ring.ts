/**
 * The ring of dueling is worn, not carried (a free pack slot; user, 2026-11-02). It can only be
 * rubbed from the pack, so a teleport takes it off, rubs it, and puts what is left back on.
 */
import type { BotActions } from '../../../sdk/actions';
import type { BotSDK } from '../../../sdk/index';

export const DUELING_RING = /^ring of dueling\(\d\)$/i;

export function hasDuelingRing(sdk: BotSDK): boolean {
    return !!sdk.findEquipmentItem(DUELING_RING) || !!sdk.findInventoryItem(DUELING_RING);
}

/** Put a carried ring of dueling on when no ring of dueling is worn. */
export async function wearDuelingRing(sdk: BotSDK, bot: BotActions): Promise<void> {
    if (sdk.findEquipmentItem(DUELING_RING)) return;
    const ring = sdk.findInventoryItem(DUELING_RING);
    if (ring) await bot.equipItem(ring).catch(() => undefined);
}

/**
 * Rub the ring to `destination` (a dialog option, e.g. /castle wars/i) and wait until `arrived`.
 * Takes it off first when worn, and wears what is left afterwards. False when there is no ring.
 */
export async function rubDuelingRing(sdk: BotSDK, bot: BotActions, destination: RegExp, arrived: () => boolean): Promise<boolean> {
    if (!sdk.findInventoryItem(DUELING_RING)) {
        const worn = sdk.findEquipmentItem(DUELING_RING);
        if (!worn) return false;
        await bot.unequipItem(worn).catch(() => undefined);
        await sdk.waitForCondition(() => !!sdk.findInventoryItem(DUELING_RING), 3_000).catch(() => undefined);
    }
    const ring = sdk.findInventoryItem(DUELING_RING);
    const rub = ring?.optionsWithIndex.find((o) => /rub/i.test(o.text));
    if (!ring || !rub) return false;
    await sdk.sendUseItem(ring.slot, rub.opIndex);
    for (let i = 0; i < 12 && !arrived(); i++) {
        const pick = sdk.getDialog()?.options.find((o) => destination.test(o.text));
        if (pick) await sdk.sendClickDialog(pick.index);
        await sdk.waitForTicks(1).catch(() => undefined);
    }
    await sdk.waitForCondition(() => arrived(), 8_000).catch(() => undefined);
    await wearDuelingRing(sdk, bot);
    return arrived();
}
