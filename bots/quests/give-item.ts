/**
 * Hand one inventory item to a partner already nearby (Catherby bank).
 * Giver can pull stock from its own bank first with --withdraw=N.
 *
 *   bun bots/quests/give-item.ts jacklove6 give jacklove10 --item='big fishing net'
 *   bun bots/quests/give-item.ts pigfat give jacklove1 --item='dragonfire shield' --withdraw=1
 *   bun bots/quests/give-item.ts jacklove10 receive jacklove6
 */
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { appendGrindLog } from '../../sdk/grind-log';
import { CATHERBY_BANK } from './tiles';
import { closeUi, playerPos, walkNear } from './movement';

const positional: string[] = [];
const flags = new Map<string, string>();
for (const a of process.argv.slice(2)) {
    if (a.startsWith('--')) {
        const eq = a.indexOf('=');
        if (eq === -1) flags.set(a.slice(2), 'true');
        else flags.set(a.slice(2, eq), a.slice(eq + 1));
    } else positional.push(a);
}

function canon(name: string): string {
    if (/^abgarmy\d+$/i.test(name)) return name.toUpperCase();
    return name;
}

const botName = canon(positional[0] ?? '');
const role = (positional[1] ?? '').toLowerCase();
const partners = positional.slice(2).map(canon);
const itemLabel = flags.get('item') ?? 'big fishing net';
const ITEM = new RegExp(`^${itemLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

if (!botName || (role !== 'give' && role !== 'receive') || partners.length === 0) {
    throw new Error(
        'Usage: bun bots/quests/give-item.ts {name} give {partner…} [--item=big fishing net] [--withdraw=N]\n' +
            '       bun bots/quests/give-item.ts {name} receive {giver}'
    );
}

function itemCount(sdk: import('../../sdk/index').BotSDK): number {
    return sdk.getInventory().filter((i) => ITEM.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
}

await runScript(async ({ bot, sdk }) => {
    const log = (level: 'LOG' | 'WARN' | 'ERROR', msg: string) => {
        console.log(`${level} ${msg}`);
        appendGrindLog(GRIND_LOG, `${new Date().toISOString()} ${level} ${msg}`);
    };

    await closeUi(bot, sdk);
    await walkNear(bot, sdk, CATHERBY_BANK.x, CATHERBY_BANK.z, 6);
    log('LOG', `give-item ${role} ${itemLabel} partners=${partners.join(',')} have=${itemCount(sdk)} @ ${playerPos(sdk).x},${playerPos(sdk).z}`);

    if (role === 'give') {
        const withdrawN = Math.max(0, parseInt(flags.get('withdraw') ?? '0', 10) || 0);
        if (withdrawN > 0) {
            const opened = await bot.openBank();
            if (!opened.success) throw new Error(`Bank did not open: ${opened.message}`);
            const w = await bot.withdrawItem(ITEM, withdrawN);
            if (!w.success && !w.partial)
                throw new Error(`Withdraw ${withdrawN} ${itemLabel} failed: ${w.message}`);
            await closeUi(bot, sdk);
            log('LOG', `Withdrew ${itemLabel} have=${itemCount(sdk)} (${w.message})`);
        }
    }

    if (role === 'receive') {
        const giver = partners[0]!;
        const from = new RegExp(`^${giver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const served = await bot.serveTrades({
            from,
            give: [],
            want: [],
            accept: (offer) => offer.some((i) => ITEM.test(i.name) && (i.count ?? 0) > 0),
            maxTrades: 1,
            timeout: 8 * 60_000,
            tradeTimeout: 90_000,
            rejectAfterMs: 60_000
        });
        const last = served.trades[served.trades.length - 1];
        log(
            last?.success ? 'LOG' : 'ERROR',
            `Recv ${giver} ${last?.success ? 'ok' : last?.reason ?? served.reason} ${itemLabel}=${itemCount(sdk)} ${served.message}`
        );
        if (!last?.success) throw new Error(`Did not receive ${itemLabel} from ${giver}: ${served.message}`);
        return;
    }

    const need = partners.length;
    if (itemCount(sdk) < need) {
        throw new Error(`Need ${need} ${itemLabel}, only have ${itemCount(sdk)}`);
    }
    for (const name of partners) {
        log('LOG', `Trading 1 ${itemLabel} to ${name}`);
        const r = await bot.trade(name, {
            give: [{ item: ITEM, amount: 1 }],
            want: [],
            retryOnBusy: true,
            requestTimeout: 180_000,
            timeout: 90_000
        });
        log(r.success ? 'LOG' : 'ERROR', `${name}: ${r.success ? 'ok' : r.message} have=${itemCount(sdk)}`);
        if (!r.success) throw new Error(`Trade to ${name} failed: ${r.message}`);
    }
    log('LOG', `Gave ${itemLabel} to ${partners.join(', ')}`);
});
