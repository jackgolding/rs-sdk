/**
 * Two-way swap at Ardougne: fish for thieving loot. Does not bank-pack.
 *
 *   bun bots/quests/food-loot-swap.ts fatpig give ABGARMY01
 *   bun bots/quests/food-loot-swap.ts ABGARMY01 receive fatpig
 */
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { appendGrindLog } from '../../sdk/grind-log';
import { closeUi, playerPos, walkNear } from './movement';

const FOOD = /^(cod|bass|tuna|swordfish|lobster|shark)$/i;
const LOOT =
    /^(coins|uncut (?:sapphire|emerald|ruby|diamond)|diamond|oysters?|clams?|(?:cosmic|nature) talisman|half of a key|jug of wine|(?:death|blood|chaos) rune|fire orb|gold ore)$/i;
/** Bank booth — knights at the old meet tile keep interrupting the trade. */
const MEET = { x: 2655, z: 3283 };
const TRADE_SLOTS = 12;
const positional = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const botName = /^abgarmy\d+$/i.test(positional[0] ?? '')
    ? positional[0]!.toUpperCase()
    : (positional[0] ?? '');
const role = (positional[1] ?? '').toLowerCase();
const partner = /^abgarmy\d+$/i.test(positional[2] ?? '')
    ? positional[2]!.toUpperCase()
    : (positional[2] ?? '');
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

if (!botName || (role !== 'give' && role !== 'receive') || !partner) {
    throw new Error('Usage: bun bots/quests/food-loot-swap.ts {name} {give|receive} {partner}');
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stacks(
    sdk: import('../../sdk/index').BotSDK,
    pred: (name: string) => boolean
): { item: RegExp; amount: number }[] {
    const seen = new Set<string>();
    const out: { item: RegExp; amount: number }[] = [];
    for (const it of sdk.getInventory()) {
        const n = it.count ?? 0;
        if (n <= 0 || !pred(it.name)) continue;
        const key = it.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ item: new RegExp(`^${escapeRegex(it.name)}$`, 'i'), amount: -1 });
        if (out.length >= TRADE_SLOTS) break;
    }
    return out;
}

function summary(sdk: import('../../sdk/index').BotSDK): string {
    return (
        sdk
            .getInventory()
            .filter((i) => (i.count ?? 0) > 0)
            .map((i) => `${i.count} ${i.name}`)
            .join(', ') || 'empty'
    );
}

await runScript(async ({ bot, sdk }) => {
    const log = (msg: string) => {
        console.log(msg);
        appendGrindLog(GRIND_LOG, `${new Date().toISOString()} ${msg}`);
    };

    await closeUi(bot, sdk);
    await bot.declineTrade().catch(() => {});
    log(`Walking to bank meet @ ${MEET.x},${MEET.z} from ${playerPos(sdk).x},${playerPos(sdk).z}`);
    await walkNear(bot, sdk, MEET.x, MEET.z, 4);
    const names = (sdk.getNearbyPlayers() ?? []).map((p) => p.name).slice(0, 8).join(', ');
    log(`${role} start @ ${playerPos(sdk).x},${playerPos(sdk).z} nearby=${names || 'none'} inv=${summary(sdk)}`);

    if (role === 'receive') {
        const from = new RegExp(`^${partner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const served = await bot.serveTrades({
            from,
            give: stacks(sdk, (n) => LOOT.test(n)),
            want: [{ item: FOOD, amount: 1 }],
            maxTrades: 4,
            timeout: 6 * 60_000,
            tradeTimeout: 90_000
        });
        const ok = served.trades.filter((t) => t.success).length;
        log(`Receive ${partner} ${ok}/${served.trades.length} ok ${served.message} | now ${summary(sdk)}`);
        return;
    }

    const deadline = Date.now() + 6 * 60_000;
    let trips = 0;
    while (Date.now() < deadline) {
        const give = stacks(sdk, (n) => FOOD.test(n));
        if (give.length === 0) {
            log(`Give done — no food left | ${summary(sdk)}`);
            return;
        }
        const result = await bot.trade(partner, {
            give,
            want: [{ item: LOOT, amount: 1 }],
            requestTimeout: 25_000,
            timeout: 90_000,
            retryOnBusy: true
        });
        trips++;
        log(`Trade ${partner} ${result.success ? 'ok' : result.reason} ${result.message} | now ${summary(sdk)}`);
        if (result.success && stacks(sdk, (n) => FOOD.test(n)).length === 0) return;
        if (!result.success && result.reason !== 'busy' && result.reason !== 'no_response') break;
        await sdk.waitForTicks(2);
    }
    log(`Give finished trips=${trips} leftover ${summary(sdk)}`);
});
