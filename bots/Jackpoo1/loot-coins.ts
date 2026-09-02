/**
 * Pick up nearby coins and log projected gp/hr.
 *
 *   bun bots/Jackpoo1/loot-coins.ts
 */
import { appendFileSync } from 'fs';
import { dirname, join } from 'path';
import { runScript } from '../../sdk/runner';

const COINS = /^coins$/i;
const DURATION_MS = 5 * 60_000;
const GRIND_LOG = join(dirname(import.meta.path), 'grind.log');

function log(msg: string): void {
    console.log(msg);
    try {
        appendFileSync(GRIND_LOG, `${new Date().toISOString()} ${msg}\n`);
    } catch {
        /* ignore */
    }
}

function coinCount(sdk: { findInventoryItem: (p: RegExp) => { count: number } | null }): number {
    return sdk.findInventoryItem(COINS)?.count ?? 0;
}

function gpPerHour(gained: number, elapsedMs: number): number {
    if (elapsedMs < 1_000) return 0;
    return Math.round((gained * 3_600_000) / elapsedMs);
}

await runScript(async ({ bot, sdk }) => {
    const started = Date.now();
    const startCoins = coinCount(sdk);
    let picked = 0;
    let missed = 0;
    let lastReport = started;

    const p = sdk.getState()?.player;
    log(
        `Loot coins start @ ${p?.worldX},${p?.worldZ} inv=${startCoins}gp piles=${
            sdk.getGroundItems().filter((g) => COINS.test(g.name)).length
        }`
    );

    while (Date.now() - started < DURATION_MS) {
        await bot.dismissBlockingUI();

        let pile = sdk.findGroundItem(COINS, { reachable: true });
        if (!pile) {
            const scanned = await sdk.scanGroundItems(15);
            pile =
                scanned
                    .filter((g) => COINS.test(g.name) && g.reachable !== false)
                    .sort((a, b) => b.count - a.count || a.distance - b.distance)[0] ?? null;
        }
        if (!pile) {
            await sdk.waitForTicks(1);
            continue;
        }

        const before = coinCount(sdk);
        const result = await bot.pickupItem(pile);
        const gained = coinCount(sdk) - before;
        if (result.success && gained > 0) {
            picked += 1;
            const elapsed = Date.now() - started;
            const total = coinCount(sdk) - startCoins;
            log(
                `+${gained}gp pile=${pile.count} @ ${pile.x},${pile.z} | session +${total}gp | ${gpPerHour(total, elapsed)} gp/hr`
            );
        } else {
            missed += 1;
            log(`miss ${pile.x},${pile.z}: ${result.message}`);
        }

        if (Date.now() - lastReport >= 15_000) {
            lastReport = Date.now();
            const elapsed = Date.now() - started;
            const total = coinCount(sdk) - startCoins;
            log(
                `pace ${gpPerHour(total, elapsed)} gp/hr | +${total}gp in ${(elapsed / 1000).toFixed(0)}s | picked=${picked} miss=${missed}`
            );
        }
    }

    const elapsed = Date.now() - started;
    const total = coinCount(sdk) - startCoins;
    log(
        `Loot coins done +${total}gp in ${(elapsed / 1000).toFixed(0)}s | ${gpPerHour(total, elapsed)} gp/hr | picked=${picked} miss=${missed} inv=${coinCount(sdk)}gp`
    );
}, { timeout: DURATION_MS + 15_000 });
