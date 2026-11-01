/**
 * Agility 44→99: Gnome Stronghold course until 52, then wilderness course
 * with full-inventory food restocks at the Mage Arena bank (Gundai).
 *
 *   bun bots/quests/agility-route.ts jackthief
 */
import { ActivitySession, BotSDK, deriveGatewayUrl, inWilderness } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { findLongPath, initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import {
    closeUi as closeUiShared,
    crossGangplank as crossGangplankShared,
    distTo as distToShared,
    walkKandarinToEdgeville,
    walkNear as walkNearShared,
    walkWaypoints as walkWaypointsShared
} from './movement';
import { ARDOUGNE_BANK, ARDOUGNE_MARKET, BRIMHAVEN_CUSTOMS, type Tile } from './tiles';
import { foodHeal } from './food-heal';
import { GnomeCourse, GNOME_START } from './gnome-course';
import { WildyCourse } from './wildy-course';
import { installGracefulShutdown } from '../../sdk/runner';

/**
 * `--until=N`: a queued task (todo.json) that trains to N and ends ("already complete" marks
 * it done) — e.g. Agility 12 for the Brimhaven stepping stones, 50 for Legends. Without it,
 * the grind parks at 99 as before.
 */
const UNTIL_ARG = Number(process.argv.find((a) => a.startsWith('--until='))?.split('=')[1] ?? 0);
const TARGET_LEVEL = UNTIL_ARG > 0 ? UNTIL_ARG : 99;
// Stay on the gnome course all the way to 99: the wilderness course's Mage
// Arena food restock loops (walkToMage never lands), so every bot that crossed
// 52 stalled in wildy_prep. Gnome laps pay the full +1162 bonus and are safe.
const GNOME_UNTIL = 99;
const GNOME_BANK = ARDOUGNE_BANK;
/** Karamja → Brimhaven dock (mainland crossing is a separate boat step). */
const TO_BRIMHAVEN: Tile[] = [
    { x: 2862, z: 3022 },
    { x: 2838, z: 3051 },
    { x: 2798, z: 3208 },
    BRIMHAVEN_CUSTOMS
];
const GNOME_GATE = { x: 2459, z: 3383 };
/** `gnome_areagate` in m38_52 (`0 27 55: 190 10 2`). The gate tile itself is a
 *  wall loc and NOT walkable, so walkTo(2459,3383) fails; this is the walkable
 *  tile 1 south of it that gnome_gate.rs2 itself walks you to ($south_entrance). */
const GNOME_GATE_ID = 190;
const GNOME_GATE_STAND = { x: 2460, z: 3382 };
const GNOME_GATE_INNER = { x: 2461, z: 3385 };
/** East of this x the bot is in the east pocket — inside the z=3383 line but on
 *  the wrong side of the course fence (see GNOME_POCKET_EXIT). */
const GNOME_EAST_POCKET_X = 2488;
/**
 * East-pocket escape: gate stand approach from the course fence at (2494,3436).
 *
 * The pocket is NOT on the course side of the fence and NOT straight west. From
 * sdk/collision-data.json (level 0): (2494,3436) carries WALL_WEST and
 * (2493,3436) carries WALL_EAST — the course fence runs north-south between
 * them, so the first westward step is the one the client rejects, which is why
 * a "raw walk 2494,3436 → 2474,3436" never moved a single tile. findLongPath(0,
 * 2494,3436 → 2474,3436) returns an EMPTY path, and findPath (1:1, what the
 * client and the server's MoveClickHandler use) returns empty too.
 *
 * The only exit is north out of the fence corner, east around it to x≈2506,
 * south to the open ground at z≈3389, then west along it to the gate stand.
 * Every consecutive pair below was accepted by
 * findPath(level 0, a → b, 1x1, NORMAL) and both endpoints are walkable; the
 * whole run matches findLongPath(2494,3436 → 2460,3382), which returns exactly
 * 20 waypoints ending at the stand.
 */
const GNOME_POCKET_EXIT: Tile[] = [
    { x: 2494, z: 3434 },
    { x: 2495, z: 3432 },
    { x: 2498, z: 3430 },
    { x: 2498, z: 3420 },
    { x: 2498, z: 3410 },
    { x: 2502, z: 3406 },
    { x: 2502, z: 3400 },
    { x: 2506, z: 3396 },
    { x: 2506, z: 3390 },
    { x: 2503, z: 3390 },
    { x: 2502, z: 3389 },
    { x: 2489, z: 3389 },
    { x: 2475, z: 3388 },
    { x: 2470, z: 3387 },
    { x: 2466, z: 3382 },
    GNOME_GATE_STAND
];
/** Gate landing → course start. Every hop is 5-12 tiles and every hop is
 *  accepted by findPath(level 0, a → b, 1x1, NORMAL) — the same pathfinder the
 *  server's MoveClickHandler uses — so these are walkable legs, not just
 *  walkable tiles. The old list ended at (2474,3430), a BLOCKED tile: walkTo
 *  failed, the sendWalk fallback dropped, and bots ended up in the east pocket
 *  at (2494,3436) on every attempt. */
const GNOME_ENTRANCE: Tile[] = [
    { x: 2460, z: 3396 },
    { x: 2460, z: 3408 },
    { x: 2463, z: 3412 },
    { x: 2468, z: 3414 },
    { x: 2468, z: 3419 },
    { x: 2470, z: 3424 },
    { x: 2470, z: 3430 },
    { x: 2470, z: 3435 },
    GNOME_START
];
const ARDY_TO_GNOME: Tile[] = [
    { x: 2662, z: 3375 },
    { x: 2550, z: 3410 },
    GNOME_GATE_STAND
];
const GNOME_TO_ARDY: Tile[] = [
    { x: 2458, z: 3370 },
    { x: 2520, z: 3320 },
    { x: 2600, z: 3290 },
    ARDOUGNE_BANK
];
const MAGE_BANK = { x: 2534, z: 4714 };
/** magearena_ladder_to_cellar loc_2871 in m48_61 — climb-down telejumps to Gundai. */
const MAGE_LADDER = { x: 3091, z: 3957 };
const MAGE_LADDER_DOWN_ID = 2871;
const MAGE_LADDER_UP_ID = 2872;
/** East of the bank-hut web — slash from here, then step in to the ladder. */
const MAGE_WEB_STAND = { x: 3094, z: 3957 };
const LUMBY_KNIFE = { x: 3224, z: 3202 };
const SLASH =
    /^(bronze |iron |steel |mithril |adamant |rune )?(axe|sword|scimitar|dagger|claws|battleaxe|longsword|2h sword)$|^knife$/i;
/** Members / spider-web gate — east of the giant spiders, not the west course fence. */
const SPIDER_GATE = { x: 3224, z: 3904 };
const WILDY_COURSE = { x: 2998, z: 3933 };
/** West end of the south fence (loc_1596/1597) — not the spider web gate at 3224. */
const WILDY_COURSE_SOUTH_GATE = { x: 2948, z: 3904 };
const WILDY_COURSE_DOOR = { x: 2998, z: 3917 };
const DITCH_SOUTH = { x: 3088, z: 3518 };
/** Lumbridge / Draynor → Edgeville ditch (south of the river, then north). */
const LUMBY_TO_DITCH: Tile[] = [
    { x: 3126, z: 3378 },
    { x: 3108, z: 3390 },
    { x: 3100, z: 3434 },
    { x: 3083, z: 3464 },
    DITCH_SOUTH
];

const FOOD_WITHDRAW = 27;
const FOOD_MIN = 8;
const FOOD_RE = /^(shark|swordfish|lobster|tuna|bass)$/i;
const FOOD_PRIORITY = ['shark', 'swordfish', 'lobster', 'tuna', 'bass'] as const;
const EAT_BELOW_HP = 55;
const BANK_RETRY_MS = 90_000;
let lastBankFailMs = 0;
const OBSTACLE_WAIT_MS = 18_000;
const STALL_OBSTACLES = 8;

/** Mage Arena surface → west course gate. Stay south of the course lava. */
const MAGE_TO_COURSE = [
    { x: 3108, z: 3956 },
    { x: 3105, z: 3934 },
    { x: 3042, z: 3929 },
    { x: 2981, z: 3913 },
    { x: 2948, z: 3902 }
];

/**
 * West of x=2944 at the course fence is unallocated void — sendWalk cannot go west
 * through ice giants to 2920,3890. Leave south of the fence, east to the members gate.
 */
const FENCE_EAST_TO_GATE: Tile[] = [
    { x: 3000, z: 3898 },
    { x: 3080, z: 3898 },
    { x: 3158, z: 3900 },
    { x: 3224, z: 3902 }
];

/** North of the members gate → Mage Arena bank ladder, north of the keep (never onto the 3158,3951 web). */
const GATE_NORTH_TO_MAGE: Tile[] = [
    { x: 3165, z: 3957 },
    { x: 3129, z: 3957 },
    { x: 3108, z: 3956 },
    MAGE_LADDER
];

/** Edgeville ditch → members gate (east road, south of the z=3904 fence). */
const DITCH_TO_MAGE: Tile[] = [
    { x: 3088, z: 3550 },
    { x: 3102, z: 3610 },
    { x: 3110, z: 3700 },
    { x: 3124, z: 3851 },
    { x: 3158, z: 3900 },
    { x: 3224, z: 3902 }
];

/** Edgeville ditch → course south fence (stay south of ice giants / west gate). */
const DITCH_TO_COURSE: Tile[] = [
    { x: 3088, z: 3550 },
    { x: 3040, z: 3610 },
    { x: 2990, z: 3680 },
    { x: 2975, z: 3800 },
    { x: 2948, z: 3900 }
];

let foodRunIndex = 0;
let mageWalkIndex = 0;
let gateToMageIndex = 0;
let lumbyDitchIndex = 0;
/** Entrance retry budget (see ensureGnomeEntrance): keyed on the tile the last
 *  attempt started from, so only a *stationary* bot runs out of attempts. The
 *  cooldown lets a transient client rejection retry later instead of wedging
 *  the bot silent for the rest of the run. */
let gnomeEntranceTile: string | null = null;
let gnomeEntranceTries = 0;
let gnomeEntranceReported = false;
let gnomeEntranceAtMs = 0;
const GNOME_ENTRANCE_TRIES = 1;
const GNOME_ENTRANCE_COOLDOWN_MS = 90_000;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/agility-route.ts {botname}`);
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
const session = new ActivitySession(sdk, bot, {
    name: 'agility',
    grindLogPath: GRIND_LOG,
    stallMs: 35_000,
    // 3 built-in (close_ui/step_off/rewalk) + the registered tactics below.
    // Capped at 8: the wildy tactics are now proximity-gated (inWildyReach), so
    // a bot in the stronghold only ever has ~4 actionable tactics. The old cap
    // of 14 meant ten wilderness treks per recovery cycle for a bot standing
    // 700 tiles from the ditch.
    maxRecoveryTactics: 8
});

installGracefulShutdown();

let laps = 0;
// Post-exhaust fallback: wildy unreachable — train the safe gnome course
// until this timestamp instead of spinning on an unwinnable trek.
let fallbackGnomeUntil = 0;
/** Set once the endgame park loop starts (it never returns before a stop). */
let parked = false;
let obstacleStreak = 0;
let lastXp = 0;

function log(msg: string): void {
    session.log('log', msg);
}

/** Zero-CPU wait. Parking must not keep sending packets or spinning ticks. */
function sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function intent(msg: string): void {
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

function agilityLevel(): number {
    return sdk.getSkill('Agility')?.baseLevel ?? 1;
}

function agilityXp(): number {
    return sdk.getSkill('Agility')?.experience ?? 0;
}

const gnomeCourse = new GnomeCourse({
    sdk,
    bot,
    session,
    log,
    intent,
    closeUi,
    agilityXp,
    agilityLevel,
    pos,
    distTo,
    isStopped: () => session.isStopped()
});

const wildyCourse = new WildyCourse({
    sdk,
    bot,
    session,
    log,
    intent,
    closeUi,
    agilityXp,
    agilityLevel,
    pos,
    distTo,
    isStopped: () => session.isStopped()
});

function onWildyCourse(): boolean {
    const p = pos();
    // x cap: the ground east of the course fence (e.g. 3041,3942) is
    // within 80 tiles but is NOT the course — without the cap the bot
    // runs lap logic there instead of entry routing and stalls on pipe.
    return inWilderness(p.x, p.z) && p.z >= 3929 && p.z < 5000 && p.x <= 3010 && distTo(WILDY_COURSE.x, WILDY_COURSE.z) < 80;
}

/** Log-balance / lava fail drops into the underground pit (z≈10362). */
function inWildyCoursePit(): boolean {
    const p = pos();
    return p.x >= 2985 && p.x <= 3025 && p.z > 5000;
}

const PIT_LADDER = { x: 3005, z: 10363 };
/** loc_1755 in m46_161 — climb-up, z-6400 (pit → surface). Not loc_1757. */
const PIT_LADDER_LOC_ID = 1755;
let pitLadderLocId: number | null = PIT_LADDER_LOC_ID;

async function climbOutOfWildyPit(): Promise<boolean> {
    if (!inWildyCoursePit()) return true;
    await session.setPhase('wildy_recover');
    intent('Climbing out of wildy course pit');

    const deadline = Date.now() + 18_000;
    while (inWildyCoursePit() && Date.now() < deadline && !session.isStopped()) {
        if (pos().isDead) return false;
        // Skeletons hit hard in the pit — eat above the course threshold.
        await eatIfNeeded(80);
        session.noteProgress('location', 'pit climb click');

        const { x: x0, z: z0 } = pos();
        if (distTo(PIT_LADDER.x, PIT_LADDER.z) > 2) {
            await sdk.sendWalk(PIT_LADDER.x, PIT_LADDER.z, true);
            await sdk.waitForTicks(2).catch(() => {});
        }

        await sdk.scanNearbyLocs(12).catch(() => {});
        const ladder = (sdk.getNearbyLocs() ?? []).find(
            (l) =>
                /ladder/i.test(l.name) &&
                l.z > 5000 &&
                l.optionsWithIndex.some((o) => /climb-up/i.test(o.text))
        );
        if (ladder) {
            pitLadderLocId = ladder.id;
            const up = ladder.optionsWithIndex.find((o) => /climb-up/i.test(o.text))!;
            await sdk.sendInteractLoc(ladder.x, ladder.z, ladder.id, up.opIndex);
        } else {
            await sdk.sendInteractLoc(PIT_LADDER.x, PIT_LADDER.z, pitLadderLocId ?? PIT_LADDER_LOC_ID, 1);
        }
        await sdk
            .waitForCondition(
                (s) => (s.player?.worldZ ?? 99_999) < 5000 || s.player?.isDead === true,
                800
            )
            .catch(() => {});
        if (Math.hypot(pos().x - x0, pos().z - z0) < 1 && inWildyCoursePit()) {
            await sdk.waitForTicks(1).catch(() => {});
        }
    }

    if (inWildyCoursePit()) {
        session.noteFailure('pit', 'stuck in wildy course pit');
        return false;
    }
    if (pos().isDead) return false;

    log(`Out of pit @ ${pos().x},${pos().z}`);
    session.noteProgress('xp', 'pit climb');
    wildyCourse.afterPitFall();
    await eatIfNeeded();
    return true;
}

function onGnomeCourse(): boolean {
    const p = pos();
    if (p.z < 3400) return false;
    return distTo(GNOME_START.x, GNOME_START.z) < 90;
}

function pastGnomeGate(): boolean {
    const p = pos();
    // z grows northward here (gnome_gate.rs2's $north_entrance is z+2), so the
    // gate line at z=3383 divides outside from inside. z>=3410 (the old test)
    // called the whole 3384-3409 garden "outside": a bot standing INSIDE at
    // (2462,3395) walked back and re-clicked the gate, and the gate script
    // force-moves an interior click 3 tiles OUT — the in/out bounce in the
    // grind logs ("Entering gnome stronghold" → "Gate interact failed").
    // x<=2488 keeps the east-of-fence pocket (2490+) out of "on the course" so
    // it still runs through ensureGnomeEntrance and crosses at the fence gap.
    return p.z >= 3388 && p.x <= 2488 && distTo(GNOME_START.x, GNOME_START.z) < 90;
}

function inArdougne(): boolean {
    const p = pos();
    return p.x > 2500 && p.x < 2720 && p.z > 3240 && p.z < 3355;
}

function onKaramja(): boolean {
    const p = pos();
    // x<2900, not 3010: the old box swallowed Rimmington (2976,3246), so a bot
    // standing at the copper rocks "was on Karamja" and looped the Brimhaven
    // customs crossing forever instead of walking to the stronghold.
    return p.x > 2680 && p.x < 2900 && p.z > 3040 && p.z < 3270;
}

function onDockedShip(): boolean {
    if (inArdougne()) return false;
    if (pos().level < 1) return false;
    const locs = sdk.getNearbyLocs() ?? [];
    return locs.some((l) => /gangplank|ship's (ladder|wheel)|anchor/i.test(l.name));
}

function coinCount(): number {
    return sdk.getInventory().find((i) => /^coins$/i.test(i.name))?.count ?? 0;
}

async function crossGangplank(): Promise<void> {
    await crossGangplankShared(bot, sdk);
}

async function clickBoatDialog(): Promise<void> {
    let closedStreak = 0;
    for (let i = 0; i < 24; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            closedStreak++;
            if (closedStreak >= 4) return;
            await sdk.waitForTicks(1).catch(() => {});
            continue;
        }
        closedStreak = 0;
        if (dialog.isWaiting) {
            await sdk.waitForTicks(1).catch(() => {});
            continue;
        }
        const opts = dialog.options ?? [];
        const pick =
            opts.find((o) => /search away|nothing to hide/i.test(o.text)) ||
            opts.find((o) => /^ok\.?$/i.test(o.text)) ||
            opts.find((o) => /yes please|pay 30|30 coins|ardougne/i.test(o.text)) ||
            opts.find((o) => /can i journey/i.test(o.text)) ||
            opts.find((o) => /yes/i.test(o.text) && !/crandor|bother|miss|customs/i.test(o.text));
        log(`Boat dialog -> ${pick?.text ?? 'continue'}`);
        await sdk.sendClickDialog(pick?.index ?? 0);
        await sdk.waitForTicks(1).catch(() => {});
    }
}

async function leaveDockedShip(): Promise<void> {
    if (!onDockedShip()) return;
    log(`On docked ship @ ${pos().x},${pos().z} — crossing gangplank`);
    for (let i = 0; i < 6 && onDockedShip(); i++) {
        await crossGangplank();
        await sdk.waitForTicks(2).catch(() => {});
    }
}

async function leaveArdougneDocks(): Promise<void> {
    if (pos().z < 3271 && sdk.findNearbyLoc(/gangplank/i)) {
        log('Leaving Ardougne docks');
        await crossGangplank();
        await sdk.waitForTicks(3).catch(() => {});
    }
    await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 8);
}

async function brimhavenToArdougne(): Promise<boolean> {
    if (inArdougne()) return true;
    if (!onKaramja()) return false;
    await leaveDockedShip();
    intent('Brimhaven customs → Ardougne (30gp)');
    await walkNear(BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z, 4);
    const customs =
        sdk.findNearbyNpc(/^customs officer$/i, { reachable: true }) ??
        sdk.findNearbyNpc(/customs officer/i);
    if (!customs) {
        session.noteFailure('boat', 'No customs officer at Brimhaven');
        return false;
    }
    if (coinCount() < 30) {
        session.noteFailure('boat', `Need 30gp for Brimhaven boat (have ${coinCount()})`);
        return false;
    }
    await bot.talkTo(customs);
    await clickBoatDialog();
    for (let i = 0; i < 24 && !inArdougne(); i++) {
        if (sdk.getDialog()?.isOpen) await clickBoatDialog();
        else if (onDockedShip()) await leaveDockedShip();
        await sdk.waitForTicks(2).catch(() => {});
    }
    log(`After Brimhaven boat @ ${pos().x},${pos().z} gp=${coinCount()}`);
    if (inArdougne()) await leaveArdougneDocks();
    return inArdougne();
}

async function ensureMainland(): Promise<boolean> {
    if (!onKaramja()) return true;
    if (distTo(BRIMHAVEN_CUSTOMS.x, BRIMHAVEN_CUSTOMS.z) > 25) {
        intent('Walking to Brimhaven customs');
        await walkWaypoints(TO_BRIMHAVEN);
    }
    return brimhavenToArdougne();
}

function invFoodCount(): number {
    return sdk.getInventory().filter((i) => FOOD_RE.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function bankFoodCount(): number {
    return sdk.getBankItems().filter((i) => FOOD_RE.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
}

async function closeUi(): Promise<void> {
    await closeUiShared(bot, sdk);
}

async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
    return walkNearShared(bot, sdk, x, z, tolerance);
}

async function walkWaypoints(wps: Tile[]): Promise<void> {
    await walkWaypointsShared(bot, sdk, wps);
}

function nearestSafeBank(): { x: number; z: number } {
    const p = pos();
    const options = [ARDOUGNE_BANK, { x: 3092, z: 3243 }];
    return options.sort((a, b) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(p.x - b.x, p.z - b.z))[0]!;
}

async function sendWalkHop(x: number, z: number): Promise<void> {
    const { x: x0, z: z0 } = pos();
    const southOfFence = x0 >= 2940 && x0 <= 3030 && z0 <= 3902 && z0 >= 3880;
    const dx = x - x0;
    const dz = z - z0;
    const span = Math.hypot(dx, dz);
    let hop =
        span > 42
            ? { x: Math.round(x0 + (dx / span) * 40), z: Math.round(z0 + (dz / span) * 40) }
            : { x, z };
    if (southOfFence && hop.z > 3902) hop = { x: hop.x, z: 3898 };
    intent(`Wildy sendWalk ${hop.x},${hop.z}${span > 42 ? ` (toward ${x},${z})` : ''}`);
    await sdk.sendWalk(hop.x, hop.z, true);
    await sdk
        .waitForCondition(
            (s) => Math.hypot((s.player?.worldX ?? x0) - x0, (s.player?.worldZ ?? z0) - z0) > 6,
            14_000
        )
        .catch(() => {});
    if (Math.hypot(pos().x - x0, pos().z - z0) < 4) {
        const nearFence = x0 >= 2940 && x0 <= 3030 && z0 >= 3885 && z0 <= 3906;
        const inMageHut = x0 >= 3086 && x0 <= 3110 && z0 >= 3948 && z0 <= 3964;
        if (nearFence) {
            intent('Wildy hop blocked — south of fence then east');
            await sdk.sendWalk(x0, 3898, true);
            await sdk.waitForTicks(5).catch(() => {});
            await sdk.sendWalk(x0 + 25, 3898, true);
            await sdk.waitForTicks(5).catch(() => {});
        } else if (inMageHut) {
            intent('Wildy hop blocked — south then east around Mage Arena hut');
            await sdk.sendWalk(x0, 3945, true);
            await sdk.waitForTicks(5).catch(() => {});
            await sdk.sendWalk(3108, 3945, true);
            await sdk.waitForTicks(6).catch(() => {});
        } else {
            intent('Wildy hop blocked — stepping west then north');
            await sdk.sendWalk(x0 - 25, z0, true);
            await sdk.waitForTicks(6).catch(() => {});
            if (Math.hypot(pos().x - x0, pos().z - z0) < 4) {
                await sdk.sendWalk(x0, z0 + 25, true);
                await sdk.waitForTicks(6).catch(() => {});
            }
        }
    }
    session.noteProgress('location', `walk ${pos().x},${pos().z}`);
}

async function sendWalkWaypoints(wps: { x: number; z: number }[]): Promise<void> {
    for (const wp of wps) {
        if (session.isStopped()) return;
        if (distTo(wp.x, wp.z) <= 10) continue;
        await sendWalkHop(wp.x, wp.z);
    }
}

async function leaveWilderness(): Promise<boolean> {
    if (!inWilderness(pos().x, pos().z)) return true;
    intent('Leaving wilderness south');
    // The wilderness ditch only crosses at the gap near x=3088, and long
    // single walks silently drop — line up on the gap, then short-hop out.
    let still = 0;
    for (let i = 0; i < 60 && inWilderness(pos().x, pos().z) && !session.isStopped(); i++) {
        const p = pos();
        if (p.isDead) {
            await waitForRespawn();
            break;
        }
        let tx = 3088;
        let tz = Math.max(3525, p.z - 15);
        if (Math.abs(p.x - 3088) > 8 && p.z > 3560) {
            tx = 3088;
            tz = p.z;
        } else if (p.z <= 3535) {
            tx = 3088;
            tz = 3508;
        }
        const dx = tx - p.x;
        const dz = tz - p.z;
        const span = Math.hypot(dx, dz);
        const hop =
            span > 15
                ? { x: Math.round(p.x + (dx / span) * 15), z: Math.round(p.z + (dz / span) * 15) }
                : { x: tx, z: tz };
        await sdk.sendWalk(hop.x, hop.z, true);
        await sdk
            .waitForCondition(
                (s) =>
                    Math.hypot((s.player?.worldX ?? p.x) - p.x, (s.player?.worldZ ?? p.z) - p.z) > 4 ||
                    (s.player?.worldZ ?? 99_999) < 3520,
                10_000
            )
            .catch(() => {});
        if (Math.hypot(pos().x - p.x, pos().z - p.z) < 2) {
            // No movement: don't burn iterations blind — surface it so the
            // caller retries with fresh routing.
            if (++still >= 2) {
                log(`leaveWilderness stuck @ ${pos().x},${pos().z} — breaking for round retry`);
                break;
            }
            await sdk.waitForTicks(2).catch(() => {});
        } else {
            still = 0;
        }
    }
    return !inWilderness(pos().x, pos().z);
}

async function clickThroughBankerChat(): Promise<void> {
    let sawOpen = false;
    for (let i = 0; i < 16; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            if (sawOpen) return;
            await sdk.waitForTicks(1).catch(() => {});
            continue;
        }
        sawOpen = true;
        if (dialog.isWaiting) {
            await sdk.waitForTicks(1).catch(() => {});
            continue;
        }
        const bank = dialog.options?.find((o) => /bank account|access my bank/i.test(o.text));
        if (bank) {
            await sdk.sendClickDialog(bank.index);
            await sdk.waitForTicks(2).catch(() => {});
            continue;
        }
        const cont = dialog.options?.find((o) => /continue/i.test(o.text));
        if (cont) {
            await sdk.sendClickDialog(cont.index);
            await sdk.waitForTicks(1).catch(() => {});
            continue;
        }
        await sdk.sendClickDialog(dialog.options[0]?.index ?? 1);
        await sdk.waitForTicks(1).catch(() => {});
    }
}

/** On the course, in the pit, or stuck on the ridge gate tiles. */
function inWildyNearCourse(): boolean {
    const p = pos();
    return p.x >= 2940 && p.x <= 3030 && p.z >= 3885 && (p.z < 5000 || inWildyCoursePit());
}

async function waitForRespawn(): Promise<void> {
    intent('Waiting to respawn');
    await sdk.waitForCondition((s) => !s.player.isDead, 60_000).catch(() => {});
    await sdk.waitForTicks(6).catch(() => {});
    wildyCourse.stepIndex = 0;
    foodRunIndex = 0;
    mageWalkIndex = 0;
    gateToMageIndex = 0;
    lumbyDitchIndex = 0;
    log(`Respawned @ ${pos().x},${pos().z}`);
}

/** Course obstacles that deal direct HP damage on fail (see wilderness_course.rs2). */
const OBSTACLE_SUICIDE = [
    { id: 'stones', stand: { x: 3001, z: 3959 }, name: /^stepping stone$/i, option: /jump/i, level: 0 },
    { id: 'rope', stand: { x: 3005, z: 3951 }, name: /^ropeswing$/i, option: /swing/i, level: 0 },
    { id: 'log', stand: { x: 3001, z: 3944 }, name: /^log balance$/i, option: /walk/i, level: 1 }
] as const;

/** Die on wildy course obstacles — empty inv, no item loss, bypasses gate pathing. */
async function suicideInWilderness(): Promise<void> {
    if (pos().isDead) return;
    await session.setPhase('wildy_suicide');
    intent('Dying on wildy course obstacles');

    if (inWildyCoursePit()) {
        if (!(await climbOutOfWildyPit())) return;
    }

    const killer = sdk.findNearbyNpc(/ice giant|ice warrior|white wolf|wolf/i);
    if (killer) {
        intent(`Dying to ${killer.name}`);
        await bot.attack(killer);
        await sdk.waitForCondition((s) => s.player.isDead, 90_000).catch(() => {});
        log(pos().isDead ? 'Died — respawning outside wildy' : 'Suicide: still alive after mob');
        return;
    }

    if (!onWildyCourse() && (southOfWildyCourseFence() || insideWildyCourseYard())) {
        await enterWildyAgilityCourse();
        return;
    }

    const deadline = Date.now() + 90_000;
    while (!pos().isDead && Date.now() < deadline && !session.isStopped()) {
        await closeUi();

        if (inWildyCoursePit()) {
            if (!(await climbOutOfWildyPit())) return;
            continue;
        }

        const obstacle = OBSTACLE_SUICIDE.find((o) => o.level === pos().level) ?? OBSTACLE_SUICIDE[0]!;
        if (obstacle.level === 1 && pos().level === 0) {
            await sdk.scanNearbyLocs(18).catch(() => {});
            const down = (sdk.getNearbyLocs() ?? []).find(
                (l) =>
                    /ladder/i.test(l.name) &&
                    l.optionsWithIndex.some((o) => /climb-down/i.test(o.text))
            );
            if (down) {
                await bot.interactLoc(down, /climb-down/i);
                await sdk.waitForCondition((s) => (s.player?.level ?? 0) === 1, 12_000).catch(() => {});
            }
            continue;
        }

        if (distTo(obstacle.stand.x, obstacle.stand.z) > 10) {
            await sdk.sendWalk(obstacle.stand.x, obstacle.stand.z, true);
            await sdk.waitForTicks(4).catch(() => {});
            continue;
        }

        await sdk.scanNearbyLocs(22).catch(() => {});
        const loc = sdk.findNearbyLoc(obstacle.name);
        if (!loc) {
            await sdk.waitForTicks(3).catch(() => {});
            continue;
        }

        const hp0 = pos().hp;
        const z0 = pos().z;
        await bot.interactLoc(loc, obstacle.option);
        await sdk
            .waitForCondition(
                (s) =>
                    s.player.isDead ||
                    (s.player?.hp ?? hp0) < hp0 ||
                    (s.player?.worldZ ?? z0) !== z0 ||
                    (s.player?.worldZ ?? 0) > 5000,
                25_000
            )
            .catch(() => {});

        if (pos().isDead) break;

        if (obstacle.id === 'stones' && pos().z >= 3960 && pos().hp >= hp0) {
            await sdk.sendWalk(3005, 3959, true);
            await sdk.waitForTicks(4).catch(() => {});
        }
    }

    log(pos().isDead ? 'Died on course — respawning outside wildy' : 'Course suicide: still alive — retry next tick');
}

async function advanceSendWalkPath(
    path: Tile[],
    getIdx: () => number,
    setIdx: (n: number) => void
): Promise<boolean> {
    if (distTo(MAGE_BANK.x, MAGE_BANK.z) <= 20) return true;
    let idx = getIdx();
    while (idx < path.length - 1) {
        const wp = path[idx]!;
        const next = path[idx + 1]!;
        if (distTo(wp.x, wp.z) <= 12) {
            idx++;
            continue;
        }
        if (distTo(next.x, next.z) + 8 < distTo(wp.x, wp.z)) {
            idx++;
            continue;
        }
        break;
    }
    setIdx(idx);
    if (idx >= path.length) return distTo(MAGE_BANK.x, MAGE_BANK.z) <= 22;

    const wp = path[idx]!;
    if (distTo(wp.x, wp.z) <= 10) {
        idx++;
        setIdx(idx);
        return idx >= path.length;
    }
    await sendWalkHop(wp.x, wp.z);
    if (distTo(wp.x, wp.z) <= 12) {
        idx++;
        setIdx(idx);
    }
    return false;
}

function inMageArenaBank(): boolean {
    const p = pos();
    return p.z > 4500 && p.x < 2700;
}

function slashItem() {
    return bot.findEquippedItem(SLASH) ?? sdk.findInventoryItem(SLASH);
}

async function pickupLumbyKnife(): Promise<boolean> {
    if (slashItem()) return true;
    if (inWilderness(pos().x, pos().z)) return false;
    // Bladeless on the mainland near a bank: withdraw a slash blade there
    // instead of trekking ~550 tiles to the Lumbridge ground spawn
    // (Jackpoo2/4 stood ~10 tiles from Ardougne bank while routed to
    // Lumbridge; the long walk dropped and tripped the stall clock).
    if (distTo(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z) < 40) {
        intent('Withdrawing a slash blade from Ardougne bank');
        if (await openBankAt(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z)) {
            const blade = sdk
                .getBankItems()
                .find((i) => SLASH.test(i.name) && (i.count ?? 0) > 0);
            if (blade) {
                await bot.withdrawItem(blade.slot, 1);
                await sdk.waitForTicks(1).catch(() => {});
            }
            await closeUi();
            if (slashItem()) {
                log('Withdrew blade for Mage Arena web');
                return true;
            }
        }
    }
    intent('Picking up Lumbridge knife to slash the Mage Arena web');
    session.noteProgress('location', 'lumby knife');
    if (distTo(LUMBY_KNIFE.x, LUMBY_KNIFE.z) > 6) {
        await sendWalkHop(LUMBY_KNIFE.x, LUMBY_KNIFE.z);
        return !!slashItem();
    }
    const ground = sdk.findGroundItem(/^knife$/i);
    if (ground) {
        await bot.pickupItem(ground);
        await sdk.waitForTicks(2).catch(() => {});
    }
    if (slashItem()) {
        log('Picked up knife for Mage Arena web');
        return true;
    }
    await sdk.sendWalk(LUMBY_KNIFE.x, LUMBY_KNIFE.z, true);
    await sdk.waitForTicks(2).catch(() => {});
    return !!slashItem();
}

async function hutSlashableWebs() {
    return (sdk.getNearbyLocs() ?? []).filter(
        (l) =>
            /^web$/i.test(l.name) &&
            l.x >= 3090 &&
            l.x <= 3098 &&
            l.z >= 3954 &&
            l.z <= 3960 &&
            l.optionsWithIndex.some((o) => /slash/i.test(o.text))
    );
}

async function slashMageBankWeb(): Promise<boolean> {
    const blade = slashItem();
    if (!blade) {
        await sdk.scanNearbyLocs(18).catch(() => {});
        if ((await hutSlashableWebs()).length === 0) return true;
        log('Mage Arena web needs a sharp blade — fetching a knife');
        return false;
    }
    if (!bot.findEquippedItem(SLASH) && !/^knife$/i.test(blade.name)) {
        await bot.equipItem(blade.name);
        await sdk.waitForTicks(1).catch(() => {});
    }
    const knife = sdk.findInventoryItem(/^knife$/i);

    for (let i = 0; i < 8; i++) {
        await sdk.scanNearbyLocs(18).catch(() => {});
        const webs = await hutSlashableWebs();
        if (!webs.length) return true;
        // Two webs sandwich 3094. Slash the one in the direction we need, then the rest.
        const leaving = pos().x >= 3093;
        const web = webs.sort((a, b) => (leaving ? b.x - a.x : a.x - b.x))[0]!;
        intent(`Slashing Mage Arena bank web @ ${web.x},${web.z}`);
        session.noteProgress('location', 'mage web');
        if (knife) {
            await sdk.sendUseItemOnLoc(knife.slot, web.x, web.z, web.id);
        } else {
            const opt = web.optionsWithIndex.find((o) => /slash/i.test(o.text));
            if (opt) await sdk.sendInteractLoc(web.x, web.z, web.id, opt.opIndex);
        }
        await sdk.waitForTicks(3).catch(() => {});
    }
    await sdk.scanNearbyLocs(10).catch(() => {});
    return (await hutSlashableWebs()).length === 0;
}

async function climbMageBankLadder(): Promise<boolean> {
    if (inMageArenaBank()) return true;
    await session.setPhase('wildy_bank');
    if (!(await slashMageBankWeb())) {
        log(`mage ladder: webs uncut @ ${pos().x},${pos().z}`);
        return false;
    }
    intent('Climbing down Mage Arena bank ladder');
    session.noteProgress('location', 'mage ladder');
    await sdk.sendWalk(3092, 3957, true);
    await sdk.waitForCondition(() => distTo(3092, 3957) <= 1, 8_000).catch(() => {});
    await sdk.scanNearbyLocs(12).catch(() => {});
    const ladder = (sdk.getNearbyLocs() ?? []).find(
        (l) =>
            /ladder/i.test(l.name) &&
            l.optionsWithIndex.some((o) => /climb-down/i.test(o.text)) &&
            l.x >= 3088 &&
            l.x <= 3094 &&
            l.z >= 3954 &&
            l.z <= 3960
    );
    if (ladder?.reachable === false) {
        log(`mage ladder: unreachable @ ${pos().x},${pos().z}`);
        return false;
    }
    if (ladder) {
        const down = ladder.optionsWithIndex.find((o) => /climb-down/i.test(o.text))!;
        await sdk.sendInteractLoc(ladder.x, ladder.z, ladder.id, down.opIndex);
    } else {
        log(`mage ladder: none visible @ ${pos().x},${pos().z} — blind interact`);
        await sdk.sendInteractLoc(MAGE_LADDER.x, MAGE_LADDER.z, MAGE_LADDER_DOWN_ID, 1);
    }
    await sdk
        .waitForCondition((s) => (s.player?.worldZ ?? 0) > 4500, 10_000)
        .catch(() => {});
    if (inMageArenaBank()) {
        log(`Mage Arena bank cellar @ ${pos().x},${pos().z}`);
        return true;
    }
    log(`mage ladder: still surface @ ${pos().x},${pos().z}`);
    return false;
}

async function climbOutOfMageBank(): Promise<boolean> {
    if (!inMageArenaBank()) return true;
    await eatIfNeeded();
    intent('Climbing out of Mage Arena bank');
    session.noteProgress('location', 'mage ladder up');
    await sdk.scanNearbyLocs(12).catch(() => {});
    const ladder = (sdk.getNearbyLocs() ?? []).find(
        (l) =>
            /ladder/i.test(l.name) && l.optionsWithIndex.some((o) => /climb-up/i.test(o.text))
    );
    if (ladder) {
        const up = ladder.optionsWithIndex.find((o) => /climb-up/i.test(o.text))!;
        await sdk.sendInteractLoc(ladder.x, ladder.z, ladder.id, up.opIndex);
    } else {
        await sdk.sendInteractLoc(pos().x, pos().z, MAGE_LADDER_UP_ID, 1);
    }
    await sdk
        .waitForCondition((s) => (s.player?.worldZ ?? 99_999) < 4500, 10_000)
        .catch(() => {});
    if (!inMageArenaBank()) {
        wildyCourse.stepIndex = 0;
        return true;
    }
    return false;
}

/** Climb-up lands west of the bank-hut web. Slash, then walk east — never west into the hut. */
async function leaveMageArenaHut(): Promise<boolean> {
    if (inMageArenaBank()) return false;
    if (distTo(MAGE_LADDER.x, MAGE_LADDER.z) > 14) return true;
    // East of the web. Do not slash (that walks back to 3094) — MAGE_TO_COURSE continues east.
    if (pos().x >= 3096) return true;
    intent('Leaving Mage Arena hut east through the web');
    session.noteProgress('location', 'leave mage hut');
    // The hut exit can need several slash→step cycles in a single tick:
    // webs re-block and lone walks drop. Retry in-tick before giving up
    // (Jackpoo3/5 pinned on (3090,3957) failing once per tick forever).
    for (let attempt = 0; attempt < 3; attempt++) {
        if (!(await slashMageBankWeb())) {
            session.noteFailure('mage_web', 'Web needs a blade we do not have');
            return false;
        }
        await sdk.sendWalk(3096, 3957, true);
        await sdk
            .waitForCondition((s) => (s.player?.worldX ?? 0) >= 3096, 8_000)
            .catch(() => {});
        if (pos().x >= 3096) return true;
    }
    return pos().x >= 3096;
}

async function passMembersGateNorth(): Promise<void> {
    intent('Members gate — east, open, walk north through');
    session.noteProgress('location', 'spider gate');
    if (distTo(SPIDER_GATE.x, SPIDER_GATE.z) > 6) {
        await sdk.sendWalk(SPIDER_GATE.x, 3902, true);
        await sdk
            .waitForCondition(() => distTo(SPIDER_GATE.x, SPIDER_GATE.z) <= 8, 10_000)
            .catch(() => {});
    }
    await sdk.scanNearbyLocs(16).catch(() => {});
    const gate = (sdk.getNearbyLocs() ?? []).find(
        (l) =>
            /gate/i.test(l.name) &&
            l.x >= 3220 &&
            l.x <= 3228 &&
            l.z >= 3902 &&
            l.z <= 3906 &&
            l.optionsWithIndex.some((o) => /^open$/i.test(o.text))
    );
    if (gate) {
        const open = gate.optionsWithIndex.find((o) => /^open$/i.test(o.text))!;
        await sdk.sendInteractLoc(gate.x, gate.z, gate.id, open.opIndex);
        await sdk.waitForTicks(2).catch(() => {});
    }
    await sdk.sendWalk(SPIDER_GATE.x, 3912, true);
    await sdk
        .waitForCondition((s) => (s.player?.worldZ ?? 0) >= 3906, 8_000)
        .catch(() => {});
}

async function walkToMageFromSafe(): Promise<boolean> {
    if (distTo(MAGE_BANK.x, MAGE_BANK.z) <= 20) return true;
    if (onWildyCourse() || inWildyCoursePit()) return false;

    if (inMageArenaBank()) {
        await sdk.sendWalk(MAGE_BANK.x, MAGE_BANK.z, true);
        await sdk
            .waitForCondition(() => distTo(MAGE_BANK.x, MAGE_BANK.z) <= 10, 8_000)
            .catch(() => {});
        return distTo(MAGE_BANK.x, MAGE_BANK.z) <= 20;
    }

    if (!slashItem()) {
        if (!inWilderness(pos().x, pos().z)) {
            intent('Need a knife before Mage Arena web');
            if (!(await pickupLumbyKnife())) return false;
        } else if (pos().z >= 3906) {
            log(`No blade for mage web @ ${pos().x},${pos().z} — south through members gate, then Lumbridge knife`);
            session.noteProgress('location', 'leave for knife');
            // Short hops: the gate is ~120 tiles away and long walks drop.
            if (pos().x < 3218 || pos().z > 3908) {
                const tx = 3224;
                const tz = Math.min(3904, pos().z > 3912 ? pos().z - 15 : 3904);
                const dx = tx - pos().x;
                const dz = tz - pos().z;
                const span = Math.hypot(dx, dz);
                const hop =
                    span > 15
                        ? { x: Math.round(pos().x + (dx / span) * 15), z: Math.round(pos().z + (dz / span) * 15) }
                        : { x: tx, z: tz };
                await sdk.sendWalk(hop.x, hop.z, true);
                await sdk.waitForTicks(8).catch(() => {});
                return false;
            }
            await sdk.scanNearbyLocs(16).catch(() => {});
            const gate = (sdk.getNearbyLocs() ?? []).find(
                (l) =>
                    /gate/i.test(l.name) &&
                    l.x >= 3220 &&
                    l.x <= 3228 &&
                    l.z >= 3902 &&
                    l.z <= 3906 &&
                    l.optionsWithIndex.some((o) => /^open$/i.test(o.text))
            );
            if (gate) {
                const open = gate.optionsWithIndex.find((o) => /^open$/i.test(o.text))!;
                await sdk.sendInteractLoc(gate.x, gate.z, gate.id, open.opIndex);
                await sdk.waitForTicks(2).catch(() => {});
            }
            await sdk.sendWalk(SPIDER_GATE.x, 3900, true);
            await sdk
                .waitForCondition((s) => (s.player?.worldZ ?? 99_999) <= 3902, 10_000)
                .catch(() => {});
            return false;
        } else {
            intent('West to the north road, then south for a Lumbridge knife');
            session.noteProgress('location', 'ditch for knife');
            if (pos().x > 3145 && pos().z < 3906) {
                await sdk.sendWalk(3135, Math.min(pos().z, 3865), true);
                await sdk
                    .waitForCondition((s) => (s.player?.worldX ?? 99_999) <= 3140, 10_000)
                    .catch(() => {});
                return false;
            }
            await sdk.sendWalk(3120, Math.max(DITCH_SOUTH.z, pos().z - 40), true);
            await sdk.waitForTicks(6).catch(() => {});
            return false;
        }
    }

    log(`walkToMage @ ${pos().x},${pos().z} food=${invFoodCount()} blade=${slashItem()?.name ?? 'none'}`);

    // South of the ditch-crossing gap the DITCH_TO_MAGE waypoints start at
    // (3088,3550) — from far west/east a single walk there silently drops
    // and the bot never moves (Jackpoo1 pinned at (2818,3525)). Short-hop
    // laterally along the ditch line toward the x=3088 gap first.
    // Corridor-only: west of x=2990 (Kandarin side) the eastward chord is
    // hard-blocked (~2640,3372) and this lineup pins forever shadowing the
    // White Wolf road below — the road handles x<2990 instead.
    if (pos().x >= 2990 && pos().z < 3560 && Math.abs(pos().x - 3088) > 15) {
        const gx =
            pos().x < 3088 ? Math.min(pos().x + 15, 3088) : Math.max(pos().x - 15, 3088);
        await sdk.sendWalk(gx, pos().z, true);
        await sdk.waitForTicks(4).catch(() => {});
        return false;
    }

    intent('Walking to Mage Arena bank');

    if (distTo(MAGE_LADDER.x, MAGE_LADDER.z) <= 30 && pos().z >= 3945 && pos().z < 4500) {
        return climbMageBankLadder();
    }

    if (!inWilderness(pos().x, pos().z)) {
        // West of the ditch corridor (Kandarin side) blind sendWalk hops
        // toward LUMBY_TO_DITCH pin forever (~2640,3372 / ~2705,3281):
        // long chords get dropped with no message. Take the proven
        // White Wolf road instead (one committed direction, no detours).
        if (pos().x < 2990) {
            intent('Kandarin → Edgeville ditch (White Wolf road)');
            session.noteProgress('location', 'kandarin ditch road');
            await walkKandarinToEdgeville(bot, sdk, {
                eat: () => eatIfNeeded(),
                walkNear: (x, z, t) => walkNear(x, z, t)
            });
            return false;
        }
        if (distTo(DITCH_SOUTH.x, DITCH_SOUTH.z) > 12) {
            return advanceSendWalkPath(
                LUMBY_TO_DITCH,
                () => lumbyDitchIndex,
                (n) => {
                    lumbyDitchIndex = n;
                }
            );
        }
        return advanceSendWalkPath(
            DITCH_TO_MAGE,
            () => mageWalkIndex,
            (n) => {
                mageWalkIndex = n;
            }
        );
    }

    const p = pos();

    // Ice giants at the west fence end. x<2944 is void — never walk west.
    if (p.x >= 2938 && p.x <= 3035 && p.z >= 3888 && p.z <= 3910) {
        session.noteProgress('location', 'fence east');
        if (p.z >= 3903) {
            intent('Open west gate, south off ice, then east to members gate');
            const gate = await findFenceGate();
            if (gate && !gate.alreadyOpen && gate.openOp != null) {
                await sdk.sendInteractLoc(gate.x, gate.z, gate.id, gate.openOp);
                await sdk.waitForTicks(2).catch(() => {});
            }
            if (p.x < 2947) {
                await sdk.sendWalk(2948, 3904, true);
                await sdk
                    .waitForCondition((s) => (s.player?.worldX ?? p.x) >= 2947, 5_000)
                    .catch(() => {});
            }
            await sdk.sendWalk(2948, 3900, true);
            await sdk
                .waitForCondition((s) => (s.player?.worldZ ?? 99_999) <= 3902, 8_000)
                .catch(() => {});
            return false;
        }
        return advanceSendWalkPath(
            FENCE_EAST_TO_GATE,
            () => foodRunIndex,
            (n) => {
                foodRunIndex = n;
            }
        );
    }

    if (p.z >= 3885 && p.z < 3906 && p.x >= 2948 && p.x < 3235) {
        if (p.x >= 3148) {
            await passMembersGateNorth();
            gateToMageIndex = 0;
            return pos().z >= 3906;
        }
        return advanceSendWalkPath(
            FENCE_EAST_TO_GATE,
            () => foodRunIndex,
            (n) => {
                foodRunIndex = n;
            }
        );
    }

    if (p.z >= 3906 && p.z < 4500 && p.x >= 3050) {
        // Hut approach: slash the bank-hut webs and climb instead of
        // walking west through them (3108,3956 is 17 from the ladder —
        // a waypoint walk stalls on the uncut web forever).
        if (distTo(MAGE_LADDER.x, MAGE_LADDER.z) <= 25) {
            return climbMageBankLadder();
        }
        return advanceSendWalkPath(
            GATE_NORTH_TO_MAGE,
            () => gateToMageIndex,
            (n) => {
                gateToMageIndex = n;
            }
        );
    }

    return advanceSendWalkPath(
        DITCH_TO_MAGE,
        () => mageWalkIndex,
        (n) => {
            mageWalkIndex = n;
        }
    );
}

async function openBankAt(x: number, z: number): Promise<boolean> {
    await closeUi();
    if (inWildyCoursePit()) {
        if (!(await climbOutOfWildyPit())) return false;
    }
    if (onKaramja()) {
        if (!(await ensureMainland())) return false;
    }
    if (inWilderness(pos().x, pos().z) && distTo(MAGE_BANK.x, MAGE_BANK.z) > 30) {
        if (onWildyCourse() || inWildyCoursePit()) {
            session.noteFailure('bank', 'Still on wildy course — leave before banking');
            return false;
        }
        if (southOfWildyCourseFence() || insideWildyCourseYard()) {
            if (!(await leaveWildyAgilityCourse())) return false;
        }
        if (!(await walkToMageFromSafe())) return false;
    }
    if (!inWilderness(pos().x, pos().z)) {
        await walkNear(x, z, 6);
    } else if (distTo(x, z) > 8) {
        await sdk.sendWalk(x, z, true);
        await sdk.waitForCondition(() => distTo(x, z) <= 10, 15_000).catch(() => {});
    }
    if (sdk.getState()?.bank?.isOpen) return true;

    if (inMageArenaBank()) {
        // Gundai's dialog is flaky — retry the talk a few times, then fall
        // back to the booth before giving up (a failed open strands the bot
        // in the cellar with no food top-up).
        for (let attempt = 0; attempt < 3; attempt++) {
            if (sdk.getState()?.bank?.isOpen) return true;
            await sdk.sendWalk(MAGE_BANK.x, MAGE_BANK.z, true);
            await sdk.waitForCondition(() => distTo(MAGE_BANK.x, MAGE_BANK.z) <= 4, 6_000).catch(() => {});
            await sdk.scanNearbyLocs(12).catch(() => {});
            const gundai = sdk.findNearbyNpc(/gundai/i);
            if (gundai) {
                intent(`Talking to Gundai (try ${attempt + 1})`);
                // Route into range first: route:false interacts silently drop
                // from 3+ tiles away (counter furniture blocks the stand tile).
                await sdk.sendTalkToNpc(gundai.index);
                await clickThroughBankerChat();
            }
            if (sdk.getState()?.bank?.isOpen) return true;
        }
        const booth = await bot.openBank();
        if (booth.success && sdk.getState()?.bank?.isOpen) return true;
        session.noteFailure('bank', 'Gundai did not open the bank');
        return false;
    }

    const banker = sdk.findNearbyNpc(/gundai|banker/i, { reachable: true });
    if (banker) {
        intent('Talking to Mage Arena banker');
        const r = await bot.interactNpc(banker, /talk|bank/i);
        await sdk.waitForTicks(3).catch(() => {});
        await clickThroughBankerChat();
        if (!sdk.getState()?.bank?.isOpen) {
            await bot.interactNpc(banker, /bank/i);
            await sdk.waitForTicks(2).catch(() => {});
        }
    }
    if (!sdk.getState()?.bank?.isOpen) {
        const opened = await bot.openBank();
        if (!opened.success) {
            if (opened.reason === 'no_bank_found') {
                // Not a failure: we are not standing at a bank. noteFailure
                // here is what produced "bank: No banker NPC or bank booth
                // found nearby" five times and tripped the recovery ladder.
                log(`No banker NPC or booth at ${pos().x},${pos().z} (bank tile ${x},${z}) — skipping bank`);
                return false;
            }
            session.noteFailure('bank', opened.message || 'could not open bank');
            return false;
        }
    }
    await clickThroughBankerChat();
    return !!sdk.getState()?.bank?.isOpen;
}

async function dropJunk(): Promise<void> {
    for (const item of sdk.getInventory()) {
        if (/^flax$/i.test(item.name)) {
            await sdk.sendDropItem(item.slot);
            await sdk.waitForTicks(1).catch(() => {});
        }
    }
}

/** A banker, booth or open bank clickable from where we stand — no walking. */
async function bankInReach(range = 10): Promise<boolean> {
    if (sdk.getState()?.bank?.isOpen) return true;
    await sdk.scanNearbyLocs(range).catch(() => {});
    if (sdk.findNearbyNpc(/gundai|banker/i, { reachable: true })) return true;
    return (sdk.getNearbyLocs() ?? []).some((l) => /bank|booth|clerk/i.test(l.name) && distTo(l.x, l.z) <= range);
}

async function depositAll(forceTile?: Tile, keepBlade = true): Promise<boolean> {
    const bankTile =
        forceTile ??
        (agilityLevel() >= GNOME_UNTIL && (onWildyCourse() || inWilderness(pos().x, pos().z))
            ? MAGE_BANK
            : onGnomeCourse() || distTo(GNOME_START.x, GNOME_START.z) < 120
              ? ARDOUGNE_BANK
              : nearestSafeBank());
    await closeUi();
    // Resolve the booth from the LIVE position before any noteFailure: a bot at
    // 2471,3422 is 600+ tiles from Edgeville, so that deposit can only fail,
    // and each failure armed the recovery ladder. Far away (or no booth even
    // after walking to the bank tile) means "nothing to deposit from here",
    // which is not a failure. Callers that want the walk did it themselves
    // (prepareForWildy walks GNOME_TO_ARDY first).
    const hasCarry =
        sdk.getInventory().some((i) => (i.count ?? 0) > 0) || (sdk.getState()?.equipment?.length ?? 0) > 0;
    if (!hasCarry) {
        log(`Nothing to deposit @ ${pos().x},${pos().z}`);
        return true;
    }
    const away = distTo(bankTile.x, bankTile.z);
    if (away > 200) {
        // Nothing we can do from here, and nothing broke: not a failure.
        log(`No bank in reach @ ${pos().x},${pos().z} (${bankTile.x},${bankTile.z} is ${away} away) — no deposit needed`);
        return true;
    }
    if (!(await bankInReach()) && away > 6) {
        // Close enough that walking to the booth is the caller's intent
        // (startup gear banking, wildy prep) — approach, then resolve again.
        await walkNear(bankTile.x, bankTile.z, 6);
    }
    if (!(await bankInReach())) {
        log(`No banker or booth at ${bankTile.x},${bankTile.z} (from ${pos().x},${pos().z}) — no deposit needed`);
        return true;
    }
    if (onGnomeCourse() && !pastGnomeGate()) {
        await ensureGnomeEntrance();
    }
    const eq = sdk.getState()?.equipment ?? [];
    for (const item of eq) {
        if (!item.name) continue;
        await bot.unequipItem(item.name);
    }
    if (!(await openBankAt(bankTile.x, bankTile.z))) return false;
    await session.setPhase('bank');
    intent('Depositing inventory and equipment');
    const inv = sdk.getInventory().filter((i) => (i.count ?? 0) > 0);
    let keptBlade = false;
    for (const item of inv) {
        // Never bank the last slash blade — a bladeless bot cannot re-enter
        // the Mage bank (the Lumby-knife bootstrap is a 200-tile trek).
        if (keepBlade && !keptBlade && SLASH.test(item.name)) {
            keptBlade = true;
            continue;
        }
        await bot.depositItem(item.name, item.count ?? 1);
    }
    await closeUi();
    session.noteProgress('bank', `deposited inv=${inv.length}`);
    return true;
}

async function withdrawFood(): Promise<boolean> {
    if (!(await openBankAt(MAGE_BANK.x, MAGE_BANK.z))) {
        lastBankFailMs = Date.now();
        return false;
    }
    await session.setPhase('pack');
    intent('Withdrawing food for wilderness course');

    let slots = 28 - sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
    if (!slashItem()) {
        const blade = sdk.getBankItems().find((i) => SLASH.test(i.name) && (i.count ?? 0) > 0);
        if (blade && slots > 0) {
            await bot.withdrawItem(blade.slot, 1);
            slots -= 1;
            await sdk.waitForTicks(1).catch(() => {});
        }
    }
    for (const kind of FOOD_PRIORITY) {
        if (slots <= 0) break;
        const re = new RegExp(`^${kind}$`, 'i');
        const bankItem = sdk.getBankItems().find((i) => re.test(i.name) && (i.count ?? 0) > 0);
        if (!bankItem) continue;
        const take = Math.min(slots, bankItem.count ?? 0, FOOD_WITHDRAW);
        if (take <= 0) continue;
        await bot.withdrawItem(bankItem.slot, take);
        slots -= take;
        await sdk.waitForTicks(1).catch(() => {});
    }
    await closeUi();
    const food = invFoodCount();
    log(`Packed ${food} food for wildy (bank food left ${bankFoodCount()})`);
    if (food < 5) {
        session.noteFailure('food', `Only ${food} food in inv/bank`);
        lastBankFailMs = Date.now();
        return false;
    }
    lastBankFailMs = 0;
    return true;
}

/** Suicide out of course when needed, bank at Gundai, re-enter via west gate. */
async function ensureWildyFood(): Promise<boolean> {
    if (pos().isDead) {
        await waitForRespawn();
        return false;
    }
    if (inWildyCoursePit()) {
        await climbOutOfWildyPit();
        return false;
    }

    const food = invFoodCount();
    if (food >= FOOD_MIN) {
        foodRunIndex = 0;
        return true;
    }

    await session.setPhase('wildy_bank');

    if (onWildyCourse() || insideWildyCourseYard() || inWildyCoursePit()) {
        if (food > 0) return true;
        return leaveCourseAndBank();
    }

    if (southOfWildyCourseFence() && food > 0) {
        foodRunIndex = 0;
        return true;
    }

    if (distTo(MAGE_BANK.x, MAGE_BANK.z) > 20) {
        await walkToMageFromSafe();
        return false;
    }

    if (!(await withdrawFood())) return false;
    foodRunIndex = 0;
    wildyCourse.stepIndex = 0;
    return invFoodCount() >= 5;
}

async function leaveCourseAndBank(): Promise<boolean> {
    log(`Empty food on course @ ${pos().x},${pos().z} HP=${pos().hp} — leaving for Mage Arena`);
    foodRunIndex = 0;
    gateToMageIndex = 0;
    if (!(await leaveWildyAgilityCourse())) return false;
    if (distTo(MAGE_BANK.x, MAGE_BANK.z) > 20) {
        await walkToMageFromSafe();
        return false;
    }
    if (!(await withdrawFood())) return false;
    foodRunIndex = 0;
    wildyCourse.stepIndex = 0;
    return invFoodCount() >= 5;
}

async function eatIfNeeded(belowHp = EAT_BELOW_HP): Promise<void> {
    const p = pos();
    if (p.hp >= belowHp) return;
    const foods = sdk
        .getInventory()
        .filter((i) => FOOD_RE.test(i.name))
        .sort((a, b) => foodHeal(b.name) - foodHeal(a.name));
    const best = foods[0];
    if (!best) return;
    intent(`Eating ${best.name} (${p.hp}/${p.maxHp} hp)`);
    await bot.eatFood(best.name);
    await sdk.waitForTicks(2).catch(() => {});
}

/**
 * Click the stronghold gate and let gnome_gate.rs2 do the crossing.
 *
 * The handler walks you to its own $north/$south entrance tile and then
 * force-moves you 3 tiles through — the gate never stays open, and the tile
 * itself is a wall loc. So: stand on the walkable approach tile, click ONCE,
 * and judge the result by which side of z=3383 you end up on. `bot.interactLoc`
 * cannot be used as the gate of that: a gate open produces no player-state
 * evidence, so it always reports "Nothing happened interacting with Gate" — and
 * its retry click, issued after the bot has been moved inside, runs the EXIT
 * branch and ejects you.
 *
 * `expectInside=false` is the leaving path (exitGnomeStronghold): an interior
 * click force-moves you out, which is exactly what that caller wants.
 */
async function openGnomeGate(expectInside = true): Promise<boolean> {
    await closeUi();
    const inside = pos().z > GNOME_GATE.z;
    if (expectInside && inside) return true;
    if (!expectInside && !inside) return true;

    const crossedOk = () => (expectInside ? pos().z > GNOME_GATE.z : pos().z < GNOME_GATE.z);
    const stand = expectInside ? GNOME_GATE_STAND : GNOME_GATE_INNER;
    // Landing tile on the far side, used when the gate reads as already open.
    const farSide = expectInside ? { x: 2461, z: 3386 } : { x: 2460, z: 3380 };
    const side = expectInside ? 'in' : 'out';

    // The handler only acts on a click issued AT the gate: from 39 tiles away
    // (the stronghold garden at 2471,3422) the interact is dropped, the scan
    // finds nothing, and the old loop logged "none in scan" four times and
    // called it blocked. Get to the stand first — by the client pathfinder,
    // then by the static BFS walk when there is no client route (east pocket).
    for (let i = 0; i < 3 && !crossedOk() && distTo(stand.x, stand.z) > 2 && !session.isStopped(); i++) {
        await walkNear(stand.x, stand.z, 1);
        if (crossedOk()) {
            log(`Gate ${side} crossed while approaching @ ${pos().x},${pos().z}`);
            return true;
        }
        if (distTo(stand.x, stand.z) > 2) await walkRouteTo(stand.x, stand.z);
    }
    if (crossedOk()) return true;
    if (distTo(stand.x, stand.z) > 3) {
        // Never click from here: an interior click force-moves 3 tiles OUT,
        // and a distant click does nothing at all.
        log(`Gate ${side} not clicked @ ${pos().x},${pos().z} — ${distTo(stand.x, stand.z)} from stand ${stand.x},${stand.z}`);
        return false;
    }

    // At most two actions: one click (gate loc in view) or one walk-through
    // (no gate loc = the open_left/open_right swap, i.e. already open). No
    // repeat clicks: each one can lose the open-window race, and a second
    // click issued after the handler moved us is what ejects an interior bot.
    let femiDeclined = false;
    for (let attempt = 0; attempt < 2 && !crossedOk() && !session.isStopped(); attempt++) {
        await sdk.scanNearbyLocs(6).catch(() => {});
        const gate = attempt === 0
            ? (sdk.getNearbyLocs() ?? []).find((l) => l.id === GNOME_GATE_ID || /^gate$/i.test(l.name))
            : undefined;
        if (!gate) {
            intent('Walking through the open gnome gate');
            log(
                `Gate ${side} @ ${pos().x},${pos().z} — no gate loc in scan (treating as open); walking through to ${farSide.x},${farSide.z}`
            );
            await sdk.sendWalk(farSide.x, farSide.z, true);
        } else {
            const openOpt = gate.optionsWithIndex.find((o) => /^open$/i.test(o.text));
            intent('Opening gnome stronghold gate');
            log(`Gate ${side} @ ${pos().x},${pos().z} → clicking ${gate.x},${gate.z} once`);
            await sdk.sendInteractLoc(gate.x, gate.z, gate.id, openOpt?.opIndex ?? 1);
        }
        await sdk
            .waitForCondition(
                (s) => s.dialog.isOpen || (expectInside ? (s.player?.worldZ ?? 0) > GNOME_GATE.z : (s.player?.worldZ ?? 0) < GNOME_GATE.z),
                6_000
            )
            .catch(() => {});
        // With %femi_help = 0, Femi beside the gate turns an inward Open into her boxes
        // dialog and the gate never opens; closeUi dismissed it and the next click asked
        // again (ABGARMY12 at 2460,3382 for 5 hours). "Sorry, I'm a bit busy." sets
        // femi_help, so the click after it opens the gate (lib/gnome-stronghold.ts).
        const busy = sdk.getDialog()?.options.find((o) => /busy/i.test(o.text));
        if (busy && !femiDeclined && !crossedOk()) {
            femiDeclined = true;
            log('Femi asked for help with her boxes at the gate — declining');
            await sdk.sendClickDialog(busy.index);
            await sdk.waitForTicks(3).catch(() => {});
            await closeUi();
            attempt--;
            continue;
        }
        if (!crossedOk() && attempt === 0) await sdk.waitForTicks(2).catch(() => {});
    }
    log(`Gate ${side} ${crossedOk() ? 'ok' : 'blocked'} @ ${pos().x},${pos().z}`);
    return crossedOk();
}

/**
 * Pathfinder route to a tile on the static collision snapshot.
 *
 * findLongPath is the ONLY trustworthy offline oracle here: it applies the
 * wall/edge flags (WALL_WEST on (2494,3436) et al) that isTileWalkable ignores
 * — isTileWalkable only checks LOC/FLOOR flags, so a tile on the far side of a
 * fence reads "walkable" and a BFS over it happily plans a route straight
 * through the fence. That is what "raw route 2494,3436 → 2474,3436: 22 tiles"
 * was: a plan the client rejected on its very first step.
 *
 * findLongPath returns a TRUNCATED path (often a single waypoint) when the
 * destination is unreachable instead of an empty one, so the endpoint is
 * checked explicitly — otherwise a 1-waypoint "route" looks like success.
 */
function pathRoute(x: number, z: number): Tile[] | null {
    const p = findLongPath(pos().level, pos().x, pos().z, x, z);
    const last = p[p.length - 1];
    if (!last || last.x !== x || last.z !== z) return null;
    return p;
}

/**
 * Walk a pathfinder route one waypoint at a time.
 *
 * sendWalk goes through the client's own pathfinder, so a leg it cannot route
 * is rejected silently (the ActionResult is discarded by callers) — the only
 * evidence of failure is that the player did not move. A leg that produces no
 * movement abandons the whole route instead of spending a wait timeout on each
 * remaining waypoint, so a wrong plan costs one timeout, not seventeen.
 */
async function walkPathLegs(wps: Tile[]): Promise<boolean> {
    for (const wp of wps) {
        if (session.isStopped()) return false;
        if (distTo(wp.x, wp.z) <= 2) continue;
        const before = pos();
        const budget = Math.min(15_000, 1_500 + 500 * distTo(wp.x, wp.z));
        await sdk.sendWalk(wp.x, wp.z, true);
        await sdk.waitForCondition(() => distTo(wp.x, wp.z) <= 2, budget).catch(() => {});
        const now = pos();
        if (now.x === before.x && now.z === before.z) {
            log(`leg ${wp.x},${wp.z} rejected from ${before.x},${before.z} — abandoning route`);
            return false;
        }
        // 'phase' (not 'location') on purpose: refreshes the stall clock without
        // resetting the recovery tactic index mid-recovery.
        session.noteProgress('phase', `gnome leg ${now.x},${now.z}`);
    }
    return true;
}

/** findLongPath legs to (x,z), then walk them. False = no route or a rejected leg. */
async function walkRouteTo(x: number, z: number): Promise<boolean> {
    const route = pathRoute(x, z);
    if (!route) {
        log(`no pathfinder route ${pos().x},${pos().z} → ${x},${z} (findLongPath empty or truncated)`);
        return false;
    }
    log(`route ${pos().x},${pos().z} → ${x},${z}: ${route.length} waypoints`);
    return walkPathLegs(route);
}

/** Slice a linear hop list at the hop nearest (x,z): a half-walked route must
 *  never be restarted from its first hop, or the bot walks back where it came. */
function fromNearest(wps: Tile[], x: number, z: number): Tile[] {
    let best = 0;
    let bestDist = Infinity;
    wps.forEach((w, i) => {
        const d = Math.hypot(w.x - x, w.z - z);
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    });
    return wps.slice(best);
}

/**
 * Get a bot onto the gnome course, including the ones that are inside the
 * stronghold but on the wrong side of the course fence.
 *
 * `force` skips the z-line test: "past the gate" is only a z >= 3388 check, and
 * a bot can sit north of that line with no pathfinder route to the course (the
 * fenced forecourt at 2475,3388 walks back into the east pocket).
 */
async function ensureGnomeEntrance(force = false): Promise<void> {
    if (!force && pastGnomeGate()) {
        gnomeEntranceTile = null;
        gnomeEntranceTries = 0;
        gnomeEntranceReported = false;
        return;
    }

    // Position-keyed retry budget. The entrance used to re-plan from the same
    // tile every 1-2 seconds forever: same phase line, same "Entering gnome
    // stronghold from 2494,3436", same plan, zero movement (x10 ... x670).
    // A plan that leaves the bot on its start tile is not retried: the second
    // attempt changes approach (and once that also fails the loop goes quiet and
    // reports one failure) so the stall clock can hand over to the recovery
    // ladder. Any move — ours or recovery's — resets the counter; the cooldown
    // resets it too, so a stale rejection is not permanent.
    const start = pos();
    const tile = `${start.x},${start.z}`;
    const nowMs = Date.now();
    if (gnomeEntranceTile === tile && nowMs - gnomeEntranceAtMs < GNOME_ENTRANCE_COOLDOWN_MS) {
        gnomeEntranceTries++;
    } else {
        gnomeEntranceTile = tile;
        gnomeEntranceTries = 0;
        gnomeEntranceReported = false;
    }
    gnomeEntranceAtMs = nowMs;
    if (gnomeEntranceTries > GNOME_ENTRANCE_TRIES) {
        if (!gnomeEntranceReported) {
            gnomeEntranceReported = true;
            session.noteFailure(
                'gnome_entrance',
                `${GNOME_ENTRANCE_TRIES + 1} entrance approaches from ${tile} without moving — quiet for ${Math.round(GNOME_ENTRANCE_COOLDOWN_MS / 1000)}s`
            );
        }
        // The caller loops straight back here: without a wait the quiet period spun a
        // billion "phase gnome_travel" lines (ABGARMY12, 50MB of log a minute).
        await sdk.waitForTicks(10).catch(() => {});
        return;
    }
    const attempt = gnomeEntranceTries;

    await session.setPhase('gnome_entrance');
    intent(`Entering gnome stronghold (attempt ${attempt + 1})`);
    log(
        `Entering gnome stronghold from ${tile} (attempt ${attempt + 1}, ${start.z > GNOME_GATE.z ? 'north of' : 'at'} the gate line)`
    );

    // Is the course reachable from here at all? From the course side of the
    // fence the pathfinder has a route; from the east pocket and the forecourt
    // behind the fence it does not (findLongPath to (2474,3436) truncates, and
    // its truncated path ends in the pocket). Decide here, once, instead of
    // walking a plan the client will reject tile by tile.
    const direct = start.z > GNOME_GATE.z ? pathRoute(GNOME_START.x, GNOME_START.z) : null;
    if (direct) {
        log(`course route from ${tile}: ${direct.length} waypoints`);
        if (await walkPathLegs(direct)) {
            log(`On the course @ ${pos().x},${pos().z}`);
            return;
        }
        // The server rejected a leg the snapshot allowed: the waypoint chain is
        // the alternate shape. Never fall through to the gate from here — an
        // interior click is force-moved 3 tiles OUT by gnome_gate.rs2.
        log(`course route abandoned @ ${pos().x},${pos().z} — waypoint chain (attempt ${attempt + 1})`);
        await walkWaypoints(GNOME_ENTRANCE);
        log(`Not on the course yet @ ${pos().x},${pos().z} (attempt ${attempt + 1})`);
        return;
    }

    if (start.z > GNOME_GATE.z) {
        // No route to the course: get out through the gate, which is the only
        // way in — its script force-moves you 3 tiles through, and that landing
        // is the only interior tile set with a route to the start.
        const inPocket = start.x > GNOME_EAST_POCKET_X;
        await session.setPhase('gnome_entrance_east');
        if (inPocket && attempt === 0) {
            log(`East pocket @ ${tile} — pathfinder route around the course fence to the gate stand`);
            if (!(await walkRouteTo(GNOME_GATE_STAND.x, GNOME_GATE_STAND.z))) {
                log(`no pathfinder exit from ${pos().x},${pos().z} — verified hop list from the nearest hop`);
                await walkPathLegs(fromNearest(GNOME_POCKET_EXIT, pos().x, pos().z));
            }
        } else if (inPocket) {
            // Different leg shape on the retry: the verified hop list, sliced at
            // the hop nearest the bot so a half-walked route never walks back
            // into the pocket.
            log(`East pocket retry @ ${pos().x},${pos().z} — verified hop list to the gate stand`);
            await walkPathLegs(fromNearest(GNOME_POCKET_EXIT, pos().x, pos().z));
        } else {
            log(`Fenced forecourt @ ${pos().x},${pos().z} — pathfinder route to the gate stand`);
            await walkRouteTo(GNOME_GATE_STAND.x, GNOME_GATE_STAND.z);
        }
        if (pos().z > GNOME_GATE.z) {
            // Still on the wrong side — never click from inside (gnome_gate.rs2
            // force-moves an interior click 3 tiles OUT).
            log(`Still north of the gate line @ ${pos().x},${pos().z} (attempt ${attempt + 1})`);
            return;
        }
    }

    // Outside the z=3383 line — one click from the documented stand, judged by
    // crossing the line (see openGnomeGate).
    if (!(await openGnomeGate())) {
        log(`Gate not crossed @ ${pos().x},${pos().z} (attempt ${attempt + 1})`);
        return;
    }
    log(`Through the gate @ ${pos().x},${pos().z} — walking to the course start`);
    if (!(await walkRouteTo(GNOME_START.x, GNOME_START.z))) {
        await walkWaypoints(GNOME_ENTRANCE);
    }
    if (pastGnomeGate()) {
        log(`On the course @ ${pos().x},${pos().z}`);
        return;
    }
    log(`Not on the course yet @ ${pos().x},${pos().z} (attempt ${attempt + 1})`);
}

/** March south out of the wilderness in ~40-tile hops, then cross the ditch.
 *  Needed when a bot is left standing at the wildy course after the schedule
 *  moved to gnome-only: walkTo cannot path across the ditch from there. */
async function walkOutOfWildy(): Promise<void> {
    await leaveWildyAgilityCourse();
    for (let i = 0; i < 24 && inWilderness(pos().x, pos().z) && !session.isStopped(); i++) {
        const x = pos().x > 3130 ? Math.max(3130, pos().x - 20) : pos().x;
        await sdk.sendWalk(x, Math.max(DITCH_SOUTH.z, pos().z - 40), true);
        await sdk.waitForTicks(6).catch(() => {});
    }
    if (inWilderness(pos().x, pos().z)) {
        await sdk.sendWalk(DITCH_SOUTH.x, DITCH_SOUTH.z, true);
        await sdk.waitForTicks(6).catch(() => {});
    }
    log(`Left wilderness ${!inWilderness(pos().x, pos().z)} @ ${pos().x},${pos().z}`);
}

async function travelToGnome(): Promise<void> {
    if (onGnomeCourse() && pastGnomeGate() && distTo(GNOME_START.x, GNOME_START.z) <= 12) return;
    if (inWilderness(pos().x, pos().z)) {
        await walkOutOfWildy();
        return;
    }
    await session.setPhase('gnome_travel');

    if (onKaramja()) {
        if (!(await ensureMainland())) return;
    } else if (inArdougne() && pos().z < 3271) {
        await leaveArdougneDocks();
    }

    if (distTo(GNOME_GATE.x, GNOME_GATE.z) > 90) {
        intent('Walking to Gnome Stronghold agility course');
        await walkWaypoints(ARDY_TO_GNOME);
    }
    if (!pastGnomeGate()) {
        await ensureGnomeEntrance();
        return;
    }
    if (distTo(GNOME_START.x, GNOME_START.z) <= 6) return;
    // "Past the gate" is a z-line test, not a reachability test: the fenced
    // forecourt at 2475,3388 is north of z=3388 and has no pathfinder route to
    // the start, so a bare walkNear here stalls every tick with no log line.
    // Let the pathfinder decide, and fall back to the entrance flow (which is
    // what routes a wrong-side bot out through the gate).
    if (!(await walkRouteTo(GNOME_START.x, GNOME_START.z))) {
        await ensureGnomeEntrance(true);
    }
}

async function goGnomeCourse(): Promise<void> {
    await travelToGnome();
}

function insideWildyCourseYard(): boolean {
    const p = pos();
    return p.x >= 2938 && p.x <= 3010 && p.z >= 3905 && p.z < 3925;
}

function southOfWildyCourseFence(): boolean {
    const p = pos();
    return p.x >= 2940 && p.x <= 3030 && p.z >= 3885 && p.z < 3906;
}

async function findFenceGate(): Promise<
    { x: number; z: number; id: number; openOp?: number; alreadyOpen: boolean } | null
> {
    await sdk.scanNearbyLocs(22).catch(() => {});
    const gate = (sdk.getNearbyLocs() ?? [])
        .filter(
            (l) =>
                /gate/i.test(l.name) &&
                l.x >= 2945 &&
                l.x <= 2951 &&
                l.z >= 3902 &&
                l.z <= 3906
        )
        .sort((a, b) => distTo(a.x, a.z) - distTo(b.x, b.z))[0];
    if (!gate) return null;
    const open = gate.optionsWithIndex.find((o) => /^open$/i.test(o.text));
    const close = gate.optionsWithIndex.find((o) => /^close$/i.test(o.text));
    return {
        x: gate.x,
        z: gate.z,
        id: gate.id,
        openOp: open?.opIndex,
        alreadyOpen: !!close && !open
    };
}

/** Stay south of the fence (z≤3902) and walk west to the gate tile. Never path north through the wall. */
async function walkSouthOfFenceToGate(): Promise<void> {
    const stand = { x: WILDY_COURSE_SOUTH_GATE.x, z: WILDY_COURSE_SOUTH_GATE.z - 2 };
    for (let i = 0; i < 16 && distTo(stand.x, stand.z) > 3 && !session.isStopped(); i++) {
        if (pos().z >= 3906) return;
        const { x: x0, z: z0 } = pos();
        const dx = stand.x - x0;
        const span = Math.max(1, Math.abs(dx));
        const hopX = span > 40 ? Math.round(x0 + Math.sign(dx) * 40) : stand.x;
        const hopZ = 3902;
        intent(`Fence south → gate ${hopX},${hopZ}`);
        await sdk.sendWalk(hopX, hopZ, true);
        await sdk
            .waitForCondition(
                (s) => Math.abs((s.player?.worldX ?? x0) - x0) > 4 || (s.player?.worldZ ?? z0) >= 3906,
                10_000
            )
            .catch(() => {});
        if (Math.abs(pos().x - x0) < 3 && pos().z < 3906) {
            await sdk.sendWalk(x0 - 15, hopZ, true);
            await sdk.waitForTicks(4).catch(() => {});
        }
    }
}

async function passWestSouthGate(): Promise<void> {
    await session.setPhase('wildy_gate');
    intent('West fence gate — walk south of wall, open, walk north through');

    for (let attempt = 0; attempt < 10 && pos().z < 3906 && !session.isStopped(); attempt++) {
        await walkSouthOfFenceToGate();
        if (pos().z >= 3906) break;

        const gate = await findFenceGate();
        if (!gate) {
            log(`No fence gate visible @ ${pos().x},${pos().z} — stepping west`);
            await sdk.sendWalk(WILDY_COURSE_SOUTH_GATE.x, 3902, true);
            await sdk.waitForTicks(4).catch(() => {});
            continue;
        }

        if (!gate.alreadyOpen && gate.openOp != null) {
            intent(`Opening fence gate @ ${gate.x},${gate.z}`);
            await sdk.sendInteractLoc(gate.x, gate.z, gate.id, gate.openOp);
            await sdk.waitForTicks(3).catch(() => {});
        }

        const z0 = pos().z;
        await sdk.sendWalk(gate.x, 3912, true);
        await sdk
            .waitForCondition((s) => (s.player?.worldZ ?? z0) >= 3906, 6_000)
            .catch(() => {});

        if (pos().z < 3906) {
            await sdk.sendWalk(gate.x + 1, 3902, true);
            await sdk.waitForTicks(2).catch(() => {});
            const again = await findFenceGate();
            if (again && !again.alreadyOpen && again.openOp != null) {
                await sdk.sendInteractLoc(again.x, again.z, again.id, again.openOp);
                await sdk.waitForTicks(2).catch(() => {});
            }
            await sdk.sendWalk(gate.x + 1, 3912, true);
            await sdk.waitForTicks(5).catch(() => {});
        }
    }

    if (pos().z < 3906) {
        session.noteFailure('gate', `still south of fence @ ${pos().x},${pos().z}`);
    }
}

async function enterCourseDoor(): Promise<void> {
    if (pos().z < 3906) return;
    intent('Walking to wilderness agility course door');
    await sdk.sendWalk(WILDY_COURSE_DOOR.x, WILDY_COURSE_DOOR.z - 1, true);
    await sdk.waitForTicks(4).catch(() => {});
    await sdk.scanNearbyLocs(16).catch(() => {});
    const door = (sdk.getNearbyLocs() ?? []).find(
        (l) =>
            /door/i.test(l.name) &&
            l.x >= 2996 &&
            l.x <= 3000 &&
            l.z >= 3915 &&
            l.z <= 3919 &&
            l.optionsWithIndex.some((o) => /^open$/i.test(o.text))
    );
    if (door) {
        const open = door.optionsWithIndex.find((o) => /^open$/i.test(o.text))!;
        await sdk.sendInteractLoc(door.x, door.z, door.id, open.opIndex);
        await sdk
            .waitForCondition((s) => (s.player?.worldZ ?? 0) >= WILDY_COURSE.z - 2, 8_000)
            .catch(() => {});
        return;
    }
    await sdk.sendWalk(3002, 3933, true);
    await sdk.waitForTicks(5).catch(() => {});
}

/** South of fence → west gate (never through the wall) → yard door → ridge. */
async function enterWildyAgilityCourse(): Promise<void> {
    if (onWildyCourse()) return;
    if (!southOfWildyCourseFence() && !insideWildyCourseYard() && distTo(WILDY_COURSE.x, WILDY_COURSE.z) > 60) {
        return;
    }

    if (pos().z < 3906) {
        await passWestSouthGate();
    }
    if (!onWildyCourse() && pos().z >= 3906) {
        await enterCourseDoor();
    }
    if (!onWildyCourse() && pos().z >= 3920) {
        if (!(await enterRidgeGate())) {
            await sdk.sendWalk(3002, 3933, true);
            await sdk
                .waitForCondition((s) => (s.player?.worldZ ?? 0) >= WILDY_COURSE.z - 2, 8_000)
                .catch(() => {});
        }
    }
}

/** Ridge gates (2307/2308) south → step north onto the course. */
async function enterRidgeGate(): Promise<boolean> {
    if (onWildyCourse()) return true;
    await sdk.scanNearbyLocs(16).catch(() => {});
    const gate = (sdk.getNearbyLocs() ?? []).find(
        (l) =>
            /gate/i.test(l.name) &&
            l.x >= 2996 &&
            l.x <= 3000 &&
            l.z >= 3929 &&
            l.z <= 3933 &&
            l.optionsWithIndex.some((o) => /^open$/i.test(o.text))
    );
    if (gate) {
        const open = gate.optionsWithIndex.find((o) => /^open$/i.test(o.text))!;
        intent('Opening ridge gate north');
        session.noteProgress('location', 'ridge gate');
        await sdk.sendInteractLoc(gate.x, gate.z, gate.id, open.opIndex);
        await sdk.waitForTicks(2).catch(() => {});
    }
    await sdk.sendWalk(3002, 3935, true);
    await sdk.waitForCondition(() => onWildyCourse(), 8_000).catch(() => {});
    return onWildyCourse();
}

/** Ridge gates (2307/2308) south → yard → west fence gate south. */
async function leaveWildyAgilityCourse(): Promise<boolean> {
    if (inWildyCoursePit()) {
        if (!(await climbOutOfWildyPit())) return false;
    }
    if (!onWildyCourse() && !insideWildyCourseYard() && !southOfWildyCourseFence()) {
        return true;
    }

    await session.setPhase('wildy_leave');
    intent('Leaving wilderness agility course for food');

    if (onWildyCourse()) {
        for (let i = 0; i < 12 && onWildyCourse() && !session.isStopped(); i++) {
            session.noteProgress('location', 'leave ridge');
            if (distTo(2998, 3932) > 6) {
                await sdk.sendWalk(2998, 3933, true);
                await sdk.waitForTicks(4).catch(() => {});
            }
            await sdk.scanNearbyLocs(16).catch(() => {});
            const gate = (sdk.getNearbyLocs() ?? []).find(
                (l) =>
                    /gate/i.test(l.name) &&
                    l.x >= 2996 &&
                    l.x <= 3000 &&
                    l.z >= 3929 &&
                    l.z <= 3933 &&
                    l.optionsWithIndex.some((o) => /^open$/i.test(o.text))
            );
            if (gate) {
                const open = gate.optionsWithIndex.find((o) => /^open$/i.test(o.text))!;
                await sdk.sendInteractLoc(gate.x, gate.z, gate.id, open.opIndex);
                await sdk
                    .waitForCondition((s) => (s.player?.worldZ ?? 99_999) < 3925, 10_000)
                    .catch(() => {});
            } else {
                await sdk.sendWalk(2998, 3918, true);
                await sdk.waitForTicks(5).catch(() => {});
            }
        }
    }

    if (insideWildyCourseYard() || (pos().z >= 3906 && pos().z < 3925)) {
        intent('Yard → west fence gate south');
        for (let i = 0; i < 10 && pos().z >= 3906 && !session.isStopped(); i++) {
            session.noteProgress('location', 'leave yard');
            await sdk.sendWalk(WILDY_COURSE_SOUTH_GATE.x, 3912, true);
            await sdk.waitForTicks(4).catch(() => {});
            const gate = await findFenceGate();
            if (gate && !gate.alreadyOpen && gate.openOp != null) {
                await sdk.sendInteractLoc(gate.x, gate.z, gate.id, gate.openOp);
                await sdk.waitForTicks(2).catch(() => {});
            }
            await sdk.sendWalk(WILDY_COURSE_SOUTH_GATE.x, 3900, true);
            await sdk
                .waitForCondition((s) => (s.player?.worldZ ?? 99_999) <= 3902, 6_000)
                .catch(() => {});
        }
    }

    log(`Left course @ ${pos().x},${pos().z}`);
    return southOfWildyCourseFence() || (!onWildyCourse() && !insideWildyCourseYard());
}

async function goWildyCourse(): Promise<void> {
    if (inMageArenaBank()) {
        await climbOutOfMageBank();
        return;
    }
    if (inWildyCoursePit()) {
        await climbOutOfWildyPit();
        return;
    }
    if (onWildyCourse()) return;
    await session.setPhase('wildy_travel');
    if (southOfWildyCourseFence()) {
        await enterWildyAgilityCourse();
        return;
    }
    if (insideWildyCourseYard()) {
        await enterWildyAgilityCourse();
        return;
    }
    // East of the course fence (e.g. 3041,3942 off the Mage walk): no east
    // gate exists — drop south to the yard door on the recorded line
    // (3041,3942 → 3027,3938 → 3007,3924 → 3005,3908 → 3000,3916), then enter.
    if (pos().x > 3010 && pos().z >= 3906 && pos().z < 4500) {
        intent('East side — south to the yard door');
        for (const hop of [
            { x: 3027, z: 3938 },
            { x: 3007, z: 3924 },
            { x: 3005, z: 3908 },
            { x: 3000, z: 3916 }
        ]) {
            if (session.isStopped() || onWildyCourse()) return;
            if (distTo(hop.x, hop.z) <= 4) continue;
            await sdk.sendWalk(hop.x, hop.z, true);
            await sdk.waitForCondition(() => distTo(hop.x, hop.z) <= 5, 12_000).catch(() => {});
            if (distTo(hop.x, hop.z) > 8) return;
        }
        await enterWildyAgilityCourse();
        return;
    }
    if (distTo(MAGE_LADDER.x, MAGE_LADDER.z) < 80 && pos().z >= 3920 && pos().z < 4500) {
        if (!(await leaveMageArenaHut())) return;
        intent('Mage Arena → west course gate');
        await sendWalkWaypoints(MAGE_TO_COURSE);
        await enterWildyAgilityCourse();
        session.setAnchor(WILDY_COURSE.x, WILDY_COURSE.z);
        return;
    }
    if (!inWilderness(pos().x, pos().z)) {
        intent('Walking toward wilderness agility course');
        if (distTo(DITCH_SOUTH.x, DITCH_SOUTH.z) > 12) {
            await walkNear(DITCH_SOUTH.x, DITCH_SOUTH.z, 4);
            return;
        }
        await sendWalkWaypoints(DITCH_TO_COURSE);
    }
    if (southOfWildyCourseFence()) {
        await enterWildyAgilityCourse();
        return;
    }
    if (insideWildyCourseYard()) {
        await enterWildyAgilityCourse();
        return;
    }
    if (inWilderness(pos().x, pos().z) && pos().x >= 2940 && pos().x <= 3020 && pos().z >= 3885) {
        await enterWildyAgilityCourse();
        return;
    }
    await sendWalkWaypoints(MAGE_TO_COURSE);
    await enterWildyAgilityCourse();
    session.setAnchor(WILDY_COURSE.x, WILDY_COURSE.z);
}

async function descendGnomeCourse(): Promise<void> {
    if (pos().level !== 2) return;
    await session.setPhase('leave_gnome');
    intent('Exiting gnome course from L2');

    await sdk.scanNearbyLocs(25).catch(() => {});
    const rope = sdk
        .getNearbyLocs()
        .find(
            (l) =>
                /^balancing rope$/i.test(l.name) &&
                l.reachable !== false &&
                l.optionsWithIndex.some((o) => /walk-on/i.test(o.text))
        );
    if (rope && pos().x < 2483) {
        await bot.walkTo(rope.x, rope.z, 1);
        await bot.interactLoc(rope, /walk-on/i);
        await sdk
            .waitForCondition((s) => (s.player?.worldX ?? 0) >= rope.x + 2, 18_000)
            .catch(() => {});
    }

    for (let x = Math.max(pos().x, 2478); x <= 2487; x++) {
        if (session.isStopped()) return;
        if (pos().x >= 2485) break;
        await sdk.sendWalk(x, 3420, true);
        const x0 = pos().x;
        await sdk.waitForCondition((s) => (s.player?.worldX ?? x0) >= x - 1, 8000).catch(() => {});
        await sdk.waitForTicks(1).catch(() => {});
    }

    await sdk.scanNearbyLocs(25).catch(() => {});
    const down = sdk
        .getNearbyLocs()
        .filter(
            (l) =>
                /^tree branch$/i.test(l.name) &&
                l.optionsWithIndex.some((o) => /climb-down/i.test(o.text))
        )
        .sort((a, b) => distTo(a.x, a.z) - distTo(b.x, b.z))[0];
    if (down) {
        await bot.walkTo(down.x, down.z, 1);
        await bot.interactLoc(down, /climb-down/i);
        await sdk.waitForCondition((s) => (s.player?.level ?? 2) === 0, 18_000).catch(() => {});
    }

    if (pos().level === 1) {
        await sdk.scanNearbyLocs(20).catch(() => {});
        const stairs = sdk.findNearbyLoc(/^staircase$/i);
        if (stairs) {
            await bot.interactLoc(stairs, /climb-down/i);
            await sdk.waitForCondition((s) => (s.player?.level ?? 1) === 0, 15_000).catch(() => {});
        }
    }
}

function insideGnomeStronghold(): boolean {
    const p = pos();
    return p.z >= 3375 && p.x >= 2440 && p.x <= 2525 && p.z < 3445;
}

async function exitGnomeStronghold(): Promise<boolean> {
    if (!insideGnomeStronghold()) return true;
    await session.setPhase('exit_gnome');
    intent('Leaving gnome stronghold through gate');
    await walkWaypoints([
        { x: 2468, z: 3390 },
        GNOME_GATE_INNER
    ]);
    // From the interior side one click force-moves you out (gnome_gate.rs2).
    await openGnomeGate(false);
    await sdk.sendWalk(2458, 3368, true);
    const z0 = pos().z;
    await sdk
        .waitForCondition((s) => (s.player?.worldZ ?? z0) < 3375, 15_000)
        .catch(() => {});
    if (insideGnomeStronghold()) {
        await bot.walkTo(2458, 3365, 3);
    }
    log(`Outside stronghold @ ${pos().x},${pos().z}`);
    return !insideGnomeStronghold();
}

async function leaveGnomeCourse(): Promise<void> {
    if (!onGnomeCourse() && pos().level === 0 && !insideGnomeStronghold()) return;
    await session.setPhase('leave_gnome');
    if (pos().level !== 0) {
        await descendGnomeCourse();
    }
    if (pastGnomeGate()) {
        intent('Walking out of gnome stronghold');
        await walkWaypoints([
            { x: 2470, z: 3415 },
            { x: 2462, z: 3395 },
            GNOME_GATE_INNER
        ]);
    }
    await exitGnomeStronghold();
}

function needsGearDeposit(): boolean {
    const inv = sdk.getInventory().filter((i) => (i.count ?? 0) > 0);
    const hasNonFood = inv.some((i) => !FOOD_RE.test(i.name) && !SLASH.test(i.name));
    return hasNonFood || (sdk.getState()?.equipment?.length ?? 0) > 0;
}

/** Exit gnome course only during the gnome phase — wildy log is plane 0 (bridged). */
async function prepareForWildy(): Promise<boolean> {
    await dropJunk();
    if (agilityLevel() < GNOME_UNTIL) {
        if (onGnomeCourse() || pos().level !== 0) {
            await leaveGnomeCourse();
            return false;
        }
        if (insideGnomeStronghold()) {
            if (!(await exitGnomeStronghold())) return false;
        }
        return true;
    }
    if (inWildyCoursePit()) {
        await climbOutOfWildyPit();
        return false;
    }
    if (onWildyCourse()) return true;
    if (invFoodCount() < 5) {
        if (southOfWildyCourseFence() || insideWildyCourseYard()) {
            await session.setPhase('wildy_bank');
            intent('Empty at wildy fence — Mage Arena before entering');
            if (insideWildyCourseYard() && !(await leaveWildyAgilityCourse())) return false;
            if (!(await walkToMageFromSafe())) return false;
            if (distTo(MAGE_BANK.x, MAGE_BANK.z) <= 22 && !(await withdrawFood())) return false;
            return false;
        }
        if (distTo(MAGE_BANK.x, MAGE_BANK.z) > 25) {
            await session.setPhase('wildy_prep');
            intent('Walking toward Mage Arena bank');
            if (!(await walkToMageFromSafe())) return false;
            return false;
        }
        if (!(await withdrawFood())) return false;
        return false;
    }
    // Food+knife in the Mage cellar is the wildy kit — never path GNOME_TO_ARDY from here.
    if (inMageArenaBank()) return true;
    // Dump leftover gnome/ardy gear only while still on the mainland. Wilderness
    // and Mage Arena already have the right inventory (food + slash blade).
    if (
        needsGearDeposit() &&
        !inWilderness(pos().x, pos().z) &&
        pos().z < 3520 &&
        distTo(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z) < 400
    ) {
        if (distTo(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z) > 35) {
            await session.setPhase('wildy_prep');
            intent('Walking to Ardougne bank before wildy');
            await walkWaypoints(GNOME_TO_ARDY);
            return false;
        }
        if (!(await depositAll())) return false;
        return false;
    }
    return true;
}

async function gnomeTick(): Promise<void> {
    if (agilityLevel() >= GNOME_UNTIL) return;
    if (!onGnomeCourse()) {
        await goGnomeCourse();
        return;
    }
    if (!pastGnomeGate()) {
        await ensureGnomeEntrance();
        return;
    }
    await dropJunk();
    await gnomeCourse.tick();
    laps = gnomeCourse.laps;
}

/** Post-exhaust fallback laps: same gnome training without the level gate
 * (52s earn slow but safe XP here instead of idling with blocked packets). */
async function fallbackGnomeTick(): Promise<void> {
    if (!onGnomeCourse()) {
        await goGnomeCourse();
        return;
    }
    if (!pastGnomeGate()) {
        await ensureGnomeEntrance();
        return;
    }
    await dropJunk();
    await gnomeCourse.tick();
    laps = gnomeCourse.laps;
}

/**
 * 99 reached: park in place. Idle, forever, until the process is asked to stop.
 *
 * The old endgame walked to Edgeville, the deposit fired from wherever it
 * happened to be (600 tiles away, no booth → noteFailure), and five failures
 * in 120s armed the full 14-tactic recovery ladder — ten of them wilderness
 * treks. Recovery exhausted, the loop retried done_walk, and the cycle re-ran
 * forever. A clean exit is no better: the supervisor restarts an exited
 * container and it re-enters the same loop, which is what took the box to
 * load 19 and 10GB swap. At the target there is nothing to deposit and nothing
 * to gain from a lap, so the deterministic end state is: one log line, then
 * sleep with no packets and no recovery.
 */
async function parkAtTarget(): Promise<void> {
    if (UNTIL_ARG > 0) {
        console.log(`agility: already complete — Agility ${agilityLevel()} >= ${TARGET_LEVEL}`);
        session.stop('done', `Agility ${agilityLevel()} reached (until ${TARGET_LEVEL})`, { restartable: false });
        return;
    }
    if (parked) return;
    parked = true;
    await session.setPhase('parked');
    intent('Agility 99 — parked');
    log(`Agility 99 target reached @ ${pos().x},${pos().z} (lvl=${agilityLevel()} laps=${laps}) — parking idle`);
    let ticks = 0;
    while (!session.isStopped() && !session.stopRequested) {
        await sleep(30_000);
        // One line per 10 min keeps grind.log legible (parked, not wedged)
        // without a recovery cycle or a packet being sent.
        if (++ticks % 20 === 0) {
            log(`parked @ ${pos().x},${pos().z} — Agility ${agilityLevel()}, idle ${Math.round(ticks / 2)} min`);
        }
    }
}

async function wildyTick(): Promise<void> {
    if (agilityLevel() >= TARGET_LEVEL) {
        // At the target there is no XP left to earn, so a lap is worth nothing:
        // park immediately instead of finishing it and walking out.
        await parkAtTarget();
        return;
    }
    if (pos().isDead) {
        await waitForRespawn();
        return;
    }
    if (inWildyCoursePit()) {
        await climbOutOfWildyPit();
        if (inWildyCoursePit() || pos().isDead) return;
    }
    if (wildyCourse.consumeLapReset()) {
        wildyCourse.stepIndex = 0;
    }
    await eatIfNeeded();
    if (invFoodCount() === 0 && (onWildyCourse() || insideWildyCourseYard() || inWildyCoursePit())) {
        await leaveCourseAndBank();
        return;
    }
    if (invFoodCount() < FOOD_MIN && !onWildyCourse()) {
        if (!(await ensureWildyFood())) return;
    }
    if (!onWildyCourse()) {
        if (invFoodCount() < 5) {
            if (!(await ensureWildyFood())) return;
            return;
        }
        await goWildyCourse();
        return;
    }
    await wildyCourse.tick();
    laps = gnomeCourse.laps + wildyCourse.laps;
}

async function tick(): Promise<void> {
    if (agilityLevel() >= TARGET_LEVEL) {
        // Checked before any packet-sending work so a maxed account never walks
        // an endgame route it has no use for.
        await parkAtTarget();
        return;
    }
    await closeUi();

    // Recovery exhausted on the wildy path: the session blocks further
    // game packets until the flag is consumed, so without this branch the
    // bot ticks silently forever. Retreat to safe gnome laps for 30 min —
    // but only below 52: at 52+ the gnome log never resolves and the
    // retreat walk itself is the north leg of the gate bounce
    // (south to the ditch vs north back to the stronghold, XP frozen).
    // 52+ stays committed to the one direction that makes progress:
    // the Mage-bank trek.
    if (Date.now() < fallbackGnomeUntil && agilityLevel() < GNOME_UNTIL) {
        await fallbackGnomeTick();
        return;
    }

    if (agilityLevel() < GNOME_UNTIL) {
        await gnomeTick();
        return;
    }

    if (!(await prepareForWildy())) return;
    await wildyTick();
}

/**
 * Wildy tactics are only meaningful near the wilderness/Mage Arena. Registered
 * unconditionally, ten of the fourteen tactics were wildy travel: a bot stalled
 * in the gnome stronghold (x≈2470) had each of them start a 200-700 tile trek,
 * so one recovery cycle did the work of a whole job switch.
 */
function inWildyReach(): boolean {
    const p = pos();
    if (inWilderness(p.x, p.z) || onWildyCourse() || inWildyCoursePit()) return true;
    if (insideWildyCourseYard() || southOfWildyCourseFence() || inMageArenaBank()) return true;
    if (distTo(MAGE_BANK.x, MAGE_BANK.z) < 40 || distTo(MAGE_LADDER.x, MAGE_LADDER.z) < 40) return true;
    if (distTo(WILDY_COURSE.x, WILDY_COURSE.z) < 120 || distTo(DITCH_SOUTH.x, DITCH_SOUTH.z) < 60) return true;
    return false;
}

session.registerRecovery([
    {
        name: 'brimhaven_boat',
        run: async () => {
            // Off Karamja this tactic cannot act — report failure so the
            // next tactic tries instead of faking a resume.
            if (!onKaramja()) return false;
            return brimhavenToArdougne();
        }
    },
    {
        name: 'gnome_start',
        run: async () => {
            if (agilityLevel() >= GNOME_UNTIL) return false;
            await goGnomeCourse();
            return onGnomeCourse();
        }
    },
    {
        name: 'exit_gnome',
        run: async () => {
            if (agilityLevel() < GNOME_UNTIL) return false;
            if (!insideGnomeStronghold()) return false;
            return exitGnomeStronghold();
        }
    },
    {
        name: 'leave_gnome',
        run: async () => {
            if (agilityLevel() < GNOME_UNTIL) return false;
            if (!onGnomeCourse() && pos().level === 0) return true;
            await leaveGnomeCourse();
            return !onGnomeCourse() && pos().level === 0;
        }
    },
    {
        name: 'wildy_pit',
        run: async () => {
            if (!inWildyCoursePit()) return true;
            return climbOutOfWildyPit();
        }
    },
    {
        name: 'wildy_suicide',
        // Death respawns outside the wildy with a reset position — a real
        // state change. The old stub returned true without acting, faking
        // recovery while the bot never moved.
        run: async () => {
            const p = pos();
            if (p.isDead) return true;
            if (!inWilderness(p.x, p.z) && !onWildyCourse() && !inWildyCoursePit()) return false;
            await suicideInWilderness();
            return pos().isDead;
        }
    },
    {
        name: 'wildy_food',
        run: async () => {
            if (agilityLevel() < GNOME_UNTIL) return false;
            if (!inWildyReach()) {
                log('recovery: wildy_food skipped — nowhere near the wilderness');
                return false;
            }
            if (invFoodCount() >= FOOD_MIN) return true;
            if (invFoodCount() === 0 && (onWildyCourse() || inWildyCoursePit() || insideWildyCourseYard())) {
                return leaveCourseAndBank();
            }
            return ensureWildyFood();
        }
    },
    {
        name: 'wildy_agility_gate',
        run: async () => {
            if (!inWildyReach()) return false;
            if (onWildyCourse()) return true;
            if (!southOfWildyCourseFence() && !insideWildyCourseYard()) return false;
            if (invFoodCount() < 5) return leaveCourseAndBank();
            await enterWildyAgilityCourse();
            return onWildyCourse();
        }
    },
    {
        name: 'wildy_course',
        run: async () => {
            if (agilityLevel() < GNOME_UNTIL) return false;
            if (!inWildyReach()) {
                log('recovery: wildy_course skipped — nowhere near the wilderness');
                return false;
            }
            if (invFoodCount() < 5) return ensureWildyFood();
            await goWildyCourse();
            return onWildyCourse();
        }
    },
    {
        name: 'mage_bank',
        run: async () => {
            if (agilityLevel() < GNOME_UNTIL) return false;
            if (!inWildyReach()) {
                log('recovery: mage_bank skipped — nowhere near the Mage Arena');
                return false;
            }
            if (onWildyCourse() || inWildyCoursePit() || insideWildyCourseYard()) {
                if (!(await leaveWildyAgilityCourse())) return false;
            }
            return openBankAt(MAGE_BANK.x, MAGE_BANK.z);
        }
    },
    {
        name: 'leave_wildy',
        run: async () => {
            if (!inWilderness(pos().x, pos().z)) return false;
            return leaveWilderness();
        }
    }
]);

try {
    await bot.skipTutorial();
    await closeUi();
    lastXp = agilityXp();
    log(
        `Agility start lvl=${agilityLevel()} xp=${lastXp} @ ${pos().x},${pos().z} target=${TARGET_LEVEL} gnome_until=${GNOME_UNTIL}`
    );
    if (agilityLevel() < GNOME_UNTIL) {
        gnomeCourse.resume();
    } else {
        wildyCourse.resume();
    }
    await sdk.scanNearbyLocs(20).catch(() => {});

    const hasCarry =
        sdk.getInventory().some((i) => (i.count ?? 0) > 0) || (sdk.getState()?.equipment?.length ?? 0) > 0;
    if (onGnomeCourse() && !pastGnomeGate()) {
        await ensureGnomeEntrance();
    }
    if (hasCarry && !onGnomeCourse() && agilityLevel() < GNOME_UNTIL) {
        log('Banking gear before agility training');
        if (onKaramja() || inArdougne() || distTo(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z) < 200) {
            if (onKaramja() && !(await ensureMainland())) {
                session.log('warn', 'boat: Could not reach mainland from Karamja');
            }
            if (!(await depositAll())) {
                session.log('warn', 'bank: Initial deposit failed — continuing anyway');
            }
        }
    } else if (hasCarry && onGnomeCourse() && agilityLevel() < GNOME_UNTIL) {
        await dropJunk();
        log('At gnome course — skipping mainland bank, training with current gear');
    }

    while (!session.isStopped()) {
        // Park before recovery: a maxed account at 99 must never run the
        // recovery ladder (it is what burned the box — 14 tactics, ten of them
        // wilderness treks, re-armed every cycle by the failed done_walk).
        if (agilityLevel() >= TARGET_LEVEL) {
            await parkAtTarget();
            break;
        }
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            // Exhaustion blocks game packets until consumed — without this
            // the loop ticks silently forever. Retreat to safe gnome laps.
            if (session.consumeFallback()) {
                fallbackGnomeUntil = Date.now() + 30 * 60_000;
                session.log('warn', 'Wildy path exhausted — gnome laps for 30 min');
            }
            continue;
        }
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            obstacleStreak = 0;
            continue;
        }
        session.maybeHeartbeat();
        await tick();
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
} finally {
    const stop = session.metrics().stopReason;
    if (stop) {
        log(
            `stopped ${stop.code} @ ${stop.location.x},${stop.location.z} agility=${agilityLevel()} laps=${laps}`
        );
    }
    await session.finalizeStop();
    await sdk.disconnect();
}
