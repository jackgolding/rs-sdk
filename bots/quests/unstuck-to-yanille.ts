/**
 * Unstuck the named bots and walk them to Yanille Bank, then accept trades.
 * Does not touch jackthief or anyone already on the stack.
 *
 *   bun bots/quests/unstuck-to-yanille.ts Name1 Name2 ...
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { playerPos, walkNear, closeUi, distTo } from './movement';
import { type Tile } from './tiles';

const TARGET: Tile = { x: 2613, z: 3094 };
const YANILLE_RADIUS = 12;

const CATHERBY_WAYPOINTS: Tile[] = [
    { x: 2804, z: 3441 },
    { x: 2788, z: 3460 },
    { x: 2758, z: 3477 },
    { x: 2726, z: 3485 },
    { x: 2695, z: 3375 },
    { x: 2662, z: 3375 },
    { x: 2662, z: 3336 },
    { x: 2662, z: 3312 },
    { x: 2655, z: 3283 },
    { x: 2640, z: 3220 },
    { x: 2630, z: 3170 },
    { x: 2626, z: 3149 },
    { x: 2615, z: 3110 },
    TARGET
];

const SOUTH_WAYPOINTS: Tile[] = [
    { x: 2662, z: 3312 },
    { x: 2655, z: 3283 },
    { x: 2640, z: 3220 },
    { x: 2630, z: 3170 },
    { x: 2626, z: 3149 },
    { x: 2615, z: 3110 },
    TARGET
];

const PORT_SARIM: Tile = { x: 3029, z: 3217 };

const NAMES = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (!NAMES.length) {
    throw new Error('Usage: bun bots/quests/unstuck-to-yanille.ts Name1 Name2 ...');
}

function loadBotCredentials(name: string): { username: string; password: string; server?: string } {
    const envPath = join(process.cwd(), 'bots', name, 'bot.env');
    if (!existsSync(envPath)) throw new Error(`bot.env not found for ${name}`);
    const content = readFileSync(envPath, 'utf-8');
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return {
        username: env.BOT_USERNAME || name,
        password: env.PASSWORD!,
        server: env.SERVER
    };
}

async function createClient(name: string) {
    try {
        const creds = loadBotCredentials(name);
        const sdk = new BotSDK({
            botUsername: creds.username,
            password: creds.password,
            server: creds.server,
            gatewayUrl: deriveGatewayUrl(creds.server),
            autoLaunchBrowser: false,
            connectTimeout: 25_000,
            readyTimeout: 15_000,
            showChat: false
        });
        await sdk.connect();
        return { name, sdk, bot: new BotActions(sdk) };
    } catch (err: any) {
        console.warn(`[connect] ${name}: ${err?.message ?? err}`);
        return null;
    }
}

async function openDoor(sdk: BotSDK): Promise<void> {
    const door = (sdk.getNearbyLocs() ?? []).find(
        (l) => /door|gate/i.test(l.name) && (l.distance ?? 99) <= 2 && l.optionsWithIndex?.some((o) => /^open$/i.test(o.text))
    );
    if (!door) return;
    const open = door.optionsWithIndex?.find((o) => /^open$/i.test(o.text));
    if (!open) return;
    await Promise.race([
        sdk.sendInteractLoc(door.x, door.z, door.id, open.opIndex),
        Bun.sleep(2500)
    ]).catch(() => {});
    await sdk.waitForTicks(2).catch(() => {});
}

async function walkTimed(bot: BotActions, sdk: BotSDK, x: number, z: number, ms = 18_000): Promise<void> {
    if (distTo(sdk, x, z) <= 4) return;
    await openDoor(sdk);
    const before = playerPos(sdk);
    await Promise.race([bot.walkTo(x, z, 3), Bun.sleep(ms)]).catch(() => {});
    if (distTo(sdk, x, z) <= 6) return;
    await sdk.sendWalk(x, z, true);
    await sdk.waitForTicks(4).catch(() => {});
    const after = playerPos(sdk);
    if (after.x === before.x && after.z === before.z) {
        await openDoor(sdk);
        await sdk.sendWalk(x, z, true);
        await sdk.waitForTicks(4).catch(() => {});
    }
}

async function leaveBuildings(sdk: BotSDK): Promise<void> {
    const p = playerPos(sdk);
    await openDoor(sdk);
    // Catherby range house
    if (p.x >= 2814 && p.x <= 2821 && p.z >= 3440 && p.z <= 3447) {
        console.log(`[leave-range] ${p.x},${p.z}`);
        await sdk.sendWalk(2808, 3441, true);
        await sdk.waitForTicks(6).catch(() => {});
        await openDoor(sdk);
        await sdk.sendWalk(2804, 3441, true);
        await sdk.waitForTicks(4).catch(() => {});
        return;
    }
    // Falador west bank
    if (p.x >= 2942 && p.x <= 2949 && p.z >= 3366 && p.z <= 3372) {
        console.log(`[leave-bank] ${p.x},${p.z}`);
        await sdk.sendWalk(2946, 3362, true);
        await sdk.waitForTicks(6).catch(() => {});
        await openDoor(sdk);
        await sdk.sendWalk(2965, 3341, true);
        await sdk.waitForTicks(6).catch(() => {});
    }
}

async function boatFromAsgarnia(bot: BotActions, sdk: BotSDK, name: string): Promise<void> {
    let p = playerPos(sdk);
    if (p.x < 2880) return;
    console.log(`[boat] ${name} Asgarnia ${p.x},${p.z} → Port Sarim`);
    const hops: Tile[] =
        playerPos(sdk).z >= 3300
            ? [
                  { x: 2946, z: 3363 },
                  { x: 2965, z: 3340 },
                  { x: 2998, z: 3312 },
                  { x: 3015, z: 3272 },
                  { x: 3029, z: 3236 },
                  { x: 3029, z: 3217 }
              ]
            : [
                  { x: 3162, z: 3228 },
                  { x: 3105, z: 3245 },
                  { x: 3046, z: 3235 },
                  { x: 3029, z: 3217 }
              ];
    for (const wp of hops) {
        p = playerPos(sdk);
        if (p.x < 2880) return;
        if (p.x <= wp.x + 4 && distTo(sdk, wp.x, wp.z) > 80) continue;
        await walkTimed(bot, sdk, wp.x, wp.z, 25_000);
    }
    await walkTimed(bot, sdk, PORT_SARIM.x, PORT_SARIM.z, 20_000);
    const sailor = sdk.findNearbyNpc(/sailor|seaman|captain tobias/i);
    if (sailor) {
        await bot.talkTo(sailor);
        await bot.navigateDialog(['yes', 'pay', 'ardougne', 'travel', 'sail']);
        await sdk.waitForCondition((s) => (s.player?.worldX ?? 0) < 2800, 12_000).catch(() => {});
        console.log(`[boat] ${name} now ${playerPos(sdk).x},${playerPos(sdk).z}`);
    } else {
        console.warn(`[boat] ${name} no sailor @ ${playerPos(sdk).x},${playerPos(sdk).z}`);
    }
}

async function follow(bot: BotActions, sdk: BotSDK, name: string, waypoints: Tile[]): Promise<void> {
    let startIdx = 0;
    let closest = Infinity;
    for (let i = 0; i < waypoints.length; i++) {
        const d = distTo(sdk, waypoints[i].x, waypoints[i].z);
        if (d < closest) {
            closest = d;
            startIdx = i;
        }
    }
    for (let i = startIdx; i < waypoints.length; i++) {
        if (!sdk.isConnected()) return;
        if (distTo(sdk, TARGET.x, TARGET.z) <= YANILLE_RADIUS) return;
        const p = playerPos(sdk);
        if (p.x >= 2880) {
            await boatFromAsgarnia(bot, sdk, name);
            return;
        }
        const wp = waypoints[i];
        if (distTo(sdk, wp.x, wp.z) <= 5) continue;
        console.log(`[wp] ${p.x},${p.z} → ${wp.x},${wp.z}`);
        await walkTimed(bot, sdk, wp.x, wp.z);
    }
}

async function walkToYanille(name: string, bot: BotActions, sdk: BotSDK): Promise<void> {
    await bot.dismissBlockingUI();
    await closeUi(bot, sdk);
    await leaveBuildings(sdk);

    let p = playerPos(sdk);
    if (distTo(sdk, TARGET.x, TARGET.z) <= YANILLE_RADIUS) {
        console.log(`[stack] ${name} already Yanille (${p.x},${p.z})`);
        return;
    }
    console.log(`[move] ${name} ${p.x},${p.z} → Yanille`);

    if (p.x >= 2880) await boatFromAsgarnia(bot, sdk, name);

    p = playerPos(sdk);
    if (distTo(sdk, TARGET.x, TARGET.z) <= YANILLE_RADIUS) return;

    if (p.x >= 2680 && p.z >= 3350 && p.x < 2880) {
        await follow(bot, sdk, name, CATHERBY_WAYPOINTS);
    } else if (p.x < 2880) {
        await follow(bot, sdk, name, SOUTH_WAYPOINTS);
    } else {
        await boatFromAsgarnia(bot, sdk, name);
        await follow(bot, sdk, name, SOUTH_WAYPOINTS);
    }

    await walkTimed(bot, sdk, TARGET.x, TARGET.z, 25_000);
    await sdk.sendWalk(TARGET.x, TARGET.z, true);
    await sdk.waitForTicks(2).catch(() => {});
    const end = playerPos(sdk);
    console.log(`[arrive] ${name} ${end.x},${end.z}`);
}

async function serve(name: string, bot: BotActions, sdk: BotSDK): Promise<void> {
    console.log(`[trade-server] ${name} accepting trades`);
    while (sdk.isConnected()) {
        try {
            await bot.dismissBlockingUI();
            await bot.serveTrades({
                timeout: 3600_000,
                tradeTimeout: 45_000,
                onTrade: (res) => {
                    if (res.success) {
                        const rec = (res.data?.received ?? []).map((i) => `${i.name} x${i.count}`).join(', ');
                        console.log(`[trade] ${name} from ${res.partner ?? '?'} [${rec || 'none'}]`);
                    }
                }
            });
        } catch {
            if (!sdk.isConnected()) break;
            await sdk.waitForTicks(2).catch(() => {});
        }
    }
}

initPathfinding();
console.log(`=== Unstuck → Yanille: ${NAMES.join(', ')} ===`);

for (const name of NAMES) {
    const client = await createClient(name);
    if (!client) continue;
    walkToYanille(name, client.bot, client.sdk)
        .then(() => serve(name, client.bot, client.sdk))
        .catch((err) => console.warn(`[err] ${name}: ${err?.message ?? err}`));
    await Bun.sleep(300);
}

console.log('Dispatched. Yanille stack left on the existing accept loop.');
