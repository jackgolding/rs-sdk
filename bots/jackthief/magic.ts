import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { Spells } from '../../sdk/spells';
import { readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

const TARGET_MAGIC = 60;
const VARROCK_WEST_BANK = { x: 3185, z: 3436 };
const ZAFF = { x: 3203, z: 3433 };
const AUBURY = { x: 3253, z: 3402 };
// Fred the Farmer / Sheep Shearer coop, west of the river (quieter than the east farm)
const CHICKENS = { x: 3185, z: 3277 };
const STAFF_COST = 1500;
const AIR_PRICE = 4;
const MIND_PRICE = 3;

const TO_VARROCK_WEST = [
    { x: 3222, z: 3225 },
    { x: 3218, z: 3275 },
    { x: 3214, z: 3355 },
    { x: 3185, z: 3436 },
];

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

function pos() {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, hp: p?.hp ?? 10, maxHp: p?.maxHp ?? 10, isDead: p?.isDead ?? false };
}

function distTo(x: number, z: number): number {
    const p = pos();
    return Math.hypot(p.x - x, p.z - z);
}

function countItems(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + i.count, 0);
}

function coins(): number {
    return sdk.findInventoryItem(/coins/i)?.count ?? 0;
}

function mindRunes(): number {
    return countItems(/^mind rune$/i);
}

function airRunes(): number {
    return countItems(/^air rune$/i);
}

function hasFireStaff(): boolean {
    return !!(sdk.findInventoryItem(/^staff of fire$/i) || sdk.findEquipmentItem(/^staff of fire$/i));
}

function magicLevel(): number {
    return sdk.getSkill('Magic')?.baseLevel ?? 1;
}

function canCast(): boolean {
    return mindRunes() >= 1 && airRunes() >= 1;
}

async function intent(msg: string): Promise<void> {
    await sdk.showIntent(msg).catch(() => {});
}

async function walkNear(x: number, z: number, tolerance = 6): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    log(`walkTo(${x},${z}): ${result.success ? 'ok' : result.message} @ ${pos().x},${pos().z}`);
    return result.success || distTo(x, z) <= tolerance + 2;
}

async function follow(waypoints: { x: number; z: number }[], destTolerance = 8): Promise<void> {
    const dest = waypoints[waypoints.length - 1];
    for (const wp of waypoints) {
        if (pos().isDead) return;
        if (distTo(wp.x, wp.z) <= destTolerance) continue;
        if (dest && distTo(dest.x, dest.z) + 8 < Math.hypot(wp.x - dest.x, wp.z - dest.z)) continue;
        log(`Walking to ${wp.x},${wp.z} (now ${pos().x},${pos().z})`);
        await intent(`walk ${wp.x},${wp.z}`);
        const ok = await walkNear(wp.x, wp.z, destTolerance);
        if (!ok) log(`Walk stalled at ${pos().x},${pos().z} heading ${wp.x},${wp.z}`);
    }
}

async function openShopByName(pattern: RegExp): Promise<boolean> {
    let opened = await bot.openShop(pattern);
    if (!sdk.getState()?.shop?.isOpen) {
        const npc = sdk.findNearbyNpc(pattern);
        if (npc) opened = await bot.openShop(npc);
    }
    return opened.success || !!sdk.getState()?.shop?.isOpen;
}

async function withdrawCoins(): Promise<void> {
    if (hasFireStaff() && canCast()) return;
    if (coins() >= 50 && (hasFireStaff() || coins() >= STAFF_COST)) return;

    log('Withdrawing coins at Varrock west');
    await intent('varrock bank');
    if (distTo(VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z) > 12) {
        if (pos().z < 3380) await follow(TO_VARROCK_WEST, 10);
        await walkNear(VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z, 4);
    }
    const opened = await bot.openBank();
    if (!opened.success) {
        log(`openBank failed: ${opened.message}`);
        return;
    }
    await bot.withdrawItem(/coins/i, -1).catch(() => {});
    if (!hasFireStaff()) {
        await bot.withdrawItem(/staff of fire/i, 1).catch(() => {});
    }
    const shield = sdk.findInventoryItem(/bronze sq shield/i);
    if (shield) await bot.depositItem(shield, -1);
    await bot.closeBank();
    log(`Coins now ${coins()} fire staff=${hasFireStaff()}`);
}

async function buyFireStaff(): Promise<void> {
    if (hasFireStaff()) {
        if (sdk.findInventoryItem(/^staff of fire$/i) && !sdk.findEquipmentItem(/^staff of fire$/i)) {
            await bot.equipItem(/staff of fire/i);
        }
        return;
    }
    if (coins() < STAFF_COST) {
        log(`Need ${STAFF_COST} gp for staff of fire, have ${coins()}`);
        return;
    }

    log('Buying staff of fire from Zaff');
    await intent('buy fire staff');
    await walkNear(ZAFF.x, ZAFF.z, 3);
    if (!(await openShopByName(/zaff/i))) {
        log('Zaff shop not open');
        return;
    }
    const bought = await bot.buyFromShop(/^staff of fire$/i, 1);
    log(`Staff buy: ${bought.success || bought.partial} ${bought.message ?? ''}`);
    await bot.closeShop();
    if (sdk.findInventoryItem(/^staff of fire$/i)) {
        await bot.equipItem(/staff of fire/i);
    }
}

async function buyRunes(): Promise<void> {
    if (canCast() && (mindRunes() >= 80 && airRunes() >= 80)) return;
    if (coins() < AIR_PRICE + MIND_PRICE) {
        log('Not enough gp for runes');
        return;
    }

    const budget = Math.floor(coins() / 2);
    const airSpend = Math.floor((budget * 2) / 3);
    const mindSpend = budget - airSpend;
    const airWant = Math.min(2000, Math.floor(airSpend / AIR_PRICE));
    const mindWant = Math.min(1000, Math.floor(mindSpend / MIND_PRICE));

    log(`Buying runes at Aubury: ${airWant} air / ${mindWant} mind from ${budget} gp (half of ${coins()})`);
    await intent('buy runes');
    await walkNear(AUBURY.x, AUBURY.z, 3);
    if (!(await openShopByName(/aubury/i))) {
        log('Aubury shop not open');
        return;
    }
    if (airWant > 0) {
        const bought = await bot.buyFromShop(/^air rune$/i, airWant);
        console.log(`Bought air: ${bought.success || bought.partial} ${bought.message ?? ''}`);
    }
    if (mindWant > 0) {
        const bought = await bot.buyFromShop(/^mind rune$/i, mindWant);
        console.log(`Bought mind: ${bought.success || bought.partial} ${bought.message ?? ''}`);
    }
    await bot.closeShop();
    log(`Runes now air ${airRunes()} mind ${mindRunes()} gp ${coins()} staff=${hasFireStaff()}`);
}

async function buryBones(): Promise<void> {
    const bones = sdk.findInventoryItem(/^bones$/i);
    if (!bones) return;
    const buryOpt = bones.optionsWithIndex.find((o) => /bury/i.test(o.text));
    if (!buryOpt) return;
    await sdk.sendUseItem(bones.slot, buryOpt.opIndex);
    await sdk.waitForTicks(1);
}

async function loot(pattern: RegExp): Promise<void> {
    if (sdk.getInventory().length >= 27) return;
    const item = sdk.findGroundItem(pattern);
    if (!item) return;
    await bot.pickupItem(item);
}

async function castWindStrike(): Promise<void> {
    const chickens = (sdk.getNearbyNpcs() ?? [])
        .filter((n) => /^chicken$/i.test(n.name) && !n.inCombat)
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
    let target = chickens[0] ?? sdk.findNearbyNpc(/^chicken$/i);
    if (!target) {
        if (distTo(CHICKENS.x, CHICKENS.z) > 8) {
            await walkNear(CHICKENS.x, CHICKENS.z, 4);
        }
        await sdk.waitForTicks(2);
        return;
    }

    const before = sdk.getSkill('Magic')?.experience ?? 0;
    const result = await bot.castSpell(target, Spells.WIND_STRIKE);
    const skill = sdk.getSkill('Magic');
    console.log(
        `${result.success ? (result.hit ? 'hit' : 'splash') : result.reason} ${target.name} | Magic ${skill?.baseLevel} (${skill?.experience} xp) | air ${airRunes()} mind ${mindRunes()} | feathers ${countItems(/feather/i)} | HP ${pos().hp}`
    );
    if (!result.success && before === (skill?.experience ?? 0)) {
        await sdk.waitForTicks(1);
    }
}

try {
    let lastLevel = magicLevel();
    console.log(`Goal: Magic ${TARGET_MAGIC}. Starting at ${lastLevel} @ ${pos().x},${pos().z}`);
    await bot.dismissBlockingUI();

    await withdrawCoins();
    await buyFireStaff();
    await buyRunes();

    if (sdk.findInventoryItem(/^staff of fire$/i) && !sdk.findEquipmentItem(/^staff of fire$/i)) {
        await bot.equipItem(/staff of fire/i);
    }

    while (magicLevel() < TARGET_MAGIC) {
        await bot.dismissBlockingUI();
        if (pos().isDead) {
            console.log('Died — waiting to respawn');
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }

        const level = magicLevel();
        if (level !== lastLevel) {
            log(`LEVEL UP Magic ${level} | air ${airRunes()} mind ${mindRunes()} | feathers ${countItems(/feather/i)} | ${coins()} gp`);
            lastLevel = level;
        }

        await loot(/^feather$/i);
        await loot(/^bones$/i);
        await buryBones();

        if (!canCast()) {
            await withdrawCoins();
            await buyFireStaff();
            await buyRunes();
            if (!canCast()) {
                log('Out of runes and could not restock — stopping');
                break;
            }
            continue;
        }

        if (distTo(CHICKENS.x, CHICKENS.z) > 12) {
            log(`Walking to Fred's chickens (${CHICKENS.x},${CHICKENS.z}) from ${pos().x},${pos().z}`);
            await walkNear(CHICKENS.x, CHICKENS.z, 5);
            continue;
        }

        await intent(`mage ${magicLevel()} air ${airRunes()} mind ${mindRunes()}`);
        await castWindStrike();
    }

    const done = sdk.getSkill('Magic');
    console.log(`Finished: Magic ${done?.baseLevel} (${done?.experience} xp) | air ${airRunes()} mind ${mindRunes()} | feathers ${countItems(/feather/i)}`);
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
