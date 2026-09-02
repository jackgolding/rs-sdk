#!/usr/bin/env bun
/**
 * Classify the fleet: running, idle-wakeable, needs intervention, or paused.
 *
 *   bun .cursor/skills/wake-fleet/scripts/fleet-status.ts
 *   bun .cursor/skills/wake-fleet/scripts/fleet-status.ts --pretty
 *
 * The roster (bots/roster.json) says which bots exist and their default job.
 * The command to restart a bot comes from its live argv when it is running,
 * otherwise its recorded assignment, otherwise the roster default — never
 * from guessing at grind.log text. Do not bring back inferCommand().
 * Log text is still read, but only to spot bots a blind restart would not help.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'fs';
import { join } from 'path';
import { readJsonlTail } from '../../../../sdk/grind-log';
import {
    computeRates,
    isZeroRate,
    stallMinutes,
    type HeartbeatRecord,
} from './fleet-rates';
import { MUSA_SHIP } from '../../../../bots/quests/tiles';
import {
    ROOT,
    resolveCommand,
    rosterBots,
    writeAssignment,
    type RosterBot,
} from './roster';

const STALE_MS = 8_000;
const SHIP_TILE = MUSA_SHIP;
/** Grind logs reach gigabytes; only the tail is ever needed. */
const TAIL_BYTES = 256 * 1024;

type Kind = 'running' | 'wake' | 'intervene' | 'paused';

interface BotRow {
    name: string;
    kind: Kind;
    reason: string;
    command: string;
    commandSource: 'live' | 'assignment' | 'roster';
    status: string;
    inGame: boolean;
    stateAge: number | null;
    controllers: number;
    bunPid: number | null;
    bunCmd: string | null;
    x: number | null;
    z: number | null;
    lastLog: string | null;
    xpPerHour?: Record<string, number>;
    gpPerHour?: number | null;
    heartbeatAgeMs?: number | null;
}

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
    /** Script path and its args, with the bun executable stripped. */
    argv: string[];
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

/** Everything after the bun executable: flags, script path, script args. */
function argvOf(cmd: string): string[] {
    const tokens = cmd.trim().split(/\s+/);
    const bunIndex = tokens.findIndex((t) => /(^|\/)bun$/.test(t));
    return bunIndex < 0 ? tokens : tokens.slice(bunIndex + 1);
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
        rows.push({ pid, cmd, argv: argvOf(cmd) });
    }
    return rows;
}

function matchBun(name: string, procs: BunProc[]): BunProc | null {
    const folder = `bots/${name}/`;
    const arg = new RegExp(`(?:\\s)${name}(?:\\s|$)`);
    return procs.find((p) => p.cmd.includes(folder) || arg.test(p.cmd)) ?? null;
}

/** Reads only the last TAIL_BYTES; grind.log can be gigabytes. */
function grindTail(name: string, n = 40): string[] {
    const path = join(ROOT, 'bots', name, 'grind.log');
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
        // A mid-line seek leaves a partial first line; drop it.
        if (bytes < size) {
            const nl = text.indexOf('\n');
            text = nl < 0 ? '' : text.slice(nl + 1);
        }
        return text
            .split('\n')
            .filter((l) => l.trim())
            .slice(-n);
    } catch {
        return [];
    } finally {
        if (fd !== null) closeSync(fd);
    }
}

function repeatHeavy(log: string[]): string | null {
    const last = log.slice(-12);
    if (last.length < 6) return null;
    const counts = new Map<string, number>();
    for (const line of last) {
        const key = line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.Z]+\s*/, '').trim();
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let best = '';
    let n = 0;
    for (const [k, v] of counts) {
        if (v > n) {
            best = k;
            n = v;
        }
    }
    if (n >= 6) return `${n}× "${best.slice(0, 80)}"`;
    return null;
}

function recoveryHigh(log: string[]): string | null {
    for (const line of log.slice().reverse()) {
        const m = line.match(/Recovering:.*?×(\d+)/i);
        if (m && Number(m[1]) >= 20) return `recovery loop ×${m[1]}`;
        const t = line.match(/recovery tactic .*?×(\d+)/i);
        if (t && Number(t[1]) >= 20) return `recovery tactic ×${t[1]}`;
    }
    return null;
}

function pathfailBurst(log: string[]): boolean {
    return log.filter((l) => /PATHFINDING FAILED/i.test(l)).length >= 8;
}

function heartbeatTail(name: string): HeartbeatRecord[] {
    const path = join(ROOT, 'bots', name, 'heartbeat.log');
    return readJsonlTail<HeartbeatRecord>(path);
}

function classify(opts: {
    bot: RosterBot;
    gw: GatewayStatus | null;
    fetchErr?: string;
    bun: BunProc | null;
    log: string[];
}): BotRow {
    const { bot, gw, fetchErr, bun, log } = opts;
    const name = bot.name;

    // A live process is the only authoritative statement of what this bot is
    // doing; persist it so a later restart does not have to guess.
    if (bun) writeAssignment(name, bun.argv, 'observed');
    const { command, source } = resolveCommand(bot, bun?.argv ?? null);

    const lastLog = log.at(-1) ?? null;
    const x = gw?.player?.worldX ?? null;
    const z = gw?.player?.worldZ ?? null;
    const controllers = gw?.controllers?.length ?? 0;
    const base = {
        name,
        command,
        commandSource: source,
        status: gw?.status ?? (fetchErr ? 'unreachable' : 'unknown'),
        inGame: !!gw?.inGame,
        stateAge: gw?.stateAge ?? null,
        controllers,
        bunPid: bun?.pid ?? null,
        bunCmd: bun?.cmd ?? null,
        x,
        z,
        lastLog
    };

    const row = (kind: Kind, reason: string): BotRow => ({ ...base, kind, reason });

    if (bot.paused) {
        const why =
            bot.pauseSource === 'food-hub'
                ? 'abg-food-hub.lock (live hub — will not wake until it exits)'
                : 'skip-bots.txt — will not re-wake if stopped';
        if (bun) return row('paused', `bun pid ${bun.pid} (${why})`);
        return row('paused', why);
    }

    if (fetchErr) return row('intervene', `gateway unreachable: ${fetchErr}`);
    if (!gw || gw.status === 'dead' || gw.inGame === false) {
        return row('intervene', 'client logged out / session dead — need a browser or lite login');
    }
    if ((gw.stateAge ?? 0) > STALE_MS) {
        return row('intervene', `client stale (${gw.stateAge}ms since last tick)`);
    }

    if (bun) {
        const hb = heartbeatTail(name);
        const rates = computeRates(hb, 6 * 3_600_000);
        const running = row('running', `bun pid ${bun.pid}`);
        if (rates) {
            running.xpPerHour = rates.xpPerHour;
            running.gpPerHour = rates.gpPerHour;
        }
        const ageMin = stallMinutes(hb);
        if (ageMin != null) running.heartbeatAgeMs = ageMin * 60_000;
        if (isZeroRate(hb, bot.bursty)) {
            return row('intervene', `zero_rate — no xp/coins progress for ${bot.bursty ? 90 : 30}+ minutes`);
        }
        return running;
    }

    if (x === SHIP_TILE.x && z === SHIP_TILE.z) {
        return row('intervene', `stuck on Musa Point ship (${x},${z}) — gangplank/path loop`);
    }

    const repeats = repeatHeavy(log);
    if (repeats && /Walking Musa Point|PATHFINDING FAILED|Tomb loot amulet=0/i.test(repeats)) {
        return row('intervene', `same log line looping: ${repeats}`);
    }

    const rec = recoveryHigh(log);
    if (rec) return row('intervene', rec);

    if (pathfailBurst(log)) {
        return row('intervene', 'pathfinding failed 8+ times in the last 40 log lines');
    }

    if (/Waiting for Fatpig/i.test(lastLog ?? '') && /food=0/.test(lastLog ?? '')) {
        return row('intervene', 'waiting at bank for Fatpig with no food');
    }

    if (controllers > 0) {
        return row('intervene', `${controllers} controller(s) but no matching bun process — stale SDK or other agent`);
    }

    return row(
        'wake',
        source === 'roster'
            ? 'in-game, no controller, no recorded assignment — using roster default'
            : 'in-game, no controller — restart last recorded job'
    );
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

const fleet = rosterBots();
const procs = bunProcesses();
const fetched = await Promise.all(fleet.map((bot) => fetchStatus(bot.name)));
const rows: BotRow[] = fleet.map((bot, i) => {
    const { gw, err } = fetched[i]!;
    return classify({
        bot,
        gw,
        fetchErr: err,
        bun: matchBun(bot.name, procs),
        log: grindTail(bot.name)
    });
});

const summary = {
    running: rows.filter((r) => r.kind === 'running').map((r) => r.name),
    wake: rows.filter((r) => r.kind === 'wake').map((r) => r.name),
    intervene: rows.filter((r) => r.kind === 'intervene').map((r) => r.name),
    paused: rows.filter((r) => r.kind === 'paused').map((r) => r.name)
};

const payload = { root: ROOT, summary, bots: rows };
if (process.argv.includes('--pretty')) {
    const pad = (s: string, n: number) => s.padEnd(n);
    console.log(`${pad('bot', 12)} ${pad('kind', 10)} ${pad('inGame', 6)} ctrls bun   xz            reason`);
    for (const r of rows) {
        const xz = r.x != null ? `${r.x},${r.z}` : '-';
        console.log(
            `${pad(r.name, 12)} ${pad(r.kind, 10)} ${pad(String(r.inGame), 6)} ${String(r.controllers).padStart(5)} ${r.bunPid ? 'yes' : ' no'}  ${pad(xz, 13)} ${r.reason}`
        );
    }
    console.log('\n' + JSON.stringify(summary, null, 2));
} else {
    console.log(JSON.stringify(payload, null, 2));
}
