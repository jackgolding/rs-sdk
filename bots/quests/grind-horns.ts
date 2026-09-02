/**
 * Bank unicorn horns → pestle and mortar → unicorn horn dust.
 *
 * Grinding has no delay and inv_del takes the first horn, so a burst of
 * OPHELDU packets aimed at the last horn slot converts the whole inventory
 * in about a tick. Pestle stays in the bag; 27 horns per trip.
 *
 *   bun bots/quests/grind-horns.ts fatpig
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { ActivitySession, BotSDK, deriveGatewayUrl, inWilderness } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import {
    ARDOUGNE_BANK,
    CATHERBY_BANK,
    DRAYNOR_BANK,
    EDGEVILLE,
    SEERS_BANK,
    type Tile
} from './tiles';
import { closeUi as closeUiShared, distTo as distToShared, walkNear as walkNearShared } from './movement';

const PESTLE = /^pestle and mortar$/i;
const HORN = /^unicorn horn$/i;
const DUST = /^unicorn horn dust$/i;
const KEEP = /^pestle and mortar$/i;

const FALADOR_WEST_BANK: Tile = { x: 2945, z: 3368 };
const FALADOR_EAST_BANK: Tile = { x: 3012, z: 3355 };
const BANKS: Tile[] = [
    FALADOR_WEST_BANK,
    FALADOR_EAST_BANK,
    EDGEVILLE,
    DRAYNOR_BANK,
    ARDOUGNE_BANK,
    SEERS_BANK,
    CATHERBY_BANK
];

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/grind-horns.ts {botname}`);
    }
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
}

loadBotEnv();

const username = process.env.BOT_USERNAME!;
const password = process.env.PASSWORD!;
const server = process.env.SERVER;
const GRIND_LOG = join(process.cwd(), 'bots', username, 'grind.log');

initPathfinding();

const sdk = new BotSDK({
    botUsername: username,
    password,
    gatewayUrl: deriveGatewayUrl(server),
    autoLaunchBrowser: false,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false
});

await sdk.connect();
const bot = new BotActions(sdk);
const session = new ActivitySession(sdk, bot, {
    name: 'grind-horns',
    grindLogPath: GRIND_LOG,
    stallMs: 90_000,
    maxRecoveryTactics: 8
});

let home: Tile = FALADOR_WEST_BANK;
let ground = 0;

function log(msg: string): void {
    session.log('log', msg);
}

function intent(msg: string): void {
    void session.showIntent(msg);
}

function pos() {
    const p = sdk.getState()?.player;
    return {
        x: p?.worldX ?? 0,
        z: p?.worldZ ?? 0,
        level: p?.level ?? 0,
        hp: p?.hp ?? 10,
        maxHp: p?.maxHp ?? 10,
        isDead: p?.isDead ?? false
    };
}

function distTo(x: number, z: number): number {
    return distToShared(sdk, x, z);
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function count(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function bankCount(pattern: RegExp): number {
    return sdk.getBankItems().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
}

function lastHorn() {
    const horns = sdk.getInventory().filter((i) => HORN.test(i.name) && (i.count ?? 0) > 0);
    if (horns.length === 0) return null;
    return horns.reduce((a, b) => (a.slot >= b.slot ? a : b));
}

function closestBank(): Tile {
    const p = pos();
    return BANKS.slice().sort((a, b) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(p.x - b.x, p.z - b.z))[0]!;
}

async function closeUi(): Promise<void> {
    await closeUiShared(bot, sdk);
}

async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
    return walkNearShared(bot, sdk, x, z, tolerance);
}

async function leaveWildy(): Promise<boolean> {
    if (!inWilderness(pos().x, pos().z)) return true;
    intent('Leaving wilderness (sendWalk south)');
    for (let i = 0; i < 20 && inWilderness(pos().x, pos().z) && !session.isStopped(); i++) {
        const p = pos();
        const destZ = Math.max(3516, p.z - 48);
        await sdk.sendWalk(p.x, destZ, true);
        const z0 = p.z;
        await sdk
            .waitForCondition((s) => (s.player?.worldZ ?? z0) < z0 - 4 || (s.player?.worldZ ?? z0) < 3520, 8_000)
            .catch(() => {});
        if (pos().z === z0) await sdk.waitForTicks(2).catch(() => {});
    }
    if (inWilderness(pos().x, pos().z)) {
        await sdk.sendWalk(pos().x, 3516, true);
        await sdk
            .waitForCondition((s) => (s.player?.worldZ ?? 3520) < 3520, 10_000)
            .catch(() => {});
    }
    return !inWilderness(pos().x, pos().z);
}

async function openHomeBank(): Promise<boolean> {
    if (inWilderness(pos().x, pos().z)) {
        if (!(await leaveWildy())) {
            session.noteFailure('wildy', 'Could not leave wilderness');
            return false;
        }
    }
    if (sdk.getState()?.bank?.isOpen) return true;
    await closeUi();
    session.setAnchor(home.x, home.z);
    if (distTo(home.x, home.z) > 6) {
        intent(`Walking to bank ${home.x},${home.z}`);
        await walkNear(home.x, home.z, 3);
    }
    if (!sdk.getState()?.bank?.isOpen) {
        const r = await bot.openBank();
        if (!r.success && !sdk.getState()?.bank?.isOpen) {
            session.noteFailure('bank_open', r.message || 'Could not open bank');
            return false;
        }
    }
    await sdk
        .waitForCondition((s) => s.bank?.isOpen === true && (s.bank.items?.length ?? 0) > 0, 8_000)
        .catch(() => {});
    return !!sdk.getState()?.bank?.isOpen;
}

async function depositExceptPestle(): Promise<void> {
    const ids = [...new Set(sdk.getInventory().filter((i) => !KEEP.test(i.name) && (i.count ?? 0) > 0).map((i) => i.id))];
    for (const id of ids) {
        const item = sdk.getInventory().find((i) => i.id === id);
        if (!item) continue;
        const r = await bot.depositItem(item, -1);
        if (!r.success && sdk.isBankOpen() && sdk.getInventory().some((i) => i.id === id)) {
            await sdk.sendBankDeposit(item.slot, -1);
            await sdk.waitForTicks(1).catch(() => {});
        }
    }
}

async function withdrawOne(pattern: RegExp): Promise<boolean> {
    if (sdk.findInventoryItem(pattern)) return true;
    const banked = sdk.findBankItem(pattern);
    if (!banked) return false;
    const r = await bot.withdrawItem(banked, 1, { asNote: false });
    if (!r.success && sdk.isBankOpen()) {
        await sdk.sendBankWithdraw(banked.slot, 1);
        await sdk.waitForTicks(2).catch(() => {});
    }
    return !!sdk.findInventoryItem(pattern);
}

async function withdrawHorns(amount: number): Promise<number> {
    if (amount <= 0) return 0;
    const before = count(HORN);
    const banked = sdk.findBankItem(HORN);
    if (!banked) return 0;
    const r = await bot.withdrawItem(banked, amount, { asNote: false });
    if (!r.success && sdk.isBankOpen() && occupiedSlots() < 28) {
        await sdk.sendBankWithdraw(banked.slot, amount);
    }
    await sdk
        .waitForCondition(() => count(HORN) > before || occupiedSlots() >= 28, 5_000)
        .catch(() => {});
    return Math.max(0, count(HORN) - before);
}

/** Queue one OPHELDU per horn at the last horn slot — inv_del eats the first. */
async function grindInventory(): Promise<number> {
    const before = count(HORN);
    if (before <= 0) return 0;
    await closeUi();
    const pestle = sdk.findInventoryItem(PESTLE);
    const horn = lastHorn();
    if (!pestle || !horn) return 0;
    intent(`Grind ${before} unicorn horns`);
    const source = pestle.slot;
    const target = horn.slot;
    await Promise.all(Array.from({ length: before }, () => sdk.sendUseItemOnItem(source, target)));
    await sdk.waitForCondition(() => count(HORN) === 0, 8_000).catch(() => {});
    while (count(HORN) > 0 && !session.isStopped()) {
        const p = sdk.findInventoryItem(PESTLE);
        const h = lastHorn();
        if (!p || !h) break;
        const n = count(HORN);
        await sdk.sendUseItemOnItem(p.slot, h.slot);
        await sdk.waitForCondition(() => count(HORN) < n, 3_000).catch(() => {});
        if (count(HORN) >= n) {
            session.noteFailure('grind', 'horn did not turn to dust');
            break;
        }
    }
    const made = before - count(HORN);
    if (made > 0) {
        ground += made;
        session.noteProgress('inventory', `dust ${made}`);
    }
    return made;
}

async function restock(): Promise<'work' | 'done' | 'fail'> {
    if (!(await openHomeBank())) return 'fail';
    await depositExceptPestle();
    session.noteProgress('bank', home.x + ',' + home.z);

    if (!(await withdrawOne(PESTLE))) {
        await bot.closeBank();
        session.stop('no_pestle', 'No pestle and mortar in bank or inventory');
        return 'fail';
    }

    const stock = bankCount(HORN);
    const free = 28 - occupiedSlots();
    if (stock <= 0) {
        await bot.closeBank();
        return 'done';
    }
    if (free < 1) {
        session.noteFailure('restock', 'No free inventory for horns');
        return 'fail';
    }

    const got = await withdrawHorns(Math.min(free, stock));
    await bot.closeBank();
    log(`Withdraw ${got} horns | bank ${Math.max(0, stock - got)} | ground ${ground}`);
    return got > 0 || count(HORN) > 0 ? 'work' : 'fail';
}

async function tick(): Promise<void> {
    if (sdk.findInventoryItem(PESTLE) && count(HORN) > 0) {
        if (session.metrics().phase !== 'grind') await session.setPhase('grind');
        const made = await grindInventory();
        if (made > 0) log(`Ground ${made} | inv dust ${count(DUST)} | total ${ground}`);
        if (count(HORN) > 0) return;
    }

    if (session.metrics().phase !== 'bank') await session.setPhase('bank');
    const result = await restock();
    if (result === 'done') {
        session.stop('done', `Ground ${ground} unicorn horns to dust`);
        return;
    }
    if (result === 'fail') await sdk.waitForTicks(3).catch(() => {});
}

session.registerRecovery([
    {
        name: 'leave_wildy',
        run: async () => leaveWildy()
    },
    {
        name: 'bank',
        run: async () => {
            await walkNear(home.x, home.z, 3);
            return distTo(home.x, home.z) <= 8;
        }
    }
]);

try {
    home = closestBank();
    session.setAnchor(home.x, home.z);
    await bot.skipTutorial();
    log(`Grind horns start @ ${pos().x},${pos().z} → bank ${home.x},${home.z}`);

    if (count(HORN) > 0 && sdk.findInventoryItem(PESTLE)) {
        await session.setPhase('grind');
    } else {
        await session.setPhase('bank');
        const first = await restock();
        if (first === 'done') session.stop('done', 'No unicorn horns in bank or inventory');
        if (first === 'fail' && !session.isStopped()) {
            session.stop('setup', 'Could not withdraw pestle and horns');
        }
    }

    while (!session.isStopped()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }
        session.maybeHeartbeat();
        await tick();
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    const stop = session.metrics().stopReason;
    if (stop) log(`stopped ${stop.code} @ ${stop.location.x},${stop.location.z} ground=${ground}`);
    await session.finalizeStop();
    await sdk.disconnect();
}
