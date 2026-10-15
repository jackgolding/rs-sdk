#!/usr/bin/env bun
/**
 * Classify the fleet. Each bot gets one evidence-based verdict.
 *
 *   bun .cursor/skills/wake-fleet/scripts/fleet-status.ts
 *   bun .cursor/skills/wake-fleet/scripts/fleet-status.ts --pretty
 *
 * Read-only: does not write assignment.json. Restart command is always the roster job.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'fs';
import { join } from 'path';
import { readJsonlTail } from '../../../../sdk/grind-log';
import { readOwnership, resolveOwner } from '../../../../sdk/assignment';
import { formatCompactLevels, type ActivityEvent, type HeartbeatRecord } from './fleet-rates';
import { launchdInfo } from './launchd-info';
import { loadState } from './fleet-shepherd';
import { ROOT, rosterBots } from './roster';
import {
    classify,
    formatHeadline,
    sortRows,
    summarize,
    type VerdictRow,
} from './fleet-verdict';

const TAIL_BYTES = 256 * 1024;

interface GatewayStatus {
    status?: string;
    inGame?: boolean;
    stateAge?: number | null;
    controllers?: string[];
    player?: { worldX?: number; worldZ?: number } | null;
}

interface BunProc {
    pid: number;
    cmd: string;
}

function loadServer(name: string): string | undefined {
    const envPath = join(ROOT, 'bots', name, 'bot.env');
    if (!existsSync(envPath)) return undefined;
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq);
        const value = trimmed.slice(eq + 1);
        if (key === 'SERVER') return value || undefined;
        if (key === 'GATEWAY_URL') return value || undefined;
    }
    return undefined;
}

function statusUrl(name: string): string {
    const server = loadServer(name);
    if (server?.startsWith('ws://') || server?.startsWith('wss://') || server?.startsWith('http')) {
        const http = server
            .replace(/^ws:/, 'http:')
            .replace(/^wss:/, 'https:')
            .replace(/\/gateway$/, '');
        return `${http.replace(/\/$/, '')}/status/${encodeURIComponent(name)}`;
    }
    if (!server || server === 'localhost' || server.startsWith('localhost:')) {
        const host = server?.includes(':') ? server : 'localhost:7780';
        return `http://${host}/status/${encodeURIComponent(name)}`;
    }
    return `https://${server}/status/${encodeURIComponent(name)}`;
}

function bunProcesses(): BunProc[] {
    const out = Bun.spawnSync(['pgrep', '-fl', 'bun bots/'], { stdout: 'pipe', stderr: 'pipe' });
    const text = new TextDecoder().decode(out.stdout);
    const rows: BunProc[] = [];
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const sp = line.indexOf(' ');
        const pid = Number(line.slice(0, sp));
        const cmd = sp > 0 ? line.slice(sp + 1) : line;
        if (!Number.isFinite(pid) || cmd.includes('fleet-status')) continue;
        if (!/\bbun\b/.test(cmd) || !cmd.includes('bots/')) continue;
        rows.push({ pid, cmd });
    }
    return rows;
}

function tailLines(path: string, n: number): string[] {
    if (!existsSync(path)) return [];
    let fd: number | null = null;
    try {
        const size = statSync(path).size;
        if (size === 0) return [];
        const bytes = Math.min(size, TAIL_BYTES);
        const buf = Buffer.allocUnsafe(bytes);
        fd = openSync(path, 'r');
        readSync(fd, buf, 0, bytes, size - bytes);
        let text = buf.toString('utf-8');
        if (bytes < size) {
            const nl = text.indexOf('\n');
            text = nl < 0 ? '' : text.slice(nl + 1);
        }
        return text.split('\n').filter((line) => line.trim()).slice(-n);
    } catch {
        return [];
    } finally {
        if (fd !== null) closeSync(fd);
    }
}

async function fetchStatus(name: string): Promise<{ gw: GatewayStatus | null; err?: string }> {
    const url = statusUrl(name);
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return { gw: null, err: `HTTP ${res.status}` };
        return { gw: (await res.json()) as GatewayStatus };
    } catch (e) {
        return { gw: null, err: e instanceof Error ? e.message : String(e) };
    }
}

export async function collectFleet(now = Date.now()): Promise<{
    rows: VerdictRow[];
    unownedProcesses: BunProc[];
}> {
    const fleet = rosterBots();
    const shepherd = loadState();
    const procs = bunProcesses();
    const fetched = await Promise.all(fleet.map((bot) => fetchStatus(bot.name)));
    const ownerPids = new Set<number>();
    const rows = fleet.map((bot, index) => {
        const { gw, err } = fetched[index]!;
        const launchd = launchdInfo(bot.name);
        const owner = resolveOwner(bot.name, launchd);
        if (owner) ownerPids.add(owner.pid);
        const recorded = readOwnership(bot.name);
        const heartbeatPath = join(ROOT, 'bots', bot.name, 'heartbeat.log');
        const eventsPath = join(ROOT, 'bots', bot.name, 'events.log');
        const botState = shepherd.bots[bot.name];
        const fresh = !!gw && gw.inGame === true && gw.status !== 'dead' && (gw.stateAge ?? Infinity) <= 8_000;
        return classify({
            bot,
            now,
            gateway: {
                reachable: !err && !!gw,
                status: gw?.status,
                inGame: gw?.inGame,
                stateAge: gw?.stateAge ?? null,
                controllers: gw?.controllers?.length ?? 0,
                x: fresh ? (gw?.player?.worldX ?? null) : null,
                z: fresh ? (gw?.player?.worldZ ?? null) : null,
                fetchErr: err,
            },
            owner,
            recordedCommand: recorded?.command ?? null,
            launchd,
            runsSamples: botState?.runsSamples ?? [],
            snapshots: readJsonlTail<HeartbeatRecord>(heartbeatPath),
            events: existsSync(eventsPath) ? readJsonlTail<ActivityEvent>(eventsPath) : null,
            grindTail: tailLines(join(ROOT, 'bots', bot.name, 'grind.log'), 40),
            shepherd: {
                capped: botState?.capped ?? false,
                cappedAt: botState?.cappedAt ?? null,
                actions: botState?.actions ?? [],
                restarts: botState?.restarts ?? [],
            },
        });
    });
    return {
        rows,
        unownedProcesses: procs.filter((proc) => !ownerPids.has(proc.pid)),
    };
}

async function main(): Promise<void> {
    const now = Date.now();
    const { rows, unownedProcesses } = await collectFleet(now);
    const ordered = sortRows(rows);
    const summary = summarize(ordered);
    const headline = formatHeadline(summary.producing.length, summary.notProducing);
    const payload = {
        root: ROOT,
        generatedAt: new Date(now).toISOString(),
        headline,
        summary,
        bots: ordered,
        unownedProcesses,
    };
    if (process.argv.includes('--pretty')) {
        const pad = (value: string, width: number) => value.padEnd(width);
        console.log(formatHeadline(summary.producing.length, summary.notProducing, { names: true }));
        console.log(`${pad('bot', 12)} ${pad('kind', 20)} ${pad('check', 18)} ${pad('levels', 28)} detail`);
        for (const row of ordered) {
            const levels = formatCompactLevels(row.levels);
            console.log(
                `${pad(row.name, 12)} ${pad(row.kind, 20)} ${pad(row.check, 18)} ${pad(levels, 28)} ${row.reason}`
            );
        }
    } else {
        console.log(JSON.stringify(payload, null, 2));
    }
}

if (import.meta.main) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
