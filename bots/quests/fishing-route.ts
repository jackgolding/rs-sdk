/**
 * jacklove fishing route:
 * bank → net → combat 15 chickens → Draynor net → Ardougne boats → Catherby.
 *
 * Default: harpoon tuna/swordfish (lobster cage fallback if Harry is dry), cook, bank.
 * `--shark`: harpoon sharks on Catherby Net/Harpoon spots (not cage spots).
 * `--smallnet`: buy a small fishing net from Harry, net Catherby Net/Bait spots
 *   (shrimp / anchovies) until Fishing 35, then harpoon tuna/swordfish.
 * `--thieve-supply N`: cook N tuna/swordfish (net under Fishing 35, or while
 *   Cooking is under 30), then restore this bot's roster job to thieving-route.
 * `--bignet`: small-net Catherby until Fishing 16, then buy a big fishing net
 *   from Harry and net the Catherby Net/Harpoon spots. Drop seaweed / mackerel /
 *   boots / gloves / cod / oysters. Open caskets. Keep and bank bass, gems,
 *   and loop / tooth key halves. Before each fishing trip, cook every raw
 *   food in the bank that Cooking can handle. Cook bass from the net when
 *   Cooking is high enough.
 *
 *   bun bots/quests/fishing-route.ts jacklove1
 *   bun bots/quests/fishing-route.ts jacklove6 --shark
 *   bun bots/quests/fishing-route.ts jacklove6 --bignet
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding, isTileWalkable } from '../../sdk/pathfinding';
import { spawn } from 'child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import {
    ARDOUGNE_MARKET,
    ARDY_TO_CATHERBY,
    CATHERBY_BANK,
    DRAYNOR_BANK,
    EDGEVILLE,
    HANDELMORT_SAFE_EAST,
    HOUSE_OUTSIDE,
    LUMBRIDGE_MEN,
    PORT_SARIM_DOCK,
    inHandelmortMansion
} from './tiles';
import { installWaitForTicksGuard, recoverGangplank, walkNear as walkNearShared } from './movement';
import { installGracefulShutdown } from '../../sdk/runner';

const TARGET_FISHING_HARPOON = 50;
const TARGET_FISHING_SHARK = 76;
const TARGET_FISHING_NET = 16;
const TARGET_FISHING_SMALLNET = 35;
const TARGET_COMBAT = 15;
const COD_COOK = 18;
const BASS_COOK = 43;
const MACKEREL_COOK = 10;
const TUNA_COOK = 30;
const SWORD_COOK = 45;
const BOAT_GP = 80;
const COIN_WITHDRAW = 100;

const DRAYNOR_NET = { x: 3087, z: 3230 };
const WIZARD_Z = 3232;
const GERRANT = { x: 3013, z: 3225 };
const DUNGEON_LADDER = { x: 3096, z: 9867 };
const WILDY_GATE = { x: 3103, z: 9909 };
/** Ground spawn in m46_57 — west of Graveyard of Shadows, ~wildy 22. */
const WILDY_NET = { x: 2999, z: 3701 };
const WILDY_DITCH_NORTH = { x: 3088, z: 3525 };
const WILDY_DITCH_SOUTH = { x: 3088, z: 3510 };
/** sendWalk only. Stays north of Dark Warriors' Fortress (~3026, 3631). */
const WILDY_TO_NET = [
    { x: 3088, z: 3525 },
    { x: 3088, z: 3610 },
    { x: 3040, z: 3660 },
    { x: 3008, z: 3690 },
    { x: 2999, z: 3701 }
];
const CHICKENS = { x: 3185, z: 3277 };
const BRIMHAVEN_CUSTOMS = { x: 2772, z: 3225 };
/** Men/women immediately north of the Catherby bank. */
const CATHERBY_MEN = { x: 2808, z: 3452 };
/** Karamja men (wiki man.md). East of Brimhaven on the Musa road — not the customs dock. */
const KARAMJA_MEN = { x: 2889, z: 3173 };
const BRIMHAVEN_BOAT_GP = 30;
const HARRY = { x: 2834, z: 3445 };
const HARPOON_GP = 5;
const SMALL_NET_GP = 5;
const LOBSTER_POT_GP = 20;
const BIG_NET_GP = 20;
const HARRY_HARPOON_SPAWNS = 5;
const HARRY_BIG_NET_SPAWNS = 5;
const HARRY_SMALL_NET_SPAWNS = 20;
/** Catherby Net/Bait beach (shrimp / anchovies), west of the cage pier. */
const CATHERBY_NET_BAIT = [
    { x: 2838, z: 3433 },
    { x: 2845, z: 3429 },
    { x: 2853, z: 3426 }
];
const RANGE_OUTSIDE = { x: 2816, z: 3439 };
const RANGE_STAND = { x: 2816, z: 3443 };

const MUSA_TO_BRIMHAVEN = [
    { x: 2864, z: 3154 },
    { x: 2812, z: 3176 },
    { x: 2772, z: 3225 }
];
const PIER = [
    { x: 2854, z: 3423 },
    { x: 2860, z: 3426 },
    { x: 2845, z: 3429 },
    { x: 2837, z: 3431 }
];
const BANKS = [
    { name: 'Draynor', x: 3092, z: 3243 },
    { name: 'Varrock West', x: 3185, z: 3436 },
    { name: 'Varrock East', x: 3253, z: 3420 },
    { name: 'Edgeville', x: 3094, z: 3492 },
    { name: 'Falador East', x: 3013, z: 3355 },
    { name: 'Catherby', x: 2808, z: 3443 },
    { name: 'Seers', x: 2727, z: 3493 },
    { name: 'Ardougne East', x: 2655, z: 3283 },
    { name: 'Yanille', x: 2613, z: 3091 }
];

const NET_KEEP = /^(coins|small fishing net|cake|2\/3 cake|chocolate slice|bread)$/i;
const TOOL_KEEP = /^(harpoon|lobster pot)$/i;
const BIG_NET_KEEP = /^(big|large) fishing net$/i;
/** Never bank the fishing tool on dump — restarts were depositing the net then failing to withdraw it. */
const DUMP_KEEP = /^(big|large) fishing net|small fishing net|harpoon|lobster pot$/i;
const RAW_SMALL = /^raw (shrimps?|anchovies|sardine|herring)$/i;
const RAW = /^raw (tuna|swordfish|lobster|shark|shrimps?|anchovies|sardine|herring)$/i;
const RAW_NET = /^raw bass$/i;
const RAW_ANY = /^raw /i;
const COOKED = /^(tuna|swordfish|lobster|shark|shrimps?|anchovies|sardine|herring|cod|bass)$/i;
const BURNT = /^burnt (lobster|fish|swordfish|tuna|shrimp|shark|cod|bass)/i;
const BIG_NET_DROP =
    /^(seaweed|edible seaweed|raw mackerel|mackerel|leather boots|leather gloves|boots|raw cod|cod|burnt cod|oyster|oysters|clam|clams)$/i;
/** Bank these. Never drop them, even if a junk pattern grows. */
const BIG_NET_TREASURE =
    /^(raw |burnt )?bass$|^(uncut )?(sapphire|emerald|ruby|diamond|dragonstone)$|loop half of a key|tooth half of a key/i;
const CASKET = /^casket$/i;
const OYSTER = /^(oyster|clam)s?$/i;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const BIG_NET = argv.includes('--bignet');
const SMALL_NET = argv.includes('--smallnet');
const SHARK = argv.includes('--shark');
const COOK_ALL = argv.includes('--cook-all');
const NO_COOK = argv.includes('--no-cook');
const THIEVE_SUPPLY = (() => {
    const i = argv.indexOf('--thieve-supply');
    if (i < 0) return 0;
    const n = Number(argv[i + 1]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500;
})();
const TARGET_FISHING = SHARK
    ? TARGET_FISHING_SHARK
    : BIG_NET
      ? TARGET_FISHING_NET
      : SMALL_NET
        ? TARGET_FISHING_SMALLNET
        : TARGET_FISHING_HARPOON;

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/fishing-route.ts {botname}`);
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

let session!: ActivitySession;

function log(msg: string): void {
    session.log('log', msg);
}

function bankItemLabel(name: string, count: number): string {
    if (/^coins?$/i.test(name)) return 'gold';
    const n = name.toLowerCase();
    if (count !== 1 && /rune$/i.test(n)) return `${n}s`;
    return n;
}

function logBank(): void {
    const parts = sdk
        .getBankItems()
        .filter((i) => (i.count ?? 0) > 0)
        .map((i) => `${i.count} ${bankItemLabel(i.name, i.count)}`);
    if (parts.length) session.log('log', parts.join(' '));
}

async function snapshotBank(): Promise<void> {
    await sdk.waitForTicks(1);
    await sdk
        .waitForCondition((s) => s.bank?.isOpen === true && (s.bank.items?.length ?? 0) > 0, 5_000)
        .catch(() => {});
    logBank();
    session.captureBankStock();
}

const YIELD_FISH =
    /^(raw )?(shark|tuna|swordfish|lobster|shrimps?|anchovies|sardine|herring|cod|bass)$|oyster|casket/i;

function fishStacks(): Map<string, number> {
    const totals = new Map<string, number>();
    for (const item of sdk.getInventory()) {
        const name = item.name?.trim();
        if (!name || !YIELD_FISH.test(name)) continue;
        totals.set(name, (totals.get(name) ?? 0) + (item.count ?? 0));
    }
    return totals;
}

/** Positive inventory deltas since `before`, minus raw that was only converted. */
function recordFishDeltas(before: Map<string, number>): void {
    const after = fishStacks();
    let rawConsumed = 0;
    const gains: { name: string; count: number }[] = [];
    for (const name of new Set([...before.keys(), ...after.keys()])) {
        const delta = (after.get(name) ?? 0) - (before.get(name) ?? 0);
        if (/^raw /i.test(name) && delta < 0) rawConsumed += -delta;
        else if (delta > 0) gains.push({ name, count: delta });
    }
    let shrink = rawConsumed;
    for (const gain of gains) {
        if (/^raw /i.test(gain.name)) continue;
        const cut = Math.min(gain.count, shrink);
        gain.count -= cut;
        shrink -= cut;
    }
    for (const gain of gains) {
        if (gain.count > 0) session.recordGain(gain.name, gain.count);
    }
}

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

await sdk.connect();
const bot = new BotActions(sdk);
session = new ActivitySession(sdk, bot, {
    name: SHARK ? 'shark' : BIG_NET ? 'bignet' : 'fishing',
    grindLogPath: GRIND_LOG,
    maxRecoveryTactics: 8
});
installGracefulShutdown({ graceMs: 30_000 });

async function enterPhase(name: string): Promise<void> {
    if (session.metrics().phase === name) return;
    await session.setPhase(name);
}

/** After a stuck net or bank lap, fish the pier instead of the same spot. */
let simpleFishUntil = 0;

async function tickSession(): Promise<boolean> {
    if (session.isStopped()) return false;
    if (session.needsRecovery()) {
        await session.recover();
        if (session.isStopped()) return false;
        if (session.consumeFallback()) {
            if (hasHarpoon() || hasLobsterPot()) {
                simpleFishUntil = Date.now() + 10 * 60_000;
                session.log('warn', 'Spot stuck — harpoon or cage on the pier for 10 min');
            } else {
                session.log('warn', 'Spot stuck — leaving it and fishing the net again');
            }
        }
        return true;
    }
    return true;
}

installWaitForTicksGuard(sdk, session);

let lastIntent = '';
let lastLoggedFishing = 0;
let lastLoggedCombat = 0;
let lastLoggedCooking = 0;
let pierHunt = 0;

/** Spread bots across booth-adjacent tiles so 20 accounts do not stack on 2809,3441. */
const CATHERBY_BANK_STAND = [
    { x: 2807, z: 3442 },
    { x: 2808, z: 3441 },
    { x: 2809, z: 3440 },
    { x: 2810, z: 3442 },
    { x: 2811, z: 3438 },
    { x: 2806, z: 3442 },
    { x: 2812, z: 3441 }
];

function bankStandTile(): { x: number; z: number } {
    let h = 0;
    for (const c of username) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
    return CATHERBY_BANK_STAND[Math.abs(h) % CATHERBY_BANK_STAND.length]!;
}

function onCatherbyBankStreet(): boolean {
    const p = pos();
    return inCatherby() && p.x >= 2804 && p.x <= 2814 && p.z >= 3438 && p.z <= 3446;
}

function inCatherbyRangeHouse(): boolean {
    const p = pos();
    return inCatherby() && p.x >= 2813 && p.x <= 2821 && p.z >= 3440 && p.z <= 3446;
}

function northOfCatherbyBank(): boolean {
    const p = pos();
    return inCatherby() && p.z >= 3444;
}

async function openNearbyDoor(): Promise<boolean> {
    const door =
        sdk.findNearbyLoc(/^door$/i, { withOption: /open/i }) ??
        sdk.findNearbyLoc(/^door$/i, { withOption: /close/i });
    if (!door || (door.distance ?? 99) > 6) return false;
    const r = await bot.openDoor(door);
    await sdk.waitForTicks(1);
    return r.success;
}

async function exitCatherbyNorthBuildings(): Promise<void> {
    if (!inCatherby()) return;
    if (!northOfCatherbyBank() && !inCatherbyRangeHouse()) return;

    await dismissCookDialog();
    log(`Exit north/range @ ${pos().x},${pos().z}`);

    if (inCatherbyRangeHouse()) {
        await hopSendWalk(2816, 3440, 2, 10_000);
        await openRangeDoor();
        await openNearbyDoor();
        await hopSendWalk(RANGE_OUTSIDE.x, RANGE_OUTSIDE.z, 2, 12_000);
    }

    const deadline = Date.now() + 50_000;
    while ((northOfCatherbyBank() || inCatherbyRangeHouse()) && Date.now() < deadline) {
        await dismissCookDialog();
        await openNearbyDoor();
        const p = pos();
        const southZ = Math.max(3436, p.z - 3);
        if (southZ === p.z) {
            await hopSendWalk(p.x - 1, p.z, 2, 4_000);
        } else {
            await hopSendWalk(p.x, southZ, 2, 8_000);
        }
        if (!northOfCatherbyBank() && !inCatherbyRangeHouse()) break;
    }

    if (northOfCatherbyBank() || inCatherbyRangeHouse()) {
        log(`Still north @ ${pos().x},${pos().z} — pathfind to pier road`);
        for (const hop of [
            { x: 2815, z: 3444 },
            { x: 2815, z: 3440 },
            { x: 2818, z: 3438 },
            { x: 2824, z: 3436 },
            { x: 2832, z: 3434 }
        ]) {
            if (!northOfCatherbyBank() && !inCatherbyRangeHouse()) break;
            await openNearbyDoor();
            await hopSendWalk(hop.x, hop.z, 2, 10_000);
        }
        await walkNear(2832, 3434, 5);
    }
    await closeBankHard();
}

async function stepOffCatherbyBank(): Promise<void> {
    await closeBankHard();
    const spread = bankStandTile();
    log(`Step off bank cluster → ${spread.x},${spread.z} from ${pos().x},${pos().z}`);
    await hopSendWalk(spread.x, spread.z, 2, 12_000);
    if (onCatherbyBankStreet()) {
        await hopSendWalk(2820, 3436, 3, 15_000);
    }
}

function intent(msg: string): void {
    if (msg === lastIntent) return;
    lastIntent = msg;
    if (sdk.isConnected()) {
        void session.showIntent(msg);
    }
}

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
        combatLevel: p?.combatLevel ?? 1
    };
}

function distTo(x: number, z: number): number {
    const p = pos();
    return Math.hypot(p.x - x, p.z - z);
}

function inDungeon(): boolean {
    return pos().z > 6400;
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

function combatLevel(): number {
    return pos().combatLevel;
}

function coins(): number {
    return sdk.findInventoryItem(/^coins$/i)?.count ?? 0;
}

function hasNet(): boolean {
    return !!sdk.findInventoryItem(/small fishing net/i);
}

function hasHarpoon(): boolean {
    return !!sdk.findInventoryItem(/^harpoon$/i);
}

function hasLobsterPot(): boolean {
    return !!sdk.findInventoryItem(/^lobster pot$/i);
}

function hasBigNet(): boolean {
    return !!sdk.findInventoryItem(BIG_NET_KEEP);
}

function smallNetPhase(): boolean {
    return SMALL_NET && fishingLevel() < TARGET_FISHING_SMALLNET;
}

/** Big net is Fishing 16. Shrimp at Catherby until then. */
function bigNetRamp(): boolean {
    return BIG_NET && fishingLevel() < TARGET_FISHING_NET;
}

function sharkRampPhase(): boolean {
    return SHARK && fishingLevel() < TARGET_FISHING_SHARK;
}

/** Cage/harpoon pier — Net/Bait spots are west (~2838+). */
function onCatherbyCagePier(): boolean {
    const p = pos();
    return inCatherby() && p.x >= 2814 && p.x <= 2833 && p.z >= 3424 && p.z <= 3442;
}

async function ensureSmallNetBeach(): Promise<void> {
    if (findSmallNetSpot() && (findSmallNetSpot()?.distance ?? 99) <= 8) return;
    const dest = CATHERBY_NET_BAIT[pierHunt % CATHERBY_NET_BAIT.length]!;
    if (onCatherbyCagePier() || distTo(dest.x, dest.z) > 10) {
        log(`Walking to Net/Bait beach from ${pos().x},${pos().z}`);
        await leaveCatherbyBankToPier(dest);
    }
}

async function cookSmallNetIfNeeded(): Promise<void> {
    if (NO_COOK || cookingLevel() >= 99) return;
    if (!hasRawSmallFish() && !cookableRaw(RAW_SMALL)) return;
    await cookInventory(RAW_SMALL);
}

function hasRawSmallFish(): boolean {
    return sdk.getInventory().some((i) => RAW_SMALL.test(i.name) && (i.count ?? 0) > 0);
}

function toolKeep(): RegExp {
    if (BIG_NET && !bigNetRamp()) return BIG_NET_KEEP;
    if (smallNetPhase() || sharkNetRamp() || thieveSupplyNet() || bigNetRamp()) {
        return /small fishing net|harpoon|lobster pot/i;
    }
    return TOOL_KEEP;
}

/** Shark roster below 35 cannot harpoon. Net shrimp until the harpoon ramp. */
function sharkNetRamp(): boolean {
    return SHARK && fishingLevel() < TARGET_FISHING_SMALLNET;
}

/** Supply runs net until they can harpoon and cook tuna. */
function thieveSupplyNet(): boolean {
    return THIEVE_SUPPLY > 0 && (fishingLevel() < TARGET_FISHING_SMALLNET || cookingLevel() < TUNA_COOK);
}

function cookRawPattern(): RegExp {
    if (BIG_NET && !bigNetRamp()) return RAW_NET;
    if (smallNetPhase() || bigNetRamp()) return RAW_SMALL;
    return RAW;
}

function hasFishingTool(): boolean {
    if (BIG_NET) return bigNetRamp() ? hasNet() : hasBigNet();
    if (smallNetPhase()) return hasNet();
    // Shark spots only publish a Harpoon option, so a lobster pot is not a
    // tool here. Accepting one made setup return early and skip Harry's
    // harpoon, leaving the bot on shark tiles with nothing to fish with.
    if (SHARK) return hasHarpoon();
    return hasHarpoon() || hasLobsterPot();
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function inventoryIsFull(): boolean {
    return occupiedSlots() >= 28;
}

function countItems(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + i.count, 0);
}

function invSummary(pattern: RegExp = /./): string {
    const parts = sdk.getInventory()
        .filter((i) => pattern.test(i.name) && (i.count ?? 0) > 0)
        .map((i) => `${i.count} ${i.name}`);
    return parts.join(', ') || 'empty';
}

function cookLevelFor(name: string): number {
    const n = name.toLowerCase();
    if (/shrimps?/.test(n)) return 1;
    if (/sardine/.test(n)) return 1;
    if (/herring/.test(n)) return 5;
    if (/anchov/.test(n)) return 15;
    if (/mackerel/.test(n)) return MACKEREL_COOK;
    if (/cod/.test(n)) return COD_COOK;
    if (/bass/.test(n)) return BASS_COOK;
    if (/tuna/.test(n)) return TUNA_COOK;
    if (/swordfish/.test(n)) return SWORD_COOK;
    if (/lobster/.test(n)) return 40;
    if (/shark/.test(n)) return 80;
    if (/sea turtle/.test(n)) return 82;
    if (/manta ray/.test(n)) return 91;
    if (/trout/.test(n)) return 15;
    if (/pike/.test(n)) return 20;
    if (/salmon/.test(n)) return 25;
    if (/chompy/.test(n)) return 30;
    if (/beef|chicken|rat meat|bear meat|meat/.test(n)) return 1;
    return 99;
}

/** Big-net junk stays dropped on the catch. Bank stock is still food. */
function canCookItem(name: string, bankStock = false): boolean {
    if (!bankStock && BIG_NET && /mackerel|cod/i.test(name)) return false;
    return cookingLevel() >= cookLevelFor(name);
}

function cookableRaw(pattern: RegExp = RAW, bankStock = false) {
    return sdk.getInventory().find((i) => pattern.test(i.name) && canCookItem(i.name, bankStock)) ?? null;
}

function bankHasCookableRaw(): boolean {
    return (sdk.getBankItems() ?? []).some((i) => RAW_ANY.test(i.name) && (i.count ?? 0) > 0 && canCookItem(i.name, true));
}

function inArdougne(): boolean {
    const p = pos();
    return p.x < 2750 && p.x > 2500 && p.z > 3240 && p.z < 3355 && p.z < 6400;
}

function inCatherby(): boolean {
    const p = pos();
    return p.x >= 2788 && p.x <= 2875 && p.z >= 3415 && p.z <= 3498 && p.z < 6400;
}

/** Already in Kandarin (Ardougne, Catherby road, Seers). Do not walk back to Port Sarim. */
function onArdyCatherbyRoad(): boolean {
    if (onKaramja()) return false;
    const p = pos();
    return p.x > 2400 && p.x < 2944 && p.z > 3271 && p.z < 3600;
}

function onKaramja(): boolean {
    const p = pos();
    return p.x > 2680 && p.x < 3010 && p.z > 3040 && p.z < 3270;
}

function onMusa(): boolean {
    return onKaramja() && pos().x >= 2815;
}

/** Deck of the Port Sarim ↔ Musa Point ship. walkTo cannot path from here to land. */
function onMusaShip(): boolean {
    const p = pos();
    return p.level >= 1 && p.x >= 2948 && p.x <= 2962 && p.z >= 3138 && p.z <= 3148;
}

function inHouse(): boolean {
    const p = pos();
    return p.x >= 2673 && p.x <= 2676 && p.z >= 3307 && p.z <= 3311;
}

/**
 * Cabinet house and Cromperty, north-east of the East Ardougne market.
 * The south door is (2669, 3316). walkTo from in here paths through the walls
 * and never reaches the Catherby road.
 */
function inNorthEastArdy(): boolean {
    const p = pos();
    return p.x >= 2668 && p.x <= 2696 && p.z >= 3316 && p.z <= 3340;
}

function inKeepLeFaye(): boolean {
    const p = pos();
    return p.x >= 2746 && p.x <= 2772 && p.z >= 3390 && p.z <= 3422 && p.z < 6400;
}

function inLegendsGuild(): boolean {
    const p = pos();
    return p.x >= 2714 && p.x <= 2742 && p.z >= 3344 && p.z <= 3388 && p.z < 6400;
}

function onDockedShip(): boolean {
    if (inArdougne()) return false;
    if (onMusaShip()) return true;
    if (pos().level < 1) return false;
    const locs = sdk.getNearbyLocs() ?? [];
    return locs.some((l) => /gangplank|ship's (ladder|wheel)|anchor/i.test(l.name));
}

function inWilderness(): boolean {
    const p = pos();
    return p.z >= 3520 && p.z < 6400 && p.x >= 2944 && p.x < 3392;
}

/** Red-dragon isle exit, then the south corridor to the Edgeville ditch. Short hops only. */
const DRAGON_WILDY_EXIT = [
    { x: 3158, z: 3900 },
    { x: 3124, z: 3851 },
    { x: 3110, z: 3700 },
    { x: 3102, z: 3610 },
    { x: 3088, z: 3550 },
    { x: 3088, z: 3525 }
];

async function hopTowardWildy(x: number, z: number, tolerance = 5): Promise<void> {
    for (let i = 0; i < 40 && !pos().isDead && inWilderness(); i++) {
        const d = distTo(x, z);
        if (d <= tolerance) return;
        await eatIfNeeded();
        const step = Math.min(8, Math.max(1, d));
        const tx = Math.round(pos().x + ((x - pos().x) / d) * step);
        const tz = Math.round(pos().z + ((z - pos().z) / d) * step);
        const sx = pos().x;
        const sz = pos().z;
        await sdk.sendWalk(tx, tz, true);
        await sdk
            .waitForCondition((s) => {
                if (s.player?.isDead) return true;
                const px = s.player?.worldX ?? 0;
                const pz = s.player?.worldZ ?? 0;
                return Math.hypot(px - tx, pz - tz) <= 3 || Math.hypot(px - x, pz - z) <= tolerance || pz < 3520;
            }, 8_000)
            .catch(() => {});
        if (pos().x === sx && pos().z === sz) {
            await sdk.sendWalk(sx + (i % 2 === 0 ? 2 : -2), sz - 1, true);
            await sdk.waitForTicks(2);
        }
    }
}

async function leaveDragonWilderness(): Promise<void> {
    if (!inWilderness()) return;
    log(`Leaving wilderness @ ${pos().x},${pos().z}`);
    const onIsle = pos().x >= 3176 && pos().x <= 3230 && pos().z >= 3800 && pos().z <= 3856;
    if (onIsle) {
        await hopTowardWildy(3201, 3852, 4);
        const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
        if (gate) await bot.openDoor(gate);
        await hopTowardWildy(3202, 3862, 3);
    }
    for (const hop of DRAGON_WILDY_EXIT) {
        if (!inWilderness() || pos().isDead) break;
        if (hop.z > pos().z + 12 && pos().x < 3160) continue;
        await hopTowardWildy(hop.x, hop.z, 6);
    }
    if (inWilderness()) {
        await sdk.sendWalk(3088, 3516, true);
        await sdk.waitForCondition((s) => (s.player?.worldZ ?? 9999) < 3520 || s.player?.isDead === true, 12_000).catch(() => {});
    }
    log(`Wilderness exit @ ${pos().x},${pos().z}`);
}

function closestBank(): { name: string; x: number; z: number } {
    const booths = (sdk.getNearbyLocs() ?? []).filter(
        (l) =>
            /bank booth/i.test(l.name) &&
            !/closed/i.test(l.name) &&
            (l.distance ?? 99) <= 20
    );
    const usable = booths.filter((l) =>
        (l.optionsWithIndex ?? []).some((o) => /use/i.test(o.text))
    );
    const pool = usable.length > 0 ? usable : booths;
    if (pool[0]) {
        const b = pool.sort((a, c) => (a.distance ?? 99) - (c.distance ?? 99))[0]!;
        return { name: b.name, x: b.x, z: b.z };
    }
    return [...BANKS].sort((a, b) => distTo(a.x, a.z) - distTo(b.x, b.z))[0]!;
}

async function walkDungeon(x: number, z: number, tolerance = 6): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    return result.success || distTo(x, z) <= tolerance + 2;
}

async function climbToSurface(): Promise<boolean> {
    if (!inDungeon()) return true;
    if (pos().z >= WILDY_GATE.z) {
        await walkDungeon(WILDY_GATE.x, WILDY_GATE.z + 6, 3);
        const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
        if (gate) await bot.openDoor(gate);
        await walkDungeon(WILDY_GATE.x, WILDY_GATE.z - 6, 3);
    }
    await walkDungeon(DUNGEON_LADDER.x, DUNGEON_LADDER.z, 2);
    const ladder = sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-up/i });
    if (ladder) {
        await bot.interactLoc(ladder, /climb-up/i);
        await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) < 6400, 10_000).catch(() => {});
    }
    log(`Surface ${!inDungeon()} @ ${pos().x},${pos().z}`);
    return !inDungeon();
}

async function walkNear(x: number, z: number, tolerance = 6): Promise<boolean> {
    if (inDungeon() && z < 6400) await climbToSurface();
    if (distTo(x, z) <= tolerance) return true;
    return walkNearShared(bot, sdk, x, z, tolerance);
}

async function unequipAll(): Promise<void> {
    for (let i = 0; i < 16; i++) {
        const worn = sdk.getEquipment()[0];
        if (!worn) return;
        const r = await bot.unequipItem(worn);
        log(`Unequip ${worn.name}: ${r.success ? 'ok' : r.message}`);
        if (!r.success) return;
        await sdk.waitForTicks(1);
    }
}

function bankIsOpen(): boolean {
    const state = sdk.getState();
    return !!state?.bank?.isOpen || state?.interface?.interfaceId === 5292;
}

async function closeBankHard(): Promise<void> {
    for (let i = 0; i < 4 && (bankIsOpen() || sdk.getState()?.interface?.isOpen); i++) {
        void sdk.sendCloseModal().catch(() => {});
        await new Promise((r) => setTimeout(r, 400));
    }
    if (!(bankIsOpen() || sdk.getState()?.interface?.isOpen)) return;
    log('Bank UI stuck — stepping off booth');
    const p = pos();
    const hopZ = inCatherby() ? Math.min(p.z, 3438) : p.z - 2;
    void sdk.sendWalk(p.x, hopZ, true).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    void sdk.sendCloseModal().catch(() => {});
}

async function dumpAllGear(): Promise<void> {
    await closeBankHard();
    await dropBigNetJunk();
    const leftover = sdk.getInventory().filter(
        (it) =>
            !DUMP_KEEP.test(it.name) &&
            !/^coins$/i.test(it.name) &&
            !RAW_ANY.test(it.name) &&
            !COOKED.test(it.name) &&
            !BURNT.test(it.name) &&
            !OYSTER.test(it.name)
    );
    if (leftover.length === 0 && sdk.getEquipment().length === 0) {
        log('Dump skipped — already empty');
        return;
    }
    if (onKaramja()) {
        log('Dump skipped — no bank on this island');
        await leaveBuilding();
        return;
    }
    intent('Bank — dump inventory and equipment');
    if (inDungeon()) await climbToSurface();
    const bank = closestBank();
    for (let pass = 0; pass < 8; pass++) {
        if (!(await openBankAt(bank.x, bank.z))) return;
        await depositAllExcept(DUMP_KEEP);
        await bot.closeBank();
        if (sdk.getEquipment().length === 0) break;
        await unequipAll();
    }
    if (await openBankAt(bank.x, bank.z)) {
        await depositAllExcept(DUMP_KEEP);
        await bot.closeBank();
    }
    log(`Dumped gear at ${bank.name}: inv=${invSummary()} worn=${sdk.getEquipment().map((e) => e.name).join(',') || 'none'}`);
}

async function waitRespawn(): Promise<void> {
    if (!pos().isDead) return;
    intent('Dead — waiting to respawn');
    await sdk.waitForCondition((s) => !s.player.isDead, 60_000).catch(() => {});
}

async function eatIfNeeded(): Promise<void> {
    const { hp, maxHp } = pos();
    if (hp >= maxHp) return;
    const eatBelow = Math.min(maxHp - 1, Math.max(7, Math.floor(maxHp * 0.65)));
    if (hp > eatBelow) return;
    const food = sdk.findInventoryItem(/cake|chocolate|slice|bread|shrimp|anchov|tuna|swordfish|bass/i);
    if (!food) return;
    log(`Eating ${food.name} at ${hp} hp`);
    await bot.eatFood(food);
}

async function openNearbyGate(): Promise<void> {
    const gate = (sdk.getNearbyLocs() ?? []).find(
        (l) =>
            /gate|door/i.test(l.name) &&
            l.optionsWithIndex.some((o) => /^open$/i.test(o.text)) &&
            (l.distance ?? 99) <= 4
    );
    if (gate) await bot.openDoor(gate);
}

/** Mule sessions leave %bankcert on. Client `noteMode` can lag, so always click item mode. */
async function ensureBankItemMode(): Promise<void> {
    const state = sdk.getState();
    if (!state?.bank?.isOpen && !state?.interface?.isOpen) return;
    await sdk.sendClickComponent(5387); // bank_main:com_94 (item)
    await sdk.waitForTicks(2);
    if (sdk.getState()?.bank?.noteMode) {
        await sdk.sendClickComponent(5387);
        await sdk.waitForTicks(2);
        if (sdk.getState()?.bank?.noteMode) log('Bank still in note mode after item-toggle');
    }
}

async function openBankAt(x: number, z: number): Promise<boolean> {
    if (inDungeon()) await climbToSurface();
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (bankIsOpen()) {
        await ensureBankItemMode();
        return true;
    }
    if (sdk.getState()?.interface?.isOpen && !bankIsOpen()) {
        await bot.closeInterface();
    }
    // Street south of the booths. sendWalk out of the north house (walkTo the
    // booth tile routes back inside). From the pier, walkNear the street —
    // do not walkTo(2807, 3441). Then click a reachable booth.
    // Requesting Catherby coords from Ardougne used to skip the walk and click
    // the local (Ardy) booth — only use this path once we are actually there.
    const wantCatherby = Math.abs(x - CATHERBY_BANK.x) <= 4 && Math.abs(z - CATHERBY_BANK.z) <= 4;
    if (wantCatherby && !inCatherby()) {
        log(`Walking to Catherby bank street @ ${pos().x},${pos().z}`);
        await walkToCatherby();
    }
    const catherby = inCatherby() && wantCatherby;
    if (catherby) {
        const stand = bankStandTile();
        const already = sdk.findNearbyLoc(/bank booth/i, { reachable: true });
        if (!already || distTo(stand.x, stand.z) > 3) {
            log(`Walking to Catherby bank stand ${stand.x},${stand.z} @ ${pos().x},${pos().z}`);
            if (northOfCatherbyBank() || inCatherbyRangeHouse()) {
                await exitCatherbyNorthBuildings();
            }
            await hopSendWalk(stand.x, stand.z, 2, 20_000);
        }
        log(`At Catherby street ${pos().x},${pos().z}`);
        let booth = sdk.findNearbyLoc(/bank booth/i, { reachable: true });
        if (!booth) {
            booth = (sdk.getNearbyLocs() ?? [])
                .filter((l) => /bank booth/i.test(l.name) && (l.optionsWithIndex?.length ?? 0) > 0)
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        }
        if (booth) {
            const opt =
                booth.optionsWithIndex.find((o) => /use.quickly/i.test(o.text)) ??
                booth.optionsWithIndex.find((o) => /^use$/i.test(o.text));
            if (opt) {
                log(`Clicking Catherby booth @ ${booth.x},${booth.z}`);
                await sdk.sendInteractLoc(booth.x, booth.z, booth.id, opt.opIndex);
                await sdk.waitForCondition((s) => s.bank?.isOpen === true || s.interface?.interfaceId === 5292, 8_000).catch(() => {});
            }
        }
        if (bankIsOpen()) {
            await ensureBankItemMode();
            return true;
        }
        log(`Catherby booth missed @ ${pos().x},${pos().z} — step off`);
        await stepOffCatherbyBank();
    } else {
        await walkNear(x, z, 4);
    }
    if (bankIsOpen()) {
        await ensureBankItemMode();
        return true;
    }
    const opened = await bot.openBank();
    if (!opened.success && !bankIsOpen()) {
        log(`openBank failed: ${opened.message}`);
        return false;
    }
    if (bankIsOpen()) await ensureBankItemMode();
    return bankIsOpen();
}

async function depositAllExcept(keep: RegExp): Promise<void> {
    let fails = 0;
    for (let i = 0; i < 40; i++) {
        const item = sdk.getInventory().find((it) => !keep.test(it.name));
        if (!item) break;
        const r = await bot.depositItem(
            new RegExp(`^${item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
            -1
        );
        if (!r.success && !r.partial) {
            log(`Deposit ${item.name} failed: ${r.message}`);
            fails++;
            if (fails >= 3) break;
            await bot.closeBank();
            const bank = closestBank();
            if (!(await openBankAt(bank.x, bank.z))) break;
        }
    }
}

async function setupClosestBankAndNet(): Promise<void> {
    const bank = closestBank();
    intent(`Banking all items at ${bank.name}`);
    if (!(await openBankAt(bank.x, bank.z))) return;
    await depositAllExcept(/^$/);
    if (!hasNet()) await bot.withdrawItem(/small fishing net/i, 1).catch(() => {});
    if (coins() === 0) await bot.withdrawItem(/^coins$/i, COIN_WITHDRAW).catch(() => {});
    await bot.closeBank();
    log(`After closest bank (${bank.name}): net=${hasNet()} gp=${coins()} inv=${invSummary()}`);
    if (!hasNet()) await getNet();
}

/** Pathfinder refuses wilderness — only sendWalk north of the ditch. */
async function sendWalkTo(x: number, z: number, tolerance = 8): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (distTo(x, z) > tolerance && Date.now() < deadline) {
        await waitRespawn();
        if (pos().isDead) return;
        await sdk.sendWalk(x, z, true);
        await sdk.waitForTicks(3);
    }
}

async function leaveWilderness(): Promise<void> {
    if (!inWilderness()) return;
    intent('Leaving wilderness south of the ditch');
    const back = [...WILDY_TO_NET].reverse();
    for (const wp of back) {
        if (!inWilderness()) return;
        await sendWalkTo(wp.x, wp.z, 10);
    }
    await sendWalkTo(WILDY_DITCH_SOUTH.x, WILDY_DITCH_SOUTH.z, 4);
    for (let i = 0; i < 8 && inWilderness(); i++) {
        await sdk.sendWalk(WILDY_DITCH_SOUTH.x, WILDY_DITCH_SOUTH.z, true);
        await sdk.waitForTicks(3);
    }
}

async function pickupWildyNet(): Promise<boolean> {
    intent('Wilderness net spawn (2999, 3701)');
    if (!inWilderness()) {
        await walkNear(EDGEVILLE.x, EDGEVILLE.z, 6);
        if (await openBankAt(EDGEVILLE.x, EDGEVILLE.z)) {
            await depositAllExcept(/^$/);
            await bot.closeBank();
        }
        intent('Crossing the Edgeville wilderness ditch (sendWalk)');
        await sdk.sendWalk(WILDY_DITCH_NORTH.x, WILDY_DITCH_NORTH.z, true);
        await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) >= 3520, 12_000).catch(() => {});
        if (!inWilderness()) {
            log('Failed to cross wilderness ditch');
            return false;
        }
    }

    for (const wp of WILDY_TO_NET) {
        await waitRespawn();
        if (pos().isDead) return false;
        if (hasNet()) break;
        if (distTo(WILDY_NET.x, WILDY_NET.z) <= 8) break;
        const remaining = distTo(WILDY_NET.x, WILDY_NET.z);
        const via = Math.hypot(wp.x - WILDY_NET.x, wp.z - WILDY_NET.z);
        if (via >= remaining - 6) continue;
        await sendWalkTo(wp.x, wp.z, 8);
    }
    await sendWalkTo(WILDY_NET.x, WILDY_NET.z, 2);

    const deadline = Date.now() + 90_000;
    while (!hasNet() && Date.now() < deadline) {
        await waitRespawn();
        if (pos().isDead) return false;
        if (distTo(WILDY_NET.x, WILDY_NET.z) > 4) await sendWalkTo(WILDY_NET.x, WILDY_NET.z, 2);
        const scanned = await sdk.scanGroundItems(12);
        const net =
            sdk.findGroundItem(/small fishing net/i) ??
            scanned.find((g) => /small fishing net/i.test(g.name)) ??
            null;
        if (net) {
            const r = await bot.pickupItem(net);
            log(`Pickup wildy net: ${r.success ? 'ok' : r.message}`);
            if (hasNet()) break;
        } else {
            log('No net on the spawn tile — waiting for respawn');
            await sdk.waitForTicks(8);
        }
    }

    await leaveWilderness();
    log(`After wildy net run: net=${hasNet()} @ ${pos().x},${pos().z}`);
    return hasNet();
}

/** Combat 15 accounts die at the wildy-22 net spawn. Try Gerrant first; wildy at most once. */
let wildyNetTried = false;

async function withdrawNetAndCoins(): Promise<void> {
    if (inWilderness() || hasNet()) return;
    const banks = [
        closestBank(),
        { name: 'Draynor', x: DRAYNOR_BANK.x, z: DRAYNOR_BANK.z }
    ];
    const seen = new Set<string>();
    for (const bank of banks) {
        const key = `${bank.x},${bank.z}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!(await openBankAt(bank.x, bank.z))) continue;
        if (!hasNet()) await bot.withdrawItem(/small fishing net/i, 1).catch(() => {});
        if (coins() < 5) await bot.withdrawItem(/^coins$/i, COIN_WITHDRAW).catch(() => {});
        await bot.closeBank();
        if (hasNet() || coins() >= 5) return;
    }
}

async function buyGerrantNet(): Promise<boolean> {
    if (hasNet() || inWilderness() || coins() < 5) return hasNet();
    intent('Buying a small fishing net from Gerrant');
    await walkNear(GERRANT.x, GERRANT.z, 4);
    const gerrant = sdk.findNearbyNpc(/^gerrant$/i) ?? sdk.findNearbyNpc(/gerrant/i);
    if (!gerrant) {
        log('Gerrant not visible');
        return false;
    }
    await bot.openShop(gerrant);
    await bot.buyFromShop(/small fishing net/i, 1);
    await bot.closeShop();
    return hasNet();
}

async function getNet(): Promise<boolean> {
    if (hasNet()) return true;

    await withdrawNetAndCoins();
    if (hasNet()) return true;
    if (await buyGerrantNet()) return true;

    const tooLow = combatLevel() < 30;
    if (!wildyNetTried && !tooLow) {
        wildyNetTried = true;
        if (await pickupWildyNet()) return true;
        await withdrawNetAndCoins();
        if (hasNet()) return true;
        if (await buyGerrantNet()) return true;
    } else if (!wildyNetTried) {
        wildyNetTried = true;
        log(`Skipping wildy net (combat ${combatLevel()} — graveyard spawn is lethal)`);
    }
    return hasNet();
}

async function bankDraynorCatch(): Promise<void> {
    const dump = sdk.getInventory().filter((i) => !NET_KEEP.test(i.name));
    if (dump.length === 0 && hasNet()) return;
    intent('Banking catch at Draynor');
    if (!(await openBankAt(DRAYNOR_BANK.x, DRAYNOR_BANK.z))) return;
    await depositAllExcept(NET_KEEP);
    if (!hasNet()) await bot.withdrawItem(/small fishing net/i, 1).catch(() => {});
    if (coins() === 0) await bot.withdrawItem(/^coins$/i, 50).catch(() => {});
    await snapshotBank();
    await bot.closeBank();
}

function netSpot() {
    const spots = (sdk.getNearbyNpcs() ?? []).filter(
        (n) =>
            /fishing\s*spot/i.test(n.name) &&
            n.optionsWithIndex.some((o) => /^net$/i.test(o.text)) &&
            (combatLevel() >= TARGET_COMBAT || (n.tileZ ?? n.z) <= WIZARD_Z + 1)
    );
    return (
        spots.filter((n) => n.reachable !== false).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ??
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
        (n) => /^chicken$/i.test(n.name) && n.optionsWithIndex.some((o) => /^attack$/i.test(o.text)) && !n.inCombat
    );
    return (
        hens.filter((n) => n.reachable !== false).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ??
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
    await waitRespawn();
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
    if (!result.success) log(`attack: ${result.message}`);
    await sdk.waitForTicks(2);
}

async function fishDraynorOnce(): Promise<void> {
    await bot.dismissBlockingUI();
    await eatIfNeeded();
    await waitRespawn();

    if (combatLevel() < TARGET_COMBAT && (pos().inCombat || pos().z > WIZARD_Z)) {
        intent('Dark wizards — staying south');
        await sdk.sendWalk(DRAYNOR_NET.x, DRAYNOR_NET.z, true);
        await sdk.waitForTicks(4);
        return;
    }

    if (!hasNet()) {
        await bankDraynorCatch();
        if (!hasNet()) await getNet();
        if (!hasNet()) {
            await sdk.waitForTicks(5);
            return;
        }
    }

    if (sdk.getInventory().some((i) => !NET_KEEP.test(i.name)) && occupiedSlots() >= 26) {
        await bankDraynorCatch();
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

async function clickBoatDialog(): Promise<void> {
    let closedStreak = 0;
    let lastPick = '';
    let repeatPick = 0;
    const start = { x: pos().x, z: pos().z };
    for (let i = 0; i < 24; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            closedStreak++;
            if (closedStreak >= 4) return;
            await new Promise((r) => setTimeout(r, 250));
            continue;
        }
        closedStreak = 0;
        if (dialog.isWaiting) {
            await sdk.waitForTicks(1);
            continue;
        }
        const opts = dialog.options ?? [];
        const pick =
            opts.find((o) => /search away|nothing to hide/i.test(o.text)) ||
            opts.find((o) => /can i journey|journey on this ship/i.test(o.text)) ||
            opts.find((o) => /yes please/i.test(o.text)) ||
            opts.find((o) => /pay (the )?(fare|30)|30 coins|30 gp/i.test(o.text)) ||
            opts.find((o) => /ardougne/i.test(o.text) && !/unusual|customs then/i.test(o.text)) ||
            opts.find((o) => /^ok\.?$/i.test(o.text)) ||
            opts.find((o) => /journey|ship/i.test(o.text) && !/customs|unusual/i.test(o.text)) ||
            opts.find((o) => /yes/i.test(o.text) && !/crandor|bother|miss/i.test(o.text));
        const label = pick?.text ?? 'continue';
        if (label === lastPick) repeatPick++;
        else {
            lastPick = label;
            repeatPick = 0;
        }
        if (repeatPick >= 8 && Math.hypot(pos().x - start.x, pos().z - start.z) < 4) {
            log(`Boat dialog stuck on "${label}" — closing and retrying`);
            await bot.closeInterface().catch(() => {});
            await sdk.waitForTicks(2);
            return;
        }
        log(`Boat dialog -> ${label} (${opts.map((o) => o.text).join(' | ')})`);
        await sdk.sendClickDialog(pick?.index ?? 0);
        await sdk.waitForTicks(1);
    }
}

async function crossGangplank(): Promise<void> {
    const plank = sdk.findNearbyLoc(/gangplank/i);
    if (!plank) return;
    const opt = plank.optionsWithIndex.find((o) => /cross|board/i.test(o.text));
    log('Crossing gangplank');
    if (opt) await sdk.sendInteractLoc(plank.x, plank.z, plank.id, opt.opIndex);
    else await bot.interactLoc(plank, /cross|board/i);
    await sdk.waitForTicks(5);
}

async function leaveDockedShip(): Promise<void> {
    if (!onDockedShip()) return;
    log(`On a docked ship at (${pos().x},${pos().z}) lv${pos().level} — getting off`);
    for (let i = 0; i < 8 && onDockedShip(); i++) {
        if (!sdk.findNearbyLoc(/gangplank/i)) {
            await sdk.scanNearbyLocs(16).catch(() => {});
        }
        await crossGangplank();
        await sdk.waitForTicks(2);
    }
}

async function bankForBoat(): Promise<void> {
    intent('Banking at Draynor before the trip');
    await bot.closeInterface().catch(() => {});
    let opened = false;
    for (let attempt = 0; attempt < 4 && !opened; attempt++) {
        opened = await openBankAt(DRAYNOR_BANK.x, DRAYNOR_BANK.z);
        if (!opened) await sdk.waitForTicks(2);
    }
    if (!opened) {
        log('Boat bank still closed — continuing with inventory coins');
        return;
    }
    await depositAllExcept(/^coins$/i);
    if (coins() < BOAT_GP) await bot.withdrawItem(/^coins$/i, BOAT_GP).catch(() => {});
    await bot.closeBank();
    log(`After boat bank: ${coins()} gp @ ${pos().x},${pos().z}`);
}

async function walkToKaramjaMen(): Promise<void> {
    await leaveDockedShip();
    if (distTo(KARAMJA_MEN.x, KARAMJA_MEN.z) <= 8) return;
    intent(`Walking to Karamja men ${KARAMJA_MEN.x},${KARAMJA_MEN.z} for boat fare`);
    if (!onMusa()) {
        for (const wp of [...MUSA_TO_BRIMHAVEN].reverse()) {
            if (distTo(KARAMJA_MEN.x, KARAMJA_MEN.z) <= 8) return;
            await walkNear(wp.x, wp.z, 8);
        }
    }
    await walkNear(KARAMJA_MEN.x, KARAMJA_MEN.z, 4);
}

/** Stay on the island and pickpocket men until the Brimhaven fare is in inventory. */
async function pickpocketForBoatFare(): Promise<void> {
    const need = BRIMHAVEN_BOAT_GP;
    const started = Date.now();
    log(`Need ${need}gp for Brimhaven boat — pickpocketing Karamja men (have ${coins()})`);
    while (coins() < need && Date.now() - started < 600_000) {
        await waitRespawn();
        await eatIfNeeded();
        if (pos().hp < 5) {
            intent(`Healing at ${pos().hp} hp before pickpocketing`);
            await sdk.waitForTicks(10);
            continue;
        }
        await walkToKaramjaMen();
        await bot.dismissBlockingUI();
        const npc =
            sdk.findNearbyNpc(/^man$/i, { reachable: true }) ??
            sdk.findNearbyNpc(/^woman$/i, { reachable: true }) ??
            sdk.findNearbyNpc(/^(man|woman)$/i);
        if (!npc) {
            log(`No men at ${pos().x},${pos().z} — waiting`);
            await sdk.waitForTicks(3);
            continue;
        }
        intent(`Pickpocketing ${npc.name} (${coins()}/${need} gp)`);
        const result = await bot.pickpocketNpc(npc);
        if (result.reason === 'stunned') await sdk.waitForTicks(6);
    }
    log(`Boat fare pocket ${coins()} gp`);
}

async function pickpocketMen(): Promise<void> {
    if (distTo(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z) > 8) {
        intent('Walking to Lumbridge men');
        await walkNear(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z, 4);
    }
    await bot.dismissBlockingUI();
    const npc =
        sdk.findNearbyNpc(/^man$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/^woman$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/^(man|woman)$/i);
    if (!npc) {
        await walkNear(LUMBRIDGE_MEN.x, LUMBRIDGE_MEN.z, 3);
        await sdk.waitForTicks(2);
        return;
    }
    intent(`Pickpocketing ${npc.name} (${coins()} gp)`);
    const result = await bot.pickpocketNpc(npc);
    if (result.reason === 'stunned') await sdk.waitForTicks(6);
}

async function portSarimToMusa(): Promise<void> {
    if (onKaramja() || inArdougne()) return;
    intent('Port Sarim sailor → Musa Point (30gp)');
    await walkNear(PORT_SARIM_DOCK.x, PORT_SARIM_DOCK.z, 4);
    const sailor =
        sdk.findNearbyNpc(/^captain tobias$/i) ??
        sdk.findNearbyNpc(/^seaman /i) ??
        sdk.findNearbyNpc(/sailor|seaman|captain tobias/i);
    if (!sailor) {
        log('No sailor at Port Sarim');
        return;
    }
    const startX = pos().x;
    await bot.talkTo(sailor);
    await clickBoatDialog();
    for (let i = 0; i < 40 && !onKaramja(); i++) {
        await crossGangplank();
        if (sdk.getDialog()?.isOpen) await clickBoatDialog();
        if (Math.abs(pos().x - startX) > 40) break;
        await sdk.waitForTicks(2);
    }
    log(`After Port Sarim boat: (${pos().x},${pos().z}) gp=${coins()}`);
    await leaveDockedShip();
}

function indoors(): boolean {
    return (sdk.getNearbyLocs() ?? []).some(
        (l) =>
            /piano|bed/i.test(l.name) &&
            (l.distance ?? 99) <= 2 &&
            l.reachable !== false
    );
}

async function leaveBuilding(): Promise<void> {
    if (!indoors()) return;
    log('Leaving a building');
    for (let i = 0; i < 8 && indoors(); i++) {
        await openNearbyGate();
        const door =
            sdk.findNearbyLoc(/^door$/i, { withOption: /open/i }) ??
            sdk.findNearbyLoc(/door/i, { withOption: /open/i });
        if (door) {
            await bot.openDoor(door);
            const tx = door.x ?? pos().x;
            const tz = door.z ?? pos().z;
            await sdk.sendWalk(tx + Math.sign(tx - pos().x || 1) * 2, tz, true);
        } else {
            await sdk.sendWalk(pos().x + 2, pos().z, true);
        }
        await sdk.waitForTicks(3);
    }
}

async function sendWalkNear(x: number, z: number, tolerance = 6, ms = 40_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (distTo(x, z) > tolerance && Date.now() < deadline) {
        await waitRespawn();
        if (pos().isDead) return;
        await leaveBuilding();
        await openNearbyGate();
        await sdk.sendWalk(x, z, true);
        await sdk.waitForTicks(3);
    }
}

/**
 * South of the Musa road (Tai Bwo / Kharazi fringe) the east hop at 2864,3154
 * is jungle. Collision from 2801,3112 reaches the Brimhaven cart track via this
 * northwest line, then the customs boat.
 */
async function walkSouthKaramjaToBrimhaven(): Promise<boolean> {
    const p = pos();
    if (!onKaramja() || p.z >= 3160 || p.x >= 2860) return false;
    log(`Walking south Karamja → Brimhaven @ ${p.x},${p.z}`);
    for (const hop of [
        { x: 2790, z: 3124 },
        { x: 2778, z: 3136 },
        { x: 2768, z: 3148 },
        { x: 2765, z: 3160 },
        { x: 2765, z: 3176 }
    ]) {
        if (distTo(BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z) <= 8) return true;
        if (distTo(hop.x, hop.z) <= 3) continue;
        await hopSendWalk(hop.x, hop.z, 3, 30_000);
    }
    return distTo(2765, 3176) <= 8;
}

async function musaToBrimhaven(): Promise<void> {
    await leaveDockedShip();
    if (await walkSouthKaramjaToBrimhaven()) return;
    if (!onMusa()) return;
    log('Walking Musa Point → Brimhaven');
    for (const wp of MUSA_TO_BRIMHAVEN) {
        if (!onMusa()) break;
        await walkNear(wp.x, wp.z, 8);
    }
    await walkNear(BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z, 5);
}

async function brimhavenToArdougne(): Promise<void> {
    if (inArdougne()) return;
    if (!onKaramja() || onMusa()) return;
    await leaveDockedShip();
    await walkSouthKaramjaToBrimhaven();
    intent('Brimhaven customs → Ardougne (30gp)');
    for (const wp of [
        { x: 2810, z: 3154 },
        { x: 2786, z: 3158 },
        { x: 2768, z: 3188 },
        { x: 2772, z: 3225 }
    ]) {
        if (inArdougne() || distTo(BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z) <= 6) break;
        await walkNear(wp.x, wp.z, 6);
    }
    await walkNear(BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z, 4);
    const customs = sdk.findNearbyNpc(/^customs officer$/i) ?? sdk.findNearbyNpc(/customs officer/i);
    if (!customs) {
        log('No Customs officer at Brimhaven');
        return;
    }
    await bot.talkTo(customs);
    await clickBoatDialog();
    for (let i = 0; i < 20 && !inArdougne(); i++) {
        if (sdk.getDialog()?.isOpen) await clickBoatDialog();
        else if (onDockedShip()) await leaveDockedShip();
        await sdk.waitForTicks(2);
    }
    log(`After Brimhaven boat: (${pos().x},${pos().z}) gp=${coins()}`);
}

async function leaveArdougneShip(): Promise<void> {
    if (pos().z < 3271 && sdk.findNearbyLoc(/gangplank/i)) {
        log('Leaving the Ardougne docks');
        await crossGangplank();
        await sdk.waitForTicks(3);
    }
    await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 8);
}

async function goToArdy(): Promise<void> {
    intent('Go to Ardougne (Port Sarim boats)');
    if (!onKaramja() && !inArdougne()) {
        await bankForBoat();
    } else {
        await leaveDockedShip();
    }

    while (coins() < 60 && !onKaramja() && !inArdougne()) {
        await waitRespawn();
        await pickpocketMen();
    }

    while (!inArdougne() || distTo(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z) > 25) {
        await bot.dismissBlockingUI();
        await waitRespawn();
        if (inArdougne()) {
            await leaveArdougneShip();
            if (distTo(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z) <= 25) break;
            continue;
        }
        if (onKaramja() && coins() < BRIMHAVEN_BOAT_GP) {
            await pickpocketForBoatFare();
            continue;
        }
        if (onMusa()) {
            await musaToBrimhaven();
            continue;
        }
        if (onKaramja()) {
            await brimhavenToArdougne();
            continue;
        }
        if (coins() < 30) {
            await pickpocketMen();
            continue;
        }
        await portSarimToMusa();
        if (!onKaramja()) await sdk.waitForTicks(3);
    }
    log(`Arrived Ardougne (${pos().x},${pos().z}) with ${coins()} gp`);
}

async function leaveHouse(): Promise<void> {
    if (!inHouse() && pos().x !== 2672) return;
    intent('Leaving the Ardougne house');
    const door = sdk.findNearbyLoc(/door/i, { withOption: /open/i });
    if (door) await bot.openDoor(door);
    await sdk.sendWalk(HOUSE_OUTSIDE.x, HOUSE_OUTSIDE.z, true);
    await sdk.waitForTicks(4);
}

/** Step south onto the market. The Catherby road is north of these houses, but the door is south. */
async function leaveNorthEastArdy(): Promise<void> {
    if (!inNorthEastArdy()) return;
    log(`Leaving NE Ardougne @ ${pos().x},${pos().z}`);
    for (let i = 0; i < 10 && inNorthEastArdy(); i++) {
        const door = sdk.findNearbyLoc(/door/i, { withOption: /open/i });
        if (door && (door.distance ?? 99) <= 4) await bot.openDoor(door);
        const p = pos();
        if (!inNorthEastArdy()) return;
        const hop = p.z >= 3316 ? { x: p.x, z: p.z - 2 } : { x: p.x - 2, z: p.z };
        await sdk.sendWalk(hop.x, hop.z, true);
        await sdk.waitForTicks(4);
    }
    if (inNorthEastArdy()) log(`Still in NE Ardougne @ ${pos().x},${pos().z}`);
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
    intent('Leaving the Legends Guild');
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

async function leaveHandelmortMansion(): Promise<void> {
    const p = pos();
    if (!inHandelmortMansion(p.x, p.z)) return;
    log(`Leaving mansion yard @ ${p.x},${p.z}`);
    const dest = HANDELMORT_SAFE_EAST;
    const hops = [
        { x: Math.min(p.x + 5, dest.x), z: p.z },
        { x: dest.x, z: p.z },
        dest
    ];
    for (const hop of hops) {
        if (!inHandelmortMansion(pos().x, pos().z)) return;
        await hopSendWalk(hop.x, hop.z, 2, 12_000);
    }
}

async function walkToCatherby(): Promise<void> {
    if (inCatherby()) return;
    await leaveHandelmortMansion();
    await leaveHouse();
    await leaveNorthEastArdy();
    const p = pos();
    if (p.x < 2662 && p.z >= 3320 && p.z <= 3380) {
        log(`Hopping east of Ardougne houses @ ${p.x},${p.z}`);
        await hopSendWalk(2662, 3336, 3, 25_000);
    }
    // The north road tile is walkable, but walkTo from the house mouth reports
    // no waypoints and the whole fleet stacks on 2662,3335. Step north first.
    const mouth = pos();
    if (mouth.x >= 2648 && mouth.x <= 2672 && mouth.z >= 3328 && mouth.z < 3370) {
        log(`Hopping north out of Ardougne @ ${mouth.x},${mouth.z}`);
        await hopSendWalk(2662, 3375, 4, 45_000);
    }
    if (!inArdougne() && !onArdyCatherbyRoad() && !inKeepLeFaye() && !inLegendsGuild()) {
        await goToArdy();
    }
    intent('Walking Ardougne → Catherby');
    await walkWaypoints(ARDY_TO_CATHERBY);
}

function harryCount(item: RegExp): number {
    return sdk.getState()?.shop?.shopItems.find((i) => item.test(i.name))?.count ?? 0;
}

async function walkToHarry(): Promise<void> {
    if (distTo(HARRY.x, HARRY.z) <= 3) return;
    if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (!inCatherby()) {
        await walkToCatherby();
        if (!inCatherby()) return;
    }
    log(`Hopping to Harry @ ${pos().x},${pos().z} → ${HARRY.x},${HARRY.z}`);
    // Straight east from the bank runs into the range house. This is the walkable
    // corridor: south of the booth, then along the north road to Harry.
    await walkCatherbyHops(
        [
            { x: 2814, z: 3440 },
            { x: 2816, z: 3440 },
            { x: 2816, z: 3443 },
            { x: 2821, z: 3445 },
            { x: 2824, z: 3444 },
            { x: 2832, z: 3445 },
            { x: 2833, z: 3445 }
        ],
        { x: 2833, z: 3445 }
    );
}

async function openHarry(): Promise<boolean> {
    await walkToHarry();
    if (distTo(HARRY.x, HARRY.z) > 5) {
        if (!inCatherby()) {
            log(`Harry still ${Math.round(distTo(HARRY.x, HARRY.z))} tiles — not in Catherby @ ${pos().x},${pos().z}`);
            return false;
        }
        log(`Harry still ${Math.round(distTo(HARRY.x, HARRY.z))} tiles @ ${pos().x},${pos().z}`);
        await hopSendWalk(HARRY.x, HARRY.z, 3, 20_000);
    }
    if (sdk.getState()?.shop?.isOpen) return true;
    const opened = await bot.openShop(/harry/i);
    if (opened.success || sdk.getState()?.shop?.isOpen) return true;
    log(`Harry shop failed: ${opened.message} @ ${pos().x},${pos().z}`);
    return false;
}

async function pickpocketCatherbyUntil(need: number): Promise<void> {
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
    if (!inCatherby()) {
        await walkToCatherby();
    }
    if (inCatherby() && distTo(CATHERBY_MEN.x, CATHERBY_MEN.z) > 4) {
        if (pos().z < 3444 && pos().x <= 2814) await hopSendWalk(2809, 3441, 2, 10_000);
        await hopSendWalk(CATHERBY_MEN.x, CATHERBY_MEN.z, 3, 20_000);
    }
    const started = Date.now();
    while (coins() < need && Date.now() - started < 240_000) {
        if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
        if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
        if (sdk.getState()?.bank?.isOpen || sdk.getState()?.shop?.isOpen) {
            log('Pickpocket skipped — bank/shop still open');
            break;
        }
        await waitRespawn();
        await eatIfNeeded();
        if (pos().hp < 5) {
            intent(`Healing at ${pos().hp} hp before pickpocketing`);
            await sdk.waitForTicks(10);
            continue;
        }
        await bot.dismissBlockingUI();
        const npc =
            sdk.findNearbyNpc(/^man$/i, { reachable: true }) ??
            sdk.findNearbyNpc(/^woman$/i, { reachable: true });
        if (!npc) {
            await sdk.waitForTicks(2);
            continue;
        }
        intent(`Pickpocketing ${npc.name} (${coins()}/${need} gp)`);
        const result = await bot.pickpocketNpc(npc);
        if (result.reason === 'stunned') await sdk.waitForTicks(6);
    }
}

async function withdrawBankCoins(need: number): Promise<boolean> {
    if (coins() >= need) return true;
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (!sdk.getState()?.bank?.isOpen) {
        const bank = inCatherby() ? CATHERBY_BANK : closestBank();
        if (!(await openBankAt(bank.x, bank.z))) return coins() >= need;
    }
    await ensureBankItemMode();
    const r = await bot.withdrawItem(/^coins$/i, Math.max(need, COIN_WITHDRAW), { asNote: false });
    if (coins() < need) log(`Withdraw coins: ${r.message} have=${coins()} need=${need}`);
    if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
    return coins() >= need;
}

async function ensureCoins(need: number): Promise<boolean> {
    if (coins() >= need) return true;
    log(`Need ${need}gp, have ${coins()} — withdrawing from Catherby bank`);
    if (await withdrawBankCoins(need)) {
        log(`Bank coins ${coins()} gp`);
        return true;
    }
    log(`Need ${need}gp, have ${coins()} — pickpocketing Catherby men`);
    await pickpocketCatherbyUntil(need);
    log(`After Catherby men: ${coins()} gp`);
    return coins() >= need;
}

/** Stay on Harry and wait for restocks. `minSpawns` is how many stock appearances (or 90s cycles) to sit through. */
async function buyHarryItem(item: RegExp, have: () => boolean, minSpawns: number, label: string): Promise<boolean> {
    if (have()) return true;
    intent(`Buying a ${label} from Harry's`);
    let spawns = 0;
    while (!have() && spawns < minSpawns) {
        if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
        if (!(await openHarry())) {
            await sdk.waitForTicks(4);
            continue;
        }
        const stock = harryCount(item);
        if (stock > 0) {
            spawns++;
            log(`Harry ${label} spawn ${spawns}/${minSpawns} stock=${stock} gp=${coins()}`);
            const bought = await bot.buyFromShop(item, 1);
            log(`Buy ${label}: ${bought.success || bought.partial} ${bought.message ?? ''}`);
            if (have()) break;
            continue;
        }
        log(`Harry ${label} out of stock — waiting spawn ${spawns + 1}/${minSpawns}`);
        const appeared = await sdk
            .waitForCondition((s) => (s.shop?.shopItems.find((i) => item.test(i.name))?.count ?? 0) > 0, 90_000)
            .then(() => true)
            .catch(() => false);
        if (!appeared) {
            spawns++;
            log(`Harry ${label} no restock in 90s (cycle ${spawns}/${minSpawns})`);
        }
    }
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    return have();
}

async function withdrawHarpoonAt(x: number, z: number, label: string): Promise<boolean> {
    intent(`${label} bank for harpoon`);
    if (!(await openBankAt(x, z))) return false;
    await ensureBankItemMode();
    if (!hasHarpoon()) {
        const r = await bot.withdrawItem(/^harpoon$/i, 1, { asNote: false });
        if (!hasHarpoon()) {
            log(`Withdraw harpoon: ${r.message}`);
            logBank();
            await ensureBankItemMode();
            const retry = await bot.withdrawItem(/^harpoon$/i, 1, { asNote: false });
            if (!hasHarpoon()) log(`Withdraw harpoon retry: ${retry.message}`);
        }
    }
    await bot.closeBank();
    return hasHarpoon();
}

async function setupFishingGear(): Promise<boolean> {
    if (BIG_NET) return bigNetRamp() ? setupSmallNet() : setupBigNet();
    if (smallNetPhase()) return setupSmallNet();
    if (hasHarpoon()) {
        log(`Harpoon setup harpoon=true gp=${coins()} inv=${invSummary()}`);
        return true;
    }
    const nearest = closestBank();
    if (await withdrawHarpoonAt(nearest.x, nearest.z, nearest.name)) {
        log(`Harpoon setup harpoon=true gp=${coins()} inv=${invSummary()} worn=${sdk.getEquipment().length}`);
        return true;
    }
    if (distTo(CATHERBY_BANK.x, CATHERBY_BANK.z) > 8) {
        if (await withdrawHarpoonAt(CATHERBY_BANK.x, CATHERBY_BANK.z, 'Catherby')) {
            log(`Harpoon setup harpoon=true gp=${coins()} inv=${invSummary()}`);
            return true;
        }
    }

    if (await ensureCoins(HARPOON_GP)) {
        await buyHarryItem(/^harpoon$/i, hasHarpoon, HARRY_HARPOON_SPAWNS, 'harpoon');
    }
    if (hasHarpoon()) {
        if (coins() > 20 && (await openBankAt(CATHERBY_BANK.x, CATHERBY_BANK.z))) {
            await bot.depositItem(/^coins$/i, -1).catch(() => {});
            if (hasLobsterPot()) await bot.depositItem(/^lobster pot$/i, 1).catch(() => {});
            await bot.closeBank();
        }
        log(`Harpoon setup harpoon=true gp=${coins()} inv=${invSummary()}`);
        return true;
    }

    if (SHARK) {
        log(`No harpoon after ${HARRY_HARPOON_SPAWNS} Harry spawns — a lobster pot cannot fish shark, retrying`);
        return false;
    }
    log('No harpoon after 5 Harry spawns — buying a lobster pot');
    if (await ensureCoins(LOBSTER_POT_GP)) {
        await buyHarryItem(/^lobster pot$/i, hasLobsterPot, 8, 'lobster pot');
    }
    if (hasLobsterPot() && coins() > 20 && (await openBankAt(CATHERBY_BANK.x, CATHERBY_BANK.z))) {
        await bot.depositItem(/^coins$/i, -1).catch(() => {});
        await bot.closeBank();
    }
    log(`Tool setup harpoon=${hasHarpoon()} pot=${hasLobsterPot()} gp=${coins()} inv=${invSummary()}`);
    return hasFishingTool();
}

async function setupBigNet(): Promise<boolean> {
    await dropBigNetJunk();
    if (hasBigNet()) {
        log(`Big net setup net=true gp=${coins()} inv=${invSummary()}`);
        return true;
    }
    intent('Catherby bank for big fishing net');
    if (await openBankAt(CATHERBY_BANK.x, CATHERBY_BANK.z)) {
        await ensureBankItemMode();
        if (!hasBigNet()) await bot.withdrawItem(BIG_NET_KEEP, 1, { asNote: false }).catch(() => {});
        await depositAllExcept(toolKeep());
        if (!hasBigNet()) {
            await ensureBankItemMode();
            await bot.withdrawItem(BIG_NET_KEEP, 1, { asNote: false }).catch(() => {});
        }
        if (!hasBigNet() && coins() < BIG_NET_GP) {
            const r = await bot.withdrawItem(/^coins$/i, COIN_WITHDRAW, { asNote: false });
            if (coins() < BIG_NET_GP) log(`Withdraw coins: ${r.message} have=${coins()}`);
        }
        await bot.closeBank();
        if (hasBigNet()) {
            log(`Big net setup net=true gp=${coins()} inv=${invSummary()}`);
            return true;
        }
    } else {
        log('Bank closed — buying a big net from Harry if needed');
    }

    if (await ensureCoins(BIG_NET_GP)) {
        await buyHarryItem(BIG_NET_KEEP, hasBigNet, HARRY_BIG_NET_SPAWNS, 'big fishing net');
    }
    if (hasBigNet() && coins() > 20 && (await openBankAt(CATHERBY_BANK.x, CATHERBY_BANK.z))) {
        await bot.depositItem(/^coins$/i, -1).catch(() => {});
        await bot.closeBank();
    }
    log(`Big net setup net=${hasBigNet()} gp=${coins()} inv=${invSummary()}`);
    return hasBigNet();
}

async function setupSmallNet(): Promise<boolean> {
    if (hasNet()) {
        log(`Small net setup net=true gp=${coins()} inv=${invSummary()}`);
        return true;
    }
    await closeBankHard();
    if (!inCatherby()) {
        if (!inArdougne() && !onArdyCatherbyRoad() && !inKeepLeFaye() && !inLegendsGuild()) {
            await goToArdy();
        }
        await walkToCatherby();
    }
    if (coins() < SMALL_NET_GP) {
        log(`Need ${SMALL_NET_GP}gp for a small net — pickpocketing (skip jammed bank)`);
        await pickpocketCatherbyUntil(SMALL_NET_GP);
    }
    if (coins() >= SMALL_NET_GP) {
        await buyHarryItem(/small fishing net/i, hasNet, HARRY_SMALL_NET_SPAWNS, 'small fishing net');
    }
    log(`Small net setup net=${hasNet()} gp=${coins()} inv=${invSummary()}`);
    return hasNet();
}

async function tryHarpoonBetweenRuns(): Promise<void> {
    if (hasHarpoon()) return;
    intent('Looking for a harpoon between lobster runs');
    if (await openBankAt(CATHERBY_BANK.x, CATHERBY_BANK.z)) {
        await bot.withdrawItem(/^harpoon$/i, 1).catch(() => {});
        await bot.closeBank();
    }
    if (hasHarpoon()) {
        log('Withdrew a harpoon from bank');
        return;
    }
    if (!(await ensureCoins(HARPOON_GP))) return;
    await buyHarryItem(/^harpoon$/i, hasHarpoon, 1, 'harpoon');
    if (hasHarpoon()) log('Bought a harpoon between lobster runs');
}

async function withdrawFishingTool(): Promise<void> {
    if (BIG_NET) {
        if (bigNetRamp()) {
            if (!hasNet()) await bot.withdrawItem(/small fishing net/i, 1).catch(() => {});
            return;
        }
        if (!hasBigNet()) await bot.withdrawItem(BIG_NET_KEEP, 1).catch(() => {});
        return;
    }
    if (smallNetPhase() || sharkNetRamp() || thieveSupplyNet()) {
        if (!hasNet()) await bot.withdrawItem(/small fishing net/i, 1).catch(() => {});
        if ((sharkNetRamp() || THIEVE_SUPPLY > 0) && !hasHarpoon()) {
            await bot.withdrawItem(/^harpoon$/i, 1).catch(() => {});
        }
        return;
    }
    if (!hasHarpoon()) await bot.withdrawItem(/^harpoon$/i, 1).catch(() => {});
    if (!hasHarpoon() && !hasLobsterPot()) await bot.withdrawItem(/^lobster pot$/i, 1).catch(() => {});
    if (hasHarpoon() && hasLobsterPot()) await bot.depositItem(/^lobster pot$/i, 1).catch(() => {});
}

function spotHas(spot: { optionsWithIndex: { text: string }[] }, option: RegExp): boolean {
    return spot.optionsWithIndex.some((o) => option.test(o.text));
}

function findTunaSwordSpot() {
    const spots = (sdk.getNearbyNpcs() ?? []).filter((n) => /fishing spot/i.test(n.name));
    const tuna = spots.filter((s) => spotHas(s, /^harpoon$/i) && spotHas(s, /^cage$/i));
    return tuna.sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null;
}

/** Nearest static-walkable tile. Fishing spots themselves sit on water. */
function standNear(x: number, z: number): { x: number; z: number } {
    if (isTileWalkable(0, x, z)) return { x, z };
    for (let r = 1; r <= 4; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
                if (isTileWalkable(0, x + dx, z + dz)) return { x: x + dx, z: z + dz };
            }
        }
    }
    return { x, z };
}

/**
 * One step, then wait until the tile actually changes. Re-issuing sendWalk
 * every 450ms cancelled the step before the player left the tile, so the
 * bank-to-pier hop sat on 2821,3436 forever.
 */
async function hopSendWalk(x: number, z: number, tolerance: number, ms: number): Promise<void> {
    const deadline = Date.now() + ms;
    let stalls = 0;
    while (distTo(x, z) > tolerance && Date.now() < deadline) {
        const p = pos();
        let stepX = p.x + Math.sign(x - p.x) * Math.min(2, Math.abs(x - p.x));
        let stepZ = p.z + Math.sign(z - p.z) * Math.min(2, Math.abs(z - p.z));
        if (stalls > 0 || !isTileWalkable(0, stepX, stepZ)) {
            const options: { x: number; z: number; score: number }[] = [];
            for (const [dx, dz] of [
                [0, -1],
                [0, 1],
                [-1, 0],
                [1, 0],
                [0, -2],
                [0, 2],
                [-2, 0],
                [2, 0],
                [1, -1],
                [-1, -1],
                [1, 1],
                [-1, 1]
            ]) {
                const nx = p.x + dx;
                const nz = p.z + dz;
                if (!isTileWalkable(0, nx, nz)) continue;
                options.push({ x: nx, z: nz, score: Math.hypot(nx - x, nz - z) });
            }
            options.sort((a, b) => a.score - b.score);
            const pick = options[Math.min(stalls, Math.max(0, options.length - 1))];
            if (!pick) {
                await openNearbyDoor();
                stalls++;
                await sdk.waitForTicks(1);
                continue;
            }
            stepX = pick.x;
            stepZ = pick.z;
        }
        const beforeX = p.x;
        const beforeZ = p.z;
        await sdk.sendWalk(stepX, stepZ, true);
        const moved = await sdk
            .waitForCondition((s) => {
                const px = s.player?.worldX ?? beforeX;
                const pz = s.player?.worldZ ?? beforeZ;
                return px !== beforeX || pz !== beforeZ;
            }, 2_000)
            .then(() => true)
            .catch(() => false);
        if (moved) stalls = 0;
        else {
            await openNearbyDoor();
            stalls++;
        }
    }
}

/** Skip hops that are behind us. `dest` is a walkable stand, not a water spot. */
async function walkCatherbyHops(hops: { x: number; z: number }[], dest: { x: number; z: number }): Promise<void> {
    for (const hop of hops) {
        if (distTo(dest.x, dest.z) <= 3) return;
        const via = Math.hypot(hop.x - dest.x, hop.z - dest.z);
        if (via > distTo(dest.x, dest.z) + 2) continue;
        if (distTo(hop.x, hop.z) <= 2) continue;
        await hopSendWalk(hop.x, hop.z, 2, 15_000);
    }
}

async function leaveCatherbyBankToPier(dest: { x: number; z: number }): Promise<void> {
    await closeBankHard();
    await dismissCookDialog();
    await exitCatherbyNorthBuildings();
    const stand = standNear(dest.x, dest.z);
    if (onCatherbyBankStreet()) log(`Leaving Catherby bank street @ ${pos().x},${pos().z}`);
    // 2837,3431 is water. The road is 2836,3436 then south onto 2838,3432.
    await walkCatherbyHops(
        [
            { x: 2814, z: 3440 },
            { x: 2816, z: 3438 },
            { x: 2836, z: 3436 },
            { x: 2836, z: 3434 },
            { x: 2838, z: 3432 },
            stand
        ],
        stand
    );
}

async function huntHarpoonSpot() {
    let spot = findTunaSwordSpot();
    if (spot && (spot.distance ?? 99) <= 8) return spot;
    const dest = spot ? { x: spot.x, z: spot.z } : PIER[pierHunt++ % PIER.length]!;
    log(`Harpoon hunt ${dest.x},${dest.z} @ ${pos().x},${pos().z}`);
    await leaveCatherbyBankToPier(dest);
    return findTunaSwordSpot();
}

function findBigNetSpot() {
    const spots = (sdk.getNearbyNpcs() ?? []).filter((n) => /fishing spot/i.test(n.name));
    const net = spots.filter(
        (s) => spotHas(s, /^net$/i) && spotHas(s, /^harpoon$/i) && !spotHas(s, /^cage$/i) && !spotHas(s, /^bait$/i)
    );
    return net.sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null;
}

async function huntBigNetSpot() {
    let spot = findBigNetSpot();
    if (spot && (spot.distance ?? 99) <= 8) return spot;
    const dest = spot ? { x: spot.x, z: spot.z } : PIER[pierHunt++ % PIER.length]!;
    log(`Net hunt ${dest.x},${dest.z} @ ${pos().x},${pos().z}`);
    await leaveCatherbyBankToPier(dest);
    return findBigNetSpot();
}

function findSmallNetSpot() {
    const spots = (sdk.getNearbyNpcs() ?? []).filter((n) => /fishing spot/i.test(n.name));
    const net = spots.filter(
        (s) => spotHas(s, /^net$/i) && spotHas(s, /^bait$/i) && !spotHas(s, /^harpoon$/i)
    );
    return net.sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null;
}

async function huntSmallNetSpot() {
    let spot = findSmallNetSpot();
    if (spot && (spot.distance ?? 99) <= 8) return spot;
    const dest = spot ? { x: spot.x, z: spot.z } : CATHERBY_NET_BAIT[pierHunt++ % CATHERBY_NET_BAIT.length]!;
    log(`Small-net hunt ${dest.x},${dest.z} @ ${pos().x},${pos().z}`);
    await leaveCatherbyBankToPier(dest);
    return findSmallNetSpot();
}

async function dropBigNetJunk(): Promise<number> {
    await closeBankHard();
    let n = 0;
    for (let i = 0; i < 28; i++) {
        const item = sdk.getInventory().find(
            (it) => BIG_NET_DROP.test(it.name) && !BIG_NET_TREASURE.test(it.name) && (it.count ?? 0) > 0
        );
        if (!item) break;
        const r = await bot.dropItem(item, 1);
        if (!r.success) {
            log(`Drop ${item.name} failed: ${r.message}`);
            break;
        }
        n++;
    }
    return n;
}

async function openCaskets(): Promise<number> {
    let n = 0;
    for (let i = 0; i < 28; i++) {
        await bot.dismissBlockingUI();
        const casket = sdk.getInventory().find((it) => CASKET.test(it.name) && (it.count ?? 0) > 0);
        if (!casket) break;
        const open = casket.optionsWithIndex.find((o) => /^open$/i.test(o.text));
        const slot = casket.slot;
        await sdk.sendUseItem(slot, open?.opIndex ?? 1);
        try {
            await sdk.waitForCondition((s) => {
                if (s.dialog.isOpen) return true;
                return !s.inventory.some((it) => it.slot === slot && CASKET.test(it.name));
            }, 4_000);
        } catch {
            /* recast */
        }
        await bot.dismissBlockingUI();
        n++;
    }
    return n;
}

async function openRangeDoor(): Promise<void> {
    const door = sdk.findNearbyLoc(/^door$/i, { withOption: /^open$/i });
    if (!door || (door.distance ?? 99) > 6) return;
    await bot.openDoor(door);
}

function findRange() {
    const ranges = (sdk.getNearbyLocs() ?? []).filter((l) => /^range$/i.test(l.name));
    return ranges.find((l) => l.reachable) ?? ranges[0] ?? null;
}

async function goToRange(): Promise<boolean> {
    if (distTo(RANGE_STAND.x, RANGE_STAND.z) > 1) {
        if (distTo(RANGE_OUTSIDE.x, RANGE_OUTSIDE.z) > 2) {
            await hopSendWalk(RANGE_OUTSIDE.x, RANGE_OUTSIDE.z, 2, 8_000);
        }
        await openRangeDoor();
        await hopSendWalk(RANGE_STAND.x, RANGE_STAND.z, 1, 8_000);
    }
    await openRangeDoor();
    return !!findRange();
}

async function dismissCookDialog(): Promise<void> {
    for (let i = 0; i < 8; i++) {
        await bot.dismissBlockingUI();
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) return;
        const cook = dialog.options.find((o) => /^(cook|make)\b/i.test(o.text));
        if (cook) {
            await sdk.sendClickDialog(cook.index);
            await sdk.waitForTicks(2);
            continue;
        }
        const cont = dialog.options.find((o) => /continue|click here/i.test(o.text));
        if (cont) {
            await sdk.sendClickDialog(cont.index);
            await sdk.waitForTicks(2);
            continue;
        }
        await sdk.sendClickDialog(dialog.options[0]?.index ?? 0);
        await sdk.waitForTicks(2);
    }
}

function invTunaSword(): number {
    return countItems(/^tuna$/i) + countItems(/^swordfish$/i);
}

const THIEVE_SUPPLY_PATH = () => join(process.cwd(), 'bots', username, 'thieve-supply.json');
let thieveSupplyCooked = 0;

function loadThieveSupply(): void {
    if (THIEVE_SUPPLY <= 0) return;
    try {
        const saved = JSON.parse(readFileSync(THIEVE_SUPPLY_PATH(), 'utf-8')) as { cooked?: number };
        thieveSupplyCooked = Math.max(0, Number(saved.cooked) || 0);
    } catch {
        thieveSupplyCooked = 0;
    }
}

function noteThieveSupply(gained: number): void {
    if (THIEVE_SUPPLY <= 0 || gained <= 0) return;
    thieveSupplyCooked += gained;
    writeFileSync(THIEVE_SUPPLY_PATH(), JSON.stringify({ cooked: thieveSupplyCooked, target: THIEVE_SUPPLY }));
    log(`Thieve supply ${thieveSupplyCooked}/${THIEVE_SUPPLY} cooked tuna/swordfish`);
    session.noteProgress('inventory', `thieve supply ${thieveSupplyCooked}/${THIEVE_SUPPLY}`);
}

function returnToThieving(): void {
    try {
        unlinkSync(THIEVE_SUPPLY_PATH());
    } catch {
        /* already gone */
    }
    const rosterPath = join(process.cwd(), 'bots', 'roster.json');
    const raw = readFileSync(rosterPath, 'utf-8');
    const nameAt = raw.search(new RegExp(`"name": "${username}"`, 'i'));
    if (nameAt < 0) {
        session.stop('script_error', 'thieve supply done but roster name missing');
        return;
    }
    const rest = raw.slice(nameAt + 10);
    const nextName = rest.search(/"name":/);
    const end = nextName < 0 ? raw.length : nameAt + 10 + nextName;
    let block = raw.slice(nameAt, end);
    const rosterName = block.match(/"name": "([^"]+)"/)?.[1] ?? username;
    const argsBody = `\n                "${rosterName}"\n            `;
    block = block.replace(/"script": "[^"]+"/, '"script": "bots/quests/thieving-route.ts"');
    block = block.replace(/"args": \[[\s\S]*?\]/, `"args": [${argsBody}]`);
    writeFileSync(rosterPath, raw.slice(0, nameAt) + block + raw.slice(end));
    log(`Cooked ${thieveSupplyCooked} tuna/swordfish — roster job is thieving again`);
    const launchd = join(process.cwd(), '.cursor/skills/wake-fleet/scripts/fleet-launchd.ts');
    const child = spawn('bun', [launchd, 'restart', rosterName], {
        cwd: process.cwd(),
        detached: true,
        stdio: 'ignore'
    });
    child.unref();
    session.stop('thieve_supply_done', 'cooked tuna/swordfish quota — back to thieving');
}

async function bankSupplyAndMaybeReturn(): Promise<boolean> {
    if (THIEVE_SUPPLY <= 0 || thieveSupplyCooked < THIEVE_SUPPLY) return false;
    if (invTunaSword() > 0 || countItems(/^raw (tuna|swordfish)$/i) > 0) await bankCatherbyCatch();
    returnToThieving();
    return true;
}

async function cookInventory(
    rawPat: RegExp = RAW,
    bankStock = false
): Promise<{ cooked: number; burnt: number; xp: number; leftover: number }> {
    if (!cookableRaw(rawPat, bankStock)) {
        return { cooked: 0, burnt: 0, xp: 0, leftover: countItems(rawPat) };
    }
    if (!(await goToRange())) return { cooked: 0, burnt: 0, xp: 0, leftover: countItems(rawPat) };

    const supplyBefore = invTunaSword();
    const startXp = cookingXp();
    const startBurnt = countItems(BURNT);
    const startCooked = countItems(COOKED);
    let idleCasts = 0;

    while (cookableRaw(rawPat, bankStock) && idleCasts < 80) {
        await dismissCookDialog();
        const dialog = sdk.getDialog();
        if (dialog?.isOpen) {
            await sdk.waitForTicks(1);
            idleCasts++;
            continue;
        }
        if (distTo(RANGE_STAND.x, RANGE_STAND.z) > 1) {
            await hopSendWalk(RANGE_STAND.x, RANGE_STAND.z, 1, 6_000);
            await openRangeDoor();
        }
        const raw = cookableRaw(rawPat, bankStock);
        const range = findRange();
        if (!raw || !range) {
            idleCasts++;
            if (!(await goToRange())) break;
            continue;
        }
        const xpBefore = cookingXp();
        const rawBefore = countItems(new RegExp(`^${raw.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
        try {
            await sdk.sendUseItemOnLoc(raw.slot, range.x, range.z, range.id);
            await sdk.waitForCondition((s) => {
                if (s.dialog.isOpen) return true;
                const xp = s.skills.find((sk) => sk.name === 'Cooking')?.experience ?? 0;
                if (xp > xpBefore) return true;
                const rawNow = s.inventory.filter((i) => i.name === raw.name).reduce((n, i) => n + i.count, 0);
                return rawNow < rawBefore;
            }, 4_000);
        } catch {
            if (!sdk.isConnected()) {
                await sdk.waitForConnection().catch(() => {});
            }
        }
        const rawAfter = countItems(new RegExp(`^${raw.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
        if (cookingXp() === xpBefore && rawAfter === rawBefore) idleCasts++;
        else idleCasts = 0;
    }

    await exitCatherbyNorthBuildings();
    noteThieveSupply(invTunaSword() - supplyBefore);
    return {
        cooked: countItems(COOKED) - startCooked,
        burnt: countItems(BURNT) - startBurnt,
        xp: cookingXp() - startXp,
        leftover: countItems(rawPat)
    };
}

async function withdrawCookableRaw(bankStock = false): Promise<number> {
    while (occupiedSlots() < 28) {
        const items = (sdk.getBankItems() ?? []).filter((i) => RAW_ANY.test(i.name) && canCookItem(i.name, bankStock));
        const item = items.find((i) => RAW_SMALL.test(i.name)) ?? items[0];
        if (!item) break;
        const before = occupiedSlots();
        const r = await bot.withdrawItem(item, -1);
        if (!r.success && !r.partial) break;
        if ((r.amountWithdrawn ?? 0) <= 0 && occupiedSlots() === before) break;
    }
    return sdk.getInventory().filter((i) => RAW_ANY.test(i.name) && canCookItem(i.name, bankStock)).length;
}

async function cookBankedUntilReady(all = false): Promise<void> {
    const limit = all || COOK_ALL ? 8000 : 80;
    let bankMisses = 0;
    if (all) await enterPhase('cook_bank');
    for (let loads = 0; loads < limit; loads++) {
        if (cookableRaw(RAW_ANY, all)) {
            const cooked = await cookInventory(RAW_ANY, all);
            if (all || COOK_ALL) session.noteProgress(cooked.xp > 0 ? 'xp' : 'inventory', `cook load ${loads + 1}`);
        }
        session.maybeHeartbeat();
        if (!(await openBankAt(CATHERBY_BANK.x, CATHERBY_BANK.z))) {
            log('Cook skip — bank closed');
            await exitCatherbyNorthBuildings();
            if (COOK_ALL || (all && bankMisses < 5)) {
                bankMisses++;
                await sdk.waitForTicks(8);
                continue;
            }
            return;
        }
        bankMisses = 0;
        await depositAllExcept(toolKeep());
        await withdrawFishingTool();
        const more = await withdrawCookableRaw(all);
        if (more <= 0) {
            await snapshotBank();
            await bot.closeBank();
            if (loads === 0) log('Cook skip — no banked raw');
            else if (all) log(`Cooked bank raw across ${loads} loads`);
            await exitCatherbyNorthBuildings();
            return;
        }
        log(`Withdrawn ${more} raw to cook (bank load ${loads + 1})`);
        await bot.closeBank();
    }
    await exitCatherbyNorthBuildings();
}

async function fishPierInventory(mode: 'harpoon' | 'cage') {
    const optRe = mode === 'harpoon' ? /^harpoon$/i : /^cage$/i;
    const startXp = fishingXp();
    const startTuna = countItems(/^raw tuna$/i);
    const startSword = countItems(/^raw swordfish$/i);
    const startLobster = countItems(/^raw lobster$/i);
    const startShark = countItems(/^raw shark$/i);
    let noSpot = 0;

    while (!inventoryIsFull()) {
        await bot.dismissBlockingUI();
        if (pos().isDead) break;
        let spot = findTunaSwordSpot();
        if (!spot || (spot.distance ?? 99) > 8) spot = await huntHarpoonSpot();
        if (!spot) {
            noSpot++;
            if (noSpot === 1 || noSpot % 5 === 0) log(`No cage/harpoon spot (${noSpot}) @ ${pos().x},${pos().z}`);
            await sdk.waitForTicks(1);
            continue;
        }
        noSpot = 0;
        const match = spot.optionsWithIndex.find((o) => optRe.test(o.text));
        if (!match) {
            await sdk.waitForTicks(1);
            continue;
        }
        const invBefore = occupiedSlots();
        const xpBefore = fishingXp();
        const started = Date.now();
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
    }

    return {
        tuna: countItems(/^raw tuna$/i) - startTuna,
        sword: countItems(/^raw swordfish$/i) - startSword,
        lobster: countItems(/^raw lobster$/i) - startLobster,
        shark: countItems(/^raw shark$/i) - startShark,
        xp: fishingXp() - startXp
    };
}

async function bankCatherbyCatch(): Promise<boolean> {
    if (!(await openBankAt(CATHERBY_BANK.x, CATHERBY_BANK.z))) return false;
    await depositAllExcept(toolKeep());
    await withdrawFishingTool();
    await snapshotBank();
    const moreRaw = !NO_COOK && bankHasCookableRaw();
    await bot.closeBank();
    if (moreRaw) await cookBankedUntilReady(true);
    return true;
}

async function fishTrip(n: number, mode: 'harpoon' | 'cage'): Promise<void> {
    intent(`${mode === 'harpoon' ? 'Harpoon' : 'Cage lobster'} trip ${n} (fish ${fishingLevel()} cook ${cookingLevel()})`);
    const beforeFish = fishStacks();
    await dismissCookDialog();
    if (sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) await closeBankHard();
    if (!findTunaSwordSpot()) await huntHarpoonSpot();
    await fishPierInventory(mode);
    const cooked = await cookInventory(RAW);
    recordFishDeltas(beforeFish);
    const banked = await bankCatherbyCatch();
    if (cooked.leftover > 0 && cookingLevel() < 99) await cookBankedUntilReady();
    const qty = cooked.cooked + cooked.burnt;
    if (qty > 0 && banked) {
        session.recordTrip(qty);
        session.noteProgress('inventory', `${mode} trip ${n}`);
        return;
    }
    log(`Empty ${mode} trip ${n} banked=${banked} cooked=${qty} @ ${pos().x},${pos().z} inv=${invSummary()}`);
    await sdk.waitForTicks(8);
}

async function fishSmallNetInventory(): Promise<{ shrimp: number; anchovy: number; xp: number }> {
    const startXp = fishingXp();
    const startShrimp = countItems(/^raw shrimps?$/i);
    const startAnchovy = countItems(/^raw anchovies$/i);
    let noSpot = 0;

    while (!inventoryIsFull()) {
        await bot.dismissBlockingUI();
        if (pos().isDead) break;
        let spot = findSmallNetSpot();
        if (!spot || (spot.distance ?? 99) > 8) spot = await huntSmallNetSpot();
        if (!spot) {
            noSpot++;
            if (noSpot === 1 || noSpot % 5 === 0) log(`No net/bait spot (${noSpot}) @ ${pos().x},${pos().z}`);
            await sdk.waitForTicks(1);
            continue;
        }
        noSpot = 0;
        const match = spot.optionsWithIndex.find((o) => /^net$/i.test(o.text));
        if (!match) {
            await sdk.waitForTicks(1);
            continue;
        }
        const invBefore = occupiedSlots();
        const xpBefore = fishingXp();
        const started = Date.now();
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
    }

    return {
        shrimp: countItems(/^raw shrimps?$/i) - startShrimp,
        anchovy: countItems(/^raw anchovies$/i) - startAnchovy,
        xp: fishingXp() - startXp
    };
}

async function fishSmallNetTrip(n: number): Promise<void> {
    intent(`Small-net trip ${n} (fish ${fishingLevel()} cook ${cookingLevel()})`);
    const beforeFish = fishStacks();
    await dismissCookDialog();
    if (sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) await closeBankHard();
    await ensureSmallNetBeach();
    if (!findSmallNetSpot()) await huntSmallNetSpot();
    const caught = await fishSmallNetInventory();
    const cooked = await cookInventory(RAW_SMALL);
    recordFishDeltas(beforeFish);
    const banked = await bankCatherbyCatch();
    if (cooked.leftover > 0) await cookSmallNetIfNeeded();
    const qty = cooked.cooked + cooked.burnt;
    if ((qty > 0 || caught.xp > 0) && banked) {
        session.recordTrip(Math.max(qty, caught.shrimp + caught.anchovy));
        // Only stamp 'xp' when XP was actually measured; cooked-with-no-XP
        // otherwise advances lastEffectAt on zero-effect trips and the fleet
        // reads a stuck bot as producing.
        session.noteProgress(caught.xp > 0 ? 'xp' : 'inventory', `smallnet trip ${n}`);
        log(
            `Small-net trip ${n} shrimp +${caught.shrimp} anchovy +${caught.anchovy} cooked=${qty} xp +${caught.xp} fish ${fishingLevel()}`
        );
        return;
    }
    log(`Empty small-net trip ${n} banked=${banked} cooked=${qty} @ ${pos().x},${pos().z} inv=${invSummary()}`);
    await sdk.waitForTicks(8);
}

async function fishBigNetInventory(): Promise<{ cod: number; bass: number; oyster: number; casket: number; xp: number }> {
    const startXp = fishingXp();
    const startCod = countItems(/^raw cod$/i);
    const startBass = countItems(/^raw bass$/i);
    const startOyster = countItems(OYSTER);
    let opened = 0;
    let noSpot = 0;

    while (true) {
        await bot.dismissBlockingUI();
        if (pos().isDead) break;
        const dropped = await dropBigNetJunk();
        opened += await openCaskets();
        if (inventoryIsFull() && dropped === 0) break;

        let spot = findBigNetSpot();
        if (!spot || (spot.distance ?? 99) > 8) spot = await huntBigNetSpot();
        if (!spot) {
            noSpot++;
            if (noSpot === 1 || noSpot % 5 === 0) log(`No net/harpoon spot (${noSpot}) @ ${pos().x},${pos().z}`);
            await sdk.waitForTicks(1);
            continue;
        }
        noSpot = 0;
        const match = spot.optionsWithIndex.find((o) => /^net$/i.test(o.text));
        if (!match) {
            await sdk.waitForTicks(1);
            continue;
        }
        const invBefore = occupiedSlots();
        const xpBefore = fishingXp();
        const started = Date.now();
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
    }

    await dropBigNetJunk();
    opened += await openCaskets();
    return {
        cod: countItems(/^raw cod$/i) - startCod,
        bass: countItems(/^raw bass$/i) - startBass,
        oyster: countItems(OYSTER) - startOyster,
        casket: opened,
        xp: fishingXp() - startXp
    };
}

function findSharkSpot() {
    return findBigNetSpot();
}

async function huntSharkSpot() {
    return huntBigNetSpot();
}

async function fishSharkInventory(): Promise<{ shark: number; xp: number }> {
    const startXp = fishingXp();
    const startShark = countItems(/^raw shark$/i);
    let noSpot = 0;

    while (!inventoryIsFull()) {
        await bot.dismissBlockingUI();
        if (pos().isDead) break;

        let spot = findSharkSpot();
        if (!spot || (spot.distance ?? 99) > 8) spot = await huntSharkSpot();
        if (!spot) {
            noSpot++;
            if (noSpot === 1 || noSpot % 5 === 0) log(`No net/harpoon shark spot (${noSpot}) @ ${pos().x},${pos().z}`);
            await sdk.waitForTicks(1);
            continue;
        }
        noSpot = 0;
        const match = spot.optionsWithIndex.find((o) => /^harpoon$/i.test(o.text));
        if (!match) {
            await sdk.waitForTicks(1);
            continue;
        }
        const invBefore = occupiedSlots();
        const xpBefore = fishingXp();
        const started = Date.now();
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
    }

    return {
        shark: countItems(/^raw shark$/i) - startShark,
        xp: fishingXp() - startXp
    };
}

async function fishSharkTrip(n: number): Promise<void> {
    intent(`Shark harpoon trip ${n} (fish ${fishingLevel()} cook ${cookingLevel()})`);
    let beforeFish = fishStacks();
    await dismissCookDialog();
    if (sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) await closeBankHard();

    if (inventoryIsFull() || occupiedSlots() >= 26) {
        log(`Shark trip ${n} — full inv (${occupiedSlots()} slots) @ ${pos().x},${pos().z}`);
        const precook = cookingLevel() < 99 ? await cookInventory(RAW) : { cooked: 0, burnt: 0, xp: 0, leftover: 0 };
        recordFishDeltas(beforeFish);
        const banked = await bankCatherbyCatch();
        beforeFish = fishStacks();
        if (inventoryIsFull() && !banked) {
            log(`Full inv, bank failed — stepping off booth @ ${pos().x},${pos().z}`);
            await stepOffCatherbyBank();
            await sdk.waitForTicks(5);
            return;
        }
        if (banked) {
            session.recordTrip(Math.max(1, precook.cooked));
            session.noteProgress('inventory', `shark bank-only ${n}`);
            log(`Banked full inv before fish ${n} | cook=${precook.cooked}`);
        }
    }

    if (!findSharkSpot()) await huntSharkSpot();
    const caught = await fishSharkInventory();
    const cooked = await cookInventory(RAW);
    recordFishDeltas(beforeFish);
    const banked = await bankCatherbyCatch();
    if (cooked.leftover > 0 && cookingLevel() < 99) await cookBankedUntilReady();
    const qty = caught.shark + cooked.cooked + cooked.burnt;
    if (qty > 0 && banked) {
        session.recordTrip(qty);
        session.noteProgress('inventory', `shark trip ${n} raw=${caught.shark} cook=${cooked.cooked}`);
        log(`Banked shark trip ${n} | raw ${caught.shark} cook ${cooked.cooked} xp ${caught.xp}`);
        return;
    }
    if (!banked && (caught.shark > 0 || cooked.cooked > 0)) await stepOffCatherbyBank();
    log(`Empty shark trip ${n} banked=${banked} cooked=${cooked.cooked} @ ${pos().x},${pos().z} inv=${invSummary()}`);
    await sdk.waitForTicks(8);
}

async function fishBigNetTrip(n: number): Promise<void> {
    intent(`Big net trip ${n} (fish ${fishingLevel()} cook ${cookingLevel()})`);
    const beforeFish = fishStacks();
    if (!findBigNetSpot()) await huntBigNetSpot();
    const caught = await fishBigNetInventory();
    const cooked = await cookInventory(cookRawPattern());
    await dropBigNetJunk();
    recordFishDeltas(beforeFish);
    const banked = await bankCatherbyCatch();
    if (cooked.leftover > 0 && cookingLevel() < 99) await cookBankedUntilReady();
    const qty = caught.cod + caught.bass + caught.oyster + cooked.cooked;
    if (qty > 0 && banked) {
        session.recordTrip(qty);
        session.noteProgress(
            'inventory',
            `bignet trip ${n} cod=${caught.cod} bass=${caught.bass} oyster=${caught.oyster} casket=${caught.casket}`
        );
        log(
            `Banked net trip ${n} | cod ${caught.cod} bass ${caught.bass} oyster ${caught.oyster} opened ${caught.casket} cook ${cooked.cooked}`
        );
        return;
    }
    log(`Empty bignet trip ${n} banked=${banked} @ ${pos().x},${pos().z} inv=${invSummary()}`);
    await sdk.waitForTicks(8);
}

function logLevels(): void {
    const fish = fishingLevel();
    const cmb = combatLevel();
    const cook = cookingLevel();
    if (fish !== lastLoggedFishing) {
        session.log('log', `LEVEL UP Fishing ${fish} | ${sdk.getSkill('Fishing')?.experience} xp`);
        session.noteProgress('xp', `fishing ${fish}`);
        lastLoggedFishing = fish;
    }
    if (cmb !== lastLoggedCombat) {
        log(`Combat ${cmb} | Atk ${sdk.getSkill('Attack')?.baseLevel} Str ${sdk.getSkill('Strength')?.baseLevel} HP ${sdk.getSkill('Hitpoints')?.baseLevel}`);
        lastLoggedCombat = cmb;
    }
    if (cook !== lastLoggedCooking) {
        log(`LEVEL UP Cooking ${cook} | ${sdk.getSkill('Cooking')?.experience} xp`);
        lastLoggedCooking = cook;
    }
}

session.registerRecovery([
    {
        name: 'exit_north_buildings',
        run: async () => {
            await exitCatherbyNorthBuildings();
            return !northOfCatherbyBank() && !inCatherbyRangeHouse();
        }
    },
    {
        name: 'step_off_bank',
        run: async () => {
            await stepOffCatherbyBank();
            return !onCatherbyBankStreet();
        }
    },
    {
        name: 'walk_catherby',
        run: async () => {
            await walkToCatherby();
            return inCatherby();
        }
    },
    {
        name: 'setup_gear',
        run: async () => setupFishingGear()
    },
    {
        name: 'leave_ship',
        run: async () => {
            await leaveDockedShip();
            return !onDockedShip();
        }
    },
    {
        name: 'recover_gangplank',
        maxConsecutive: 2,
        run: async () => recoverGangplank(bot, sdk)
    }
]);

try {
    await bot.skipTutorial();
    await bot.dismissBlockingUI();
    await dismissCookDialog();
    lastLoggedFishing = fishingLevel();
    lastLoggedCombat = combatLevel();
    lastLoggedCooking = cookingLevel();
    session.log('log', `Fishing ${lastLoggedFishing} combat ${lastLoggedCombat} cook ${lastLoggedCooking} @ ${pos().x},${pos().z}`);
    if (inWilderness()) await leaveDragonWilderness();
    loadThieveSupply();
    if (THIEVE_SUPPLY > 0) {
        log(`Thieve supply ${thieveSupplyCooked}/${THIEVE_SUPPLY} cooked tuna/swordfish`);
    }
    await closeBankHard();
    if (inCatherby() && (northOfCatherbyBank() || inCatherbyRangeHouse())) {
        await exitCatherbyNorthBuildings();
    }

    // Buy/withdraw the tool before dump. Dump used to bank the net, then stall
    // on a jammed Catherby booth and never walk to Harry.
    // --smallnet: skip the dump entirely — 99 thieves pickpocket 5gp and buy from Harry.
    if (SMALL_NET) {
        log('Small-net — skip dump, get a net');
        await closeBankHard();
        if (smallNetPhase()) {
            await setupSmallNet();
        }
    } else if (!hasFishingTool()) {
        log('Need fishing tool before dump');
        await setupFishingGear();
    }
    if (SMALL_NET) {
        await closeBankHard();
    } else if (hasFishingTool() && inCatherby()) {
        log(
            `${SHARK ? 'Shark harpoon' : bigNetRamp() ? 'Small net' : BIG_NET ? 'Big net' : smallNetPhase() ? 'Small net' : hasHarpoon() ? 'Harpoon' : 'Lobster pot'} ready — skip dump, go fish`
        );
        await closeBankHard();
        await dropBigNetJunk();
    } else if (sdk.getEquipment().length > 0) {
        log(`Skip dump — leaving worn gear (${sdk.getEquipment().map((e) => e.name).join(', ')})`);
        await closeBankHard();
    } else {
        await enterPhase('dump_gear');
        await dumpAllGear();
    }
    await closeBankHard();

    // --smallnet, --bignet, and --shark (which net at Catherby first) skip Lumbridge/Draynor.
    if (!SMALL_NET && !SHARK && !BIG_NET && fishingLevel() < TARGET_FISHING && !inCatherby() && !inArdougne() && !onKaramja()) {
        await setupClosestBankAndNet();
        await enterPhase('chickens');
        while (combatLevel() < TARGET_COMBAT) {
            if (!(await tickSession())) break;
            logLevels();
            await punchChickens();
            session.noteProgress('xp', 'combat');
        }
        log(`Combat ${combatLevel()} — walking to Draynor`);
        await enterPhase('fish_draynor');
        while (fishingLevel() < TARGET_FISHING) {
            if (!(await tickSession())) break;
            logLevels();
            await fishDraynorOnce();
            session.noteProgress('xp', 'draynor');
        }
        await bankDraynorCatch();
        log(`Fishing ${fishingLevel()} — heading to Ardougne`);
    }

    if (!inCatherby()) {
        await enterPhase('travel_catherby');
        if (!inArdougne() && !onArdyCatherbyRoad()) await goToArdy();
        await walkToCatherby();
    }

    const gearReady =
        SMALL_NET && smallNetPhase()
            ? await setupSmallNet()
            : await setupFishingGear();
    if (!gearReady) {
        const missing = bigNetRamp()
            ? 'small fishing net'
            : BIG_NET
              ? 'big fishing net'
              : SHARK
                ? 'harpoon'
                : smallNetPhase()
                  ? 'small fishing net'
                  : 'harpoon or lobster pot';
        session.noteFailure('setup_gear', `no ${missing} @ ${pos().x},${pos().z} gp=${coins()}`);
        log(`Could not get a ${missing} @ ${pos().x},${pos().z} gp=${coins()} — will keep trying`);
    }
    await closeBankHard();
    if (!NO_COOK) {
        log('Cooking all raw food in the bank before fishing');
        await cookBankedUntilReady(true);
        log('Bank raw cooked — starting the fishing loop');
    }
    if (await bankSupplyAndMaybeReturn()) {
            /* quota already met from banked raw */
        } else {
        let trip = 1;
        while (true) {
            if (!(await tickSession())) break;
            if (await bankSupplyAndMaybeReturn()) break;
            session.maybeHeartbeat();
            await bot.dismissBlockingUI();
            logLevels();
            await waitRespawn();
            if (!inCatherby()) {
                await enterPhase('travel_catherby');
                await walkToCatherby();
            }
            if (inCatherby() && (northOfCatherbyBank() || inCatherbyRangeHouse())) {
                await exitCatherbyNorthBuildings();
            }
            if (!hasFishingTool()) {
                if (!(SMALL_NET && smallNetPhase() ? await setupSmallNet() : await setupFishingGear())) {
                    const missing = bigNetRamp()
                        ? 'small fishing net'
                        : BIG_NET
                          ? 'big fishing net'
                          : SHARK
                            ? 'harpoon'
                            : smallNetPhase()
                              ? 'small fishing net'
                              : 'harpoon or lobster pot';
                    session.noteFailure('missing_supplies', `Cannot restock ${missing}`);
                    log(`Cannot restock ${missing} — waiting on Harry`);
                    await sdk.waitForTicks(10);
                    continue;
                }
            }
            if (SHARK) {
                if (sharkNetRamp()) {
                    await enterPhase('shark-ramp');
                    if (!hasNet()) {
                        if (await openBankAt(CATHERBY_BANK.x, CATHERBY_BANK.z)) {
                            await bot.withdrawItem(/small fishing net/i, 1).catch(() => {});
                            await bot.closeBank();
                        }
                    }
                    if (!hasNet() && !(await setupSmallNet())) {
                        session.noteFailure('missing_supplies', 'Cannot restock small fishing net');
                        log('Cannot restock small fishing net — waiting on Harry');
                        await sdk.waitForTicks(10);
                        continue;
                    }
                    await cookSmallNetIfNeeded();
                    await fishSmallNetTrip(trip);
                } else if (sharkRampPhase()) {
                    await enterPhase('shark-ramp');
                    if (hasHarpoon()) {
                        await fishTrip(trip, 'harpoon');
                    } else {
                        await fishTrip(trip, 'cage');
                        await tryHarpoonBetweenRuns();
                    }
                } else {
                    await enterPhase('shark');
                    await fishSharkTrip(trip);
                }
            } else if (BIG_NET && Date.now() >= simpleFishUntil) {
                if (bigNetRamp()) {
                    await enterPhase('bignet-ramp');
                    if (!hasNet()) {
                        if (await openBankAt(CATHERBY_BANK.x, CATHERBY_BANK.z)) {
                            await bot.withdrawItem(/small fishing net/i, 1).catch(() => {});
                            await bot.closeBank();
                        }
                    }
                    if (!hasNet() && !(await setupSmallNet())) {
                        session.noteFailure('missing_supplies', 'Cannot restock small fishing net');
                        log('Cannot restock small fishing net — waiting on Harry');
                        await sdk.waitForTicks(10);
                        continue;
                    }
                    await cookSmallNetIfNeeded();
                    await fishSmallNetTrip(trip);
                } else {
                    await enterPhase('bignet');
                    await fishBigNetTrip(trip);
                }
            } else if (smallNetPhase() || thieveSupplyNet()) {
                await enterPhase('smallnet');
                if (!hasNet()) {
                    if (await openBankAt(CATHERBY_BANK.x, CATHERBY_BANK.z)) {
                        await bot.withdrawItem(/small fishing net/i, 1).catch(() => {});
                        await bot.closeBank();
                    }
                }
                if (!hasNet() && !(await setupSmallNet())) {
                    session.noteFailure('missing_supplies', 'Cannot restock small fishing net');
                    log('Cannot restock small fishing net — waiting on Harry');
                    await sdk.waitForTicks(10);
                    continue;
                }
                await cookSmallNetIfNeeded();
                await fishSmallNetTrip(trip);
            } else {
                await enterPhase(hasHarpoon() ? 'harpoon' : 'cage');
                if (hasHarpoon()) {
                    await fishTrip(trip, 'harpoon');
                } else {
                    await fishTrip(trip, 'cage');
                    await tryHarpoonBetweenRuns();
                }
            }
            if (await bankSupplyAndMaybeReturn()) break;
            trip++;
        }
    }
} catch (err) {
    session.stopRestartable('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    await session.finalizeStop();
    await sdk.disconnect();
}
