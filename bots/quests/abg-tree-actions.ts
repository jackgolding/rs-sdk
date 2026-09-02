import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { TradeItem, TradeItemSpec } from '../../sdk/types';
import { meetTile, receiverTile } from './tree-trade-plan';
import { HANDELMORT_SAFE_EAST, inHandelmortMansion } from './tiles';
import { walkNear } from './movement';

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function goTreeMeet(
    bot: BotActions,
    sdk: BotSDK,
    me: string,
    partner: string,
    asReceiver: boolean,
    log: (msg: string) => void
): Promise<void> {
    if (sdk.getTradeState().isOpen) await bot.declineTrade().catch(() => {});
    await bot.closeInterface();
    const meet = meetTile(me, partner);
    const tile = asReceiver ? receiverTile(meet) : meet;
    log(`Meet ${partner} @ ${tile.x},${tile.z} (${asReceiver ? 'recv' : 'give'})`);
    await walkNear(bot, sdk, tile.x, tile.z, 3);
    const p = sdk.getState()?.player;
    if (p && inHandelmortMansion(p.worldX, p.worldZ)) {
        log(`Meet path entered Handelmort mansion — stepping east`);
        await walkNear(bot, sdk, HANDELMORT_SAFE_EAST.x, p.worldZ, 3);
    }
}

export async function treeGive(
    bot: BotActions,
    sdk: BotSDK,
    me: string,
    partner: string,
    give: TradeItemSpec[],
    log: (msg: string) => void,
    ms = 80_000
): Promise<boolean> {
    await goTreeMeet(bot, sdk, me, partner, false, log);
    if (give.length === 0) {
        log(`Nothing to give ${partner}`);
        return false;
    }
    const result = await bot.trade(partner, {
        give,
        want: [],
        requestTimeout: 45_000,
        timeout: ms,
        rejectAfterMs: 60_000,
        retryOnBusy: true
    });
    log(`Give ${partner} ${result.success ? 'ok' : result.reason} ${result.message}`);
    return result.success;
}

export async function treeReceive(
    bot: BotActions,
    sdk: BotSDK,
    me: string,
    partner: string,
    log: (msg: string) => void,
    opts: {
        want?: TradeItemSpec[];
        accept?: (theirOffer: TradeItem[]) => boolean;
        ms?: number;
    } = {}
): Promise<boolean> {
    const ms = opts.ms ?? 80_000;
    await goTreeMeet(bot, sdk, me, partner, true, log);
    const from = new RegExp(`^${escapeRegex(partner)}$`, 'i');
    const served = await bot.serveTrades({
        from,
        give: [],
        want: opts.want ?? [],
        accept: opts.accept,
        maxTrades: 1,
        timeout: ms,
        tradeTimeout: ms,
        rejectAfterMs: 60_000
    });
    const last = served.trades[served.trades.length - 1];
    log(`Recv ${partner} ${last?.success ? 'ok' : last?.reason ?? served.reason} ${served.message}`);
    return !!last?.success;
}
