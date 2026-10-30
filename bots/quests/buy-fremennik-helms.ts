/**
 * After The Fremennik Trials: from Seers' bank, buy 5 each of the Berserker, Archer,
 * Warrior and Farseer helms from Skulgrimen in Rellekka, as far as the coins go.
 *
 *   bun bots/quests/buy-fremennik-helms.ts {botname}
 *
 * viking_weapon_salesman.rs2: Skulgrimen's Talk-to opens viking_weapons_shop only
 * once %viking is complete. viking.inv: 5 of each helm, shared by every player,
 * restocking; base cost 60000 each, and the asking price rises as stock falls, so
 * every helm is priced from the open shop. Always buys 5 of each, whatever is already
 * banked (pigfat, with 5 Berserker and 5 Archer banked, bought only the other two).
 * The epilogue banks what was bought at Seers'.
 *
 * Queued in todo.json like a quest. A task writes no run record, so every finish logs
 * "already complete", the line todo-runner marks done without one.
 */
import { runTask, type Quest } from './lib/run-quest';
import { untilTicks } from './lib/ticks';

/** Skulgrimen's spawn (map m41_57). */
const SKULGRIMEN = { x: 2663, z: 3694 };
const WANT = 5;
const HELMS = [/^berserker helm$/i, /^archer helm$/i, /^warrior helm$/i, /^farseer helm$/i];
/** 20 helms at up to ~1.3x base and rising: enough for the lot, never the whole bank. */
const COINS_CAP = 2_000_000;

const held = (q: Quest, re: RegExp) =>
    q.sdk.getInventory().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);

await runTask({
    id: 'buy-fremennik-helms',
    hub: 'seers',
    task: async (q) => {
        await q.bot.openBank();
        const short = HELMS.map(() => WANT);
        const coins = q.sdk.findBankItem(/^coins$/i)?.count ?? 0;
        if (coins < 60_000) {
            await q.bot.closeBank();
            return q.log(`helms: only ${coins} coins banked, not enough for one helm — already complete for now`);
        }
        await q.bot.withdrawItem(/^coins$/i, Math.min(coins, COINS_CAP));
        await q.bot.closeBank();
        q.log(`helms: want ${short.join('/')} (berserker/archer/warrior/farseer); carrying ${q.count('coins')} coins`);

        await q.talk(/^skulgrimen$/i, [], SKULGRIMEN);
        if (!(await untilTicks(q.sdk, () => !!q.sdk.getState()?.shop?.isOpen, 10))) {
            throw new Error('helms: Skulgrimen did not open his shop (are the Fremennik Trials complete?)');
        }
        for (let i = 0; i < HELMS.length; i++) {
            const re = HELMS[i]!;
            for (let n = 0; n < short[i]!; n++) {
                const stock = q.sdk.getState()?.shop?.shopItems?.find((s) => re.test(s.name));
                if (!stock || stock.count < 1) {
                    q.log(`helms: ${re.source} out of stock after ${n}`);
                    break;
                }
                if (q.count('coins') < stock.buyPrice) {
                    q.log(`helms: ${stock.name} costs ${stock.buyPrice}, only ${q.count('coins')} coins left`);
                    break;
                }
                const before = held(q, re);
                const res = await q.bot.buyFromShop(re, 1);
                if (held(q, re) <= before) {
                    q.log(`helms: buying ${stock.name} failed: ${res.message}`);
                    break;
                }
            }
        }
        await q.bot.closeShop();
        const bought = HELMS.map((re) => held(q, re));
        q.log(`helms: bought ${bought.join('/')} (berserker/archer/warrior/farseer) — already complete for this account`);
    },
});
