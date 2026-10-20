/**
 * One-off: buy the three Fremennik combat helms from Skulgrimen's Battle Gear
 * in Rellekka and bank them at Seers'.
 *
 *   bun bots/quests/buy-fremennik-helms.ts jackthief
 *
 * Everything below is read from the server's own content, not a guide:
 *   scripts/areas/area_vt/configs/viking.inv  [viking_weapons_shop]
 *     stock8=viking_helmet_range   -> "Archer helm"
 *     stock9=viking_helmet_crush   -> "Berserker helm"
 *     stock10=viking_helmet_slash  -> "Warrior helm"      (each 5 in stock)
 *   configs/viking.obj: each carries cost=60000
 *   scripts/quests/quest_viking/scripts/viking_weapon_salesman.rs2: the counter
 *     opens ONLY once the Fremennik Trials are complete
 *     (`%viking = ^viking_complete`); before that he refuses outerlanders and
 *     runs a dialog instead, so this script needs a finished account.
 *   NPC placement: viking_weapons_salesman ("Skulgrimen") at 2663,3694.
 *
 * The price actually charged is read from the OPEN shop rather than assumed
 * from the obj cost — the NPC carries shop_buy_multiplier 700 — and every buy
 * is verified by the pack count growing, never by the click receipt.
 *
 * Idempotent: buys only what the account lacks (pack + bank) and then IDLES
 * with DONE instead of exiting, because a container that exits 0 is restarted
 * and would run the whole purchase again.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { installGracefulShutdown } from '../../sdk/runner';
import { playerPos, walkSendHops, waitForPlayerState } from './movement';
import { SEERS_BANK, type Tile } from './tiles';

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
if (!botArg) throw new Error('usage: buy-fremennik-helms.ts <botname>');

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
const GRIND_LOG = join(process.cwd(), 'bots', username, 'grind.log');

const SKULGRIMEN: Tile = { x: 2663, z: 3694 };
const COIN_CAP = 300_000;
const COINS = /^coins$/i;

interface Helm {
    label: string;
    re: RegExp;
}

const HELMS: Helm[] = [
    { label: 'Berserker helm', re: /^berserker helm$/i },
    { label: 'Archer helm', re: /^archer helm$/i },
    { label: 'Warrior helm', re: /^warrior helm$/i },
];

/** Seers' <-> Rellekka road, as walked (and proven) by fremennik-trials.ts.
 *  A single leg of this length silently no-ops, so it is crossed in chunks. */
const NORTH_ROAD: Tile[] = [
    { x: 2795, z: 3445 },
    { x: 2780, z: 3460 },
    { x: 2765, z: 3475 },
    { x: 2750, z: 3485 },
    SEERS_BANK,
    { x: 2715, z: 3495 },
    { x: 2705, z: 3510 },
    { x: 2698, z: 3530 },
    { x: 2692, z: 3550 },
    { x: 2688, z: 3570 },
    { x: 2680, z: 3590 },
    { x: 2672, z: 3610 },
    { x: 2665, z: 3630 },
    { x: 2660, z: 3650 },
    { x: 2660, z: 3665 },
    { x: 2658, z: 3671 },
];

initPathfinding();

const sdk = new BotSDK({
    botUsername: username,
    password,
    gatewayUrl: deriveGatewayUrl(server),
    autoLaunchBrowser: false,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    autoReconnect: false,
    showChat: false,
});
await sdk.connect();
const bot = new BotActions(sdk);
const session = new ActivitySession(sdk, bot, {
    name: 'buy-fremennik-helms',
    grindLogPath: GRIND_LOG,
    stallMs: 360_000,
    maxRecoveryTactics: 8,
});
installGracefulShutdown({ graceMs: 120_000 });

const log = (msg: string): void => {
    session.log('log', msg);
    void session.showIntent(msg).catch(() => undefined);
    console.log(`[helms] ${msg}`);
};
const invCount = (re: RegExp): number =>
    sdk.getInventory().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
const bankCount = (re: RegExp): number =>
    (sdk.getBankItems?.() ?? []).filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
const here = (): string => {
    const p = playerPos(sdk);
    return `${p.x},${p.z},${p.level}`;
};

if (!(await waitForPlayerState(sdk))) throw new Error('no fresh player state');
log(`start @ ${here()} — buying ${HELMS.map((h) => h.label).join(' + ')}`);

// ---- pack check first (no bank read needed for this half of the answer) ----
const inPack = HELMS.filter((h) => invCount(h.re) > 0);

// ---- coins and the bank half of the idempotency check ----
log(`travelling to Seers bank @ ${here()}`);
await walkSendHops(sdk, [...NORTH_ROAD].reverse(), SEERS_BANK, 4);
if (!sdk.getState()?.bank?.isOpen) {
    const opened = await bot.openBank();
    if (!opened.success && !sdk.getState()?.bank?.isOpen) {
        log(`bank would not open (${opened.message}) — stopping`);
        await sdk.disconnect().catch(() => undefined);
        process.exit(1);
    }
}
await sdk.waitForTicks(3).catch(() => undefined);

const missing = HELMS.filter((h) => invCount(h.re) === 0 && bankCount(h.re) === 0);
log(
    `already held: ${inPack.length ? inPack.map((h) => h.label).join(',') : 'none'} | ` +
        `in bank: ${HELMS.filter((h) => bankCount(h.re) > 0).map((h) => h.label).join(',') || 'none'} | ` +
        `to buy: ${missing.map((h) => h.label).join(',') || 'nothing'}`
);

if (missing.length === 0) {
    await bot.closeBank().catch(() => undefined);
    log('DONE — all three helms already held; nothing to buy');
    session.stop('done', 'nothing to buy', { restartable: false });
    while (true) await sdk.waitForTicks(100).catch(() => undefined);
}

const packCoins = invCount(COINS);
if (packCoins < COIN_CAP) {
    const available = bankCount(COINS);
    const want = Math.min(COIN_CAP - packCoins, available);
    if (want > 0) {
        const w = await bot.withdrawItem(COINS, want).catch(() => ({ success: false, message: 'threw' }));
        log(`coin withdraw ${want}: ${w.success} ${w.message ?? ''} (bank had ${available})`);
        session.noteProgress('bank', 'coins withdrawn');
    } else {
        log(`WARN bank holds ${available} coins — buying what the pack affords (${packCoins})`);
    }
}
await sdk.waitForTicks(2).catch(() => undefined);
log(`coins in pack: ${invCount(COINS)}`);
if (invCount(COINS) < 60_000) {
    log(`underfunded: ${invCount(COINS)} coins — a single helm costs 60000; stopping so this is visible`);
    await sdk.disconnect().catch(() => undefined);
    process.exit(1);
}
await bot.closeBank().catch(() => undefined);

// ---- travel to Skulgrimen and open his counter ----
log(`travelling to Skulgrimen @ ${here()}`);
await walkSendHops(sdk, NORTH_ROAD, SKULGRIMEN, 4);

let opened = false;
for (let attempt = 0; attempt < 4 && !opened; attempt++) {
    const r = await bot.openShop(/skulgrimen/i).catch((e: unknown) => ({ success: false, message: String(e) }));
    opened = r.success || !!sdk.getState()?.shop?.isOpen;
    log(`openShop attempt ${attempt + 1}: ${opened} ${r.message ?? ''} @ ${here()}`);
    if (!opened) await sdk.waitForTicks(6).catch(() => undefined);
}
if (!opened) {
    log('could not open Skulgrimen\'s counter (needs the Fremennik Trials complete) — stopping');
    await sdk.disconnect().catch(() => undefined);
    process.exit(1);
}

const shelf = sdk.getState()?.shop?.shopItems ?? [];
log(
    `shelf: ${shelf
        .filter((i) => HELMS.some((h) => h.re.test(i.name)))
        .map((i) => `${i.name} x${i.count} @${i.buyPrice}gp`)
        .join(' | ')}`
);

for (const helm of missing) {
    const line = shelf.find((i) => helm.re.test(i.name));
    if (!line) {
        log(`${helm.label}: not on the shelf — skipped`);
        continue;
    }
    const before = invCount(helm.re);
    const r = await bot.buyFromShop(helm.re, 1).catch((e: unknown) => ({ success: false, message: String(e) }));
    await sdk.waitForTicks(3).catch(() => undefined);
    const after = invCount(helm.re);
    log(`${helm.label}: buy success=${r.success} ${r.message ?? ''} pack ${before}->${after} @${line.buyPrice}gp`);
    if (after > before) session.noteProgress('shop', `bought ${helm.label}`);
}
await bot.closeShop().catch(() => undefined);
await sdk.waitForTicks(2).catch(() => undefined);

const bought = HELMS.filter((h) => invCount(h.re) > 0);
log(`pack now: ${bought.map((h) => h.label).join(',') || 'no helms'} — banking`);

// ---- bank them (helms are the deliverable; coins stay in the pack) ----
log(`travelling back to Seers bank @ ${here()}`);
await walkSendHops(sdk, [...NORTH_ROAD].reverse(), SEERS_BANK, 4);
if (!sdk.getState()?.bank?.isOpen) {
    const r = await bot.openBank();
    if (!r.success && !sdk.getState()?.bank?.isOpen) log(`bank would not open for the deposit (${r.message})`);
}
await sdk.waitForTicks(3).catch(() => undefined);
for (const item of [...sdk.getInventory()]) {
    if (!HELMS.some((h) => h.re.test(item.name))) continue;
    const d = await bot.depositItem(item, item.count ?? 1).catch((e: unknown) => ({ success: false, message: String(e) }));
    log(`deposit ${item.name} x${item.count}: ${d.success} ${d.message ?? ''}`);
    if (d.success) session.noteProgress('bank', `banked ${item.name}`);
}
await sdk.waitForTicks(3).catch(() => undefined);
log(
    `bank now holds: ${HELMS.map((h) => `${h.label}=${bankCount(h.re)}`).join(' ')} | pack coins=${invCount(COINS)}`
);
await bot.closeBank().catch(() => undefined);

const ok = HELMS.every((h) => bankCount(h.re) > 0 || invCount(h.re) > 0);
log(`${ok ? 'DONE' : 'INCOMPLETE'} — ${HELMS.map((h) => `${h.label}: bank=${bankCount(h.re)} pack=${invCount(h.re)}`).join(' | ')}`);
session.stop(ok ? 'done' : 'incomplete', 'helms purchase finished', { restartable: false });

// Idle rather than exit: a container that exits 0 is restarted by the supervisor
// and would run this purchase again from the top.
log('idling (idempotent — a restart will find nothing to buy)');
while (true) await sdk.waitForTicks(100).catch(() => undefined);
