import { describe, expect, test } from 'bun:test';
import { foodHeal, foodHp, needsBankHeal } from '../../bots/quests/food-heal';

describe('foodHp', () => {
    test('noted swordfish stack is count times 14', () => {
        expect(foodHeal('Swordfish')).toBe(14);
        expect(foodHp([{ name: 'Swordfish', count: 156 }])).toBe(156 * 14);
    });

    test('sums mixed bank food after a mule dump', () => {
        expect(
            foodHp([
                { name: 'Swordfish', count: 2808 },
                { name: 'Tuna', count: 830 },
                { name: 'Bass', count: 398 },
                { name: 'Cod', count: 654 },
                { name: 'Shark', count: 6 },
                { name: 'Jug of wine', count: 65 },
                { name: 'Coins', count: 3990657 }
            ])
        ).toBe(2808 * 14 + 830 * 10 + 398 * 13 + 654 * 7 + 6 * 20 + 65 * 11);
    });

    test('cake remaining bites and unknown items', () => {
        expect(foodHp([{ name: 'Cake', count: 1 }, { name: '2/3 cake', count: 1 }])).toBe(20);
        expect(foodHp([{ name: 'Death rune', count: 10 }])).toBe(0);
    });
});

describe('needsBankHeal', () => {
    test('11/72 hp walks out; full and mid hp stay on rocks', () => {
        expect(needsBankHeal(11, 72)).toBe(true);
        expect(needsBankHeal(20, 72)).toBe(true);
        expect(needsBankHeal(26, 72)).toBe(false);
        expect(needsBankHeal(72, 72)).toBe(false);
    });
});
