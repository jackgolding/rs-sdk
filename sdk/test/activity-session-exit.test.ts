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
        process.exitCode = prev;
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
        process.exitCode = prev;
    });
});
