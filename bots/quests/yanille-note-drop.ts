/**
 * At Yanille bank: withdraw listed loot as notes and drop it.
 *
 * Jackpoo1 also notes/drops Magic logs.
 * Skips jackthief (and anyone without live gateway state).
 *
 *   bun bots/quests/yanille-note-drop.ts
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

const DUMP: RegExp[] = [
    /^diamond$/i,
    /^coal$/i,
    /^oyster$/i,
    /battlestaff/i,
    /^yew logs$/i,
    /^red spiders' eggs$/i,
    /^cosmic rune$/i,
    /^cosmic talisman$/i,
    /^arrow shaft$/i,
    /^logs$/i,
    /^casket$/i
];

const MAGIC_LOGS = /^magic logs$/i;

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

function dumpPatterns(name: string): RegExp[] {
    return /^jackpoo1$/i.test(name) ? [...DUMP, MAGIC_LOGS] : DUMP;
}

function isDump(itemName: string, botName: string): boolean {
    return dumpPatterns(botName).some((re) => re.test(itemName));
}

function summarize(items: { name: string; count: number }[]): string {
    return items.map((i) => `${i.count} ${i.name}`).join(', ') || 'none';
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

        if (sdk.getState()?.bank?.isOpen) {
            // already open
        } else {
            const opened = await bot.openBank(8_000);
            if (!opened.success && !sdk.getState()?.bank?.isOpen) {
                return { name, status: 'failed', detail: `open bank: ${opened.message}` };
            }
        }
        await sdk.waitForCondition((s) => (s.bank?.items?.length ?? 0) > 0, 5_000).catch(() => {});

        for (const item of [...sdk.getInventory()]) {
            if ((item.count ?? 0) <= 0 || !isDump(item.name, name)) continue;
            await bot.depositItem(item, -1);
        }

        const wanted = sdk.getBankItems().filter((i) => (i.count ?? 0) > 0 && isDump(i.name, name));
        const withdrawn: string[] = [];
        for (const item of wanted) {
            const r = await bot.withdrawItem(item, -1, { asNote: true });
            withdrawn.push(
                `${item.name} x${item.count}${r.success || r.partial ? '' : ` (${r.message})`}`
            );
        }

        await bot.closeBank();
        await sdk.waitForCondition((s) => s.bank?.isOpen === false, 3_000).catch(() => {});

        const beforeDrop = sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && isDump(i.name, name));
        while (true) {
            const next = sdk.getInventory().find((i) => (i.count ?? 0) > 0 && isDump(i.name, name));
            if (!next) break;
            const r = await bot.dropItem(next, 'all');
            if (!r.success && r.reason === 'item_not_found') break;
            if (!r.success && r.slotsDropped === 0) {
                return {
                    name,
                    status: 'failed',
                    detail: `drop ${next.name}: ${r.message} | withdrew ${withdrawn.join('; ') || 'nothing'}`
                };
            }
        }

        const leftover = sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && isDump(i.name, name));
        return {
            name,
            status: leftover.length ? 'partial' : wanted.length || beforeDrop.length ? 'dropped' : 'empty',
            detail: leftover.length
                ? `left ${summarize(leftover)} | withdrew ${withdrawn.join('; ') || 'nothing'}`
                : `dropped ${summarize(beforeDrop)}`
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
console.log(`[yanille-note-drop] ${names.length} accounts (skip ${[...SKIP].join(', ')})`);

const results: Result[] = [];
for (let i = 0; i < names.length; i += BATCH) {
    const batch = names.slice(i, i + BATCH);
    console.log(`[yanille-note-drop] batch ${Math.floor(i / BATCH) + 1}: ${batch.join(', ')}`);
    results.push(...(await Promise.all(batch.map(dumpBot))));
}

for (const r of results) {
    console.log(`${r.status.padEnd(8)} ${r.name.padEnd(12)} ${r.detail}`);
}
const counts: Record<string, number> = {};
for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
console.log(JSON.stringify(counts));
if (results.some((r) => r.status === 'failed')) process.exitCode = 1;
