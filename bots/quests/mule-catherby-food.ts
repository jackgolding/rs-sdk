/**
 * Mule cooked tuna/swordfish/lobster/shark notes at Catherby bank.
 *
 *   bun bots/quests/mule-catherby-food.ts jacklove1 collect
 *   bun bots/quests/mule-catherby-food.ts jacklove2 give
 *   bun bots/quests/mule-catherby-food.ts Jackpoo3 fetch
 *
 * collect — Jacklove1: note own bank food, take notes from Jacklove2–5, then
 *           give everything to Jackpoo3.
 * give    — Jacklove2–5: note bank food and trade it to Jacklove1.
 * fetch   — Jackpoo3: walk Ardougne → Catherby and take the notes.
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';

const COLLECTOR = 'Jacklove1';
const FETCHER = 'Jackpoo3';
const GIVERS = /^Jacklove[2-5]$/i;
const FOOD = /^(tuna|swordfish|lobster|shark)$/i;
const FOOD_NAMES = ['tuna', 'swordfish', 'lobster', 'shark'];
const CATHERBY_BANK = { x: 2808, z: 3443 };
const ARDY_TO_CATHERBY = [
    { x: 2662, z: 3336 },
    { x: 2662, z: 3375 },
    { x: 2695, z: 3375 },
    { x: 2726, z: 3485 },
    { x: 2758, z: 3477 },
    { x: 2788, z: 3460 },
    { x: 2808, z: 3443 }
];

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const botName = args[0] ?? '';
const roleArg = (args[1] ?? '').toLowerCase();
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

function inferRole(name: string): 'collect' | 'give' | 'fetch' {
    if (/^jacklove1$/i.test(name)) return 'collect';
    if (/^jackpoo3$/i.test(name)) return 'fetch';
    return 'give';
}

const role = roleArg === 'collect' || roleArg === 'give' || roleArg === 'fetch'
    ? roleArg
    : inferRole(botName);

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
    const count = (pattern: RegExp) =>
        sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    const invFood = () =>
        FOOD_NAMES
            .map((name) => ({ name, count: count(new RegExp(`^${name}$`, 'i')) }))
            .filter((s) => s.count > 0);
    const foodGive = () =>
        invFood().map(({ name, count: n }) => ({
            item: new RegExp(`^${name}$`, 'i'),
            amount: n
        }));
    const foodSummary = () =>
        invFood().map((s) => `${s.count} ${s.name}`).join(', ') || 'none';

    async function closeUi() {
        if (sdk.getTradeState().isOpen) await bot.declineTrade().catch(() => {});
        const dialog = sdk.getDialog();
        if (dialog?.isOpen) {
            const cont = dialog.options?.find((o) => /continue|click here/i.test(o.text));
            if (cont) await sdk.sendClickDialog(cont.index);
            else await sdk.sendClickDialog(0);
            await sdk.waitForTicks(1);
        }
        await bot.dismissBlockingUI();
        if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
            await bot.closeInterface();
        }
    }

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function walkWaypoints(wps: { x: number; z: number }[]): Promise<void> {
        const dest = wps[wps.length - 1]!;
        for (const wp of wps) {
            if (distTo(dest.x, dest.z) <= 8) return;
            const remaining = distTo(dest.x, dest.z);
            const via = Math.hypot(wp.x - dest.x, wp.z - dest.z);
            if (via >= remaining - 6) continue;
            await walkNear(wp.x, wp.z, 8);
        }
        if (distTo(dest.x, dest.z) > 6) await walkNear(dest.x, dest.z, 6);
    }

    async function openBank(): Promise<boolean> {
        if (sdk.getState()?.bank?.isOpen) return true;
        await walkNear(CATHERBY_BANK.x, CATHERBY_BANK.z, 3);
        const r = await bot.openBank();
        if (r.success || sdk.getState()?.bank?.isOpen) return true;
        log(`openBank failed: ${r.message}`);
        return false;
    }

    async function depositAll(): Promise<void> {
        for (let i = 0; i < 40; i++) {
            const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0);
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            if (!r.success && !r.partial) {
                log(`Deposit ${item.name} failed: ${r.message}`);
                break;
            }
        }
    }

    async function noteBankFood(): Promise<number> {
        await closeUi();
        if (!(await openBank())) return count(FOOD);
        await depositAll();
        for (const name of FOOD_NAMES) {
            const re = new RegExp(`^${name}$`, 'i');
            const inBank = sdk.findBankItem(re)?.count ?? 0;
            if (inBank <= 0) continue;
            const r = await bot.withdrawItem(re, -1, { asNote: true });
            log(`Noted ${name} x${inBank} ${r.success ? 'ok' : r.message}`);
        }
        await bot.closeBank();
        log(`Packed notes ${foodSummary()} @ ${pos().x},${pos().z}`);
        return count(FOOD);
    }

    async function giveToCollector(): Promise<boolean> {
        const packed = await noteBankFood();
        if (packed <= 0) {
            log('No cooked tuna/swordfish/lobster/shark to mule');
            return false;
        }
        await walkNear(CATHERBY_BANK.x, CATHERBY_BANK.z, 4);
        const deadline = Date.now() + 3 * 60_000;
        while (Date.now() < deadline && count(FOOD) > 0) {
            await closeUi();
            const give = foodGive();
            if (give.length === 0) break;
            const result = await bot.trade(COLLECTOR, {
                give,
                requestTimeout: 25_000,
                timeout: 45_000,
                retryOnBusy: true
            });
            log(
                `Trade ${COLLECTOR} ${result.success ? 'ok' : result.reason} ${result.message} | leftover ${foodSummary()}`
            );
            if (result.success && count(FOOD) === 0) return true;
            await walkNear(CATHERBY_BANK.x, CATHERBY_BANK.z, 4);
            await sdk.waitForTicks(2);
        }
        return count(FOOD) === 0;
    }

    async function collectFromGivers(): Promise<void> {
        const packed = await noteBankFood();
        log(`Own notes ${packed} — waiting on Jacklove2–5`);
        await walkNear(CATHERBY_BANK.x, CATHERBY_BANK.z, 4);
        if (sdk.getTradeState().isOpen) await bot.declineTrade().catch(() => {});
        const served = await bot.serveTrades({
            from: GIVERS,
            give: [],
            want: [{ item: FOOD, amount: 1 }],
            maxTrades: 4,
            timeout: 3 * 60_000,
            tradeTimeout: 60_000
        });
        const ok = served.trades.filter((t) => t.success).length;
        log(
            `Collect givers ${ok}/4 ${served.reason} ${served.message} | now ${foodSummary()}`
        );
    }

    async function giveToFetcher(): Promise<boolean> {
        const give = foodGive();
        if (give.length === 0) {
            log('No notes left to give Jackpoo3');
            return false;
        }
        await walkNear(CATHERBY_BANK.x, CATHERBY_BANK.z, 4);
        if (sdk.getTradeState().isOpen) await bot.declineTrade().catch(() => {});
        log(`Serving ${FETCHER} ${foodSummary()}`);
        const served = await bot.serveTrades({
            from: new RegExp(`^${FETCHER}$`, 'i'),
            give,
            want: [],
            maxTrades: 1,
            timeout: 8 * 60_000,
            tradeTimeout: 90_000
        });
        const last = served.trades[served.trades.length - 1];
        log(
            `Give ${FETCHER} ${last?.success ? 'ok' : last?.reason ?? served.reason} ${served.message} | leftover ${foodSummary()}`
        );
        return last?.success === true || count(FOOD) === 0;
    }

    async function fetchFromCollector(): Promise<boolean> {
        await closeUi();
        log(`Walking to Catherby bank for ${COLLECTOR} notes @ ${pos().x},${pos().z}`);
        await walkWaypoints(ARDY_TO_CATHERBY);
        await walkNear(CATHERBY_BANK.x, CATHERBY_BANK.z, 4);
        const deadline = Date.now() + 8 * 60_000;
        while (Date.now() < deadline && count(FOOD) === 0) {
            await closeUi();
            if (!sdk.findNearbyPlayer(new RegExp(`^${COLLECTOR}$`, 'i'))) {
                log(`${COLLECTOR} not visible — waiting at bank`);
                await walkNear(CATHERBY_BANK.x, CATHERBY_BANK.z, 4);
                await sdk.waitForTicks(4);
                continue;
            }
            const result = await bot.trade(COLLECTOR, {
                give: [],
                want: [{ item: FOOD, amount: 1 }],
                requestTimeout: 25_000,
                timeout: 45_000,
                retryOnBusy: true
            });
            log(
                `Trade ${COLLECTOR} ${result.success ? 'ok' : result.reason} ${result.message} | got ${foodSummary()}`
            );
            if (result.success && count(FOOD) > 0) return true;
            await sdk.waitForTicks(3);
        }
        return count(FOOD) > 0;
    }

    await closeUi();
    log(`Mule ${role} start @ ${pos().x},${pos().z} food=${foodSummary()}`);
    if (role === 'give') {
        const ok = await giveToCollector();
        log(`Give done ${ok ? 'ok' : 'incomplete'} leftover ${foodSummary()}`);
        return;
    }
    if (role === 'collect') {
        await collectFromGivers();
        const ok = await giveToFetcher();
        log(`Collect done ${ok ? 'ok' : 'incomplete'} leftover ${foodSummary()}`);
        return;
    }
    const ok = await fetchFromCollector();
    log(`Fetch done ${ok ? 'ok' : 'incomplete'} got ${foodSummary()}`);
});
