#!/usr/bin/env bun
/**
 * Open (and close) a bank for roster accounts so the fleet-bank-canvas
 * observer can capture items.
 *
 * The roster job picks the bank. Knights walk the Ardougne road, fishers walk
 * to Catherby, wilderness jobs walk their south path and cross the ditch.
 * A job with no bank walks to the closest named bank. There is no distance cap.
 * Edgeville dungeon and the mining guild climb out first.
 *
 * Usage:
 *   bun bots/quests/snapshot-nearest-banks.ts Bot1 Bot2 ...
 *   bun bots/quests/snapshot-nearest-banks.ts --all
 *   bun bots/quests/snapshot-nearest-banks.ts --yanille-only Bot1
 *   bun bots/quests/snapshot-nearest-banks.ts --force Bot1
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { appendHourlyBankStock } from '../../sdk/bank-stock';
import type { BankItem } from '../../sdk/types';
import { findBot, rosterBots, ROOT } from '../../.cursor/skills/wake-fleet/scripts/roster';
import { formatStateAge, LIVE_STATE_MS } from '../../sdk/gateway-state';
import { inEdgevilleDungeon, inMiningGuild, planBankWalk, type BankPlan } from './job-bank';
import { leaveAdjacentClosedDoor, walkNear } from './movement';
import { YANILLE_BANK, toSurfaceTile } from './tiles';

const CLOSE_ONLY = process.argv.includes('--close-only');
const FORCE = process.argv.includes('--force');
const YANILLE_ONLY = process.argv.includes('--yanille-only');
const ALL = process.argv.includes('--all');
const YANILLE_RADIUS = 15;
const DEFAULT_HOLD_TICKS = 8;
/** Every account at once. A smaller --batch is only for a deliberate cap. */
const DEFAULT_BATCH = 10_000;

type Result = {
    name: string;
    status: 'captured' | 'skipped' | 'failed';
    detail: string;
};

function flagNumber(name: string, fallback: number): number {
    const index = process.argv.indexOf(name);
    if (index < 0) return fallback;
    const value = Number(process.argv[index + 1]);
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} needs a number >= 0`);
    return value;
}

function snapshotStorePath(): string {
    const workspaceKey = ROOT.replace(/^\/+/, '').replaceAll('/', '-');
    return join(homedir(), '.cursor', 'projects', workspaceKey, 'fleet-bank-snapshots.json');
}

let saveChain: Promise<void> = Promise.resolve();

/** The canvas observer saturates the gateway at fleet scale, so the opener records the bank it already has open. */
function rememberBank(name: string, items: BankItem[]): void {
    const view = findBot(name)?.view ?? '';
    const capturedAt = new Date().toISOString();
    saveChain = saveChain.then(() => {
        const path = snapshotStorePath();
        let store: { version: 1; accounts: Record<string, { name: string; view: string; capturedAt: string; items: BankItem[] }> } =
            { version: 1, accounts: {} };
        if (existsSync(path)) {
            try {
                const parsed = JSON.parse(readFileSync(path, 'utf8'));
                if (parsed?.version === 1 && parsed.accounts) store = parsed;
            } catch {
                // Keep the empty store and overwrite a corrupt file.
            }
        }
        store.accounts[name.toLowerCase()] = { name, view, capturedAt, items };
        writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`);
        appendHourlyBankStock(
            name,
            items.map((item) => ({ id: item.id, name: item.name, count: item.count })),
            Date.now()
        );
    });
}
const HOLD_TICKS = flagNumber('--hold-ticks', DEFAULT_HOLD_TICKS);
const BATCH = Math.max(1, Math.floor(flagNumber('--batch', DEFAULT_BATCH)));

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

function skipNames(): Set<string> {
    const path = join(ROOT, '.cursor/skills/wake-fleet/skip-bots.txt');
    if (!existsSync(path)) return new Set();
    return new Set(
        readFileSync(path, 'utf8')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#'))
            .map((line) => line.toLowerCase())
    );
}

function usableBooth(sdk: BotSDK) {
    return (sdk.getNearbyLocs() ?? [])
        .filter(
            (loc) =>
                /^(bank booth|bank chest)$/i.test(loc.name) && (loc.optionsWithIndex?.length ?? 0) > 0
        )
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
}

/**
 * Short hops only. `walkTo` runs a synchronous long-path search that stalls
 * the process when several accounts pathfind at once, so house exits are
 * door clicks plus hops.
 */
async function botDismiss(sdk: BotSDK): Promise<void> {
    const dialog = sdk.getDialog();
    if (dialog?.isOpen) {
        const cont = dialog.options?.find((option) => /continue|click here/i.test(option.text));
        await sdk.sendClickDialog(cont?.index ?? 0);
        await sdk.waitForTicks(1).catch(() => {});
    }
}

const WALK_MS = 14 * 60_000;
const GUILD_LADDER_DOWN = { x: 3019, z: 9739 };

function atTargetBank(sdk: BotSDK, bank: { x: number; z: number }): boolean {
    const here = sdk.getState()?.player;
    if (!here) return false;
    const near = Math.hypot(here.worldX - bank.x, here.worldZ - bank.z) <= 12;
    if (!near) return false;
    if (sdk.getState()?.bank?.isOpen) return true;
    const booth = usableBooth(sdk);
    return Boolean(booth && (booth.distance ?? 99) <= 8) || Math.hypot(here.worldX - bank.x, here.worldZ - bank.z) <= 6;
}

async function crossDitchSouth(sdk: BotSDK): Promise<boolean> {
    const here = sdk.getState()?.player;
    if (!here || here.worldZ < 3523 || here.worldZ >= 9000) return true;
    await hopTowardBank(sdk, 3088, 3525, 20_000);
    await sdk.sendWalk(3088, 3518, true);
    await sdk
        .waitForCondition((state) => (state.player?.worldZ ?? 9999) < 3520, 12_000)
        .catch(() => {});
    const after = sdk.getState()?.player;
    return (after?.worldZ ?? 9999) < 3520;
}

async function approachBank(sdk: BotSDK, plan: BankPlan): Promise<boolean> {
    const deadline = Date.now() + WALK_MS;
    let crossed = !plan.ditch;
    for (const point of plan.points) {
        while (Date.now() < deadline) {
            const here = sdk.getState()?.player;
            if (!here) return false;
            if (atTargetBank(sdk, plan.bank)) return true;
            if (!crossed && here.worldZ >= 3523 && here.worldZ < 9000 && point.z < 3520) {
                crossed = await crossDitchSouth(sdk);
                if (!crossed) return false;
                continue;
            }
            if (Math.hypot(here.worldX - point.x, here.worldZ - point.z) <= 4) break;
            await botDismiss(sdk);
            await leaveAdjacentClosedDoor(sdk);
            if (await hopTowardBank(sdk, point.x, point.z, 12_000)) break;
        }
    }
    return atTargetBank(sdk, plan.bank);
}

/** Short hops — walkTo pathfinds through guild/house doors and never returns. */
async function hopTowardBank(sdk: BotSDK, x: number, z: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const player = sdk.getState()?.player;
        if (!player) return false;
        const dx = x - player.worldX;
        const dz = z - player.worldZ;
        const dist = Math.hypot(dx, dz);
        if (dist <= 3) return true;
        const step = Math.min(3, dist);
        await sdk.sendWalk(
            Math.round(player.worldX + (dx / dist) * step),
            Math.round(player.worldZ + (dz / dist) * step),
            true
        );
        await sdk.waitForTicks(2).catch(() => {});
    }
    const player = sdk.getState()?.player;
    if (!player) return false;
    return Math.hypot(player.worldX - x, player.worldZ - z) <= 6;
}

const EDGEVILLE_LADDER = { x: 3096, z: 9867 };
const EDGEVILLE_WILDY_GATE = { x: 3103, z: 9909 };

async function climbMiningGuild(sdk: BotSDK, bot: BotActions): Promise<boolean> {
    const player = sdk.getState()?.player;
    if (!player || !inMiningGuild(player.worldX, player.worldZ)) return true;
    await hopTowardBank(sdk, GUILD_LADDER_DOWN.x, GUILD_LADDER_DOWN.z, 25_000);
    const ladder = sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-up/i });
    if (ladder) {
        await bot.interactLoc(ladder, /climb-up/i);
        await sdk.waitForCondition((state) => (state.player?.worldZ ?? 9999) < 9000, 10_000).catch(() => {});
    }
    return (sdk.getState()?.player?.worldZ ?? 9999) < 9000;
}

async function climbEdgevilleDungeon(bot: BotActions, sdk: BotSDK): Promise<boolean> {
    const player = sdk.getState()?.player;
    if (!player) return false;
    if (!inEdgevilleDungeon(player.worldX, player.worldZ)) {
        return player.worldZ < 6400;
    }
    if (player.worldZ >= EDGEVILLE_WILDY_GATE.z) {
        await walkNear(bot, sdk, EDGEVILLE_WILDY_GATE.x, EDGEVILLE_WILDY_GATE.z + 6, 3);
        const gate = sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
        if (gate) await bot.openDoor(gate);
        await walkNear(bot, sdk, EDGEVILLE_WILDY_GATE.x, EDGEVILLE_WILDY_GATE.z - 6, 3);
    }
    await walkNear(bot, sdk, EDGEVILLE_LADDER.x, EDGEVILLE_LADDER.z, 2);
    const ladder = sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-up/i });
    if (ladder) {
        await bot.interactLoc(ladder, /climb-up/i);
        await sdk.waitForCondition((state) => (state.player?.worldZ ?? 0) < 6400, 10_000).catch(() => {});
    }
    return (sdk.getState()?.player?.worldZ ?? 0) < 6400;
}

async function openBoothWithoutWalkTo(sdk: BotSDK): Promise<{ success: boolean; message: string }> {
    if (sdk.getState()?.bank?.isOpen) return { success: true, message: 'already open' };
    const booth = usableBooth(sdk);
    if (!booth) return { success: false, message: 'no booth in view' };
    const op =
        (booth.optionsWithIndex ?? []).find((option) => /^bank$/i.test(option.text)) ??
        (booth.optionsWithIndex ?? []).find((option) => /use.quickly/i.test(option.text)) ??
        (booth.optionsWithIndex ?? []).find((option) => /^use$/i.test(option.text));
    if (!op) return { success: false, message: `booth has no bank option (${(booth.options ?? []).join(', ')})` };
    await sdk.sendInteractLoc(booth.x, booth.z, booth.id, op.opIndex);
    await sdk.waitForCondition((state) => state.bank?.isOpen === true, 8_000).catch(() => {});
    return sdk.getState()?.bank?.isOpen
        ? { success: true, message: 'opened' }
        : { success: false, message: 'booth click had no bank UI' };
}

async function openBanker(sdk: BotSDK): Promise<{ success: boolean; message: string }> {
    const banker = sdk.findNearbyNpc(/banker/i);
    const op = banker?.optionsWithIndex?.find((option) => /^bank$/i.test(option.text));
    if (!banker || !op) return { success: false, message: 'no banker' };
    await sdk.sendInteractNpc(banker.index, op.opIndex);
    await sdk.waitForCondition((state) => state.bank?.isOpen === true, 8_000).catch(() => {});
    return sdk.getState()?.bank?.isOpen
        ? { success: true, message: 'banker' }
        : { success: false, message: 'banker click had no bank UI' };
}

async function snapshot(name: string): Promise<Result> {
    const env = loadEnv(name);
    const sdk = new BotSDK({
        botUsername: env.BOT_USERNAME || name,
        password: env.PASSWORD || '',
        gatewayUrl: env.GATEWAY_URL || deriveGatewayUrl(env.SERVER || 'rs-sdk-demo.fly.dev'),
        connectionMode: 'control',
        autoReconnect: false,
        actionTimeout: 8_000,
        autoLaunchBrowser: false,
        showChat: false,
        connectTimeout: 10_000,
        readyTimeout: 10_000
    });

    let killer: ReturnType<typeof setTimeout> | undefined;

    try {
        await sdk.connect();
        killer = setTimeout(() => {
            try {
                sdk.disconnect();
            } catch {
                // Force-fail a hung openBank.
            }
        }, 16 * 60_000);
        const stateAge = sdk.getStateAge();
        if (!FORCE && stateAge > LIVE_STATE_MS) {
            return {
                name,
                status: 'failed',
                detail: `no live gateway state (${formatStateAge(stateAge)} old) — restart lite or reconnect live client`
            };
        }

        const state = sdk.getState();
        if (!state?.player) return { name, status: 'failed', detail: 'no player state' };

        const x = state.player.worldX;
        const z = state.player.worldZ;
        const roster = findBot(name);
        let plan = planBankWalk(
            { script: roster?.script ?? '', args: (roster?.args ?? []).filter((arg) => arg !== name) },
            { x, z }
        );
        const surface = toSurfaceTile(x, z);

        if (YANILLE_ONLY) {
            const yanille = Math.hypot(surface.x - YANILLE_BANK.x, surface.z - YANILLE_BANK.z);
            if (!FORCE && yanille > YANILLE_RADIUS) {
                return {
                    name,
                    status: 'skipped',
                    detail: `outside Yanille bank @ ${x},${z} (closest ${plan.bank.name})`
                };
            }
        }

        if (CLOSE_ONLY) {
            void sdk.sendCloseModal().catch(() => {});
            await Bun.sleep(2_000);
            const stillOpen = sdk.getState()?.modalOpen || sdk.getState()?.interface?.isOpen;
            return {
                name,
                status: stillOpen ? 'failed' : 'captured',
                detail: stillOpen ? 'close packet sent but modal remains open' : 'modal closed'
            };
        }

        const bot = new BotActions(sdk);
        if (state.modalOpen && !state.bank?.isOpen) await bot.closeInterface().catch(() => {});

        const booth = usableBooth(sdk);
        const atBooth = Boolean(booth && (booth.distance ?? 99) <= 8);

        if (!atBooth && !sdk.getState()?.bank?.isOpen) {
            if (plan.climb === 'edgeville-dungeon') {
                const climbed = await climbEdgevilleDungeon(bot, sdk);
                const afterClimb = sdk.getState()?.player;
                if (!climbed || !afterClimb || afterClimb.worldZ >= 6400) {
                    return {
                        name,
                        status: 'failed',
                        detail: `Edgeville dungeon climb failed @ ${x},${z}`
                    };
                }
                plan = planBankWalk(
                    { script: roster?.script ?? '', args: (roster?.args ?? []).filter((arg) => arg !== name) },
                    { x: afterClimb.worldX, z: afterClimb.worldZ }
                );
            } else if (plan.climb === 'mining-guild') {
                const climbed = await climbMiningGuild(sdk, bot);
                const afterClimb = sdk.getState()?.player;
                if (!climbed || !afterClimb || afterClimb.worldZ >= 9000) {
                    return {
                        name,
                        status: 'failed',
                        detail: `mining guild climb failed @ ${x},${z}`
                    };
                }
                plan = planBankWalk(
                    { script: roster?.script ?? '', args: (roster?.args ?? []).filter((arg) => arg !== name) },
                    { x: afterClimb.worldX, z: afterClimb.worldZ }
                );
            }
            const walked = await approachBank(sdk, plan);
            const here = sdk.getState()?.player;
            if (!walked && !atTargetBank(sdk, plan.bank)) {
                return {
                    name,
                    status: 'failed',
                    detail: `walk to ${plan.bank.name} (${plan.bank.x},${plan.bank.z}) failed from ${x},${z}${here ? ` now ${here.worldX},${here.worldZ}` : ''}`
                };
            }
        }

        const bank = plan.bank;

        const opened = sdk.getState()?.bank?.isOpen
            ? { success: true as const, message: 'already open' }
            : await openBoothWithoutWalkTo(sdk);
        if (!sdk.getState()?.bank?.isOpen) {
            await openBanker(sdk);
        }
        if (!opened.success && !sdk.getState()?.bank?.isOpen) {
            return {
                name,
                status: 'failed',
                detail: `open failed at ${bank.name}: ${opened.message}`
            };
        }

        await sdk.waitForCondition((next) => next.bank?.isOpen === true, 5_000).catch(() => {});
        await sdk.waitForTicks(HOLD_TICKS);
        const items = (sdk.getState()?.bank?.items ?? []).map((item) => ({ ...item })).filter((item) => item.count > 0);
        rememberBank(name, items);
        const totalQuantity = items.reduce((sum, item) => sum + item.count, 0);

        const closed = await Promise.race([
            bot.closeBank(),
            new Promise<{ success: false; message: string }>((resolve) =>
                setTimeout(() => resolve({ success: false, message: 'close timeout' }), 5_000)
            )
        ]);
        if (!closed.success && sdk.getState()?.bank?.isOpen) await sdk.sendCloseModal().catch(() => {});
        await sdk.waitForCondition((next) => next.bank?.isOpen === false, 3_000).catch(() => {});
        if (!closed.success && sdk.getState()?.bank?.isOpen) {
            return {
                name,
                status: 'failed',
                detail: `captured ${items.length} slots at ${bank.name} but close failed: ${closed.message}`
            };
        }
        return {
            name,
            status: 'captured',
            detail: `${bank.name}: ${items.length} slots, ${totalQuantity.toLocaleString()} items`
        };
    } catch (error) {
        return { name, status: 'failed', detail: error instanceof Error ? error.message : String(error) };
    } finally {
        clearTimeout(killer);
        try {
            sdk.disconnect();
        } catch {
            // Ignore disconnect cleanup.
        }
    }
}

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = [];
    for (let i = 0; i < items.length; i += size) {
        const chunk = items.slice(i, i + size);
        out.push(...(await Promise.all(chunk.map(fn))));
    }
    return out;
}

const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-') && !/^\d+$/.test(arg));
const rosterNames = new Map(rosterBots().map((bot) => [bot.name.toLowerCase(), bot.name]));
const skipped = skipNames();

let names: string[];
if (ALL) {
    names = rosterBots()
        .map((bot) => bot.name)
        .filter((name) => !skipped.has(name.toLowerCase()));
} else {
    if (requested.length === 0) {
        throw new Error('Pass roster names, or --all (skips skip-bots.txt)');
    }
    names = requested.map((name) => {
        const canonical = rosterNames.get(name.toLowerCase());
        if (!canonical) throw new Error(`Not in roster: ${name}`);
        return canonical;
    });
}

console.error(
    `[nearest-bank] Opening banks for ${names.length} account(s) at once` +
        (BATCH < names.length ? ` (capped at ${BATCH})` : '') +
        (YANILLE_ONLY ? ' (Yanille only)' : '')
);
const results = await mapPool(names, BATCH, async (name) => {
    const result = await snapshot(name);
    console.error(`[nearest-bank] ${result.name}: ${result.status} — ${result.detail}`);
    return result;
});
await saveChain;

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
if (results.some((result) => result.status === 'failed')) process.exitCode = 1;
