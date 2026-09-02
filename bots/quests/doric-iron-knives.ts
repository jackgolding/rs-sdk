/**
 * Smithing grind: bronze to 15, guild/dwarven iron → Doric knives to 30,
 * then steel bars (1 iron + 2 coal) to 70, then bank addy / runite
 * (rune first at 85+). Iron is mined at the north guild / dwarven-stair
 * cluster, not Rimmington.
 *
 * Iron knives unlock at 22; 15–22 smiths iron daggers. If addy is gone and
 * smithing is still under 85 with runite left, keeps smelting steel.
 *
 *   bun bots/quests/doric-iron-knives.ts Jackpoo2
 */
import {
    ActivitySession,
    BotSDK,
    deriveGatewayUrl,
    inMiningGuild as inMiningGuildCoords,
    inWilderness
} from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import {
    DITCH_NORTH,
    DITCH_SOUTH,
    DORIC_ANVIL,
    DWARVEN_MINE_DOOR,
    DWARVEN_STAIRS_DOWN,
    DWARVEN_STAIRS_UP,
    EDGEVILLE,
    FALADOR_EAST_BANK,
    FALADOR_FURNACE,
    FALADOR_NORTH,
    FALADOR_WEST_BANK,
    GUILD_COAL,
    GUILD_IRON,
    GUILD_LADDER,
    GUILD_LADDER_DOWN,
    RIMMINGTON_BRONZE,
    RIMMINGTON_IRON
} from './tiles';
import {
    closeUi as closeUiShared,
    distTo as distToShared,
    walkNear as walkNearShared,
    walkWaypoints as walkWaypointsShared
} from './movement';

const KNIFE_TARGET = 70;
const RUNE_SMELT = 85;
const IRON_SMELT = 15;
const STEEL_LEVEL = 30;
const IRON_KNIVES = 22;
const BRONZE_KNIVES = 7;

const PICKAXE = /^(bronze|iron|steel|mithril|adamant|rune) pickaxe$/i;
const HAMMER = /^hammer$/i;
const COPPER = /^copper ore$/i;
const TIN = /^tin ore$/i;
const IRON = /^iron ore$/i;
const COAL = /^coal$/i;
const BRONZE_BAR = /^bronze bar$/i;
const IRON_BAR = /^iron bar$/i;
const STEEL_BAR = /^steel bar$/i;
const KING_SCORPION = /king scorpion/i;
const ADDY_ORE = /^adamantite ore$/i;
const RUNE_ORE = /^runite ore$/i;
const KNIVES = /^(bronze|iron) kni(fe|ves)$/i;
const FOOD_NAME =
    /shrimp|anchov|sardine|herring|trout|pike|salmon|tuna|lobster|swordfish|shark|bass|meat|chicken|bread|cake|wine|kebab|beer/i;

const ROCK_COPPER = /rocks copper ore/i;
const ROCK_TIN = /rocks tin ore/i;
const ROCK_IRON = /rocks iron ore/i;
const ROCK_COAL = /rocks coal ore/i;

const SMITH_UI = {
    dagger: { component: 1119, slot: 0 },
    knives: { component: 1123, slot: 2 }
} as const;

const TO_MINE = [
    { x: 3007, z: 3340 },
    { x: 3010, z: 3265 },
    RIMMINGTON_IRON
];
const TO_FURNACE_FROM_MINE = [
    { x: 3010, z: 3265 },
    { x: 3007, z: 3340 },
    FALADOR_FURNACE
];
const TO_DORIC_FROM_EDGE = [
    { x: 3080, z: 3480 },
    { x: 3080, z: 3420 },
    { x: 3018, z: 3450 },
    DORIC_ANVIL
];
const OUT_OF_WILDY = [
    { x: 3110, z: 3700 },
    { x: 3102, z: 3610 },
    DITCH_NORTH
];

type Premium = {
    name: 'rune' | 'adamant';
    level: number;
    ore: RegExp;
    coalPerBar: number;
    bar: RegExp;
    make10: RegExp;
};

const PREMIUM: Premium[] = [
    {
        name: 'rune',
        level: RUNE_SMELT,
        ore: RUNE_ORE,
        coalPerBar: 8,
        bar: /^runite bar$/i,
        make10: /smelt\s+10.*rune/i
    },
    {
        name: 'adamant',
        level: 70,
        ore: ADDY_ORE,
        coalPerBar: 6,
        bar: /^adamantite bar$/i,
        make10: /smelt\s+10.*adamant/i
    }
];

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function isCookedFood(name: string): boolean {
    return FOOD_NAME.test(name) && !/^raw |^burnt /i.test(name);
}

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/doric-iron-knives.ts {botname}`);
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
    name: 'doric-iron-knives',
    grindLogPath: GRIND_LOG,
    stallMs: 180_000,
    maxRecoveryTactics: 8
});

let lastSmith = 0;

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

async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
    return walkNearShared(bot, sdk, x, z, tolerance);
}

async function walkWaypoints(points: { x: number; z: number }[]): Promise<void> {
    await walkWaypointsShared(bot, sdk, points, { distTo, walkNear });
}

async function closeUi(): Promise<void> {
    await closeUiShared(bot, sdk);
}

function smithing(): number {
    return sdk.getSkill('Smithing')?.baseLevel ?? 1;
}

function smithXp(): number {
    return sdk.getSkill('Smithing')?.experience ?? 0;
}

function miningXp(): number {
    return sdk.getSkill('Mining')?.experience ?? 0;
}

function count(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function bagFull(): boolean {
    return occupiedSlots() >= 28;
}

function hasPickaxe(): boolean {
    return !!(sdk.findInventoryItem(PICKAXE) || sdk.findEquipmentItem(PICKAXE));
}

function hasHammer(): boolean {
    return !!sdk.findInventoryItem(HAMMER);
}

function bankReady(): boolean {
    const s = sdk.getState();
    return !!(s?.bank?.isOpen && s?.interface?.isOpen);
}

function bankCount(pattern: RegExp): number {
    return sdk.findBankItem(pattern)?.count ?? 0;
}

function keepItem(name: string): boolean {
    if (PICKAXE.test(name)) return true;
    if (smithing() < STEEL_LEVEL && (HAMMER.test(name) || KNIVES.test(name))) return true;
    return false;
}

function inMine(): boolean {
    const p = pos();
    return p.level === 0 && p.x >= 2960 && p.x <= 2992 && p.z >= 3224 && p.z <= 3252;
}

function inGuild(): boolean {
    return inMiningGuildCoords(pos().x, pos().z);
}

function inUnderground(): boolean {
    return pos().z >= 9600 && pos().z < 10000;
}

function nearDoric(): boolean {
    return distTo(DORIC_ANVIL.x, DORIC_ANVIL.z) <= 8;
}

function nearFurnace(): boolean {
    return distTo(FALADOR_FURNACE.x, FALADOR_FURNACE.z) <= 8;
}

function nearWestBank(): boolean {
    return distTo(FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z) <= 10;
}

function nearAnyBank(): boolean {
    return (
        nearWestBank() ||
        distTo(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z) <= 8 ||
        distTo(EDGEVILLE.x, EDGEVILLE.z) <= 8
    );
}

function bronzeProduct(): 'dagger' | 'knives' {
    return smithing() >= BRONZE_KNIVES ? 'knives' : 'dagger';
}

function ironProduct(): 'dagger' | 'knives' {
    return smithing() >= IRON_KNIVES ? 'knives' : 'dagger';
}

function noteLevel(): void {
    if (smithing() === lastSmith) return;
    log(`LEVEL UP Smithing ${smithing()} (${smithXp()} xp)`);
    lastSmith = smithing();
    session.noteProgress('xp', `smith ${smithing()}`);
}

async function openToward(tx: number, tz: number): Promise<void> {
    const door = (sdk.getNearbyLocs() ?? [])
        .filter(
            (l) =>
                /door|gate/i.test(l.name) &&
                l.reachable !== false &&
                l.optionsWithIndex.some((o) => /^open$/i.test(o.text))
        )
        .sort((a, b) => Math.hypot(a.x - tx, a.z - tz) - Math.hypot(b.x - tx, b.z - tz))[0];
    if (door && (door.distance ?? 99) <= 10) await bot.openDoor(door);
}

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
}

async function leaveWildy(): Promise<boolean> {
    if (!inWilderness(pos().x, pos().z)) return true;
    intent('Leaving wilderness via Edgeville ditch');
    session.setAnchor(DITCH_SOUTH.x, DITCH_SOUTH.z);
    for (const p of OUT_OF_WILDY) {
        if (!inWilderness(pos().x, pos().z)) break;
        if (p.z > pos().z + 8) continue;
        await sendWalkTo(p.x, p.z, 8);
    }
    await sendWalkTo(DITCH_NORTH.x, DITCH_NORTH.z, 6);
    await sdk.sendWalk(DITCH_SOUTH.x, DITCH_SOUTH.z, true);
    await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) < 3520 || s.player?.isDead === true, 12_000).catch(() => {});
    const ok = !inWilderness(pos().x, pos().z);
    if (!ok) session.noteFailure('ditch', 'Still north of wilderness ditch');
    return ok;
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

async function leaveGuild(): Promise<boolean> {
    if (!inGuild()) return true;
    intent('Climbing out of Mining Guild');
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
    const match = ladder.optionsWithIndex.find((o) => /climb-up|climb.up/i.test(o.text));
    if (match && (ladder.distance ?? 99) <= 2) {
        await sdk.sendInteractLoc(ladder.x, ladder.z, ladder.id, match.opIndex);
    } else {
        await bot.interactLoc(ladder, /climb-up|climb.up/i);
    }
    await sdk.waitForCondition(() => !inGuild(), 10_000).catch(() => {});
    const ok = !inGuild();
    if (!ok) session.noteFailure('climb', 'Still in Mining Guild');
    return ok;
}

async function climbGuildDown(): Promise<boolean> {
    if (inGuild()) return true;
    intent('Climbing into Mining Guild');
    await openToward(GUILD_LADDER.x, GUILD_LADDER.z);
    await walkNear(GUILD_LADDER.x, GUILD_LADDER.z, 2);
    let ladder = findLadder('down');
    if (!ladder) {
        await sdk.scanNearbyLocs(8).catch(() => {});
        ladder = findLadder('down');
    }
    if (!ladder) {
        session.noteFailure('climb', 'No guild down ladder');
        return false;
    }
    await bot.interactLoc(ladder, /climb-down|climb.down/i);
    await sdk.waitForCondition(() => inGuild(), 10_000).catch(() => {});
    return inGuild();
}

function findStairs(want: 'up' | 'down') {
    const opt = want === 'up' ? /climb-up|climb.up/i : /climb-down|climb.down/i;
    return (
        (sdk.getNearbyLocs() ?? [])
            .filter(
                (l) =>
                    /stair/i.test(l.name) &&
                    l.optionsWithIndex.some((o) => opt.test(o.text)) &&
                    l.reachable !== false
            )
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null
    );
}

async function climbStairs(want: 'up' | 'down'): Promise<boolean> {
    const stand = want === 'down' ? DWARVEN_STAIRS_DOWN : DWARVEN_STAIRS_UP;
    const before = inUnderground();
    if (want === 'down' && distTo(stand.x, stand.z) <= 4) {
        await walkNear(DWARVEN_MINE_DOOR.x, DWARVEN_MINE_DOOR.z, 1);
        await openToward(stand.x, stand.z);
    }
    if (distTo(stand.x, stand.z) > 4) {
        await openToward(stand.x, stand.z);
        await walkNear(stand.x, stand.z, 2);
    }
    let stairs = findStairs(want);
    if (!stairs) {
        await sdk.scanNearbyLocs(8).catch(() => {});
        stairs = findStairs(want);
    }
    if (!stairs) {
        session.noteFailure('climb', `No ${want} stairs @ ${pos().x},${pos().z}`);
        return false;
    }
    intent(`Climb ${want} ${stairs.name} @ ${stairs.x},${stairs.z}`);
    const opt = want === 'up' ? /climb-up|climb.up/i : /climb-down|climb.down/i;
    await bot.interactLoc(stairs, opt);
    await sdk.waitForCondition(() => inUnderground() !== before, 10_000).catch(() => {});
    return inUnderground() !== before;
}

async function leaveUnderground(): Promise<boolean> {
    if (!inUnderground()) return true;
    intent('Leaving dwarven mine / Mining Guild');
    const useStairs =
        pos().z >= 9752 || distTo(DWARVEN_STAIRS_UP.x, DWARVEN_STAIRS_UP.z) <= distTo(GUILD_LADDER_DOWN.x, GUILD_LADDER_DOWN.z) + 6;
    if (useStairs) {
        await walkNear(DWARVEN_STAIRS_UP.x, DWARVEN_STAIRS_UP.z, 2);
        if (await climbStairs('up')) return true;
    }
    if (inGuild() && (await leaveGuild())) return true;
    await walkNear(DWARVEN_STAIRS_UP.x, DWARVEN_STAIRS_UP.z, 2);
    const ok = await climbStairs('up');
    if (!ok) session.noteFailure('climb', `Still underground @ ${pos().x},${pos().z}`);
    return ok;
}

async function fleeScorpion(): Promise<boolean> {
    const king = (sdk.getNearbyNpcs() ?? [])
        .filter((n) => KING_SCORPION.test(n.name))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (!king || (king.distance ?? 99) > 8) return false;
    intent(`Run from king scorpion to dwarven stairs`);
    await walkNear(DWARVEN_STAIRS_UP.x, DWARVEN_STAIRS_UP.z, 2);
    return true;
}

async function leaveWildyOrGuild(): Promise<boolean> {
    if (inWilderness(pos().x, pos().z) && !(await leaveWildy())) return false;
    if (inUnderground() && !(await leaveUnderground())) return false;
    return pos().z < 6400;
}

async function goToDoric(): Promise<boolean> {
    await closeUi();
    if (!(await leaveWildyOrGuild())) return false;
    if (nearDoric() && sdk.findNearbyLoc(/anvil/i)) return true;
    intent('Walking to Doric anvil');
    session.setAnchor(DORIC_ANVIL.x, DORIC_ANVIL.z);
    if (distTo(DORIC_ANVIL.x, DORIC_ANVIL.z) > 40) {
        if (pos().x > 3050 && pos().z > 3460) await walkWaypoints(TO_DORIC_FROM_EDGE);
        else if (inMine() || pos().z < 3300) {
            await walkWaypoints(TO_FURNACE_FROM_MINE);
            await walkNear(FALADOR_NORTH.x, FALADOR_NORTH.z, 4);
        } else if (nearFurnace() || nearWestBank()) {
            await walkNear(FALADOR_NORTH.x, FALADOR_NORTH.z, 4);
        }
    }
    await openToward(DORIC_ANVIL.x, DORIC_ANVIL.z);
    await walkNear(DORIC_ANVIL.x, DORIC_ANVIL.z, 2);
    await openToward(DORIC_ANVIL.x, DORIC_ANVIL.z);
    await sdk.scanNearbyLocs(8).catch(() => {});
    const ok = nearDoric() || !!sdk.findNearbyLoc(/anvil/i);
    if (!ok) session.noteFailure('doric', `Still ${pos().x},${pos().z}`);
    return ok;
}

async function goToFurnace(): Promise<boolean> {
    await closeUi();
    if (!(await leaveWildyOrGuild())) return false;
    if (nearFurnace()) return true;
    intent('Walking to Falador furnace');
    session.setAnchor(FALADOR_FURNACE.x, FALADOR_FURNACE.z);
    if (inMine() || pos().z < 3280) await walkWaypoints(TO_FURNACE_FROM_MINE);
    else if (nearDoric()) await walkNear(FALADOR_NORTH.x, FALADOR_NORTH.z, 4);
    else if (distTo(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z) <= 20) {
        await walkNear(FALADOR_NORTH.x, FALADOR_NORTH.z, 6);
    } else if (pos().x > 3050 && pos().z > 3460) {
        await walkWaypoints(TO_DORIC_FROM_EDGE);
        await walkNear(FALADOR_NORTH.x, FALADOR_NORTH.z, 4);
    }
    await walkNear(FALADOR_FURNACE.x, FALADOR_FURNACE.z, 2);
    const ok = distTo(FALADOR_FURNACE.x, FALADOR_FURNACE.z) <= 8;
    if (!ok) session.noteFailure('furnace', `Still ${pos().x},${pos().z}`);
    return ok;
}

async function goToMine(): Promise<boolean> {
    await closeUi();
    if (!(await leaveWildyOrGuild())) return false;
    if (inMine()) return true;
    intent('Walking to Rimmington mine');
    session.setAnchor(RIMMINGTON_IRON.x, RIMMINGTON_IRON.z);
    if (distTo(RIMMINGTON_IRON.x, RIMMINGTON_IRON.z) > 16) {
        if (nearDoric()) await walkNear(FALADOR_NORTH.x, FALADOR_NORTH.z, 4);
        await walkWaypoints(TO_MINE);
    }
    await walkNear(RIMMINGTON_IRON.x, RIMMINGTON_IRON.z, 3);
    await sdk.scanNearbyLocs(12).catch(() => {});
    const ok = inMine() || distTo(RIMMINGTON_IRON.x, RIMMINGTON_IRON.z) <= 8;
    if (ok) session.noteProgress('location', 'rimmington');
    else session.noteFailure('mine_walk', `Still ${pos().x},${pos().z}`);
    return ok;
}

async function goToGuildIron(): Promise<boolean> {
    await closeUi();
    if (inWilderness(pos().x, pos().z) && !(await leaveWildy())) return false;
    if (inUnderground() && distTo(GUILD_IRON.x, GUILD_IRON.z) <= 14) return true;
    intent('Walking to dwarven / guild iron');
    session.setAnchor(GUILD_IRON.x, GUILD_IRON.z);
    if (!inUnderground()) {
        if (distTo(DWARVEN_STAIRS_DOWN.x, DWARVEN_STAIRS_DOWN.z) > 10) {
            if (nearDoric() || nearWestBank() || nearFurnace()) {
                await walkNear(FALADOR_NORTH.x, FALADOR_NORTH.z, 4);
            }
            await openToward(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z);
            await walkNear(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z, 6);
            await walkNear(DWARVEN_STAIRS_DOWN.x, DWARVEN_STAIRS_DOWN.z, 3);
        }
        await openToward(DWARVEN_STAIRS_DOWN.x, DWARVEN_STAIRS_DOWN.z);
        await walkNear(DWARVEN_MINE_DOOR.x, DWARVEN_MINE_DOOR.z, 1);
        if (!(await climbStairs('down'))) {
            if (!(await climbGuildDown())) return false;
        }
    }
    await walkNear(GUILD_IRON.x, GUILD_IRON.z, 3);
    await sdk.scanNearbyLocs(12).catch(() => {});
    const ok = inUnderground() && distTo(GUILD_IRON.x, GUILD_IRON.z) <= 14;
    if (ok) session.noteProgress('location', 'guild iron');
    else session.noteFailure('mine_walk', `Still ${pos().x},${pos().z}`);
    return ok;
}

async function goToWestBank(): Promise<boolean> {
    await closeUi();
    if (!(await leaveWildyOrGuild())) return false;
    if (nearWestBank()) return true;
    intent('Walking to Falador west bank');
    session.setAnchor(FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z);
    if (inMine() || pos().z < 3280) await walkWaypoints(TO_FURNACE_FROM_MINE);
    else if (nearDoric()) await walkNear(FALADOR_NORTH.x, FALADOR_NORTH.z, 4);
    else if (distTo(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z) <= 30 || distTo(DWARVEN_STAIRS_DOWN.x, DWARVEN_STAIRS_DOWN.z) <= 20) {
        await walkNear(FALADOR_NORTH.x, FALADOR_NORTH.z, 6);
    } else if (pos().x > 3050 && pos().z > 3460) {
        await walkWaypoints(TO_DORIC_FROM_EDGE);
        await walkNear(FALADOR_NORTH.x, FALADOR_NORTH.z, 4);
    }
    await openToward(FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z);
    await walkNear(FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z, 2);
    return distTo(FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z) <= 8;
}

async function goToEastBank(): Promise<boolean> {
    await closeUi();
    if (!(await leaveWildyOrGuild())) return false;
    intent('Walking to Falador east bank');
    session.setAnchor(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z);
    if (inMine() || pos().z < 3280) {
        await walkWaypoints([
            { x: 3010, z: 3265 },
            { x: 3007, z: 3340 },
            FALADOR_EAST_BANK
        ]);
    } else if (nearWestBank() || nearFurnace() || nearDoric()) {
        await walkNear(FALADOR_NORTH.x, FALADOR_NORTH.z, 4);
        await walkNear(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z, 3);
    }
    await openToward(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z);
    await walkNear(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z, 2);
    return distTo(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z) <= 8;
}

async function openNearbyBank(): Promise<boolean> {
    await closeUi();
    if (bankReady()) return true;
    if (!nearAnyBank() && !nearWestBank()) {
        if (distTo(EDGEVILLE.x, EDGEVILLE.z) <= 20) await walkNear(EDGEVILLE.x, EDGEVILLE.z, 2);
        else if (!(await goToWestBank())) return false;
    }
    const opened = await bot.openBank();
    if (!opened.success) {
        const booth = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /bank booth/i.test(l.name) && (l.optionsWithIndex?.length ?? 0) > 0)
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (booth) await bot.interactLoc(booth, /use.quickly|bank/i);
    }
    await sdk.waitForCondition(() => bankReady(), 6_000).catch(() => {});
    if (!bankReady()) {
        session.noteFailure('bank_open', opened.message);
        return false;
    }
    return true;
}

async function depositJunk(): Promise<void> {
    for (;;) {
        const item = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && !keepItem(i.name));
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success) break;
    }
}

async function withdrawOne(pattern: RegExp): Promise<boolean> {
    if (sdk.findInventoryItem(pattern)) return true;
    const item = sdk.findBankItem(pattern);
    if (!item) return false;
    const r = await bot.withdrawItem(item, 1);
    return r.success || r.partial || !!sdk.findInventoryItem(pattern);
}

async function ensureTools(): Promise<boolean> {
    if (hasPickaxe() && hasHammer()) {
        const inv = sdk.findInventoryItem(PICKAXE);
        if (inv && !sdk.findEquipmentItem(PICKAXE)) await bot.equipItem(inv);
        return true;
    }
    if (!(await openNearbyBank())) return false;
    await depositJunk();
    if (!hasHammer()) await withdrawOne(HAMMER);
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
    if (!hasHammer()) session.noteFailure('no_hammer', 'No hammer in inv or bank');
    if (!hasPickaxe()) session.noteFailure('no_pickaxe', 'No pickaxe in inv, equipment, or bank');
    return hasPickaxe() && hasHammer();
}

function findFurnace() {
    return (
        sdk.findNearbyLoc(/furnace/i, { withOption: /smelt/i }) ??
        (sdk.getNearbyLocs() ?? []).find(
            (l) => /furnace/i.test(l.name) && l.optionsWithIndex.some((o) => /smelt/i.test(o.text))
        ) ??
        null
    );
}

async function clickSmelt10(make10: RegExp): Promise<boolean> {
    const dialog = sdk.getDialog();
    if (!dialog?.isOpen) return false;
    const clicked = await sdk.clickDialogByText(make10);
    if (clicked.success) return true;
    const opts = dialog.options ?? [];
    const hit = opts.find((o) => make10.test(o.text) || /smelt\s+10/i.test(o.text) || /^make\s+10$/i.test(o.text));
    if (hit) {
        await sdk.sendClickDialog(hit.index);
        return true;
    }
    const any = opts.find((o) => /smelt/i.test(o.text));
    if (any) {
        await sdk.sendClickDialog(any.index);
        return true;
    }
    return false;
}

async function smeltUntilEmpty(ore: RegExp, make10: RegExp, coalPerBar = 0): Promise<number> {
    const possible = () =>
        coalPerBar <= 0 ? count(ore) > 0 : Math.min(count(ore), Math.floor(count(COAL) / coalPerBar)) > 0;
    await closeUi();
    if (!possible()) return 0;
    if (!(await goToFurnace())) return 0;
    const beforeXp = smithXp();
    const oreBefore = count(ore);
    let furnace = findFurnace();
    if (!furnace) {
        await sdk.scanNearbyLocs(10).catch(() => {});
        furnace = findFurnace();
    }
    if (!furnace) {
        session.noteFailure('furnace', `No smeltable furnace @ ${pos().x},${pos().z}`);
        return 0;
    }
    const opened = await bot.interactLoc(furnace, /smelt/i);
    if (!opened.success) {
        const oreItem = sdk.findInventoryItem(ore);
        if (!oreItem) return 0;
        const use = await sdk.sendUseItemOnLoc(oreItem.slot, furnace.x, furnace.z, furnace.id);
        if (!use.success) {
            session.noteFailure('smelt', use.message);
            return 0;
        }
    }
    await sdk.waitForCondition((s) => s.dialog?.isOpen || smithXp() > beforeXp || count(ore) < oreBefore, 8_000).catch(
        () => {}
    );
    if (sdk.getDialog()?.isOpen) {
        if (!(await clickSmelt10(make10))) {
            log(`No Smelt 10: ${(sdk.getDialog()?.options ?? []).map((o) => o.text).join(' | ')}`);
        }
    }
    await sdk.waitForCondition(() => count(ore) < oreBefore || smithXp() > beforeXp || !possible(), 20_000).catch(() => {});
    let last = count(ore);
    while (possible()) {
        const prev = last;
        await sdk.waitForCondition(() => count(ore) < prev || !possible(), 10_000).catch(() => {});
        last = count(ore);
        if (last >= prev) break;
    }
    await closeUi();
    noteLevel();
    const used = oreBefore - count(ore);
    if (used > 0) {
        session.noteProgress('xp', 'smelt');
        log(`Smelted ${used} ore | Smithing ${smithing()} (${smithXp()} xp) @ ${pos().x},${pos().z}`);
    }
    return used;
}

async function smithBars(bar: RegExp, product: 'dagger' | 'knives'): Promise<number> {
    let made = 0;
    while (count(bar) > 0 && !session.isStopped()) {
        if (!hasHammer()) {
            await ensureTools();
            if (!hasHammer()) break;
        }
        if (!(await goToDoric())) break;
        const before = count(bar);
        const beforeXp = smithXp();
        const n = before;
        const option = n >= 10 ? 3 : n >= 5 ? 2 : 1;
        const spec = SMITH_UI[product];
        intent(`Smith ${n} ${product} at Doric`);
        const barItem = sdk.findInventoryItem(bar);
        let anvil = sdk.findNearbyLoc(/anvil/i);
        if (!anvil) {
            await sdk.scanNearbyLocs(8).catch(() => {});
            anvil = sdk.findNearbyLoc(/anvil/i);
        }
        if (barItem && anvil) {
            await sdk.sendUseItemOnLoc(barItem.slot, anvil.x, anvil.z, anvil.id);
            await sdk
                .waitForCondition((s) => s.interface?.isOpen && s.interface.interfaceId === 994, 5_000)
                .catch(() => {});
            if (sdk.getState()?.interface?.interfaceId === 994) {
                await sdk.sendClickComponentWithOption(spec.component, option, spec.slot);
            }
        } else {
            const r = await bot.smithAtAnvil(product, { barPattern: bar, timeout: 20_000 });
            if (!r.success) {
                session.noteFailure('smith', r.message);
                break;
            }
        }
        await sdk.waitForCondition(() => count(bar) < before || smithXp() > beforeXp, 18_000).catch(() => {});
        let last = count(bar);
        const expect = option === 3 ? 10 : option === 2 ? 5 : 1;
        const deadline = Date.now() + 50_000;
        while (Date.now() < deadline && count(bar) > Math.max(0, before - expect)) {
            const prev = last;
            await sdk.waitForCondition(() => count(bar) < prev, 8_000).catch(() => {});
            if (count(bar) >= prev) break;
            last = count(bar);
        }
        await closeUi();
        if (count(bar) >= before && smithXp() <= beforeXp) {
            const r = await bot.smithAtAnvil(product, { barPattern: bar, timeout: 20_000 });
            if (!r.success) {
                session.noteFailure('smith', r.message);
                break;
            }
        }
        const used = before - count(bar);
        if (used > 0) {
            made += used;
            session.noteProgress('xp', product);
            log(`Smithed ${used} ${product} | Smithing ${smithing()} (${smithXp()} xp)`);
        } else {
            break;
        }
        noteLevel();
        if (bar === IRON_BAR && smithing() >= STEEL_LEVEL) break;
    }
    return made;
}

function otherPlayers() {
    const me = username.toLowerCase();
    return (sdk.getNearbyPlayers() ?? []).filter((p) => (p.name ?? '').toLowerCase() !== me);
}

function crowd(x: number, z: number, radius = 1): number {
    return otherPlayers().filter((p) => Math.hypot((p.worldX ?? p.x) - x, (p.worldZ ?? p.z) - z) <= radius).length;
}

function rocks(rock: RegExp, camp: { x: number; z: number }, radius = 18) {
    return (sdk.getNearbyLocs() ?? []).filter(
        (l) =>
            rock.test(l.name) &&
            l.optionsWithIndex.some((o) => /^mine$/i.test(o.text)) &&
            l.reachable !== false &&
            Math.hypot(l.x - camp.x, l.z - camp.z) <= radius
    );
}

function findRock(rock: RegExp, camp: { x: number; z: number }) {
    const list = [...rocks(rock, camp)].sort(
        (a, b) =>
            crowd(a.x, a.z) - crowd(b.x, b.z) ||
            Math.hypot(a.x - camp.x, a.z - camp.z) - Math.hypot(b.x - camp.x, b.z - camp.z) ||
            (a.distance ?? 99) - (b.distance ?? 99)
    );
    return list.find((r) => crowd(r.x, r.z) === 0) ?? list[0] ?? null;
}

async function mineRock(rock: RegExp, camp: { x: number; z: number }, ore: RegExp): Promise<boolean> {
    await closeUi();
    if (bagFull()) return false;
    let target = findRock(rock, camp);
    if (!target) {
        await sdk.scanNearbyLocs(15).catch(() => {});
        target = findRock(rock, camp);
    }
    if (!target) {
        session.noteFailure('mine', `No live ${ore.source} @ ${pos().x},${pos().z}`);
        return false;
    }
    const before = count(ore);
    const xpBefore = miningXp();
    intent(`Mine ${target.name} @ ${target.x},${target.z}`);
    session.setAnchor(target.x, target.z);
    const r = await bot.interactLoc(target, /mine/i);
    await sdk
        .waitForCondition(
            (s) =>
                s.inventory.filter((i) => ore.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0) > before ||
                (s.skills.find((sk) => sk.name === 'Mining')?.experience ?? 0) > xpBefore ||
                s.inventory.filter((i) => (i.count ?? 0) > 0).length >= 28,
            18_000
        )
        .catch(() => {});
    await closeUi();
    if (count(ore) > before || miningXp() > xpBefore) {
        session.noteProgress('xp', 'mine');
        return true;
    }
    if (!r.success) session.noteFailure('mine', r.message);
    return false;
}

async function lootOre(ore: RegExp): Promise<boolean> {
    if (bagFull()) return false;
    let item = sdk.findGroundItem(ore, { reachable: true });
    if (!item) {
        await sdk.scanGroundItems(8).catch(() => {});
        item = sdk.findGroundItem(ore, { reachable: true });
    }
    if (!item || (item.distance ?? 99) > 8) return false;
    const before = occupiedSlots();
    await bot.pickupItem(item);
    await sdk.waitForCondition(() => occupiedSlots() > before, 5_000).catch(() => {});
    return occupiedSlots() > before;
}

async function eatIfNeeded(): Promise<void> {
    if (pos().hp >= 20 || pos().hp >= pos().maxHp - 2) return;
    const food = sdk
        .getInventory()
        .find((i) => isCookedFood(i.name) && i.optionsWithIndex.some((o) => /eat/i.test(o.text)));
    if (!food) return;
    await bot.eatFood(food);
}

async function mineIronBag(): Promise<void> {
    if (!(await goToGuildIron())) return;
    await session.setPhase('mine_iron');
    while (!bagFull() && !session.isStopped()) {
        await closeUi();
        await eatIfNeeded();
        await fleeScorpion();
        await lootOre(IRON);
        if (!(await mineRock(ROCK_IRON, GUILD_IRON, IRON))) await sdk.waitForTicks(2);
    }
    if (count(IRON) > 0) log(`Bag iron ${count(IRON)} | Mining trip ready`);
}

async function mineBronzeBag(): Promise<void> {
    if (!(await goToMine())) return;
    await session.setPhase('mine_bronze');
    await walkNear(RIMMINGTON_BRONZE.x, RIMMINGTON_BRONZE.z, 4);
    while (!bagFull() && !session.isStopped() && smithing() < IRON_SMELT) {
        await closeUi();
        await eatIfNeeded();
        const copper = count(COPPER);
        const tin = count(TIN);
        const wantTin = tin <= copper;
        await lootOre(wantTin ? TIN : COPPER);
        const rock = wantTin ? ROCK_TIN : ROCK_COPPER;
        const ore = wantTin ? TIN : COPPER;
        if (!(await mineRock(rock, RIMMINGTON_BRONZE, ore))) {
            const other = wantTin ? ROCK_COPPER : ROCK_TIN;
            const otherOre = wantTin ? COPPER : TIN;
            if (!(await mineRock(other, RIMMINGTON_BRONZE, otherOre))) await sdk.waitForTicks(2);
        }
        if (count(COPPER) > 0 && count(TIN) > 0 && occupiedSlots() >= 20) break;
    }
}

function bronzePairs(): number {
    return Math.min(count(COPPER), count(TIN));
}

async function withdrawBankOres(ore: RegExp, amount: number): Promise<boolean> {
    if (amount <= 0) return false;
    if (!(await openNearbyBank())) return false;
    await depositJunk();
    if (!hasHammer()) await withdrawOne(HAMMER);
    if (!hasPickaxe()) {
        const pick = sdk.findBankItem(/^rune pickaxe$/i) ?? sdk.findBankItem(PICKAXE);
        if (pick) await bot.withdrawItem(pick, 1);
    }
    const item = sdk.findBankItem(ore);
    if (!item) {
        await bot.closeBank();
        return false;
    }
    const r = await bot.withdrawItem(item, amount);
    await bot.closeBank();
    return count(ore) > 0 || r.success || r.partial;
}

function invBarsPossible(recipe: Premium): number {
    const ore = count(recipe.ore);
    return Math.min(ore, Math.floor(count(COAL) / recipe.coalPerBar));
}

let bankOre = { rune: 0, adamant: 0, coal: 0 };

function snapshotBankOres(): void {
    bankOre = {
        rune: bankCount(RUNE_ORE),
        adamant: bankCount(ADDY_ORE),
        coal: bankCount(COAL)
    };
}

function bankBarsPossible(recipe: Premium): number {
    const ore = recipe.name === 'rune' ? bankOre.rune : bankOre.adamant;
    if (bankReady()) {
        return Math.min(bankCount(recipe.ore), Math.floor(bankCount(COAL) / recipe.coalPerBar));
    }
    return Math.min(ore, Math.floor(bankOre.coal / recipe.coalPerBar));
}

function pickPremium(): Premium | null {
    for (const recipe of PREMIUM) {
        if (smithing() < recipe.level) continue;
        if (invBarsPossible(recipe) > 0 || bankBarsPossible(recipe) > 0) return recipe;
    }
    return null;
}

async function logPremiumStock(): Promise<void> {
    if (!bankReady() && !(await openNearbyBank())) return;
    snapshotBankOres();
    log(`Bank rune ${bankOre.rune} addy ${bankOre.adamant} coal ${bankOre.coal} | Smithing ${smithing()}`);
}

async function restockPremium(recipe: Premium): Promise<boolean> {
    if (invBarsPossible(recipe) >= 1) return true;
    if (!(await goToWestBank())) return false;
    if (!(await openNearbyBank())) return false;
    await depositJunk();
    for (const r of PREMIUM) {
        const bars = sdk.findInventoryItem(r.bar);
        if (bars) await bot.depositItem(bars, -1);
    }
    await logPremiumStock();
    if (smithing() < recipe.level || bankBarsPossible(recipe) < 1) {
        await bot.closeBank();
        return false;
    }
    const slots = 28 - occupiedSlots();
    const per = 1 + recipe.coalPerBar;
    const bars = Math.min(Math.floor(Math.max(slots, 0) / per), bankBarsPossible(recipe), 10);
    if (bars < 1) {
        await bot.closeBank();
        return false;
    }
    await bot.withdrawItem(recipe.ore, bars);
    await bot.withdrawItem(COAL, bars * recipe.coalPerBar);
    await bot.closeBank();
    return invBarsPossible(recipe) >= 1;
}

async function mineCoalFor(recipe: Premium): Promise<boolean> {
    log(`Need coal for ${recipe.name} — mining guild south coal`);
    await session.setPhase('mine_coal');
    if (!(await goToEastBank())) return false;
    if (!(await openNearbyBank())) return false;
    await depositJunk();
    await bot.closeBank();
    if (!(await climbGuildDown())) return false;
    await walkNear(GUILD_COAL.x, GUILD_COAL.z, 3);
    while (!bagFull() && !session.isStopped()) {
        await closeUi();
        await eatIfNeeded();
        await lootOre(COAL);
        if (!(await mineRock(ROCK_COAL, GUILD_COAL, COAL))) await sdk.waitForTicks(2);
    }
    if (!(await leaveGuild())) return false;
    if (!(await goToEastBank())) return false;
    if (!(await openNearbyBank())) return false;
    await depositJunk();
    snapshotBankOres();
    await bot.closeBank();
    log(`Banked coal trip | coal ${bankOre.coal} | Smithing ${smithing()}`);
    return true;
}

async function bankPremiumBars(): Promise<void> {
    const has = PREMIUM.some((r) => count(r.bar) > 0);
    if (!has) return;
    if (!(await goToWestBank())) return;
    if (!(await openNearbyBank())) return;
    for (const r of PREMIUM) {
        const item = sdk.findInventoryItem(r.bar);
        if (!item) continue;
        const n = count(r.bar);
        await bot.depositItem(item, -1);
        if (n > 0) log(`Banked ${n} ${r.name} bars`);
    }
    await bot.closeBank();
}

async function smeltPremiumLoop(): Promise<'done' | 'need_level' | 'need_coal'> {
    await session.setPhase('smelt_premium');
    if (!nearWestBank() && !nearAnyBank()) await goToWestBank();
    if (!(await openNearbyBank())) return 'need_coal';
    await logPremiumStock();
    await bot.closeBank();

    while (!session.isStopped()) {
        noteLevel();
        const recipe = pickPremium();
        if (!recipe) {
            if (!(await openNearbyBank())) return 'need_coal';
            snapshotBankOres();
            const runeOre = bankOre.rune + count(RUNE_ORE);
            const addyOre = bankOre.adamant + count(ADDY_ORE);
            const coal = bankOre.coal + count(COAL);
            const again = pickPremium();
            await bot.closeBank();
            if (again) {
                log(`Now smelting ${again.name}`);
                continue;
            }
            if (runeOre <= 0 && addyOre <= 0) return 'done';
            if (runeOre > 0 && smithing() < RUNE_SMELT && addyOre <= 0) return 'need_level';
            if ((runeOre > 0 || addyOre > 0) && coal < 6) return 'need_coal';
            return 'done';
        }
        if (invBarsPossible(recipe) < 1) {
            if (!(await restockPremium(recipe))) {
                const oreLeft =
                    (recipe.name === 'rune' ? bankOre.rune : bankOre.adamant) + count(recipe.ore);
                if (oreLeft > 0 && bankOre.coal < recipe.coalPerBar) return 'need_coal';
                continue;
            }
        }
        const used = await smeltUntilEmpty(recipe.ore, recipe.make10);
        if (used <= 0 && invBarsPossible(recipe) > 0) await sdk.waitForTicks(2);
        if (count(recipe.bar) > 0) await bankPremiumBars();
    }
    return 'done';
}

async function bronzeTick(): Promise<void> {
    if (count(BRONZE_BAR) > 0) {
        await session.setPhase('smith_bronze');
        await smithBars(BRONZE_BAR, bronzeProduct());
        return;
    }
    if (bronzePairs() > 0) {
        await session.setPhase('smelt_bronze');
        await smeltUntilEmpty(COPPER, /smelt\s+10.*bronze/i);
        return;
    }
    if (nearAnyBank() || occupiedSlots() >= 20) {
        if (await openNearbyBank()) {
            const copper = bankCount(COPPER);
            const tin = bankCount(TIN);
            const bars = bankCount(BRONZE_BAR);
            if (bars > 0) {
                await withdrawBankOres(BRONZE_BAR, Math.min(bars, 27));
                return;
            }
            const pairs = Math.min(copper, tin, 13);
            if (pairs > 0) {
                await depositJunk();
                await withdrawOne(HAMMER);
                const c = sdk.findBankItem(COPPER);
                const t = sdk.findBankItem(TIN);
                if (c) await bot.withdrawItem(c, pairs);
                if (t) await bot.withdrawItem(t, pairs);
                await bot.closeBank();
                return;
            }
            await bot.closeBank();
        }
    }
    await mineBronzeBag();
}

function steelPossible(): number {
    return Math.min(count(IRON), Math.floor(count(COAL) / 2));
}

async function bankSteelBars(): Promise<void> {
    if (count(STEEL_BAR) < 1) return;
    if (!(await goToWestBank())) return;
    if (!(await openNearbyBank())) return;
    const n = count(STEEL_BAR);
    const item = sdk.findInventoryItem(STEEL_BAR);
    if (item) await bot.depositItem(item, -1);
    log(`Banked ${n} steel bars | Smithing ${smithing()}`);
    session.noteProgress('bank', 'steel');
    await bot.closeBank();
}

async function restockSteel(): Promise<boolean> {
    if (steelPossible() >= 1) return true;
    if (!(await goToWestBank())) return false;
    if (!(await openNearbyBank())) return false;
    await depositJunk();
    const ironBank = bankCount(IRON) + count(IRON);
    const coalBank = bankCount(COAL) + count(COAL);
    const bars = Math.min(9, ironBank, Math.floor(coalBank / 2));
    if (bars < 1) {
        log(`Steel restock empty: iron ${ironBank} coal ${coalBank}`);
        await bot.closeBank();
        return false;
    }
    const needIron = Math.max(0, bars - count(IRON));
    const needCoal = Math.max(0, bars * 2 - count(COAL));
    if (needIron > 0) await bot.withdrawItem(IRON, needIron);
    if (needCoal > 0) await bot.withdrawItem(COAL, needCoal);
    await bot.closeBank();
    const ok = steelPossible() >= 1;
    if (ok) log(`Steel trip ${steelPossible()} bars (iron ${count(IRON)} coal ${count(COAL)})`);
    return ok;
}

async function steelTick(): Promise<void> {
    await session.setPhase('smelt_steel');
    if (count(STEEL_BAR) > 0 && steelPossible() < 1) {
        await bankSteelBars();
        return;
    }
    if (steelPossible() >= 1) {
        await smeltUntilEmpty(IRON, /smelt\s+10.*steel/i, 2);
        if (count(STEEL_BAR) > 0) await bankSteelBars();
        return;
    }
    if (count(IRON) > 0 || nearAnyBank() || occupiedSlots() >= 20) {
        if (await restockSteel()) return;
        if (await openNearbyBank()) {
            const ironBank = bankCount(IRON) + count(IRON);
            const coalBank = bankCount(COAL);
            await bot.closeBank();
            if (ironBank > 0 && coalBank < 2) {
                log('Need coal for steel — mining guild south coal');
                await mineCoalFor(PREMIUM[1]!);
                return;
            }
        }
    }
    await mineIronBag();
}

async function ironTick(): Promise<void> {
    if (smithing() >= STEEL_LEVEL) {
        await steelTick();
        return;
    }
    if (count(IRON_BAR) > 0) {
        await session.setPhase('smith_iron');
        await smithBars(IRON_BAR, ironProduct());
        return;
    }
    if (count(IRON) > 0) {
        await session.setPhase('smelt_iron');
        await smeltUntilEmpty(IRON, /smelt\s+10.*iron/i);
        return;
    }
    if (nearAnyBank() || occupiedSlots() >= 22) {
        if (await openNearbyBank()) {
            const bars = bankCount(IRON_BAR);
            const ore = bankCount(IRON);
            if (bars > 0) {
                await withdrawBankOres(IRON_BAR, Math.min(bars, 26));
                return;
            }
            if (ore > 0) {
                await withdrawBankOres(IRON, Math.min(ore, 26));
                return;
            }
            await bot.closeBank();
        }
    }
    await mineIronBag();
}

session.registerRecovery([
    {
        name: 'leave_wildy',
        run: async () => inWilderness(pos().x, pos().z) && (await leaveWildy())
    },
    {
        name: 'leave_guild',
        run: async () => inUnderground() && (await leaveUnderground())
    },
    {
        name: 'tools',
        run: async () => ensureTools()
    },
    {
        name: 'bank_junk',
        run: async () => {
            if (occupiedSlots() < 24) return false;
            return goToWestBank().then((ok) => ok && openNearbyBank()).then(async (ok) => {
                if (!ok) return false;
                await depositJunk();
                await bot.closeBank();
                return true;
            });
        }
    }
]);

try {
    lastSmith = smithing();
    await bot.skipTutorial();
    await closeUi();
    log(
        `Doric smithing start Smithing ${lastSmith} (${smithXp()} xp) @ ${pos().x},${pos().z} ` +
            `pick=${sdk.findEquipmentItem(PICKAXE)?.name ?? 'none'} hammer=${hasHammer()}`
    );

    for (let i = 0; i < 6 && !(hasPickaxe() && hasHammer()) && !session.isStopped(); i++) {
        await ensureTools();
    }
    if (!hasPickaxe() || !hasHammer()) {
        session.stop('no_tools', `pick=${hasPickaxe()} hammer=${hasHammer()}`);
    }

    while (!session.isStopped()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        await closeUi();
        if (pos().isDead) {
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }
        noteLevel();
        await eatIfNeeded();

        if (smithing() >= KNIFE_TARGET) {
            const result = await smeltPremiumLoop();
            if (result === 'done') {
                session.stop('smelt_done', `Smithing ${smithing()} — bank addy/rune smelted`);
                break;
            }
            if (result === 'need_coal') {
                const recipe =
                    pickPremium() ??
                    PREMIUM.find((r) => smithing() >= r.level && (count(r.ore) > 0 || bankCount(r.ore) > 0)) ??
                    PREMIUM[1]!;
                if (!(await mineCoalFor(recipe))) await sdk.waitForTicks(5);
                continue;
            }
            if (result === 'need_level') {
                log(`Runite in bank but Smithing ${smithing()} < ${RUNE_SMELT} — steel until 85`);
                await steelTick();
                continue;
            }
        }

        if (smithing() < IRON_SMELT) await bronzeTick();
        else await ironTick();
    }

    const stop = session.metrics().stopReason;
    if (stop) log(`stopped ${stop.code} @ ${stop.location.x},${stop.location.z}`);
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; lite client can stay logged in.');
    await sdk.disconnect();
}
