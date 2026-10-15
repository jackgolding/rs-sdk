/**
 * Offer all Dragon longswords except KEEP to pigfat in a player trade.
 * Pigfat's side is operated by a human: this script only accepts on its own
 * side after the partner has accepted, and declines if nothing happens.
 *
 *   bun bots/quests/trade-longswords-to-pigfat.ts ABGARMY09
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';

const botName = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

const PARTNER = /^pigfat$/i;
const ITEM = /^dragon longsword$/i;
const KEEP = 2;
const WAIT_MS = 5 * 60_000;

await runScript(async ({ bot, sdk }) => {
    const log = (msg: string) => {
        const line = `${new Date().toISOString()} ${msg}`;
        console.log(msg);
        try {
            appendFileSync(GRIND_LOG, line + '\n');
        } catch {
            /* ignore */
        }
    };

    const longswords = () =>
        sdk.getInventory().filter((i) => ITEM.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);

    const total = longswords();
    const give = total - KEEP;
    if (give < 1) {
        log(`TRADE-LS abort: ${total} longswords, nothing to give after keeping ${KEEP}`);
        return;
    }
    log(`TRADE-LS start: ${total} longswords, offering ${give}, keeping ${KEEP}, partner pigfat`);

    const opened = await bot.tradeWith(PARTNER, 60_000, { retryOnBusy: true });
    if (!opened.success) {
        log(`TRADE-LS could not open trade with pigfat: ${opened.message}`);
        return;
    }
    log(`TRADE-LS trade open with pigfat`);

    const offered = await bot.offerTradeItems([{ item: ITEM, amount: give }]);
    if (!offered.success) {
        log(`TRADE-LS offer failed: ${offered.message}`);
        await bot.declineTrade().catch(() => {});
        return;
    }
    log(`TRADE-LS offered ${give} longswords, waiting for pigfat to accept`);

    const deadline = Date.now() + WAIT_MS;
    let lastScreen = '';
    while (Date.now() < deadline) {
        const t = sdk.getTradeState();
        if (!t.isOpen) {
            log(`TRADE-LS trade closed; longswords left in inventory: ${longswords()}`);
            return;
        }
        const screen = `${t.screen}/partner=${t.partnerAccepted}/me=${t.myAccepted}`;
        if (screen !== lastScreen) {
            log(`TRADE-LS screen ${screen} | my offer ${t.myOffer.map((i) => `${i.name} x${i.count}`).join(', ') || 'none'} | their offer ${t.theirOffer.map((i) => `${i.name} x${i.count}`).join(', ') || 'none'}`);
            lastScreen = screen;
        }
        if (t.partnerAccepted && !t.myAccepted) {
            const acc = await bot.acceptTrade();
            log(`TRADE-LS accepted on our side: ${acc.message}`);
            if (!acc.success && acc.reason !== 'declined') {
                await sdk.waitForTicks(1).catch(() => {});
            }
            continue;
        }
        await sdk.waitForTicks(1).catch(() => {});
    }

    log(`TRADE-LS timed out after ${WAIT_MS / 60_000} min with no pigfat accept, declining`);
    await bot.declineTrade().catch(() => {});
    log(`TRADE-LS declined; longswords in inventory: ${longswords()}`);
});
