import { describe, expect, test } from 'bun:test';
import { ActivitySession } from '../activity';
import type { BotSDK } from '../index';
import type { BotActions } from '../actions';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const TMP = join(import.meta.dir, '.heartbeat-test.log');

interface FakeTimer {
    setInterval: (fn: () => void, ms: number) => number;
    clearInterval: (id: unknown) => void;
    fire: (ms: number) => void;
    cleared: number[];
}

function fakeTimer(): FakeTimer {
    let next = 1;
    const intervals: { id: number; ms: number; fn: () => void }[] = [];
    const cleared: number[] = [];
    return {
        cleared,
        setInterval(fn, ms) {
            const id = next++;
            intervals.push({ id, ms, fn });
            return id;
        },
        clearInterval(id) {
            cleared.push(id as number);
            const index = intervals.findIndex((item) => item.id === id);
            if (index >= 0) intervals.splice(index, 1);
        },
        fire(ms) {
            for (const item of [...intervals]) {
                if (item.ms === ms) item.fn();
            }
        },
    };
}

function mockPair(initial?: { skills?: { name: string; experience: number; level: number }[]; x?: number; z?: number }) {
    const world = {
        skills: initial?.skills ?? [
            { name: 'Hitpoints', experience: 1154, level: 10 },
            { name: 'fishing', experience: 5000, level: 40 },
        ],
        x: initial?.x ?? 2840,
        z: initial?.z ?? 3430,
    };
    const sdk = {
        getState: () => ({ player: { worldX: world.x, worldZ: world.z, level: 0 } }),
        getSkills: () => world.skills,
        getInventory: () => [{ name: 'Coins', count: 100 }],
        showIntent: async () => ({ success: true }),
        sendWalk: async () => ({ success: true }),
    } as unknown as BotSDK;
    const bot = {
        closeInterface: async () => ({ success: true }),
        dismissBlockingUI: async () => {},
        walkTo: async () => ({ success: true }),
        declineTrade: async () => ({ success: true }),
    } as unknown as BotActions;
    return { sdk, bot, world };
}

function records(): Array<Record<string, unknown>> {
    if (!existsSync(TMP)) return [];
    return readFileSync(TMP, 'utf-8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('ActivitySession heartbeat', () => {
    test('does not write while skills are empty or the position is 0,0', () => {
        try {
            unlinkSync(TMP);
        } catch {
            /* ignore */
        }
        const timer = fakeTimer();
        const empty = mockPair({ skills: [], x: 2840, z: 3430 });
        new ActivitySession(empty.sdk, empty.bot, {
            name: 'fishing-route',
            heartbeatPath: TMP,
            heartbeatMs: 60_000,
            timer,
            writeLog: () => {},
        });
        timer.fire(1_000);
        expect(existsSync(TMP)).toBe(false);

        const origin = mockPair({ x: 0, z: 0 });
        const timer2 = fakeTimer();
        new ActivitySession(origin.sdk, origin.bot, {
            name: 'fishing-route',
            heartbeatPath: TMP,
            heartbeatMs: 60_000,
            timer: timer2,
            writeLog: () => {},
        });
        timer2.fire(1_000);
        expect(existsSync(TMP)).toBe(false);
    });

    test('writes the first valid record once skills arrive', () => {
        try {
            unlinkSync(TMP);
        } catch {
            /* ignore */
        }
        const timer = fakeTimer();
        const { sdk, bot, world } = mockPair({ skills: [], x: 2840, z: 3430 });
        new ActivitySession(sdk, bot, {
            name: 'fishing-route',
            heartbeatPath: TMP,
            heartbeatMs: 60_000,
            timer,
            writeLog: () => {},
        });
        timer.fire(1_000);
        expect(existsSync(TMP)).toBe(false);
        world.skills = [
            { name: 'Hitpoints', experience: 1154, level: 10 },
            { name: 'fishing', experience: 5000, level: 40 },
        ];
        timer.fire(1_000);
        const written = records();
        expect(written).toHaveLength(1);
        expect(written[0]!.job).toBe('fishing-route');
        expect((written[0]!.xp as { fishing: number }).fishing).toBe(5000);
        expect(written[0]!.levels).toEqual({ Hitpoints: 10, fishing: 40 });
        unlinkSync(TMP);
    });

    test('timer keeps writing while a script promise never resolves', () => {
        try {
            unlinkSync(TMP);
        } catch {
            /* ignore */
        }
        const timer = fakeTimer();
        const { sdk, bot } = mockPair();
        new ActivitySession(sdk, bot, {
            name: 'fishing-route',
            heartbeatPath: TMP,
            heartbeatMs: 300_000,
            timer,
            writeLog: () => {},
        });
        const hung = new Promise(() => {});
        void hung;
        timer.fire(300_000);
        timer.fire(300_000);
        expect(records().length).toBeGreaterThanOrEqual(2);
        unlinkSync(TMP);
    });

    test('records carry pid, phase, progress clocks, recoveries, and stopped', async () => {
        try {
            unlinkSync(TMP);
        } catch {
            /* ignore */
        }
        let now = 5_000;
        const timer = fakeTimer();
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'fishing-route',
            heartbeatPath: TMP,
            heartbeatMs: 300_000,
            timer,
            now: () => now,
            writeLog: () => {},
        });
        await session.setPhase('fish');
        session.noteProgress('xp', 'catch');
        timer.fire(300_000);
        const record = records().at(-1)!;
        expect(record.pid).toBe(process.pid);
        expect(record.phase).toBe('fish');
        expect(record.lastProgressAt).toBe(now);
        expect(record.lastEffectAt).toBe(now);
        expect(record.recoveries).toBe(0);
        expect(record.stopped).toBeNull();
        unlinkSync(TMP);
    });

    test('maybeHeartbeat is a no-op while the timer is active', () => {
        try {
            unlinkSync(TMP);
        } catch {
            /* ignore */
        }
        const timer = fakeTimer();
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'test',
            heartbeatPath: TMP,
            heartbeatMs: 300_000,
            timer,
            writeLog: () => {},
        });
        session.maybeHeartbeat();
        expect(existsSync(TMP)).toBe(false);
        timer.fire(300_000);
        expect(records()).toHaveLength(1);
        unlinkSync(TMP);
    });

    test('finalizeStop clears the timer and writes one final record', async () => {
        try {
            unlinkSync(TMP);
        } catch {
            /* ignore */
        }
        const timer = fakeTimer();
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'test',
            heartbeatPath: TMP,
            heartbeatMs: 300_000,
            timer,
            writeLog: () => {},
        });
        session.stop('out_of_food', 'empty');
        await session.finalizeStop();
        expect(timer.cleared.length).toBeGreaterThan(0);
        const written = records();
        expect(written.length).toBeGreaterThanOrEqual(1);
        expect(written.at(-1)!.stopped).toBe('out_of_food');
        timer.fire(300_000);
        expect(records()).toHaveLength(written.length);
        unlinkSync(TMP);
    });
});
