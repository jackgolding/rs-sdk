#!/usr/bin/env bun
/**
 * Install a launchd job: every 3h feed thieving bots + collect loot → fatpig.
 *
 *   bun .cursor/skills/wake-fleet/scripts/abg-food-schedule.ts install
 *   bun .cursor/skills/wake-fleet/scripts/abg-food-schedule.ts run-now
 *   bun .cursor/skills/wake-fleet/scripts/abg-food-schedule.ts status
 *   bun .cursor/skills/wake-fleet/scripts/abg-food-schedule.ts uninstall
 */
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { ROOT } from './roster';

const USER_ID = process.getuid?.() ?? Number(Bun.spawnSync(['id', '-u']).stdout.toString().trim());
const DOMAIN = `gui/${USER_ID}`;
const BUN = Bun.which('bun');
const BASH = Bun.which('bash') ?? '/bin/bash';
const AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents');
const LOG_DIR = join(homedir(), 'Library', 'Logs', 'rs-sdk-fleet');
const LABEL = 'com.rs-sdk.abg-thief-mule';
const OLD_LABEL = 'com.rs-sdk.abg-food-all';
const SCRIPT = join(ROOT, 'bots/quests/abg-thief-mule-cycle.sh');
const INTERVAL_SEC = 3 * 60 * 60; // 3 hours

if (!BUN) throw new Error('bun is not available on PATH');

type Command = 'install' | 'uninstall' | 'status' | 'run-now';

function xml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

function plistPath(): string {
    return join(AGENTS_DIR, `${LABEL}.plist`);
}

function plist(): string {
    const path = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${xml(BASH)}</string>
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
    <string>${xml(join(LOG_DIR, 'abg-thief-mule-cycle.out.log'))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(join(LOG_DIR, 'abg-thief-mule-cycle.err.log'))}</string>
</dict>
</plist>
`;
}

function run(args: string[], quiet = false): { ok: boolean; output: string } {
    const proc = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' });
    const output = `${proc.stdout.toString()}${proc.stderr.toString()}`.trim();
    if (!quiet && output) console.log(output);
    return { ok: proc.exitCode === 0, output };
}

function isLoaded(): boolean {
    return run(['launchctl', 'print', `${DOMAIN}/${LABEL}`], true).ok;
}

function install(): void {
    run(['launchctl', 'bootout', `${DOMAIN}/${OLD_LABEL}`], true);
    const oldPlist = join(AGENTS_DIR, `${OLD_LABEL}.plist`);
    if (existsSync(oldPlist)) unlinkSync(oldPlist);
    writeFileSync(plistPath(), plist(), { mode: 0o644 });
    if (!isLoaded()) {
        const result = run(['launchctl', 'bootstrap', DOMAIN, plistPath()], true);
        if (!result.ok) throw new Error(result.output);
    }
    console.log(`abg-thief-mule: installed (every 3h, log ${LOG_DIR}/abg-thief-mule-cycle.log)`);
}

function uninstall(): void {
    run(['launchctl', 'bootout', `${DOMAIN}/${LABEL}`], true);
    run(['launchctl', 'bootout', `${DOMAIN}/${OLD_LABEL}`], true);
    if (existsSync(plistPath())) unlinkSync(plistPath());
    const oldPlist = join(AGENTS_DIR, `${OLD_LABEL}.plist`);
    if (existsSync(oldPlist)) unlinkSync(oldPlist);
    console.log('abg-thief-mule: schedule removed');
}

function status(): void {
    if (isLoaded()) {
        console.log(`abg-thief-mule: active (every 3h — food + loot → fatpig)`);
        run(['launchctl', 'print', `${DOMAIN}/${LABEL}`], true);
    } else if (run(['launchctl', 'print', `${DOMAIN}/${OLD_LABEL}`], true).ok) {
        console.log('abg-food-all: active (food only — run install to upgrade to full cycle)');
    } else {
        console.log('abg-thief-mule: not installed');
    }
}

function runNow(): void {
    console.log('abg-thief-mule: starting full cycle now…');
    const proc = Bun.spawnSync([BASH, SCRIPT], {
        stdout: 'inherit',
        stderr: 'inherit',
        cwd: ROOT
    });
    if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1);
}

const cmd = (process.argv[2] ?? 'status') as Command;
switch (cmd) {
    case 'install':
        install();
        break;
    case 'uninstall':
        uninstall();
        break;
    case 'run-now':
        runNow();
        break;
    case 'status':
        status();
        break;
    default:
        console.error(`Usage: bun ${process.argv[1]} install|uninstall|status|run-now`);
        process.exit(1);
}
