/**
 * One-off move of a paused account to a swarm hub (swarm-jobs.ts walks only short legs):
 * out of the Gnome Stronghold / Al Kharid if needed, walk to the hub bank, bank the pack, exit.
 *
 *   bun bots/quests/go-to-hub.ts {botname} --hub=ardougne|catherby
 *
 * Exit 0 when parked at the hub bank, 1 otherwise.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { closeUi, walkNear } from './movement';
import { crossAlKharidToll, inAlKharidRegion } from './alkharid-toll';
import { crossGnomeGate, inStronghold } from './lib/gnome-stronghold';
import type { Quest } from './lib/run-quest';

/** swarm-jobs.ts hubs: Ardougne south bank (knights) and Catherby bank (big net). */
const HUBS: Record<string, { x: number; z: number }> = {
    ardougne: { x: 2655, z: 3283 },
    catherby: { x: 2809, z: 3436 }
};

const argv = process.argv.slice(2);
const name = argv.find((a) => !a.startsWith('-'))!;
const hubName = argv.find((a) => a.startsWith('--hub='))?.split('=')[1] ?? 'ardougne';
const hub = HUBS[hubName];
if (!name || !hub) throw new Error('usage: go-to-hub.ts {botname} --hub=ardougne|catherby');

const envPath = join(process.cwd(), 'bots', name, 'bot.env');
if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}`);
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    const eq = t.indexOf('=');
    if (t && !t.startsWith('#') && eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}

initPathfinding();
const sdk = new BotSDK({
    botUsername: process.env.BOT_USERNAME!,
    password: process.env.PASSWORD!,
    gatewayUrl: deriveGatewayUrl(process.env.SERVER),
    autoLaunchBrowser: false,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false
});
await sdk.connect();
const bot = new BotActions(sdk);
const log = (m: string) => console.log(`${new Date().toISOString()} [go-to-hub ${name}] ${m}`);
const pos = () => ({ x: sdk.getState()?.player?.worldX ?? 0, z: sdk.getState()?.player?.worldZ ?? 0, level: sdk.getState()?.player?.level ?? 0 });
const dist = () => Math.hypot(pos().x - hub.x, pos().z - hub.z);

let ok = false;
try {
    await closeUi(bot, sdk);
    log(`start @ ${pos().x},${pos().z},L${pos().level} -> ${hubName} (${hub.x},${hub.z})`);
    if (inStronghold(pos())) {
        const q = {
            bot,
            sdk,
            log,
            goTo: (t: { x: number; z: number }, tol = 2) => walkNear(bot, sdk, t.x, t.z, tol).then(() => undefined),
            climbTo: async (level: number) => {
                for (let i = 0; i < 4 && pos().level > level; i++) {
                    const down = sdk.findNearbyLoc(/ladder|staircase|branch|rope|tree/i);
                    const op = down?.optionsWithIndex.find((o) => /climb-down|climb down/i.test(o.text));
                    if (!down || !op) break;
                    await bot.interactLoc(down, op.text);
                    await sdk.waitForTicks(4).catch(() => {});
                }
            }
        } as unknown as Quest;
        await crossGnomeGate(q, false).catch((e) => log(`gnome gate: ${(e as Error).message}`));
    }
    if (inAlKharidRegion(pos())) await crossAlKharidToll(bot, sdk, false, { log });
    for (let attempt = 1; attempt <= 4 && dist() > 6; attempt++) {
        const r = await bot.walkTo(hub.x, hub.z, 3);
        if (!r.success && dist() > 6) await walkNear(bot, sdk, hub.x, hub.z, 3);
        log(`walk ${attempt}: @ ${pos().x},${pos().z} (${Math.round(dist())} tiles to go)`);
    }
    if (dist() <= 8) {
        const opened = await bot.openBank();
        if (opened.success) {
            for (let i = 0; i < 28; i++) {
                const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0);
                if (!item) break;
                const r = await bot.depositItem(item, -1);
                if (!r.success && !r.partial) break;
            }
            await bot.closeBank();
        }
        ok = true;
    }
    log(`${ok ? 'parked' : 'NOT at the hub'} @ ${pos().x},${pos().z} pack=${sdk.getInventory().length}`);
} catch (e) {
    log(`error: ${(e as Error).message}`);
} finally {
    await sdk.disconnect();
    process.exit(ok ? 0 : 1);
}
