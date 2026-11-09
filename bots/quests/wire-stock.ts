/**
 * Bronze wire in bulk for the mule (user, 2026-11-09: "50 bronze wires for jackthief ... buy bronze bars from Shantay
 * pass ... sitting there buying until it has all 50"). Shilo Village needs one a run and jackthief ran out.
 *
 *   bun bots/quests/wire-stock.ts {botname} [--count=50]
 *
 * Rounds until this account's bank holds --count wires: from the Seers bank (hammer and coins), to Shantay's shop,
 * where it waits out restocks until the pack is full of bars (buyWaitingForRestock, called again while short), then
 * back to the Seers anvil to smith them (the 'bronze wire' source's proven Make-1 routine) and bank. Delivery is a
 * separate legends-stock run (--counts='bronze wire:50' --deliver=jackthief), which then finds them banked.
 * Smithing 4. A run-once task: logs "already complete" at the count.
 */
import { runTask, type Quest } from './lib/run-quest';
import { SOURCES } from './lib/sources';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const TARGET = Number(arg('count') ?? 50);
const SEERS_BANK = { x: 2725, z: 3492 };
/** Calls to the restock-waiting buy while at the counter, each with its own restock budget. */
const SIT_ROUNDS = 8;

const banked = (q: Quest) => q.sdk.getBankItems().find((b) => /^bronze wire$/i.test(b.name))?.count ?? 0;

async function atBank(q: Quest): Promise<void> {
    await q.goTo(SEERS_BANK, 4);
    const r = await q.bot.openBank();
    if (!r.success && !q.sdk.getState()?.bank?.isOpen) throw new Error(`wire-stock: bank did not open: ${r.message}`);
    for (const i of q.sdk.getInventory()) await q.bot.depositItem(i, -1).catch(() => undefined);
    await q.sdk.waitForTicks(2);
}

async function withdraw(q: Quest, re: RegExp, n: number): Promise<void> {
    const b = q.sdk.getBankItems().find((i) => re.test(i.name) && i.count > 0);
    if (b) await q.bot.withdrawItem(b, Math.min(n, b.count)).catch(() => undefined);
    await q.sdk.waitForTicks(2);
}

await runTask({
    id: 'wire-stock',
    hub: 'seers',
    task: async (q) => {
        if ((q.sdk.getSkill('smithing')?.baseLevel ?? 1) < 4) throw new Error('wire-stock: needs Smithing 4');
        for (let round = 1; round <= 12 && !q.stopRequested(); round++) {
            await atBank(q);
            const have = banked(q);
            q.log(`wire-stock: ${have}/${TARGET} bronze wire banked (round ${round})`);
            if (have >= TARGET) break;
            await withdraw(q, /^hammer$/i, 1);
            await withdraw(q, /^coins$/i, 1500);
            await q.bot.closeBank().catch(() => undefined);
            if (!q.sdk.getInventory().some((i) => /^hammer$/i.test(i.name))) await q.ensure('hammer', 1);
            const batch = Math.min(TARGET - have, 28 - q.sdk.getInventory().length);
            if (batch <= 0) throw new Error('wire-stock: no room in the pack for bars');
            // Sit at Shantay's counter until the pack's batch is bought: each call waits out a restock budget.
            for (let sit = 1; sit <= SIT_ROUNDS && q.count('bronze bar') < batch && !q.stopRequested(); sit++) {
                await q.ensure('bronze bar', batch).catch((e) => q.log(`wire-stock: ${q.count('bronze bar')}/${batch} bars (${(e as Error).message}); waiting on`));
            }
            const bars = q.count('bronze bar');
            q.log(`wire-stock: ${bars} bronze bars bought; to the Seers anvil`);
            if (bars === 0) throw new Error("wire-stock: Shantay's shop sold no bronze bars");
            // The source smiths every bar held (it only buys a bar when none is): target = wires + bars.
            await SOURCES['bronze wire']!.get!(q, q.count('bronze wire') + bars).catch((e) => q.log(`wire-stock: smithing: ${(e as Error).message}`));
            q.log(`wire-stock: holding ${q.count('bronze wire')} bronze wire`);
        }
        await atBank(q);
        const end = banked(q);
        await q.bot.closeBank().catch(() => undefined);
        if (end < TARGET) throw new Error(`wire-stock: ${end}/${TARGET} bronze wire banked`);
        q.log(`wire-stock: ${end} bronze wire banked — already complete`);
    },
});
