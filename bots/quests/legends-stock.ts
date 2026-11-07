/**
 * Legends' Quest stock run: bank the lines no shop sells and the fleet has none of (cut opal, jade,
 * red topaz, lockpicks, unpowered orbs), made by their lib/sources.ts recipes
 * (lib/legends-supplies.ts), then optionally trade them to the mule. A run-once task: queue it as a
 * todo.json item.
 *
 *   bun bots/quests/legends-stock.ts {botname} [--deliver=jackthief]
 *       [--counts='opal:3,jade:3,red topaz:3,lockpick:3,unpowered orb:3']
 *
 *   --counts   bank at least this many of each (what the bank already holds counts). Any item with
 *              a source recipe works ('molten glass:5'); toadflax has none (Agility Arena tickets).
 *   --deliver  walk to that mule's bank (supply.ts muleBank: jackthief at Ardougne), withdraw the
 *              --counts lines as notes (capped at what this bank holds), DM `quest-restock`, and
 *              trade them over; the mule (quest-mule.ts receiveRestock) banks them. The account
 *              must be in supply.ts MULE_RESTOCKERS or the roster. Skipped when this account is
 *              that mule.
 *
 * Trips, each from and back to the Ardougne bank, naked in between:
 *   gems      Brimhaven boat, Shilo Village's gem rocks (Shilo Village done, Mining 40, Crafting 16
 *             for red topaz / 13 jade), chisel and pickaxe from the bank. Spare uncut sapphires and
 *             better come home too.
 *   lockpick  the Yanille dungeon spider room's spawn (one per visit, 100t respawn).
 *   glass     Entrana by the Port Sarim monks (only buckets go; Crafting 46 for orbs).
 *
 * SIGTERM stops at the next trip boundary (q.stopRequested); the epilogue banks the pack. Ticks,
 * not milliseconds. A task writes no run record; the finish logs "already complete" for todo-runner.
 */
import { runTask, type Quest } from './lib/run-quest';
import { tickNow, ticksToMs, untilTicks } from './lib/ticks';
import { GROUPS, SOURCES, itemPattern } from './lib/sources';
import { SAFE_BANKS } from './safe-stops';
import { dmMule, muleAccount, muleBank } from './supply';
import type { BankItem } from '../../sdk/types';

const arg = (name: string) => {
    const a = process.argv.find((x) => x.startsWith(`--${name}=`));
    return a === undefined ? undefined : a.slice(name.length + 3);
};
const BOT = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const DELIVER_TO = arg('deliver');
const COUNTS = (arg('counts') ?? 'opal:3,jade:3,red topaz:3,lockpick:3,unpowered orb:3')
    .split(',')
    .map((s) => s.split(':').map((x) => x.trim()))
    .filter(([label, n]) => label && Number(n) > 0)
    .map(([label, n]) => ({ item: label!.toLowerCase(), count: Number(n) }));

const HUB = SAFE_BANKS.ardougne;

/** Trip groups, in run order; anything else asked for is its own trip. */
const TRIPS: Array<{ name: string; items: string[]; kit: (q: Quest, need: Map<string, number>) => Array<{ item: string | RegExp; count: number; group?: string }> }> = [
    {
        name: 'gems',
        items: ['opal', 'jade', 'red topaz'],
        // The Brimhaven boat both ways (30gp each), a chisel, the best pickaxe the account can use.
        kit: () => [
            { item: 'coins', count: 200 },
            { item: 'chisel', count: 1 },
            { item: 'pickaxe', count: 1, group: 'pickaxe' },
            { item: /^(shark|swordfish|lobster)$/i, count: 4 },
        ],
    },
    {
        name: 'lockpick',
        items: ['lockpick'],
        // A knife cuts the webs round the west staircase.
        kit: () => [
            { item: 'knife', count: 1 },
            { item: /^(shark|swordfish|lobster)$/i, count: 4 },
        ],
    },
    {
        name: 'glass',
        items: ['unpowered orb', 'molten glass'],
        kit: (_q, need) => [
            { item: 'bucket', count: (need.get('molten glass') ?? 0) + (need.get('unpowered orb') ?? 0) },
            { item: 'glassblowing pipe', count: need.get('unpowered orb') ? 1 : 0 },
            { item: 'coins', count: 100 },
        ],
    },
];

const bankCount = (q: Quest, re: RegExp) => q.sdk.getBankItems().filter((b) => re.test(b.name)).reduce((n, b) => n + b.count, 0);
const bankItem = (q: Quest, re: RegExp): BankItem | undefined => q.sdk.getBankItems().find((b) => re.test(b.name) && b.count > 0);
const held = (q: Quest, re: RegExp) => q.sdk.getInventory().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
/** Uncut gems: the gem trip's bonus, banked and reported. */
const UNCUT = /^uncut /i;

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

/** Banked count of every asked line (bank open). */
function banked(q: Quest): Map<string, number> {
    return new Map(COUNTS.map((c) => [c.item, bankCount(q, itemPattern(c.item))]));
}

async function runTrip(q: Quest, trip: (typeof TRIPS)[number], need: Map<string, number>): Promise<void> {
    await q.goTo(HUB, 4);
    await openBank(q);
    await depositAll(q);
    for (const k of trip.kit(q, need)) {
        if (k.count <= 0) continue;
        if (k.group) {
            const usable = GROUPS[k.group]!.filter((m) => q.level(m.skill) >= m.level).map((m) => itemPattern(m.item));
            const re = usable.find((p) => bankItem(q, p));
            if (re) await take(q, re, 1);
            continue;
        }
        const re = typeof k.item === 'string' ? itemPattern(k.item) : k.item;
        const got = await take(q, re, k.count);
        if (got < k.count && typeof k.item === 'string') q.log(`${trip.name}: ${got}/${k.count} ${k.item} from the bank (the source buys or finds the rest)`);
    }
    await q.bot.closeBank().catch(() => undefined);
    const t0 = tickNow(q.sdk);
    for (const item of trip.items) {
        const n = need.get(item) ?? 0;
        if (n <= 0 || q.stopRequested()) continue;
        const ti = tickNow(q.sdk);
        try {
            await q.ensure(item, n);
            q.log(`${trip.name}: ${item} ${q.count(item)}/${n} in ${tickNow(q.sdk) - ti}t`);
        } catch (err) {
            q.log(`${trip.name}: ${item} failed after ${tickNow(q.sdk) - ti}t: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    const bonus = q.sdk.getInventory().filter((i) => UNCUT.test(i.name)).map((i) => i.name);
    await q.goTo(HUB, 4);
    await openBank(q);
    await depositAll(q);
    q.log(`${trip.name}: trip done in ${tickNow(q.sdk) - t0}t${bonus.length ? `; banked ${bonus.join(', ')}` : ''}`);
}

async function deliver(q: Quest, mule: string): Promise<void> {
    const { sdk, bot } = q;
    const account = muleAccount(mule);
    await q.goTo(muleBank(mule), 3);
    await openBank(q);
    await depositAll(q);
    const give: Array<{ item: RegExp; amount: number }> = [];
    for (const line of COUNTS) {
        const re = itemPattern(line.item);
        const got = await take(q, re, line.count, true);
        if (got > 0) give.push({ item: re, amount: got });
        q.log(`deliver: ${line.item} ${got}/${line.count}${got < line.count ? ' (all this bank holds)' : ''}`);
    }
    await bot.closeBank().catch(() => undefined);
    if (give.length === 0) return void q.log(`deliver: nothing to give ${mule}`);
    let ok = false;
    // The mule serves one account at a time: a busy mule is waited out.
    for (let attempt = 1; attempt <= 10 && !ok && !q.stopRequested(); attempt++) {
        if (attempt > 1) await sdk.waitForTicks(40);
        await dmMule(sdk, account, 'quest-restock');
        q.log(`deliver: asked ${mule}${account !== mule ? ` (${account})` : ''} to take a restock (attempt ${attempt})`);
        await sdk.waitForTicks(8);
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
    if (ok) q.log(`deliver: ${mule} restocked: ${give.map((g) => `${g.item.source.slice(1, -1)} x${g.amount}`).join(', ')}`);
    if (give.some((g) => held(q, g.item) > 0)) {
        await openBank(q);
        await depositAll(q);
        await bot.closeBank().catch(() => undefined);
    }
    if (!ok) throw new Error(`deliver: ${mule} never took the restock trade`);
}

await runTask({
    id: 'legends-stock',
    hub: 'ardougne',
    task: async (q) => {
        if (COUNTS.length === 0) throw new Error("usage: legends-stock.ts <bot> [--deliver=<mule>] [--counts='opal:3,lockpick:3,…']");
        const unmade = COUNTS.filter((c) => !SOURCES[c.item]?.get || SOURCES[c.item]?.mule);
        if (unmade.length) throw new Error(`no source recipe for ${unmade.map((c) => c.item).join(', ')}`);
        // Made here for the mule, so never asked of it.
        q.noMuleFor = new Set(COUNTS.map((c) => c.item));
        const t0 = tickNow(q.sdk);
        await q.goTo(HUB, 4);
        await openBank(q);
        await depositAll(q);
        const start = banked(q);
        q.log(`legends-stock: banked ${COUNTS.map((c) => `${c.item} ${start.get(c.item)}/${c.count}`).join(', ')}`);
        const trips = [...TRIPS, ...COUNTS.filter((c) => !TRIPS.some((t) => t.items.includes(c.item))).map((c) => ({ name: c.item, items: [c.item], kit: () => [] }))];
        for (const trip of trips) {
            if (q.stopRequested()) break;
            await openBank(q);
            const have = banked(q);
            const need = new Map(COUNTS.filter((c) => trip.items.includes(c.item)).map((c) => [c.item, Math.max(0, c.count - (have.get(c.item) ?? 0))]));
            if (![...need.values()].some((n) => n > 0)) continue;
            q.log(`legends-stock: ${trip.name} trip for ${[...need].filter(([, n]) => n > 0).map(([i, n]) => `${n} ${i}`).join(', ')}`);
            await runTrip(q, trip, need);
        }
        await openBank(q);
        const end = banked(q);
        await q.bot.closeBank().catch(() => undefined);
        const short = COUNTS.filter((c) => (end.get(c.item) ?? 0) < c.count);
        q.log(`legends-stock: banked ${COUNTS.map((c) => `${c.item} ${end.get(c.item)}/${c.count} (+${(end.get(c.item) ?? 0) - (start.get(c.item) ?? 0)})`).join(', ')} in ${tickNow(q.sdk) - t0}t`);
        if (q.stopRequested()) return void q.log('stop requested — banked; the epilogue takes it home');
        if (DELIVER_TO && muleAccount(DELIVER_TO).toLowerCase() !== BOT.toLowerCase()) await deliver(q, DELIVER_TO);
        else if (DELIVER_TO) q.log(`deliver: this account is ${DELIVER_TO}: the stock is already in its bank`);
        if (short.length) throw new Error(`legends-stock: short ${short.map((c) => `${c.item} ${end.get(c.item)}/${c.count}`).join(', ')}`);
        q.log('legends-stock: already complete');
    },
});
