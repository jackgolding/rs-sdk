/**
 * Leave the air altar, dump runecrafting gear at Falador east, take 10k gp
 * from Jackthief, and deposit it.
 *
 *   bun bots/quests/bank-rc-collect-gold.ts jacklove1
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import {
    closeUi,
    count,
    depositAll,
    goFaladorEast,
    leaveAltar,
    leaveMine,
    openFaladorBank
} from './air-runes-shared';

const JACKTHIEF = /^Jackthief$/i;
const COINS = /^coins$/i;
const GOLD = 10_000;

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

await runScript(async ({ bot, sdk }) => {
    const log = (msg: string) => {
        console.log(msg);
        try {
            appendFileSync(GRIND_LOG, `${new Date().toISOString()} ${msg}\n`);
        } catch {
            /* ignore */
        }
    };

    await closeUi(bot, sdk);
    log(`Bank-rc start coins=${count(sdk, COINS)}`);
    await leaveMine(bot, sdk, log);
    await leaveAltar(bot, sdk, log);
    await goFaladorEast(bot, sdk, log);
    await openFaladorBank(bot, sdk);
    await depositAll(bot, sdk);
    await bot.closeBank();
    log(`Dumped RC kit, waiting for Jackthief 10k @ coins=${count(sdk, COINS)}`);

    if (count(sdk, COINS) < GOLD) {
        const served = await bot.serveTrades({
            from: JACKTHIEF,
            give: [],
            want: [{ item: COINS, amount: GOLD }],
            maxTrades: 1,
            timeout: 10 * 60_000,
            tradeTimeout: 90_000,
            until: () => count(sdk, COINS) >= GOLD
        });
        const last = served.trades.at(-1);
        log(
            `Gold trade: ${served.reason} ${last ? (last.success ? 'ok' : last.message) : served.message} coins=${count(sdk, COINS)}`
        );
        if (count(sdk, COINS) < GOLD) {
            throw new Error(`Did not receive 10k gp (have ${count(sdk, COINS)})`);
        }
    }

    await openFaladorBank(bot, sdk);
    if (count(sdk, COINS) > 0) {
        const d = await bot.depositItem(COINS, -1);
        if (!d.success) log(`Coin deposit: ${d.message}`);
    }
    await bot.closeBank();
    log(`Gold banked coinsInv=${count(sdk, COINS)}`);
});
