#!/usr/bin/env bun
/**
 * Install and control lite-client launchd jobs, and move bots on/off Chrome.
 *
 *   bun .cursor/skills/lite-client/scripts/lite-launchd.ts to-lite jacklove1 jacklove2
 *   bun .cursor/skills/lite-client/scripts/lite-launchd.ts to-chrome jacklove1
 *   bun .cursor/skills/lite-client/scripts/lite-launchd.ts status
 *   bun .cursor/skills/lite-client/scripts/lite-launchd.ts stop jacklove1
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

const ROOT = resolve(dirname(import.meta.path), '../../../..');
const WEBCLIENT = join(ROOT, 'server/webclient');
const USER_ID = process.getuid?.() ?? Number(Bun.spawnSync(['id', '-u']).stdout.toString().trim());
const DOMAIN = `gui/${USER_ID}`;
const BUN = Bun.which('bun');
const AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents');
const LOG_DIR = join(homedir(), 'Library', 'Logs', 'rs-sdk-fleet');
const LITE_PREFIX = 'com.rs-sdk.lite';
const GRIND_PREFIX = 'com.rs-sdk.bot';
const STAGGER_MS = 4_000;
const WAIT_MS = 90_000;

if (!BUN) throw new Error('bun is not available on PATH');

function assertLiteDeps(): void {
    if (!existsSync(join(WEBCLIENT, 'node_modules', 'fflate'))) {
        throw new Error(
            `lite client missing fflate. From the repo root run: bun install --cwd server/webclient`
        );
    }
}

type Command = 'install' | 'start' | 'stop' | 'restart' | 'status' | 'uninstall' | 'to-lite' | 'to-chrome';

function xml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

function liteLabel(name: string): string {
    return `${LITE_PREFIX}.${name.toLowerCase()}`;
}

function grindLabel(name: string): string {
    return `${GRIND_PREFIX}.${name.toLowerCase()}`;
}

function litePlistPath(name: string): string {
    return join(AGENTS_DIR, `${liteLabel(name)}.plist`);
}

function grindPlistPath(name: string): string {
    return join(AGENTS_DIR, `${grindLabel(name)}.plist`);
}

function envPath(name: string): string {
    return join(ROOT, 'bots', name, 'bot.env');
}

function loadEnv(name: string): Record<string, string> {
    const path = envPath(name);
    if (!existsSync(path)) throw new Error(`No bot.env at bots/${name}/bot.env`);
    const env: Record<string, string> = {};
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
    return env;
}

function resolveBot(raw: string): string {
    if (existsSync(envPath(raw))) return raw;
    const botsDir = join(ROOT, 'bots');
    const match = Bun.spawnSync(['ls', botsDir], { stdout: 'pipe' })
        .stdout.toString()
        .split('\n')
        .find((d) => d.toLowerCase() === raw.toLowerCase());
    if (match && existsSync(envPath(match))) return match;
    throw new Error(`Unknown bot "${raw}" (no bots/${raw}/bot.env)`);
}

function run(args: string[], quiet = false): { ok: boolean; output: string } {
    const proc = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' });
    const output = `${proc.stdout.toString()}${proc.stderr.toString()}`.trim();
    if (!quiet && output) console.log(output);
    return { ok: proc.exitCode === 0, output };
}

function isLoaded(label: string): boolean {
    return run(['launchctl', 'print', `${DOMAIN}/${label}`], true).ok;
}

function litePlist(name: string): string {
    const path = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
    const bunDir = dirname(BUN!);
    const pathVal = path.includes(bunDir) ? path : `${bunDir}:${path}`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${xml(liteLabel(name))}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${xml(BUN!)}</string>
        <string>src/lite/runner.ts</string>
        <string>${xml(name)}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${xml(WEBCLIENT)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${xml(pathVal)}</string>
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
    <string>${xml(join(LOG_DIR, `lite-${name}.out.log`))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(join(LOG_DIR, `lite-${name}.err.log`))}</string>
</dict>
</plist>
`;
}

function writeLiteAgent(name: string): void {
    writeFileSync(litePlistPath(name), litePlist(name), { mode: 0o644 });
}

function startLite(name: string): boolean {
    if (!existsSync(litePlistPath(name))) writeLiteAgent(name);
    if (isLoaded(liteLabel(name))) {
        console.log(`${name}: lite already supervised`);
        return true;
    }
    const result = run(['launchctl', 'bootstrap', DOMAIN, litePlistPath(name)], true);
    console.log(`${name}: lite ${result.ok ? 'started' : `failed — ${result.output}`}`);
    return result.ok;
}

function stopLite(name: string): boolean {
    if (!isLoaded(liteLabel(name))) {
        console.log(`${name}: lite already stopped`);
        return true;
    }
    const result = run(['launchctl', 'bootout', `${DOMAIN}/${liteLabel(name)}`], true);
    console.log(`${name}: lite ${result.ok ? 'stopped' : `failed — ${result.output}`}`);
    return result.ok;
}

function restartLite(name: string): boolean {
    if (!isLoaded(liteLabel(name))) return startLite(name);
    const result = run(['launchctl', 'kickstart', '-k', `${DOMAIN}/${liteLabel(name)}`], true);
    console.log(`${name}: lite ${result.ok ? 'restarted' : `failed — ${result.output}`}`);
    return result.ok;
}

function restartGrind(name: string): void {
    if (!existsSync(grindPlistPath(name))) {
        console.log(`${name}: no grind launch agent (${grindLabel(name)}) — start the script yourself`);
        return;
    }
    if (!isLoaded(grindLabel(name))) {
        const result = run(['launchctl', 'bootstrap', DOMAIN, grindPlistPath(name)], true);
        console.log(`${name}: grind ${result.ok ? 'started' : `failed — ${result.output}`}`);
        return;
    }
    const result = run(['launchctl', 'kickstart', '-k', `${DOMAIN}/${grindLabel(name)}`], true);
    console.log(`${name}: grind ${result.ok ? 'restarted' : `failed — ${result.output}`}`);
}

function statusUrl(name: string): string {
    const env = loadEnv(name);
    const server = env.GATEWAY_URL || env.SERVER;
    if (server?.startsWith('ws://') || server?.startsWith('wss://') || server?.startsWith('http')) {
        const http = server
            .replace(/^ws:/, 'http:')
            .replace(/^wss:/, 'https:')
            .replace(/\/gateway$/, '');
        return `${http.replace(/\/$/, '')}/status/${encodeURIComponent(name)}`;
    }
    if (!server || server === 'localhost' || server.startsWith('localhost:')) {
        const host = server?.includes(':') ? server : 'localhost:7780';
        return `http://${host}/status/${encodeURIComponent(name)}`;
    }
    return `https://${server}/status/${encodeURIComponent(name)}`;
}

async function waitInGame(name: string, timeoutMs = WAIT_MS, requireLite = false): Promise<boolean> {
    const url = statusUrl(name);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (requireLite && !run(['pgrep', '-f', `src/lite/runner.ts ${name}`], true).ok) {
            await Bun.sleep(2000);
            continue;
        }
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (res.ok) {
                const gw = (await res.json()) as { inGame?: boolean; status?: string; stateAge?: number };
                if (gw.inGame && gw.status !== 'dead' && (gw.stateAge ?? 0) < 8000) return true;
            }
        } catch {
            /* retry */
        }
        await Bun.sleep(2000);
    }
    return false;
}

function clientUrl(name: string): string {
    const env = loadEnv(name);
    const host = env.SERVER || 'localhost';
    const origin =
        host.startsWith('http') || host.startsWith('ws')
            ? host.replace(/^ws/, 'http').replace(/\/gateway$/, '')
            : host.startsWith('localhost') || host.startsWith('127.')
              ? `http://${host.includes(':') ? host : host + ':8888'}`
              : `https://${host}`;
    const user = env.BOT_USERNAME || name;
    const pass = env.PASSWORD || '';
    return `${origin.replace(/\/$/, '')}/bot?bot=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;
}

function openChrome(name: string): void {
    const result = run(['open', clientUrl(name)], true);
    console.log(`${name}: Chrome ${result.ok ? 'opened' : `open failed — ${result.output}`}`);
}

function closeChromeTabs(names: string[]): void {
    const quoted = names.map((n) => `"${n.replaceAll('"', '')}"`).join(', ');
    const script = `
tell application "Google Chrome"
  if not (exists window 1) then return
  repeat with w in windows
    set tabCount to count of tabs of w
    repeat with i from tabCount to 1 by -1
      set u to URL of tab i of w
      repeat with n in {${quoted}}
        if u contains ("bot=" & n) then
          close tab i of w
          exit repeat
        end if
      end repeat
    end repeat
  end repeat
end tell
`;
    const result = run(['osascript', '-e', script], true);
    if (!result.ok) console.log(`Chrome close: ${result.output || 'failed'}`);
    else console.log(`Closed Chrome tabs for ${names.join(', ')}`);
}

function printStatus(name: string): void {
    const result = run(['launchctl', 'print', `${DOMAIN}/${liteLabel(name)}`], true);
    if (!result.ok) {
        console.log(`${name.padEnd(12)} lite stopped`);
        return;
    }
    const state = result.output.match(/\bstate = ([^\n]+)/)?.[1]?.trim() ?? 'loaded';
    const pid = result.output.match(/\bpid = (\d+)/)?.[1];
    const lastExit = result.output.match(/\blast exit code = ([^\n]+)/)?.[1]?.trim();
    const details = [pid ? `pid ${pid}` : null, lastExit ? `last exit ${lastExit}` : null]
        .filter(Boolean)
        .join(', ');
    console.log(`${name.padEnd(12)} lite ${state}${details ? ` (${details})` : ''}`);
}

function listedLiteBots(): string[] {
    if (!existsSync(AGENTS_DIR)) return [];
    const prefix = `${LITE_PREFIX}.`;
    return Bun.spawnSync(['ls', AGENTS_DIR], { stdout: 'pipe' })
        .stdout.toString()
        .split('\n')
        .filter((f) => f.startsWith(prefix) && f.endsWith('.plist'))
        .map((f) => f.slice(prefix.length, -'.plist'.length));
}

const command = (process.argv[2] ?? 'status') as Command;
const rawNames = process.argv.slice(3);
const commands: Command[] = [
    'install',
    'start',
    'stop',
    'restart',
    'status',
    'uninstall',
    'to-lite',
    'to-chrome'
];
if (!commands.includes(command)) {
    throw new Error(`Unknown command "${command}". Expected: ${commands.join(', ')}`);
}

mkdirSync(AGENTS_DIR, { recursive: true });
mkdirSync(LOG_DIR, { recursive: true });
assertLiteDeps();

if ((command === 'to-lite' || command === 'to-chrome') && rawNames.length === 0) {
    throw new Error(`${command} requires at least one bot name`);
}

const names =
    rawNames.length > 0 ? rawNames.map(resolveBot) : listedLiteBots().map((n) => resolveBot(n) || n);

let failed = false;

if (command === 'status') {
    const list = names.length ? names : listedLiteBots();
    if (list.length === 0) console.log('No lite launch agents installed');
    for (const name of list) printStatus(name);
} else if (command === 'install' || command === 'start') {
    for (let i = 0; i < names.length; i++) {
        const name = names[i]!;
        writeLiteAgent(name);
        if (!startLite(name)) failed = true;
        if (names.length > 1 && i < names.length - 1) await Bun.sleep(STAGGER_MS);
    }
} else if (command === 'stop') {
    for (const name of names) if (!stopLite(name)) failed = true;
} else if (command === 'restart') {
    for (let i = 0; i < names.length; i++) {
        if (!restartLite(names[i]!)) failed = true;
        if (names.length > 1 && i < names.length - 1) await Bun.sleep(STAGGER_MS);
    }
} else if (command === 'uninstall') {
    for (const name of names) {
        if (!stopLite(name)) failed = true;
        if (existsSync(litePlistPath(name))) unlinkSync(litePlistPath(name));
        console.log(`${name}: lite launch agent removed`);
    }
} else if (command === 'to-lite') {
    const moved: string[] = [];
    for (let i = 0; i < names.length; i++) {
        const name = names[i]!;
        writeLiteAgent(name);
        if (isLoaded(liteLabel(name))) {
            if (!restartLite(name)) failed = true;
        } else if (!startLite(name)) {
            failed = true;
            continue;
        }
        const ok = await waitInGame(name, WAIT_MS, true);
        if (!ok) {
            console.log(`${name}: lite did not reach in-game within ${WAIT_MS / 1000}s — grind not restarted`);
            failed = true;
            continue;
        }
        console.log(`${name}: lite in-game`);
        restartGrind(name);
        moved.push(name);
        if (names.length > 1 && i < names.length - 1) await Bun.sleep(STAGGER_MS);
    }
    if (moved.length) closeChromeTabs(moved);
} else if (command === 'to-chrome') {
    for (let i = 0; i < names.length; i++) {
        const name = names[i]!;
        stopLite(name);
        openChrome(name);
        const ok = await waitInGame(name);
        if (!ok) {
            console.log(`${name}: Chrome did not reach in-game within ${WAIT_MS / 1000}s — grind not restarted`);
            failed = true;
            continue;
        }
        console.log(`${name}: Chrome in-game`);
        restartGrind(name);
        if (names.length > 1 && i < names.length - 1) await Bun.sleep(STAGGER_MS);
    }
}

if (failed) process.exitCode = 1;
