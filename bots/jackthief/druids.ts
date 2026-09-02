import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const DUNGEON_LADDER = { x: 3096, z: 9867 };
const WILDY_GATE = { x: 3103, z: 9909 };
/** Southern chaos druids — giant skeletons wander the northern pack around 3104,9948. */
const DRUIDS = { x: 3114, z: 9929 };
const SKELETON_LINE = 9940;

const HERB = /^(herb|guam leaf|marrentill|tarromin|harralander|ranarr weed|toadflax|irit leaf|avantoe|kwuarm|cadantine|lantadyme|dwarf weed|torstol)$/i;
const RUNE = /rune$/i;
const COINS = /^coins$/i;
const LOOT = /^(herb|guam leaf|marrentill|tarromin|harralander|ranarr weed|toadflax|irit leaf|avantoe|kwuarm|cadantine|lantadyme|dwarf weed|torstol|coins|.+ rune)$/i;
const BONES = /^bones$/i;
const FOOD_ORDER = [/^salmon$/i, /^pike$/i, /^trout$/i, /^herring$/i, /^sardine$/i, /^cooked chicken$/i, /^shrimps?$/i];
const FOOD = /^(salmon|pike|trout|herring|sardine|cooked chicken|shrimps?)$/i;
const KEEP = /^(coins|staff of fire|salmon|pike|trout|herring|sardine|cooked chicken|shrimps?)$/i;

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
    for (const pattern of FOOD_ORDER) {
        const item = sdk.findInventoryItem(pattern);
        if (item) return item;
    }
    return sdk.findInventoryItem(FOOD);
}

function hasFireStaff(): boolean {
    return !!(sdk.findInventoryItem(/^staff of fire$/i) || sdk.findEquipmentItem(/^staff of fire$/i));
}

const PROT_MAGIC = 'protect_from_magic' as const;

let lastPrayerToggleTick = -1;
let loggedFlickReady = false;

async function intent(msg: string): Promise<void> {
    await sdk.showIntent(msg).catch(() => {});
}

function prayerReady(): boolean {
    const level = sdk.getSkill('Prayer')?.baseLevel ?? 0;
    const pts = sdk.getPrayerState()?.prayerPoints ?? 0;
    return level >= 37 && pts > 0;
}

async function toggleProtectMagic(): Promise<void> {
    const tick = sdk.getState()?.tick ?? 0;
    if (tick === lastPrayerToggleTick) {
        await sdk.waitForTicks(1);
    }
    await sdk.sendTogglePrayer(PROT_MAGIC);
    lastPrayerToggleTick = sdk.getState()?.tick ?? tick;
}

/** On for exactly one tick, off on the next. Never on+off in the same tick. */
async function flickProtectMagic(): Promise<void> {
    if (!prayerReady()) {
        await prayerOff();
        return;
    }
    if (!loggedFlickReady) {
        log(`Prayer ${sdk.getSkill('Prayer')?.baseLevel} — flicking protect from magic`);
        loggedFlickReady = true;
    }
    if (sdk.isPrayerActive(PROT_MAGIC)) {
        await toggleProtectMagic();
        return;
    }
    await toggleProtectMagic();
    await sdk.waitForTicks(1);
    if (sdk.isPrayerActive(PROT_MAGIC)) await toggleProtectMagic();
}

async function prayerOff(): Promise<void> {
    if (sdk.isPrayerActive(PROT_MAGIC)) await toggleProtectMagic();
}

async function walkNear(x: number, z: number, tolerance = 6): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    log(`walkTo(${x},${z}): ${result.success ? 'ok' : result.message} @ ${pos().x},${pos().z}`);
    return result.success || distTo(x, z) <= tolerance + 2;
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
    if (pos().z >= WILDY_GATE.z) {
        await walkNear(DRUIDS.x, WILDY_GATE.z - 4, 4);
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

async function setAggressive(): Promise<void> {
    const styles = sdk.getState()?.combatStyle?.styles ?? [];
    const agg = styles.find((s) => /aggressive/i.test(s.type) || /aggressive|pound/i.test(s.name));
    if (agg) {
        await sdk.sendSetCombatStyle(agg.index);
        log(`Combat style ${agg.index} ${agg.name} (${agg.type})`);
    } else {
        log(`No aggressive style: ${styles.map((s) => `${s.index}:${s.name}/${s.type}`).join(', ') || 'none'}`);
    }
}

async function prepareLoadout(): Promise<void> {
    await prayerOff();
    await intent('bank salmon');
    if (inDungeon()) await climbToSurface();
    if (!(await openBankAt(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z))) return;

    await depositJunk();
    if (!hasFireStaff()) await bot.withdrawItem(/staff of fire/i, 1).catch(() => {});
    let food = foodCount();
    if (food < 20) {
        await bot.withdrawItem(/^salmon$/i, 20 - food).catch(() => {});
        food = foodCount();
    }
    for (const pattern of FOOD_ORDER.slice(1)) {
        if (food >= 20) break;
        await bot.withdrawItem(pattern, 20 - food).catch(() => {});
        food = foodCount();
    }
    log(`Loadout staff=${hasFireStaff()} food=${foodCount()} (${sdk.getInventory().filter((i) => FOOD.test(i.name)).map((i) => `${i.count} ${i.name}`).join(', ') || 'none'})`);
    await bot.closeBank();

    if (sdk.findInventoryItem(/^staff of fire$/i) && !sdk.findEquipmentItem(/^staff of fire$/i)) {
        await bot.equipItem(/staff of fire/i);
    }
    await setAggressive();
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
    if (p.hp > p.maxHp - 9 && p.hp > p.maxHp * 0.55) return;
    const food = findFood();
    if (!food) return;
    const r = await bot.eatFood(food);
    if (r.success) log(`Ate ${food.name} +${r.hpGained} HP ${pos().hp}/${pos().maxHp} left=${foodCount()}`);
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

async function lootGround(): Promise<void> {
    for (let i = 0; i < 8; i++) {
        await buryBones();
        if (occupiedSlots() >= 28) break;
        const item = (sdk.getGroundItems() ?? [])
            .filter((g) => (LOOT.test(g.name) || BONES.test(g.name)) && g.reachable !== false && (g.distance ?? 99) <= 8)
            .sort((a, b) => {
                const aPri = RUNE.test(a.name) || COINS.test(a.name) || HERB.test(a.name) ? 0 : 1;
                const bPri = RUNE.test(b.name) || COINS.test(b.name) || HERB.test(b.name) ? 0 : 1;
                if (aPri !== bPri) return aPri - bPri;
                return (a.distance ?? 99) - (b.distance ?? 99);
            })[0];
        if (!item) return;
        const r = await bot.pickupItem(item);
        if (!r.success) {
            log(`Pickup ${item.name} failed: ${r.message}`);
            return;
        }
    }
}

function findDruid() {
    const druids = (sdk.getNearbyNpcs() ?? [])
        .filter((n) =>
            /^chaos druid$/i.test(n.name) &&
            (n.hp === null || n.hp > 0) &&
            n.z < SKELETON_LINE &&
            (n.reachable !== false)
        )
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
    const free = druids.filter((d) => !d.inCombat);
    return free[0] ?? druids[0] ?? null;
}

async function bashDruid(): Promise<void> {
    if (pos().inCombat && pos().targetType === 'npc') {
        const until = Date.now() + 25_000;
        while (pos().inCombat && !pos().isDead && Date.now() < until) {
            await flickProtectMagic();
            await prayerOff();
            await eatIfNeeded();
        }
        await prayerOff();
        return;
    }

    const target = findDruid();
    if (!target) {
        if (distTo(DRUIDS.x, DRUIDS.z) > 8) await walkNear(DRUIDS.x, DRUIDS.z, 5);
        else await sdk.waitForTicks(1);
        return;
    }
    const r = await bot.attack(target, 8_000);
    if (!r.success) log(`Attack ${target.name}: ${r.reason} ${r.message}`);
}

try {
    console.log(`Staff-bash chaos druids (aggressive). Str ${sdk.getSkill('Strength')?.baseLevel} @ ${pos().x},${pos().z}`);
    await bot.dismissBlockingUI();
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (sdk.getState()?.bank?.isOpen) await bot.closeBank();

    if (!(inDungeon() && hasFireStaff() && foodCount() > 0)) {
        await prepareLoadout();
        await goToDruids();
    }
    await setAggressive();

    let lastStr = sdk.getSkill('Strength')?.baseLevel ?? 1;
    while (true) {
        await bot.dismissBlockingUI();
        if (pos().isDead) {
            await prayerOff();
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

        const str = sdk.getSkill('Strength')?.baseLevel ?? 1;
        if (str !== lastStr) {
            log(`LEVEL UP Strength ${str} | food ${foodCount()} herbs ${herbSlots()}`);
            lastStr = str;
        }

        await eatIfNeeded();
        if (await fleeSkeletons()) continue;

        if (foodCount() === 0 || occupiedSlots() >= 28) {
            log(`Banking food=${foodCount()} herbs=${herbSlots()} slots=${occupiedSlots()}`);
            await prepareLoadout();
            await goToDruids();
            continue;
        }

        await lootGround();
        await intent(`bash Str${str} food ${foodCount()} herbs ${herbSlots()}`);
        await bashDruid();
    }
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
