import { runScript } from '../../sdk/runner';

const BANK = { x: 2655, z: 3284 };
const SHOP = { x: 2614, z: 3293 };
const VIAL = /^vial of water$/i;
const COINS = /^coins$/i;
const PER_TRIP = 27;

await runScript(async ({ bot, sdk }) => {
    const pos = () => {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? p?.x ?? 0, z: p?.worldZ ?? p?.z ?? 0 };
    };
    const distTo = (x: number, z: number) => {
        const p = pos();
        return Math.hypot(p.x - x, p.z - z);
    };
    const coins = () => sdk.findInventoryItem(COINS)?.count ?? 0;
    const vials = () =>
        sdk.getInventory().filter((i) => VIAL.test(i.name)).reduce((n, i) => n + i.count, 0);
    const emptySlots = () => 28 - sdk.getInventory().length;

    async function closeUi() {
        await bot.dismissBlockingUI();
        if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
        if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
        if (sdk.getState()?.interface?.isOpen) await bot.closeInterface();
    }

    async function walkNear(x: number, z: number, tolerance = 3) {
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, tolerance);
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function bankExceptCoins() {
        const extra = sdk.getInventory().filter((i) => !COINS.test(i.name));
        if (extra.length === 0) return true;
        await closeUi();
        if (!(await walkNear(BANK.x, BANK.z, 3))) {
            console.log(`Walk to bank failed @ ${pos().x},${pos().z}`);
            return false;
        }
        if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
            console.log('Could not open bank');
            return false;
        }
        for (let i = 0; i < 40; i++) {
            const item = sdk.getInventory().find((it) => !COINS.test(it.name));
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            console.log(`Deposit ${item.name}: ${r.success || r.partial ? 'ok' : r.message}`);
            if (!r.success && !r.partial) break;
        }
        await bot.closeBank();
        const left = sdk.getInventory().filter((i) => !COINS.test(i.name)).length;
        console.log(`Banked. extra left=${left} gp=${coins()}`);
        return left === 0;
    }

    await closeUi();
    await sdk.showIntent('buy vials of water at Aemad').catch(() => {});
    console.log(`Start @ ${pos().x},${pos().z} gp=${coins()} vials=${vials()}`);
    if (!(await bankExceptCoins())) return;

    let trips = 0;
    let fails = 0;
    while (coins() >= 2) {
        if (vials() > 0) {
            if (!(await bankExceptCoins())) break;
        }
        if (coins() < 2) break;

        await closeUi();
        if (!(await walkNear(SHOP.x, SHOP.z, 3))) {
            console.log(`Walk to shop failed @ ${pos().x},${pos().z}`);
            fails++;
            if (fails > 8) break;
            continue;
        }

        const opened = sdk.getState()?.shop?.isOpen
            || (await bot.openShop(/^(aemad|kortan)$/i)).success;
        if (!opened && !sdk.getState()?.shop?.isOpen) {
            console.log('Could not open Aemad shop');
            fails++;
            if (fails > 8) break;
            await sdk.waitForTicks(5);
            continue;
        }

        const line = sdk.getState()?.shop?.shopItems.find((i) => VIAL.test(i.name)) ?? null;
        const price = Math.max(1, line?.buyPrice ?? 2);
        if (!line || line.count <= 0 || coins() < price) {
            await bot.closeShop();
            if (coins() < price) {
                console.log(`Out of coins (${coins()}gp, need ${price}gp)`);
                break;
            }
            console.log('Shop out of stock, waiting');
            await sdk.waitForTicks(20);
            continue;
        }

        const want = Math.min(PER_TRIP, emptySlots(), line.count, Math.floor(coins() / price));
        if (want <= 0) {
            await bot.closeShop();
            break;
        }

        const bought = await bot.buyFromShop(line, want);
        console.log(
            `Buy ${bought.amountBought}/${want} @ ${price}gp | ` +
            `stock ${sdk.getState()?.shop?.shopItems.find((i) => VIAL.test(i.name))?.count ?? 0} | ${coins()}gp`
        );
        await bot.closeShop();

        if ((bought.amountBought ?? 0) <= 0) {
            fails++;
            if (fails > 8) break;
            await sdk.waitForTicks(10);
            continue;
        }

        fails = 0;
        trips++;
        if (!(await bankExceptCoins())) break;
        console.log(`Trip ${trips} done | gp=${coins()}`);
    }

    await bankExceptCoins();
    await closeUi();
    console.log(`Done. trips=${trips} gp=${coins()} vials in inv=${vials()}`);
});
