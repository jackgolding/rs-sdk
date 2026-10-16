#!/usr/bin/env bun
/**
 * Log in accounts with no live client, open every roster bank, then start
 * the grinds that were running. Lite stays up. skip-bots are not force-logged
 * in (that session may be manual Chrome) but are still opened if already live.
 * Shepherd is unloaded for the pass so it does not start grinds mid-walk.
 *
 *   bun tools/fleet-desk/bank-check.ts
 *   bun tools/fleet-desk/bank-check.ts --except jackthief
 *
 * `--except` leaves named accounts fully out of the pass: their grinds keep
+ * running and their banks are not opened (the snapshot run would otherwise
+ * steal control from the live owner).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { isFreshGatewayState, type GatewaySnapshot } from '../../sdk/gateway-state';
import { botsDir, ROOT, rosterBots } from '../../.cursor/skills/wake-fleet/scripts/roster';
import { supervisorKind } from '../../.cursor/skills/wake-fleet/scripts/supervisor';
import { releaseLock, STATE_DIR } from '../../.cursor/skills/wake-fleet/scripts/fleet-shepherd';

const LAUNCHD = join(ROOT, '.cursor/skills/wake-fleet/scripts/fleet-launchd.ts');
const LITE = join(ROOT, '.cursor/skills/lite-client/scripts/lite-launchd.ts');
const COMPOSE = join(ROOT, 'infra/pilot/compose.fleet.yml');
const SNAPSHOT = join(ROOT, 'bots/quests/snapshot-nearest-banks.ts');
const SHEPHERD_LABEL = 'com.rs-sdk.fleet-shepherd';
const USER_ID = process.getuid?.() ?? Number(Bun.spawnSync(['id', '-u']).stdout.toString().trim());
const DOMAIN = `gui/${USER_ID}`;
const SHEPHERD_PLIST = join(homedir(), 'Library', 'LaunchAgents', `${SHEPHERD_LABEL}.plist`);
const LOGIN_WAIT_MS = 180_000;

export function bankPass(bots: { name: string; paused: boolean; pauseSource?: string | null }[]): {
    open: string[];
    restart: string[];
    login: string[];
} {
    return {
        open: bots.map((bot) => bot.name),
        restart: bots.filter((bot) => !bot.paused).map((bot) => bot.name),
        login: bots.filter((bot) => bot.pauseSource !== 'skip-bots').map((bot) => bot.name),
    };
}

export function namesNeedingLogin(candidates: string[], fresh: ReadonlySet<string>): string[] {
    return candidates.filter((name) => !fresh.has(name));
}

function statusUrl(name: string): string {
    // Per-bot live files (bot.env) live under FLEET_BOTS_DIR on the VPS
    // host (/srv/fleet/bots), not in the repo checkout.
    const envPath = join(botsDir(), name, 'bot.env');
    let server: string | undefined;
    if (existsSync(envPath)) {
        for (const line of readFileSync(envPath, 'utf8').split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eq = trimmed.indexOf('=');
            if (eq <= 0) continue;
            const key = trimmed.slice(0, eq).trim();
            const value = trimmed.slice(eq + 1).trim();
            if (key === 'SERVER') server = value || undefined;
            if (key === 'GATEWAY_URL' && value) server = value;
        }
    }
    if (server?.startsWith('ws://') || server?.startsWith('wss://') || server?.startsWith('http')) {
        const http = server.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:').replace(/\/gateway$/, '');
        return `${http.replace(/\/$/, '')}/status/${encodeURIComponent(name)}`;
    }
    if (!server || server === 'localhost' || server.startsWith('localhost:')) {
        const host = server?.includes(':') ? server : 'localhost:7780';
        return `http://${host}/status/${encodeURIComponent(name)}`;
    }
    return `https://${server}/status/${encodeURIComponent(name)}`;
}

async function freshNameSet(names: string[]): Promise<Set<string>> {
    const rows = await Promise.all(
        names.map(async (name) => {
            try {
                const res = await fetch(statusUrl(name), { signal: AbortSignal.timeout(8000) });
                if (!res.ok) return null;
                const gw = (await res.json()) as GatewaySnapshot;
                return isFreshGatewayState(gw) ? name : null;
            } catch {
                return null;
            }
        })
    );
    return new Set(rows.filter((name): name is string => name != null));
}

async function waitForLiveClients(names: string[]): Promise<string[]> {
    const deadline = Date.now() + LOGIN_WAIT_MS;
    let pending = names;
    while (pending.length > 0 && Date.now() < deadline) {
        const fresh = await freshNameSet(pending);
        if (fresh.size > 0) console.log(`[bank-check] live: ${[...fresh].join(', ')}`);
        pending = pending.filter((name) => !fresh.has(name));
        if (pending.length === 0) break;
        await Bun.sleep(2000);
    }
    return pending;
}

function launchctl(args: string[]): { ok: boolean; output: string } {
    const proc = Bun.spawnSync(['launchctl', ...args]);
    const output = `${proc.stdout ?? ''}${proc.stderr ?? ''}`.trim();
    return { ok: proc.exitCode === 0, output };
}

let child: ReturnType<typeof Bun.spawn> | null = null;

function run(args: string[], stdout: 'inherit' | 'ignore'): Promise<number> {
    const proc = Bun.spawn([process.execPath, ...args], {
        cwd: ROOT,
        stdout,
        stderr: 'inherit',
        stdin: 'ignore',
    });
    child = proc;
    return proc.exited.finally(() => {
        if (child === proc) child = null;
    });
}

/** Non-bun child (docker, systemctl): same lifecycle tracking, no execPath. */
function runSys(cmd: string[]): Promise<number> {
    const proc = Bun.spawn(cmd, {
        cwd: ROOT,
        stdout: 'inherit',
        stderr: 'inherit',
        stdin: 'ignore',
    });
    child = proc;
    return proc.exited.finally(() => {
        if (child === proc) child = null;
    });
}

function sysStatus(cmd: string[]): { ok: boolean; output: string } {
    const proc = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' });
    const output = `${proc.stdout ?? ''}${proc.stderr ?? ''}`.trim();
    return { ok: proc.exitCode === 0, output };
}

const isDocker = supervisorKind() === 'docker';
/** Mirrors gen-compose.py service naming: quest-<lowercase name>. */
const questSvc = (name: string) => `quest-${name.toLowerCase()}`;

let shepherdWasLoaded = false;
let grindsStopped = false;
let finishing: Promise<void> | null = null;

function holdShepherd(): void {
    if (isDocker) {
        // Stop the systemd timer so no shepherd run restarts quest
        // containers mid-walk. The timer stays enabled, so a reboot
        // restores supervision even if this pass dies mid-flight.
        mkdirSync(STATE_DIR, { recursive: true });
        writeFileSync(join(STATE_DIR, 'shepherd.lock'), String(Date.now()));
        const t = sysStatus(['systemctl', 'stop', 'fleet-shepherd.timer']);
        console.log(t.ok ? 'shepherd timer: held' : `shepherd timer: stop failed — ${t.output}`);
        if (sysStatus(['systemctl', 'is-active', '--quiet', 'fleet-shepherd.service']).ok) {
            const k = sysStatus(['systemctl', 'stop', 'fleet-shepherd.service']);
            console.log(k.ok ? 'shepherd: in-flight run stopped' : `shepherd: service stop failed — ${k.output}`);
        }
        return;
    }
    if (!existsSync(SHEPHERD_PLIST)) {
        console.log('shepherd: not installed');
        return;
    }
    if (!launchctl(['print', `${DOMAIN}/${SHEPHERD_LABEL}`]).ok) {
        console.log('shepherd: not loaded');
        return;
    }
    const out = launchctl(['bootout', `${DOMAIN}/${SHEPHERD_LABEL}`]);
    if (!out.ok) throw new Error(`could not hold shepherd: ${out.output}`);
    shepherdWasLoaded = true;
    console.log('shepherd: held');
}

function releaseShepherd(): void {
    if (isDocker) {
        releaseLock();
        const out = sysStatus(['systemctl', 'start', 'fleet-shepherd.timer']);
        console.log(out.ok ? 'shepherd timer: restored' : `shepherd timer: start failed — ${out.output}`);
        return;
    }
    if (!shepherdWasLoaded) return;
    shepherdWasLoaded = false;
    // Bootstrap without RunAtLoad so shepherd does not immediately restart
    // grinds that have not produced yet. The LaunchAgents file is unchanged,
    // so the next login still loads the normal job.
    const quiet = readFileSync(SHEPHERD_PLIST, 'utf8').replace(/\s*<key>RunAtLoad<\/key>\s*<true\/>/g, '');
    const plist = join(tmpdir(), 'rs-sdk-shepherd-quiet.plist');
    writeFileSync(plist, quiet);
    const out = launchctl(['bootstrap', DOMAIN, plist]);
    console.log(out.ok ? 'shepherd: restored' : `shepherd: restore failed — ${out.output}`);
}

function finish(names: string[]): Promise<void> {
    if (finishing) return finishing;
    finishing = (async () => {
        try {
            if (grindsStopped && names.length > 0) {
                if (isDocker) {
                    console.log(`[bank-check] starting ${names.length} quest container(s)`);
                    const code = await runSys([
                        'docker',
                        'compose',
                        '-f',
                        COMPOSE,
                        'start',
                        ...names.map(questSvc),
                    ]);
                    if (code !== 0) console.log(`[bank-check] quest start exited ${code}`);
                } else {
                    console.log(`[bank-check] starting ${names.length} grind(s)`);
                    const code = await run([LAUNCHD, 'start', ...names], 'inherit');
                    if (code !== 0) console.log(`[bank-check] grind start exited ${code}`);
                }
            }
        } finally {
            releaseShepherd();
        }
    })();
    return finishing;
}

async function main(): Promise<number> {
    const flagAt = process.argv.indexOf('--except');
    const except = new Set(
        (flagAt < 0 ? [] : process.argv.slice(flagAt + 1))
            .map((name) => name.toLowerCase())
    );
    const roster = rosterBots().filter((bot) => !except.has(bot.name.toLowerCase()));
    if (except.size > 0) {
        console.log(`[bank-check] except: ${[...except].join(', ')} (${rosterBots().length - roster.length} skipped)`);
    }
    const { open, restart, login } = bankPass(roster);
    if (open.length === 0) {
        console.log('[bank-check] roster is empty');
        return 0;
    }
    process.on('SIGTERM', () => child?.kill());
    process.on('SIGINT', () => child?.kill());
    let snapCode = 0;
    try {
        holdShepherd();
        if (restart.length > 0) {
            if (isDocker) {
                // One compose call stops every quest container in parallel.
                // SIGTERM lets each quest drain to its bank (park.json), so
                // snapshots start near a bank; -t 60 bounds the wait well
                // below the compose stop grace. Lite containers stay up and
                // keep the game sessions live for the snapshot pass.
                console.log(`[bank-check] stopping ${restart.length} quest container(s)`);
                const stopCode = await runSys([
                    'docker',
                    'compose',
                    '-f',
                    COMPOSE,
                    'stop',
                    '-t',
                    '60',
                    ...restart.map(questSvc),
                ]);
                grindsStopped = true;
                if (stopCode !== 0) console.log(`[bank-check] quest stop exited ${stopCode}`);
            } else {
                console.log(`[bank-check] stopping ${restart.length} grind(s)`);
                const stopCode = await run([LAUNCHD, 'stop', ...restart], 'inherit');
                grindsStopped = true;
                if (stopCode !== 0) console.log(`[bank-check] grind stop exited ${stopCode}`);
            }
        }
        if (isDocker) {
            // Lite containers stay up on the VPS — no restart step. Log
            // accounts with no live client; the snapshot pass reports them
            // stale per account instead of waiting out a login window.
            const fresh = await freshNameSet(login);
            const stale = namesNeedingLogin(login, fresh);
            if (stale.length > 0) {
                console.log(`[bank-check] no live client for ${stale.length} account(s): ${stale.join(', ')}`);
            }
        } else {
            const fresh = await freshNameSet(login);
            const needingLogin = namesNeedingLogin(login, fresh);
            if (needingLogin.length > 0) {
                console.log(`[bank-check] starting lite for ${needingLogin.length} account(s) with no live client`);
                const liteCode = await run([LITE, 'restart', ...needingLogin], 'inherit');
                if (liteCode !== 0) console.log(`[bank-check] lite restart exited ${liteCode}`);
                const stillDown = await waitForLiveClients(needingLogin);
                if (stillDown.length > 0) {
                    console.log(`[bank-check] no live client after wait: ${stillDown.join(', ')}`);
                }
            }
        }
        console.log(`[bank-check] opening nearest banks for ${open.length} account(s)`);
        snapCode = await run([SNAPSHOT, ...open], 'inherit');
    } finally {
        await finish(restart);
    }
    return snapCode;
}

if (import.meta.main) {
    main()
        .then((code) => {
            process.exitCode = code;
        })
        .catch((err) => {
            console.error(err instanceof Error ? err.message : String(err));
            process.exitCode = 1;
        });
}
