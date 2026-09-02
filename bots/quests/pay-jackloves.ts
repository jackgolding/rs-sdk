/**
 * Dump air-rune kit at Falador east, then gift 10k gp to Jacklove1–5.
 *
 *   bun bots/quests/pay-jackloves.ts jackthief
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

const COINS = /^coins$/i;
const GOLD = 10_000;
const LOVES = ['Jacklove1', 'Jacklove2', 'Jacklove3', 'Jacklove4', 'Jacklove5'] as const;
const NEED = GOLD * LOVES.length;

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'jackthief';
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
    log(`Pay-jackloves start coins=${count(sdk, COINS)}`);
    await leaveMine(bot, sdk, log);
    await leaveAltar(bot, sdk, log);
    await goFaladorEast(bot, sdk, log);
    await openFaladorBank(bot, sdk);
    await depositAll(bot, sdk, COINS);
    if (count(sdk, COINS) < NEED) {
        const have = count(sdk, COINS);
        const w = await bot.withdrawItem(COINS, NEED - have);
        if (!w.success) log(`Coin withdraw: ${w.message}`);
    }
    await bot.closeBank();
    const purse = count(sdk, COINS);
    log(`Purse ${purse} need ${NEED}`);
    if (purse < NEED) throw new Error(`Need ${NEED} gp, only have ${purse}`);

    for (const name of LOVES) {
        log(`Trading ${GOLD} gp to ${name}`);
        const r = await bot.trade(name, {
            give: [{ item: COINS, amount: GOLD }],
            want: [],
            retryOnBusy: true,
            requestTimeout: 180_000,
            timeout: 90_000
        });
        log(`${name}: ${r.success ? 'ok' : r.message} coinsLeft=${count(sdk, COINS)}`);
        if (!r.success) throw new Error(`Trade to ${name} failed: ${r.message}`);
    }

    await openFaladorBank(bot, sdk);
    if (count(sdk, COINS) > 0) await bot.depositItem(COINS, -1);
    await bot.closeBank();
    log('Paid all five Jackloves');
});
