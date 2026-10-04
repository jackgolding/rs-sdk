#!/usr/bin/env bun
/**
 * Read the public world map (`/playerpositions`, the feed behind `/mapview/`)
 * and compare it to the fleet roster plus the last sample on this machine.
 *
 *   bun .cursor/skills/map-watch/scripts/map-watch.ts
 *   bun .cursor/skills/map-watch/scripts/map-watch.ts --pretty
 *   bun .cursor/skills/map-watch/scripts/map-watch.ts --gap 15
 *
 * Does not connect a bot, walk, or attack. `level` in the feed is the floor.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { LIVE_STATE_MS } from '../../../../sdk/gateway-state';
import { rosterBots, ROOT, type RosterBot } from '../../wake-fleet/scripts/roster';
import {
    classifyProgress,
    expectsWilderness,
    indexPlayers,
    inventorySig,
    isStationaryJob,
    movementKind,
    nameKey,
    nearbyPlayers,
    nextFix,
    nextGains,
    piles,
    progressDetail,
    stuckThresholdMs,
    tileDist,
    wildernessLevel,
    xpTotal,
    type GainSample,
    type Snapshot,
    type WorldPlayer
} from './classify';

const SNAPSHOT_PATH = join(homedir(), 'Library', 'Logs', 'rs-sdk-fleet', 'map-watch.json');
const NEARBY_RADIUS = 24;
const PILE_MIN = 4;

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
    for (const bot of rosterBots()) {
        const server = loadEnv(bot.name).SERVER;
        if (server) return originFromServer(server);
    }
    return originFromServer(process.env.SERVER || 'rs-sdk-demo.fly.dev');
}

function parseArgs(argv: string[]) {
    let origin: string | undefined;
    let pretty = false;
    let gapSec = 0;
    let noSave = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === '--origin') origin = argv[++i];
        else if (arg === '--pretty') pretty = true;
        else if (arg === '--gap') gapSec = Number(argv[++i]);
        else if (arg === '--no-save') noSave = true;
        else if (arg === '--help') {
            console.log(`Usage: bun ${process.argv[1]} [--pretty] [--gap SEC] [--origin URL] [--no-save]

Reads GET /playerpositions (same feed as /mapview/). Compares roster bots to the
previous sample in ~/Library/Logs/rs-sdk-fleet/map-watch.json.

  --gap SEC    Wait and sample twice so a cold history can see movement
  --pretty     Human table, then the same JSON
  --no-save    Do not update the dwell snapshot
`);
            process.exit(0);
        } else {
            throw new Error(`unknown argument ${arg}`);
        }
    }
    if (!Number.isFinite(gapSec) || gapSec < 0 || gapSec > 120) throw new Error('--gap must be 0–120 seconds');
    return { origin: origin ? originFromServer(origin) : defaultOrigin(), pretty, gapSec, noSave };
}

function loadSnapshot(): Snapshot | null {
    if (!existsSync(SNAPSHOT_PATH)) return null;
    try {
        const raw = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as Snapshot;
        if (!raw || typeof raw.savedAt !== 'number' || !raw.fixes) return null;
        return raw;
    } catch {
        return null;
    }
}

function saveSnapshot(snapshot: Snapshot): void {
    mkdirSync(join(SNAPSHOT_PATH, '..'), { recursive: true });
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot));
}

async function fetchPlayers(origin: string): Promise<WorldPlayer[]> {
    const res = await fetch(`${origin}/playerpositions`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`GET /playerpositions HTTP ${res.status}`);
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) throw new Error('playerpositions was not an array');
    const players: WorldPlayer[] = [];
    for (const row of data) {
        if (!row || typeof row !== 'object') continue;
        const rec = row as Record<string, unknown>;
        const name = typeof rec.name === 'string' ? rec.name : '';
        const x = Number(rec.x);
        const z = Number(rec.z);
        const level = Number(rec.level);
        if (!name || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(level)) continue;
        players.push({ name, x, z, level });
    }
    return players;
}

function gatewayHttp(env: Record<string, string>): string {
    if (env.GATEWAY_URL) return env.GATEWAY_URL.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/$/, '').replace(/\/gateway$/, '');
    const server = env.SERVER;
    if (!server || server === 'localhost' || server.startsWith('localhost:')) {
        const host = !server || server === 'localhost' ? 'localhost:7780' : server;
        return `http://${host.includes(':') ? host : `${host}:7780`}`;
    }
    if (server.startsWith('ws://') || server.startsWith('wss://')) {
        return server.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/$/, '').replace(/\/gateway$/, '');
    }
    if (/^https?:\/\//i.test(server)) return new URL(server).origin;
    return `https://${server}`;
}

/** Inventory signature and total xp from the gateway's last frame. Null when that frame is missing or stale. */
async function fetchGain(name: string): Promise<GainSample | null> {
    const env = loadEnv(name);
    if (!env.PASSWORD) return null;
    const url = `${gatewayHttp(env)}/state/${encodeURIComponent(name)}?password=${encodeURIComponent(env.PASSWORD)}`;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (!(res.headers.get('content-type') ?? '').includes('json')) return null;
        const body = (await res.json()) as {
            state?: { skills?: { experience: number }[]; inventory?: { id: number; count: number }[] };
            stateAge?: number;
        };
        if (!body?.state || (body.stateAge ?? Infinity) >= LIVE_STATE_MS) return null;
        if (!Array.isArray(body.state.skills) || !Array.isArray(body.state.inventory)) return null;
        return { xp: xpTotal(body.state.skills), inv: inventorySig(body.state.inventory) };
    } catch {
        return null;
    }
}

async function fetchGains(names: string[]): Promise<Map<string, GainSample | null>> {
    const out = new Map<string, GainSample | null>();
    const queue = [...names];
    const workers = Math.min(8, names.length);
    await Promise.all(
        Array.from({ length: workers }, async () => {
            for (;;) {
                const name = queue.shift();
                if (!name) return;
                out.set(nameKey(name), await fetchGain(name));
            }
        })
    );
    return out;
}

function applySample(players: WorldPlayer[], snapshot: Snapshot, now: number, progress: Map<string, GainSample | null>, rosterNames: string[]): Snapshot {
    const priorSavedAt = snapshot.savedAt || null;
    const next: Snapshot = { savedAt: now, fixes: {} };
    for (const player of players) {
        const key = nameKey(player.name);
        const { fix } = nextFix(snapshot.fixes[key], now, priorSavedAt, player);
        next.fixes[key] = fix;
    }
    const gains: Snapshot['gains'] = {};
    for (const name of rosterNames) {
        const key = nameKey(name);
        gains[key] = nextGains(snapshot.gains?.[key], now, priorSavedAt, progress.get(key) ?? null).gain;
    }
    next.gains = gains;
    return next;
}

interface FleetRow {
    name: string;
    paused: boolean;
    command: string;
    onMap: boolean;
    x: number | null;
    z: number | null;
    level: number | null;
    wildyLevel: number | null;
    unexpectedWildy: boolean;
    dwellMs: number | null;
    dryMs: number | null;
    /** Tile clock: seen, moving, or still. */
    motion: 'seen' | 'moving' | 'still' | null;
    /** Inventory + xp + movement. */
    kind: 'absent' | 'unknown' | 'working' | 'task' | 'flat' | 'stuck';
    detail: string;
    nearby: { fleet: string[]; strangers: string[] };
}

function classifyFleet(
    bot: RosterBot,
    players: Map<string, WorldPlayer>,
    before: Snapshot,
    after: Snapshot,
    now: number,
    allFleet: WorldPlayer[],
    strangers: WorldPlayer[],
    progress: Map<string, GainSample | null>
): FleetRow {
    const player = players.get(nameKey(bot.name));
    if (!player) {
        return {
            name: bot.name,
            paused: bot.paused,
            command: bot.command,
            onMap: false,
            x: null,
            z: null,
            level: null,
            wildyLevel: null,
            unexpectedWildy: false,
            dwellMs: null,
            dryMs: null,
            motion: null,
            kind: 'absent',
            detail: 'not on the world map',
            nearby: { fleet: [], strangers: [] }
        };
    }
    const key = nameKey(bot.name);
    const { moved } = nextFix(before.fixes[key], now, before.savedAt || null, player);
    const fix = after.fixes[key];
    const dwellMs = fix ? Math.max(0, now - fix.since) : 0;
    const motion = movementKind(moved, dwellMs, stuckThresholdMs(bot.command));
    const tileMotion = motion === 'moving' ? 'moving' : motion === 'still' || motion === 'stuck' ? 'still' : 'seen';
    const gains = nextGains(before.gains?.[key], now, before.savedAt || null, progress.get(key) ?? null);
    const dryMs = Math.max(0, now - gains.gain.drySince);
    const stationary = isStationaryJob(bot.command);
    const thresholdMs = stuckThresholdMs(bot.command);
    const kind = classifyProgress({
        onMap: true,
        inventoryChanged: gains.inventoryChanged,
        xpChanged: gains.xpChanged,
        moved: tileMotion === 'seen' ? null : tileMotion === 'moving',
        dryMs,
        thresholdMs,
        stationary
    });
    const wildyLevel = wildernessLevel(player.x, player.z, player.level);
    return {
        name: bot.name,
        paused: bot.paused,
        command: bot.command,
        onMap: true,
        x: player.x,
        z: player.z,
        level: player.level,
        wildyLevel,
        unexpectedWildy: wildyLevel != null && !expectsWilderness(bot.command),
        dwellMs: tileMotion === 'seen' ? null : tileMotion === 'moving' ? 0 : dwellMs,
        dryMs: kind === 'unknown' ? null : dryMs,
        motion: tileMotion === 'seen' ? 'seen' : tileMotion,
        kind,
        detail: progressDetail(kind),
        nearby: nearbyPlayers(player, allFleet, strangers, NEARBY_RADIUS)
    };
}

interface WildyStranger {
    name: string;
    x: number;
    z: number;
    level: number;
    wildyLevel: number;
    nearestFleet: { name: string; dist: number } | null;
}

function wildyStrangers(strangers: WorldPlayer[], fleetOnMap: WorldPlayer[]): WildyStranger[] {
    const rows: WildyStranger[] = [];
    for (const player of strangers) {
        const wildyLevel = wildernessLevel(player.x, player.z, player.level);
        if (wildyLevel == null) continue;
        let nearest: { name: string; dist: number } | null = null;
        for (const bot of fleetOnMap) {
            if (bot.level !== player.level) continue;
            const dist = Math.round(tileDist(player, bot));
            if (!nearest || dist < nearest.dist) nearest = { name: bot.name, dist };
        }
        rows.push({
            name: player.name,
            x: player.x,
            z: player.z,
            level: player.level,
            wildyLevel,
            nearestFleet: nearest
        });
    }
    rows.sort((a, b) => b.wildyLevel - a.wildyLevel || a.name.localeCompare(b.name));
    return rows;
}

function formatDwell(ms: number | null): string {
    if (ms == null) return '-';
    const sec = Math.round(ms / 1000);
    if (sec < 90) return `${sec}s`;
    const min = Math.round(sec / 60);
    if (min < 90) return `${min}m`;
    return `${Math.round(min / 60)}h`;
}

function printPretty(payload: {
    origin: string;
    mapUrl: string;
    sampledAt: string;
    fleet: FleetRow[];
    piles: { x: number; z: number; level: number; names: string[] }[];
    wilderness: WildyStranger[];
    worldCount: number;
}): void {
    const counts = {
        onMap: payload.fleet.filter((r) => r.onMap).length,
        stuck: payload.fleet.filter((r) => r.kind === 'stuck').length,
        flat: payload.fleet.filter((r) => r.kind === 'flat').length,
        task: payload.fleet.filter((r) => r.kind === 'task').length,
        working: payload.fleet.filter((r) => r.kind === 'working').length,
        unknown: payload.fleet.filter((r) => r.kind === 'unknown').length,
        absent: payload.fleet.filter((r) => r.kind === 'absent').length,
        unexpectedWildy: payload.fleet.filter((r) => r.unexpectedWildy).length
    };
    console.log(`${payload.mapUrl}`);
    console.log(
        `${payload.sampledAt}  world ${payload.worldCount}  fleet ${counts.onMap}/${payload.fleet.length} on map  stuck ${counts.stuck}  flat ${counts.flat}  task ${counts.task}  working ${counts.working}  unknown ${counts.unknown}  absent ${counts.absent}  unexpected wildy ${counts.unexpectedWildy}`
    );
    const attention = payload.fleet.filter((r) => r.kind === 'stuck' || r.kind === 'absent' || r.unexpectedWildy);
    if (attention.length) {
        console.log('\nbot          kind      dwell   xz              note');
        for (const row of attention) {
            const xz = row.onMap ? `${row.x},${row.z}` : '-';
            const note = [
                row.unexpectedWildy ? `wildy ${row.wildyLevel}` : '',
                row.paused ? 'paused' : '',
                row.kind === 'stuck' && row.nearby.strangers.length ? `near ${row.nearby.strangers.slice(0, 3).join(',')}` : ''
            ]
                .filter(Boolean)
                .join(' ');
            console.log(
                `${row.name.padEnd(12)} ${row.kind.padEnd(9)} ${formatDwell(row.dwellMs).padEnd(7)} ${xz.padEnd(15)} ${note}`
            );
        }
    }
    if (payload.piles.length) {
        console.log('\npiles');
        for (const pile of payload.piles) {
            console.log(`  ${pile.x},${pile.z} ×${pile.names.length}  ${pile.names.join(', ')}`);
        }
    }
    console.log(`\nwilderness strangers ${payload.wilderness.length} (no combat level on this feed)`);
    for (const row of payload.wilderness.slice(0, 15)) {
        const near = row.nearestFleet ? `nearest ${row.nearestFleet.name} ${row.nearestFleet.dist}t` : 'no fleet on this floor';
        console.log(`  ${row.name.padEnd(12)} lvl ${String(row.wildyLevel).padEnd(3)} ${row.x},${row.z}  ${near}`);
    }
    if (payload.wilderness.length > 15) console.log(`  … ${payload.wilderness.length - 15} more in JSON`);
    console.log('');
}

const opts = parseArgs(process.argv.slice(2));
const roster = rosterBots();
const rosterNames = roster.map((bot) => bot.name);
let before = loadSnapshot() ?? { savedAt: 0, fixes: {} };
let [players, progress] = await Promise.all([fetchPlayers(opts.origin), fetchGains(rosterNames)]);
if (opts.gapSec > 0) {
    const firstAt = Date.now();
    before = applySample(players, before, firstAt, progress, rosterNames);
    await new Promise((resolve) => setTimeout(resolve, opts.gapSec * 1000));
    [players, progress] = await Promise.all([fetchPlayers(opts.origin), fetchGains(rosterNames)]);
}
const now = Date.now();
const after = applySample(players, before, now, progress, rosterNames);
if (!opts.noSave) saveSnapshot(after);

const byName = indexPlayers(players);
const fleetNames = new Set(roster.map((b) => nameKey(b.name)));
const fleetOnMap: WorldPlayer[] = [];
const strangers: WorldPlayer[] = [];
for (const player of byName.values()) {
    if (fleetNames.has(nameKey(player.name))) fleetOnMap.push(player);
    else strangers.push(player);
}

const fleet = roster.map((bot) => classifyFleet(bot, byName, before, after, now, fleetOnMap, strangers, progress));
const payload = {
    origin: opts.origin,
    mapUrl: `${opts.origin}/mapview/`,
    sampledAt: new Date(now).toISOString(),
    snapshotPath: SNAPSHOT_PATH,
    gapSec: opts.gapSec,
    note: 'Movement is the map feed. Inventory and xp are the gateway frame when it is under 2 minutes old. Stuck means no inventory change, no xp, and no movement, held for the job threshold. Movement or an inventory change without xp is task-dependent. A standing job that keeps moving with neither gain past the threshold is stuck.',
    worldCount: byName.size,
    summary: {
        onMap: fleet.filter((r) => r.onMap).map((r) => r.name),
        stuck: fleet.filter((r) => r.kind === 'stuck').map((r) => r.name),
        flat: fleet.filter((r) => r.kind === 'flat').map((r) => r.name),
        task: fleet.filter((r) => r.kind === 'task').map((r) => r.name),
        working: fleet.filter((r) => r.kind === 'working').map((r) => r.name),
        unknown: fleet.filter((r) => r.kind === 'unknown').map((r) => r.name),
        absent: fleet.filter((r) => r.kind === 'absent').map((r) => r.name),
        unexpectedWildy: fleet.filter((r) => r.unexpectedWildy).map((r) => r.name)
    },
    piles: piles(fleetOnMap, PILE_MIN),
    fleet,
    wilderness: wildyStrangers(strangers, fleetOnMap)
};

if (opts.pretty) printPretty(payload);
console.log(JSON.stringify(payload, null, 2));
