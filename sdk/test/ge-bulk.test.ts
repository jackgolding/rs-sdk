import { describe, expect, test } from 'bun:test';
import { OpenLedger, assertWaves, bookMismatch, lotSizes, offerTax, planWaves, preflightBook, summarize } from '../ge-bulk';

describe('GE tax', () => {
    test('one item under 20 gp pays nothing; 20 items in one offer pay 5%', () => {
        expect(offerTax(1, 19)).toBe(0);
        expect(offerTax(20, 19)).toBe(19);
        expect(offerTax(1, 20)).toBe(1);
    });
});

describe('lotSizes', () => {
    test('splits into lots with a smaller remainder', () => {
        expect(lotSizes(7, 3)).toEqual([3, 3, 1]);
        expect(lotSizes(4, 1)).toEqual([1, 1, 1, 1]);
    });
    test('rejects non-positive input', () => {
        expect(() => lotSizes(0, 1)).toThrow();
        expect(() => lotSizes(5, 0)).toThrow();
    });
});

describe('planWaves: sell mode (many sellers, one buyer)', () => {
    test('each wave uses at most six buyer slots and matches every sell', () => {
        const sellers = Array.from({ length: 8 }, (_, i) => ({ name: `acc${i}`, units: 1 }));
        const waves = planWaves({ mode: 'sell', sellers, buyer: 'jackthief', lot: 1 });
        expect(waves.length).toBe(2);
        expect(waves[0]!.supply.length).toBe(6);
        expect(waves[1]!.supply.length).toBe(2);
        for (const wave of waves) {
            expect(wave.demand.every((l) => l.account === 'jackthief')).toBe(true);
        }
        assertWaves(waves);
    });

    test('a seller with several lots contributes one lot per wave', () => {
        const waves = planWaves({ mode: 'sell', sellers: [{ name: 'a', units: 3 }, { name: 'b', units: 1 }], buyer: 'jackthief', lot: 1 });
        expect(waves.map((w) => w.supply.map((l) => `${l.account}:${l.quantity}`))).toEqual([
            ['a:1', 'b:1'],
            ['a:1'],
            ['a:1'],
        ]);
    });

    test('refuses a buyer that is also a seller', () => {
        expect(() => planWaves({ mode: 'sell', sellers: [{ name: 'jackthief', units: 1 }], buyer: 'jackthief', lot: 1 })).toThrow(/cannot also be the buyer/);
    });

    test('refuses when no seller has stock', () => {
        expect(() => planWaves({ mode: 'sell', sellers: [{ name: 'a', units: 0 }], buyer: 'jackthief', lot: 1 })).toThrow(/no seller/i);
    });
});

describe('planWaves: bid mode (one seller, many bidders)', () => {
    test('20 shortbows across 20 bidders take four waves of at most six lots', () => {
        const bidders = Array.from({ length: 20 }, (_, i) => `b${i}`);
        const waves = planWaves({ mode: 'bid', seller: 'jackthief', units: 20, bidders, lot: 1 });
        expect(waves.map((w) => w.supply.length)).toEqual([6, 6, 6, 2]);
        const bidOnce = waves.flatMap((w) => w.demand.map((l) => l.account));
        expect(new Set(bidOnce).size).toBe(20);
        assertWaves(waves);
    });

    test('a short bidder list is reused across waves but never within one', () => {
        const waves = planWaves({ mode: 'bid', seller: 'jackthief', units: 5, bidders: ['x', 'y'], lot: 1 });
        for (const wave of waves) {
            const accounts = wave.demand.map((l) => l.account);
            expect(new Set(accounts).size).toBe(accounts.length);
        }
        expect(waves.reduce((n, w) => n + w.demand.length, 0)).toBe(5);
    });

    test('refuses the seller as a bidder and duplicate bidders', () => {
        expect(() => planWaves({ mode: 'bid', seller: 'jackthief', units: 1, bidders: ['jackthief'], lot: 1 })).toThrow(/cannot also be a bidder/);
        expect(() => planWaves({ mode: 'bid', seller: 'jackthief', units: 1, bidders: ['a', 'a'], lot: 1 })).toThrow(/listed once/);
    });
});

describe('summarize', () => {
    test('tax-free plan at 19 gp with one item per offer', () => {
        const waves = planWaves({ mode: 'bid', seller: 'jackthief', units: 20, bidders: Array.from({ length: 20 }, (_, i) => `b${i}`), lot: 1 });
        const s = summarize(waves, 19);
        expect(s.units).toBe(20);
        expect(s.offers).toBe(20);
        expect(s.tax).toBe(0);
        expect(s.coinsNeeded.get('b0')).toBe(19);
        expect(s.proceeds.get('jackthief')).toBe(380);
    });

    test('one 20-item offer pays 19 gp tax', () => {
        const waves = planWaves({ mode: 'bid', seller: 'jackthief', units: 20, bidders: ['b0'], lot: 20 });
        expect(summarize(waves, 19).tax).toBe(19);
    });

    test('sell mode: buyer pays every seller, sellers net of tax', () => {
        const waves = planWaves({ mode: 'sell', sellers: [{ name: 'a', units: 2 }, { name: 'b', units: 1 }], buyer: 'jackthief', lot: 2 });
        const s = summarize(waves, 19);
        expect(s.coinsNeeded.get('jackthief')).toBe(3 * 19);
        expect(s.proceeds.get('a')).toBe(38 - offerTax(2, 19));
    });
});

describe('OpenLedger', () => {
    test('sell placements rest on the sell side and fills consume buys', () => {
        const ledger = new OpenLedger();
        ledger.record('sell', { remaining: 1, filled: 0 });
        expect(ledger.open).toEqual({ buy: 0, sell: 1 });
        ledger.record('buy', { remaining: 0, filled: 1 });
        expect(ledger.open).toEqual({ buy: 0, sell: 0 });
    });

    test('a fill against our own resting buy removes that buy', () => {
        const ledger = new OpenLedger();
        ledger.record('buy', { remaining: 6, filled: 0 });
        ledger.record('sell', { remaining: 0, filled: 4 });
        expect(ledger.open).toEqual({ buy: 2, sell: 0 });
    });

    test('negative totals throw', () => {
        const ledger = new OpenLedger();
        expect(() => ledger.record('sell', { remaining: 0, filled: 1 })).toThrow(/negative/);
    });
});

describe('book guards', () => {
    test('preflight refuses any open offer on the item', () => {
        expect(preflightBook({ buyQuantity: 0, sellQuantity: 0 })).toBeNull();
        expect(preflightBook({ buyQuantity: 3, sellQuantity: 0 })).toMatch(/Refusing/);
        expect(preflightBook({ buyQuantity: 0, sellQuantity: 1 })).toMatch(/Refusing/);
    });

    test('mid-run: foreign buying is caught', () => {
        const ours = { buy: 6, sell: 0 };
        expect(bookMismatch({ buyQuantity: 6, sellQuantity: 0 }, ours)).toBeNull();
        expect(bookMismatch({ buyQuantity: 7, sellQuantity: 0 }, ours)).toMatch(/Someone else is buying/);
    });

    test('mid-run: foreign selling is caught', () => {
        expect(bookMismatch({ buyQuantity: 0, sellQuantity: 2 }, { buy: 0, sell: 1 })).toMatch(/Someone else is selling/);
    });

    test('mid-run: fewer units than recorded stops the run', () => {
        expect(bookMismatch({ buyQuantity: 0, sellQuantity: 0 }, { buy: 0, sell: 1 })).toMatch(/fewer units/);
    });
});
