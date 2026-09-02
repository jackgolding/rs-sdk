import { describe, expect, test } from 'bun:test';
import { ActivitySession } from '../activity';
import type { BotSDK } from '../index';
import type { BotActions } from '../actions';

function mockPair(pos = { worldX: 2744, worldZ: 3444 }) {
    const walks: Array<[number, number]> = [];
    const sendWalks: Array<[number, number]> = [];
    const walkTos: Array<[number, number]> = [];
    const sdk = {
        getState: () => ({
            player: { worldX: pos.worldX, worldZ: pos.worldZ, level: 0 },
        }),
        showIntent: async () => ({ success: true, message: 'ok' }),
        sendWalk: async (x: number, z: number) => {
            walks.push([x, z]);
            sendWalks.push([x, z]);
            return { success: true };
        },
    } as unknown as BotSDK;
    const bot = {
        closeInterface: async () => ({ success: true }),
        dismissBlockingUI: async () => {},
        walkTo: async (x: number, z: number) => {
            walks.push([x, z]);
            walkTos.push([x, z]);
            return { success: true, message: 'ok' };
        },
    } as unknown as BotActions;
    return { sdk, bot, walks, sendWalks, walkTos };
}

describe('ActivitySession', () => {
    test('stalls after 2 minutes without progress', () => {
        let now = 1_000;
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'bowstrings',
            now: () => now,
            writeLog: () => {},
        });
        expect(session.needsRecovery()).toBe(false);
        now += 119_999;
        expect(session.needsRecovery()).toBe(false);
        now += 2;
        expect(session.needsRecovery()).toBe(true);
    });

    test('stalls after 5 identical failures in the window', () => {
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'bowstrings',
            now: () => 5_000,
            writeLog: () => {},
        });
        for (let i = 0; i < 4; i++) session.noteFailure('bank', 'Could not open Seers bank');
        expect(session.needsRecovery()).toBe(false);
        session.noteFailure('bank', 'Could not open Seers bank');
        expect(session.needsRecovery()).toBe(true);
    });

    test('noteProgress clears the repeat-fail window so the loop can leave recovery', async () => {
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'essence',
            maxRecoveryTactics: 8,
            now: () => 5_000,
            writeLog: () => {},
        });
        session.registerRecovery([{ name: 'ok', run: async () => true }]);
        for (let i = 0; i < 5; i++) session.noteFailure('mine', 'No essence rock nearby');
        expect(session.needsRecovery()).toBe(true);
        expect(await session.recover()).toBe('resumed');
        expect(session.needsRecovery()).toBe(false);
    });

    test('recover resumes when a tactic reports progress and exhausts otherwise', async () => {
        const { sdk, bot, walks } = mockPair();
        let now = 1_000;
        const session = new ActivitySession(sdk, bot, {
            name: 'bowstrings',
            stallMs: 10,
            maxRecoveryTactics: 8,
            recoveryBudgetMs: 60_000,
            now: () => now,
            writeLog: () => {},
        });
        session.registerRecovery([
            { name: 'ok', run: async () => true },
        ]);
        now = 20;
        const resumed = await session.recover();
        expect(resumed).toBe('resumed');
        expect(session.isStopped()).toBe(false);

        let t2 = 0;
        const session2 = new ActivitySession(sdk, bot, {
            name: 'bowstrings',
            stallMs: 10,
            maxRecoveryTactics: 1,
            now: () => t2,
            writeLog: () => {},
        });
        t2 = 20;
        session2.registerRecovery([{ name: 'fail', run: async () => false }]);
        const exhausted = await session2.recover();
        expect(exhausted).toBe('exhausted');
        expect(session2.isStopped()).toBe(true);
        expect(session2.metrics().stopReason?.code).toBe('recovery_exhausted');

        walks.length = 0;
        const again = await session2.recover();
        expect(again).toBe('exhausted');
        expect(walks).toEqual([]);
    });

    test('samples repeated warn lines and never drops error', () => {
        const lines: string[] = [];
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'bowstrings',
            now: () => 1,
            writeLog: (line) => lines.push(line),
        });
        for (let i = 0; i < 12; i++) session.noteFailure('wheel', 'no wheel');
        const warns = lines.filter((l) => l.includes(' WARN '));
        expect(warns.length).toBeLessThan(12);
        expect(warns.length).toBeGreaterThanOrEqual(2);

        session.stop('recovery_exhausted', 'done');
        session.stop('recovery_exhausted', 'done');
        const errors = lines.filter((l) => l.includes(' ERROR '));
        expect(errors.length).toBe(1);
        expect(session.metrics().lastSeverity).toBe('error');
    });

    test('rewalk uses sendWalk in the wilderness instead of walkTo', async () => {
        const { sdk, bot, sendWalks, walkTos } = mockPair({ worldX: 3058, worldZ: 3814 });
        let now = 1_000;
        const session = new ActivitySession(sdk, bot, {
            name: 'rune-rocks',
            stallMs: 10,
            maxRecoveryTactics: 8,
            recoveryBudgetMs: 60_000,
            now: () => now,
            writeLog: () => {},
        });
        session.setAnchor(3058, 3884);
        session.registerRecovery([{ name: 'ok', run: async () => true }]);
        now = 20;
        expect(await session.recover()).toBe('resumed');
        expect(walkTos).toEqual([]);
        expect(sendWalks).toContainEqual([3058, 3884]);
    });
});
