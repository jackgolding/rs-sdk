/**
 * Fleet shepherd: classify → wake idle bots → enforce restart cap → notify.
 * Installed as com.rs-sdk.fleet-shepherd (StartInterval 600s) by fleet-launchd install.
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { ROOT, rosterBots, type RosterBot } from './roster';

export const MAX_RESTARTS_PER_HOUR = 4;
export const ROLLING_WINDOW_MS = 60 * 60 * 1000;
export const LOCK_STALE_MS = 5 * 60 * 1000;

const LOG_DIR = join(homedir(), 'Library', 'Logs', 'rs-sdk-fleet');
export const STATE_PATH = join(LOG_DIR, 'shepherd-state.json');
const LOCK_PATH = join(LOG_DIR, 'shepherd.lock');
const HUB_LOCK_PATH = join(LOG_DIR, 'abg-food-hub.lock');

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

export interface ShepherdBotState {
    restarts: number[];
    capped: boolean;
    notified: Record<string, number>;
}

export interface ShepherdState {
    bots: Record<string, ShepherdBotState>;
    lastRun: number;
}

export interface ClassifiedBot {
    name: string;
    kind: 'running' | 'wake' | 'intervene' | 'paused';
    reason: string;
    bunPid: number | null;
    x: number | null;
    z: number | null;
}

export function emptyState(): ShepherdState {
    return { bots: {}, lastRun: 0 };
}

export function loadState(): ShepherdState {
    if (!existsSync(STATE_PATH)) return emptyState();
    try {
        return JSON.parse(readFileSync(STATE_PATH, 'utf-8')) as ShepherdState;
    } catch {
        return emptyState();
    }
}

export function saveState(state: ShepherdState): void {
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
    const bot = bots[name] ?? { restarts: [], capped: false, notified: {} };
    bot.restarts = pruneRestarts([...bot.restarts, now], now);
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

/** `start` is a no-op while a controller is attached — bounce the job instead. */
export function shouldRestartZeroRate(
    row: Pick<ClassifiedBot, 'kind' | 'reason'>,
    bot: Pick<RosterBot, 'script' | 'bursty'> | undefined
): boolean {
    if (!bot || bot.bursty) return false;
    if (row.kind !== 'intervene') return false;
    return row.reason.startsWith('zero_rate');
}

/** @deprecated use shouldRestartZeroRate */
export const shouldRestartStuckThief = shouldRestartZeroRate;

export function expireCap(state: ShepherdState, name: string, now: number): ShepherdState {
    const bot = state.bots[name];
    if (!bot?.capped) return state;
    if (pruneRestarts(bot.restarts, now).length > MAX_RESTARTS_PER_HOUR) return state;
    const bots = { ...state.bots };
    bots[name] = { ...bot, capped: false };
    return { ...state, bots };
}

export function shouldCap(state: ShepherdState, name: string, now: number): boolean {
    const bot = state.bots[name];
    if (!bot) return false;
    return pruneRestarts(bot.restarts, now).length > MAX_RESTARTS_PER_HOUR;
}

export function clearCappedOnStart(state: ShepherdState, name: string, hadController: boolean, hasController: boolean): ShepherdState {
    if (!hadController && hasController) {
        const bots = { ...state.bots };
        const bot = bots[name] ?? { restarts: [], capped: false, notified: {} };
        bot.capped = false;
        bot.restarts = [];
        bots[name] = bot;
        return { ...state, bots };
    }
    return state;
}

export function shouldNotify(
    bot: ShepherdBotState | undefined,
    conditionKey: string,
    now: number
): boolean {
    if (!bot) return true;
    const last = bot.notified[conditionKey];
    return last == null;
}

export function markNotified(state: ShepherdState, name: string, conditionKey: string, now: number): ShepherdState {
    const bots = { ...state.bots };
    const bot = bots[name] ?? { restarts: [], capped: false, notified: {} };
    bot.notified = { ...bot.notified, [conditionKey]: now };
    bots[name] = bot;
    return { ...state, bots };
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
    const safe = body.slice(0, 200).replace(/"/g, "'");
    spawnSync('osascript', ['-e', `display notification "${safe}" with title "rs-sdk fleet"`], {
        stdio: 'ignore',
    });
}

async function classifyFleet(): Promise<ClassifiedBot[]> {
    const proc = spawnSync('bun', [join(ROOT, '.cursor/skills/wake-fleet/scripts/fleet-status.ts')], {
        cwd: ROOT,
        encoding: 'utf-8',
    });
    const payload = JSON.parse(proc.stdout) as {
        bots: Array<{
            name: string;
            kind: ClassifiedBot['kind'];
            reason: string;
            bunPid: number | null;
            x: number | null;
            z: number | null;
        }>;
    };
    return payload.bots.map((b) => ({
        name: b.name,
        kind: b.kind,
        reason: b.reason,
        bunPid: b.bunPid,
        x: b.x,
        z: b.z,
    }));
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

export async function runShepherdCycle(now = Date.now()): Promise<{
    woke: string[];
    capped: string[];
    notified: string[];
}> {
    if (isHubLocked()) {
        console.log('shepherd: abg-food-hub lock active — skip cycle');
        return { woke: [], capped: [], notified: [] };
    }

    if (!acquireLock(now)) {
        console.log('shepherd: previous cycle still running — skip');
        return { woke: [], capped: [], notified: [] };
    }

    const woke: string[] = [];
    const capped: string[] = [];
    const notified: string[] = [];

    try {
        let state = loadState();
        const rows = await classifyFleet();
        const roster = rosterBots();
        const rosterMap = new Map(roster.map((b) => [b.name, b]));

        for (const row of rows) {
            const prev = state.bots[row.name];
            const hadBun = prev?.restarts.length ? false : false; // simplified: detect via pid change below

            // Detect restart: new bun pid when we had none before in last cycle is handled by wake path
            state = expireCap(state, row.name, now);

            if (row.kind === 'paused') {
                continue;
            }

            if (row.kind === 'running' && row.bunPid) {
                if (prev?.capped || state.bots[row.name]?.capped) {
                    state = clearCappedOnStart(state, row.name, false, true);
                }
            }

            if (row.kind === 'wake') {
                const botState = state.bots[row.name];
                if (botState?.capped || shouldCap(state, row.name, now)) {
                    continue;
                }
                const started = launchdStart(row.name);
                if (shouldRecordWake(started)) {
                    woke.push(row.name);
                    state = recordRestart(state, row.name, now);
                }
            }

            const rosterBot = rosterMap.get(row.name);
            if (
                shouldRestartZeroRate(row, rosterBot) &&
                !state.bots[row.name]?.capped
            ) {
                if (launchdRestart(row.name)) {
                    woke.push(row.name);
                    state = recordRestart(state, row.name, now);
                }
            }

            if (shouldCap(state, row.name, now) && row.kind !== 'running') {
                const botState = state.bots[row.name] ?? { restarts: [], capped: false, notified: {} };
                if (!botState.capped) {
                    launchdStop(row.name);
                    botState.capped = true;
                    state.bots[row.name] = botState;
                    capped.push(row.name);
                }
            }

            if (row.kind === 'intervene') {
                const key = `intervene:${row.reason}`;
                if (shouldNotify(state.bots[row.name], key, now)) {
                    notified.push(`${row.name}: ${row.reason}`);
                    state = markNotified(state, row.name, key, now);
                }
            }

            if (state.bots[row.name]?.capped) {
                const key = 'capped';
                if (shouldNotify(state.bots[row.name], key, now)) {
                    notified.push(`${row.name}: restart cap exceeded`);
                    state = markNotified(state, row.name, key, now);
                }
            }
        }

        state.lastRun = now;
        saveState(state);

        if (notified.length > 0) {
            notifyMac(notified.join('; '));
        }

        console.log(
            `shepherd: woke=${woke.length} capped=${capped.length} notified=${notified.length}`
        );
        return { woke, capped, notified };
    } finally {
        releaseLock();
    }
}

if (import.meta.main) {
    runShepherdCycle()
        .then((r) => {
            if (r.woke.length) console.log('woke:', r.woke.join(', '));
            if (r.capped.length) console.log('capped:', r.capped.join(', '));
        })
        .catch((e) => {
            console.error(e);
            process.exitCode = 1;
        });
}
