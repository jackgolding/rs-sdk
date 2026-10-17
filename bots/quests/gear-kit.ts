/**
 * Dragon-kit staging one-shot: reach a fleet bank from anywhere (Wilderness
 * ditch exit, Zanaris portal + ladder exit, White Wolf crossing included),
 * then for EACH --item= ensure one is worn (already-worn skip, inventory
 * equip, else bank withdraw + equip + verify). Ends holding DONE at the bank
 * for the operator. Quest/stock shortfalls park as DONE lines (no crash
 * loop) so the operator can sort them at the bank:
 *
 *   bun bots/quests/gear-kit.ts ABGARMY09 --bank=varrock-east \
 *     --item='Dragon longsword' --item='Dragonfire shield' \
 *     --item='Dragon vambraces' --item='Dragonhide chaps'
 *
 * Restarts are no-ops per item: worn items are skipped, inventory items are
 * equipped without touching the bank. Leave staged until switched back.
 */
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { appendGrindLog } from '../../sdk/grind-log';
import { inWilderness, type BotSDK } from '../../sdk/index';
import { FLEET_BANKS, type Tile } from './tiles';
import {
    closeUi,
    distTo,
    leaveEdgevilleWilderness,
    playerPos,
    walkKandarinToEdgeville,
    walkNear,
    walkWaypoints
} from './movement';

const positional: string[] = [];
const items: string[] = [];
let bankFlag = 'varrock-east';
for (const a of process.argv.slice(2)) {
    if (a.startsWith('--item=')) items.push(a.slice('--item='.length));
    else if (a.startsWith('--bank=')) bankFlag = a.slice('--bank='.length);
    else if (!a.startsWith('--')) positional.push(a);
}

function canon(name: string): string {
    if (/^abgarmy\d+$/i.test(name)) return name.toUpperCase();
    return name;
}

const botName = canon(positional[0] ?? '');
const KIT = items.length > 0 ? items : ['Dragon longsword', 'Dragonfire shield', 'Dragon vambraces', 'Dragonhide chaps'];
const bankRaw = bankFlag.toLowerCase().replace(/[_\s]+/g, '-').replace(/-bank$/, '');
const MEET_BANK = FLEET_BANKS.find((b) => b.name.toLowerCase().replace(/\s+/g, '-') === bankRaw) ?? null;
if (!MEET_BANK) {
    throw new Error(
        `Unknown --bank=${bankFlag}: valid: ${FLEET_BANKS.map((b) => b.name.toLowerCase().replace(/\s+/g, '-')).join(', ')}`
    );
}
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

if (!botName) {
    throw new Error("Usage: bun bots/quests/gear-kit.ts {name} --bank=NAME --item=NAME [--item=NAME ...]");
}

/** Zanaris exit + White Wolf surface route (from walk-to-varrock-east.ts). */
const ZANARIS_PORTAL: Tile = { x: 3220, z: 9592 };
const ZANARIS_LADDER: Tile = { x: 3222, z: 9588 };
const ZANARIS_EAST_LADDER: Tile = { x: 3254, z: 9590 };
const ZANARIS_EXIT_HOPS: Tile[] = [
    { x: 3196, z: 9568 },
    { x: 3202, z: 9584 },
    { x: 3214, z: 9590 },
    ZANARIS_PORTAL
];
const SHED: Tile = { x: 3203, z: 3169 };
const FROM_WEST: Tile[] = [
    { x: 3088, z: 3490 },
    { x: 3110, z: 3475 },
    { x: 3136, z: 3455 },
    { x: 3164, z: 3438 },
    { x: 3190, z: 3434 },
    { x: 3216, z: 3426 },
    { x: 3240, z: 3422 }
];
const FROM_SOUTH: Tile[] = [
    { x: 3206, z: 3205 },
    { x: 3214, z: 3245 },
    { x: 3220, z: 3285 },
    { x: 3226, z: 3325 },
    { x: 3234, z: 3365 },
    { x: 3244, z: 3400 }
];

const esc = (s: string): RegExp => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

function equippedCount(sdk: BotSDK, rx: RegExp): number {
    return sdk
        .getEquipment()
        .filter((i) => rx.test(i.name))
        .reduce((n, i) => n + (i.count ?? 1), 0);
}

function invCount(sdk: BotSDK, rx: RegExp): number {
    return sdk.getInventory().filter((i) => rx.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
}

function inZanaris(sdk: BotSDK): boolean {
    const p = playerPos(sdk);
    return p.x >= 3050 && p.x <= 3400 && p.z >= 9400 && p.z < 9700;
}

function onSurface(sdk: BotSDK): boolean {
    const p = playerPos(sdk);
    return p.x > 1000 && p.z > 1000 && p.z < 9000;
}

async function hopTo(sdk: BotSDK, tile: Tile): Promise<void> {
    if (distTo(sdk, tile.x, tile.z) <= 3) return;
    await sdk.sendWalk(tile.x, tile.z, true);
    await sdk
        .waitForCondition(
            (state) =>
                Math.hypot((state.player?.worldX ?? 0) - tile.x, (state.player?.worldZ ?? 0) - tile.z) <= 4,
            12_000
        )
        .catch(() => {});
}

async function climbLadder(sdk: BotSDK, tile: Tile): Promise<boolean> {
    await hopTo(sdk, tile);
    await sdk.sendWalk(tile.x, tile.z, true);
    await sdk.waitForTicks(2).catch(() => {});
    await sdk.scanNearbyLocs(6).catch(() => {});
    const ladder = (sdk.getNearbyLocs() ?? [])
        .filter(
            (loc) =>
                /ladder/i.test(loc.name) &&
                Math.hypot(loc.x - tile.x, loc.z - tile.z) <= 3 &&
                (loc.optionsWithIndex ?? []).some((option) => /climb-up|climb.up/i.test(option.text))
        )
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (!ladder) return false;
    const match = (ladder.optionsWithIndex ?? []).find((option) => /climb-up|climb.up/i.test(option.text));
    if (match) await sdk.sendInteractLoc(ladder.x, ladder.z, ladder.id, match.opIndex);
    await sdk.waitForCondition(() => onSurface(sdk), 15_000).catch(() => {});
    await sdk.waitForTicks(3).catch(() => {});
    return onSurface(sdk);
}

async function leaveZanaris(sdk: BotSDK): Promise<boolean> {
    if (onSurface(sdk)) return true;
    if (!inZanaris(sdk)) return onSurface(sdk);
    const here = playerPos(sdk);
    if (here.x >= 3230 && here.z < 9580) {
        await hopTo(sdk, { x: 3220, z: here.z });
    }
    for (const hop of ZANARIS_EXIT_HOPS) {
        if (onSurface(sdk)) return true;
        if (distTo(sdk, ZANARIS_LADDER.x, ZANARIS_LADDER.z) <= 3) break;
        await hopTo(sdk, hop);
    }
    if (await climbLadder(sdk, ZANARIS_LADDER)) return true;
    if (!inZanaris(sdk)) return onSurface(sdk);
    for (const hop of [{ x: 3236, z: 9590 }, { x: 3246, z: 9590 }, ZANARIS_EAST_LADDER]) {
        if (onSurface(sdk)) return true;
        await hopTo(sdk, hop);
    }
    return climbLadder(sdk, ZANARIS_EAST_LADDER);
}

async function stepOutOfShed(sdk: BotSDK): Promise<void> {
    if (!onSurface(sdk) || distTo(sdk, SHED.x, SHED.z) > 20) return;
    for (const hop of [
        { x: 3194, z: 3176 },
        { x: 3194, z: 3196 },
        { x: 3208, z: 3210 }
    ]) {
        if (playerPos(sdk).z >= 3205) return;
        await hopTo(sdk, hop);
    }
}

await runScript(async ({ bot, sdk }) => {
    const log = (level: 'LOG' | 'WARN' | 'ERROR', msg: string) => {
        console.log(`${level} ${msg}`);
        appendGrindLog(GRIND_LOG, `${new Date().toISOString()} ${level} ${msg}`);
    };

    async function idleDone(msg: string): Promise<never> {
        log('LOG', `DONE ${msg}`);
        for (;;) {
            await sdk.waitForTicks(600).catch(() => {});
            log('LOG', `DONE holding: ${msg}`);
        }
        throw new Error('unreachable');
    }

    await closeUi(bot, sdk);
    const start = playerPos(sdk);
    if (inWilderness(start.x, start.z)) {
        log('LOG', `Leaving wilderness from ${start.x},${start.z} before banking`);
        await leaveEdgevilleWilderness(sdk).catch((e) => log('WARN', `wildy exit: ${e instanceof Error ? e.message : String(e)}`));
    }
    if (inZanaris(sdk)) {
        log('LOG', `Leaving Zanaris from ${start.x},${start.z} before banking`);
        const out = await leaveZanaris(sdk).catch(() => false);
        if (!out && inZanaris(sdk)) throw new Error(`Still in Zanaris @ ${playerPos(sdk).x},${playerPos(sdk).z} — holding, operator check needed`);
        await stepOutOfShed(sdk);
    }
    const surfaced = playerPos(sdk);
    if (surfaced.z < 9000 && surfaced.x < 2990) {
        await walkKandarinToEdgeville(bot, sdk, { eat: async () => {} }).catch(() => false);
    }
    const here = playerPos(sdk);
    if (here.z < 9000 && Math.hypot(here.x - MEET_BANK.x, here.z - MEET_BANK.z) > 60) {
        const route = here.z < 3300 ? FROM_SOUTH : FROM_WEST;
        await walkWaypoints(bot, sdk, [...route, { x: MEET_BANK.x, z: MEET_BANK.z }]).catch(() => false);
    }
    await walkNear(bot, sdk, MEET_BANK.x, MEET_BANK.z, 6);

    const worn: string[] = [];
    const short: string[] = [];
    for (const itemLabel of KIT) {
        const rx = esc(itemLabel);
        if (equippedCount(sdk, rx) >= 1) {
            log('LOG', `Kit ${itemLabel}: already worn — skip`);
            worn.push(itemLabel);
            continue;
        }
        if (invCount(sdk, rx) < 1) {
            if (!(sdk.isBankOpen() || (await bot.openBank()).success)) {
                throw new Error(`Bank did not open at ${MEET_BANK.name} (needed ${itemLabel})`);
            }
            const bankStock: number = sdk
                .getBankItems()
                .filter((i) => rx.test(i.name))
                .reduce((n, i) => n + (i.count ?? 0), 0);
            if (bankStock < 1) {
                await closeUi(bot, sdk);
                log('LOG', `Kit ${itemLabel}: short bank=${bankStock} inv=0 — operator sort`);
                short.push(`${itemLabel} (no stock)`);
                continue;
            }
            const w = await bot.withdrawItem(rx, 1);
            if (!w.success && !w.partial) throw new Error(`Withdraw 1 ${itemLabel} failed: ${w.message}`);
            log('LOG', `Withdrew ${itemLabel} inv=${invCount(sdk, rx)} (${w.message})`);
            await closeUi(bot, sdk);
        }
        const target = sdk.findInventoryItem(rx);
        if (!target) {
            log('LOG', `Kit ${itemLabel}: not in inventory after withdraw — operator sort`);
            short.push(`${itemLabel} (not in inv)`);
            continue;
        }
        const eq = await bot.equipItem(rx);
        if (!eq.success) {
            log('LOG', `Kit ${itemLabel}: CANNOT-WIELD ${eq.message} — needs quest/level, operator sort`);
            short.push(`${itemLabel} (cannot wield)`);
            continue;
        }
        await sdk.waitForTicks(1);
        if (equippedCount(sdk, rx) < 1) {
            throw new Error(`Equip ${itemLabel} UNVERIFIED: nothing matching in equipment — holding, operator check needed`);
        }
        log('LOG', `Kit ${itemLabel}: wearing now`);
        worn.push(itemLabel);
    }
    if (sdk.isBankOpen()) await closeUi(bot, sdk);
    const at = playerPos(sdk);
    const summary = `kit bank=${MEET_BANK.name} @ ${at.x},${at.z} worn=[${worn.join('|') || 'none'}]${short.length > 0 ? ` SHORT=[${short.join('|')}]` : ''}`;
    return idleDone(summary);
});
