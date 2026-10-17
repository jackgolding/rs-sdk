import { describe, expect, test } from 'bun:test';
import { bankPass, namesNeedingLogin } from './bank-check';

describe('bankPass', () => {
    test('opens every account and only restarts grinds that were running', () => {
        expect(
            bankPass([
                { name: 'Jackpoo1', paused: false, pauseSource: null },
                { name: 'fatpig', paused: true, pauseSource: 'skip-bots' },
                { name: 'jackthief', paused: true, pauseSource: 'food-hub' },
            ])
        ).toEqual({
            open: ['Jackpoo1', 'fatpig', 'jackthief'],
            restart: ['Jackpoo1'],
            login: ['Jackpoo1', 'jackthief'],
        });
    });
});

describe('namesNeedingLogin', () => {
    test('skips accounts that already have a fresh client', () => {
        expect(namesNeedingLogin(['Jackpoo1', 'Jackpoo2', 'fatpig'], new Set(['Jackpoo1']))).toEqual([
            'Jackpoo2',
            'fatpig',
        ]);
    });
});
