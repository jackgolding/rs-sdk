/**
 * One side of a tree-trade pair.
 *
 *   bun bots/quests/tree-trade.ts ABGARMY03 give ABGARMY04 loot --meet=2640,3300
 *   bun bots/quests/tree-trade.ts ABGARMY04 receive ABGARMY03 loot --meet=2640,3300
 *   bun bots/quests/tree-trade.ts jacklove1 give ABGARMY01 food --shares=3 --hold=2
 *   bun bots/quests/tree-trade.ts ABGARMY16 dump fatpig
 *   bun bots/quests/tree-trade.ts fatpig collect
 *   bun bots/quests/tree-trade.ts ABGARMY02 pack loot
 */
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { appendGrindLog } from '../../sdk/grind-log';
import { ARDOUGNE_BANK, ARDOUGNE_MARKET, ARDY_TO_CATHERBY, CATHERBY_BANK, CATHERBY_TO_ARDY } from './tiles';
import { closeUi, distTo, playerPos, walkNear, walkWaypoints } from './movement';
import { meetTile, receiverTile, splitAmount } from './tree-trade-plan';
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { Tile } from './tiles';

const FOOD = /^(tuna|swordfish|lobster|shark)$/i;
const FOOD_NAMES = ['tuna', 'swordfish', 'lobster', 'shark'] as const;
const SLASH = /^(bronze |iron |steel |mithril |adamant |rune )?(axe|sword|scimitar|dagger|claws|battleaxe|longsword|2h sword)$|^knife$/i;
const CASKET_LOOT = /^(coins|uncut (?:sapphire|emerald|ruby|diamond)|(?:cosmic|nature) talisman|half of a key)$/i;

const positional: string[] = [];
const flags = new Map<string, string>();
for (const a of process.argv.slice(2)) {
    if (a.startsWith('--')) {
        const eq = a.indexOf('=');
        if (eq === -1) flags.set(a.slice(2), 'true');
        else flags.set(a.slice(2, eq), a.slice(eq + 1));
    } else positional.push(a);
}

function canonBot(name: string): string {
    if (/^abgarmy\d+$/i.test(name)) return name.toUpperCase();
    if (/^jackpoo3$/i.test(name)) return 'Jackpoo3';
    if (/^fatpig$/i.test(name)) return 'fatpig';
    return name;
}

const botName = canonBot(positional[0] ?? '');
const role = (positional[1] ?? '').toLowerCase();
const kindArg = role === 'pack' ? positional[2] : positional[3];
const partner = canonBot(role === 'pack' ? '' : (positional[2] ?? (role === 'dump' ? 'fatpig' : '')));
const kind = (kindArg === 'food' || flags.get('kind') === 'food' ? 'food' : 'loot') as 'loot' | 'food';
const shares = Number(flags.get('shares') ?? '1');
const hold = Number(flags.get('hold') ?? '0');
const doPack = flags.has('pack');
const meetFlag = flags.get('meet');
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

if (!botName || !role) {
    throw new Error(
        'Usage: bun bots/quests/tree-trade.ts {name} {pack|give|receive|dump|collect} [partner] [loot|food]'
    );
}

function parseMeet(): Tile {
    if (meetFlag) {
        const [x, z] = meetFlag.split(',').map(Number);
        if (Number.isFinite(x) && Number.isFinite(z)) return { x: x!, z: z! };
    }
    if (partner) return meetTile(botName, partner);
    return ARDOUGNE_MARKET;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inCatherby(x: number, z: number): boolean {
    return x >= 2788 && x <= 2875 && z >= 3415 && z <= 3498 && z < 6400;
}

function inArdougne(x: number, z: number): boolean {
    return x >= 2600 && x <= 2700 && z >= 3260 && z <= 3345;
}

function inRangingGuild(sdk: BotSDK): boolean {
    const p = playerPos(sdk);
    return p.x >= 2655 && p.x <= 2685 && p.z >= 3410 && p.z <= 3445;
}

function isCasketBot(name: string): boolean {
    return /^jacklove\d+$/i.test(name);
}

function isCasketLoot(name: string): boolean {
    return CASKET_LOOT.test(name);
}

function isEatFood(name: string): boolean {
    return FOOD.test(name) || /^kebab$/i.test(name);
}

function isKeep(name: string): boolean {
    return isEatFood(name) || SLASH.test(name);
}

function usedSlots(sdk: BotSDK): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function countFood(sdk: BotSDK): number {
    return sdk.getInventory().filter((i) => FOOD.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function foodSummary(sdk: BotSDK): string {
    const parts: string[] = [];
    for (const name of FOOD_NAMES) {
        const n = sdk
            .getInventory()
            .filter((i) => new RegExp(`^${name}$`, 'i').test(i.name))
            .reduce((s, i) => s + (i.count ?? 1), 0);
        if (n > 0) parts.push(`${n} ${name}`);
    }
    return parts.join(', ') || 'none';
}

function lootGiveList(sdk: BotSDK): { item: RegExp; amount: number }[] {
    const give: { item: RegExp; amount: number }[] = [];
    const seen = new Set<string>();
    for (const item of sdk.getInventory()) {
        const count = item.count ?? 0;
        if (count <= 0 || isKeep(item.name)) continue;
        if (isCasketBot(botName) && !isCasketLoot(item.name)) continue;
        const key = item.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        give.push({ item: new RegExp(`^${escapeRegex(item.name)}$`, 'i'), amount: -1 });
    }
    return give;
}

function foodGiveList(sdk: BotSDK, giveShares: number, holdShares: number): { item: RegExp; amount: number }[] {
    const give: { item: RegExp; amount: number }[] = [];
    for (const name of FOOD_NAMES) {
        const total = sdk
            .getInventory()
            .filter((i) => new RegExp(`^${name}$`, 'i').test(i.name))
            .reduce((s, i) => s + (i.count ?? 1), 0);
        const amount = splitAmount(total, giveShares, holdShares);
        if (amount >= 1) give.push({ item: new RegExp(`^${name}$`, 'i'), amount });
    }
    return give;
}

function lootSummary(sdk: BotSDK): string {
    return (
        sdk
            .getInventory()
            .filter((i) => (i.count ?? 0) > 0 && !isKeep(i.name))
            .map((i) => `${i.count} ${i.name}`)
            .join(', ') || 'none'
    );
}

await runScript(async ({ bot, sdk }) => {
    const log = (level: 'LOG' | 'WARN' | 'ERROR', msg: string) => {
        const line = `${new Date().toISOString()} ${level} ${msg}`;
        console.log(`${level} ${msg}`);
        appendGrindLog(GRIND_LOG, line);
    };

    async function declineIfOpen(): Promise<void> {
        if (sdk.getTradeState().isOpen) await bot.declineTrade().catch(() => {});
        await closeUi(bot, sdk);
    }

    async function leaveRangingGuild(): Promise<void> {
        if (!inRangingGuild(sdk)) return;
        log('LOG', `Leaving ranging guild @ ${playerPos(sdk).x},${playerPos(sdk).z}`);
        for (let i = 0; i < 8 && inRangingGuild(sdk); i++) {
            const closed =
                sdk.findNearbyLoc(/^guild door$/i, { withOption: /open/i }) ??
                sdk.findNearbyLoc(/^(door|gate)$/i, { withOption: /open/i });
            if (closed) {
                const opt = closed.optionsWithIndex?.find((o) => /^open$/i.test(o.text));
                await sdk.sendInteractLoc(closed.x, closed.z, closed.id, opt?.opIndex ?? 1);
                await sdk.waitForTicks(2);
            }
            await walkNear(bot, sdk, 2654, 3438, 2);
        }
    }

    async function leaveArdougneSouthBank(): Promise<void> {
        const p0 = playerPos(sdk);
        if (!(p0.x >= 2648 && p0.x <= 2660 && p0.z >= 3278 && p0.z <= 3290)) return;
        log('LOG', `Leaving Ardougne south bank @ ${p0.x},${p0.z}`);
        for (let i = 0; i < 4; i++) {
            const closed = sdk.findNearbyLoc(/^(door|gate)$/i, { withOption: /^open$/i });
            if (closed && (closed.distance ?? 99) <= 12) {
                log('LOG', `Opening ${closed.name} @ ${closed.x},${closed.z}`);
                await bot.openDoor(closed);
                await sdk.waitForTicks(2);
            }
            await sdk.sendWalk(2658, 3294, true);
            await sdk.waitForCondition(() => playerPos(sdk).z >= 3292, 8_000).catch(() => {});
            if (playerPos(sdk).z >= 3292) return;
        }
    }

    async function goCatherby(): Promise<void> {
        if (inCatherby(playerPos(sdk).x, playerPos(sdk).z)) return;
        await leaveArdougneSouthBank();
        const p = playerPos(sdk);
        if (inArdougne(p.x, p.z) || p.x < 2750) await walkWaypoints(bot, sdk, ARDY_TO_CATHERBY);
        await walkNear(bot, sdk, CATHERBY_BANK.x, CATHERBY_BANK.z, 6);
    }

    async function goArdougne(): Promise<void> {
        await leaveRangingGuild();
        const p = playerPos(sdk);
        if (inArdougne(p.x, p.z)) return;
        if (p.x >= 2750 || p.z >= 3380) await walkWaypoints(bot, sdk, CATHERBY_TO_ARDY);
        await walkNear(bot, sdk, ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 6);
    }

    async function openBankAt(tile: Tile): Promise<boolean> {
        if (sdk.getState()?.bank?.isOpen) return true;
        await walkNear(bot, sdk, tile.x, tile.z, 3);
        for (let i = 0; i < 4; i++) {
            if (sdk.getState()?.bank?.isOpen) return true;
            const r = await bot.openBank();
            if (r.success || sdk.getState()?.bank?.isOpen) return true;
            await sdk.waitForTicks(2);
        }
        return !!sdk.getState()?.bank?.isOpen;
    }

    async function depositAll(): Promise<void> {
        for (let i = 0; i < 40; i++) {
            const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0);
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            if (!r.success && !r.partial) break;
        }
    }

    async function bankLootKeepFood(): Promise<void> {
        const p = playerPos(sdk);
        const bank = inCatherby(p.x, p.z) ? CATHERBY_BANK : ARDOUGNE_BANK;
        if (!(await openBankAt(bank))) {
            log('WARN', 'Bank open failed');
            return;
        }
        for (let i = 0; i < 50; i++) {
            const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !isEatFood(it.name));
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            if (!r.success && !r.partial) break;
        }
        for (let i = 0; i < 40; i++) {
            const food = sdk.getInventory().filter((it) => (it.count ?? 0) > 0 && isEatFood(it.name));
            if (food.length <= 4) break;
            const extra = food[food.length - 1]!;
            const r = await bot.depositItem(extra, -1);
            if (!r.success && !r.partial) break;
        }
        await bot.closeBank();
        log('LOG', `Banked loot, ${usedSlots(sdk)} inv slots leftover=${lootSummary(sdk)}`);
    }

    async function packLoot(): Promise<number> {
        await declineIfOpen();
        const casketPack = isCasketBot(botName);
        if (casketPack) {
            await goCatherby();
            if (!(await openBankAt(CATHERBY_BANK))) {
                log('WARN', 'Could not open Catherby bank to pack casket loot');
                return lootGiveList(sdk).length;
            }
        } else {
            await goArdougne();
            if (!(await openBankAt(ARDOUGNE_BANK))) {
                log('WARN', 'Could not open Ardougne bank to pack loot');
                return lootGiveList(sdk).length;
            }
        }
        await depositAll();
        if (casketPack) {
            for (const item of sdk.getBankItems()) {
                if ((item.count ?? 0) <= 0) continue;
                if (!isCasketLoot(item.name) || /^coins$/i.test(item.name)) continue;
                const r = await bot.withdrawItem(item, -1, { asNote: true });
                if (!r.success && !r.partial) log('WARN', `Note-withdraw ${item.name}: ${r.message}`);
            }
        } else {
            for (const item of sdk.getBankItems()) {
                if ((item.count ?? 0) <= 0) continue;
                if (isEatFood(item.name) || /^coins$/i.test(item.name) || SLASH.test(item.name)) continue;
                const r = await bot.withdrawItem(item, -1, { asNote: true });
                if (!r.success && !r.partial) log('WARN', `Note-withdraw ${item.name}: ${r.message}`);
            }
        }
        const bankCoins = sdk.findBankItem(/^coins$/i)?.count ?? 0;
        if (bankCoins > 0) await bot.withdrawItem(/^coins$/i, bankCoins);
        await bot.closeBank();
        const n = lootGiveList(sdk).length;
        log('LOG', `Packed ${casketPack ? 'casket ' : ''}loot ${n} stack(s): ${lootSummary(sdk)}`);
        return n;
    }

    async function packFood(): Promise<number> {
        await declineIfOpen();
        const already = countFood(sdk);
        const p = playerPos(sdk);
        if (already >= 20 && inArdougne(p.x, p.z)) {
            log('LOG', `Already packed food notes: ${foodSummary(sdk)}`);
            return already;
        }
        const atArdy = inArdougne(p.x, p.z);
        const bankTile = atArdy ? ARDOUGNE_BANK : CATHERBY_BANK;
        log('LOG', `Packing food at ${atArdy ? 'Ardougne' : 'Catherby'} bank @ ${p.x},${p.z}`);
        if (!(await openBankAt(bankTile))) {
            log('WARN', 'Could not open bank to pack food');
            return countFood(sdk);
        }
        await depositAll();
        for (const name of FOOD_NAMES) {
            const bankItem = sdk.findBankItem(new RegExp(`^${name}$`, 'i'));
            if (!bankItem || (bankItem.count ?? 0) <= 0) continue;
            const r = await bot.withdrawItem(bankItem, -1, { asNote: true });
            log('LOG', `Withdraw ${name} x${bankItem.count} ${r.success ? 'ok' : r.message}`);
        }
        await bot.closeBank();
        log('LOG', `Packed food notes: ${foodSummary(sdk)}`);
        return countFood(sdk);
    }

    async function walkToMeet(asReceiver: boolean): Promise<void> {
        const meet = parseMeet();
        if (inCatherby(meet.x, meet.z)) await goCatherby();
        else await goArdougne();
        const tile = asReceiver ? receiverTile(meet) : meet;
        await walkNear(bot, sdk, tile.x, tile.z, 2);
        if (distTo(sdk, tile.x, tile.z) > 6) await walkNear(bot, sdk, tile.x, tile.z, 3);
        log('LOG', `At meet ${tile.x},${tile.z} @ ${playerPos(sdk).x},${playerPos(sdk).z}`);
    }

    async function runGive(): Promise<void> {
        if (!partner) throw new Error('give requires a partner');
        if (kind === 'food') {
            if (doPack || countFood(sdk) <= 0) {
                const packed = await packFood();
                if (packed <= 0) {
                    log('WARN', 'No food notes to give');
                    return;
                }
            }
        } else if (doPack || lootGiveList(sdk).length === 0) {
            await packLoot();
        }
        await walkToMeet(false);
        const deadline = Date.now() + 6 * 60_000;
        let trips = 0;
        while (Date.now() < deadline && trips < 8) {
            const give =
                kind === 'food' ? foodGiveList(sdk, shares, hold) : lootGiveList(sdk);
            if (give.length === 0) {
                log('LOG', trips === 0 ? 'Nothing to trade' : 'Give complete');
                break;
            }
            log(
                'LOG',
                `Give ${partner} trip ${trips + 1}: ${kind === 'food' ? foodSummary(sdk) : lootSummary(sdk)} shares=${shares} hold=${hold}`
            );
            const result = await bot.trade(partner, {
                give,
                want: [],
                requestTimeout: 90_000,
                timeout: 90_000,
                retryOnBusy: true
            });
            log(
                result.success ? 'LOG' : 'WARN',
                `Trade ${partner} ${result.success ? 'ok' : result.reason} ${result.message}`
            );
            if (result.success) {
                trips++;
                if (kind === 'food') break;
                continue;
            }
            if (result.reason === 'no_space') {
                log('WARN', `${partner} inventory full — waiting`);
                await sdk.waitForTicks(20);
                continue;
            }
            break;
        }
        log('LOG', `Give done leftover ${kind === 'food' ? foodSummary(sdk) : lootSummary(sdk)}`);
    }

    async function runReceive(): Promise<void> {
        if (!partner) throw new Error('receive requires a partner');
        await declineIfOpen();
        await leaveRangingGuild();
        if (kind === 'food' && usedSlots(sdk) > 24) await bankLootKeepFood();
        await walkToMeet(true);
        const from = new RegExp(`^${escapeRegex(partner)}$`, 'i');
        log('LOG', `Waiting for ${partner}`);
        const windowEnd = Date.now() + 6 * 60_000;
        let got = 0;
        while (Date.now() < windowEnd && got < 8) {
            const served = await bot.serveTrades({
                from,
                give: [],
                want: kind === 'food' ? [{ item: FOOD, amount: 1 }] : [],
                maxTrades: 1,
                timeout: Math.max(8_000, windowEnd - Date.now()),
                tradeTimeout: 90_000
            });
            const last = served.trades[served.trades.length - 1];
            if (last?.success) {
                got++;
                log(
                    'LOG',
                    `Receive ok ${served.message} | ${kind === 'food' ? foodSummary(sdk) : lootSummary(sdk)}`
                );
                if (kind === 'food') break;
                if (usedSlots(sdk) >= 22) await bankLootKeepFood();
                await walkToMeet(true);
                continue;
            }
            log('WARN', `Receive ${last?.reason ?? served.reason} ${served.message}`);
            if (Date.now() >= windowEnd) break;
            if (served.reason !== 'timeout') break;
        }
        log('LOG', `Receive done (${got} trip(s))`);
    }

    async function runDump(): Promise<void> {
        const packed = await packLoot();
        if (packed <= 0 && lootGiveList(sdk).length === 0) {
            log('LOG', 'Nothing to dump');
            return;
        }
        await walkToMeet(false);
        const deadline = Date.now() + 8 * 60_000;
        let trips = 0;
        while (Date.now() < deadline && trips < 12) {
            const give = lootGiveList(sdk);
            if (give.length === 0) {
                const more = await packLoot();
                if (more <= 0) {
                    log('LOG', 'Dump complete');
                    break;
                }
                await walkToMeet(false);
                continue;
            }
            log('LOG', `Dump trip ${trips + 1} to ${partner || 'fatpig'}: ${lootSummary(sdk)}`);
            const result = await bot.trade(partner || 'fatpig', {
                give,
                want: [],
                requestTimeout: 45_000,
                timeout: 90_000,
                retryOnBusy: true
            });
            log(
                result.success ? 'LOG' : 'WARN',
                `Trade ${partner || 'fatpig'} ${result.success ? 'ok' : result.reason} ${result.message}`
            );
            if (result.success) {
                trips++;
                continue;
            }
            if (result.reason === 'no_space') {
                log('WARN', 'fatpig full — waiting for them to bank');
                await sdk.waitForTicks(20);
                continue;
            }
            break;
        }
        log('LOG', `Dump done leftover ${lootSummary(sdk)}`);
    }

    async function runCollect(): Promise<void> {
        await declineIfOpen();
        await leaveRangingGuild();
        const hub = parseMeet();
        if (inCatherby(hub.x, hub.z)) await goCatherby();
        else await goArdougne();
        await bankLootKeepFood();
        await walkNear(bot, sdk, hub.x, hub.z, 4);
        const from = partner
            ? new RegExp(`^${escapeRegex(partner)}$`, 'i')
            : /^(ABGARMY\d+|Jackpoo3|jacklove\d+)$/i;
        log('LOG', `Waiting for dumpers @ ${playerPos(sdk).x},${playerPos(sdk).z} meet=${hub.x},${hub.z}`);
        const windowEnd = Date.now() + 12 * 60_000;
        let got = 0;
        while (Date.now() < windowEnd) {
            const served = await bot.serveTrades({
                from,
                give: [],
                want: [{ item: /.+/i, amount: 1 }],
                maxTrades: 1,
                timeout: Math.min(3 * 60_000, windowEnd - Date.now()),
                tradeTimeout: 90_000
            });
            const last = served.trades[served.trades.length - 1];
            if (last?.success) {
                got++;
                log('LOG', `Collect ok ${served.message}`);
                await bankLootKeepFood();
                await walkNear(bot, sdk, hub.x, hub.z, 4);
                continue;
            }
            log('WARN', `Collect ${last?.reason ?? served.reason} ${served.message}`);
            if (served.reason === 'timeout' && got > 0) break;
            if (Date.now() >= windowEnd) break;
        }
        log('LOG', `Collect done (${got} trip(s))`);
    }

    await declineIfOpen();
    log('LOG', `tree-trade ${role} ${kind} partner=${partner || '-'} @ ${playerPos(sdk).x},${playerPos(sdk).z}`);
    if (role === 'pack') {
        if (kind === 'food') await packFood();
        else await packLoot();
    } else if (role === 'give') await runGive();
    else if (role === 'receive') await runReceive();
    else if (role === 'dump') await runDump();
    else if (role === 'collect') await runCollect();
    else throw new Error(`Unknown role ${role}`);
});
