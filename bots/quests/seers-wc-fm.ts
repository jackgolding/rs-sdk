/**
 * Seers Village woodcutting + firemaking to 99, then fletching.
 * Smiths a rune axe first if the character does not already have one.
 *
 * Trees: willows → maples (WC 45) → yews (WC 80). Stays at Seers bank.
 * After Firemaking 99, chops the same trees and fletches unstrung bows.
 * `--fletch` forces that fletching leg now, without waiting for Firemaking 99
 * (tier still follows Woodcutting + Fletching, so it starts on normal logs).
 *
 *   bun bots/quests/seers-wc-fm.ts jackthief
 *   bun bots/quests/seers-wc-fm.ts Jackpoo1 --yews   # chop + bank churchyard yews (no FM)
 *   bun bots/quests/seers-wc-fm.ts ABGARMY02 --until-wc=36
 *     # chop only (normal → oak → willow), drop logs, then PARK at 36.
 *     # Buys an iron/bronze/steel axe from Bob when the bank has none.
 *     # (Reaching the target parks: it never exits 0, see "Contention" below.)
 *
 * Contention: the Seers patches are shared with the rest of the fleet, so
 * "no live <tree>" and "felled by someone else" are NORMAL. They are counted
 * by the chop loop's contention ladder (see CONTENTION_* below), which walks
 * to the next live tree, then to the next patch spot, then down a tree tier —
 * recovery tactics are reserved for genuine stuck/lost states.
 *
 * A met target or a grind that cannot chop at all PARKS (sleep loop); it never
 * exits 0, because the box supervisor relaunches exit-0 containers in seconds.
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding, isTileWalkable } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import {
    ARDY_TO_CATHERBY,
    ARHEIN_SHOP,
    CATHERBY_TO_ARDY,
    SEERS_ANVIL,
    SEERS_BANK,
    SEERS_FIRE_START,
    SEERS_MAPLES,
    SEERS_OAKS,
    SEERS_TREES,
    SEERS_WILLOWS,
    SEERS_YEWS
} from './tiles';
import {
    closeUi as closeUiShared,
    distTo as distToShared,
    installWaitForTicksGuard,
    walkKandarinToEdgeville,
    walkNear as walkNearShared,
    walkWaypoints as walkWaypointsShared
} from './movement';
import { travelToSeersFlax } from '../Jackpoo1/travel-to-flax';
import { installGracefulShutdown } from '../../sdk/runner';

const TARGET = 99;
const YEW_WC = 80;
const SMITH_AXE_LEVEL = 86;

const AXE = /^(bronze|iron|steel|black|mithril|adamant|rune) axe$/i;
const RUNE_AXE = /^rune axe$/i;
const RUNITE_BAR = /^runite bar$/i;
const HAMMER = /^hammer$/i;
const TINDERBOX = /^tinderbox$/i;
const KNIFE = /^knife$/i;
const COINS = /^coins$/i;
const FOOD_EAT = /^(shark|swordfish|lobster|tuna|salmon|trout|bass|bread|cake|meat|anchovies)$/i;
const ANY_LOGS = /logs$/i;
const BOW = /^(oak |willow |maple |yew |magic )?(shortbow|longbow)$/i;
const SHAFTS = /^arrow shaft/i;
const KEEP = /^(coins|knife|tinderbox|hammer|(bronze|iron|steel|black|mithril|adamant|rune) axe)$/i;
/**
 * chopTree results that mean "the tree went away / never yielded": a crowded
 * patch, not a broken loop. Any other failure stays a real `chop` failure.
 */
const CONTENDED = /felled by someone else|timed out waiting for logs|no tree found/i;

const AXE_TIERS = [
    { name: 'rune axe', level: 41 },
    { name: 'adamant axe', level: 31 },
    { name: 'mithril axe', level: 21 },
    { name: 'black axe', level: 6 },
    { name: 'steel axe', level: 6 },
    { name: 'iron axe', level: 1 },
    { name: 'bronze axe', level: 1 }
] as const;

type PhaseId = 'normal' | 'oak' | 'willow' | 'maple' | 'yew';

type Phase = {
    id: PhaseId;
    tree: RegExp;
    logs: RegExp;
    stand: { x: number; z: number };
    maxDrift: number;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    burnLevel: number;
    fletchShort: number;
};

const PHASES: Record<PhaseId, Phase> = {
    normal: {
        id: 'normal',
        tree: /^tree$/i,
        logs: /^logs$/i,
        stand: SEERS_TREES,
        maxDrift: 12,
        minX: 2708,
        maxX: 2738,
        minZ: 3468,
        maxZ: 3505,
        burnLevel: 1,
        fletchShort: 5
    },
    oak: {
        id: 'oak',
        tree: /^oak$/i,
        logs: /^oak logs$/i,
        stand: SEERS_OAKS,
        maxDrift: 14,
        minX: 2704,
        maxX: 2736,
        minZ: 3476,
        maxZ: 3510,
        burnLevel: 15,
        fletchShort: 20
    },
    willow: {
        id: 'willow',
        tree: /^willow$/i,
        logs: /^willow logs$/i,
        stand: SEERS_WILLOWS,
        maxDrift: 12,
        minX: 2698,
        maxX: 2724,
        minZ: 3498,
        maxZ: 3518,
        burnLevel: 30,
        fletchShort: 35
    },
    maple: {
        id: 'maple',
        tree: /^maple/i,
        logs: /^maple logs$/i,
        stand: SEERS_MAPLES,
        maxDrift: 14,
        minX: 2716,
        maxX: 2738,
        minZ: 3478,
        maxZ: 3508,
        burnLevel: 45,
        fletchShort: 50
    },
    yew: {
        id: 'yew',
        tree: /^yew$/i,
        logs: /^yew logs$/i,
        stand: SEERS_YEWS,
        maxDrift: 14,
        minX: 2698,
        maxX: 2722,
        minZ: 3454,
        maxZ: 3472,
        burnLevel: 60,
        fletchShort: 65
    }
};

/**
 * ── Contention ladder ──────────────────────────────────────────────────────
 * The Seers patches are shared: several bots chop the same yews. "No live
 * <tree>" or "<tree> was felled by someone else" therefore means the SPOT is
 * crowded, not that the loop is broken, and the answer is to move rather than
 * to re-click the same four tiles (or to burn recovery tactics).
 *
 * After CONTENTION_MOVE_AFTER consecutive empty/felled outcomes at one place
 * the ladder walks to, in order:
 *   1. the nearest live tree of the same tier that is CONTENTION_MIN_MOVE
 *      tiles away from the contested one (a different tree, found by a
 *      CONTENTION_SCAN_RADIUS scan) — this is the "next available yew";
 *   2. the next spot in YEW_SPOTS (the same patch, a different scan window);
 *   3. the next tree tier down (TIER_DOWN) for TIER_FALLBACK_MS, so a fully
 *      contested yew patch still produces XP/logs instead of pacing;
 *   4. a bounded park (PARK_RETRY_MS) when nothing at all is chopable.
 * `--yews` skips rung 3: that run exists to bank YEW logs, so a maple stand-in
 * would silently bank the wrong item.
 */
const CONTENTION_MOVE_AFTER = 3;
/** A replacement tree must be at least this far (Chebyshev) from the contested one. */
const CONTENTION_MIN_MOVE = 6;
/** Radius of the wider scan used to find a live tree elsewhere in the patch. */
const CONTENTION_SCAN_RADIUS = 16;
/** Ticks to wait at a spot between contention retries (a yew respawn is not instant). */
const CONTENTION_RETRY_TICKS = 6;
/** After a ladder move, keep recovery out of the way this long so the new spot gets tried. */
const CONTENTION_HOLD_RECOVERY_MS = 120_000;
/** Ladder passes that found nothing chopable anywhere before parking. */
const CONTENTION_PARK_PASSES = 2;
/** How long a tier downgrade stays in force before the preferred tier is retried. */
const TIER_FALLBACK_MS = 240_000;

/**
 * Scan points for the churchyard yew patch, most familiar first. Chains off
 * SEERS_YEWS so the first entry stays the historic stand. Every tile is
 * walkable at level 0 in sdk/collision-data.json with at least three open
 * cardinal neighbours (verified offline); these are places to STAND and scan
 * — the chop target always comes from the live loc scan, never from a tree
 * tile written down here.
 */
const YEW_SPOTS: ReadonlyArray<{ x: number; z: number }> = [
    SEERS_YEWS, // 2708,3461 — historic stand
    { x: 2719, z: 3466 }, // eastern side of the patch, 11 tiles off the stand
    { x: 2701, z: 3468 } // south-west cluster, 7 tiles off the stand
];

/** One tier down from each phase; `normal` is the floor. */
const TIER_DOWN: Record<PhaseId, PhaseId | null> = {
    yew: 'maple',
    maple: 'willow',
    willow: 'oak',
    oak: 'normal',
    normal: null
};

/** Park/hold timings. A parked grind sleeps instead of exiting 0. */
const PARK_SLEEP_MS = 15_000;
const PARK_HEARTBEAT_MS = 300_000;
/** Bounded park when the area has no live trees at all, then try again. */
const PARK_RETRY_MS = 120_000;
/** Bank retry interval while parked for a missing axe/tool. */
const PARK_TOOL_RETRY_MS = 300_000;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
/** Chop Seers yews and bank the logs — no firemaking or fletching. */
const BANK_YEWS = argv.includes('--yews');
/** Force the fletching leg early: chop + fletch bows instead of burning to FM 99 first. */
const FLETCH_FORCE = argv.includes('--fletch');
const untilWcArg = argv.find((a) => a.startsWith('--until-wc='));
const untilWc = Number(untilWcArg?.split('=')[1]);
/** Chop-only stop. Tree choice follows Woodcutting, logs are dropped, no FM. */
const WC_UNTIL = Number.isFinite(untilWc) && untilWc > 0 ? untilWc : 0;
const untilFletchArg = argv.find((a) => a.startsWith('--until-fletch='));
const untilFletch = Number(untilFletchArg?.split('=')[1]);
/** Fletch-only stop; implies the fletch leg without waiting for Firemaking 99. */
const FLETCH_UNTIL = Number.isFinite(untilFletch) && untilFletch > 0 ? untilFletch : 0;
/**
 * Exit 2 instead of parking once a target is met. Orchestrators (lost-city-prep)
 * read exit 2 as "level met, next leg"; the default stays park-forever so the
 * box supervisor never relaunches a finished grind.
 */
const EXIT_WHEN_MET = argv.includes('--exit-when-met');

const BOBS_AXES = { x: 3232, z: 3203 };
const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const DUNGEON_LADDER = { x: 3096, z: 9867 };
const WILDY_GATE = { x: 3103, z: 9909 };
const SHOP_AXES = [
    { name: 'steel axe', level: 6, price: 200 },
    { name: 'iron axe', level: 1, price: 56 },
    { name: 'bronze axe', level: 1, price: 16 }
] as const;

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/seers-wc-fm.ts {botname}`);
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

console.log('Warming pathfinder...');
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

console.log('Opening/attaching the game client...');
await sdk.connect();
const bot = new BotActions(sdk);
const session = new ActivitySession(sdk, bot, {
    name: BANK_YEWS ? 'seers-yews' : 'seers-wc-fm',
    grindLogPath: GRIND_LOG,
    stallMs: 180_000,
    maxRecoveryTactics: 8
});

installGracefulShutdown();

installWaitForTicksGuard(sdk, session);

let lastLoggedWc = 0;
let lastLoggedFm = 0;
let lastLoggedFl = 0;
let lastIntent = '';
/**
 * Where fires go: the open ground east of the bank path (collision-mapped 2026-10-30).
 * Every account used to burn down the same two columns from SEERS_FIRE_START, so 25
 * firemakers kept reaching for each other's tiles. Each inventory now starts on a random
 * lane in this field and walks south, skipping blocked tiles, then re-picks a lane.
 */
const FIRE_FIELD = { minX: 2731, maxX: 2746, minZ: 3446, maxZ: 3478 };
let fireCol = SEERS_FIRE_START.x;
let fireZ = SEERS_FIRE_START.z;

function pickFireLane(): void {
    for (let i = 0; i < 20; i++) {
        fireCol = FIRE_FIELD.minX + Math.floor(Math.random() * (FIRE_FIELD.maxX - FIRE_FIELD.minX + 1));
        // Start in the north half so a full inventory (27 fires) still has room southward.
        fireZ = FIRE_FIELD.maxZ - Math.floor(Math.random() * 10);
        if (isTileWalkable(0, fireCol, fireZ)) return;
    }
}

/** Contention ladder bookkeeping (see CONTENTION_* above). */
const contention = {
    /** consecutive empty/felled outcomes since a chop last actually gained logs */
    streak: 0,
    /** index into phaseSpots() — the next scan point to try */
    spot: 0,
    /** when the ladder last moved the bot */
    lastMoveAt: 0,
    /** ladder passes that found nothing chopable anywhere */
    emptyPasses: 0,
    /** tile of the tree that was last contested, so the ladder picks a DIFFERENT one */
    from: null as { x: number; z: number } | null,
    /** recovery runs held out of the way (diagnostic only) */
    held: 0
};
/** Active tier downgrade, cleared by effectivePhase() once it expires. */
const tierFallback: { id: PhaseId | null; until: number } = { id: null, until: 0 };

function log(msg: string): void {
    session.log('log', msg);
}

function warn(msg: string): void {
    session.log('warn', msg);
}

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
        isDead: p?.isDead ?? false
    };
}

function distTo(x: number, z: number): number {
    return distToShared(sdk, x, z);
}

function wc(): number {
    return sdk.getSkill('Woodcutting')?.baseLevel ?? 1;
}

function fm(): number {
    return sdk.getSkill('Firemaking')?.baseLevel ?? 1;
}

function fl(): number {
    return sdk.getSkill('Fletching')?.baseLevel ?? 1;
}

function smithing(): number {
    return sdk.getSkill('Smithing')?.baseLevel ?? 1;
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function invFull(): boolean {
    return occupiedSlots() >= 28;
}

function count(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function coins(): number {
    return sdk.findInventoryItem(COINS)?.count ?? 0;
}

function hasAxe(): boolean {
    return !!(sdk.findInventoryItem(AXE) || sdk.findEquipmentItem(AXE));
}

function hasRuneAxe(): boolean {
    return !!(sdk.findInventoryItem(RUNE_AXE) || sdk.findEquipmentItem(RUNE_AXE));
}

function currentAxeName(): string | null {
    return sdk.findEquipmentItem(AXE)?.name ?? sdk.findInventoryItem(AXE)?.name ?? null;
}

function axeRank(name: string): number {
    const idx = AXE_TIERS.findIndex((t) => t.name === name.toLowerCase());
    return idx === -1 ? 99 : idx;
}

function bestUsableAxeName(): string | null {
    const wood = wc();
    const owned = [
        ...sdk.getInventory().filter((i) => AXE.test(i.name)),
        ...sdk.getEquipment().filter((i) => AXE.test(i.name))
    ];
    for (const tier of AXE_TIERS) {
        if (wood < tier.level) continue;
        if (owned.some((i) => i.name.toLowerCase() === tier.name)) return tier.name;
    }
    return owned[0]?.name ?? null;
}

function fletchingNow(): boolean {
    if (BANK_YEWS || WC_UNTIL > 0) return false;
    return FLETCH_FORCE || FLETCH_UNTIL > 0 || fm() >= TARGET;
}

function chopOnly(): boolean {
    return BANK_YEWS || WC_UNTIL > 0;
}

/** Spread a fleet off the same stand tile. The 99 burn route keeps the fixed stand. */
function chopStand(p: Phase): { x: number; z: number } {
    if (!(WC_UNTIL > 0)) return p.stand;
    let h = 0;
    for (const ch of username) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
    const dx = (h % 9) - 4;
    const dz = ((h >>> 4) % 9) - 4;
    return {
        x: Math.min(p.maxX - 1, Math.max(p.minX + 1, p.stand.x + dx)),
        z: Math.min(p.maxZ - 1, Math.max(p.minZ + 1, p.stand.z + dz))
    };
}

function phase(): Phase {
    const wood = wc();
    const fire = fm();
    const fletch = fl();
    if (BANK_YEWS || WC_UNTIL > 0) {
        if (wood >= YEW_WC) return PHASES.yew;
        if (wood >= 45) return PHASES.maple;
        if (wood >= 30) return PHASES.willow;
        if (wood >= 15) return PHASES.oak;
        return PHASES.normal;
    }
    if (fletchingNow()) {
        if (wood >= YEW_WC && fletch >= PHASES.yew.fletchShort) return PHASES.yew;
        if (wood >= 45 && fletch >= PHASES.maple.fletchShort) return PHASES.maple;
        if (wood >= 30 && fletch >= PHASES.willow.fletchShort) return PHASES.willow;
        if (wood >= 15 && fletch >= PHASES.oak.fletchShort) return PHASES.oak;
        return PHASES.normal;
    }
    if (wood >= YEW_WC && fire >= PHASES.yew.burnLevel) return PHASES.yew;
    if (wood >= 45 && fire >= PHASES.maple.burnLevel) return PHASES.maple;
    if (wood >= 30 && fire >= PHASES.willow.burnLevel) return PHASES.willow;
    if (wood >= 15 && fire >= PHASES.oak.burnLevel) return PHASES.oak;
    return PHASES.normal;
}

/**
 * The phase the chop loop actually works, which is the preferred phase unless
 * a contention tier downgrade is in force (rung 3 of the ladder). Only ever
 * one tier DOWN, so the level gates of the preferred tier still hold.
 */
function effectivePhase(): Phase {
    if (tierFallback.id && Date.now() >= tierFallback.until) {
        log(`tier fallback over — retrying ${phase().id}`);
        tierFallback.id = null;
    }
    return tierFallback.id ? PHASES[tierFallback.id] : phase();
}

/** Places to stand and scan for this phase; only the yew patch has alternatives. */
function phaseSpots(p: Phase): ReadonlyArray<{ x: number; z: number }> {
    return p.id === 'yew' ? YEW_SPOTS : [p.stand];
}

function fletchProduct(p: Phase): string {
    const level = fl();
    if (p.id === 'yew') {
        if (level >= 70) return 'yew long';
        if (level >= 65) return 'yew short';
    }
    if (p.id === 'maple') {
        if (level >= 55) return 'maple long';
        if (level >= 50) return 'maple short';
    }
    if (p.id === 'willow') {
        if (level >= 40) return 'willow long';
        if (level >= 35) return 'willow short';
    }
    if (p.id === 'oak') {
        if (level >= 25) return 'oak long';
        if (level >= 20) return 'oak short';
    }
    if (level >= 10) return 'long';
    if (level >= 5) return 'short';
    return 'arrow shaft';
}

function inSeers(): boolean {
    const p = pos();
    return p.x >= 2690 && p.x <= 2760 && p.z >= 3435 && p.z <= 3522;
}

function inKandarin(): boolean {
    const p = pos();
    return p.x >= 2460 && p.x <= 2940 && p.z >= 3200 && p.z <= 3680;
}

function treeOk(loc: { x: number; z: number }, p: Phase): boolean {
    return loc.x >= p.minX && loc.x <= p.maxX && loc.z >= p.minZ && loc.z <= p.maxZ;
}

function findTree(p: Phase) {
    const local = (sdk.getNearbyLocs() ?? [])
        .filter((l) => p.tree.test(l.name) && l.optionsWithIndex.some((o) => /chop/i.test(o.text)))
        .filter((l) => l.reachable !== false)
        .filter((l) => treeOk(l, p))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (local) return local;
    const nearby = sdk.findNearbyLoc(p.tree, { reachable: true, withOption: /chop/i });
    if (nearby && treeOk(nearby, p)) return nearby;
    return null;
}

async function closeUi(): Promise<void> {
    const dialog = sdk.getDialog();
    if (dialog?.isOpen) {
        const opts = dialog.options ?? [];
        const skillDlg = opts.some((o) => /make \d+|make x|arrow shaft|shortbow|longbow|axe|dagger/i.test(o.text));
        if (skillDlg) {
            await sdk.sendCloseModal();
            await sdk.waitForTicks(1).catch(() => {});
            return;
        }
    }
    await closeUiShared(bot, sdk);
}

async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
    return walkNearShared(bot, sdk, x, z, tolerance);
}

async function climbDown(): Promise<void> {
    if (pos().level <= 0) return;
    intent('Climbing down to the ground');
    // The gnome stronghold has its own staircases ~10 tiles from the course
    // landing; falling straight to the Seers wheel house walks a bot in the
    // stronghold hundreds of tiles into a wall, so pick the nearest spot.
    const stairSpots = [
        { x: 2461, z: 3417 }, // gnome stronghold, west staircase by the statue
        { x: 2479, z: 3408 }, // gnome stronghold, east staircase
        { x: 2715, z: 3471 } // Seers wheel house
    ];
    for (let i = 0; i < 12 && pos().level > 0; i++) {
        const stairs = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /stair|ladder/i.test(l.name) && l.optionsWithIndex.some((o) => /climb-down|climb.down/i.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!stairs) {
            const p = pos();
            const spot = stairSpots
                .slice()
                .sort(
                    (a, b) =>
                        Math.abs(a.x - p.x) + Math.abs(a.z - p.z) - (Math.abs(b.x - p.x) + Math.abs(b.z - p.z))
                )[0]!;
            await walkNear(spot.x, spot.z, 2);
            continue;
        }
        await bot.interactLoc(stairs, /climb-down|climb.down/i);
        await sdk.waitForCondition((s) => (s.player?.level ?? 1) === 0, 8_000).catch(() => {});
    }
}

function waypointsToSeers() {
    const seersAt = (list: typeof ARDY_TO_CATHERBY) => {
        const idx = list.findIndex((t) => t.x === SEERS_BANK.x && t.z === SEERS_BANK.z);
        return idx >= 0 ? list.slice(0, idx + 1) : list;
    };
    if (pos().x >= 2740) return seersAt(CATHERBY_TO_ARDY);
    if (pos().x <= 2695) return seersAt(ARDY_TO_CATHERBY);
    return [SEERS_BANK];
}

async function walkToSeers(): Promise<void> {
    await climbDown();
    if (inSeers() && distTo(SEERS_BANK.x, SEERS_BANK.z) <= 24) {
        await walkNear(SEERS_BANK.x, SEERS_BANK.z, 4);
        return;
    }
    if (inKandarin()) {
        intent('Walking to Seers bank');
        await walkWaypointsShared(bot, sdk, waypointsToSeers());
        await walkNear(SEERS_BANK.x, SEERS_BANK.z, 4);
        if (inSeers()) return;
    }
    intent('Travelling to Seers');
    // The flax leg scans plane-0 locs; a bot parked upstairs (gnome course,
    // wheel house) reports 'At flax | flax=0' forever without this.
    await climbDown();
    const travel = await travelToSeersFlax({ sdk, bot, log, session });
    if (travel !== 'arrived' && !inSeers()) {
        session.noteFailure('travel', `travel ended ${travel}`);
    }
    await walkNear(SEERS_BANK.x, SEERS_BANK.z, 4);
}

async function openSeersBank(): Promise<boolean> {
    await climbDown();
    if (!sdk.getState()?.bank?.isOpen) await closeUi();
    if (distTo(SEERS_BANK.x, SEERS_BANK.z) > 4) {
        await walkNear(SEERS_BANK.x, SEERS_BANK.z, 2);
    }
    if (!sdk.getState()?.bank?.isOpen) {
        const r = await bot.openBank();
        if (!r.success && !sdk.getState()?.bank?.isOpen) {
            session.noteFailure('bank_open', r.message || 'Could not open Seers bank');
            return false;
        }
    }
    await sdk
        .waitForCondition((s) => s.bank?.isOpen === true && (s.bank.items?.length ?? 0) > 0, 8_000)
        .catch(() => {});
    return !!sdk.getState()?.bank?.isOpen;
}

async function depositJunk(extraKeep: RegExp = KEEP): Promise<void> {
    for (const item of [...sdk.getInventory()]) {
        if (extraKeep.test(item.name)) continue;
        const r = await bot.depositItem(item, -1);
        if (!r.success && sdk.isBankOpen()) {
            await sdk.sendBankDeposit(item.slot, -1);
            await sdk.waitForTicks(1);
        }
    }
}

async function withdrawOne(pattern: RegExp): Promise<boolean> {
    if (sdk.findInventoryItem(pattern) || sdk.findEquipmentItem(pattern)) return true;
    const banked = sdk.findBankItem(pattern);
    if (!banked) return false;
    const r = await bot.withdrawItem(banked, 1);
    if (!r.success && sdk.isBankOpen()) {
        await sdk.sendBankWithdraw(banked.slot, 1);
        await sdk.waitForTicks(2);
    }
    return !!(sdk.findInventoryItem(pattern) || sdk.findEquipmentItem(pattern));
}

async function depositAllAxes(): Promise<void> {
    const eq = sdk.findEquipmentItem(AXE);
    if (eq) {
        await bot.unequipItem(eq);
        await sdk.waitForTicks(1);
    }
    for (const held of [...sdk.getInventory().filter((i) => AXE.test(i.name))]) {
        await bot.depositItem(held, -1);
    }
}

async function withdrawBestAxe(): Promise<boolean> {
    const wood = wc();
    const cur = currentAxeName();
    const curRank = cur ? axeRank(cur) : 99;
    for (const tier of AXE_TIERS) {
        if (wood < tier.level) continue;
        const rank = axeRank(tier.name);
        const pat = new RegExp(`^${tier.name}$`, 'i');
        const inBank = !!sdk.findBankItem(pat);
        const inHand = !!(sdk.findInventoryItem(pat) || sdk.findEquipmentItem(pat));
        if (!inBank && !inHand) continue;
        if (rank >= curRank && hasAxe()) return true;
        await depositAllAxes();
        await withdrawOne(pat);
        return hasAxe();
    }
    return hasAxe();
}

async function equipBestAxe(): Promise<void> {
    const want = bestUsableAxeName();
    if (!want) return;
    const equipped = sdk.findEquipmentItem(AXE);
    if (equipped && equipped.name.toLowerCase() === want) return;
    const inv = sdk.findInventoryItem(new RegExp(`^${want}$`, 'i'));
    if (inv) {
        const r = await bot.equipItem(inv);
        log(`Equip ${inv.name}: ${r.success ? 'ok' : r.message}`);
    }
}

async function buyFromArhein(item: RegExp, label: string): Promise<boolean> {
    if (sdk.findInventoryItem(item)) return true;
    if (coins() < 1) {
        session.noteFailure('shop', `Need 1gp for ${label} (have ${coins()})`);
        return false;
    }
    intent(`Buying ${label} from Arhein`);
    await walkNear(ARHEIN_SHOP.x, ARHEIN_SHOP.z, 3);
    const opened = await bot.openShop(/arhein/i);
    if (!opened.success && !sdk.getState()?.shop?.isOpen) {
        session.noteFailure('shop', `Arhein: ${opened.message}`);
        return false;
    }
    await bot.buyFromShop(item, 1);
    await bot.closeShop();
    return !!sdk.findInventoryItem(item);
}

async function climbOutOfEdgeDungeon(): Promise<void> {
    if (pos().z < 6400) return;
    intent('Climbing out of Edgeville dungeon');
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
        await sdk.waitForCondition((s) => (s.player?.worldZ ?? 9999) < 6400, 10_000).catch(() => {});
    }
}

async function withdrawAxeAndCoins(): Promise<void> {
    await closeUi();
    if (pos().z < 6400 && distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z) > 8 && distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z) < 80) {
        await walkNear(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z, 4);
    }
    const opened = await bot.openBank();
    if (!opened.success && !sdk.getState()?.bank?.isOpen) {
        session.noteFailure('bank_open', opened.message || 'Could not open a bank for an axe');
        return;
    }
    await withdrawBestAxe();
    if (coins() < 250) {
        const banked = sdk.findBankItem(COINS);
        if (banked) await bot.withdrawItem(banked, Math.min(banked.count, 500));
    }
    await bot.closeBank();
}

async function buyAxeFromBob(): Promise<boolean> {
    if (hasAxe()) return true;
    const affordable = SHOP_AXES.filter((axe) => wc() >= axe.level && coins() >= axe.price);
    if (affordable.length === 0) {
        session.noteFailure('no_axe', `Need coins for an axe (have ${coins()}gp)`);
        return false;
    }
    intent("Buying an axe from Bob's");
    await walkNear(BOBS_AXES.x, BOBS_AXES.z, 3);
    let opened = await bot.openShop(/^bob$/i);
    if (!opened.success && !sdk.getState()?.shop?.isOpen) {
        await bot.interactNpc(/^bob$/i, /trade/i);
        await sdk.waitForCondition((s) => s.shop?.isOpen === true, 8_000).catch(() => {});
    }
    if (!sdk.getState()?.shop?.isOpen && sdk.getDialog()?.isOpen) {
        await sdk.clickDialogByText(/have you anything to sell/i).catch(() => {});
        await sdk.waitForCondition((s) => s.shop?.isOpen === true, 8_000).catch(() => {});
    }
    if (!sdk.getState()?.shop?.isOpen) {
        session.noteFailure('shop', `Bob shop closed @ ${pos().x},${pos().z}`);
        return false;
    }
    for (const axe of affordable) {
        const bought = await bot.buyFromShop(new RegExp(`^${axe.name}$`, 'i'), 1);
        log(`Buy ${axe.name}: ${bought.success ? 'ok' : bought.message} | coins ${coins()}`);
        if (hasAxe()) break;
    }
    await bot.closeShop();
    if (hasAxe()) await equipBestAxe();
    else await sdk.waitForTicks(20);
    return hasAxe();
}

/** Bank, then Bob. Used by --until-wc before the Seers trip and again if the axe is lost. */
async function ensureChopAxe(): Promise<boolean> {
    if (hasAxe()) {
        await equipBestAxe();
        return true;
    }
    await climbOutOfEdgeDungeon();
    await withdrawAxeAndCoins();
    if (hasAxe()) {
        await equipBestAxe();
        return true;
    }
    if (inKandarin() && pos().x < 2940 && pos().z < 6400) {
        intent('No axe in this bank — walking Kandarin → Edgeville');
        await walkKandarinToEdgeville(bot, sdk, {
            eat: async () => {
                const food = sdk.findInventoryItem(FOOD_EAT);
                if (food && pos().hp < pos().maxHp - 15) await bot.eatFood(food);
            },
            walkNear
        });
        await withdrawAxeAndCoins();
        if (hasAxe()) {
            await equipBestAxe();
            return true;
        }
    }
    return buyAxeFromBob();
}

async function ensureTools(): Promise<boolean> {
    await closeUi();
    const needTinder = !chopOnly() && !fletchingNow();
    const needKnife = !chopOnly() && (fletchingNow() || fl() < TARGET);
    if (hasAxe() && (!needTinder || sdk.findInventoryItem(TINDERBOX)) && (!needKnife || sdk.findInventoryItem(KNIFE))) {
        await equipBestAxe();
        return true;
    }
    if (!(await openSeersBank())) return false;
    await depositJunk();
    await withdrawBestAxe();
    if (needTinder) await withdrawOne(TINDERBOX);
    if (needKnife) await withdrawOne(KNIFE);
    if (coins() < 5) await withdrawOne(COINS);
    await bot.closeBank();
    if (needTinder && !sdk.findInventoryItem(TINDERBOX)) {
        if (!(await buyFromArhein(TINDERBOX, 'tinderbox'))) return false;
        await walkToSeers();
    }
    if (!hasAxe()) {
        if (WC_UNTIL > 0) return ensureChopAxe();
        session.noteFailure('no_axe', 'No axe after bank');
        return false;
    }
    await equipBestAxe();
    return hasAxe() && (!needTinder || !!sdk.findInventoryItem(TINDERBOX));
}

async function smithRuneAxe(): Promise<boolean> {
    if (hasRuneAxe()) {
        log('Already carrying a rune axe');
        return true;
    }
    if (!(await openSeersBank())) return false;
    const bankAxe = sdk.findBankItem(RUNE_AXE);
    const bankBar = sdk.findBankItem(RUNITE_BAR);
    const bankHammer = sdk.findBankItem(HAMMER);
    log(
        `Bank rune-axe=${bankAxe?.count ?? 0} runite-bar=${bankBar?.count ?? 0} hammer=${bankHammer?.count ?? 0} smith=${smithing()}`
    );
    if (bankAxe) {
        log('Withdrawing rune axe from bank');
        await withdrawOne(RUNE_AXE);
        await bot.closeBank();
        return hasRuneAxe();
    }
    if (smithing() < SMITH_AXE_LEVEL) {
        log(`Smithing ${smithing()} — need ${SMITH_AXE_LEVEL} for a rune axe`);
        await bot.closeBank();
        return false;
    }
    if (!bankBar && !sdk.findInventoryItem(RUNITE_BAR)) {
        session.noteFailure('no_bars', 'No runite bar to smith a rune axe');
        await bot.closeBank();
        return false;
    }
    await depositJunk(/^(coins|hammer|runite bar|(bronze|iron|steel|black|mithril|adamant|rune) axe)$/i);
    await withdrawOne(HAMMER);
    await withdrawOne(RUNITE_BAR);
    log(`Inv hammer=${!!sdk.findInventoryItem(HAMMER)} bar=${!!sdk.findInventoryItem(RUNITE_BAR)}`);
    await bot.closeBank();
    intent('Smithing a rune axe at Seers');
    await walkNear(SEERS_ANVIL.x, SEERS_ANVIL.z, 2);
    const r = await bot.smithAtAnvil('rune axe', { barPattern: RUNITE_BAR, timeout: 20_000 });
    log(`Smith rune axe: ${r.success ? 'ok' : r.message}`);
    if (!r.success) session.noteFailure('smith', r.message);
    if (await openSeersBank()) {
        const hammer = sdk.findInventoryItem(HAMMER);
        if (hammer) await bot.depositItem(hammer, -1);
        await bot.closeBank();
    }
    return hasRuneAxe();
}

function cannotBurn(): boolean {
    return (sdk.getState()?.gameMessages ?? []).some((m) => /need a firemaking level/i.test(m.text));
}

async function dropLogs(pattern: RegExp): Promise<void> {
    while (sdk.findInventoryItem(pattern)) {
        await bot.dropItem(pattern, 1);
        await sdk.waitForTicks(1);
    }
}

async function dropStrayLogs(p: Phase, alsoKeep?: RegExp): Promise<void> {
    for (const item of [...sdk.getInventory()]) {
        if (!ANY_LOGS.test(item.name) || p.logs.test(item.name)) continue;
        if (alsoKeep?.test(item.name)) continue;
        intent(`Dropping stray ${item.name}`);
        await bot.dropItem(item, 1);
        await sdk.waitForTicks(1);
    }
}

async function stepForFire(): Promise<void> {
    fireZ -= 1;
    while (fireZ >= FIRE_FIELD.minZ && !isTileWalkable(0, fireCol, fireZ)) fireZ -= 1;
    if (fireZ < FIRE_FIELD.minZ) pickFireLane();
    await sdk.sendWalk(fireCol, fireZ, true);
    await sdk.waitForTicks(2);
}

async function goToFireLine(): Promise<void> {
    const p = pos();
    if (p.x >= FIRE_FIELD.minX && p.x <= FIRE_FIELD.maxX && p.z >= FIRE_FIELD.minZ && p.z <= FIRE_FIELD.maxZ && Math.abs(p.x - fireCol) <= 1) return;
    pickFireLane();
    intent(`Walking to fire lane x ${fireCol} (field east of the bank path)`);
    await walkNear(fireCol, fireZ, 1);
}

async function burnInventory(p: Phase): Promise<void> {
    if (!sdk.findInventoryItem(p.logs) || !sdk.findInventoryItem(TINDERBOX)) return;
    if (fm() < p.burnLevel) {
        log(`FM ${fm()} — dropping ${p.id} logs (need ${p.burnLevel} to burn)`);
        await dropLogs(p.logs);
        return;
    }
    await goToFireLine();
    let fails = 0;
    while (sdk.findInventoryItem(p.logs) && fails < 40 && !session.isStopped()) {
        await closeUi();
        if (cannotBurn() || fm() < p.burnLevel) {
            log(`Cannot burn ${p.id} at FM ${fm()} — dropping`);
            await dropLogs(p.logs);
            return;
        }
        intent(`Burning ${p.id} logs (FM ${fm()})`);
        const r = await bot.burnLogs(p.logs);
        if (r.success) {
            session.noteProgress('xp', 'firemaking');
            fails = 0;
            await stepForFire();
            continue;
        }
        fails++;
        if (cannotBurn()) {
            await dropLogs(p.logs);
            return;
        }
        if (/move|can't light|bad location/i.test(r.message)) {
            await stepForFire();
            continue;
        }
        session.noteFailure('burn', r.message);
        await stepForFire();
    }
}

async function fletchInventory(p: Phase): Promise<void> {
    if (!sdk.findInventoryItem(KNIFE) || !sdk.findInventoryItem(p.logs)) return;
    const product = fletchProduct(p);
    await dropStrayLogs(p);
    while (sdk.findInventoryItem(p.logs) && !session.isStopped()) {
        await closeUi();
        if (!sdk.findInventoryItem(KNIFE)) break;
        intent(`Fletching ${product}`);
        const r = await bot.fletchLogs(product);
        if (!r.success) {
            session.noteFailure('fletch', r.message);
            if (/level too low|no fletching product/i.test(r.message)) break;
            break;
        }
        session.noteProgress('xp', 'fletching');
        await sdk.waitForTicks(1);
    }
}

async function bankProducts(): Promise<void> {
    const bows = sdk.getInventory().filter((i) => BOW.test(i.name) || SHAFTS.test(i.name));
    if (bows.length === 0 && !invFull()) return;
    if (!(await openSeersBank())) return;
    await depositJunk();
    if (fletchingNow()) {
        const tinder = sdk.findInventoryItem(TINDERBOX);
        if (tinder) await bot.depositItem(tinder, -1);
    }
    await withdrawBestAxe();
    if (!fletchingNow()) await withdrawOne(TINDERBOX);
    await withdrawOne(KNIFE);
    await bot.closeBank();
    session.noteProgress('bank', 'seers');
    log(`Banked fletching products | WC ${wc()} FM ${fm()} FL ${fl()}`);
}

async function bankLogs(): Promise<void> {
    if (!(await openSeersBank())) return;
    await depositJunk();
    await withdrawBestAxe();
    await bot.closeBank();
    session.noteProgress('bank', 'seers');
    log(`Banked ${phase().id} logs | WC ${wc()}`);
}

async function goToTrees(p: Phase): Promise<void> {
    const stand = currentSpot(p);
    session.setAnchor(stand.x, stand.z);
    if (distTo(stand.x, stand.z) <= p.maxDrift) return;
    intent(`Walking to Seers ${p.id} trees`);
    await walkNear(stand.x, stand.z, 4);
}

/**
 * Where the current phase wants the bot to stand right now: the ladder's
 * current spot for the yew patch, otherwise the (fleet-spread) phase stand.
 */
function currentSpot(p: Phase): { x: number; z: number } {
    if (p.id !== 'yew') return chopStand(p);
    return YEW_SPOTS[Math.min(contention.spot, YEW_SPOTS.length - 1)] ?? chopStand(p);
}

// ── Parking ─────────────────────────────────────────────────────────────────
// The box supervisor relaunches an exit-0 container within seconds, so a grind
// that has nothing to do must SLEEP, not return: 200+ restarts/hour per bot is
// what an "exit 0 when finished" loop costs the fleet.

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sleep `ms` in PARK_SLEEP_MS slices. False means a stop was requested. */
async function sleepChunked(ms: number): Promise<boolean> {
    const until = Date.now() + ms;
    for (;;) {
        if (session.isStoppedOrRequested()) return false;
        const left = until - Date.now();
        if (left <= 0) return true;
        await sleep(Math.min(PARK_SLEEP_MS, left));
    }
}

/**
 * Idle in place until a stop is requested (or, with `resumeAfterMs`, for that
 * long and then return so the caller can retry). Never exits by itself.
 */
async function park(reason: string, resumeAfterMs = 0): Promise<void> {
    // --exit-when-met: a met level target ends the process instead of idling,
    // because the caller is an orchestrator waiting on this child.
    if (EXIT_WHEN_MET && ((WC_UNTIL > 0 && wc() >= WC_UNTIL) || (FLETCH_UNTIL > 0 && fl() >= FLETCH_UNTIL))) {
        log(`${reason} — --exit-when-met, exiting 2`);
        process.exit(2);
    }
    const until = resumeAfterMs > 0 ? Date.now() + resumeAfterMs : Number.POSITIVE_INFINITY;
    warn(`parking: ${reason} @ ${pos().x},${pos().z} — idling instead of exiting (exit 0 is relaunched in seconds)`);
    while (Date.now() < until) {
        if (!(await sleepChunked(Math.min(PARK_HEARTBEAT_MS, until - Date.now())))) return;
        if (Date.now() < until) {
            log(`parked: ${reason} @ ${pos().x},${pos().z} WC ${wc()} FM ${fm()} FL ${fl()}`);
        }
    }
    log(`park over (${reason}) — resuming @ ${pos().x},${pos().z}`);
}

/**
 * No axe/tool. `--fletch` and `--yews` deliberately have no Bob's-Axes
 * fallback, so this only retries the Seers bank: a park, never a silent trek
 * for an axe the account cannot buy.
 */
async function parkForTools(): Promise<void> {
    while (!session.isStoppedOrRequested()) {
        warn(
            `no usable axe/tools @ ${pos().x},${pos().z} — parking, Seers bank retry in ${Math.round(PARK_TOOL_RETRY_MS / 1000)}s`
        );
        if (!(await sleepChunked(PARK_TOOL_RETRY_MS))) return;
        if (await ensureTools()) {
            log(`tools recovered after park axe=${currentAxeName() ?? 'none'} @ ${pos().x},${pos().z}`);
            return;
        }
    }
}

// ── Contention ladder ───────────────────────────────────────────────────────

function resetContention(keepSpot = false): void {
    contention.streak = 0;
    contention.emptyPasses = 0;
    contention.lastMoveAt = 0;
    contention.held = 0;
    if (!keepSpot) contention.spot = 0;
}

/** True while contention is the chop loop's business, so recovery stays out. */
function contentionActive(): boolean {
    if (contention.streak > 0) return true;
    return contention.lastMoveAt > 0 && Date.now() - contention.lastMoveAt < CONTENTION_HOLD_RECOVERY_MS;
}

/** Nearest live tree of this phase's tier that is a real move away from `from`. */
function findTreeAway(p: Phase, from: { x: number; z: number } | null, minMove: number, radius: number) {
    return (sdk.getNearbyLocs() ?? [])
        .filter((l) => p.tree.test(l.name) && l.optionsWithIndex.some((o) => /chop/i.test(o.text)))
        .filter((l) => l.reachable !== false)
        .filter((l) => treeOk(l, p))
        .filter((l) => (l.distance ?? 99) <= radius)
        .filter((l) => !from || Math.max(Math.abs(l.x - from.x), Math.abs(l.z - from.z)) >= minMove)
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
}

/** Nearest walkable tile adjacent to a loc — locs (trees) stand on blocked tiles. */
function standNextTo(x: number, z: number): { x: number; z: number } {
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        if (isTileWalkable(0, x + dx!, z + dz!)) return { x: x + dx!, z: z + dz! };
    }
    return { x, z };
}

/**
 * One rung of the ladder. Returns which rung fired. A location note is only
 * credited when the tile actually advanced (noteProgress enforces it), so a
 * refused walk cannot fake progress.
 */
async function contentionMove(p: Phase): Promise<'tree' | 'spot' | 'tier' | 'none'> {
    await sdk.scanNearbyLocs(CONTENTION_SCAN_RADIUS).catch(() => {});
    contention.lastMoveAt = Date.now();

    const other = findTreeAway(p, contention.from, CONTENTION_MIN_MOVE, CONTENTION_SCAN_RADIUS);
    if (other) {
        intent(`Crowded ${p.id} patch — moving to ${other.name} at ${other.x},${other.z}`);
        warn(`contention: moving to ${other.name} at ${other.x},${other.z} (different tree)`);
        const beside = standNextTo(other.x, other.z);
        await walkNear(beside.x, beside.z, 2);
        session.noteProgress('location', `contention tree ${other.x},${other.z}`);
        contention.from = { x: other.x, z: other.z };
        return 'tree';
    }

    const spots = phaseSpots(p);
    if (contention.spot + 1 < spots.length) {
        contention.spot++;
        const spot = spots[contention.spot]!;
        intent(`No live ${p.id} here — walking to spot ${spot.x},${spot.z}`);
        warn(`contention: no live ${p.id} in ${CONTENTION_SCAN_RADIUS} tiles — walking to spot ${spot.x},${spot.z}`);
        await walkNear(spot.x, spot.z, 2);
        session.noteProgress('location', `contention spot ${spot.x},${spot.z}`);
        contention.from = null;
        return 'spot';
    }

    const down = BANK_YEWS ? null : TIER_DOWN[p.id];
    if (down) {
        tierFallback.id = down;
        tierFallback.until = Date.now() + TIER_FALLBACK_MS;
        contention.spot = 0;
        contention.from = null;
        warn(
            `contention: no live ${p.id} left in the patch — ${down} for ${Math.round(TIER_FALLBACK_MS / 1000)}s`
        );
        await goToTrees(PHASES[down]);
        return 'tier';
    }

    return 'none';
}

/**
 * Called from the chop loop for every "no live tree" / "felled by someone
 * else". These are CONTENTION, not failure events: they are logged as warns
 * and handled here, so recovery tactics are never spent on a crowded spot.
 */
async function onContention(p: Phase, why: string, at?: { x: number; z: number }): Promise<void> {
    if (at) contention.from = at;
    contention.streak++;
    warn(`contention ${p.id}: ${why} (${contention.streak}/${CONTENTION_MOVE_AFTER})`);
    if (contention.streak < CONTENTION_MOVE_AFTER) {
        await sdk.waitForTicks(CONTENTION_RETRY_TICKS).catch(() => {});
        return;
    }
    contention.streak = 0;
    const moved = await contentionMove(p);
    if (moved !== 'none') {
        contention.emptyPasses = 0;
        return;
    }
    // Nothing chopable anywhere: THAT is a genuine lost state — let recovery
    // run, and park if it keeps happening.
    session.noteFailure('no_tree', `no live ${p.id} within ${CONTENTION_SCAN_RADIUS} of ${pos().x},${pos().z}`);
    contention.emptyPasses++;
    if (contention.emptyPasses >= CONTENTION_PARK_PASSES) {
        resetContention();
        await park(`no live ${p.id} trees in the area`, PARK_RETRY_MS);
    }
}

async function tick(): Promise<void> {
    await closeUi();
    await climbDown();
    const p = effectivePhase();

    if (!hasAxe() || (!chopOnly() && !fletchingNow() && !sdk.findInventoryItem(TINDERBOX))) {
        if (WC_UNTIL > 0 && !hasAxe()) await ensureChopAxe();
        else if (!(await ensureTools())) await parkForTools();
        return;
    }
    if (fletchingNow() && !sdk.findInventoryItem(KNIFE) && sdk.findInventoryItem(p.logs)) {
        if (!(await ensureTools())) await parkForTools();
        return;
    }

    // A tier downgrade must not make the bot drop the finer logs it already
    // chopped: keep both tiers' logs, drop only unrelated ones.
    await dropStrayLogs(p, phase().logs);

    if (fletchingNow() && (sdk.findInventoryItem(BOW) || sdk.findInventoryItem(SHAFTS))) {
        if (invFull() || count(BOW) >= 10 || !sdk.findInventoryItem(p.logs)) {
            await bankProducts();
            return;
        }
    }

    if (sdk.findInventoryItem(p.logs) && (invFull() || occupiedSlots() >= 27)) {
        if (WC_UNTIL > 0) {
            intent(`Dropping ${p.id} logs (WC ${wc()}/${WC_UNTIL})`);
            await dropLogs(p.logs);
        } else if (BANK_YEWS) {
            await bankLogs();
        } else if (fletchingNow()) {
            await fletchInventory(p);
            await bankProducts();
        } else {
            await burnInventory(p);
        }
        return;
    }

    if (invFull() && !sdk.findInventoryItem(p.logs)) {
        if (BANK_YEWS || WC_UNTIL > 0) await bankLogs();
        else if (fletchingNow()) await bankProducts();
        else await depositJunk();
        return;
    }

    await goToTrees(p);
    await sdk.scanNearbyLocs(12).catch(() => {});
    let tree = findTree(p);
    if (!tree) {
        // One respawn wait at the spot the ladder currently wants before the
        // spot is called crowded (walking back to the home stand here is what
        // pinned the bot to the same four tiles).
        const stand = currentSpot(p);
        intent(`Waiting for ${p.id} to respawn at ${stand.x},${stand.z}`);
        await walkNear(stand.x, stand.z, 3);
        await sdk.waitForTicks(CONTENTION_RETRY_TICKS);
        await sdk.scanNearbyLocs(12).catch(() => {});
        tree = findTree(p);
    }
    if (!tree) {
        await onContention(p, `no live ${p.id} at ${pos().x},${pos().z}`);
        return;
    }

    intent(`Chop ${tree.name} at ${tree.x},${tree.z} (WC ${wc()} FM ${fm()})`);
    const before = count(p.logs);
    const r = await bot.chopTree(tree);
    if (count(p.logs) > before) {
        // Real work: the ladder and any tier downgrade go back to normal.
        resetContention(true);
        session.noteProgress('inventory', p.id);
        return;
    }
    if (CONTENDED.test(r.message)) {
        // Someone else felled it (or it never yielded): crowded spot, not a
        // stuck loop — the ladder moves instead of recovery running.
        await onContention(p, `${tree.name} at ${tree.x},${tree.z}: ${r.message}`, { x: tree.x, z: tree.z });
        return;
    }
    if (!r.success) session.noteFailure('chop', r.message);
}

session.registerRecovery([
    {
        name: 'close_ui',
        run: async () => {
            await closeUi();
            return true;
        }
    },
    {
        name: 'seers_bank',
        run: async () => {
            await walkToSeers();
            return inSeers();
        }
    },
    {
        name: 'tools',
        run: async () => ensureTools()
    },
    {
        name: 'trees',
        run: async () => {
            const p = phase();
            await goToTrees(p);
            await sdk.scanNearbyLocs(12).catch(() => {});
            return !!findTree(p);
        }
    }
]);

function logLevels(): void {
    if (wc() !== lastLoggedWc) {
        log(`LEVEL UP Woodcutting ${wc()} | ${phase().id}`);
        lastLoggedWc = wc();
        session.noteProgress('xp', `wc ${wc()}`);
    }
    if (fm() !== lastLoggedFm) {
        log(`LEVEL UP Firemaking ${fm()} | ${phase().id}`);
        lastLoggedFm = fm();
        session.noteProgress('xp', `fm ${fm()}`);
    }
    if (fl() !== lastLoggedFl) {
        log(`LEVEL UP Fletching ${fl()} | ${fletchProduct(phase())}`);
        lastLoggedFl = fl();
        session.noteProgress('xp', `fl ${fl()}`);
    }
}

/**
 * A met target or a finished grind is a PARK, never an exit 0: the box
 * supervisor relaunches exit-0 containers within seconds, which is how the
 * fleet burned 200+ restarts/hour per bot overnight.
 */
function targetReached(): string | null {
    if (WC_UNTIL > 0 && wc() >= WC_UNTIL) return `WC ${wc()} — --until-wc=${WC_UNTIL} met`;
    if (FLETCH_UNTIL > 0 && fl() >= FLETCH_UNTIL) return `Fletch ${fl()} — --until-fletch=${FLETCH_UNTIL} met`;
    if (!BANK_YEWS && !(WC_UNTIL > 0) && wc() >= TARGET && fm() >= TARGET && fl() >= TARGET) {
        return `WC ${wc()} FM ${fm()} FL ${fl()} — all 99`;
    }
    return null;
}

try {
    lastLoggedWc = wc();
    lastLoggedFm = fm();
    lastLoggedFl = fl();
    await bot.skipTutorial();
    await closeUi();
    log(
        `${WC_UNTIL > 0 ? `Seers WC until ${WC_UNTIL}` : BANK_YEWS ? 'Seers yew-bank' : 'Seers WC/FM'} start WC ${lastLoggedWc} FM ${lastLoggedFm} FL ${lastLoggedFl} Smith ${smithing()} @ ${pos().x},${pos().z}`
    );

    let parkedOut = false;
    const alreadyMet = targetReached();
    if (alreadyMet) {
        parkedOut = true;
        await park(alreadyMet);
        session.stop('done', alreadyMet);
    } else if (WC_UNTIL > 0) {
        await session.setPhase('axe');
        const gotAxe = await ensureChopAxe();
        log(`Axe: ${gotAxe ? (currentAxeName() ?? 'yes') : `none (${coins()}gp, will retry Bob)`}`);
    }

    if (!session.isStopped() && !parkedOut) {
    await session.setPhase('travel');
    await walkToSeers();

    if (!BANK_YEWS && !(WC_UNTIL > 0)) {
        await session.setPhase('smith');
        session.setAnchor(SEERS_ANVIL.x, SEERS_ANVIL.z);
        const smithed = await smithRuneAxe();
        log(`Rune axe: ${smithed ? currentAxeName() ?? 'yes' : `using ${currentAxeName() ?? 'none'}`}`);
    }

    await session.setPhase('tools');
    if (!(await ensureTools())) {
        if (WC_UNTIL > 0) {
            log(`Tools still missing @ ${pos().x},${pos().z} — chop loop retries the axe`);
        } else {
            // No axe and no (documented) Bob's-Axes fallback in this mode:
            // park and retry the bank instead of exiting 0 into a restart loop.
            await parkForTools();
        }
    } else {
        log(
            `Tools axe=${currentAxeName() ?? 'none'} tinder=${!!sdk.findInventoryItem(TINDERBOX)} knife=${!!sdk.findInventoryItem(KNIFE)} phase=${phase().id}`
        );
    }

    while (!session.isStoppedOrRequested()) {
        if (session.needsRecovery()) {
            // Contention is the chop loop's business: the ladder is moving the
            // bot between trees/spots, so step_off/rewalk/climb_floor/close_ui
            // would only burn the budget on a crowded patch.
            if (contentionActive()) {
                contention.held++;
                if (contention.held === 1 || contention.held % 4 === 0) {
                    warn(
                        `contention: holding recovery (streak ${contention.streak}, spot ${contention.spot}, held ${contention.held}) — ladder is moving`
                    );
                }
                await sleepChunked(PARK_SLEEP_MS);
                continue;
            }
            resetContention();
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        await closeUi();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }
        logLevels();
        const met = targetReached();
        if (met) {
            await park(met);
            session.stop('done', met);
            break;
        }
        const p = effectivePhase();
        const wantPhase = chopOnly() ? `chop_${p.id}` : fletchingNow() ? `fletch_${p.id}` : `burn_${p.id}`;
        if (session.metrics().phase !== wantPhase) await session.setPhase(wantPhase);
        const stand = currentSpot(p);
        session.setAnchor(stand.x, stand.z);
        await tick();
    }
    }

    const stop = session.metrics().stopReason;
    if (stop) log(`stopped ${stop.code} @ ${stop.location.x},${stop.location.z}`);
} catch (err) {
    session.stopRestartable('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    await session.finalizeStop();
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
