import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

const PARTNER = 'Jackthief';
/** Jackpoo1 is woodcutting — Ardougne food run is the four thieves. */
const MULES = ['Jackpoo2', 'Jackpoo3', 'Jackpoo4', 'Jackpoo5'];
const BANK = { x: 2808, z: 3443 };
const HARRY = { x: 2834, z: 3445 };
const HOUSE_OUTSIDE = { x: 2669, z: 3311 };
const ARDOUGNE_BANK = { x: 2655, z: 3283 };
const ARDOUGNE_MARKET = { x: 2662, z: 3312 };
const KNIGHTS = { x: 2652, z: 3318 };
const PALADINS = { x: 2653, z: 3315 };
const HEROES = { x: 2630, z: 3288 };
const ARDY_HUNT = [ARDOUGNE_BANK, HEROES, KNIGHTS, PALADINS, ARDOUGNE_MARKET, HOUSE_OUTSIDE];
/** Cage/Harpoon spots hop along these tiles. West is often Net/Harpoon (sharks) — hunt east first. */
const PIER = [
    { x: 2854, z: 3423 },
    { x: 2860, z: 3426 },
    { x: 2845, z: 3429 },
    { x: 2837, z: 3431 },
];
const NET_PIER = [
    { x: 2837, z: 3431 },
    { x: 2845, z: 3429 },
    { x: 2854, z: 3423 },
];
/** RS2 minimap is ~25 tiles; scanGroundItems default is only 15. */
const MINIMAP_RADIUS = 25;
/** South of the range house — door faces the beach path. */
const RANGE_OUTSIDE = { x: 2816, z: 3439 };
const RANGE_STAND = { x: 2816, z: 3442 };
const COIN_WITHDRAW = 100;
const LOADS_BEFORE_MULE = 4;
const ARDY_TO_CATHERBY = [
    { x: 2662, z: 3336 },
    { x: 2662, z: 3375 },
    { x: 2695, z: 3375 },
    { x: 2726, z: 3485 },
    { x: 2758, z: 3477 },
    { x: 2788, z: 3460 },
    { x: 2808, z: 3443 }
];
const CATHERBY_TO_ARDY = [
    { x: 2808, z: 3443 },
    { x: 2788, z: 3460 },
    { x: 2758, z: 3477 },
    { x: 2726, z: 3485 },
    { x: 2695, z: 3375 },
    { x: 2662, z: 3375 },
    { x: 2662, z: 3336 },
    { x: 2662, z: 3312 }
];

const KEEP = /^(lobster pot|coins)$/i;
const RAW_SMALL = /^raw (shrimps?|anchovies)$/i;
const RAW = /^raw (lobster|tuna|swordfish|shark|shrimps?|anchovies)$/i;
const COOKED = /^(lobster|tuna|swordfish|shark|shrimps?|anchovies)$/i;
const NOTE_FISH = /^(raw )?(lobster|tuna|swordfish|shark)$/i;
const BURNT = /^burnt (lobster|fish|swordfish|tuna|shark|shrimp)/i;
const FISH_ANY = /^(raw )?(lobster|tuna|swordfish|shark|shrimps?|anchovies)$|^burnt /i;
const RAW_SHARK = /^raw shark$/i;

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

function fmtSec(ms: number): string {
    return `${(ms / 1000).toFixed(1)}s`;
}

function rate(count: number, ms: number): string {
    if (ms <= 0) return 'n/a';
    return `${((count * 60_000) / ms).toFixed(1)}/min`;
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

let lastIntent = '';
let bankTrips = 0;

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
        isDead: p?.isDead ?? false,
    };
}

function distTo(x: number, z: number): number {
    const p = pos();
    return Math.hypot(p.x - x, p.z - z);
}

function inCatherby(): boolean {
    const p = pos();
    return p.x >= 2788 && p.x <= 2860 && p.z >= 3420 && p.z <= 3460 && p.z < 6400;
}

function inArdougne(): boolean {
    const p = pos();
    return p.x > 2500 && p.x < 2720 && p.z > 3240 && p.z < 3355 && p.z < 6400;
}

function inHouse(): boolean {
    const p = pos();
    return p.x >= 2673 && p.x <= 2676 && p.z >= 3307 && p.z <= 3311;
}

function inKeepLeFaye(): boolean {
    const p = pos();
    return p.x >= 2746 && p.x <= 2772 && p.z >= 3390 && p.z <= 3422 && p.z < 6400;
}

function inLegendsGuild(): boolean {
    const p = pos();
    return p.x >= 2714 && p.x <= 2742 && p.z >= 3344 && p.z <= 3388 && p.z < 6400;
}

function countItems(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + i.count, 0);
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function inventoryIsFull(): boolean {
    return occupiedSlots() >= 28;
}

function coins(): number {
    return sdk.findInventoryItem(/^coins$/i)?.count ?? 0;
}

function hasPot(): boolean {
    return !!sdk.findInventoryItem(/^lobster pot$/i);
}

function hasNet(): boolean {
    return !!sdk.findInventoryItem(/small fishing net/i);
}

function fishingLevel(): number {
    return sdk.getSkill('Fishing')?.baseLevel ?? 1;
}

function cookingLevel(): number {
    return sdk.getSkill('Cooking')?.baseLevel ?? 1;
}

function fishingXp(): number {
    return sdk.getSkill('Fishing')?.experience ?? 0;
}

function cookingXp(): number {
    return sdk.getSkill('Cooking')?.experience ?? 0;
}

function shouldNet(): boolean {
    return cookingLevel() < 30;
}

function cookLevelFor(name: string): number {
    const n = name.toLowerCase();
    if (/shrimps?/.test(n)) return 1;
    if (/anchov/.test(n)) return 15;
    if (/lobster/.test(n)) return 40;
    if (/tuna/.test(n)) return 30;
    if (/swordfish/.test(n)) return 45;
    if (/shark/.test(n)) return 80;
    return 99;
}

function canCookItem(name: string): boolean {
    return cookingLevel() >= cookLevelFor(name);
}

function cookableRaw() {
    return sdk.getInventory().find((i) => RAW.test(i.name) && canCookItem(i.name)) ?? null;
}

function invSummary(pattern: RegExp = /./): string {
    const parts = sdk.getInventory()
        .filter((i) => pattern.test(i.name) && (i.count ?? 0) > 0)
        .map((i) => `${i.count} ${i.name}`);
    return parts.join(', ') || 'empty';
}

async function walkNear(x: number, z: number, tolerance = 6): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    const started = Date.now();
    const from = pos();
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    const ok = result.success || distTo(x, z) <= tolerance + 2;
    log(`walk ${from.x},${from.z} -> ${x},${z} ${fmtSec(Date.now() - started)} ${ok ? 'ok' : result.message} now ${pos().x},${pos().z} (${Math.round(distTo(x, z))}t)`);
    return ok;
}

async function openBankAt(x: number, z: number): Promise<boolean> {
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (sdk.getState()?.interface?.isOpen && !sdk.getState()?.bank?.isOpen) await bot.closeInterface();
    await walkNear(x, z, 4);
    if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
    const opened = await bot.openBank();
    if (!opened.success && !sdk.getState()?.bank?.isOpen) {
        log(`openBank failed: ${opened.message}`);
        return false;
    }
    return !!sdk.getState()?.bank?.isOpen;
}

async function depositJunk(): Promise<void> {
    for (let i = 0; i < 40; i++) {
        const item = sdk.getInventory().find((it) => !KEEP.test(it.name));
        if (!item) break;
        const r = await bot.depositItem(
            new RegExp(`^${item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
            -1
        );
        if (!r.success && !r.partial) {
            log(`Deposit ${item.name} failed: ${r.message}`);
            break;
        }
    }
}

async function leaveHouse(): Promise<void> {
    if (!inHouse() && pos().x !== 2672) return;
    intent('Leaving the Ardougne house');
    const door = sdk.findNearbyLoc(/door/i, { withOption: /open/i });
    if (door) await bot.openDoor(door);
    await sdk.sendWalk(HOUSE_OUTSIDE.x, HOUSE_OUTSIDE.z, true);
    await sdk.waitForTicks(4);
    if (inHouse()) await walkNear(HOUSE_OUTSIDE.x, HOUSE_OUTSIDE.z, 1);
}

async function dismissLegendsGuard(): Promise<void> {
    for (let i = 0; i < 12; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) return;
        const opts = dialog.options ?? [];
        const pick =
            opts.find((o) => /ok thanks|it's ok thanks|some other time|no thanks/i.test(o.text)) ||
            opts.find((o) => /click here to continue/i.test(o.text));
        await sdk.sendClickDialog(pick?.index ?? 0);
        await sdk.waitForTicks(1);
    }
}

async function leaveLegendsGuild(): Promise<void> {
    if (!inLegendsGuild() && !sdk.getDialog()?.isOpen) return;
    intent('Leaving the Legends Guild — going around, not in');
    await dismissLegendsGuard();
    await sdk.sendWalk(2695, 3375, true);
    await sdk.waitForTicks(8);
    await dismissLegendsGuard();
}

async function leaveKeepLeFaye(): Promise<void> {
    if (!inKeepLeFaye()) return;
    intent('Leaving Keep Le Faye');
    const door = sdk.findNearbyLoc(/door|gate/i, { withOption: /open/i });
    if (door) await bot.openDoor(door);
    await sdk.sendWalk(2726, 3485, true);
    await sdk.waitForTicks(8);
}

async function walkWaypoints(wps: { x: number; z: number }[]): Promise<void> {
    await leaveHouse();
    await leaveLegendsGuild();
    await leaveKeepLeFaye();
    const dest = wps[wps.length - 1]!;
    for (const wp of wps) {
        if (inLegendsGuild()) await leaveLegendsGuild();
        if (inKeepLeFaye()) await leaveKeepLeFaye();
        if (distTo(dest.x, dest.z) <= 8) return;
        const remaining = distTo(dest.x, dest.z);
        const via = Math.hypot(wp.x - dest.x, wp.z - dest.z);
        if (via >= remaining - 6) continue;
        await walkNear(wp.x, wp.z, 8);
    }
    if (distTo(dest.x, dest.z) > 6) await walkNear(dest.x, dest.z, 6);
}

async function walkToCatherby(): Promise<void> {
    if (inCatherby()) return;
    await leaveHouse();
    intent('Walking Ardougne → Catherby');
    await walkWaypoints(ARDY_TO_CATHERBY);
}

async function walkToArdougne(): Promise<void> {
    if (inArdougne()) return;
    await leaveKeepLeFaye();
    await leaveLegendsGuild();
    intent('Walking Catherby → Ardougne');
    await walkWaypoints(CATHERBY_TO_ARDY);
    if (distTo(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z) > 12) {
        await walkNear(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 6);
    }
}

async function buyTools(): Promise<boolean> {
    if (hasPot()) return true;
    if (occupiedSlots() >= 26) {
        if (await openBankAt(BANK.x, BANK.z)) {
            await depositJunk();
            await bot.closeBank();
        }
    }
    if (coins() < 20) {
        log(`Need gp for a lobster pot, have ${coins()}`);
        return false;
    }
    const started = Date.now();
    intent("Buying a lobster pot from Harry's");
    for (let attempt = 0; attempt < 8 && !hasPot(); attempt++) {
        await walkNear(HARRY.x, HARRY.z, 3);
        const opened = await bot.openShop(/harry/i);
        if (!opened.success && !sdk.getState()?.shop?.isOpen) {
            log(`Harry shop failed: ${opened.message}`);
            await sdk.waitForTicks(4);
            continue;
        }
        const bought = await bot.buyFromShop(/^lobster pot$/i, 1);
        log(`Buy lobster pot: ${bought.success || bought.partial} ${bought.message ?? ''}`);
        if (hasPot()) break;
        await bot.closeShop();
        log('Harry out of lobster pots — waiting');
        await sdk.waitForTicks(8);
    }
    log(`Harry shop ${fmtSec(Date.now() - started)} pot=${hasPot()}`);
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    return hasPot();
}

async function setupBankAndTools(): Promise<boolean> {
    const started = Date.now();
    intent('catherby bank');
    if (!(await openBankAt(BANK.x, BANK.z))) return false;

    await depositJunk();
    if (!sdk.getState()?.bank?.isOpen) {
        if (!(await openBankAt(BANK.x, BANK.z))) return false;
        await depositJunk();
    }
    if (!hasPot()) await bot.withdrawItem(/^lobster pot$/i, 1).catch(() => {});
    if (!hasPot() && coins() < 20) {
        const r = await bot.withdrawItem(/^coins$/i, COIN_WITHDRAW);
        log(`Withdraw coins: ${r.success || r.partial} got ${r.amountWithdrawn ?? '?'} now ${coins()}gp`);
    }
    await bot.closeBank();
    log(`Bank setup ${fmtSec(Date.now() - started)} pot=${hasPot()} gp=${coins()} inv=${invSummary()}`);

    if (!hasPot()) {
        if (!(await buyTools())) return false;
        if (coins() > 20 && (await openBankAt(BANK.x, BANK.z))) {
            await bot.depositItem(/^coins$/i, -1).catch(() => {});
            await bot.closeBank();
        }
    }
    return hasPot();
}

function spotHas(spot: { optionsWithIndex: { text: string }[] }, option: RegExp): boolean {
    return spot.optionsWithIndex.some((o) => option.test(o.text));
}

function pierNear(x: number, z: number): { x: number; z: number } {
    return [...PIER].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0]!;
}

/** Cage+Harpoon = tuna/swordfish. Net+Harpoon = sharks — never click those. */
function findTunaSwordSpot() {
    const spots = (sdk.getNearbyNpcs() ?? []).filter((n) => /fishing spot/i.test(n.name));
    const tuna = spots.filter((s) => spotHas(s, /^harpoon$/i) && spotHas(s, /^cage$/i));
    return tuna.sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null;
}

function findNetSpot() {
    const spots = (sdk.getNearbyNpcs() ?? []).filter((n) => /fishing spot/i.test(n.name));
    const net = spots.filter((s) => spotHas(s, /^net$/i));
    return net.sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null;
}

let pierHunt = 0;
let netHunt = 0;
let sharkAim: { x: number; z: number } | null = null;

async function huntCageSpot(): Promise<NonNullable<ReturnType<typeof findTunaSwordSpot>> | null> {
    let spot = findTunaSwordSpot();
    if (spot && (spot.distance ?? 99) <= 8) {
        if (!sharkAim || Math.hypot(spot.x - sharkAim.x, spot.z - sharkAim.z) <= 10) return spot;
    }
    if (spot && !sharkAim) {
        await walkNear(spot.x, spot.z, 2);
        return findTunaSwordSpot();
    }
    const wp = sharkAim ? pierNear(sharkAim.x, sharkAim.z) : PIER[pierHunt++ % PIER.length]!;
    const nearby = (sdk.getNearbyNpcs() ?? [])
        .filter((n) => /fishing spot/i.test(n.name))
        .map((n) => `${n.optionsWithIndex.map((o) => o.text).join('/')}@${n.x},${n.z}`);
    log(`Cage hunt ${wp.x},${wp.z} @ ${pos().x},${pos().z} nearby=${nearby.join(' ') || 'none'}${sharkAim ? ` sharks@${sharkAim.x},${sharkAim.z}` : ''}`);
    await walkNear(wp.x, wp.z, 3);
    return findTunaSwordSpot();
}

async function huntNetSpot(): Promise<NonNullable<ReturnType<typeof findNetSpot>> | null> {
    let spot = findNetSpot();
    if (spot && (spot.distance ?? 99) <= 8) return spot;
    if (spot) {
        await walkNear(spot.x, spot.z, 2);
        return findNetSpot();
    }
    const wp = NET_PIER[netHunt++ % NET_PIER.length]!;
    log(`Net hunt ${wp.x},${wp.z} @ ${pos().x},${pos().z}`);
    await walkNear(wp.x, wp.z, 3);
    return findNetSpot();
}

let skipSharkUntil = 0;

async function scanMinimapSharks() {
    const items = await sdk.scanGroundItems(MINIMAP_RADIUS);
    const sharks = items
        .filter((i) => RAW_SHARK.test(i.name))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
    if (sharks[0]) sharkAim = { x: sharks[0].x, z: sharks[0].z };
    else sharkAim = null;
    return sharks;
}

async function pickupDroppedSharks(): Promise<number> {
    if (Date.now() < skipSharkUntil) return 0;
    let sharks = await scanMinimapSharks();
    if (sharks.length === 0) return 0;

    const nearest = sharks[0]!;
    if ((nearest.distance ?? 99) > 5) {
        const wp = pierNear(nearest.x, nearest.z);
        log(`Minimap ${sharks.length} raw shark @ ${nearest.x},${nearest.z} (${nearest.distance?.toFixed(0)}t) — moving to ${wp.x},${wp.z}`);
        await walkNear(wp.x, wp.z, 3);
        sharks = await scanMinimapSharks();
    }

    let picked = 0;
    for (let i = 0; i < 8; i++) {
        const shark =
            sdk.findGroundItem(RAW_SHARK, { reachable: true }) ??
            sharks.find((s) => s.reachable !== false) ??
            null;
        if (!shark) break;
        if (inventoryIsFull()) {
            const junk =
                sdk.findInventoryItem(/^raw tuna$/i) ??
                sdk.findInventoryItem(/^raw shrimps?$/i) ??
                sdk.findInventoryItem(/^raw anchovies$/i);
            if (!junk) break;
            await sdk.sendDropItem(junk.slot);
            await sdk.waitForTicks(1);
            log(`Dropped ${junk.name} for raw shark @ ${shark.x},${shark.z}`);
        }
        if (inventoryIsFull()) break;
        const r = await bot.pickupItem(shark);
        if (!r.success) {
            skipSharkUntil = Date.now() + 8_000;
            log(`Pickup raw shark failed: ${r.message} — skip 8s`);
            break;
        }
        picked++;
        log(`Picked raw shark (${shark.distance?.toFixed(0)}t) ${shark.x},${shark.z}`);
        sharks = sharks.filter((s) => !(s.x === shark.x && s.z === shark.z));
    }
    return picked;
}

async function openRangeDoor(): Promise<void> {
    const door = sdk.findNearbyLoc(/^door$/i, { withOption: /^open$/i });
    if (!door) return;
    if ((door.distance ?? 99) > 6) return;
    await bot.openDoor(door);
}

function findRange() {
    const ranges = (sdk.getNearbyLocs() ?? []).filter((l) => /^range$/i.test(l.name));
    return ranges.find((l) => l.reachable) ?? ranges[0] ?? null;
}

async function goToRange(): Promise<boolean> {
    if (distTo(RANGE_STAND.x, RANGE_STAND.z) > 3) {
        await walkNear(RANGE_OUTSIDE.x, RANGE_OUTSIDE.z, 2);
        await openRangeDoor();
        await walkNear(RANGE_STAND.x, RANGE_STAND.z, 1);
    }
    await openRangeDoor();
    const range = findRange();
    if (!range) {
        log(`No range @ ${pos().x},${pos().z} locs=${(sdk.getNearbyLocs() ?? []).map((l) => l.name).slice(0, 10).join(',')}`);
        return false;
    }
    return true;
}

async function fishInventory(): Promise<{ lobster: number; xp: number; idleMs: number; clicks: number }> {
    const startXp = fishingXp();
    const startLobster = countItems(/^raw lobster$/i);
    let idleMs = 0;
    let clicks = 0;
    let noSpot = 0;

    while (!inventoryIsFull()) {
        await bot.dismissBlockingUI();
        if (pos().isDead) break;

        let spot = findTunaSwordSpot();
        if (!spot || (spot.distance ?? 99) > 8) {
            const walkStart = Date.now();
            spot = await huntCageSpot();
            idleMs += Date.now() - walkStart;
        }
        if (!spot) {
            noSpot++;
            if (noSpot === 1 || noSpot % 5 === 0) {
                const nearby = (sdk.getNearbyNpcs() ?? [])
                    .filter((n) => /fishing spot/i.test(n.name))
                    .map((n) => `${n.optionsWithIndex.map((o) => o.text).join('/') || '?'}@${n.x},${n.z}`);
                log(`No cage spot (${noSpot}) @ ${pos().x},${pos().z} nearby=${nearby.join(' ') || 'none'}`);
            }
            await sdk.waitForTicks(1);
            continue;
        }
        noSpot = 0;

        const match = spot.optionsWithIndex.find((o) => /^cage$/i.test(o.text));
        if (!match) {
            log(`Spot options: ${spot.optionsWithIndex.map((o) => o.text).join(', ')}`);
            await sdk.waitForTicks(1);
            continue;
        }

        const invBefore = occupiedSlots();
        const xpBefore = fishingXp();
        const started = Date.now();
        clicks++;
        await sdk.sendInteractNpc(spot.index, match.opIndex);

        try {
            await sdk.waitForCondition((s) => {
                if (s.dialog.isOpen) return true;
                if (s.inventory.filter((i) => (i.count ?? 0) > 0).length >= 28) return true;
                const xp = s.skills.find((sk) => sk.name === 'Fishing')?.experience ?? 0;
                const gained = xp > xpBefore || s.inventory.length > invBefore;
                const idle = (s.player?.animId ?? -1) === -1;
                if (gained && idle) return true;
                if (!gained && idle && Date.now() - started > 2500) return true;
                return false;
            }, 8_000);
        } catch {
            /* recast */
        }

        if (fishingXp() === xpBefore && occupiedSlots() === invBefore) {
            idleMs += Date.now() - started;
        }
    }

    return {
        lobster: countItems(/^raw lobster$/i) - startLobster,
        xp: fishingXp() - startXp,
        idleMs,
        clicks,
    };
}

async function withdrawRawSmallFish(): Promise<number> {
    while (occupiedSlots() < 28) {
        const item = sdk.findBankItem(/^raw shrimps?$/i) ?? sdk.findBankItem(/^raw anchovies$/i);
        if (!item) break;
        const r = await bot.withdrawItem(item, -1);
        if (!r.success && !r.partial) {
            log(`Withdraw ${item.name} failed: ${r.message}`);
            break;
        }
    }
    return countItems(RAW_SMALL);
}

/** Cook every raw shrimp/anchovy already in the bag or bank before going back to the pier. */
async function cookOffShrimpAndAnchovies(): Promise<void> {
    let loads = 0;
    while (loads < 50) {
        if (countItems(RAW_SMALL) > 0) {
            intent(`cook shrimp/anchovies (cooking ${cookingLevel()})`);
            const cooked = await cookInventory();
            log(
                `Shrimp cook load ${loads} | ${cooked.cooked} cooked ${cooked.burnt} burnt +${cooked.xp}xp leftover ${cooked.leftover} | Cook ${cookingLevel()}`
            );
        }
        if (!(await openBankAt(BANK.x, BANK.z))) break;
        for (const item of [...sdk.getInventory()]) {
            if (KEEP.test(item.name) || RAW_SMALL.test(item.name)) continue;
            await bot.depositItem(item, -1);
        }
        const more = await withdrawRawSmallFish();
        await bot.closeBank();
        if (more <= 0) {
            log(`No more raw shrimp/anchovies in bank. Cook ${cookingLevel()}`);
            break;
        }
        loads++;
        log(`Withdrew ${more} raw shrimp/anchovy for cooking`);
    }
}

async function cookInventory(): Promise<{ cooked: number; burnt: number; xp: number; leftover: number }> {
    const cookableStart = sdk.getInventory().filter((i) => RAW.test(i.name) && canCookItem(i.name)).length;
    if (cookableStart === 0) return { cooked: 0, burnt: 0, xp: 0, leftover: countItems(RAW) };

    if (!(await goToRange())) return { cooked: 0, burnt: 0, xp: 0, leftover: countItems(RAW) };

    intent(`cook fish (cooking ${cookingLevel()})`);
    const startXp = cookingXp();
    const startBurnt = countItems(BURNT);
    const startCooked = countItems(COOKED);
    let idleCasts = 0;

    while (cookableRaw() && idleCasts < 80) {
        await bot.dismissBlockingUI();
        const dialog = sdk.getDialog();
        if (dialog?.isOpen) {
            const cook = dialog.options.find((o) => /cook/i.test(o.text));
            await sdk.sendClickDialog(cook?.index ?? dialog.options[0]?.index ?? 0);
            await sdk.waitForTicks(1);
            idleCasts = 0;
            continue;
        }

        if (distTo(RANGE_STAND.x, RANGE_STAND.z) > 2) {
            await walkNear(RANGE_STAND.x, RANGE_STAND.z, 1);
            await openRangeDoor();
        }

        const raw = cookableRaw();
        const range = findRange();
        if (!raw || !range) {
            log(`Cook stuck raw=${raw?.name ?? 'none'} range=${!!range} @ ${pos().x},${pos().z}`);
            idleCasts++;
            if (!(await goToRange())) break;
            continue;
        }

        const xpBefore = cookingXp();
        const rawBefore = countItems(new RegExp(`^${raw.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
        const r = await sdk.sendUseItemOnLoc(raw.slot, range.x, range.z, range.id);
        if (!r.success) log(`useItemOnLoc: ${r.message}`);

        try {
            await sdk.waitForCondition((s) => {
                if (s.dialog.isOpen) return true;
                const xp = s.skills.find((sk) => sk.name === 'Cooking')?.experience ?? 0;
                if (xp > xpBefore) return true;
                const rawNow = s.inventory.filter((i) => i.name === raw.name).reduce((n, i) => n + i.count, 0);
                return rawNow < rawBefore;
            }, 5_000);
        } catch {
            /* recast — this game cooks one fish per use */
        }

        const rawAfter = countItems(new RegExp(`^${raw.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
        if (cookingXp() === xpBefore && rawAfter === rawBefore) {
            idleCasts++;
            if (idleCasts === 1 || idleCasts % 8 === 0) {
                log(`Cook miss ${idleCasts} ${raw.name} on ${range.name}(${range.x},${range.z}) @ ${pos().x},${pos().z}`);
            }
        } else {
            idleCasts = 0;
        }
    }

    return {
        cooked: countItems(COOKED) - startCooked,
        burnt: countItems(BURNT) - startBurnt,
        xp: cookingXp() - startXp,
        leftover: countItems(RAW),
    };
}

type TripStats = {
    n: number;
    totalMs: number;
    fishMs: number;
    cookMs: number;
    walkMs: number;
    bankMs: number;
    tuna: number;
    sword: number;
    sharks: number;
    lobster: number;
    cooked: number;
    burnt: number;
    fishXp: number;
    cookXp: number;
};

const session: TripStats = {
    n: 0, totalMs: 0, fishMs: 0, cookMs: 0, walkMs: 0, bankMs: 0,
    tuna: 0, sword: 0, sharks: 0, lobster: 0, cooked: 0, burnt: 0, fishXp: 0, cookXp: 0,
};

function logSession(): void {
    if (session.n === 0) return;
    const t = session.totalMs;
    log(
        `SESSION ${session.n} trips ${fmtSec(t)} | ` +
        `fish ${session.lobster} lobster (${rate(session.lobster, t)}) | ` +
        `cook ${session.cooked} burnt ${session.burnt}` +
        `${session.cooked + session.burnt > 0 ? ` (${((100 * session.burnt) / (session.cooked + session.burnt)).toFixed(1)}%)` : ''} | ` +
        `split fish ${((100 * session.fishMs) / t).toFixed(0)}% cook ${((100 * session.cookMs) / t).toFixed(0)}% walk ${((100 * session.walkMs) / t).toFixed(0)}% bank ${((100 * session.bankMs) / t).toFixed(0)}% | ` +
        `Fish ${sdk.getSkill('Fishing')?.baseLevel} (+${session.fishXp}xp) Cook ${sdk.getSkill('Cooking')?.baseLevel} (+${session.cookXp}xp)`
    );
}

const FOOD_NAMES = ['lobster', 'swordfish', 'tuna', 'shark', 'raw lobster', 'raw swordfish', 'raw tuna', 'raw shark'];

function foodSnapshot(): { name: string; count: number }[] {
    return FOOD_NAMES
        .map((name) => ({ name, count: countItems(new RegExp(`^${name}$`, 'i')) }))
        .filter((s) => s.count > 0);
}

function shareGive(snapshot: { name: string; count: number }[]): { item: RegExp; amount: number }[] {
    const parts = MULES.length;
    return snapshot
        .map(({ name, count }) => ({
            item: new RegExp(`^${name}$`, 'i'),
            amount: Math.floor(count / parts),
        }))
        .filter((s) => s.amount > 0);
}

async function withdrawAllNotedFish(): Promise<number> {
    for (const name of FOOD_NAMES) {
        const re = new RegExp(`^${name}$`, 'i');
        const inBank = sdk.findBankItem(re)?.count ?? 0;
        if (inBank <= 0) continue;
        const r = await bot.withdrawItem(re, -1, { asNote: true }).catch(() => null);
        log(`Noted ALL ${name} (${inBank}) ${r?.success ? 'ok' : r?.message ?? 'fail'}`);
    }
    return countItems(NOTE_FISH);
}

async function packOwnFoodNotes(): Promise<number> {
    if (!(await openBankAt(BANK.x, BANK.z))) return 0;
    await depositJunk();
    const packed = await withdrawAllNotedFish();
    if (hasPot()) await bot.depositItem(/^lobster pot$/i, 1).catch(() => {});
    await bot.closeBank();
    log(`Packed own notes ${packed} | ${invSummary(NOTE_FISH)}`);
    return packed;
}

async function collectJackthiefFood(): Promise<boolean> {
    intent(`Waiting at Catherby bank for ${PARTNER} to hand over ALL food`);
    await walkNear(BANK.x, BANK.z, 4);
    if (sdk.getState()?.trade?.isOpen) await bot.declineTrade().catch(() => {});

    const served = await bot.serveTrades({
        from: new RegExp(`^${PARTNER}$`, 'i'),
        give: [],
        want: [{ item: NOTE_FISH, amount: 1 }],
        maxTrades: 1,
        timeout: countItems(NOTE_FISH) > 0 ? 90_000 : 4 * 60_000,
        tradeTimeout: 60_000
    });
    const last = served.trades[served.trades.length - 1];
    log(
        `Collect ${PARTNER} ${last?.success ? 'ok' : last?.reason ?? served.reason} ${served.message} | ${invSummary(NOTE_FISH)}`
    );
    return last?.success === true;
}

async function tradeMule(name: string, give: { item: RegExp; amount: number }[]): Promise<boolean> {
    const mule = sdk.findNearbyPlayer(new RegExp(`^${name}$`, 'i'));
    if (!mule) return false;
    if (give.length === 0) return false;
    const started = Date.now();
    const result = await bot.trade(mule, {
        give,
        accept: (their) =>
            their.some((i) => /^coins$/i.test(i.name) && i.count > 0) ||
            Date.now() - started > 12_000,
        requestTimeout: 25_000,
        timeout: 45_000,
        retryOnBusy: true
    });
    log(
        `Trade ${name} ${result.success ? 'ok' : result.reason} ${result.message} | ` +
        `leftover ${invSummary(NOTE_FISH)} gp=${coins()}`
    );
    return result.success;
}

async function deliverToMules(): Promise<void> {
    const snapshot = foodSnapshot();
    const give = shareGive(snapshot);
    log(
        `Ardougne 1/${MULES.length} of ${snapshot.map((s) => `${s.count} ${s.name}`).join(', ') || 'nothing'} ` +
        `-> ${MULES.join(', ')}`
    );
    if (give.length === 0) {
        log('Not enough noted food to split');
        return;
    }

    const served = new Set<string>();
    const deadline = Date.now() + 8 * 60_000;
    let hunt = 0;
    while (Date.now() < deadline && served.size < MULES.length) {
        await bot.dismissBlockingUI();
        for (const name of MULES) {
            if (served.has(name)) continue;
            if (await tradeMule(name, give)) served.add(name);
        }
        if (served.size >= MULES.length) break;
        const wp = ARDY_HUNT[hunt++ % ARDY_HUNT.length]!;
        intent(`Hunting ${MULES.filter((m) => !served.has(m)).join(', ')} @ ${wp.x},${wp.z}`);
        await walkNear(wp.x, wp.z, 6);
    }
    log(`Mule trades ${[...served].join(', ') || 'none'} | leftover ${invSummary(NOTE_FISH)} gp=${coins()}`);
}

async function dumpArdougneBank(): Promise<void> {
    if (!(await openBankAt(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z))) return;
    for (const item of [...sdk.getInventory()]) {
        await bot.depositItem(item, -1);
    }
    log(`Ardougne dump ${invSummary()} gp kept in bank`);
    await bot.closeBank();
}

async function muleRun(): Promise<void> {
    log(`Bank ${bankTrips}: mule run — collect ${PARTNER} food, 1/${MULES.length} to ${MULES.join(', ')}`);
    intent('Packing food notes for Ardougne');
    await packOwnFoodNotes();

    const gotJack = await collectJackthiefFood();
    if (!gotJack) log(`${PARTNER} did not hand over food — going to Ardougne with what I have`);
    log(`Leaving Catherby with ${invSummary(NOTE_FISH)}`);

    await walkToArdougne();
    await deliverToMules();
    await dumpArdougneBank();

    intent('Walking back to Catherby to fish');
    await walkToCatherby();
    await setupBankAndTools();
}

async function bankCatch(): Promise<void> {
    if (!(await openBankAt(BANK.x, BANK.z))) return;
    await depositJunk();
    if (!hasPot()) await bot.withdrawItem(/^lobster pot$/i, 1).catch(() => {});
    await bot.closeBank();
    bankTrips++;
    log(`Bank trip ${bankTrips} (mule run every ${LOADS_BEFORE_MULE})`);
    if (bankTrips > 0 && bankTrips % LOADS_BEFORE_MULE === 0) {
        await muleRun();
    }
}

async function runTrip(n: number): Promise<void> {
    const tripStart = Date.now();
    let fishMs = 0;
    let cookMs = 0;
    let walkMs = 0;
    let bankMs = 0;

    intent(`cage lobster trip ${n}`);
    if (!findTunaSwordSpot()) {
        const t = Date.now();
        await huntCageSpot();
        walkMs += Date.now() - t;
    }

    const fishStart = Date.now();
    const catch_ = await fishInventory();
    fishMs += Date.now() - fishStart;
    const caught = catch_.lobster;
    log(
        `trip ${n} FISH ${fmtSec(fishMs)} | ${caught} lobster ` +
        `${rate(caught, fishMs)} | +${catch_.xp}xp | idle ${fmtSec(catch_.idleMs)} clicks ${catch_.clicks} | ${invSummary(FISH_ANY)}`
    );

    const toRange = Date.now();
    intent('cook on way to bank');
    const cooked = await cookInventory();
    cookMs += Date.now() - toRange;
    const burnPct = cooked.cooked + cooked.burnt > 0
        ? `${((100 * cooked.burnt) / (cooked.cooked + cooked.burnt)).toFixed(1)}%`
        : 'n/a';
    log(
        `trip ${n} COOK ${fmtSec(cookMs)} | ${cooked.cooked} cooked ${cooked.burnt} burnt (${burnPct}) ` +
        `+${cooked.xp}xp leftover ${cooked.leftover} | ${invSummary(FISH_ANY)}`
    );

    const toBank = Date.now();
    intent('bank fish');
    await bankCatch();
    bankMs += Date.now() - toBank;
    log(`trip ${n} BANK ${fmtSec(bankMs)} pot=${hasPot()} inv=${occupiedSlots()} @ ${pos().x},${pos().z}`);

    const total = Date.now() - tripStart;
    walkMs = Math.max(0, total - fishMs - cookMs - bankMs);
    log(
        `trip ${n} TOTAL ${fmtSec(total)} | fish ${fmtSec(fishMs)} (${((100 * fishMs) / total).toFixed(0)}%) ` +
        `cook ${fmtSec(cookMs)} (${((100 * cookMs) / total).toFixed(0)}%) ` +
        `bank ${fmtSec(bankMs)} (${((100 * bankMs) / total).toFixed(0)}%) ` +
        `other/walk ${fmtSec(walkMs)} | ${rate(caught, total)} caught`
    );

    session.n++;
    session.totalMs += total;
    session.fishMs += fishMs;
    session.cookMs += cookMs;
    session.walkMs += walkMs;
    session.bankMs += bankMs;
    session.lobster += catch_.lobster;
    session.cooked += cooked.cooked;
    session.burnt += cooked.burnt;
    session.fishXp += catch_.xp;
    session.cookXp += cooked.xp;
    logSession();
}

try {
    const fish = sdk.getSkill('Fishing');
    const cook = sdk.getSkill('Cooking');
    log(
        `Catherby: cage lobsters (Fish ${fish?.baseLevel} Cook ${cook?.baseLevel}). ` +
        `Every ${LOADS_BEFORE_MULE} banks collect ALL food from ${PARTNER}, then 1/${MULES.length} to ${MULES.join(', ')} in Ardougne. @ ${pos().x},${pos().z}`
    );
    await bot.dismissBlockingUI();
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
    sdk.getNewChat();

    if (pos().isDead) {
        await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
    }

    await leaveHouse();
    if (!inCatherby()) await walkToCatherby();

    await cookOffShrimpAndAnchovies();

    if (!(await setupBankAndTools())) {
        throw new Error(`Could not get a lobster pot @ ${pos().x},${pos().z} gp=${coins()}`);
    }

    log('Startup: dropping food in Ardougne first — mules are already there');
    await muleRun();

    let trip = 1;
    while (true) {
        await bot.dismissBlockingUI();
        if (pos().isDead) {
            log('Died — waiting to respawn');
            await sdk.waitForCondition((s) => !s.player.isDead, 60_000).catch(() => {});
            log(`Respawned @ ${pos().x},${pos().z}`);
            if (!inCatherby()) await walkToCatherby();
            await setupBankAndTools();
            continue;
        }
        if (!hasPot()) {
            log('Lost lobster pot — restocking');
            if (!(await setupBankAndTools())) {
                log('Cannot restock lobster pot — waiting on Harry');
                await sdk.waitForTicks(10);
                continue;
            }
        }
        await runTrip(trip);
        trip++;
    }
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    logSession();
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
