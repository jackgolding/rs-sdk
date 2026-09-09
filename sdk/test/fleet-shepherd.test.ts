import { describe, expect, test } from 'bun:test';
import {
    emptyState,
    MAX_RESTARTS_PER_HOUR,
    pruneRestarts,
    recordRestart,
    shouldCap,
    shouldNotify,
    shouldRestartStuckThief,
    shouldRestartZeroRate,
    expireCap,
    markNotified,
    parseLaunchdStartOutput,
    shouldRecordWake,
    ROLLING_WINDOW_MS,
} from '../../.cursor/skills/wake-fleet/scripts/fleet-shepherd';

describe('fleet-shepherd decisions', () => {
    test('pruneRestarts drops events outside rolling window', () => {
        const now = 10_000_000;
        const restarts = [now - ROLLING_WINDOW_MS - 1, now - 1000, now - 500];
        expect(pruneRestarts(restarts, now).length).toBe(2);
    });

    test('shouldCap after MAX_RESTARTS_PER_HOUR in window', () => {
        const now = 5_000_000;
        let state = emptyState();
        for (let i = 0; i <= MAX_RESTARTS_PER_HOUR; i++) {
            state = recordRestart(state, 'Jackpoo1', now - i * 1000);
        }
        expect(shouldCap(state, 'Jackpoo1', now)).toBe(true);
    });

    test('shouldCap false under limit', () => {
        const now = 5_000_000;
        let state = emptyState();
        state = recordRestart(state, 'Jackpoo1', now - 1000);
        expect(shouldCap(state, 'Jackpoo1', now)).toBe(false);
    });

    test('notification dedupe until condition changes', () => {
        const now = 1_000_000;
        let state = emptyState();
        expect(shouldNotify(undefined, 'intervene:stale', now)).toBe(true);
        state = markNotified(state, 'ABGARMY13', 'intervene:stale', now);
        expect(shouldNotify(state.bots.ABGARMY13, 'intervene:stale', now + 1000)).toBe(false);
        expect(shouldNotify(state.bots.ABGARMY13, 'intervene:other', now + 1000)).toBe(true);
    });

    test('zero_rate grinders bounce; bursty mules do not', () => {
        const zero = { kind: 'intervene' as const, reason: 'zero_rate — no xp/coins progress for 30+ minutes' };
        expect(
            shouldRestartZeroRate(zero, { script: 'bots/quests/thieving-route.ts', bursty: false })
        ).toBe(true);
        expect(
            shouldRestartZeroRate(zero, { script: 'bots/quests/fishing-route.ts', bursty: false })
        ).toBe(true);
        expect(
            shouldRestartZeroRate(zero, { script: 'bots/quests/mining-guild.ts', bursty: false })
        ).toBe(true);
        expect(
            shouldRestartZeroRate(zero, { script: 'bots/quests/abg-food-loot-mule.ts', bursty: true })
        ).toBe(false);
        expect(
            shouldRestartStuckThief(
                { kind: 'running', reason: 'bun pid 1' },
                { script: 'bots/quests/thieving-route.ts', bursty: false }
            )
        ).toBe(false);
    });

    test('no-op start (already running) is not a counted wake', () => {
        expect(parseLaunchdStartOutput('Jackpoo5: already running', 0)).toBe('already-running');
        expect(shouldRecordWake('already-running')).toBe(false);
        expect(parseLaunchdStartOutput('Jackpoo5: kickstarted', 0)).toBe('started');
        expect(shouldRecordWake('started')).toBe(true);
        expect(parseLaunchdStartOutput('Jackpoo5: failed to start — boom', 1)).toBe('failed');
        expect(shouldRecordWake('failed')).toBe(false);
    });

    test('capped flag expires when the rolling window drops under the limit', () => {
        const now = 20_000_000;
        let state = emptyState();
        for (let i = 0; i <= MAX_RESTARTS_PER_HOUR; i++) {
            state = recordRestart(state, 'Jackpoo4', now - ROLLING_WINDOW_MS - 1000);
        }
        state.bots.Jackpoo4.capped = true;
        state = expireCap(state, 'Jackpoo4', now);
        expect(state.bots.Jackpoo4.capped).toBe(false);
        expect(shouldCap(state, 'Jackpoo4', now)).toBe(false);
    });
});
