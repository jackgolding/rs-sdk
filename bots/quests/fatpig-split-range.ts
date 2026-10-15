/**
 * Fatpig splits bronze arrows evenly across accounts under 90 Attack, and
 * gives a shortbow to each one that does not already have one. Shortbows he
 * does not have are bought from Lowe in Varrock. After each trade the
 * partner withdraws 20 food, then launchd starts bots/quests/wildy-range.ts.
 *
 *   bun bots/quests/fatpig-split-range.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import type { TradeItemSpec } from '../../sdk/types';
import { rosterBots, ROOT } from '../../.cursor/skills/wake-fleet/scripts/roster';
import { closeUi, playerPos, walkNear } from './movement';
import { initPathfinding } from '../../sdk/pathfinding';
import { VARROCK_EAST_BANK } from './tiles';

const HIGH_ATTACK = 90;
const FOOD_WITHDRAW = 20;
const BANK = VARROCK_EAST_BANK;
const LOWE = { x: 3232, z: 3423 };
const SKIP_PATH = join(ROOT, '.cursor/skills/wake-fleet/skip-bots.txt');
const LAUNCHD = join(ROOT, '.cursor/skills/wake-fleet/scripts/fleet-launchd.ts');
const SHORTBOW = /^shortbow$/i;
const BRONZE_ARROW = /^bronze arrows?$/i;
const COINS = /^coins$/i;
const FOOD_ORDER = [/^shark$/i, /^swordfish$/i, /^lobster$/i, /^tuna$/i, /^bass$/i, /^salmon$/i, /^trout$/i];
const KEEP = /^(shortbow|bronze arrows?|coins)$/i;

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

async function connect(name: string, mode: 'control' | 'observe'): Promise<Client> {
    const env = loadEnv(name);
    const sdk = new BotSDK({
        botUsername: env.BOT_USERNAME || name,
        password: env.PASSWORD || '',
        gatewayUrl: env.GATEWAY_URL || deriveGatewayUrl(env.SERVER || 'rs-sdk-demo.fly.dev'),
        connectionMode: mode,
        autoReconnect: false,
        autoLaunchBrowser: false,
        showChat: false,
        connectTimeout: 20_000,
        readyTimeout: 15_000
    });
    await sdk.connect();
    await sdk.waitForCondition((s) => (s.skills?.length ?? 0) > 0, 8_000).catch(() => {});
    return { name, sdk, bot: new BotActions(sdk) };
}

function filled(sdk: BotSDK) {
    return sdk.getInventory().filter((item) => (item.count ?? 0) > 0);
}

function countOf(sdk: BotSDK, pattern: RegExp): number {
    const worn = (sdk.getState()?.equipment ?? [])
        .filter((item) => pattern.test(item.name ?? ''))
        .reduce((sum, item) => sum + (item.count ?? 0), 0);
    return (
        worn +
        filled(sdk)
            .filter((item) => pattern.test(item.name))
            .reduce((sum, item) => sum + (item.count ?? 0), 0)
    );
}

function freeSlots(sdk: BotSDK): number {
    return 28 - filled(sdk).length;
}

function attackLevel(sdk: BotSDK): number {
    return sdk.getSkill('Attack')?.baseLevel ?? sdk.getSkill('Attack')?.level ?? 0;
}

function hasShortbow(sdk: BotSDK, bankNames: string[]): boolean {
    if (countOf(sdk, SHORTBOW) > 0) return true;
    return bankNames.some((name) => SHORTBOW.test(name));
}

function launchd(op: 'stop' | 'restart', name: string): void {
    const proc = Bun.spawnSync(['bun', LAUNCHD, op, name], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
    const text = `${proc.stdout}${proc.stderr}`.trim();
    console.log(`[launchd] ${op} ${name}: ${text || proc.exitCode}`);
}

function unskip(name: string): void {
    const lines = readFileSync(SKIP_PATH, 'utf8').split('\n');
    const next = lines.filter((line) => line.trim().toLowerCase() !== name.toLowerCase());
    writeFileSync(SKIP_PATH, next.join('\n'));
}

async function standAtBank(bot: BotActions, sdk: BotSDK): Promise<void> {
    await closeUi(bot, sdk);
    const here = playerPos(sdk);
    if (Math.hypot(here.x - BANK.x, here.z - BANK.z) > 10) {
        await walkNear(bot, sdk, BANK.x, BANK.z, 3);
    }
}

async function openBank(bot: BotActions, sdk: BotSDK): Promise<boolean> {
    await standAtBank(bot, sdk);
    if (sdk.getState()?.bank?.isOpen) return true;
    const opened = await bot.openBank();
    if (!opened.success) console.log(`[bank] open failed: ${opened.message}`);
    return opened.success || sdk.getState()?.bank?.isOpen === true;
}

async function depositOther(bot: BotActions, sdk: BotSDK): Promise<void> {
    for (let i = 0; i < 30; i++) {
        const item = filled(sdk).find((entry) => !KEEP.test(entry.name));
        if (!item) break;
        const moved = await bot.depositItem(item, -1);
        if (!moved.success && !moved.partial) break;
        await sdk.waitForTicks(1).catch(() => {});
    }
}

async function makeRoom(bot: BotActions, sdk: BotSDK, needed: number): Promise<void> {
    while (freeSlots(sdk) < needed) {
        const spareFood = countFood(sdk) > FOOD_WITHDRAW;
        const item =
            filled(sdk).find((entry) => !KEEP.test(entry.name) && !FOOD_ORDER.some((pattern) => pattern.test(entry.name))) ??
            (spareFood ? filled(sdk).find((entry) => FOOD_ORDER.some((pattern) => pattern.test(entry.name))) : undefined);
        if (!item) break;
        const moved = await bot.depositItem(item, -1);
        if (!moved.success && !moved.partial) break;
        await sdk.waitForTicks(1).catch(() => {});
    }
}

async function buyShortbows(giver: Client, needed: number): Promise<number> {
    if (needed <= 0) return 0;
    if (countOf(giver.sdk, COINS) < 50) {
        if (await openBank(giver.bot, giver.sdk)) {
            const bankGp = giver.sdk.findBankItem(COINS)?.count ?? 0;
            if (bankGp > 0) await giver.bot.withdrawItem(COINS, Math.min(bankGp, 500));
            await giver.bot.closeBank();
        }
    }
    if (countOf(giver.sdk, COINS) < 50) {
        console.log(`[lowe] ${countOf(giver.sdk, COINS)}gp — cannot buy shortbows`);
        return 0;
    }
    await walkNear(giver.bot, giver.sdk, LOWE.x, LOWE.z, 3);
    const before = countOf(giver.sdk, SHORTBOW);
    for (let attempt = 0; attempt < 8 && countOf(giver.sdk, SHORTBOW) - before < needed; attempt++) {
        if (freeSlots(giver.sdk) < 1) break;
        const opened = await giver.bot.openShop(/lowe/i);
        if (!opened.success && !giver.sdk.getState()?.shop?.isOpen) {
            console.log(`[lowe] shop failed: ${opened.message}`);
            break;
        }
        const line = giver.sdk.getState()?.shop?.shopItems.find((item) => SHORTBOW.test(item.name) && item.count > 0);
        if (!line) {
            console.log(`[lowe] shortbow out of stock (try ${attempt + 1})`);
            await giver.bot.closeShop();
            await Bun.sleep(15_000);
            continue;
        }
        const room = Math.min(needed - (countOf(giver.sdk, SHORTBOW) - before), line.count, freeSlots(giver.sdk));
        const bought = await giver.bot.buyFromShop(line, room);
        console.log(`[lowe] buy ${room} shortbow: ${bought.success || bought.partial ? 'ok' : bought.message}`);
        await giver.bot.closeShop();
        if (!bought.success && !bought.partial) break;
    }
    await walkNear(giver.bot, giver.sdk, BANK.x, BANK.z, 3);
    const got = countOf(giver.sdk, SHORTBOW) - before;
    console.log(`[lowe] bought ${got} shortbow, now ${countOf(giver.sdk, SHORTBOW)}`);
    return got;
}

async function withdrawFood(partner: Client): Promise<number> {
    if (!(await openBank(partner.bot, partner.sdk))) return countFood(partner.sdk);
    const slotsNeeded = (countFood(partner.sdk) > 0 ? 0 : 1) + (countOf(partner.sdk, SHORTBOW) > 0 ? 0 : 1);
    if (slotsNeeded > 0) await makeRoom(partner.bot, partner.sdk, slotsNeeded);
    let have = countFood(partner.sdk);
    for (const pattern of FOOD_ORDER) {
        if (have >= FOOD_WITHDRAW) break;
        const stocked = (partner.sdk.getState()?.bank?.items ?? []).find(
            (item) => (item.count ?? 0) > 0 && pattern.test(item.name)
        );
        if (!stocked) continue;
        const took = await partner.bot.withdrawItem(stocked, Math.min(FOOD_WITHDRAW - have, stocked.count));
        console.log(`[food] ${partner.name} ${stocked.name}: ${took.success || took.partial}`);
        have = countFood(partner.sdk);
    }
    if (countOf(partner.sdk, SHORTBOW) === 0) {
        let took = await partner.bot.withdrawItem(SHORTBOW, 1);
        if (!took.success && !took.partial) {
            await makeRoom(partner.bot, partner.sdk, 1);
            took = await partner.bot.withdrawItem(SHORTBOW, 1);
        }
        const bows = (partner.sdk.getState()?.bank?.items ?? [])
            .filter((item) => /bow/i.test(item.name))
            .map((item) => `${item.name} x${item.count}`)
            .join(', ');
        console.log(
            `[bow] ${partner.name} withdraw shortbow: ${took.success || took.partial} ${took.message ?? ''} slots=${freeSlots(partner.sdk)} bank bows=[${bows}]`
        );
    }
    await partner.bot.closeBank();
    return have;
}

function countFood(sdk: BotSDK): number {
    return FOOD_ORDER.reduce((sum, pattern) => sum + countOf(sdk, pattern), 0);
}

async function equip(partner: Client): Promise<void> {
    const bow = partner.sdk.findInventoryItem(SHORTBOW);
    if (bow && !partner.sdk.findEquipmentItem(SHORTBOW)) await partner.bot.equipItem(bow);
    const arrows = partner.sdk.findInventoryItem(BRONZE_ARROW);
    if (arrows) await partner.bot.equipItem(arrows);
}

async function tradeOnce(giver: Client, partner: Client, give: TradeItemSpec[]): Promise<string> {
    const serve = partner.bot
        .serveTrades({
            from: /fatpig/i,
            maxTrades: 1,
            timeout: 70_000,
            tradeTimeout: 45_000
        })
        .catch((err: unknown) => ({
            success: false,
            message: err instanceof Error ? err.message : String(err),
            trades: []
        }));
    await Bun.sleep(1_500);
    const sent = await giver.bot.trade(partner.name, {
        give,
        timeout: 45_000,
        requestTimeout: 20_000,
        retryOnBusy: true
    });
    await Promise.race([serve, Bun.sleep(50_000)]);
    const gave = (sent.gave ?? []).map((item) => `${item.name} x${item.count}`).join(', ');
    return `${sent.success ? 'ok' : 'FAIL'} ${sent.message} | gave [${gave}]`;
}

async function attackSnapshot(names: string[]): Promise<Map<string, number>> {
    const levels = new Map<string, number>();
    let index = 0;
    async function worker() {
        while (index < names.length) {
            const name = names[index++]!;
            let client: Client | null = null;
            try {
                client = await connect(name, 'observe');
                levels.set(name, attackLevel(client.sdk));
            } catch (err) {
                console.log(`[observe] ${name} ${err instanceof Error ? err.message : err}`);
            } finally {
                await client?.sdk.disconnect().catch(() => {});
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(8, names.length) }, () => worker()));
    return levels;
}

function argNames(flag: string): Set<string> | null {
    const index = process.argv.indexOf(flag);
    if (index < 0 || !process.argv[index + 1]) return null;
    return new Set(
        process.argv[index + 1]!
            .split(',')
            .map((name) => name.trim().toLowerCase())
            .filter(Boolean)
    );
}

initPathfinding();
const only = argNames('--only');
const gearOnly = argNames('--gear');
const rosterNames = rosterBots()
    .map((bot) => bot.name)
    .filter((name) => name.toLowerCase() !== 'fatpig')
    .filter((name) => {
        if (!only && !gearOnly) return true;
        const key = name.toLowerCase();
        return (only?.has(key) ?? false) || (gearOnly?.has(key) ?? false);
    });
const attacks = await attackSnapshot(rosterNames);
const targets = rosterNames
    .filter((name) => !gearOnly?.has(name.toLowerCase()) || only?.has(name.toLowerCase()))
    .filter((name) => {
        const attack = attacks.get(name);
        return attack == null || attack < HIGH_ATTACK;
    })
    .filter((name) => (only ? only.has(name.toLowerCase()) : true))
    .sort((a, b) => a.localeCompare(b));
console.log(`[targets] ${targets.length} under ${HIGH_ATTACK} attack: ${targets.join(', ')}`);

launchd('stop', 'fatpig');
let giver = await connect('fatpig', 'control');

async function ensureGiver(): Promise<void> {
    const state = giver.sdk.getState();
    if (state && giver.sdk.getStateAge() < 8_000) return;
    await giver.sdk.disconnect().catch(() => {});
    giver = await connect('fatpig', 'control');
    console.log(`[fatpig] reconnected @ ${playerPos(giver.sdk).x},${playerPos(giver.sdk).z}`);
}

console.log(`[fatpig] @ ${playerPos(giver.sdk).x},${playerPos(giver.sdk).z}`);
if (!(await openBank(giver.bot, giver.sdk))) throw new Error('Fatpig could not open the bank');
await depositOther(giver.bot, giver.sdk);
if (giver.sdk.findEquipmentItem(SHORTBOW)) await giver.bot.unequipItem(SHORTBOW);
if (giver.sdk.findEquipmentItem(BRONZE_ARROW)) await giver.bot.unequipItem(BRONZE_ARROW);
const bows = await giver.bot.withdrawItem(SHORTBOW, -1);
const arrows = await giver.bot.withdrawItem(BRONZE_ARROW, -1);
console.log(`[fatpig] withdraw shortbows: ${bows.message}`);
console.log(`[fatpig] withdraw bronze arrows: ${arrows.message}`);
await giver.bot.closeBank();
const arrowStack = filled(giver.sdk)
    .filter((item) => BRONZE_ARROW.test(item.name))
    .reduce((sum, item) => sum + item.count, 0);
const share = targets.length > 0 ? Math.floor(arrowStack / targets.length) : 0;
console.log(`[fatpig] ${countOf(giver.sdk, SHORTBOW)} shortbows, ${arrowStack} bronze arrows, ${share} each`);

const summary: string[] = [];
for (const [index, name] of targets.entries()) {
    let partner: Client | null = null;
    let startRange = false;
    try {
        await ensureGiver();
        if (giver.sdk.getTradeState().isOpen) {
            await Promise.race([giver.bot.declineTrade(), Bun.sleep(8_000)]);
        }
        launchd('stop', name);
        partner = await connect(name, 'control');
        const attack = attackLevel(partner.sdk);
        if (attack >= HIGH_ATTACK) {
            summary.push(`${name}: attack ${attack}, skipped`);
            continue;
        }
        await standAtBank(partner.bot, partner.sdk);
        const spot = { x: BANK.x + ((index % 5) - 2), z: BANK.z + (Math.floor(index / 5) % 2 === 0 ? 1 : -1) };
        if (Math.hypot(playerPos(partner.sdk).x - spot.x, playerPos(partner.sdk).z - spot.z) > 1) {
            await walkNear(partner.bot, partner.sdk, spot.x, spot.z, 1);
        }
        if (!(await openBank(partner.bot, partner.sdk))) {
            summary.push(`${name}: bank did not open`);
            continue;
        }
        const bankNames = partner.sdk.getBankItems().map((item) => item.name);
        const giveBow = !hasShortbow(partner.sdk, bankNames);
        await partner.bot.closeBank();
        if (giveBow && filled(giver.sdk).filter((item) => SHORTBOW.test(item.name)).length < 1) {
            await buyShortbows(giver, 1);
        }
        const heldArrows = countOf(partner.sdk, BRONZE_ARROW);
        const alreadyPaid = heldArrows >= 2_500 && heldArrows < 8_000;
        const giverGive: TradeItemSpec[] = [];
        if (!alreadyPaid && share > 0 && countOf(giver.sdk, BRONZE_ARROW) >= share) {
            giverGive.push({ item: BRONZE_ARROW, amount: share });
        }
        if (giveBow && filled(giver.sdk).some((item) => SHORTBOW.test(item.name))) {
            giverGive.push({ item: SHORTBOW, amount: 1 });
        }
        if (giverGive.length === 0) {
            const food = await withdrawFood(partner);
            await equip(partner);
            summary.push(`${name}: already geared, food ${food}, bow=${countOf(partner.sdk, SHORTBOW) > 0}`);
            startRange = food > 0 && countOf(partner.sdk, SHORTBOW) > 0 && countOf(partner.sdk, BRONZE_ARROW) > 0;
        } else {
        const slots =
            (giveBow && countOf(partner.sdk, SHORTBOW) === 0 ? 1 : 0) +
            (share > 0 && countOf(partner.sdk, BRONZE_ARROW) === 0 ? 1 : 0);
        if (slots > 0 && freeSlots(partner.sdk) < slots) {
            if (await openBank(partner.bot, partner.sdk)) {
                await makeRoom(partner.bot, partner.sdk, slots);
                await partner.bot.closeBank();
            }
        }
        console.log(
            `[trade] ${name} atk ${attack} ${giverGive.map((spec) => `${spec.item} x${spec.amount}`).join(' + ')}`
        );
        const line = await Promise.race([
            tradeOnce(giver, partner, giverGive),
            Bun.sleep(90_000).then(() => 'FAIL outer timeout')
        ]);
        console.log(`[trade] ${name} ${line}`);
        if (!line.startsWith('ok')) {
            summary.push(`${name}: ${line}`);
            continue;
        }
        const food = await withdrawFood(partner);
        await equip(partner);
        console.log(`[food] ${name} withdrew ${food}, bow=${countOf(partner.sdk, SHORTBOW) > 0} arrows=${countOf(partner.sdk, BRONZE_ARROW)}`);
        summary.push(`${name}: ${line} | food ${food}`);
        startRange = food > 0 && countOf(partner.sdk, SHORTBOW) > 0 && countOf(partner.sdk, BRONZE_ARROW) > 0;
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`[trade] ${name} error ${message}`);
        summary.push(`${name}: error ${message}`);
    } finally {
        if (giver.sdk.getTradeState().isOpen) {
            await Promise.race([giver.bot.declineTrade(), Bun.sleep(6_000)]);
        }
        if (partner?.sdk.getTradeState().isOpen) {
            await Promise.race([partner.bot.declineTrade(), Bun.sleep(6_000)]);
        }
        await partner?.sdk.disconnect().catch(() => {});
    }
    if (startRange) {
        unskip(name);
        launchd('restart', name);
    }
}

if (gearOnly) {
    const gearNames = rosterBots()
        .map((bot) => bot.name)
        .filter((name) => gearOnly.has(name.toLowerCase()) && !targets.some((target) => target.toLowerCase() === name.toLowerCase()));
    for (const name of gearNames) {
        let partner: Client | null = null;
        try {
            await ensureGiver();
            launchd('stop', name);
            partner = await connect(name, 'control');
            if (partner.sdk.getTradeState().isOpen) {
                await Promise.race([partner.bot.declineTrade(), Bun.sleep(6_000)]);
            }
            await standAtBank(partner.bot, partner.sdk);
            if (!(await openBank(partner.bot, partner.sdk))) {
                summary.push(`${name}: gear bank did not open`);
                continue;
            }
            const needsBow = !hasShortbow(partner.sdk, partner.sdk.getBankItems().map((item) => item.name));
            await partner.bot.closeBank();
            if (needsBow) {
                if (!filled(giver.sdk).some((item) => SHORTBOW.test(item.name))) await buyShortbows(giver, 1);
                if (filled(giver.sdk).some((item) => SHORTBOW.test(item.name))) {
                    const line = await tradeOnce(giver, partner, [{ item: SHORTBOW, amount: 1 }]);
                    console.log(`[trade] ${name} bow ${line}`);
                    summary.push(`${name}: bow ${line}`);
                }
            }
            let food = await withdrawFood(partner);
            if (countOf(partner.sdk, SHORTBOW) === 0) {
                if (!filled(giver.sdk).some((item) => SHORTBOW.test(item.name))) await buyShortbows(giver, 1);
                if (filled(giver.sdk).some((item) => SHORTBOW.test(item.name))) {
                    if (freeSlots(partner.sdk) < 1 && (await openBank(partner.bot, partner.sdk))) {
                        await makeRoom(partner.bot, partner.sdk, 1);
                        await partner.bot.closeBank();
                    }
                    const line = await tradeOnce(giver, partner, [{ item: SHORTBOW, amount: 1 }]);
                    console.log(`[trade] ${name} bow ${line}`);
                    food = Math.max(food, countFood(partner.sdk));
                }
            }
            await equip(partner);
            const ready = food > 0 && countOf(partner.sdk, SHORTBOW) > 0 && countOf(partner.sdk, BRONZE_ARROW) > 0;
            console.log(`[gear] ${name} food=${food} bow=${countOf(partner.sdk, SHORTBOW) > 0} arrows=${countOf(partner.sdk, BRONZE_ARROW)}`);
            summary.push(`${name}: gear food ${food} bow=${countOf(partner.sdk, SHORTBOW) > 0}`);
            if (!ready) continue;
            await partner.sdk.disconnect().catch(() => {});
            partner = null;
            unskip(name);
            launchd('restart', name);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.log(`[gear] ${name} error ${message}`);
            summary.push(`${name}: gear error ${message}`);
        } finally {
            if (giver.sdk.getTradeState().isOpen) await Promise.race([giver.bot.declineTrade(), Bun.sleep(6_000)]);
            await partner?.sdk.disconnect().catch(() => {});
        }
    }
}

const bowsLeft = countOf(giver.sdk, SHORTBOW);
const arrowsLeft = countOf(giver.sdk, BRONZE_ARROW);
await giver.sdk.disconnect().catch(() => {});
console.log('\n--- summary ---');
for (const line of summary) console.log(line);
console.log(`shortbows left ${bowsLeft}, arrows left ${arrowsLeft}`);
