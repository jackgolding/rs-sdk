/**
 * Accept fleet trades at Draynor bank and deposit after each one.
 *
 *   bun bots/jackthief/receive-draynor.ts
 */
import { runScript } from '../../sdk/runner';
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import { appendFileSync } from 'fs';
import { join, dirname } from 'path';

const FLEET = /^(Jackpoo\d|jacklove\d|Fatpig|fatpig)$/i;
const SERVE_WINDOW_MS = 45 * 60_000;

function log(msg: string): void {
    const line = `${new Date().toISOString()} ${msg}`;
    console.log(line);
    try {
        appendFileSync(join(dirname(import.meta.path), 'grind.log'), line + '\n');
    } catch {
        /* optional */
    }
}

async function depositAll(bot: BotActions, sdk: BotSDK): Promise<void> {
    const opened = await bot.openBank(15_000);
    if (!opened.success) {
        log(`deposit openBank failed: ${opened.message}`);
        return;
    }

    for (let pass = 0; pass < 6; pass++) {
        const inv = [...sdk.getInventory()];
        if (inv.length === 0) break;
        for (const item of inv) {
            await bot.depositItem(item, -1);
        }
    }

    await bot.closeBank();
    log(`Deposited trade loot — inv=${sdk.getInventory().length}`);
}

await runScript(async ({ bot, sdk }) => {
    log('Draynor mule receive — waiting for fleet trades');

    const deadline = Date.now() + SERVE_WINDOW_MS;
    let completed = 0;

    while (Date.now() < deadline) {
        const batch = await bot.serveTrades({
            from: FLEET,
            want: [],
            timeout: Math.min(120_000, deadline - Date.now()),
            maxTrades: 1,
            tradeTimeout: 120_000,
        });

        const trade = batch.trades.find(t => t.success);
        if (trade) {
            const recv = trade.received.map(i => `${i.name}x${i.count}`).join(', ') || 'items';
            log(`Received from ${trade.partner ?? 'fleet'}: ${recv}`);
            await depositAll(bot, sdk);
            completed++;
            continue;
        }

        if (batch.reason === 'timeout' && batch.trades.length === 0) {
            continue;
        }

        if (batch.reason === 'max_trades' && !trade) {
            continue;
        }

        log(`serveTrades ended: ${batch.message}`);
        if (batch.reason === 'until') break;
    }

    log(`Draynor mule receive finished — ${completed} trade(s) banked`);
});
