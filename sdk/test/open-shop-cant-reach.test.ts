import { describe, expect, test } from 'bun:test';
import { BotSDK } from '../index';
import { BotActions } from '../actions';

describe('openShop cant_reach', () => {
    test('returns reason cant_reach when the walk fails', async () => {
        const sdk = Object.create(BotSDK.prototype) as BotSDK;
        const npc = {
            name: 'Bob',
            index: 3,
            x: 3232,
            z: 3203,
            distance: 8,
            optionsWithIndex: [{ text: 'Trade', opIndex: 1 }],
        };
        (sdk as any).getState = () => ({
            nearbyNpcs: [npc],
            shop: { isOpen: false },
            dialog: { isOpen: false, options: [] },
            interface: { isOpen: false },
            bank: { isOpen: false },
            gameMessages: [],
            player: { worldX: 3222, worldZ: 3218, level: 0 },
        });
        (sdk as any).waitForTicks = async () => {};

        const bot = new BotActions(sdk);
        (bot as any).dismissBlockingUI = async () => {};
        (bot as any).helpers.resolveNpc = () => npc;
        (bot as any).helpers.withDoorRetry = async (fn: () => Promise<any>, retry: (r: any) => boolean) => {
            const result = await fn();
            expect(retry(result)).toBe(true);
            return result;
        };
        (bot as any).walkTo = async () => ({ success: false, message: "Can't reach Bob" });

        const result = await bot.openShop(/bob/i);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('cant_reach');
    });
});
