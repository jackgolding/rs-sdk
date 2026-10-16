/**
 * Wilderness rune rocks — suicide 2-ore trips, bank Edgeville.
 *
 *   bun bots/quests/rune-rocks.ts {botname}
 *   bun bots/Jackpoo2/rune-rocks.ts
 *
 * Lava Maze rocks (3059,3885) and (3060,3884). Walk the west side of the
 * maze, past the KBD ladder, not the east road through green dragons.
 * Stay on the rocks until 2 runite — wait out the respawn. On the way
 * back, mine every adamant at the hobgoblin mine, then bank Edgeville.
 * Never bot.walkTo north of the ditch.
 *
 * `--pk`: a fight at the rocks. Retaliate only — Attack on anyone who has
 * not already hit us applies a PK skull (pk_skull.rs2). Wear the dragon
 * longsword when we have one and mine with the rune pick in the inventory.
 * Carry 16 sharks. Auto-retaliate stays on. If a skull lands anyway, leave
 * the wilderness until it drops. Prayer at 0 is recharged at the deep-wildy
 * chaos altar (2947, 3820), west of the KBD ladder, and not by leaving a
 * rock that has not given the second ore. Stay on this job.
 */
import {
    ActivitySession,
    BotSDK,
    deriveGatewayUrl,
    inEssenceMine as inEssenceMineCoords,
    inMiningGuild as inMiningGuildCoords
} from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { findLongPath, getDoorAt, initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { foodHeal, needsBankHeal } from './food-heal';
import {
    BANDIT_CAMP,
    CHAOS_ALTAR,
    CHAOS_ALTAR_STAND,
    EAST_OF_BANDITS,
    HOBGOBLIN,
    ROCKS,
    chaosAltarHops,
    clickAhead,
    hobToDitchHops,
    inGreenDragons,
    returnToHobHops,
    westToRocksHops,
    type Tile
} from './rune-rocks-route';
import { DRAYNOR_BANK } from './tiles';
import { mayRetaliate } from './rune-rocks-pk';
import { botNames } from '../../.cursor/skills/wake-fleet/scripts/roster';
import { installGracefulShutdown } from '../../sdk/runner';

const EDGEVILLE_BANK = { x: 3094, z: 3492 };
const DITCH_NORTH = { x: 3088, z: 3525 };
const DITCH_SOUTH = { x: 3088, z: 3518 };
const GUILD_LADDER_DOWN = { x: 3019, z: 9739 };

const TO_EDGEVILLE = [
    { x: 3104, z: 3291 },
    { x: 3079, z: 3419 },
    { x: 3094, z: 3492 }
];
const EAST_DRAYNOR_GATE = { x: 3162, z: 3290 };
const SOUTH_OF_EAST_DRAYNOR_GATE = { x: 3162, z: 3286 };
/** East wheat field — walk south through the gate pocket, not west into the fence corner. */
const EAST_DRAYNOR_TO_BANK = [
    { x: SOUTH_OF_EAST_DRAYNOR_GATE.x, z: SOUTH_OF_EAST_DRAYNOR_GATE.z },
    { x: 3158, z: 3280 },
    { x: 3150, z: 3270 },
    { x: 3135, z: 3260 },
    { x: 3115, z: 3250 },
    { x: DRAYNOR_BANK.x, z: DRAYNOR_BANK.z }
];
const GUILD_TO_EDGEVILLE = [
    { x: 3019, z: 3339 },
    { x: 3079, z: 3419 },
    { x: 3094, z: 3492 }
];

const PICKAXE = /^(bronze|iron|steel|mithril|adamant|rune) pickaxe$/i;
const RUNITE = /^runite ore$/i;
const ROCK = /rocks runite ore/i;
const ADDY = /^adamantite ore$/i;
const ADDY_ROCK = /rocks adamant/i;
const TRIP_SIZE = 2;

/** Retaliate at the rocks. Do not swing first — that skulls. */
const PK = process.argv.includes('--pk');
/** controls:com_2. Component ids match max-mining emotes: com_24 clap is 172, so com_N is 148+N. */
const AUTO_RETALIATE_ON = 150;
const DLONG = /^dragon longsword$/i;
const RUNE_PICK = /^rune pickaxe$/i;
const SHARK = /^shark$/i;
const SHARKS_PER_TRIP = 16;
const PK_SPECS = 4;
/** combat_hacksword:specbar — Cleave, 25% (250/1000). Four specs empty the bar. */
const HACKSWORD_SPECBAR = 7587;
const DLONG_SPEC_COST = 250;
const SPEC_MAX = 1000;
const SPEC_REGEN = 100;
const SPEC_REGEN_TICKS = 50;
const FLEET = new Set(botNames().map((name) => name.toLowerCase()));

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/rune-rocks.ts {botname}`);
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
    name: 'rune-rocks',
    grindLogPath: GRIND_LOG,
    stallMs: 480_000,
    maxRecoveryTactics: 8
});

installGracefulShutdown();

let banked = 0;
let deaths = 0;
let specEnergy = SPEC_MAX;
let specArmed = false;
let lastSpecRegenTick = -1;
let sharkShort = false;
let pkBankNow = false;
let retaliateClicks = 0;
let notedPickFight = false;

function log(msg: string): void {
    session.log('log', msg);
}

function intent(msg: string): void {
    void session.showIntent(msg);
}

function pos() {
    const p = sdk.getState()?.player;
    const hpSkill = sdk.getSkill('Hitpoints');
    return {
        x: p?.worldX ?? 0,
        z: p?.worldZ ?? 0,
        level: p?.level ?? 0,
        hp: hpSkill?.level ?? p?.hp ?? 10,
        maxHp: hpSkill?.baseLevel ?? p?.maxHp ?? 10,
        isDead: p?.isDead ?? false,
        inCombat: p?.combat?.inCombat ?? false,
        targetType: p?.combat?.targetType ?? 'none',
        targetIndex: p?.combat?.targetIndex ?? -1,
        lifeId: p?.lifeId ?? 0
    };
}

function distTo(x: number, z: number): number {
    return Math.hypot(pos().x - x, pos().z - z);
}

function inGuild(): boolean {
    const p = pos();
    return inMiningGuildCoords(p.x, p.z);
}

function inEssenceMine(): boolean {
    const p = pos();
    return inEssenceMineCoords(p.x, p.z);
}

function northOfDitch(): boolean {
    return pos().z >= 3520 && pos().z < 6400 && !inEssenceMine();
}

function atRocks(): boolean {
    return distTo(ROCKS.x, ROCKS.z) <= 8;
}

function atHobgoblin(): boolean {
    const p = pos();
    if (p.x >= 3065 && p.x <= 3100 && p.z >= 3740 && p.z <= 3778) return true;
    return distTo(HOBGOBLIN.x, HOBGOBLIN.z) <= 12;
}

function atEdgeville(): boolean {
    return distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z) <= 8 && !northOfDitch();
}

/** East of the Draynor wheat fence — walkTo west loops the closed gate corner. */
function inEastDraynorWheat(): boolean {
    const p = pos();
    return p.x >= 3148 && p.z >= 3288 && p.z <= 3310;
}

function preferDraynorBank(): boolean {
    if (PK) return false;
    return (
        inEastDraynorWheat() ||
        distTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z) + 4 < distTo(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z)
    );
}

function inGuildSurface(): boolean {
    const p = pos();
    return p.x >= 3000 && p.x <= 3060 && p.z >= 3320 && p.z <= 3365;
}

function mining(): number {
    return sdk.getSkill('Mining')?.baseLevel ?? 1;
}

function miningXp(): number {
    return sdk.getSkill('Mining')?.experience ?? 0;
}

function countRunite(): number {
    return sdk.getInventory().filter((i) => RUNITE.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function countAddy(): number {
    return sdk.getInventory().filter((i) => ADDY.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function freeSlots(): number {
    return 28 - occupiedSlots();
}

function runiteSlotsNeeded(): number {
    return Math.max(0, TRIP_SIZE - countRunite());
}

/** Leave room for the rest of the 2-ore runite trip. */
function canMineAddy(): boolean {
    return freeSlots() > runiteSlotsNeeded();
}

function hasPickaxe(): boolean {
    return !!(sdk.findInventoryItem(PICKAXE) || sdk.findEquipmentItem(PICKAXE));
}

function hasDlong(): boolean {
    return !!(sdk.findInventoryItem(DLONG) || sdk.findEquipmentItem(DLONG));
}

function sharkCount(): number {
    return sdk.getInventory().filter((i) => SHARK.test(i.name) && (i.count ?? 0) > 0).reduce((n, i) => n + (i.count ?? 1), 0);
}

function kept(name: string): boolean {
    if (PICKAXE.test(name)) return true;
    return PK && (DLONG.test(name) || SHARK.test(name));
}

function extras() {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && !kept(i.name));
}

function loadoutReady(): boolean {
    if (!hasPickaxe()) return false;
    if (!PK) return extras().length === 0;
    if (extras().length > 0) return false;
    return sharkCount() >= SHARKS_PER_TRIP || sharkShort;
}

function packed(): boolean {
    return loadoutReady();
}

function shouldBank(): boolean {
    if (countRunite() >= TRIP_SIZE) return true;
    if (PK && pkBankNow) return true;
    if (PK && sharkCount() === 0 && !sharkShort) return true;
    if (!northOfDitch() && (countRunite() > 0 || extras().length > 0)) return true;
    if (PK && !northOfDitch() && !loadoutReady()) return true;
    return false;
}

/**
 * The player auto-retaliate is already fighting, while their hit is fresh.
 * Anyone else nearby is not a target — Attack would skull us.
 */
function seeHostile() {
    if (!PK || !northOfDitch()) return null;
    const state = sdk.getState();
    const combat = state?.player?.combat;
    const targetIndex = combat?.targetIndex ?? -1;
    const player = sdk.getNearbyPlayers().find((entry) => entry.index === targetIndex);
    const ok = mayRetaliate({
        skulled: state?.isSkulled === true,
        tick: state?.tick ?? 0,
        lastDamageTick: combat?.lastDamageTick ?? -1,
        targetType: combat?.targetType ?? 'none',
        targetIndex,
        targetName: player?.name ?? '',
        selfName: username,
        fleet: FLEET
    });
    return ok && player ? player : null;
}

/** controls:com_2 sets option_nodef to 0 (auto-retaliate on). Clicking stops the current action. */
async function ensureAutoRetaliate(): Promise<void> {
    if (!PK) return;
    if (sdk.getState()?.autoRetaliateEnabled === true) return;
    if (retaliateClicks >= 3) return;
    retaliateClicks++;
    const r = await sdk.sendClickComponent(AUTO_RETALIATE_ON);
    await sdk.waitForTicks(2).catch(() => {});
    const on = sdk.getState()?.autoRetaliateEnabled === true;
    log(`Auto retaliate ${on ? 'on' : `still off (${r.message})`}`);
}

function needsHeal(): boolean {
    const p = pos();
    return needsBankHeal(p.hp, p.maxHp);
}

function bankFood() {
    return sdk
        .getBankItems()
        .filter((i) => (i.count ?? 0) > 0 && foodHeal(i.name) > 0)
        .sort((a, b) => foodHeal(b.name) - foodHeal(a.name))[0] ?? null;
}

function invEdible() {
    return sdk.getInventory().find(
        (i) =>
            (i.count ?? 0) > 0 &&
            foodHeal(i.name) > 0 &&
            (i.optionsWithIndex ?? []).some((o) => /eat/i.test(o.text))
    );
}

/** Eat at Edgeville, then deposit leftover food — do not take it into the wild. */
async function eatAtBank(): Promise<void> {
    const p = pos();
    if (p.hp >= p.maxHp - 3) return;
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        session.noteFailure('bank_open', 'Edgeville bank open failed (eat)');
        return;
    }
    const best = bankFood();
    if (!best) {
        session.log('warn', `No bank food to eat @ ${p.hp}/${p.maxHp}`);
        await bot.closeBank();
        return;
    }
    const missing = pos().maxHp - pos().hp;
    const heal = Math.max(foodHeal(best.name), 1);
    const take = Math.min(best.count ?? 1, Math.max(1, Math.ceil(missing / heal) + 1), 10);
    intent(`Withdrawing ${take} ${best.name} to eat (${pos().hp}/${pos().maxHp})`);
    await bot.withdrawItem(best, take, { asNote: false });
    await bot.closeBank();
    let bites = 0;
    while (pos().hp < pos().maxHp - 3 && bites < 12) {
        const food = invEdible();
        if (!food) break;
        const before = pos().hp;
        const r = await bot.eatFood(food);
        if (!r.success) break;
        await sdk.waitForCondition((s) => (s.player?.hp ?? 0) > before, 4_000).catch(() => {});
        bites++;
        session.noteProgress('inventory', 'eat');
    }
    const leftover = sdk.getInventory().filter((i) => foodHeal(i.name) > 0 && (i.count ?? 0) > 0);
    if (leftover.length) {
        if (sdk.getState()?.bank?.isOpen || (await bot.openBank()).success) {
            for (const item of leftover) await bot.depositItem(item, -1);
            await bot.closeBank();
        }
    }
    log(`Ate ${bites} @ Edgeville now ${pos().hp}/${pos().maxHp}`);
}

async function closeUi(): Promise<void> {
    const dialog = sdk.getDialog();
    if (dialog?.isOpen) {
        if (
            dialog.options?.every((o) => /click here to continue|continue/i.test(o.text)) ||
            (dialog.options?.length ?? 0) <= 1
        ) {
            await sdk.sendClickDialog(dialog.options?.[0]?.index ?? 0);
            await sdk.waitForTicks(1).catch(() => {});
        }
    }
    if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
        await bot.closeInterface();
    }
    await bot.dismissBlockingUI();
}

async function openNearbyGate(): Promise<void> {
    await sdk.scanNearbyLocs(10).catch(() => {});
    const closed =
        sdk.findNearbyLoc(/^(door|gate)$/i, { withOption: /^open$/i }) ??
        sdk.findNearbyLoc(/door|gate/i, { withOption: /open/i });
    if (closed && (closed.distance ?? 99) <= 5) {
        intent(`Opening ${closed.name} @ ${closed.x},${closed.z}`);
        await bot.openDoor(closed);
        await sdk.waitForTicks(2).catch(() => {});
    }
}

async function openEastDraynorGate(): Promise<void> {
    await sdk.scanNearbyLocs(12).catch(() => {});
    const gates = (sdk.getNearbyLocs() ?? [])
        .filter((l) => /gate/i.test(l.name) && l.z === EAST_DRAYNOR_GATE.z && l.x >= 3161 && l.x <= 3164)
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
    for (const gate of gates) {
        const open = gate.optionsWithIndex.find((o) => /^open$/i.test(o.text));
        if (!open) continue;
        intent(`Opening gate @ ${gate.x},${gate.z}`);
        await sdk.sendInteractLoc(gate.x, gate.z, gate.id, open.opIndex);
        await new Promise((r) => setTimeout(r, 800));
    }
}

/** Chaos temple double door is masked walkable. Open it before a hop crosses it. */
async function openDoorAhead(hop: Tile): Promise<void> {
    const here = pos();
    const dx = hop.x - here.x;
    const dz = hop.z - here.z;
    const steps = Math.max(Math.abs(dx), Math.abs(dz));
    let near = false;
    for (let i = 0; i <= steps; i++) {
        const x = here.x + Math.round((dx * i) / Math.max(steps, 1));
        const z = here.z + Math.round((dz * i) / Math.max(steps, 1));
        if (Math.max(Math.abs(x - here.x), Math.abs(z - here.z)) > 6) break;
        if (getDoorAt(0, x, z)) {
            near = true;
            break;
        }
    }
    if (!near) return;
    await sdk.scanNearbyLocs(8).catch(() => {});
    const door = (sdk.getNearbyLocs() ?? [])
        .filter((l) => /door|gate/i.test(l.name) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    const open = door?.optionsWithIndex.find((o) => /^open$/i.test(o.text));
    if (!door || !open) return;
    log(`Opening ${door.name} @ ${door.x},${door.z}`);
    await sdk.sendInteractLoc(door.x, door.z, door.id, open.opIndex);
    await sdk.waitForTicks(3).catch(() => {});
}

async function sendWalkHop(x: number, z: number, tolerance = 5, timeoutMs = 6_000): Promise<boolean> {
    await closeUi();
    if (distTo(x, z) <= tolerance) return true;
    const startZ = pos().z;
    const startX = pos().x;
    await sdk.sendWalk(x, z, true);
    const moved = await sdk
        .waitForCondition(
            (s) =>
                s.player?.isDead === true ||
                Math.hypot((s.player?.worldX ?? 0) - x, (s.player?.worldZ ?? 0) - z) <= tolerance + 1 ||
                (s.player?.worldX ?? startX) !== startX ||
                (s.player?.worldZ ?? startZ) !== startZ,
            timeoutMs
        )
        .then(() => true)
        .catch(() => false);
    await closeUi();
    return moved;
}

/**
 * One sendWalk, then keep moving until near the tile. Returning on the
 * first step made the wilderness loop re-click every tile and drop to a walk.
 */
async function runClick(x: number, z: number): Promise<boolean> {
    await closeUi();
    if (distTo(x, z) <= 5) return true;
    const sent = await sdk.sendWalk(x, z, true);
    if (!sent.success) return false;
    let lastX = pos().x;
    let lastZ = pos().z;
    let still = 0;
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline && !pos().isDead) {
        if (distTo(x, z) <= 5) return true;
        await sdk.waitForTicks(1).catch(() => {});
        if (pos().x === lastX && pos().z === lastZ) {
            still++;
            if (still >= 5) return false;
        } else {
            still = 0;
            lastX = pos().x;
            lastZ = pos().z;
        }
    }
    return distTo(x, z) <= 8;
}

/** Pathfinder loops the closed gate corner — open the gate, then hop south. */
async function escapeEastDraynorWheat(): Promise<boolean> {
    if (!inEastDraynorWheat()) return true;
    const startX = pos().x;
    const startZ = pos().z;
    intent('Opening east Draynor wheat gate');
    await openEastDraynorGate();
    intent('Walking south through gate');
    await sendWalkHop(SOUTH_OF_EAST_DRAYNOR_GATE.x, SOUTH_OF_EAST_DRAYNOR_GATE.z, 2);
    if (pos().z >= EAST_DRAYNOR_GATE.z) {
        await sendWalkHop(pos().x, EAST_DRAYNOR_GATE.z - 2, 1);
    }
    for (const wp of EAST_DRAYNOR_TO_BANK) {
        if (!inEastDraynorWheat() && distTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z) <= 12) return true;
        if (distTo(wp.x, wp.z) <= 4) continue;
        if (pos().z >= EAST_DRAYNOR_GATE.z) await openEastDraynorGate();
        const before = distTo(wp.x, wp.z);
        await sendWalkHop(wp.x, wp.z, 5);
        if (distTo(wp.x, wp.z) < before - 2) session.noteProgress('location', `${wp.x},${wp.z}`);
    }
    const escaped = !inEastDraynorWheat() || distTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z) <= 12;
    if (!escaped && pos().x === startX && pos().z === startZ) {
        session.log('warn', 'Still wedged on east Draynor gate — open gate @ 3162,3290 once manually');
    }
    return escaped;
}

async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
    await openNearbyGate();
    const result = await bot.walkTo(x, z, Math.min(tolerance, 3));
    return result.success || distTo(x, z) <= tolerance + 2;
}

async function walkWaypoints(points: { x: number; z: number }[]): Promise<void> {
    const dest = points[points.length - 1]!;
    for (const p of points) {
        if (northOfDitch()) return;
        if (distTo(p.x, p.z) <= 8) continue;
        if (Math.hypot(dest.x - p.x, dest.z - p.z) >= distTo(dest.x, dest.z) - 4) continue;
        await walkNear(p.x, p.z, 6);
    }
    if (!northOfDitch() && distTo(dest.x, dest.z) > 6) await walkNear(dest.x, dest.z, 4);
}

/** Raw sendWalk — pathfinder avoids wilderness and loops the Edgeville ditch. */
async function sendWalkTo(x: number, z: number, tolerance = 8): Promise<void> {
    await closeUi();
    if (distTo(x, z) <= tolerance) return;
    await sdk.sendWalk(x, z, true);
    await sdk
        .waitForCondition(
            (s) =>
                s.player?.isDead === true ||
                Math.hypot((s.player?.worldX ?? 0) - x, (s.player?.worldZ ?? 0) - z) <= tolerance + 2,
            18_000
        )
        .catch(() => {});
    await closeUi();
    await sdk.waitForTicks(1).catch(() => {});
}

function findLadder(want: 'up' | 'down') {
    const opt = want === 'up' ? /climb-up|climb.up/i : /climb-down|climb.down/i;
    return (
        (sdk.getNearbyLocs() ?? [])
            .filter((l) => /ladder/i.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
            .sort(
                (a, b) =>
                    (a.reachable === false ? 1 : 0) - (b.reachable === false ? 1 : 0) ||
                    (a.distance ?? 99) - (b.distance ?? 99)
            )[0] ?? null
    );
}

async function climbGuildUp(): Promise<boolean> {
    if (!inGuild()) return true;
    if (distTo(GUILD_LADDER_DOWN.x, GUILD_LADDER_DOWN.z) > 6) {
        await walkNear(GUILD_LADDER_DOWN.x, GUILD_LADDER_DOWN.z, 2);
    }
    let ladder = findLadder('up');
    if (!ladder) {
        await sdk.scanNearbyLocs(8).catch(() => {});
        ladder = findLadder('up');
    }
    if (!ladder) {
        session.noteFailure('climb', `No up ladder @ ${pos().x},${pos().z}`);
        return false;
    }
    intent(`Climb up ${ladder.name} @ ${ladder.x},${ladder.z}`);
    const match = ladder.optionsWithIndex.find((o) => /climb-up|climb.up/i.test(o.text));
    if ((ladder.distance ?? 99) > 2) await walkNear(ladder.x, ladder.z, 1);
    if (match && (ladder.distance ?? 99) <= 2) {
        await sdk.sendInteractLoc(ladder.x, ladder.z, ladder.id, match.opIndex);
    } else {
        await bot.interactLoc(ladder, /climb-up|climb.up/i);
    }
    await sdk.waitForCondition(() => !inGuild(), 10_000).catch(() => {});
    await closeUi();
    const ok = !inGuild();
    if (!ok) session.noteFailure('climb', 'Still in guild');
    return ok;
}

async function leaveEssenceMine(): Promise<boolean> {
    if (!inEssenceMine()) return true;
    for (let i = 0; i < 8; i++) {
        let portal = sdk.findNearbyLoc(/^portal$/i) ?? sdk.findNearbyLoc(/portal/i);
        if (!portal) {
            await sdk.scanNearbyLocs(15).catch(() => {});
            portal = sdk.findNearbyLoc(/^portal$/i) ?? sdk.findNearbyLoc(/portal/i);
        }
        if (!portal) {
            session.noteFailure('portal', `No portal in view @ ${pos().x},${pos().z}`);
            await sdk.waitForTicks(2);
            continue;
        }
        intent('Leaving essence mine via portal');
        await bot.interactLoc(portal, /use|enter|climb/i);
        await sdk.waitForCondition(() => !inEssenceMine(), 10_000).catch(() => {});
        if (!inEssenceMine()) return true;
    }
    return !inEssenceMine();
}

async function goToSurfaceBank(): Promise<boolean> {
    await closeUi();
    if (inEssenceMine() && !(await leaveEssenceMine())) return false;
    if (inGuild() && !(await climbGuildUp())) return false;
    if (northOfDitch()) return false;

    const useDraynor = preferDraynorBank();
    const bank = useDraynor ? DRAYNOR_BANK : EDGEVILLE_BANK;
    if (distTo(bank.x, bank.z) <= 8) return true;

    await openNearbyGate();
    intent(`Walking to ${useDraynor ? 'Draynor' : 'Edgeville'} bank`);
    session.setAnchor(bank.x, bank.z);
    if (inEastDraynorWheat()) {
        if (!(await escapeEastDraynorWheat())) {
            session.noteFailure('bank_walk', 'Could not leave east Draynor wheat');
            return false;
        }
    }
    if (useDraynor) {
        await walkNear(bank.x, bank.z, 4);
    } else if (distTo(bank.x, bank.z) > 25) {
        // A client pathfind from Ardougne to the guild freezes the lite client.
        // South of 2681,3316 is a wall; the road out is east. Hop that path.
        const moved = await hopToward(bank.x, bank.z);
        if (!moved) {
            session.noteFailure('bank_walk', `No step toward Edgeville @ ${pos().x},${pos().z}`);
            return false;
        }
        return distTo(bank.x, bank.z) <= 10;
    } else if (inGuildSurface() || pos().x < 3120) {
        await walkWaypoints(GUILD_TO_EDGEVILLE);
    } else {
        await walkWaypoints(TO_EDGEVILLE);
    }
    await walkNear(bank.x, bank.z, 2);
    return distTo(bank.x, bank.z) <= 10;
}

/** One-tile steps. A 2-tile chord east of 2681,3316 is "I can't reach that". */
async function stepAdjacent(towardX: number, towardZ: number): Promise<boolean> {
    const start = pos();
    const dx = Math.sign(towardX - start.x);
    const dz = Math.sign(towardZ - start.z);
    const tries = [
        { x: start.x + dx, z: start.z + dz },
        { x: start.x + dx, z: start.z },
        { x: start.x, z: start.z + dz },
        { x: start.x - dx, z: start.z },
        { x: start.x, z: start.z - dz }
    ].filter((tile, i, all) => all.findIndex((t) => t.x === tile.x && t.z === tile.z) === i);
    for (const tile of tries) {
        await sdk.sendWalk(tile.x, tile.z, false);
        await sdk
            .waitForCondition(
                (s) => (s.player?.worldX ?? start.x) !== start.x || (s.player?.worldZ ?? start.z) !== start.z,
                2_500
            )
            .catch(() => {});
        if (pos().x !== start.x || pos().z !== start.z) {
            log(`Stepped ${start.x},${start.z} -> ${pos().x},${pos().z}`);
            return true;
        }
    }
    await sdk.scanNearbyLocs(12).catch(() => {});
    const door = (sdk.getNearbyLocs() ?? [])
        .filter((l) => /door|gate/i.test(l.name) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (!door) return false;
    const open = door.optionsWithIndex.find((o) => /^open$/i.test(o.text));
    if (!open) return false;
    log(`Opening ${door.name} @ ${door.x},${door.z}`);
    await sdk.sendInteractLoc(door.x, door.z, door.id, open.opIndex);
    await sdk
        .waitForCondition(
            (s) => (s.player?.worldX ?? start.x) !== start.x || (s.player?.worldZ ?? start.z) !== start.z,
            8_000
        )
        .catch(() => {});
    const moved = pos().x !== start.x || pos().z !== start.z;
    if (moved) log(`Stepped ${start.x},${start.z} -> ${pos().x},${pos().z}`);
    return moved;
}

/** Short sendWalk hops along the local path. One client pathfind across the map stalls. */
async function hopToward(x: number, z: number): Promise<boolean> {
    const start = pos();
    if (!(await stepAdjacent(x, z))) {
        session.log('warn', `No adjacent step @ ${start.x},${start.z}`);
        return false;
    }
    const path = findLongPath(0, pos().x, pos().z, x, z).filter((p) => p.x !== pos().x || p.z !== pos().z);
    if (!path.length) {
        session.log('warn', `No path ${start.x},${start.z} -> ${x},${z}`);
        return false;
    }
    // First vertex only, then a few tiles along the path. A chord south of
    // 2681,3316 is a wall and the client never takes the step.
    const picks: { x: number; z: number }[] = [path[0]!];
    let prev = path[0]!;
    let travelled = 0;
    for (const tile of path.slice(1)) {
        travelled += Math.hypot(tile.x - prev.x, tile.z - prev.z);
        prev = tile;
        if (travelled < 3) continue;
        picks.push(tile);
        travelled = 0;
        if (picks.length >= 8) break;
    }
    log(`Hop ${start.x},${start.z} -> ${picks.map((p) => `${p.x},${p.z}`).join(' ')}`);
    for (const tile of picks) {
        if (pos().isDead) return false;
        const before = pos();
        const ok = await sendWalkHop(tile.x, tile.z, 2, 5_000);
        if (!ok && pos().x === before.x && pos().z === before.z) {
            session.log('warn', `No step ${before.x},${before.z} -> ${tile.x},${tile.z}`);
            break;
        }
        if (distTo(x, z) <= 10) return true;
    }
    const moved = pos().x !== start.x || pos().z !== start.z;
    if (!moved) {
        const step = path[0]!;
        log(`Still @ ${start.x},${start.z} — stepping ${step.x},${step.z}`);
        await sendWalkHop(step.x, step.z, 1, 5_000);
    }
    const now = pos();
    if (now.x !== start.x || now.z !== start.z) {
        log(`Moved ${start.x},${start.z} -> ${now.x},${now.z}`);
        return true;
    }
    session.log('warn', `Stuck @ ${now.x},${now.z} toward ${x},${z}`);
    return false;
}

function tickSpecRegen(): void {
    const tick = sdk.getState()?.tick ?? 0;
    if (lastSpecRegenTick < 0) lastSpecRegenTick = tick;
    if (specEnergy >= SPEC_MAX) {
        lastSpecRegenTick = tick;
        return;
    }
    while (tick - lastSpecRegenTick >= SPEC_REGEN_TICKS && specEnergy < SPEC_MAX) {
        specEnergy = Math.min(SPEC_MAX, specEnergy + SPEC_REGEN);
        lastSpecRegenTick += SPEC_REGEN_TICKS;
    }
}

async function enableDlongSpec(): Promise<boolean> {
    tickSpecRegen();
    if (!sdk.findEquipmentItem(DLONG)) return false;
    if (specEnergy < DLONG_SPEC_COST) return false;
    if (specArmed) return true;
    await sdk.sendSetTab(0).catch(() => {});
    const r = await sdk.sendClickComponent(HACKSWORD_SPECBAR);
    if (!r.success) {
        session.log('warn', `Spec bar click failed: ${r.message}`);
        return false;
    }
    specArmed = true;
    log(`Spec Cleave armed ${Math.floor(specEnergy / 10)}%`);
    return true;
}

function noteSpecUsed(): void {
    if (!specArmed) return;
    specArmed = false;
    specEnergy = Math.max(0, specEnergy - DLONG_SPEC_COST);
}

function noteSpecRejected(): void {
    const noPower = sdk.getNewChat({ types: [0] }).some((m) => /enough power/i.test(m.text));
    if (!noPower) return;
    specArmed = false;
    specEnergy = Math.min(specEnergy, DLONG_SPEC_COST - 1);
    session.log('warn', `Spec not enough power — energy tracked ${specEnergy}`);
}

function resetSpec(): void {
    specEnergy = SPEC_MAX;
    specArmed = false;
    lastSpecRegenTick = -1;
}

async function equipDlong(): Promise<boolean> {
    if (sdk.findEquipmentItem(DLONG)) return true;
    const inv = sdk.findInventoryItem(DLONG);
    if (!inv) return false;
    const r = await bot.equipItem(inv);
    const on = r.success || !!sdk.findEquipmentItem(DLONG);
    log(`Equip dragon longsword: ${on ? 'ok' : r.message}`);
    return on;
}

/** Dragon longsword when we have one. Otherwise the rune pickaxe, then any pickaxe. */
async function equipFightWeapon(): Promise<boolean> {
    if (hasDlong()) return equipDlong();
    const rune = sdk.findInventoryItem(RUNE_PICK);
    if (rune && !sdk.findEquipmentItem(RUNE_PICK)) {
        const r = await bot.equipItem(rune);
        const on = r.success || !!sdk.findEquipmentItem(RUNE_PICK);
        log(`Equip rune pickaxe: ${on ? 'ok' : r.message}`);
        if (on) return true;
    }
    if (sdk.findEquipmentItem(RUNE_PICK) || sdk.findEquipmentItem(PICKAXE)) return true;
    await equipPick();
    return hasPickaxe();
}

async function equipPick(): Promise<void> {
    if (sdk.findEquipmentItem(RUNE_PICK)) return;
    const rune = sdk.findInventoryItem(RUNE_PICK);
    if (rune) {
        const worn = sdk.findEquipmentItem(PICKAXE);
        if (worn && !RUNE_PICK.test(worn.name ?? '')) await bot.unequipItem(worn);
        const r = await bot.equipItem(sdk.findInventoryItem(RUNE_PICK) ?? rune);
        if (r.success || sdk.findEquipmentItem(RUNE_PICK)) {
            log('Equip rune pickaxe');
            return;
        }
    }
    if (sdk.findEquipmentItem(PICKAXE)) return;
    const inv = sdk.findInventoryItem(PICKAXE);
    if (!inv) return;
    const r = await bot.equipItem(inv);
    if (r.success) log(`Equip ${inv.name}`);
}

/** PK wears the dragon longsword and mines with the pick left in the bag. */
async function armTrip(): Promise<void> {
    if (PK && (await equipDlong())) {
        log('PK weapon dragon longsword, rune pick stays in inventory');
        return;
    }
    await equipPick();
}

function prayerPoints(): number {
    return sdk.getPrayerState()?.prayerPoints ?? 0;
}

function prayerLevel(): number {
    return sdk.getPrayerState()?.prayerLevel ?? sdk.getSkill('Prayer')?.baseLevel ?? 0;
}

/** Bank is open. Drop a worse pick when Edgeville has a rune one. */
async function preferRunePick(): Promise<void> {
    if (sdk.findInventoryItem(RUNE_PICK) || sdk.findEquipmentItem(RUNE_PICK)) return;
    if (!sdk.getState()?.bank?.isOpen || !sdk.findBankItem(RUNE_PICK)) return;
    const worn = sdk.findEquipmentItem(PICKAXE);
    if (worn && !RUNE_PICK.test(worn.name ?? '')) await bot.unequipItem(worn);
    for (const item of sdk.getInventory()) {
        if ((item.count ?? 0) > 0 && PICKAXE.test(item.name ?? '') && !RUNE_PICK.test(item.name ?? '')) {
            const r = await bot.depositItem(item, -1);
            if (!r.success) break;
        }
    }
    const banked = sdk.findBankItem(RUNE_PICK);
    if (!banked) return;
    const r = await bot.withdrawItem(banked, 1);
    log(`Withdraw rune pickaxe: ${r.success || r.partial ? 'ok' : r.message}`);
}

async function prayersOn(): Promise<void> {
    for (const name of ['ultimate_strength', 'incredible_reflexes'] as const) {
        const r = await bot.activatePrayer(name);
        log(`${name} ${r.success ? 'on' : r.message}`);
    }
}

async function prayersOff(): Promise<void> {
    await bot.deactivatePrayer('ultimate_strength').catch(() => {});
    await bot.deactivatePrayer('incredible_reflexes').catch(() => {});
}

/** Eat one shark when a hit would otherwise drop us. Returns false when full or out. */
async function eatShark(): Promise<boolean> {
    const p = pos();
    if (p.isDead || p.hp > p.maxHp - 18) return false;
    const food = sdk.getInventory().find((i) => SHARK.test(i.name) && (i.count ?? 0) > 0);
    if (!food) return false;
    const before = p.hp;
    const r = await bot.eatFood(food);
    if (!r.success) {
        session.log('warn', `Eat shark failed at ${before}/${p.maxHp}: ${r.message}`);
        return false;
    }
    await sdk.waitForCondition((s) => (s.player?.hp ?? 0) > before, 3_000).catch(() => {});
    log(`Ate shark ${pos().hp}/${pos().maxHp} left ${sharkCount()}`);
    return true;
}

/** Keep eating until a shark would overheal, or the eat is refused twice. */
async function eatUntilSafe(): Promise<void> {
    let misses = 0;
    for (let i = 0; i < 8 && !pos().isDead && sharkCount() > 0; i++) {
        if (pos().hp > pos().maxHp - 18) return;
        if (await eatShark()) {
            misses = 0;
            continue;
        }
        misses++;
        if (misses >= 2) return;
        await sdk.waitForTicks(2).catch(() => {});
    }
}

/** Short hop. walkTo pathfinds around wilderness lava. */
async function stepToward(x: number, z: number): Promise<void> {
    const p = pos();
    const dx = x - p.x;
    const dz = z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= 1) return;
    const step = Math.min(3, dist);
    const nx = Math.round(p.x + (dx / dist) * step);
    const nz = Math.round(p.z + (dz / dist) * step);
    await sdk.sendWalk(nx, nz, true);
    await sdk.waitForTicks(2).catch(() => {});
}

/**
 * Pray, then keep retaliating at the player who already hit us.
 * Dragon longsword Cleaves; a missing sword uses the pickaxe. Stop when the
 * hit goes stale, the target changes, or a skull appears — do not pick a new one.
 */
async function fightPker(target: { index: number; name: string; combatLevel: number; x: number; z: number }): Promise<void> {
    const weapon = hasDlong() ? 'dragon longsword' : 'pickaxe';
    log(`Retaliate ${target.name} (${target.combatLevel}) @ ${target.x},${target.z} with ${weapon} sharks=${sharkCount()}`);
    intent(`Retaliate ${target.name} with ${weapon}`);
    if (sdk.getState()?.isSkulled === true) {
        session.log('warn', 'Skulled — not swinging');
        return;
    }
    if (!(await equipFightWeapon())) {
        session.log('warn', 'No dragon longsword or pickaxe to retaliate with');
        return;
    }
    await sdk.waitForTicks(1).catch(() => {});
    await prayersOn();
    let specs = 0;
    let swung = false;
    try {
        for (let swing = 0; swing < 28 && !pos().isDead; swing++) {
            if (sdk.getState()?.isSkulled === true) {
                session.log('warn', `Skulled mid-fight vs ${target.name} — stopping`);
                break;
            }
            const current = seeHostile();
            if (!current || current.index !== target.index) {
                log(`${target.name} no longer the retaliate target after ${specs} specs`);
                break;
            }
            const live = sdk.getNearbyPlayers().find((p) => p.index === current.index);
            if (!live) break;
            await eatUntilSafe();
            if (pos().hp < 40 && sharkCount() > 0) continue;
            if (live.distance > 1) {
                await stepToward(live.x, live.z);
                await eatUntilSafe();
                continue;
            }
            const wantSpec = hasDlong() && specs < PK_SPECS && (await enableDlongSpec());
            if (sdk.getState()?.isSkulled === true || seeHostile()?.index !== live.index) break;
            const hit = await sdk.sendInteractPlayer(live.index, 2);
            if (!hit.success) {
                session.log('warn', `Attack ${live.name}: ${hit.message}`);
                await sdk.waitForTicks(1).catch(() => {});
                continue;
            }
            swung = true;
            if (wantSpec) {
                noteSpecUsed();
                specs++;
                log(`Spec ${specs}/${PK_SPECS} on ${live.name} @ ${pos().hp}/${pos().maxHp}`);
            }
            await eatUntilSafe();
            await sdk.waitForTicks(2).catch(() => {});
            noteSpecRejected();
            if (sharkCount() === 0) break;
            if (specs >= PK_SPECS && !pos().inCombat) break;
        }
    } finally {
        await prayersOff();
    }
    pkBankNow = sharkCount() === 0 && !sharkShort;
    log(`Fight done specs=${specs} swung=${swung} sharks=${sharkCount()} bank=${pkBankNow}`);
}

/** Bank is open. Sword, 20 sharks, eat up, then leave the shark pack in the bag. */
async function packPkLoadout(): Promise<void> {
    if (!hasDlong()) {
        const sword = sdk.findBankItem(DLONG);
        if (sword) {
            const r = await bot.withdrawItem(sword, 1, { asNote: false });
            log(`Withdraw dragon longsword: ${r.success || r.partial ? 'ok' : r.message}`);
        } else if (!notedPickFight) {
            notedPickFight = true;
            log('No dragon longsword — retaliating with the pickaxe');
        }
    }
    if (pos().hp < pos().maxHp - 8 && (sharkCount() > 0 || (sdk.findBankItem(SHARK)?.count ?? 0) > 0)) {
        const missing = pos().maxHp - pos().hp;
        const need = Math.max(1, Math.ceil(missing / 20));
        const bankedSharks = sdk.findBankItem(SHARK);
        const take = Math.min(Math.max(0, need - sharkCount()), bankedSharks?.count ?? 0);
        if (take > 0 && bankedSharks) await bot.withdrawItem(bankedSharks, take, { asNote: false });
        await bot.closeBank();
        let bites = 0;
        while (pos().hp < pos().maxHp - 3 && bites < 8) {
            if (!(await eatShark())) break;
            bites++;
        }
        if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) return;
    }
    while (sharkCount() > SHARKS_PER_TRIP) {
        const extra = sdk.findInventoryItem(SHARK);
        if (!extra) break;
        const r = await bot.depositItem(extra, -1);
        if (!r.success) break;
    }
    if (sharkCount() < SHARKS_PER_TRIP) {
        const bankedSharks = sdk.findBankItem(SHARK);
        const take = Math.min(SHARKS_PER_TRIP - sharkCount(), bankedSharks?.count ?? 0);
        if (take > 0 && bankedSharks) {
            const r = await bot.withdrawItem(bankedSharks, take, { asNote: false });
            log(`Withdraw ${take} shark: ${r.success || r.partial ? 'ok' : r.message}`);
        }
    }
    sharkShort = sharkCount() < SHARKS_PER_TRIP && (sdk.findBankItem(SHARK)?.count ?? 0) === 0;
    if (sharkShort) session.log('warn', `Only ${sharkCount()} sharks — Edgeville bank has no more`);
}

async function bankTrip(): Promise<boolean> {
    if (session.metrics().phase !== 'deposit') await session.setPhase('deposit');
    const bankTile = preferDraynorBank() ? DRAYNOR_BANK : EDGEVILLE_BANK;
    const fromX = pos().x;
    const fromZ = pos().z;
    if (!(await goToSurfaceBank())) {
        const nowDist = distTo(bankTile.x, bankTile.z);
        if (pos().x !== fromX || pos().z !== fromZ) {
            log(`Toward Edgeville @ ${pos().x},${pos().z} (${Math.round(nowDist)} tiles)`);
            return false;
        }
        session.noteFailure('bank_walk', preferDraynorBank() ? 'Could not reach Draynor' : 'Could not reach Edgeville');
        return false;
    }
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        session.noteFailure('bank_open', 'Edgeville bank open failed');
        return false;
    }
    const before = countRunite();
    const addyBefore = countAddy();
    for (const item of sdk.getInventory()) {
        const name = item.name?.trim();
        if (!name || (!RUNITE.test(name) && !ADDY.test(name))) continue;
        if ((item.count ?? 0) > 0) session.recordGain(name, item.count ?? 1);
    }
    for (;;) {
        const item = extras()[0];
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success) break;
    }
    if (!hasPickaxe()) {
        const pick =
            sdk.findBankItem(/^rune pickaxe$/i) ??
            sdk.findBankItem(/^adamant pickaxe$/i) ??
            sdk.findBankItem(PICKAXE);
        if (pick) await bot.withdrawItem(pick, 1);
    }
    if (PK && (sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        await preferRunePick();
        await packPkLoadout();
    }
    session.captureBankStock();
    await bot.closeBank();
    await armTrip();
    if (!PK && pos().hp < pos().maxHp - 8) await eatAtBank();
    if (PK) {
        pkBankNow = false;
        log(
            `Edgeville loadout sharks=${sharkCount()} dlong=${hasDlong() ? 'yes' : 'no'} ` +
                `pick=${hasPickaxe() ? 'yes' : 'no'} hp=${pos().hp}/${pos().maxHp}`
        );
    }
    const deposited = before - countRunite();
    const addyOut = addyBefore - countAddy();
    if (deposited > 0) {
        banked += deposited;
        session.recordTrip(deposited);
    }
    session.noteProgress('bank', 'edgeville');
    log(
        `Banked ${deposited} runite addy ${addyOut} | trip ${session.metrics().trips} total ${banked} | ` +
            `deaths ${deaths} | Mining ${mining()} (${miningXp()} xp)`
    );
    return packed() || hasPickaxe();
}

async function crossDitchNorth(): Promise<boolean> {
    if (northOfDitch()) return true;
    intent('Crossing the Edgeville wilderness ditch (sendWalk)');
    await sdk.sendWalk(DITCH_NORTH.x, DITCH_NORTH.z, true);
    await sdk
        .waitForCondition((s) => (s.player?.worldZ ?? 0) >= 3520 || s.player?.isDead === true, 12_000)
        .catch(() => {});
    await closeUi();
    if (!northOfDitch()) {
        await sdk.sendWalk(DITCH_NORTH.x, DITCH_NORTH.z, true);
        await sdk
            .waitForCondition((s) => (s.player?.worldZ ?? 0) >= 3520 || s.player?.isDead === true, 8_000)
            .catch(() => {});
        await closeUi();
    }
    return northOfDitch();
}

async function crossDitchSouth(): Promise<boolean> {
    if (!northOfDitch()) return true;
    intent('Crossing south out of wilderness (sendWalk)');
    await sendWalkTo(DITCH_NORTH.x, DITCH_NORTH.z, 6);
    await sdk.sendWalk(DITCH_SOUTH.x, DITCH_SOUTH.z, true);
    await sdk
        .waitForCondition((s) => (s.player?.worldZ ?? 0) < 3520 || s.player?.isDead === true, 12_000)
        .catch(() => {});
    await closeUi();
    if (northOfDitch()) {
        await sdk.sendWalk(DITCH_SOUTH.x, DITCH_SOUTH.z, true);
        await sdk
            .waitForCondition((s) => (s.player?.worldZ ?? 0) < 3520 || s.player?.isDead === true, 8_000)
            .catch(() => {});
        await closeUi();
    }
    return !northOfDitch();
}

function inBanditCamp(): boolean {
    const p = pos();
    return p.x >= BANDIT_CAMP.xMin && p.x <= BANDIT_CAMP.xMax && p.z >= BANDIT_CAMP.zMin && p.z <= BANDIT_CAMP.zMax;
}

async function escapeBanditCamp(): Promise<void> {
    if (!inBanditCamp()) return;
    intent(`Leaving Bandit Camp east @ ${EAST_OF_BANDITS.x},${EAST_OF_BANDITS.z}`);
    // Keep re-issuing walk while bandits drag us west.
    for (let i = 0; i < 8 && inBanditCamp() && !pos().isDead; i++) {
        await sendWalkTo(EAST_OF_BANDITS.x, Math.max(pos().z, EAST_OF_BANDITS.z), 6);
    }
}

/** Closest hop that does not aim back through the green dragons. */
function resumeHop(hops: Tile[]): number {
    const here = pos();
    const northRim = hops.some((h) => h.z >= 3878);
    const belowDragons = hops.some((h) => h.z <= 3768);
    let idx = 0;
    let best = Infinity;
    for (let i = 0; i < hops.length; i++) {
        const hop = hops[i]!;
        if (northRim && here.z >= 3878 && hop.z < 3878) continue;
        if (belowDragons && here.z < 3878 && hop.z > 3768) continue;
        const d = Math.hypot(here.x - hop.x, here.z - hop.z);
        if (d < best) {
            best = d;
            idx = i;
        }
    }
    return idx;
}

/** One 3-tile sendWalk. Refuses a step that enters the green-dragon box. */
async function stepToward(tile: Tile): Promise<boolean> {
    const path = findLongPath(0, pos().x, pos().z, tile.x, tile.z).filter((p) => p.x !== pos().x || p.z !== pos().z);
    let travelled = 0;
    let prev = { x: pos().x, z: pos().z };
    let pick: Tile | null = null;
    for (const p of path) {
        if (inGreenDragons(p.x, p.z)) {
            pick = null;
            break;
        }
        travelled += Math.hypot(p.x - prev.x, p.z - prev.z);
        prev = p;
        if (travelled >= 3) {
            pick = { x: p.x, z: p.z };
            break;
        }
    }
    const before = pos();
    if (!pick) {
        const tx = pos().x > 3010 && pos().z >= 3836 && pos().z < 3878 ? pos().x - 3 : pos().x;
        const tz = pos().z >= 3770 && pos().z < 3878 ? Math.max(3756, pos().z - 3) : pos().z;
        if (tx === pos().x && tz === pos().z) return false;
        await sendWalkHop(tx, tz, 1, 4_000);
    } else {
        await sendWalkHop(pick.x, pick.z, 1, 4_000);
    }
    return pos().x !== before.x || pos().z !== before.z;
}

let prayerTriedAt = 0;

async function rechargeAtChaosAltar(): Promise<boolean> {
    if (prayerLevel() <= 0 || prayerPoints() > 0) return true;
    intent(`Prayer ${prayerPoints()}/${prayerLevel()} — chaos altar @ ${CHAOS_ALTAR.x},${CHAOS_ALTAR.z}`);
    const there = await walkHops(
        chaosAltarHops(),
        () => distTo(CHAOS_ALTAR_STAND.x, CHAOS_ALTAR_STAND.z) <= 2,
        'altar'
    );
    if (!there && distTo(CHAOS_ALTAR.x, CHAOS_ALTAR.z) > 5) {
        session.noteFailure('prayer', `Could not reach chaos altar @ ${pos().x},${pos().z}`);
        return false;
    }
    await sdk.scanNearbyLocs(8).catch(() => {});
    const altar =
        (sdk.getNearbyLocs() ?? [])
            .filter((l) => /chaos altar/i.test(l.name) && l.optionsWithIndex.some((o) => /pray/i.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null;
    const pray = altar?.optionsWithIndex.find((o) => /pray/i.test(o.text));
    if (!altar || !pray) {
        session.noteFailure('prayer', `No chaos altar @ ${pos().x},${pos().z}`);
        return false;
    }
    const before = prayerPoints();
    await sdk.sendInteractLoc(altar.x, altar.z, altar.id, pray.opIndex);
    await sdk
        .waitForCondition((s) => (s.prayers?.prayerPoints ?? 0) > before, 8_000)
        .catch(() => {});
    const ok = prayerPoints() > before;
    log(`Chaos altar ${before} -> ${prayerPoints()}/${prayerLevel()} @ ${pos().x},${pos().z}`);
    return ok;
}

/** Recharge only off the rocks. A half trip stays put until the second ore. */
async function maybeRechargePrayer(label: string): Promise<void> {
    if (label === 'altar') return;
    if (atRocks() && countRunite() < TRIP_SIZE) return;
    if (prayerLevel() <= 0 || prayerPoints() > 0) return;
    if (Date.now() - prayerTriedAt < 120_000) return;
    const nearRoad = Math.hypot(pos().x - 2984, pos().z - 3820) <= 25;
    const nearAltar = distTo(CHAOS_ALTAR.x, CHAOS_ALTAR.z) <= 30;
    if (!nearRoad && !nearAltar) return;
    prayerTriedAt = Date.now();
    await rechargeAtChaosAltar();
}

async function walkHops(hops: Tile[], arrive: () => boolean, label: string): Promise<boolean> {
    let cursor = resumeHop(hops);
    let stuck = 0;
    for (let n = 0; n < 280 && !arrive() && !pos().isDead; n++) {
        if (label === 'west' && PK && sdk.getState()?.isSkulled === true) return false;
        await maybeRechargePrayer(label);
        if (arrive()) return true;
        while (cursor < hops.length - 1 && distTo(hops[cursor]!.x, hops[cursor]!.z) <= 3) cursor++;
        if (cursor >= hops.length) return arrive();
        const click = clickAhead(pos(), hops, cursor, (x, z) => getDoorAt(0, x, z) != null);
        const hop = click.tile;
        if (distTo(hop.x, hop.z) <= 3) {
            cursor = Math.max(cursor, click.index) + 1;
            continue;
        }
        const before = pos();
        await openDoorAhead(hop);
        const moved = click.straight ? await runClick(hop.x, hop.z) : await stepToward(hop);
        if (distTo(hop.x, hop.z) <= 6) {
            cursor = click.index;
            stuck = 0;
        } else if (!moved && pos().x === before.x && pos().z === before.z) {
            stuck++;
            if (stuck >= 4) {
                session.noteFailure('wildy_hop', `${label} stuck @ ${pos().x},${pos().z} toward ${hop.x},${hop.z}`);
                return false;
            }
        } else {
            stuck = 0;
        }
        if (n % 8 === 0) session.noteProgress('location', `${pos().x},${pos().z}`);
    }
    return arrive();
}

async function mineAllAddy(): Promise<void> {
    if (session.metrics().phase !== 'addy') await session.setPhase('addy');
    let dry = 0;
    while (!pos().isDead && canMineAddy() && dry < 2 && sdk.getState()?.isSkulled !== true) {
        if (!atHobgoblin()) return;
        const mined = await mineAddy();
        if (mined) dry = 0;
        else dry++;
    }
    log(`Hobgoblin clear addy ${countAddy()} runite ${countRunite()}/${TRIP_SIZE} @ ${pos().x},${pos().z}`);
}

async function goToRocks(): Promise<boolean> {
    if (atRocks()) return true;
    if (PK && sdk.getState()?.isSkulled === true) return false;
    if (session.metrics().phase !== 'wildy') await session.setPhase('wildy');
    if (!northOfDitch()) {
        if (!packed() && !(await bankTrip())) return false;
        if (!(await crossDitchNorth())) {
            session.noteFailure('ditch', 'Could not cross wilderness ditch');
            return false;
        }
    }
    if (inBanditCamp()) await escapeBanditCamp();
    session.setAnchor(ROCKS.x, ROCKS.z);
    intent('West of the lava maze, past the KBD ladder');
    return walkHops(westToRocksHops(), () => atRocks() || countRunite() >= TRIP_SIZE, 'west');
}

async function leaveWildy(): Promise<boolean> {
    if (!northOfDitch()) return true;
    if (session.metrics().phase !== 'escape') await session.setPhase('escape');
    if (pos().z < 3600 && distTo(DITCH_NORTH.x, DITCH_NORTH.z) <= 20) {
        await crossDitchSouth();
        return !northOfDitch();
    }
    const urgent =
        sdk.getState()?.isSkulled === true || needsHeal() || (PK && sharkCount() === 0 && !sharkShort);
    intent('Leaving on the west side of the lava maze');
    await walkHops(returnToHobHops(), () => atHobgoblin(), 'hob');
    if (!urgent && !pos().isDead && countRunite() >= TRIP_SIZE && hasPickaxe() && canMineAddy() && atHobgoblin()) {
        await mineAllAddy();
    }
    if (northOfDitch() && !pos().isDead && (atHobgoblin() || pos().z < 3770 || pos().x < 3020)) {
        await walkHops(hobToDitchHops(), () => !northOfDitch() || distTo(DITCH_NORTH.x, DITCH_NORTH.z) <= 6, 'south');
    }
    if (northOfDitch() && !pos().isDead && distTo(DITCH_NORTH.x, DITCH_NORTH.z) <= 30) await crossDitchSouth();
    return !northOfDitch();
}

function runeRocks() {
    return (sdk.getNearbyLocs() ?? [])
        .filter(
            (l) =>
                ROCK.test(l.name) &&
                l.optionsWithIndex.some((o) => /^mine$/i.test(o.text)) &&
                l.reachable !== false
        )
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
}

function addyRocks() {
    return (sdk.getNearbyLocs() ?? [])
        .filter(
            (l) =>
                ADDY_ROCK.test(l.name) &&
                l.optionsWithIndex.some((o) => /^mine$/i.test(o.text)) &&
                l.reachable !== false
        )
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
}

async function mineAddy(): Promise<boolean> {
    await closeUi();
    if (!atHobgoblin() || !canMineAddy()) return false;
    let rocks = addyRocks();
    if (!rocks.length) {
        await sdk.scanNearbyLocs(12).catch(() => {});
        rocks = addyRocks();
    }
    if (!rocks.length) {
        session.noteFailure('addy', `No adamant rock nearby @ ${pos().x},${pos().z}`);
        return false;
    }
    const rock = rocks[0]!;
    if ((rock.distance ?? 99) > 2) await sendWalkTo(rock.x, rock.z, 2);
    const before = countAddy();
    const xpBefore = miningXp();
    const life = pos().lifeId;
    const mine = rock.optionsWithIndex.find((o) => /^mine$/i.test(o.text));
    intent(`Mine ${rock.name} @ ${rock.x},${rock.z}`);
    if (mine) await sdk.sendInteractLoc(rock.x, rock.z, rock.id, mine.opIndex);
    await sdk
        .waitForCondition(
            (s) =>
                s.player?.isDead === true ||
                s.player?.lifeId !== life ||
                s.inventory.filter((i) => ADDY.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0) >
                    before ||
                (s.skills.find((sk) => sk.name === 'Mining')?.experience ?? 0) > xpBefore ||
                seeHostile() !== null,
            20_000
        )
        .catch(() => {});
    await closeUi();
    if (countAddy() > before || miningXp() > xpBefore) {
        session.noteProgress('xp', 'adamant');
        log(`Mined addy ${countAddy()} (runite ${countRunite()}/${TRIP_SIZE}) @ ${pos().x},${pos().z}`);
        return true;
    }
    if (seeHostile() || pos().isDead) return false;
    session.noteFailure('addy', `Nothing from ${rock.name}`);
    return false;
}

async function mineOne(): Promise<boolean> {
    await closeUi();
    if (!atRocks()) return false;
    let rocks = runeRocks();
    if (!rocks.length) {
        await sdk.scanNearbyLocs(12).catch(() => {});
        rocks = runeRocks();
    }
    if (!rocks.length) {
        session.noteProgress('location', 'waiting rocks');
        intent(`Waiting for rune rocks @ ${pos().x},${pos().z} ore=${countRunite()}`);
        await sdk.waitForTicks(5);
        return false;
    }
    const rock = rocks[0]!;
    if ((rock.distance ?? 99) > 2) {
        await sendWalkTo(rock.x + (rock.x >= ROCKS.x ? -1 : 1), rock.z, 2);
    }
    const before = countRunite();
    const xpBefore = miningXp();
    const life = pos().lifeId;
    const mine = rock.optionsWithIndex.find((o) => /^mine$/i.test(o.text));
    intent(`Mine ${rock.name} @ ${rock.x},${rock.z}`);
    if (mine) await sdk.sendInteractLoc(rock.x, rock.z, rock.id, mine.opIndex);
    await sdk
        .waitForCondition(
            (s) =>
                s.player?.isDead === true ||
                s.player?.lifeId !== life ||
                s.inventory.filter((i) => RUNITE.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0) >
                    before ||
                (s.skills.find((sk) => sk.name === 'Mining')?.experience ?? 0) > xpBefore ||
                seeHostile() !== null,
            20_000
        )
        .catch(() => {});
    await closeUi();
    if (countRunite() > before || miningXp() > xpBefore) {
        session.noteProgress('xp', 'runite');
        log(`Mined runite ${countRunite()}/${TRIP_SIZE} @ ${pos().x},${pos().z}`);
        return true;
    }
    if (seeHostile() || pos().isDead) return false;
    session.noteFailure('mine', `Nothing from ${rock.name}`);
    return false;
}

async function waitRespawn(): Promise<void> {
    const life = pos().lifeId;
    deaths++;
    log(`Died life ${life} @ ${pos().x},${pos().z} ore=${countRunite()} — waiting respawn`);
    intent('Dead — waiting Lumbridge respawn');
    await sdk.waitForCondition((s) => !s.player.isDead && s.player.lifeId !== life, 45_000).catch(() => {});
    await closeUi();
    resetSpec();
    session.noteProgress('location', 'respawn');
}

session.registerRecovery([
    {
        name: 'heal',
        run: async () => {
            if (!needsHeal()) return false;
            if (northOfDitch()) await leaveWildy();
            return bankTrip();
        }
    },
    {
        name: 'bank_ore',
        run: async () => {
            if (!shouldBank()) return false;
            if (northOfDitch()) await leaveWildy();
            return bankTrip();
        }
    },
    {
        name: 'to_rocks',
        run: async () => {
            if (shouldBank()) return false;
            return goToRocks();
        }
    }
]);

let deathsThisSession = 0;
let startHeal = true;
const MAX_DEATHS_PER_SESSION = 3;

try {
    await bot.skipTutorial();
    await closeUi();
    log(
        `Rune rocks start Mining ${mining()} (${miningXp()} xp) combat ${sdk.getState()?.player?.combatLevel ?? '?'} ` +
            `@ ${pos().x},${pos().z} hp=${pos().hp}/${pos().maxHp} pick=${sdk.findEquipmentItem(PICKAXE)?.name ?? sdk.findInventoryItem(PICKAXE)?.name ?? 'none'} ` +
            `runite=${countRunite()}${PK ? ' pk=retaliate noskull' : ''}`
    );

    if (mining() < 85) {
        session.stop('mining_level', `Mining ${mining()} — runite needs 85`);
    }

    while (!session.isStopped()) {
        session.maybeHeartbeat();
        await closeUi();
        if (pos().isDead) {
            deathsThisSession++;
            await waitRespawn();
            if (deathsThisSession >= MAX_DEATHS_PER_SESSION) {
                session.stopRestartable('death_cap', `Died ${deathsThisSession} times this session`);
                break;
            }
            if (!hasPickaxe()) {
                if (northOfDitch()) await leaveWildy();
                await bankTrip();
                if (!hasPickaxe()) {
                    session.stop('cannot_regear', 'No pickaxe in bank after death');
                    break;
                }
            }
            continue;
        }
        await ensureAutoRetaliate();
        if (PK && sdk.getState()?.isSkulled === true) {
            if (northOfDitch()) {
                log('Skulled — leaving the wilderness');
                await leaveWildy();
                continue;
            }
            if (countRunite() > 0 || countAddy() > 0) {
                await bankTrip();
                continue;
            }
            session.log('warn', `Skulled — waiting south of the ditch @ ${pos().x},${pos().z}`);
            await sdk.waitForTicks(25).catch(() => {});
            continue;
        }
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }

        const pker = seeHostile();
        if (pker) {
            await fightPker(pker);
            if (pos().isDead) continue;
            if (pkBankNow) {
                if (northOfDitch()) await leaveWildy();
                if (pos().isDead) continue;
                await bankTrip();
            } else {
                await armTrip();
            }
            continue;
        }

        if (PK && northOfDitch() && pos().hp <= pos().maxHp - 18 && sharkCount() > 0) {
            await eatShark();
        }

        if (startHeal) {
            startHeal = false;
            if (pos().hp < pos().maxHp - 8) {
                log(`Start heal ${pos().hp}/${pos().maxHp} — Edgeville eat then rocks`);
                if (northOfDitch()) await leaveWildy();
                if (pos().isDead) continue;
                await bankTrip();
                continue;
            }
        }

        if (needsHeal()) {
            if (northOfDitch()) await leaveWildy();
            if (pos().isDead) continue;
            await bankTrip();
            continue;
        }

        if (shouldBank()) {
            if (northOfDitch()) await leaveWildy();
            if (pos().isDead) continue;
            await bankTrip();
            continue;
        }

        if (!hasPickaxe()) {
            if (northOfDitch()) await leaveWildy();
            await bankTrip();
            if (!hasPickaxe()) {
                session.stop('no_pickaxe', 'No pickaxe after bank — check Edgeville');
                break;
            }
            continue;
        }

        if (atRocks() && runeRocks().length === 0) {
            await sdk.scanNearbyLocs(12).catch(() => {});
        }

        if (atRocks() && runeRocks().length > 0) {
            if (PK && hasDlong() && !sdk.findEquipmentItem(DLONG)) await armTrip();
            if (session.metrics().phase !== 'mine') await session.setPhase('mine');
            await mineOne();
            continue;
        }

        if (atRocks()) {
            if (PK && hasDlong() && !sdk.findEquipmentItem(DLONG)) await armTrip();
            if (session.metrics().phase !== 'mine') await session.setPhase('mine');
            await mineOne();
            continue;
        }

        if (!atRocks()) {
            await goToRocks();
            continue;
        }

        if (session.metrics().phase !== 'mine') await session.setPhase('mine');
        await mineOne();
    }

    const stop = session.metrics().stopReason;
    if (stop) log(`stopped ${stop.code} @ ${stop.location.x},${stop.location.z}`);
} catch (err) {
    console.error('Script error:', err);
} finally {
    await session.finalizeStop();
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
