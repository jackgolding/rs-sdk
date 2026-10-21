/**
 * leave-essence — walk an account out of the rune essence mine before handing it
 * to another script.
 *
 *   tools/canary.sh <acct> leave-essence.ts
 *   bun bots/quests/leave-essence.ts <botname>
 *
 * Why: the essence mine is an instanced pocket (x 2860-3040, z 4760-4940) reached
 * via Aubury's teleport, with no walkable route back to the surface — the exit is
 * the Portal loc. A quest script started from inside the mine plans surface routes
 * it can never walk and either blocks on the first leg or burns its whole budget
 * refusing hops. So the driver/canary hands over only after this script proves the
 * account is outside that box.
 *
 * Exit codes: 0 = outside (or never inside), 1 = still inside after all attempts.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';

const argv = process.argv.slice(2);
const botArg = argv.find(a => !a.startsWith('-'));
const envPath = botArg ? join(process.cwd(), 'bots', botArg, 'bot.env') : join(process.cwd(), 'bot.env');
if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}`);
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}
const username = process.env.BOT_USERNAME!;
const gatewayUrl = deriveGatewayUrl(process.env);

const sdk = new BotSDK({ botUsername: username, gatewayUrl });
const bot = new BotActions(sdk);
const log = (m: string) => console.log(`[leave-essence] ${m}`);

const IN_MINE = (x: number, z: number) => x >= 2860 && x <= 3040 && z >= 4760 && z <= 4940;
const pos = () => sdk.getState()?.player ?? { worldX: 0, worldZ: 0, level: 0 };

await sdk.connect();
await sdk.waitForCondition((s) => !!s.player, 20_000).catch(() => undefined);
const start = pos();
log(`start (${start.worldX},${start.worldZ}) l${start.level} inMine=${IN_MINE(start.worldX, start.worldZ)}`);

if (!IN_MINE(start.worldX, start.worldZ)) {
    log('already outside the essence mine — nothing to do');
    await sdk.disconnect();
    process.exit(0);
}

for (let attempt = 1; attempt <= 6; attempt++) {
    const p = pos();
    if (!IN_MINE(p.worldX, p.worldZ)) break;

    await sdk.scanNearbyLocs(20).catch(() => undefined);
    let portal = sdk.findNearbyLoc(/^portal$/i) ?? sdk.findNearbyLoc(/portal/i);
    if (!portal) {
        // The mine's portal sits near the south-west of the pocket; probe around it.
        for (const t of [{ x: 2885, z: 4850 }, { x: 2880, z: 4835 }, { x: 2900, z: 4830 }]) {
            await bot.walkTo(t.x, t.z, 2).catch(() => undefined);
            await sdk.scanNearbyLocs(20).catch(() => undefined);
            portal = sdk.findNearbyLoc(/portal/i);
            if (portal) break;
        }
    }
    if (!portal) {
        log(`attempt ${attempt}: no Portal loc in view at (${pos().worldX},${pos().worldZ})`);
        await bot.walkTo(p.worldX + 6, p.worldZ - 6, 3).catch(() => undefined);
        await sdk.waitForTicks(3);
        continue;
    }

    if ((portal.distance ?? 99) > 2) {
        await bot.walkTo(portal.x, portal.z, 1).catch(() => undefined);
        await sdk.waitForTicks(2);
    }
    log(`attempt ${attempt}: portal @ (${portal.x},${portal.z}) dist=${portal.distance} options=${portal.optionsWithIndex?.map(o => o.text).join('|')}`);
    await bot.interactLoc(portal, /use|enter|climb/i).catch(() => undefined);
    await sdk.waitForCondition((s) => {
        const pl = s.player;
        return !pl || !IN_MINE(pl.worldX, pl.worldZ);
    }, 10_000).catch(() => undefined);
    const after = pos();
    log(`attempt ${attempt}: now (${after.worldX},${after.worldZ}) l${after.level} inMine=${IN_MINE(after.worldX, after.worldZ)}`);
}

const end = pos();
await sdk.disconnect();
if (IN_MINE(end.worldX, end.worldZ)) {
    log(`FAILED to leave the essence mine — stuck at (${end.worldX},${end.worldZ})`);
    process.exit(1);
}
log(`out of the essence mine at (${end.worldX},${end.worldZ}) l${end.level}`);
process.exit(0);
