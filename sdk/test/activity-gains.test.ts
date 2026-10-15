import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ActivitySession } from '../activity';
import { readJsonlTail } from '../grind-log';
import type { BotSDK } from '../index';
import type { BotActions } from '../actions';

function mockPair(bankOpen = false) {
    const sdk = {
        getState: () => ({
            player: { worldX: 2840, worldZ: 3430, level: 0 },
            bank: bankOpen
                ? { isOpen: true, items: [{ slot: 0, id: 1, name: 'Raw shark', count: 10 }] }
                : { isOpen: false, items: [] },
        }),
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

describe('ActivitySession gains', () => {
    test('records each kept stack once and ignores a zero count', () => {
        const lines: string[] = [];
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'shark',
            jobKey: 'bots/quests/fishing-route.ts --shark',
            now: () => 1_700_000_000_000,
            gainsWrite: (line) => lines.push(line),
            heartbeatMs: 0,
        });
        session.recordGain('Cooked shark', 8);
        session.recordGain('Raw shark', 2);
        session.recordGain('Burnt shark', 0);
        session.recordGain('  ', 4);
        expect(lines).toHaveLength(2);
        const rows = lines.map((line) => JSON.parse(line) as { item: string; count: number; jobKey: string });
        expect(rows[0]).toMatchObject({ item: 'Cooked shark', count: 8, jobKey: 'bots/quests/fishing-route.ts --shark' });
        expect(rows[1]).toMatchObject({ item: 'Raw shark', count: 2 });
    });

    test('a failed gain write warns once and does not throw', () => {
        const logs: string[] = [];
        const { sdk, bot } = mockPair();
        const session = new ActivitySession(sdk, bot, {
            name: 'shark',
            jobKey: 'bots/quests/fishing-route.ts --shark',
            heartbeatMs: 0,
            writeLog: (line) => logs.push(line),
            gainsWrite: () => {
                throw new Error('disk full');
            },
        });
        expect(() => session.recordGain('Shark', 1)).not.toThrow();
        expect(() => session.recordGain('Shark', 1)).not.toThrow();
        expect(logs.filter((line) => line.includes('gain write failed'))).toHaveLength(1);
    });

    test('captures an open bank once per hour and skips a closed bank', () => {
        const root = mkdtempSync(join(tmpdir(), 'bank-stock-'));
        const prev = process.env.BOT_USERNAME;
        process.env.BOT_USERNAME = 'Jackpoo3';
        try {
            const closed = mockPair(false);
            const closedSession = new ActivitySession(closed.sdk, closed.bot, {
                name: 'shark',
                heartbeatMs: 0,
                stockRoot: root,
                now: () => Date.parse('2026-10-05T14:10:00'),
            });
            closedSession.captureBankStock();
            expect(readJsonlTail(join(root, 'bots', 'Jackpoo3', 'bank-stock.log'))).toHaveLength(0);

            const open = mockPair(true);
            const session = new ActivitySession(open.sdk, open.bot, {
                name: 'shark',
                heartbeatMs: 0,
                stockRoot: root,
                now: () => Date.parse('2026-10-05T14:10:00'),
            });
            session.captureBankStock();
            session.captureBankStock();
            const lines = readJsonlTail<{ hour: string; items: { name: string }[] }>(
                join(root, 'bots', 'Jackpoo3', 'bank-stock.log')
            );
            expect(lines).toHaveLength(1);
            expect(lines[0]!.items[0]!.name).toBe('Raw shark');
        } finally {
            if (prev === undefined) delete process.env.BOT_USERNAME;
            else process.env.BOT_USERNAME = prev;
        }
    });
});
