#!/usr/bin/env bun
/**
 * Public Grand Exchange dump (no bot connection, no GE UI).
 *
 *   bun .cursor/skills/grand-exchange/scripts/dump-ge.ts
 *   bun .cursor/skills/grand-exchange/scripts/dump-ge.ts --q logs --limit 25
 *
 * Default sort is newest last trade first (`recent`). Individual offer owners
 * are never in the public API.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { MARKET_SORTS, MarketClient, type MarketDays, type MarketSort } from '../../../../sdk/market';
import { rosterBots, ROOT } from '../../wake-fleet/scripts/roster';

const DAYS: MarketDays[] = [1, 7, 30, 90];

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

function originFromServer(server: string): string {
    if (/^https?:\/\//i.test(server)) return new URL(server).origin;
    const host = server.replace(/\/.*$/, '');
    if (host.startsWith('localhost') || host.startsWith('127.')) {
        return `http://${host.includes(':') ? host : `${host}:8888`}`;
    }
    return `https://${host}`;
}

function defaultOrigin(): string {
    const bots = rosterBots();
    for (const bot of bots) {
        const server = loadEnv(bot.name).SERVER;
        if (server) return originFromServer(server);
    }
    return originFromServer(process.env.SERVER || 'rs-sdk-demo.fly.dev');
}

function parseArgs(argv: string[]) {
    let origin: string | undefined;
    let query = '';
    let limit = 50;
    let offset = 0;
    let days: MarketDays = 7;
    let sort: MarketSort = 'recent';
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === '--origin') origin = argv[++i];
        else if (arg === '--q' || arg === '--query') query = argv[++i] ?? '';
        else if (arg === '--limit') limit = Number(argv[++i]);
        else if (arg === '--offset') offset = Number(argv[++i]);
        else if (arg === '--days') days = Number(argv[++i]) as MarketDays;
        else if (arg === '--sort') sort = (argv[++i] ?? 'recent') as MarketSort;
        else if (arg === '--help') {
            console.log(`Usage: bun ${process.argv[1]} [options]

Options:
  --origin URL     Game HTTP origin (default: first roster bot.env SERVER)
  --q / --query    Fuzzy item search
  --sort           ${MARKET_SORTS.join('|')} (default: recent = newest last trade)
  --days           1|7|30|90 period for volume/gross (default: 7)
  --limit          1–100 (default: 50)
  --offset         Pagination offset
`);
            process.exit(0);
        }
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit must be 1–100');
    if (!Number.isInteger(offset) || offset < 0) throw new Error('--offset must be >= 0');
    if (!DAYS.includes(days)) throw new Error('--days must be 1, 7, 30, or 90');
    if (!MARKET_SORTS.includes(sort)) throw new Error(`--sort must be one of ${MARKET_SORTS.join(', ')}`);
    return { origin: origin || defaultOrigin(), query, limit, offset, days, sort };
}

if (import.meta.main) {
    const opts = parseArgs(process.argv.slice(2));
    const market = new MarketClient(opts.origin);
    const status = await market.status();
    if (!status.enabled) {
        process.stdout.write(`${JSON.stringify({ origin: opts.origin, enabled: false, message: status.message }, null, 2)}\n`);
        process.exitCode = 1;
        process.exit(0);
    }
    const data = await market.items(opts.query, {
        sort: opts.sort,
        days: opts.days,
        limit: opts.limit,
        offset: opts.offset
    });
    process.stdout.write(
        `${JSON.stringify(
            {
                origin: opts.origin,
                enabled: true,
                ...data
            },
            null,
            2
        )}\n`
    );
}
