import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ActivitySession, parkPathFor, readParkRecord } from '../activity';
import type { BotSDK } from '../index';
import type { BotActions } from '../actions';

function mockPair() {
    const sdk = {
        getState: () => ({
            player: { worldX: 3092, worldZ: 3243, level: 0 },
            skills: [],
            inventory: [],
        }),
        getSkills: () => [],
        getSkill: () => undefined,
        getInventory: () => [],
        getStateAge: () => 0,
        isConnected: () => true,
        waitForConnection: async () => {},
        showIntent: async () => ({ success: true, message: 'ok' }),
    } as unknown as BotSDK;
    const bot = {
        dismissBlockingUI: async () => {},
    } as unknown as BotActions;
    return { sdk, bot };
}

function finish(session: ActivitySession): void {
    session.stop('stopped', 'test done', { restartable: false });
}

describe('ActivitySession safe stop', () => {
    test('requestStop flags a drain without stopping the loop', () => {
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, { name: 'drain', now: () => 1_000, writeLog: () => {} });
        expect(session.stopRequested).toBe(false);
        expect(session.isStoppedOrRequested()).toBe(false);
        session.requestStop('SIGTERM');
        expect(session.stopRequested).toBe(true);
        expect(session.isStoppedOrRequested()).toBe(true);
        expect(session.isStopped()).toBe(false);
        session.requestStop('SIGTERM');
        finish(session);
    });

    test('requestStopAll reaches every live session', () => {
        const a = new ActivitySession(mockPair().sdk, mockPair().bot, {
            name: 'drain-a',
            now: () => 1_000,
            writeLog: () => {},
        });
        const b = new ActivitySession(mockPair().sdk, mockPair().bot, {
            name: 'drain-b',
            now: () => 1_000,
            writeLog: () => {},
        });
        ActivitySession.requestStopAll('SIGTERM');
        expect(a.stopRequested).toBe(true);
        expect(b.stopRequested).toBe(true);
        finish(a);
        finish(b);
    });

    test('drainToBank banks immediately when already bankable', async () => {
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, { name: 'drain', now: () => 1_000, writeLog: () => {} });
        let stages = 0;
        const outcome = await session.drainToBank(async () => true, {
            deadlineMs: 1_000,
            onStage: async () => {
                stages++;
            },
        });
        expect(outcome).toBe('banked');
        expect(stages).toBe(0);
        finish(session);
    });

    test('drainToBank runs one more stage, then banks', async () => {
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, { name: 'drain', now: () => 1_000, writeLog: () => {} });
        let attempts = 0;
        let stages = 0;
        const outcome = await session.drainToBank(async () => ++attempts >= 2, {
            deadlineMs: 60_000,
            onStage: async () => {
                stages++;
            },
        });
        expect(outcome).toBe('banked');
        expect(stages).toBe(1);
        finish(session);
    });

    test('drainToBank times out instead of hanging', async () => {
        let now = 1_000;
        const dir = mkdtempSync(join(tmpdir(), 'park-'));
        const grindLog = join(dir, 'grind.log');
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'drain',
            grindLogPath: grindLog,
            now: () => now,
            writeLog: () => {},
        });
        const outcome = await session.drainToBank(
            async () => {
                now += 1_000;
                return false;
            },
            { deadlineMs: 2_500, onStage: async () => {} }
        );
        expect(outcome).toBe('timeout');
        // Mid-drain checkpoints leave an unbanked position for the next job.
        const park = readParkRecord(grindLog);
        expect(park).not.toBeNull();
        expect(park!.banked).toBe(false);
        finish(session);
    });

    test('finalizeStop writes a banked park record the next job can route from', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'park-'));
        const grindLog = join(dir, 'grind.log');
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'drain',
            grindLogPath: grindLog,
            now: () => 1_000,
            writeLog: () => {},
        });
        session.requestStop('SIGTERM');
        expect(await session.drainToBank(async () => true, { deadlineMs: 1_000 })).toBe('banked');
        session.stop('stopped', 'drained to bank: banked', { restartable: false });
        await session.finalizeStop();
        expect(process.exitCode).toBe(0);
        process.exitCode = undefined;
        const park = readParkRecord(grindLog);
        expect(park).not.toBeNull();
        expect(park!.banked).toBe(true);
        expect(park!.x).toBe(3092);
        expect(park!.z).toBe(3243);
        expect(readFileSync(parkPathFor(grindLog), 'utf-8')).toContain('"banked":true');
    });

    test('readParkRecord is null without a park file', () => {
        const dir = mkdtempSync(join(tmpdir(), 'park-'));
        expect(readParkRecord(join(dir, 'grind.log'))).toBeNull();
    });
});
