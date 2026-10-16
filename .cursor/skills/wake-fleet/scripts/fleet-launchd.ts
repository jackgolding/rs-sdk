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
 *   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts stop Jackpoo2 --drain
 *   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts switch jackthief
 *   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts rotate
 *   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts caffeinate
 *   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts uninstall
 *
 * `stop --drain` SIGTERMs the grind and waits for it to bank (park.json),
 * holding the shepherd so nothing restarts it mid-drain. `switch` drains
 * then starts the roster job — edit bots/roster.json first to change jobs.
 * Plain `stop`/`restart` stay abrupt; use them only when the drain itself
 * is wedged.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { readJsonlTail } from '../../../../sdk/grind-log';
import { ROOT, botNames, findBot, resolveOwner, type RosterBot } from './roster';
import { launchdInfo } from './launchd-info';
import { formatElapsed, parseTimeout, verifyOutcome } from './fleet-verify';
import { installVerifyReport, uninstallVerifyReport } from './fleet-verify-report';
import { assertOnlineWorktree } from '../../../scripts/offline-worktree';
import type { ActivityEvent, HeartbeatRecord } from './fleet-rates';

const USER_ID = process.getuid?.() ?? Number(Bun.spawnSync(['id', '-u']).stdout.toString().trim());
const DOMAIN = `gui/${USER_ID}`;
const BUN = Bun.which('bun') ?? (process.execPath.endsWith('/bun') ? process.execPath : null);
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

type Command = 'install' | 'start' | 'stop' | 'restart' | 'switch' | 'status' | 'uninstall' | 'rotate' | 'caffeinate';

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
    <!-- Drain window: bootout SIGTERMs first, SIGKILLs after this. Grinds
         drain to a bank on SIGTERM (up to ~11 min for a temple return),
         so the kill must not land at the 20s default. -->
    <key>ExitTimeOut</key>
    <integer>700</integer>
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
    return launchdInfo(name).loaded;
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

function start(name: string, force = false): boolean {
    if (!existsSync(plistPath(name))) writeAgent(name);
    const info = launchdInfo(name);
    if (info.loaded) {
        if (info.pid != null) {
            console.log(`${name}: already running`);
            return true;
        }
        if (!force && info.lastExit === '0') {
            console.log(`${name}: finished — use --force`);
            return false;
        }
        const result = run(['launchctl', 'kickstart', '-k', `${DOMAIN}/${label(name)}`], true);
        console.log(`${name}: ${result.ok ? 'kickstarted' : `failed to start — ${result.output}`}`);
        return result.ok;
    }
    const result = run(['launchctl', 'bootstrap', DOMAIN, plistPath(name)], true);
    console.log(`${name}: ${result.ok ? 'started' : `failed to start — ${result.output}`}`);
    return result.ok;
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

let shepherdHeld = false;

/**
 * Hold the shepherd so it cannot restart a bot mid-drain (a bootout from
 * the shepherd during a drain reads as a second SIGTERM and kills the
 * drain instantly). Mirrors bank-check.ts. Always paired with
 * releaseShepherd in a finally.
 */
function holdShepherd(): void {
    if (!existsSync(shepherdPlistPath())) return;
    if (!run(['launchctl', 'print', `${DOMAIN}/${SHEPHERD_LABEL}`], true).ok) return;
    const out = run(['launchctl', 'bootout', `${DOMAIN}/${SHEPHERD_LABEL}`], true);
    if (!out.ok) throw new Error(`could not hold shepherd: ${out.output}`);
    shepherdHeld = true;
}

function releaseShepherd(): void {
    if (!shepherdHeld) return;
    shepherdHeld = false;
    const quiet = readFileSync(shepherdPlistPath(), 'utf8').replace(/\s*<key>RunAtLoad<\/key>\s*<true\/>/g, '');
    const plist = join(tmpdir(), 'rs-sdk-shepherd-quiet.plist');
    writeFileSync(plist, quiet);
    const out = run(['launchctl', 'bootstrap', DOMAIN, plist], true);
    console.log(out.ok ? 'shepherd: restored' : `shepherd: restore failed — ${out.output}`);
}

function parkJsonPath(name: string): string {
    return join(ROOT, 'bots', name, 'park.json');
}

/**
 * Graceful stop: SIGTERM the grind, then wait for it to drain to a bank.
 * Prints where it parked (banked park.json) or that the drain timed out.
 * Holds the shepherd for the duration so nothing restarts the bot mid-drain.
 */
async function stopDrained(name: string, timeoutMs: number): Promise<boolean> {
    const t0 = Date.now();
    const priorPid = resolveOwner(name, launchdInfo(name))?.pid ?? null;
    holdShepherd();
    try {
        if (!stop(name)) return false;
        while (Date.now() - t0 < timeoutMs) {
            const owner = resolveOwner(name, launchdInfo(name));
            if (!owner || (priorPid != null && owner.pid !== priorPid)) {
                // Old pid gone. Fresh park.json means it banked on the way out.
                try {
                    const park = JSON.parse(readFileSync(parkJsonPath(name), 'utf8')) as {
                        x: number;
                        z: number;
                        banked: boolean;
                        bank?: string;
                        at: number;
                    };
                    if (park.at >= t0 - 5_000 && park.banked) {
                        console.log(`${name}: drained to ${park.bank ?? 'bank'} @ ${park.x},${park.z}`);
                        return true;
                    }
                } catch {
                    /* no park record yet */
                }
                const stillThere = owner && priorPid != null && owner.pid === priorPid;
                if (!stillThere) {
                    console.log(`${name}: stopped (no banked park — drain timed out or predates safe-stop code)`);
                    return true;
                }
            }
            await Bun.sleep(5_000);
        }
        console.log(`${name}: still draining after ${Math.round(timeoutMs / 1000)}s — left alone, check park.json`);
        return false;
    } finally {
        releaseShepherd();
    }
}

function restart(name: string): boolean {
    writeAgent(name);
    // kickstart keeps the already-loaded job. A roster edit is on disk until
    // bootout + bootstrap reads the new plist.
    if (isLoaded(name)) {
        const out = run(['launchctl', 'bootout', `${DOMAIN}/${label(name)}`], true);
        if (!out.ok && !/No such process|Could not find service/i.test(out.output)) {
            console.log(`${name}: failed to unload — ${out.output}`);
            return false;
        }
    }
    let result = run(['launchctl', 'bootstrap', DOMAIN, plistPath(name)], true);
    if (!result.ok && /Input\/output error/.test(result.output)) {
        // launchd often refuses bootstrap in the same turn as bootout.
        Bun.sleepSync(400);
        result = run(['launchctl', 'bootstrap', DOMAIN, plistPath(name)], true);
    }
    console.log(`${name}: ${result.ok ? 'restarted' : `failed to restart — ${result.output}`}`);
    return result.ok;
}

function status(name: string): void {
    const info = launchdInfo(name);
    if (!info.loaded) {
        console.log(`${name.padEnd(12)} stopped`);
        return;
    }
    const details = [
        info.pid != null ? `pid ${info.pid}` : null,
        info.runs != null ? `runs ${info.runs}` : null,
        info.lastExit ? `last exit ${info.lastExit}` : null,
    ]
        .filter(Boolean)
        .join(', ');
    console.log(`${name.padEnd(12)} ${info.state ?? 'loaded'}${details ? ` (${details})` : ''}`);
}

function tailLines(path: string, n: number): string[] {
    if (!existsSync(path)) return [];
    let fd: number | null = null;
    try {
        const size = statSync(path).size;
        if (size === 0) return [];
        const bytes = Math.min(size, 64 * 1024);
        const buf = Buffer.allocUnsafe(bytes);
        fd = openSync(path, 'r');
        readSync(fd, buf, 0, bytes, size - bytes);
        let text = buf.toString('utf-8');
        if (bytes < size) {
            const nl = text.indexOf('\n');
            text = nl < 0 ? '' : text.slice(nl + 1);
        }
        return text.split('\n').filter((line) => line.trim()).slice(-n);
    } catch {
        return [];
    } finally {
        if (fd !== null) closeSync(fd);
    }
}

async function verifyBot(name: string, t0: number, oldPid: number | null, timeoutMs: number): Promise<boolean> {
    const eventsPath = join(ROOT, 'bots', name, 'events.log');
    const heartbeatPath = join(ROOT, 'bots', name, 'heartbeat.log');
    const grindPath = join(ROOT, 'bots', name, 'grind.log');
    while (true) {
        const now = Date.now();
        const outcome = verifyOutcome({
            events: readJsonlTail<ActivityEvent>(eventsPath),
            snapshots: readJsonlTail<HeartbeatRecord>(heartbeatPath),
            t0,
            oldPid,
            now,
            timeoutMs,
        });
        if (outcome.status === 'success') {
            console.log(`verified ${name}: ${outcome.evidence} after ${formatElapsed(outcome.elapsedMs)} (pid ${outcome.pid})`);
            return true;
        }
        if (outcome.status === 'failure') {
            if (now - t0 >= timeoutMs) console.log(`NOT verified ${name} after ${formatElapsed(timeoutMs)}`);
            console.log(outcome.reason);
            for (const line of tailLines(grindPath, 5)) console.log(line);
            return false;
        }
        const remaining = t0 + timeoutMs - now;
        if (remaining <= 0) continue;
        await Bun.sleep(Math.min(15_000, remaining));
    }
}

const rawArgs = process.argv.slice(2);
const command = (rawArgs[0] ?? 'status') as Command;
if (!['install', 'start', 'stop', 'restart', 'switch', 'status', 'uninstall', 'rotate', 'caffeinate'].includes(command)) {
    throw new Error(`Unknown command "${command}"`);
}
assertOnlineWorktree(ROOT, command);

const force = rawArgs.includes('--force');
const verify = rawArgs.includes('--verify');
const drain = rawArgs.includes('--drain');
let timeoutRaw: string | undefined;
const positionals: string[] = [];
for (let i = 1; i < rawArgs.length; i++) {
    const arg = rawArgs[i]!;
    if (arg === '--force' || arg === '--verify' || arg === '--drain') continue;
    if (arg.startsWith('--timeout=')) {
        timeoutRaw = arg.slice('--timeout='.length);
        continue;
    }
    if (arg === '--timeout') {
        timeoutRaw = rawArgs[++i];
        continue;
    }
    if (arg.startsWith('--')) continue;
    positionals.push(arg);
}
const timeoutMs = parseTimeout(timeoutRaw);

const names = positionals.length === 0 ? botNames() : positionals.map((name) => selected(name)[0]!);
mkdirSync(AGENTS_DIR, { recursive: true });
mkdirSync(LOG_DIR, { recursive: true });

let failed = false;
if (command === 'install') {
    installRotator();
    installShepherd();
    installVerifyReport();
    const toInstall = positionals.length > 0 ? names : names.filter((name) => !botFor(name).paused);
    for (let i = 0; i < toInstall.length; i++) {
        const name = toInstall[i]!;
        writeAgent(name);
        if (!start(name, force)) failed = true;
    }
    console.log(`Logs: ${LOG_DIR}`);
    console.log('caffeinate: skipped (opt-in with `fleet-launchd.ts caffeinate`)');
} else if (command === 'start' || command === 'restart') {
    const t0 = Date.now();
    const priors = names.map((name) => ({
        name,
        pid: resolveOwner(name, launchdInfo(name))?.pid ?? null,
    }));
    for (const name of names) {
        const ok = command === 'start' ? start(name, force) : restart(name);
        if (!ok) failed = true;
    }
    if (verify) {
        const results = await Promise.all(priors.map((prior) => verifyBot(prior.name, t0, prior.pid, timeoutMs)));
        if (results.some((ok) => !ok)) failed = true;
    }
} else if (command === 'stop') {
    if (drain) {
        for (const name of names) if (!(await stopDrained(name, timeoutMs))) failed = true;
    } else {
        for (const name of names) if (!stop(name)) failed = true;
    }
} else if (command === 'switch') {
    // Job change: drain to a bank first, then start the roster job. Change
    // what the bot runs by editing bots/roster.json before switching — the
    // new job routes from the park record via declared legs. The plist is
    // rewritten like restart does: start alone would keep supervising the
    // previous script.
    for (const name of names) {
        writeAgent(name);
        if (!(await stopDrained(name, timeoutMs))) {
            failed = true;
            continue;
        }
        if (!start(name, force)) failed = true;
    }
    if (verify) {
        const t0 = Date.now();
        const results = await Promise.all(names.map((name) => verifyBot(name, t0, null, timeoutMs)));
        if (results.some((ok) => !ok)) failed = true;
    }
} else if (command === 'status') {
    for (const name of names) status(name);
} else if (command === 'rotate') {
    installRotator();
} else if (command === 'caffeinate') {
    installCaffeinate();
} else {
    if (positionals.length === 0) {
        uninstallRotator();
        uninstallShepherd();
        uninstallCaffeinate();
        uninstallVerifyReport();
    }
    for (const name of names) {
        if (!stop(name)) failed = true;
        if (existsSync(plistPath(name))) unlinkSync(plistPath(name));
        console.log(`${name}: launch agent removed`);
    }
}

if (failed) process.exitCode = 1;
