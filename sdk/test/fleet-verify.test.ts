import { describe, expect, test } from 'bun:test';
import { verifyOutcome } from '../../.cursor/skills/wake-fleet/scripts/fleet-verify';
import type { ActivityEvent, HeartbeatRecord } from '../../.cursor/skills/wake-fleet/scripts/fleet-rates';

const T0 = 1_000_000;
const OLD = 10;
const NEW = 20;

function snap(t: number, fishing: number, pid = NEW, session = 2): HeartbeatRecord {
    return {
        t,
        session,
        job: 'fishing',
        xp: { Hitpoints: 1154, fishing },
        coins: 1,
        x: 2840,
        z: 3430,
        pid,
    };
}

describe('verifyOutcome', () => {
    test('success requires an effect from a new pid after t0', () => {
        const events: ActivityEvent[] = [
            { t: T0 + 5_000, pid: NEW, type: 'progress', kind: 'xp', message: 'cast' },
        ];
        const result = verifyOutcome({
            events,
            snapshots: [],
            t0: T0,
            oldPid: OLD,
            now: T0 + 5_000,
            timeoutMs: 60_000,
        });
        expect(result.status).toBe('success');
        if (result.status === 'success') {
            expect(result.evidence).toBe('progress xp');
            expect(result.pid).toBe(NEW);
            expect(result.elapsedMs).toBe(5_000);
        }
    });

    test('events from the old pid are ignored', () => {
        const result = verifyOutcome({
            events: [{ t: T0 + 1_000, pid: OLD, type: 'progress', kind: 'xp' }],
            snapshots: [],
            t0: T0,
            oldPid: OLD,
            now: T0 + 1_000,
            timeoutMs: 60_000,
        });
        expect(result.status).toBe('pending');
    });

    test('a stop from the new pid fails immediately', () => {
        const result = verifyOutcome({
            events: [{ t: T0 + 2_000, pid: NEW, type: 'stop', code: 'recovery_exhausted', message: 'budget', restartable: true }],
            snapshots: [],
            t0: T0,
            oldPid: OLD,
            now: T0 + 2_000,
            timeoutMs: 60_000,
        });
        expect(result).toEqual({ status: 'failure', reason: 'recovery_exhausted: budget' });
    });

    test('timeout fails with the newest failure reason', () => {
        const result = verifyOutcome({
            events: [
                { t: T0 + 1_000, pid: NEW, type: 'failure', code: 'missing_supplies', message: 'no super attack in bank', count: 1 },
                { t: T0 + 4_000, pid: NEW, type: 'failure', code: 'missing_supplies', message: 'no super attack in bank', count: 4 },
            ],
            snapshots: [],
            t0: T0,
            oldPid: OLD,
            now: T0 + 60_000,
            timeoutMs: 60_000,
        });
        expect(result).toEqual({ status: 'failure', reason: 'missing_supplies: no super attack in bank' });
    });

    test('a location-only progress event never succeeds', () => {
        const pending = verifyOutcome({
            events: [{ t: T0 + 1_000, pid: NEW, type: 'progress', kind: 'location' }],
            snapshots: [],
            t0: T0,
            oldPid: OLD,
            now: T0 + 1_000,
            timeoutMs: 60_000,
        });
        expect(pending.status).toBe('pending');
        const timedOut = verifyOutcome({
            events: [{ t: T0 + 1_000, pid: NEW, type: 'progress', kind: 'location' }],
            snapshots: [snap(T0 + 2_000, 100), snap(T0 + 3_000, 100)],
            t0: T0,
            oldPid: OLD,
            now: T0 + 60_000,
            timeoutMs: 60_000,
        });
        expect(timedOut.status).toBe('failure');
    });

    test('a valid snapshot xp increase from the new pid succeeds', () => {
        const result = verifyOutcome({
            events: [],
            snapshots: [snap(T0 + 10_000, 1000), snap(T0 + 20_000, 1500)],
            t0: T0,
            oldPid: OLD,
            now: T0 + 20_000,
            timeoutMs: 60_000,
        });
        expect(result.status).toBe('success');
        if (result.status === 'success') expect(result.evidence).toContain('fishing');
    });
});
