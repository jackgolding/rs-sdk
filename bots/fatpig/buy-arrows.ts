/**
 * Drain Lowe's Archery Emporium of bronze arrows, then bank them.
 *
 *   bun bots/fatpig/buy-arrows.ts
 */
import { appendFileSync } from 'fs';
import { dirname, join } from 'path';
import { runScript } from '../../sdk/runner';

const EDGEVILLE_BANK = { x: 3096, z: 3494 };
const VARROCK_EAST = { x: 3253, z: 3420 };
const LOWE = { x: 3232, z: 3423 };
const COIN_WITHDRAW = 15_000;
const BRONZE_STOCK = 2000;
const BRONZE_ARROW = /^bronze arrows?$/i;
const COINS = /^coins$/i;

const TO_LOWE = [
    { x: 3096, z: 3494 },
    { x: 3105, z: 3482 },
    { x: 3180, z: 3430 },
    { x: 3232, z: 3423 }
];

const GRIND_LOG = join(dirname(import.meta.path), 'grind.log');

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
    const pos = () => {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, hp: p?.hp ?? 0, maxHp: p?.maxHp ?? 10 };
    };
    const distTo = (x: number, z: number) => Math.hypot(pos().x - x, pos().z - z);
    const coins = () => sdk.findInventoryItem(COINS)?.count ?? 0;
    const countArrows = () =>
        sdk.getInventory().filter((i) => BRONZE_ARROW.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);

    const shopLine = () => sdk.getState()?.shop?.shopItems.find((i) => BRONZE_ARROW.test(i.name)) ?? null;

    const shopBuyPrice = (item: { count: number; baseCost: number }) => {
        const cfg = sdk.getState()?.shop?.shopConfig;
        const haggle = cfg?.haggle ?? 10;
        const sellMult = cfg?.sellMultiplier ?? 1000;
        const stockDiff = item.count - BRONZE_STOCK;
        const int5Raw = Math.min(1000, Math.max(-5000, stockDiff * haggle));
        const int5 = Math.max(100, sellMult - int5Raw);
        return Math.max(1, Math.floor((item.baseCost * int5) / 1000));
    };

    async function closeUi() {
        if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
            await bot.closeInterface();
        }
        await bot.dismissBlockingUI();
    }

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const life = sdk.getState()?.player?.lifeId;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        const p = sdk.getState()?.player;
        if (p?.isDead || (life !== undefined && p?.lifeId !== undefined && p.lifeId !== life)) {
            throw new Error(`Died walking to ${x},${z}`);
        }
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function walkWaypoints(points: { x: number; z: number }[]) {
        const dest = points[points.length - 1]!;
        for (const p of points) {
            if (distTo(p.x, p.z) <= 8) continue;
            if (Math.hypot(dest.x - p.x, dest.z - p.z) >= distTo(dest.x, dest.z) - 4) continue;
            await walkNear(p.x, p.z, 6);
        }
        if (distTo(dest.x, dest.z) > 6) await walkNear(dest.x, dest.z, 3);
    }

    await closeUi();
    log(`Lowe bronze-arrow buyout start @ ${pos().x},${pos().z} arrows=${countArrows()} gp=${coins()}`);

    const bank = distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z) <= distTo(VARROCK_EAST.x, VARROCK_EAST.z)
        ? EDGEVILLE_BANK
        : VARROCK_EAST;
    log(`Withdrawing ${COIN_WITHDRAW} gp at ${bank === EDGEVILLE_BANK ? 'Edgeville' : 'Varrock east'}`);
    await walkNear(bank.x, bank.z, 3);
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        throw new Error('Could not open bank');
    }
    if (coins() < COIN_WITHDRAW) {
        const r = await bot.withdrawItem(COINS, COIN_WITHDRAW);
        log(`Withdraw coins: ${r.success || r.partial ? 'ok' : r.message} now ${coins()}gp`);
    }
    await bot.closeBank();
    if (coins() < 1) throw new Error('No coins');

    log('Walking to Lowe');
    await walkWaypoints(TO_LOWE);
    const opened = await bot.openShop(/lowe/i);
    if (!opened.success && !sdk.getState()?.shop?.isOpen) {
        throw new Error(`Lowe shop failed: ${opened.message}`);
    }

    let bought = 0;
    for (let i = 0; i < 400; i++) {
        const line = shopLine();
        if (!line || line.count <= 0) {
            log(`Shop empty after ${bought} bought`);
            break;
        }
        const price = shopBuyPrice(line);
        if (coins() < price) {
            log(`Out of coins (${coins()}gp, need ${price}gp) stock ${line.count}`);
            break;
        }
        const want = Math.min(100, line.count, Math.floor(coins() / price));
        if (want <= 0) break;
        const r = await bot.buyFromShop(line, want);
        bought += r.amountBought ?? 0;
        if ((r.amountBought ?? 0) <= 0) {
            log(`Buy failed: ${r.message}`);
            break;
        }
        if (i % 5 === 0 || line.count <= 20) {
            log(`Bought ${r.amountBought} bronze @ ${price}gp | stock ${shopLine()?.count ?? 0} | ${coins()}gp | inv ${countArrows()}`);
        }
    }
    await bot.closeShop();
    log(`Bought ${bought} bronze arrows | inv ${countArrows()} | ${coins()}gp`);

    log('Banking arrows at Varrock east');
    await walkNear(VARROCK_EAST.x, VARROCK_EAST.z, 3);
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        throw new Error('Could not open Varrock east bank');
    }
    if (countArrows() > 0) {
        const r = await bot.depositItem(BRONZE_ARROW, -1);
        log(`Deposit arrows: ${r.success || r.partial ? 'ok' : r.message}`);
    }
    if (coins() > 0) await bot.depositItem(COINS, -1);
    await bot.closeBank();
    log(`Done. arrows left in inv ${countArrows()}`);
});
