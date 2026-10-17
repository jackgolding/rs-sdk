/**
 * Mule handoff protocol: both sides meet at Catherby bank with EMPTY bags,
 * trade verified stock (banknotes by default), bank the result, then hold
 * DONE for the operator to switch them back to their grind.
 *
 *   bun bots/quests/give-item.ts pigfat give jacklove1 jacklove4 --item='dragonfire shield'
 *   bun bots/quests/give-item.ts jacklove1 receive pigfat --item='dragonfire shield' --count=3
 *
 * Flags:
 *   --item=NAME    what moves (default 'big fishing net')
 *   --each=N       giver: N items per partner (default 1)
 *   --count=N      receiver: N items expected (default 1)
 *   --withdraw=N   giver: cap the bank withdrawal (default: exactly the shortfall)
 *   --noted=false  giver: withdraw unnoted, trade 1-by-1 (default noted)
 *
 * Completion is a DONE line plus an idle heartbeat — the container stays Up
 * doing nothing, so a restart can never over-deliver. Genuine stalls (short
 * stock, failed trades) throw loudly instead. Switch both sides back to
 * their grind once every DONE is in.
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
        'Usage: bun bots/quests/give-item.ts {name} give {partner…} [--item=NAME] [--each=N] [--withdraw=N] [--noted=false]\n' +
            '       bun bots/quests/give-item.ts {name} receive {giver} [--item=NAME] [--count=N]'
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

    async function openBank(why: string): Promise<void> {
        for (let attempt = 0; attempt < 2; attempt++) {
            if (sdk.isBankOpen()) return;
            const r = await bot.openBank();
            if (!r.success && attempt === 1) throw new Error(`Bank did not open (${why}): ${r.message}`);
        }
        if (!sdk.isBankOpen()) throw new Error(`Bank did not open (${why}): still closed after retry`);
    }

    // Both sides start with a fully empty bag: grind leftovers (fish, nets,
    // tools) can neither clog the trade nor leak into the next task.
    async function bankAll(why: string): Promise<void> {
        await openBank(why);
        for (const it of sdk.getInventory()) {
            await bot.depositItem(it.name, -1).catch(() => {});
        }
        await closeUi(bot, sdk);
    }

    function bankCount(): number {
        return sdk
            .getBankItems()
            .filter((i) => ITEM.test(i.name))
            .reduce((n, i) => n + (i.count ?? 0), 0);
    }

    // Finished jobs idle instead of exiting: quest containers restart on
    // exit, and a re-run must never move stock twice.
    async function idleDone(msg: string): Promise<never> {
        log('LOG', `DONE ${msg}`);
        for (;;) {
            await sdk.waitForTicks(600).catch(() => {});
            log('LOG', `DONE holding: ${msg}`);
        }
        throw new Error('unreachable');
    }

    if (role === 'give') {
        const each = Math.max(1, parseInt(flags.get('each') ?? '1', 10) || 1);
        const need = partners.length * each;
        await bankAll('give-start');
        await openBank('give-stockcheck');
        const stocked = bankCount();
        if (stocked < need) {
            await closeUi(bot, sdk);
            return idleDone(`short ${itemLabel}: bank=${stocked} need=${need} — stock the mule`);
        }
        // Withdraw exactly what this run hands over (flag caps it lower).
        // Restarts re-run from scratch: the shortfall form means a restart
        // after a partial run tops up instead of draining the bank twice.
        const capRaw = flags.get('withdraw');
        const cap = capRaw == null ? need : Math.max(0, parseInt(capRaw, 10) || 0);
        const get = Math.min(cap, Math.max(0, need - itemCount(sdk)));
        if (get > 0) {
            const w = await bot.withdrawItem(ITEM, get, asNote ? { asNote: true } : {});
            if (!w.success && !w.partial) throw new Error(`Withdraw ${get} ${itemLabel} failed: ${w.message}`);
            log('LOG', `Withdrew ${itemLabel} have=${itemCount(sdk)} (${w.message})`);
        }
        await closeUi(bot, sdk);
        if (itemCount(sdk) < need) {
            throw new Error(`Need ${need} ${itemLabel}, only hold ${itemCount(sdk)} after withdraw`);
        }
        // Noted stock moves in ONE trade per partner; unnoted goes 1-by-1.
        const perTrade = asNote ? each : 1;
        const rounds = asNote ? 1 : each;
        for (let round = 1; round <= rounds; round++) {
            for (const name of partners) {
                const before = itemCount(sdk);
                log('LOG', `Trading ${perTrade}x ${itemLabel} to ${name} (round ${round}/${rounds})`);
                const r = await bot.trade(name, {
                    give: [{ item: ITEM, amount: perTrade }],
                    want: [],
                    retryOnBusy: true,
                    requestTimeout: 180_000,
                    timeout: 90_000
                });
                if (!r.success) throw new Error(`Trade to ${name} failed: ${r.message}`);
                const after = itemCount(sdk);
                if (before - after !== perTrade) {
                    throw new Error(
                        `Trade to ${name} UNVERIFIED: have ${before} -> ${after}, expected -${perTrade} — holding, operator check needed`
                    );
                }
                log('LOG', `${name}: ok verified -${perTrade} have=${after}`);
            }
        }
        await bankAll('give-leftover');
        return idleDone(`gave ${each}x ${itemLabel} to ${partners.join(',')}, leftovers banked`);
    }

    if (role === 'receive') {
        const giver = partners[0]!;
        const from = new RegExp(`^${giver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        // --count=N is ITEMS expected (one noted trade can deliver them all).
        const count = Math.max(1, parseInt(flags.get('count') ?? '1', 10) || 1);
        await bankAll('receive-start');
        // Already secured (a previous run banked it)? Done — restarts are
        // no-ops instead of duplicate accepts.
        await openBank('receive-stockcheck');
        const secured = bankCount();
        await closeUi(bot, sdk);
        if (secured >= count) {
            return idleDone(`already banked ${secured}x ${itemLabel} (>=${count}) — nothing to receive`);
        }
        const served = await bot.serveTrades({
            from,
            give: [],
            want: [],
            accept: (offer) => offer.some((i) => ITEM.test(i.name) && (i.count ?? 0) > 0),
            until: () => itemCount(sdk) >= count,
            maxTrades: count,
            timeout: 8 * 60_000,
            tradeTimeout: 90_000,
            rejectAfterMs: 60_000
        });
        const have = itemCount(sdk);
        const okTrades = served.trades.filter((t) => t.success).length;
        log(
            okTrades > 0 && have >= count ? 'LOG' : 'ERROR',
            `Recv ${giver} have=${have}/${count} in ${okTrades} trade(s) (${served.reason}) ${served.message}`
        );
        if (have < count || okTrades < 1) {
            throw new Error(`Receipt UNVERIFIED from ${giver}: have=${have} want=${count} — holding, operator check needed`);
        }
        await bankAll('receive-bank');
        return idleDone(`received ${have}x ${itemLabel} from ${giver}, banked`);
    }
});
