/**
 * Logic test for sdk.clickDialogByText() — no bot required.
 *
 * Verifies the helper resolves dialog options by visible text and dispatches
 * the server-assigned (1-based) index, sidestepping the array-position
 * footgun that exists with raw sendClickDialog().
 */

import { describe, expect, test } from 'bun:test';
import { BotSDK } from '../index';
import type { ActionResult, BotWorldState, DialogOption } from '../types';

function makeOption(index: number, text: string): DialogOption {
    return { index, text, componentId: 1000 + index, buttonType: 0 };
}

function makeState(opts: { dialogOpen: boolean; options?: DialogOption[] }): BotWorldState {
    // Only the dialog field matters — cast the rest. clickDialogByText only
    // touches state.dialog.
    return {
        dialog: {
            isOpen: opts.dialogOpen,
            options: opts.options ?? [],
            isWaiting: false,
        },
    } as unknown as BotWorldState;
}

function mountSdk(state: BotWorldState | null): { sdk: BotSDK; calls: number[] } {
    const sdk = new BotSDK({ botUsername: 'test' });
    (sdk as any).state = state;

    // Stub the protocol-level call so we can record what the helper dispatches.
    const calls: number[] = [];
    (sdk as any).sendClickDialog = async (option: number): Promise<ActionResult> => {
        calls.push(option);
        return { success: true, message: 'stub-clicked' };
    };

    return { sdk, calls };
}

describe('clickDialogByText()', () => {
    test('returns no_dialog when dialog is closed', async () => {
        const { sdk, calls } = mountSdk(makeState({ dialogOpen: false }));
        const r = await sdk.clickDialogByText(/yes/i);

        expect(r.success).toBe(false);
        expect(r.reason).toBe('no_dialog');
        expect(calls).toEqual([]);
    });

    test('returns no_dialog when state is null', async () => {
        const { sdk, calls } = mountSdk(null);
        const r = await sdk.clickDialogByText(/yes/i);

        expect(r.success).toBe(false);
        expect(r.reason).toBe('no_dialog');
        expect(calls).toEqual([]);
    });

    // The core footgun fix: array position 0 maps to server index 1.
    test('dispatches server-assigned index 1 for first option (NOT array position 0)', async () => {
        const options = [makeOption(1, 'Yes, ok.'), makeOption(2, 'No thanks.')];
        const { sdk, calls } = mountSdk(makeState({ dialogOpen: true, options }));
        const r = await sdk.clickDialogByText(/yes/i);

        expect(r.success).toBe(true);
        expect(calls).toEqual([1]);
    });

    test('dispatches index 2 for the alleyway option', async () => {
        const options = [
            makeOption(1, 'Yes, ok.'),
            makeOption(2, 'Is there anything down this alleyway?'),
            makeOption(3, 'No thanks.'),
        ];
        const { sdk, calls } = mountSdk(makeState({ dialogOpen: true, options }));
        const r = await sdk.clickDialogByText('alleyway');

        expect(r.success).toBe(true);
        expect(calls).toEqual([2]);
    });

    test('string pattern is case-insensitive', async () => {
        const options = [makeOption(1, 'Yes, ok.'), makeOption(2, 'No thanks.')];
        const { sdk, calls } = mountSdk(makeState({ dialogOpen: true, options }));
        const r = await sdk.clickDialogByText('YES');

        expect(r.success).toBe(true);
        expect(calls).toEqual([1]);
    });

    // Caller-supplied RegExp flags are respected — no /i means no match on "Yes".
    test('explicit RegExp without /i is honoured (no match)', async () => {
        const options = [makeOption(1, 'Yes, ok.'), makeOption(2, 'No thanks.')];
        const { sdk, calls } = mountSdk(makeState({ dialogOpen: true, options }));
        const r = await sdk.clickDialogByText(/YES/);

        expect(r.success).toBe(false);
        expect(r.reason).toBe('no_match');
        expect(calls).toEqual([]);
    });

    test('returns no_match when no option matches, listing available options', async () => {
        const options = [makeOption(1, 'Yes, ok.'), makeOption(2, 'No thanks.')];
        const { sdk, calls } = mountSdk(makeState({ dialogOpen: true, options }));
        const r = await sdk.clickDialogByText(/maybe/i);

        expect(r.success).toBe(false);
        expect(r.reason).toBe('no_match');
        expect(r.message).toContain('Yes, ok.');
        expect(r.message).toContain('No thanks.');
        expect(calls).toEqual([]);
    });

    test('returns no_match when option list is empty', async () => {
        const { sdk, calls } = mountSdk(makeState({ dialogOpen: true, options: [] }));
        const r = await sdk.clickDialogByText(/anything/);

        expect(r.success).toBe(false);
        expect(r.reason).toBe('no_match');
        expect(r.message).toContain('(none)');
        expect(calls).toEqual([]);
    });

    // Real dialogs assign 1..N contiguously today, but the SDK must never
    // assume that — it has to trust DialogOption.index.
    test('passes through non-contiguous server-assigned indices', async () => {
        const options = [makeOption(7, 'Yes, ok.'), makeOption(42, 'Tell me more.')];
        const { sdk, calls } = mountSdk(makeState({ dialogOpen: true, options }));
        const r = await sdk.clickDialogByText(/tell me/i);

        expect(r.success).toBe(true);
        expect(calls).toEqual([42]);
    });

    test('string patterns treat ? as literal so 20 coins does not hit 5 coins', async () => {
        const options = [
            makeOption(1, 'How about 5 coins?'),
            makeOption(2, 'How about 10 coins?'),
            makeOption(3, 'How about 15 coins?'),
            makeOption(4, 'How about 20 coins?'),
        ];
        const { sdk, calls } = mountSdk(makeState({ dialogOpen: true, options }));
        const r = await sdk.clickDialogByText('How about 20 coins?');

        expect(r.success).toBe(true);
        expect(calls).toEqual([4]);
    });

    test('prefers the OK twin when CONTINUE and OK share a label', async () => {
        const options = [
            { index: 1, text: 'How about 20 coins?', componentId: 1, buttonType: 2 },
            { index: 2, text: 'How about 20 coins?', componentId: 2, buttonType: 1 },
        ];
        const { sdk, calls } = mountSdk(makeState({ dialogOpen: true, options }));
        const r = await sdk.clickDialogByText(/how about 20 coins/i);

        expect(r.success).toBe(true);
        expect(calls).toEqual([2]);
    });
});
