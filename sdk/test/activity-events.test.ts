import { describe, expect, test } from 'bun:test';
import { ActivitySession } from '../activity';
import type { BotSDK } from '../index';
import type { BotActions } from '../actions';

function mockPair() {
    const sdk = {
        getState: () => ({ player: { worldX: 2840, worldZ: 3430, level: 0 } }),
        getSkills: () => [{ name: 'Hitpoints', experience: 1154, level: 10 }],
        getInventory: () => [],
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

function parsed(lines: string[]): Array<Record<string, unknown>> {
    return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('ActivitySession events', () => {
    test('start, throttled progress, counted failures, one recovery per tactic, and stop', async () => {
        let now = 1_000;
        const lines: string[] = [];
        const logs: string[] = [];
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'fishing-route',
            now: () => now,
            eventsWrite: (line) => lines.push(line),
            writeLog: (line) => logs.push(line),
            maxRecoveryTactics: 8,
            stallMs: 10_000,
        });
        const events = () => parsed(lines);
        expect(events()[0]!.type).toBe('start');

        session.noteProgress('xp', 'cast');
        session.noteProgress('xp', 'cast');
        expect(events().filter((event) => event.type === 'progress' && event.kind === 'xp')).toHaveLength(1);
        now += 30_000;
        session.noteProgress('xp', 'cast');
        expect(events().filter((event) => event.type === 'progress' && event.kind === 'xp')).toHaveLength(2);

        for (let i = 0; i < 100; i++) session.noteFailure('bank', 'Could not open bank');
        const failures = events().filter((event) => event.type === 'failure' && event.code === 'bank');
        expect(failures).toHaveLength(100);
        expect(failures.at(-1)!.count).toBe(100);
        const warnLines = logs.filter((line) => line.includes('bank: Could not open bank'));
        expect(warnLines.length).toBeLessThan(100);

        session.registerRecovery([
            { name: 'custom_close', run: async () => false },
            { name: 'custom_ok', run: async () => true },
        ]);
        await session.recover();
        const tactics = events().filter((event) => event.type === 'recovery').map((event) => event.tactic);
        expect(tactics.filter((name) => name === 'custom_close')).toHaveLength(1);
        expect(tactics.filter((name) => name === 'custom_ok')).toHaveLength(1);

        session.stop('out_of_food', 'empty', { restartable: false });
        const stop = events().find((event) => event.type === 'stop');
        expect(stop?.code).toBe('out_of_food');
        expect(stop?.restartable).toBe(false);
    });
});
