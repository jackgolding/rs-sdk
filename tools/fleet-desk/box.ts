/**
 * Host health for the desk's header strip: memory, swap, load, containers and game-client
 * drops in the last hour. Memory is what drops clients on the VPS (2026-11-02: 1.3 GB
 * available, 2.2 GB swapped), so it is shown before the accounts start falling over.
 * Linux only (/proc); elsewhere `boxHealth` returns null and the strip stays hidden.
 */
import { existsSync, openSync, readFileSync, readSync, closeSync, readdirSync, statSync } from 'fs';
import { cpus } from 'os';
import { join } from 'path';

export interface BoxHealth {
    memTotalMb: number;
    memAvailableMb: number;
    swapUsedMb: number;
    load1: number;
    load5: number;
    cores: number;
    containers: number | null;
    /** grind.log "controller down" lines in the last hour, summed over every bot. */
    clientDrops1h: number;
    dropBots1h: string[];
    at: number;
}

const DROP = /controller down/;
const TAIL_BYTES = 64 * 1024;

/** `Key:   1234 kB` lines of /proc/meminfo, in MB. */
export function parseMeminfo(text: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const line of text.split('\n')) {
        const m = line.match(/^(\w+):\s+(\d+)\s*kB/);
        if (m) out[m[1]!] = Math.round(Number(m[2]) / 1024);
    }
    return out;
}

/** Drop lines stamped within `sinceMs` in the tail of one grind.log. */
export function countDrops(tail: string, sinceMs: number): number {
    let n = 0;
    for (const line of tail.split('\n')) {
        if (!DROP.test(line)) continue;
        const t = Date.parse(line.slice(0, 24));
        if (Number.isFinite(t) && t >= sinceMs) n++;
    }
    return n;
}

function readTail(path: string): string {
    const size = statSync(path).size;
    const fd = openSync(path, 'r');
    try {
        const len = Math.min(size, TAIL_BYTES);
        const buf = Buffer.alloc(len);
        readSync(fd, buf, 0, len, size - len);
        return buf.toString('utf-8');
    } finally {
        closeSync(fd);
    }
}

async function countContainers(): Promise<number | null> {
    try {
        const proc = Bun.spawn(['docker', 'ps', '-q'], { stdout: 'pipe', stderr: 'ignore' });
        const out = await new Response(proc.stdout).text();
        return (await proc.exited) === 0 ? out.split('\n').filter(Boolean).length : null;
    } catch {
        return null;
    }
}

let cache: BoxHealth | null = null;

export async function boxHealth(botsDir: string, maxAgeMs = 20_000): Promise<BoxHealth | null> {
    if (!existsSync('/proc/meminfo')) return null;
    if (cache && Date.now() - cache.at < maxAgeMs) return cache;
    const mem = parseMeminfo(readFileSync('/proc/meminfo', 'utf-8'));
    const [load1, load5] = readFileSync('/proc/loadavg', 'utf-8').split(/\s+/).map(Number);
    const since = Date.now() - 3_600_000;
    let clientDrops1h = 0;
    const dropBots1h: string[] = [];
    for (const name of existsSync(botsDir) ? readdirSync(botsDir) : []) {
        const log = join(botsDir, name, 'grind.log');
        if (!existsSync(log)) continue;
        try {
            if (statSync(log).mtimeMs < since) continue;
            const n = countDrops(readTail(log), since);
            if (n) {
                clientDrops1h += n;
                dropBots1h.push(name);
            }
        } catch {
            // A log rotating under us is skipped this round.
        }
    }
    cache = {
        memTotalMb: mem.MemTotal ?? 0,
        memAvailableMb: mem.MemAvailable ?? 0,
        swapUsedMb: (mem.SwapTotal ?? 0) - (mem.SwapFree ?? 0),
        load1: load1 ?? 0,
        load5: load5 ?? 0,
        cores: cpus().length,
        containers: await countContainers(),
        clientDrops1h,
        dropBots1h,
        at: Date.now(),
    };
    return cache;
}
