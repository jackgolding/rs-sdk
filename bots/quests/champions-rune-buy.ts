/**
 * Champions' Guild rune buyout loop (Scavvo's Rune Store) for jackthief.
 *
 *   bun bots/quests/champions-rune-buy.ts jackthief
 *
 * Withdraws a healthy coin pocket from the bank, walks to the Champions'
 * Guild south-west of Varrock, buys out the rune ARMOUR lines in Scavvo's
 * shared shop (chainbody, platelegs, plateskirt — no weapons), and
 * repeats: when the backpack fills it banks the armour at Varrock West and
 * comes back. When the shelf is empty it waits in the guild for restock.
 *
 * Notes:
 * - Scavvo's shop is SHARED stock (scope=shared, 1 of each rune line) with
 *   restock on, so most sweeps buy 0-6 pieces and the loop camps restocks.
 * - The guild door needs 32 Quest Points. If the door refuses, the bot logs
 *   QP_BLOCKED and idles (no restart burn) until QP lands.
 * - Coins never leave the loop except into armour: every bank trip deposits
 *   the loot and tops the pocket back to POCKET_TARGET.
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { closeUi, playerPos, walkNear } from './movement';
import { VARROCK_WEST_BANK } from './tiles';
import { installGracefulShutdown } from '../../sdk/runner';

/** Rune armour lines in Scavvo's shop, most valuable first (no weapons). */
const RUNE_WANTS = [/^rune chainbody$/i, /^rune platelegs$/i, /^rune plateskirt$/i];
const LOOT = /^(rune chainbody|rune platelegs|rune plateskirt)$/i;
const COINS = /^coins$/i;
const SCAVVO = /^scavvo$/i;
/** Kit to wear: chainbody + plateskirt + mace (mace is never bought). */
const KIT_BODY = /^rune chainbody$/i;
const KIT_LEGS = /^rune plateskirt$/i;
const KIT_WEAPON = /^rune mace$/i;

/** Guild hall centre (labels.txt: Champions' Guild 3201,3354). */
const HALL = { x: 3200, z: 3352 };
/** Staging tile in the park north of the guild's north door. */
const ENTRY = { x: 3191, z: 3367 };
/** Only doors inside this box belong to the guild — ignore city doors. */
const GUILD_BOX = { x0: 3184, x1: 3202, z0: 3348, z1: 3368 };
/** The walled guild complex itself (floor plan from collision walls). */
const GUILD_IN = { x0: 3185, x1: 3199, z0: 3352, z1: 3364 };
/** Interior sweep covering hall, west/east wings and the south annex. */
const SWEEP = [
    { x: 3190, z: 3362 },
    { x: 3186, z: 3361 },
    { x: 3196, z: 3361 },
    { x: 3186, z: 3357 },
    { x: 3190, z: 3357 },
    { x: 3196, z: 3357 },
    { x: 3186, z: 3354 },
    { x: 3190, z: 3354 },
    { x: 3196, z: 3354 },
    { x: 3192, z: 3353 }
];
/** The Guildmaster greets on entry: proof the last Open took us inside. */
const GREET = /greetings bold adventurer|welcome to the guild/i;
/** Char count of chat arrays before a door Open; only NEWER lines prove entry. */
function chatBaseline(): { msgs: number; dialogs: number } {
    return {
        msgs: sdk.getState()?.gameMessages?.length ?? 0,
        dialogs: (sdk.getState()?.recentDialogs as unknown[] | undefined)?.length ?? 0
    };
}

/** True when the Guildmaster's entry greeting arrived AFTER the baseline. */
function freshGreeting(base: { msgs: number; dialogs: number }): boolean {
    const tail = JSON.stringify([
        ...(sdk.getState()?.gameMessages ?? []).slice(base.msgs),
        ...(((sdk.getState()?.recentDialogs as unknown[] | undefined) ?? []).slice(base.dialogs) as object[])
    ]);
    return GREET.test(tail);
}

/** Nearby NPC names for remote-visibility logs. */
function npcSummary(): string {
    return (
        (sdk.getNearbyNpcs() ?? [])
            .slice(0, 8)
            .map((n) => `${n.name}@${n.x},${n.z}`)
            .join(' ') || 'none'
    );
}

/** Inside flag survives across reachScavvo calls; only OUR door Open clears it. */
let insideGuild = false;
/** Doors already worked with no effect — retried only after real movement. */
const triedDoors = new Set<string>();
let triedAt = { x: 0, z: 0 };
/** Nearest openable door inside the guild box (city doors ignored). */
function nearestOpenDoor(skipTried = false) {
    return (sdk.getNearbyLocs() ?? [])
        .filter(
            (l) =>
                /door/i.test(l.name) &&
                l.x >= GUILD_BOX.x0 &&
                l.x <= GUILD_BOX.x1 &&
                l.z >= GUILD_BOX.z0 &&
                l.z <= GUILD_BOX.z1 &&
                (!skipTried || !triedDoors.has(`${l.x},${l.z}`)) &&
                (l.optionsWithIndex ?? []).some((o) => /^open$/i.test(o.text))
        )
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
}
/** Where the confirmed entry landed — the interior sweep centres here. */
let entryPos = { x: 0, z: 0 };
/** Varrock West booths read UNREACHABLE from the west when crowded. */
const BANK_APPROACH = { x: 3195, z: 3440 };

/** Coin pocket target per bank trip; MIN_POCKET triggers a top-up trip. */
const POCKET_TARGET = 10_000_000;
const MIN_POCKET = 50_000;
/** Restock camp: 60s polls, then a bank round-trip every EMPTY_SWEEPS_TO_BANK. */
const RESTOCK_POLLS = 10;
const RESTOCK_WAIT_TICKS = 100;
const EMPTY_SWEEPS_TO_BANK = 3;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg ? join(process.cwd(), 'bots', botArg, 'bot.env') : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}`);
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
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
    name: 'champions-rune-buy',
    grindLogPath: GRIND_LOG,
    stallMs: 300_000,
    maxRecoveryTactics: 8
});
installGracefulShutdown({ graceMs: 30_000 });
initPathfinding();

function here(): string {
    const p = playerPos(sdk);
    return `${p.x},${p.z}`;
}

function count(re: RegExp): number {
    return sdk
        .getInventory()
        .filter((i) => re.test(i.name))
        .reduce((n, i) => n + (i.count ?? 1), 0);
}

function freeSlots(): number {
    return Math.max(0, 28 - sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length);
}

function bankCoins(): number {
    return (sdk.getBankItems?.() ?? []).filter((i) => COINS.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
}

function shopOpen(): boolean {
    return sdk.getState()?.shop?.isOpen === true;
}

function shopRuneStock(): { name: string; stock: number }[] {
    const items = sdk.getState()?.shop?.shopItems ?? [];
    return RUNE_WANTS.map((want) => {
        const line = items.find((i) => want.test(i.name));
        return { name: line?.name ?? want.source, stock: line?.count ?? 0 };
    }).filter((l) => l.stock > 0);
}

/** True when the guild door / guildmaster refused entry on quest points. */
function qpRefused(): boolean {
    const tail = JSON.stringify((sdk.getState()?.gameMessages ?? []).slice(-6)).toLowerCase();
    if (/quest points|worthy/.test(tail)) return true;
    const d = sdk.getDialog();
    if (d?.isOpen && /worthy|quest points/i.test(JSON.stringify(d))) return true;
    return false;
}

function scavvo(): { x: number; z: number; distance: number } | null {
    const list = (sdk.getNearbyNpcs() ?? [])
        .filter((n) => SCAVVO.test(n.name))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
    const s = list[0];
    return s ? { x: s.x, z: s.z, distance: s.distance ?? 99 } : null;
}

/**
 * Bank at Varrock West: deposit rune loot, top the coin pocket to
 * POCKET_TARGET. Returns false when the bot cannot fund the loop.
 */
async function bankTrip(): Promise<boolean> {
    await closeUi(bot, sdk);
    await walkNear(bot, sdk, BANK_APPROACH.x, BANK_APPROACH.z, 3);
    await walkNear(bot, sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z, 3);
    let opened = shopOpen() ? false : (await bot.openBank()).success || sdk.getState()?.bank?.isOpen === true;
    if (!opened) {
        await walkNear(bot, sdk, BANK_APPROACH.x, BANK_APPROACH.z, 2);
        opened = (await bot.openBank()).success || sdk.getState()?.bank?.isOpen === true;
    }
    if (!opened) {
        session.log('warn', `bank open failed @ ${here()}`);
        return count(COINS) >= MIN_POCKET;
    }
    let banked = 0;
    for (const want of RUNE_WANTS) {
        if (count(want) > 0) {
            const before = count(want);
            await bot.depositItem(want, -1);
            banked += Math.max(0, before - count(want));
        }
    }
    // Sweep any other non-coin junk that slipped in, keep it clean —
    // except the kit mace, which rides in the pack until it is worn.
    for (let i = 0; i < 8; i++) {
        const junk = sdk
            .getInventory()
            .find((it) => (it.count ?? 0) > 0 && !COINS.test(it.name) && !LOOT.test(it.name) && !KIT_WEAPON.test(it.name));
        if (!junk) break;
        await bot.depositItem(new RegExp(`^${junk.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), -1);
    }
    // Pull missing kit pieces (unnoted) so they can be worn.
    for (const kit of [KIT_BODY, KIT_LEGS, KIT_WEAPON]) {
        if (!sdk.findEquipmentItem(kit) && count(kit) === 0) {
            const b = (sdk.getBankItems?.() ?? []).find((i) => kit.test(i.name));
            if (b) {
                const w = await bot.withdrawItem(b, 1);
                session.log('log', `kit withdraw ${b.name}: ${w.success ? 'ok' : w.message}`);
            }
        }
    }
    const pocket = count(COINS);
    const vault = bankCoins();
    if (pocket < POCKET_TARGET && vault > 0) {
        const w = await bot.withdrawItem(COINS, Math.min(POCKET_TARGET - pocket, vault));
        if (!w.success) session.log('warn', `coin withdraw: ${w.message}`);
    }
    const now = count(COINS);
    session.log('log', `banked +${banked} loot=${count(LOOT)} pocket=${now} vault~${bankCoins()} @ ${here()}`);
    await bot.closeBank().catch(() => undefined);
    return now >= MIN_POCKET;
}

/**
 * Reach Scavvo's side. Inside is decided by POSITION (in the walled
 * complex), never by chat: the north door teleports on Open, interior
 * room doors open normally, and any door that throws us outside flips
 * us back to entry duty on the next round.
 */
function inComplex(): boolean {
    const p = playerPos(sdk);
    return p.x >= GUILD_IN.x0 && p.x <= GUILD_IN.x1 && p.z >= GUILD_IN.z0 && p.z <= GUILD_IN.z1;
}

async function reachScavvo(): Promise<'ok' | 'qp-blocked' | 'failed'> {
    let climbed = false;
    for (let i = 0; i < 16; i++) {
        if (session.stopRequested) return 'failed';
        await closeUi(bot, sdk);
        const s = scavvo();
        if (s && s.distance <= 3) return 'ok';
        if (s) {
            await walkNear(bot, sdk, s.x, s.z, 2);
            continue;
        }
        await sdk.scanNearbyLocs(10).catch(() => undefined);
        if (scavvo()) continue;
        if (inComplex()) {
            insideGuild = true;
            // Sweep every wing so the shopkeeper walks into NPC range.
            let found = false;
            for (const wp of SWEEP) {
                if (session.stopRequested) return 'failed';
                if (!inComplex()) break;
                await walkNear(bot, sdk, wp.x, wp.z, 2);
                await sdk.scanNearbyLocs(10).catch(() => undefined);
                if (scavvo()) {
                    found = true;
                    break;
                }
            }
            if (found) continue;
            if (!inComplex()) continue;
            if (!climbed) {
                const stairs = (sdk.getNearbyLocs() ?? [])
                    .filter(
                        (l) =>
                            /stair/i.test(l.name) &&
                            (l.optionsWithIndex ?? []).some((o) => /climb-?up/i.test(o.text))
                    )
                    .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
                if (stairs && (stairs.distance ?? 99) <= 12) {
                    const before = playerPos(sdk).level;
                    session.log('log', `climbing ${stairs.x},${stairs.z} looking for the shop`);
                    await walkNear(bot, sdk, stairs.x, stairs.z, 2);
                    await bot.interactLoc(stairs, /climb-?up/i).catch(() => null);
                    await sdk
                        .waitForCondition(() => playerPos(sdk).level !== before, 8_000)
                        .catch(() => undefined);
                    climbed = true;
                    continue;
                }
                climbed = true;
            }
            // Open interior room doors (a displacement outside flips us out).
            await sdk.scanNearbyLocs(10).catch(() => undefined);
            let inner = nearestOpenDoor();
            if (inner && (inner.distance ?? 99) > 5) {
                await walkNear(bot, sdk, inner.x, inner.z, 2);
                await sdk.scanNearbyLocs(8).catch(() => undefined);
                inner = nearestOpenDoor();
            }
            if (inner && (inner.distance ?? 99) <= 5) {
                const before = playerPos(sdk);
                const opened = await bot.interactLoc(inner, /open/i).catch(() => null);
                await sdk.waitForTicks(4).catch(() => undefined);
                if (qpRefused()) return 'qp-blocked';
                await sdk.scanNearbyLocs(10).catch(() => undefined);
                const after = playerPos(sdk);
                session.log(
                    'log',
                    `room door ${inner.x},${inner.z}: ${opened?.success ? 'ok' : opened?.message ?? 'fail'} @ ${here()}`
                );
                if (scavvo()) continue;
                void before;
                void after;
            } else {
                await sdk.waitForTicks(5).catch(() => undefined);
            }
            continue;
        }
        insideGuild = false;
        // Outside: stage in the park, work the nearest guild door. The
        // north door teleports inside on Open — nothing walks after it.
        await walkNear(bot, sdk, ENTRY.x, ENTRY.z, 2);
        await sdk.scanNearbyLocs(10).catch(() => undefined);
        if (scavvo()) continue;
        if (inComplex()) continue;
        let door = nearestOpenDoor(true);
        if (!door) {
            triedDoors.clear();
            await sdk.waitForTicks(5).catch(() => undefined);
            continue;
        }
        if (door && (door.distance ?? 99) > 4) {
            await walkNear(bot, sdk, door.x, door.z, 2);
            await sdk.scanNearbyLocs(8).catch(() => undefined);
            door = nearestOpenDoor(true);
        }
        if (door && (door.distance ?? 99) <= 5) {
            const key = `${door.x},${door.z}`;
            const p0 = playerPos(sdk);
            if (Math.hypot(p0.x - triedAt.x, p0.z - triedAt.z) > 6) {
                triedDoors.clear();
                triedAt = { x: p0.x, z: p0.z };
            }
            if (triedDoors.has(key)) {
                await sdk.waitForTicks(3).catch(() => undefined);
                continue;
            }
            const base = chatBaseline();
            const opened = await bot.interactLoc(door, /open/i).catch(() => null);
            await sdk.waitForTicks(4).catch(() => undefined);
            if (qpRefused()) return 'qp-blocked';
            await sdk.scanNearbyLocs(10).catch(() => undefined);
            const newChat = JSON.stringify([
                ...(sdk.getState()?.gameMessages ?? []).slice(base.msgs),
                ...(((sdk.getState()?.recentDialogs as unknown[] | undefined) ?? []).slice(base.dialogs) as object[])
            ]).slice(-200);
            if (inComplex()) {
                insideGuild = true;
                session.log('log', `inside the guild @ ${here()} — sweeping the wings`);
            } else {
                session.log('log', `door ${door.x},${door.z}: ${opened?.success ? 'ok' : opened?.message ?? 'fail'} @ ${here()} chat: ${newChat}`);
                triedDoors.add(key);
            }
            continue;
        }
        await sdk.waitForTicks(3).catch(() => undefined);
    }
    return scavvo() ? 'ok' : 'failed';
}

/** Wear chainbody + plateskirt + mace from the pack. Loud on change only. */
let kitSaidMissing = false;
async function ensureKit(): Promise<void> {
    for (const kit of [KIT_BODY, KIT_LEGS, KIT_WEAPON]) {
        if (sdk.findEquipmentItem(kit)) continue;
        const inv = sdk.findInventoryItem(kit);
        if (!inv) continue;
        const r = await bot.equipItem(inv).catch(() => null);
        session.log('log', `wear ${inv.name}: ${r?.success ? 'ok' : r?.message ?? 'fail'}`);
    }
    const missing = [KIT_BODY, KIT_LEGS, KIT_WEAPON].filter((kit) => !sdk.findEquipmentItem(kit) && !sdk.findInventoryItem(kit));
    if (missing.length > 0 && !kitSaidMissing) {
        kitSaidMissing = true;
        session.log('warn', `kit short: ${missing.map((m) => m.source).join(', ')} nowhere yet — bank/shop will supply`);
    }
    if (missing.length === 0) kitSaidMissing = false;
}

/** Buy every rune line with shelf stock. Assumes the shop is open. */
async function buySweep(): Promise<{ bought: number; sawStock: boolean }> {
    let bought = 0;
    let sawStock = false;
    for (const want of RUNE_WANTS) {
        if (freeSlots() <= 0) break;
        const line = sdk.getState()?.shop?.shopItems.find((i) => want.test(i.name));
        const stock = line?.count ?? 0;
        if (stock <= 0) continue;
        sawStock = true;
        const n = Math.min(stock, freeSlots(), 10);
        const r = await bot.buyFromShop(want, n);
        bought += r.amountBought ?? 0;
        session.log(
            r.success || r.partial ? 'log' : 'warn',
            `buy ${line!.name} x${r.amountBought ?? 0}/${n}: ${r.message} pocket=${count(COINS)}`
        );
        if (!r.success && !r.partial && /coin|afford|cost|wealth|enough|space/i.test(r.message)) break;
    }
    return { bought, sawStock };
}

try {
    await sdk.waitForConnection(90_000).catch(() => undefined);
    session.log('log', `champions-rune-buy start @ ${here()} pocket=${count(COINS)} loot=${count(LOOT)}`);
    await session.showIntent('Buying out Scavvo rune stock').catch(() => undefined);

    let totalBought = 0;
    let emptySweeps = 0;

    for (;;) {
        if (session.stopRequested) {
            await bankTrip().catch(() => false);
            session.stop('stopped', `drain to bank bought=${totalBought}`, {
                restartable: true
            });
            break;
        }
        await closeUi(bot, sdk);
        await ensureKit().catch(() => undefined);

        // 1. Keep a funded pocket.
        if (count(COINS) < MIN_POCKET) {
            const funded = await bankTrip();
            if (!funded) {
                session.log(
                    'error',
                    `FUNDS_DRY pocket=${count(COINS)} vault~${bankCoins()} — idling, top up coins to resume`
                );
                for (let i = 0; i < 20 && !session.stopRequested; i++)
                    await sdk.waitForTicks(100).catch(() => undefined);
                continue;
            }
        }

        // 2. Reach the shop.
        const there = await reachScavvo();
        if (there === 'qp-blocked') {
            session.log('error', 'QP_BLOCKED: guild door needs 32 Quest Points — idling until QP lands');
            for (let i = 0; i < 60 && !session.stopRequested; i++)
                await sdk.waitForTicks(100).catch(() => undefined);
            continue;
        }
        if (there !== 'ok') {
            session.log('warn', `could not reach Scavvo @ ${here()} npcs: ${npcSummary()} — retrying`);
            await sdk.waitForTicks(10).catch(() => undefined);
            continue;
        }

        // 3. Open and sweep the shelf.
        if (!shopOpen()) {
            const opened = await bot.openShop(SCAVVO);
            if (!shopOpen()) {
                session.log('warn', `Scavvo shop: ${opened.message}`);
                await sdk.waitForTicks(5).catch(() => undefined);
                continue;
            }
        }
        await session.showIntent('Sweeping rune shelf').catch(() => undefined);
        const { bought, sawStock } = await buySweep();
        await bot.closeShop().catch(() => undefined);
        await ensureKit().catch(() => undefined);
        totalBought += bought;
        if (bought > 0) emptySweeps = 0;
        session.log(
            'log',
            `sweep bought=${bought} total=${totalBought} loot=${count(LOOT)} free=${freeSlots()} pocket=${count(COINS)} @ ${here()}`
        );

        // 4. Full backpack -> bank it.
        if (freeSlots() <= 1 && count(LOOT) > 0) {
            await bankTrip();
            emptySweeps = 0;
            continue;
        }

        // 5. Shelf cleared but room left -> camp restock, bank every few empties.
        if (bought === 0) {
            emptySweeps++;
            if (emptySweeps >= EMPTY_SWEEPS_TO_BANK) {
                await bankTrip();
                emptySweeps = 0;
                continue;
            }
            if (!sawStock) {
                let restocked = false;
                for (let w = 0; w < RESTOCK_POLLS && !session.stopRequested; w++) {
                    await sdk.waitForTicks(RESTOCK_WAIT_TICKS).catch(() => undefined);
                    if (scavvo()?.distance !== undefined && scavvo()!.distance > 4) break;
                    const o = await bot.openShop(SCAVVO).catch(() => null);
                    void o;
                    if (!shopOpen()) break;
                    if (shopRuneStock().length > 0) {
                        restocked = true;
                        break;
                    }
                    await bot.closeShop().catch(() => undefined);
                }
                await bot.closeShop().catch(() => undefined);
                if (restocked) {
                    emptySweeps = 0;
                    continue;
                }
            }
        }
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err), { restartable: true });
    throw err;
} finally {
    await session.finalizeStop().catch(() => undefined);
    await sdk.disconnect();
}
