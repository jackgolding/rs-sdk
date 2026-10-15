import { describe, expect, test } from 'bun:test';
import { ActivitySession, RESTARTABLE_EXIT_CODE } from '../activity';
import type { BotSDK } from '../index';
import type { BotActions } from '../actions';

function mockPair() {
    const state = { tradeDeclined: false, interfaceClosed: false };
    const sdk = {
        getState: () => ({
            player: { worldX: 100, worldZ: 200, level: 0 },
        }),
        getSkills: () => [{ name: 'thieving', experience: 1000, level: 10 }],
        getInventory: () => [],
        showIntent: async () => ({ success: true }),
        sendWalk: async () => ({ success: true }),
    } as unknown as BotSDK;
    const bot = {
        declineTrade: async () => {
            state.tradeDeclined = true;
            return { success: true };
        },
        closeInterface: async () => {
            state.interfaceClosed = true;
            return { success: true };
        },
        dismissBlockingUI: async () => {},
        walkTo: async () => ({ success: true }),
    } as unknown as BotActions;
    return { sdk, bot, get tradeDeclined() { return state.tradeDeclined; }, get interfaceClosed() { return state.interfaceClosed; } };
}

describe('ActivitySession exit semantics', () => {
    test('recovery_exhausted is restartable with exit code 70', () => {
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, { name: 'test', writeLog: () => {} });
        session.stop('recovery_exhausted', 'budget gone', { restartable: true });
        expect(session.exitCode()).toBe(RESTARTABLE_EXIT_CODE);
        expect(session.metrics().stopReason?.restartable).toBe(true);
    });

    test('script_error is restartable by default so KeepAlive revives overnight jobs', () => {
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, { name: 'test', writeLog: () => {} });
        session.stop('script_error', 'waitForConnection timed out');
        expect(session.exitCode()).toBe(RESTARTABLE_EXIT_CODE);
        expect(session.metrics().stopReason?.restartable).toBe(true);
    });

    test('cannot_regear is terminal with exit code 0', () => {
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, { name: 'test', writeLog: () => {} });
        session.stop('cannot_regear', 'no pickaxe in bank');
        expect(session.exitCode()).toBe(0);
        expect(session.metrics().stopReason?.restartable).toBe(false);
    });

    test('finalizeStop runs safe-park and sets process.exitCode for restartable stop', async () => {
        const mocks = mockPair();
        const session = new ActivitySession(mocks.sdk, mocks.bot, { name: 'test', writeLog: () => {} });
        session.stopRestartable('recovery_exhausted', 'done');
        const prev = process.exitCode;
        await session.finalizeStop();
        expect(mocks.tradeDeclined).toBe(true);
        expect(mocks.interfaceClosed).toBe(true);
        expect(process.exitCode).toBe(RESTARTABLE_EXIT_CODE);
        process.exitCode = prev ?? 0;
    });

    test('park failure still exits restartable', async () => {
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'test',
            writeLog: () => {},
            park: { name: 'park', run: async () => { throw new Error('fail'); } },
        });
        session.stopRestartable('recovery_exhausted', 'done');
        const prev = process.exitCode;
        await session.finalizeStop();
        expect(process.exitCode).toBe(RESTARTABLE_EXIT_CODE);
        process.exitCode = prev ?? 0;
    });
});

describe('ActivitySession controller watch', () => {
    function mockConnectedPair() {
        const listeners: Array<(state: string, attempt?: number) => void> = [];
        const { sdk, bot } = mockPair();
        const connected = {
            ...sdk,
            onConnectionStateChange(listener: (state: string, attempt?: number) => void) {
                listeners.push(listener);
                return () => {
                    const i = listeners.indexOf(listener);
                    if (i >= 0) listeners.splice(i, 1);
                };
            },
        } as unknown as BotSDK;
        return {
            sdk: connected,
            bot,
            emit(state: string) {
                for (const listener of [...listeners]) listener(state);
            },
        };
    }

    test('permanent disconnect waits out the give-up window before exiting 70', () => {
        let next = 1;
        const intervals: { id: number; ms: number; fn: () => void }[] = [];
        const timer = {
            setInterval(fn: () => void, ms: number) {
                const id = next++;
                intervals.push({ id, ms, fn });
                return id;
            },
            clearInterval(id: unknown) {
                const index = intervals.findIndex((item) => item.id === id);
                if (index >= 0) intervals.splice(index, 1);
            },
        };
        const { sdk, bot, emit } = mockConnectedPair();
        const exits: number[] = [];
        const session = new ActivitySession(sdk, bot, {
            name: 'test',
            writeLog: () => {},
            timer,
            reconnectGiveUpMs: 90_000,
            exitProcess: (code) => exits.push(code),
        });
        emit('disconnected');
        expect(session.isStopped()).toBe(false);
        expect(exits).toEqual([]);
        for (const item of [...intervals]) {
            if (item.ms === 90_000) item.fn();
        }
        expect(session.metrics().stopReason?.code).toBe('controller_lost');
        expect(session.exitCode()).toBe(RESTARTABLE_EXIT_CODE);
        expect(exits).toEqual([RESTARTABLE_EXIT_CODE]);
    });

    test('reconnecting does not exit until the give-up timer fires', () => {
        let next = 1;
        const intervals: { id: number; ms: number; fn: () => void }[] = [];
        const timer = {
            setInterval(fn: () => void, ms: number) {
                const id = next++;
                intervals.push({ id, ms, fn });
                return id;
            },
            clearInterval(id: unknown) {
                const index = intervals.findIndex((item) => item.id === id);
                if (index >= 0) intervals.splice(index, 1);
            },
        };
        const { sdk, bot, emit } = mockConnectedPair();
        const exits: number[] = [];
        const session = new ActivitySession(sdk, bot, {
            name: 'test',
            writeLog: () => {},
            timer,
            reconnectGiveUpMs: 90_000,
            exitProcess: (code) => exits.push(code),
        });
        emit('reconnecting');
        expect(session.isStopped()).toBe(false);
        expect(exits).toEqual([]);
        for (const item of [...intervals]) {
            if (item.ms === 90_000) item.fn();
        }
        expect(session.metrics().stopReason?.code).toBe('controller_lost');
        expect(exits).toEqual([RESTARTABLE_EXIT_CODE]);
    });

    test('stale SDK state waits out the give-up window before exiting 70', () => {
        let now = 1_000;
        let age = 1_000;
        const { sdk, bot } = mockPair();
        const live = {
            ...sdk,
            getStateAge: () => age,
            getStateReceivedAt: () => now - age,
        } as unknown as BotSDK;
        let next = 1;
        const intervals: { id: number; ms: number; fn: () => void }[] = [];
        const timer = {
            setInterval(fn: () => void, ms: number) {
                const id = next++;
                intervals.push({ id, ms, fn });
                return id;
            },
            clearInterval(id: unknown) {
                const index = intervals.findIndex((item) => item.id === id);
                if (index >= 0) intervals.splice(index, 1);
            },
        };
        const exits: number[] = [];
        const session = new ActivitySession(live, bot, {
            name: 'test',
            writeLog: () => {},
            now: () => now,
            timer,
            staleStateMs: 90_000,
            reconnectGiveUpMs: 90_000,
            exitProcess: (code) => exits.push(code),
        });
        for (const item of [...intervals]) {
            if (item.ms === 15_000) item.fn();
        }
        expect(session.isStopped()).toBe(false);
        age = 90_001;
        for (const item of [...intervals]) {
            if (item.ms === 15_000) item.fn();
        }
        expect(session.isStopped()).toBe(false);
        expect(exits).toEqual([]);
        for (const item of [...intervals]) {
            if (item.ms === 90_000) item.fn();
        }
        expect(session.metrics().stopReason?.code).toBe('controller_lost');
        expect(exits).toEqual([RESTARTABLE_EXIT_CODE]);
    });

    test('a successful reconnect cancels the give-up timer', () => {
        let next = 1;
        const intervals: { id: number; ms: number; fn: () => void }[] = [];
        const timer = {
            setInterval(fn: () => void, ms: number) {
                const id = next++;
                intervals.push({ id, ms, fn });
                return id;
            },
            clearInterval(id: unknown) {
                const index = intervals.findIndex((item) => item.id === id);
                if (index >= 0) intervals.splice(index, 1);
            },
        };
        const { sdk, bot, emit } = mockConnectedPair();
        const exits: number[] = [];
        const session = new ActivitySession(sdk, bot, {
            name: 'test',
            writeLog: () => {},
            timer,
            reconnectGiveUpMs: 90_000,
            exitProcess: (code) => exits.push(code),
        });
        emit('reconnecting');
        emit('connected');
        for (const item of [...intervals]) {
            if (item.ms === 90_000) item.fn();
        }
        expect(session.isStopped()).toBe(false);
        expect(exits).toEqual([]);
    });
});
