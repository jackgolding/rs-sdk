/**
 * Taverley dungeon blue-dragon scale spawns (m45_153). Hides in the room
 * while the spawns come back (30 ticks), then Falador-teleports a full
 * inventory to the bank.
 *
 * Falador teleport is Magic 37 (1 law, 1 water, air staff or 3 air).
 * Dusty key stays in the inventory. Jail key is only for Velrak's cell.
 *
 *   bun bots/quests/blue-dragon-scales.ts jackthief
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { Spells } from '../../sdk/spells';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { FALADOR_EAST_BANK, FALADOR_WEST_BANK } from './tiles';
import { closeUi, distTo, playerPos, walkNear, walkSendHops } from './movement';
import { installGracefulShutdown } from '../../sdk/runner';

/** Withdraw-5 is a real bank option. 4 and 100 open the X dialog, which stalls. */
const FOOD_COUNT = 5;
const WATER_STOCK = 100;
const LAW_STOCK = 50;
const MAGIC_TAB = 6;
const FALADOR_MAGIC = 37;

const LADDER = { x: 2884, z: 3397 };
const LADDER_UNDER = { x: 2884, z: 9798 };
/** East side of the dusty-key gate. The blue-dragon room is to the west. */
const GATE = { x: 2924, z: 9803 };
const GATE_OUTSIDE = { x: 2925, z: 9803 };
/** Inside the room, east of baby-blue wander. */
const HIDE = { x: 2923, z: 9804 };
const SCALES = [
    { x: 2902, z: 9806 },
    { x: 2905, z: 9801 },
    { x: 2906, z: 9796 },
    { x: 2908, z: 9805 },
    { x: 2910, z: 9809 }
];
const JAILER = { x: 2933, z: 9693 };
const JAIL_DOOR = { x: 2931, z: 9690 };
const VELRAK = { x: 2931, z: 9685 };
const ZAFF = { x: 3203, z: 3433 };
const AUBURY = { x: 3253, z: 3402 };
const MAGIC_SHOP = { x: 2595, z: 3087 };
const DUKE = { x: 3212, z: 3220 };

/** Ladder → north corridor → around the locked room → east side of the gate. */
const TO_GATE = [
    { x: 2884, z: 9827 },
    { x: 2896, z: 9830 },
    { x: 2921, z: 9821 },
    { x: 2931, z: 9824 },
    { x: 2937, z: 9810 },
    { x: 2941, z: 9802 },
    { x: 2951, z: 9776 },
    { x: 2944, z: 9774 },
    { x: 2935, z: 9760 },
    { x: 2923, z: 9761 },
    { x: 2930, z: 9774 },
    { x: 2932, z: 9783 },
    { x: 2930, z: 9801 },
    GATE_OUTSIDE
];

const TO_JAILER = [
    { x: 2884, z: 9827 },
    { x: 2896, z: 9830 },
    { x: 2921, z: 9821 },
    { x: 2931, z: 9824 },
    { x: 2937, z: 9810 },
    { x: 2941, z: 9802 },
    { x: 2951, z: 9776 },
    { x: 2944, z: 9774 },
    { x: 2935, z: 9758 },
    { x: 2924, z: 9748 },
    { x: 2909, z: 9725 },
    { x: 2907, z: 9696 },
    { x: 2922, z: 9694 },
    JAILER
];

const SCALE = /^blue dragon scale$/i;
const HIDE_ITEM = /^dragonhide$/i;
const DUSTY = /^dusty key$/i;
const JAIL_KEY = /^jail key$/i;
const SHARK = /^shark$/i;
const WATER = /^water rune$/i;
const LAW = /^law rune$/i;
const AIR = /^air rune$/i;
const STAFF = /^(mystic )?staff of air$/i;
const SHIELD = /anti-?dragon|dragonfire shield/i;
const FOOD = /^(shark|swordfish|lobster|bass|tuna)$/i;
const COINS = /^coins$/i;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/blue-dragon-scales.ts {botname}`);
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
    name: 'blue-dragon-scales',
    grindLogPath: GRIND_LOG,
    stallMs: 240_000,
    maxRecoveryTactics: 8
});

installGracefulShutdown({ graceMs: 30_000 });

// The nav mesh takes a while to build. Get off the demon side of the gate first.
if (distTo(sdk, GATE.x, GATE.z) <= 8 && pos().x > 2922) {
    await stepThroughGate();
}
initPathfinding();

let scalesBanked = 0;
let hidesBanked = 0;

function log(msg: string): void {
    session.log('log', msg);
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

function here(): string {
    const p = pos();
    return `${p.x},${p.z}`;
}

function count(pattern: RegExp): number {
    return sdk
        .getInventory()
        .filter((i) => pattern.test(i.name))
        .reduce((n, i) => n + (i.count ?? 1), 0);
}

function equipped(pattern: RegExp): boolean {
    return !!sdk.findEquipmentItem(pattern);
}

function has(pattern: RegExp): boolean {
    return count(pattern) > 0 || equipped(pattern);
}

function freeSlots(): number {
    return Math.max(0, 28 - sdk.getInventory().length);
}

function inDungeon(): boolean {
    const p = pos();
    return p.z >= 9600 && p.z <= 9920 && p.x >= 2800 && p.x <= 3000;
}

function inBlueRoom(): boolean {
    const p = pos();
    return p.x >= 2888 && p.x <= 2923 && p.z >= 9792 && p.z <= 9814;
}

function keep(name: string): boolean {
    return (
        DUSTY.test(name) ||
        JAIL_KEY.test(name) ||
        WATER.test(name) ||
        LAW.test(name) ||
        AIR.test(name) ||
        STAFF.test(name) ||
        SHIELD.test(name) ||
        FOOD.test(name)
    );
}

function bankReady(): boolean {
    const s = sdk.getState();
    // 5292 is the bank interface. bank.isOpen can lag behind it.
    return !!(s?.bank?.isOpen || s?.interface?.interfaceId === 5292);
}

async function eatIfLow(): Promise<void> {
    const p = pos();
    if (p.hp > Math.min(70, p.maxHp - 10)) return;
    const food = sdk.getInventory().find((i) => FOOD.test(i.name));
    if (!food) return;
    const before = p.hp;
    await bot.eatFood(food);
    log(`Ate ${food.name} hp ${before}->${pos().hp}`);
    session.noteProgress('inventory', 'eat');
}

async function stepTowardTile(x: number, z: number, maxSteps = 90): Promise<boolean> {
    for (let i = 0; i < maxSteps && distTo(sdk, x, z) > 3; i++) {
        const p = pos();
        const dx = Math.sign(x - p.x);
        const dz = Math.sign(z - p.z);
        // One packet. A second walk in the same tick is dropped, and the tile snapshot lags.
        const opt = i % 3 === 0 ? { x: p.x + dx, z: p.z + dz } : i % 3 === 1 ? { x: p.x + dx, z: p.z } : { x: p.x, z: p.z + dz };
        if (opt.x === p.x && opt.z === p.z) continue;
        const sent = await Promise.race([
            sdk.sendWalk(opt.x, opt.z, true),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000))
        ]);
        await sdk.waitForCondition(() => pos().x !== p.x || pos().z !== p.z, 12_000).catch(() => {});
        if (pos().x !== p.x || pos().z !== p.z) continue;
        if (i % 3 === 2) {
            const msg = sent && typeof sent === 'object' && 'message' in sent ? String(sent.message) : 'timeout';
            session.log('warn', `no step @ ${here()} toward ${x},${z} ${msg}`);
            return false;
        }
    }
    return distTo(sdk, x, z) <= 4;
}

async function walkRoute(points: Array<{ x: number; z: number }>): Promise<void> {
    for (const point of points) {
        if (session.isStopped()) return;
        await eatIfLow();
        await closeUi(bot, sdk);
        if (distTo(sdk, point.x, point.z) <= 4) continue;
        const ok = await walkNear(bot, sdk, point.x, point.z, 3);
        session.noteProgress('location', here());
        if (!ok && distTo(sdk, point.x, point.z) > 6) {
            await sdk.scanNearbyLocs(8).catch(() => {});
            const door = (sdk.getNearbyLocs() ?? [])
                .filter((l) => {
                    if (Math.hypot(l.x - GATE.x, l.z - GATE.z) <= 1) return false;
                    if (Math.hypot(l.x - JAIL_DOOR.x, l.z - JAIL_DOOR.z) <= 1) return false;
                    return /door|gate/i.test(l.name) && (l.optionsWithIndex ?? []).some((o) => /^open$/i.test(o.text));
                })
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (door && (door.distance ?? 99) <= 6) {
                log(`Opening ${door.name} @ ${door.x},${door.z}`);
                await bot.interactLoc(door, /^open$/i);
                await sdk.waitForTicks(2);
            } else {
                session.log('warn', `Walk stalled @ ${here()} toward ${point.x},${point.z}`);
            }
        }
    }
}

async function climbDungeon(down: boolean): Promise<boolean> {
    const wantUnder = down;
    for (let i = 0; i < 6 && inDungeon() !== wantUnder; i++) {
        if (down && pos().z >= 9600) break;
        if (!down && pos().z > 0 && pos().z < 9600) break;
        await closeUi(bot, sdk);
        const spot = down ? LADDER : LADDER_UNDER;
        if (distTo(sdk, spot.x, spot.z) > 6) await walkNear(bot, sdk, spot.x, spot.z, 2);
        await sdk.scanNearbyLocs(8).catch(() => {});
        const opt = down ? /climb-down|climb.down/i : /climb-up|climb.up/i;
        const ladder = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /ladder/i.test(l.name) && (l.optionsWithIndex ?? []).some((o) => opt.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!ladder) {
            session.log('warn', `No dungeon ladder @ ${here()}`);
            continue;
        }
        const beforeZ = pos().z;
        await session.setPhase(down ? 'enter_dungeon' : 'leave_dungeon');
        await bot.interactLoc(ladder, opt);
        await sdk.waitForCondition((s) => Math.abs((s.player?.worldZ ?? beforeZ) - beforeZ) > 8, 8_000).catch(() => {});
    }
    return inDungeon() === wantUnder;
}

function locNear(x: number, z: number, name: RegExp) {
    return (sdk.getNearbyLocs() ?? [])
        .filter((l) => name.test(l.name) && Math.hypot(l.x - x, l.z - z) <= 2)
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
}

async function useKeyOn(item: RegExp, x: number, z: number, name: RegExp): Promise<boolean> {
    await sdk.scanNearbyLocs(10).catch(() => {});
    const loc = locNear(x, z, name);
    if (!loc) {
        session.log('warn', `No ${name} near ${x},${z} @ ${here()}`);
        return false;
    }
    const tick = sdk.getState()?.tick ?? 0;
    log(`Using key on ${loc.name} @ ${loc.x},${loc.z}`);
    const used = await bot.useItemOnLoc(item, loc);
    if (!used.success) session.log('warn', `use key: ${used.message}`);
    await sdk.waitForTicks(2);
    const chat = (sdk.getState()?.gameMessages ?? []).some((m) => m.tick >= tick && /unlock/i.test(m.text));
    return used.success || chat;
}

async function clickChoice(pattern: RegExp): Promise<boolean> {
    for (let i = 0; i < 14; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            await sdk.waitForTicks(1);
            continue;
        }
        const match = dialog.options?.find((o) => pattern.test(o.text));
        if (match) {
            await sdk.sendClickDialog(match.index);
            await sdk.waitForTicks(1);
            return true;
        }
        const cont = dialog.options?.find((o) => /continue|click here/i.test(o.text));
        if (cont || (dialog.options?.length ?? 0) <= 1) {
            await sdk.sendClickDialog(cont?.index ?? dialog.options?.[0]?.index ?? 0);
            await sdk.waitForTicks(1);
            continue;
        }
        return false;
    }
    return false;
}

async function ensureDustyKey(): Promise<boolean> {
    if (has(DUSTY)) return true;
    await session.setPhase('dusty_key');
    if (!inDungeon() && !(await climbDungeon(true))) return false;
    if (!has(JAIL_KEY)) {
        if (distTo(sdk, JAILER.x, JAILER.z) > 8) await walkRoute(TO_JAILER);
        const jailer = sdk.findNearbyNpc(/^jailer$/i);
        if (!jailer) {
            session.log('warn', `Jailer not visible @ ${here()}`);
            return false;
        }
        log('Killing jailer for the jail key');
        await bot.attack(jailer);
        const dropped = await sdk.waitForCondition(() => !!sdk.findGroundItem(JAIL_KEY), 25_000).catch(() => false);
        if (!dropped) {
            session.log('warn', 'Jail key did not drop');
            return false;
        }
        const picked = await bot.pickupItem(JAIL_KEY);
        if (!picked.success && !has(JAIL_KEY)) {
            session.log('warn', `Jail key pickup: ${picked.message}`);
            return false;
        }
        log('Picked jail key');
    }
    if (distTo(sdk, JAIL_DOOR.x, JAIL_DOOR.z) > 4) await walkNear(bot, sdk, 2931, 9692, 1);
    await useKeyOn(JAIL_KEY, JAIL_DOOR.x, JAIL_DOOR.z, /^door$/i);
    if (distTo(sdk, VELRAK.x, VELRAK.z) > 4) await walkNear(bot, sdk, VELRAK.x, VELRAK.z, 2);
    const velrak = sdk.findNearbyNpc(/velrak/i);
    if (!velrak) {
        session.log('warn', `Velrak not visible @ ${here()}`);
        return false;
    }
    await bot.talkTo(velrak);
    await clickChoice(/anywhere good to explore/i);
    await clickChoice(/yes please/i);
    await closeUi(bot, sdk);
    if (has(DUSTY)) {
        log('Got dusty key from Velrak');
        session.noteProgress('inventory', 'dusty key');
        return true;
    }
    session.log('warn', 'Velrak did not hand over the dusty key');
    return false;
}

async function enterBlueRoom(): Promise<boolean> {
    if (inBlueRoom()) return true;
    if (!has(DUSTY)) return false;
    await session.setPhase('to_blue_dragons');
    if (!inDungeon() && distTo(sdk, 3012, 3355) < 30) {
        // Step off the packed east-bank tiles before the long pathfind.
        await walkSendHops(sdk, [{ x: 3012, z: 3364 }, { x: 2990, z: 3374 }], { x: 2884, z: 3397 }, 3);
    }
    if (!inDungeon() && !(await climbDungeon(true))) return false;
    if (!inBlueRoom()) {
        if (distTo(sdk, GATE_OUTSIDE.x, GATE_OUTSIDE.z) > 3 && distTo(sdk, GATE.x, GATE.z) > 3) await walkRoute(TO_GATE);
        await stepThroughGate();
    }
    const inside = inBlueRoom();
    if (inside) log(`In the blue dragon room @ ${here()}`);
    else session.log('warn', `Still outside the blue dragon room @ ${here()}`);
    return inside;
}

async function tryFaladorTeleport(): Promise<boolean> {
    if ((sdk.getSkill('Magic')?.baseLevel ?? 0) < FALADOR_MAGIC) return false;
    if (count(WATER) < 1 || count(LAW) < 1) return false;
    if (!equipped(STAFF) && count(AIR) < 3) return false;
    const before = pos();
    await closeUi(bot, sdk);
    await sdk.sendSetTab(MAGIC_TAB);
    await sdk.waitForTicks(1);
    await sdk.sendClickComponent(Spells.FALADOR_TELEPORT);
    await sdk.waitForCondition(() => Math.hypot(pos().x - before.x, pos().z - before.z) > 40, 8_000).catch(() => {});
    const moved = Math.hypot(pos().x - before.x, pos().z - before.z) > 40;
    if (moved) log(`Falador teleport @ ${here()}`);
    return moved;
}

/** Stand tile in front of the booth. The west constant is the notice board. */
const BANKS = [
    { stand: { x: 2946, z: 3368 }, booth: { x: 2946, z: 3368 } },
    { stand: { x: 3012, z: 3356 }, booth: { x: 3012, z: 3354 } },
    { stand: { x: 3014, z: 3356 }, booth: { x: 3014, z: 3354 } }
];

function nearestBank(): (typeof BANKS)[number] {
    return [...BANKS].sort((a, b) => distTo(sdk, a.stand.x, a.stand.z) - distTo(sdk, b.stand.x, b.stand.z))[0]!;
}

async function stepToward(x: number, z: number): Promise<void> {
    for (let i = 0; i < 4 && distTo(sdk, x, z) > 1; i++) {
        const p = pos();
        const nx = p.x + Math.sign(x - p.x);
        const nz = p.z + Math.sign(z - p.z);
        await Promise.race([
            sdk.sendWalk(nx, nz),
            new Promise((resolve) => setTimeout(resolve, 4_000))
        ]);
        await sdk.waitForCondition(() => pos().x !== p.x || pos().z !== p.z, 3_000).catch(() => {});
        if (pos().x === p.x && pos().z === p.z) break;
    }
}

async function clickBooth(): Promise<boolean> {
    await sdk.scanNearbyLocs(12).catch(() => {});
    const loc = (sdk.getNearbyLocs() ?? [])
        .filter((l) => /bank booth/i.test(l.name) && (l.optionsWithIndex ?? []).some((o) => /use|bank/i.test(o.text)))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    const opt = (loc?.optionsWithIndex ?? []).find((o) => /use.quickly|^bank$/i.test(o.text))
        ?? (loc?.optionsWithIndex ?? []).find((o) => /^use$/i.test(o.text));
    if (!loc || !opt) return false;
    log(`Clicking ${loc.name} @ ${loc.x},${loc.z} from ${here()}`);
    await Promise.race([
        sdk.sendInteractLoc(loc.x, loc.z, loc.id, opt.opIndex),
        new Promise((resolve) => setTimeout(resolve, 8_000))
    ]);
    await sdk.waitForCondition(() => bankReady(), 4_000).catch(() => {});
    if (bankReady()) {
        log(`Bank open @ ${here()}`);
        return true;
    }
    const last = sdk.getState()?.gameMessages?.slice(-2).map((m) => m.text).join(' | ') ?? '';
    log(`Booth click did not open the bank @ ${here()} ${last}`.trim());
    return false;
}

async function openFaladorBank(): Promise<boolean> {
    if (bankReady()) return true;
    await closeUi(bot, sdk);
    if (bankReady()) return true;
    // The booth is on z=3354. Use-quickly from two tiles north is ignored.
    // 3012,3355 is the tile the air-rune run actually banked from.
    if (distTo(sdk, 3012, 3355) <= 25) {
        if (pos().x !== 3012 || pos().z !== 3355) {
            await Promise.race([
                sdk.sendWalk(3012, 3355, true),
                new Promise((resolve) => setTimeout(resolve, 6_000))
            ]);
            await sdk.waitForCondition(() => pos().x === 3012 && pos().z === 3355, 4_000).catch(() => {});
        }
        if (await clickBooth()) return true;
        log('East booth stayed closed, hopping to the west bank');
    }
    await walkSendHops(
        sdk,
        [
            { x: 3012, z: 3364 },
            { x: 2988, z: 3368 },
            { x: 2964, z: 3372 },
            { x: 2945, z: 3368 }
        ],
        { x: 2945, z: 3368 },
        2
    );
    if (pos().x !== 2945 || pos().z !== 3368) {
        await Promise.race([
            sdk.sendWalk(2945, 3368, true),
            new Promise((resolve) => setTimeout(resolve, 6_000))
        ]);
        await sdk.waitForCondition(() => pos().x === 2945 && pos().z === 3368, 6_000).catch(() => {});
    }
    if (await clickBooth()) return true;
    session.log('warn', `Bank still closed @ ${here()}`);
    return false;
}

/** 1, 5, 10, and All. Any other amount opens the X dialog and the client misses it. */
function withdrawChunk(want: number, available: number, stack: boolean): number {
    if (want >= available) return -1;
    if (stack) return -1;
    if (want >= 10) return 10;
    if (want >= 5) return 5;
    return 1;
}

/** Bank packets land, then the published inventory lags. Keep polling past the SDK timeout. */
async function awaitCount(pattern: RegExp, before: number, ms: number): Promise<number> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        const got = count(pattern) - before;
        if (got > 0) return got;
        await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return count(pattern) - before;
}

async function withdraw(pattern: RegExp, amount: number, label: string): Promise<void> {
    let left = amount;
    for (let n = 0; n < 4 && left > 0; n++) {
        const item = sdk.findBankItem(pattern);
        const available = item?.count ?? 0;
        if (!item || available <= 0) return;
        const stack = WATER.test(item.name) || LAW.test(item.name) || AIR.test(item.name) || COINS.test(item.name);
        const chunk = withdrawChunk(left, available, stack);
        const before = count(pattern);
        await sdk.waitForTicks(1).catch(() => {});
        const sent = await sdk.sendBankWithdraw(item.slot, chunk);
        const sentOk = /withdrawing from slot/i.test(sent.message ?? '');
        // The packet lands before the inventory snapshot. One All click is enough.
        const got = await awaitCount(pattern, before, sentOk ? 30_000 : 8_000);
        if (got > 0) {
            log(`Withdrew ${label} x${got}`);
            left -= got;
            if (chunk === -1) return;
            continue;
        }
        const msg = sdk.getState()?.gameMessages?.at(-1)?.text ?? '';
        session.log('warn', `withdraw ${label} slot ${item.slot} x${chunk}: ${sent.message}${msg ? ` | ${msg}` : ''}`);
        if (sentOk) return;
    }
}

async function equipHeld(): Promise<void> {
    if (!equipped(SHIELD)) {
        const shield = sdk.findInventoryItem(SHIELD);
        if (shield) {
            await bot.equipItem(shield);
            if (equipped(SHIELD)) log('Equipped dragonfire shield');
        }
    }
    if (!equipped(STAFF)) {
        const staff = sdk.findInventoryItem(STAFF);
        if (staff) await bot.equipItem(staff);
    }
}

async function buyFrom(npc: RegExp, tile: { x: number; z: number }, item: RegExp, amount: number, dialog: RegExp | null): Promise<boolean> {
    if (distTo(sdk, tile.x, tile.z) > 6) await walkNear(bot, sdk, tile.x, tile.z, 3);
    await closeUi(bot, sdk);
    if (dialog) {
        const seller = sdk.findNearbyNpc(npc);
        if (!seller) return false;
        await bot.talkTo(seller);
        await clickChoice(dialog);
    } else {
        const opened = await bot.openShop(npc);
        if (!opened.success && !sdk.getState()?.shop?.isOpen) return false;
    }
    await sdk.waitForCondition(() => !!sdk.getState()?.shop?.isOpen, 6_000).catch(() => {});
    if (!sdk.getState()?.shop?.isOpen) return false;
    const before = count(item) + (equipped(item) ? 1 : 0);
    const bought = await bot.buyFromShop(item, amount);
    await bot.closeShop();
    const after = count(item) + (equipped(item) ? 1 : 0);
    if (after > before) log(`Bought ${item} x${after - before}`);
    else session.log('warn', `Buy failed: ${bought.message}`);
    return after > before;
}

async function climbTo(level: number): Promise<boolean> {
    for (let i = 0; i < 6 && pos().level !== level; i++) {
        const up = pos().level < level;
        const opt = up ? /climb-up|climb.up/i : /climb-down|climb.down/i;
        await sdk.scanNearbyLocs(8).catch(() => {});
        const stairs = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /stair|ladder/i.test(l.name) && (l.optionsWithIndex ?? []).some((o) => opt.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!stairs) {
            await walkNear(bot, sdk, MAGIC_SHOP.x, MAGIC_SHOP.z, 4);
            continue;
        }
        const before = pos().level;
        await bot.interactLoc(stairs, opt);
        await sdk.waitForCondition((s) => (s.player?.level ?? before) !== before, 8_000).catch(() => {});
    }
    return pos().level === level;
}

async function buyMissing(): Promise<void> {
    if (count(AIR) >= 100 && count(WATER) >= 20 && count(LAW) >= 5) return;
    await session.setPhase('buy_runes');
    // All is the only bank amount big enough for law runes. Put the stack back after.
    if (count(COINS) < 20_000) {
        if (!(await openFaladorBank())) return;
        await withdraw(COINS, 20_000, 'coins');
        await bot.closeBank();
    }
    if (distTo(sdk, 2586, 3088) > 15) await walkNear(bot, sdk, 2586, 3088, 4);
    if (pos().level !== 1) await climbTo(1);
    if (count(AIR) < 100) await buyFrom(/magic store owner/i, MAGIC_SHOP, AIR, 100, /yes please/i);
    if (count(WATER) < 20) await buyFrom(/magic store owner/i, MAGIC_SHOP, WATER, WATER_STOCK, /yes please/i);
    if (count(LAW) < 5) await buyFrom(/magic store owner/i, MAGIC_SHOP, LAW, LAW_STOCK, /yes please/i);
    if (pos().level !== 0) await climbTo(0);
}

async function claimShield(): Promise<boolean> {
    if (has(SHIELD)) return true;
    await session.setPhase('dragonfire_shield');
    await walkSendHops(
        sdk,
        [
            { x: 2964, z: 3368 },
            { x: 2998, z: 3342 },
            { x: 3030, z: 3315 },
            { x: 3060, z: 3278 },
            { x: 3093, z: 3244 },
            { x: 3135, z: 3248 },
            { x: 3174, z: 3240 },
            { x: 3202, z: 3218 },
            { x: 3205, z: 3208 }
        ],
        { x: 3205, z: 3208 },
        5
    );
    if (pos().level !== 1) {
        await sdk.scanNearbyLocs(8).catch(() => {});
        const stairs = (sdk.getNearbyLocs() ?? []).find(
            (l) => /stair/i.test(l.name) && (l.optionsWithIndex ?? []).some((o) => /climb-up|climb.up/i.test(o.text))
        );
        if (stairs) {
            await bot.interactLoc(stairs, /climb-up|climb.up/i);
            await sdk.waitForTicks(3);
        }
    }
    if (distTo(sdk, DUKE.x, DUKE.z) > 4) await walkNear(bot, sdk, DUKE.x, DUKE.z, 2);
    const duke = sdk.findNearbyNpc(/duke/i);
    if (!duke) return false;
    await bot.talkTo(duke);
    const offered = await clickChoice(/shield that will protect me from the dragon/i);
    await closeUi(bot, sdk);
    if (has(SHIELD)) {
        await equipHeld();
        log('Duke gave an anti-dragon shield');
        return true;
    }
    if (!offered) session.log('warn', 'No anti-dragon shield in the bank, and Duke did not offer one');
    return false;
}

async function bankTrip(): Promise<boolean> {
    await session.setPhase('bank');
    await eatIfLow();
    const nearBank = BANKS.some((bank) => distTo(sdk, bank.stand.x, bank.stand.z) <= 25);
    if (!nearBank) {
        if (!(await tryFaladorTeleport())) {
            if (inDungeon()) await climbDungeon(false);
            await walkSendHops(
                sdk,
                [
                    { x: 3202, z: 3218 },
                    { x: 3174, z: 3240 },
                    { x: 3135, z: 3248 },
                    { x: 3093, z: 3244 },
                    { x: 3060, z: 3278 },
                    { x: 3030, z: 3315 },
                    { x: 2998, z: 3342 },
                    { x: 2964, z: 3368 },
                    { x: 2945, z: 3368 }
                ],
                FALADOR_WEST_BANK,
                5
            );
        }
    }
    if (!(await openFaladorBank())) return false;
    const scales = count(SCALE);
    const hides = count(HIDE_ITEM);
    for (const item of [...sdk.getInventory()]) {
        if (keep(item.name)) continue;
        await bot.depositItem(item, -1);
    }
    if (scales > 0) {
        scalesBanked += scales;
        log(`Banked ${scales} blue dragon scales (session ${scalesBanked})`);
        session.noteProgress('bank', `${scales} scales`);
    }
    if (hides > 0) {
        hidesBanked += hides;
        log(`Banked ${hides} dragonhide (session ${hidesBanked})`);
    }
    if (!has(DUSTY)) await withdraw(DUSTY, 1, 'dusty key');
    if (!has(SHIELD)) await withdraw(SHIELD, 1, 'shield');
    if (!has(STAFF)) await withdraw(STAFF, 1, 'staff of air');
    if (!has(STAFF) && count(AIR) < 3) await withdraw(AIR, 10, 'air rune');
    let foodNeed = FOOD_COUNT - count(FOOD);
    for (const pattern of [SHARK, /^swordfish$/i, /^lobster$/i, /^bass$/i, /^tuna$/i]) {
        if (foodNeed <= 0) break;
        const before = count(FOOD);
        await withdraw(pattern, foodNeed, 'food');
        foodNeed -= count(FOOD) - before;
    }
    if (count(WATER) < 20) await withdraw(WATER, WATER_STOCK, 'water rune');
    if (count(LAW) < 20) await withdraw(LAW, LAW_STOCK, 'law rune');
    await bot.closeBank();
    await equipHeld();
    log(
        `Restocked food=${count(FOOD)} water=${count(WATER)} law=${count(LAW)} air=${count(AIR)} staff=${has(STAFF)} shield=${has(SHIELD)} key=${has(DUSTY)} @ ${here()}`
    );
    return true;
}

function suppliesReady(): boolean {
    const air = has(STAFF) || count(AIR) >= 3;
    return has(SHIELD) && air && has(DUSTY) && count(FOOD) > 0 && count(WATER) >= 1 && count(LAW) >= 1;
}

let triedStaffShop = false;

async function ensureSupplies(): Promise<boolean> {
    if (!has(SHIELD)) await claimShield();
    // Coins are not needed in the dungeon. All-withdraw emptied the bank stack once.
    if (count(COINS) > 5_000 && !(await bankTrip())) return false;
    if (suppliesReady() && equipped(SHIELD) && (equipped(STAFF) || count(AIR) >= 3)) return true;
    if (!(await bankTrip())) return false;
    if (count(AIR) < 3 || count(WATER) < 1 || count(LAW) < 1) {
        if (!triedStaffShop) {
            triedStaffShop = true;
            await buyMissing();
            if (count(COINS) > 5_000) await bankTrip();
        }
    }
    if (!has(SHIELD)) await claimShield();
    if (!has(DUSTY)) await ensureDustyKey();
    await equipHeld();
    if (count(FOOD) === 0) session.log('warn', 'No food in the bank');
    return suppliesReady();
}

function visibleLoot() {
    return (sdk.getGroundItems() ?? [])
        .filter((g) => SCALE.test(g.name) || (inBlueRoom() && HIDE_ITEM.test(g.name)))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
}

async function pickupLoot(): Promise<boolean> {
    const ground = visibleLoot();
    if (!ground || freeSlots() <= 0) return false;
    const scalesBefore = count(SCALE);
    const hidesBefore = count(HIDE_ITEM);
    if ((ground.distance ?? 99) > 1) await walkNear(bot, sdk, ground.x, ground.z, 1);
    const picked = await bot.pickupItem(ground);
    if (count(SCALE) > scalesBefore) {
        log(`Picked blue dragon scale ${count(SCALE)} @ ${ground.x},${ground.z}`);
        session.noteProgress('inventory', 'scale');
        return true;
    }
    if (count(HIDE_ITEM) > hidesBefore) {
        log(`Picked dragonhide ${count(HIDE_ITEM)} @ ${ground.x},${ground.z}`);
        session.noteProgress('inventory', 'hide');
        return true;
    }
    if (!picked.success) session.log('warn', `pickup ${ground.name}: ${picked.message}`);
    return false;
}

let spawnCursor = 0;

/** Lesser demons stand on the east side of this gate. Step west before pathfinding. */
async function stepThroughGate(): Promise<boolean> {
    for (let i = 0; i < 5 && !inBlueRoom(); i++) {
        await eatIfLow();
        await sdk.scanNearbyLocs(8).catch(() => {});
        const loc = locNear(GATE.x, GATE.z, /^gate$/i);
        const open = (loc?.optionsWithIndex ?? []).find((o) => /^open$/i.test(o.text));
        if (loc && open) {
            log(`Opening ${loc.name} @ ${loc.x},${loc.z}`);
            await Promise.race([
                sdk.sendInteractLoc(loc.x, loc.z, loc.id, open.opIndex),
                new Promise((resolve) => setTimeout(resolve, 5_000))
            ]);
            await sdk.waitForTicks(2);
        }
        const last = sdk.getState()?.gameMessages?.at(-1)?.text ?? '';
        if (/locked/i.test(last) && !/unlock/i.test(last)) {
            await useKeyOn(DUSTY, GATE.x, GATE.z, /^gate$/i);
        }
        await Promise.race([
            sdk.sendWalk(2922, 9804, true),
            new Promise((resolve) => setTimeout(resolve, 5_000))
        ]);
        await sdk.waitForCondition(() => inBlueRoom() && pos().x <= 2922, 4_000).catch(() => {});
    }
    if (inBlueRoom() && distTo(sdk, HIDE.x, HIDE.z) > 2) {
        await Promise.race([
            sdk.sendWalk(HIDE.x, HIDE.z, true),
            new Promise((resolve) => setTimeout(resolve, 5_000))
        ]);
    }
    return inBlueRoom();
}

async function collectOrHide(): Promise<void> {
    if (!inBlueRoom()) return;
    if (await pickupLoot()) return;
    const lapStart = spawnCursor;
    for (let n = 0; n < SCALES.length; n++) {
        if (freeSlots() <= 0) return;
        const spot = SCALES[spawnCursor % SCALES.length]!;
        spawnCursor++;
        if (distTo(sdk, spot.x, spot.z) > 2) await walkNear(bot, sdk, spot.x, spot.z, 1);
        if (await pickupLoot()) return;
    }
    if (spawnCursor === lapStart) return;
    await session.setPhase('hide');
    if (distTo(sdk, HIDE.x, HIDE.z) > 1) await walkNear(bot, sdk, HIDE.x, HIDE.z, 1);
    log(`Hiding @ ${here()} for scale respawn`);
    for (let t = 0; t < 25; t++) {
        if (visibleLoot() || freeSlots() <= 0) return;
        await sdk.waitForTicks(1);
    }
}

try {
    if (!bankReady()) await closeUi(bot, sdk);
    while (!session.isStopped()) {
        if (session.needsRecovery()) {
            if ((await session.recover()) === 'exhausted') break;
            continue;
        }
        if (pos().isDead) {
            session.log('warn', `Died @ ${here()}`);
            await sdk.waitForCondition((s) => !s.player.isDead, 45_000).catch(() => {});
            continue;
        }
        await eatIfLow();
        if (!(await ensureSupplies())) {
            session.noteFailure('supplies', `shield=${has(SHIELD)} staff=${has(STAFF)} key=${has(DUSTY)} food=${count(FOOD)} water=${count(WATER)} law=${count(LAW)}`);
            await sdk.waitForTicks(5);
            continue;
        }
        if (freeSlots() <= 0 || (count(FOOD) === 0 && pos().hp < 40)) {
            await bankTrip();
            continue;
        }
        if (!(await enterBlueRoom())) {
            session.noteFailure('room', `not in blue room @ ${here()}`);
            await sdk.waitForTicks(3);
            continue;
        }
        session.setAnchor(HIDE.x, HIDE.z);
        await collectOrHide();
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err), { restartable: true });
    throw err;
} finally {
    await sdk.disconnect();
}
