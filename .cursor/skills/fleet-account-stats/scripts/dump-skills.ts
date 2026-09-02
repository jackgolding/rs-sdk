#!/usr/bin/env bun
/**
 * Live skill snapshot for every roster account (observe-only).
 *
 *   bun .cursor/skills/fleet-account-stats/scripts/dump-skills.ts
 *   bun .cursor/skills/fleet-account-stats/scripts/dump-skills.ts --concurrency 8
 *
 * Never connect in control mode — that would pre-empt grind jobs.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../../../sdk/index';
import { rosterBots, ROOT } from '../../wake-fleet/scripts/roster';

const PLACEHOLDER = /^Stat\d+$/;
const CONCURRENCY_DEFAULT = 6;

export type SkillDumpRow = {
    name: string;
    view: string;
    combat: number | null;
    total: number | null;
    skills: Record<string, number> | null;
    inGame: boolean | null;
    error: string | null;
};

function loadEnv(name: string): Record<string, string> {
    const envPath = join(ROOT, 'bots', name, 'bot.env');
    const env: Record<string, string> = {};
    if (!existsSync(envPath)) return env;
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return env;
}

function parseConcurrency(argv: string[]): number {
    const i = argv.indexOf('--concurrency');
    if (i < 0) return CONCURRENCY_DEFAULT;
    const n = Number(argv[i + 1]);
    return Number.isInteger(n) && n >= 1 && n <= 16 ? n : CONCURRENCY_DEFAULT;
}

async function observe(name: string): Promise<SkillDumpRow> {
    const env = loadEnv(name);
    const username = env.BOT_USERNAME || name;
    const password = env.PASSWORD || '';
    const server = env.SERVER || 'rs-sdk-demo.fly.dev';
    const sdk = new BotSDK({
        botUsername: username,
        password,
        gatewayUrl: env.GATEWAY_URL || deriveGatewayUrl(server),
        connectionMode: 'observe',
        autoReconnect: false,
        autoLaunchBrowser: false,
        readyTimeout: 0,
        connectTimeout: 8000
    });
    try {
        await Promise.race([
            sdk.connect(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('connect timeout')), 9000))
        ]);
        await sdk.waitForCondition((s) => s !== null, 6000).catch(() => {});
        const state = sdk.getState();
        if (!state?.skills?.length) {
            return {
                name,
                view: '',
                combat: null,
                total: null,
                skills: null,
                inGame: state?.inGame ?? false,
                error: 'no state'
            };
        }
        const skills: Record<string, number> = {};
        for (const s of state.skills) {
            if (PLACEHOLDER.test(s.name)) continue;
            skills[s.name] = s.baseLevel ?? s.level;
        }
        const total = Object.values(skills).reduce((a, b) => a + b, 0);
        return {
            name,
            view: '',
            combat: state.player?.combatLevel ?? null,
            total,
            skills,
            inGame: !!state.inGame,
            error: null
        };
    } finally {
        try {
            sdk.disconnect();
        } catch {
            /* ignore */
        }
    }
}

async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let i = 0;
    async function worker() {
        while (i < items.length) {
            const idx = i++;
            out[idx] = await fn(items[idx]!);
        }
    }
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()));
    return out;
}

export async function dumpSkills(concurrency = CONCURRENCY_DEFAULT): Promise<SkillDumpRow[]> {
    const bots = rosterBots();
    const rows = await pool(bots, concurrency, async (bot) => {
        try {
            const row = await observe(bot.name);
            return { ...row, view: bot.view };
        } catch (e) {
            return {
                name: bot.name,
                view: bot.view,
                combat: null,
                total: null,
                skills: null,
                inGame: null,
                error: e instanceof Error ? e.message : String(e)
            };
        }
    });
    return rows;
}

if (import.meta.main) {
    const rows = await dumpSkills(parseConcurrency(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    const failed = rows.filter((r) => r.error).length;
    if (failed) process.exitCode = 1;
}
