import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

const TARGET_FISHING = 40;
const TARGET_COMBAT = 15;
const DRAYNOR_BANK = { x: 3092, z: 3243 };
const DRAYNOR_NET = { x: 3087, z: 3230 };
const WIZARD_Z = 3232;
const GERRANT = { x: 3013, z: 3225 };
// Open farm west of Lumbridge — easier than the packed backyard coop.
const CHICKENS = { x: 3185, z: 3277 };
const KEEP = /^(coins|small fishing net|cake|2\/3 cake|chocolate slice|bread|feather)$/i;
const RAW_FISH = /^raw (shrimps?|anchovies)$/i;

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

let lastLoggedFishing = 0;
let lastLoggedCombat = 0;
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
        hp: p?.hp ?? 10,
        maxHp: p?.maxHp ?? 10,
        isDead: p?.isDead ?? false,
        inCombat: p?.combat?.inCombat ?? false,
        combatLevel: p?.combatLevel ?? 1
    };
}

function distTo(x: number, z: number): number {
    const p = pos();
    return Math.hypot(p.x - x, p.z - z);
}

function fishingLevel(): number {
    return sdk.getSkill('Fishing')?.baseLevel ?? 1;
}

function combatLevel(): number {
    return pos().combatLevel;
}

function hasNet(): boolean {
    return !!sdk.findInventoryItem(/small fishing net/i);
}

function coinCount(): number {
    return sdk.findInventoryItem(/coins/i)?.count ?? 0;
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function dumpItems() {
    return sdk.getInventory().filter((i) => !KEEP.test(i.name));
}

async function walkNear(x: number, z: number, tolerance = 6): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    return result.success || distTo(x, z) <= tolerance + 2;
}

async function eatIfNeeded(): Promise<void> {
    const { hp, maxHp } = pos();
    if (hp >= maxHp) return;
    const eatBelow = Math.min(maxHp - 1, Math.max(7, Math.floor(maxHp * 0.65)));
    if (hp > eatBelow) return;
    const food = sdk.findInventoryItem(/cake|chocolate|slice|bread|shrimp|anchov/i);
    if (!food) return;
    console.log(`Eating ${food.name} at ${hp} hp`);
    await bot.eatFood(food);
}

async function openNearbyGate(): Promise<void> {
    const gate = (sdk.getNearbyLocs() ?? []).find(
        (l) => /gate|door/i.test(l.name) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)) && (l.distance ?? 99) <= 4
    );
    if (gate) await bot.openDoor(gate);
}

async function openDraynorBank(): Promise<boolean> {
    await walkNear(DRAYNOR_BANK.x, DRAYNOR_BANK.z, 5);
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (sdk.getState()?.bank?.isOpen) return true;
    const opened = await bot.openBank();
    if (!opened.success) {
        console.log(`openBank failed: ${opened.message}`);
        return false;
    }
    return true;
}

async function bankCatch(): Promise<void> {
    const dump = dumpItems();
    if (dump.length === 0 && hasNet()) return;
    intent('Banking catch at Draynor');
    if (!(await openDraynorBank())) return;
    for (const item of [...sdk.getInventory()]) {
        if (KEEP.test(item.name)) continue;
        const r = await bot.depositItem(item, -1);
        log(`Banked ${item.name}: ${r.success ? 'ok' : r.message}`);
    }
    if (!hasNet()) await bot.withdrawItem(/small fishing net/i, 1).catch(() => {});
    if (coinCount() === 0) await bot.withdrawItem(/^coins$/i, 50).catch(() => {});
    await bot.closeBank();
}

async function buyNet(): Promise<void> {
    if (hasNet()) return;
    if (coinCount() < 5) {
        if (!(await openDraynorBank())) return;
        if (!hasNet()) await bot.withdrawItem(/small fishing net/i, 1).catch(() => {});
        if (coinCount() === 0) await bot.withdrawItem(/^coins$/i, 50).catch(() => {});
        await bot.closeBank();
        if (hasNet()) return;
    }
    if (coinCount() < 5) {
        console.log('No net and not enough coins to buy one');
        return;
    }
    intent('Buying a small fishing net from Gerrant');
    await walkNear(GERRANT.x, GERRANT.z, 4);
    const gerrant = sdk.findNearbyNpc(/^gerrant$/i) ?? sdk.findNearbyNpc(/gerrant/i);
    if (!gerrant) {
        console.log('Gerrant not found');
        return;
    }
    await bot.openShop(gerrant);
    await bot.buyFromShop(/small fishing net/i, 1);
    await bot.closeShop();
}

function netSpot() {
    const spots = (sdk.getNearbyNpcs() ?? []).filter(
        (n) =>
            /fishing\s*spot/i.test(n.name) &&
            n.optionsWithIndex.some((o) => /^net$/i.test(o.text)) &&
            (combatLevel() >= TARGET_COMBAT || (n.tileZ ?? n.z) <= WIZARD_Z + 1)
    );
    return (
        spots
            .filter((n) => n.reachable !== false)
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ??
        spots[0] ??
        null
    );
}

async function ensurePunch(): Promise<void> {
    const cs = sdk.getState()?.combatStyle;
    if (!cs) return;
    const punch =
        cs.styles.find((s) => /^punch$/i.test(s.name)) ??
        cs.styles.find((s) => s.type === 'Accurate' && s.trainsSkills.includes('Attack'));
    if (!punch || cs.currentStyle === punch.index) return;
    await sdk.sendSetCombatStyle(punch.index);
}

function findChicken() {
    const hens = (sdk.getNearbyNpcs() ?? []).filter(
        (n) =>
            /^chicken$/i.test(n.name) &&
            n.optionsWithIndex.some((o) => /^attack$/i.test(o.text)) &&
            !n.inCombat
    );
    return (
        hens
            .filter((n) => n.reachable !== false)
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ??
        hens[0] ??
        null
    );
}

async function buryBones(): Promise<void> {
    for (let i = 0; i < 12; i++) {
        const bones = sdk.findInventoryItem(/^bones$/i);
        if (!bones) break;
        const bury = bones.optionsWithIndex.find((o) => /bury/i.test(o.text));
        if (!bury) break;
        const slot = bones.slot;
        await sdk.sendUseItem(slot, bury.opIndex);
        await sdk.waitForCondition(
            (s) => !s.inventory.some((it) => it.slot === slot && /^bones$/i.test(it.name)),
            3_000
        ).catch(() => {});
    }
}

async function lootFeathersAndBones(): Promise<void> {
    await buryBones();
    for (let i = 0; i < 20; i++) {
        const items = sdk.getGroundItems() ?? [];
        const nearby = items
            .filter((g) => (g.distance ?? 99) <= 12 && g.reachable !== false)
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
        const feathers = nearby.find((g) => /feather/i.test(g.name));
        const bones = nearby.find((g) => /^bones$/i.test(g.name));
        const item = feathers ?? bones;
        if (!item) break;
        if (occupiedSlots() >= 27 && !sdk.findInventoryItem(new RegExp(`^${item.name}$`, 'i'))) {
            await buryBones();
            if (occupiedSlots() >= 27) break;
        }
        const r = await bot.pickupItem(item);
        if (!r.success) break;
        if (/^bones$/i.test(item.name)) await buryBones();
    }
    await buryBones();
}

async function punchChickens(): Promise<void> {
    await bot.dismissBlockingUI();
    await eatIfNeeded();

    if (pos().isDead) {
        intent('Dead — waiting to respawn');
        await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
        return;
    }

    await ensurePunch();
    await lootFeathersAndBones();

    if (pos().inCombat) {
        intent(`Punching — combat ${combatLevel()} (goal ${TARGET_COMBAT})`);
        await sdk.waitForTicks(3);
        await eatIfNeeded();
        await lootFeathersAndBones();
        return;
    }

    if (distTo(CHICKENS.x, CHICKENS.z) > 12) {
        intent('Walking to the west Lumbridge chicken farm');
        await walkNear(CHICKENS.x, CHICKENS.z, 5);
        await openNearbyGate();
        return;
    }

    await openNearbyGate();
    const hen = findChicken();
    if (!hen) {
        intent('No chicken — looting the farm');
        await lootFeathersAndBones();
        await walkNear(CHICKENS.x, CHICKENS.z, 4);
        await sdk.waitForTicks(2);
        return;
    }

    intent(`Punching ${hen.name} (combat ${combatLevel()})`);
    const result = await bot.attack(hen, 6_000);
    if (!result.success) console.log(`attack: ${result.message}`);
    await sdk.waitForTicks(2);
}

async function fishOnce(): Promise<void> {
    await bot.dismissBlockingUI();
    await eatIfNeeded();

    if (pos().isDead) {
        intent('Dead — waiting to respawn');
        await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
        return;
    }

    if (combatLevel() < TARGET_COMBAT && (pos().inCombat || pos().z > WIZARD_Z)) {
        intent('Dark wizards — staying south');
        await sdk.sendWalk(DRAYNOR_NET.x, DRAYNOR_NET.z, true);
        await sdk.waitForTicks(4);
        return;
    }

    if (!hasNet()) {
        await bankCatch();
        if (!hasNet()) await buyNet();
        if (!hasNet()) {
            await sdk.waitForTicks(5);
            return;
        }
    }

    if (dumpItems().length > 0 && occupiedSlots() >= 26) {
        await bankCatch();
        return;
    }

    if (distTo(DRAYNOR_NET.x, DRAYNOR_NET.z) > 12) {
        intent('Walking to Draynor net spots');
        await walkNear(DRAYNOR_NET.x, DRAYNOR_NET.z, 4);
        return;
    }

    const spot = netSpot();
    if (!spot) {
        intent('No net spot — waiting at the beach');
        await walkNear(DRAYNOR_NET.x, DRAYNOR_NET.z, 3);
        await sdk.waitForTicks(3);
        return;
    }

    const net = spot.optionsWithIndex.find((o) => /^net$/i.test(o.text));
    intent(`Netting ${spot.name} (${fishingLevel()} fishing)`);
    if (net) await sdk.sendInteractNpc(spot.index, net.opIndex);
    else await bot.interactNpc(spot, /net/i);
    await sdk.waitForTicks(2);
}

try {
    lastLoggedFishing = fishingLevel();
    lastLoggedCombat = combatLevel();
    console.log(`Goal: Combat ${TARGET_COMBAT} on chickens, then Fishing ${TARGET_FISHING} at Draynor`);
    await bot.skipTutorial();
    await bankCatch();
    if (!hasNet()) await buyNet();
    lastLoggedFishing = fishingLevel();
    lastLoggedCombat = combatLevel();
    log(`Start — combat ${lastLoggedCombat} fishing ${lastLoggedFishing} net=${hasNet()} gp=${coinCount()} @ ${pos().x},${pos().z}`);

    while (fishingLevel() < TARGET_FISHING) {
        const fish = fishingLevel();
        const cmb = combatLevel();
        if (fish !== lastLoggedFishing) {
            log(`LEVEL UP Fishing ${fish} | ${sdk.getSkill('Fishing')?.experience} xp`);
            lastLoggedFishing = fish;
        }
        if (cmb !== lastLoggedCombat) {
            log(`Combat ${cmb} | Atk ${sdk.getSkill('Attack')?.baseLevel} Str ${sdk.getSkill('Strength')?.baseLevel} HP ${sdk.getSkill('Hitpoints')?.baseLevel}`);
            lastLoggedCombat = cmb;
        }

        if (cmb < TARGET_COMBAT) await punchChickens();
        else await fishOnce();
    }

    await bankCatch();
    const done = sdk.getSkill('Fishing');
    console.log(`Finished: Fishing ${done?.baseLevel} (${done?.experience} xp) combat ${combatLevel()}`);
    log(`Finished fishing ${done?.baseLevel} combat ${combatLevel()}`);
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
