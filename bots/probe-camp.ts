/**
 * Throwaway: what blocks the last hop into the Ardougne Monastery imp camp?
 *
 *   bun bots/probe-camp.ts <bot>
 *
 * Teleports to the tile where the walker stalls, then dumps every loc in range
 * with its options and walkability, so the gate (or fence) is named rather than
 * guessed.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { BotSDK, deriveGatewayUrl } from '../sdk/index';
import { initPathfinding, isTileWalkable } from '../sdk/pathfinding';

const botArg = process.argv.slice(2).find((a) => !a.startsWith('-'));
if (!botArg) throw new Error('usage: probe-camp.ts <bot>');
for (const line of readFileSync(join(process.cwd(), 'bots', botArg, 'bot.env'), 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}
initPathfinding();
const sdk = new BotSDK({
    botUsername: process.env.BOT_USERNAME!,
    password: process.env.PASSWORD!,
    gatewayUrl: deriveGatewayUrl(process.env.SERVER),
    autoLaunchBrowser: false,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    autoReconnect: false,
    showChat: false,
});
await sdk.connect();
const ticks = (n: number) => sdk.waitForTicks(n).catch(() => undefined);

// x=2630 -> mx=41, lx=6 ; z=3228 -> mz=50, lz=28
await sdk.say('::tele 0,41,50,6,28');
await ticks(8);
await sdk.scanNearbyLocs(12).catch(() => undefined);
await ticks(4);
await sdk.scanNearbyLocs(12).catch(() => undefined);

const p = sdk.getState()?.player;
console.log(`at (${p?.worldX},${p?.worldZ}) l${p?.level}`);
const locs = (sdk.getNearbyLocs() ?? []).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
console.log(`${locs.length} loc(s) in range:`);
for (const l of locs.slice(0, 25)) {
    const opts = (l.optionsWithIndex ?? []).map((o) => `${o.opIndex}:${o.text}`).join(' | ');
    console.log(`   ${l.name} (${l.x},${l.z}) dist=${l.distance ?? '?'} reachable=${l.reachable ?? '?'} opts=[${opts}]`);
}

// Where is the camp tile itself? Print walkability on a small grid toward it.
console.log('\nwalkable grid toward the camp (2632,3218), . = walkable, # = not:');
for (let z = 3232; z >= 3214; z -= 2) {
    let row = `${String(z).padStart(5)} `;
    for (let x = 2620; x <= 2644; x += 2) row += isTileWalkable(0, x, z) ? '.' : '#';
    console.log(row);
}
console.log('        ' + Array.from({ length: 13 }, (_, i) => String(2620 + i * 2).slice(-1)).join(''));

sdk.disconnect();
process.exit(0);
