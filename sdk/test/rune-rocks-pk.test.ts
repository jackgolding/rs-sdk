import { describe, expect, test } from 'bun:test';
import { mayRetaliate, RETALIATE_TICKS, type RetaliateInput } from '../../bots/quests/rune-rocks-pk';

const fleet = new Set(['jackthief', 'jackpoo1']);

function input(over: Partial<RetaliateInput> = {}): RetaliateInput {
    return {
        skulled: false,
        tick: 100,
        lastDamageTick: 100,
        targetType: 'player',
        targetIndex: 4,
        targetName: 'SomePker',
        selfName: 'Jackpoo2',
        fleet,
        ...over
    };
}

describe('mayRetaliate', () => {
    test('retaliates the player who just hit us', () => {
        expect(mayRetaliate(input())).toBe(true);
    });

    test('refuses while skulled', () => {
        expect(mayRetaliate(input({ skulled: true }))).toBe(false);
    });

    test('refuses a stale hit', () => {
        expect(mayRetaliate(input({ lastDamageTick: 100 - RETALIATE_TICKS }))).toBe(true);
        expect(mayRetaliate(input({ lastDamageTick: 100 - RETALIATE_TICKS - 1 }))).toBe(false);
        expect(mayRetaliate(input({ lastDamageTick: -1 }))).toBe(false);
    });

    test('refuses when we are not already fighting that player', () => {
        expect(mayRetaliate(input({ targetType: 'none', targetIndex: -1 }))).toBe(false);
        expect(mayRetaliate(input({ targetType: 'npc', targetIndex: 4 }))).toBe(false);
    });

    test('refuses fleet and self', () => {
        expect(mayRetaliate(input({ targetName: 'JackThief' }))).toBe(false);
        expect(mayRetaliate(input({ targetName: 'jackpoo2' }))).toBe(false);
        expect(mayRetaliate(input({ targetName: '  ' }))).toBe(false);
    });
});
