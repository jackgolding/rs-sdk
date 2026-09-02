/**
 * Legends Guild magic trees → Seers bank.
 * Chop an inventory of magic logs, deposit them, repeat.
 *
 *   bun bots/Jackpoo1/magic-shortbows.ts
 */
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';
import { nearLegendsMagic, travelToLegendsMagic } from './travel-to-flax';

const SEERS_BANK = { x: 2726, z: 3485 };
/** Actual magic cluster. LEGENDS_MAGIC 2696,3410 sits on an oak 13 tiles south. */
const MAGIC_STAND = { x: 2696, z: 3423 };

const MAGIC_LOGS = /^magic logs$/i;
const AXE = /^(bronze|iron|steel|black|mithril|adamant|rune) axe$/i;
const KEEP = /^(coins|(bronze|iron|steel|black|mithril|adamant|rune) axe)$/i;
const AXE_RANK = ['rune axe', 'adamant axe', 'mithril axe', 'black axe', 'steel axe', 'iron axe', 'bronze axe'];

function loadBotEnv(): void {
    const envPath = join(dirname(import.meta.path), 'bot.env');
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
}

loadBotEnv();

const GRIND_LOG = join(dirname(import.meta.path), 'grind.log');

function log(msg: string): void {
    console.log(msg);
}

function logMagicBank(): void {
    const line = `${new Date().toISOString()} LOG magic logs ${bankCount(MAGIC_LOGS)}`;
    console.log(line);
    try {
        appendFileSync(GRIND_LOG, `${line}\n`);
    } catch {
        /* ignore */
    }
}

initPathfinding();

const sdk = new BotSDK({
    botUsername: process.env.BOT_USERNAME!,
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

let lastIntent = '';

function intent(msg: string): void {
    if (msg === lastIntent) return;
    lastIntent = msg;
    console.log(`> ${msg}`);
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
    return Math.hypot(pos().x - x, pos().z - z);
}

function count(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function bankCount(pattern: RegExp): number {
    return sdk.getBankItems().filter((i) => pattern.test(i.name)).reduce((n, i) => n + i.count, 0);
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function invFull(): boolean {
    return occupiedSlots() >= 28;
}

function hasAxe(): boolean {
    return !!(sdk.findInventoryItem(AXE) || sdk.findEquipmentItem(AXE));
}

function atTrees(): boolean {
    const p = pos();
    return nearLegendsMagic(p.x, p.z);
}

function inKandarin(): boolean {
    const p = pos();
    return p.x > 2400 && p.x < 2878 && p.z > 3200 && p.z < 3550 && p.z < 6400;
}

async function closeUi(): Promise<void> {
    await bot.dismissBlockingUI();
    if (sdk.getDialog()?.isOpen) {
        await sdk.sendClickDialog(0);
        await sdk.waitForTicks(1);
    }
    for (let i = 0; i < 6; i++) {
        const st = sdk.getState();
        if (!st?.shop?.isOpen && !st?.interface?.isOpen) return;
        await sdk.sendCloseModal();
        await bot.closeInterface().catch(() => {});
        await sdk.waitForTicks(1);
    }
}

async function closeBankNow(): Promise<boolean> {
    for (let i = 0; i < 8; i++) {
        const st = sdk.getState();
        if (!st?.interface?.isOpen && !st?.shop?.isOpen) return true;
        await sdk.sendCloseModal();
        await bot.closeInterface().catch(() => {});
        await sdk.waitForTicks(1);
    }
    return !sdk.getState()?.interface?.isOpen;
}

async function healIfNeeded(): Promise<void> {
    const { hp, maxHp, isDead } = pos();
    if (isDead) {
        intent('Dead — waiting to respawn');
        await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
        return;
    }
    if (hp > 4) return;
    intent(`Healing ${hp}/${maxHp}`);
    while (pos().hp < Math.max(14, Math.floor(pos().maxHp * 0.7)) && !pos().isDead) {
        await sdk.waitForTicks(10);
    }
}

async function openSeersBank(): Promise<boolean> {
    if (sdk.getState()?.interface?.interfaceId !== 5292) await closeUi();
    if (pos().level > 0) {
        const stairs = sdk.findNearbyLoc(/stair|ladder/i, { withOption: /climb-down|climb.down/i });
        if (stairs) await bot.interactLoc(stairs, /climb-down|climb.down/i);
        await sdk.waitForTicks(2);
    }
    if (distTo(SEERS_BANK.x, SEERS_BANK.z) > 4) {
        intent('Walking to Seers bank');
        await bot.walkTo(SEERS_BANK.x, SEERS_BANK.z, 2);
    }
    const already = sdk.getState();
    if (already?.interface?.isOpen && already.interface.interfaceId === 5292) return true;
    const r = await bot.openBank();
    if (!r.success && sdk.getState()?.interface?.interfaceId !== 5292) {
        log(`openBank: ${r.message}`);
        return false;
    }
    await sdk.waitForCondition((s) => s.interface?.interfaceId === 5292, 8_000).catch(() => {});
    return sdk.getState()?.interface?.interfaceId === 5292;
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
        const have = sdk.findEquipmentItem(new RegExp(`^${name}$`, 'i')) ?? sdk.findInventoryItem(new RegExp(`^${name}$`, 'i'));
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

async function goToTrees(): Promise<boolean> {
    if (atTrees()) return true;
    if (inKandarin()) {
        intent(`Walking to Legends Guild magics ${MAGIC_STAND.x},${MAGIC_STAND.z}`);
        await bot.walkTo(MAGIC_STAND.x, MAGIC_STAND.z, 3);
        if (atTrees()) return true;
    }
    const travel = await travelToLegendsMagic({ sdk, bot, log });
    return travel === 'arrived' || atTrees();
}

async function bankTrip(): Promise<'ok' | 'bank_fail'> {
    const before = count(MAGIC_LOGS);
    if (!(await openSeersBank())) return 'bank_fail';
    await depositJunk();
    await withdrawBestAxe();
    if (before > 0) logMagicBank();
    await closeBankNow();
    await equipAxe();
    return 'ok';
}

async function bootstrapSeers(): Promise<boolean> {
    if (!inKandarin()) {
        log('Travelling to Seers for an axe');
        intent('Travel to Seers via wildy lever');
        await travelToLegendsMagic({ sdk, bot, log });
    }
    if (distTo(SEERS_BANK.x, SEERS_BANK.z) > 6) {
        intent('Walking to Seers bank');
        await bot.walkTo(SEERS_BANK.x, SEERS_BANK.z, 3);
    }
    if (!(await openSeersBank())) {
        log('Could not open Seers bank');
        return false;
    }
    const before = count(MAGIC_LOGS);
    await depositJunk();
    await withdrawBestAxe();
    if (before > 0) logMagicBank();
    await closeBankNow();
    await equipAxe();
    return hasAxe();
}

async function chopUntilFull(): Promise<void> {
    intent(`Chopping magics @ ${MAGIC_STAND.x},${MAGIC_STAND.z}`);
    if (!atTrees()) await bot.walkTo(MAGIC_STAND.x, MAGIC_STAND.z, 3);
    let misses = 0;
    while (!invFull() && occupiedSlots() < 27 && misses < 40) {
        await healIfNeeded();
        if (pos().isDead) return;
        const tree =
            sdk.findNearbyLoc(/^magic tree$/i, { reachable: true, withOption: /chop/i }) ??
            sdk.findNearbyLoc(/^magic tree$/i, { reachable: true });
        if (!tree) {
            misses++;
            if (distTo(MAGIC_STAND.x, MAGIC_STAND.z) > 8) {
                await bot.walkTo(MAGIC_STAND.x, MAGIC_STAND.z, 3);
            }
            intent('Waiting for magic tree');
            await sdk.scanNearbyLocs(10).catch(() => {});
            await sdk.waitForTicks(4);
            continue;
        }
        misses = 0;
        const before = count(MAGIC_LOGS);
        intent(`Chop ${tree.name} at ${tree.x},${tree.z} (${before} logs)`);
        const r = await bot.chopTree(tree);
        if (!r.success) console.log(`chop: ${r.message}`);
    }
}

try {
    await bot.skipTutorial();
    await closeUi();
    log(`Magic logs start WC ${sdk.getSkill('Woodcutting')?.baseLevel ?? 0} @ ${pos().x},${pos().z}`);
    await healIfNeeded();

    if (!(await bootstrapSeers())) {
        log('Seers bootstrap failed — no axe');
        process.exitCode = 1;
    } else if (!hasAxe()) {
        log('No axe equipped or in inventory');
        process.exitCode = 1;
    } else {
        while (true) {
            await closeUi();
            await healIfNeeded();
            if (pos().isDead) continue;

            if (count(MAGIC_LOGS) > 0 || invFull()) {
                const result = await bankTrip();
                if (result === 'bank_fail') {
                    log('Bank failed — retrying');
                    await sdk.waitForTicks(8);
                }
                continue;
            }

            if (!(await goToTrees())) {
                log(`Could not reach magics @ ${pos().x},${pos().z}`);
                await sdk.waitForTicks(8);
                continue;
            }
            await equipAxe();
            await chopUntilFull();
            if (count(MAGIC_LOGS) < 1) {
                await sdk.waitForTicks(6);
                continue;
            }
            const result = await bankTrip();
            if (result === 'bank_fail') {
                log('Bank failed after chop — retrying');
                await sdk.waitForTicks(8);
            }
        }
    }
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; lite client can stay logged in.');
    await sdk.disconnect();
}
