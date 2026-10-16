#!/usr/bin/env bun
/**
 * Walk roster accounts to the Varrock east bank (3253, 3420).
 *
 * Leaves Zanaris through the north portal, climbs down to the ground floor,
 * and crosses White Wolf from Kandarin. One-shot: it does not edit the roster.
 *
 *   bun bots/quests/walk-to-varrock-east.ts --except Jackpoo2 jackthief
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { rosterBots, ROOT } from '../../.cursor/skills/wake-fleet/scripts/roster';
import {
    closeUi,
    distTo,
    playerPos,
    walkKandarinToEdgeville,
    walkNear,
    walkWaypoints
} from './movement';
import { VARROCK_EAST_BANK, VARROCK_WEST_BANK, type Tile } from './tiles';

/** `--west` walks to the Varrock west bank instead of east. */
const BANK = process.argv.includes('--west') ? VARROCK_WEST_BANK : VARROCK_EAST_BANK;
const ZANARIS_PORTAL: Tile = { x: 3220, z: 9592 };
/** Climb-up just south of the arrival tile. The market doors are further south. */
const ZANARIS_LADDER: Tile = { x: 3222, z: 9588 };
/** North edge, east of the market, if the west ladder does not leave. */
const ZANARIS_EAST_LADDER: Tile = { x: 3254, z: 9590 };
/** West of the market toll doors (3233 and 3238). walkTo routes through them. */
const ZANARIS_EXIT_HOPS: Tile[] = [
    { x: 3196, z: 9568 },
    { x: 3202, z: 9584 },
    { x: 3214, z: 9590 },
    ZANARIS_PORTAL
];
const SHED: Tile = { x: 3203, z: 3169 };
const PER_BOT_MS = 25 * 60_000;
/** Space logins so the gateway accepts them. Everyone walks at the same time. */
const LOGIN_GAP_MS = 250;

const FROM_WEST: Tile[] = [
    { x: 3088, z: 3490 },
    { x: 3110, z: 3475 },
    { x: 3136, z: 3455 },
    { x: 3164, z: 3438 },
    { x: 3190, z: 3434 },
    { x: 3216, z: 3426 },
    { x: 3240, z: 3422 },
    BANK
];

const FROM_SOUTH: Tile[] = [
    { x: 3206, z: 3205 },
    { x: 3214, z: 3245 },
    { x: 3220, z: 3285 },
    { x: 3226, z: 3325 },
    { x: 3234, z: 3365 },
    { x: 3244, z: 3400 },
    BANK
];

type Result = { name: string; status: 'arrived' | 'failed'; detail: string };

function onlyNames(): string[] {
    const index = process.argv.indexOf('--only');
    if (index < 0) return [];
    const names: string[] = [];
    for (let i = index + 1; i < process.argv.length; i++) {
        const arg = process.argv[i]!;
        if (arg.startsWith('--')) break;
        names.push(arg.toLowerCase());
    }
    return names;
}

function exceptNames(): Set<string> {
    const index = process.argv.indexOf('--except');
    if (index < 0) return new Set();
    const names: string[] = [];
    for (let i = index + 1; i < process.argv.length; i++) {
        const arg = process.argv[i]!;
        if (arg.startsWith('--')) break;
        names.push(arg.toLowerCase());
    }
    return new Set(names);
}

function loadEnv(name: string): Record<string, string> {
    const path = join(ROOT, 'bots', name, 'bot.env');
    if (!existsSync(path)) throw new Error(`Missing bot.env for ${name}`);
    const env: Record<string, string> = {};
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const equals = trimmed.indexOf('=');
        if (equals > 0) env[trimmed.slice(0, equals).trim()] = trimmed.slice(equals + 1).trim();
    }
    return env;
}

function inZanaris(sdk: BotSDK): boolean {
    const p = playerPos(sdk);
    return p.x >= 3050 && p.x <= 3400 && p.z >= 9400 && p.z < 9700;
}

function atBank(sdk: BotSDK): boolean {
    const p = playerPos(sdk);
    return p.z < 9000 && distTo(sdk, BANK.x, BANK.z) <= 8;
}

async function eat(bot: BotActions, sdk: BotSDK): Promise<void> {
    const player = sdk.getState()?.player;
    if (!player || player.hp >= player.maxHp - 4) return;
    const food = sdk.findInventoryItem(
        /shark|lobster|swordfish|tuna|salmon|trout|bass|herring|sardine|shrimp|anchov|bread|cake|meat|pie|stew|pizza|karambwan|monkfish|chicken|kebab|wine/i
    );
    if (food) await bot.eatFood(food);
}

async function climbDown(bot: BotActions, sdk: BotSDK): Promise<void> {
    for (let i = 0; i < 8; i++) {
        const level = sdk.getState()?.player?.level ?? 0;
        if (level <= 0) return;
        await closeUi(bot, sdk);
        await sdk.scanNearbyLocs(16).catch(() => {});
        const stairs = (sdk.getNearbyLocs() ?? [])
            .filter(
                (loc) =>
                    /stair|ladder/i.test(loc.name) &&
                    (loc.optionsWithIndex ?? []).some((option) => /climb-down|climb.down/i.test(option.text))
            )
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!stairs) {
            const p = playerPos(sdk);
            await sdk.sendWalk(p.x + (i % 2 === 0 ? 3 : -3), p.z, true);
            await sdk.waitForTicks(2).catch(() => {});
            continue;
        }
        if ((stairs.distance ?? 99) > 2) await walkNear(bot, sdk, stairs.x, stairs.z, 1);
        await bot.interactLoc(stairs, /climb-down|climb.down/i);
        await sdk.waitForCondition((state) => (state.player?.level ?? 1) < level, 8_000).catch(() => {});
    }
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

function onSurface(sdk: BotSDK): boolean {
    const p = playerPos(sdk);
    return p.x > 1000 && p.z > 1000 && p.z < 9000;
}

async function climbLadder(name: string, sdk: BotSDK, tile: Tile): Promise<boolean> {
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
    if (!ladder) {
        console.log(`[zanaris] ${name} no ladder @ ${playerPos(sdk).x},${playerPos(sdk).z} (want ${tile.x},${tile.z})`);
        return false;
    }
    const match = (ladder.optionsWithIndex ?? []).find((option) => /climb-up|climb.up/i.test(option.text));
    console.log(`[zanaris] ${name} climbing ${ladder.name} @ ${ladder.x},${ladder.z} from ${playerPos(sdk).x},${playerPos(sdk).z}`);
    if (match) await sdk.sendInteractLoc(ladder.x, ladder.z, ladder.id, match.opIndex);
    await sdk.waitForCondition(() => onSurface(sdk), 15_000).catch(() => {});
    await sdk.waitForTicks(3).catch(() => {});
    const landed = playerPos(sdk);
    console.log(`[zanaris] ${name} after climb ${landed.x},${landed.z}`);
    return onSurface(sdk);
}

async function leaveZanaris(name: string, bot: BotActions, sdk: BotSDK): Promise<boolean> {
    if (onSurface(sdk)) return true;
    if (!inZanaris(sdk)) return onSurface(sdk);
    console.log(`[zanaris] ${name} leaving from ${playerPos(sdk).x},${playerPos(sdk).z}`);
    await closeUi(bot, sdk);
    const here = playerPos(sdk);
    if (here.x >= 3230 && here.z < 9580) {
        await hopTo(sdk, { x: 3220, z: here.z });
    }
    for (const hop of ZANARIS_EXIT_HOPS) {
        if (onSurface(sdk)) return true;
        if (distTo(sdk, ZANARIS_LADDER.x, ZANARIS_LADDER.z) <= 3) break;
        await hopTo(sdk, hop);
    }
    if (await climbLadder(name, sdk, ZANARIS_LADDER)) return true;
    if (!inZanaris(sdk)) return onSurface(sdk);
    for (const hop of [
        { x: 3236, z: 9590 },
        { x: 3246, z: 9590 },
        ZANARIS_EAST_LADDER
    ]) {
        if (onSurface(sdk)) return true;
        await hopTo(sdk, hop);
    }
    return climbLadder(name, sdk, ZANARIS_EAST_LADDER);
}

/**
 * The shed door is the Zanaris entrance while a dramen staff is worn.
 * Walk around it. Do not click Open.
 */
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

async function waitAlive(sdk: BotSDK): Promise<void> {
    if (!sdk.getState()?.player?.isDead) return;
    await sdk
        .waitForCondition((state) => !!state.player && !state.player.isDead && state.player.worldZ < 9000, 25_000)
        .catch(() => {});
}

async function walkToBank(name: string, bot: BotActions, sdk: BotSDK): Promise<Result> {
    await closeUi(bot, sdk);
    await climbDown(bot, sdk);
    if (!(await leaveZanaris(name, bot, sdk))) {
        const p = playerPos(sdk);
        return { name, status: 'failed', detail: `still in Zanaris @ ${p.x},${p.z}` };
    }
    await stepOutOfShed(sdk);
    await waitAlive(sdk);

    const start = playerPos(sdk);
    if (start.z >= 9000) {
        return { name, status: 'failed', detail: `still underground @ ${start.x},${start.z}` };
    }
    if (atBank(sdk)) return { name, status: 'arrived', detail: `${start.x},${start.z}` };

    if (start.x < 2990) {
        console.log(`[kandarin] ${name} crossing from ${start.x},${start.z}`);
        await walkKandarinToEdgeville(bot, sdk, { eat: () => eat(bot, sdk) });
        await waitAlive(sdk);
    }

    const here = playerPos(sdk);
    if (here.z >= 9000 || here.x < 2900) {
        return { name, status: 'failed', detail: `did not reach Misthalin @ ${here.x},${here.z}` };
    }
    if (atBank(sdk)) return { name, status: 'arrived', detail: `${here.x},${here.z}` };

    const route = here.z < 3300 ? FROM_SOUTH : FROM_WEST;
    console.log(`[walk] ${name} ${here.x},${here.z} -> Varrock east`);
    await walkWaypoints(bot, sdk, route, { beforeStep: () => eat(bot, sdk) });
    await waitAlive(sdk);
    if (!atBank(sdk)) await walkNear(bot, sdk, BANK.x, BANK.z, 4);

    const end = playerPos(sdk);
    if (atBank(sdk)) return { name, status: 'arrived', detail: `${end.x},${end.z}` };
    return { name, status: 'failed', detail: `stopped @ ${end.x},${end.z}` };
}

async function moveBot(name: string): Promise<Result> {
    const env = loadEnv(name);
    const sdk = new BotSDK({
        botUsername: env.BOT_USERNAME || name,
        password: env.PASSWORD || '',
        gatewayUrl: env.GATEWAY_URL || deriveGatewayUrl(env.SERVER || 'rs-sdk-demo.fly.dev'),
        connectionMode: 'control',
        autoReconnect: false,
        autoLaunchBrowser: false,
        showChat: false,
        connectTimeout: 20_000,
        readyTimeout: 15_000
    });
    const killer = setTimeout(() => {
        sdk.disconnect().catch(() => {});
    }, PER_BOT_MS);
    try {
        await sdk.connect();
        const bot = new BotActions(sdk);
        const result = await walkToBank(name, bot, sdk);
        console.log(`RESULT ${result.name} ${result.status} ${result.detail}`);
        return result;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`RESULT ${name} failed ${message}`);
        return { name, status: 'failed', detail: message };
    } finally {
        clearTimeout(killer);
        await sdk.disconnect().catch(() => {});
    }
}

const skip = exceptNames();
const only = onlyNames();
const names = rosterBots()
    .map((bot) => bot.name)
    .filter((name) => !skip.has(name.toLowerCase()))
    .filter((name) => only.length === 0 || only.includes(name.toLowerCase()));

console.log(`Walking ${names.length} bots to Varrock east (${BANK.x}, ${BANK.z}), except ${[...skip].join(', ') || 'nobody'}`);
initPathfinding();

console.log(`Starting all ${names.length} together`);
const results = await Promise.all(
    names.map(async (name, index) => {
        if (index > 0) await Bun.sleep(index * LOGIN_GAP_MS);
        return moveBot(name);
    })
);

const arrived = results.filter((result) => result.status === 'arrived');
const failed = results.filter((result) => result.status === 'failed');
console.log(`\n${arrived.length} arrived, ${failed.length} failed`);
for (const result of failed) console.log(`  ${result.name}: ${result.detail}`);
