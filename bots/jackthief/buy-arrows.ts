import { runScript } from '../../sdk/runner';

const HICKTON = { x: 2822, z: 3442 };
const MAX_GP = 5;
const BRONZE_STOCK = 1000;
const IRON_STOCK = 800;
const COIN_WITHDRAW = 2000;
const IRON_ARROW = /^iron arrows?$/i;
const BRONZE_ARROW = /^bronze arrows?$/i;

await runScript(async ({ bot, sdk }) => {
    const pos = () => {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0 };
    };
    const distTo = (x: number, z: number) => {
        const p = pos();
        return Math.hypot(p.x - x, p.z - z);
    };
    const coins = () => sdk.findInventoryItem(/^coins$/i)?.count ?? 0;
    const countItems = (pattern: RegExp) =>
        sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + i.count, 0);

    const shopLine = (pattern: RegExp) =>
        sdk.getState()?.shop?.shopItems.find((i) => pattern.test(i.name)) ?? null;

    const shopBuyPrice = (item: { name: string; count: number; baseCost: number }) => {
        const cfg = sdk.getState()?.shop?.shopConfig;
        const haggle = cfg?.haggle ?? 10;
        const sellMult = cfg?.sellMultiplier ?? 1000;
        const stockBase = IRON_ARROW.test(item.name)
            ? IRON_STOCK
            : BRONZE_ARROW.test(item.name)
              ? BRONZE_STOCK
              : item.count;
        const stockDiff = item.count - stockBase;
        const int5Raw = Math.min(1000, Math.max(-5000, stockDiff * haggle));
        const int5 = Math.max(100, sellMult - int5Raw);
        return Math.max(1, Math.floor((item.baseCost * int5) / 1000));
    };

    const buyWhileCheap = async (pattern: RegExp, label: string) => {
        let bought = 0;
        for (let i = 0; i < 80; i++) {
            const line = shopLine(pattern);
            if (!line || line.count <= 0) break;
            const price = shopBuyPrice(line);
            if (price >= MAX_GP) {
                console.log(`${label} ${price}gp (>= ${MAX_GP}) stock ${line.count} — stop`);
                break;
            }
            if (coins() < price) {
                console.log(`Out of coins for ${label} (${coins()}gp, need ${price}gp)`);
                break;
            }
            const want = Math.min(10, line.count, Math.floor(coins() / price));
            if (want <= 0) break;
            const r = await bot.buyFromShop(line, want);
            bought += r.amountBought ?? 0;
            if ((r.amountBought ?? 0) <= 0) {
                console.log(`Buy ${label} failed: ${r.message}`);
                break;
            }
            console.log(`Bought ${r.amountBought} ${label} @ ${price}gp | ${coins()}gp left`);
        }
        return bought;
    };

    await bot.dismissBlockingUI();
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();

    if (!sdk.getState()?.bank?.isOpen) {
        const opened = await bot.openBank();
        if (!opened.success) throw new Error(`openBank failed: ${opened.message}`);
    }
    if (coins() < COIN_WITHDRAW) {
        const r = await bot.withdrawItem(/^coins$/i, COIN_WITHDRAW);
        console.log(`Withdraw coins: ${r.success || r.partial} now ${coins()}gp`);
    }
    await bot.closeBank();
    if (coins() < 1) throw new Error('No coins to buy arrows');

    await sdk.showIntent('buy cheap arrows at Hickton').catch(() => {});
    if (distTo(HICKTON.x, HICKTON.z) > 3) {
        const walk = await bot.walkTo(HICKTON.x, HICKTON.z, 3);
        if (!walk.success && distTo(HICKTON.x, HICKTON.z) > 5) {
            throw new Error(`walk to Hickton failed: ${walk.message} @ ${pos().x},${pos().z}`);
        }
    }

    const opened = await bot.openShop(/hickton/i);
    if (!opened.success && !sdk.getState()?.shop?.isOpen) {
        throw new Error(`Hickton shop failed: ${opened.message}`);
    }

    const iron = shopLine(IRON_ARROW);
    const bronze = shopLine(BRONZE_ARROW);
    console.log(
        `Hickton iron ${iron?.count ?? 0} @ ${iron ? shopBuyPrice(iron) : '?'}gp ` +
        `bronze ${bronze?.count ?? 0} @ ${bronze ? shopBuyPrice(bronze) : '?'}gp | ${coins()}gp`
    );

    const gotIron = await buyWhileCheap(IRON_ARROW, 'iron arrow');
    const gotBronze = await buyWhileCheap(BRONZE_ARROW, 'bronze arrow');
    await bot.closeShop();

    const best = sdk.findInventoryItem(IRON_ARROW) ?? sdk.findInventoryItem(BRONZE_ARROW);
    if (best) {
        const r = await bot.equipItem(best);
        console.log(`Equip ${best.count} ${best.name}: ${r.success ? 'ok' : r.message}`);
    }

    console.log(
        `Done. +${gotIron} iron +${gotBronze} bronze | ` +
        `inv iron ${countItems(IRON_ARROW)} bronze ${countItems(BRONZE_ARROW)} | ${coins()}gp`
    );
}, {
    timeout: 180_000,
});
