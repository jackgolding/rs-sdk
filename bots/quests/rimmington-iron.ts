/**
 * Rimmington iron → Falador east bank.
 *
 *   bun bots/quests/rimmington-iron.ts {botname}
 *   bun bots/Jackpoo4/rimmington-iron.ts
 *
 * Mines the SE Rimmington iron cluster (~2969, 3240) and banks at
 * Falador east (3012, 3355). Wilderness exits use sendWalk — walkTo
 * will not path north of the Edgeville ditch.
 */
import {
    ActivitySession,
    BotSDK,
    deriveGatewayUrl,
    inMiningGuild as inMiningGuildCoords
} from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { installGracefulShutdown } from '../../sdk/runner';

const FALADOR_EAST_BANK = { x: 3012, z: 3355 };
const MINE = { x: 2969, z: 3240 };
const DITCH_NORTH = { x: 3088, z: 3525 };
const DITCH_SOUTH = { x: 3088, z: 3518 };
const GUILD_LADDER_DOWN = { x: 3019, z: 9739 };

/** East of Falador, then in from the north so we skip the castle and mining guild. */
const EAST_BANK_NORTH = { x: 3012, z: 3372 };
const TO_BANK_OLD = [
    { x: 3010, z: 3265 },
    { x: 3060, z: 3305 },
    { x: 3065, z: 3370 },
    { x: 3012, z: 3372 },
    { x: 3012, z: 3355 }
];
/** Shortcut via Falador south-east (3007, 3340). */
const TO_BANK = [
    { x: 3010, z: 3265 },
    { x: 3007, z: 3340 },
    { x: 3012, z: 3355 }
];
const TO_BANK_SHORTCUT = TO_BANK;
const TO_MINE = [
    { x: 3007, z: 3340 },
    { x: 3010, z: 3265 },
    { x: 2969, z: 3240 }
];
const TO_BANK_FROM_LUMBRIDGE = [
    { x: 3160, z: 3250 },
    { x: 3088, z: 3250 },
    { x: 3065, z: 3370 },
    { x: 3012, z: 3372 },
    { x: 3012, z: 3355 }
];
const OUT_OF_WILDY = [
    { x: 3110, z: 3700 },
    { x: 3102, z: 3610 },
    { x: 3088, z: 3525 }
];

const PICKAXE = /^(bronze|iron|steel|mithril|adamant|rune) pickaxe$/i;
const IRON = /^iron ore$/i;
const ROCK = /rocks iron ore/i;
const FOOD_NAME =
    /shrimp|anchov|sardine|herring|trout|pike|salmon|tuna|lobster|swordfish|shark|bass|meat|chicken|bread|cake|wine|kebab|beer/i;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const bench = argv.includes('--bench');

function isCookedFood(name: string): boolean {
    return FOOD_NAME.test(name) && !/^raw |^burnt /i.test(name);
}

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/rimmington-iron.ts {botname}`);
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
    name: 'rimmington-iron',
    grindLogPath: GRIND_LOG,
    maxRecoveryTactics: 8
});

installGracefulShutdown();

let bankedIron = 0;

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
    return Math.hypot(pos().x - x, pos().z - z);
}

function mining(): number {
    return sdk.getSkill('Mining')?.baseLevel ?? 1;
}

function miningXp(): number {
    return sdk.getSkill('Mining')?.experience ?? 0;
}

function occupiedSlots(): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

function count(pattern: RegExp): number {
    return sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
}

function hasPickaxe(): boolean {
    return !!(sdk.findInventoryItem(PICKAXE) || sdk.findEquipmentItem(PICKAXE));
}

function bagFull(): boolean {
    return occupiedSlots() >= 28;
}

function inMine(): boolean {
    const p = pos();
    return p.level === 0 && p.x >= 2964 && p.x <= 2986 && p.z >= 3228 && p.z <= 3248;
}

function inGuild(): boolean {
    return inMiningGuildCoords(pos().x, pos().z);
}

function northOfDitch(): boolean {
    return pos().z >= 3520 && pos().z < 6400;
}

function junkSlots(): number {
    return sdk
        .getInventory()
        .filter((i) => (i.count ?? 0) > 0 && !PICKAXE.test(i.name) && !IRON.test(i.name)).length;
}

function shouldBank(): boolean {
    if (bagFull()) return true;
    if (count(IRON) > 0 && occupiedSlots() >= 27 && !inMine()) return true;
    if (!inMine() && junkSlots() > 0 && distTo(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z) <= 40) return true;
    return false;
}

/** Only reroute north when inside the castle or the mining-guild building. */
function southOfEastBank(): boolean {
    const p = pos();
    const inCastle = p.x < 2995 && p.z >= 3325 && p.z < 3360;
    const inGuildBuilding = p.x >= 3014 && p.x <= 3028 && p.z >= 3332 && p.z <= 3346;
    return inCastle || inGuildBuilding;
}

async function closeUi(): Promise<void> {
    const dialog = sdk.getDialog();
    if (dialog?.isOpen) {
        const decline = dialog.options?.find((o) => /no thank you|i'?m not interested|never mind/i.test(o.text));
        if (decline) {
            await sdk.sendClickDialog(decline.index);
            await sdk.waitForTicks(1);
        } else if (
            dialog.options?.every((o) => /click here to continue|continue/i.test(o.text)) ||
            (dialog.options?.length ?? 0) <= 1
        ) {
            await sdk.sendClickDialog(dialog.options?.[0]?.index ?? 0);
            await sdk.waitForTicks(1);
        }
    }
    if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
        await bot.closeInterface();
    }
    await bot.dismissBlockingUI();
}

async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
    if (distTo(x, z) <= tolerance) return true;
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
    await sdk.waitForTicks(1);
}

async function leaveWildy(): Promise<boolean> {
    if (!northOfDitch()) return true;
    intent('Leaving wilderness via Edgeville ditch');
    session.setAnchor(DITCH_SOUTH.x, DITCH_SOUTH.z);
    for (const p of OUT_OF_WILDY) {
        if (!northOfDitch()) break;
        if (p.z > pos().z + 8) continue;
        await sendWalkTo(p.x, p.z, 8);
    }
    await sendWalkTo(DITCH_NORTH.x, DITCH_NORTH.z, 6);
    await sdk.sendWalk(DITCH_SOUTH.x, DITCH_SOUTH.z, true);
    await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) < 3520 || s.player?.isDead === true, 12_000).catch(() => {});
    if (northOfDitch()) {
        await sdk.sendWalk(DITCH_SOUTH.x, DITCH_SOUTH.z, true);
        await sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) < 3520 || s.player?.isDead === true, 8_000).catch(() => {});
    }
    const ok = !northOfDitch();
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
    await closeUi();
    const ok = !inGuild();
    if (!ok) session.noteFailure('climb', 'Still in Mining Guild');
    return ok;
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

async function goToBank(): Promise<boolean> {
    await closeUi();
    if (northOfDitch() && !(await leaveWildy())) return false;
    if (inGuild() && !(await leaveGuild())) return false;
    if (pos().z > 6400) return false;
    intent('Walking to Falador east bank');
    session.setAnchor(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z);
    if (distTo(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z) > 8) {
        if (pos().x > 3120 && pos().z < 3300) await walkWaypoints(TO_BANK_FROM_LUMBRIDGE);
        else if (southOfEastBank() || distTo(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z) > 20) {
            await walkWaypoints(TO_BANK);
        }
        if (southOfEastBank()) {
            intent('Approach east bank from the north');
            await openToward(EAST_BANK_NORTH.x, EAST_BANK_NORTH.z);
            await walkNear(EAST_BANK_NORTH.x, EAST_BANK_NORTH.z, 4);
        }
    }
    await openToward(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z);
    await walkNear(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z, 2);
    return distTo(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z) <= 8;
}

async function goToMine(): Promise<boolean> {
    await closeUi();
    if (northOfDitch() && !(await leaveWildy())) return false;
    if (inGuild() && !(await leaveGuild())) return false;
    if (inMine()) return true;
    intent('Walking to Rimmington iron');
    session.setAnchor(MINE.x, MINE.z);
    if (distTo(MINE.x, MINE.z) > 16) {
        if (pos().x > 3120 && pos().z < 3300) {
            await walkWaypoints(TO_BANK_FROM_LUMBRIDGE);
            if (shouldBank() || !hasPickaxe()) return bankOres();
        }
        await walkWaypoints(TO_MINE);
    }
    await walkNear(MINE.x, MINE.z, 3);
    await sdk.scanNearbyLocs(12).catch(() => {});
    const ok = inMine() || distTo(MINE.x, MINE.z) <= 8;
    if (ok) session.noteProgress('location', 'rimmington iron');
    else session.noteFailure('mine_walk', `Still ${pos().x},${pos().z}`);
    return ok;
}

async function ensurePickaxe(): Promise<boolean> {
    if (hasPickaxe()) return true;
    intent('Withdraw pickaxe');
    if (sdk.getState()?.bank?.isOpen || (await bot.openBank()).success) {
        const pick =
            sdk.findBankItem(/^rune pickaxe$/i) ??
            sdk.findBankItem(/^adamant pickaxe$/i) ??
            sdk.findBankItem(PICKAXE);
        if (pick) await bot.withdrawItem(pick, 1);
        await bot.closeBank();
    }
    const inv = sdk.findInventoryItem(PICKAXE);
    if (inv && !sdk.findEquipmentItem(PICKAXE)) await bot.equipItem(inv);
    return hasPickaxe();
}

async function bankOres(): Promise<boolean> {
    if (session.metrics().phase !== 'deposit') await session.setPhase('deposit');
    if (!(await goToBank())) {
        session.noteFailure('bank_walk', 'Could not reach Falador east');
        return false;
    }
    if (!(sdk.getState()?.bank?.isOpen || (await bot.openBank()).success)) {
        session.noteFailure('bank_open', 'Falador east bank open failed');
        return false;
    }
    const before = count(IRON);
    for (const item of sdk.getInventory()) {
        if (IRON.test(item.name) && (item.count ?? 0) > 0) session.recordGain(item.name, item.count ?? 1);
    }
    for (;;) {
        const item = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && !PICKAXE.test(i.name));
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
    session.captureBankStock();
    await bot.closeBank();
    const inv = sdk.findInventoryItem(PICKAXE);
    if (inv && !sdk.findEquipmentItem(PICKAXE)) await bot.equipItem(inv);
    const deposited = before - count(IRON);
    bankedIron += before;
    if (deposited > 0) session.recordTrip(deposited);
    session.noteProgress('bank', 'falador east');
    log(
        `Banked ${deposited} iron | trip ${session.metrics().trips} total ${session.metrics().itemsBanked} | ` +
            `iron ${bankedIron} | Mining ${mining()} (${miningXp()} xp)`
    );
    return occupiedSlots() < 27;
}

function otherPlayers() {
    const me = username.toLowerCase();
    return (sdk.getNearbyPlayers() ?? []).filter((p) => (p.name ?? '').toLowerCase() !== me);
}

function crowd(x: number, z: number, radius = 1): number {
    return otherPlayers().filter((p) => Math.hypot((p.worldX ?? p.x) - x, (p.worldZ ?? p.z) - z) <= radius).length;
}

function ironRocks() {
    return (sdk.getNearbyLocs() ?? []).filter(
        (l) =>
            ROCK.test(l.name) &&
            l.optionsWithIndex.some((o) => /^mine$/i.test(o.text)) &&
            l.reachable !== false &&
            Math.hypot(l.x - MINE.x, l.z - MINE.z) <= 18
    );
}

function findIronRock() {
    const rocks = [...ironRocks()].sort(
        (a, b) =>
            crowd(a.x, a.z) - crowd(b.x, b.z) ||
            Math.hypot(a.x - MINE.x, a.z - MINE.z) - Math.hypot(b.x - MINE.x, b.z - MINE.z) ||
            (a.distance ?? 99) - (b.distance ?? 99)
    );
    return rocks.find((r) => crowd(r.x, r.z) === 0) ?? rocks[0] ?? null;
}

function floorIron() {
    return (
        (sdk.getGroundItems() ?? [])
            .filter((g) => IRON.test(g.name) && g.reachable !== false && (g.distance ?? 99) <= 8)
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null
    );
}

async function lootIron(): Promise<boolean> {
    if (bagFull()) return false;
    let item = floorIron() ?? sdk.findGroundItem(IRON, { reachable: true });
    if (!item) {
        await sdk.scanGroundItems(8).catch(() => {});
        item = floorIron() ?? sdk.findGroundItem(IRON, { reachable: true });
    }
    if (!item || (item.distance ?? 99) > 8) return false;
    const before = occupiedSlots();
    intent(`Loot iron ore @ ${item.x},${item.z}`);
    const r = await bot.pickupItem(item);
    await sdk.waitForCondition(() => occupiedSlots() > before, 5_000).catch(() => {});
    if (occupiedSlots() > before) {
        session.noteProgress('inventory', 'loot');
        return true;
    }
    if (!r.success) session.noteFailure('loot', r.message);
    return false;
}

async function mineOne(): Promise<boolean> {
    await closeUi();
    if (!inMine() || bagFull()) return false;
    if (distTo(MINE.x, MINE.z) > 12) await walkNear(MINE.x, MINE.z, 3);

    let rock = findIronRock();
    if (!rock) {
        await sdk.scanNearbyLocs(15).catch(() => {});
        rock = findIronRock();
    }
    if (!rock) {
        session.noteFailure('mine', `No live iron @ ${pos().x},${pos().z}`);
        return false;
    }
    const before = count(IRON);
    const xpBefore = miningXp();
    intent(`Mine ${rock.name} @ ${rock.x},${rock.z}`);
    session.setAnchor(rock.x, rock.z);
    const r = await bot.interactLoc(rock, /mine/i);
    await sdk
        .waitForCondition(
            (s) =>
                s.inventory.filter((i) => IRON.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0) > before ||
                (s.skills.find((sk) => sk.name === 'Mining')?.experience ?? 0) > xpBefore ||
                s.inventory.filter((i) => (i.count ?? 0) > 0).length >= 28,
            18_000
        )
        .catch(() => {});
    await closeUi();
    if (count(IRON) > before || miningXp() > xpBefore) {
        session.noteProgress('xp', 'iron');
        return true;
    }
    if (!r.success) session.noteFailure('mine', r.message);
    await sdk.waitForTicks(1);
    return false;
}

async function eatIfNeeded(): Promise<boolean> {
    if (pos().hp >= 20 || pos().hp >= pos().maxHp - 2) return false;
    const food = sdk
        .getInventory()
        .find((i) => isCookedFood(i.name) && i.optionsWithIndex.some((o) => /eat/i.test(o.text)));
    if (!food) return false;
    intent(`Eating ${food.name} (HP ${pos().hp}/${pos().maxHp})`);
    const before = pos().hp;
    await bot.eatFood(food);
    await sdk.waitForCondition((s) => (s.player?.hp ?? 0) > before, 4_000).catch(() => {});
    return pos().hp > before;
}

function runEnergy(): number {
    return sdk.getState()?.player?.runEnergy ?? 0;
}

async function visitAll(points: { x: number; z: number }[], label: string): Promise<number> {
    const started = Date.now();
    const energy0 = runEnergy();
    log(`BENCH ${label} start @ ${pos().x},${pos().z} slots=${occupiedSlots()} energy=${energy0}`);
    for (const p of points) {
        intent(`Bench ${label} → ${p.x},${p.z}`);
        await walkNear(p.x, p.z, 3);
    }
    const ms = Date.now() - started;
    log(
        `BENCH ${label} mine→bank ${(ms / 1000).toFixed(1)}s energy ${energy0}→${runEnergy()} ` +
            `slots=${occupiedSlots()} end @ ${pos().x},${pos().z}`
    );
    return ms;
}

async function fillBag(): Promise<void> {
    if (!(await goToMine())) throw new Error('bench: could not reach mine');
    while (occupiedSlots() < 28 && !session.isStopped()) {
        await closeUi();
        await eatIfNeeded();
        await lootIron();
        await mineOne();
    }
}

async function runBench(): Promise<void> {
    log('BENCH start: old east loop vs shortcut 3007,3340 (full inv each way)');
    await fillBag();
    const oldMs = await visitAll(TO_BANK_OLD, 'old');
    await bankOres();
    await fillBag();
    const newMs = await visitAll(TO_BANK_SHORTCUT, 'new');
    await bankOres();
    log(
        `BENCH done old=${(oldMs / 1000).toFixed(1)}s new=${(newMs / 1000).toFixed(1)}s ` +
            `delta=${((oldMs - newMs) / 1000).toFixed(1)}s`
    );
    session.stop('bench_done', `old ${(oldMs / 1000).toFixed(1)}s vs new ${(newMs / 1000).toFixed(1)}s`);
}

session.registerRecovery([
    {
        name: 'leave_wildy',
        run: async () => northOfDitch() && (await leaveWildy())
    },
    {
        name: 'leave_guild',
        run: async () => inGuild() && (await leaveGuild())
    },
    {
        name: 'bank_if_full',
        run: async () => {
            if (!shouldBank() && occupiedSlots() < 20) return false;
            return bankOres();
        }
    },
    {
        name: 'walk_mine',
        run: async () => {
            if (shouldBank()) return false;
            return goToMine();
        }
    }
]);

try {
    await bot.skipTutorial();
    await closeUi();
    log(
        `Rimmington iron start Mining ${mining()} (${miningXp()} xp) @ ${pos().x},${pos().z} lv${pos().level} ` +
            `pick=${sdk.findEquipmentItem(PICKAXE)?.name ?? sdk.findInventoryItem(PICKAXE)?.name ?? 'none'} ` +
            `iron=${count(IRON)}`
    );

    for (let prep = 0; prep < 8 && !hasPickaxe() && !session.isStopped(); prep++) {
        if (await ensurePickaxe()) break;
        await bankOres();
        await sdk.waitForTicks(2);
    }
    if (!hasPickaxe() && !session.isStopped()) {
        session.stop('no_pickaxe', 'No pickaxe after Falador bank');
    }

    if (bench) {
        await runBench();
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
        await eatIfNeeded();
        await lootIron();

        if (northOfDitch()) {
            await leaveWildy();
            continue;
        }
        if (inGuild()) {
            await leaveGuild();
            continue;
        }

        if (shouldBank() || (!inMine() && occupiedSlots() >= 20 && count(IRON) > 0)) {
            await bankOres();
            continue;
        }

        if (!hasPickaxe()) {
            await bankOres();
            if (!hasPickaxe()) {
                session.stop('no_pickaxe', 'No pickaxe in inventory, equipment, or Falador east bank');
                break;
            }
        }

        if (!inMine()) {
            await goToMine();
            continue;
        }

        if (session.metrics().phase !== 'mine') await session.setPhase('mine');
        await mineOne();
    }

    const stop = session.metrics().stopReason;
    if (stop) log(`stopped ${stop.code} @ ${stop.location.x},${stop.location.z}`);
} catch (err) {
    console.error('Script error:', err);
    throw err;
} finally {
    console.log('Disconnecting SDK; browser client can stay open.');
    await sdk.disconnect();
}
