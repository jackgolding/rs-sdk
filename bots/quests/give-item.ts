/**
 * Hand one inventory item to a partner already nearby (Catherby bank).
 * Giver can pull stock from its own bank first with --withdraw=N.
 *
 *   bun bots/quests/give-item.ts jacklove6 give jacklove10 --item='big fishing net'
 *   bun bots/quests/give-item.ts pigfat give jacklove1 --item='dragonfire shield' --withdraw=1
 *   bun bots/quests/give-item.ts jacklove10 receive jacklove6
 *
 * Notes: withdrawals default to banknotes (--noted=true) so bulky unstackables
 * ride in one slot and hand over in one trade per partner. Pass --noted=false
 * for items the engine cannot note (falls back to 1-by-1 rounds).
 * Stock pre-check: if inventory + bank hold less than the run needs, the
 * script logs the exact shortfall and idles instead of crash-looping.
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
const partners = [...new Set(positional.slice(2).map(canon))];
const itemLabel = flags.get('item') ?? 'big fishing net';
const asNote = (flags.get('noted') ?? 'true') === 'true';
const ITEM = new RegExp(`^${itemLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

if (!botName || (role !== 'give' && role !== 'receive') || partners.length === 0) {
    throw new Error(
        'Usage: bun bots/quests/give-item.ts {name} give {partner…} [--item=big fishing net] [--withdraw=N] [--each=N]\n' +
            '       bun bots/quests/give-item.ts {name} receive {giver} [--count=N]'
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

    // Make room: bots arrive mid-grind with full bags (fish, nets). Bank
    // everything except the item being handed over so withdraws and trade
    // offers have somewhere to land.
    async function makeRoom(): Promise<void> {
        const opened = await bot.openBank();
        if (!opened.success) throw new Error(`Bank did not open: ${opened.message}`);
        for (const it of sdk.getInventory()) {
            if (ITEM.test(it.name)) continue;
            await bot.depositItem(it.name, -1).catch(() => {});
        }
        await closeUi(bot, sdk);
        log('LOG', `Room made have=${itemCount(sdk)} ${itemLabel}`);
    }

    if (role === 'give') {
        const withdrawN = Math.max(0, parseInt(flags.get('withdraw') ?? '0', 10) || 0);
        if (withdrawN > 0) {
            await makeRoom();
            // Verify the bank is actually open right before touching it — the
            // interface can drop between openBank success and withdraw (this
            // exact race crashed pigfat: "Bank is not open"). One retry, then
            // fail loudly instead of throwing into a crash loop.
            for (let attempt = 0; attempt < 2; attempt++) {
                if (sdk.isBankOpen()) break;
                const reopened = await bot.openBank();
                if (!reopened.success && attempt === 1)
                    throw new Error(`Bank did not reopen: ${reopened.message}`);
            }
            if (!sdk.isBankOpen()) throw new Error('Bank did not reopen: still closed after retry');
            const bankHave = sdk
                .getBankItems()
                .filter((i) => ITEM.test(i.name))
                .reduce((n, i) => n + (i.count ?? 0), 0);
            const need = partners.length * Math.max(1, parseInt(flags.get('each') ?? '1', 10) || 1);
            const total = itemCount(sdk) + bankHave;
            if (total < need) {
                log('ERROR', `Short ${need - total} ${itemLabel}: have=${itemCount(sdk)} bank=${bankHave} need=${need} — idling, stock the mule`);
                await closeUi(bot, sdk);
                return;
            }
            const w = await bot.withdrawItem(ITEM, withdrawN, asNote ? { asNote: true } : {});
            if (!w.success && !w.partial)
                throw new Error(`Withdraw ${withdrawN} ${itemLabel} failed: ${w.message}`);
            await closeUi(bot, sdk);
            log('LOG', `Withdrew ${itemLabel} have=${itemCount(sdk)} (${w.message})`);
        }
    }

    if (role === 'receive') {
        const giver = partners[0]!;
        const from = new RegExp(`^${giver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        // --count=N: accept N separate trades (giver hands over one per trade).
        const count = Math.max(1, parseInt(flags.get('count') ?? '1', 10) || 1);
        await makeRoom();
        const served = await bot.serveTrades({
            from,
            give: [],
            want: [],
            accept: (offer) => offer.some((i) => ITEM.test(i.name) && (i.count ?? 0) > 0),
            maxTrades: count,
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

    // --each=N: hand N to every partner. Noted stock goes in ONE trade per
    // partner; unnoted (--noted=false) keeps the 1-by-1 rounds.
    const each = Math.max(1, parseInt(flags.get('each') ?? '1', 10) || 1);
    const need = partners.length * each;
    if (itemCount(sdk) < need) {
        throw new Error(`Need ${need} ${itemLabel}, only have ${itemCount(sdk)}`);
    }
    const perTrade = asNote ? each : 1;
    const rounds = asNote ? 1 : each;
    for (let round = 1; round <= rounds; round++) {
        for (const name of partners) {
            log('LOG', `Trading ${perTrade}x ${itemLabel} to ${name} (round ${round}/${rounds})`);
            const r = await bot.trade(name, {
                give: [{ item: ITEM, amount: perTrade }],
                want: [],
                retryOnBusy: true,
                requestTimeout: 180_000,
                timeout: 90_000
            });
            log(r.success ? 'LOG' : 'ERROR', `${name}: ${r.success ? 'ok' : r.message} have=${itemCount(sdk)}`);
            if (!r.success) throw new Error(`Trade to ${name} failed: ${r.message}`);
        }
    }
    log('LOG', `Gave ${each}x ${itemLabel} to ${partners.join(', ')}`);
});
