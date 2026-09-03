/**
 * jacklove fishing route:
 * bank → net → combat 15 chickens → Draynor net → Ardougne boats → Catherby.
 *
 * Default: harpoon tuna/swordfish (lobster cage fallback if Harry is dry), cook, bank.
 * `--shark`: harpoon sharks on Catherby Net/Harpoon spots (not cage spots).
 * `--bignet`: buy a big fishing net from Harry, net the Catherby Net/Harpoon spots.
 *   Drop seaweed / mackerel / boots / gloves. Open caskets and bank the loot.
 *   Cook cod and bass. Bank oysters (the "clams") unopened.
 *
 *   bun bots/quests/fishing-route.ts jacklove1
 *   bun bots/quests/fishing-route.ts jacklove6 --shark
 *   bun bots/quests/fishing-route.ts jacklove6 --bignet
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import {
    ARDOUGNE_MARKET,
    ARDY_TO_CATHERBY,
    CATHERBY_BANK,
    DRAYNOR_BANK,
    EDGEVILLE,
    HOUSE_OUTSIDE,
    LUMBRIDGE_MEN,
    PORT_SARIM_DOCK
} from './tiles';
import { recoverGangplank, walkNear as walkNearShared } from './movement';

const TARGET_FISHING_HARPOON = 50;
const TARGET_FISHING_SHARK = 76;
const TARGET_FISHING_NET = 16;
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
const LOBSTER_POT_GP = 20;
const BIG_NET_GP = 20;
const HARRY_HARPOON_SPAWNS = 5;
const HARRY_BIG_NET_SPAWNS = 5;
const RANGE_OUTSIDE = { x: 2816, z: 3439 };
const RANGE_STAND = { x: 2816, z: 3442 };

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
    { name: 'Ardougne East', x: 2655, z: 3283 }
];

const NET_KEEP = /^(coins|small fishing net|cake|2\/3 cake|chocolate slice|bread)$/i;
const TOOL_KEEP = /^(harpoon|lobster pot)$/i;
const BIG_NET_KEEP = /^(big|large) fishing net$/i;
/** Never bank the fishing tool on dump — restarts were depositing the net then failing to withdraw it. */
const DUMP_KEEP = /^(big|large) fishing net|small fishing net|harpoon|lobster pot$/i;
const RAW_SMALL = /^raw (shrimps?|anchovies)$/i;
const RAW = /^raw (tuna|swordfish|lobster|shark|shrimps?|anchovies)$/i;
const RAW_NET = /^raw (cod|bass)$/i;
const RAW_ANY = /^raw /i;
const COOKED = /^(tuna|swordfish|lobster|shark|shrimps?|anchovies|cod|bass)$/i;
const BURNT = /^burnt (lobster|fish|swordfish|tuna|shrimp|shark|cod|bass)/i;
const BIG_NET_DROP = /^(seaweed|edible seaweed|raw mackerel|mackerel|leather boots|leather gloves|boots)$/i;
const CASKET = /^casket$/i;
const OYSTER = /^(oyster|clam)s?$/i;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const BIG_NET = argv.includes('--bignet');
const SHARK = argv.includes('--shark');
const TARGET_FISHING = SHARK ? TARGET_FISHING_SHARK : BIG_NET ? TARGET_FISHING_NET : TARGET_FISHING_HARPOON;

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

async function enterPhase(name: string): Promise<void> {
    if (session.metrics().phase === name) return;
    await session.setPhase(name);
}

async function tickSession(): Promise<boolean> {
    if (session.isStopped()) return false;
    if (session.needsRecovery()) {
        return (await session.recover()) === 'resumed';
    }
    return true;
}

{
    const origWait = sdk.waitForTicks.bind(sdk);
    sdk.waitForTicks = (async (ticks: number = 1) => {
        try {
            return await origWait(ticks);
        } catch (err) {
            log(`waitForTicks(${ticks}): ${(err as Error).message}`);
            return sdk.getState()!;
        }
    }) as typeof sdk.waitForTicks;
}

let lastIntent = '';
let lastLoggedFishing = 0;
let lastLoggedCombat = 0;
let lastLoggedCooking = 0;
let pierHunt = 0;

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

function toolKeep(): RegExp {
    return BIG_NET ? BIG_NET_KEEP : TOOL_KEEP;
}

function cookRawPattern(): RegExp {
    return BIG_NET ? RAW_NET : RAW;
}

function hasFishingTool(): boolean {
    if (BIG_NET) return hasBigNet();
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
    if (/anchov/.test(n)) return 15;
    if (/mackerel/.test(n)) return MACKEREL_COOK;
    if (/cod/.test(n)) return COD_COOK;
    if (/bass/.test(n)) return BASS_COOK;
    if (/tuna/.test(n)) return TUNA_COOK;
    if (/swordfish/.test(n)) return SWORD_COOK;
    if (/lobster/.test(n)) return 40;
    if (/shark/.test(n)) return 80;
    return 99;
}

function canCookItem(name: string): boolean {
    if (BIG_NET && /mackerel/i.test(name)) return false;
    return cookingLevel() >= cookLevelFor(name);
}

function cookableRaw(pattern: RegExp = RAW) {
    return sdk.getInventory().find((i) => pattern.test(i.name) && canCookItem(i.name)) ?? null;
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
    void sdk.sendWalk(p.x, Math.max(3438, p.z - 3), true).catch(() => {});
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
    const food = sdk.findInventoryItem(/cake|chocolate|slice|bread|shrimp|anchov|tuna|swordfish|cod|bass/i);
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
    const catherby =
        inCatherby() || (Math.abs(x - CATHERBY_BANK.x) <= 4 && Math.abs(z - CATHERBY_BANK.z) <= 4);
    if (catherby) {
        const already = sdk.findNearbyLoc(/bank booth/i, { reachable: true });
        if (!already) {
            log(`Walking to Catherby bank street @ ${pos().x},${pos().z}`);
            if (pos().z >= 3444) {
                log('Leaving north of Catherby bank via sendWalk');
                const deadline = Date.now() + 90_000;
                while (distTo(2801, 3441) > 2 && Date.now() < deadline) {
                    await sdk.sendWalk(2801, 3441, true);
                    await sdk.waitForTicks(3);
                }
            } else if (distTo(2809, 3441) > 4) {
                await walkNear(2809, 3441, 3);
            }
        }
        log(`At Catherby street ${pos().x},${pos().z}`);
        const booth = sdk.findNearbyLoc(/bank booth/i, { reachable: true });
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
        log(`Catherby booth missed @ ${pos().x},${pos().z} — openBank`);
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

async function musaToBrimhaven(): Promise<void> {
    await leaveDockedShip();
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

async function walkToCatherby(): Promise<void> {
    if (inCatherby()) return;
    await leaveHouse();
    intent('Walking Ardougne → Catherby');
    await walkWaypoints(ARDY_TO_CATHERBY);
}

function harryCount(item: RegExp): number {
    return sdk.getState()?.shop?.shopItems.find((i) => item.test(i.name))?.count ?? 0;
}

async function openHarry(): Promise<boolean> {
    await walkNear(HARRY.x, HARRY.z, 3);
    if (sdk.getState()?.shop?.isOpen) return true;
    const opened = await bot.openShop(/harry/i);
    if (opened.success || sdk.getState()?.shop?.isOpen) return true;
    log(`Harry shop failed: ${opened.message}`);
    return false;
}

async function pickpocketCatherbyUntil(need: number): Promise<void> {
    if (sdk.getState()?.shop?.isOpen) await bot.closeShop();
    if (sdk.getState()?.bank?.isOpen) await bot.closeBank();
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
        if (!(await openBankAt(CATHERBY_BANK.x, CATHERBY_BANK.z))) return coins() >= need;
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

async function setupFishingGear(): Promise<boolean> {
    if (BIG_NET) return setupBigNet();
    if (hasHarpoon()) {
        log(`Harpoon setup harpoon=true gp=${coins()} inv=${invSummary()}`);
        return true;
    }
    intent('Catherby bank for harpoon');
    if (await openBankAt(CATHERBY_BANK.x, CATHERBY_BANK.z)) {
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
        if (!hasHarpoon() && !hasLobsterPot()) {
            const r = await bot.withdrawItem(/^lobster pot$/i, 1, { asNote: false });
            if (!hasLobsterPot()) log(`Withdraw lobster pot: ${r.message}`);
        }
        await depositAllExcept(toolKeep());
        if (!hasHarpoon()) await bot.withdrawItem(/^harpoon$/i, 1, { asNote: false });
        if (!hasHarpoon() && !hasLobsterPot()) await bot.withdrawItem(/^lobster pot$/i, 1, { asNote: false });
        if (!hasFishingTool() && coins() < HARPOON_GP) {
            const r = await bot.withdrawItem(/^coins$/i, COIN_WITHDRAW, { asNote: false });
            if (coins() < HARPOON_GP) log(`Withdraw coins: ${r.message} have=${coins()}`);
        }
        await bot.closeBank();
        if (hasFishingTool()) {
            log(`Harpoon setup harpoon=${hasHarpoon()} pot=${hasLobsterPot()} gp=${coins()} inv=${invSummary()}`);
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
        if (!hasBigNet()) await bot.withdrawItem(BIG_NET_KEEP, 1).catch(() => {});
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

/** Booth street / range house / north of bank: walkTo is a no-op. Hop with sendWalk. */
async function hopSendWalk(x: number, z: number, tolerance: number, ms: number): Promise<void> {
    const deadline = Date.now() + ms;
    while (distTo(x, z) > tolerance && Date.now() < deadline) {
        void sdk.sendWalk(x, z, true).catch(() => {});
        await new Promise((r) => setTimeout(r, 500));
    }
}

async function leaveCatherbyBankToPier(dest: { x: number; z: number }): Promise<void> {
    await closeBankHard();
    await dismissCookDialog();
    const start = pos();
    if (start.x >= 2814 && start.x <= 2820 && start.z >= 3441 && start.z <= 3446) {
        await openRangeDoor();
        log(`Leaving Catherby range @ ${start.x},${start.z}`);
        await hopSendWalk(RANGE_OUTSIDE.x, RANGE_OUTSIDE.z, 2, 15_000);
    }
    if (pos().z >= 3444 && pos().x <= 2825) {
        log(`Leaving north of Catherby bank @ ${pos().x},${pos().z}`);
        await hopSendWalk(2809, 3441, 2, 25_000);
    }
    if (pos().x <= 2814 && pos().z >= 3436 && pos().z <= 3446) {
        log(`Leaving Catherby bank street @ ${pos().x},${pos().z}`);
        await hopSendWalk(2816, 3438, 3, 15_000);
    }
    const hops = [
        { x: 2824, z: 3436 },
        { x: 2832, z: 3432 },
        { x: 2837, z: 3431 },
        dest
    ];
    for (const hop of hops) {
        if (distTo(dest.x, dest.z) <= 4) break;
        await hopSendWalk(hop.x, hop.z, 3, 12_000);
    }
    await hopSendWalk(dest.x, dest.z, 4, 15_000);
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

async function dropBigNetJunk(): Promise<number> {
    await closeBankHard();
    let n = 0;
    for (let i = 0; i < 28; i++) {
        const item = sdk.getInventory().find((it) => BIG_NET_DROP.test(it.name) && (it.count ?? 0) > 0);
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
    if (distTo(RANGE_STAND.x, RANGE_STAND.z) > 3) {
        await walkNear(RANGE_OUTSIDE.x, RANGE_OUTSIDE.z, 2);
        await openRangeDoor();
        await walkNear(RANGE_STAND.x, RANGE_STAND.z, 1);
    }
    await openRangeDoor();
    return !!findRange();
}

async function dismissCookDialog(): Promise<void> {
    await bot.dismissBlockingUI();
    const dialog = sdk.getDialog();
    if (!dialog?.isOpen) return;
    const cook = dialog.options.find((o) => /^(cook|make)\b/i.test(o.text));
    if (cook) {
        await sdk.sendClickDialog(cook.index);
        return;
    }
    await sdk.clickDialogByText(/continue|click here/i).catch(async () => {
        await sdk.sendClickDialog(dialog.options[0]?.index ?? 0);
    });
}

async function cookInventory(rawPat: RegExp = RAW): Promise<{ cooked: number; burnt: number; xp: number; leftover: number }> {
    if (!cookableRaw(rawPat)) {
        return { cooked: 0, burnt: 0, xp: 0, leftover: countItems(rawPat) };
    }
    if (!(await goToRange())) return { cooked: 0, burnt: 0, xp: 0, leftover: countItems(rawPat) };

    intent(`Cook fish (cooking ${cookingLevel()})`);
    const startXp = cookingXp();
    const startBurnt = countItems(BURNT);
    const startCooked = countItems(COOKED);
    let idleCasts = 0;

    while (cookableRaw(rawPat) && idleCasts < 80) {
        await dismissCookDialog();
        const dialog = sdk.getDialog();
        if (dialog?.isOpen) {
            await sdk.waitForTicks(1);
            idleCasts++;
            continue;
        }
        if (distTo(RANGE_STAND.x, RANGE_STAND.z) > 2) {
            await walkNear(RANGE_STAND.x, RANGE_STAND.z, 1);
            await openRangeDoor();
        }
        const raw = cookableRaw(rawPat);
        const range = findRange();
        if (!raw || !range) {
            idleCasts++;
            if (!(await goToRange())) break;
            continue;
        }
        const xpBefore = cookingXp();
        const rawBefore = countItems(new RegExp(`^${raw.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
        const r = await bot.useItemOnLoc(raw, range, { timeout: 12_000 });
        if (!r.success) log(`useItemOnLoc: ${r.message}`);
        try {
            await sdk.waitForCondition((s) => {
                if (s.dialog.isOpen) return true;
                const xp = s.skills.find((sk) => sk.name === 'Cooking')?.experience ?? 0;
                if (xp > xpBefore) return true;
                const rawNow = s.inventory.filter((i) => i.name === raw.name).reduce((n, i) => n + i.count, 0);
                return rawNow < rawBefore;
            }, 8_000);
        } catch {
            /* recast */
        }
        const rawAfter = countItems(new RegExp(`^${raw.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
        if (cookingXp() === xpBefore && rawAfter === rawBefore) idleCasts++;
        else idleCasts = 0;
    }

    return {
        cooked: countItems(COOKED) - startCooked,
        burnt: countItems(BURNT) - startBurnt,
        xp: cookingXp() - startXp,
        leftover: countItems(rawPat)
    };
}

async function withdrawCookableRaw(): Promise<number> {
    while (occupiedSlots() < 28) {
        const items = (sdk.getBankItems() ?? []).filter((i) => RAW_ANY.test(i.name) && canCookItem(i.name));
        const item = items.find((i) => RAW_SMALL.test(i.name)) ?? items[0];
        if (!item) break;
        const before = occupiedSlots();
        const r = await bot.withdrawItem(item, -1);
        if (!r.success && !r.partial) break;
        if ((r.amountWithdrawn ?? 0) <= 0 && occupiedSlots() === before) break;
    }
    return sdk.getInventory().filter((i) => RAW_ANY.test(i.name) && canCookItem(i.name)).length;
}

async function cookBankedUntilReady(): Promise<void> {
    intent(`Cooking banked raw (cooking ${cookingLevel()})`);
    for (let loads = 0; loads < 80; loads++) {
        if (cookableRaw(RAW_ANY)) {
            await cookInventory(RAW_ANY);
        }
        if (!(await openBankAt(CATHERBY_BANK.x, CATHERBY_BANK.z))) {
            log('Cook skip — bank closed');
            return;
        }
        await depositAllExcept(toolKeep());
        await withdrawFishingTool();
        const more = await withdrawCookableRaw();
        if (more <= 0) {
            await snapshotBank();
            await bot.closeBank();
            if (loads === 0) log('Cook skip — no banked raw');
            return;
        }
        await bot.closeBank();
    }
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
    await bot.closeBank();
    return true;
}

async function fishTrip(n: number, mode: 'harpoon' | 'cage'): Promise<void> {
    intent(`${mode === 'harpoon' ? 'Harpoon' : 'Cage lobster'} trip ${n} (fish ${fishingLevel()} cook ${cookingLevel()})`);
    await dismissCookDialog();
    if (sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) await closeBankHard();
    if (!findTunaSwordSpot()) await huntHarpoonSpot();
    await fishPierInventory(mode);
    const cooked = await cookInventory(RAW);
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
    await dismissCookDialog();
    if (sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) await closeBankHard();
    if (!findSharkSpot()) await huntSharkSpot();
    const caught = await fishSharkInventory();
    const cooked = await cookInventory(RAW);
    const banked = await bankCatherbyCatch();
    if (cooked.leftover > 0 && cookingLevel() < 99) await cookBankedUntilReady();
    const qty = caught.shark + cooked.cooked + cooked.burnt;
    if (qty > 0 && banked) {
        session.recordTrip(qty);
        session.noteProgress('inventory', `shark trip ${n} raw=${caught.shark} cook=${cooked.cooked}`);
        log(`Banked shark trip ${n} | raw ${caught.shark} cook ${cooked.cooked} xp ${caught.xp}`);
        return;
    }
    log(`Empty shark trip ${n} banked=${banked} cooked=${cooked.cooked} @ ${pos().x},${pos().z} inv=${invSummary()}`);
    await sdk.waitForTicks(8);
}

async function fishBigNetTrip(n: number): Promise<void> {
    intent(`Big net trip ${n} (fish ${fishingLevel()} cook ${cookingLevel()})`);
    if (!findBigNetSpot()) await huntBigNetSpot();
    const caught = await fishBigNetInventory();
    const cooked = await cookInventory(cookRawPattern());
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
    lastLoggedFishing = fishingLevel();
    lastLoggedCombat = combatLevel();
    lastLoggedCooking = cookingLevel();
    session.log('log', `Fishing ${lastLoggedFishing} combat ${lastLoggedCombat} cook ${lastLoggedCooking} @ ${pos().x},${pos().z}`);
    await closeBankHard();

    // Buy/withdraw the tool before dump. Dump used to bank the net, then stall
    // on a jammed Catherby booth and never walk to Harry.
    if (!hasFishingTool()) {
        log('Need fishing tool before dump');
        await setupFishingGear();
    }
    if (hasFishingTool() && inCatherby()) {
        log(
            `${SHARK ? 'Shark harpoon' : BIG_NET ? 'Big net' : hasHarpoon() ? 'Harpoon' : 'Lobster pot'} ready — skip dump, go fish`
        );
        await closeBankHard();
        await dropBigNetJunk();
    } else {
        await enterPhase('dump_gear');
        await dumpAllGear();
    }
    await closeBankHard();

    if (fishingLevel() < TARGET_FISHING && !inCatherby() && !inArdougne() && !onKaramja()) {
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

    if (!(await setupFishingGear())) {
        const missing = BIG_NET ? 'big fishing net' : SHARK ? 'harpoon' : 'harpoon or lobster pot';
        session.noteFailure('setup_gear', `no ${missing} @ ${pos().x},${pos().z} gp=${coins()}`);
        log(`Could not get a ${missing} @ ${pos().x},${pos().z} gp=${coins()} — will keep trying`);
    }
    await closeBankHard();
    if (cookingLevel() < 99) await cookBankedUntilReady();

    let trip = 1;
    while (true) {
        if (!(await tickSession())) break;
        session.maybeHeartbeat();
        await bot.dismissBlockingUI();
        logLevels();
        await waitRespawn();
        if (!inCatherby()) {
            await enterPhase('travel_catherby');
            await walkToCatherby();
        }
        if (!hasFishingTool()) {
            if (!(await setupFishingGear())) {
                const missing = BIG_NET ? 'big fishing net' : SHARK ? 'harpoon' : 'harpoon or lobster pot';
                session.noteFailure('setup_gear', `Cannot restock ${missing}`);
                log(`Cannot restock ${missing} — waiting on Harry`);
                await sdk.waitForTicks(10);
                continue;
            }
        }
        if (SHARK) {
            await enterPhase('shark');
            if (cookingLevel() < 99) await cookBankedUntilReady();
            await fishSharkTrip(trip);
        } else if (BIG_NET) {
            await enterPhase('bignet');
            if (cookingLevel() < 99) await cookBankedUntilReady();
            await fishBigNetTrip(trip);
        } else {
            await enterPhase(hasHarpoon() ? 'harpoon' : 'cage');
            if (cookingLevel() < 99) await cookBankedUntilReady();
            if (hasHarpoon()) {
                await fishTrip(trip, 'harpoon');
            } else {
                await fishTrip(trip, 'cage');
                await tryHarpoonBetweenRuns();
            }
        }
        trip++;
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    await session.finalizeStop();
    await sdk.disconnect();
}
