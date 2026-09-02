import { describe, expect, test } from 'bun:test';
import { ActivitySession } from '../activity';
import type { BotSDK } from '../index';
import type { BotActions } from '../actions';

function mockSession(tactics: Array<{ name: string; maxConsecutive?: number; run: () => Promise<boolean> }>) {
    const calls: string[] = [];
    let i = 0;
    const sdk = {
        getState: () => ({ player: { worldX: 0, worldZ: 0, level: 0 } }),
        showIntent: async () => ({ success: true }),
        sendWalk: async () => ({ success: true }),
    } as unknown as BotSDK;
    const bot = {
        closeInterface: async () => ({ success: true }),
        dismissBlockingUI: async () => {},
        walkTo: async () => ({ success: true }),
        declineTrade: async () => ({ success: true }),
    } as unknown as BotActions;
    const session = new ActivitySession(sdk, bot, {
        name: 'thieving',
        maxRecoveryTactics: 20,
        recoveryBudgetMs: 600_000,
        now: () => 1_000,
        writeLog: () => {},
    });
    session.registerRecovery(
        tactics.map((t) => ({
            name: t.name,
            maxConsecutive: t.maxConsecutive ?? 2,
            run: async () => {
                calls.push(t.name);
                return t.run();
            },
        }))
    );
    return { session, calls };
}

describe('maxConsecutive tactic bound', () => {
    test('same tactic never exceeds maxConsecutive before advancing', async () => {
        const { session, calls } = mockSession([
            { name: 'recover_stun', maxConsecutive: 2, run: async () => false },
            { name: 'return_ardougne', maxConsecutive: 2, run: async () => true },
        ]);
        session.noteFailure('pick', 'fail');
        for (let n = 0; n < 5; n++) session.noteFailure('pick', 'fail');
        await session.recover();
        const stunCount = calls.filter((c) => c === 'recover_stun').length;
        expect(stunCount).toBeLessThanOrEqual(2);
        expect(calls).toContain('return_ardougne');
    });
});
