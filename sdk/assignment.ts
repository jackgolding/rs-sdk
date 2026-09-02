/**
 * Per-bot job identity. Written when a script starts so fleet-status can
 * restart the same command without guessing from grind.log text.
 *
 *   bots/{name}/assignment.json
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';

export const REPO_ROOT = resolve(dirname(import.meta.path), '..');

export type AssignmentSource = 'launchd' | 'observed';

export interface Assignment {
    name: string;
    /** Script path followed by its args, as passed to bun. */
    argv: string[];
    command: string;
    observedAt: string;
    source: AssignmentSource;
}

export function assignmentPath(name: string): string {
    return join(REPO_ROOT, 'bots', name, 'assignment.json');
}

export function readAssignment(name: string): Assignment | null {
    const path = assignmentPath(name);
    if (!existsSync(path)) return null;
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Assignment;
        if (!Array.isArray(parsed.argv) || parsed.argv.length === 0) return null;
        if (typeof parsed.command !== 'string' || !parsed.command) return null;
        return parsed;
    } catch {
        return null;
    }
}

/**
 * Records what this bot is running. Safe to call on every status pass; skips
 * the write when nothing changed so it does not churn the file.
 */
export function writeAssignment(name: string, argv: string[], source: AssignmentSource): void {
    if (argv.length === 0) return;
    const command = ['bun', ...argv].join(' ');
    const existing = readAssignment(name);
    if (existing?.command === command && existing.source === source) return;
    const payload: Assignment = {
        name,
        argv,
        command,
        observedAt: new Date().toISOString(),
        source,
    };
    try {
        writeFileSync(assignmentPath(name), `${JSON.stringify(payload, null, 4)}\n`);
    } catch {
        /* bots/{name}/ may not exist yet; a missing cache just falls back to the roster */
    }
}

function repoRelative(path: string): string {
    const abs = resolve(path);
    if (abs === REPO_ROOT || abs.startsWith(`${REPO_ROOT}/`)) {
        return relative(REPO_ROOT, abs) || path;
    }
    return path;
}

/**
 * Writes bots/{BOT_USERNAME}/assignment.json from this process's argv.
 * No-op when BOT_USERNAME is unset (unit tests, MCP execute_code).
 */
export function recordScriptAssignment(source: AssignmentSource = 'observed'): void {
    const name = process.env.BOT_USERNAME;
    if (!name) return;
    const raw = process.argv.slice(1);
    if (raw.length === 0) return;
    const script = raw[0]!;
    writeAssignment(name, [repoRelative(script), ...raw.slice(1)], source);
}
