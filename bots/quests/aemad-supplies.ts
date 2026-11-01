/**
 * Herblore and quest supplies from Aemad's Adventuring Supplies, East Ardougne (2613,3294):
 * vials of water (2gp, stock 500) for prayer-potion brewing (prayer-brew.ts) and rope (23gp,
 * stock 20) for Waterfall, Plague City and the Kalphite lair. Buys a pack, banks it at the
 * Ardougne south bank, repeats until the bank holds the targets, then parks and rechecks.
 *
 *   bun bots/quests/aemad-supplies.ts {botname} [--vials=1000] [--ropes=50]
 *
 * The user's call (2026-11-01): its own job, not a step inside the boss scripts.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { installGracefulShutdown } from '../../sdk/runner';
import { closeUi, walkNear } from './movement';
import { buyAtShop } from './quest-supplies';
import { ARDOUGNE_BANK } from './tiles';
import { crossAlKharidToll, inAlKharidRegion } from './alkharid-toll';
import { crossGnomeGate, inStronghold } from './lib/gnome-stronghold';
import type { Quest } from './lib/run-quest';

const AEMAD = { x: 2613, z: 3294, npc: /^aemad$/i };
const VIAL = /^vial of water$/i;
const ROPE = /^rope$/i;
const COINS = /^coins$/i;
/** Enough for a full pack of rope at 23gp with headroom for the price rising as stock falls. */
const COINS_WANT = 1_000;
const ROPES_PER_TRIP = 5;
const PARK_MS = 30 * 60_000;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const numArg = (name: string, dflt: number) => {
    const a = argv.find((x) => x.startsWith(`--${name}=`));
    return a ? Number(a.split('=')[1]) : dflt;
};
const VIAL_TARGET = numArg('vials', 1_000);
const ROPE_TARGET = numArg('ropes', 50);

function loadBotEnv(): void {
    const envPath = botArg ? join(process.cwd(), 'bots', botArg, 'bot.env') : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/aemad-supplies.ts {botname}`);
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
    }
}

loadBotEnv();
const username = process.env.BOT_USERNAME!;
initPathfinding();
const sdk = new BotSDK({
    botUsername: username,
    password: process.env.PASSWORD!,
    gatewayUrl: deriveGatewayUrl(process.env.SERVER),
    autoLaunchBrowser: false,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false
});
await sdk.connect();
const bot = new BotActions(sdk);
const session = new ActivitySession(sdk, bot, {
    name: 'aemad-supplies',
    grindLogPath: join(process.cwd(), 'bots', username, 'grind.log'),
    stallMs: 240_000,
    maxRecoveryTactics: 6
});
installGracefulShutdown({ graceMs: 30_000 });

let trips = 0;
let boughtVials = 0;
let boughtRopes = 0;

function log(msg: string): void {
    session.log('log', msg);
}

function pos() {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0 };
}

function distTo(x: number, z: number): number {
    return Math.hypot(pos().x - x, pos().z - z);
}

function count(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function banked(pattern: RegExp): number {
    return (sdk.getBankItems() ?? []).filter((b) => pattern.test(b.name)).reduce((n, b) => n + b.count, 0);
}

function freeSlots(): number {
    return 28 - sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

async function walkTo(x: number, z: number, tol: number): Promise<void> {
    if (distTo(x, z) <= tol) return;
    const r = await bot.walkTo(x, z, tol);
    if (!r.success && distTo(x, z) > tol + 2) await walkNear(bot, sdk, x, z, tol);
}

/** Out of Al Kharid or the Gnome Stronghold, the two starts walkTo has no route from. */
async function leaveStartArea(): Promise<void> {
    if (inAlKharidRegion(pos())) await crossAlKharidToll(bot, sdk, false, { log });
    if (inStronghold(pos())) {
        const q = {
            bot,
            sdk,
            log,
            goTo: (t: { x: number; z: number }, tol = 2) => walkNear(bot, sdk, t.x, t.z, tol).then(() => undefined),
            climbTo: async () => undefined
        } as unknown as Quest;
        await crossGnomeGate(q, false).catch((e) => log(`stronghold: leaving: ${(e as Error).message}`));
    }
}

/** Bank everything but coins, top coins up to COINS_WANT. False when the bank will not open. */
async function bank(): Promise<boolean> {
    await session.setPhase('bank');
    await walkTo(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
    const opened = await bot.openBank();
    if (!opened.success) {
        session.noteFailure('bank', `openBank: ${opened.message}`);
        return false;
    }
    for (let i = 0; i < 28; i++) {
        const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !COINS.test(it.name));
        if (!item) break;
        await bot.depositItem(item, -1);
        await sdk.waitForTicks(1).catch(() => {});
    }
    const coins = sdk.findBankItem(COINS);
    if (count(COINS) < COINS_WANT && coins) await bot.withdrawItem(coins, Math.min(coins.count, COINS_WANT - count(COINS)));
    await sdk.waitForTicks(2).catch(() => {});
    log(`Bank: vials ${banked(VIAL)}/${VIAL_TARGET} ropes ${banked(ROPE)}/${ROPE_TARGET} coins ${count(COINS)} | trips ${trips} bought vials ${boughtVials} ropes ${boughtRopes}`);
    return true;
}

/** One pack from Aemad: ropes first (the scarce stock), vials in the rest. */
async function buyPack(needVials: number, needRopes: number): Promise<number> {
    await session.setPhase('shop');
    await closeUi(bot, sdk);
    const ropes = Math.min(ROPES_PER_TRIP, needRopes, Math.floor(count(COINS) / 30));
    const vials = Math.min(needVials, freeSlots() - ropes, Math.floor((count(COINS) - ropes * 30) / 3));
    const before = { v: count(VIAL), r: count(ROPE) };
    const items = [
        ...(ropes > 0 ? [{ pattern: ROPE, amount: ropes, label: 'rope' }] : []),
        ...(vials > 0 ? [{ pattern: VIAL, amount: vials, label: 'vial of water' }] : [])
    ];
    if (items.length === 0) return 0;
    await buyAtShop(
        { bot, sdk, log, intent: (m: string) => void session.showIntent(m), walkNear: (x, z, t = 3) => walkNear(bot, sdk, x, z, t), closeUi: () => closeUi(bot, sdk) },
        AEMAD,
        items
    ).catch((e) => log(`Aemad: ${e instanceof Error ? e.message : String(e)}`));
    await closeUi(bot, sdk);
    const got = { v: count(VIAL) - before.v, r: count(ROPE) - before.r };
    boughtVials += got.v;
    boughtRopes += got.r;
    if (got.v + got.r > 0) session.noteProgress('inventory', `vials +${got.v} ropes +${got.r}`);
    log(`Aemad: bought ${got.v} vials of water, ${got.r} ropes (coins ${count(COINS)})`);
    return got.v + got.r;
}

async function park(why: string): Promise<void> {
    await session.setPhase('parked');
    log(`parked: ${why} — rechecking in ${PARK_MS / 60_000} min`);
    const until = Date.now() + PARK_MS;
    while (Date.now() < until && !session.isStopped()) {
        session.maybeHeartbeat();
        await sdk.waitForTicks(50).catch(() => {});
    }
}

session.registerRecovery([{ name: 'bank', run: async () => bank() }]);
session.setAnchor(AEMAD.x, AEMAD.z);

try {
    await closeUi(bot, sdk);
    log(`Aemad supplies @ ${pos().x},${pos().z} targets vials=${VIAL_TARGET} ropes=${ROPE_TARGET}`);
    await leaveStartArea();
    while (!session.isStopped()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        session.maybeHeartbeat();
        if (!(await bank())) {
            await sdk.waitForTicks(10).catch(() => {});
            continue;
        }
        const needVials = Math.max(0, VIAL_TARGET - banked(VIAL));
        const needRopes = Math.max(0, ROPE_TARGET - banked(ROPE));
        await bot.closeBank();
        if (needVials + needRopes === 0) {
            await park(`bank holds ${banked(VIAL)} vials and ${banked(ROPE)} ropes`);
            continue;
        }
        if (count(COINS) < 30) {
            session.log('warn', `out of coins (${count(COINS)} held, bank empty of coins)`);
            await park('no coins');
            continue;
        }
        const got = await buyPack(needVials, needRopes);
        trips++;
        // Aemad's stock restocks slowly once bought out: wait a while before the next pack.
        if (got === 0) await sdk.waitForTicks(100).catch(() => {});
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    log(`stopped: trips=${trips} vials=${boughtVials} ropes=${boughtRopes}`);
    await session.finalizeStop();
    await sdk.disconnect();
}
