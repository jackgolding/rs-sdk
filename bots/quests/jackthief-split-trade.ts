#!/usr/bin/env bun
/**
 * Jackthief splits the stacks in their inventory across accounts with 90+ Attack,
 * takes every fire orb and any coins above 500k back from those accounts, and
 * gives one noted rune pickaxe to each account that does not already have one.
 *
 *   bun bots/quests/jackthief-split-trade.ts
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

const KEEP_COINS = 500_000;
const HIGH_ATTACK = 90;
const BANK = VARROCK_EAST_BANK;

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

function attackLevel(sdk: BotSDK): number {
    const skill = sdk.getSkills().find((entry) => /^attack$/i.test(entry.name));
    return skill?.baseLevel ?? skill?.level ?? 0;
}

function hasPickaxe(sdk: BotSDK, bankNames: string[]): boolean {
    if (countOf(sdk, /^rune pickaxe$/i) > 0) return true;
    const worn = sdk.getState()?.equipment ?? [];
    if (worn.some((item) => /^rune pickaxe$/i.test(item.name ?? '') && (item.count ?? 0) > 0)) return true;
    return bankNames.some((name) => /^rune pickaxe$/i.test(name));
}

async function standAtBank(bot: BotActions, sdk: BotSDK): Promise<void> {
    await closeUi(bot, sdk);
    const here = playerPos(sdk);
    if (Math.hypot(here.x - BANK.x, here.z - BANK.z) > 12) {
        await walkNear(bot, sdk, BANK.x, BANK.z, 3);
    }
}

async function openBank(bot: BotActions, sdk: BotSDK): Promise<boolean> {
    await standAtBank(bot, sdk);
    const opened = await bot.openBank();
    if (!opened.success) console.log(`[bank] open failed: ${opened.message}`);
    return opened.success || sdk.getState()?.bank?.isOpen === true;
}

/** Deposit unrelated stacks until `needed` inventory slots are free. */
async function makeRoom(bot: BotActions, sdk: BotSDK, needed: number): Promise<string[]> {
    const parked: string[] = [];
    while (freeSlots(sdk) < needed) {
        const item = filled(sdk).find((entry) => !/^(coins|fire orb|rune pickaxe)$/i.test(entry.name));
        if (!item) break;
        const moved = await bot.depositItem(item, -1);
        if (!moved.success) break;
        parked.push(`${item.name} x${item.count}`);
        await sdk.waitForTicks(1).catch(() => {});
    }
    return parked;
}

async function tradeOnce(
    thief: Client,
    partner: Client,
    thiefGive: TradeItemSpec[],
    partnerGive: TradeItemSpec[],
    expect: { orbs: boolean; coins: number }
): Promise<string> {
    const serve = partner.bot.serveTrades({
        from: /jackthief/i,
        maxTrades: 1,
        timeout: 70_000,
        tradeTimeout: 45_000,
        give: partnerGive
    }).catch((err: unknown) => ({
        success: false,
        message: err instanceof Error ? err.message : String(err),
        trades: []
    }));
    await Bun.sleep(1_500);
    const sent = await thief.bot.trade(partner.name, {
        give: thiefGive,
        timeout: 45_000,
        requestTimeout: 20_000,
        retryOnBusy: true,
        accept: (offer) => {
            if (expect.orbs && !offer.some((item) => /fire orb/i.test(item.name) && item.count > 0)) return false;
            if (expect.coins > 0 && !offer.some((item) => /^coins$/i.test(item.name) && item.count >= expect.coins)) {
                return false;
            }
            return true;
        }
    });
    const served = await Promise.race([
        serve,
        Bun.sleep(50_000).then(() => ({ success: false, message: 'serve timed out', trades: [] }))
    ]);
    const got = (sent.received ?? []).map((item) => `${item.name} x${item.count}`).join(', ');
    const gave = (sent.gave ?? []).map((item) => `${item.name} x${item.count}`).join(', ');
    return `${sent.success ? 'ok' : 'FAIL'} ${sent.message ?? served.message} | gave [${gave}] got [${got}]`;
}

let thief = await connect('jackthief');

async function ensureThief(): Promise<void> {
    const state = thief.sdk.getState();
    if (state && thief.sdk.getStateAge() < 8_000) return;
    await thief.sdk.disconnect().catch(() => {});
    thief = await connect('jackthief');
    console.log(`[thief] reconnected @ ${playerPos(thief.sdk).x},${playerPos(thief.sdk).z}`);
}
initPathfinding();
console.log(`[thief] ${thief.name} @ ${playerPos(thief.sdk).x},${playerPos(thief.sdk).z}`);
await standAtBank(thief.bot, thief.sdk);
if (!(await openBank(thief.bot, thief.sdk))) throw new Error('Jackthief could not open the bank');
const withdrawn = await thief.bot.withdrawItem(/^rune pickaxe$/i, -1, { asNote: true });
console.log(`[thief] note rune pickaxes: ${withdrawn.success ? withdrawn.message : withdrawn.message}`);
await thief.bot.closeBank();
let pickaxes = countOf(thief.sdk, /^rune pickaxe$/i);
console.log(`[thief] noted rune pickaxes in inventory: ${pickaxes}`);

let gifts = filled(thief.sdk)
    .filter((item) => !/^(rune pickaxe|coins|fire orb)$/i.test(item.name))
    .map((item) => item.name);
console.log(`[thief] stacks to split (${gifts.length}): ${gifts.join(', ')}`);

const HIGH_FIRST = new Set(
    [
        'ABGARMY02', 'ABGARMY04', 'ABGARMY05', 'ABGARMY07', 'ABGARMY08', 'ABGARMY09',
        'ABGARMY11', 'ABGARMY13', 'ABGARMY14', 'ABGARMY16', 'ABGARMY17', 'ABGARMY18',
        'ABGARMY19', 'ABGARMY20', 'jacklove1', 'jacklove2', 'jacklove3', 'jacklove5',
        'Jackpoo1', 'Jackpoo2', 'Jackpoo4', 'Jackpoo5'
    ].map((name) => name.toLowerCase())
);
const others = rosterBots()
    .map((bot) => bot.name)
    .filter((name) => name.toLowerCase() !== 'jackthief')
    .sort((a, b) => Number(HIGH_FIRST.has(b.toLowerCase())) - Number(HIGH_FIRST.has(a.toLowerCase())) || a.localeCompare(b));

const GIFT_DONE = new Set(
    ['ABGARMY02', 'ABGARMY04', 'ABGARMY05', 'ABGARMY07', 'ABGARMY08', 'ABGARMY09', 'ABGARMY11'].map((name) => name.toLowerCase())
);
const summary: string[] = [];
for (const name of others) {
    let partner: Client | null = null;
    try {
        await ensureThief();
        if (thief.sdk.getTradeState().isOpen) {
            await Promise.race([thief.bot.declineTrade(), Bun.sleep(8_000)]);
        }
        partner = await connect(name);
        await standAtBank(partner.bot, partner.sdk);
        const attack = attackLevel(partner.sdk);
        const high = attack >= HIGH_ATTACK;
        if (!(await openBank(partner.bot, partner.sdk))) {
            summary.push(`${name}: bank did not open`);
            continue;
        }
        if (high && countOf(partner.sdk, /fire orb/i) > 0) {
            const putBack = await partner.bot.depositItem(/fire orb/i, -1);
            if (!putBack.success) console.log(`[bank] ${name} deposit orbs: ${putBack.message}`);
        }
        const bank = partner.sdk.getBankItems();
        const bankNames = bank.map((item) => item.name);
        const needsPick = !hasPickaxe(partner.sdk, bankNames) && pickaxes > 0;
        const bankOrbs = bank.filter((item) => /fire orb/i.test(item.name)).reduce((sum, item) => sum + item.count, 0);
        const bankCoins = bank.filter((item) => /^coins$/i.test(item.name)).reduce((sum, item) => sum + item.count, 0);
        const invCoins = countOf(partner.sdk, /^coins$/i);
        const excessCoins = high ? Math.max(0, bankCoins + invCoins - KEEP_COINS) : 0;
        const withdrawCoins = Math.min(bankCoins, Math.max(0, excessCoins - invCoins));
        const withdrawOrbs = high && bankOrbs > 0;
        const room =
            (withdrawOrbs && countOf(partner.sdk, /fire orb/i) === 0 ? 1 : 0) +
            (withdrawCoins > 0 && invCoins === 0 ? 1 : 0);
        const parked = room > 0 ? await makeRoom(partner.bot, partner.sdk, room) : [];
        if (withdrawOrbs) {
            let took = await partner.bot.withdrawItem(/fire orb/i, -1, { asNote: true });
            if (!took.success && /toggle/i.test(took.message)) {
                await partner.sdk.sendClickComponent(5386);
                await partner.sdk.waitForTicks(2).catch(() => {});
                took = await partner.bot.withdrawItem(/fire orb/i, -1, { asNote: true });
            }
            if (!took.success) console.log(`[bank] ${name} orbs: ${took.message}`);
        }
        if (withdrawCoins > 0) {
            const took = await partner.bot.withdrawItem(/^coins$/i, withdrawCoins);
            if (!took.success) console.log(`[bank] ${name} coins: ${took.message}`);
        }
        await partner.bot.closeBank();

        const orbs = countOf(partner.sdk, /fire orb/i);
        const coins = countOf(partner.sdk, /^coins$/i);
        const offerCoins = Math.min(excessCoins, coins);
        const partnerGive: TradeItemSpec[] = [];
        if (orbs > 0) partnerGive.push({ item: /fire orb/i, amount: -1 });
        if (offerCoins > 0) partnerGive.push({ item: /^coins$/i, amount: offerCoins });

        const giving = (orbs > 0 ? 1 : 0) + (offerCoins > 0 ? 1 : 0);
        let spare = freeSlots(partner.sdk) + giving;
        const thiefGive: TradeItemSpec[] = [];
        if (needsPick && pickaxes > 0) {
            if (spare < 1) {
                if (await openBank(partner.bot, partner.sdk)) {
                    parked.push(...(await makeRoom(partner.bot, partner.sdk, 1)));
                    await partner.bot.closeBank();
                    spare = freeSlots(partner.sdk) + giving;
                }
            }
            if (spare >= 1) {
                thiefGive.push({ item: /^rune pickaxe$/i, amount: 1 });
                spare -= 1;
            }
        }
        const gift = high && !GIFT_DONE.has(name.toLowerCase()) && gifts.length > 0 && spare >= 1 ? gifts[0]! : null;
        if (gift) {
            thiefGive.push({ item: new RegExp(`^${gift.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), amount: -1 });
        }
        if (thiefGive.length === 0 && partnerGive.length === 0) {
            summary.push(`${name}: nothing to trade`);
            continue;
        }

        console.log(
            `[trade] ${name} atk ${attack} receive ${thiefGive.map((spec) => String(spec.item)).join(' + ') || 'nothing'}` +
                (parked.length ? ` parked ${parked.join(', ')}` : '')
        );
        let line: string;
        try {
            line = await Promise.race([
                tradeOnce(thief, partner, thiefGive, partnerGive, { orbs: orbs > 0, coins: offerCoins }),
                Bun.sleep(90_000).then(() => 'FAIL outer timeout')
            ]);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (!/not connected/i.test(message)) throw err;
            console.log(`[thief] connection dropped during ${name}, retrying`);
            await thief.sdk.disconnect().catch(() => {});
            thief = await connect('jackthief');
            line = await Promise.race([
                tradeOnce(thief, partner, thiefGive, partnerGive, { orbs: orbs > 0, coins: offerCoins }),
                Bun.sleep(90_000).then(() => 'FAIL outer timeout')
            ]);
        }
        console.log(`[trade] ${name} ${line}`);
        pickaxes = countOf(thief.sdk, /^rune pickaxe$/i);
        gifts = filled(thief.sdk)
            .filter((item) => !/^(rune pickaxe|coins|fire orb)$/i.test(item.name))
            .map((item) => item.name);
        summary.push(`${name}: ${line}${parked.length ? ` | parked ${parked.join(', ')}` : ''}`);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`[trade] ${name} error ${message}`);
        summary.push(`${name}: error ${message}`);
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
console.log(`pickaxes left ${pickaxes}, stacks left ${gifts.join(', ') || 'none'}`);
