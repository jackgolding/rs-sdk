#!/usr/bin/env bun
/**
 * Split ABGARMY14's noted magic longbows and ABGARMY16's noted magic shortbows
 * across every roster account except jackthief. Jackthief ferries the stacks.
 *
 *   bun bots/quests/split-magic-bows.ts
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import type { TradeItemSpec } from '../../sdk/types';
import { rosterBots, ROOT } from '../../.cursor/skills/wake-fleet/scripts/roster';
import { closeUi, playerPos, walkNear } from './movement';
import { initPathfinding } from '../../sdk/pathfinding';
import { VARROCK_EAST_BANK } from './tiles';

const BANK = VARROCK_EAST_BANK;
const LONG = /^magic longbow$/i;
const SHORT = /^magic shortbow$/i;

type Client = { name: string; sdk: BotSDK; bot: BotActions };

function loadEnv(name: string): Record<string, string> {
    const path = join(ROOT, 'bots', name, 'bot.env');
    if (!existsSync(path)) throw new Error(`Missing bot.env for ${name}`);
    const env: Record<string, string> = {};
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return env;
}

async function connect(name: string): Promise<Client> {
    const env = loadEnv(name);
    const sdk = new BotSDK({
        botUsername: env.BOT_USERNAME || name,
        password: env.PASSWORD || '',
        gatewayUrl: env.GATEWAY_URL || deriveGatewayUrl(env.SERVER || 'rs-sdk-demo.fly.dev'),
        connectionMode: 'control',
        autoReconnect: false,
        autoLaunchBrowser: false,
        showChat: false,
        connectTimeout: 20_000,
        readyTimeout: 15_000
    });
    await sdk.connect();
    return { name, sdk, bot: new BotActions(sdk) };
}

function filled(sdk: BotSDK) {
    return sdk.getInventory().filter((item) => (item.count ?? 0) > 0);
}

function countOf(sdk: BotSDK, pattern: RegExp): number {
    return filled(sdk)
        .filter((item) => pattern.test(item.name))
        .reduce((sum, item) => sum + (item.count ?? 0), 0);
}

function freeSlots(sdk: BotSDK): number {
    return 28 - filled(sdk).length;
}

async function standAtBank(bot: BotActions, sdk: BotSDK): Promise<void> {
    await closeUi(bot, sdk);
    const here = playerPos(sdk);
    if (Math.hypot(here.x - BANK.x, here.z - BANK.z) > 12) {
        await walkNear(bot, sdk, BANK.x, BANK.z, 3);
    }
}

async function makeRoom(bot: BotActions, sdk: BotSDK, needed: number): Promise<string[]> {
    if (freeSlots(sdk) >= needed) return [];
    const opened = await bot.openBank();
    if (!opened.success && sdk.getState()?.bank?.isOpen !== true) {
        throw new Error(`bank did not open (${opened.message})`);
    }
    const parked: string[] = [];
    while (freeSlots(sdk) < needed) {
        const item = filled(sdk).find((entry) => !/^(magic longbow|magic shortbow|rune pickaxe)$/i.test(entry.name));
        if (!item) break;
        const moved = await bot.depositItem(item, -1);
        if (!moved.success) break;
        parked.push(`${item.name} x${item.count}`);
        await sdk.waitForTicks(1).catch(() => {});
    }
    await bot.closeBank();
    return parked;
}

async function tradeFrom(
    giver: Client,
    receiver: Client,
    give: TradeItemSpec[],
    from: RegExp
): Promise<string> {
    if (giver.sdk.getTradeState().isOpen) {
        await Promise.race([giver.bot.declineTrade(), Bun.sleep(6_000)]);
    }
    const serve = receiver.bot.serveTrades({
        from,
        maxTrades: 1,
        timeout: 70_000,
        tradeTimeout: 45_000,
        want: give.map((spec) => ({ item: spec.item, amount: spec.amount === -1 ? 1 : spec.amount }))
    }).catch((err: unknown) => ({
        success: false,
        message: err instanceof Error ? err.message : String(err),
        trades: [] as []
    }));
    await Bun.sleep(1_500);
    const sent = await giver.bot.trade(receiver.name, {
        give,
        timeout: 45_000,
        requestTimeout: 20_000,
        retryOnBusy: true
    });
    const served = await Promise.race([
        serve,
        Bun.sleep(20_000).then(() => ({ success: false, message: 'serve still going' }))
    ]);
    const gave = (sent.gave ?? []).map((item) => `${item.name} x${item.count}`).join(', ');
    const got = (sent.received ?? []).map((item) => `${item.name} x${item.count}`).join(', ');
    return `${sent.success ? 'ok' : 'FAIL'} ${sent.message ?? served.message} | gave [${gave}] got [${got}]`;
}

const names = rosterBots()
    .map((bot) => bot.name)
    .filter((name) => name.toLowerCase() !== 'jackthief')
    .sort((a, b) => a.localeCompare(b));

const longBase = Math.floor(184 / names.length);
const longExtra = 184 % names.length;
const shortBase = Math.floor(1840 / names.length);
const shortExtra = 1840 % names.length;
const shares = names.map((name, index) => ({
    name,
    long: longBase + (index < longExtra ? 1 : 0),
    short: shortBase + (index < shortExtra ? 1 : 0)
}));

initPathfinding();
let thief = await connect('jackthief');
const longHolder = await connect('ABGARMY14');
const shortHolder = await connect('ABGARMY16');
await standAtBank(thief.bot, thief.sdk);
await standAtBank(longHolder.bot, longHolder.sdk);
await standAtBank(shortHolder.bot, shortHolder.sdk);

const longHave = countOf(longHolder.sdk, LONG);
const shortHave = countOf(shortHolder.sdk, SHORT);
console.log(`[stock] ABGARMY14 magic longbow x${longHave}, ABGARMY16 magic shortbow x${shortHave}`);
console.log(`[plan] ${names.length} accounts: longbow ${longBase} (+1 for ${longExtra}), shortbow ${shortBase} (+1 for ${shortExtra})`);

const longKeep = shares.find((share) => share.name === 'ABGARMY14')!;
const shortKeep = shares.find((share) => share.name === 'ABGARMY16')!;
const sendLong = longHave - longKeep.long;
const sendShort = shortHave - shortKeep.short;
if (sendLong <= 0 || sendShort <= 0) throw new Error(`Nothing to ferry (long ${sendLong}, short ${sendShort})`);

const pulledLong = await Promise.race([
    tradeFrom(longHolder, thief, [{ item: LONG, amount: sendLong }], /abgarmy14/i),
    Bun.sleep(90_000).then(() => 'FAIL outer timeout')
]);
console.log(`[ferry] longbows ${pulledLong}`);
const pulledShort = await Promise.race([
    tradeFrom(shortHolder, thief, [{ item: SHORT, amount: sendShort }], /abgarmy16/i),
    Bun.sleep(90_000).then(() => 'FAIL outer timeout')
]);
console.log(`[ferry] shortbows ${pulledShort}`);
await longHolder.sdk.disconnect().catch(() => {});
await shortHolder.sdk.disconnect().catch(() => {});

let longLeft = countOf(thief.sdk, LONG);
let shortLeft = countOf(thief.sdk, SHORT);
console.log(`[thief] holding longbow x${longLeft}, shortbow x${shortLeft}`);
if (longLeft < sendLong || shortLeft < sendShort) {
    throw new Error('Ferry did not land both stacks');
}

const summary: string[] = [];
for (const share of shares) {
    const give: TradeItemSpec[] = [];
    if (share.name !== 'ABGARMY14' && share.long > 0) give.push({ item: LONG, amount: Math.min(share.long, longLeft) });
    if (share.name !== 'ABGARMY16' && share.short > 0) give.push({ item: SHORT, amount: Math.min(share.short, shortLeft) });
    if (give.length === 0) {
        summary.push(`${share.name}: keeps longbow x${share.long} shortbow x${share.short}`);
        continue;
    }
    let partner: Client | null = null;
    try {
        if (!thief.sdk.getState() || thief.sdk.getStateAge() > 8_000) {
            await thief.sdk.disconnect().catch(() => {});
            thief = await connect('jackthief');
            longLeft = countOf(thief.sdk, LONG);
            shortLeft = countOf(thief.sdk, SHORT);
        }
        partner = await connect(share.name);
        await standAtBank(partner.bot, partner.sdk);
        const needs =
            (give.some((spec) => spec.item === LONG) && countOf(partner.sdk, LONG) === 0 ? 1 : 0) +
            (give.some((spec) => spec.item === SHORT) && countOf(partner.sdk, SHORT) === 0 ? 1 : 0);
        const parked = await makeRoom(partner.bot, partner.sdk, needs);
        if (freeSlots(partner.sdk) < needs) {
            summary.push(`${share.name}: not enough room (free ${freeSlots(partner.sdk)}, need ${needs})`);
            continue;
        }
        console.log(`[trade] ${share.name} ${give.map((spec) => `${spec.item} x${spec.amount}`).join(' + ')}` + (parked.length ? ` parked ${parked.join(', ')}` : ''));
        const line = await Promise.race([
            tradeFrom(thief, partner, give, /jackthief/i),
            Bun.sleep(90_000).then(() => 'FAIL outer timeout')
        ]);
        console.log(`[trade] ${share.name} ${line}`);
        longLeft = countOf(thief.sdk, LONG);
        shortLeft = countOf(thief.sdk, SHORT);
        summary.push(`${share.name}: ${line}${parked.length ? ` | parked ${parked.join(', ')}` : ''}`);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`[trade] ${share.name} error ${message}`);
        summary.push(`${share.name}: error ${message}`);
    } finally {
        if (thief.sdk.getTradeState().isOpen) {
            await Promise.race([thief.bot.declineTrade(), Bun.sleep(6_000)]);
        }
        await partner?.sdk.disconnect().catch(() => {});
    }
}

await thief.sdk.disconnect().catch(() => {});
console.log('\n--- summary ---');
for (const line of summary) console.log(line);
console.log(`left on jackthief longbow x${longLeft} shortbow x${shortLeft}`);
