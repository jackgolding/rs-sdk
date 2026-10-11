#!/usr/bin/env bun
/**
 * Read-only fleet snapshot. Does not restart bots and does not start an agent.
 *
 *   bun .cursor/skills/wake-fleet/scripts/fleet-verify-report.ts
 *   bun .cursor/skills/wake-fleet/scripts/fleet-verify-report.ts install
 *
 * launchd label com.rs-sdk.fleet-verify, every 30 minutes.
 * Shepherd remains the only unattended restarter.
 */
import { spawnSync } from 'child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { ROOT } from './roster';

const USER_ID = process.getuid?.() ?? Number(spawnSync('id', ['-u']).stdout.toString().trim());
const DOMAIN = `gui/${USER_ID}`;
const LABEL = 'com.rs-sdk.fleet-verify';
const INTERVAL_SEC = 1800;
const LOG_DIR = join(homedir(), 'Library', 'Logs', 'rs-sdk-fleet');
const LOG_PATH = join(LOG_DIR, 'fleet-verify.jsonl');
const MAX_BYTES = 512 * 1024;
const SCRIPT = join(ROOT, '.cursor/skills/wake-fleet/scripts/fleet-verify-report.ts');

export type AuditBot = { name: string; kind: string; check: string };

export type AuditLine = {
    t: number;
    headline: string;
    producing: number;
    notProducing: AuditBot[];
};

type StatusPayload = {
    headline?: string;
    summary?: { producing?: string[]; notProducing?: string[] };
    bots?: Array<{ name?: string; kind?: string; check?: string }>;
};

export function auditLine(payload: StatusPayload, t: number): AuditLine {
    const notNames = new Set(payload.summary?.notProducing ?? []);
    const notProducing = (payload.bots ?? [])
        .filter((bot) => bot.name && notNames.has(bot.name))
        .map((bot) => ({
            name: bot.name!,
            kind: bot.kind ?? '',
            check: bot.check ?? '',
        }));
    return {
        t,
        headline: payload.headline ?? '',
        producing: payload.summary?.producing?.length ?? 0,
        notProducing,
    };
}

export function namesChanged(prev: string[], next: string[]): boolean {
    if (prev.length !== next.length) return true;
    const a = [...prev].sort();
    const b = [...next].sort();
    return a.some((name, i) => name !== b[i]);
}

function xml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

function lastNames(path: string): string[] {
    if (!existsSync(path)) return [];
    const fd = readFileSync(path);
    const start = Math.max(0, fd.length - 8192);
    const tail = fd.subarray(start).toString('utf-8');
    const line = tail.trim().split('\n').at(-1);
    if (!line) return [];
    try {
        const parsed = JSON.parse(line) as AuditLine;
        return (parsed.notProducing ?? []).map((bot) => bot.name);
    } catch {
        return [];
    }
}

function appendCapped(path: string, line: string): void {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path) && statSync(path).size > MAX_BYTES) {
        const raw = readFileSync(path, 'utf-8');
        const kept = raw.slice(Math.max(0, raw.length - MAX_BYTES / 2));
        const trimmed = kept.slice(kept.indexOf('\n') + 1);
        writeFileSync(path, trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`);
    }
    appendFileSync(path, `${line}\n`);
}

function notify(body: string): void {
    const safe = body.slice(0, 200).replace(/"/g, "'");
    spawnSync('osascript', ['-e', `display notification "${safe}" with title "rs-sdk fleet"`], {
        stdio: 'ignore',
    });
}

export function installVerifyReport(): void {
    const bun = Bun.which('bun');
    if (!bun) throw new Error('bun is not available on PATH');
    const path = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${xml(bun)}</string>
        <string>${xml(SCRIPT)}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${xml(ROOT)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${xml(path)}</string>
    </dict>
    <key>RunAtLoad</key>
    <false/>
    <key>StartInterval</key>
    <integer>${INTERVAL_SEC}</integer>
    <key>StandardOutPath</key>
    <string>${xml(join(LOG_DIR, 'fleet-verify.out.log'))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(join(LOG_DIR, 'fleet-verify.err.log'))}</string>
</dict>
</plist>
`;
    mkdirSync(dirname(plistPath), { recursive: true });
    mkdirSync(LOG_DIR, { recursive: true });
    writeFileSync(plistPath, plist, { mode: 0o644 });
    const printed = spawnSync('launchctl', ['print', `${DOMAIN}/${LABEL}`], { encoding: 'utf-8' });
    if (printed.status !== 0) {
        spawnSync('launchctl', ['bootstrap', DOMAIN, plistPath], { encoding: 'utf-8' });
    }
    console.log(`${LABEL}: installed (every 30m, read-only)`);
}

export function uninstallVerifyReport(): void {
    spawnSync('launchctl', ['bootout', `${DOMAIN}/${LABEL}`], { encoding: 'utf-8' });
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
    if (existsSync(plistPath)) unlinkSync(plistPath);
    console.log(`${LABEL}: removed`);
}

function runOnce(): void {
    const proc = spawnSync('bun', [join(ROOT, '.cursor/skills/wake-fleet/scripts/fleet-status.ts')], {
        cwd: ROOT,
        encoding: 'utf-8',
    });
    if (!proc.stdout?.trim()) {
        console.error(proc.stderr?.trim() || 'fleet-status returned no JSON');
        process.exitCode = 1;
        return;
    }
    const payload = JSON.parse(proc.stdout) as StatusPayload;
    const now = Date.now();
    const line = auditLine(payload, now);
    const prev = lastNames(LOG_PATH);
    const next = line.notProducing.map((bot) => bot.name);
    appendCapped(LOG_PATH, JSON.stringify(line));
    console.log(line.headline || `${line.producing} producing, ${next.length} not producing`);
    if (namesChanged(prev, next) && next.length > 0) notify(line.headline || next.join(', '));
}

if (import.meta.main) {
    const command = process.argv[2] ?? 'run';
    if (command === 'install') installVerifyReport();
    else if (command === 'uninstall') uninstallVerifyReport();
    else if (command === 'run') runOnce();
    else throw new Error(`Unknown command "${command}"`);
}
