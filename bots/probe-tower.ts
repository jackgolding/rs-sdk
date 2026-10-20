/**
 * Throwaway recon probe: what climbable locs actually exist inside the Wizards'
 * Tower, on each plane, with the options the client publishes?
 *
 *   bun bots/probe-tower.ts <bot>
 *
 * Reads only: teleports to the tower interior, scans, climbs, scans again. The
 * point is to replace imp-catcher's assumption ("there is a staircase within 20
 * tiles with a climb-up option") with the map's actual answer.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { BotSDK, deriveGatewayUrl } from '../sdk/index';
import { BotActions } from '../sdk/actions';

const botArg = process.argv.slice(2).find((a) => !a.startsWith('-'));
if (!botArg) throw new Error('usage: probe-tower.ts <bot>');
for (const line of readFileSync(join(process.cwd(), 'bots', botArg, 'bot.env'), 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}
if (!existsSync(join(process.cwd(), 'bots', botArg, 'bot.env'))) throw new Error('no bot.env');

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
const bot = new BotActions(sdk);

const where = () => {
    const p = sdk.getState()?.player;
    return `(${p?.worldX ?? '?'},${p?.worldZ ?? '?'}) l${p?.level ?? '?'}`;
};
const sleepTicks = (n: number) => sdk.waitForTicks(n).catch(() => undefined);

async function dump(label: string): Promise<void> {
    await sleepTicks(6);
    await sdk.scanNearbyLocs(15).catch(() => undefined);
    await sleepTicks(4);
    await sdk.scanNearbyLocs(15).catch(() => undefined);
    const locs = (sdk.getNearbyLocs() ?? []).filter((l) => /stair|ladder/i.test(l.name));
    console.log(`\n== ${label} @ ${where()} — ${locs.length} climbable loc(s)`);
    for (const l of locs) {
        const opts = (l.optionsWithIndex ?? []).map((o) => `${o.opIndex}:${o.text}`).join(' | ');
        console.log(`   ${l.name} (${l.x},${l.z}) dist=${l.distance ?? '?'} reachable=${l.reachable ?? '?'} opts=[${opts}]`);
    }
}

// x=3105 -> mx=48, lx=33 ; z=3163 -> mz=49, lz=27
await sdk.say('::tele 0,48,49,33,27');
await dump('tower interior (plane 0)');

for (let climb = 0; climb < 3; climb++) {
    const up = (sdk.getNearbyLocs() ?? []).find(
        (l) => /stair|ladder/i.test(l.name) && (l.optionsWithIndex ?? []).some((o) => /climb-up|climb up/i.test(o.text)),
    );
    if (!up) {
        console.log('no climb-up loc in the current plane — stopping');
        break;
    }
    console.log(`\nclimbing ${up.name} (${up.x},${up.z}) from ${where()}`);
    const res = await bot.interactLoc(up, /climb-up|climb up/i).catch((e: unknown) => ({ success: false, message: String(e) }));
    console.log(`climb result: ${res.success} ${(res as { message?: string }).message ?? ''}`);
    await sleepTicks(8);
    await dump(`after climb ${climb + 1}`);
}

console.log('\nprobe done');
sdk.disconnect();
process.exit(0);
