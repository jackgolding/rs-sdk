/**
 * Buy one plain shortbow (if the account has none) and an even share of the
 * bronze and iron arrows on the shelf, then bank them.
 *
 * Accounts run one at a time so the live stock is split across whoever is
 * left. Hickton is Catherby. Lowe is Varrock.
 *
 *   bun bots/quests/buy-range-kit.ts hickton Jackpoo1 ABGARMY02
 *   bun bots/quests/buy-range-kit.ts lowe Jackpoo5 ABGARMY13
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { closeUi, playerPos, walkKandarinToEdgeville, walkNear } from './movement';
import { CATHERBY_BANK, VARROCK_EAST_BANK } from './tiles';

const SHORTBOW = /^shortbow$/i;
const BRONZE = /^bronze arrows?$/i;
const IRON = /^iron arrows?$/i;
const COINS = /^coins$/i;
const KEEP = /^(coins|shortbow|bronze arrows?|iron arrows?)$/i;

const SHOPS = {
    hickton: { npc: /hickton/i, x: 2822, z: 3442, bank: CATHERBY_BANK, label: 'Hickton' },
    lowe: { npc: /lowe/i, x: 3232, z: 3423, bank: VARROCK_EAST_BANK, label: 'Lowe' }
} as const;

type ShopId = keyof typeof SHOPS;
type Client = { name: string; sdk: BotSDK; bot: BotActions };

const shopId = process.argv[2] as ShopId;
const names = process.argv.slice(3).filter((arg) => !arg.startsWith('-'));
const shop = SHOPS[shopId];
if (!shop || names.length === 0) {
    throw new Error('Usage: bun bots/quests/buy-range-kit.ts hickton|lowe Bot1 Bot2 ...');
}

function loadEnv(name: string): Record<string, string> {
    const path = join(process.cwd(), 'bots', name, 'bot.env');
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

function count(sdk: BotSDK, pattern: RegExp, where: 'inv' | 'bank'): number {
    const items = where === 'inv' ? sdk.getInventory() : sdk.getBankItems();
    return items.filter((item) => pattern.test(item.name) && (item.count ?? 0) > 0).reduce((sum, item) => sum + item.count, 0);
}

function shopStock(sdk: BotSDK, pattern: RegExp): number {
    return sdk.getState()?.shop?.shopItems.find((item) => pattern.test(item.name))?.count ?? 0;
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
        readyTimeout: 20_000
    });
    await sdk.connect();
    return { name, sdk, bot: new BotActions(sdk) };
}

async function reachBank(client: Client): Promise<void> {
    const here = playerPos(client.sdk);
    if (shopId === 'lowe' && here.x < 2990) {
        const walked = await walkKandarinToEdgeville(client.bot, client.sdk, {
            eat: async () => {
                const food = client.sdk.findInventoryItem(/shark|swordfish|lobster|tuna|bass|salmon|trout/i);
                if (food) await client.bot.eatFood(food).catch(() => {});
            }
        });
        if (!walked) throw new Error(`${client.name} did not reach Edgeville`);
    }
    const bank = shop.bank;
    const ok = await walkNear(client.bot, client.sdk, bank.x, bank.z, 4);
    if (!ok) throw new Error(`${client.name} did not reach ${shop.label} bank @ ${bank.x},${bank.z}`);
}

async function openBank(client: Client): Promise<void> {
    await reachBank(client);
    await closeUi(client.bot, client.sdk);
    const opened = await client.bot.openBank();
    if (!opened.success && !client.sdk.getState()?.bank?.isOpen) {
        throw new Error(`${client.name} bank did not open: ${opened.message}`);
    }
}

async function makeRoom(client: Client, slots: number): Promise<void> {
    for (let i = 0; i < 40 && 28 - client.sdk.getInventory().filter((item) => (item.count ?? 0) > 0).length < slots; i++) {
        const junk = client.sdk.getInventory().find((item) => (item.count ?? 0) > 0 && !KEEP.test(item.name));
        if (!junk) break;
        const deposited = await client.bot.depositItem(new RegExp(`^${junk.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), -1);
        if (!deposited.success && !deposited.partial) break;
    }
}

async function buyKit(client: Client, remaining: number): Promise<string> {
    await openBank(client);
    const hadBow = count(client.sdk, SHORTBOW, 'bank') + count(client.sdk, SHORTBOW, 'inv') > 0;
    await makeRoom(client, 4);
    const pocket = count(client.sdk, COINS, 'inv');
    if (pocket < 5_000) {
        const banked = count(client.sdk, COINS, 'bank');
        const need = Math.min(20_000, banked);
        if (need > 0) {
            const took = await client.bot.withdrawItem(COINS, need);
            if (!took.success) console.log(`[kit] ${client.name} coins: ${took.message}`);
        }
    }
    await client.bot.closeBank();
    const atShop = await walkNear(client.bot, client.sdk, shop.x, shop.z, 2);
    if (!atShop) throw new Error(`${client.name} did not reach ${shop.label}`);
    let shopMessage = 'shop did not open';
    for (let attempt = 0; attempt < 3 && !client.sdk.getState()?.shop?.isOpen; attempt++) {
        const door = client.sdk.findNearbyLoc(/door/i, { withOption: /open/i });
        if (door && (door.distance ?? 99) <= 4) await client.bot.openDoor(door);
        await client.sdk.sendWalk(shop.x, shop.z, true);
        await client.sdk.waitForTicks(3).catch(() => {});
        const opened = await client.bot.openShop(shop.npc);
        shopMessage = opened.message;
        if (opened.success || client.sdk.getState()?.shop?.isOpen) break;
        const dialog = client.sdk.getDialog();
        if (dialog?.isOpen) {
            const choice = dialog.options.find((option) => /trade|yes|shop/i.test(option.text)) ?? dialog.options[0];
            if (choice) await client.sdk.sendClickDialog(choice.index);
            await client.sdk.waitForCondition((state) => state.shop?.isOpen === true, 8_000).catch(() => {});
        }
    }
    if (!client.sdk.getState()?.shop?.isOpen) {
        throw new Error(`${client.name} ${shop.label} shop: ${shopMessage}`);
    }

    let bow = 'already had a shortbow';
    if (!hadBow && count(client.sdk, SHORTBOW, 'inv') === 0) {
        const stock = shopStock(client.sdk, SHORTBOW);
        if (stock > 0) {
            const bought = await client.bot.buyFromShop(SHORTBOW, 1);
            bow = bought.success || bought.partial ? 'bought shortbow' : `shortbow failed: ${bought.message}`;
        } else {
            bow = 'shortbow out of stock';
        }
    }

    const bronzeShare = Math.floor(shopStock(client.sdk, BRONZE) / remaining);
    const ironShare = Math.floor(shopStock(client.sdk, IRON) / remaining);
    let bronze = 0;
    let iron = 0;
    if (bronzeShare > 0) {
        const bought = await client.bot.buyFromShop(BRONZE, bronzeShare);
        bronze = bought.amountBought ?? 0;
    }
    if (ironShare > 0) {
        const bought = await client.bot.buyFromShop(IRON, ironShare);
        iron = bought.amountBought ?? 0;
    }
    await client.bot.closeShop();

    await openBank(client);
    for (const pattern of [SHORTBOW, BRONZE, IRON]) {
        if (count(client.sdk, pattern, 'inv') > 0) {
            await client.bot.depositItem(pattern, -1);
        }
    }
    const bankedBow = count(client.sdk, SHORTBOW, 'bank');
    const bankedBronze = count(client.sdk, BRONZE, 'bank');
    const bankedIron = count(client.sdk, IRON, 'bank');
    await client.bot.closeBank();
    return `${bow}; bought bronze ${bronze} iron ${iron}; bank shortbow ${bankedBow} bronze ${bankedBronze} iron ${bankedIron}`;
}

initPathfinding();
console.log(`[kit] ${shop.label} for ${names.join(', ')}`);
const summary: string[] = [];
for (let i = 0; i < names.length; i++) {
    const name = names[i]!;
    const remaining = names.length - i;
    let client: Client | null = null;
    try {
        client = await connect(name);
        const pos = playerPos(client.sdk);
        console.log(`[kit] ${name} @ ${pos.x},${pos.z} (${remaining} left including them)`);
        const line = await buyKit(client, remaining);
        console.log(`[kit] ${name} ${line}`);
        summary.push(`${name}: ${line}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[kit] ${name} FAIL ${message}`);
        summary.push(`${name}: FAIL ${message}`);
    } finally {
        try {
            await client?.sdk.disconnect();
        } catch {
            /* ignore */
        }
    }
}
console.log(`[kit] done\n${summary.join('\n')}`);
