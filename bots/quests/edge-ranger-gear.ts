#!/usr/bin/env bun
/**
 * ABGARMY01 holds the noted magic shortbows and dragonfire shields and
 * meets the other rangers at Edgeville. Each other ranger gets 50 shortbows.
 * A shield goes to a ranger who does not already have one, leaving ABGARMY01 one.
 *
 *   bun bots/quests/edge-ranger-gear.ts
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import type { TradeItemSpec } from '../../sdk/types';
import { inWilderness } from '../../sdk/regions';
import { rosterBots, ROOT } from '../../.cursor/skills/wake-fleet/scripts/roster';
import { closeUi, playerPos, walkNear, walkSendHops } from './movement';
import { initPathfinding } from '../../sdk/pathfinding';

const EDGE = { x: 3094, z: 3492 };
const LADDER = { x: 3096, z: 9867 };
const GATE = { x: 3103, z: 9909 };
const SHORT = /^magic shortbow$/i;
const SHIELD = /dragonfire shield|anti-dragon/i;
const BOWS = 50;

type Client = { name: string; sdk: BotSDK; bot: BotActions };

function loadEnv(name: string): Record<string, string> {
    const path = join(ROOT, 'bots', name, 'bot.env');
    if (!existsSync(path)) throw new Error(`Missing bot.env for ${name}`);
    const env: Record<string, string> = {};
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return env;
}

async function connect(name: string): Promise<Client> {
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
    await sdk.connect();
    return { name, sdk, bot: new BotActions(sdk) };
}

function countOf(sdk: BotSDK, pattern: RegExp): number {
    return sdk.getInventory().filter((item) => pattern.test(item.name)).reduce((sum, item) => sum + (item.count ?? 0), 0);
}

function freeSlots(sdk: BotSDK): number {
    return 28 - sdk.getInventory().filter((item) => (item.count ?? 0) > 0).length;
}

function holdingShield(sdk: BotSDK): boolean {
    if (countOf(sdk, SHIELD) > 0) return true;
    return (sdk.getState()?.equipment ?? []).some((item) => SHIELD.test(item.name ?? '') && (item.count ?? 0) > 0);
}

async function stopGrind(name: string): Promise<void> {
    const proc = Bun.spawn(['bun', '.cursor/skills/wake-fleet/scripts/fleet-launchd.ts', 'stop', name], {
        stdout: 'ignore',
        stderr: 'ignore'
    });
    await proc.exited;
}

async function makeRoom(bot: BotActions, sdk: BotSDK, needed: number): Promise<string[]> {
    if (freeSlots(sdk) >= needed) return [];
    const opened = await bot.openBank();
    if (!opened.success && sdk.getState()?.bank?.isOpen !== true) return [];
    const parked: string[] = [];
    while (freeSlots(sdk) < needed) {
        const item = sdk.getInventory().find((entry) => (entry.count ?? 0) > 0 && !SHIELD.test(entry.name) && !SHORT.test(entry.name) && !/^rune pickaxe$/i.test(entry.name));
        if (!item) break;
        const moved = await bot.depositItem(item, -1);
        if (!moved.success) break;
        parked.push(`${item.name} x${item.count}`);
        await sdk.waitForTicks(1).catch(() => {});
    }
    await bot.closeBank();
    return parked;
}

async function bankHasShield(bot: BotActions, sdk: BotSDK): Promise<boolean> {
    if (holdingShield(sdk)) return true;
    const opened = await bot.openBank();
    if (!opened.success && sdk.getState()?.bank?.isOpen !== true) return false;
    const found = sdk.getBankItems().some((item) => SHIELD.test(item.name) && item.count > 0);
    await bot.closeBank();
    return found;
}

async function leaveDungeon(bot: BotActions, sdk: BotSDK): Promise<void> {
    const pos = () => playerPos(sdk);
    if (pos().z < 9000) return;
    if (pos().z >= GATE.z) {
        await walkNear(bot, sdk, GATE.x, GATE.z - 4, 3);
        const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
        if (gate) await bot.openDoor(gate);
    }
    await walkNear(bot, sdk, LADDER.x, LADDER.z, 3);
    const ladder = sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-up/i });
    if (ladder) await bot.interactLoc(ladder, /climb-up/i);
    await sdk.waitForCondition((s) => (s.player?.worldZ ?? 9999) < 9000, 20_000).catch(() => {});
}

async function toEdge(bot: BotActions, sdk: BotSDK): Promise<void> {
    await closeUi(bot, sdk);
    if (playerPos(sdk).z > 9000) await leaveDungeon(bot, sdk);
    const after = playerPos(sdk);
    if (inWilderness(after.x, after.z)) {
        const hops = [];
        let z = after.z;
        const x = after.x;
        while (z >= 3520) {
            z = Math.max(3516, z - 12);
            hops.push({ x, z });
        }
        hops.push({ x: 3088, z: 3516 }, EDGE);
        await walkSendHops(sdk, hops, EDGE, 4);
    }
    if (Math.hypot(playerPos(sdk).x - EDGE.x, playerPos(sdk).z - EDGE.z) > 8) {
        await walkNear(bot, sdk, EDGE.x, EDGE.z, 3);
    }
}

async function give(giver: Client, partner: Client, specs: TradeItemSpec[]): Promise<string> {
    if (giver.sdk.getTradeState().isOpen) await Promise.race([giver.bot.declineTrade(), Bun.sleep(6_000)]);
    const serve = partner.bot.serveTrades({
        from: /abgarmy01/i,
        maxTrades: 1,
        timeout: 70_000,
        tradeTimeout: 40_000,
        want: specs.map((spec) => ({ item: spec.item, amount: spec.amount }))
    }).catch((err: unknown) => ({ message: err instanceof Error ? err.message : String(err) }));
    await Bun.sleep(1_500);
    const sent = await giver.bot.trade(partner.name, {
        give: specs,
        timeout: 40_000,
        requestTimeout: 15_000,
        retryOnBusy: true
    });
    await Promise.race([serve, Bun.sleep(8_000)]);
    const gave = (sent.gave ?? []).map((item) => `${item.name} x${item.count}`).join(', ');
    return `${sent.success ? 'ok' : 'FAIL'} ${sent.message} | gave [${gave}]`;
}

const rangers = rosterBots()
    .filter((bot) => bot.script.includes('wildy-range') && bot.name.toLowerCase() !== 'abgarmy01')
    .map((bot) => bot.name)
    .sort((a, b) => a.localeCompare(b));

initPathfinding();
await stopGrind('ABGARMY01');
let giver = await connect('ABGARMY01');
try {
    await walkNear(giver.bot, giver.sdk, EDGE.x, EDGE.z, 4);
} catch (err) {
    console.log(`[army] walk ${err instanceof Error ? err.message : err}`);
    if (!giver.sdk.getState()) {
        await giver.sdk.disconnect().catch(() => {});
        await stopGrind('ABGARMY01');
        giver = await connect('ABGARMY01');
    }
}
let shields = countOf(giver.sdk, SHIELD);
let bows = countOf(giver.sdk, SHORT);
console.log(`[army] @ ${playerPos(giver.sdk).x},${playerPos(giver.sdk).z} shortbow x${bows} dragonfire shield x${shields}`);
console.log(`[rangers] ${rangers.length}: ${rangers.join(', ')}`);

const summary: string[] = [];
for (const name of rangers) {
    await stopGrind(name);
    let partner: Client | null = null;
    try {
        if (!giver.sdk.getState() || giver.sdk.getStateAge() > 8_000) {
            await giver.sdk.disconnect().catch(() => {});
            giver = await connect('ABGARMY01');
            shields = countOf(giver.sdk, SHIELD);
            bows = countOf(giver.sdk, SHORT);
        }
        partner = await connect(name);
        await toEdge(partner.bot, partner.sdk);
        const gap = Math.hypot(playerPos(partner.sdk).x - playerPos(giver.sdk).x, playerPos(partner.sdk).z - playerPos(giver.sdk).z);
        if (gap > 12) {
            summary.push(`${name}: still ${Math.round(gap)} tiles away @ ${playerPos(partner.sdk).x},${playerPos(partner.sdk).z}`);
            continue;
        }
        const hasShield = await bankHasShield(partner.bot, partner.sdk);
        const giveShield = !hasShield && shields > 1;
        const giveBows = countOf(partner.sdk, SHORT) >= BOWS ? 0 : Math.min(BOWS, Math.max(0, bows - BOWS));
        if (giveBows <= 0 && !giveShield) {
            summary.push(`${name}: nothing left to give`);
            continue;
        }
        const needs = (countOf(partner.sdk, SHORT) === 0 && giveBows > 0 ? 1 : 0) + (giveShield ? 1 : 0);
        const parked = await makeRoom(partner.bot, partner.sdk, needs);
        if (freeSlots(partner.sdk) < needs) {
            summary.push(`${name}: no room`);
            continue;
        }
        const specs: TradeItemSpec[] = [];
        if (giveBows > 0) specs.push({ item: SHORT, amount: giveBows });
        if (giveShield) specs.push({ item: SHIELD, amount: 1 });
        console.log(`[trade] ${name} shortbow x${giveBows}${giveShield ? ' + shield' : ''}${parked.length ? ` parked ${parked.join(', ')}` : ''}`);
        const line = await Promise.race([give(giver, partner, specs), Bun.sleep(80_000).then(() => 'FAIL outer timeout')]);
        console.log(`[trade] ${name} ${line}`);
        bows = countOf(giver.sdk, SHORT);
        shields = countOf(giver.sdk, SHIELD);
        summary.push(`${name}: ${line}${parked.length ? ` | parked ${parked.join(', ')}` : ''}`);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`[trade] ${name} error ${message}`);
        summary.push(`${name}: error ${message}`);
    } finally {
        if (giver.sdk.getTradeState().isOpen) await Promise.race([giver.bot.declineTrade(), Bun.sleep(5_000)]);
        await partner?.sdk.disconnect().catch(() => {});
    }
}

await giver.sdk.disconnect().catch(() => {});
console.log('\n--- summary ---');
for (const line of summary) console.log(line);
console.log(`left shortbow x${bows} dragonfire shield x${shields}`);
