/**
 * Wilderness rune rocks — suicide 2-ore trips, bank Edgeville.
 *
 *   bun bots/quests/rune-rocks.ts {botname}
 *   bun bots/Jackpoo2/rune-rocks.ts
 *
 * Lava Maze rocks (3059,3885) and (3060,3884). Pickaxe only so a PK
 * keeps pick + 2 runite. Eat at Edgeville when HP is low; never carry
 * food into the wild. Never bot.walkTo north of the ditch.
 * While rune rocks are down, mine adamant at the hobgoblin mine
 * (3075,3748) — keep two inventory slots free for runite, then walk
 * back to check. Stay on this job; do not fall back to essence.
 */
import {
    ActivitySession,
    BotSDK,
    deriveGatewayUrl,
    inEssenceMine as inEssenceMineCoords,
    inMiningGuild as inMiningGuildCoords
} from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { foodHeal, needsBankHeal } from './food-heal';
import {
    BANDIT_CAMP,
    EAST_OF_BANDITS,
    HOBGOBLIN,
    LAVA_MAZE_EAST,
    ROCKS,
    TO_HOBGOBLIN,
    WILDY_TO_ROCKS,
    skipIfFarther,
    southOfLavaMaze,
    waypointsToRuneRocks
} from './rune-rocks-route';
import { DRAYNOR_BANK } from './tiles';

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
const ADDY_BEFORE_RECHECK = 4;

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
    autoLaunchBrowser: true,
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

let banked = 0;
let deaths = 0;

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

function extras() {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && !PICKAXE.test(i.name));
}

function packed(): boolean {
    return hasPickaxe() && extras().length === 0;
}

function shouldBank(): boolean {
    if (countRunite() >= TRIP_SIZE) return true;
    if (!northOfDitch() && (countRunite() > 0 || extras().length > 0)) return true;
    return false;
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
    } else if (inGuildSurface() || pos().x < 3120) {
        await walkWaypoints(GUILD_TO_EDGEVILLE);
    } else {
        await walkWaypoints(TO_EDGEVILLE);
    }
    await walkNear(bank.x, bank.z, 2);
    return distTo(bank.x, bank.z) <= 10;
}

async function bankTrip(): Promise<boolean> {
    if (session.metrics().phase !== 'deposit') await session.setPhase('deposit');
    if (!(await goToSurfaceBank())) {
        session.noteFailure('bank_walk', preferDraynorBank() ? 'Could not reach Draynor' : 'Could not reach Edgeville');
        return false;
    }
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        session.noteFailure('bank_open', 'Edgeville bank open failed');
        return false;
    }
    const before = countRunite();
    const addyBefore = countAddy();
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
    await bot.closeBank();
    const inv = sdk.findInventoryItem(PICKAXE);
    if (inv && !sdk.findEquipmentItem(PICKAXE)) await bot.equipItem(inv);
    if (pos().hp < pos().maxHp - 8) await eatAtBank();
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

async function goToRocks(): Promise<boolean> {
    if (atRocks()) return true;
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
    intent(`Wildy sendWalk to rune rocks @ ${ROCKS.x},${ROCKS.z}`);
    for (let i = 0; i < 12 && !atRocks() && !pos().isDead; i++) {
        if (countRunite() >= TRIP_SIZE) return true;
        if (inBanditCamp()) {
            await escapeBanditCamp();
            continue;
        }
        const p = pos();
        const next = waypointsToRuneRocks({ x: p.x, z: p.z })[0];
        if (!next) {
            await sendWalkTo(ROCKS.x, ROCKS.z, 4);
            break;
        }
        const before = distTo(next.x, next.z);
        await sendWalkTo(next.x, next.z, 6);
        if (distTo(next.x, next.z) <= 8 || distTo(next.x, next.z) < before - 2) {
            session.noteProgress('location', `${next.x},${next.z}`);
        }
    }
    if (!atRocks() && !pos().isDead) await sendWalkTo(ROCKS.x, ROCKS.z, 4);
    if (atRocks()) session.noteProgress('location', 'rune rocks');
    return atRocks();
}

async function goToHobgoblin(): Promise<boolean> {
    if (atHobgoblin()) return true;
    if (!northOfDitch()) return false;
    if (session.metrics().phase !== 'addy') await session.setPhase('addy');
    if (inBanditCamp()) await escapeBanditCamp();
    intent(`Wildy sendWalk to hobgoblin addy @ ${HOBGOBLIN.x},${HOBGOBLIN.z}`);
    session.setAnchor(HOBGOBLIN.x, HOBGOBLIN.z);
    if (southOfLavaMaze(pos().x, pos().z)) {
        await sendWalkTo(LAVA_MAZE_EAST.x, LAVA_MAZE_EAST.z, 6);
        session.noteProgress('location', `${LAVA_MAZE_EAST.x},${LAVA_MAZE_EAST.z}`);
    }
    for (const wp of TO_HOBGOBLIN) {
        if (pos().isDead || countRunite() >= TRIP_SIZE) return false;
        const now = pos();
        if (skipIfFarther({ x: now.x, z: now.z }, wp, HOBGOBLIN)) continue;
        if (distTo(wp.x, wp.z) <= 6) continue;
        if (atHobgoblin()) break;
        await sendWalkTo(wp.x, wp.z, 6);
        session.noteProgress('location', `${wp.x},${wp.z}`);
    }
    if (!atHobgoblin() && !pos().isDead) await sendWalkTo(HOBGOBLIN.x, HOBGOBLIN.z, 6);
    if (atHobgoblin()) session.noteProgress('location', 'hobgoblin mine');
    return atHobgoblin();
}

async function leaveWildy(): Promise<boolean> {
    if (!northOfDitch()) return true;
    if (session.metrics().phase !== 'escape') await session.setPhase('escape');
    intent('Leaving wilderness with ore (sendWalk south)');
    if (southOfLavaMaze(pos().x, pos().z)) {
        await sendWalkTo(LAVA_MAZE_EAST.x, LAVA_MAZE_EAST.z, 6);
        session.noteProgress('location', `${LAVA_MAZE_EAST.x},${LAVA_MAZE_EAST.z}`);
    }
    for (const wp of [...WILDY_TO_ROCKS].reverse()) {
        if (pos().isDead || !northOfDitch()) break;
        if (pos().z <= wp.z + 4 && distTo(wp.x, wp.z) > 40) continue;
        await sendWalkTo(wp.x, wp.z, 8);
        session.noteProgress('location', `${wp.x},${wp.z}`);
    }
    if (northOfDitch() && !pos().isDead) await crossDitchSouth();
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
                (s.skills.find((sk) => sk.name === 'Mining')?.experience ?? 0) > xpBefore,
            20_000
        )
        .catch(() => {});
    await closeUi();
    if (countAddy() > before || miningXp() > xpBefore) {
        session.noteProgress('xp', 'adamant');
        log(`Mined addy ${countAddy()} (runite ${countRunite()}/${TRIP_SIZE}) @ ${pos().x},${pos().z}`);
        return true;
    }
    if (pos().isDead) return false;
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
                (s.skills.find((sk) => sk.name === 'Mining')?.experience ?? 0) > xpBefore,
            20_000
        )
        .catch(() => {});
    await closeUi();
    if (countRunite() > before || miningXp() > xpBefore) {
        session.noteProgress('xp', 'runite');
        log(`Mined runite ${countRunite()}/${TRIP_SIZE} @ ${pos().x},${pos().z}`);
        return true;
    }
    if (pos().isDead) return false;
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

let waitingForRocks = false;
let addyThisVisit = 0;
let deathsThisSession = 0;
let startHeal = true;
const MAX_DEATHS_PER_SESSION = 3;

try {
    await bot.skipTutorial();
    await closeUi();
    log(
        `Rune rocks start Mining ${mining()} (${miningXp()} xp) combat ${sdk.getState()?.player?.combatLevel ?? '?'} ` +
            `@ ${pos().x},${pos().z} hp=${pos().hp}/${pos().maxHp} pick=${sdk.findEquipmentItem(PICKAXE)?.name ?? sdk.findInventoryItem(PICKAXE)?.name ?? 'none'} ` +
            `runite=${countRunite()}`
    );

    if (mining() < 70) {
        session.stop('mining_level', `Mining ${mining()} — runite needs 70`);
    }

    while (!session.isStopped()) {
        session.maybeHeartbeat();
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        await closeUi();
        if (pos().isDead) {
            waitingForRocks = false;
            addyThisVisit = 0;
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

        if (startHeal) {
            startHeal = false;
            if (pos().hp < pos().maxHp - 8) {
                waitingForRocks = false;
                addyThisVisit = 0;
                log(`Start heal ${pos().hp}/${pos().maxHp} — Edgeville eat then rocks`);
                if (northOfDitch()) await leaveWildy();
                if (pos().isDead) continue;
                await bankTrip();
                continue;
            }
        }

        if (needsHeal()) {
            waitingForRocks = false;
            addyThisVisit = 0;
            if (northOfDitch()) await leaveWildy();
            if (pos().isDead) continue;
            await bankTrip();
            continue;
        }

        if (shouldBank()) {
            waitingForRocks = false;
            addyThisVisit = 0;
            if (northOfDitch()) await leaveWildy();
            if (pos().isDead) continue;
            await bankTrip();
            continue;
        }

        if (!hasPickaxe()) {
            waitingForRocks = false;
            addyThisVisit = 0;
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
            waitingForRocks = false;
            addyThisVisit = 0;
            if (session.metrics().phase !== 'mine') await session.setPhase('mine');
            await mineOne();
            continue;
        }

        if (atRocks() && runeRocks().length === 0) {
            waitingForRocks = true;
        }

        if (waitingForRocks && canMineAddy() && northOfDitch()) {
            if (!atHobgoblin()) {
                const left = await goToHobgoblin();
                if (!left) waitingForRocks = false;
                continue;
            }
            if (session.metrics().phase !== 'addy') await session.setPhase('addy');
            const mined = await mineAddy();
            if (mined) addyThisVisit++;
            if (!mined || addyThisVisit >= ADDY_BEFORE_RECHECK) {
                addyThisVisit = 0;
                waitingForRocks = false;
                await goToRocks();
            }
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
