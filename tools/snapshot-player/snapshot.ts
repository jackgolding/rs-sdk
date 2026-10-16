#!/usr/bin/env bun
/**
 * Snapshot a live player (stats, inventory, equipment, location) to JSON for
 * local debugging.
 *
 *   bun tools/snapshot-player/snapshot.ts <botname> [--out=snapshots/] [--force] [--timeout=90]
 *   bun tools/snapshot-player/snapshot.ts --env-file=/path/to/bot.env [--out=...]
 *
 * Credential lookup for <botname>: ./bots/<name>/bot.env, then
 * ~/rs-sdk/bots/<name>/bot.env (fleet passwords live in the fleet checkout;
 * this tool lives in the offline/debug checkout).
 *
 * !! ONE-CONTROLLER RULE: logging in here PRE-EMPTS the live session for that
 * !! account. If the bot is currently grinding (Mac launchd job or VPS quest/
 * !! lite containers), STOP IT FIRST, snapshot, then restart it:
 * !!   Mac: bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts stop <Name>
 * !!   VPS: ssh root@$IP "cd /srv/fleet/repo && docker compose -f infra/pilot/compose.fleet.yml stop lite-<slug> quest-<slug>"
 * !! The script refuses while the player is online unless --force is given.
 *
 * Captured: skill XP/levels (all 21), backpack inventory, worn equipment,
 * map position, run energy. NOT captured (invisible to the SDK): bank
 * contents, quest varps / quest points, appearance, playtime. See README.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';

const argv = process.argv.slice(2);
const flags = new Map<string, string>();
const positional: string[] = [];
for (const a of argv) {
    if (a.startsWith('--')) {
        const [k, v] = a.slice(2).split('=');
        flags.set(k, v ?? 'true');
    } else {
        positional.push(a);
    }
}

const force = flags.get('force') === 'true';
const timeoutSec = Math.max(15, parseInt(flags.get('timeout') ?? '90', 10) || 90);
const outArg = flags.get('out') ?? 'snapshots';
const envFileArg = flags.get('env-file');

function loadEnvFile(path: string): void {
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
    }
}

let envPath = envFileArg;
if (!envPath) {
    const name = positional[0];
    if (!name) {
        console.error('usage: snapshot.ts <botname> [--out=...] [--force] [--timeout=90]');
        process.exit(1);
    }
    const candidates = [
        join(process.cwd(), 'bots', name, 'bot.env'),
        join(homedir(), 'rs-sdk', 'bots', name, 'bot.env'),
    ];
    envPath = candidates.find(p => existsSync(p)) ?? '';
    if (!envPath) {
        console.error(`bot.env for "${name}" not found. Tried:\n  ${candidates.join('\n  ')}\nPass --env-file=/path/to/bot.env explicitly.`);
        process.exit(1);
    }
}
if (!existsSync(envPath)) {
    console.error(`env file not found: ${envPath}`);
    process.exit(1);
}
loadEnvFile(envPath);

const username = process.env.BOT_USERNAME ?? '';
const password = process.env.PASSWORD ?? '';
const server = process.env.SERVER;
if (!username || !password) {
    console.error(`BOT_USERNAME/PASSWORD missing in ${envPath}`);
    process.exit(1);
}
const fileKey = username.toLowerCase().replace(/[^a-z0-9]/g, '_');

function webOrigin(srv: string | undefined): string {
    if (!srv) return 'http://localhost:7780';
    if (srv.startsWith('http')) return srv;
    if (srv === 'localhost' || srv.startsWith('localhost:')) return `http://${srv}`;
    return `https://${srv}`;
}

async function isOnline(): Promise<boolean | null> {
    try {
        const res = await fetch(`${webOrigin(server)}/playerpositions`, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return null;
        const players = (await res.json()) as { name: string }[];
        return players.some(p => p.name.toLowerCase().replace(/[^a-z0-9]/g, '_') === fileKey);
    } catch {
        return null;
    }
}

const online = await isOnline();
if (online === true && !force) {
    console.error(
        `${username} is ONLINE on ${server ?? '(local)'}.\n` +
        `Snapshotting now would pre-empt the live session (one-controller rule) and the running\n` +
        `bot would fight this login. Stop the bot first (see header), then re-run.\n` +
        `Override with --force if you know what you are doing.`
    );
    process.exit(2);
}
if (online === null) console.warn('warn: could not reach /playerpositions; proceeding blind. Stop the live bot first if it is running.');

const sdk = new BotSDK({
    botUsername: username,
    password,
    gatewayUrl: deriveGatewayUrl(server),
    autoLaunchBrowser: false,
    autoReconnect: false,
    connectTimeout: 60_000,
    readyTimeout: 45_000,
    showChat: false,
});

console.log(`connecting as ${username} via ${deriveGatewayUrl(server)} ...`);
await sdk.connect();

const deadline = Date.now() + timeoutSec * 1000;
let state = null as NonNullable<ReturnType<BotSDK['getState']>>;
for (;;) {
    const s = sdk.getState();
    if (s?.inGame && s.player && s.skills?.length === 21 && s.tick > 0) {
        state = s;
        break;
    }
    if (Date.now() > deadline) {
        console.error(`timed out after ${timeoutSec}s waiting for fresh in-game state (inGame=${s?.inGame}, skills=${s?.skills?.length}, tick=${s?.tick}). Is the world up and the account loggable-in?`);
        await sdk.disconnect().catch(() => {});
        process.exit(1);
    }
    await new Promise(r => setTimeout(r, 500));
}

const snapshot = {
    tool: 'snapshot-player',
    version: 1,
    username,
    fileKey,
    server: server ?? 'localhost',
    snapshotAt: new Date().toISOString(),
    player: {
        x: state.player!.x,
        z: state.player!.z,
        level: state.player!.level,
        runEnergy: state.player!.runEnergy,
    },
    skills: state.skills.map(s => ({ name: s.name, level: s.level, baseLevel: s.baseLevel, experience: s.experience })),
    inventory: state.inventory.map(i => ({ slot: i.slot, id: i.id, name: i.name, count: i.count })),
    equipment: state.equipment.map(i => ({ slot: i.slot, id: i.id, name: i.name, count: i.count })),
};

let outPath = outArg;
if (!outPath.endsWith('.json')) {
    mkdirSync(outPath, { recursive: true });
    const stamp = snapshot.snapshotAt.replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
    outPath = join(outPath, `${fileKey}-${stamp}.json`);
} else {
    mkdirSync(join(outPath, '..') === '' ? '.' : dirname2(outPath), { recursive: true });
}
function dirname2(p: string): string {
    const i = p.lastIndexOf('/');
    return i <= 0 ? '.' : p.slice(0, i);
}
writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

console.log(`snapshot of ${username} @ (${snapshot.player.x}, ${snapshot.player.z}, l${snapshot.player.level})`);
console.log(`  skills: ${snapshot.skills.map(s => `${s.name}:${s.baseLevel}`).join(' ')}`);
console.log(`  inventory: ${snapshot.inventory.length} stacks, equipment: ${snapshot.equipment.length} pieces`);
console.log(`wrote ${resolve(outPath)}`);
console.log(`apply locally: cd ~/rs-sdk-offline/server/engine && bun tools/server/snapshot-apply.ts ${resolve(outPath)}`);

await sdk.disconnect().catch(() => {});
process.exit(0);
