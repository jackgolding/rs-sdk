/**
 * Cook all raw food in bank and inventory at the Catherby range.
 *
 *   bun bots/quests/catherby-cook-bank.ts jacklove1
 */
import { ActivitySession, BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { playerPos, closeUi } from './movement';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { installGracefulShutdown } from '../../sdk/runner';

const CATHERBY_BANK_STREET = { x: 2809, z: 3441 };
const RANGE_OUTSIDE = { x: 2816, z: 3438 };
const RANGE_DOORWAY = { x: 2816, z: 3440 };
const RANGE_STAND = { x: 2816, z: 3443 };

const RAW_PATTERN = /^raw /i;
const COOKED_PATTERN = /^(tuna|swordfish|lobster|shark|shrimps?|anchovies|cod|bass|salmon|trout|pike|herring|sardine|mackerel|cooked meat)/i;
const BURNT_PATTERN = /^burnt /i;

const argv = process.argv.slice(2);
const botArg = argv.find((a) => !a.startsWith('-'));
if (!botArg) throw new Error('Usage: bun bots/quests/catherby-cook-bank.ts {botname}');

function loadBotEnv(): void {
    const envPath = join(process.cwd(), 'bots', botArg!, 'bot.env');
    if (!existsSync(envPath)) {
        throw new Error(`bot.env not found at ${envPath}`);
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

const gatewayUrl = deriveGatewayUrl(server);
const sdk = new BotSDK({
    botUsername: username,
    gatewayUrl,
    password,
    autoReconnect: false,
    autoLaunchBrowser: false
});
const bot = new BotActions(sdk);

const session = new ActivitySession(sdk, bot, {
    name: 'catherby-cook',
    writeLog: (line: string) => {
        try {
            const path = join(process.cwd(), 'bots', username, 'grind.log');
            appendFileSync(path, `${line}\n`);
        } catch {
            /* ignore */
        }
    },
    heartbeatIntervalMs: 60_000,
    progressTimeoutMs: 300_000,
    failureThresholds: { door_jam: 10, walk_fail: 10 }
});

installGracefulShutdown({ graceMs: 30_000 });

const log = (msg: string) => session.log('log', msg);

function distTo(x: number, z: number): number {
    const p = playerPos(sdk);
    return Math.hypot(p.x - x, p.z - z);
}

async function walkToTile(x: number, z: number, tolerance = 1): Promise<void> {
    for (let step = 0; step < 8; step++) {
        if (distTo(x, z) <= tolerance) break;
        await sdk.sendWalk(x, z, true);
        await sdk.waitForTicks(2).catch(() => {});
    }
}

async function handleDoorIfClosed(): Promise<void> {
    const door = (sdk.getNearbyLocs() ?? []).find(
        (l) => /door/i.test(l.name) && (l.distance ?? 99) <= 3 && (l.options ?? []).some((o) => /^open$/i.test(o))
    );
    if (!door) return;
    const openOpt = door.optionsWithIndex?.find((o) => /^open$/i.test(o.text)) ?? { opIndex: 1 };
    log(`Opening closed door at (${door.x}, ${door.z}) id=${door.id}`);
    await sdk.sendInteractLoc(door.x, door.z, door.id, openOpt.opIndex);
    await sdk.waitForTicks(2).catch(() => {});
}

async function goToRange(): Promise<boolean> {
    const p = playerPos(sdk);
    if (distTo(RANGE_STAND.x, RANGE_STAND.z) > 1) {
        if (distTo(RANGE_OUTSIDE.x, RANGE_OUTSIDE.z) > 2) {
            await walkToTile(RANGE_OUTSIDE.x, RANGE_OUTSIDE.z, 1);
        }
        await handleDoorIfClosed();
        await walkToTile(RANGE_DOORWAY.x, RANGE_DOORWAY.z, 1);
        await walkToTile(RANGE_STAND.x, RANGE_STAND.z, 1);
    }
    const range = (sdk.getNearbyLocs() ?? []).find((l) => /^range$/i.test(l.name));
    return !!range;
}

async function leaveRangeToBank(): Promise<void> {
    const p = playerPos(sdk);
    if (p.x >= 2814 && p.x <= 2820 && p.z >= 3440 && p.z <= 3446) {
        await walkToTile(RANGE_DOORWAY.x, RANGE_DOORWAY.z, 1);
        await handleDoorIfClosed();
        await walkToTile(RANGE_OUTSIDE.x, RANGE_OUTSIDE.z, 1);
    }
    await walkToTile(CATHERBY_BANK_STREET.x, CATHERBY_BANK_STREET.z, 2);
}

async function openCatherbyBank(): Promise<boolean> {
    await closeUi(bot, sdk);
    if (sdk.getState()?.bank?.isOpen) return true;

    if (distTo(CATHERBY_BANK_STREET.x, CATHERBY_BANK_STREET.z) > 3) {
        await leaveRangeToBank();
    }

    const booth = (sdk.getNearbyLocs() ?? [])
        .filter((l) => /bank booth/i.test(l.name) && (l.optionsWithIndex?.length ?? 0) > 0)
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];

    if (booth) {
        const opt = booth.optionsWithIndex.find((o) => /use.quickly/i.test(o.text)) ?? booth.optionsWithIndex[0];
        if (opt) {
            log(`Interacting with bank booth @ (${booth.x}, ${booth.z})`);
            await sdk.sendInteractLoc(booth.x, booth.z, booth.id, opt.opIndex);
            await sdk.waitForCondition((s) => s.bank?.isOpen === true || s.interface?.interfaceId === 5292, 6000).catch(() => {});
        }
    }

    if (!sdk.getState()?.bank?.isOpen) {
        const opened = await bot.openBank(6000);
        if (!opened.success && !sdk.getState()?.bank?.isOpen) {
            return false;
        }
    }

    if (sdk.getState()?.bank?.noteMode) {
        await sdk.sendClickComponent(5387);
        await sdk.waitForTicks(2).catch(() => {});
    }
    return true;
}

function countItems(pat: RegExp): number {
    return (sdk.getInventory() ?? []).filter((i) => pat.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
}

function cookingXp(): number {
    return sdk.getSkill('Cooking')?.experience ?? 0;
}

async function cookCurrentInventory(): Promise<{ cooked: number; burnt: number; xp: number }> {
    const startXp = cookingXp();
    const startBurnt = countItems(BURNT_PATTERN);
    const startCooked = countItems(COOKED_PATTERN);

    if (countItems(RAW_PATTERN) === 0) {
        return { cooked: 0, burnt: 0, xp: 0 };
    }

    if (!(await goToRange())) {
        log('Failed to reach Catherby range');
        return { cooked: 0, burnt: 0, xp: 0 };
    }

    let idleAttempts = 0;
    while (countItems(RAW_PATTERN) > 0 && idleAttempts < 30) {
        try {
            if (sdk.getTradeState()?.isOpen) {
                await bot.declineTrade().catch(() => {});
            }
            await closeUi(bot, sdk);

            if (distTo(RANGE_STAND.x, RANGE_STAND.z) > 1) {
                await handleDoorIfClosed();
                await walkToTile(RANGE_DOORWAY.x, RANGE_DOORWAY.z, 1);
                await walkToTile(RANGE_STAND.x, RANGE_STAND.z, 1);
            }

            const rawItem = (sdk.getInventory() ?? []).find((i) => RAW_PATTERN.test(i.name) && (i.count ?? 0) > 0);
            const range = (sdk.getNearbyLocs() ?? []).find((l) => /^range$/i.test(l.name));
            if (!rawItem || !range) {
                idleAttempts++;
                if (!(await goToRange())) break;
                continue;
            }

            const xpBefore = cookingXp();
            const rawCountBefore = countItems(RAW_PATTERN);

            await sdk.sendUseItemOnLoc(rawItem.slot, range.x, range.z, range.id);

            try {
                await sdk.waitForCondition((s) => {
                    const xp = s.skills.find((sk) => sk.name === 'Cooking')?.experience ?? 0;
                    if (xp > xpBefore) return true;
                    const rawNow = s.inventory.filter((i) => RAW_PATTERN.test(i.name)).reduce((n, i) => n + i.count, 0);
                    return rawNow < rawCountBefore;
                }, 3000);
            } catch {}

            const rawCountAfter = countItems(RAW_PATTERN);
            if (rawCountAfter < rawCountBefore || cookingXp() > xpBefore) {
                log(`Cooked 1 ${rawItem.name} | raw left in inv: ${rawCountAfter}`);
                idleAttempts = 0;
            } else {
                idleAttempts++;
                await sdk.waitForTicks(1).catch(() => {});
            }
        } catch (itemErr) {
            log(`Item cook error: ${itemErr}`);
            await sdk.waitForTicks(2).catch(() => {});
        }
    }

    return {
        cooked: countItems(COOKED_PATTERN) - startCooked,
        burnt: countItems(BURNT_PATTERN) - startBurnt,
        xp: cookingXp() - startXp
    };
}

try {
    await sdk.connect();
    log(`Starting Catherby bank cooking for ${username}...`);
    let totalCooked = 0;
    let totalBurnt = 0;
    const initialStartXp = cookingXp();

    while (true) {
        try {
            const rawInInv = countItems(RAW_PATTERN);
            if (rawInInv > 0) {
                log(`Cooking ${rawInInv} raw items from inventory...`);
                const res = await cookCurrentInventory();
                totalCooked += res.cooked;
                totalBurnt += res.burnt;
                session.noteProgress('cooking', `cooked=${res.cooked} burnt=${res.burnt}`);
                log(`Batch complete: +${res.cooked} cooked, +${res.burnt} burnt, +${res.xp} XP (Total Cooked: ${totalCooked})`);
            }

            log(`Opening Catherby bank...`);
            const bankOpened = await openCatherbyBank();
            if (!bankOpened) {
                log(`Failed to open bank, retrying...`);
                await sdk.waitForTicks(3).catch(() => {});
                continue;
            }

            const inv = sdk.getInventory() ?? [];
            for (const item of inv) {
                if (COOKED_PATTERN.test(item.name) || BURNT_PATTERN.test(item.name)) {
                    await bot.depositItem(item.name, -1).catch(() => {});
                }
            }

            const bankItems = sdk.getBankItems() ?? [];
            const rawBankItems = bankItems.filter((i) => RAW_PATTERN.test(i.name) && (i.count ?? 0) > 0);

            if (rawBankItems.length === 0 && countItems(RAW_PATTERN) === 0) {
                log(`No more raw food in bank or inventory! All done.`);
                break;
            }

            const rawToWithdraw = rawBankItems[0];
            if (rawToWithdraw) {
                log(`Withdrawing ${rawToWithdraw.name} (bank has ${rawToWithdraw.count})...`);
                await bot.withdrawItem(rawToWithdraw.name, -1).catch(() => {});
            }

            await bot.closeBank();
            await sdk.waitForTicks(2).catch(() => {});

            if (countItems(RAW_PATTERN) === 0) {
                log(`Nothing withdrawn, finishing.`);
                break;
            }
        } catch (loopErr) {
            log(`Recoverable error: ${loopErr}`);
            if (!sdk.isConnected()) {
                break;
            }
            await sdk.waitForTicks(3).catch(() => {});
        }
    }

    const netXp = cookingXp() - initialStartXp;
    log(`FINISHED ALL COOKING! Total Cooked: ${totalCooked}, Burnt: ${totalBurnt}, XP Gained: ${netXp}`);
    session.stop('complete', `cooked ${totalCooked} burnt ${totalBurnt}`);
    process.exit(0);
} catch (err) {
    session.stop('script_error', err instanceof Error ? err.message : String(err));
    console.error('Cooking script error:', err);
} finally {
    await session.finalizeStop();
    await sdk.disconnect();
}
