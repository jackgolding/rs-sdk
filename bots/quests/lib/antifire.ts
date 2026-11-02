/**
 * Antifire upkeep for the dragon farms. A dose sets %dragonresist to map_clock + 600
 * (anti_fire.rs2), which KBD (king_black_dragon.rs2), the metal dragons (metal_dragon.rs2) and
 * dragon.rs2 all check: with the dragonfire shield too, breath does nothing. 600 ticks is only
 * 3 minutes on prod's 300ms tick, so it is redrunk every REDRINK_TICKS while fighting, and only
 * while the pack holds a dose (jacklove16 brewed the fleet's first 78, 2026-11-02).
 */
import type { BotSDK } from '../../../sdk/index';
import { tickNow } from './ticks';

export const ANTIFIRE = /^antifire potion\(\d\)$/i;
/** A little under the 600-tick effect, so it never lapses mid-breath. */
const REDRINK_TICKS = 560;

export class AntifireUpkeep {
    private drankAt = -Infinity;

    constructor(private readonly sdk: BotSDK, private readonly log: (m: string) => void) {}

    /** Drink a dose if the last one is about to wear off and one is carried. */
    async maybeDrink(): Promise<void> {
        if (tickNow(this.sdk) - this.drankAt < REDRINK_TICKS) return;
        const pot = this.sdk.findInventoryItem(ANTIFIRE);
        const drink = pot?.optionsWithIndex.find((o) => /drink/i.test(o.text));
        if (!pot || !drink) return;
        await this.sdk.sendUseItem(pot.slot, drink.opIndex);
        await this.sdk.waitForTicks(2).catch(() => undefined);
        this.drankAt = tickNow(this.sdk);
        this.log(`Drank ${pot.name}`);
    }

    /** A new trip: the next fight drinks straight away. */
    reset(): void {
        this.drankAt = -Infinity;
    }
}
