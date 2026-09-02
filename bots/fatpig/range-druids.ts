import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const VARROCK_SQUARE = { x: 3210, z: 3429 };
const LOWE = { x: 3232, z: 3423 };
const DUNGEON_LADDER = { x: 3096, z: 9867 };
const WILDY_GATE = { x: 3103, z: 9909 };
const DRUIDS = { x: 3114, z: 9929 };
const SKELETON_LINE = 9940;

const FOOD_WITHDRAW = 4;
const ARROW_WITHDRAW = 1000;
const ARROW_RESTOCK_BELOW = 80;
const COIN_WITHDRAW = 15_000;
const LOWE_BRONZE_STOCK = 2000;
const RANGED_BLACK_DHIDE = 70;

const HERB = /^(herb|guam leaf|marrentill|tarromin|harralander|ranarr weed|toadflax|irit leaf|avantoe|kwuarm|cadantine|lantadyme|dwarf weed|torstol)$/i;
const RUNE = /rune$/i;
const COINS = /^coins$/i;
const LOOT = /^(herb|guam leaf|marrentill|tarromin|harralander|ranarr weed|toadflax|irit leaf|avantoe|kwuarm|cadantine|lantadyme|dwarf weed|torstol|coins|.+ rune)$/i;
const BONES = /^bones$/i;
const FOOD = /^lobster$/i;
const BRONZE_ARROW = /^bronze arrows?$/i;
const ARROW = /^(bronze|iron|steel|mithril|adamant|rune) arrows?$/i;
const MAGIC_SHORTBOW = /^magic shortbow$/i;
const BOW = /bow/i;
const GREEN_DHIDE = /^(green )?d'hide body$|^dragonhide body$|^(green )?d'hide chaps$|^dragonhide chaps$|^dragon vambraces$/i;
const BLACK_DHIDE =
    /^black d'hide body$|^black dragonhide body$|^black d'hide chaps$|^black dragonhide chaps$|^black d'hide vambraces$|^black dragonhide vambraces$/i;
const KEEP = /^(coins|lobster|(bronze|iron|steel|mithril|adamant|rune) arrows?|magic shortbow|.+bow|black d'hide body|black d'hide chaps|black d'hide vambraces|black dragonhide body|black dragonhide chaps|black dragonhide vambraces)$/i;

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
    autoLaunchBrowser: 'auto',
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: true
});

console.log('Opening/attaching the game client...');
await sdk.connect();
const bot = new BotActions(sdk);

function pos() {
    const p = sdk.getState()?.player;
    return {
        x: p?.worldX ?? 0,
        z: p?.worldZ ?? 0,
        level: p?.level ?? 0,
        hp: p?.hp ?? 10,
        maxHp: p?.maxHp ?? 10,
        isDead: p?.isDead ?? false,
        inCombat: p?.combat?.inCombat ?? false,
        targetType: p?.combat?.targetType ?? 'none',
        targetIndex: p?.combat?.targetIndex ?? -1,
    };
}

function distTo(x: number, z: number): number {
    const p = pos();
    return Math.hypot(p.x - x, p.z - z);
}

function inDungeon(): boolean {
    return pos().z > 6400;
}

function countItems(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + i.count, 0);
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function herbSlots(): number {
    return sdk.getInventory().filter((i) => HERB.test(i.name)).length;
}

function foodCount(): number {
    return countItems(FOOD);
}

function findFood() {
    return sdk.findInventoryItem(FOOD);
}

function arrowCount(): number {
    const worn = sdk.getEquipment().filter((i) => ARROW.test(i.name)).reduce((n, i) => n + i.count, 0);
    return worn + countItems(ARROW);
}

function coins(): number {
    return sdk.findInventoryItem(COINS)?.count ?? 0;
}

function hasMagicShortbow(): boolean {
    return !!(sdk.findEquipmentItem(MAGIC_SHORTBOW) || sdk.findInventoryItem(MAGIC_SHORTBOW));
}

function hasBow(): boolean {
    return hasMagicShortbow() || !!(sdk.findEquipmentItem(BOW) || sdk.findInventoryItem(BOW));
}

function rangedLevel(): number {
    return sdk.getSkill('Ranged')?.baseLevel ?? 1;
}

function rangedXp(): number {
    return sdk.getSkill('Ranged')?.experience ?? 0;
}

function defenceLevel(): number {
    return sdk.getSkill('Defence')?.baseLevel ?? 1;
}

function defenceXp(): number {
    return sdk.getSkill('Defence')?.experience ?? 0;
}

async function intent(msg: string): Promise<void> {
    await sdk.showIntent(msg).catch(() => {});
}

async function ensureGroundFloor(): Promise<void> {
    for (let i = 0; i < 8 && pos().level > 0; i++) {
        const loc = sdk.findNearbyLoc(/ladder|stair/i, { withOption: /down/i });
        if (loc) {
            await bot.interactLoc(loc, /down/i);
            await sdk.waitForCondition((s) => (s.player?.level ?? 1) === 0, 8_000).catch(() => {});
        }
        await sdk.waitForTicks(1);
    }
    if (pos().level > 0) log(`Still upstairs @ ${pos().x},${pos().z} L${pos().level}`);
}

async function leaveVarrockEastBank(): Promise<void> {
    if (pos().level > 0) {
        const down = sdk.findNearbyLoc(/stair|ladder/i, { withOption: /down/i });
        if (down) {
            await bot.interactLoc(down, /down/i);
            await sdk.waitForCondition((s) => (s.player?.level ?? 1) === 0, 8_000).catch(() => {});
        }
        await ensureGroundFloor();
    }
    if (pos().x > 3225 || pos().level > 0) {
        await bot.walkTo(VARROCK_SQUARE.x, VARROCK_SQUARE.z, 4);
        log(`Left Varrock east @ ${pos().x},${pos().z}`);
    }
}

async function walkNear(x: number, z: number, tolerance = 6): Promise<boolean> {
    if (pos().hp <= 16) await eatIfNeeded();
    if (pos().level > 0) await ensureGroundFloor();
    if (inDungeon() && z < 6400) await climbToSurface();
    if (pos().x > 3225 && x < 3200) await leaveVarrockEastBank();
    if (distTo(x, z) <= tolerance) return true;
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    log(`walkTo(${x},${z}): ${result.success ? 'ok' : result.message} @ ${pos().x},${pos().z} L${pos().level}`);
    return result.success || distTo(x, z) <= tolerance + 2;
}

async function openBankAt(x: number, z: number): Promise<boolean> {
    if (inDungeon()) await climbToSurface();
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (sdk.getState()?.bank?.isOpen) {
        if (distTo(x, z) <= 8) return true;
        await bot.closeBank();
    }
    if (sdk.getState()?.interface?.isOpen && !sdk.getState()?.bank?.isOpen) await bot.closeInterface();
    await walkNear(x, z, 4);
    if (sdk.getState()?.bank?.isOpen) return true;
    const opened = await bot.openBank();
    if (!opened.success) {
        log(`openBank failed: ${opened.message}`);
        return false;
    }
    return true;
}

async function depositJunk(): Promise<void> {
    for (let i = 0; i < 40; i++) {
        const item = sdk.getInventory().find((it) => !KEEP.test(it.name));
        if (!item) break;
        const r = await bot.depositItem(
            new RegExp(`^${item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
            -1
        );
        log(`Deposit ${item.name}: ${r.success || r.partial} ${r.message ?? ''}`);
        if (!r.success && !r.partial) break;
    }
    if (sdk.findInventoryItem(COINS)) {
        const r = await bot.depositItem(COINS, -1);
        log(`Deposit coins: ${r.success || r.partial} ${r.message ?? ''}`);
    }
}

async function restockArrowsAtLowe(): Promise<void> {
    if (arrowCount() >= ARROW_RESTOCK_BELOW) {
        log(`Arrows ok (${arrowCount()}) — skip Lowe`);
        return;
    }
    log(`Bank-run Lowe restock arrows=${arrowCount()} bow=${hasBow()} gp=${coins()}`);
    await intent('buy bronze arrows at Lowe');
    if (!(await openBankAt(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z))) return;
    await depositJunk();
    if (!hasBow()) {
        const r = await bot.withdrawItem(/shortbow/i, 1);
        if (!(r.success || r.partial)) {
            await bot.withdrawItem(BOW, 1).catch(() => {});
        }
        log(`Withdraw bow: ${hasBow()}`);
    }
    if (coins() < COIN_WITHDRAW) {
        const bankGp = sdk.findBankItem(COINS)?.count ?? 0;
        if (bankGp > 0) {
            const r = await bot.withdrawItem(COINS, Math.min(COIN_WITHDRAW - coins(), bankGp));
            log(`Withdraw coins for Lowe: ${r.success || r.partial} now ${coins()}gp`);
        }
    }
    await bot.closeBank();
    if (coins() < 1) {
        log('No coins for Lowe');
        return;
    }

    await walkNear(LOWE.x, LOWE.z, 3);
    const opened = await bot.openShop(/lowe/i);
    if (!opened.success && !sdk.getState()?.shop?.isOpen) {
        log(`Lowe shop failed: ${opened.message}`);
        return;
    }

    if (!hasBow()) {
        const bowLine = sdk.getState()?.shop?.shopItems.find((i) => /shortbow/i.test(i.name));
        if (bowLine && bowLine.count > 0) {
            const r = await bot.buyFromShop(bowLine, 1);
            log(`Buy shortbow: ${(r.amountBought ?? 0) > 0 ? 'ok' : r.message} now ${sdk.findInventoryItem(BOW)?.name ?? 'none'}`);
            await equipGear();
        }
    }

    const shopLine = () => sdk.getState()?.shop?.shopItems.find((i) => BRONZE_ARROW.test(i.name)) ?? null;
    const liveBuyPrice = (line: { count: number; baseCost?: number }) => {
        const cfg = sdk.getState()?.shop?.shopConfig;
        const cost = line.baseCost || 1;
        const haggle = cfg?.haggle ?? 10;
        const sellMult = cfg?.sellMultiplier ?? 1000;
        const stockDiff = (line.count ?? 0) - LOWE_BRONZE_STOCK;
        const raw = Math.min(1000, Math.max(-5000, stockDiff * haggle));
        return Math.max(1, Math.floor((cost * Math.max(100, sellMult - raw)) / 1000));
    };

    const before = arrowCount();
    let stall = 0;
    while (stall < 4 && coins() >= 1 && arrowCount() - before < ARROW_WITHDRAW) {
        const line = shopLine();
        if (!line || line.count <= 0) break;
        if (coins() < liveBuyPrice(line)) break;
        const stockBefore = line.count;
        const room = ARROW_WITHDRAW - (arrowCount() - before);
        const clicks = Math.min(8, Math.ceil(Math.min(stockBefore, Math.max(10, room)) / 10));
        for (let n = 0; n < clicks; n++) {
            const r = await sdk.sendShopBuy(line.slot, 10);
            if (!r.success) {
                log(`Buy bronze send failed: ${r.message}`);
                stall = 99;
                break;
            }
        }
        await sdk.waitForTicks(1);
        const stockAfter = shopLine()?.count ?? 0;
        if (stockAfter >= stockBefore) stall++;
        else stall = 0;
    }
    log(`Bought ${arrowCount() - before} bronze arrows | shelf ${shopLine()?.count ?? 0} | ${coins()}gp | total ${arrowCount()}`);
    await bot.closeShop();
    await equipGear();
    await leaveVarrockEastBank();
}

async function withdrawFoodAndSpareArrows(): Promise<void> {
    if (!hasMagicShortbow()) {
        const bow = sdk.findBankItem(MAGIC_SHORTBOW);
        if (bow) {
            const r = await bot.withdrawItem(bow, 1);
            log(`Withdraw magic shortbow: ${r.success || r.partial}`);
        }
    }
    if (!hasBow()) {
        await bot.withdrawItem(/shortbow/i, 1).catch(() => {});
        if (!hasBow()) await bot.withdrawItem(BOW, 1).catch(() => {});
    }
    const arrowPattern = BRONZE_ARROW;
    const extra = arrowCount() - ARROW_WITHDRAW;
    if (extra > 0 && sdk.findInventoryItem(arrowPattern)) {
        const r = await bot.depositItem(arrowPattern, extra);
        log(`Park extra arrows: ${r.success || r.partial} now ${arrowCount()}`);
    }
    const needArrows = ARROW_WITHDRAW - arrowCount();
    if (needArrows > 0) {
        const bankArrows = sdk.findBankItem(arrowPattern)?.count ?? 0;
        if (bankArrows > 0) {
            const r = await bot.withdrawItem(arrowPattern, Math.min(needArrows, bankArrows));
            log(`Bank bronze arrows: ${r.success || r.partial} now ${arrowCount()}`);
        }
    }
    const extraFood = foodCount() - FOOD_WITHDRAW;
    if (extraFood > 0 && sdk.findInventoryItem(FOOD)) {
        const r = await bot.depositItem(FOOD, extraFood);
        log(`Park extra lobster: ${r.success || r.partial} now ${foodCount()}`);
    }
    const haveFood = foodCount();
    if (haveFood < FOOD_WITHDRAW) {
        const bankFood = sdk.findBankItem(FOOD)?.count ?? 0;
        if (bankFood > 0) {
            const r = await bot.withdrawItem(FOOD, Math.min(FOOD_WITHDRAW - haveFood, bankFood));
            log(`Withdraw lobster: ${r.success || r.partial} now ${foodCount()}`);
        }
    }
}

async function setLongrange(): Promise<void> {
    const style = sdk.getState()?.combatStyle?.styles.find(
        (s) => s.type === 'Longrange' || /longrange/i.test(s.name)
    );
    if (!style) {
        log(`No Longrange style (tab known=${sdk.getState()?.combatStyle?.known} weapon=${sdk.getState()?.combatStyle?.weaponName})`);
        return;
    }
    if (sdk.getState()?.combatStyle?.currentStyle === style.index) return;
    await sdk.sendSetCombatStyle(style.index);
    await sdk.waitForCondition((s) => s.combatStyle?.currentStyle === style.index, 5_000).catch(() => {});
    log(`Combat style ${style.name} (${style.type}) trains ${style.trainsSkills.join('+')}`);
}

async function equipGear(): Promise<void> {
    const range = rangedLevel();
    if (range >= RANGED_BLACK_DHIDE) {
        for (const piece of [
            /^black d'hide body$|^black dragonhide body$/i,
            /^black d'hide chaps$|^black dragonhide chaps$/i,
            /^black d'hide vambraces$|^black dragonhide vambraces$/i
        ]) {
            if (sdk.findEquipmentItem(piece)) continue;
            const inv = sdk.findInventoryItem(piece) ?? sdk.findBankItem(piece);
            if (inv && !(await bot.openBank()).success) {
                /* bank already open elsewhere */
            }
            if (!sdk.findInventoryItem(piece) && sdk.getState()?.bank?.isOpen) {
                const bank = sdk.findBankItem(piece);
                if (bank) await bot.withdrawItem(bank, 1);
            }
            const item = sdk.findInventoryItem(piece);
            if (item) {
                const r = await bot.equipItem(item);
                log(`Equip ${item.name}: ${r.success ? 'ok' : r.message}`);
            }
        }
        if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
    }

    if (!sdk.findEquipmentItem(MAGIC_SHORTBOW)) {
        const magic = sdk.findInventoryItem(MAGIC_SHORTBOW);
        if (magic) {
            const r = await bot.equipItem(magic);
            log(`Equip magic shortbow: ${r.success ? 'ok' : r.message}`);
        }
    }
    if (!sdk.findEquipmentItem(BOW)) {
        const bow = sdk.findInventoryItem(BOW);
        if (bow) {
            const r = await bot.equipItem(bow);
            log(`Equip ${bow.name}: ${r.success ? 'ok' : r.message}`);
        }
    }
    const arrows = sdk.findInventoryItem(BRONZE_ARROW) ?? sdk.findInventoryItem(ARROW);
    if (arrows) {
        const r = await bot.equipItem(arrows);
        if (r.success) log(`Wield ${arrows.count} ${arrows.name}`);
    }
    await setLongrange();
}

async function climbIntoDungeon(): Promise<boolean> {
    if (inDungeon()) return true;
    await walkNear(3095, 3468, 1);
    for (let attempt = 0; attempt < 4 && !inDungeon(); attempt++) {
        const trap = sdk.findNearbyLoc(/trapdoor/i);
        log(`Trapdoor try ${attempt}: ${trap ? `${trap.name} [${trap.optionsWithIndex.map((o) => o.text).join(', ')}]` : 'none'} @ ${pos().x},${pos().z}`);
        if (!trap) {
            await sdk.waitForTicks(1);
            continue;
        }
        if (trap.optionsWithIndex.some((o) => /^open$/i.test(o.text))) {
            await bot.interactLoc(trap, /^open$/i);
            await sdk.waitForCondition(
                (s) => (s.nearbyLocs ?? []).some((l) => /trapdoor/i.test(l.name) && l.optionsWithIndex.some((o) => /climb-down/i.test(o.text))),
                6_000
            ).catch(() => {});
        }
        const down = sdk.findNearbyLoc(/trapdoor/i, { withOption: /climb-down/i });
        if (down) {
            await bot.interactLoc(down, /climb-down/i);
            await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) > 6400, 8_000).catch(() => {});
        }
    }
    log(`Dungeon ${inDungeon()} @ ${pos().x},${pos().z}`);
    return inDungeon();
}

async function climbToSurface(): Promise<boolean> {
    if (!inDungeon()) return true;
    await eatIfNeeded();
    if (pos().z >= WILDY_GATE.z) {
        await walkNear(WILDY_GATE.x, WILDY_GATE.z + 6, 3);
        const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
        if (gate) await bot.openDoor(gate);
        await walkNear(WILDY_GATE.x, WILDY_GATE.z - 6, 3);
    }
    await walkNear(DUNGEON_LADDER.x, DUNGEON_LADDER.z, 2);
    const ladder = sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-up/i });
    if (ladder) {
        await bot.interactLoc(ladder, /climb-up/i);
        await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) < 6400, 10_000).catch(() => {});
    }
    log(`Surface ${!inDungeon()} @ ${pos().x},${pos().z}`);
    return !inDungeon();
}

async function prepareLoadout(): Promise<void> {
    await intent('bank, magic shortbow + bronze arrows, 4 lobster');
    if (inDungeon()) await climbToSurface();
    await ensureGroundFloor();
    await leaveVarrockEastBank();
    if (!(await openBankAt(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z))) return;
    await depositJunk();
    await withdrawFoodAndSpareArrows();
    if (!hasMagicShortbow()) {
        log('No magic shortbow in bank or equipped — deposit one before grinding');
    }
    await bot.closeBank();
    await restockArrowsAtLowe();
    if (!(await openBankAt(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z))) return;
    await depositJunk();
    await withdrawFoodAndSpareArrows();
    log(
        `Loadout food=${foodCount()} arrows=${arrowCount()} bow=${sdk.findEquipmentItem(BOW)?.name ?? sdk.findInventoryItem(BOW)?.name ?? 'none'}`
    );
    await bot.closeBank();
    await equipGear();
}

async function goToDruids(): Promise<void> {
    if (!inDungeon() && !(await climbIntoDungeon())) return;
    if (pos().z < WILDY_GATE.z - 4) {
        await walkNear(WILDY_GATE.x, WILDY_GATE.z - 2, 3);
        const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
        if (gate) await bot.openDoor(gate);
    }
    await walkNear(DRUIDS.x, DRUIDS.z, 6);
}

function nearbySkeleton() {
    return (sdk.getNearbyNpcs() ?? []).find(
        (n) => /^skeleton$/i.test(n.name) && (n.distance ?? 99) <= 3
    ) ?? null;
}

async function fleeSkeletons(): Promise<boolean> {
    const skel = nearbySkeleton();
    if (!skel && pos().z < SKELETON_LINE) return false;
    log(`Skeleton nearby ${skel?.x ?? '?'},${skel?.z ?? pos().z} — backing south`);
    await walkNear(DRUIDS.x, DRUIDS.z - 4, 3);
    return true;
}

async function eatIfNeeded(): Promise<void> {
    const p = pos();
    if (p.hp > 16) return;
    const food = findFood();
    if (!food) return;
    const r = await bot.eatFood(food);
    if (r.success) log(`Ate ${food.name} +${r.hpGained} HP ${pos().hp}/${pos().maxHp} left=${foodCount()}`);
    else log(`Eat failed: ${r.message} HP ${p.hp}/${p.maxHp}`);
}

async function keepRange(): Promise<void> {
    const p = pos();
    if (!p.inCombat || p.targetType !== 'npc') return;
    const target = sdk.getNearbyNpcs().find((n) => n.index === p.targetIndex);
    if ((target?.distance ?? 99) > 2) return;
    await walkNear(DRUIDS.x, DRUIDS.z - 5, 2);
}

async function buryBones(): Promise<void> {
    for (let i = 0; i < 8; i++) {
        const bones = sdk.findInventoryItem(BONES);
        if (!bones) return;
        const buryOpt = bones.optionsWithIndex.find((o) => /bury/i.test(o.text));
        if (!buryOpt) return;
        await sdk.sendUseItem(bones.slot, buryOpt.opIndex);
        await sdk.waitForTicks(1);
    }
}

function isArrowStack(g: { name: string; count: number }): boolean {
    return ARROW.test(g.name) && (g.count ?? 0) >= 5;
}

async function lootGround(): Promise<void> {
    for (let i = 0; i < 8; i++) {
        await eatIfNeeded();
        if (pos().hp <= 16) return;
        await buryBones();
        if (occupiedSlots() >= 28) break;
        const item = (sdk.getGroundItems() ?? [])
            .filter((g) =>
                (LOOT.test(g.name) || BONES.test(g.name) || isArrowStack(g)) &&
                g.reachable !== false &&
                (g.distance ?? 99) <= 8
            )
            .sort((a, b) => {
                const pri = (g: typeof a) =>
                    isArrowStack(g) ? 0 : RUNE.test(g.name) || COINS.test(g.name) || HERB.test(g.name) ? 1 : 2;
                const d = pri(a) - pri(b);
                if (d !== 0) return d;
                return (a.distance ?? 99) - (b.distance ?? 99);
            })[0];
        if (!item) return;
        const r = await bot.pickupItem(item);
        if (!r.success) {
            log(`Pickup ${item.name} x${item.count} failed: ${r.message}`);
            return;
        }
        if (isArrowStack(item)) log(`Picked ${item.count} ${item.name}`);
    }
}

function findDruid() {
    const druids = (sdk.getNearbyNpcs() ?? [])
        .filter((n) =>
            /^chaos druid$/i.test(n.name) &&
            (n.hp === null || n.hp > 0) &&
            n.z < SKELETON_LINE &&
            n.optionsWithIndex.some((o) => /attack/i.test(o.text)) &&
            (n.reachable !== false)
        )
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
    const myTarget = pos().targetIndex;
    const free = druids.filter((d) => !d.inCombat || d.index === myTarget);
    return free[0] ?? null;
}

function hasValidNpcTarget(): boolean {
    const p = pos();
    if (!p.inCombat || p.targetType !== 'npc' || p.targetIndex < 0) return false;
    const target = sdk.getNearbyNpcs().find((n) => n.index === p.targetIndex);
    return !!target && (target.hp === null || target.hp > 0);
}

async function waitForDruidFight(): Promise<void> {
    const started = Date.now();
    while (hasValidNpcTarget() && !pos().isDead && Date.now() - started < 25_000) {
        await bot.dismissBlockingUI();
        await eatIfNeeded();
        await keepRange();
        if (arrowCount() <= 0) return;
        if (pos().hp <= 16) continue;
        await lootGround();
    }
}

async function shootDruid(): Promise<void> {
    if (hasValidNpcTarget()) {
        await waitForDruidFight();
        return;
    }

    const target = findDruid();
    if (!target) {
        if (distTo(DRUIDS.x, DRUIDS.z) > 8) await walkNear(DRUIDS.x, DRUIDS.z, 5);
        else await sdk.waitForTicks(1);
        return;
    }

    const d = target.distance ?? 99;
    if (d > 8) await walkNear(target.x, target.z, 7);
    else if (d <= 2) await walkNear(DRUIDS.x, DRUIDS.z - 5, 2);

    const opt = target.optionsWithIndex.find((o) => /attack/i.test(o.text));
    if (!opt) return;
    const r = await sdk.sendInteractNpc(target.index, opt.opIndex);
    if (!r.success) {
        log(`Attack ${target.name}: ${r.message}`);
        return;
    }
    try {
        await sdk.waitForCondition((s) => {
            if (s.player?.combat?.inCombat) return true;
            const gone = !s.nearbyNpcs.some((n) => n.index === target.index && (n.hp === null || n.hp > 0));
            return gone;
        }, 8_000);
    } catch {
        /* recast next loop */
    }
    await waitForDruidFight();
}

try {
    log(
        `Range chaos druids (longrange). Ranged ${rangedLevel()} (${rangedXp()} xp) ` +
        `Defence ${defenceLevel()} (${defenceXp()} xp) @ ${pos().x},${pos().z} arrows=${arrowCount()} food=${foodCount()}`
    );
    await bot.dismissBlockingUI();
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (sdk.getState()?.bank?.isOpen) await bot.closeBank();

    await equipGear();
    if (!(inDungeon() && hasBow() && foodCount() > 0 && arrowCount() >= ARROW_RESTOCK_BELOW)) {
        await prepareLoadout();
        await goToDruids();
    }
    await setLongrange();

    let lastRange = rangedLevel();
    let lastDef = defenceLevel();
    while (true) {
        await bot.dismissBlockingUI();

        if (pos().isDead) {
            log('Died — waiting to respawn');
            await sdk.waitForCondition((s) => !s.player.isDead, 60_000).catch(() => {});
            log(`Respawned @ ${pos().x},${pos().z}`);
            await prepareLoadout();
            await goToDruids();
            continue;
        }

        if (pos().targetType === 'player' && pos().inCombat) {
            log('Player combat — running to ladder');
            await walkNear(DUNGEON_LADDER.x, DUNGEON_LADDER.z, 4);
            await climbToSurface();
            await prepareLoadout();
            await goToDruids();
            continue;
        }

        const range = rangedLevel();
        const def = defenceLevel();
        if (range !== lastRange || def !== lastDef) {
            log(
                `LEVEL UP Ranged ${range} (${rangedXp()} xp) Defence ${def} (${defenceXp()} xp) | ` +
                `food ${foodCount()} herbs ${herbSlots()} arrows ${arrowCount()}`
            );
            lastRange = range;
            lastDef = def;
            if (range >= RANGED_BLACK_DHIDE) await equipGear();
        }

        await eatIfNeeded();
        await keepRange();
        if (await fleeSkeletons()) continue;

        if (foodCount() === 0 || occupiedSlots() >= 28 || arrowCount() <= 0) {
            log(`Banking food=${foodCount()} herbs=${herbSlots()} arrows=${arrowCount()} slots=${occupiedSlots()}`);
            await prepareLoadout();
            if (foodCount() === 0) {
                log('Out of lobster — stopping');
                break;
            }
            if (arrowCount() <= 0) {
                log(`Out of arrows after bank — stopping`);
                break;
            }
            if (!hasBow()) {
                log('No bow after bank — stopping');
                break;
            }
            await goToDruids();
            continue;
        }

        await lootGround();
        await equipGear();
        await intent(`longrange druids r${range} d${def} | ${arrowCount()} arr | food ${foodCount()}`);
        await shootDruid();
        await lootGround();
    }
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
