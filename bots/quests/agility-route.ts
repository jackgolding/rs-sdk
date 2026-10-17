/**
 * Agility 44→99: Gnome Stronghold course until 52, then wilderness course
 * with full-inventory food restocks at the Mage Arena bank (Gundai).
 *
 *   bun bots/quests/agility-route.ts jackthief
 */
import { ActivitySession, BotSDK, deriveGatewayUrl, inWilderness } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
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
import { ARDOUGNE_BANK, ARDOUGNE_MARKET, BRIMHAVEN_CUSTOMS, EDGEVILLE, type Tile } from './tiles';
import { foodHeal } from './food-heal';
import { GnomeCourse, GNOME_START } from './gnome-course';
import { WildyCourse } from './wildy-course';
import { installGracefulShutdown } from '../../sdk/runner';

const TARGET_LEVEL = 99;
const GNOME_UNTIL = 52;
const GNOME_BANK = ARDOUGNE_BANK;
/** Karamja → Brimhaven dock (mainland crossing is a separate boat step). */
const TO_BRIMHAVEN: Tile[] = [
    { x: 2862, z: 3022 },
    { x: 2838, z: 3051 },
    { x: 2798, z: 3208 },
    BRIMHAVEN_CUSTOMS
];
const GNOME_GATE = { x: 2459, z: 3383 };
const GNOME_ENTRANCE: Tile[] = [
    { x: 2462, z: 3395 },
    { x: 2470, z: 3415 },
    { x: 2474, z: 3430 },
    GNOME_START
];
const ARDY_TO_GNOME: Tile[] = [
    { x: 2662, z: 3375 },
    { x: 2550, z: 3410 },
    GNOME_GATE
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
    // 3 built-in (close_ui/step_off/rewalk) + all 11 registered below.
    // A short cap strands bots before mage_bank/leave_wildy ever run.
    maxRecoveryTactics: 14
});

installGracefulShutdown();

let laps = 0;
// Post-exhaust fallback: wildy unreachable — train the safe gnome course
// until this timestamp instead of spinning on an unwinnable trek.
let fallbackGnomeUntil = 0;
// Final-lap mode: 99 hit mid-lap — finish the lap before Edgeville.
let finishingLap = false;
let lapsAt99 = 0;
let obstacleStreak = 0;
let lastXp = 0;

function log(msg: string): void {
    session.log('log', msg);
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
    // x<=2490: the course fence (server-side) strands walkers east of it at
    // x>2490 — those are outside the course even when close to the start.
    return p.z >= 3410 && p.x <= 2490 && distTo(GNOME_START.x, GNOME_START.z) < 60;
}

function inArdougne(): boolean {
    const p = pos();
    return p.x > 2500 && p.x < 2720 && p.z > 3240 && p.z < 3355;
}

function onKaramja(): boolean {
    const p = pos();
    return p.x > 2680 && p.x < 3010 && p.z > 3040 && p.z < 3270;
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

async function depositAll(forceTile?: Tile, keepBlade = true): Promise<boolean> {
    const bankTile =
        forceTile ??
        (agilityLevel() >= GNOME_UNTIL && (onWildyCourse() || inWilderness(pos().x, pos().z))
            ? MAGE_BANK
            : onGnomeCourse() || distTo(GNOME_START.x, GNOME_START.z) < 120
              ? ARDOUGNE_BANK
              : nearestSafeBank());
    await closeUi();
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

async function openGnomeGate(): Promise<void> {
    await closeUi();
    await walkNear(GNOME_GATE.x, GNOME_GATE.z, 2);
    await sdk.scanNearbyLocs(8).catch(() => {});
    const gate = sdk.findNearbyLoc(/^gate$/i);
    if (!gate) {
        log(`No gate found near ${pos().x},${pos().z}`);
        return;
    }
    const openOpt = gate.optionsWithIndex.find((o) => /^open$/i.test(o.text));
    if (!openOpt) {
        log(`Gate found but no Open option (${gate.optionsWithIndex.map((o) => o.text).join(', ')})`);
        return;
    }
    intent('Opening gnome stronghold gate');
    log(`Opening gate @ ${gate.x},${gate.z}`);
    const r = await bot.interactLoc(gate, /open/i);
    if (!r.success) {
        log(`Gate interact failed: ${r.message}`);
        await sdk.sendInteractLoc(gate.x, gate.z, gate.id, openOpt.opIndex);
    }
    await sdk.waitForTicks(3).catch(() => {});
}

async function ensureGnomeEntrance(): Promise<void> {
    if (pastGnomeGate()) return;
    await session.setPhase('gnome_entrance');
    intent('Entering gnome stronghold');
    log(`Entering gnome stronghold from ${pos().x},${pos().z}`);
    await walkNear(GNOME_GATE.x, GNOME_GATE.z, 3);
    await openGnomeGate();
    await walkWaypoints(GNOME_ENTRANCE);
    if (distTo(GNOME_START.x, GNOME_START.z) <= 12 || pos().x <= 2490) {
        log(`Inside stronghold @ ${pos().x},${pos().z}`);
        return;
    }
    // Stranded east of the course fence: drop south below it on open ground,
    // cross west, and re-enter through the proven south corridor. Every leg
    // is verified — a silent failed leg is what stranded us here before.
    log(`East of course fence @ ${pos().x},${pos().z} — detouring south around it`);
    await session.setPhase('gnome_entrance_detour');
    const detourX0 = pos().x;
    const southOk = await walkNear(detourX0, 3405, 4);
    log(`Detour south leg → ${pos().x},${pos().z} ok=${southOk}`);
    for (const z of [3405, 3398, 3390]) {
        const westOk = await walkNear(2465, z, 4);
        log(`Detour west leg z=${z} → ${pos().x},${pos().z} ok=${westOk}`);
        if (westOk || pos().x <= 2480) break;
    }
    await walkWaypoints(GNOME_ENTRANCE);
    if (distTo(GNOME_START.x, GNOME_START.z) <= 12) {
        log(`Inside stronghold @ ${pos().x},${pos().z}`);
    } else {
        log(`Detour failed, still @ ${pos().x},${pos().z} — will retry via gate`);
    }
}

async function travelToGnome(): Promise<void> {
    if (onGnomeCourse() && pastGnomeGate() && distTo(GNOME_START.x, GNOME_START.z) <= 12) return;
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
    await walkNear(GNOME_START.x, GNOME_START.z, 6);
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
        GNOME_GATE
    ]);
    await openGnomeGate();
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
            GNOME_GATE
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

/** 99 reached: leave the course, bank everything at Edgeville, stop clean.
 * Never stops dirty — unverified rounds retry next tick. */
async function finishAtEdgeville(): Promise<void> {
    await session.setPhase('done_walk');
    intent('Agility 99 — banking at Edgeville');
    log(`Agility 99 after ${laps} laps — walking to Edgeville`);
    for (let round = 0; round < 3; round++) {
        if (pos().isDead) {
            await waitForRespawn();
            continue;
        }
        await eatIfNeeded();
        if (inWildyCoursePit()) {
            await climbOutOfWildyPit();
        }
        if (onWildyCourse() || insideWildyCourseYard()) {
            await leaveWildyAgilityCourse();
        }
        if (inWilderness(pos().x, pos().z)) {
            await leaveWilderness();
        }
        if (!inWilderness(pos().x, pos().z)) break;
    }
    if (inWilderness(pos().x, pos().z)) {
        session.noteFailure('done_walk', `still in wildy @ ${pos().x},${pos().z} — retrying next tick`);
        return;
    }
    await walkNear(EDGEVILLE.x, EDGEVILLE.z, 6);
    if (!(await depositAll(EDGEVILLE, false))) {
        session.noteFailure('done_walk', 'Edgeville deposit failed — retrying next tick');
        return;
    }
    if (sdk.getInventory().some((i) => (i.count ?? 0) > 0)) {
        session.noteFailure('done_walk', 'inventory not empty after deposit — retrying');
        return;
    }
    session.stop('done', `Agility 99 @ ${pos().x},${pos().z} laps=${laps}`);
}

async function wildyTick(): Promise<void> {
    if (agilityLevel() >= TARGET_LEVEL) {
        if (onWildyCourse() && wildyCourse.stepIndex !== 0 && !finishingLap) {
            finishingLap = true;
            lapsAt99 = laps;
            log(`Agility 99 mid-lap — finishing the lap first`);
        } else if (!onWildyCourse() || wildyCourse.stepIndex === 0 || finishingLap) {
            if (!finishingLap || laps > lapsAt99 || wildyCourse.stepIndex === 0) {
                await finishAtEdgeville();
                return;
            }
        }
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
    await closeUi();
    if (agilityLevel() >= TARGET_LEVEL) {
        // 99 lands mid-lap — wildyTick finishes the lap, then Edgeville.
        await wildyTick();
        return;
    }

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
            if (invFoodCount() < 5) return ensureWildyFood();
            await goWildyCourse();
            return onWildyCourse();
        }
    },
    {
        name: 'mage_bank',
        run: async () => {
            if (agilityLevel() < GNOME_UNTIL) return false;
            if (onWildyCourse() || inWildyCoursePit() || insideWildyCourseYard()) {
                if (!(await leaveWildyAgilityCourse())) return false;
            }
            return openBankAt(MAGE_BANK.x, MAGE_BANK.z);
        }
    },
    {
        name: 'leave_wildy',
        run: async () => leaveWilderness()
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
