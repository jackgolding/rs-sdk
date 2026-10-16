/**
 * Per-bot ownership. Written by the process that holds the control connection
 * so fleet-status never guesses ownership from argv text.
 *
 *   bots/{name}/assignment.json
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';

export const REPO_ROOT = resolve(dirname(import.meta.path), '..');

export interface OwnershipRecord {
    name: string;
    pid?: number;
    /** Script path followed by its args, as passed to bun. */
    argv: string[];
    command: string;
    startedAt?: string;
    /** Legacy files used observedAt instead of startedAt. */
    observedAt?: string;
    /** `'connect'` for new records. Legacy `'launchd' | 'observed'` stays readable and is never live. */
    source?: string;
}

export interface ResolvedOwner {
    pid: number;
    command: string;
    supervised: boolean;
    startedAt: string | null;
    legacy: boolean;
}

export interface OwnerDeps {
    /** Defaults to `process.kill(pid, 0)`. */
    kill?: (pid: number, signal?: number) => void;
    /** Defaults to `ps -o command= -p pid`. Return null when the process is gone. */
    ps?: (pid: number) => string | null;
    /** Override the repo root (tests). */
    root?: string;
    pid?: number;
    argv?: string[];
    now?: () => string;
}

export interface LaunchdOwnerHint {
    loaded: boolean;
    pid?: number | null;
    programArgs?: string[];
}

export function assignmentPath(name: string, root = REPO_ROOT): string {
    return join(root, 'bots', name, 'assignment.json');
}

function repoRelative(path: string): string {
    const abs = resolve(path);
    if (abs === REPO_ROOT || abs.startsWith(`${REPO_ROOT}/`)) {
        return relative(REPO_ROOT, abs) || path;
    }
    return path;
}

export function readOwnership(name: string, deps?: Pick<OwnerDeps, 'root'>): OwnershipRecord | null {
    const path = assignmentPath(name, deps?.root ?? REPO_ROOT);
    if (!existsSync(path)) return null;
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf-8')) as OwnershipRecord;
        if (!Array.isArray(parsed.argv) || parsed.argv.length === 0) return null;
        if (typeof parsed.command !== 'string' || !parsed.command) return null;
        if (parsed.name && parsed.name !== name) return null;
        return parsed;
    } catch {
        return null;
    }
}

function defaultKill(pid: number, signal = 0): void {
    process.kill(pid, signal);
}

function defaultPs(pid: number): string | null {
    try {
        const proc = Bun.spawnSync(['ps', '-o', 'command=', '-p', String(pid)], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        if (proc.exitCode !== 0) return null;
        const text = proc.stdout.toString().trim();
        return text || null;
    } catch {
        return null;
    }
}

/** Live when the pid exists and its command still contains the recorded script path. */
export function isOwnerLive(record: OwnershipRecord, deps?: OwnerDeps): boolean {
    if (record.pid == null || !Number.isInteger(record.pid) || record.pid <= 0) return false;
    if (!record.argv?.length) return false;
    const kill = deps?.kill ?? defaultKill;
    try {
        kill(record.pid, 0);
    } catch {
        return false;
    }
    const ps = deps?.ps ?? defaultPs;
    const cmd = ps(record.pid);
    if (!cmd) return false;
    return cmd.includes(record.argv[0]!);
}

/**
 * Writes the ownership record for the process that just connected in control mode.
 * No-op when `bots/{name}/` does not exist, or when argv is empty.
 */
export function recordOwnership(name: string | undefined, deps?: OwnerDeps): void {
    if (!name) return;
    const root = deps?.root ?? REPO_ROOT;
    const dir = join(root, 'bots', name);
    if (!existsSync(dir)) return;
    const raw = deps?.argv ?? process.argv.slice(1);
    if (raw.length === 0) return;
    const argv = deps?.argv ? raw : [repoRelative(raw[0]!), ...raw.slice(1)];
    if (argv.length === 0 || !argv[0]) return;
    const payload: OwnershipRecord = {
        name,
        pid: deps?.pid ?? process.pid,
        argv,
        command: ['bun', ...argv].join(' '),
        startedAt: (deps?.now ?? (() => new Date().toISOString()))(),
        source: 'connect',
    };
    try {
        writeFileSync(assignmentPath(name, root), `${JSON.stringify(payload, null, 4)}\n`);
    } catch {
        /* a missing directory is a no-op; other IO errors must not fail connect() */
    }
}

function commandFromProgramArgs(args: string[]): string {
    if (args.length === 0) return '';
    const bunIndex = args.findIndex((arg) => /(^|\/)bun$/.test(arg));
    const rest = bunIndex >= 0 ? args.slice(bunIndex + 1) : args;
    return ['bun', ...rest].join(' ');
}

/**
 * A live ownership record, else the launchd agent pid (`legacy: true`), else null.
 * `supervised` is the pid match with the launchd agent. Name-in-argv is never consulted.
 */
export function resolveOwner(
    name: string,
    launchd: LaunchdOwnerHint | null,
    deps?: OwnerDeps
): ResolvedOwner | null {
    const record = readOwnership(name, deps);
    if (record && isOwnerLive(record, deps)) {
        const pid = record.pid!;
        return {
            pid,
            command: record.command,
            supervised: launchd?.pid != null && launchd.pid === pid,
            startedAt: record.startedAt ?? record.observedAt ?? null,
            legacy: false,
        };
    }
    if (launchd?.loaded && launchd.pid != null) {
        return {
            pid: launchd.pid,
            command: commandFromProgramArgs(launchd.programArgs ?? []),
            supervised: true,
            startedAt: null,
            legacy: true,
        };
    }
    return null;
}

/**
 * Alias used by `runScript` and `ActivitySession`. Records this process for
 * `BOT_USERNAME`. No-op when that env var is unset.
 */
export function recordScriptAssignment(): void {
    recordOwnership(process.env.BOT_USERNAME);
}
