/**
 * Bulk Grand Exchange transfer between your own accounts.
 *
 * Dry run (default): checks the public book, reads backpacks through observe-mode
 * connections (no control taken), and prints the plan, tax and coin needs. Places nothing.
 *
 * Execute: takes control of the accounts involved and places bulk offers. The buyers' bids go
 * in first; then each seller lists its whole share of an item as one offer, which fills against
 * those bids at once. Every sale and every account runs at once. An account only does one GE or
 * bank visit at a time, so an account that is in several sales takes them in turn.
 *
 * The public book is checked before the bids and before the sells of each sale. If another
 * party is trading the same item, or the book stops matching what this run placed, that sale
 * cancels its own open offers and stops. It never retries a dispatched placement.
 * Bulk offers pay GE tax (5% of each sell's gross).
 *
 *   # bid mode: several sales at once to the same bidders, each split evenly across them
 *   bun bots/quests/ge-bulk-transfer.ts --mode=bid --price=19 --bidders=a,b,c --bank \
 *       --sale=1305@pigfat:36 --sale=1065@jackthief:36 --sale=1099@jackthief:36
 *   # a single sale can also be written --item=<id> --seller=<name> --qty=N
 *   # sell mode: every seller lists its whole stack of one item; one buyer takes it all
 *   bun bots/quests/ge-bulk-transfer.ts --mode=sell --item=<id> --price=19 --sellers=Jackpoo1,Jackpoo2 --buyer=jackthief
 *   # add --execute to place real offers
 *
 * Options:
 *   --sale=ITEM@SELLER:QTY  bid mode, repeatable, one per item. QTY is split evenly over
 *                    --bidders; when it does not divide, the bidders listed first take one extra.
 *   --qty=N          sell mode: cap total units (default: each seller's full stock).
 *   --origin=URL     game HTTP origin (default: from the first account's bot.env SERVER).
 *   --force          execute even if an account looks owned by a live process.
 *   --bank           bid mode: bidders that do not already hold their coins bank their backpack and
 *                    withdraw them, and sellers withdraw missing units, all in parallel. Bidders
 *                    far from Varrock West, or that fail or time out, are dropped and the run trades
 *                    the rest; re-run with the dropped ones. Without --execute it only reports who
 *                    is ready, who would bank, and who would be dropped.
 *
 * Run it in the foreground (pipe to `tee` if you want a file, not to `rg`, which buffers).
 * A `nohup … &` launch from an agent shell is killed when that shell call returns.
 *
 * Banknotes (item id + 1) count as stock for sellers; the GE accepts them.
 * Limits: the public API has no owners, so the guard works from this run's own ledger.
 * It cannot see a foreign offer that appears and fills within one cache window (5s).
 * Outside orders that cannot cross --price are tolerated as a fixed baseline.
 */
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { BotSDK, MarketClient, deriveGatewayUrl } from '../../sdk/index';
import type { GEOffer } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { resolveOwner } from '../../sdk/assignment';
import {
    COINS_ID,
    OpenLedger,
    bookMismatch,
    planWaves,
    preflightBook,
    summarize,
    type BulkPlanInput,
    type Leg,
    type Wave,
} from '../../sdk/ge-bulk';

const ROOT = resolve(import.meta.dir, '../..');
const INVENTORY_SLOTS = 28;
/** One lot holds a seller's whole stock, so each seller lists a single offer. */
const BULK_LOT = Number.MAX_SAFE_INTEGER;

// ---------- arguments ----------

const argv = process.argv.slice(2);

function option(name: string): string | undefined {
    const pref = `--${name}=`;
    const hit = argv.find((a) => a.startsWith(pref));
    if (hit) return hit.slice(pref.length);
    const i = argv.indexOf(`--${name}`);
    if (i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--')) return argv[i + 1];
    return undefined;
}
const flag = (name: string) => argv.includes(`--${name}`);
const list = (value: string | undefined) => (value ? value.split(',').map((s) => s.trim()).filter(Boolean) : []);

function fail(message: string): never {
    console.error(`[ge-bulk] ${message}`);
    process.exit(1);
}

function positiveInt(name: string, value: string | undefined, required: boolean): number | undefined {
    if (value === undefined) {
        if (required) fail(`--${name} is required.`);
        return undefined;
    }
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1) fail(`--${name} must be a positive whole number (got "${value}").`);
    return n;
}

// ---------- roster and credentials ----------

function rosterNames(): string[] {
    const roster = JSON.parse(readFileSync(join(ROOT, 'bots', 'roster.json'), 'utf-8')) as { bots: { name: string }[] };
    return roster.bots.map((b) => b.name);
}

function canonicalAccount(name: string, roster: string[]): string {
    const hit = roster.find((r) => r.toLowerCase() === name.toLowerCase());
    if (!hit) fail(`"${name}" is not in bots/roster.json. Only roster accounts can trade here.`);
    return hit;
}

function loadEnv(name: string): Record<string, string> {
    const path = join(ROOT, 'bots', name, 'bot.env');
    if (!existsSync(path)) fail(`bots/${name}/bot.env not found.`);
    const env: Record<string, string> = {};
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return env;
}

function originFromServer(server: string): string {
    if (/^https?:\/\//i.test(server)) return new URL(server).origin;
    const host = server.replace(/\/.*$/, '');
    if (host.startsWith('localhost') || host.startsWith('127.')) return `http://${host.includes(':') ? host : `${host}:8888`}`;
    return `https://${host}`;
}

// ---------- connections ----------

interface Client {
    name: string;
    sdk: BotSDK;
    bot: BotActions;
}

async function connect(name: string, mode: 'control' | 'observe'): Promise<Client> {
    const env = loadEnv(name);
    if (!env.PASSWORD) fail(`bots/${name}/bot.env has no PASSWORD.`);
    const sdk = new BotSDK({
        botUsername: env.BOT_USERNAME || name,
        password: env.PASSWORD!,
        gatewayUrl: deriveGatewayUrl(env.SERVER),
        autoLaunchBrowser: false,
        connectTimeout: 25_000,
        readyTimeout: 20_000,
        showChat: false,
        connectionMode: mode,
    });
    await sdk.connect();
    // inGame only turns true once a real state update has arrived, so the empty default inventory is not mistaken for a backpack.
    await sdk.waitForCondition((w) => w.inGame, 15_000);
    return { name, sdk, bot: new BotActions(sdk) };
}

function countItem(sdk: BotSDK, id: number): number {
    return sdk.getInventory().filter((i) => i.id === id).reduce((n, i) => n + i.count, 0);
}

/** Units of the item held in the backpack, noted (id + 1) or not. */
function heldUnits(sdk: BotSDK, item: number): number {
    return countItem(sdk, item) + countItem(sdk, item + 1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(message: string) {
    console.log(`[ge-bulk] ${message}`);
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

function groupByAccount(legs: Leg[]): Map<string, Leg[]> {
    const groups = new Map<string, Leg[]>();
    for (const leg of legs) groups.set(leg.account, [...(groups.get(leg.account) ?? []), leg]);
    return groups;
}

/** An account does one GE or bank visit at a time; concurrent sales queue on this. */
const locks = new Map<string, Promise<unknown>>();

function withLock<T>(account: string, work: () => Promise<T>): Promise<T> {
    const next = (locks.get(account) ?? Promise.resolve()).catch(() => undefined).then(work);
    locks.set(account, next.catch(() => undefined));
    return next;
}

const ACCOUNT_STEP_TIMEOUT_MS = 120_000;
const BANK_STEP_TIMEOUT_MS = 150_000;

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
    });
    return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/** Run one step per account in parallel, each bounded. Returns a message per failed account. */
async function eachAccount<K>(entries: [string, K][], what: string, step: (account: string, value: K) => Promise<void>): Promise<string[]> {
    const results = await Promise.allSettled(entries.map(([account, value]) => withTimeout(step(account, value), ACCOUNT_STEP_TIMEOUT_MS, `${account} ${what}`)));
    return results.flatMap((r, i) => (r.status === 'rejected' ? [`${entries[i]![0]}: ${reason(r.reason)}`] : []));
}

// ---------- execution ----------

interface BookUnits {
    buy: number;
    sell: number;
}

/** Re-read the public book until it matches this run's ledger plus the outside baseline, or give up. */
async function awaitBook(market: MarketClient, item: number, ledger: OpenLedger, external: BookUnits, timeoutMs: number, pollMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const quote = await market.item(item);
        const problem = bookMismatch(quote, { buy: ledger.open.buy + external.buy, sell: ledger.open.sell + external.sell });
        if (!problem) return;
        if (Date.now() >= deadline) throw new Error(problem);
        // The API caches quotes for 5s, so a mismatch right after our own placement may be stale.
        await sleep(pollMs);
    }
}

export interface ExecuteOptions {
    /** How long a mismatched book may take to settle (API cache is 5s). */
    bookTimeoutMs?: number;
    pollMs?: number;
    /** Outside units already on the book that cannot cross this run's price. */
    external?: BookUnits;
    /** Prefix for log lines when several sales run at once. */
    label?: string;
}

/** Runs one item's waves. Returns true when every wave matched and was collected. */
export async function execute(
    waves: Wave[],
    clients: Map<string, Client>,
    market: MarketClient,
    item: number,
    price: number,
    options: ExecuteOptions = {},
): Promise<boolean> {
    const bookTimeoutMs = options.bookTimeoutMs ?? 15_000;
    const pollMs = options.pollMs ?? 2_000;
    const external = options.external ?? { buy: 0, sell: 0 };
    const say = (message: string) => log(options.label ? `${options.label}: ${message}` : message);
    const ledger = new OpenLedger();
    const touched = new Set<string>();
    /** Offers this run placed. Cleanup only touches these, never an account's unrelated offers. */
    const placedIds = new Set<number>();
    const guard = () => awaitBook(market, item, ledger, external, bookTimeoutMs, pollMs);

    function visit<T>(account: string, work: (c: Client) => Promise<T>): Promise<T> {
        return withLock(account, async () => {
            const c = clients.get(account)!;
            const opened = await c.bot.openGE();
            if (!opened.success) throw new Error(`could not open the Grand Exchange (${opened.message})`);
            try {
                return await work(c);
            } finally {
                await c.bot.closeInterface().catch(() => undefined);
            }
        });
    }

    async function place(account: string, side: 'buy' | 'sell', legs: Leg[]): Promise<void> {
        await visit(account, async (c) => {
            for (const leg of legs) {
                touched.add(account);
                const r = await c.bot.placeGEOffer({ item, side, quantity: leg.quantity, price });
                if (!r.success || !r.offer) {
                    const unknown = r.outcome === 'unknown' ? ' Outcome unknown: inspect the exchange before retrying.' : '';
                    throw new Error(`${side} of ${leg.quantity} was not placed (${r.message}).${unknown}`);
                }
                ledger.record(side, r.offer);
                placedIds.add(r.offer.id);
                say(`  ${account} ${side} ${leg.quantity} @ ${price} -> offer #${r.offer.id} (${r.offer.filled}/${r.offer.quantity} matched)`);
            }
        });
    }

    async function collect(account: string): Promise<void> {
        await visit(account, async (c) => {
            const offers: GEOffer[] = c.sdk.getGEState()?.offers ?? [];
            for (const offer of offers) {
                if (!placedIds.has(offer.id)) continue;
                if (offer.items === 0 && offer.coins === 0) continue;
                const r = await c.bot.collectGEOffer(offer.id, false);
                if (!r.success) throw new Error(`collect of offer #${offer.id} failed (${r.message})`);
                say(`  ${account} collected offer #${offer.id}: ${r.items ?? 0} item(s), ${r.coins ?? 0} gp`);
            }
        });
    }

    async function cancelOpen(account: string): Promise<void> {
        await visit(account, async (c) => {
            for (const offer of c.sdk.getGEState()?.offers ?? []) {
                if (offer.state !== 'open' || !placedIds.has(offer.id)) continue;
                const r = await c.bot.cancelGEOffer(offer.id);
                say(`  cleanup ${account} cancelled offer #${offer.id}: ${r.success ? 'ok' : r.message}`);
            }
        });
        await collect(account);
    }

    const uncollected: string[] = [];
    try {
        for (const [i, wave] of waves.entries()) {
            const started = Date.now();
            say(`wave ${i + 1}/${waves.length}: ${wave.supply.length} sell(s), ${wave.demand.length} buy(s) at ${price}`);
            // Bids go in first and rest; the sells then fill against them on placement. A resting bid can only
            // be hit by someone selling to us at our price, never by someone buying our stock.
            await guard();
            const buyFailures = await eachAccount([...groupByAccount(wave.demand)], 'buy', (a, legs) => place(a, 'buy', legs));
            if (buyFailures.length) throw new Error(`buy placement failed: ${buyFailures.join('; ')}`);
            await guard();
            const sellFailures = await eachAccount([...groupByAccount(wave.supply)], 'sell', (a, legs) => place(a, 'sell', legs));
            if (sellFailures.length) throw new Error(`sell placement failed: ${sellFailures.join('; ')}`);
            const left = ledger.open;
            if (left.buy || left.sell) throw new Error(`wave ${i + 1} did not fully match (buy ${left.buy}, sell ${left.sell} still open).`);
            const accounts = [...new Set([...wave.supply, ...wave.demand].map((l) => l.account))];
            const collectFailures = await eachAccount(accounts.map((a) => [a, null] as [string, null]), 'collect', (a) => collect(a));
            for (const f of collectFailures) say(`WARN collect ${f}. The claim stays on the exchange; collect it later.`);
            uncollected.push(...collectFailures);
            say(`wave ${i + 1}/${waves.length} matched in ${Math.round((Date.now() - started) / 1000)}s`);
        }
        if (uncollected.length) {
            say(`done: every wave matched; ${uncollected.length} collection(s) still waiting on the exchange.`);
            process.exitCode = 1;
            return false;
        }
        say('done: every wave matched and was collected.');
        return true;
    } catch (error) {
        say(`STOPPED: ${reason(error)}`);
        say("cancelling this run's open offers and collecting what is ready...");
        const failures = await eachAccount([...touched].map((a) => [a, null] as [string, null]), 'cleanup', (a) => cancelOpen(a));
        for (const f of failures) say(`  cleanup ${f}`);
        process.exitCode = 1;
        return false;
    }
}

// ---------- planning ----------

interface Sale {
    item: number;
    seller: string;
    units: number;
}

function saleInput(sale: Sale, bidders: string[]): Extract<BulkPlanInput, { mode: 'bid' }> {
    return { mode: 'bid', seller: sale.seller, units: sale.units, bidders, lot: BULK_LOT };
}

/**
 * Bid mode plan: the seller lists the whole stock as one offer, and the bidders split it evenly
 * (each bidder takes its share as one buy). The offer pays GE tax on its gross.
 */
function bidWaves(input: Extract<BulkPlanInput, { mode: 'bid' }>): Wave[] {
    const n = Math.min(input.bidders.length, input.units);
    if (n < 1) throw new Error('bid mode needs at least one bidder and one unit.');
    const base = Math.floor(input.units / n);
    const extra = input.units % n;
    const demand: Leg[] = input.bidders.slice(0, n).map((account, i) => ({ account, quantity: base + (i < extra ? 1 : 0) }));
    return [{ supply: [{ account: input.seller, quantity: input.units }], demand }];
}

/** Units each bidder takes from one sale. */
function shares(sale: Sale, bidders: string[]): Map<string, number> {
    return new Map(bidWaves(saleInput(sale, bidders))[0]!.demand.map((leg) => [leg.account, leg.quantity]));
}

function parseSales(roster: string[]): Sale[] {
    const specs = argv.filter((a) => a.startsWith('--sale=')).map((a) => a.slice('--sale='.length));
    if (!specs.length) {
        const item = positiveInt('item', option('item'), true)!;
        const seller = canonicalAccount(option('seller') ?? fail('--seller (or --sale=ITEM@SELLER:QTY) is required in bid mode.'), roster);
        return [{ item, seller, units: positiveInt('qty', option('qty'), true)! }];
    }
    const sales = specs.map((spec) => {
        const m = /^(\d+)@([A-Za-z0-9_]+):(\d+)$/.exec(spec) ?? fail(`--sale=${spec} must look like ITEM@SELLER:QTY, e.g. --sale=1305@pigfat:36.`);
        return { item: positiveInt('sale item', m[1], true)!, seller: canonicalAccount(m[2]!, roster), units: positiveInt('sale qty', m[3], true)! };
    });
    const items = sales.map((s) => s.item);
    if (new Set(items).size !== items.length) fail('each item may appear in only one --sale (the book guard tracks one ledger per item).');
    return sales;
}

// ---------- bank step ----------

/** Open tile east of the Varrock west bank booths. Crowded booths read UNREACHABLE from the west side. */
const BANK_EAST = { x: 3195, z: 3440 };
/** Accounts further than this from Varrock West are dropped, not walked across the map. */
const BANK_RADIUS = 40;

function tilesFromBank(c: Client): number {
    const p = c.sdk.getState()?.player;
    if (!p) return Infinity;
    return Math.max(Math.abs(p.worldX - BANK_EAST.x), Math.abs(p.worldZ - BANK_EAST.z));
}

function atBank<T>(c: Client, work: () => Promise<T>): Promise<T> {
    return withLock(c.name, async () => {
        let opened = await c.bot.openBank();
        for (let attempt = 1; !opened.success && attempt <= 2; attempt++) {
            await c.bot.walkTo(BANK_EAST.x, BANK_EAST.z, 2).catch(() => undefined);
            await sleep(2_000);
            opened = await c.bot.openBank();
        }
        if (!opened.success) throw new Error(`${c.name}: could not open the bank (${opened.message}).`);
        try {
            return await work();
        } finally {
            await c.bot.closeBank().catch(() => undefined);
        }
    });
}

/**
 * Bid mode only. Every account runs at once. A bidder that already holds the coins for all its
 * buys and has room for the items skips the bank. Otherwise it banks its whole backpack and
 * withdraws those coins. Each seller withdraws any units it is short of.
 *
 * A bidder that is far from Varrock West, fails, or times out is dropped and the rest carry on.
 * Returns the bidders that are ready. A seller failure stops the run.
 */
async function prepareBank(clients: Map<string, Client>, sales: Sale[], bidders: string[], price: number, dryRun: boolean): Promise<string[]> {
    const units = new Map<string, number>();
    for (const sale of sales) for (const [a, n] of shares(sale, bidders)) units.set(a, (units.get(a) ?? 0) + n);

    async function bankBidder(account: string, wanted: number): Promise<void> {
        const c = clients.get(account)!;
        const need = wanted * price;
        const free = INVENTORY_SLOTS - c.sdk.getInventory().length;
        if (countItem(c.sdk, COINS_ID) >= need && free >= wanted) {
            log(`bank ${account}: ready (${countItem(c.sdk, COINS_ID)} coins, ${free} free slots), no bank visit`);
            return;
        }
        const away = tilesFromBank(c);
        if (away > BANK_RADIUS) {
            throw new Error(`${away} tiles from Varrock West bank`);
        }
        if (dryRun) {
            log(`bank ${account}: would bank its backpack and withdraw ${need} coins`);
            return;
        }
        log(`bank ${account}: banking backpack, withdrawing ${need} coins`);
        const started = Date.now();
        await atBank(c, async () => {
            for (let i = 0; i < INVENTORY_SLOTS + 2; i++) {
                const stack = c.sdk.getInventory().find((it) => it.count > 0);
                if (!stack) break;
                const r = await c.bot.depositItem(stack, -1);
                if (!r.success) throw new Error(`could not bank ${stack.name} (${r.message})`);
            }
            const coins = c.sdk.getBankItems().find((b) => b.id === COINS_ID);
            if (!coins || coins.count < need) throw new Error(`needs ${need} coins in the bank, has ${coins?.count ?? 0}`);
            const w = await c.bot.withdrawItem(coins, need);
            if (!w.success) throw new Error(`could not withdraw ${need} coins (${w.message})`);
            await c.sdk.waitForCondition(() => countItem(c.sdk, COINS_ID) >= need, 8_000).catch(() => undefined);
            if (countItem(c.sdk, COINS_ID) < need) throw new Error(`withdrew coins but the backpack shows ${countItem(c.sdk, COINS_ID)}`);
        });
        log(`bank ${account}: backpack banked, ${need} coins withdrawn (${Math.round((Date.now() - started) / 1000)}s)`);
    }

    async function bankSeller(sale: Sale): Promise<void> {
        const seller = clients.get(sale.seller)!;
        const short = sale.units - heldUnits(seller.sdk, sale.item);
        if (short <= 0) return;
        if (dryRun) {
            log(`bank ${sale.seller}: would withdraw ${short} of item ${sale.item} from its bank`);
            return;
        }
        await atBank(seller, async () => {
            const bank = seller.sdk.getBankItems();
            const stock = [sale.item, sale.item + 1].map((id) => bank.find((b) => b.id === id && b.count >= short)).find((b) => b !== undefined);
            const total = bank.filter((b) => b.id === sale.item || b.id === sale.item + 1).reduce((n, b) => n + b.count, 0);
            if (!stock) throw new Error(`${sale.seller}: needs ${short} more of item ${sale.item} in the bank, has ${total}.`);
            const w = await seller.bot.withdrawItem(stock, short);
            if (!w.success) throw new Error(`${sale.seller}: could not withdraw ${short} of item ${sale.item} (${w.message}).`);
            await seller.sdk.waitForCondition(() => heldUnits(seller.sdk, sale.item) >= sale.units, 8_000).catch(() => undefined);
        });
        log(`bank ${sale.seller}: ${short} of item ${sale.item} withdrawn, backpack now holds ${heldUnits(seller.sdk, sale.item)}`);
    }

    const wanted = bidders.filter((b) => (units.get(b) ?? 0) > 0);
    const [sellerResults, bidderResults] = await Promise.all([
        Promise.allSettled(sales.map((sale) => withTimeout(bankSeller(sale), BANK_STEP_TIMEOUT_MS, `${sale.seller} bank step`))),
        Promise.allSettled(wanted.map((b) => withTimeout(bankBidder(b, units.get(b)!), BANK_STEP_TIMEOUT_MS, 'bank step'))),
    ]);
    const sellerFailure = sellerResults.find((r) => r.status === 'rejected');
    if (sellerFailure) throw (sellerFailure as PromiseRejectedResult).reason;

    const ready: string[] = [];
    bidderResults.forEach((r, i) => {
        if (r.status === 'fulfilled') ready.push(wanted[i]!);
        else log(`WARN bank ${wanted[i]}: dropped from this run (${reason(r.reason)})`);
    });
    return ready;
}

// ---------- main ----------

interface ItemPlan {
    item: number;
    label: string;
    waves: Wave[];
}

async function main(): Promise<void> {
    const roster = rosterNames();
    const price = positiveInt('price', option('price'), true)!;
    for (const removed of ['lot', 'one-offer', 'allow-tax']) {
        if (flag(removed) || option(removed) !== undefined) fail(`--${removed} was removed: every sale is one bulk offer per seller.`);
    }
    const mode = option('mode');
    if (mode !== 'sell' && mode !== 'bid') fail('--mode must be "sell" (sellers to one buyer) or "bid" (sellers to many bidders).');
    const execute_ = flag('execute');
    /** A dry run with --bank plans as if the bank step has already run. */
    const bankDry = flag('bank') && !execute_;
    initPathfinding();

    let sales: Sale[] = [];
    let bidders: string[] = [];
    let sellInput: Extract<BulkPlanInput, { mode: 'sell' }> | null = null;
    let sellItem = 0;
    let accounts: string[];
    if (mode === 'sell') {
        if (argv.some((a) => a.startsWith('--sale'))) fail('--sale is for bid mode.');
        if (flag('bank')) fail('--bank only supports bid mode.');
        sellItem = positiveInt('item', option('item'), true)!;
        const sellers = list(option('sellers')).map((n) => canonicalAccount(n, roster));
        const buyer = canonicalAccount(option('buyer') ?? fail('--buyer is required in sell mode.'), roster);
        if (!sellers.length) fail('--sellers is required in sell mode.');
        sellInput = { mode: 'sell', sellers: sellers.map((name) => ({ name, units: 0 })), buyer, lot: BULK_LOT };
        accounts = [...sellers, buyer];
    } else {
        sales = parseSales(roster);
        bidders = [...new Set(list(option('bidders')).map((n) => canonicalAccount(n, roster)))];
        if (!bidders.length) fail('--bidders is required in bid mode.');
        for (const sale of sales) if (bidders.includes(sale.seller)) fail(`${sale.seller} sells item ${sale.item} and cannot also bid on it.`);
        accounts = [...sales.map((s) => s.seller), ...bidders];
    }
    accounts = [...new Set(accounts)];

    const origin = option('origin') ?? originFromServer(loadEnv(accounts[0]!).SERVER || process.env.SERVER || 'rs-sdk-demo.fly.dev');
    const market = new MarketClient(origin);
    const status = await market.status();
    if (!status.enabled) fail(status.message ?? 'Grand Exchange is not available on this server.');

    const items = mode === 'sell' ? [sellItem] : sales.map((s) => s.item);
    const external = new Map<number, BookUnits>();
    const names = new Map<number, string>();
    for (const item of items) {
        const quote = await market.item(item);
        names.set(item, quote.name);
        log(`item ${item}: ${quote.name}  (bid ${quote.bid ?? '-'}, ask ${quote.ask ?? '-'}, buy units ${quote.buyQuantity}, sell units ${quote.sellQuantity})`);
        const blocked = preflightBook(quote);
        if (!blocked) {
            external.set(item, { buy: 0, sell: 0 });
            continue;
        }
        // Outside orders that cannot cross our price (every outside bid below ours, every outside ask above ours)
        // cannot fill this run. Their units are subtracted from the book guard as a baseline.
        const cannotCross = (quote.bid === null || quote.bid < price) && (quote.ask === null || quote.ask > price);
        if (!cannotCross) fail(`${quote.name}: ${blocked}`);
        external.set(item, { buy: quote.buyQuantity, sell: quote.sellQuantity });
        log(`  outside orders cannot cross ${price} gp; tolerated as a baseline (not ours).`);
    }

    if (execute_) {
        for (const name of accounts) {
            const owner = resolveOwner(name, null);
            if (owner && !flag('force')) {
                fail(`${name} is already controlled by pid ${owner.pid} (${owner.command}). Stop that job first (see .cursor/skills/wake-fleet/SKILL.md) or pass --force.`);
            }
        }
    }

    const clients = new Map<string, Client>();
    try {
        const connected = await Promise.allSettled(
            accounts.map(async (name, i) => {
                await sleep(i * 250);
                clients.set(name, await connect(name, execute_ ? 'control' : 'observe'));
            }),
        );
        const unconnected = connected.flatMap((r, i) => (r.status === 'rejected' ? [`${accounts[i]} (${reason(r.reason)})`] : []));
        if (unconnected.length) throw new Error(`could not connect: ${unconnected.join(', ')}`);
        log(`connected ${clients.size} account(s) in ${execute_ ? 'control' : 'observe'} mode`);
        // Sellers (and a sell-mode buyer) cannot be dropped, so a far one stops the run before anything is banked.
        const anchors = mode === 'sell' ? accounts : [...new Set(sales.map((s) => s.seller))];
        const far = anchors.filter((name) => tilesFromBank(clients.get(name)!) > BANK_RADIUS);
        if (far.length) {
            fail(`${far.map((n) => `${n} (${tilesFromBank(clients.get(n)!)} tiles)`).join(', ')} not at Varrock West. Walk first: bun bots/quests/walk-to-varrock-east.ts --west --only ${far.join(' ')}`);
        }

        const plans: ItemPlan[] = [];
        if (mode === 'sell') {
            let remaining = positiveInt('qty', option('qty'), false) ?? Infinity;
            for (const seller of sellInput!.sellers) {
                const have = heldUnits(clients.get(seller.name)!.sdk, sellItem);
                seller.units = Math.min(have, remaining);
                remaining -= seller.units;
                log(`seller ${seller.name}: ${have} in backpack, selling ${seller.units}`);
            }
            plans.push({ item: sellItem, label: names.get(sellItem)!, waves: planWaves(sellInput!) });
        } else {
            if (flag('bank')) {
                if (bankDry) log('--bank: dry run, so nothing is banked. The plan below assumes the bank step has run.');
                const before = sales.map((sale) => shares(sale, bidders));
                const ready = await prepareBank(clients, sales, bidders, price, bankDry);
                if (!ready.length) fail('no bidder is ready; nothing to trade.');
                const dropped = bidders.filter((b) => !ready.includes(b));
                if (dropped.length) {
                    sales = sales.map((sale, i) => ({ ...sale, units: ready.reduce((n, a) => n + (before[i]!.get(a) ?? 0), 0) })).filter((s) => s.units > 0);
                    log(`WARN ${ready.length}/${bidders.length} bidders ready. Walk the far ones (bun bots/quests/walk-to-varrock-east.ts --west --only ${dropped.join(' ')}), then re-run with --bidders=${dropped.join(',')}`);
                    // Release dropped bidders so another controller (a walk back to the bank) can take them now.
                    for (const name of dropped) {
                        await clients.get(name)?.sdk.disconnect().catch(() => undefined);
                        clients.delete(name);
                    }
                    bidders = bidders.filter((b) => ready.includes(b));
                }
            }
            for (const sale of sales) {
                const have = heldUnits(clients.get(sale.seller)!.sdk, sale.item);
                log(`seller ${sale.seller}: ${have} ${names.get(sale.item)} in backpack, sells ${sale.units}`);
                if (have < sale.units && !bankDry) fail(`${sale.seller} has ${have} ${names.get(sale.item)} in its backpack; the sale needs ${sale.units}. Add --bank.`);
                plans.push({ item: sale.item, label: names.get(sale.item)!, waves: bidWaves(saleInput(sale, bidders)) });
            }
        }

        const coinsNeeded = new Map<string, number>();
        const received = new Map<string, number>();
        for (const plan of plans) {
            const s = summarize(plan.waves, price);
            log(`plan ${plan.label}: ${s.units} unit(s) in ${s.offers} sell offer(s) at ${price} gp; GE tax ${s.tax} gp; proceeds ${[...s.proceeds].map(([a, g]) => `${a} ${g} gp`).join(', ')}`);
            for (const [i, wave] of plan.waves.entries()) {
                const sells = wave.supply.map((l) => `${l.account} x${l.quantity}`).join(', ');
                const buys = wave.demand.map((l) => `${l.account} x${l.quantity}`).join(', ');
                log(`  wave ${i + 1}: sell [${sells}]  buy [${buys}]`);
            }
            for (const [a, n] of s.coinsNeeded) coinsNeeded.set(a, (coinsNeeded.get(a) ?? 0) + n);
            for (const wave of plan.waves) for (const leg of wave.demand) received.set(leg.account, (received.get(leg.account) ?? 0) + leg.quantity);
        }
        const coins = (name: string) => countItem(clients.get(name)!.sdk, COINS_ID);
        const short = [...coinsNeeded].filter(([account, need]) => coins(account) < need);
        if (short.length && !bankDry) fail(`not enough coins in the backpack: ${short.map(([a, need]) => `${a} ${coins(a)}/${need}`).join(', ')}. Add --bank.`);
        log(`coins: ${[...coinsNeeded].map(([a, need]) => `${a} ${coins(a)}/${need}`).join(', ')}`);
        for (const [account, n] of received) {
            const free = INVENTORY_SLOTS - clients.get(account)!.sdk.getInventory().length;
            if (n > free) log(`warning: ${account} may not have room for ${n} item(s) (${free} free slots); unstackable items need one slot each.`);
        }

        if (!execute_) {
            log('dry run: nothing was placed. Add --execute to run this plan.');
            return;
        }
        const label = plans.length > 1;
        const results = await Promise.all(
            plans.map((p) => execute(p.waves, clients, market, p.item, price, { external: external.get(p.item), label: label ? p.label : undefined })),
        );
        log(results.every(Boolean) ? 'all sales done.' : `finished: ${results.filter(Boolean).length}/${results.length} sales completed; see STOPPED / WARN lines above.`);
    } finally {
        await Promise.all([...clients.values()].map((c) => c.sdk.disconnect().catch(() => undefined)));
    }
}

if (import.meta.main) {
    main().catch((error) => {
        console.error(`[ge-bulk] ${reason(error)}`);
        process.exit(1);
    });
}
