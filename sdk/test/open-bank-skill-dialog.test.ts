import { describe, expect, test } from 'bun:test';
import { BotSDK } from '../index';
import { BotActions } from '../actions';

function makeBankBot(opts: {
    dialog?: { isOpen: boolean; options: Array<{ index: number; text: string }> };
    bankOpenAfterClose?: boolean;
    bankAlreadyOpen?: boolean;
}) {
    const sdk = Object.create(BotSDK.prototype) as BotSDK;
    let dialog = opts.dialog ?? { isOpen: false, options: [] as Array<{ index: number; text: string }> };
    let bankOpen = opts.bankAlreadyOpen ?? false;
    let interfaceOpen = false;
    const clicks: number[] = [];
    const closed: string[] = [];
    const locOps: number[] = [];

    const booth = {
        name: 'Bank booth',
        x: 2726,
        z: 3485,
        id: 1,
        distance: 1,
        optionsWithIndex: [{ text: 'Bank', opIndex: 1 }],
    };

    const snapshot = () => ({
        tick: 1,
        player: { worldX: 2726, worldZ: 3485, x: 2726, z: 3485, level: 0, animId: -1 },
        dialog,
        interface: { isOpen: interfaceOpen, interfaceId: bankOpen ? 12 : 0 },
        shop: { isOpen: false },
        bank: { isOpen: bankOpen },
        nearbyLocs: [booth],
        nearbyNpcs: [],
        gameMessages: [],
        inventory: [],
    });

    (sdk as any).getState = snapshot;
    (sdk as any).getNearbyLocs = () => [booth];
    (sdk as any).findNearbyNpc = () => null;
    (sdk as any).waitForTicks = async () => {};
    (sdk as any).waitForCondition = async (pred: (s: any) => boolean) => {
        const s = snapshot();
        if (pred(s)) return s;
        throw new Error('timeout');
    };
    (sdk as any).sendInteractLoc = async (_x: number, _z: number, _id: number, op: number) => {
        locOps.push(op);
        if (opts.dialog?.isOpen) {
            dialog = opts.dialog;
        } else if (opts.bankOpenAfterClose) {
            bankOpen = true;
            interfaceOpen = true;
        }
        return { success: true, message: 'ok' };
    };
    (sdk as any).sendCloseModal = async () => {
        closed.push('modal');
        dialog = { isOpen: false, options: [] };
        if (opts.bankOpenAfterClose) {
            bankOpen = true;
            interfaceOpen = true;
        }
        return { success: true, message: 'closed' };
    };
    (sdk as any).sendClickDialog = async (index: number) => {
        clicks.push(index);
        return { success: true, message: 'click' };
    };

    const bot = new BotActions(sdk);
    (bot as any).walkTo = async () => ({ success: true, message: 'here' });
    (bot as any).dismissBlockingUI = async () => {};
    (bot as any).closeInterface = async () => {
        closed.push('interface');
        interfaceOpen = false;
    };
    (bot as any).helpers.withDoorRetry = async (fn: () => Promise<any>) => fn();
    (bot as any).helpers.getMessageTick = () => 0;
    (bot as any).helpers.checkCantReachMessage = () => false;

    return { bot, clicks, closed, locOps, getBankOpen: () => bankOpen };
}

describe('openBank vs skill dialog', () => {
    test('already-open bank is a no-op', async () => {
        const { bot, locOps } = makeBankBot({ bankAlreadyOpen: true });
        const result = await bot.openBank();
        expect(result.success).toBe(true);
        expect(locOps).toEqual([]);
    });

    test('closes Make X / flax dialog instead of clicking it, then requires bank.isOpen', async () => {
        const { bot, clicks, closed } = makeBankBot({
            dialog: {
                isOpen: true,
                options: [
                    { index: 0, text: 'Make 10' },
                    { index: 1, text: 'Make 5' },
                    { index: 2, text: 'Make X' },
                    { index: 3, text: 'Flax' },
                ],
            },
            bankOpenAfterClose: true,
        });
        const result = await bot.openBank(3000);
        expect(clicks).toEqual([]);
        expect(closed).toContain('modal');
        expect(result.success).toBe(true);
    });

    test('does not report success on a non-bank interface', async () => {
        const { bot } = makeBankBot({
            dialog: { isOpen: false, options: [] },
        });
        const result = await bot.openBank(50);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('timeout');
    });
});
