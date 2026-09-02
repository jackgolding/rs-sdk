import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

const BOBS_AXES = { x: 3232, z: 3203 };
const LUMBY_KNIFE = { x: 3224, z: 3202 };
const LUMBRIDGE_SHOP = { x: 3211, z: 3246 };
const LUMBRIDGE_TREES = { x: 3195, z: 3220 };
const DRAYNOR_BANK = { x: 3092, z: 3243 };
const LUMBRIDGE_BANK = { x: 3208, z: 3220 };
const FALADOR_BANK = { x: 3014, z: 3355 };
const OAK_STAND = { x: 3102, z: 3242 };
const WILLOW_STAND = { x: 3091, z: 3228 };

const SOUTH_TO_LUMBRIDGE = [
    { x: 3088, z: 3220 },
    { x: 3110, z: 3214 },
    { x: 3140, z: 3208 },
    { x: 3175, z: 3208 },
    { x: 3210, z: 3212 },
    { x: 3224, z: 3202 }
];

const AXE = /^(bronze|iron|steel|black|mithril|adamant|rune) axe$/i;
const BRONZE_AXE = /^bronze axe$/i;
const AXE_RANK = ['rune axe', 'adamant axe', 'mithril axe', 'black axe', 'steel axe', 'iron axe', 'bronze axe'];
const KEEP = /^(coins|knife|(bronze|iron|steel|black|mithril|adamant|rune) axe)$/i;
const SHAFTS = /^arrow shaft/i;
const BOW = /^(oak |willow )?shortbow$/i;
const LETHAL = /jail\s*guard|^guard$|dark wizard|wolf|highwayman/i;

type PhaseId = 'normal' | 'oak' | 'willow';

type Phase = {
    id: PhaseId;
    tree: RegExp;
    logs: RegExp;
    stand: { x: number; z: number };
    maxDrift: number;
};

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

const username = process.env.BOT_USERNAME!;
const password = process.env.PASSWORD!;
const server = process.env.SERVER;
const GRIND_LOG = join(dirname(import.meta.path), 'grind.log');

function log(msg: string): void {
    console.log(msg);
    try {
        appendFileSync(GRIND_LOG, `${new Date().toISOString()} ${msg}\n`);
    } catch {
        /* ignore */
    }
}

console.log('Warming pathfinder...');
initPathfinding();

const sdk = new BotSDK({
    botUsername: username,
    password,
    gatewayUrl: deriveGatewayUrl(server),
    autoLaunchBrowser: true,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false
});

console.log('Opening/attaching the game client...');
await sdk.connect();
const bot = new BotActions(sdk);

let lastIntent = '';
let lastLoggedWc = 0;
let lastLoggedFl = 0;

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
        hp: p?.hp ?? 10,
        maxHp: p?.maxHp ?? 10,
        isDead: p?.isDead ?? false,
        inCombat: p?.combat?.inCombat ?? false
    };
}

function distTo(x: number, z: number): number {
    return Math.hypot(pos().x - x, pos().z - z);
}

function wc(): number {
    return sdk.getSkill('Woodcutting')?.baseLevel ?? 1;
}

function fl(): number {
    return sdk.getSkill('Fletching')?.baseLevel ?? 1;
}

function coinCount(): number {
    return sdk.findInventoryItem(/^coins$/i)?.count ?? 0;
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function invFull(): boolean {
    return occupiedSlots() >= 28;
}

function hasKnife(): boolean {
    return !!sdk.findInventoryItem(/^knife$/i);
}

function hasAxe(): boolean {
    return !!(sdk.findInventoryItem(AXE) || sdk.findEquipmentItem(AXE));
}

function phase(): Phase {
    const fletch = fl();
    const wood = wc();

    // Tree tier follows fletching — chop what we're training to fletch.
    let want: PhaseId =
        fletch >= 35 ? 'willow' : fletch >= 20 ? 'oak' : 'normal';

    // Woodcutting still gates which trees we can chop.
    if (want === 'willow' && wood < 30) want = 'oak';
    if (want === 'oak' && wood < 15) want = 'normal';

    if (want === 'willow') {
        return {
            id: 'willow',
            tree: /^willow$/i,
            logs: /^willow logs$/i,
            stand: WILLOW_STAND,
            maxDrift: 8
        };
    }
    if (want === 'oak') {
        return {
            id: 'oak',
            tree: /^oak$/i,
            logs: /^oak logs$/i,
            stand: OAK_STAND,
            maxDrift: 10
        };
    }
    return {
        id: 'normal',
        tree: /^tree$/i,
        logs: /^logs$/i,
        stand: LUMBRIDGE_TREES,
        maxDrift: 15
    };
}

function fletchProduct(p: Phase): string {
    const level = fl();
    if (p.id === 'willow') return 'willow short';
    if (p.id === 'oak') return 'oak short';
    if (level >= 5) return 'short';
    return 'arrow shaft';
}

function isStrayLog(name: string, p: Phase): boolean {
    return /logs/i.test(name) && !p.logs.test(name);
}

async function dropStrayLogs(p: Phase): Promise<void> {
    for (const item of [...sdk.getInventory()]) {
        if (!isStrayLog(item.name, p)) continue;
        intent(`Dropping stray ${item.name}`);
        await sdk.sendDropItem(item.slot);
        await sdk.waitForTicks(1);
    }
}

function nearJail(x = pos().x, z = pos().z): boolean {
    return x >= 3105 && x <= 3148 && z >= 3232 && z <= 3266;
}

function nearWizards(x = pos().x, z = pos().z): boolean {
    return x <= 3087 && z >= 3232 && z <= 3242;
}

function npcDist(n: { x?: number; tileX?: number; z?: number; tileZ?: number; distance?: number }): number {
    if (typeof n.distance === 'number') return n.distance;
    return Math.hypot(pos().x - (n.tileX ?? n.x ?? 0), pos().z - (n.tileZ ?? n.z ?? 0));
}

function nearestLethal(radius = 14) {
    return (sdk.getNearbyNpcs() ?? [])
        .filter((n) => LETHAL.test(n.name) && npcDist(n) <= radius)
        .sort((a, b) => npcDist(a) - npcDist(b))[0] ?? null;
}

function treeOk(loc: { x: number; z: number }, id: PhaseId): boolean {
    if (nearJail(loc.x, loc.z) || nearWizards(loc.x, loc.z)) return false;
    if (id === 'oak') return loc.x <= 3104 && loc.z <= 3246 && loc.x >= 3088 && loc.z >= 3236;
    if (id === 'willow') return loc.x >= 3088 && loc.z <= 3231;
    return true;
}

function findTree(p: Phase) {
    return (sdk.getNearbyLocs() ?? [])
        .filter((l) => p.tree.test(l.name) && l.optionsWithIndex.some((o) => /chop/i.test(o.text)))
        .filter((l) => l.reachable !== false)
        .filter((l) => treeOk(l, p.id))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null;
}

async function closeUi(): Promise<void> {
    await bot.dismissBlockingUI();
    if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
        await bot.closeInterface();
    }
    if (sdk.getDialog()?.isOpen) {
        await bot.dismissBlockingUI();
        if (sdk.getDialog()?.isOpen) {
            await sdk.sendClickDialog(0);
            await sdk.waitForTicks(1);
        }
    }
}

async function leaveLumbridgeCastle(): Promise<boolean> {
    const p = pos();
    if (p.x < 3225 || p.x > 3242 || p.z < 3210 || p.z > 3228) return false;
    intent('Leaving Lumbridge courtyard through the west doors');
    const door = (sdk.getNearbyLocs() ?? []).find(
        (l) => /door/i.test(l.name) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)) && (l.distance ?? 99) <= 8
    );
    if (door) await bot.openDoor(door);
    await sdk.sendWalk(3216, 3218, true);
    await sdk.waitForTicks(5);
    if (pos().x >= 3226) {
        const door2 = (sdk.getNearbyLocs() ?? []).find(
            (l) => /door/i.test(l.name) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)) && (l.distance ?? 99) <= 6
        );
        if (door2) await bot.openDoor(door2);
        await sdk.sendWalk(3214, 3218, true);
        await sdk.waitForTicks(4);
    }
    return pos().x >= 3225;
}

async function walkWaypoints(points: { x: number; z: number }[]): Promise<void> {
    const dest = points[points.length - 1]!;
    for (const p of points) {
        if (nearJail(p.x, p.z) || nearWizards(p.x, p.z)) continue;
        if (distTo(p.x, p.z) <= 8) continue;
        if (Math.hypot(dest.x - p.x, dest.z - p.z) >= distTo(dest.x, dest.z) - 4) continue;
        await bot.walkTo(p.x, p.z, 3);
        if (await fleeIfNeeded()) return;
    }
}

async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    await leaveLumbridgeCastle();
    if (nearJail() || nearWizards()) {
        await sdk.sendWalk(3088, 3224, true);
        await sdk.waitForTicks(4);
    }
    if (x <= 3110 && pos().x >= 3180) {
        await walkWaypoints([...SOUTH_TO_LUMBRIDGE].reverse());
        if (distTo(x, z) <= tolerance + 2) return true;
    }
    if (x <= 3120 && pos().x >= 3180 && pos().z > 3250) {
        await walkWaypoints([...SOUTH_TO_LUMBRIDGE].reverse());
        if (distTo(x, z) <= tolerance + 2) return true;
    }
    const result = await bot.walkTo(x, z, Math.min(tolerance, 2));
    return result.success || distTo(x, z) <= tolerance + 2;
}

async function fleeIfNeeded(): Promise<boolean> {
    if (pos().isDead) {
        intent('Dead — waiting to respawn');
        await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
        return true;
    }
    const threat = nearestLethal(14);
    const wizard = threat && /dark wizard/i.test(threat.name);
    const tooCloseWizard = wizard && npcDist(threat!) <= 7;
    if (nearJail() || nearWizards() || tooCloseWizard) {
        intent(`Away from ${threat?.name ?? 'jail/wizards'}`);
        const p = phase();
        await sdk.sendWalk(p.stand.x, p.stand.z, true);
        await sdk.waitForTicks(4);
        return true;
    }
    return false;
}

function axeRank(name: string): number {
    const lower = name.toLowerCase();
    const idx = AXE_RANK.indexOf(lower);
    return idx === -1 ? 99 : idx;
}

function currentAxeName(): string | null {
    const eq = sdk.findEquipmentItem(AXE);
    if (eq) return eq.name;
    const inv = sdk.findInventoryItem(AXE);
    return inv?.name ?? null;
}

function bestBankAxe(): { name: string; slot: number; id: number } | null {
    const bank = sdk.getBankItems();
    for (const rank of AXE_RANK) {
        const pat = new RegExp(`^${rank}$`, 'i');
        const item = bank.find((i) => pat.test(i.name));
        if (item) return item;
    }
    return bank.find((i) => AXE.test(i.name)) ?? null;
}

async function depositAllAxes(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        const eq = sdk.findEquipmentItem(AXE);
        if (eq) {
            await bot.unequipItem(eq);
            await sdk.waitForTicks(1);
        }
        const inv = sdk.findInventoryItem(AXE);
        if (!inv) break;
        const r = await bot.depositItem(inv, -1);
        if (!r.success && sdk.isBankOpen()) {
            await sdk.sendBankDeposit(inv.slot, -1);
            await sdk.waitForTicks(2);
        }
        if (!sdk.findInventoryItem(AXE) && !sdk.findEquipmentItem(AXE)) break;
    }
}

async function openNearbyBank(): Promise<boolean> {
    const booth = sdk.findNearbyLoc(/bank booth/i);
    if (!booth || (booth.distance ?? 99) > 6) {
        const p = pos();
        const toDraynor = Math.hypot(p.x - DRAYNOR_BANK.x, p.z - DRAYNOR_BANK.z);
        const toLumby = Math.hypot(p.x - LUMBRIDGE_BANK.x, p.z - LUMBRIDGE_BANK.z);
        const toFalador = Math.hypot(p.x - FALADOR_BANK.x, p.z - FALADOR_BANK.z);
        const nearest =
            toFalador <= toDraynor && toFalador <= toLumby
                ? FALADOR_BANK
                : toLumby <= toDraynor
                  ? LUMBRIDGE_BANK
                  : DRAYNOR_BANK;
        await walkNear(nearest.x, nearest.z, 5);
    }
    const opened = await bot.openBank();
    if (!opened.success) {
        log(`openBank: ${opened.message}`);
        return false;
    }
    if (!sdk.isBankOpen()) {
        log('openBank reported success but bank.isOpen is false');
        return false;
    }
    return true;
}

async function withdrawBankAxe(bankAxe: { name: string; slot: number }): Promise<boolean> {
    intent(`Withdrawing ${bankAxe.name} from bank`);
    const pat = new RegExp(`^${bankAxe.name}$`, 'i');
    const countBefore =
        (sdk.findInventoryItem(pat)?.count ?? 0) + (sdk.findEquipmentItem(pat) ? 1 : 0);
    const r = await bot.withdrawItem(bankAxe, 1);
    if (!r.success && sdk.isBankOpen()) {
        log(`withdrawItem failed (${r.message}) — trying sendBankWithdraw`);
        await sdk.sendBankWithdraw(bankAxe.slot, 1);
        try {
            await sdk.waitForCondition(
                (s) => {
                    const inv = s.inventory.find((i) => pat.test(i.name));
                    const eq = s.equipment?.some((i) => pat.test(i.name));
                    const now = (inv?.count ?? 0) + (eq ? 1 : 0);
                    return now > countBefore;
                },
                8_000
            );
            log(`Withdraw ${bankAxe.name}: ok (sendBankWithdraw)`);
            return true;
        } catch {
            log(`Withdraw ${bankAxe.name}: timed out`);
            return hasAxe();
        }
    }
    log(`Withdraw ${bankAxe.name}: ${r.success ? 'ok' : r.message}`);
    return r.success || hasAxe();
}

/** Swap to the best axe in the open bank — deposits worse equipped/inventory axes first. */
async function ensureBestAxeFromBank(): Promise<boolean> {
    const bankAxe = bestBankAxe();
    const cur = currentAxeName();
    if (!bankAxe) {
        log(`No axe in bank (have ${cur ?? 'none'})`);
        return hasAxe();
    }
    if (cur && axeRank(bankAxe.name) >= axeRank(cur)) {
        log(`Already using ${cur} (bank has ${bankAxe.name})`);
        return true;
    }
    log(`Upgrading ${cur ?? 'no axe'} → ${bankAxe.name}`);
    await depositAllAxes();
    return await withdrawBankAxe(bankAxe);
}

async function bankPrep(): Promise<void> {
    intent('Banking — deposit junk, withdraw best axe');
    if (!(await openNearbyBank())) return;
    for (const item of [...sdk.getInventory()]) {
        if (/^coins$/i.test(item.name)) continue;
        if (AXE.test(item.name)) continue;
        await bot.depositItem(item, -1);
    }
    await ensureBestAxeFromBank();
    await bot.closeBank();
}

async function pickupLumbyKnife(): Promise<boolean> {
    if (hasKnife()) return true;
    intent('Picking up the Lumbridge knife spawn');
    await walkNear(LUMBY_KNIFE.x, LUMBY_KNIFE.z, 2);
    for (let i = 0; i < 24; i++) {
        await sdk.scanGroundItems(8).catch(() => {});
        const knife =
            sdk.findGroundItem(/^knife$/i) ??
            (sdk.getGroundItems() ?? []).find((g) => /^knife$/i.test(g.name) && (g.distance ?? 99) <= 6);
        if (knife) {
            const r = await bot.pickupItem(knife);
            if (r.success || hasKnife()) return true;
        }
        await sdk.waitForTicks(2);
    }
    return hasKnife();
}

async function buyBronzeAxe(): Promise<boolean> {
    if (sdk.findInventoryItem(BRONZE_AXE) || sdk.findEquipmentItem(BRONZE_AXE)) return true;
    if (coinCount() < 16) {
        log(`Need 16gp for bronze axe (have ${coinCount()})`);
        return false;
    }
    intent("Buying a bronze axe from Bob's");
    await walkNear(BOBS_AXES.x, BOBS_AXES.z, 4);
    const shop = await bot.openShop(/bob/i);
    if (!shop.success && !sdk.getState()?.shop?.isOpen) {
        log(`Bob shop failed: ${shop.message}`);
        return false;
    }
    await bot.buyFromShop(BRONZE_AXE, 1);
    await bot.closeShop();
    const axe = sdk.findInventoryItem(BRONZE_AXE);
    if (axe) await bot.equipItem(axe);
    return !!(sdk.findInventoryItem(BRONZE_AXE) || sdk.findEquipmentItem(BRONZE_AXE));
}

async function equipAxe(): Promise<void> {
    const axe = sdk.findInventoryItem(AXE);
    if (axe && !sdk.findEquipmentItem(AXE)) {
        const r = await bot.equipItem(axe);
        log(`Equip ${axe.name}: ${r.success ? 'ok' : r.message}`);
    }
}

async function ensureAxe(): Promise<boolean> {
    if (hasAxe()) {
        const bankAxe = sdk.isBankOpen() ? bestBankAxe() : null;
        const cur = currentAxeName();
        if (!bankAxe || !cur || axeRank(bankAxe.name) >= axeRank(cur)) {
            return true;
        }
    }
    if (await openNearbyBank()) {
        const ok = await ensureBestAxeFromBank();
        await bot.closeBank();
        if (ok) return true;
    }
    if (hasAxe()) return true;
    if (pos().x > 3180 || pos().z > 3250) await walkNear(BOBS_AXES.x, BOBS_AXES.z, 6);
    return buyBronzeAxe();
}

async function ensureTools(): Promise<boolean> {
    await closeUi();
    if (!hasKnife()) {
        if (pos().x > 3180 || pos().z > 3250) await walkNear(LUMBY_KNIFE.x, LUMBY_KNIFE.z, 6);
        if (!(await pickupLumbyKnife())) return false;
    }
    if (!(await ensureAxe())) return false;
    await equipAxe();
    return hasKnife() && hasAxe();
}

function countLogs(p: Phase): number {
    return sdk
        .getInventory()
        .filter((i) => p.logs.test(i.name))
        .reduce((s, i) => s + (i.count ?? 0), 0);
}

function hasFletchProducts(): boolean {
    return sdk.getInventory().some((i) => SHAFTS.test(i.name) || BOW.test(i.name));
}

/** Fill inventory with logs before fletching — don't fletch one log at a time. */
function shouldFletch(p: Phase): boolean {
    if (!sdk.findInventoryItem(p.logs)) return false;
    return invFull();
}

async function dropShafts(): Promise<void> {
    for (const item of sdk.getInventory()) {
        if (SHAFTS.test(item.name)) {
            await sdk.sendDropItem(item.slot);
            await sdk.waitForTicks(1);
        }
    }
}

async function sellBows(): Promise<void> {
    const bows = sdk.getInventory().filter((i) => BOW.test(i.name));
    if (bows.length === 0) return;
    intent(`Selling ${bows.length} shortbow(s) at Lumbridge general store`);
    await walkNear(LUMBRIDGE_SHOP.x, LUMBRIDGE_SHOP.z, 3);
    let opened = await bot.openShop();
    if (!opened.success) {
        const r = await bot.interactNpc(/shop\s*(keeper|assistant)/i, /trade/i);
        log(`trade shop: ${r.success ? 'ok' : r.message}`);
        await sdk.waitForCondition((s) => s.shop?.isOpen, 8_000).catch(() => {});
    }
    if (!sdk.getState()?.shop?.isOpen) {
        log('Could not open Lumbridge general store');
        return;
    }
    for (const bow of bows) {
        const still = sdk.getInventory().find((i) => i.slot === bow.slot && BOW.test(i.name));
        if (!still) continue;
        const r = await bot.sellToShop(still, -1);
        if (!r.success) log(`sell ${still.name}: ${r.message}`);
    }
    await bot.closeShop();
}

async function clearProducts(): Promise<void> {
    await dropShafts();
    const bows = sdk.getInventory().filter((i) => BOW.test(i.name));
    if (bows.length >= 3 || invFull()) await sellBows();
    else if (bows.length > 0 && occupiedSlots() >= 26) await sellBows();
}

async function fletchInventory(p: Phase): Promise<void> {
    const product = fletchProduct(p);
    while (sdk.findInventoryItem(p.logs)) {
        await closeUi();
        if (!hasKnife()) break;
        // bot.fletchLogs matches any /logs/i — drop strays so knife hits the right log type.
        await dropStrayLogs(p);
        if (!sdk.findInventoryItem(p.logs)) break;
        intent(`Fletching ${product}`);
        const r = await bot.fletchLogs(product);
        if (!r.success) {
            log(`fletch: ${r.message}`);
            if (/level too low/i.test(r.message)) break;
            if (/no fletching product/i.test(r.message)) {
                await dropStrayLogs(p);
                break;
            }
            break;
        }
        await sdk.waitForTicks(1);
    }
}

async function goToPhase(p: Phase): Promise<void> {
    if (p.id === 'normal') {
        if (distTo(LUMBRIDGE_TREES.x, LUMBRIDGE_TREES.z) > 20 && pos().x > 3180) {
            await walkNear(LUMBRIDGE_TREES.x, LUMBRIDGE_TREES.z, 8);
        }
        return;
    }
    if (pos().x > 3120) await walkWaypoints([...SOUTH_TO_LUMBRIDGE].reverse());
    await walkNear(p.stand.x, p.stand.z, p.maxDrift);
}

async function tick(): Promise<void> {
    await closeUi();
    if (await leaveLumbridgeCastle()) return;
    if (await fleeIfNeeded()) return;

    const p = phase();
    if (!hasKnife() || !hasAxe()) {
        await ensureTools();
        return;
    }

    await dropStrayLogs(p);

    if (hasFletchProducts()) {
        await clearProducts();
        if (hasFletchProducts() && invFull()) return;
    }

    if (shouldFletch(p)) {
        intent(`Inventory full (${countLogs(p)} logs) — fletching`);
        await fletchInventory(p);
        await clearProducts();
        return;
    }

    if (invFull() && !sdk.findInventoryItem(p.logs)) {
        intent('Inventory full of products — selling/dropping');
        await sellBows();
        await dropShafts();
        return;
    }

    if (p.id !== 'normal' && distTo(p.stand.x, p.stand.z) > p.maxDrift + 6) {
        intent(`Walking to ${p.id} trees`);
        await goToPhase(p);
        return;
    }

    let tree = findTree(p);
    if (!tree && distTo(p.stand.x, p.stand.z) > p.maxDrift) {
        intent(`${p.id} stand ${p.stand.x},${p.stand.z} (wc ${wc()}, fl ${fl()})`);
        await goToPhase(p);
        await sdk.waitForTicks(2);
        tree = findTree(p);
    }
    if (!tree) {
        intent(`Waiting for ${p.id} to respawn`);
        await sdk.waitForTicks(4);
        return;
    }

    intent(`Chop ${tree.name} at ${tree.x},${tree.z}`);
    const r = await bot.chopTree(tree);
    if (!r.success) log(`chop: ${r.message}`);
}

try {
    lastLoggedWc = wc();
    lastLoggedFl = fl();
    console.log('Goal: WC + Fletch — fill invent with logs, then fletch (normal → oak @20 → willow @35).');
    await bot.skipTutorial();
    await closeUi();
    log(`Woodcut start WC ${lastLoggedWc} Fletch ${lastLoggedFl} @ ${pos().x},${pos().z}`);

    intent('Bank prep — deposit junk, withdraw steel axe if banked');
    if (!hasKnife() || !hasAxe()) {
        await bankPrep();
    } else {
        log('Tools ok — skipping bank prep');
    }

    if (!(await ensureTools())) {
        log('Failed to get knife + axe');
        throw new Error('setup failed');
    }
    log(`Tools axe=${sdk.findEquipmentItem(AXE)?.name ?? sdk.findInventoryItem(AXE)?.name ?? 'none'} knife=${hasKnife()} phase=${phase().id}`);

    while (true) {
        await closeUi();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }
        if (wc() !== lastLoggedWc) {
            log(`LEVEL UP Woodcutting ${wc()} | ${phase().id}`);
            lastLoggedWc = wc();
        }
        if (fl() !== lastLoggedFl) {
            log(`LEVEL UP Fletching ${fl()} | product=${fletchProduct(phase())}`);
            lastLoggedFl = fl();
        }
        await tick();
    }
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
