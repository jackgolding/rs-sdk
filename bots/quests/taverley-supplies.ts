/**
 * Herblore supplies from Taverley instead of Aemad (Aemad's vials and rope were out of stock
 * for 10 trips straight, 2026-11-01): Jatix's Herblore Shop (2899,3427: 800 vials at 2gp,
 * 800 eye of newt at 3gp), bank at Falador east, fill the empty vials at the fountain by the
 * bank, repeat until the bank holds the targets. Pattern from guam-irit-potions.ts.
 *
 *   bun bots/quests/taverley-supplies.ts {botname} [--vials=1000] [--eyes=1000]
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { installGracefulShutdown } from '../../sdk/runner';
import { closeUi, walkNear } from './movement';
import { buyAtShop } from './quest-supplies';
import { FALADOR_EAST_BANK } from './tiles';

const JATIX = { x: 2899, z: 3427, npc: /^jatix$/i };
/** The west park fountain guam-irit-potions.ts uses, if none is in view of the east bank. */
const FALLBACK_FOUNTAIN = { x: 2950, z: 3379 };
const EMPTY = /^vial$/i;
const WATER = /^vial of water$/i;
const EYE = /^eye of newt$/i;
const COINS = /^coins$/i;
const PARK_MS = 30 * 60_000;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const num = (n: string, d: number) => Number(argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d);
const VIAL_TARGET = num('vials', 1000);
const EYE_TARGET = num('eyes', 1000);

const envPath = botArg ? join(process.cwd(), 'bots', botArg, 'bot.env') : join(dirname(import.meta.path), 'bot.env');
if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}`);
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    const eq = t.indexOf('=');
    if (t && !t.startsWith('#') && eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}
const username = process.env.BOT_USERNAME!;
initPathfinding();
const sdk = new BotSDK({
    botUsername: username,
    password: process.env.PASSWORD!,
    gatewayUrl: deriveGatewayUrl(process.env.SERVER),
    autoLaunchBrowser: false,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false
});
await sdk.connect();
const bot = new BotActions(sdk);
const session = new ActivitySession(sdk, bot, {
    name: 'taverley-supplies',
    grindLogPath: join(process.cwd(), 'bots', username, 'grind.log'),
    stallMs: 300_000,
    maxRecoveryTactics: 6
});
installGracefulShutdown({ graceMs: 55_000 });

const log = (m: string) => session.log('log', m);
const pos = () => ({ x: sdk.getState()?.player?.worldX ?? 0, z: sdk.getState()?.player?.worldZ ?? 0 });
const dist = (t: { x: number; z: number }) => Math.hypot(pos().x - t.x, pos().z - t.z);
const held = (p: RegExp) => sdk.getInventory().filter((i) => p.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const banked = (p: RegExp) => (sdk.getBankItems() ?? []).filter((b) => p.test(b.name)).reduce((n, b) => n + b.count, 0);
let bought = { vials: 0, eyes: 0 };
let filledTotal = 0;

async function goTo(t: { x: number; z: number }, tol = 3): Promise<void> {
    if (dist(t) <= tol) return;
    const r = await bot.walkTo(t.x, t.z, tol);
    if (!r.success && dist(t) > tol + 2) await walkNear(bot, sdk, t.x, t.z, tol);
}

/** Bank everything but coins; top coins up to 6k. Returns the bank's counts. */
async function bank(): Promise<{ water: number; empty: number; eyes: number } | null> {
    await session.setPhase('bank');
    await goTo(FALADOR_EAST_BANK, 3);
    const opened = await bot.openBank();
    if (!opened.success) {
        session.noteFailure('bank', `openBank: ${opened.message}`);
        return null;
    }
    for (let i = 0; i < 28; i++) {
        const it = sdk.getInventory().find((x) => (x.count ?? 0) > 0 && !COINS.test(x.name));
        if (!it) break;
        const r = await bot.depositItem(it, -1);
        if (!r.success && !r.partial) break;
    }
    const coins = sdk.findBankItem(COINS);
    if (held(COINS) < 6000 && coins) await bot.withdrawItem(coins, Math.min(coins.count, 6000 - held(COINS)));
    await sdk.waitForTicks(2).catch(() => {});
    const c = { water: banked(WATER), empty: banked(EMPTY), eyes: banked(EYE) };
    log(`Bank: vials of water ${c.water}/${VIAL_TARGET} empty ${c.empty} eyes ${c.eyes}/${EYE_TARGET} coins ${held(COINS)} | bought vials ${bought.vials} eyes ${bought.eyes} filled ${filledTotal}`);
    return c;
}

/** Fill a pack of empties at the nearest fountain; returns the number filled. */
async function fillTrip(): Promise<number> {
    const empties = sdk.findBankItem(EMPTY);
    if (!empties) return 0;
    await bot.withdrawItem(empties, Math.min(27, empties.count));
    await bot.closeBank();
    await session.setPhase('fill');
    await sdk.scanNearbyLocs(25).catch(() => {});
    let fountain = sdk.findNearbyLoc(/^fountain$/i, { reachable: true });
    if (!fountain) {
        await goTo(FALLBACK_FOUNTAIN, 4);
        await sdk.scanNearbyLocs(15).catch(() => {});
        fountain = sdk.findNearbyLoc(/^fountain$/i);
    }
    if (!fountain) {
        session.log('warn', `no fountain near ${pos().x},${pos().z}`);
        return 0;
    }
    let filled = 0;
    let misses = 0;
    while (held(EMPTY) > 0 && misses < 4 && !session.isStoppedOrRequested()) {
        const vial = sdk.findInventoryItem(EMPTY);
        if (!vial) break;
        const before = held(WATER);
        await bot.useItemOnLoc(vial, fountain);
        await sdk.waitForCondition(() => held(WATER) > before, 4_000).catch(() => {});
        if (held(WATER) > before) {
            filled += held(WATER) - before;
            misses = 0;
        } else misses++;
    }
    filledTotal += filled;
    if (filled) session.noteProgress('inventory', `filled ${filled}`);
    log(`Filled ${filled} vials at the fountain (${fountain.x},${fountain.z})`);
    return filled;
}

/** A pack from Jatix: empties and eyes of newt in the proportion still needed. */
async function buyTrip(needVials: number, needEyes: number): Promise<number> {
    await bot.closeBank();
    await session.setPhase('shop');
    const space = 27;
    const vials = needVials > 0 ? Math.min(needVials, needEyes > 0 ? Math.ceil(space / 2) : space) : 0;
    const eyes = needEyes > 0 ? Math.min(needEyes, space - vials) : 0;
    const before = { v: held(EMPTY), e: held(EYE) };
    await buyAtShop(
        { bot, sdk, log, intent: (m: string) => void session.showIntent(m), walkNear: (x, z, t = 3) => walkNear(bot, sdk, x, z, t), closeUi: () => closeUi(bot, sdk) },
        JATIX,
        [...(vials ? [{ pattern: EMPTY, amount: vials, label: 'vial' }] : []), ...(eyes ? [{ pattern: EYE, amount: eyes, label: 'eye of newt' }] : [])]
    ).catch((e) => log(`Jatix: ${e instanceof Error ? e.message : String(e)}`));
    await closeUi(bot, sdk);
    const got = { v: held(EMPTY) - before.v, e: held(EYE) - before.e };
    bought.vials += got.v;
    bought.eyes += got.e;
    log(`Jatix: bought ${got.v} vials, ${got.e} eyes of newt (coins ${held(COINS)})`);
    return got.v + got.e;
}

async function park(why: string): Promise<void> {
    await session.setPhase('parked');
    log(`parked: ${why} — rechecking in 30 min`);
    const until = Date.now() + PARK_MS;
    while (Date.now() < until && !session.isStopped()) {
        session.maybeHeartbeat();
        await sdk.waitForTicks(50).catch(() => {});
    }
}

session.registerRecovery([{ name: 'bank', run: async () => (await bank()) !== null }]);
session.setAnchor(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z);

try {
    await closeUi(bot, sdk);
    log(`Taverley supplies @ ${pos().x},${pos().z} targets vials=${VIAL_TARGET} eyes=${EYE_TARGET}`);
    while (!session.isStoppedOrRequested()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        session.maybeHeartbeat();
        const c = await bank();
        if (!c) {
            await sdk.waitForTicks(10).catch(() => {});
            continue;
        }
        if (c.empty > 0) {
            await fillTrip();
            continue;
        }
        const needVials = Math.max(0, VIAL_TARGET - c.water - c.empty);
        const needEyes = Math.max(0, EYE_TARGET - c.eyes);
        if (needVials + needEyes === 0) {
            await bot.closeBank();
            await park(`bank holds ${c.water} vials of water and ${c.eyes} eyes of newt`);
            continue;
        }
        if (held(COINS) < 60) {
            await bot.closeBank();
            session.log('warn', 'out of coins');
            await park('no coins');
            continue;
        }
        if ((await buyTrip(needVials, needEyes)) === 0) await sdk.waitForTicks(100).catch(() => {});
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    if (sdk.getInventory().some((i) => !COINS.test(i.name)) || dist(FALADOR_EAST_BANK) > 6) {
        await bank().catch(() => null);
        await bot.closeBank().catch(() => undefined);
    }
    log(`stopped: bought vials ${bought.vials} eyes ${bought.eyes} filled ${filledTotal}`);
    await session.finalizeStop();
    await sdk.disconnect();
}
