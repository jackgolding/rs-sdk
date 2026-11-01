/**
 * Mule production run (jackthief, the max-stat mule): bank the mule-only lines the fleet runs
 * out of, then optionally carry a share to the Draynor mule by trade. A run-once task: queue it
 * as a todo.json item, and todo-runner goes back to `--then quest-mule.ts … --serve-only` after.
 *
 *   bun bots/quests/mule-produce.ts {botname} [--nails=N] [--bread=M]
 *       [--deliver=Jackpoo2 [--give='nails:600,bread:40,dragon longsword:10,chaos rune:500']]
 *
 *   --nails=N   bank at least N nails: steel bars from the bank smithed at the Seers' anvil
 *               (2713,3492; the Seers' bank is 15 tiles off). smithing.dbrow nails: Smithing 34,
 *               one steel bar makes two; Make 10 runs 3 ticks a bar, so a pack of 27 bars is
 *               54 nails in ~85 ticks, ~110 ticks with the bank trip.
 *   --bread=M   bank at least M bread: the Ardougne Baker's Stall (ardougne_east.inv bakery:
 *               bread 10 at 12 gp, +1 per 100 ticks, shared world-wide). The shelf is emptied
 *               first, again after the nails (it refills to 10 while away), and the rest is
 *               waited out at the stall.
 *   --deliver   walk to that mule's bank (supply.ts muleBank: Jackpoo2 at Draynor), withdraw the
 *               --give lines as notes (capped at what this bank holds), DM `quest-restock`, and
 *               trade them over; the mule (quest-mule.ts receiveRestock) banks them. Only
 *               supply.ts MULE_RESTOCKERS may restock a mule.
 *
 * Starts and ends naked at the Ardougne bank (the runner's prologue/epilogue). SIGTERM stops at
 * the next bank (q.stopRequested), and the epilogue banks the pack. Ticks, not milliseconds.
 * A task writes no run record; the finish logs "already complete" for todo-runner.
 */
import { runTask, type Quest } from './lib/run-quest';
import { tickNow, untilTicks, ticksToMs } from './lib/ticks';
import { SAFE_BANKS } from './safe-stops';
import { dmMule, muleAccount, muleBank } from './supply';
import type { BankItem } from '../../sdk/types';

const arg = (name: string) => {
    const a = process.argv.find((x) => x.startsWith(`--${name}=`));
    return a === undefined ? undefined : a.slice(name.length + 3);
};
const NAILS_TARGET = Number(arg('nails') ?? 0);
const BREAD_TARGET = Number(arg('bread') ?? 0);
const DELIVER_TO = arg('deliver');
const GIVE = (arg('give') ?? 'nails:600,bread:40,dragon longsword:10,chaos rune:500')
    .split(',')
    .map((s) => s.split(':').map((x) => x.trim()))
    .filter(([label, n]) => label && Number(n) > 0)
    .map(([label, n]) => ({ label: label!, count: Number(n) }));

const HUB = SAFE_BANKS.ardougne;
const SEERS_BANK = SAFE_BANKS.seers;
/** Stand tile beside the Seers' anvils (2712,3495 / 2713,3492 / 2714,3495). */
const SEERS_ANVIL = { x: 2713, z: 3493 };
/** Between the two Bakers (2653,3307) and (2672,3309): both trade the one shared stall. */
const BAKERY = { x: 2662, z: 3307 };

const NAILS = /^nails$/i;
const STEEL_BAR = /^steel bar$/i;
const HAMMER = /^hammer$/i;
const BREAD = /^bread$/i;
const COINS = /^coins$/i;
const ANVIL = /^anvil$/i;
/** smithing.if: the nails button is column 4, slot 3; inv_button3 is Make 10. */
const NAILS_COMPONENT = 1123;
const NAILS_SLOT = 3;
const MAKE_10 = 3;
const SMITHING_IF = 994;
const BREAD_PRICE = 12;
/** A restock wait at the stall gives up after this long with no new loaf (another buyer, a broken shop). */
const SHELF_WAIT_TICKS = 400;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const count = (q: Quest, re: RegExp) => q.sdk.getInventory().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const bankItem = (q: Quest, re: RegExp): BankItem | undefined => q.sdk.getBankItems().find((b) => re.test(b.name) && b.count > 0);
const bankCount = (q: Quest, re: RegExp) => q.sdk.getBankItems().filter((b) => re.test(b.name)).reduce((n, b) => n + b.count, 0);
const freeSlots = (q: Quest) => 28 - q.sdk.getInventory().length;

/** Last banked counts, refreshed every time the bank is open. */
const banked = { nails: 0, bread: 0, bars: 0 };
function readBank(q: Quest): void {
    banked.nails = bankCount(q, NAILS);
    banked.bread = bankCount(q, BREAD);
    banked.bars = bankCount(q, STEEL_BAR);
}

async function openBank(q: Quest): Promise<void> {
    if (!q.sdk.getState()?.bank?.isOpen) {
        const r = await q.bot.openBank();
        if (!r.success && !q.sdk.getState()?.bank?.isOpen) throw new Error(`bank did not open: ${r.message}`);
    }
    readBank(q);
}

/** Bank everything carried except what `keep` matches (bank open). */
async function depositExcept(q: Quest, keep: RegExp[]): Promise<void> {
    for (const item of q.sdk.getInventory()) {
        if (keep.some((re) => re.test(item.name))) continue;
        await q.bot.depositItem(item, -1).catch(() => undefined);
    }
    await untilTicks(q.sdk, () => q.sdk.getInventory().every((i) => keep.some((re) => re.test(i.name))), 4);
    readBank(q);
}

/** Withdraw up to `n` of a bank line (bank open); returns how many arrived. */
async function take(q: Quest, re: RegExp, n: number, asNote = false): Promise<number> {
    const line = bankItem(q, re);
    if (!line || n <= 0) return 0;
    const before = count(q, re);
    await q.bot.withdrawItem(line, Math.min(n, line.count), { asNote });
    await untilTicks(q.sdk, () => count(q, re) > before, 4);
    return count(q, re) - before;
}

// ── nails ───────────────────────────────────────────────────────────────────

/** Smith every steel bar carried into nails at the anvil beside us. Returns nails made. */
async function smithPack(q: Quest): Promise<number> {
    const { sdk, bot } = q;
    const nails0 = count(q, NAILS);
    let misses = 0;
    while (count(q, STEEL_BAR) > 0 && misses < 4) {
        await bot.dismissBlockingUI().catch(() => undefined);
        const anvil = sdk.findNearbyLoc(ANVIL);
        const bar = sdk.findInventoryItem(STEEL_BAR);
        if (!anvil || !bar) throw new Error(`smith: no ${anvil ? 'bar' : 'anvil'} at (${sdk.getState()?.player?.worldX},${sdk.getState()?.player?.worldZ})`);
        const bars0 = count(q, STEEL_BAR);
        await sdk.sendUseItemOnLoc(bar.slot, anvil.x, anvil.z, anvil.id);
        if (!(await untilTicks(sdk, (s) => !!s.interface?.isOpen && s.interface.interfaceId === SMITHING_IF, 12))) {
            misses++;
            q.log(`smith: the anvil interface did not open (miss ${misses})`);
            continue;
        }
        await sdk.sendClickComponentWithOption(NAILS_COMPONENT, MAKE_10, NAILS_SLOT);
        // smithing_anvil: 3 ticks a bar, up to 10. Done when 10 are gone, the bars run out, or
        // nothing has changed for 8 ticks (interrupted).
        const goal = bars0 - Math.min(10, bars0);
        let last = bars0;
        let lastChange = tickNow(sdk);
        while (count(q, STEEL_BAR) > goal && tickNow(sdk) - lastChange < 8) {
            await sdk.waitForTicks(1);
            const now = count(q, STEEL_BAR);
            if (now !== last) {
                last = now;
                lastChange = tickNow(sdk);
            }
        }
        // The last bar's p_delay(2) is still running: a use sent now is dropped.
        await sdk.waitForTicks(2);
        if (count(q, STEEL_BAR) < bars0) misses = 0;
        else {
            misses++;
            q.log(`smith: Make 10 used no bar (miss ${misses})`);
        }
    }
    if (count(q, STEEL_BAR) > 0) throw new Error(`smith: stuck with ${count(q, STEEL_BAR)} bars after 4 misses`);
    await bot.dismissBlockingUI().catch(() => undefined);
    return count(q, NAILS) - nails0;
}

async function makeNails(q: Quest, target: number): Promise<void> {
    await q.goTo(SEERS_BANK, 3);
    await openBank(q);
    q.log(`nails: target ${target}; ${banked.nails} nails and ${banked.bars} steel bars banked`);
    const t0 = tickNow(q.sdk);
    const start = banked.nails;
    let packs = 0;
    while (banked.nails < target && !q.stopRequested()) {
        await openBank(q);
        await depositExcept(q, [HAMMER]);
        if (count(q, HAMMER) === 0 && (await take(q, HAMMER, 1)) === 0) throw new Error('nails: no hammer in the bank');
        const bars = Math.min(freeSlots(q), Math.ceil((target - banked.nails) / 2));
        const got = await take(q, STEEL_BAR, bars);
        if (got === 0) {
            q.log(`nails: out of steel bars with ${banked.nails}/${target} nails banked`);
            break;
        }
        await q.bot.closeBank().catch(() => undefined);
        const t = tickNow(q.sdk);
        await q.goTo(SEERS_ANVIL, 1);
        await q.reach(ANVIL);
        const made = await smithPack(q);
        await q.goTo(SEERS_BANK, 3);
        await openBank(q);
        await depositExcept(q, [HAMMER]);
        packs++;
        const hours = ((tickNow(q.sdk) - t0) * 0.6) / 3600;
        q.log(`nails: pack ${packs}: ${made} nails from ${got} bars in ${tickNow(q.sdk) - t}t; ${banked.nails}/${target} banked, ${banked.bars} bars left (${hours > 0 ? Math.round((banked.nails - start) / hours) : 0}/h)`);
    }
    await depositExcept(q, []);
    await q.bot.closeBank().catch(() => undefined);
}

// ── bread ───────────────────────────────────────────────────────────────────

/**
 * Buy bread off the stall until `stillShort` is 0 or the pack is full. With `wait`, an empty
 * shelf is waited out (one loaf per 100 ticks); otherwise the run moves on. Returns loaves bought.
 */
async function buyBread(q: Quest, stillShort: () => number, wait: boolean): Promise<number> {
    const { sdk, bot } = q;
    const before = count(q, BREAD);
    await q.goTo(BAKERY, 4);
    if (!sdk.getState()?.shop?.isOpen) {
        const r = await bot.openShop(/^baker$/i);
        if (!r.success && !sdk.getState()?.shop?.isOpen) throw new Error(`bread: the stall did not open: ${r.message}`);
    }
    const stock = () => sdk.getState()?.shop?.shopItems?.find((s) => BREAD.test(s.name));
    if (!stock()) throw new Error('bread: the stall does not list bread');
    let lastLoaf = tickNow(sdk);
    let waited = 0;
    while (stillShort() > 0 && freeSlots(q) > 0 && !q.stopRequested() && sdk.getState()?.shop?.isOpen) {
        const s = stock();
        if (s && s.count > 0) {
            if (count(q, COINS) < s.buyPrice) throw new Error(`bread: out of coins (${count(q, COINS)} carried)`);
            const n = Math.min(s.count, stillShort(), freeSlots(q));
            const had = count(q, BREAD);
            const r = await bot.buyFromShop(BREAD, n);
            if (count(q, BREAD) === had) {
                q.log(`bread: buy of ${n} failed: ${r.message}`);
                await sdk.waitForTicks(2);
            } else lastLoaf = tickNow(sdk);
            continue;
        }
        if (!wait) break;
        if (tickNow(sdk) - lastLoaf > SHELF_WAIT_TICKS) {
            q.log(`bread: no restock in ${SHELF_WAIT_TICKS}t; leaving`);
            break;
        }
        const t = tickNow(sdk);
        await untilTicks(sdk, () => (stock()?.count ?? 0) > 0 || !sdk.getState()?.shop?.isOpen || q.stopRequested(), 110);
        waited += tickNow(sdk) - t;
    }
    await bot.closeShop().catch(() => undefined);
    const got = count(q, BREAD) - before;
    q.log(`bread: bought ${got}${waited ? ` (${waited}t waiting for restock)` : ''}; carrying ${count(q, BREAD)}`);
    return got;
}

/** One or more stall trips from the Ardougne bank until `target` bread is banked (or, without `wait`, the shelf is bare). */
async function makeBread(q: Quest, target: number, wait: boolean): Promise<void> {
    await q.goTo(HUB, 4);
    await openBank(q);
    q.log(`bread: target ${target}; ${banked.bread} banked${wait ? '' : ' (taking the shelf only)'}`);
    while (banked.bread < target && !q.stopRequested()) {
        await depositExcept(q, [COINS]);
        const coinsWanted = Math.min(27, target - banked.bread) * BREAD_PRICE;
        if (count(q, COINS) < coinsWanted) await take(q, COINS, coinsWanted - count(q, COINS));
        if (count(q, COINS) < BREAD_PRICE) throw new Error('bread: no coins in the bank');
        await q.bot.closeBank().catch(() => undefined);
        const got = await buyBread(q, () => target - banked.bread - count(q, BREAD), wait);
        await q.goTo(HUB, 4);
        await openBank(q);
        await depositExcept(q, []);
        q.log(`bread: ${banked.bread}/${target} banked`);
        if (got === 0 || !wait) break;
    }
    await depositExcept(q, []);
    await q.bot.closeBank().catch(() => undefined);
}

// ── delivery ────────────────────────────────────────────────────────────────

async function deliver(q: Quest, mule: string): Promise<void> {
    const { sdk, bot } = q;
    const account = muleAccount(mule);
    const at = muleBank(mule);
    await q.goTo(at, 3);
    await openBank(q);
    await depositExcept(q, []);
    const give: Array<{ item: RegExp; amount: number }> = [];
    for (const line of GIVE) {
        const re = new RegExp(`^${esc(line.label)}$`, 'i');
        // Notes: 40 bread or 10 longswords in one slot each. Runes and nails stack anyway
        // (the engine withdraws an un-notable item unnoted).
        const got = await take(q, re, line.count, true);
        if (got > 0) give.push({ item: re, amount: got });
        q.log(`deliver: ${line.label} ${got}/${line.count}${got < line.count ? ' (all this bank holds)' : ''}`);
    }
    await bot.closeBank().catch(() => undefined);
    if (give.length === 0) {
        q.log(`deliver: nothing to give ${mule}`);
        return;
    }
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok && !q.stopRequested(); attempt++) {
        await dmMule(sdk, account, 'quest-restock');
        q.log(`deliver: asked ${mule}${account !== mule ? ` (${account})` : ''} to take a restock (attempt ${attempt})`);
        // The mule banks its pack first (a few ticks), then waits in serveTrades.
        await sdk.waitForTicks(8);
        // Exact counts, never -1: with several noted stacks -1 offered nothing (2026-10-30).
        const res = await bot.trade(account, {
            give,
            want: [],
            timeout: ticksToMs(300),
            requestTimeout: ticksToMs(150),
            rejectAfterMs: ticksToMs(150),
            retryOnBusy: true,
        });
        ok = res.success;
        q.log(`deliver: trade with ${mule} ${ok ? 'ok' : `failed (${res.reason ?? res.message})`}`);
    }
    const left = give.filter((g) => count(q, g.item) > 0);
    if (ok) q.log(`deliver: ${mule} restocked: ${give.map((g) => `${g.item.source.slice(1, -1)} x${g.amount}`).join(', ')}`);
    // Whatever did not go over goes back into this bank before the walk home.
    if (left.length) {
        await openBank(q);
        await depositExcept(q, []);
        await bot.closeBank().catch(() => undefined);
    }
    if (!ok) throw new Error(`deliver: ${mule} never took the restock trade`);
}

await runTask({
    id: 'mule-produce',
    hub: 'ardougne',
    task: async (q) => {
        if (!(NAILS_TARGET >= 0 && BREAD_TARGET >= 0) || (!NAILS_TARGET && !BREAD_TARGET && !DELIVER_TO)) {
            throw new Error('usage: mule-produce.ts <bot> [--nails=N] [--bread=M] [--deliver=<mule> [--give=label:n,…]]');
        }
        const t0 = tickNow(q.sdk);
        // The shelf first (10 at once), the nails (it refills to 10 meanwhile), then the shelf
        // again and the rest waited out.
        if (BREAD_TARGET > 0) await makeBread(q, BREAD_TARGET, false);
        if (NAILS_TARGET > 0 && !q.stopRequested()) await makeNails(q, NAILS_TARGET);
        if (BREAD_TARGET > 0 && !q.stopRequested()) await makeBread(q, BREAD_TARGET, true);
        if (q.stopRequested()) {
            q.log('stop requested — banked; the epilogue takes it home');
            return;
        }
        if (NAILS_TARGET > 0 && banked.nails < NAILS_TARGET) throw new Error(`nails: ${banked.nails}/${NAILS_TARGET} banked`);
        if (BREAD_TARGET > 0 && banked.bread < BREAD_TARGET) throw new Error(`bread: ${banked.bread}/${BREAD_TARGET} banked`);
        if (DELIVER_TO) await deliver(q, DELIVER_TO);
        q.log(`mule-produce: nails ${banked.nails}, bread ${banked.bread} banked before any delivery, in ${tickNow(q.sdk) - t0}t — already complete`);
    },
});
