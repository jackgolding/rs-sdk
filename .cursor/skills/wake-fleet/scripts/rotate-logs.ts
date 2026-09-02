#!/usr/bin/env bun
/**
 * Cap grind.log and launchd stdio logs. fleet-launchd install also registers
 * this as a 6-hour launchd job (com.rs-sdk.rotate-logs).
 *
 *   bun .cursor/skills/wake-fleet/scripts/rotate-logs.ts
 */
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { rosterBots, ROOT } from './roster';
import { rotateLogFile } from '../../../../sdk/grind-log';

const LAUNCHD_LOG_DIR = join(homedir(), 'Library', 'Logs', 'rs-sdk-fleet');
const MAX_LAUNCHD = 8 * 1024 * 1024;
const KEEP_LAUNCHD = 2 * 1024 * 1024;

function rotateIfPresent(path: string, maxBytes?: number, keepBytes?: number): void {
    if (!existsSync(path)) return;
    rotateLogFile(path, maxBytes != null ? { maxBytes, keepBytes } : undefined);
}

let n = 0;
for (const bot of rosterBots()) {
    rotateIfPresent(join(ROOT, 'bots', bot.name, 'grind.log'));
    rotateIfPresent(join(ROOT, 'bots', bot.name, 'heartbeat.log'));
    n++;
}

if (existsSync(LAUNCHD_LOG_DIR)) {
    for (const name of readdirSync(LAUNCHD_LOG_DIR)) {
        if (!name.endsWith('.log')) continue;
        rotateIfPresent(join(LAUNCHD_LOG_DIR, name), MAX_LAUNCHD, KEEP_LAUNCHD);
        n++;
    }
}

console.log(`Rotated up to ${n} log files (grind.log cap 8MB, launchd cap 8MB)`);
