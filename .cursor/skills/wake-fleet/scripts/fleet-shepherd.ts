/**
 * Fleet shepherd: classify → plan one action per bot → execute → notify.
 * Mac: installed as com.rs-sdk.fleet-shepherd (StartInterval 600s) by
 * fleet-launchd install. VPS: systemd timer with FLEET_SUPERVISOR=docker,
 * FLEET_BOTS_DIR=/srv/fleet/bots, FLEET_STATE_DIR=/srv/fleet/state
 * (see infra/pilot/observability/README.md).
 *
 * A cycle never starts and stops the same bot. `canStart` is checked before any start.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, appendFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { ROOT, rosterBots, type RosterBot } from './roster';
import { dockerContainerId, supervisorInfo, supervisorKind } from './supervisor';

export const MAX_RESTARTS_PER_HOUR = 4;
export const ROLLING_WINDOW_MS = 60 * 60 * 1000;
export const RENOTIFY_MS = 2 * 60 * 60 * 1000;
export const LOCK_STALE_MS = 5 * 60 * 1000;
const ACTION_KEEP_MS = 2 * 60 * 60 * 1000;
/**
 * Gap between shepherd cycles that means the Mac slept, rebooted, or the
 * shepherd starved (normal gap is ~StartInterval 600s + runtime). On wake
 * every bot looks stuck at once; treat it as a fresh episode instead of
 * waiting out per-bot backoff.
 */
export const WAKE_GAP_MS = 20 * 60 * 1000;

/** True when the shepherd itself was quiet long enough to imply sleep/reboot. */
export function detectWake(state: ShepherdState, now: number): boolean {
    if (!state.lastRun) return false;
    return now - state.lastRun > WAKE_GAP_MS;
}

const DEFAULT_STATE_DIR = join(homedir(), 'Library', 'Logs', 'rs-sdk-fleet');
/**
 * State home. Mac default is the historical log dir; the VPS host sets
 * FLEET_STATE_DIR=/srv/fleet/state (host dir, survives redeploys, never git).
 * fleet-status reads shepherd state through loadState(), so capped/churning
 * verdicts light up wherever this points.
 */
export const STATE_DIR = process.env.FLEET_STATE_DIR ?? DEFAULT_STATE_DIR;
export const STATE_PATH = join(STATE_DIR, 'shepherd-state.json');
const LOCK_PATH = join(STATE_DIR, 'shepherd.lock');
/** Docker-mode notification sink (replaces the Mac osascript popup). */
const SHEPHERD_LOG = join(STATE_DIR, 'shepherd.log');
const HUB_LOCK_PATH = join(DEFAULT_STATE_DIR, 'abg-food-hub.lock');

function isHubLocked(): boolean {
    if (!existsSync(HUB_LOCK_PATH)) return false;
    try {
        const lines = readFileSync(HUB_LOCK_PATH, 'utf-8').trim().split('\n');
        const pid = Number(lines[0]);
        if (!Number.isFinite(pid) || pid <= 0) return false;
        const proc = spawnSync('kill', ['-0', String(pid)]);
        return proc.status === 0;
    } catch {
        return false;
    }
}

export interface ShepherdActionRecord {
    t: number;
    action: 'start' | 'restart' | 'cap' | 'uncap' | 'skip-foreign' | 'skip-finished';
}

export interface ShepherdBotState {
    restarts: number[];
    capped: boolean;
    cappedAt?: number | null;
    notified: Record<string, number>;
    actions?: ShepherdActionRecord[];
    runsSamples?: { t: number; runs: number }[];
    episodeRestarted?: boolean;
}

export interface ShepherdState {
    bots: Record<string, ShepherdBotState>;
    lastRun: number;
}

export interface ShepherdRow {
    name: string;
    kind: string;
    owner?: { pid?: number; supervised?: boolean } | null;
}

export interface PlanAction {
    name: string;
    op: 'start' | 'restart' | 'stop';
}

export interface CyclePlan {
    actions: PlanAction[];
    state: ShepherdState;
    notifications: string[];
    woke: string[];
    capped: string[];
}

export function emptyState(): ShepherdState {
    return { bots: {}, lastRun: 0 };
}

/** Drops legacy `intervene:*` keys and fills fields added by this feature. */
export function migrateShepherdState(raw: Partial<ShepherdState> | null | undefined): ShepherdState {
    const bots: Record<string, ShepherdBotState> = {};
    for (const [name, bot] of Object.entries(raw?.bots ?? {})) {
        if (!bot) continue;
        const notified: Record<string, number> = {};
        for (const [key, value] of Object.entries(bot.notified ?? {})) {
            if (key.startsWith('intervene:')) continue;
            if (typeof value === 'number') notified[key] = value;
        }
        bots[name] = {
            restarts: Array.isArray(bot.restarts) ? bot.restarts : [],
            capped: bot.capped === true,
            cappedAt: bot.cappedAt ?? null,
            notified,
            actions: Array.isArray(bot.actions) ? bot.actions : [],
            runsSamples: Array.isArray(bot.runsSamples) ? bot.runsSamples : [],
            episodeRestarted: bot.episodeRestarted === true,
        };
    }
    return { bots, lastRun: raw?.lastRun ?? 0 };
}

export function loadState(): ShepherdState {
    if (!existsSync(STATE_PATH)) return emptyState();
    try {
        return migrateShepherdState(JSON.parse(readFileSync(STATE_PATH, 'utf-8')) as ShepherdState);
    } catch {
        return emptyState();
    }
}

export function saveState(state: ShepherdState): void {
    mkdirSync(STATE_DIR, { recursive: true });
    const tmp = `${STATE_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    writeFileSync(STATE_PATH, readFileSync(tmp));
    try {
        unlinkSync(tmp);
    } catch {
        /* ignore */
    }
}

export function pruneRestarts(restarts: number[], now: number): number[] {
    return restarts.filter((t) => now - t < ROLLING_WINDOW_MS);
}

export function recordRestart(state: ShepherdState, name: string, now: number): ShepherdState {
    const bots = { ...state.bots };
    const bot = {
        ...(bots[name] ?? { restarts: [], capped: false, notified: {} }),
    };
    bot.restarts = pruneRestarts([...(bot.restarts ?? []), now], now);
    bots[name] = bot;
    return { ...state, bots };
}

export type LaunchdStartResult = 'started' | 'already-running' | 'failed';

/** Shepherd must not count a no-op `start` (loaded, already has a pid) toward the hourly cap. */
export function parseLaunchdStartOutput(output: string, status: number | null): LaunchdStartResult {
    if (/: already running\b/.test(output)) return 'already-running';
    if (status === 0) return 'started';
    return 'failed';
}

export function shouldRecordWake(result: LaunchdStartResult): boolean {
    return result === 'started';
}

/** True when one more start still fits in the rolling hour. */
export function canStart(state: ShepherdState, name: string, now: number): boolean {
    const restarts = state.bots[name]?.restarts ?? [];
    return pruneRestarts(restarts, now).length + 1 <= MAX_RESTARTS_PER_HOUR;
}

export function shouldCap(state: ShepherdState, name: string, now: number): boolean {
    const bot = state.bots[name];
    if (!bot) return false;
    return pruneRestarts(bot.restarts, now).length > MAX_RESTARTS_PER_HOUR;
}

export function shouldNotify(bot: ShepherdBotState | undefined, conditionKey: string, now: number): boolean {
    if (!bot) return true;
    const last = bot.notified[conditionKey];
    if (last == null) return true;
    return now - last >= RENOTIFY_MS;
}

export function markNotified(state: ShepherdState, name: string, conditionKey: string, now: number): ShepherdState {
    const bots = { ...state.bots };
    const bot = { ...(bots[name] ?? { restarts: [], capped: false, notified: {} }) };
    bot.notified = { ...bot.notified, [conditionKey]: now };
    bots[name] = bot;
    return { ...state, bots };
}

function conditionOf(kind: string): string | null {
    switch (kind) {
        case 'capped':
            return 'capped';
        case 'alive-not-producing':
            return 'not_producing';
        case 'churning':
            return 'churning';
        case 'needs-supplies':
            return 'needs_supplies';
        case 'needs-client':
            return 'needs_client';
        case 'foreign-owner':
            return 'foreign_owner';
        case 'finished':
            return 'finished';
        default:
            return null;
    }
}

function cloneState(state: ShepherdState): ShepherdState {
    return migrateShepherdState(JSON.parse(JSON.stringify(state)) as ShepherdState);
}

function ensure(state: ShepherdState, name: string): ShepherdBotState {
    const existing = state.bots[name];
    if (existing) return existing;
    const created: ShepherdBotState = {
        restarts: [],
        capped: false,
        cappedAt: null,
        notified: {},
        actions: [],
        runsSamples: [],
        episodeRestarted: false,
    };
    state.bots[name] = created;
    return created;
}

function logAction(bot: ShepherdBotState, action: ShepherdActionRecord['action'], now: number): void {
    bot.actions = [...(bot.actions ?? []), { t: now, action }].filter((entry) => now - entry.t < ACTION_KEEP_MS);
}

/**
 * Pure cycle plan. `actions` is what launchd should run. A bot is never both
 * started and stopped. `woke` lists starts that this plan does not undo.
 */
export function planCycle(
    state: ShepherdState,
    rows: ShepherdRow[],
    _rosterMap: Map<string, RosterBot>,
    now: number,
    opts?: { wake?: boolean }
): CyclePlan {
    const next = cloneState(state);
    const actions: PlanAction[] = [];
    const notifications: string[] = [];
    const woke: string[] = [];
    const capped: string[] = [];

    if (opts?.wake) {
        for (const bot of Object.values(next.bots)) bot.episodeRestarted = false;
        const quietMin = state.lastRun ? Math.round((now - state.lastRun) / 60_000) : 0;
        notifications.push(`wake after ${quietMin}m quiet — fresh episode`);
    }

    for (const row of rows) {
        const bot = ensure(next, row.name);
        if (row.kind === 'paused') {
            bot.notified = {};
            continue;
        }

        const code = conditionOf(row.kind);
        for (const key of Object.keys(bot.notified)) {
            if (key !== code) delete bot.notified[key];
        }

        if (row.kind === 'restartable' || row.kind === 'capped') {
            if (canStart(next, row.name, now)) {
                actions.push({ name: row.name, op: 'start' });
                woke.push(row.name);
                bot.restarts = pruneRestarts([...(bot.restarts ?? []), now], now);
                if (bot.capped) {
                    bot.capped = false;
                    bot.cappedAt = null;
                    logAction(bot, 'uncap', now);
                }
                logAction(bot, 'start', now);
            } else if (!bot.capped) {
                bot.capped = true;
                bot.cappedAt = now;
                capped.push(row.name);
                logAction(bot, 'cap', now);
            }
        } else if (row.kind === 'alive-not-producing') {
            const supervised = row.owner?.supervised === true;
            if (supervised && canStart(next, row.name, now) && !bot.episodeRestarted) {
                actions.push({ name: row.name, op: 'restart' });
                woke.push(row.name);
                bot.restarts = pruneRestarts([...(bot.restarts ?? []), now], now);
                bot.episodeRestarted = true;
                logAction(bot, 'restart', now);
            }
        } else if (row.kind === 'foreign-owner') {
            logAction(bot, 'skip-foreign', now);
        } else if (row.kind === 'finished') {
            logAction(bot, 'skip-finished', now);
        } else if (row.kind === 'producing') {
            bot.episodeRestarted = false;
        }

        if (code && shouldNotify(bot, code, now)) {
            notifications.push(`${row.name}: ${code}`);
            bot.notified = { ...bot.notified, [code]: now };
        }
    }

    const started = new Set(actions.filter((action) => action.op !== 'stop').map((action) => action.name));
    return {
        actions: actions.filter((action) => !(action.op === 'stop' && started.has(action.name))),
        state: next,
        notifications,
        woke,
        capped,
    };
}

export function acquireLock(now: number): boolean {
    if (existsSync(LOCK_PATH)) {
        try {
            const raw = readFileSync(LOCK_PATH, 'utf-8');
            const age = now - Number(raw);
            if (Number.isFinite(age) && age < LOCK_STALE_MS) return false;
        } catch {
            /* stale lock */
        }
    }
    writeFileSync(LOCK_PATH, String(now));
    return true;
}

export function releaseLock(): void {
    try {
        unlinkSync(LOCK_PATH);
    } catch {
        /* ignore */
    }
}

function notifyMac(body: string): void {
    if (supervisorKind() === 'docker') {
        try {
            appendFileSync(SHEPHERD_LOG, `${new Date().toISOString()} ${body}\n`);
        } catch {
            console.error(`shepherd notify: ${body}`);
        }
        return;
    }
    const safe = body.slice(0, 200).replace(/"/g, "'");
    spawnSync('osascript', ['-e', `display notification "${safe}" with title "rs-sdk fleet"`], {
        stdio: 'ignore',
    });
}

function sampleRuns(state: ShepherdState, now: number): ShepherdState {
    const next = cloneState(state);
    for (const bot of rosterBots()) {
        const info = supervisorInfo(bot.name);
        if (!info.loaded || info.runs == null) continue;
        const entry = ensure(next, bot.name);
        entry.runsSamples = [...(entry.runsSamples ?? []), { t: now, runs: info.runs }].filter(
            (sample) => now - sample.t < ACTION_KEEP_MS
        );
    }
    return next;
}

async function classifyFleet(): Promise<ShepherdRow[] | null> {
    const proc = spawnSync('bun', [join(ROOT, '.cursor/skills/wake-fleet/scripts/fleet-status.ts')], {
        cwd: ROOT,
        encoding: 'utf-8',
    });
    const stdout = proc.stdout ?? '';
    const stderr = (proc.stderr ?? '').trim();
    try {
        if (!stdout.trim()) throw new Error('empty stdout');
        const payload = JSON.parse(stdout) as {
            bots: Array<{ name: string; kind: string; owner?: ShepherdRow['owner'] }>;
        };
        return payload.bots.map((bot) => ({
            name: bot.name,
            kind: bot.kind,
            owner: bot.owner ?? null,
        }));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`ERROR fleet-status JSON parse failed: ${message}`);
        if (stderr) console.error(stderr);
        return null;
    }
}

function launchdRestart(name: string): boolean {
    const proc = spawnSync(
        'bun',
        [join(ROOT, '.cursor/skills/wake-fleet/scripts/fleet-launchd.ts'), 'restart', name],
        { cwd: ROOT, encoding: 'utf-8' }
    );
    return proc.status === 0;
}

function launchdStart(name: string): LaunchdStartResult {
    const proc = spawnSync(
        'bun',
        [join(ROOT, '.cursor/skills/wake-fleet/scripts/fleet-launchd.ts'), 'start', name],
        { cwd: ROOT, encoding: 'utf-8' }
    );
    const output = `${proc.stdout ?? ''}${proc.stderr ?? ''}`;
    if (output.trim()) console.log(output.trim());
    return parseLaunchdStartOutput(output, proc.status);
}

function launchdStop(name: string): boolean {
    const proc = spawnSync(
        'bun',
        [join(ROOT, '.cursor/skills/wake-fleet/scripts/fleet-launchd.ts'), 'stop', name],
        { cwd: ROOT, encoding: 'utf-8' }
    );
    return proc.status === 0;
}

/**
 * Docker executors. Act on the container ID (compose names carry the
 * fleet- prefix, so the bare quest-<slug> name never matches).
 *
 * STOP_GRACE: `docker restart`/`stop` wait up to the compose stop grace
 * (700s quest drain) for SIGTERM handlers. A full drain per bot stalls a
 * 10-minute cycle when several bots need restarts, so cap the wait: stuck
 * bots are restarted BECAUSE they are stuck, and producing bots are never
 * touched, so SIGKILL after the grace is the right tradeoff.
 * NOTE: a manual restart resets Docker's RestartCount — loop detection must
 * use the shepherd's own restarts[] timestamps, never the counter alone.
 */
const STOP_GRACE_SECS = 90;

function dockerAct(name: string, op: 'start' | 'stop' | 'restart'): boolean {
    const id = dockerContainerId(name);
    if (!id) {
        console.error(`shepherd: no quest container for ${name}`);
        return false;
    }
    console.log(`shepherd: docker ${op} ${name} (grace ${STOP_GRACE_SECS}s)`);
    const args = op === 'start' ? [op, id] : [op, '-t', String(STOP_GRACE_SECS), id];
    const proc = spawnSync('docker', args, { encoding: 'utf-8' });
    if ((proc.stdout ?? '').trim()) console.log((proc.stdout ?? '').trim());
    if (proc.status !== 0) console.error(`shepherd: docker ${op} ${name}: ${(proc.stderr ?? '').trim()}`);
    return proc.status === 0;
}

function botStart(name: string): LaunchdStartResult {
    if (supervisorKind() === 'docker') return dockerAct(name, 'start') ? 'started' : 'failed';
    return launchdStart(name);
}

function botRestart(name: string): boolean {
    if (supervisorKind() === 'docker') return dockerAct(name, 'restart');
    return launchdRestart(name);
}

function botStop(name: string): boolean {
    if (supervisorKind() === 'docker') return dockerAct(name, 'stop');
    return launchdStop(name);
}

export async function runShepherdCycle(now = Date.now(), opts?: { dryRun?: boolean; only?: string }): Promise<{
    woke: string[];
    capped: string[];
    notified: string[];
}> {
    // The food-hub lock is Mac orchestration; the VPS runs roster jobs only.
    if (supervisorKind() !== 'docker' && isHubLocked()) {
        console.log('shepherd: abg-food-hub lock active — skip cycle');
        return { woke: [], capped: [], notified: [] };
    }

    if (!opts?.dryRun && !acquireLock(now)) {
        console.log('shepherd: previous cycle still running — skip');
        return { woke: [], capped: [], notified: [] };
    }

    try {
        let state = sampleRuns(loadState(), now);
        const rows = await classifyFleet();
        if (!rows) {
            console.error('ERROR shepherd skipped cycle after fleet-status JSON parse failed');
            return { woke: [], capped: [], notified: [] };
        }
        const rosterMap = new Map(rosterBots().map((bot) => [bot.name, bot]));
        const wake = detectWake(state, now);
        if (wake) console.log(`shepherd: wake after ${Math.round((now - state.lastRun) / 60_000)}m quiet`);
        const scoped = opts?.only ? rows.filter((row) => row.name.toLowerCase() === opts.only!.toLowerCase()) : rows;
        if (opts?.only && scoped.length === 0) console.log(`shepherd: no such bot ${opts.only}`);
        const plan = planCycle(state, scoped, rosterMap, now, { wake });
        if (opts?.dryRun) {
            for (const action of plan.actions) console.log(`plan: ${action.op} ${action.name}`);
            console.log(`plan: woke=${plan.woke.length} capped=${plan.capped.length} notified=${plan.notifications.length}`);
            return { woke: plan.woke, capped: plan.capped, notified: plan.notifications };
        }
        for (const action of plan.actions) {
            if (action.op === 'start') botStart(action.name);
            else if (action.op === 'restart') botRestart(action.name);
            else if (action.op === 'stop') botStop(action.name);
        }
        plan.state.lastRun = now;
        saveState(plan.state);
        if (plan.notifications.length > 0) notifyMac(plan.notifications.join('; '));
        console.log(`shepherd: woke=${plan.woke.length} capped=${plan.capped.length} notified=${plan.notifications.length}`);
        return { woke: plan.woke, capped: plan.capped, notified: plan.notifications };
    } finally {
        if (!opts?.dryRun) releaseLock();
    }
}

if (import.meta.main) {
    const dryRun = process.argv.includes('--plan');
    const only = process.argv.slice(2).find((a) => !a.startsWith('-'));
    runShepherdCycle(Date.now(), { dryRun, only })
        .then((result) => {
            if (result.woke.length) console.log('woke:', result.woke.join(', '));
            if (result.capped.length) console.log('capped:', result.capped.join(', '));
        })
        .catch((error) => {
            console.error(error);
            process.exitCode = 1;
        });
}
