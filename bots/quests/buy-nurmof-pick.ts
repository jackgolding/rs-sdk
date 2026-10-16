/**
 * One-off: buy a rune pickaxe from Nurmof's shop (Dwarven Mine) for a bot
 * that has none anywhere. Bootstrap for dorics-quest / essence loops, which
 * stop with no_pickaxe instead of buying the first one themselves.
 *
 *   # stop the bot's quest container first (one-controller rule), then:
 *   bun bots/quests/buy-nurmof-pick.ts jackthief
 *   # restart the quest container after; dorics-quest resumes on its own.
 *
 * Needs ~32k coins (bank + backpack combined). Idempotent: exits at once if
 * the bot already holds any pickaxe tier. Leaves the pickaxe in the
 * backpack (dorics-quest banks everything except a pickaxe itself).
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { walkNear, walkWaypoints, waitForPlayerState } from './movement';

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const capArg = argv.find((a) => a.startsWith('--cap='));
const PRICE_CAP = Math.max(33_000, parseInt(capArg?.split('=')[1] ?? '40000', 10) || 40_000);
if (!botArg) throw new Error('usage: buy-nurmof-pick.ts <botname> [--cap=40000]');

function loadBotEnv(): void {
    const envPath = join(process.cwd(), 'bots', botArg!, 'bot.env');
    if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}`);
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
    }
}
loadBotEnv();

const username = process.env.BOT_USERNAME!;
const password = process.env.PASSWORD!;
const server = process.env.SERVER;

const PICKAXE = /^(bronze|iron|steel|mithril|adamant|rune) pickaxe$/i;
const RUNE_PICK = /^rune pickaxe$/i;
const COINS = /^coins$/i;
const VARROCK_EAST_BANK = { x: 3253, z: 3420 };
const TO_DWARF_STAIRS = [
    { x: 3180, z: 3430 },
    { x: 3082, z: 3420 },
    { x: 3059, z: 3376 },
];
const FROM_DWARF_TO_VARROCK = [
    { x: 3082, z: 3420 },
    { x: 3180, z: 3430 },
    { x: 3253, z: 3420 },
];
const DWARF_DOOR = { x: 3063, z: 3380 };
const DWARF_STAIRS_UP = { x: 3058, z: 9776 };
const NURMOF = { x: 2998, z: 9844 };

function invCount(re: RegExp): number {
    return sdk.getInventory().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
}
function hasPickaxe(): boolean {
    return invCount(PICKAXE) > 0 || !!sdk.findEquipmentItem(PICKAXE);
}
function pos() {
    // World coords: the client's local x/z live in a different space
    // (essence.ts pos() uses worldX/worldZ for the same reason).
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? p?.x ?? 0, z: p?.worldZ ?? p?.z ?? 0 };
}
function underground(): boolean {
    const p = pos();
    return p.z >= 9600 && p.z <= 9920 && p.x >= 2930 && p.x <= 3072;
}

console.log('Warming pathfinder...');
initPathfinding();
const sdk = new BotSDK({
    botUsername: username,
    password,
    gatewayUrl: deriveGatewayUrl(server),
    autoLaunchBrowser: false,
    connectTimeout: 60_000,
    readyTimeout: 45_000,
    autoReconnect: false,
    showChat: false,
});
await sdk.connect();
const bot = new BotActions(sdk);
if (!(await waitForPlayerState(sdk))) throw new Error('no fresh player state');
console.log(`[pick] ${username} @ ${pos().x},${pos().z}`);

if (hasPickaxe()) {
    console.log('[pick] already holds a pickaxe — nothing to do');
    await sdk.disconnect().catch(() => {});
    process.exit(0);
}

// ---- coins: backpack + Varrock east bank ----
let coins = invCount(COINS);
if (coins < PRICE_CAP) {
    console.log(`[pick] backpack coins ${coins}, opening bank...`);
    if (!sdk.getState()?.bank?.isOpen) {
        await walkNear(bot, sdk, VARROCK_EAST_BANK.x, VARROCK_EAST_BANK.z, 2);
        const opened = await bot.openBank();
        if (!opened.success) throw new Error(`bank open failed: ${opened.message}`);
    }
    const bankCoins = (sdk.getBankItems?.() ?? []).find((b) => COINS.test(b.name))?.count ?? 0;
    const want = Math.min(PRICE_CAP - coins, bankCoins);
    if (want > 0) {
        const w = await bot.withdrawItem(COINS, want);
        if (!w.success) throw new Error(`coin withdraw failed: ${w.message}`);
    }
    await bot.closeBank().catch(() => undefined);
    coins = invCount(COINS);
    console.log(`[pick] coins after bank: ${coins} (bank had ${bankCoins})`);
}
if (coins < 32_000) throw new Error(`underfunded: ${coins} coins on hand, need ~32k for a rune pickaxe`);

// ---- walk to the mine, climb down ----
await walkWaypoints(bot, sdk, TO_DWARF_STAIRS);
for (let i = 0; i < 8 && !underground(); i++) {
    await sdk.scanNearbyLocs(8).catch(() => {});
    const loc = (sdk.getNearbyLocs() ?? [])
        .filter((l) => /stair/i.test(l.name) && l.optionsWithIndex.some((o) => /climb-down/i.test(o.text)) && l.reachable !== false)
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (!loc) {
        await walkNear(bot, sdk, DWARF_DOOR.x, DWARF_DOOR.z, 2);
        continue;
    }
    if ((loc.distance ?? 99) > 2) await walkNear(bot, sdk, loc.x, loc.z, 1);
    const beforeZ = pos().z;
    await bot.interactLoc(loc, /climb-down/i);
    await sdk.waitForCondition(() => Math.abs(pos().z - beforeZ) > 8, 8_000).catch(() => {});
}
if (!underground()) throw new Error('could not enter the dwarven mine');

// ---- open Nurmof, buy one rune pickaxe ----
await walkNear(bot, sdk, NURMOF.x, NURMOF.z, 3);
let shopMsg = 'shop did not open';
for (let attempt = 0; attempt < 3 && !sdk.getState()?.shop?.isOpen; attempt++) {
    const opened = await bot.openShop(/nurmof/i);
    shopMsg = opened.message;
    if (opened.success || sdk.getState()?.shop?.isOpen) break;
    const dialog = sdk.getDialog();
    if (dialog?.isOpen) {
        const choice = dialog.options.find((o) => /trade|yes|shop/i.test(o.text)) ?? dialog.options[0];
        if (choice) await sdk.sendClickDialog(choice.index);
        await sdk.waitForCondition((s) => s.shop?.isOpen === true, 8_000).catch(() => {});
    }
}
if (!sdk.getState()?.shop?.isOpen) throw new Error(`Nurmof shop: ${shopMsg}`);
const bought = await bot.buyFromShop(RUNE_PICK, 1);
await bot.closeShop().catch(() => undefined);
if (!bought.success && !bought.partial) throw new Error(`buy failed: ${bought.message} (bought ${bought.amountBought ?? 0})`);
console.log(`[pick] bought ${(bought.amountBought ?? 1)} rune pickaxe(s), coins left ${invCount(COINS)}`);

// ---- walk back, verify ----
await walkNear(bot, sdk, DWARF_STAIRS_UP.x, DWARF_STAIRS_UP.z, 3);
for (let i = 0; i < 8 && underground(); i++) {
    await sdk.scanNearbyLocs(8).catch(() => {});
    const loc = (sdk.getNearbyLocs() ?? [])
        .filter((l) => /stair/i.test(l.name) && l.optionsWithIndex.some((o) => /climb-up/i.test(o.text)) && l.reachable !== false)
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (!loc) break;
    if ((loc.distance ?? 99) > 2) await walkNear(bot, sdk, loc.x, loc.z, 1);
    const beforeZ = pos().z;
    await bot.interactLoc(loc, /climb-up/i);
    await sdk.waitForCondition(() => Math.abs(pos().z - beforeZ) > 8, 8_000).catch(() => {});
}
await walkWaypoints(bot, sdk, FROM_DWARF_TO_VARROCK);
if (!hasPickaxe()) throw new Error('pickaxe missing after the run — check the shop stock/logs');
console.log('[pick] done: rune pickaxe in backpack, restart the quest container');
await sdk.disconnect().catch(() => {});
process.exit(0);
