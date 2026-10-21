/**
 * probe-walk — why does a walk from this tile move nothing?
 *
 *   tools/canary.sh <acct> probe-walk.ts [x z]
 *   bun bots/quests/probe-walk.ts <botname> [x z]
 *
 * Prints, at the current tile: transport state, the four neighbour tiles'
 * classified walkability (offline collision data), every nearby loc within 6
 * tiles, then the ActionResult of three walk attempts (8-tile, 3-tile, 1-tile)
 * with the displacement each produced. A bot that "refuses every hop" on a tile
 * the planner calls walkable is either off the wire, standing inside geometry, or
 * blocked by something the loc scan can name — this tells you which.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding, isTileWalkable, isIsolatedWalkableTile, findLongPath } from '../../sdk/pathfinding';

const argv = process.argv.slice(2);
const botArg = argv.find(a => !a.startsWith('-'));
const envPath = botArg ? join(process.cwd(), 'bots', botArg, 'bot.env') : join(dirname(import.meta.path), 'bot.env');
if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}`);
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}
const username = process.env.BOT_USERNAME!;

initPathfinding();
const sdk = new BotSDK({
    botUsername: username,
    password: process.env.PASSWORD ?? '',
    gatewayUrl: deriveGatewayUrl(process.env.SERVER),
    autoLaunchBrowser: true,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false,
});
const bot = new BotActions(sdk);
const pos = () => {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const log = (m: string) => console.log(m);

await sdk.connect();
await sdk.waitForCondition(s => !!s.player, 60_000).catch(() => {});

const here = pos();
log(`probe-walk ${username} @ ${here.x},${here.z} l${here.level}`);
log(`transport: isConnected=${sdk.isConnected()} revision=${sdk.getState()?.revision ?? 'n/a'} tick=${sdk.getState()?.tick ?? 'n/a'}`);

log(`offline collision: walkable=${isTileWalkable(here.level, here.x, here.z)} isolated=${isIsolatedWalkableTile(here.level, here.x, here.z)}`);
for (const [dx, dz, name] of [[0, -1, 'N'], [1, 0, 'E'], [0, 1, 'S'], [-1, 0, 'W']] as [number, number, string][]) {
    const x = here.x + dx;
    const z = here.z + dz;
    log(`  neighbour ${name} (${x},${z}) walkable=${isTileWalkable(here.level, x, z)}`);
}

await sdk.scanNearbyLocs(8).catch(() => undefined);
const locs = (sdk.getNearbyLocs() ?? []).filter(l => (l.distance ?? 99) <= 6).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
log(`locs within 6: ${locs.map(l => `${l.name}@${l.x},${l.z}(${(l.optionsWithIndex ?? []).map(o => o.text).join('/')})`).join(' ; ') || '(none)'}`);
log(`npcs within 6: ${(sdk.getNearbyNpcs() ?? []).filter(n => (n.distance ?? 99) <= 6).map(n => `${n.name}@${n.x},${n.z}`).join(' ; ') || '(none)'}`);

const path = findLongPath(here.level, here.x, here.z, here.x - 20, here.z) as { x: number; z: number }[] | null;
log(`offline plan 20 tiles west: ${path?.length ?? 0} waypoints, first ${path?.[0] ? `(${path[0].x},${path[0].z})` : 'n/a'}`);

for (const step of [8, 3, 1] as const) {
    const from = pos();
    const target = { x: from.x - step, z: from.z };
    const res = await sdk.sendWalk(target.x, target.z, true).catch((e: unknown) => ({ success: false, message: String(e) } as any));
    log(`walk ${step} tiles west -> (${target.x},${target.z}) action=${JSON.stringify(res)}`);
    for (let i = 0; i < 12; i++) {
        await sdk.waitForTicks(1);
        if (Math.hypot(pos().x - from.x, pos().z - from.z) >= 1) break;
    }
    const after = pos();
    log(`  now (${after.x},${after.z}) moved=${Math.hypot(after.x - from.x, after.z - from.z).toFixed(1)}`);
    if (after.x !== from.x || after.z !== from.z) break;
}

await sdk.disconnect();
