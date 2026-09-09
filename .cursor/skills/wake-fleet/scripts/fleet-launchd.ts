#!/usr/bin/env bun
/**
 * Install and control independent macOS launchd jobs for the bot fleet.
 *
 * Each bot is owned directly by launchd, so ending or aborting a Cursor task
 * cannot terminate the rest of the fleet.
 *
 * Which bots exist and what each one runs comes from bots/roster.json.
 *
 *   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts install
 *   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts status
 *   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts restart Jackpoo2
 *   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts stop
 *   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts rotate
 *   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts caffeinate
 *   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts uninstall
 */
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { ROOT, botNames, findBot, writeAssignment, type RosterBot } from './roster';

const USER_ID = process.getuid?.() ?? Number(Bun.spawnSync(['id', '-u']).stdout.toString().trim());
const DOMAIN = `gui/${USER_ID}`;
const BUN = Bun.which('bun');
const AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents');
const LOG_DIR = join(homedir(), 'Library', 'Logs', 'rs-sdk-fleet');
const LABEL_PREFIX = 'com.rs-sdk.bot';
const ROTATE_LABEL = 'com.rs-sdk.rotate-logs';
const SHEPHERD_LABEL = 'com.rs-sdk.fleet-shepherd';
const CAFFEINATE_LABEL = 'com.rs-sdk.caffeinate';
const CAFFEINATE = '/usr/bin/caffeinate';
const ROTATE_SCRIPT = join(ROOT, '.cursor/skills/wake-fleet/scripts/rotate-logs.ts');
const SHEPHERD_SCRIPT = join(ROOT, '.cursor/skills/wake-fleet/scripts/fleet-shepherd.ts');

if (!BUN) throw new Error('bun is not available on PATH');

type Command = 'install' | 'start' | 'stop' | 'restart' | 'status' | 'uninstall' | 'rotate' | 'caffeinate';

/** Roster entry for a name already validated by {@link selected}. */
function botFor(name: string): RosterBot {
    const bot = findBot(name);
    if (!bot) throw new Error(`"${name}" is not in bots/roster.json`);
    return bot;
}

function label(name: string): string {
    return `${LABEL_PREFIX}.${name.toLowerCase()}`;
}

function plistPath(name: string): string {
    return join(AGENTS_DIR, `${label(name)}.plist`);
}

function xml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

function plist(name: string): string {
    const bot = botFor(name);
    const args = [BUN!, bot.script, ...bot.args]
        .map((arg) => `        <string>${xml(arg)}</string>`)
        .join('\n');
    const path = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label(name)}</string>
    <key>ProgramArguments</key>
    <array>
${args}
    </array>
    <key>WorkingDirectory</key>
    <string>${xml(ROOT)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${xml(path)}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>${xml(join(LOG_DIR, `${name}.out.log`))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(join(LOG_DIR, `${name}.err.log`))}</string>
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

function isLoaded(name: string): boolean {
    return run(['launchctl', 'print', `${DOMAIN}/${label(name)}`], true).ok;
}

function agentPid(name: string): number | null {
    const result = run(['launchctl', 'print', `${DOMAIN}/${label(name)}`], true);
    if (!result.ok) return null;
    const pid = result.output.match(/\bpid = (\d+)/)?.[1];
    return pid ? Number(pid) : null;
}

function selected(rawName?: string): string[] {
    if (!rawName) return botNames();
    const match = findBot(rawName);
    if (!match) {
        throw new Error(`Unknown bot "${rawName}". Expected: ${botNames().join(', ')}`);
    }
    return [match.name];
}

function writeAgent(name: string): void {
    writeFileSync(plistPath(name), plist(name), { mode: 0o644 });
}

function rotatePlistPath(): string {
    return join(AGENTS_DIR, `${ROTATE_LABEL}.plist`);
}

function rotatePlist(): string {
    const path = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${ROTATE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${xml(BUN!)}</string>
        <string>${xml(ROTATE_SCRIPT)}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${xml(ROOT)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${xml(path)}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>21600</integer>
    <key>StandardOutPath</key>
    <string>${xml(join(LOG_DIR, 'rotate-logs.out.log'))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(join(LOG_DIR, 'rotate-logs.err.log'))}</string>
</dict>
</plist>
`;
}

function installRotator(): void {
    writeFileSync(rotatePlistPath(), rotatePlist(), { mode: 0o644 });
    if (!run(['launchctl', 'print', `${DOMAIN}/${ROTATE_LABEL}`], true).ok) {
        run(['launchctl', 'bootstrap', DOMAIN, rotatePlistPath()], true);
    }
    run(['launchctl', 'kickstart', '-k', `${DOMAIN}/${ROTATE_LABEL}`], true);
    console.log('rotate-logs: installed (every 6h)');
}

function shepherdPlistPath(): string {
    return join(AGENTS_DIR, `${SHEPHERD_LABEL}.plist`);
}

function shepherdPlist(): string {
    const path = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SHEPHERD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${xml(BUN!)}</string>
        <string>${xml(SHEPHERD_SCRIPT)}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${xml(ROOT)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${xml(path)}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>600</integer>
    <key>StandardOutPath</key>
    <string>${xml(join(LOG_DIR, 'shepherd.out.log'))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(join(LOG_DIR, 'shepherd.err.log'))}</string>
</dict>
</plist>
`;
}

function installShepherd(): void {
    writeFileSync(shepherdPlistPath(), shepherdPlist(), { mode: 0o644 });
    if (!run(['launchctl', 'print', `${DOMAIN}/${SHEPHERD_LABEL}`], true).ok) {
        run(['launchctl', 'bootstrap', DOMAIN, shepherdPlistPath()], true);
    }
    run(['launchctl', 'kickstart', '-k', `${DOMAIN}/${SHEPHERD_LABEL}`], true);
    console.log('fleet-shepherd: installed (every 10m)');
}

function uninstallShepherd(): void {
    run(['launchctl', 'bootout', `${DOMAIN}/${SHEPHERD_LABEL}`], true);
    if (existsSync(shepherdPlistPath())) unlinkSync(shepherdPlistPath());
    console.log('fleet-shepherd: removed');
}

function caffeinatePlistPath(): string {
    return join(AGENTS_DIR, `${CAFFEINATE_LABEL}.plist`);
}

function caffeinatePlist(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${CAFFEINATE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${xml(CAFFEINATE)}</string>
        <string>-dims</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${xml(join(LOG_DIR, 'caffeinate.out.log'))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(join(LOG_DIR, 'caffeinate.err.log'))}</string>
</dict>
</plist>
`;
}

function installCaffeinate(): void {
    writeFileSync(caffeinatePlistPath(), caffeinatePlist(), { mode: 0o644 });
    if (!run(['launchctl', 'print', `${DOMAIN}/${CAFFEINATE_LABEL}`], true).ok) {
        run(['launchctl', 'bootstrap', DOMAIN, caffeinatePlistPath()], true);
    }
    run(['launchctl', 'kickstart', '-k', `${DOMAIN}/${CAFFEINATE_LABEL}`], true);
    console.log('caffeinate: installed (display + idle + disk + AC sleep held off)');
}

function uninstallCaffeinate(): void {
    run(['launchctl', 'bootout', `${DOMAIN}/${CAFFEINATE_LABEL}`], true);
    if (existsSync(caffeinatePlistPath())) unlinkSync(caffeinatePlistPath());
    console.log('caffeinate: removed');
}

function uninstallRotator(): void {
    run(['launchctl', 'bootout', `${DOMAIN}/${ROTATE_LABEL}`], true);
    if (existsSync(rotatePlistPath())) unlinkSync(rotatePlistPath());
    console.log('rotate-logs: removed');
}

function start(name: string): boolean {
    if (!existsSync(plistPath(name))) writeAgent(name);
    if (isLoaded(name)) {
        if (agentPid(name) != null) {
            console.log(`${name}: already running`);
            return true;
        }
        // Loaded after exit 0 (KeepAlive SuccessfulExit=false) — bootstrap is a no-op.
        const result = run(['launchctl', 'kickstart', '-k', `${DOMAIN}/${label(name)}`], true);
        if (result.ok) recordAssignment(name);
        console.log(`${name}: ${result.ok ? 'kickstarted' : `failed to start — ${result.output}`}`);
        return result.ok;
    }
    const result = run(['launchctl', 'bootstrap', DOMAIN, plistPath(name)], true);
    if (result.ok) recordAssignment(name);
    console.log(`${name}: ${result.ok ? 'started' : `failed to start — ${result.output}`}`);
    return result.ok;
}

/** Persist the job so fleet-status can restart this bot onto it later. */
function recordAssignment(name: string): void {
    const bot = botFor(name);
    writeAssignment(name, [bot.script, ...bot.args], 'launchd');
}

function stop(name: string): boolean {
    if (!isLoaded(name)) {
        console.log(`${name}: already stopped`);
        return true;
    }
    const result = run(['launchctl', 'bootout', `${DOMAIN}/${label(name)}`], true);
    console.log(`${name}: ${result.ok ? 'stopped' : `failed to stop — ${result.output}`}`);
    return result.ok;
}

function restart(name: string): boolean {
    writeAgent(name);
    if (isLoaded(name)) {
        run(['launchctl', 'bootout', `${DOMAIN}/${label(name)}`], true);
        Bun.sleepSync(1_000);
    }
    const result = run(['launchctl', 'bootstrap', DOMAIN, plistPath(name)], true);
    if (result.ok) recordAssignment(name);
    console.log(`${name}: ${result.ok ? 'restarted' : `failed to restart — ${result.output}`}`);
    return result.ok;
}

function status(name: string): void {
    const result = run(['launchctl', 'print', `${DOMAIN}/${label(name)}`], true);
    if (!result.ok) {
        console.log(`${name.padEnd(12)} stopped`);
        return;
    }
    const state = result.output.match(/\bstate = ([^\n]+)/)?.[1]?.trim() ?? 'loaded';
    const pid = result.output.match(/\bpid = (\d+)/)?.[1];
    const lastExit = result.output.match(/\blast exit code = ([^\n]+)/)?.[1]?.trim();
    const details = [pid ? `pid ${pid}` : null, lastExit ? `last exit ${lastExit}` : null]
        .filter(Boolean)
        .join(', ');
    console.log(`${name.padEnd(12)} ${state}${details ? ` (${details})` : ''}`);
}

const command = (process.argv[2] ?? 'status') as Command;
if (!['install', 'start', 'stop', 'restart', 'status', 'uninstall', 'rotate', 'caffeinate'].includes(command)) {
    throw new Error(`Unknown command "${command}"`);
}

const names = selected(process.argv[3]);
mkdirSync(AGENTS_DIR, { recursive: true });
mkdirSync(LOG_DIR, { recursive: true });

let failed = false;
if (command === 'install') {
    installRotator();
    installShepherd();
    installCaffeinate();
    for (let i = 0; i < names.length; i++) {
        const name = names[i]!;
        writeAgent(name);
        if (!start(name)) failed = true;
        if (names.length > 1 && i < names.length - 1) await Bun.sleep(4_000);
    }
    console.log(`Logs: ${LOG_DIR}`);
} else if (command === 'start') {
    for (const name of names) if (!start(name)) failed = true;
} else if (command === 'stop') {
    for (const name of names) if (!stop(name)) failed = true;
} else if (command === 'restart') {
    for (const name of names) if (!restart(name)) failed = true;
} else if (command === 'status') {
    for (const name of names) status(name);
} else if (command === 'rotate') {
    installRotator();
} else if (command === 'caffeinate') {
    installCaffeinate();
} else {
    if (!process.argv[3]) {
        uninstallRotator();
        uninstallShepherd();
        uninstallCaffeinate();
    }
    for (const name of names) {
        if (!stop(name)) failed = true;
        if (existsSync(plistPath(name))) unlinkSync(plistPath(name));
        console.log(`${name}: launch agent removed`);
    }
}

if (failed) process.exitCode = 1;
