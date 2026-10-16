/**
 * Turn banked rune arrowtips into rune arrows: shafts from normal logs,
 * feathers on shafts, tips on headless. Buys extra feathers at the Fishing Guild
 * if the bank is short.
 *
 *   bun bots/quests/fletch-rune-arrows.ts jackthief
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import {
    CATHERBY_BANK,
    CATHERBY_TO_FISHING_GUILD,
    FISHING_GUILD_DOOR,
    FISHING_GUILD_SHOP,
    SEERS_TREES
} from './tiles';
import { closeUi, distTo, playerPos, walkNear, walkWaypoints } from './movement';
import { installGracefulShutdown } from '../../sdk/runner';

const KNIFE = /^knife$/i;
const AXE = /^(bronze|iron|steel|black|mithril|adamant|rune) axe$/i;
const COINS = /^coins$/i;
const FEATHER = /^feather$/i;
const SHAFT = /^arrow shaft$/i;
const HEADLESS = /^headless arrow$/i;
const TIPS = /^rune arrowtips$/i;
const ARROWS = /^rune arrows?$/i;
const LOGS = /^logs$/i;
const KEEP =
    /^(coins|knife|(bronze|iron|steel|black|mithril|adamant|rune) axe|feather|arrow shaft|headless arrow|rune arrowtips|rune arrows?|logs)$/i;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));

function loadBotEnv(): void {
    const envPath = botArg
        ? join(process.cwd(), 'bots', botArg, 'bot.env')
        : join(dirname(import.meta.path), 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}. Usage: bun bots/quests/fletch-rune-arrows.ts {botname}`);
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
    actionTimeout: 12_000,
    showChat: false
});

await sdk.connect();
const bot = new BotActions(sdk);
const session = new ActivitySession(sdk, bot, {
    name: 'fletch-rune-arrows',
    grindLogPath: GRIND_LOG,
    stallMs: 180_000,
    maxRecoveryTactics: 8
});

installGracefulShutdown({ graceMs: 30_000 });

function log(msg: string): void {
    session.log('log', msg);
}

function inv(pattern: RegExp): number {
    return sdk.countInventoryItems(pattern);
}

function bankCount(pattern: RegExp): number {
    return sdk.getBankItems().reduce((n, i) => n + (pattern.test(i.name) ? (i.count ?? 0) : 0), 0);
}

function occupied(): number {
    return sdk.getInventory().length;
}

function bankOpen(): boolean {
    const s = sdk.getState();
    return !!s?.bank?.isOpen || s?.interface?.interfaceId === 5292;
}

async function clickCatherbyBooth(): Promise<boolean> {
    const booth =
        sdk.findNearbyLoc(/bank booth/i, { reachable: true }) ??
        (sdk.getNearbyLocs() ?? [])
            .filter((l) => /bank booth/i.test(l.name) && (l.optionsWithIndex?.length ?? 0) > 0)
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (!booth) return false;
    const opt =
        booth.optionsWithIndex.find((o) => /use.quickly/i.test(o.text)) ??
        booth.optionsWithIndex.find((o) => /^use$/i.test(o.text));
    if (!opt) return false;
    log(`Clicking Catherby booth @ ${booth.x},${booth.z}`);
    await sdk.sendInteractLoc(booth.x, booth.z, booth.id, opt.opIndex);
    await sdk.waitForCondition((s) => s.bank?.isOpen === true || s.interface?.interfaceId === 5292, 8_000).catch(() => {});
    return bankOpen();
}

async function openCatherbyBank(): Promise<boolean> {
    if (bankOpen()) return true;
    if (sdk.getState()?.shop?.isOpen || sdk.getState()?.dialog?.isOpen) await closeUi(bot, sdk);
    if (bankOpen()) return true;
    if (distTo(sdk, CATHERBY_BANK.x, CATHERBY_BANK.z) > 8) {
        await walkNear(bot, sdk, 2809, 3441, 2);
    }
    if (await clickCatherbyBooth()) return true;
    const opened = await bot.openBank(8_000);
    if (!opened.success && !bankOpen()) {
        session.log('warn', `openBank: ${opened.message}`);
        return false;
    }
    await sdk
        .waitForCondition((s) => s.bank?.isOpen === true && (s.bank.items?.length ?? 0) > 0, 8_000)
        .catch(() => {});
    return bankOpen();
}

async function depositJunk(): Promise<void> {
    for (const item of [...sdk.getInventory()]) {
        if (KEEP.test(item.name)) continue;
        const r = await bot.depositItem(item, -1);
        if (!r.success && !r.partial) break;
    }
}

async function ensureItemMode(): Promise<void> {
    if (!bankOpen()) return;
    if (sdk.getState()?.bank?.noteMode === true) {
        await sdk.sendClickComponent(5387);
        await sdk.waitForCondition((s) => s.bank?.noteMode === false, 3_000).catch(() => {});
    }
}

async function withdrawSlot(pattern: RegExp, amount: number): Promise<number> {
    if (!bankOpen()) return inv(pattern);
    await ensureItemMode();
    const banked = sdk.findBankItem(pattern);
    if (!banked) return inv(pattern);
    const before = inv(pattern);
    log(`Withdraw ${banked.name} slot ${banked.slot} x${amount === -1 ? 'all' : amount} (bank ${banked.count})`);
    const r = await sdk.sendBankWithdraw(banked.slot, amount);
    log(`Withdraw ${banked.name}: ${r.success ? 'ok' : r.message}`);
    await sdk
        .waitForCondition(() => inv(pattern) > before, 4_000)
        .catch(() => {});
    return inv(pattern);
}

async function withdrawOne(pattern: RegExp): Promise<boolean> {
    if (sdk.findInventoryItem(pattern)) return true;
    return (await withdrawSlot(pattern, 1)) > 0;
}

async function withdrawAll(pattern: RegExp): Promise<number> {
    return withdrawSlot(pattern, -1);
}

async function combineStacks(a: RegExp, b: RegExp): Promise<number> {
    let made = 0;
    let misses = 0;
    for (let i = 0; i < 500; i++) {
        await bot.dismissBlockingUI();
        if (sdk.getState()?.bank?.isOpen || sdk.getState()?.shop?.isOpen) await closeUi(bot, sdk);
        const left = sdk.findInventoryItem(a);
        const right = sdk.findInventoryItem(b);
        if (!left || !right) break;
        const beforeA = inv(a);
        const beforeB = inv(b);
        const r = await sdk.sendUseItemOnItem(left.slot, right.slot);
        if (!r.success) {
            session.log('warn', `useItemOnItem: ${r.message}`);
            misses++;
            if (misses >= 20) break;
            await sdk.waitForTicks(1).catch(() => {});
            continue;
        }
        await sdk
            .waitForCondition(() => inv(a) < beforeA || inv(b) < beforeB, 3_000)
            .catch(() => {});
        const used = Math.min(beforeA - inv(a), beforeB - inv(b));
        if (used <= 0) {
            misses++;
            if (misses >= 20) {
                session.log('warn', `combine ${a.source} + ${b.source} stalled`);
                break;
            }
            await sdk.waitForTicks(1).catch(() => {});
            continue;
        }
        misses = 0;
        made += used;
        session.noteProgress('inventory', 'arrows');
    }
    return made;
}

async function fletchAllLogs(): Promise<number> {
    let shafts = 0;
    while (sdk.findInventoryItem(LOGS) && !session.isStopped()) {
        await closeUi(bot, sdk);
        const before = inv(SHAFT);
        const r = await bot.fletchLogs('arrow shaft');
        if (!r.success) {
            session.log('warn', `fletchLogs: ${r.message}`);
            break;
        }
        const gained = inv(SHAFT) - before;
        shafts += Math.max(0, gained);
        session.noteProgress('xp', 'fletching');
        log(`Shafts +${gained} (now ${inv(SHAFT)}) | ${r.message}`);
    }
    return shafts;
}

async function chopLogs(needLogs: number): Promise<void> {
    if (needLogs <= 0) return;
    await closeUi(bot, sdk);
    let misses = 0;
    while (inv(LOGS) < needLogs && occupied() < 26 && !session.isStopped()) {
        let tree = sdk.findNearbyLoc(/^tree$/i, { reachable: true }) ?? sdk.findNearbyLoc(/^tree$/i);
        if (!tree) {
            if (distTo(sdk, SEERS_TREES.x, SEERS_TREES.z) > 10) {
                await walkNear(bot, sdk, SEERS_TREES.x, SEERS_TREES.z, 4);
            }
            tree = sdk.findNearbyLoc(/^tree$/i, { reachable: true }) ?? sdk.findNearbyLoc(/^tree$/i);
        }
        if (!tree) {
            misses++;
            session.log('warn', `no normal tree @ ${playerPos(sdk).x},${playerPos(sdk).z}`);
            if (misses > 6) return;
            await walkNear(bot, sdk, SEERS_TREES.x, SEERS_TREES.z, 4);
            await sdk.waitForTicks(3).catch(() => {});
            continue;
        }
        await session.showIntent(`chop ${tree.name} ${tree.x},${tree.z}`);
        const r = await bot.chopTree(tree);
        if (r.success) {
            misses = 0;
            session.noteProgress('inventory', 'logs');
            continue;
        }
        misses++;
        session.log('warn', `chop: ${r.message}`);
        await sdk.waitForTicks(2).catch(() => {});
    }
}

function insideGuild(): boolean {
    const p = playerPos(sdk);
    return p.x >= 2584 && p.x <= 2610 && p.z >= 3388 && p.z <= 3426;
}

async function enterGuild(): Promise<boolean> {
    if (insideGuild()) return true;
    await closeUi(bot, sdk);
    if (distTo(sdk, FISHING_GUILD_DOOR.x, FISHING_GUILD_DOOR.z) > 8) {
        await walkWaypoints(bot, sdk, CATHERBY_TO_FISHING_GUILD);
        await walkNear(bot, sdk, FISHING_GUILD_DOOR.x, FISHING_GUILD_DOOR.z, 2);
    }
    const door =
        sdk.findNearbyLoc(/^door$/i, { reachable: true }) ??
        sdk.findNearbyLoc(/guild|door/i);
    if (door) {
        const opened = await bot.openDoor(door);
        if (!opened.success) session.log('warn', `guild door: ${opened.message}`);
        await sdk.waitForTicks(2).catch(() => {});
    }
    await walkNear(bot, sdk, FISHING_GUILD_SHOP.x, FISHING_GUILD_SHOP.z, 3);
    return insideGuild() || distTo(sdk, FISHING_GUILD_SHOP.x, FISHING_GUILD_SHOP.z) < 12;
}

async function leaveGuild(): Promise<void> {
    if (!insideGuild()) return;
    await closeUi(bot, sdk);
    await walkNear(bot, sdk, FISHING_GUILD_DOOR.x, FISHING_GUILD_DOOR.z, 2);
    const door = sdk.findNearbyLoc(/^door$/i) ?? sdk.findNearbyLoc(/guild|door/i);
    if (door) await bot.openDoor(door);
    await sdk.waitForTicks(2).catch(() => {});
    await walkNear(bot, sdk, FISHING_GUILD_DOOR.x + 3, FISHING_GUILD_DOOR.z, 2);
}

async function buyFeathers(need: number): Promise<number> {
    if (need <= 0) return inv(FEATHER);
    await session.setPhase('buy-feathers');
    log(`Need ${need} more feathers — Fishing Guild shop`);
    if (!(await enterGuild())) {
        session.log('warn', 'could not enter fishing guild');
        return inv(FEATHER);
    }
    const opened = await bot.openShop(/^roachey$/i);
    if (!opened.success && !sdk.getState()?.shop?.isOpen) {
        session.log('warn', `Roachey: ${opened.message}`);
        return inv(FEATHER);
    }
    const before = inv(FEATHER);
    let remaining = need;
    while (remaining > 0) {
        const line = sdk.getState()?.shop?.shopItems.find((i) => FEATHER.test(i.name));
        if (!line || (line.count ?? 0) <= 0) {
            session.log('warn', 'Roachey out of feathers');
            break;
        }
        const want = Math.min(1000, remaining, line.count);
        const r = await bot.buyFromShop(line, want);
        log(`Bought feathers: ${r.message} (+${r.amountBought ?? 0})`);
        if ((r.amountBought ?? 0) <= 0) break;
        remaining -= r.amountBought ?? 0;
        session.noteProgress('shop', 'feather');
    }
    await bot.closeShop();
    await leaveGuild();
    log(`Feathers ${before} → ${inv(FEATHER)}`);
    return inv(FEATHER);
}

async function loadSupplies(): Promise<{ tips: number; feathers: number; shafts: number }> {
    log(`Opening Catherby bank @ ${playerPos(sdk).x},${playerPos(sdk).z} bank=${sdk.getState()?.bank?.isOpen} iface=${sdk.getState()?.interface?.interfaceId}`);
    if (bankOpen() && inv(TIPS) === 0 && inv(HEADLESS) === 0 && inv(SHAFT) === 0 && inv(ARROWS) === 0) {
        log('Closing stale bank then reopening via booth');
        await sdk.sendCloseModal();
        await sdk.waitForCondition((s) => !s.bank?.isOpen && s.interface?.interfaceId !== 5292, 8_000).catch(() => {});
    }
    if (!(await openCatherbyBank())) return { tips: inv(TIPS), feathers: inv(FEATHER), shafts: inv(SHAFT) + inv(HEADLESS) };
    log(`Bank open, ${sdk.getBankItems().length} slots`);
    await depositJunk();
    await withdrawOne(KNIFE);
    await withdrawOne(AXE);
    if (inv(COINS) < 4000) {
        const coins = sdk.findBankItem(COINS);
        if (coins) await bot.withdrawItem(coins, 4000);
    }
    await withdrawAll(FEATHER);
    await withdrawAll(SHAFT);
    await withdrawAll(HEADLESS);
    await withdrawAll(TIPS);
    await withdrawAll(LOGS);
    const tips = inv(TIPS);
    const feathers = inv(FEATHER);
    const shafts = inv(SHAFT) + inv(HEADLESS);
    log(
        `Load tips ${tips} feathers ${feathers} shafts ${inv(SHAFT)} headless ${inv(HEADLESS)} logs ${inv(LOGS)} knife=${!!sdk.findInventoryItem(KNIFE)} axe=${!!sdk.findInventoryItem(AXE)}`
    );
    await bot.closeBank();
    return { tips, feathers, shafts };
}

session.registerRecovery([
    {
        name: 'close_ui',
        run: async () => {
            await closeUi(bot, sdk);
            return true;
        }
    }
]);

try {
    await bot.skipTutorial();
    await bot.dismissBlockingUI();
    session.setAnchor(CATHERBY_BANK.x, CATHERBY_BANK.z);
    log(`Fletch rune arrows start @ ${playerPos(sdk).x},${playerPos(sdk).z} Fletching ${sdk.getSkill('Fletching')?.baseLevel}`);

    const start = await loadSupplies();
    if (inv(ARROWS) > 0 && start.tips <= 0 && inv(HEADLESS) <= 0 && inv(SHAFT) <= 0) {
        if (await openCatherbyBank()) {
            for (let i = 0; i < 5 && inv(ARROWS) > 0; i++) {
                const arrows = sdk.findInventoryItem(ARROWS);
                if (!arrows) break;
                log(`Depositing rune arrows slot ${arrows.slot} x${arrows.count}`);
                await sdk.sendBankDeposit(arrows.slot, -1);
                await sdk.waitForCondition(() => inv(ARROWS) === 0, 8_000).catch(() => {});
            }
            await depositJunk();
            log(`Banked leftover rune arrows | bank now ${bankCount(ARROWS)} inv ${inv(ARROWS)}`);
            await bot.closeBank();
        }
    } else if (!sdk.findInventoryItem(KNIFE)) {
        session.stop('script_error', 'no knife in bank or inventory');
    } else if (!sdk.findInventoryItem(AXE) && start.tips > inv(SHAFT) + inv(HEADLESS) + inv(LOGS) * 15) {
        session.stop('script_error', 'no axe to cut trees');
    } else if (start.tips <= 0 && inv(HEADLESS) <= 0 && inv(SHAFT) <= 0) {
        log('No rune arrowtips to fletch');
    } else {
        let tipsLeft = start.tips;
        const feathered = start.feathers + inv(HEADLESS);
        const feathersNeed = Math.max(0, tipsLeft - feathered);
        if (feathersNeed > 0) await buyFeathers(feathersNeed);

        const stillNeedShafts = Math.max(0, tipsLeft - (inv(SHAFT) + inv(HEADLESS)));
        const logsNeeded = Math.ceil(stillNeedShafts / 15) - inv(LOGS);
        if (logsNeeded > 0) {
            await session.setPhase('chop');
            log(`Need ~${stillNeedShafts} shafts (${logsNeeded} more logs) — chopping normal trees`);
            if (distTo(sdk, SEERS_TREES.x, SEERS_TREES.z) > 12 && !sdk.findNearbyLoc(/^tree$/i)) {
                await walkNear(bot, sdk, SEERS_TREES.x, SEERS_TREES.z, 4);
            }
            for (let trip = 0; trip < 12 && inv(SHAFT) + inv(HEADLESS) + inv(LOGS) * 15 < tipsLeft && !session.isStopped(); trip++) {
                const need = Math.min(20, Math.ceil((tipsLeft - inv(SHAFT) - inv(HEADLESS)) / 15) - inv(LOGS));
                await chopLogs(Math.max(1, need));
                await fletchAllLogs();
                if (!sdk.findNearbyLoc(/^tree$/i) && inv(LOGS) === 0 && inv(SHAFT) + inv(HEADLESS) < tipsLeft) {
                    await walkNear(bot, sdk, SEERS_TREES.x, SEERS_TREES.z, 4);
                }
                if (inv(SHAFT) + inv(HEADLESS) >= tipsLeft) break;
            }
        } else {
            await fletchAllLogs();
        }

        await session.setPhase('attach');
        if (distTo(sdk, CATHERBY_BANK.x, CATHERBY_BANK.z) < 4) {
            await walkNear(bot, sdk, 2809, 3434, 2);
        }
        for (let round = 0; round < 6 && (inv(TIPS) > 0 || inv(SHAFT) > 0) && !session.isStopped(); round++) {
            const headless = await combineStacks(SHAFT, FEATHER);
            if (headless > 0) log(`Headless +${headless} (now ${inv(HEADLESS)})`);
            const tipped = await combineStacks(TIPS, HEADLESS);
            if (tipped > 0) {
                log(`Rune arrows +${tipped} (now ${inv(ARROWS)}) | tips left ${inv(TIPS)}`);
            }
            if (inv(TIPS) === 0) break;
            session.log('warn', `attach round ${round + 1} leftover tips ${inv(TIPS)} headless ${inv(HEADLESS)}`);
            await sdk.waitForTicks(2).catch(() => {});
        }

        if (await openCatherbyBank()) {
            const arrows = sdk.findInventoryItem(ARROWS);
            if (arrows) await bot.depositItem(arrows, -1);
            await depositJunk();
            const bankArrows = bankCount(ARROWS);
            const bankTips = bankCount(TIPS);
            log(`Banked. Rune arrows in bank ${bankArrows} | leftover tips ${bankTips + inv(TIPS)}`);
            await bot.closeBank();
            tipsLeft = bankTips + inv(TIPS);
            if (tipsLeft > 0) {
                session.log('warn', `Still have ${tipsLeft} rune arrowtips — missing feathers or shafts`);
            } else {
                log('All rune arrowtips are now rune arrows');
            }
        }
    }
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Script error:', err);
    throw err;
} finally {
    await session.finalizeStop();
    await sdk.disconnect();
}
