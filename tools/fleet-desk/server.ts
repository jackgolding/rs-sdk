#!/usr/bin/env bun
/**
 * Local fleet desk. Bind is 127.0.0.1 only.
 *
 *   bun tools/fleet-desk/server.ts
 *   bun tools/fleet-desk/server.ts --no-open
 *
 * Passwords stay in bot.env. Chrome is opened by lite-launchd on this machine.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { formatWorldState } from '../../sdk/formatter';
import type { BankItem, BotWorldState } from '../../sdk/types';
import { formatStateAge, FRESH_STATE_MS } from '../../sdk/gateway-state';
import { formatBotState } from '../../server/webclient/src/bot/formatters';
import { collectFleet } from '../../.cursor/skills/wake-fleet/scripts/fleet-status';
import { MAX_RESTARTS_PER_HOUR } from '../../.cursor/skills/wake-fleet/scripts/fleet-shepherd';
import { findBot, invalidateRosterCache, ROOT, rosterBots } from '../../.cursor/skills/wake-fleet/scripts/roster';
import { supervisorKind } from '../../.cursor/skills/wake-fleet/scripts/supervisor';
import { areaName } from './areas';
import { assignRosterScript, scriptError, setSkipList } from './roster-edit';
import { tailFile } from './tail';

const HOST = '127.0.0.1';
const PORT = Number(process.env.FLEET_DESK_PORT || 8791);
const ROSTER_PATH = join(ROOT, 'bots', 'roster.json');
const SKIP_PATH = process.env.FLEET_SKIP_FILE ?? join(ROOT, '.cursor/skills/wake-fleet/skip-bots.txt');
const LOG_DIR = join(homedir(), 'Library', 'Logs', 'rs-sdk-fleet');
const LAUNCHD = join(ROOT, '.cursor/skills/wake-fleet/scripts/fleet-launchd.ts');
const LITE = join(ROOT, '.cursor/skills/lite-client/scripts/lite-launchd.ts');
/** Docker-side stop/start/restart for the VPS fleet (Mac keeps fleet-launchd). */
const CTL = join(ROOT, '.cursor/skills/wake-fleet/scripts/fleet-ctl.ts');
const isDocker = () => supervisorKind() === 'docker';
const BANK_CHECK = join(import.meta.dir, 'bank-check.ts');
const HTML = join(import.meta.dir, 'public', 'index.html');
const STALE_BANK_MS = 24 * 60 * 60 * 1000;

const SUGGESTED_SCRIPTS = [
    'bots/quests/thieving-route.ts',
    'bots/quests/fishing-route.ts',
    'bots/quests/mining-guild.ts',
    'bots/quests/seers-wc-fm.ts',
    'bots/quests/agility-route.ts',
    'bots/quests/wildy-course.ts',
    'bots/quests/gnome-course.ts',
    'bots/quests/green-dragons.ts',
    'bots/quests/red-dragons.ts',
    'bots/quests/kbd-range.ts',
    'bots/quests/wildy-range.ts',
    'bots/quests/edgeville-range-druids.ts',
    'bots/quests/edgeville-dungeon-melee.ts',
    'bots/quests/hobgoblins.ts',
    'bots/quests/magic-trees.ts',
    'bots/quests/rune-rocks.ts',
    'bots/quests/essence.ts',
    'bots/quests/nature-essence-run.ts',
    'bots/quests/high-alch.ts',
    'bots/quests/herblore.ts',
    'bots/quests/catherby-cook-bank.ts',
    'bots/quests/bank-fletch.ts',
    'bots/quests/rimmington-iron.ts',
    'bots/quests/accept-trades.ts',
];

const LOGS: Record<string, (name: string) => string> = {
    // Live per-bot files live under FLEET_BOTS_DIR on the VPS host
    // (/srv/fleet/bots), not in the repo checkout — same rule as
    // supervisor.ts assignmentRoot(). Unset keeps the Mac repo path.
    grind: (name) => join(process.env.FLEET_BOTS_DIR ? resolve(process.env.FLEET_BOTS_DIR) : join(ROOT, 'bots'), name, 'grind.log'),
    out: (name) => join(LOG_DIR, `${name}.out.log`),
    err: (name) => join(LOG_DIR, `${name}.err.log`),
    lite: (name) => join(LOG_DIR, `lite-${name}.out.log`),
    'lite-err': (name) => join(LOG_DIR, `lite-${name}.err.log`),
};

class HttpError extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message);
    }
}

interface Job {
    id: string;
    name: string;
    action: string;
    status: 'running' | 'ok' | 'failed';
    output: string;
    startedAt: number;
    endedAt?: number;
}

interface BankSnap {
    name: string;
    capturedAt: string;
    items: BankItem[];
}

const jobs = new Map<string, Job>();
const deskStart = Date.now();
let fleetCache: { at: number; startedAt: number; body: unknown } | null = null;
let fleetInflight: Promise<unknown> | null = null;

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
}

function canonicalName(raw: string): string {
    const bot = findBot(decodeURIComponent(raw));
    if (!bot) throw new HttpError(404, `Unknown account "${raw}"`);
    return bot.name;
}

function readBotEnv(name: string): { username: string; password: string; server?: string; gatewayUrl?: string } {
    // Live per-bot files live under FLEET_BOTS_DIR on the VPS host.
    const envPath = join(
        process.env.FLEET_BOTS_DIR ? resolve(process.env.FLEET_BOTS_DIR) : join(ROOT, 'bots'),
        name,
        'bot.env'
    );
    if (!existsSync(envPath)) throw new HttpError(404, `${name} has no bot.env`);
    const env: Record<string, string> = {};
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    if (!env.BOT_USERNAME || !env.PASSWORD) throw new HttpError(404, `${name} bot.env is missing BOT_USERNAME or PASSWORD`);
    return {
        username: env.BOT_USERNAME,
        password: env.PASSWORD,
        server: env.SERVER,
        gatewayUrl: env.GATEWAY_URL,
    };
}

function gatewayUrlFor(env: { server?: string; gatewayUrl?: string }): string {
    if (env.gatewayUrl && (env.gatewayUrl.startsWith('ws://') || env.gatewayUrl.startsWith('wss://'))) {
        return env.gatewayUrl;
    }
    const server = env.server ?? 'rs-sdk-demo.fly.dev';
    return deriveGatewayUrl(server);
}

function httpBase(gatewayUrl: string): string {
    return gatewayUrl
        .replace(/^ws(s?):\/\//, 'http$1://')
        .replace(/\/gateway$/, '')
        .replace(/\/$/, '');
}

function stackItems(
    items: { name?: string; count?: number; id?: number }[] | undefined
): { name: string; count: number; id: number | null }[] {
    const counts = new Map<string, { count: number; id: number | null }>();
    for (const item of items ?? []) {
        const name = item.name || 'Item';
        const prev = counts.get(name) ?? { count: 0, id: null as number | null };
        if (prev.id == null && typeof item.id === 'number') prev.id = item.id;
        prev.count += item.count || 0;
        counts.set(name, prev);
    }
    return [...counts].map(([name, { count, id }]) => ({ name, count, id }));
}

function optionText(entity: { options?: string[]; optionsWithIndex?: { text: string }[] } | undefined): string {
    if (!entity) return '';
    const named = entity.options?.filter(Boolean);
    if (named && named.length) return named.join(', ');
    return (entity.optionsWithIndex ?? []).map((option) => option.text).filter(Boolean).join(', ');
}

function cleanChat(text: string): string {
    return text.replace(/@\w+@/g, '').trim();
}

/** Same slices the Chrome client prints, plus worn gear, as data the page can lay out. */
function chromeView(state: BotWorldState) {
    const player = state.player;
    return {
        inGame: state.inGame,
        tick: state.tick,
        player: player
            ? {
                  name: player.name,
                  combatLevel: player.combatLevel,
                  x: player.worldX,
                  z: player.worldZ,
                  level: player.level,
                  runEnergy: player.runEnergy,
                  runWeight: player.runWeight,
                  dead: player.isDead,
              }
            : null,
        skills: (state.skills ?? []).map((skill) => ({
            name: skill.name,
            level: skill.level,
            baseLevel: skill.baseLevel,
            xp: skill.experience,
        })),
        inventory: stackItems(state.inventory),
        worn: stackItems(state.equipment),
        dialogOpen: state.dialog?.isOpen
            ? (state.dialog.options ?? []).map((option) => `${option.index}. ${option.text}`)
            : [],
        npcs: (state.nearbyNpcs ?? []).slice(0, 24).map((npc) => ({
            name: npc.name,
            combatLevel: npc.combatLevel,
            hp: npc.hp,
            maxHp: npc.maxHp,
            distance: npc.distance,
            options: optionText(npc),
        })),
        npcCount: state.nearbyNpcs?.length ?? 0,
        players: (state.nearbyPlayers ?? []).slice(0, 24).map((other) => ({
            name: other.name,
            combatLevel: other.combatLevel,
            distance: other.distance,
        })),
        playerCount: state.nearbyPlayers?.length ?? 0,
        objects: (state.nearbyLocs ?? []).slice(0, 24).map((loc) => ({
            name: loc.name,
            x: loc.x,
            z: loc.z,
            distance: loc.distance,
            options: optionText(loc),
        })),
        objectCount: state.nearbyLocs?.length ?? 0,
        ground: (state.groundItems ?? []).slice(0, 24).map((item) => ({
            name: item.name,
            id: item.id ?? null,
            count: item.count,
            distance: item.distance,
        })),
        groundCount: state.groundItems?.length ?? 0,
        messages: (state.gameMessages ?? []).slice(-12).map((message) => {
            const text = cleanChat(message.text || '');
            return message.sender ? `${message.sender}: ${text}` : text;
        }),
        dialogs: (state.recentDialogs ?? []).slice(0, 6).map((dialog) => {
            const text = (dialog.text ?? []).join(' | ');
            return `[tick ${dialog.tick}] ${text.slice(0, 120)}`;
        }),
        shop: state.shop?.isOpen ? state.shop.title : null,
        trade: state.trade?.isOpen ? state.trade.partner || 'trade' : null,
        bankOpen: !!state.bank?.isOpen,
    };
}

function renderState(state: BotWorldState, stateAge: number): string {
    let text: string;
    try {
        text = formatBotState(state as never);
    } catch {
        text = formatWorldState(state);
    }
    if (stateAge > FRESH_STATE_MS) {
        return `State is ${formatStateAge(stateAge)} old. Coords can be a frozen snapshot.\n\n${text}`;
    }
    return text;
}

async function fetchStateHttp(
    gatewayUrl: string,
    username: string,
    password: string
): Promise<{ state: BotWorldState; stateAge: number } | null> {
    const qs = password ? `?${new URLSearchParams({ password })}` : '';
    const url = `${httpBase(gatewayUrl)}/state/${encodeURIComponent(username)}${qs}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) return null;
    const body = (await res.json().catch(() => null)) as { state?: BotWorldState; stateAge?: number } | null;
    if (!body?.state) return null;
    return { state: body.state, stateAge: Number(body.stateAge) || 0 };
}

async function readLiveState(name: string): Promise<{ state: BotWorldState; stateAge: number }> {
    const env = readBotEnv(name);
    const gatewayUrl = gatewayUrlFor(env);
    const httpState = await fetchStateHttp(gatewayUrl, env.username, env.password).catch(() => null);
    if (httpState) return httpState;

    const sdk = new BotSDK({
        botUsername: env.username,
        password: env.password,
        gatewayUrl,
        connectionMode: 'observe',
        autoReconnect: false,
        autoLaunchBrowser: false,
        readyTimeout: 0,
    });
    try {
        await sdk.connect();
        await sdk.waitForCondition((state) => state !== null, 8000);
        const state = sdk.getState();
        if (!state) throw new HttpError(502, `${name} has no game state. The client may be logged out.`);
        return { state, stateAge: sdk.getStateAge() };
    } finally {
        await sdk.disconnect().catch(() => undefined);
    }
}

function snapshotPath(): string {
    const workspaceKey = ROOT.replace(/^\/+/, '').replaceAll('/', '-');
    return join(homedir(), '.cursor', 'projects', workspaceKey, 'fleet-bank-snapshots.json');
}

function loadBank(name: string): BankSnap | null {
    const path = snapshotPath();
    if (!existsSync(path)) return null;
    try {
        const store = JSON.parse(readFileSync(path, 'utf-8')) as { accounts?: Record<string, BankSnap> };
        return store.accounts?.[name.toLowerCase()] ?? null;
    } catch {
        return null;
    }
}

function scriptChoices(): string[] {
    const found = new Set<string>();
    for (const script of SUGGESTED_SCRIPTS) {
        if (existsSync(join(ROOT, script))) found.add(script);
    }
    for (const bot of rosterBots()) found.add(bot.script);
    return [...found].sort((a, b) => a.localeCompare(b));
}

function extraArgs(name: string, args: string[]): string {
    if (args.length === 0) return '';
    if (args[0]?.toLowerCase() === name.toLowerCase()) return args.slice(1).join(' ');
    return args.join(' ');
}

function beginFleetBuild(): Promise<unknown> {
    if (!fleetInflight) {
        const startedAt = Date.now();
        fleetInflight = buildFleet()
            .then((body) => {
                fleetCache = { at: Date.now(), startedAt, body };
                return body;
            })
            .finally(() => {
                fleetInflight = null;
            });
    }
    return fleetInflight;
}

/** `fresh` skips the few-second cache so the desk Refresh button sees a new snapshot. */
async function fleetPayload(fresh = false): Promise<unknown> {
    const requestedAt = Date.now();
    if (!fresh && fleetCache && requestedAt - fleetCache.at < 5000) return fleetCache.body;
    if (fresh && fleetInflight) {
        await fleetInflight.catch(() => undefined);
        if (fleetCache && fleetCache.startedAt >= requestedAt) return fleetCache.body;
    }
    return beginFleetBuild();
}

async function buildFleet(): Promise<unknown> {
    invalidateRosterCache();
    const roster = rosterBots();
    let rows: Awaited<ReturnType<typeof collectFleet>>['rows'];
    let unownedProcesses: Awaited<ReturnType<typeof collectFleet>>['unownedProcesses'];
    try {
        ({ rows, unownedProcesses } = await collectFleet(Date.now()));
    } catch (err) {
        // Gateway totally unreachable: don't 500 the desk. The UI shows a
        // banner distinguishing "gateway down" from "bots logged out".
        return {
            generatedAt: new Date().toISOString(),
            headline: 'gateway unreachable',
            producing: 0,
            notProducing: roster.map((bot) => bot.name),
            paused: 0,
            views: [...new Set(roster.map((bot) => bot.view).filter(Boolean))],
            scripts: scriptChoices(),
            bots: [],
            unowned: [],
            gatewayDown: true,
            gatewayError: err instanceof Error ? err.message : String(err),
            maxRestarts: MAX_RESTARTS_PER_HOUR,
        };
    }
    const byName = new Map(roster.map((bot) => [bot.name, bot]));
    const bots = rows.map((row) => {
        const bot = byName.get(row.name);
        return {
            name: row.name,
            view: bot?.view ?? '',
            script: bot?.script ?? '',
            extra: bot ? extraArgs(row.name, bot.args) : '',
            command: bot?.command ?? row.restartCommand,
            paused: row.paused,
            pauseSource: bot?.pauseSource ?? null,
            kind: row.kind,
            check: row.check,
            reason: row.reason,
            x: row.x,
            z: row.z,
            area: row.x == null || row.z == null ? null : areaName(row.x, row.z),
            stateAge: row.stateAge,
            controllers: row.controllers,
            drift: row.drift?.owner ?? null,
            minutesSinceEffect: row.minutesSinceEffect,
            minutesSinceSnapshot: row.minutesSinceSnapshot,
            relaunches1h: row.relaunches1h,
            lastExit: row.lastExit,
            lastStop: row.lastStop,
            shepherdCapped: row.shepherd.capped,
            xpPerHour: row.xpPerHour,
            gpPerHour: row.gpPerHour,
            levels: row.levels,
        };
    });
    const producing = bots.filter((bot) => bot.kind === 'producing').length;
    const notProducing = bots.filter((bot) => bot.kind !== 'producing' && bot.kind !== 'paused').map((bot) => bot.name);
    const paused = bots.filter((bot) => bot.kind === 'paused').length;
    // Gateway-down signal: most of the roster unreachable at once is a gateway
    // outage, not 40 simultaneous logouts. The banner says so explicitly.
    const unreachable = bots.filter(
        (bot) => bot.check === 'no_live_state' && bot.reason.startsWith('gateway unreachable')
    ).length;
    const gatewayDown = bots.length > 0 && unreachable >= Math.max(2, Math.ceil(bots.length / 2));
    return {
        generatedAt: new Date().toISOString(),
        headline: gatewayDown ? 'gateway unreachable' : `${producing} producing, ${notProducing.length} not producing`,
        producing,
        notProducing,
        paused,
        views: [...new Set(roster.map((bot) => bot.view).filter(Boolean))],
        scripts: scriptChoices(),
        bots,
        unowned: unownedProcesses.map((proc) => ({ pid: proc.pid, cmd: proc.cmd })),
        gatewayDown,
        maxRestarts: MAX_RESTARTS_PER_HOUR,
    };
}

function runningJob(name: string): Job | undefined {
    for (const job of jobs.values()) {
        if (job.name === name && job.status === 'running') return job;
    }
    return undefined;
}

function remember(job: Job): void {
    jobs.set(job.id, job);
    const stale = [...jobs.values()]
        .filter((entry) => entry.status !== 'running')
        .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
        .slice(20);
    const keep = new Set([...jobs.values()].filter((entry) => entry.status === 'running').map((entry) => entry.id));
    for (const entry of stale) keep.add(entry.id);
    for (const id of jobs.keys()) if (!keep.has(id)) jobs.delete(id);
}

async function pipe(stream: ReadableStream<Uint8Array> | null, job: Job): Promise<void> {
    if (!stream) return;
    const reader = stream.getReader();
    const decode = new TextDecoder();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) job.output = (job.output + decode.decode(value, { stream: true })).slice(-16_000);
    }
}

function assertDeskFree(name?: string): void {
    const bank = runningJob('fleet');
    if (bank?.action === 'banks') {
        throw new HttpError(409, 'A bank check is running. Wait until the grinds start again.');
    }
    if (!name) {
        const busy = [...jobs.values()].find((job) => job.status === 'running');
        if (busy) throw new HttpError(409, `Wait for ${busy.name} ${busy.action} to finish`);
        return;
    }
    const current = runningJob(name);
    if (current) throw new HttpError(409, `${name} is already running ${current.action}`);
}

function startJob(name: string, action: string, args: string[]): Job {
    const current = runningJob(name);
    if (current) throw new HttpError(409, `${name} is already running ${current.action}`);
    const job: Job = {
        id: crypto.randomUUID(),
        name,
        action,
        status: 'running',
        output: '',
        startedAt: Date.now(),
    };
    remember(job);
    const proc = Bun.spawn([process.execPath, ...args], {
        cwd: ROOT,
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: 'ignore',
    });
    void (async () => {
        await Promise.all([
            pipe(proc.stdout as ReadableStream<Uint8Array>, job),
            pipe(proc.stderr as ReadableStream<Uint8Array>, job),
        ]).catch((err) => {
            job.output = `${job.output}\n${err instanceof Error ? err.message : String(err)}`.slice(-16_000);
        });
        const code = await proc.exited;
        job.endedAt = Date.now();
        job.status = code === 0 ? 'ok' : 'failed';
        job.output = `${job.output}\n(exit ${code})`.slice(-16_000);
        fleetCache = null;
    })();
    return job;
}

function writeRoster(roster: unknown): void {
    const tmp = `${ROSTER_PATH}.desk-tmp`;
    writeFileSync(tmp, `${JSON.stringify(roster, null, 4)}\n`);
    renameSync(tmp, ROSTER_PATH);
    invalidateRosterCache();
    fleetCache = null;
}

function readRosterFile(): { bots?: unknown } {
    return JSON.parse(readFileSync(ROSTER_PATH, 'utf-8')) as { bots?: unknown };
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
    const text = await req.text();
    if (!text.trim()) return {};
    try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new HttpError(400, 'Expected a JSON object');
        }
        return parsed as Record<string, unknown>;
    } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(400, 'Expected JSON');
    }
}

async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/') {
        return new Response(readFileSync(HTML), {
            headers: {
                'content-type': 'text/html; charset=utf-8',
                'cache-control': 'no-store',
                // rs-world only renders inside a cross-origin-isolated iframe.
                // COEP credentialless lets that frame load; COOP isolates this page.
                'Cross-Origin-Opener-Policy': 'same-origin',
                'Cross-Origin-Embedder-Policy': 'credentialless',
            },
        });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/icons/')) {
        const rel = url.pathname.replace(/^\/+/, '');
        const file = join(import.meta.dir, 'public', rel);
        const iconsDir = join(import.meta.dir, 'public', 'icons');
        if (!file.startsWith(iconsDir) || !existsSync(file)) throw new HttpError(404, 'Not found');
        return new Response(Bun.file(file), { headers: { 'cache-control': 'no-cache' } });
    }
    if (req.method === 'GET' && url.pathname === '/api/fleet') {
        return json(await fleetPayload(url.searchParams.get('fresh') === '1'));
    }
    const iconMatch = url.pathname.match(/^\/api\/item-icon\/(\d{1,6})\.png$/);
    if (req.method === 'GET' && iconMatch) {
        const id = iconMatch[1];
        const base = (process.env.FLEET_DESK_SPRITE_BASE || 'https://rs-sdk-demo.fly.dev').replace(/\/$/, '');
        const upstream = await fetch(`${base}/sprite/item/${id}.png`, { signal: AbortSignal.timeout(8000) });
        if (!upstream.ok) throw new HttpError(404, `No icon for item ${id}`);
        return new Response(upstream.body, {
            headers: {
                'content-type': upstream.headers.get('content-type') || 'image/png',
                'cache-control': 'public, max-age=86400',
            },
        });
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
        return json({
            ok: true,
            uptimeMs: Date.now() - deskStart,
            cacheAgeMs: fleetCache ? Date.now() - fleetCache.at : null,
            jobsRunning: [...jobs.values()].filter((job) => job.status === 'running').length,
        });
    }
    if (req.method === 'GET' && url.pathname === '/api/jobs') {
        return json([...jobs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 12));
    }
    if (req.method === 'POST' && url.pathname === '/api/fleet/banks') {
        assertDeskFree();
        const args = [BANK_CHECK];
        const except = (url.searchParams.get('except') ?? '').split(/[\s,]+/).filter(Boolean);
        if (except.length > 0) args.push('--except', ...except);
        return json(startJob('fleet', 'banks', args));
    }

    const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (req.method === 'GET' && jobMatch) {
        const job = jobs.get(jobMatch[1] ?? '');
        if (!job) throw new HttpError(404, 'Unknown job');
        return json(job);
    }

    const botMatch = url.pathname.match(/^\/api\/bots\/([^/]+)(?:\/([^/]+))?$/);
    if (!botMatch) throw new HttpError(404, 'Not found');
    const name = canonicalName(botMatch[1] ?? '');
    const action = botMatch[2] ?? '';

    if (req.method === 'GET' && action === 'bank') {
        const snap = loadBank(name);
        let live: BankItem[] | null = null;
        try {
            const { state } = await readLiveState(name);
            if (state.bank?.isOpen) live = state.bank.items;
        } catch {
            live = null;
        }
        const capturedAt = snap?.capturedAt ?? null;
        const ageMs = capturedAt ? Date.now() - new Date(capturedAt).getTime() : null;
        return json({
            name,
            source: live ? 'live' : snap ? 'snapshot' : 'missing',
            capturedAt,
            stale: ageMs != null && ageMs > STALE_BANK_MS,
            items: (live ?? snap?.items ?? []).map((item) => ({ name: item.name, count: item.count })),
        });
    }

    if (req.method === 'GET' && action === 'state') {
        const { state, stateAge } = await readLiveState(name);
        return json({
            name,
            stateAge,
            text: renderState(state, stateAge),
            view: chromeView(state),
            combatLevel: state.player?.combatLevel ?? null,
            x: state.player?.worldX ?? null,
            z: state.player?.worldZ ?? null,
            area:
                state.player?.worldX != null && state.player?.worldZ != null
                    ? areaName(state.player.worldX, state.player.worldZ)
                    : null,
        });
    }

    if (req.method === 'GET' && action === 'log') {
        const which = url.searchParams.get('which') || 'grind';
        const pick = LOGS[which];
        if (!pick) throw new HttpError(400, `Unknown log "${which}"`);
        const path = pick(name);
        const lines = Math.min(Number(url.searchParams.get('lines') || 160) || 160, 400);
        return json({ name, which, missing: !existsSync(path), lines: tailFile(path, lines) });
    }

    if (req.method === 'POST' && action === 'stop') {
        assertDeskFree(name);
        // Drained stop: the grind banks first (park.json), so the next job
        // starts from a bank instead of mid-route.
        if (isDocker()) return json(startJob(name, 'stop', [CTL, 'stop', name, '--drain']));
        return json(startJob(name, 'stop', [LAUNCHD, 'stop', name, '--drain']));
    }
    if (req.method === 'POST' && action === 'restart') {
        assertDeskFree(name);
        // --verify waits for an effect (up to 10 min) so the job outcome says
        // "verified producing" instead of "process started, good luck".
        if (isDocker()) return json(startJob(name, 'restart', [CTL, 'restart', name, '--verify']));
        return json(startJob(name, 'restart', [LAUNCHD, 'restart', name, '--verify']));
    }
    if (req.method === 'POST' && action === 'chrome') {
        assertDeskFree(name);
        if (isDocker()) throw new HttpError(409, 'The VPS fleet runs headless — there is no browser client to move to.');
        return json(startJob(name, 'chrome', [LITE, 'to-chrome', name]));
    }
    if (req.method === 'POST' && action === 'lite') {
        assertDeskFree(name);
        if (isDocker()) throw new HttpError(409, 'The VPS fleet is already headless.');
        return json(startJob(name, 'lite', [LITE, 'to-lite', name]));
    }

    if (req.method === 'POST' && action === 'script') {
        const body = await readBody(req);
        const script = typeof body.script === 'string' ? body.script.trim() : '';
        const extra = typeof body.extra === 'string' ? body.extra : '';
        const problem = scriptError(script, (path) => existsSync(join(ROOT, path)));
        if (problem) throw new HttpError(400, problem);
        assertDeskFree(name);
        if (isDocker()) {
            // Before any repo write: the box deploys with a read-only key and
            // pull --ff-only, so a tracked-file rewrite here breaks the next
            // deploy (seen live: a 409 test dirtied roster.json and failed
            // the rollout). Roster changes go through a PR; fleet-ctl switch
            // stays for operator SSH use.
            throw new HttpError(409, 'Roster changes go through a pull request — the deploy rolls them to the box.');
        }
        const roster = readRosterFile();
        const assigned = assignRosterScript(roster, name, script, extra);
        writeRoster(roster);
        const bot = findBot(assigned.name);
        if (bot?.paused) {
            return json({ name: assigned.name, script, args: assigned.args, restarted: false, paused: true });
        }
        const job = startJob(assigned.name, 'switch', [LAUNCHD, 'switch', assigned.name, '--verify']);
        return json({ name: assigned.name, script, args: assigned.args, restarted: true, job });
    }

    if (req.method === 'POST' && action === 'pause') {
        const body = await readBody(req);
        if (typeof body.paused !== 'boolean') throw new HttpError(400, 'paused must be true or false');
        const before = findBot(name);
        if (!body.paused && before?.pauseSource === 'food-hub') {
            throw new HttpError(409, `${name} is paused by the food-hub lock. skip-bots will not release it.`);
        }
        if (body.paused) assertDeskFree(name);
        const current = existsSync(SKIP_PATH) ? readFileSync(SKIP_PATH, 'utf-8') : '';
        const next = setSkipList(current, name, body.paused);
        const tmp = `${SKIP_PATH}.desk-tmp`;
        writeFileSync(tmp, next);
        renameSync(tmp, SKIP_PATH);
        invalidateRosterCache();
        fleetCache = null;
        let job: Job | null = null;
        // Unpausing releases the bot; the shepherd wakes it within a cycle.
        // (Same on both supervisors — no start here.)
        if (body.paused) job = startJob(name, 'stop', isDocker() ? [CTL, 'stop', name, '--drain'] : [LAUNCHD, 'stop', name, '--drain']);
        const after = findBot(name);
        return json({
            name,
            paused: after?.paused ?? body.paused,
            pauseSource: after?.pauseSource ?? null,
            job,
        });
    }

    throw new HttpError(404, 'Not found');
}

const server = Bun.serve({
    hostname: HOST,
    port: PORT,
    idleTimeout: 30,
    async fetch(req) {
        try {
            return await handle(req);
        } catch (err) {
            const status = err instanceof HttpError ? err.status : 500;
            const message = err instanceof Error ? err.message : String(err);
            if (status === 500) console.error(err);
            return json({ error: message }, status);
        }
    },
});

const page = `http://${HOST}:${server.port}/`;
console.log(`Fleet desk  ${page}`);
console.log('Local only. Account passwords are not sent to the browser.');
if (!process.argv.includes('--no-open')) {
    Bun.spawn(['open', page], { stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' });
}
