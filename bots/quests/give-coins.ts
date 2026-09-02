/**
 * Walk to Catherby and hand coins to one or more partners.
 *
 *   bun bots/quests/give-coins.ts ABGARMY18 give jacklove3 jacklove4 --amount=2000
 *   bun bots/quests/give-coins.ts jacklove3 receive ABGARMY18
 */
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { appendGrindLog } from '../../sdk/grind-log';
import { ARDOUGNE_BANK, ARDOUGNE_MARKET, ARDY_TO_CATHERBY, CATHERBY_BANK } from './tiles';
import { closeUi, playerPos, walkNear, walkWaypoints } from './movement';

const COINS = /^coins$/i;

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
const amount = Math.max(1, Number(flags.get('amount') ?? '2000'));
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

if (!botName || (role !== 'give' && role !== 'receive') || partners.length === 0) {
    throw new Error(
        'Usage: bun bots/quests/give-coins.ts {name} give {partner…} [--amount=2000]\n' +
            '       bun bots/quests/give-coins.ts {name} receive {giver}'
    );
}

function inCatherby(x: number, z: number): boolean {
    return x >= 2788 && x <= 2875 && z >= 3415 && z <= 3498 && z < 6400;
}

function inArdougne(x: number, z: number): boolean {
    return x >= 2600 && x <= 2700 && z >= 3260 && z <= 3345;
}

/** Farmer's sheep pen west of the Ardougne→Catherby road. */
function inSheepFarm(x: number, z: number): boolean {
    return x <= 2656 && z >= 3355 && z <= 3385;
}

function coinCount(sdk: import('../../sdk/index').BotSDK): number {
    return sdk.getInventory().filter((i) => COINS.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
}

await runScript(async ({ bot, sdk }) => {
    const log = (level: 'LOG' | 'WARN' | 'ERROR', msg: string) => {
        console.log(`${level} ${msg}`);
        appendGrindLog(GRIND_LOG, `${new Date().toISOString()} ${level} ${msg}`);
    };

    async function leaveSheepFarm(): Promise<void> {
        let p = playerPos(sdk);
        if (!inSheepFarm(p.x, p.z)) return;
        log('LOG', `Sheep farm @ ${p.x},${p.z} — climb stile then road`);
        const stile = sdk.findNearbyLoc(/stile/i, { withOption: /climb-over/i });
        if (stile) {
            const r = await bot.interactLoc(stile, /climb-over/i);
            log('LOG', `Stile ${stile.x},${stile.z}: ${r.success ? 'ok' : r.message}`);
            await sdk.waitForTicks(3);
        }
        p = playerPos(sdk);
        if (inSheepFarm(p.x, p.z) || p.x < 2660) {
            await walkNear(bot, sdk, 2662, 3375, 4);
        }
    }

    async function goCatherby(): Promise<void> {
        let p = playerPos(sdk);
        if (inCatherby(p.x, p.z)) {
            await walkNear(bot, sdk, CATHERBY_BANK.x, CATHERBY_BANK.z, 6);
            return;
        }
        if (inArdougne(p.x, p.z) && p.z < 3280) {
            log('LOG', `South of Ardougne bank @ ${p.x},${p.z} — door then north`);
            await walkNear(bot, sdk, 2662, 3279, 2);
            const closed = sdk.findNearbyLoc(/^door$/i, { withOption: /^open$/i });
            if (closed) {
                log('LOG', `Opening door @ ${closed.x},${closed.z}`);
                await bot.openDoor(closed);
                await sdk.waitForTicks(2);
            }
            await walkNear(bot, sdk, 2663, 3281, 1);
        }
        await leaveSheepFarm();
        p = playerPos(sdk);
        if (inArdougne(p.x, p.z) || p.x < 2750) {
            log('LOG', `Bank/market north ${p.x},${p.z} → Catherby`);
            if (p.z < 3325) await walkNear(bot, sdk, ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 6);
            // Pin to the north-south road (x=2662) before cutting east — skipping
            // that hop pathfinds through the sheep farm west of 2695,3375.
            if (playerPos(sdk).x < 2688 && !inCatherby(playerPos(sdk).x, playerPos(sdk).z)) {
                if (playerPos(sdk).z < 3368) await walkNear(bot, sdk, 2662, 3336, 6);
                await leaveSheepFarm();
                log('LOG', `Walk 2662,3375 from ${playerPos(sdk).x},${playerPos(sdk).z}`);
                await walkNear(bot, sdk, 2662, 3375, 6);
            }
            for (const step of [
                { x: 2695, z: 3375 },
                { x: 2726, z: 3485 },
                { x: 2758, z: 3477 },
                { x: 2788, z: 3460 },
                CATHERBY_BANK
            ] as const) {
                const here = playerPos(sdk);
                if (inCatherby(here.x, here.z) && step !== CATHERBY_BANK) continue;
                log('LOG', `Walk ${step.x},${step.z} from ${here.x},${here.z}`);
                await walkNear(bot, sdk, step.x, step.z, 6);
            }
        }
        await walkNear(bot, sdk, CATHERBY_BANK.x, CATHERBY_BANK.z, 6);
        log('LOG', `Catherby bank @ ${playerPos(sdk).x},${playerPos(sdk).z}`);
    }

    async function withdrawCoins(need: number): Promise<void> {
        if (coinCount(sdk) >= need) return;
        await closeUi(bot, sdk);
        const p = playerPos(sdk);
        const bank = inCatherby(p.x, p.z) ? CATHERBY_BANK : ARDOUGNE_BANK;
        await walkNear(bot, sdk, bank.x, bank.z, 3);
        const opened = await bot.openBank();
        if (!opened.success && !sdk.getState()?.bank?.isOpen) {
            throw new Error(`Bank open failed: ${opened.message}`);
        }
        const have = coinCount(sdk);
        const w = await bot.withdrawItem(COINS, need - have);
        if (!w.success) log('WARN', `Coin withdraw: ${w.message}`);
        await bot.closeBank();
    }

    await closeUi(bot, sdk);
    log('LOG', `give-coins ${role} partners=${partners.join(',')} amount=${amount} gp=${coinCount(sdk)}`);

    if (role === 'receive') {
        const giver = partners[0]!;
        await goCatherby();
        log('LOG', `Waiting for ${giver} @ ${playerPos(sdk).x},${playerPos(sdk).z}`);
        const from = new RegExp(`^${giver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const served = await bot.serveTrades({
            from,
            give: [],
            want: [],
            accept: (offer) => offer.some((i) => COINS.test(i.name) && (i.count ?? 0) > 0),
            maxTrades: 1,
            timeout: 30 * 60_000,
            tradeTimeout: 90_000,
            rejectAfterMs: 60_000
        });
        const last = served.trades[served.trades.length - 1];
        log(
            last?.success ? 'LOG' : 'ERROR',
            `Recv ${giver} ${last?.success ? 'ok' : last?.reason ?? served.reason} gp=${coinCount(sdk)} ${served.message}`
        );
        if (!last?.success) throw new Error(`Did not receive coins from ${giver}: ${served.message}`);
        return;
    }

    const need = amount * partners.length;
    await withdrawCoins(need);
    if (coinCount(sdk) < need) {
        throw new Error(`Need ${need} gp, only have ${coinCount(sdk)}`);
    }
    await goCatherby();
    log('LOG', `At Catherby gp=${coinCount(sdk)} @ ${playerPos(sdk).x},${playerPos(sdk).z}`);

    for (const name of partners) {
        log('LOG', `Trading ${amount} gp to ${name}`);
        const r = await bot.trade(name, {
            give: [{ item: COINS, amount }],
            want: [],
            retryOnBusy: true,
            requestTimeout: 180_000,
            timeout: 90_000
        });
        log(r.success ? 'LOG' : 'ERROR', `${name}: ${r.success ? 'ok' : r.message} gp=${coinCount(sdk)}`);
        if (!r.success) throw new Error(`Trade to ${name} failed: ${r.message}`);
    }
    log('LOG', `Paid ${partners.join(', ')}`);
});
