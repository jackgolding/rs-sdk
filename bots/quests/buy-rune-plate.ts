/**
 * After Dragon Slayer: buy a rune platebody from Oziach (Edgeville) and bank it.
 *
 *   bun bots/quests/buy-rune-plate.ts {botname}
 *
 * oziach.rs2: once %dragonquest is complete, Talk-to runs oziach_dragon_complete
 * ("Can I buy a rune plate mail body now please?" opens the shop). edgeville.inv:
 * stock 2, shared by every player, restocking; base cost 65000 but Oziach asks 84500
 * (70000 bought nothing for ABGARMY20, 2026-10-30). Does nothing when the
 * account already owns one (bank, pack or worn), or has not finished Dragon Slayer
 * (Oziach then never opens the shop).
 *
 * Queued in todo.json like a quest. A task writes no run record, so every finish logs
 * "already complete", the line todo-runner marks done without one.
 */
import { runTask, type Quest } from './lib/run-quest';
import { SAFE_BANKS } from './safe-stops';
import { untilTicks } from './lib/ticks';

const OZIACH = { x: 3069, z: 3517 };
const PLATE = /^rune platebody$/i;
const COINS_NEEDED = 100_000;
/** Shared stock of 2: wait for a restock before giving up. */
const STOCK_WAITS = 6;

const owned = (q: Quest) =>
    q.sdk.getInventory().some((i) => PLATE.test(i.name)) || q.sdk.getEquipment().some((i) => PLATE.test(i.name));

async function bankEverything(q: Quest): Promise<void> {
    await q.goTo(SAFE_BANKS.edgeville, 3);
    await q.bot.openBank();
    for (const item of q.sdk.getInventory()) await q.bot.depositItem(item.name, -1);
    await q.bot.closeBank();
}

/**
 * `--buyout`: buy every rune platebody Oziach has in stock right now, owned or not, with no
 * restock waits (user, 2026-11-01: jacklove18 buys out his stock before its next job).
 */
const BUYOUT = process.argv.includes('--buyout');

async function buyout(q: Quest): Promise<void> {
    await q.bot.openBank();
    const banked = q.sdk.findBankItem(/^coins$/i)?.count ?? 0;
    const take = Math.min(banked, 300_000);
    if (take < 84_500) {
        await q.bot.closeBank();
        return q.log(`rune plate buyout: only ${banked} coins banked — already complete (nothing bought)`);
    }
    await q.bot.withdrawItem(/^coins$/i, take);
    await q.bot.closeBank();
    await q.talk(/^oziach$/i, [/can i buy a rune plate/i], OZIACH);
    if (!(await untilTicks(q.sdk, () => !!q.sdk.getState()?.shop?.isOpen, 10))) {
        throw new Error('rune plate buyout: Oziach did not open his shop (is Dragon Slayer complete?)');
    }
    let bought = 0;
    for (let i = 0; i < 6; i++) {
        const stock = q.sdk.getState()?.shop?.shopItems?.find((it) => PLATE.test(it.name));
        if (!stock || stock.count < 1 || q.count('coins') < stock.buyPrice) break;
        const before = q.sdk.getInventory().filter((it) => PLATE.test(it.name)).length;
        const res = await q.bot.buyFromShop(PLATE, 1);
        await untilTicks(q.sdk, () => q.sdk.getInventory().filter((it) => PLATE.test(it.name)).length > before, 6);
        if (q.sdk.getInventory().filter((it) => PLATE.test(it.name)).length > before) bought++;
        q.log(`rune plate buyout: ${res.message} (price ${stock.buyPrice}, stock ${stock.count})`);
    }
    await q.bot.closeShop();
    await bankEverything(q);
    q.log(`rune plate buyout: bought ${bought} and banked them — already complete for this run`);
}

await runTask({
    id: 'buy-rune-plate',
    hub: 'edgeville',
    task: async (q) => {
        if (BUYOUT) return buyout(q);
        if (owned(q)) return q.log('rune plate: already complete (carried or worn)');
        await q.bot.openBank();
        if (q.sdk.findBankItem(PLATE)) {
            await q.bot.closeBank();
            return q.log('rune plate: already complete (banked)');
        }
        const coins = q.sdk.findBankItem(/^coins$/i)?.count ?? 0;
        if (coins < COINS_NEEDED) {
            await q.bot.closeBank();
            return q.log(`rune plate: only ${coins} coins banked, need ${COINS_NEEDED}`);
        }
        await q.bot.withdrawItem(/^coins$/i, COINS_NEEDED);
        await q.bot.closeBank();

        for (let wait = 0; wait <= STOCK_WAITS && !owned(q); wait++) {
            if (wait) {
                q.log(`rune plate: none bought (Oziach out of stock?); waiting for a restock (${wait}/${STOCK_WAITS})`);
                await q.sdk.waitForTicks(100);
            }
            await q.talk(/^oziach$/i, [/can i buy a rune plate/i], OZIACH);
            if (!(await untilTicks(q.sdk, () => !!q.sdk.getState()?.shop?.isOpen, 10))) {
                throw new Error('rune plate: Oziach did not open his shop (is Dragon Slayer complete?)');
            }
            const stock = q.sdk.getState()?.shop?.shopItems?.find((i) => PLATE.test(i.name));
            const coins = q.count('coins');
            if (stock && stock.count > 0 && coins < stock.buyPrice) {
                await q.bot.closeShop();
                throw new Error(`rune plate: Oziach asks ${stock.buyPrice}, carrying ${coins}`);
            }
            if (!stock || stock.count < 1) {
                await q.bot.closeShop();
                continue;
            }
            const res = await q.bot.buyFromShop(PLATE, 1);
            q.log(`rune plate: ${res.message} (price ${stock.buyPrice}, stock ${stock.count})`);
            await q.bot.closeShop();
        }
        if (!owned(q)) throw new Error(`rune plate: none bought after ${STOCK_WAITS} restock waits`);
        await bankEverything(q);
        q.log('rune plate: bought and banked — already complete for this account');
    },
});
