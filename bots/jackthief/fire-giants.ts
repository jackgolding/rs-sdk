/**
 * Fire giants — Jackthief.
 *
 *   bun bots/jackthief/fire-giants.ts
 *
 * North Ardougne bank → Aemad bronze arrows (whole stock) → regear
 * (Glarial’s amulet, dragonhide, magic shortbow, bronze arrows, rope, 20 sharks)
 * → waterfall dungeon. Range from the chair safespot; on a hit, run to the
 * door safespot. After each kill bury big bones and pick up arrows. Full
 * bag banks at North Ardougne.
 */
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding, nearestWalkableTile } from '../../sdk/pathfinding';
import { readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

const NORTH_BANK = { x: 2618, z: 3332 };
const AEMAD = { x: 2613, z: 3294 };
const RAFT = { x: 2510, z: 3494 };
const ISLAND_SHOT = { x: 2512, z: 3476 };
const LEDGE = { x: 2511, z: 3463 };
/** Door safespot: 2568,9894 if reachable, else the door tile 2568,9893. */
const SAFE_SPOT = { x: 2568, z: 9894 };
const ROOM_DOOR = { x: 2568, z: 9893 };
const DUNGEON_EXIT = { x: 2575, z: 9861 };
const GIANT_DOOR = { x: 2566, z: 9901 };
/** West fire-giant room only. East chamber starts ~2574 (large doors 2576,9884). */
const HUNT = { minX: 2562, maxX: 2571, minZ: 9882, maxZ: 9892 };
/** Stay east of Hadley's tourist centre — 2512,3430 walks through it. */
const TO_FALLS = [
    { x: 2618, z: 3332 },
    { x: 2618, z: 3378 },
    { x: 2585, z: 3405 },
    { x: 2548, z: 3440 },
    { x: 2512, z: 3496 }
];
/** Barrel dumps at Hadley's — do not reverse TO_FALLS (that walks to the raft). */
const TO_BANK = [
    { x: 2548, z: 3405 },
    { x: 2585, z: 3378 },
    { x: 2618, z: 3332 }
];
const COIN_WITHDRAW = 5000;
const FOOD_COUNT = 20;
const ARROW_RESTOCK_BELOW = 50;

const COINS = /^coins$/i;
const BRONZE_ARROW = /^bronze arrows?$/i;
const ANY_ARROW = /^(bronze|iron|steel|mithril|adamant|rune) arrows?$/i;
const AMULET = /glarial'?s amulet/i;
const ROPE = /^rope$/i;
const FOOD = /^(shark|swordfish|tuna)$/i;
const BODY = /dragonhide body/i;
const CHAPS = /dragonhide chaps/i;
const VAMBS = /dragon vambraces/i;
const SHORTBOW = /magic shortbow/i;
const GIANT = /^fire giant$/i;
const BIG_BONES = /^big bones$/i;
const ANY_BONES = /bones$/i;
const ARROW_LOOT = /arrows?$/i;
const RUNE_LOOT = /runes?$/i;
const KEEP_INV =
    /glarial'?s amulet|^rope$|^(shark|swordfish|tuna)$|^(bronze|iron|steel|mithril|adamant|rune) arrows?$|magic shortbow|dragonhide|dragon vambraces/i;

function loadBotEnv(): void {
    const envPath = join(dirname(import.meta.path), 'bot.env');
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
let lastHp = 0;
let lastDamageTick = -1;

function intent(msg: string): void {
    if (msg === lastIntent) return;
    lastIntent = msg;
    console.log(`> ${msg}`);
    sdk.showIntent(msg).catch(() => {});
}

function pos() {
    const p = sdk.getState()?.player;
    return {
        x: p?.worldX ?? 0,
        z: p?.worldZ ?? 0,
        hp: p?.hp ?? 10,
        maxHp: p?.maxHp ?? 10,
        isDead: p?.isDead ?? false,
        inCombat: p?.combat?.inCombat ?? false,
        targetIndex: p?.combat?.targetIndex ?? -1,
        targetType: p?.combat?.targetType ?? 'none',
        lastDamageTick: p?.combat?.lastDamageTick ?? -1
    };
}

function distTo(x: number, z: number): number {
    return Math.hypot(pos().x - x, pos().z - z);
}

function count(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function coins(): number {
    return sdk.findInventoryItem(COINS)?.count ?? 0;
}

function arrowCount(): number {
    const worn = sdk.getEquipment().filter((i) => ANY_ARROW.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
    return worn + count(ANY_ARROW);
}

const NO_AMMO = /no ammo left in your quiver/i;
let quiverEmpty = false;

function noteAmmoChat(): void {
    if (sdk.getNewChat({ types: [0] }).some((m) => NO_AMMO.test(m.text))) quiverEmpty = true;
}

function needArrows(): boolean {
    noteAmmoChat();
    return arrowCount() < ARROW_RESTOCK_BELOW || quiverEmpty;
}

function clearAmmoFlag(): void {
    sdk.getNewChat({ types: [0] });
    quiverEmpty = false;
}

function foodCount(): number {
    return sdk.getInventory().filter((i) => FOOD.test(i.name)).length;
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function bagFull(): boolean {
    return occupiedSlots() >= 26;
}

function hasBankableLoot(): boolean {
    return sdk.getInventory().some((i) => (i.count ?? 0) > 0 && !KEEP_INV.test(i.name));
}

function onIsland(): boolean {
    const p = pos();
    return p.z < 6400 && p.x >= 2508 && p.x <= 2518 && p.z >= 3476 && p.z <= 3486;
}

/** On the rock/tree island after the river rope — not the waterfall ledge. */
function onTreeRock(): boolean {
    const p = pos();
    return p.z < 6400 && p.x >= 2508 && p.x <= 2516 && p.z >= 3465 && p.z <= 3474;
}

function onLedge(): boolean {
    return pos().z < 6400 && pos().z <= 3464 && distTo(LEDGE.x, LEDGE.z) <= 4;
}

function inDungeon(): boolean {
    return pos().z >= 9856;
}

function inGiantAlcove(): boolean {
    const p = pos();
    return p.z >= 9884 && p.z <= 9893 && p.x >= 2563 && p.x <= 2569;
}

function huntTile(n: { x: number; z: number; tileX?: number; tileZ?: number }) {
    return { x: n.tileX ?? n.x, z: n.tileZ ?? n.z };
}

function inHuntRoom(x: number, z: number): boolean {
    return x >= HUNT.minX && x <= HUNT.maxX && z >= HUNT.minZ && z <= HUNT.maxZ;
}

/** Already inside the west giant room — sendWalk only; walkTo routes into the east chamber. */
function inGiantRoomArea(): boolean {
    const p = pos();
    return p.z >= 9880 && p.x >= 2560 && p.x <= 2572;
}

function canLootAt(x: number, z: number): boolean {
    if (!(inHuntRoom(x, z) || (x >= 2566 && x <= 2569 && z >= 9890 && z <= 9894))) return false;
    return Math.hypot(x - ROOM_DOOR.x, z - ROOM_DOOR.z) <= 6;
}

function atSafe(): boolean {
    const p = pos();
    return p.x === 2568 && p.z >= 9893 && p.z <= 9894;
}

function isDoorTile(x: number, z: number): boolean {
    return x === ROOM_DOOR.x && z === ROOM_DOOR.z;
}

function moveLog(kind: string, detail: string): void {
    log(`MOVE ${kind} @ ${pos().x},${pos().z} ${detail}`);
}

async function closeUi(): Promise<void> {
    if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
        await bot.closeInterface();
    }
    await bot.dismissBlockingUI();
}

async function clickWalk(why: string, x: number, z: number): Promise<void> {
    if (isDoorTile(x, z)) {
        moveLog('skip-door', `${why} refused walk onto door ${x},${z}`);
        return;
    }
    moveLog('sendWalk', `${why} -> ${x},${z}`);
    await sdk.sendWalk(x, z, true);
}

async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    if (inGiantRoomArea()) {
        moveLog('block-walkTo', `giant room ${pos().x},${pos().z} -> ${x},${z} using sendWalk`);
        await clickWalk(`walkNear(${tolerance})`, x, z);
        await sdk.waitForCondition(() => distTo(x, z) <= tolerance + 1, 4_000).catch(() => {});
        return distTo(x, z) <= tolerance + 2;
    }
    const dest = nearestWalkableTile(0, x, z) ?? { x, z };
    moveLog('walkTo', `${pos().x},${pos().z} -> ${dest.x},${dest.z}`);
    const r = await bot.walkTo(dest.x, dest.z, Math.min(tolerance, 3));
    log(`  ${r.success ? 'ok' : r.message} now ${pos().x},${pos().z}`);
    return r.success || distTo(x, z) <= tolerance + 2;
}

async function walkWaypoints(points: { x: number; z: number }[]): Promise<void> {
    for (const p of points) {
        if (distTo(p.x, p.z) <= 8) continue;
        await eatIfLow();
        await walkNear(p.x, p.z, 6);
    }
}

async function eatIfLow(threshold = 50): Promise<void> {
    if (pos().hp >= Math.min(threshold, pos().maxHp - 8)) return;
    const food =
        sdk.findInventoryItem(/^shark$/i) ??
        sdk.findInventoryItem(/^swordfish$/i) ??
        sdk.findInventoryItem(/^tuna$/i);
    if (!food) return;
    const r = await bot.eatFood(food);
    log(`Eat ${food.name}: ${r.success ? `+${r.hpGained}` : r.message} HP ${pos().hp} food=${foodCount()}`);
}

async function waitBankClosed(): Promise<void> {
    if (sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
        await bot.closeBank();
    }
    await sdk.waitForCondition((s) => !s.bank?.isOpen && !s.interface?.isOpen, 5_000).catch(() => {});
}

async function openBank(): Promise<boolean> {
    if (sdk.getState()?.bank?.isOpen && (sdk.getState()?.bank?.items?.length ?? 0) > 0) return true;
    await waitBankClosed();
    if (distTo(NORTH_BANK.x, NORTH_BANK.z) > 8) await walkNear(NORTH_BANK.x, NORTH_BANK.z, 3);
    const r = await bot.openBank();
    if (!r.success && !sdk.getState()?.bank?.isOpen && !sdk.getState()?.interface?.isOpen) {
        log(`openBank: ${r.message}`);
        return false;
    }
    await sdk.waitForCondition((s) => (s.bank?.items?.length ?? 0) > 0, 8_000).catch(() => {});
    const n = sdk.getBankItems().length;
    if (n < 1) {
        log(`openBank: no items yet (${r.message})`);
        return false;
    }
    return true;
}

async function withdrawPat(pattern: RegExp, amount: number): Promise<number> {
    if (count(pattern) >= amount) return count(pattern);
    const item = sdk.findBankItem(pattern);
    if (!item) {
        log(`bank missing ${pattern}`);
        return count(pattern);
    }
    await bot.withdrawItem(item, amount === -1 ? -1 : Math.min(amount - count(pattern), item.count));
    return count(pattern);
}

async function buyAemadArrows(): Promise<void> {
    intent('Withdrawing coins at North Ardougne');
    await closeUi();
    if (!(await openBank())) throw new Error('bank did not open for coins');
    for (const item of [...sdk.getInventory()]) {
        if (COINS.test(item.name) || AMULET.test(item.name) || ANY_ARROW.test(item.name)) continue;
        await bot.depositItem(item, -1);
    }
    const need = Math.max(0, COIN_WITHDRAW - coins());
    const bankCoins = sdk.findBankItem(COINS) ?? sdk.findBankItem(/coins/i);
    const bankArrows = sdk.findBankItem(ANY_ARROW);
    log(`Bank ${sdk.getBankItems().length} items, coins=${bankCoins?.count ?? 0}, arrows=${bankArrows?.count ?? 0}, inv ${coins()}gp / ${arrowCount()} arr`);
    if (need > 0 && bankCoins) {
        const r = await bot.withdrawItem(bankCoins, Math.min(need, bankCoins.count));
        log(`Withdraw coins: ${r.message} +${r.amountWithdrawn ?? 0} now ${coins()}gp`);
    } else if (need > 0) {
        log(`bank missing coins (inv ${coins()}gp)`);
    }
    if (coins() < 1) {
        await waitBankClosed();
        if (arrowCount() >= ARROW_RESTOCK_BELOW || (bankArrows?.count ?? 0) >= ARROW_RESTOCK_BELOW) {
            log('No coins for Aemad — using arrows on hand / in bank');
            return;
        }
        throw new Error('no coins for Aemad');
    }
    await waitBankClosed();
    log(`Coins ${coins()}gp — walking to Aemad`);

    intent('Buying all bronze arrows from Aemad');
    await walkNear(AEMAD.x, AEMAD.z, 4);
    const npc =
        sdk.findNearbyNpc(/^(aemad|kortan)$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/^(aemad|kortan)$/i);
    if (!npc) throw new Error('Aemad/Kortan not visible');
    const opened = await bot.openShop(npc);
    if (!opened.success && !sdk.getState()?.shop?.isOpen) {
        await bot.interactNpc(npc, /trade/i);
    }
    if (!sdk.getState()?.shop?.isOpen) throw new Error(`Aemad shop closed: ${opened.message}`);

    const line = () => sdk.getState()?.shop?.shopItems.find((i) => BRONZE_ARROW.test(i.name));
    const before = count(BRONZE_ARROW);
    const stock = line()?.count ?? 0;
    const slot = line()?.slot;
    if (slot == null || stock <= 0) {
        log('No bronze arrows on the shelf');
    } else {
        const clicks = Math.ceil(stock / 10);
        log(`Buy-10 x${clicks} bronze arrows (shelf ${stock})`);
        for (let n = 0; n < clicks && coins() >= 1; n++) {
            const r = await sdk.sendShopBuy(slot, 10);
            if (!r.success) {
                log(`shop buy: ${r.message}`);
                break;
            }
        }
        await sdk.waitForCondition(() => (line()?.count ?? 0) <= 0 || coins() < 1, 15_000).catch(() => {});
    }
    await bot.closeShop();
    log(`Bought ${count(BRONZE_ARROW) - before} bronze arrows, holding ${count(BRONZE_ARROW)}, ${coins()}gp`);
}

async function gearUp(): Promise<void> {
    intent('Gearing at North Ardougne bank');
    await walkNear(NORTH_BANK.x, NORTH_BANK.z, 3);
    if (!(await openBank())) throw new Error('bank did not open for gear');
    for (const item of [...sdk.getInventory()]) {
        await bot.depositItem(item, -1);
    }
    await bot.closeBank();
    for (const worn of [...bot.getEquipment()]) {
        await bot.unequipItem(worn);
    }
    if (!(await openBank())) throw new Error('bank did not reopen after unequip');
    for (const item of [...sdk.getInventory()]) {
        await bot.depositItem(item, -1);
    }

    await withdrawPat(AMULET, 1);
    await withdrawPat(BODY, 1);
    await withdrawPat(CHAPS, 1);
    await withdrawPat(VAMBS, 1);
    await withdrawPat(ROPE, 1);
    await withdrawPat(SHORTBOW, 1);
    const arrows = sdk.findBankItem(BRONZE_ARROW);
    if (arrows) await bot.withdrawItem(arrows, -1);
    const extraArrows = sdk.findBankItem(ANY_ARROW);
    if (extraArrows) await bot.withdrawItem(extraArrows, -1);
    const food =
        sdk.findBankItem(/^shark$/i) ?? sdk.findBankItem(/^swordfish$/i) ?? sdk.findBankItem(/^tuna$/i);
    if (food) await bot.withdrawItem(food, Math.min(FOOD_COUNT, food.count), { asNote: false });
    await bot.closeBank();

    for (const pat of [AMULET, BODY, CHAPS, VAMBS, SHORTBOW, ANY_ARROW]) {
        const item = sdk.findInventoryItem(pat);
        if (item && !sdk.findEquipmentItem(pat)) await bot.equipItem(item);
    }
    const style = sdk.getState()?.combatStyle?.styles.find((s) => s.type === 'Rapid' || /rapid/i.test(s.name));
    if (style && sdk.getState()?.combatStyle?.currentStyle !== style.index) {
        await sdk.sendSetCombatStyle(style.index);
        log(`Combat style ${style.name}`);
    }
    log(
        `Geared amulet=${sdk.findEquipmentItem(AMULET)?.name ?? 'no'} ` +
            `bow=${sdk.findEquipmentItem(SHORTBOW)?.name ?? 'no'} ` +
            `arrows=${arrowCount()} food=${foodCount()} rope=${count(ROPE)}`
    );
    if (!sdk.findEquipmentItem(AMULET) && count(AMULET) < 1) throw new Error('no Glarial’s amulet');
    if (!sdk.findEquipmentItem(SHORTBOW) && count(SHORTBOW) < 1) throw new Error('no magic shortbow');
    if (arrowCount() < 1) throw new Error('no arrows');
    if (count(ROPE) < 1) throw new Error('no rope');
    clearAmmoFlag();
}

function climbTree() {
    return (
        (sdk.getNearbyLocs() ?? []).find(
            (l) => /dead tree/i.test(l.name) && l.optionsWithIndex.some((o) => /^climb$/i.test(o.text))
        ) ?? null
    );
}

async function ropeOnTree(): Promise<boolean> {
    await sdk.scanNearbyLocs(12).catch(() => {});
    const tree = climbTree();
    const rope = sdk.findInventoryItem(ROPE);
    if (!tree || !rope) {
        log(`Tree/rope missing @ ${pos().x},${pos().z} tree=${tree?.x},${tree?.z}`);
        return false;
    }
    intent('Stepping next to the dead tree to attach the rope');
    await walkNear(tree.x, tree.z, 1);
    log(`Beside tree @ ${pos().x},${pos().z} tree=${tree.x},${tree.z} d=${Math.hypot(pos().x - tree.x, pos().z - tree.z).toFixed(1)}`);
    const ropeNow = sdk.findInventoryItem(ROPE);
    const treeNow = climbTree() ?? tree;
    if (!ropeNow) return false;
    await sdk.sendUseItemOnLoc(ropeNow.slot, treeNow.x, treeNow.z, treeNow.id);
    await sdk.waitForCondition(() => onLedge(), 15_000).catch(() => {});
    log(`After tree rope @ ${pos().x},${pos().z} ledge=${onLedge()}`);
    return onLedge();
}

async function ropeAcross(): Promise<boolean> {
    if (onIsland()) {
        await walkNear(ISLAND_SHOT.x, ISLAND_SHOT.z, 1);
        const rock = sdk.findNearbyLoc(/^rock$/i, { withOption: /swim/i }) ?? sdk.findNearbyLoc(/^rock$/i);
        const rope = sdk.findInventoryItem(ROPE);
        if (!rock || !rope) {
            log('No rock/rope on island');
            return false;
        }
        intent('Rope on the river rock');
        await sdk.sendUseItemOnLoc(rope.slot, rock.x, rock.z, rock.id);
        await sdk.waitForCondition(() => onTreeRock() || onLedge(), 20_000).catch(() => {});
        log(`After rock @ ${pos().x},${pos().z} treeRock=${onTreeRock()}`);
    }
    return ropeOnTree();
}

async function enterDungeon(): Promise<void> {
    if (inDungeon()) return;
    const amulet = sdk.findInventoryItem(AMULET);
    if (amulet) await bot.equipItem(amulet);
    if (!onLedge() && !onIsland() && !onTreeRock()) {
        intent('Walking to the log raft');
        await walkWaypoints(TO_FALLS);
        await walkNear(RAFT.x, RAFT.z, 3);
        const raft = sdk.findNearbyLoc(/log raft/i);
        if (raft) {
            await bot.interactLoc(raft, /board/i);
            await sdk.waitForCondition(() => onIsland(), 20_000).catch(() => {});
        }
        log(`After raft @ ${pos().x},${pos().z} island=${onIsland()}`);
    }
    if (onIsland() || onTreeRock()) await ropeAcross();
    if (!onLedge()) return;
    intent('Opening the waterfall door');
    const ledge =
        sdk.findNearbyLoc(/^ledge$/i, { reachable: true }) ??
        (sdk.getNearbyLocs() ?? []).find((l) => /^ledge$/i.test(l.name) && l.reachable !== false);
    if (!ledge) {
        log(`No reachable ledge @ ${pos().x},${pos().z}`);
        return;
    }
    const before = pos();
    await bot.interactLoc(ledge, /open/i);
    await sdk.waitForCondition(() => inDungeon() || distTo(before.x, before.z) > 4, 20_000).catch(() => {});
    log(`After door @ ${pos().x},${pos().z} dungeon=${inDungeon()}`);
}

function wasHit(): boolean {
    const p = pos();
    if (lastHp > 0 && p.hp < lastHp) return true;
    if (p.lastDamageTick >= 0 && p.lastDamageTick > lastDamageTick) return true;
    return false;
}

function noteHp(): void {
    const p = pos();
    lastHp = p.hp;
    if (p.lastDamageTick > lastDamageTick) lastDamageTick = p.lastDamageTick;
}

async function stepToSafe(): Promise<void> {
    if (atSafe()) return;
    intent('Walking to west-room safespot');
    if (!inGiantRoomArea()) {
        await walkNear(SAFE_SPOT.x, SAFE_SPOT.z, 2);
        if (atSafe()) {
            noteHp();
            return;
        }
    }
    await clickWalk('safe', SAFE_SPOT.x, SAFE_SPOT.z);
    await sdk.waitForCondition(() => atSafe(), 3_000).catch(() => {});
    moveLog('safe-now', atSafe() ? `holding ${pos().x},${pos().z}` : `missed ${pos().x},${pos().z}`);
    noteHp();
}

function distToDoor(n: { x: number; z: number; tileX?: number; tileZ?: number }): number {
    const t = huntTile(n);
    return Math.hypot(t.x - ROOM_DOOR.x, t.z - ROOM_DOOR.z);
}

function findGiant() {
    return (
        (sdk.getNearbyNpcs() ?? [])
            .filter((n) => {
                if (!GIANT.test(n.name)) return false;
                if (n.hp !== null && n.hp <= 0) return false;
                if (!n.optionsWithIndex.some((o) => /attack/i.test(o.text))) return false;
                if (n.reachable === false) return false;
                const t = huntTile(n);
                return inHuntRoom(t.x, t.z);
            })
            .sort((a, b) => {
                const da = a.distance ?? distToDoor(a);
                const db = b.distance ?? distToDoor(b);
                if (da !== db) return da - db;
                return distToDoor(a) - distToDoor(b);
            })[0] ?? null
    );
}

function hasTarget(): boolean {
    const p = pos();
    if (!p.inCombat || p.targetType !== 'npc' || p.targetIndex < 0) return false;
    const t = sdk.getNearbyNpcs().find((n) => n.index === p.targetIndex);
    if (!t || (t.hp !== null && t.hp <= 0)) return false;
    const tile = huntTile(t);
    if (!inHuntRoom(tile.x, tile.z)) {
        log(`Drop target npc#${t.index} outside hunt room @ ${tile.x},${tile.z}`);
        return false;
    }
    return true;
}

async function buryBones(): Promise<number> {
    let buried = 0;
    for (let i = 0; i < 12; i++) {
        const bones = sdk.findInventoryItem(BIG_BONES) ?? sdk.findInventoryItem(ANY_BONES);
        if (!bones) break;
        const buryOpt = bones.optionsWithIndex.find((o) => /bury/i.test(o.text));
        if (!buryOpt) break;
        const xpBefore = sdk.getSkill('Prayer')?.experience ?? 0;
        await sdk.sendUseItem(bones.slot, buryOpt.opIndex);
        try {
            await sdk.waitForCondition((s) => {
                const xp = s.skills.find((sk) => sk.name === 'Prayer')?.experience ?? 0;
                return xp > xpBefore || !s.inventory.find((it) => it.slot === bones.slot && ANY_BONES.test(it.name));
            }, 4_000);
        } catch {
            break;
        }
        buried++;
        if (wasHit()) break;
    }
    if (buried) log(`Buried ${buried} bones`);
    return buried;
}

async function lootAfterKill(): Promise<void> {
    noteHp();
    intent('Looting doorway pile');
    for (let i = 0; i < 16; i++) {
        if (wasHit()) {
            await stepToSafe();
            return;
        }
        await buryBones();
        const items = ((await sdk.scanGroundItems(8).catch(() => [])) ?? []).filter(
            (g) => g.reachable !== false && canLootAt(g.x, g.z)
        );
        const item = items.sort((a, b) => {
            const pri = (n: string) =>
                ANY_BONES.test(n) ? 0 : RUNE_LOOT.test(n) ? 1 : /coins|herb/i.test(n) ? 2 : ARROW_LOOT.test(n) ? 3 : 4;
            const d = pri(a.name) - pri(b.name);
            if (d !== 0) return d;
            return (a.distance ?? 99) - (b.distance ?? 99);
        })[0];
        if (!item) break;
        const stacks = ARROW_LOOT.test(item.name) || ANY_BONES.test(item.name) || RUNE_LOOT.test(item.name) || /^coins$/i.test(item.name);
        if (bagFull() && !stacks) break;
        moveLog('pickup', `${item.name} x${item.count ?? 1} @ ${item.x},${item.z} d=${item.distance}`);
        await sdk.sendPickup(item.x, item.z, item.id);
        await sdk.waitForTicks(1);
        log(`Loot ${item.count ?? 1} ${item.name}`);
        if (ANY_ARROW.test(item.name)) {
            const stack = sdk.findInventoryItem(ANY_ARROW);
            if (stack) await bot.equipItem(stack);
        }
    }
    await buryBones();
    if (!atSafe()) await stepToSafe();
}

async function shoot(): Promise<boolean> {
    if (needArrows()) return false;
    if (!atSafe()) return false;
    const target = findGiant();
    if (!target) return hasTarget();
    if (hasTarget() && pos().targetIndex === target.index) return true;
    const opt = target.optionsWithIndex.find((o) => /attack/i.test(o.text));
    if (!opt) return false;
    moveLog('attack', `npc#${target.index} ${target.name} @ ${target.x},${target.z} d=${target.distance}`);
    const r = await sdk.sendInteractNpc(target.index, opt.opIndex, { route: false });
    if (!r.success) {
        log(`Attack giant: ${r.message}`);
        return false;
    }
    await sdk.waitForCondition((s) => !!s.player?.combat?.inCombat, 4_000).catch(() => {});
    return hasTarget();
}

async function waitForKill(): Promise<void> {
    const started = Date.now();
    let sawTarget = hasTarget();
    while (!pos().isDead && Date.now() - started < 45_000) {
        await eatIfLow(60);
        if (needArrows()) break;
        if (!atSafe()) {
            if (!inGiantAlcove() && !inHuntRoom(pos().x, pos().z)) {
                log(`Left hunt room @ ${pos().x},${pos().z} — back to door`);
                break;
            }
            await stepToSafe();
        }
        const closest = findGiant();
        if (closest && pos().targetIndex !== closest.index) {
            await shoot();
        }
        if (hasTarget()) {
            sawTarget = true;
        } else if (sawTarget) {
            break;
        } else if (!closest) {
            break;
        }
        await sdk.waitForTicks(1);
        noteHp();
    }
}

async function leaveDungeon(): Promise<void> {
    intent('Leaving the waterfall dungeon to bank');
    if (inDungeon()) {
        await walkNear(DUNGEON_EXIT.x, DUNGEON_EXIT.z, 3);
        const door = (sdk.getNearbyLocs() ?? [])
            .filter(
                (l) =>
                    /door/i.test(l.name) &&
                    l.reachable !== false &&
                    !(l.x === GIANT_DOOR.x && l.z === GIANT_DOOR.z)
            )
            .sort(
                (a, b) =>
                    Math.hypot(a.x - DUNGEON_EXIT.x, a.z - DUNGEON_EXIT.z) -
                    Math.hypot(b.x - DUNGEON_EXIT.x, b.z - DUNGEON_EXIT.z)
            )[0];
        if (door) {
            const before = pos();
            await bot.interactLoc(door, /open/i);
            await sdk.waitForCondition(() => !inDungeon() || distTo(before.x, before.z) > 6, 12_000).catch(() => {});
        }
        log(`After exit door @ ${pos().x},${pos().z} dungeon=${inDungeon()}`);
    }
    if (onIsland()) {
        intent('Swimming off the island — washes down to Hadley');
        if (distTo(ISLAND_SHOT.x, ISLAND_SHOT.z) > 2) {
            await sdk.sendWalk(ISLAND_SHOT.x, ISLAND_SHOT.z, true);
            await sdk.waitForCondition(() => distTo(ISLAND_SHOT.x, ISLAND_SHOT.z) <= 2, 8_000).catch(() => {});
        }
        await sdk.scanNearbyLocs(12).catch(() => {});
        const rock = sdk.findNearbyLoc(/^rock$/i, { withOption: /swim/i }) ?? sdk.findNearbyLoc(/^rock$/i);
        const swim = rock?.optionsWithIndex.find((o) => /swim/i.test(o.text));
        if (rock && swim) {
            await sdk.sendInteractLoc(rock.x, rock.z, rock.id, swim.opIndex);
            await sdk.waitForCondition(() => pos().z < 3450, 20_000).catch(() => {});
        } else {
            log(`No swim-rock @ ${pos().x},${pos().z} rock=${rock?.x},${rock?.z} opts=${rock?.optionsWithIndex.map((o) => o.text).join('/')}`);
        }
        log(`After island swim @ ${pos().x},${pos().z} island=${onIsland()}`);
    }
    if (onTreeRock()) {
        intent('Climbing the dead tree — washes down to Hadley');
        const tree = climbTree() ?? sdk.findNearbyLoc(/dead tree/i);
        if (tree) {
            await bot.interactLoc(tree, /climb/i);
            await sdk.waitForCondition(() => !onTreeRock() && !onLedge(), 20_000).catch(() => {});
            log(`After tree climb @ ${pos().x},${pos().z}`);
        }
    }
    if (onLedge()) {
        const barrel = sdk.findNearbyLoc(/^barrel$/i, { withOption: /get in/i }) ?? sdk.findNearbyLoc(/^barrel$/i);
        if (barrel) {
            await bot.interactLoc(barrel, /get in/i);
            await sdk.waitForCondition(() => !onLedge() && !onTreeRock() && !inDungeon(), 20_000).catch(() => {});
            log(`Barrel @ ${pos().x},${pos().z}`);
        }
    }
}

async function restockAtBank(): Promise<void> {
    if (inDungeon() || onLedge() || onTreeRock() || onIsland()) await leaveDungeon();
    if (inDungeon() || onLedge() || onTreeRock() || onIsland()) {
        throw new Error(`still at the falls @ ${pos().x},${pos().z}`);
    }
    intent('Banking loot at North Ardougne');
    if (pos().z < 6400 && distTo(NORTH_BANK.x, NORTH_BANK.z) > 12) {
        if (pos().x >= 2580 && pos().z < 3410) {
            await walkNear(NORTH_BANK.x, NORTH_BANK.z, 3);
        } else {
            await walkWaypoints(TO_BANK);
        }
    }
    if (!(await openBank())) {
        log('Bank open failed for restock');
        return;
    }
    for (const item of [...sdk.getInventory()]) {
        if (KEEP_INV.test(item.name) || COINS.test(item.name)) continue;
        await bot.depositItem(item, -1);
    }
    await waitBankClosed();

    try {
        if (needArrows()) await buyAemadArrows();
        else log(`Skip Aemad — ${arrowCount()} arrows`);
    } catch (err) {
        log(`Aemad buy skipped: ${(err as Error).message}`);
        await closeUi();
        if (needArrows()) throw err;
    }

    if (!(await openBank())) {
        log('Bank open failed after Aemad');
        return;
    }
    for (const item of [...sdk.getInventory()]) {
        if (KEEP_INV.test(item.name) || COINS.test(item.name)) continue;
        await bot.depositItem(item, -1);
    }
    const spareCoins = sdk.findInventoryItem(COINS);
    if (spareCoins) await bot.depositItem(spareCoins, -1);
    const bankArrows = sdk.findBankItem(BRONZE_ARROW) ?? sdk.findBankItem(ANY_ARROW);
    if (bankArrows) await bot.withdrawItem(bankArrows, -1);
    for (let i = 0; i < 4; i++) {
        const more = sdk.findBankItem(ANY_ARROW);
        if (!more) break;
        await bot.withdrawItem(more, -1);
    }
    if (foodCount() < FOOD_COUNT) {
        const food =
            sdk.findBankItem(/^shark$/i) ?? sdk.findBankItem(/^swordfish$/i) ?? sdk.findBankItem(/^tuna$/i);
        if (food) await bot.withdrawItem(food, Math.min(FOOD_COUNT - foodCount(), food.count), { asNote: false });
    }
    if (count(ROPE) < 1) await withdrawPat(ROPE, 1);
    await bot.closeBank();
    const invArrows = sdk.findInventoryItem(ANY_ARROW);
    if (invArrows) await bot.equipItem(invArrows);
    clearAmmoFlag();
    log(`Restocked arrows=${arrowCount()} food=${foodCount()} inv=${occupiedSlots()}`);
    if (arrowCount() < 1) throw new Error('no arrows after Aemad restock');
}

try {
    await closeUi();
    noteHp();
    log(
        `Fire giants start Ranged ${sdk.getSkill('Ranged')?.baseLevel} @ ${pos().x},${pos().z} ` +
            `hp=${pos().hp}/${pos().maxHp} arrows=${arrowCount()} food=${foodCount()}`
    );
    if (!inDungeon() && (foodCount() < FOOD_COUNT || needArrows())) {
        await restockAtBank();
    }

    while (true) {
        await closeUi();
        await eatIfLow();
        if (pos().isDead) {
            intent('Dead — waiting to respawn');
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }

        if (!inDungeon()) {
            const unequipped = !sdk.findEquipmentItem(SHORTBOW) || needArrows();
            if (unequipped) {
                await buyAemadArrows();
                await gearUp();
            } else if (hasBankableLoot() || foodCount() < 1 || bagFull()) {
                await restockAtBank();
            }
            await enterDungeon();
            continue;
        }

        const outOfAmmo = needArrows();
        if (bagFull() || foodCount() < 1 || outOfAmmo) {
            if (outOfAmmo) log(`Out of ammo (${arrowCount()}) — North Ardougne then Aemad`);
            await lootAfterKill();
            await leaveDungeon();
            await restockAtBank();
            continue;
        }

        if (!atSafe()) await stepToSafe();
        if (!atSafe()) {
            await sdk.waitForTicks(1);
            continue;
        }
        noteHp();

        intent('Door safespot — ranging closest fire giant');
        if (await shoot()) {
            await waitForKill();
            await lootAfterKill();
        } else {
            await sdk.waitForTicks(2);
        }
    }
} catch (err) {
    console.error('Script error:', err);
    log(`Script error: ${(err as Error).message}`);
    throw err;
} finally {
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
