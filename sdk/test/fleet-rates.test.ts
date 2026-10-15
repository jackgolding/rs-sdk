import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    computeRates,
    estimateFishFromXp,
    flagMaxedSkill,
    flagZeroValue,
    formatCompactLevels,
    isValidSnapshot,
    lastEffectAt,
    parseWindowArg,
    recordsInWindow,
    skillLookup,
    type ActivityEvent,
    type HeartbeatRecord,
} from '../../.cursor/skills/wake-fleet/scripts/fleet-rates';

const FIX = join(import.meta.dir, 'fixtures/telemetry');

function hb(t: number, xp: Record<string, number>, coins: number, session = 1, extra: Partial<HeartbeatRecord> = {}): HeartbeatRecord {
    return {
        t,
        session,
        job: 'test',
        xp: { Hitpoints: 1154, ...xp },
        coins,
        x: 3200,
        z: 3400,
        ...extra,
    };
}

function loadJsonl(name: string): HeartbeatRecord[] {
    return readFileSync(join(FIX, name), 'utf-8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as HeartbeatRecord);
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

    test('per-session rates ignore a cross-session jump', () => {
        const records = [
            hb(0, { mining: 100 }, 0, 1),
            hb(1_800_000, { mining: 200 }, 0, 2),
            hb(3_600_000, { mining: 400 }, 0, 2),
        ];
        const rates = computeRates(records, 3_600_000, 3_600_000);
        expect(rates!.xpPerHour.mining).toBe(400);
    });

    test('Jackpoo3 fixture sums in-session deltas over summed session time', () => {
        const records = loadJsonl('heartbeat-jackpoo3.jsonl');
        const rates = computeRates(records, 24 * 3_600_000, 7_800_000);
        expect(rates).not.toBeNull();
        expect(rates!.xpPerHour.fishing).toBe(74_250);
    });

    test('Jackpoo1 fixture is under 10 min of valid data and cannot inflate to billions', () => {
        const records = loadJsonl('heartbeat-jackpoo1.jsonl');
        const rates = computeRates(records, 24 * 3_600_000, 1_150_000);
        expect(rates).toBeNull();
        expect(records[1]!.xp.Woodcutting).toBeGreaterThan(2_000_000_000);
    });

    test('no data returns null rates', () => {
        expect(computeRates([], 3_600_000)).toBeNull();
        expect(computeRates([hb(0, {}, 0)], 3_600_000, 0)).toBeNull();
    });

    test('isValidSnapshot rejects empty skills and position 0,0', () => {
        expect(isValidSnapshot(hb(0, {}, 0, 1, { xp: {}, x: 0, z: 0 }))).toBe(false);
        expect(isValidSnapshot(hb(0, { Hitpoints: 1154 }, 0, 1, { x: 0, z: 0 }))).toBe(false);
        expect(isValidSnapshot(hb(0, {}, 0))).toBe(true);
    });

    test('lastEffectAt ignores invalid records and cross-session jumps', () => {
        const records = [
            hb(0, {}, 0, 1, { xp: {}, x: 0, z: 0 }),
            hb(1_000, { fishing: 10 }, 1, 1),
            hb(2_000, { fishing: 10 }, 1, 1),
            hb(3_000, { fishing: 500 }, 1, 2),
            hb(4_000, { fishing: 40 }, 9, 1, { lastEffectAt: 500 }),
        ];
        expect(lastEffectAt(records, [])).toBe(4_000);

        const crossOnly = [
            hb(1_000, { fishing: 10 }, 1, 1),
            hb(2_000, { fishing: 999 }, 1, 2),
        ];
        expect(lastEffectAt(crossOnly, [])).toBeNull();
    });

    test('lastEffectAt accepts effect progress events and ignores location and phase', () => {
        const records = [hb(1_000, { fishing: 10 }, 1, 1)];
        const events: ActivityEvent[] = [
            { t: 5_000, type: 'progress', kind: 'location' },
            { t: 6_000, type: 'progress', kind: 'phase' },
            { t: 7_000, type: 'progress', kind: 'bank' },
        ];
        expect(lastEffectAt(records, events)).toBe(7_000);
    });

    test('recordsInWindow filters by time', () => {
        const records = [hb(0, {}, 0), hb(1000, {}, 0), hb(5000, {}, 0)];
        expect(recordsInWindow(records, 2000, 6000).length).toBe(1);
        expect(recordsInWindow(records, 6000, 6000).length).toBe(3);
    });

    test('maxed skill flag uses client levels, not OSRS XP', () => {
        const xpOnly = [hb(0, { Fishing: 1_075_292, thieving: 13_034_431 }, 0)];
        expect(flagMaxedSkill(xpOnly, 'fishing')).toBeNull();
        expect(flagMaxedSkill(xpOnly, 'thieving')).toBeNull();
        const records = [
            hb(0, { Fishing: 1_075_292 }, 0, 1, { levels: { Hitpoints: 10, Fishing: 99, Attack: 50 } }),
        ];
        expect(flagMaxedSkill(records, 'fishing')?.reason).toBe('maxed_skill');
        expect(flagMaxedSkill(records, 'Fishing')?.detail).toBe('Fishing 99');
        expect(flagMaxedSkill(records, 'attack')).toBeNull();
        expect(flagMaxedSkill(records, 'mining')).toBeNull();
    });

    test('skillLookup is case-insensitive', () => {
        expect(skillLookup({ Fishing: 88_040 }, 'fishing')).toBe(88_040);
        expect(skillLookup({ fishing: 1 }, 'Fishing')).toBe(1);
        expect(formatCompactLevels({ Attack: 99, Fishing: 99, Hitpoints: 75 })).toBe('Atk99 HP75 Fish99');
    });

    test('zero value flag', () => {
        const rates = { xpPerHour: {}, gpPerHour: 0, windowMs: 1, recordCount: 2 };
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

});
