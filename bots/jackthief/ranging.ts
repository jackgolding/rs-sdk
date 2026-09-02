import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

/** Chickens just west of the Ranging Guild gates. */
const CHICKENS = { x: 2650, z: 3440 };
const BANK = { x: 2808, z: 3443 };
const HICKTON = { x: 2822, z: 3442 };

const BRONZE_MAX_GP = 7;
const IRON_MAX_GP = 5;
const BRONZE_STOCK = 1000;
const IRON_STOCK = 800;
const ARROW_LOW = 5;
const COIN_WITHDRAW = 2000;

const ARROW = /^(bronze|iron|steel|mithril|adamant|rune) arrows?$/i;
const IRON_ARROW = /^iron arrows?$/i;
const BRONZE_ARROW = /^bronze arrows?$/i;
const FEATHER = /^feathers?$/i;
const BONES = /^bones$/i;
const LOOT = /^(bronze|iron|steel|mithril|adamant|rune) arrows?$|^feathers?$|^bones$/i;
const BOW = /bow/i;

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
    showChat: true
});

console.log('Opening/attaching the game client...');
await sdk.connect();
const bot = new BotActions(sdk);

let lastLoggedLevel = 0;

function pos() {
    const p = sdk.getState()?.player;
    return {
        x: p?.worldX ?? 0,
        z: p?.worldZ ?? 0,
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

function atChickens(): boolean {
    return distTo(CHICKENS.x, CHICKENS.z) <= 12 && pos().z < 6400;
}

function countItems(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + i.count, 0);
}

function coins(): number {
    return sdk.findInventoryItem(/^coins$/i)?.count ?? 0;
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function arrowCount(): number {
    const worn = sdk.getEquipment().filter((i) => ARROW.test(i.name)).reduce((n, i) => n + i.count, 0);
    return worn + countItems(ARROW);
}

function rangedLevel(): number {
    return sdk.getSkill('Ranged')?.baseLevel ?? 1;
}

function rangedXp(): number {
    return sdk.getSkill('Ranged')?.experience ?? 0;
}

async function intent(msg: string): Promise<void> {
    await sdk.showIntent(msg).catch(() => {});
}

async function walkNear(x: number, z: number, tolerance = 6): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    return result.success || distTo(x, z) <= tolerance + 2;
}

async function setRapid(): Promise<void> {
    const style = sdk.getState()?.combatStyle?.styles.find(
        (s) => s.type === 'Rapid' || /rapid/i.test(s.name)
    );
    if (!style) return;
    if (sdk.getState()?.combatStyle?.currentStyle === style.index) return;
    await sdk.sendSetCombatStyle(style.index);
    await sdk.waitForCondition((s) => s.combatStyle?.currentStyle === style.index, 5_000).catch(() => {});
    log(`Combat style ${style.name} (${style.type})`);
}

async function equipGear(): Promise<void> {
    if (!sdk.findEquipmentItem(BOW)) {
        const bow = sdk.findInventoryItem(BOW);
        if (bow) {
            const r = await bot.equipItem(bow);
            log(`Equip ${bow.name}: ${r.success ? 'ok' : r.message}`);
        }
    }
    const iron = sdk.findInventoryItem(IRON_ARROW);
    const bronze = sdk.findInventoryItem(BRONZE_ARROW);
    const any = sdk.findInventoryItem(ARROW);
    const worn = sdk.findEquipmentItem(ARROW);
    const best = iron ?? (IRON_ARROW.test(worn?.name ?? '') ? null : bronze ?? any);
    if (best) {
        const r = await bot.equipItem(best);
        if (r.success) log(`Wield ${best.count} ${best.name}`);
    }
    await setRapid();
}

async function buryBones(): Promise<number> {
    let buried = 0;
    for (let i = 0; i < 12; i++) {
        const bones = sdk.findInventoryItem(BONES);
        if (!bones) break;
        const buryOpt = bones.optionsWithIndex.find((o) => /bury/i.test(o.text));
        if (!buryOpt) break;
        const xpBefore = sdk.getSkill('Prayer')?.experience ?? 0;
        await sdk.sendUseItem(bones.slot, buryOpt.opIndex);
        try {
            await sdk.waitForCondition((s) => {
                const xp = s.skills.find((sk) => sk.name === 'Prayer')?.experience ?? 0;
                return xp > xpBefore || !s.inventory.find((it) => it.slot === bones.slot && BONES.test(it.name));
            }, 4_000);
        } catch {
            break;
        }
        buried++;
    }
    return buried;
}

async function lootGround(): Promise<number> {
    let picked = 0;
    for (let i = 0; i < 10; i++) {
        await buryBones();
        if (occupiedSlots() >= 27 && !sdk.findInventoryItem(ARROW) && !sdk.findInventoryItem(FEATHER)) break;
        const item = (sdk.getGroundItems() ?? [])
            .filter((g) => LOOT.test(g.name) && g.reachable !== false && (g.distance ?? 99) <= 8)
            .sort((a, b) => {
                const pri = (n: string) => (ARROW.test(n) ? 0 : FEATHER.test(n) ? 1 : 2);
                const d = pri(a.name) - pri(b.name);
                if (d !== 0) return d;
                return (a.distance ?? 99) - (b.distance ?? 99);
            })[0];
        if (!item) break;
        let r;
        try {
            r = await bot.pickupItem(item);
        } catch (err) {
            log(`Pickup ${item.name} threw: ${err instanceof Error ? err.message : err}`);
            break;
        }
        if (!r.success) {
            log(`Pickup ${item.name} failed: ${r.message}`);
            break;
        }
        picked++;
    }
    await buryBones();
    return picked;
}

function shopBuyPrice(item: { name: string; count: number; baseCost: number }): number {
    const cfg = sdk.getState()?.shop?.shopConfig;
    const haggle = cfg?.haggle ?? 10;
    const sellMult = cfg?.sellMultiplier ?? 1000;
    const stockBase = IRON_ARROW.test(item.name) ? IRON_STOCK : BRONZE_ARROW.test(item.name) ? BRONZE_STOCK : item.count;
    const stockDiff = item.count - stockBase;
    const int5Raw = Math.min(1000, Math.max(-5000, stockDiff * haggle));
    const int5 = Math.max(100, sellMult - int5Raw);
    return Math.max(1, Math.floor(item.baseCost * int5 / 1000));
}

function shopLine(pattern: RegExp) {
    return sdk.getState()?.shop?.shopItems.find((i) => pattern.test(i.name)) ?? null;
}

async function buyWhileCheap(pattern: RegExp, maxGp: number, label: string): Promise<number> {
    let bought = 0;
    for (let i = 0; i < 80; i++) {
        const line = shopLine(pattern);
        if (!line || line.count <= 0) break;
        const price = shopBuyPrice(line);
        if (price >= maxGp) {
            log(`${label} ${price}gp (>= ${maxGp}) stock ${line.count} — stop`);
            break;
        }
        if (coins() < price) break;
        const want = Math.min(10, line.count, Math.floor(coins() / price));
        if (want <= 0) break;
        const r = await bot.buyFromShop(line, want);
        bought += r.amountBought ?? 0;
        if ((r.amountBought ?? 0) <= 0) {
            log(`Buy ${label} failed: ${r.message}`);
            break;
        }
        log(`Bought ${r.amountBought} ${label} @ ${price}gp (${arrowCount()} arrows, ${coins()}gp)`);
    }
    return bought;
}

async function openBankAt(x: number, z: number): Promise<boolean> {
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (sdk.getState()?.bank?.isOpen) return true;
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

async function restockArrows(): Promise<boolean> {
    log(`Out of arrows (${arrowCount()}) — Catherby Hickton`);
    await intent('buy arrows at Hickton');

    if (await openBankAt(BANK.x, BANK.z)) {
        if (sdk.findInventoryItem(/^harpoon$/i)) await bot.depositItem(/^harpoon$/i, -1).catch(() => {});
        if (coins() < 200) {
            const r = await bot.withdrawItem(/^coins$/i, COIN_WITHDRAW);
            log(`Withdraw coins: ${r.success || r.partial} now ${coins()}gp`);
        }
        if (!sdk.findEquipmentItem(BOW) && !sdk.findInventoryItem(BOW)) {
            await bot.withdrawItem(BOW, 1).catch(() => {});
        }
        await bot.closeBank();
    }

    if (coins() < 1) {
        log(`No coins for arrows`);
        return arrowCount() > 0;
    }

    await walkNear(HICKTON.x, HICKTON.z, 3);
    const opened = await bot.openShop(/hickton/i);
    if (!opened.success && !sdk.getState()?.shop?.isOpen) {
        log(`Hickton shop failed: ${opened.message}`);
        return arrowCount() > 0;
    }

    const iron = shopLine(IRON_ARROW);
    const bronze = shopLine(BRONZE_ARROW);
    log(
        `Hickton iron ${iron?.count ?? 0} @ ${iron ? shopBuyPrice(iron) : '?'}gp ` +
        `bronze ${bronze?.count ?? 0} @ ${bronze ? shopBuyPrice(bronze) : '?'}gp | ${coins()}gp`
    );

    const gotIron = await buyWhileCheap(IRON_ARROW, IRON_MAX_GP, 'iron arrow');
    const gotBronze = await buyWhileCheap(BRONZE_ARROW, BRONZE_MAX_GP, 'bronze arrow');
    await bot.closeShop();

    await equipGear();
    log(`Restock done iron+${gotIron} bronze+${gotBronze} | ${arrowCount()} arrows ${coins()}gp`);
    return arrowCount() > 0;
}

function findChicken() {
    const chickens = (sdk.getNearbyNpcs() ?? [])
        .filter((n) =>
            /^chicken$/i.test(n.name) &&
            n.optionsWithIndex.some((o) => /attack/i.test(o.text)) &&
            (n.hp === null || n.hp > 0) &&
            n.reachable !== false
        )
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
    const myTarget = sdk.getState()?.player?.combat?.targetIndex ?? -1;
    const free = chickens.filter((c) => !c.inCombat || c.index === myTarget);
    return free[0] ?? null;
}

async function waitForChickenFight(): Promise<void> {
    const started = Date.now();
    while (pos().inCombat && !pos().isDead && Date.now() - started < 20_000) {
        await bot.dismissBlockingUI();
        if (arrowCount() <= 0) return;
        const target = sdk.getNearbyNpcs().find((n) => n.index === pos().targetIndex);
        if (target && target.hp === 0) return;
        await sdk.waitForTicks(1);
    }
}

async function shootChicken(): Promise<void> {
    if (pos().inCombat && pos().targetType === 'npc') {
        await waitForChickenFight();
        return;
    }

    const chicken = findChicken();
    if (!chicken) {
        if (distTo(CHICKENS.x, CHICKENS.z) > 6) await walkNear(CHICKENS.x, CHICKENS.z, 3);
        else await sdk.waitForTicks(1);
        return;
    }

    if ((chicken.distance ?? 99) > 7) {
        await walkNear(chicken.x, chicken.z, 4);
    }

    const opt = chicken.optionsWithIndex.find((o) => /attack/i.test(o.text));
    if (!opt) return;
    const r = await sdk.sendInteractNpc(chicken.index, opt.opIndex);
    if (!r.success) {
        log(`Attack chicken: ${r.message}`);
        return;
    }
    try {
        await sdk.waitForCondition((s) => {
            if (s.player?.combat?.inCombat) return true;
            const gone = !s.nearbyNpcs.some((n) => n.index === chicken.index && (n.hp === null || n.hp > 0));
            return gone;
        }, 6_000);
    } catch {
        /* recast next loop */
    }
    await waitForChickenFight();
}

try {
    lastLoggedLevel = rangedLevel();
    log(
        `Range chickens outside Ranging Guild. Ranged ${lastLoggedLevel} (${rangedXp()} xp) ` +
        `@ ${pos().x},${pos().z} arrows=${arrowCount()} bow=${sdk.findEquipmentItem(BOW)?.name ?? 'none'}`
    );
    await bot.dismissBlockingUI();
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (sdk.getState()?.bank?.isOpen) await bot.closeBank();

    await equipGear();
    if (arrowCount() < ARROW_LOW) {
        if (!(await restockArrows())) {
            throw new Error(`Could not buy arrows @ ${pos().x},${pos().z} gp=${coins()}`);
        }
    }
    if (!atChickens()) await walkNear(CHICKENS.x, CHICKENS.z, 3);
    await setRapid();

    while (true) {
        await bot.dismissBlockingUI();

        if (pos().isDead) {
            log('Died — waiting to respawn');
            await sdk.waitForCondition((s) => !s.player.isDead, 60_000).catch(() => {});
            log(`Respawned @ ${pos().x},${pos().z}`);
            await equipGear();
            continue;
        }

        const level = rangedLevel();
        if (level !== lastLoggedLevel) {
            log(`LEVEL UP Ranged ${level} (${rangedXp()} xp) | arrows ${arrowCount()} feathers ${countItems(FEATHER)}`);
            lastLoggedLevel = level;
        }

        await lootGround();
        await equipGear();

        if (arrowCount() < ARROW_LOW) {
            if (!(await restockArrows())) {
                log('Still no arrows — waiting at Hickton');
                await sdk.waitForTicks(20);
                continue;
            }
            await walkNear(CHICKENS.x, CHICKENS.z, 3);
            continue;
        }

        if (!atChickens()) {
            await intent('walk to ranging-guild chickens');
            await walkNear(CHICKENS.x, CHICKENS.z, 3);
            continue;
        }

        await intent(`range chickens ${level} | ${arrowCount()} arrows | ${countItems(FEATHER)} feathers`);
        await shootChicken();
        await lootGround();
    }
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
