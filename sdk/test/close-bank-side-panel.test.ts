import { describe, expect, test } from 'bun:test';
import { BotSDK } from '../index';
import { BotActions } from '../actions';

/** bank.isOpen can stay true when the side inv still has items while mainModalId is -1. */
function makeSidePanelBankBot() {
    const sdk = Object.create(BotSDK.prototype) as BotSDK;
    let bankOpen = true;
    let interfaceOpen = false;
    const closed: string[] = [];

    (sdk as any).getState = () => ({
        tick: 1,
        player: { worldX: 3253, worldZ: 3420, x: 3253, z: 3420, level: 0, animId: -1 },
        dialog: { isOpen: false, options: [] },
        interface: { isOpen: interfaceOpen, interfaceId: 0 },
        shop: { isOpen: false },
        bank: { isOpen: bankOpen },
        inventory: [],
    });
    (sdk as any).sendCloseModal = async () => {
        closed.push('modal');
        bankOpen = false;
        interfaceOpen = false;
        return { success: true, message: 'closed' };
    };
    (sdk as any).waitForTicks = async () => {};
    (sdk as any).waitForCondition = async (pred: (s: any) => boolean) => {
        const s = (sdk as any).getState();
        if (pred(s)) return s;
        throw new Error('timeout');
    };

    const bot = new BotActions(sdk);
    return { bot, closed, setBankOpen: (v: boolean) => {
        bankOpen = v;
    } };
}

describe('closeBank side-panel desync', () => {
    test('closes when bank.isOpen is true but interface.isOpen is false', async () => {
        const { bot, closed } = makeSidePanelBankBot();
        const result = await bot.closeBank();
        expect(result.success).toBe(true);
        expect(closed).toContain('modal');
    });

    test('closeInterface alone would not close a side-panel-only bank', async () => {
        const { bot, closed } = makeSidePanelBankBot();
        const result = await bot.closeInterface();
        expect(result.success).toBe(true);
        expect(result.message).toContain('already closed');
        expect(closed).toEqual([]);
    });
});
