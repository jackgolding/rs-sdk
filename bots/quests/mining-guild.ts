/**
 * Falador Mining Guild — south mithril/coal.
 *
 *   bun bots/quests/mining-guild.ts {botname}
 *   bun bots/Jackpoo2/mining-guild.ts
 *
 * Banks at Falador east, climbs the guild ladder at (3019, 3339).
 * Default: south room mithril > coal (not north for adamant).
 * `--coal-only`: south coal piles. `--iron-only`: north iron.
 * `--north`: north room adamant > mithril > gold > coal (runs from scorpions, stays north).
 */
import {
    ActivitySession,
    BotSDK,
    deriveGatewayUrl,
    inMiningGuild as inMiningGuildCoords,
    inMiningGuildSouth
} from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { appendGrindLog } from '../../sdk/grind-log';

const FALADOR_EAST_BANK = { x: 3012, z: 3355 };
const GUILD_LADDER = { x: 3019, z: 3339 };
const GUILD_LADDER_DOWN = { x: 3019, z: 9739 };
/** Offset camps on the south mithril/coal cluster. Do not walk north for adamant. */
const SOUTH_CAMPS = [
    { name: 'mithril-south-east', x: 3050, z: 9738 },
    { name: 'mithril-south-west', x: 3040, z: 9734 },
    { name: 'mithril-south-mid', x: 3045, z: 9736 }
] as const;
/** Coal-only camps on the south-room east / west piles. */
const COAL_CAMPS = [
    { name: 'coal-east', x: 3051, z: 9735 },
    { name: 'coal-west', x: 3032, z: 9737 },
    { name: 'coal-mid', x: 3046, z: 9735 }
] as const;
/** North iron cluster (z 9765+). Used with --iron-only for jackthief steel smelting. */
const IRON_CAMPS = [
    { name: 'iron-north-east', x: 3045, z: 9774 },
    { name: 'iron-north-west', x: 3037, z: 9776 },
    { name: 'iron-north-mid', x: 3040, z: 9774 }
] as const;
/** North room addy / mith / gold / coal. King scorpions wander here. */
const NORTH_CAMPS = [
    { name: 'addy-west', x: 3033, z: 9763 },
    { name: 'north-mid', x: 3043, z: 9768 },
    { name: 'north-east', x: 3052, z: 9765 }
] as const;
const TO_FALADOR_EAST = [
    { x: 2964, z: 3381 },
    { x: 3012, z: 3355 }
];

const PICKAXE = /^(bronze|iron|steel|mithril|adamant|rune) pickaxe$/i;
const PICKAXE_TIERS = [
    { pattern: /^rune pickaxe$/i, level: 41, name: 'Rune pickaxe' },
    { pattern: /^adamant pickaxe$/i, level: 31, name: 'Adamant pickaxe' },
    { pattern: /^mithril pickaxe$/i, level: 21, name: 'Mithril pickaxe' },
    { pattern: /^steel pickaxe$/i, level: 6, name: 'Steel pickaxe' },
    { pattern: /^iron pickaxe$/i, level: 1, name: 'Iron pickaxe' },
    { pattern: /^bronze pickaxe$/i, level: 1, name: 'Bronze pickaxe' }
] as const;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
const ironOnly = argv.includes('--iron-only');
const coalOnly = argv.includes('--coal-only');
const northMode = argv.includes('--north');

const PRIORITY = (
    ironOnly
        ? [{ kind: 'iron', item: /^iron ore$/i, rock: /rocks iron ore/i, level: 15 }]
        : northMode
          ? [
                { kind: 'adamant', item: /^adamantite ore$/i, rock: /rocks adamant/i, level: 70 },
                { kind: 'mithril', item: /^mithril ore$/i, rock: /rocks mithril ore/i, level: 55 },
                { kind: 'gold', item: /^gold ore$/i, rock: /rocks gold ore/i, level: 40 },
                { kind: 'coal', item: /^coal$/i, rock: /rocks coal ore/i, level: 30 }
            ]
        : coalOnly
          ? [{ kind: 'coal', item: /^coal$/i, rock: /rocks coal ore/i, level: 30 }]
          : [
                { kind: 'mithril', item: /^mithril ore$/i, rock: /rocks mithril ore/i, level: 55 },
                { kind: 'coal', item: /^coal$/i, rock: /rocks coal ore/i, level: 30 },
                { kind: 'iron', item: /^iron ore$/i, rock: /rocks iron ore/i, level: 15 }
            ]
) as readonly { kind: string; item: RegExp; rock: RegExp; level: number }[];
const FLOOR_ORE = coalOnly
    ? /^coal$/i
    : /^(clay|coal|copper ore|tin ore|iron ore|silver ore|gold ore|mithril ore|adamantite ore|runite ore)$/i;
const FOOD_NAME = /shrimp|anchov|sardine|herring|trout|pike|salmon|tuna|lobster|swordfish|shark|bass|meat|chicken|bread|cake|wine|kebab|beer/i;
const KING_SCORPION = /king scorpion/i;
const HP_SOUTH = 20;

function isCookedFood(name: string): boolean {
    return FOOD_NAME.test(name) && !/^raw |^burnt /i.test(name);
}

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/mining-guild.ts {botname}`);
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

function workCamps() {
    return ironOnly ? IRON_CAMPS : northMode ? NORTH_CAMPS : coalOnly ? COAL_CAMPS : SOUTH_CAMPS;
}

function campIndex(): number {
    const named: Record<string, number> = {
        Jackpoo2: 0,
        Jackpoo4: 1,
        Jackpoo5: 2,
        Jackthief: 0,
        jackthief: 0
    };
    const camps = workCamps();
    return named[username] ?? [...username].reduce((h, c) => h + c.charCodeAt(0), 0) % camps.length;
}

function assignedCamp() {
    return workCamps()[campIndex()]!;
}

function homeCamp() {
    return assignedCamp();
}

console.log('Warming pathfinder...');
initPathfinding();

function writeGrindLog(line: string): void {
    if (!northMode && !/\sLOG coal \d+(?: \(×\d+\))?$/.test(line)) return;
    console.log(line);
    try {
        appendGrindLog(GRIND_LOG, line);
    } catch {
        /* ignore */
    }
}

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
    name: 'mining-guild',
    grindLogPath: GRIND_LOG,
    maxRecoveryTactics: 8,
    writeLog: writeGrindLog
});

let lastLoggedMine = 0;
const banked = { mithril: 0, coal: 0, iron: 0, adamant: 0, gold: 0 };

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
        isDead: p?.isDead ?? false,
        inCombat: p?.combat?.inCombat ?? false
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

function oreSlots(): number {
    return PRIORITY.reduce((n, t) => n + count(t.item), 0);
}

function shouldBank(): boolean {
    return bagFull() || (oreSlots() > 0 && occupiedSlots() >= 27 && !inGuild());
}

function inGuild(): boolean {
    const p = pos();
    return inMiningGuildCoords(p.x, p.z);
}

function inSouthRoom(): boolean {
    const p = pos();
    return inMiningGuildSouth(p.x, p.z);
}

function inIronRoom(x: number, z: number): boolean {
    return inMiningGuildCoords(x, z) && z >= 9765;
}

function inNorthRoom(x = pos().x, z = pos().z): boolean {
    return inMiningGuildCoords(x, z) && z > 9750;
}

function inWorkRoom(): boolean {
    const p = pos();
    if (ironOnly) return inIronRoom(p.x, p.z);
    if (northMode) return inNorthRoom(p.x, p.z);
    return inSouthRoom();
}

function inWorkZone(x: number, z: number): boolean {
    if (ironOnly) return inMiningGuildCoords(x, z);
    if (northMode) return inNorthRoom(x, z);
    return inMiningGuildSouth(x, z);
}

function campRadius(): number {
    return northMode ? 18 : 12;
}

function oreSnapshot(): string {
    return PRIORITY.map((t) => `${t.kind} ${count(t.item)}`).join(' ');
}

async function closeUi(): Promise<void> {
    const dialog = sdk.getDialog();
    if (dialog?.isOpen) {
        const decline = dialog.options?.find((o) => /no thank you|i'?m not interested|never mind/i.test(o.text));
        if (decline) {
            await sdk.sendClickDialog(decline.index);
            await sdk.waitForTicks(1);
        } else if (dialog.options?.every((o) => /click here to continue|continue/i.test(o.text)) || (dialog.options?.length ?? 0) <= 1) {
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
        if (distTo(p.x, p.z) <= 8) continue;
        if (Math.hypot(dest.x - p.x, dest.z - p.z) >= distTo(dest.x, dest.z) - 4) continue;
        await walkNear(p.x, p.z, 6);
    }
    if (distTo(dest.x, dest.z) > 6) await walkNear(dest.x, dest.z, 4);
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

async function climbGuild(want: 'up' | 'down'): Promise<boolean> {
    const before = inGuild();
    const target = want === 'down' ? GUILD_LADDER : GUILD_LADDER_DOWN;
    if (distTo(target.x, target.z) > 6) {
        await openToward(target.x, target.z);
        await walkNear(target.x, target.z, 2);
    }
    let ladder = findLadder(want);
    if (!ladder) {
        await sdk.scanNearbyLocs(8).catch(() => {});
        ladder = findLadder(want);
    }
    if (!ladder) {
        session.noteFailure('climb', `No ${want} ladder @ ${pos().x},${pos().z}`);
        return false;
    }
    intent(`Climb ${want} ${ladder.name} @ ${ladder.x},${ladder.z}`);
    const opt = want === 'up' ? /climb-up|climb.up/i : /climb-down|climb.down/i;
    const match = ladder.optionsWithIndex.find((o) => opt.test(o.text));
    if ((ladder.distance ?? 99) > 2) await walkNear(ladder.x, ladder.z, 1);
    if (match && (ladder.distance ?? 99) <= 2) {
        await sdk.sendInteractLoc(ladder.x, ladder.z, ladder.id, match.opIndex);
    } else {
        await bot.interactLoc(ladder, opt);
    }
    await sdk.waitForCondition(() => inGuild() !== before, 10_000).catch(() => {});
    await closeUi();
    const ok = inGuild() !== before;
    if (!ok) session.noteFailure('climb', `Still ${inGuild() ? 'in' : 'out of'} guild`);
    return ok;
}

async function goToBank(): Promise<boolean> {
    await closeUi();
    if (inGuild() && !(await climbGuild('up'))) return false;
    if (pos().z > 6400) return false;
    intent('Walking to Falador east bank');
    session.setAnchor(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z);
    if (distTo(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z) > 20) {
        if (pos().z < 3320 && pos().x > 3080) {
            await walkWaypoints([
                { x: 3080, z: 3420 },
                { x: 3012, z: 3355 }
            ]);
        } else if (pos().z > 3400 || pos().x < 2980) await walkWaypoints(TO_FALADOR_EAST);
    }
    await openToward(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z);
    await walkNear(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z, 2);
    return distTo(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z) <= 8;
}

async function ensurePickaxe(): Promise<boolean> {
    if (hasPickaxe()) return true;
    intent('Withdraw pickaxe from nearest bank');
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
    await ensureCombatPickaxe();
    await ensureDefensiveStyle();
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
    const before = {
        mithril: count(/^mithril ore$/i),
        coal: count(/^coal$/i),
        iron: count(/^iron ore$/i),
        adamant: count(/^adamantite ore$/i),
        gold: count(/^gold ore$/i)
    };
    for (;;) {
        const item = sdk.getInventory().find((i) => (i.count ?? 0) > 0);
        if (!item) break;
        const r = await bot.depositItem(item, -1);
        if (!r.success) break;
    }
    const equippedRune = sdk.findEquipmentItem(/^rune pickaxe$/i);
    if (!equippedRune) {
        const pick =
            sdk.findBankItem(/^rune pickaxe$/i) ??
            sdk.findBankItem(/^adamant pickaxe$/i) ??
            sdk.findBankItem(PICKAXE);
        if (pick) await bot.withdrawItem(pick, 1);
    }
    await sdk.waitForTicks(1);
    await sdk
        .waitForCondition(
            (s) => s.bank?.isOpen === true && (s.bank.items?.length ?? 0) > 0,
            5_000
        )
        .catch(() => {});
    const bankCoal = sdk.findBankItem(/^coal$/i)?.count ?? 0;
    await bot.closeBank();
    const inv = sdk.findInventoryItem(/^rune pickaxe$/i) ?? sdk.findInventoryItem(PICKAXE);
    if (inv && !sdk.findEquipmentItem(PICKAXE)) await bot.equipItem(inv);
    await ensureCombatPickaxe();
    await ensureDefensiveStyle();
    const deposited =
        before.mithril + before.coal + before.iron + before.adamant + before.gold - oreSlots();
    banked.mithril += before.mithril;
    banked.coal += before.coal;
    banked.iron += before.iron;
    banked.adamant += before.adamant;
    banked.gold += before.gold;
    if (deposited > 0) session.recordTrip(deposited);
    session.noteProgress('bank', 'falador east');
    if (northMode) {
        log(
            `banked addy ${banked.adamant} mith ${banked.mithril} gold ${banked.gold} coal ${banked.coal}`
        );
    } else {
        log(`coal ${bankCoal}`);
    }
    return occupiedSlots() < 27;
}

async function enterGuild(): Promise<boolean> {
    if (inGuild()) return true;
    if (session.metrics().phase !== 'enter') await session.setPhase('enter');
    session.setAnchor(GUILD_LADDER.x, GUILD_LADDER.z);
    if (distTo(GUILD_LADDER.x, GUILD_LADDER.z) > 8) {
        if (distTo(FALADOR_EAST_BANK.x, FALADOR_EAST_BANK.z) > 30 && pos().z > 3400) {
            await walkWaypoints(TO_FALADOR_EAST);
        }
        await openToward(GUILD_LADDER.x, GUILD_LADDER.z);
        await walkNear(GUILD_LADDER.x, GUILD_LADDER.z, 2);
    }
    const ok = await climbGuild('down');
    if (ok) {
        session.noteProgress('location', 'mining guild');
        await goHomeCamp();
    }
    return ok;
}

function hasRunePickaxe(): boolean {
    return !!(sdk.findInventoryItem(/^rune pickaxe$/i) || sdk.findEquipmentItem(/^rune pickaxe$/i));
}

async function ensureCombatPickaxe(): Promise<boolean> {
    const equipped = sdk.findEquipmentItem(/^rune pickaxe$/i);
    if (equipped) return true;
    const rune = sdk.findInventoryItem(/^rune pickaxe$/i);
    if (rune) {
        await bot.equipItem(rune);
        return !!sdk.findEquipmentItem(/^rune pickaxe$/i);
    }
    const inv = sdk.findInventoryItem(PICKAXE);
    if (inv && !sdk.findEquipmentItem(PICKAXE)) await bot.equipItem(inv);
    return hasPickaxe();
}

async function ensureDefensiveStyle(): Promise<void> {
    const cs = sdk.getState()?.combatStyle;
    if (!cs?.known) return;
    const def = cs.styles.find((s) => s.type === 'Defensive');
    if (!def || cs.currentStyle === def.index) return;
    await sdk.sendSetCombatStyle(def.index);
    await sdk
        .waitForCondition((s) => s.combatStyle?.currentStyle === def.index, 3_000)
        .catch(() => {});
}

function fightingScorpion(): boolean {
    const n = combatNpc();
    return !!n && /scorpion/i.test(n.name);
}

function scorpionNear(x: number, z: number, radius = 8): boolean {
    return (sdk.getNearbyNpcs() ?? []).some(
        (n) => /scorpion/i.test(n.name) && Math.hypot(n.x - x, n.z - z) <= radius
    );
}

function kingThreat(): boolean {
    if (fightingKing() || (northMode && fightingScorpion())) return true;
    const king = nearbyKingScorpion();
    if (!king) return false;
    return (king.distance ?? 99) <= (northMode ? 7 : 12);
}

function nearbyKingScorpion() {
    return (
        (sdk.getNearbyNpcs() ?? [])
            .filter((n) => KING_SCORPION.test(n.name))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null
    );
}

function combatNpc() {
    const c = sdk.getState()?.player?.combat;
    if (!c?.inCombat || c.targetType !== 'npc' || c.targetIndex < 0) return null;
    return sdk.getNearbyNpc(c.targetIndex);
}

function fightingKing(): boolean {
    const n = combatNpc();
    return !!n && KING_SCORPION.test(n.name);
}

function otherPlayers() {
    const me = username.toLowerCase();
    return (sdk.getNearbyPlayers() ?? []).filter((p) => (p.name ?? '').toLowerCase() !== me);
}

function crowd(x: number, z: number, radius = 2): number {
    return otherPlayers().filter((p) => Math.hypot((p.worldX ?? p.x) - x, (p.worldZ ?? p.z) - z) <= radius).length;
}

function rocksOf(tier: (typeof PRIORITY)[number]) {
    return (sdk.getNearbyLocs() ?? []).filter(
        (l) =>
            tier.rock.test(l.name) &&
            l.optionsWithIndex.some((o) => /^mine$/i.test(o.text)) &&
            l.reachable !== false &&
            inWorkZone(l.x, l.z)
    );
}

function findPriorityRock() {
    const lvl = mining();
    const home = homeCamp();
    for (const tier of PRIORITY) {
        if (lvl < tier.level) continue;
        const rocks = [...rocksOf(tier)].sort(
            (a, b) =>
                (northMode ? Number(scorpionNear(a.x, a.z)) - Number(scorpionNear(b.x, b.z)) : 0) ||
                crowd(a.x, a.z) - crowd(b.x, b.z) ||
                Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z) ||
                (a.distance ?? 99) - (b.distance ?? 99)
        );
        if (!rocks.length) continue;
        const free = rocks.find((r) => crowd(r.x, r.z) === 0);
        if (free) return { rock: free, tier };
    }
    return null;
}

async function goHomeCamp(): Promise<void> {
    if (!inGuild()) return;
    const home = homeCamp();
    if (distTo(home.x, home.z) <= 6) return;
    intent(`Walking to ${home.name} camp @ ${home.x},${home.z}`);
    session.setAnchor(home.x, home.z);
    await walkNear(home.x, home.z, 3);
    await sdk.scanNearbyLocs(northMode ? 20 : 15).catch(() => {});
}

function hpLow(): boolean {
    return pos().hp < HP_SOUTH;
}

async function eatIfNeeded(): Promise<boolean> {
    if (!hpLow()) return false;
    const food = sdk.getInventory().find(
        (i) => isCookedFood(i.name) && i.optionsWithIndex.some((o) => /eat/i.test(o.text))
    );
    if (!food) return false;
    intent(`Eating ${food.name} (HP ${pos().hp}/${pos().maxHp})`);
    const before = pos().hp;
    await bot.eatFood(food);
    await sdk.waitForCondition((s) => (s.player?.hp ?? 0) > before, 4_000).catch(() => {});
    session.noteProgress('inventory', 'eat');
    return pos().hp > before;
}

async function retreatSouth(): Promise<boolean> {
    if (ironOnly || northMode || !inGuild() || inSouthRoom()) return false;
    const home = homeCamp();
    log(`Leaving north — south camp @ ${home.x},${home.z}`);
    intent(`Walk south @ ${home.x},${home.z}`);
    session.setAnchor(home.x, home.z);
    await walkNear(home.x, home.z, 3);
    return inSouthRoom() || distTo(home.x, home.z) <= 6;
}

async function fightKingScorpion(): Promise<boolean> {
    if (!kingThreat()) return false;
    const king = nearbyKingScorpion();
    if (!(await ensureCombatPickaxe())) return false;
    await ensureDefensiveStyle();

    const target = fightingKing() ? combatNpc() : king;
    if (!target) return false;

    log(
        `King scorpion${king ? ` @ ${king.x},${king.z} d${king.distance}` : ''} — fighting (defensive)`
    );
    intent(`Fight king scorpion @ ${target.x},${target.z}`);
    session.setAnchor(target.x, target.z);

    if (!fightingKing()) {
        const r = await bot.attack(target);
        if (!r.success) {
            session.noteFailure('combat', r.message);
            return false;
        }
    }

    await sdk
        .waitForCondition(
            (s) => {
                if (!s.player.combat.inCombat) return true;
                const n = sdk.getNearbyNpc(s.player.combat.targetIndex);
                return !n || !KING_SCORPION.test(n.name);
            },
            90_000
        )
        .catch(() => {});

    await closeUi();
    if (fightingKing()) return false;
    session.noteProgress('combat', 'king scorpion');
    return true;
}

async function fleeKingScorpion(): Promise<boolean> {
    const king = nearbyKingScorpion();
    if (!king && !fightingKing() && !(northMode && fightingScorpion())) return false;
    if (!northMode && king && (king.distance ?? 99) > 12 && inSouthRoom()) return false;
    if (northMode) {
        const kx = king?.x ?? pos().x;
        const kz = king?.z ?? pos().z;
        const dest = [...NORTH_CAMPS].sort(
            (a, b) => Math.hypot(b.x - kx, b.z - kz) - Math.hypot(a.x - kx, a.z - kz)
        )[0]!;
        log(
            `Scorpion${king ? ` @ ${king.x},${king.z} d${king.distance}` : ''} — running to ${dest.name}`
        );
        intent(`Run from scorpion to ${dest.x},${dest.z}`);
        session.setAnchor(dest.x, dest.z);
        await walkNear(dest.x, dest.z, 3);
        return true;
    }
    const home = homeCamp();
    log(
        `King scorpion${king ? ` @ ${king.x},${king.z} d${king.distance}` : ''} — running south`
    );
    intent(`Run from king scorpion to ${home.x},${home.z}`);
    session.setAnchor(home.x, home.z);
    await walkNear(home.x, home.z, 3);
    if (!inSouthRoom()) await walkNear(GUILD_LADDER_DOWN.x, GUILD_LADDER_DOWN.z, 3);
    return true;
}

function floorOre() {
    return (
        (sdk.getGroundItems() ?? [])
            .filter((g) => FLOOR_ORE.test(g.name) && g.reachable !== false && (g.distance ?? 99) <= 10 && inWorkZone(g.x, g.z))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null
    );
}

async function lootFloorOre(): Promise<boolean> {
    if (bagFull()) return false;
    let item = floorOre() ?? sdk.findGroundItem(FLOOR_ORE, { reachable: true });
    if (!item) {
        await sdk.scanGroundItems(8).catch(() => {});
        item = floorOre() ?? sdk.findGroundItem(FLOOR_ORE, { reachable: true });
    }
    if (!item || (item.distance ?? 99) > 10) return false;
    if (!inWorkZone(item.x, item.z)) return false;
    const before = occupiedSlots();
    intent(`Loot ${item.name} @ ${item.x},${item.z}`);
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
    if (!inGuild() || bagFull()) return false;
    const home = homeCamp();
    if (!inWorkRoom() || distTo(home.x, home.z) > campRadius()) await goHomeCamp();

    let found = findPriorityRock();
    if (!found) {
        await sdk.scanNearbyLocs(northMode ? 20 : 15).catch(() => {});
        found = findPriorityRock();
    }
    if (!found) {
        await goHomeCamp();
        found = findPriorityRock();
    }
    if (!found) {
        session.noteFailure('mine', `No live rocks @ ${pos().x},${pos().z} camp=${home.name}`);
        return false;
    }
    const { rock, tier } = found;
    const before = count(tier.item);
    const xpBefore = miningXp();
    intent(`Mine ${rock.name} @ ${rock.x},${rock.z}`);
    session.setAnchor(rock.x, rock.z);
    const r = await bot.interactLoc(rock, /mine/i);
    await sdk
        .waitForCondition(
            (s) =>
                s.inventory.filter((i) => tier.item.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0) > before ||
                (s.skills.find((sk) => sk.name === 'Mining')?.experience ?? 0) > xpBefore ||
                s.inventory.filter((i) => (i.count ?? 0) > 0).length >= 28 ||
                (s.nearbyNpcs ?? []).some((n) => KING_SCORPION.test(n.name) && (n.distance ?? 99) <= 10),
            18_000
        )
        .catch(() => {});
    await closeUi();
    if (count(tier.item) > before || miningXp() > xpBefore) {
        session.noteProgress('xp', tier.kind);
        return true;
    }
    if (!r.success) session.noteFailure('mine', r.message);
    await sdk.waitForTicks(1);
    return false;
}

session.registerRecovery([
    {
        name: 'climb_up_if_full',
        run: async () => {
            if (!inGuild() || !shouldBank()) return false;
            return climbGuild('up');
        }
    },
    {
        name: 'bank_if_full',
        run: async () => {
            if (!shouldBank() && occupiedSlots() < 20) return false;
            return bankOres();
        }
    },
    {
        name: 'enter_guild',
        run: async () => {
            if (inGuild() || shouldBank()) return false;
            return enterGuild();
        }
    },
    {
        name: 'walk_camp',
        run: async () => {
            if (!inGuild() || shouldBank()) return false;
            await goHomeCamp();
            return !!findPriorityRock();
        }
    }
]);

try {
    lastLoggedMine = mining();
    await bot.skipTutorial();
    await closeUi();

    if (mining() < 60) {
        session.stop('mining_level', `Mining ${mining()} — guild needs 60`);
    }

    for (let prep = 0; prep < 20 && !hasPickaxe() && !session.isStopped(); prep++) {
        if (await ensurePickaxe()) break;
        await bankOres();
        await sdk.waitForTicks(2);
    }
    if (!hasPickaxe() && !session.isStopped()) {
        session.stop('no_pickaxe', 'No pickaxe after local + Falador bank');
    }

    await ensureCombatPickaxe();
    await ensureDefensiveStyle();
    if (!session.isStopped()) await bankOres();

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
        if (hpLow()) await eatIfNeeded();
        if (kingThreat()) {
            if (ironOnly) await fightKingScorpion();
            else await fleeKingScorpion();
            continue;
        }
        if (inGuild() && !inWorkRoom()) {
            if (ironOnly || northMode) await goHomeCamp();
            else await retreatSouth();
            continue;
        }
        await lootFloorOre();
        if (mining() !== lastLoggedMine) {
            log(`LEVEL UP Mining ${mining()}`);
            lastLoggedMine = mining();
        }

        if (!inGuild()) {
            const extra = sdk.getInventory().some((i) => (i.count ?? 0) > 0);
            if (extra || shouldBank()) {
                await bankOres();
                continue;
            }
        }

        if (shouldBank()) {
            if (inGuild()) await climbGuild('up');
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

        if (!inGuild()) {
            await enterGuild();
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
