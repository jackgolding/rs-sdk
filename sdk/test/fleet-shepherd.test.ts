import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    canStart,
    detectWake,
    emptyState,
    markNotified,
    MAX_RESTARTS_PER_HOUR,
    migrateShepherdState,
    parseLaunchdStartOutput,
    planCycle,
    pruneRestarts,
    recordRestart,
    RENOTIFY_MS,
    shouldCap,
    shouldNotify,
    shouldRecordWake,
    ROLLING_WINDOW_MS,
    WAKE_GAP_MS,
    type ShepherdState,
} from '../../.cursor/skills/wake-fleet/scripts/fleet-shepherd';

const FIXTURE = join(import.meta.dir, 'fixtures/telemetry/shepherd-state-capped.json');

describe('fleet-shepherd decisions', () => {
    test('pruneRestarts drops events outside rolling window', () => {
        const now = 10_000_000;
        const restarts = [now - ROLLING_WINDOW_MS - 1, now - 1000, now - 500];
        expect(pruneRestarts(restarts, now).length).toBe(2);
    });

    test('canStart allows 3 restarts and refuses 4 and 5', () => {
        const now = 5_000_000;
        const withRestarts = (count: number) => {
            let state = emptyState();
            for (let i = 0; i < count; i++) state = recordRestart(state, 'Jackpoo1', now - i * 1000);
            return state;
        };
        expect(canStart(withRestarts(3), 'Jackpoo1', now)).toBe(true);
        expect(canStart(withRestarts(4), 'Jackpoo1', now)).toBe(false);
        expect(canStart(withRestarts(5), 'Jackpoo1', now)).toBe(false);
        expect(MAX_RESTARTS_PER_HOUR).toBe(4);
    });

    test('shouldCap after more than MAX_RESTARTS_PER_HOUR in window', () => {
        const now = 5_000_000;
        let state = emptyState();
        for (let i = 0; i <= MAX_RESTARTS_PER_HOUR; i++) {
            state = recordRestart(state, 'Jackpoo1', now - i * 1000);
        }
        expect(shouldCap(state, 'Jackpoo1', now)).toBe(true);
    });

    test('notification re-fires after RENOTIFY_MS and a missing condition drops the key', () => {
        const now = 1_000_000;
        let state = emptyState();
        expect(shouldNotify(undefined, 'capped', now)).toBe(true);
        state = markNotified(state, 'ABGARMY13', 'capped', now);
        expect(shouldNotify(state.bots.ABGARMY13, 'capped', now + 1000)).toBe(false);
        expect(shouldNotify(state.bots.ABGARMY13, 'capped', now + RENOTIFY_MS)).toBe(true);

        state = markNotified(state, 'ABGARMY13', 'churning', now);
        const cleared = planCycle(state, [{ name: 'ABGARMY13', kind: 'producing', owner: null }], new Map(), now + 1);
        expect(cleared.state.bots.ABGARMY13?.notified.churning).toBeUndefined();
        expect(cleared.state.bots.ABGARMY13?.notified.capped).toBeUndefined();
    });

    test('legacy intervene keys are dropped on load', () => {
        const raw = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as ShepherdState;
        const state = migrateShepherdState(raw);
        expect(state.bots.Jackpoo5?.notified['intervene:stale (11s old)']).toBeUndefined();
        const cappedAt = raw.bots.Jackpoo5?.notified.capped;
        if (cappedAt == null) throw new Error('fixture missing capped notification');
        expect(state.bots.Jackpoo5?.notified.capped).toBe(cappedAt);
    });

    test('capped fixture neither starts nor stops; after the oldest restart ages out it starts once', () => {
        const raw = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as ShepherdState & { now: number };
        const state = migrateShepherdState(raw);
        const now = raw.now;
        const row = { name: 'Jackpoo5', kind: 'capped', owner: null };
        const held = planCycle(state, [row], new Map(), now);
        expect(held.actions).toEqual([]);
        expect(held.woke).toEqual([]);
        expect(held.capped).toEqual([]);

        const aged = planCycle(state, [row], new Map(), now + 52 * 60 * 1000);
        expect(aged.actions).toEqual([{ name: 'Jackpoo5', op: 'start' }]);
        expect(aged.woke).toEqual(['Jackpoo5']);
        expect(aged.capped).not.toContain('Jackpoo5');
        expect(aged.state.bots.Jackpoo5?.capped).toBe(false);
    });

    test('no plan contains both start and stop for one bot', () => {
        const now = 8_000_000;
        const scenarios = [
            planCycle(emptyState(), [{ name: 'A', kind: 'restartable', owner: null }], new Map(), now),
            planCycle(emptyState(), [{ name: 'A', kind: 'capped', owner: null }], new Map(), now),
            planCycle(
                emptyState(),
                [{ name: 'A', kind: 'alive-not-producing', owner: { pid: 1, supervised: true } }],
                new Map(),
                now
            ),
        ];
        for (const plan of scenarios) {
            const names = new Set(plan.actions.map((action) => action.name));
            for (const name of names) {
                const ops = plan.actions.filter((action) => action.name === name).map((action) => action.op);
                expect(ops.includes('start') && ops.includes('stop')).toBe(false);
                expect(ops.includes('restart') && ops.includes('stop')).toBe(false);
            }
        }
    });

    test('foreign-owner and finished produce no launchd action', () => {
        const now = 9_000_000;
        const plan = planCycle(
            emptyState(),
            [
                { name: 'Manual', kind: 'foreign-owner', owner: { pid: 4, supervised: false } },
                { name: 'Done', kind: 'finished', owner: null },
            ],
            new Map(),
            now
        );
        expect(plan.actions).toEqual([]);
        expect(plan.state.bots.Manual?.actions?.map((action) => action.action)).toContain('skip-foreign');
        expect(plan.state.bots.Done?.actions?.map((action) => action.action)).toContain('skip-finished');
    });

    test('alive-not-producing restarts once per episode and resets after producing', () => {
        const now = 3_000_000;
        const stuck = { name: 'Jackpoo1', kind: 'alive-not-producing', owner: { pid: 9, supervised: true } };
        const first = planCycle(emptyState(), [stuck], new Map(), now);
        expect(first.actions).toEqual([{ name: 'Jackpoo1', op: 'restart' }]);
        const second = planCycle(first.state, [stuck], new Map(), now + 1);
        expect(second.actions).toEqual([]);
        expect(second.state.bots.Jackpoo1?.episodeRestarted).toBe(true);
        expect(second.notifications.some((line) => line.includes('not_producing'))).toBe(false);
        const producing = planCycle(second.state, [{ ...stuck, kind: 'producing' }], new Map(), now + 2);
        expect(producing.state.bots.Jackpoo1?.episodeRestarted).toBe(false);
        const again = planCycle(producing.state, [stuck], new Map(), now + 3);
        expect(again.actions).toEqual([{ name: 'Jackpoo1', op: 'restart' }]);
    });

    test('no-op start (already running) is not a counted wake', () => {
        expect(parseLaunchdStartOutput('Jackpoo5: already running', 0)).toBe('already-running');
        expect(shouldRecordWake('already-running')).toBe(false);
        expect(parseLaunchdStartOutput('Jackpoo5: kickstarted', 0)).toBe('started');
        expect(shouldRecordWake('started')).toBe(true);
        expect(parseLaunchdStartOutput('Jackpoo5: failed to start — boom', 1)).toBe('failed');
        expect(shouldRecordWake('failed')).toBe(false);
    });

    test('detectWake fires only after a long shepherd silence', () => {
        const now = 50_000_000;
        expect(detectWake(emptyState(), now)).toBe(false);
        expect(detectWake({ bots: {}, lastRun: now - 600_000 }, now)).toBe(false);
        expect(detectWake({ bots: {}, lastRun: now - WAKE_GAP_MS - 1 }, now)).toBe(true);
    });

    test('wake resets the episode so a still-stuck bot restarts again', () => {
        const now = 60_000_000;
        const stuck = { name: 'Jackpoo1', kind: 'alive-not-producing', owner: { pid: 9, supervised: true } };
        const first = planCycle(emptyState(), [stuck], new Map(), now);
        expect(first.actions).toEqual([{ name: 'Jackpoo1', op: 'restart' }]);
        const second = planCycle(first.state, [stuck], new Map(), now + 1);
        expect(second.actions).toEqual([]);
        const woken = planCycle(
            { ...second.state, lastRun: now + 1 },
            [stuck],
            new Map(),
            now + 1 + WAKE_GAP_MS + 1,
            { wake: true }
        );
        expect(woken.actions).toEqual([{ name: 'Jackpoo1', op: 'restart' }]);
        expect(woken.notifications.some((line) => line.startsWith('wake after'))).toBe(true);
    });
});
