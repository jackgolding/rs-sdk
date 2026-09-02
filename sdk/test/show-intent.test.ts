import { describe, expect, test } from 'bun:test';
import { BotSDK } from '../index';

describe('showIntent', () => {
    function sdkWithDispatch() {
        const sdk = Object.create(BotSDK.prototype) as BotSDK;
        const sent: Array<{ type: string; message: string; reason: string }> = [];
        (sdk as any).lastIntentLine = '';
        (sdk as any).sendAction = async (action: any) => {
            sent.push(action);
            return { success: true, message: action.message };
        };
        return { sdk, sent };
    }

    test('skips empty lines', async () => {
        const { sdk, sent } = sdkWithDispatch();
        const result = await sdk.showIntent('   \n');
        expect(result.success).toBe(true);
        expect(sent).toEqual([]);
    });

    test('dedupes the last shown line', async () => {
        const { sdk, sent } = sdkWithDispatch();
        await sdk.showIntent('Picking flax');
        await sdk.showIntent('Picking flax');
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ type: 'localChat', reason: 'intent', message: 'Picking flax' });
    });

    test('collapses newlines and trims to 80 chars', async () => {
        const { sdk, sent } = sdkWithDispatch();
        const long = `${'a'.repeat(90)}\nmore`;
        await sdk.showIntent(long);
        expect(sent[0]!.message).toHaveLength(80);
        expect(sent[0]!.message.includes('\n')).toBe(false);
    });
});
