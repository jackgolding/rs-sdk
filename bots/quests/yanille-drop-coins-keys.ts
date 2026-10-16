/**
 * At Yanille bank: dump coins above 30k and every half key onto the stack.
 *
 *   bun bots/quests/yanille-drop-coins-keys.ts
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { botNames, ROOT } from '../../.cursor/skills/wake-fleet/scripts/roster';
import { FRESH_STATE_MS, formatStateAge } from '../../sdk/gateway-state';
import { closeUi } from './movement';

const SKIP = new Set(['jackthief', 'ABGARMY02'].map((n) => n.toLowerCase()));
const BATCH = 8;
const KEEP_COINS = 30_000;
const COINS = /^coins$/i;
const KEY_HALF = /half of a key/i;

type Result = { name: string; status: string; detail: string };

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

function countCoins(items: { name: string; count: number }[]): number {
    return items.filter((i) => COINS.test(i.name)).reduce((sum, i) => sum + (i.count ?? 0), 0);
}

async function dropMatching(bot: BotActions, sdk: BotSDK, match: (name: string) => boolean): Promise<string | null> {
    while (true) {
        const next = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && match(i.name));
        if (!next) return null;
        const r = await bot.dropItem(next, 'all');
        if (!r.success && r.reason === 'item_not_found') return null;
        if (!r.success && r.slotsDropped === 0) return `drop ${next.name}: ${r.message}`;
    }
}

async function dumpBot(name: string): Promise<Result> {
    const env = loadEnv(name);
    const sdk = new BotSDK({
        botUsername: env.BOT_USERNAME || name,
        password: env.PASSWORD || '',
        gatewayUrl: env.GATEWAY_URL || deriveGatewayUrl(env.SERVER || 'rs-sdk-demo.fly.dev'),
        connectionMode: 'control',
        autoReconnect: false,
        autoLaunchBrowser: false,
        showChat: false,
        connectTimeout: 12_000,
        readyTimeout: 10_000
    });

    try {
        await sdk.connect();
        const age = sdk.getStateAge();
        if (age > FRESH_STATE_MS) {
            return { name, status: 'skipped', detail: `no live state (${formatStateAge(age)} old)` };
        }

        const bot = new BotActions(sdk);
        await bot.dismissBlockingUI();
        await closeUi(bot, sdk);

        const opened = sdk.getState()?.bank?.isOpen ? { success: true, message: 'already open' } : await bot.openBank(8_000);
        if (!opened.success && !sdk.getState()?.bank?.isOpen) {
            return { name, status: 'failed', detail: `open bank: ${opened.message}` };
        }
        await sdk.waitForCondition((s) => (s.bank?.items?.length ?? 0) > 0, 5_000).catch(() => {});

        const invCoins = sdk.findInventoryItem(COINS);
        if (invCoins && invCoins.count > 0) await bot.depositItem(invCoins, -1);
        for (const item of [...sdk.getInventory()]) {
            if ((item.count ?? 0) <= 0 || !KEY_HALF.test(item.name)) continue;
            await bot.depositItem(item, -1);
        }

        const bankCoins = countCoins(sdk.getBankItems());
        const excess = Math.max(0, bankCoins - KEEP_COINS);
        const keys = sdk.getBankItems().filter((i) => (i.count ?? 0) > 0 && KEY_HALF.test(i.name));
        const parts: string[] = [];

        if (excess > 0) {
            const r = await bot.withdrawItem(COINS, excess, { asNote: false });
            parts.push(
                `coins excess ${excess}${r.success || r.partial ? ` took ${r.amountWithdrawn ?? '?'}` : ` (${r.message})`}`
            );
        } else {
            parts.push(`coins keep ${bankCoins}`);
        }

        for (const key of keys) {
            const r = await bot.withdrawItem(key, -1, { asNote: true });
            parts.push(
                `key id ${key.id} x${key.count}${r.success || r.partial ? '' : ` (${r.message})`}`
            );
        }

        await bot.closeBank();
        await sdk.waitForCondition((s) => s.bank?.isOpen === false, 3_000).catch(() => {});

        const droppedCoins = countCoins(sdk.getInventory());
        const droppedKeys = sdk
            .getInventory()
            .filter((i) => (i.count ?? 0) > 0 && KEY_HALF.test(i.name))
            .reduce((sum, i) => sum + i.count, 0);

        const dropErr =
            (await dropMatching(bot, sdk, (n) => COINS.test(n))) ??
            (await dropMatching(bot, sdk, (n) => KEY_HALF.test(n)));
        if (dropErr) return { name, status: 'failed', detail: `${dropErr} | ${parts.join('; ')}` };

        const leftCoins = countCoins(sdk.getInventory());
        const leftKeys = sdk.getInventory().filter((i) => KEY_HALF.test(i.name) && (i.count ?? 0) > 0);
        return {
            name,
            status: leftCoins || leftKeys.length ? 'partial' : excess || droppedKeys ? 'dropped' : 'kept',
            detail: `dropped ${droppedCoins} coins + ${droppedKeys} key halves; ${parts.join('; ')}`
        };
    } catch (error) {
        return { name, status: 'failed', detail: error instanceof Error ? error.message : String(error) };
    } finally {
        try {
            sdk.disconnect();
        } catch {
            // ignore
        }
    }
}

initPathfinding();
const names = botNames().filter((n) => !SKIP.has(n.toLowerCase()));
console.log(`[yanille-coins-keys] ${names.length} accounts keep ${KEEP_COINS} coins (skip ${[...SKIP].join(', ')})`);

const results: Result[] = [];
for (let i = 0; i < names.length; i += BATCH) {
    const batch = names.slice(i, i + BATCH);
    console.log(`[yanille-coins-keys] batch ${Math.floor(i / BATCH) + 1}: ${batch.join(', ')}`);
    results.push(...(await Promise.all(batch.map(dumpBot))));
}

for (const r of results) {
    console.log(`${r.status.padEnd(8)} ${r.name.padEnd(12)} ${r.detail}`);
}
const counts: Record<string, number> = {};
for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
console.log(JSON.stringify(counts));
if (results.some((r) => r.status === 'failed')) process.exitCode = 1;
