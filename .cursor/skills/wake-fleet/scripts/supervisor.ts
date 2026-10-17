/**
 * Supervisor abstraction: launchd (Mac) vs Docker (VPS).
 *
 * fleet-status classifies from SupervisorInfo, which keeps the LaunchdInfo
 * shape so fleet-verdict stays untouched. Select with FLEET_SUPERVISOR
 * (`launchd` default, `docker` on the VPS host). Unknown values fall back
 * to launchd — a typo must never blind the Mac desk.
 *
 * Docker ownership note: assignment.json pids are container-internal, so a
 * host-side kill(pid, 0) checks the wrong namespace. On Docker a record is
 * live when its quest container runs AND the recorded command matches the
 * roster command — the container's main process IS the quest script, so a
 * running container with the right command means a live owner.
 */

import { dirname, resolve } from 'path';
import { commandFromProgramArgs, launchdInfo, type LaunchdInfo } from './launchd-info';
import { readOwnership, type ResolvedOwner } from '../../../../sdk/assignment';

export type SupervisorKind = 'launchd' | 'docker';
export type SupervisorInfo = LaunchdInfo;

export function supervisorKind(): SupervisorKind {
    return process.env.FLEET_SUPERVISOR === 'docker' ? 'docker' : 'launchd';
}

/** Mirrors gen-compose.py service naming: quest-<lowercase name>. */
export function dockerContainerName(botName: string): string {
    return `quest-${botName.toLowerCase()}`;
}

/** Compose prefixes container names with the project (fleet-quest-x-1). */
export function dockerNameFilter(botName: string): string {
    return dockerContainerName(botName);
}

export interface DockerInspectState {
    Status?: string;
    Running?: boolean;
    Pid?: number;
    ExitCode?: number;
}

export interface DockerInspectEntry {
    State?: DockerInspectState;
    RestartCount?: number;
    Path?: string;
    Args?: string[];
    Config?: { Cmd?: string[] | null; Entrypoint?: string[] | null };
}

/**
 * Pure parser for `docker inspect` output (an array; first entry wins).
 * Returns `{ loaded: false }` for empty/missing arrays — same contract as
 * parseLaunchctlPrint's unloaded case.
 */
export function parseDockerInspect(entries: unknown): SupervisorInfo {
    if (!Array.isArray(entries) || entries.length === 0) return { loaded: false };
    const entry = entries[0] as DockerInspectEntry;
    const state = entry.State;
    if (!state) return { loaded: false };
    const running = state.Running === true;
    const programArgs =
        entry.Args && entry.Args.length > 0 && entry.Path
            ? [entry.Path, ...entry.Args]
            : [...(entry.Config?.Entrypoint ?? []), ...(entry.Config?.Cmd ?? [])];
    return {
        loaded: true,
        pid: typeof state.Pid === 'number' && state.Pid > 0 ? state.Pid : null,
        runs: typeof entry.RestartCount === 'number' ? entry.RestartCount : null,
        lastExit: typeof state.ExitCode === 'number' ? String(state.ExitCode) : null,
        state: state.Status ?? (running ? 'running' : 'exited'),
        programArgs,
    };
}

function runDocker(args: string[]): { ok: boolean; out: string } {
    try {
        const proc = Bun.spawnSync(['docker', ...args], { stdout: 'pipe', stderr: 'pipe' });
        return { ok: proc.exitCode === 0, out: proc.stdout.toString() };
    } catch {
        return { ok: false, out: '' };
    }
}

/** `{ loaded: false }` when docker is absent or no quest container matches. */
export function dockerContainerId(botName: string): string | null {
    const ps = runDocker(['ps', '-a', '--filter', `name=${dockerNameFilter(botName)}`, '--format', '{{.ID}}']);
    const id = ps.ok ? ps.out.split('\n').map((l) => l.trim()).filter(Boolean)[0] : undefined;
    return id ?? null;
}

/** `{ loaded: false }` when docker is absent or no quest container matches. */
export function dockerSupervisorInfo(botName: string): SupervisorInfo {
    const id = dockerContainerId(botName);
    if (!id) return { loaded: false };
    const inspect = runDocker(['inspect', id]);
    if (!inspect.ok) return { loaded: false };
    try {
        return parseDockerInspect(JSON.parse(inspect.out));
    } catch {
        return { loaded: false };
    }
}

/** Dispatches on FLEET_SUPERVISOR. Mac callers keep getting launchd. */
export function supervisorInfo(botName: string): SupervisorInfo {
    return supervisorKind() === 'docker' ? dockerSupervisorInfo(botName) : launchdInfo(botName);
}

/**
 * Assignment root for ownership reads. Per-bot live files (assignment.json,
 * grind.log, heartbeat.log) live under FLEET_BOTS_DIR on the VPS host
 * (/srv/fleet/bots), not in the repo checkout — so the root is its parent.
 * Returns undefined on the Mac so assignment.ts defaults apply.
 */
export function assignmentRoot(): string | undefined {
    const botsDir = process.env.FLEET_BOTS_DIR;
    if (!botsDir) return undefined;
    return dirname(resolve(botsDir));
}

/**
 * Docker owner resolution. Mirrors resolveOwner's contract (live record,
 * else supervised legacy owner, else null) without pid-namespace checks.
 */
export function resolveSupervisorOwner(
    name: string,
    info: SupervisorInfo,
    opts?: { root?: string; expectedCommand?: string }
): ResolvedOwner | null {
    const record = readOwnership(name, opts?.root ? { root: opts.root } : undefined);
    if (record && info.loaded && opts?.expectedCommand && record.command === opts.expectedCommand) {
        const pid = info.pid ?? record.pid;
        if (pid == null) return null;
        return {
            pid,
            command: record.command,
            supervised: commandFromProgramArgs(info.programArgs ?? []) === record.command,
            startedAt: record.startedAt ?? record.observedAt ?? null,
            legacy: false,
        };
    }
    if (info.loaded && info.pid != null) {
        return {
            pid: info.pid,
            command: commandFromProgramArgs(info.programArgs ?? []),
            supervised: true,
            startedAt: null,
            legacy: true,
        };
    }
    return null;
}
