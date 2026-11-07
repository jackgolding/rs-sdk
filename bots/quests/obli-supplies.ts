/**
 * Vials of water, papyrus and charcoal from Obli's General Store in Shilo Village (shilo.inv
 * shilojunglestore: 50 of each, ~200t a restock), banked at Shilo's own bank. A run-once task: queue
 * it as a todo.json item; mule-produce.ts --deliver carries the result to a mule.
 *
 *   bun bots/quests/obli-supplies.ts {botname} [--counts='vial of water:50,papyrus:30'] [--buyout='vial of water,vial']
 *
 * Needs Shilo Village complete (Hajedy's cart). `--counts` is what the bank should hold afterwards.
 * `--buyout` buys each listed item until the shop shows none left.
 */
import { runTask, type Quest } from './lib/run-quest';
import { enterShiloVillage, inShiloVillage, leaveShiloVillage } from './lib/shilo-village';
import { itemPattern } from './lib/sources';
import { buyAtShop } from './quest-supplies';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const BUYOUT = (arg('buyout') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((label) => ({ label, pattern: itemPattern(label) }));
const COUNTS = (arg('counts') ?? (BUYOUT.length ? '' : 'vial of water:50'))
    .split(',')
    .map((s) => s.split(':').map((x) => x.trim()))
    .filter(([label, n]) => label && Number(n) > 0)
    .map(([label, n]) => ({ label: label!.toLowerCase(), count: Number(n), pattern: itemPattern(label!.toLowerCase()) }));

const OBLI = { x: 2824, z: 2959, npc: /^obli$/i };
const SHILO_BANK = { x: 2852, z: 2955 };
/** Rounds in a row that buy nothing before stopping with what the bank holds. */
const EMPTY_ROUNDS = 3;
/** Obli's restock interval (shilo.inv), and enough coins for a pack at his raised prices plus the cart. */
const RESTOCK_TICKS = 200;
const COINS_FLOAT = 3000;

const banked = (q: Quest, re: RegExp) => q.sdk.getBankItems().filter((b) => re.test(b.name)).reduce((n, b) => n + b.count, 0);

async function openBank(q: Quest): Promise<void> {
    if (q.sdk.getState()?.bank?.isOpen) return;
    const r = await q.bot.openBank();
    if (!r.success && !q.sdk.getState()?.bank?.isOpen) throw new Error(`bank did not open: ${r.message}`);
}

await runTask({
    id: 'obli-supplies',
    hub: 'ardougne',
    task: async (q) => {
        if (COUNTS.length === 0 && BUYOUT.length === 0) throw new Error("usage: obli-supplies.ts <bot> [--counts='vial of water:50,papyrus:30'] [--buyout='vial of water,vial']");
        await openBank(q);
        const short = () => COUNTS.map((c) => ({ ...c, missing: c.count - banked(q, c.pattern) })).filter((c) => c.missing > 0);
        if (short().length === 0 && BUYOUT.length === 0) return void q.log('obli-supplies: the bank holds every target — already complete');
        const coins = q.sdk.getBankItems().find((b) => /^coins$/i.test(b.name));
        if (!coins) throw new Error('obli-supplies: no coins in the bank');
        await q.bot.withdrawItem(coins, Math.min(COINS_FLOAT, coins.count));
        await q.sdk.waitForTicks(2);
        await q.bot.closeBank().catch(() => undefined);
        await enterShiloVillage(q);
        let empty = 0;
        while (empty < EMPTY_ROUNDS && !q.stopRequested()) {
            // Bank first: it holds the running count, and the pack comes back empty.
            await q.goTo(SHILO_BANK, 4);
            await openBank(q);
            for (const item of q.sdk.getInventory()) {
                if (!/^coins$/i.test(item.name)) await q.bot.depositItem(item, -1).catch(() => undefined);
            }
            await q.sdk.waitForTicks(2);
            const todo = short();
            q.log(`obli-supplies: bank ${[...COUNTS.map((c) => `${c.label} ${banked(q, c.pattern)}/${c.count}`), ...BUYOUT.map((b) => `${b.label} ${banked(q, b.pattern)}`)].join(', ')}`);
            await q.bot.closeBank().catch(() => undefined);
            // What the shop still lists of the buy-out items.
            let left: Array<{ pattern: RegExp; label: string; missing: number }> = [];
            if (BUYOUT.length) {
                await q.goTo(OBLI, 3);
                const opened = await q.bot.openShop(OBLI.npc);
                if (!opened.success) throw new Error(`obli-supplies: shop did not open: ${opened.message}`);
                const listed = q.sdk.getState()?.shop?.shopItems ?? [];
                left = BUYOUT.map((b) => ({ ...b, missing: listed.find((i) => b.pattern.test(i.name))?.count ?? 0 })).filter((b) => b.missing > 0);
                q.log(`obli-supplies: shop lists ${BUYOUT.map((b) => `${b.label} ${listed.find((i) => b.pattern.test(i.name))?.count ?? 0}`).join(', ')}`);
                await q.bot.closeShop().catch(() => undefined);
            }
            if (todo.length === 0 && left.length === 0) break;
            const before = q.sdk.getInventory().length;
            let room = 28 - before;
            const buy = [...left, ...todo].flatMap((c) => {
                const amount = Math.min(c.missing, room);
                room -= amount;
                return amount > 0 ? [{ pattern: c.pattern, amount, label: c.label }] : [];
            });
            await buyAtShop(q.supply, OBLI, buy).catch((e: Error) => q.log(`obli-supplies: ${e.message}`));
            await q.bot.closeShop().catch(() => undefined);
            if (q.sdk.getInventory().length > before) empty = 0;
            else if (++empty < EMPTY_ROUNDS) await q.sdk.waitForTicks(RESTOCK_TICKS);
        }
        if (inShiloVillage({ x: q.sdk.getState()!.player!.worldX, z: q.sdk.getState()!.player!.worldZ })) await leaveShiloVillage(q);
        q.log('obli-supplies: already complete');
    },
});
