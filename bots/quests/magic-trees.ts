/**
 * Legends Guild magic trees → Seers bank.
 * Chop an inventory of magic logs, deposit them, repeat.
 *
 *   bun bots/quests/magic-trees.ts Jackpoo1
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { LEGENDS_MAGICS, SEERS_BANK } from './tiles';
import {
    closeUi as closeUiShared,
    distTo as distToShared,
    installWaitForTicksGuard,
    walkNear as walkNearShared
} from './movement';
import { nearLegendsMagic, travelToLegendsMagic } from '../Jackpoo1/travel-to-flax';
import { installGracefulShutdown } from '../../sdk/runner';

const MAGIC_LOGS = /^magic logs$/i;
const AXE = /^(bronze|iron|steel|black|mithril|adamant|rune) axe$/i;
const KEEP = /^(coins|(bronze|iron|steel|black|mithril|adamant|rune) axe)$/i;
const AXE_RANK = [
    'rune axe',
    'adamant axe',
    'mithril axe',
    'black axe',
    'steel axe',
    'iron axe',
    'bronze axe'
];

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/magic-trees.ts {botname}`);
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

console.log('Warming pathfinder...');
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

console.log('Opening/attaching the game client...');
await sdk.connect();
const bot = new BotActions(sdk);
const session = new ActivitySession(sdk, bot, {
    name: 'magic-trees',
    grindLogPath: GRIND_LOG,
    stallMs: 180_000,
    maxRecoveryTactics: 8
});

installGracefulShutdown();

installWaitForTicksGuard(sdk, session);

let lastIntent = '';
let lastLoggedWc = 0;

function log(msg: string): void {
    session.log('log', msg);
}

function intent(msg: string): void {
    if (msg === lastIntent) return;
    lastIntent = msg;
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

async function closeUi(): Promise<void> {
    await closeUiShared(bot, sdk);
}

async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
    return walkNearShared(bot, sdk, x, z, tolerance);
}

function wc(): number {
    return sdk.getSkill('Woodcutting')?.baseLevel ?? 1;
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function invFull(): boolean {
    return occupiedSlots() >= 28;
}

function count(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function bankCount(pattern: RegExp): number {
    return sdk.getBankItems().filter((i) => pattern.test(i.name)).reduce((n, i) => n + i.count, 0);
}

function hasAxe(): boolean {
    return !!(sdk.findInventoryItem(AXE) || sdk.findEquipmentItem(AXE));
}

function currentAxeName(): string | null {
    return sdk.findEquipmentItem(AXE)?.name ?? sdk.findInventoryItem(AXE)?.name ?? null;
}

function atTrees(): boolean {
    const p = pos();
    return nearLegendsMagic(p.x, p.z);
}

function inKandarin(): boolean {
    const p = pos();
    return p.x > 2400 && p.x < 2878 && p.z > 3200 && p.z < 3550 && p.z < 6400;
}

async function climbDown(): Promise<void> {
    if (pos().level <= 0) return;
    intent('Climbing down to the ground');
    for (let i = 0; i < 8 && pos().level > 0; i++) {
        const stairs = sdk.findNearbyLoc(/stair|ladder/i, { withOption: /climb-down|climb.down/i });
        if (!stairs) break;
        await bot.interactLoc(stairs, /climb-down|climb.down/i);
        await sdk.waitForCondition((s) => (s.player?.level ?? 1) === 0, 8_000).catch(() => {});
    }
}

async function openSeersBank(): Promise<boolean> {
    await climbDown();
    if (!sdk.getState()?.bank?.isOpen) await closeUi();
    if (distTo(SEERS_BANK.x, SEERS_BANK.z) > 4) {
        intent('Walking to Seers bank');
        await walkNear(SEERS_BANK.x, SEERS_BANK.z, 2);
    }
    if (!sdk.getState()?.bank?.isOpen) {
        const r = await bot.openBank();
        if (!r.success && !sdk.getState()?.bank?.isOpen) {
            session.noteFailure('bank_open', r.message || 'Could not open Seers bank');
            return false;
        }
    }
    await sdk
        .waitForCondition((s) => s.bank?.isOpen === true && (s.bank.items?.length ?? 0) > 0, 8_000)
        .catch(() => {});
    return !!sdk.getState()?.bank?.isOpen;
}

async function depositJunk(): Promise<void> {
    for (const item of [...sdk.getInventory()]) {
        if (KEEP.test(item.name)) continue;
        await bot.depositItem(item, -1);
    }
}

async function withdrawBestAxe(): Promise<void> {
    if (sdk.findEquipmentItem(/^rune axe$/i) || sdk.findInventoryItem(/^rune axe$/i)) return;
    for (const name of AXE_RANK) {
        const have =
            sdk.findEquipmentItem(new RegExp(`^${name}$`, 'i')) ??
            sdk.findInventoryItem(new RegExp(`^${name}$`, 'i'));
        if (have) return;
        const inBank = sdk.findBankItem(new RegExp(`^${name}$`, 'i'));
        if (!inBank) continue;
        const extra = sdk.findInventoryItem(AXE);
        if (extra) await bot.depositItem(extra, 1);
        const r = await bot.withdrawItem(inBank, 1);
        log(`Withdraw ${name}: ${r.success ? 'ok' : r.message}`);
        return;
    }
}

async function equipAxe(): Promise<void> {
    const axe = sdk.findInventoryItem(AXE);
    if (axe && !sdk.findEquipmentItem(AXE)) {
        const r = await bot.equipItem(axe);
        log(`Equip ${axe.name}: ${r.success ? 'ok' : r.message}`);
    }
}

async function bankTrip(): Promise<boolean> {
    const before = count(MAGIC_LOGS);
    if (!(await openSeersBank())) {
        if (hasAxe()) {
            log(`Seers bank did not open — already have ${currentAxeName()}`);
            return true;
        }
        return false;
    }
    const logs = sdk.findInventoryItem(MAGIC_LOGS);
    if (logs && (logs.count ?? 0) > 0) session.recordGain(logs.name, logs.count);
    await depositJunk();
    await withdrawBestAxe();
    const banked = before > 0 ? bankCount(MAGIC_LOGS) : 0;
    session.captureBankStock();
    await bot.closeBank();
    await equipAxe();
    session.noteProgress('bank', 'seers');
    if (before > 0) log(`Banked magic logs | bank ${banked} | WC ${wc()}`);
    return hasAxe();
}

async function goToTrees(): Promise<boolean> {
    session.setAnchor(LEGENDS_MAGICS.x, LEGENDS_MAGICS.z);
    if (atTrees()) return true;
    if (inKandarin()) {
        intent(`Walking to Legends Guild magics ${LEGENDS_MAGICS.x},${LEGENDS_MAGICS.z}`);
        await walkNear(LEGENDS_MAGICS.x, LEGENDS_MAGICS.z, 3);
        if (atTrees()) return true;
    }
    intent('Travelling to Legends Guild magics');
    const travel = await travelToLegendsMagic({ sdk, bot, log, session });
    if (travel !== 'arrived' && !atTrees()) {
        session.noteFailure('travel', `travel ended ${travel}`);
        return false;
    }
    await walkNear(LEGENDS_MAGICS.x, LEGENDS_MAGICS.z, 3);
    return atTrees();
}

function findTree() {
    return (
        sdk.findNearbyLoc(/^magic tree$/i, { reachable: true, withOption: /chop/i }) ??
        sdk.findNearbyLoc(/^magic tree$/i, { reachable: true })
    );
}

async function tick(): Promise<void> {
    await closeUi();
    await climbDown();

    if (!hasAxe()) {
        await bankTrip();
        return;
    }

    if (count(MAGIC_LOGS) > 0 && (invFull() || occupiedSlots() >= 27)) {
        await bankTrip();
        return;
    }

    if (invFull() && count(MAGIC_LOGS) < 1) {
        await bankTrip();
        return;
    }

    if (!(await goToTrees())) return;
    await equipAxe();
    await sdk.scanNearbyLocs(12).catch(() => {});
    let tree = findTree();
    if (!tree) {
        intent('Waiting for magic tree');
        await walkNear(LEGENDS_MAGICS.x, LEGENDS_MAGICS.z, 3);
        await sdk.waitForTicks(4);
        tree = findTree();
    }
    if (!tree) {
        session.noteFailure('no_tree', `no magic tree at ${pos().x},${pos().z}`);
        return;
    }

    intent(`Chop ${tree.name} at ${tree.x},${tree.z} (${count(MAGIC_LOGS)} logs)`);
    const before = count(MAGIC_LOGS);
    const r = await bot.chopTree(tree);
    if (count(MAGIC_LOGS) > before) {
        session.noteProgress('inventory', 'magic');
    } else if (!r.success) {
        session.noteFailure('chop', r.message);
    }
}

session.registerRecovery([
    {
        name: 'close_ui',
        run: async () => {
            await closeUi();
            return true;
        }
    },
    {
        name: 'seers_bank',
        run: async () => {
            await walkNear(SEERS_BANK.x, SEERS_BANK.z, 4);
            return distTo(SEERS_BANK.x, SEERS_BANK.z) <= 8;
        }
    },
    {
        name: 'tools',
        run: async () => bankTrip()
    },
    {
        name: 'trees',
        run: async () => {
            await goToTrees();
            await sdk.scanNearbyLocs(12).catch(() => {});
            return !!findTree();
        }
    }
]);

try {
    lastLoggedWc = wc();
    await bot.skipTutorial();
    await closeUi();
    log(`Magic trees start WC ${lastLoggedWc} @ ${pos().x},${pos().z}`);

    await session.setPhase('tools');
    if (hasAxe()) {
        await equipAxe();
        log(`Tools axe=${currentAxeName() ?? 'none'}`);
    } else if (await bankTrip()) {
        log(`Tools axe=${currentAxeName() ?? 'none'}`);
    } else {
        log(`No axe yet @ ${pos().x},${pos().z} — will keep trying Seers bank`);
    }

    while (!session.isStopped()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        await closeUi();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }
        if (wc() !== lastLoggedWc) {
            log(`LEVEL UP Woodcutting ${wc()}`);
            lastLoggedWc = wc();
            session.noteProgress('xp', `wc ${wc()}`);
        }
        if (session.metrics().phase !== 'chop_magic') await session.setPhase('chop_magic');
        session.setAnchor(LEGENDS_MAGICS.x, LEGENDS_MAGICS.z);
        await tick();
    }

    const stop = session.metrics().stopReason;
    if (stop) log(`stopped ${stop.code} @ ${stop.location.x},${stop.location.z}`);
} catch (err) {
    session.stopRestartable('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    await session.finalizeStop();
    console.log('Disconnecting SDK; lite client can stay logged in.');
    await sdk.disconnect();
}
