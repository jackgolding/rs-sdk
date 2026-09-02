/**
 * Timed dummy: 1 cooked fish for 1 coin at Ardougne bank.
 *
 *   bun bots/quests/dummy-swap.ts ABGARMY01 give ABGARMY20
 *   bun bots/quests/dummy-swap.ts ABGARMY20 receive ABGARMY01
 */
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { appendGrindLog } from '../../sdk/grind-log';
import { closeUi, playerPos, walkNear } from './movement';
import { ARDOUGNE_BANK, HANDELMORT_SAFE_EAST, inHandelmortMansion } from './tiles';

const FISH = /^(cod|bass|tuna|swordfish|lobster|shark)$/i;
const COIN = /^coins$/i;

const positional = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const botName = /^abgarmy\d+$/i.test(positional[0] ?? '')
    ? positional[0]!.toUpperCase()
    : (positional[0] ?? '');
const role = (positional[1] ?? '').toLowerCase();
const partner = /^abgarmy\d+$/i.test(positional[2] ?? '')
    ? positional[2]!.toUpperCase()
    : (positional[2] ?? '');
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');
const t0 = Date.now();

if (!botName || (role !== 'give' && role !== 'receive') || !partner) {
    throw new Error('Usage: bun bots/quests/dummy-swap.ts {name} {give|receive} {partner}');
}

function count(sdk: import('../../sdk/index').BotSDK, re: RegExp): number {
    return sdk.getInventory().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
}

await runScript(async ({ bot, sdk }) => {
    const log = (msg: string) => {
        const ms = Date.now() - t0;
        console.log(`+${ms}ms ${msg}`);
        appendGrindLog(GRIND_LOG, `${new Date().toISOString()} dummy +${ms}ms ${msg}`);
    };

    await closeUi(bot, sdk);
    await bot.declineTrade().catch(() => {});
    const start = playerPos(sdk);
    log(`Walking to bank @ ${ARDOUGNE_BANK.x},${ARDOUGNE_BANK.z} from ${start.x},${start.z}`);
    if (inHandelmortMansion(start.x, start.z)) {
        log(`Leaving mansion via ${HANDELMORT_SAFE_EAST.x},${HANDELMORT_SAFE_EAST.z}`);
        await walkNear(bot, sdk, HANDELMORT_SAFE_EAST.x, HANDELMORT_SAFE_EAST.z, 3);
    }
    await walkNear(bot, sdk, ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 4);
    const here = playerPos(sdk);
    const names = (sdk.getNearbyPlayers() ?? []).map((p) => p.name).slice(0, 8).join(', ');
    log(`at bank @ ${here.x},${here.z} nearby=${names || 'none'} fish=${count(sdk, FISH)} gp=${count(sdk, COIN)}`);

    const partnerRe = new RegExp(`^${partner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

    if (role === 'receive') {
        const from = partnerRe;
        const served = await bot.serveTrades({
            from,
            give: [{ item: COIN, amount: 1 }],
            want: [{ item: FISH, amount: 1 }],
            maxTrades: 1,
            timeout: 180_000,
            tradeTimeout: 60_000
        });
        const last = served.trades[served.trades.length - 1];
        log(
            `recv ${last?.success ? 'ok' : last?.reason ?? served.reason} ${served.message} fish=${count(sdk, FISH)} gp=${count(sdk, COIN)}`
        );
        return;
    }

    const seen = await sdk
        .waitForCondition(() => !!sdk.findNearbyPlayer(partnerRe), 40_000)
        .then(() => true)
        .catch(() => false);
    log(`partner visible=${seen} before give`);
    const result = await bot.trade(partner, {
        give: [{ item: FISH, amount: 1 }],
        want: [{ item: COIN, amount: 1 }],
        requestTimeout: 45_000,
        timeout: 60_000,
        retryOnBusy: true
    });
    log(
        `give ${result.success ? 'ok' : result.reason} ${result.message} fish=${count(sdk, FISH)} gp=${count(sdk, COIN)}`
    );
});
