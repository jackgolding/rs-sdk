#!/usr/bin/env bun
/**
 * Detached worktree for cloud or headless agents.
 *
 *   bun .cursor/scripts/offline-worktree.ts
 *
 * Writes .cursor/offline-worktree (gitignored) so fleet-launchd and
 * lite-launchd refuse start/stop/restart/install in that checkout.
 * Does not copy bot.env. Does not push.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

const ROOT = resolve(dirname(import.meta.path), '../..');
export const OFFLINE_MARKER = join('.cursor', 'offline-worktree');

export function isOfflineWorktree(root: string): boolean {
    return existsSync(join(root, OFFLINE_MARKER));
}

/** Exit when this checkout is the offline worktree. status stays allowed. */
export function assertOnlineWorktree(root: string, command: string): void {
    if (!isOfflineWorktree(root)) return;
    if (command === 'status') return;
    console.error(
        `offline worktree: refusing ${command}. Live fleet control stays on the main checkout.`,
    );
    process.exit(1);
}

function main(): void {
    const dest = resolve(ROOT, '..', 'rs-sdk-offline');
    if (!existsSync(join(dest, '.git')) && !existsSync(dest)) {
        const proc = Bun.spawnSync(['git', 'worktree', 'add', '--detach', dest, 'HEAD'], {
            cwd: ROOT,
            stdout: 'inherit',
            stderr: 'inherit',
        });
        if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1);
    } else if (!existsSync(dest)) {
        throw new Error(`${dest} exists but is not a git worktree`);
    }
    mkdirSync(join(dest, '.cursor'), { recursive: true });
    writeFileSync(join(dest, OFFLINE_MARKER), 'offline\n');
    console.log(dest);
}

if (import.meta.main) main();
