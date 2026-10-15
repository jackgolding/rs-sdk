#!/usr/bin/env bun
/**
 * Docker-side bot control for the VPS fleet. Dispatched from fleet-desk on
 * FLEET_SUPERVISOR=docker; the Mac keeps fleet-launchd.ts. Desk jobs stream
 * this script's stdout to the browser, so every step prints one line.
 *
 *   bun fleet-ctl.ts stop <Name> [--drain] [--grace=90]
 *   bun fleet-ctl.ts start <Name>
 *   bun fleet-ctl.ts restart <Name> [--verify] [--timeout=10m]
 *   bun fleet-ctl.ts switch <Name> [--verify]   (caller rewrites the roster
 *       first; this regenerates compose.fleet.yml and recreates the service.
 *       Brand-new quest files need an image rebuild — a deploy — first.)
 *
 * --drain mirrors launchd's SIGTERM-then-park: the quest script banks on
 * SIGTERM and writes park.json, which we wait for. The shepherd is held via
 * its lock file for the duration (auto-stales in 5 min if we die).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { dockerContainerId, supervisorKind } from './supervisor';
import { ROOT } from './roster';
import { STATE_DIR, releaseLock } from './fleet-shepherd';
import { parseTimeout, verifyOutcome } from './fleet-verify';
import { readJsonlTail } from '../../../../sdk/grind-log';
import type { ActivityEvent, HeartbeatRecord } from './fleet-rates';

const GRACE_SECS = 90;
const COMPOSE = join(ROOT, 'infra/pilot/compose.fleet.yml');
const GEN = join(ROOT, 'infra/pilot/gen-compose.py');

const slug = (name: string) => name.toLowerCase();
const questSvc = (name: string) => `quest-${slug(name)}`;
const liveBots = () => (process.env.FLEET_BOTS_DIR ? process.env.FLEET_BOTS_DIR : join(ROOT, 'bots'));
const parkPath = (name: string) => join(liveBots(), name, 'park.json');
const eventsPath = (name: string) => join(liveBots(), name, 'events.log');
const heartbeatPath = (name: string) => join(liveBots(), name, 'heartbeat.log');

function fail(msg: string): never {
    console.error(msg);
    process.exit(1);
}

interface Inspect {
    running: boolean;
    pid: number | null;
}

function inspectContainer(id: string): Inspect | null {
    const proc = Bun.spawnSync(['docker', 'inspect', id], { stdout: 'pipe', stderr: 'pipe' });
    if (proc.exitCode !== 0) return null;
    try {
        const entry = JSON.parse(new TextDecoder().decode(proc.stdout))[0];
        const running = entry?.State?.Running === true;
        const pid = typeof entry?.State?.Pid === 'number' && entry.State.Pid > 0 ? entry.State.Pid : null;
        return { running, pid };
    } catch {
        return null;
    }
}

function compose(args: string[]): { ok: boolean; out: string } {
    const proc = Bun.spawnSync(['docker', 'compose', '-f', COMPOSE, ...args], {
        cwd: ROOT,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const text = new TextDecoder();
    const out = `${text.decode(proc.stdout)}${text.decode(proc.stderr)}`.trim();
    return { ok: proc.exitCode === 0, out };
}

function holdShepherd(): void {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(join(STATE_DIR, 'shepherd.lock'), String(Date.now()));
}

async function opStop(name: string, drain: boolean, grace: number): Promise<boolean> {
    const t0 = Date.now();
    const id = dockerContainerId(name);
    if (!id) {
        console.log(`${name}: no quest container — already stopped`);
        return true;
    }
    const info = inspectContainer(id);
    if (info && !info.running) {
        console.log(`${name}: container present but not running — stopped`);
        return true;
    }
    if (drain) holdShepherd();
    try {
        console.log(`${name}: docker stop -t ${grace}${drain ? ' (draining to bank)' : ''}`);
        const proc = Bun.spawnSync(['docker', 'stop', '-t', String(grace), id], { stdout: 'pipe', stderr: 'pipe' });
        if (proc.exitCode !== 0) {
            console.error(`${name}: stop failed — ${new TextDecoder().decode(proc.stderr).trim()}`);
            return false;
        }
        if (!drain) {
            console.log(`${name}: stopped`);
            return true;
        }
        const deadline = Date.now() + (grace + 30) * 1000;
        while (Date.now() < deadline) {
            try {
                const park = JSON.parse(readFileSync(parkPath(name), 'utf-8')) as {
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
            const cur = id ? inspectContainer(id) : null;
            if (!cur || !cur.running) {
                console.log(`${name}: stopped (no banked park — drain timed out or predates safe-stop code)`);
                return true;
            }
            await Bun.sleep(5_000);
        }
        console.log(`${name}: still draining — left alone, check park.json`);
        return false;
    } finally {
        if (drain) releaseLock();
    }
}

async function opStart(name: string): Promise<boolean> {
    const id = dockerContainerId(name);
    if (id) {
        const info = inspectContainer(id);
        if (info?.running) {
            console.log(`${name}: already running`);
            return true;
        }
        const proc = Bun.spawnSync(['docker', 'start', id], { stdout: 'pipe', stderr: 'pipe' });
        console.log(`${name}: ${proc.exitCode === 0 ? 'started' : `start failed — ${new TextDecoder().decode(proc.stderr).trim()}`}`);
        return proc.exitCode === 0;
    }
    console.log(`${name}: no container — creating via compose`);
    const r = compose(['up', '-d', questSvc(name)]);
    console.log(r.ok ? `${name}: created and started` : `${name}: compose up failed — ${r.out}`);
    return r.ok;
}

async function verify(name: string, t0: number, oldPid: number | null, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        let events: ActivityEvent[] = [];
        let snaps: HeartbeatRecord[] = [];
        try {
            events = existsSync(eventsPath(name)) ? readJsonlTail<ActivityEvent>(eventsPath(name)) : [];
            snaps = existsSync(heartbeatPath(name)) ? readJsonlTail<HeartbeatRecord>(heartbeatPath(name)) : [];
        } catch {
            /* tails unreadable yet */
        }
        const outcome = verifyOutcome({ events, snapshots: snaps, t0, oldPid, now: Date.now(), timeoutMs });
        if (outcome.status === 'success') {
            console.log(`${name}: verified producing — ${outcome.evidence}`);
            return true;
        }
        if (outcome.status === 'failure') {
            console.error(`${name}: verify failed — ${outcome.reason}`);
            return false;
        }
        await Bun.sleep(15_000);
    }
    console.error(`${name}: no effect within ${Math.round(timeoutMs / 60_000)}m — inspect grind.log`);
    return false;
}

async function opRestart(name: string, verifyIt: boolean, timeoutMs: number, grace: number): Promise<boolean> {
    const t0 = Date.now();
    const id = dockerContainerId(name);
    const oldPid = id ? (inspectContainer(id)?.pid ?? null) : null;
    if (!id) return opStart(name);
    console.log(`${name}: docker restart -t ${grace}`);
    const proc = Bun.spawnSync(['docker', 'restart', '-t', String(grace), id], { stdout: 'pipe', stderr: 'pipe' });
    if (proc.exitCode !== 0) {
        console.error(`${name}: restart failed — ${new TextDecoder().decode(proc.stderr).trim()}`);
        return false;
    }
    console.log(`${name}: restarted`);
    if (!verifyIt) return true;
    return verify(name, t0, oldPid, timeoutMs);
}

async function opSwitch(name: string, verifyIt: boolean, timeoutMs: number): Promise<boolean> {
    // The quest container mounts the LIVE roster read-only; sync the repo
    // copy the desk just rewrote before regenerating compose from it.
    const repoRoster = join(ROOT, 'bots', 'roster.json');
    const liveRoster = join(liveBots(), 'roster.json');
    if (resolve(repoRoster) !== resolve(liveRoster)) {
        try {
            writeFileSync(liveRoster, readFileSync(repoRoster));
            console.log(`${name}: synced roster.json to the live bots dir`);
        } catch (e) {
            fail(`${name}: roster sync failed — ${(e as Error).message}`);
        }
    }
    console.log(`${name}: regenerating compose.fleet.yml`);
    const gen = Bun.spawnSync(['python3', GEN], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
    if (gen.exitCode !== 0) fail(`gen-compose.py failed — ${new TextDecoder().decode(gen.stderr).trim()}`);
    writeFileSync(COMPOSE, new TextDecoder().decode(gen.stdout));
    const r = compose(['up', '-d', questSvc(name)]);
    if (!r.ok) fail(`${name}: compose up failed — ${r.out}`);
    console.log(`${name}: service recreated with the roster script`);
    if (!verifyIt) return true;
    return verify(name, Date.now(), null, timeoutMs);
}

async function main(): Promise<void> {
    if (supervisorKind() !== 'docker') fail('fleet-ctl is docker-only; the Mac uses fleet-launchd.ts');
    const argv = process.argv.slice(2);
    const op = argv.find((a) => !a.startsWith('-'));
    const opt = (key: string): string | undefined => {
        const hit = argv.find((a) => a.startsWith(`--${key}=`));
        return hit ? hit.slice(key.length + 3) : undefined;
    };
    const flag = (key: string): boolean => argv.includes(`--${key}`);
    if (!op || !argv.find((a, i) => i > 0 && !a.startsWith('-'))) fail('usage: fleet-ctl.ts <stop|start|restart|switch> <Name> [--drain] [--verify] [--grace=90] [--timeout=10m]');
    const names = argv.filter((a) => !a.startsWith('-'));
    const name = names[1] ?? fail('usage: fleet-ctl.ts <stop|start|restart|switch> <Name> [...flags]');
    const grace = Math.max(10, parseInt(opt('grace') ?? String(GRACE_SECS), 10) || GRACE_SECS);
    const timeoutMs = parseTimeout(opt('timeout'), 10 * 60 * 1000);
    let ok = false;
    if (op === 'stop') ok = await opStop(name, flag('drain'), grace);
    else if (op === 'start') ok = await opStart(name);
    else if (op === 'restart') ok = await opRestart(name, flag('verify'), timeoutMs, grace);
    else if (op === 'switch') ok = await opSwitch(name, flag('verify'), timeoutMs);
    else fail(`unknown op ${op}: want stop|start|restart|switch`);
    process.exit(ok ? 0 : 1);
}

await main();
