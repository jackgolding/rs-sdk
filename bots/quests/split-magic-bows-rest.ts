#!/usr/bin/env bun
/**
 * Deliver the magic bows still on jackthief to accounts the first pass missed.
 * Meets the Varrock group there, then everyone else at Edgeville bank.
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

const VARROCK = { x: 3253, z: 3420 };
const EDGE = { x: 3094, z: 3492 };
const LADDER = { x: 3096, z: 9867 };
const GATE = { x: 3103, z: 9909 };
const LONG = /^magic longbow$/i;
const SHORT = /^magic shortbow$/i;
const MISSED = new Set(
    [
        'ABGARMY01', 'ABGARMY03', 'ABGARMY08', 'ABGARMY09', 'ABGARMY10', 'ABGARMY12',
        'ABGARMY15', 'ABGARMY16', 'ABGARMY17', 'ABGARMY19',
        'jacklove6', 'jacklove7', 'jacklove8', 'jacklove9', 'jacklove11', 'jacklove12',
        'jacklove16', 'jacklove17', 'jacklove18', 'jacklove19', 'jacklove20', 'Jackpoo3'
    ].map((name) => name.toLowerCase())
);

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

async function stopGrind(name: string): Promise<void> {
    const proc = Bun.spawn(
        ['bun', '.cursor/skills/wake-fleet/scripts/fleet-launchd.ts', 'stop', name],
        { stdout: 'ignore', stderr: 'ignore' }
    );
    await proc.exited;
}

async function makeRoom(bot: BotActions, sdk: BotSDK, needed: number): Promise<string[]> {
    if (freeSlots(sdk) >= needed) return [];
    const opened = await bot.openBank();
    if (!opened.success && sdk.getState()?.bank?.isOpen !== true) return [];
    const parked: string[] = [];
    while (freeSlots(sdk) < needed) {
        const item = sdk.getInventory().find((entry) => (entry.count ?? 0) > 0 && !/^(magic longbow|magic shortbow|rune pickaxe)$/i.test(entry.name));
        if (!item) break;
        const moved = await bot.depositItem(item, -1);
        if (!moved.success) break;
        parked.push(`${item.name} x${item.count}`);
        await sdk.waitForTicks(1).catch(() => {});
    }
    await bot.closeBank();
    return parked;
}

async function giveBows(thief: Client, partner: Client, give: TradeItemSpec[]): Promise<string> {
    if (thief.sdk.getTradeState().isOpen) await Promise.race([thief.bot.declineTrade(), Bun.sleep(6_000)]);
    const serve = partner.bot.serveTrades({
        from: /jackthief/i,
        maxTrades: 1,
        timeout: 70_000,
        tradeTimeout: 40_000,
        want: give.map((spec) => ({ item: spec.item, amount: spec.amount }))
    }).catch((err: unknown) => ({ message: err instanceof Error ? err.message : String(err) }));
    await Bun.sleep(1_200);
    const sent = await thief.bot.trade(partner.name, {
        give,
        timeout: 40_000,
        requestTimeout: 15_000,
        retryOnBusy: true
    });
    await Promise.race([serve, Bun.sleep(8_000)]);
    const gave = (sent.gave ?? []).map((item) => `${item.name} x${item.count}`).join(', ');
    return `${sent.success ? 'ok' : 'FAIL'} ${sent.message} | gave [${gave}]`;
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
    const here = playerPos(sdk);
    if (here.z > 9000) await leaveDungeon(bot, sdk);
    const after = playerPos(sdk);
    if (inWilderness(after.x, after.z)) {
        const hops = [];
        let z = after.z;
        let x = after.x;
        while (z >= 3520) {
            z = Math.max(3516, z - 12);
            hops.push({ x, z });
        }
        hops.push({ x: 3088, z: 3516 }, { x: EDGE.x, z: EDGE.z });
        await walkSendHops(sdk, hops, EDGE, 4);
    }
    if (Math.hypot(playerPos(sdk).x - EDGE.x, playerPos(sdk).z - EDGE.z) > 8) {
        await walkNear(bot, sdk, EDGE.x, EDGE.z, 3);
    }
}

const names = rosterBots()
    .map((bot) => bot.name)
    .filter((name) => name.toLowerCase() !== 'jackthief')
    .sort((a, b) => a.localeCompare(b));
const shares = names.map((name, index) => ({
    name,
    long: Math.floor(184 / names.length) + (index < 184 % names.length ? 1 : 0),
    short: Math.floor(1840 / names.length) + (index < 1840 % names.length ? 1 : 0)
})).filter((share) => MISSED.has(share.name.toLowerCase()));

initPathfinding();
let thief = await connect('jackthief');
console.log(`[thief] longbow x${countOf(thief.sdk, LONG)} shortbow x${countOf(thief.sdk, SHORT)} @ ${playerPos(thief.sdk).x},${playerPos(thief.sdk).z}`);

async function deliver(share: { name: string; long: number; short: number }, meet: { x: number; z: number }): Promise<string> {
    await stopGrind(share.name);
    let partner: Client | null = null;
    try {
        if (!thief.sdk.getState() || thief.sdk.getStateAge() > 8_000) {
            await thief.sdk.disconnect().catch(() => {});
            thief = await connect('jackthief');
        }
        partner = await connect(share.name);
        const here = playerPos(partner.sdk);
        if (meet === VARROCK && Math.hypot(here.x - meet.x, here.z - meet.z) > 20) {
            return `${share.name}: later`;
        }
        if (Math.hypot(here.x - meet.x, here.z - meet.z) > 20) {
            if (meet === EDGE) await toEdge(partner.bot, partner.sdk);
            else await walkNear(partner.bot, partner.sdk, meet.x, meet.z, 4);
        }
        const near = Math.hypot(playerPos(partner.sdk).x - playerPos(thief.sdk).x, playerPos(partner.sdk).z - playerPos(thief.sdk).z);
        if (near > 12) return `${share.name}: still ${Math.round(near)} tiles from jackthief`;
        const longDue = Math.max(0, share.long - countOf(partner.sdk, LONG));
        const shortDue = Math.max(0, share.short - countOf(partner.sdk, SHORT));
        const give: TradeItemSpec[] = [];
        if (longDue > 0) give.push({ item: LONG, amount: Math.min(longDue, countOf(thief.sdk, LONG)) });
        if (shortDue > 0) give.push({ item: SHORT, amount: Math.min(shortDue, countOf(thief.sdk, SHORT)) });
        if (give.length === 0) return `${share.name}: already has their share`;
        const needs =
            (longDue > 0 && countOf(partner.sdk, LONG) === 0 ? 1 : 0) +
            (shortDue > 0 && countOf(partner.sdk, SHORT) === 0 ? 1 : 0);
        const parked = await makeRoom(partner.bot, partner.sdk, needs);
        if (freeSlots(partner.sdk) < needs) return `${share.name}: no room`;
        const line = await Promise.race([
            giveBows(thief, partner, give),
            Bun.sleep(80_000).then(() => 'FAIL outer timeout')
        ]);
        console.log(`[trade] ${share.name} ${line}${parked.length ? ` parked ${parked.join(', ')}` : ''}`);
        return `${share.name}: ${line}`;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`[trade] ${share.name} error ${message}`);
        return `${share.name}: error ${message}`;
    } finally {
        if (thief.sdk.getTradeState().isOpen) await Promise.race([thief.bot.declineTrade(), Bun.sleep(5_000)]);
        await partner?.sdk.disconnect().catch(() => {});
    }
}

const summary: string[] = [];
for (const share of shares) {
    const here = playerPos(thief.sdk);
    if (Math.hypot(here.x - VARROCK.x, here.z - VARROCK.z) > 30) break;
    summary.push(await deliver(share, VARROCK));
}

console.log('[thief] walking to Edgeville bank');
await walkNear(thief.bot, thief.sdk, EDGE.x, EDGE.z, 3);
console.log(`[thief] @ ${playerPos(thief.sdk).x},${playerPos(thief.sdk).z}`);

const done = new Set(summary.filter((line) => line.includes(': ok ') || line.includes('already has')).map((line) => line.split(':')[0]!.toLowerCase()));
for (const share of shares) {
    if (done.has(share.name.toLowerCase())) continue;
    summary.push(await deliver(share, EDGE));
}

await thief.sdk.disconnect().catch(() => {});
console.log('\n--- summary ---');
for (const line of summary) console.log(line);
console.log(`left longbow x${countOf(thief.sdk, LONG)} shortbow x${countOf(thief.sdk, SHORT)}`);
