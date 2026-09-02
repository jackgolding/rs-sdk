import { describe, expect, test } from 'bun:test';
import { ActivitySession } from '../activity';
import type { BotSDK } from '../index';
import type { BotActions } from '../actions';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const TMP = join(import.meta.dir, '.heartbeat-test.log');

function mockPair() {
    const sdk = {
        getState: () => ({ player: { worldX: 1, worldZ: 2, level: 0 } }),
        getSkills: () => [{ name: 'fishing', experience: 5000, level: 40 }],
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
    return { sdk, bot };
}

describe('ActivitySession heartbeat', () => {
    test('writes first heartbeat at session start', () => {
        try {
            unlinkSync(TMP);
        } catch {
            /* ignore */
        }
        const { sdk, bot } = mockPair();
        new ActivitySession(sdk, bot, {
            name: 'fishing-route',
            heartbeatPath: TMP,
            heartbeatMs: 60_000,
            writeLog: () => {},
        });
        expect(existsSync(TMP)).toBe(true);
        const lines = readFileSync(TMP, 'utf-8').trim().split('\n');
        const record = JSON.parse(lines[0]!);
        expect(record.job).toBe('fishing-route');
        expect(record.xp.fishing).toBe(5000);
        unlinkSync(TMP);
    });

    test('maybeHeartbeat respects interval', () => {
        try {
            unlinkSync(TMP);
        } catch {
            /* ignore */
        }
        let now = 1_000_000;
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'test',
            heartbeatPath: TMP,
            heartbeatMs: 300_000,
            now: () => now,
            writeLog: () => {},
        });
        const afterStart = readFileSync(TMP, 'utf-8').trim().split('\n').length;
        now += 100_000;
        session.maybeHeartbeat();
        expect(readFileSync(TMP, 'utf-8').trim().split('\n').length).toBe(afterStart);
        now += 250_000;
        session.maybeHeartbeat();
        expect(readFileSync(TMP, 'utf-8').trim().split('\n').length).toBe(afterStart + 1);
        unlinkSync(TMP);
    });

    test('finalizeStop writes final heartbeat on stop', async () => {
        try {
            unlinkSync(TMP);
        } catch {
            /* ignore */
        }
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'test',
            heartbeatPath: TMP,
            heartbeatMs: 300_000,
            writeLog: () => {},
        });
        session.stop('out_of_food', 'empty');
        await session.finalizeStop();
        const lines = readFileSync(TMP, 'utf-8').trim().split('\n');
        expect(lines.length).toBeGreaterThanOrEqual(1);
        unlinkSync(TMP);
    });
});
