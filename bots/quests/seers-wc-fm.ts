/**
 * Seers Village woodcutting + firemaking to 99, then fletching.
 * Smiths a rune axe first if the character does not already have one.
 *
 * Trees: willows → maples (WC 45) → yews (WC 80). Stays at Seers bank.
 * After Firemaking 99, chops the same trees and fletches unstrung bows.
 *
 *   bun bots/quests/seers-wc-fm.ts jackthief
 *   bun bots/quests/seers-wc-fm.ts Jackpoo1 --yews   # chop + bank churchyard yews (no FM)
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import {
    ARDY_TO_CATHERBY,
    ARHEIN_SHOP,
    CATHERBY_TO_ARDY,
    SEERS_ANVIL,
    SEERS_BANK,
    SEERS_FIRE_START,
    SEERS_MAPLES,
    SEERS_OAKS,
    SEERS_TREES,
    SEERS_WILLOWS,
    SEERS_YEWS
} from './tiles';
import {
    closeUi as closeUiShared,
    distTo as distToShared,
    installWaitForTicksGuard,
    walkNear as walkNearShared,
    walkWaypoints as walkWaypointsShared
} from './movement';
import { travelToSeersFlax } from '../Jackpoo1/travel-to-flax';

const TARGET = 99;
const YEW_WC = 80;
const SMITH_AXE_LEVEL = 86;

const AXE = /^(bronze|iron|steel|black|mithril|adamant|rune) axe$/i;
const RUNE_AXE = /^rune axe$/i;
const RUNITE_BAR = /^runite bar$/i;
const HAMMER = /^hammer$/i;
const TINDERBOX = /^tinderbox$/i;
const KNIFE = /^knife$/i;
const COINS = /^coins$/i;
const ANY_LOGS = /logs$/i;
const BOW = /^(oak |willow |maple |yew |magic )?(shortbow|longbow)$/i;
const SHAFTS = /^arrow shaft/i;
const KEEP = /^(coins|knife|tinderbox|hammer|(bronze|iron|steel|black|mithril|adamant|rune) axe)$/i;

const AXE_TIERS = [
    { name: 'rune axe', level: 41 },
    { name: 'adamant axe', level: 31 },
    { name: 'mithril axe', level: 21 },
    { name: 'black axe', level: 6 },
    { name: 'steel axe', level: 6 },
    { name: 'iron axe', level: 1 },
    { name: 'bronze axe', level: 1 }
] as const;

type PhaseId = 'normal' | 'oak' | 'willow' | 'maple' | 'yew';

type Phase = {
    id: PhaseId;
    tree: RegExp;
    logs: RegExp;
    stand: { x: number; z: number };
    maxDrift: number;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    burnLevel: number;
    fletchShort: number;
};

const PHASES: Record<PhaseId, Phase> = {
    normal: {
        id: 'normal',
        tree: /^tree$/i,
        logs: /^logs$/i,
        stand: SEERS_TREES,
        maxDrift: 12,
        minX: 2708,
        maxX: 2738,
        minZ: 3468,
        maxZ: 3505,
        burnLevel: 1,
        fletchShort: 5
    },
    oak: {
        id: 'oak',
        tree: /^oak$/i,
        logs: /^oak logs$/i,
        stand: SEERS_OAKS,
        maxDrift: 14,
        minX: 2704,
        maxX: 2736,
        minZ: 3476,
        maxZ: 3510,
        burnLevel: 15,
        fletchShort: 20
    },
    willow: {
        id: 'willow',
        tree: /^willow$/i,
        logs: /^willow logs$/i,
        stand: SEERS_WILLOWS,
        maxDrift: 12,
        minX: 2698,
        maxX: 2724,
        minZ: 3498,
        maxZ: 3518,
        burnLevel: 30,
        fletchShort: 35
    },
    maple: {
        id: 'maple',
        tree: /^maple/i,
        logs: /^maple logs$/i,
        stand: SEERS_MAPLES,
        maxDrift: 14,
        minX: 2716,
        maxX: 2738,
        minZ: 3478,
        maxZ: 3508,
        burnLevel: 45,
        fletchShort: 50
    },
    yew: {
        id: 'yew',
        tree: /^yew$/i,
        logs: /^yew logs$/i,
        stand: SEERS_YEWS,
        maxDrift: 14,
        minX: 2698,
        maxX: 2722,
        minZ: 3454,
        maxZ: 3472,
        burnLevel: 60,
        fletchShort: 65
    }
};

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
/** Chop Seers yews and bank the logs — no firemaking or fletching. */
const BANK_YEWS = argv.includes('--yews');

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/seers-wc-fm.ts {botname}`);
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
    name: BANK_YEWS ? 'seers-yews' : 'seers-wc-fm',
    grindLogPath: GRIND_LOG,
    stallMs: 180_000,
    maxRecoveryTactics: 8
});

installWaitForTicksGuard(sdk, session);

let lastLoggedWc = 0;
let lastLoggedFm = 0;
let lastLoggedFl = 0;
let lastIntent = '';
let fireCol = SEERS_FIRE_START.x;
let fireZ = SEERS_FIRE_START.z;

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

function wc(): number {
    return sdk.getSkill('Woodcutting')?.baseLevel ?? 1;
}

function fm(): number {
    return sdk.getSkill('Firemaking')?.baseLevel ?? 1;
}

function fl(): number {
    return sdk.getSkill('Fletching')?.baseLevel ?? 1;
}

function smithing(): number {
    return sdk.getSkill('Smithing')?.baseLevel ?? 1;
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

function coins(): number {
    return sdk.findInventoryItem(COINS)?.count ?? 0;
}

function hasAxe(): boolean {
    return !!(sdk.findInventoryItem(AXE) || sdk.findEquipmentItem(AXE));
}

function hasRuneAxe(): boolean {
    return !!(sdk.findInventoryItem(RUNE_AXE) || sdk.findEquipmentItem(RUNE_AXE));
}

function currentAxeName(): string | null {
    return sdk.findEquipmentItem(AXE)?.name ?? sdk.findInventoryItem(AXE)?.name ?? null;
}

function axeRank(name: string): number {
    const idx = AXE_TIERS.findIndex((t) => t.name === name.toLowerCase());
    return idx === -1 ? 99 : idx;
}

function bestUsableAxeName(): string | null {
    const wood = wc();
    const owned = [
        ...sdk.getInventory().filter((i) => AXE.test(i.name)),
        ...sdk.getEquipment().filter((i) => AXE.test(i.name))
    ];
    for (const tier of AXE_TIERS) {
        if (wood < tier.level) continue;
        if (owned.some((i) => i.name.toLowerCase() === tier.name)) return tier.name;
    }
    return owned[0]?.name ?? null;
}

function fletchingNow(): boolean {
    return !BANK_YEWS && fm() >= TARGET;
}

function phase(): Phase {
    const wood = wc();
    const fire = fm();
    const fletch = fl();
    if (BANK_YEWS) {
        if (wood >= YEW_WC) return PHASES.yew;
        if (wood >= 45) return PHASES.maple;
        if (wood >= 30) return PHASES.willow;
        if (wood >= 15) return PHASES.oak;
        return PHASES.normal;
    }
    if (fletchingNow()) {
        if (wood >= YEW_WC && fletch >= PHASES.yew.fletchShort) return PHASES.yew;
        if (wood >= 45 && fletch >= PHASES.maple.fletchShort) return PHASES.maple;
        if (wood >= 30 && fletch >= PHASES.willow.fletchShort) return PHASES.willow;
        if (wood >= 15 && fletch >= PHASES.oak.fletchShort) return PHASES.oak;
        return PHASES.normal;
    }
    if (wood >= YEW_WC && fire >= PHASES.yew.burnLevel) return PHASES.yew;
    if (wood >= 45 && fire >= PHASES.maple.burnLevel) return PHASES.maple;
    if (wood >= 30 && fire >= PHASES.willow.burnLevel) return PHASES.willow;
    if (wood >= 15 && fire >= PHASES.oak.burnLevel) return PHASES.oak;
    return PHASES.normal;
}

function fletchProduct(p: Phase): string {
    const level = fl();
    if (p.id === 'yew') {
        if (level >= 70) return 'yew long';
        if (level >= 65) return 'yew short';
    }
    if (p.id === 'maple') {
        if (level >= 55) return 'maple long';
        if (level >= 50) return 'maple short';
    }
    if (p.id === 'willow') {
        if (level >= 40) return 'willow long';
        if (level >= 35) return 'willow short';
    }
    if (p.id === 'oak') {
        if (level >= 25) return 'oak long';
        if (level >= 20) return 'oak short';
    }
    if (level >= 10) return 'long';
    if (level >= 5) return 'short';
    return 'arrow shaft';
}

function inSeers(): boolean {
    const p = pos();
    return p.x >= 2690 && p.x <= 2760 && p.z >= 3435 && p.z <= 3522;
}

function inKandarin(): boolean {
    const p = pos();
    return p.x >= 2460 && p.x <= 2940 && p.z >= 3200 && p.z <= 3680;
}

function treeOk(loc: { x: number; z: number }, p: Phase): boolean {
    return loc.x >= p.minX && loc.x <= p.maxX && loc.z >= p.minZ && loc.z <= p.maxZ;
}

function findTree(p: Phase) {
    const local = (sdk.getNearbyLocs() ?? [])
        .filter((l) => p.tree.test(l.name) && l.optionsWithIndex.some((o) => /chop/i.test(o.text)))
        .filter((l) => l.reachable !== false)
        .filter((l) => treeOk(l, p))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (local) return local;
    const nearby = sdk.findNearbyLoc(p.tree, { reachable: true, withOption: /chop/i });
    if (nearby && treeOk(nearby, p)) return nearby;
    return null;
}

async function closeUi(): Promise<void> {
    const dialog = sdk.getDialog();
    if (dialog?.isOpen) {
        const opts = dialog.options ?? [];
        const skillDlg = opts.some((o) => /make \d+|make x|arrow shaft|shortbow|longbow|axe|dagger/i.test(o.text));
        if (skillDlg) {
            await sdk.sendCloseModal();
            await sdk.waitForTicks(1).catch(() => {});
            return;
        }
    }
    await closeUiShared(bot, sdk);
}

async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
    return walkNearShared(bot, sdk, x, z, tolerance);
}

async function climbDown(): Promise<void> {
    if (pos().level <= 0) return;
    intent('Climbing down to the ground');
    for (let i = 0; i < 8 && pos().level > 0; i++) {
        const stairs = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some((o) => /climb-down|climb.down/i.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!stairs) {
            await walkNear(2715, 3471, 2);
            continue;
        }
        await bot.interactLoc(stairs, /climb-down|climb.down/i);
        await sdk.waitForCondition((s) => (s.player?.level ?? 1) === 0, 8_000).catch(() => {});
    }
}

function waypointsToSeers() {
    const seersAt = (list: typeof ARDY_TO_CATHERBY) => {
        const idx = list.findIndex((t) => t.x === SEERS_BANK.x && t.z === SEERS_BANK.z);
        return idx >= 0 ? list.slice(0, idx + 1) : list;
    };
    if (pos().x >= 2740) return seersAt(CATHERBY_TO_ARDY);
    if (pos().x <= 2695) return seersAt(ARDY_TO_CATHERBY);
    return [SEERS_BANK];
}

async function walkToSeers(): Promise<void> {
    await climbDown();
    if (inSeers() && distTo(SEERS_BANK.x, SEERS_BANK.z) <= 24) {
        await walkNear(SEERS_BANK.x, SEERS_BANK.z, 4);
        return;
    }
    if (inKandarin()) {
        intent('Walking to Seers bank');
        await walkWaypointsShared(bot, sdk, waypointsToSeers());
        await walkNear(SEERS_BANK.x, SEERS_BANK.z, 4);
        if (inSeers()) return;
    }
    intent('Travelling to Seers');
    const travel = await travelToSeersFlax({ sdk, bot, log, session });
    if (travel !== 'arrived' && !inSeers()) {
        session.noteFailure('travel', `travel ended ${travel}`);
    }
    await walkNear(SEERS_BANK.x, SEERS_BANK.z, 4);
}

async function openSeersBank(): Promise<boolean> {
    await climbDown();
    if (!sdk.getState()?.bank?.isOpen) await closeUi();
    if (distTo(SEERS_BANK.x, SEERS_BANK.z) > 4) {
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

async function depositJunk(extraKeep: RegExp = KEEP): Promise<void> {
    for (const item of [...sdk.getInventory()]) {
        if (extraKeep.test(item.name)) continue;
        const r = await bot.depositItem(item, -1);
        if (!r.success && sdk.isBankOpen()) {
            await sdk.sendBankDeposit(item.slot, -1);
            await sdk.waitForTicks(1);
        }
    }
}

async function withdrawOne(pattern: RegExp): Promise<boolean> {
    if (sdk.findInventoryItem(pattern) || sdk.findEquipmentItem(pattern)) return true;
    const banked = sdk.findBankItem(pattern);
    if (!banked) return false;
    const r = await bot.withdrawItem(banked, 1);
    if (!r.success && sdk.isBankOpen()) {
        await sdk.sendBankWithdraw(banked.slot, 1);
        await sdk.waitForTicks(2);
    }
    return !!(sdk.findInventoryItem(pattern) || sdk.findEquipmentItem(pattern));
}

async function depositAllAxes(): Promise<void> {
    const eq = sdk.findEquipmentItem(AXE);
    if (eq) {
        await bot.unequipItem(eq);
        await sdk.waitForTicks(1);
    }
    for (const held of [...sdk.getInventory().filter((i) => AXE.test(i.name))]) {
        await bot.depositItem(held, -1);
    }
}

async function withdrawBestAxe(): Promise<boolean> {
    const wood = wc();
    const cur = currentAxeName();
    const curRank = cur ? axeRank(cur) : 99;
    for (const tier of AXE_TIERS) {
        if (wood < tier.level) continue;
        const rank = axeRank(tier.name);
        const pat = new RegExp(`^${tier.name}$`, 'i');
        const inBank = !!sdk.findBankItem(pat);
        const inHand = !!(sdk.findInventoryItem(pat) || sdk.findEquipmentItem(pat));
        if (!inBank && !inHand) continue;
        if (rank >= curRank && hasAxe()) return true;
        await depositAllAxes();
        await withdrawOne(pat);
        return hasAxe();
    }
    return hasAxe();
}

async function equipBestAxe(): Promise<void> {
    const want = bestUsableAxeName();
    if (!want) return;
    const equipped = sdk.findEquipmentItem(AXE);
    if (equipped && equipped.name.toLowerCase() === want) return;
    const inv = sdk.findInventoryItem(new RegExp(`^${want}$`, 'i'));
    if (inv) {
        const r = await bot.equipItem(inv);
        log(`Equip ${inv.name}: ${r.success ? 'ok' : r.message}`);
    }
}

async function buyFromArhein(item: RegExp, label: string): Promise<boolean> {
    if (sdk.findInventoryItem(item)) return true;
    if (coins() < 1) {
        session.noteFailure('shop', `Need 1gp for ${label} (have ${coins()})`);
        return false;
    }
    intent(`Buying ${label} from Arhein`);
    await walkNear(ARHEIN_SHOP.x, ARHEIN_SHOP.z, 3);
    const opened = await bot.openShop(/arhein/i);
    if (!opened.success && !sdk.getState()?.shop?.isOpen) {
        session.noteFailure('shop', `Arhein: ${opened.message}`);
        return false;
    }
    await bot.buyFromShop(item, 1);
    await bot.closeShop();
    return !!sdk.findInventoryItem(item);
}

async function ensureTools(): Promise<boolean> {
    await closeUi();
    const needTinder = !BANK_YEWS && !fletchingNow();
    const needKnife = !BANK_YEWS && (fletchingNow() || fl() < TARGET);
    if (hasAxe() && (!needTinder || sdk.findInventoryItem(TINDERBOX)) && (!needKnife || sdk.findInventoryItem(KNIFE))) {
        await equipBestAxe();
        return true;
    }
    if (!(await openSeersBank())) return false;
    await depositJunk();
    await withdrawBestAxe();
    if (needTinder) await withdrawOne(TINDERBOX);
    if (needKnife) await withdrawOne(KNIFE);
    if (coins() < 5) await withdrawOne(COINS);
    await bot.closeBank();
    if (needTinder && !sdk.findInventoryItem(TINDERBOX)) {
        if (!(await buyFromArhein(TINDERBOX, 'tinderbox'))) return false;
        await walkToSeers();
    }
    if (!hasAxe()) {
        session.noteFailure('no_axe', 'No axe after bank');
        return false;
    }
    await equipBestAxe();
    return hasAxe() && (!needTinder || !!sdk.findInventoryItem(TINDERBOX));
}

async function smithRuneAxe(): Promise<boolean> {
    if (hasRuneAxe()) {
        log('Already carrying a rune axe');
        return true;
    }
    if (!(await openSeersBank())) return false;
    const bankAxe = sdk.findBankItem(RUNE_AXE);
    const bankBar = sdk.findBankItem(RUNITE_BAR);
    const bankHammer = sdk.findBankItem(HAMMER);
    log(
        `Bank rune-axe=${bankAxe?.count ?? 0} runite-bar=${bankBar?.count ?? 0} hammer=${bankHammer?.count ?? 0} smith=${smithing()}`
    );
    if (bankAxe) {
        log('Withdrawing rune axe from bank');
        await withdrawOne(RUNE_AXE);
        await bot.closeBank();
        return hasRuneAxe();
    }
    if (smithing() < SMITH_AXE_LEVEL) {
        log(`Smithing ${smithing()} — need ${SMITH_AXE_LEVEL} for a rune axe`);
        await bot.closeBank();
        return false;
    }
    if (!bankBar && !sdk.findInventoryItem(RUNITE_BAR)) {
        session.noteFailure('no_bars', 'No runite bar to smith a rune axe');
        await bot.closeBank();
        return false;
    }
    await depositJunk(/^(coins|hammer|runite bar|(bronze|iron|steel|black|mithril|adamant|rune) axe)$/i);
    await withdrawOne(HAMMER);
    await withdrawOne(RUNITE_BAR);
    log(`Inv hammer=${!!sdk.findInventoryItem(HAMMER)} bar=${!!sdk.findInventoryItem(RUNITE_BAR)}`);
    await bot.closeBank();
    intent('Smithing a rune axe at Seers');
    await walkNear(SEERS_ANVIL.x, SEERS_ANVIL.z, 2);
    const r = await bot.smithAtAnvil('rune axe', { barPattern: RUNITE_BAR, timeout: 20_000 });
    log(`Smith rune axe: ${r.success ? 'ok' : r.message}`);
    if (!r.success) session.noteFailure('smith', r.message);
    if (await openSeersBank()) {
        const hammer = sdk.findInventoryItem(HAMMER);
        if (hammer) await bot.depositItem(hammer, -1);
        await bot.closeBank();
    }
    return hasRuneAxe();
}

function cannotBurn(): boolean {
    return (sdk.getState()?.gameMessages ?? []).some((m) => /need a firemaking level/i.test(m.text));
}

async function dropLogs(pattern: RegExp): Promise<void> {
    while (sdk.findInventoryItem(pattern)) {
        await bot.dropItem(pattern, 1);
        await sdk.waitForTicks(1);
    }
}

async function dropStrayLogs(p: Phase): Promise<void> {
    for (const item of [...sdk.getInventory()]) {
        if (!ANY_LOGS.test(item.name) || p.logs.test(item.name)) continue;
        intent(`Dropping stray ${item.name}`);
        await bot.dropItem(item, 1);
        await sdk.waitForTicks(1);
    }
}

async function stepForFire(): Promise<void> {
    fireZ -= 1;
    if (fireZ < 3458) {
        fireZ = SEERS_FIRE_START.z;
        fireCol = fireCol === SEERS_FIRE_START.x ? SEERS_FIRE_START.x - 2 : SEERS_FIRE_START.x;
    }
    await sdk.sendWalk(fireCol, fireZ, true);
    await sdk.waitForTicks(2);
}

async function goToFireLine(): Promise<void> {
    if (Math.abs(pos().x - fireCol) <= 2 && pos().z <= SEERS_FIRE_START.z && pos().z >= 3458) return;
    fireCol = SEERS_FIRE_START.x;
    fireZ = SEERS_FIRE_START.z;
    intent('Walking to the firemaking strip south of the bank');
    await walkNear(fireCol, fireZ, 2);
}

async function burnInventory(p: Phase): Promise<void> {
    if (!sdk.findInventoryItem(p.logs) || !sdk.findInventoryItem(TINDERBOX)) return;
    if (fm() < p.burnLevel) {
        log(`FM ${fm()} — dropping ${p.id} logs (need ${p.burnLevel} to burn)`);
        await dropLogs(p.logs);
        return;
    }
    await goToFireLine();
    let fails = 0;
    while (sdk.findInventoryItem(p.logs) && fails < 40 && !session.isStopped()) {
        await closeUi();
        if (cannotBurn() || fm() < p.burnLevel) {
            log(`Cannot burn ${p.id} at FM ${fm()} — dropping`);
            await dropLogs(p.logs);
            return;
        }
        intent(`Burning ${p.id} logs (FM ${fm()})`);
        const r = await bot.burnLogs(p.logs);
        if (r.success) {
            session.noteProgress('xp', 'firemaking');
            fails = 0;
            await stepForFire();
            continue;
        }
        fails++;
        if (cannotBurn()) {
            await dropLogs(p.logs);
            return;
        }
        if (/move|can't light|bad location/i.test(r.message)) {
            await stepForFire();
            continue;
        }
        session.noteFailure('burn', r.message);
        await stepForFire();
    }
}

async function fletchInventory(p: Phase): Promise<void> {
    if (!sdk.findInventoryItem(KNIFE) || !sdk.findInventoryItem(p.logs)) return;
    const product = fletchProduct(p);
    await dropStrayLogs(p);
    while (sdk.findInventoryItem(p.logs) && !session.isStopped()) {
        await closeUi();
        if (!sdk.findInventoryItem(KNIFE)) break;
        intent(`Fletching ${product}`);
        const r = await bot.fletchLogs(product);
        if (!r.success) {
            session.noteFailure('fletch', r.message);
            if (/level too low|no fletching product/i.test(r.message)) break;
            break;
        }
        session.noteProgress('xp', 'fletching');
        await sdk.waitForTicks(1);
    }
}

async function bankProducts(): Promise<void> {
    const bows = sdk.getInventory().filter((i) => BOW.test(i.name) || SHAFTS.test(i.name));
    if (bows.length === 0 && !invFull()) return;
    if (!(await openSeersBank())) return;
    await depositJunk();
    if (fletchingNow()) {
        const tinder = sdk.findInventoryItem(TINDERBOX);
        if (tinder) await bot.depositItem(tinder, -1);
    }
    await withdrawBestAxe();
    if (!fletchingNow()) await withdrawOne(TINDERBOX);
    await withdrawOne(KNIFE);
    await bot.closeBank();
    session.noteProgress('bank', 'seers');
    log(`Banked fletching products | WC ${wc()} FM ${fm()} FL ${fl()}`);
}

async function bankLogs(): Promise<void> {
    if (!(await openSeersBank())) return;
    await depositJunk();
    await withdrawBestAxe();
    await bot.closeBank();
    session.noteProgress('bank', 'seers');
    log(`Banked ${phase().id} logs | WC ${wc()}`);
}

async function goToTrees(p: Phase): Promise<void> {
    session.setAnchor(p.stand.x, p.stand.z);
    if (distTo(p.stand.x, p.stand.z) <= p.maxDrift) return;
    intent(`Walking to Seers ${p.id} trees`);
    await walkNear(p.stand.x, p.stand.z, 4);
}

async function tick(): Promise<void> {
    await closeUi();
    await climbDown();
    const p = phase();

    if (!hasAxe() || (!BANK_YEWS && !fletchingNow() && !sdk.findInventoryItem(TINDERBOX))) {
        await ensureTools();
        return;
    }
    if (fletchingNow() && !sdk.findInventoryItem(KNIFE) && sdk.findInventoryItem(p.logs)) {
        await ensureTools();
        return;
    }

    await dropStrayLogs(p);

    if (fletchingNow() && (sdk.findInventoryItem(BOW) || sdk.findInventoryItem(SHAFTS))) {
        if (invFull() || count(BOW) >= 10 || !sdk.findInventoryItem(p.logs)) {
            await bankProducts();
            return;
        }
    }

    if (sdk.findInventoryItem(p.logs) && (invFull() || occupiedSlots() >= 27)) {
        if (BANK_YEWS) {
            await bankLogs();
        } else if (fletchingNow()) {
            await fletchInventory(p);
            await bankProducts();
        } else {
            await burnInventory(p);
        }
        return;
    }

    if (invFull() && !sdk.findInventoryItem(p.logs)) {
        if (BANK_YEWS) await bankLogs();
        else if (fletchingNow()) await bankProducts();
        else await depositJunk();
        return;
    }

    await goToTrees(p);
    await sdk.scanNearbyLocs(12).catch(() => {});
    let tree = findTree(p);
    if (!tree) {
        intent(`Waiting for ${p.id} to respawn`);
        await walkNear(p.stand.x, p.stand.z, 3);
        await sdk.waitForTicks(4);
        tree = findTree(p);
    }
    if (!tree) {
        session.noteFailure('no_tree', `no ${p.id} at ${pos().x},${pos().z}`);
        return;
    }

    intent(`Chop ${tree.name} at ${tree.x},${tree.z} (WC ${wc()} FM ${fm()})`);
    const before = count(p.logs);
    const r = await bot.chopTree(tree);
    if (count(p.logs) > before) {
        session.noteProgress('inventory', p.id);
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
            await walkToSeers();
            return inSeers();
        }
    },
    {
        name: 'tools',
        run: async () => ensureTools()
    },
    {
        name: 'trees',
        run: async () => {
            const p = phase();
            await goToTrees(p);
            await sdk.scanNearbyLocs(12).catch(() => {});
            return !!findTree(p);
        }
    }
]);

function logLevels(): void {
    if (wc() !== lastLoggedWc) {
        log(`LEVEL UP Woodcutting ${wc()} | ${phase().id}`);
        lastLoggedWc = wc();
        session.noteProgress('xp', `wc ${wc()}`);
    }
    if (fm() !== lastLoggedFm) {
        log(`LEVEL UP Firemaking ${fm()} | ${phase().id}`);
        lastLoggedFm = fm();
        session.noteProgress('xp', `fm ${fm()}`);
    }
    if (fl() !== lastLoggedFl) {
        log(`LEVEL UP Fletching ${fl()} | ${fletchProduct(phase())}`);
        lastLoggedFl = fl();
        session.noteProgress('xp', `fl ${fl()}`);
    }
}

try {
    lastLoggedWc = wc();
    lastLoggedFm = fm();
    lastLoggedFl = fl();
    await bot.skipTutorial();
    await closeUi();
    log(
        `${BANK_YEWS ? 'Seers yew-bank' : 'Seers WC/FM'} start WC ${lastLoggedWc} FM ${lastLoggedFm} FL ${lastLoggedFl} Smith ${smithing()} @ ${pos().x},${pos().z}`
    );

    await session.setPhase('travel');
    await walkToSeers();

    if (!BANK_YEWS) {
        await session.setPhase('smith');
        session.setAnchor(SEERS_ANVIL.x, SEERS_ANVIL.z);
        const smithed = await smithRuneAxe();
        log(`Rune axe: ${smithed ? currentAxeName() ?? 'yes' : `using ${currentAxeName() ?? 'none'}`}`);
    }

    await session.setPhase('tools');
    if (!(await ensureTools())) {
        session.stop('setup', BANK_YEWS ? 'Could not get an axe' : 'Could not get axe + tinderbox');
    } else {
        log(
            `Tools axe=${currentAxeName() ?? 'none'} tinder=${!!sdk.findInventoryItem(TINDERBOX)} knife=${!!sdk.findInventoryItem(KNIFE)} phase=${phase().id}`
        );
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
        logLevels();
        if (!BANK_YEWS && wc() >= TARGET && fm() >= TARGET && fl() >= TARGET) {
            session.stop('done', `WC ${wc()} FM ${fm()} FL ${fl()} — all 99`);
            break;
        }
        const p = phase();
        const wantPhase = BANK_YEWS ? `chop_${p.id}` : fletchingNow() ? `fletch_${p.id}` : `burn_${p.id}`;
        if (session.metrics().phase !== wantPhase) await session.setPhase(wantPhase);
        session.setAnchor(p.stand.x, p.stand.z);
        await tick();
    }

    const stop = session.metrics().stopReason;
    if (stop) log(`stopped ${stop.code} @ ${stop.location.x},${stop.location.z}`);
} catch (err) {
    session.stopRestartable('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    await session.finalizeStop();
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
