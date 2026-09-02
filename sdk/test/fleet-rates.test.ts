import { describe, expect, test } from 'bun:test';
import {
    computeRates,
    estimateFishFromXp,
    flagMaxedSkill,
    flagZeroValue,
    isZeroRate,
    parseWindowArg,
    recordsInWindow,
    type HeartbeatRecord,
    xpAt99,
    ZERO_RATE_MS,
    BURSTY_ZERO_RATE_MS,
} from '../../.cursor/skills/wake-fleet/scripts/fleet-rates';

function hb(t: number, xp: Record<string, number>, coins: number, session = 1): HeartbeatRecord {
    return { t, session, job: 'test', xp, coins, x: 0, z: 0 };
}

describe('fleet-rates', () => {
    test('computeRates from two heartbeats', () => {
        const records = [
            hb(0, { thieving: 1_000_000 }, 10_000),
            hb(3_600_000, { thieving: 1_100_000 }, 20_000),
        ];
        const rates = computeRates(records, 3_600_000, 3_600_000);
        expect(rates).not.toBeNull();
        expect(rates!.xpPerHour.thieving).toBe(100_000);
        expect(rates!.gpPerHour).toBe(10_000);
    });

    test('restart mid-window keeps monotonic xp deltas', () => {
        const records = [
            hb(0, { mining: 100 }, 0, 1),
            hb(1_800_000, { mining: 200 }, 0, 2),
            hb(3_600_000, { mining: 400 }, 0, 2),
        ];
        const rates = computeRates(records, 3_600_000, 3_600_000);
        expect(rates!.xpPerHour.mining).toBe(300);
    });

    test('no data returns null rates', () => {
        expect(computeRates([], 3_600_000)).toBeNull();
        expect(computeRates([hb(0, {}, 0)], 3_600_000)).toBeNull();
    });

    test('zero-rate within 30m for normal bots', () => {
        const now = 10_000_000;
        const records = [
            hb(now - ZERO_RATE_MS - 1_000, { thieving: 500 }, 100),
            hb(now - 1_000, { thieving: 500 }, 100),
        ];
        expect(isZeroRate(records, false, now)).toBe(true);
    });

    test('bursty bot tolerates 30m but flags at 90m', () => {
        const now = 20_000_000;
        const at45 = [
            hb(now - 45 * 60_000, { thieving: 500 }, 100),
            hb(now - 1_000, { thieving: 500 }, 100),
        ];
        expect(isZeroRate(at45, true, now)).toBe(false);

        const at95 = [
            hb(now - 95 * 60_000, { thieving: 500 }, 100),
            hb(now - 1_000, { thieving: 500 }, 100),
        ];
        expect(isZeroRate(at95, true, now)).toBe(true);
    });

    test('recordsInWindow filters by time', () => {
        const records = [hb(0, {}, 0), hb(1000, {}, 0), hb(5000, {}, 0)];
        expect(recordsInWindow(records, 2000, 6000).length).toBe(1);
        expect(recordsInWindow(records, 6000, 6000).length).toBe(3);
    });

    test('maxed skill flag at 99 threshold', () => {
        const records = [hb(0, { thieving: 13_034_431 }, 0)];
        expect(flagMaxedSkill(records, 'thieving')?.reason).toBe('maxed_skill');
        expect(flagMaxedSkill(records, 'mining')).toBeNull();
    });

    test('zero value flag', () => {
        const rates = { xpPerHour: {}, gpPerHour: 0, windowMs: 1, recordCount: 2, stallMinutes: null };
        expect(flagZeroValue(rates)?.reason).toBe('zero_value');
    });

    test('parseWindowArg', () => {
        expect(parseWindowArg('6h', 0)).toBe(6 * 3_600_000);
        expect(parseWindowArg('2d', 0)).toBe(2 * 24 * 3_600_000);
        expect(parseWindowArg(undefined, 999)).toBe(999);
    });

    test('estimateFishFromXp', () => {
        expect(estimateFishFromXp(1000)).toBe(10);
        expect(estimateFishFromXp(0)).toBe(0);
    });

    test('xpAt99', () => {
        expect(xpAt99('thieving', 13_034_431)).toBe(true);
        expect(xpAt99('thieving', 1000)).toBe(false);
    });
});
