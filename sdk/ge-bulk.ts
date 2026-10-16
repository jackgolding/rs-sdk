/**
 * Bulk Grand Exchange transfers between your own accounts: pure planning and
 * guards. The game driver lives in bots/quests/ge-bulk-transfer.ts. Everything
 * here is deterministic so it can be tested without a game connection.
 *
 * Tax: the server takes floor(cumulative gross / 20) from each sell offer
 * (5%), counted per offer. A sell offer that grosses under 20 gp pays nothing,
 * so a single item at 19 gp is tax-free while 20 items in one offer pay 19 gp.
 *
 * Book guard: the public API aggregates buy and sell quantities without owners.
 * The run keeps a ledger of the units its own accounts have open. Whenever the
 * book disagrees with that ledger, another party is trading on the same item
 * (or the run is out of step), and placements stop.
 */
import type { MarketQuote } from './market';

/** Offer slots per account; the GE has six. */
export const GE_SLOTS = 6;
/** Tax divisor: floor(gross / 20) is 5% of gross on a sell offer. */
export const GE_TAX_DIVISOR = 20;
/** Coins item ID. */
export const COINS_ID = 995;

/** Coins a sell offer of `quantity` at `price` loses to tax when it fully fills at once. */
export function offerTax(quantity: number, price: number): number {
    return Math.floor((quantity * price) / GE_TAX_DIVISOR);
}

/** Split `units` into lots of at most `lot` units; the last lot may be smaller. */
export function lotSizes(units: number, lot: number): number[] {
    if (!Number.isSafeInteger(units) || units < 1) throw new Error(`Units must be a positive whole number (got ${units}).`);
    if (!Number.isSafeInteger(lot) || lot < 1) throw new Error(`Lot size must be a positive whole number (got ${lot}).`);
    const sizes: number[] = [];
    for (let left = units; left > 0; left -= lot) sizes.push(Math.min(lot, left));
    return sizes;
}

/** One offer placed by one account. */
export interface Leg {
    account: string;
    quantity: number;
}

/**
 * One wave: `supply` legs are sell offers, `demand` legs are the matching buy
 * offers placed after them. Every demand leg matches one supply leg at the
 * same price, so a wave fully settles before the next one starts.
 */
export interface Wave {
    supply: Leg[];
    demand: Leg[];
}

export type BulkPlanInput =
    | {
          /** Each seller sells its own stock to one buyer. */
          mode: 'sell';
          sellers: { name: string; units: number }[];
          buyer: string;
          lot: number;
      }
    | {
          /** One account sells and each bidder buys a lot. */
          mode: 'bid';
          seller: string;
          units: number;
          bidders: string[];
          lot: number;
      };

/**
 * Build the wave schedule. Sell mode: each wave takes up to six sellers with
 * stock left, and the buyer places one buy per seller (the buyer's six slots
 * are the limit). Bid mode: the seller lists up to six lots, and each bidder
 * takes one lot, cycling through the bidder list.
 */
export function planWaves(input: BulkPlanInput): Wave[] {
    const waves: Wave[] = [];
    if (input.mode === 'sell') {
        if (!input.buyer) throw new Error('Sell mode needs a buyer.');
        if (input.sellers.some((s) => s.name === input.buyer)) throw new Error('A seller cannot also be the buyer; the exchange does not match an account against itself.');
        const queues = input.sellers.filter((s) => s.units > 0).map((s) => ({ name: s.name, lots: lotSizes(s.units, input.lot) }));
        if (!queues.length) throw new Error('No seller has any stock to sell.');
        while (queues.some((q) => q.lots.length)) {
            const active = queues.filter((q) => q.lots.length).slice(0, GE_SLOTS);
            const supply = active.map((q) => ({ account: q.name, quantity: q.lots.shift()! }));
            waves.push({ supply, demand: supply.map((leg) => ({ account: input.buyer, quantity: leg.quantity })) });
        }
    } else {
        if (!input.bidders.length) throw new Error('Bid mode needs at least one bidder.');
        if (input.bidders.includes(input.seller)) throw new Error('The seller cannot also be a bidder; the exchange does not match an account against itself.');
        if (new Set(input.bidders).size !== input.bidders.length) throw new Error('Each bidder must be listed once.');
        const lots = lotSizes(input.units, input.lot);
        let cursor = 0;
        while (lots.length) {
            const count = Math.min(GE_SLOTS, input.bidders.length, lots.length);
            const sizes = lots.splice(0, count);
            const supply = sizes.map((quantity) => ({ account: input.seller, quantity }));
            const demand = sizes.map((quantity, i) => ({ account: input.bidders[(cursor + i) % input.bidders.length]!, quantity }));
            cursor = (cursor + count) % input.bidders.length;
            waves.push({ supply, demand });
        }
    }
    assertWaves(waves);
    return waves;
}

/** Structural checks any schedule must pass before it touches the game. */
export function assertWaves(waves: Wave[]): void {
    for (const [i, wave] of waves.entries()) {
        const supplyCounts = countBy(wave.supply.map((l) => l.account));
        const demandCounts = countBy(wave.demand.map((l) => l.account));
        for (const [account, n] of [...supplyCounts, ...demandCounts]) {
            if (n > GE_SLOTS) throw new Error(`Wave ${i + 1}: ${account} needs ${n} offer slots; the GE has ${GE_SLOTS}.`);
        }
        for (const account of supplyCounts.keys()) {
            if (demandCounts.has(account)) throw new Error(`Wave ${i + 1}: ${account} is both buyer and seller in one wave.`);
        }
        if (wave.supply.length !== wave.demand.length) throw new Error(`Wave ${i + 1}: every sell needs one matching buy.`);
        const supplyUnits = wave.supply.reduce((n, l) => n + l.quantity, 0);
        const demandUnits = wave.demand.reduce((n, l) => n + l.quantity, 0);
        if (supplyUnits !== demandUnits) throw new Error(`Wave ${i + 1}: ${supplyUnits} units offered but ${demandUnits} bought.`);
    }
}

function countBy(values: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    return counts;
}

export interface PlanSummary {
    units: number;
    offers: number;
    waves: number;
    /** Total GE tax on the sell side, in coins. Zero when every sell offer grosses under 20 gp. */
    tax: number;
    /** Coins each buying account must hold before the run starts. */
    coinsNeeded: Map<string, number>;
    /** Coins each selling account receives after tax. */
    proceeds: Map<string, number>;
}

export function summarize(waves: Wave[], price: number): PlanSummary {
    const coinsNeeded = new Map<string, number>();
    const proceeds = new Map<string, number>();
    let units = 0;
    let tax = 0;
    let offers = 0;
    for (const wave of waves) {
        for (const leg of wave.demand) coinsNeeded.set(leg.account, (coinsNeeded.get(leg.account) ?? 0) + leg.quantity * price);
        for (const leg of wave.supply) {
            const legTax = offerTax(leg.quantity, price);
            tax += legTax;
            units += leg.quantity;
            offers++;
            proceeds.set(leg.account, (proceeds.get(leg.account) ?? 0) + leg.quantity * price - legTax);
        }
    }
    return { units, offers, waves: waves.length, tax, coinsNeeded, proceeds };
}

/** Units this run currently has resting on the book, by side. */
export interface OpenUnits {
    buy: number;
    sell: number;
}

/**
 * Accounting for the offers this run placed. Each placement's unfilled remainder
 * rests on its own side. Fills consume the opposite side: a sell that filled
 * against our buys removes that many buy units, and vice versa.
 */
export class OpenLedger {
    buy = 0;
    sell = 0;

    record(side: 'buy' | 'sell', offer: { remaining: number; filled: number }): void {
        if (side === 'sell') {
            this.sell += offer.remaining;
            this.buy -= offer.filled;
        } else {
            this.buy += offer.remaining;
            this.sell -= offer.filled;
        }
        if (this.buy < 0 || this.sell < 0) throw new Error(`Ledger went negative (buy ${this.buy}, sell ${this.sell}); the book does not match this run.`);
    }

    /** Units this run has open, which the book should show exactly. */
    get open(): OpenUnits {
        return { buy: this.buy, sell: this.sell };
    }
}

/**
 * Before the run places anything: the item must have no open offers at all. Any
 * open buy would take our sells; any open sell would fill our buys with someone
 * else's stock.
 */
export function preflightBook(quote: Pick<MarketQuote, 'buyQuantity' | 'sellQuantity'>): string | null {
    if (quote.buyQuantity === 0 && quote.sellQuantity === 0) return null;
    return `Open offers already exist (${quote.buyQuantity} buy, ${quote.sellQuantity} sell units). Refusing: someone could take or fill these items.`;
}

/**
 * During the run the book should show exactly the units this run has open. More
 * buying than that means someone else is in the market. Less means fills happened
 * that this run did not record. Either way, stop placing.
 */
export function bookMismatch(quote: Pick<MarketQuote, 'buyQuantity' | 'sellQuantity'>, ours: OpenUnits): string | null {
    if (quote.buyQuantity > ours.buy) return `Someone else is buying: ${quote.buyQuantity - ours.buy} buy unit(s) are open that this run did not place. Stopping.`;
    if (quote.sellQuantity > ours.sell) return `Someone else is selling: ${quote.sellQuantity - ours.sell} sell unit(s) are open that this run did not place. Stopping.`;
    if (quote.buyQuantity < ours.buy || quote.sellQuantity < ours.sell)
        return `The book shows fewer units than this run has open (buy ${quote.buyQuantity}/${ours.buy}, sell ${quote.sellQuantity}/${ours.sell}). Stopping; fills are not being recorded.`;
    return null;
}
