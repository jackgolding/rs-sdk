import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';

const FATPIG = /^fatpig$/i;
const FOOD = /^(swordfish|lobster)$/i;
const ARDY_BANK = { x: 2655, z: 3283 };
const GRIND_LOG = join(import.meta.dir, 'grind.log');

await runScript(async ({ bot, sdk }) => {
    const log = (msg: string) => {
        console.log(msg);
        try {
            appendFileSync(GRIND_LOG, `${new Date().toISOString()} ${msg}\n`);
        } catch {
            /* ignore */
        }
    };
    const pos = () => {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0 };
    };
    const distTo = (x: number, z: number) => Math.hypot(pos().x - x, pos().z - z);
    const foodSummary = () =>
        sdk
            .getInventory()
            .filter((i) => FOOD.test(i.name))
            .map((i) => `${i.count} ${i.name}`)
            .join(', ') || 'none';

    await bot.dismissBlockingUI();
    if (distTo(ARDY_BANK.x, ARDY_BANK.z) > 6) {
        await bot.walkTo(ARDY_BANK.x, ARDY_BANK.z, 3);
    }
    log(`Waiting for fatpig food trade @ ${pos().x},${pos().z}`);

    const served = await bot.serveTrades({
        from: FATPIG,
        accept: (offer) => offer.some((o) => FOOD.test(o.name)),
        want: [{ item: FOOD, amount: 1 }],
        maxTrades: 1,
        timeout: 10 * 60_000,
        tradeTimeout: 120_000
    });
    log(`Food from fatpig: ${served.success ? 'ok' : served.message} | inv ${foodSummary()}`);
});
