import { afterEach, describe, expect, test } from 'bun:test';
import { execute } from '../../bots/quests/ge-bulk-transfer';
import { offerTax, planWaves } from '../ge-bulk';

/**
 * A tiny in-memory exchange. It matches buys against resting sells first-in first-out
 * and tracks each account's claims, which is enough to drive the wave runner without
 * a game connection. `foreignBuy` simulates another trader's bid appearing on the book.
 */
function fakeExchange(price: number) {
    let nextId = 1;
    let foreignBuy = 0;
    const offers: any[] = [];
    const cancelled: number[] = [];
    const placed: string[] = [];

    const open = (item: number, side: string) => offers.filter((o) => o.item === item && o.side === side && o.state === 'open');
    const book = (item: number) => ({
        buyQuantity: open(item, 'buy').reduce((n, o) => n + o.remaining, 0) + (item === 569 ? foreignBuy : 0),
        sellQuantity: open(item, 'sell').reduce((n, o) => n + o.remaining, 0),
    });

    const market = {
        async item(item: number) {
            return { id: item, name: `item ${item}`, ...book(item) };
        },
    };

    function clientFor(name: string) {
        const sdk = {
            getGEState: () => ({ offers: offers.filter((o) => o.owner === name) }),
        };
        const bot = {
            async openGE() {
                return { success: true, message: 'open' };
            },
            async closeInterface() {
                return { success: true, message: 'closed' };
            },
            async placeGEOffer({ item, side, quantity }: { item: number; side: 'buy' | 'sell'; quantity: number }) {
                placed.push(`${name}:${side}`);
                const offer: any = { id: nextId++, item, owner: name, side, quantity, price, remaining: quantity, filled: 0, state: 'open', items: 0, coins: 0, tax: 0 };
                offers.push(offer);
                const other = side === 'buy' ? 'sell' : 'buy';
                for (const resting of open(item, other).filter((o) => o.owner !== name && o !== offer)) {
                    if (!offer.remaining) break;
                    const n = Math.min(offer.remaining, resting.remaining);
                    const tax = offerTax(n, price);
                    const [sell, buy] = side === 'sell' ? [offer, resting] : [resting, offer];
                    for (const o of [sell, buy]) {
                        o.remaining -= n;
                        o.filled += n;
                        if (!o.remaining) o.state = 'completed';
                    }
                    sell.coins += n * price - tax;
                    sell.tax += tax;
                    buy.items += n;
                }
                return { success: true, message: 'placed', offer: { ...offer } };
            },
            async collectGEOffer(id: number) {
                const offer = offers.find((o) => o.id === id);
                const claimed = { items: offer.items, coins: offer.coins };
                offer.items = 0;
                offer.coins = 0;
                if (offer.state !== 'open') offers.splice(offers.indexOf(offer), 1);
                return { success: true, message: 'collected', ...claimed };
            },
            async cancelGEOffer(id: number) {
                const offer = offers.find((o) => o.id === id);
                cancelled.push(id);
                offer.remaining = 0;
                offer.state = 'cancelled';
                return { success: true, message: 'cancelled' };
            },
        };
        return { name, sdk, bot } as any;
    }

    return {
        market: market as any,
        clientFor,
        offers,
        cancelled,
        placed,
        setForeignBuy(n: number) {
            foreignBuy = n;
        },
    };
}

const savedExitCode = process.exitCode;
afterEach(() => {
    process.exitCode = savedExitCode;
});

describe('execute: wave runner against an in-memory exchange', () => {
    test('two sellers to one buyer settles fully and collects every claim', async () => {
        const ex = fakeExchange(19);
        const waves = planWaves({ mode: 'sell', sellers: [{ name: 'a', units: 1 }, { name: 'b', units: 1 }], buyer: 'buyer', lot: 1 });
        const clients = new Map([
            ['a', ex.clientFor('a')],
            ['b', ex.clientFor('b')],
            ['buyer', ex.clientFor('buyer')],
        ]);
        await execute(waves, clients, ex.market, 569, 19, { bookTimeoutMs: 0, pollMs: 0 });
        expect(process.exitCode ?? 0).toBe(0);
        expect(ex.cancelled).toEqual([]);
        expect(ex.placed).toEqual(['buyer:buy', 'buyer:buy', 'a:sell', 'b:sell']);
        expect(ex.offers.length).toBe(0);
    });

    test('a foreign bid appearing after our bids stops the run before any sell and cancels our bids', async () => {
        const ex = fakeExchange(19);
        const waves = planWaves({ mode: 'sell', sellers: [{ name: 'a', units: 1 }, { name: 'b', units: 1 }], buyer: 'buyer', lot: 1 });
        const clients = new Map([
            ['a', ex.clientFor('a')],
            ['b', ex.clientFor('b')],
            ['buyer', ex.clientFor('buyer')],
        ]);
        // The buyer bids, then a stranger bids on the same item before the sells go in.
        const originalPlace = clients.get('buyer')!.bot.placeGEOffer;
        clients.get('buyer')!.bot.placeGEOffer = async (req: any) => {
            const r = await originalPlace(req);
            ex.setForeignBuy(3);
            return r;
        };
        await execute(waves, clients, ex.market, 569, 19, { bookTimeoutMs: 0, pollMs: 0 });
        expect(process.exitCode).toBe(1);
        // The check before the sells catches the stranger, so no stock is listed.
        expect(ex.placed).toEqual(['buyer:buy', 'buyer:buy']);
        expect(ex.cancelled.length).toBe(2);
        expect(ex.offers.every((o) => o.state !== 'open')).toBe(true);
    });
    test('abort leaves an account\'s unrelated open offers alone', async () => {
        const ex = fakeExchange(19);
        // Seller a already has an unrelated offer open on another item (not this run's).
        ex.offers.push({ id: 900, owner: 'a', side: 'sell', quantity: 5, price: 100, remaining: 5, filled: 0, state: 'open', items: 0, coins: 0, tax: 0, item: 999 });
        const waves = planWaves({ mode: 'sell', sellers: [{ name: 'a', units: 1 }, { name: 'b', units: 1 }], buyer: 'buyer', lot: 1 });
        const clients = new Map([
            ['a', ex.clientFor('a')],
            ['b', ex.clientFor('b')],
            ['buyer', ex.clientFor('buyer')],
        ]);
        const originalPlace = clients.get('a')!.bot.placeGEOffer;
        clients.get('a')!.bot.placeGEOffer = async (req: any) => {
            const r = await originalPlace(req);
            ex.setForeignBuy(3);
            return r;
        };
        await execute(waves, clients, ex.market, 569, 19, { bookTimeoutMs: 0, pollMs: 0 });
        expect(ex.cancelled).not.toContain(900);
        expect(ex.offers.find((o) => o.id === 900)?.state).toBe('open');
    });

    test('two sales run at once; an account in both takes its GE visits one at a time', async () => {
        const ex = fakeExchange(19);
        let inside = 0;
        let overlapped = false;
        const buyer = ex.clientFor('buyer');
        const open = buyer.bot.openGE;
        const close = buyer.bot.closeInterface;
        buyer.bot.openGE = async () => {
            if (inside++) overlapped = true;
            await new Promise((r) => setTimeout(r, 5));
            return open();
        };
        buyer.bot.closeInterface = async () => {
            inside--;
            return close();
        };
        const clients = new Map([
            ['a', ex.clientFor('a')],
            ['b', ex.clientFor('b')],
            ['buyer', buyer],
        ]);
        const waves = (seller: string) => planWaves({ mode: 'sell', sellers: [{ name: seller, units: 2 }], buyer: 'buyer', lot: 2 });
        const results = await Promise.all([
            execute(waves('a'), clients, ex.market, 569, 19, { bookTimeoutMs: 0, pollMs: 0 }),
            execute(waves('b'), clients, ex.market, 570, 19, { bookTimeoutMs: 0, pollMs: 0 }),
        ]);
        expect(overlapped).toBe(false);
        expect(ex.placed.filter((p) => p === 'buyer:buy').length).toBe(2);
        expect(results).toEqual([true, true]);
        expect(ex.offers.length).toBe(0);
    });
});
