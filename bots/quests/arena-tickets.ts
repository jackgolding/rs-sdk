/**
 * Toadflax stock run: Brimhaven Agility Arena tickets exchanged with Pirate Jackie (3 a herb),
 * the only toadflax source in this revision (lib/agility-arena.ts has the mechanics). Banks them,
 * then optionally trades them to the mule. A run-once task: queue it as a todo.json item.
 *
 *   bun bots/quests/arena-tickets.ts {botname} [--toadflax=6] [--deliver=jackthief] [--max-ticks=20000]
 *
 *   --toadflax   bank at least this many (what the bank already holds counts).
 *   --deliver    walk to that mule's bank (supply.ts muleBank: jackthief at Ardougne), withdraw the
 *                toadflax as notes, DM `quest-restock` and trade them over (quest-mule.ts
 *                receiveRestock banks them). Skipped when this account is that mule.
 *   --max-ticks  give up on the arena after this many ticks (tickets held are kept, in the bank).
 *
 * Needs Agility 40 to use every bridge (spinning blades, poison darts); 20-39 routes round them.
 * From and back to the Ardougne bank: Barnaby's boat (30gp each way), 200gp to Cap'n Izzy per
 * entry, food from the bank (each failed obstacle or trap hits 5% hp + 2).
 *
 * SIGTERM stops at the next tag and the epilogue banks the pack. Ticks, not milliseconds. A task
 * writes no run record; the finish logs "already complete" for todo-runner.
 */
import { runTask, type Quest } from './lib/run-quest';
import { tickNow, ticksToMs, untilTicks } from './lib/ticks';
import { arenaToadflax, leaveArena, TICKETS_PER_TOADFLAX } from './lib/agility-arena';
import { homeFromJungle } from './lib/jungle-potion';
import { SAFE_BANKS } from './safe-stops';
import { dmMule, muleAccount, muleBank } from './supply';
import type { BankItem } from '../../sdk/types';

const arg = (name: string) => {
    const a = process.argv.find((x) => x.startsWith(`--${name}=`));
    return a === undefined ? undefined : a.slice(name.length + 3);
};
const BOT = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const TARGET = Number(arg('toadflax') ?? 6);
const DELIVER_TO = arg('deliver');
const MAX_TICKS = Number(arg('max-ticks') ?? 20_000);

const HUB = SAFE_BANKS.ardougne;
const TOADFLAX = /^toadflax$/i;
const TICKET = /^agility arena ticket$/i;
const COINS = /^coins$/i;
const FOOD = /^(shark|swordfish|lobster|monkfish|bass|tuna|salmon|trout)$/i;
/** Boat both ways and a few entries. */
const COINS_KIT = 1000;
const FOOD_KIT = 12;

const bankCount = (q: Quest, re: RegExp) => q.sdk.getBankItems().filter((b) => re.test(b.name)).reduce((n, b) => n + b.count, 0);
const bankItem = (q: Quest, re: RegExp): BankItem | undefined => q.sdk.getBankItems().find((b) => re.test(b.name) && b.count > 0);
const held = (q: Quest, re: RegExp) => q.sdk.getInventory().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);

async function openBank(q: Quest): Promise<void> {
    if (q.sdk.getState()?.bank?.isOpen) return;
    const r = await q.bot.openBank();
    if (!r.success && !q.sdk.getState()?.bank?.isOpen) throw new Error(`bank did not open: ${r.message}`);
}

async function depositAll(q: Quest): Promise<void> {
    for (const item of q.sdk.getInventory()) await q.bot.depositItem(item, -1).catch(() => undefined);
    await untilTicks(q.sdk, () => q.sdk.getInventory().length === 0, 6);
}

/** Withdraw up to `n` of a bank line (bank open); returns how many arrived. */
async function take(q: Quest, re: RegExp, n: number, asNote = false): Promise<number> {
    const line = bankItem(q, re);
    if (!line || n <= 0) return 0;
    const before = held(q, re);
    await q.bot.withdrawItem(line, Math.min(n, line.count), { asNote });
    await untilTicks(q.sdk, () => held(q, re) > before, 6);
    return held(q, re) - before;
}

async function deliver(q: Quest, mule: string): Promise<void> {
    const { sdk, bot } = q;
    const account = muleAccount(mule);
    await q.goTo(muleBank(mule), 3);
    await openBank(q);
    await depositAll(q);
    const got = await take(q, TOADFLAX, TARGET, true);
    await bot.closeBank().catch(() => undefined);
    if (got === 0) return void q.log(`deliver: no toadflax to give ${mule}`);
    let ok = false;
    for (let attempt = 1; attempt <= 10 && !ok && !q.stopRequested(); attempt++) {
        if (attempt > 1) await sdk.waitForTicks(40);
        await dmMule(sdk, account, 'quest-restock');
        q.log(`deliver: asked ${mule}${account !== mule ? ` (${account})` : ''} to take ${got} toadflax (attempt ${attempt})`);
        await sdk.waitForTicks(8);
        const res = await bot.trade(account, {
            give: [{ item: TOADFLAX, amount: got }],
            want: [],
            timeout: ticksToMs(300),
            requestTimeout: ticksToMs(150),
            rejectAfterMs: ticksToMs(150),
            retryOnBusy: true,
        });
        ok = res.success;
        q.log(`deliver: trade with ${mule} ${ok ? 'ok' : `failed (${res.reason ?? res.message})`}`);
    }
    if (held(q, TOADFLAX) > 0) {
        await openBank(q);
        await depositAll(q);
        await bot.closeBank().catch(() => undefined);
    }
    if (!ok) throw new Error(`deliver: ${mule} never took the toadflax`);
    q.log(`deliver: ${mule} restocked with ${got} toadflax`);
}

await runTask({
    id: 'arena-tickets',
    hub: 'ardougne',
    task: async (q) => {
        if (!(TARGET > 0)) throw new Error('usage: arena-tickets.ts <bot> [--toadflax=N] [--deliver=<mule>]');
        const t0 = tickNow(q.sdk);
        await q.goTo(HUB, 4);
        await openBank(q);
        await depositAll(q);
        const start = bankCount(q, TOADFLAX);
        const need = TARGET - start;
        q.log(`arena-tickets: banked toadflax ${start}/${TARGET}, ${bankCount(q, TICKET)} tickets, agility ${q.level('agility')}`);
        if (need > 0) {
            await take(q, COINS, COINS_KIT);
            await take(q, FOOD, FOOD_KIT);
            await take(q, TICKET, need * TICKETS_PER_TOADFLAX);
            await q.bot.closeBank().catch(() => undefined);
            if (held(q, COINS) < 290) throw new Error(`arena-tickets: ${held(q, COINS)} coins: need the boat and Cap'n Izzy's 200`);
            let err: unknown;
            try {
                await arenaToadflax(q, need, { maxTicks: MAX_TICKS });
            } catch (e) {
                err = e;
                await leaveArena(q).catch((e2) => q.log(`arena-tickets: ${e2 instanceof Error ? e2.message : String(e2)}`));
            }
            await homeFromJungle(q);
            await q.goTo(HUB, 4);
            await openBank(q);
            await depositAll(q);
            const end = bankCount(q, TOADFLAX);
            q.log(`arena-tickets: banked toadflax ${end}/${TARGET} (+${end - start}), ${bankCount(q, TICKET)} tickets, in ${tickNow(q.sdk) - t0}t (${end > start ? Math.round((tickNow(q.sdk) - t0) / (end - start)) : '-'}t a herb, trip included)`);
            await q.bot.closeBank().catch(() => undefined);
            if (err) throw err;
            if (end < TARGET) throw new Error(`arena-tickets: short, ${end}/${TARGET} toadflax`);
        } else {
            await q.bot.closeBank().catch(() => undefined);
        }
        if (q.stopRequested()) return void q.log('stop requested — banked; the epilogue takes it home');
        if (DELIVER_TO && muleAccount(DELIVER_TO).toLowerCase() !== BOT.toLowerCase()) await deliver(q, DELIVER_TO);
        else if (DELIVER_TO) q.log(`deliver: this account is ${DELIVER_TO}: the stock is already in its bank`);
        q.log('arena-tickets: already complete');
    },
});
