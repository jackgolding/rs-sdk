import { describe, expect, test } from 'bun:test';
import {
    ABG_NAMES,
    FOOD_MULE,
    FOOD_MULE_FROM,
    FOOD_PER_TRADE,
    foodPackGive,
    usesFoodMule,
    abgFoodBroadcast,
    abgLootPlan,
    abgThieves,
    broadcastRounds,
    casketPlan,
    foodPlan,
    goldHolders,
    goldPlan,
    meetTile,
    reductionRounds,
    splitAmount
} from '../../bots/quests/tree-trade-plan';
import { SLOT_MS, TREE_PERIOD_MS, treeLayout } from '../../bots/quests/abg-loot-food-tree';

describe('reductionRounds', () => {
    test('1→2 and 3→4 in parallel, then 2→4', () => {
        const { rounds, winner } = reductionRounds(['ABGARMY01', 'ABGARMY02', 'ABGARMY03', 'ABGARMY04']);
        expect(rounds).toEqual([
            [
                { giver: 'ABGARMY01', receiver: 'ABGARMY02' },
                { giver: 'ABGARMY03', receiver: 'ABGARMY04' }
            ],
            [{ giver: 'ABGARMY02', receiver: 'ABGARMY04' }]
        ]);
        expect(winner).toBe('ABGARMY04');
    });

    test('odd count carries a bye into the next round', () => {
        const { rounds, winner } = reductionRounds(['a', 'b', 'c']);
        expect(rounds).toEqual([
            [{ giver: 'a', receiver: 'b' }],
            [{ giver: 'b', receiver: 'c' }]
        ]);
        expect(winner).toBe('c');
    });
});

describe('broadcastRounds', () => {
    test('one source feeding five splits across three parallel rounds', () => {
        const rounds = broadcastRounds('jacklove1', [
            'ABGARMY01',
            'ABGARMY02',
            'ABGARMY03',
            'ABGARMY04',
            'ABGARMY05'
        ]);
        expect(rounds[0]).toEqual([
            { giver: 'jacklove1', receiver: 'ABGARMY01', shares: 3, hold: 2 }
        ]);
        expect(rounds[1]).toEqual([
            { giver: 'jacklove1', receiver: 'ABGARMY04', shares: 1, hold: 1 },
            { giver: 'ABGARMY01', receiver: 'ABGARMY02', shares: 1, hold: 2 }
        ]);
        expect(rounds[2]?.map((p) => `${p.giver}→${p.receiver}`).sort()).toEqual([
            'ABGARMY01→ABGARMY03',
            'jacklove1→ABGARMY05'
        ]);
        const receivers = new Set(rounds.flat().map((p) => p.receiver));
        expect(receivers.size).toBe(5);
        expect(Math.max(...rounds.map((r) => r.length))).toBeGreaterThan(1);
    });
});

describe('splitAmount', () => {
    test('gives three fifths then dumps the rest', () => {
        expect(splitAmount(100, 3, 2)).toBe(60);
        expect(splitAmount(40, 1, 1)).toBe(20);
        expect(splitAmount(20, 1, 0)).toBe(20);
    });
});

describe('goldPlan', () => {
    test('skip list drops a holder and still names a winner', () => {
        const skip = ['ABGARMY06'];
        const holders = goldHolders(skip);
        expect(holders).not.toContain('ABGARMY06');
        expect(holders).toContain('Jackpoo3');
        const { rounds, winner } = goldPlan(skip);
        expect(rounds.length).toBeGreaterThanOrEqual(4);
        expect(rounds[0]!.length).toBe(Math.floor(holders.length / 2));
        expect(winner).toBeTruthy();
        const givers = new Set(rounds.flat().map((p) => p.giver));
        expect(givers.has('ABGARMY06')).toBe(false);
    });
});

describe('foodPlan', () => {
    test('squads share a round: several jackloves give at once', () => {
        const rounds = foodPlan(['ABGARMY06']);
        expect(rounds[0]!.length).toBe(5);
        expect(rounds[0]!.every((p) => p.giver.startsWith('jacklove'))).toBe(true);
        expect(rounds[0]!.some((p) => p.receiver === 'ABGARMY06')).toBe(false);
    });
});

describe('bank 1-to-1 food pack', () => {
    test('FOOD_MULE_FROM is the thieves plus Jackpoo3, not 01', () => {
        expect(usesFoodMule('ABGARMY06')).toBe(true);
        expect(usesFoodMule('ABGARMY07')).toBe(true);
        expect(usesFoodMule('ABGARMY20')).toBe(true);
        expect(usesFoodMule('Jackpoo3')).toBe(true);
        expect(usesFoodMule('ABGARMY01')).toBe(false);
        expect(FOOD_MULE_FROM.test('Abgarmy10')).toBe(true);
        expect(FOOD_MULE_FROM.test('fatpig')).toBe(false);
    });

    test('prefers swordfish then bass and caps at FOOD_PER_TRADE', () => {
        expect(
            foodPackGive([
                { name: 'cod', count: 2000 },
                { name: 'bass', count: 100 },
                { name: 'swordfish', count: 10 }
            ])
        ).toEqual([
            { item: /^swordfish$/i, amount: 10 },
            { item: /^bass$/i, amount: 15 }
        ]);
        expect(FOOD_PER_TRADE).toBe(25);
        expect(foodPackGive([{ name: 'cod', count: 8 }])).toEqual([{ item: /^cod$/i, amount: 8 }]);
        expect(foodPackGive([])).toEqual([]);
    });
});

describe('abg army skip', () => {
    test('ABGARMY06 is back in the army and 01 is the food mule not a thief', () => {
        expect(ABG_NAMES).toContain('ABGARMY06');
        expect(abgThieves()).not.toContain('ABGARMY01');
        expect(abgThieves()).toContain('ABGARMY06');
        expect(abgThieves()).toContain('ABGARMY07');
        expect(foodPlan().flat().some((p) => p.receiver === 'ABGARMY06')).toBe(true);
        expect(goldHolders()).toContain('ABGARMY06');
    });
});

describe('casketPlan', () => {
    test('20 jackloves reduce in 5 rounds with 10 parallel trades first', () => {
        const { rounds, winner } = casketPlan();
        expect(rounds[0]!.length).toBe(10);
        expect(rounds.length).toBe(5);
        expect(winner).toBe('jacklove20');
        expect(rounds.flat().every((p) => /^jacklove\d+$/.test(p.giver))).toBe(true);
    });
});

describe('meetTile', () => {
    test('is stable for a pair and nearby the Ardougne bank/market', () => {
        const a = meetTile('ABGARMY01', 'ABGARMY02');
        const b = meetTile('ABGARMY02', 'ABGARMY01');
        expect(a).toEqual(b);
        expect(a.x).toBeGreaterThanOrEqual(2650);
        expect(a.x).toBeLessThanOrEqual(2680);
        expect(a.z).toBeGreaterThanOrEqual(3288);
        expect(a.z).toBeLessThanOrEqual(3320);
    });

    test('jacklove pairs meet at Catherby, not Ardougne', () => {
        const a = meetTile('jacklove7', 'jacklove8');
        const b = meetTile('jacklove8', 'jacklove7');
        expect(a).toEqual(b);
        expect(a.x).toBeGreaterThanOrEqual(2790);
        expect(a.x).toBeLessThanOrEqual(2826);
        expect(a.z).toBeGreaterThanOrEqual(3432);
        expect(a.z).toBeLessThanOrEqual(3452);
    });
});

describe('abg loot/food tree', () => {
    test('first loot round is 20→19, 18→17, 16→15 in parallel', () => {
        const { rounds, winner } = abgLootPlan();
        expect(rounds[0]!.slice(0, 3)).toEqual([
            { giver: 'ABGARMY20', receiver: 'ABGARMY19' },
            { giver: 'ABGARMY18', receiver: 'ABGARMY17' },
            { giver: 'ABGARMY16', receiver: 'ABGARMY15' }
        ]);
        expect(winner).toBe('ABGARMY02');
        expect(rounds[0]!.some((p) => p.giver === 'ABGARMY01' || p.receiver === 'ABGARMY01')).toBe(false);
    });

    test('food comes back out from 01 to every thief', () => {
        const thieves = abgThieves();
        const rounds = abgFoodBroadcast();
        expect(rounds[0]![0]!.giver).toBe(FOOD_MULE);
        const got = new Set(rounds.flat().map((p) => p.receiver));
        for (const t of thieves) expect(got.has(t)).toBe(true);
        expect(got.has(FOOD_MULE)).toBe(false);
    });

    test('layout fits inside one tree period', () => {
        const layout = treeLayout();
        expect(layout.treeSlots * SLOT_MS).toBeLessThanOrEqual(TREE_PERIOD_MS);
        expect(layout.winner).toBe('ABGARMY02');
    });
});
