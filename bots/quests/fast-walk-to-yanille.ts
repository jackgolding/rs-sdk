/**
 * Direct hop-walker to send ALL bots not in Yanille Bank straight to (2613, 3094).
 * Uses fast tick-paced `sdk.sendWalk` path stepping rather than blocking walkTo.
 *
 * Usage:
 *   bun bots/quests/fast-walk-to-yanille.ts
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding, findLongPath } from '../../sdk/pathfinding';
import { playerPos, closeUi, distTo } from './movement';
import { type Tile } from './tiles';

const TARGET_TILE: Tile = { x: 2613, z: 3094 }; // Yanille Bank stack

const CORRIDOR_WAYPOINTS: Tile[] = [
    { x: 2804, z: 3441 }, // Catherby street
    { x: 2758, z: 3477 }, // Road to Seers
    { x: 2726, z: 3485 }, // Seers Bank
    { x: 2695, z: 3375 }, // Road south of Seers
    { x: 2662, z: 3336 }, // Road north of Ardy
    { x: 2655, z: 3283 }, // Ardougne Bank
    { x: 2640, z: 3220 }, // South of Ardougne
    { x: 2630, z: 3170 }, // South road
    { x: 2615, z: 3110 }, // Yanille North gate / road
    TARGET_TILE           // Yanille Bank inside
];

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

async function createBotClient(name: string): Promise<{ name: string; sdk: BotSDK; bot: BotActions } | null> {
    try {
        const creds = loadBotCredentials(name);
        const sdk = new BotSDK({
            botUsername: creds.username,
            password: creds.password,
            server: creds.server,
            gatewayUrl: deriveGatewayUrl(creds.server),
            autoLaunchBrowser: false,
            connectTimeout: 20_000,
            readyTimeout: 15_000,
            showChat: false
        });
        await sdk.connect();
        const bot = new BotActions(sdk);
        return { name, sdk, bot };
    } catch (err: any) {
        console.warn(`[connect] Could not connect ${name}: ${err?.message ?? err}`);
        return null;
    }
}

async function handleNearbyDoors(sdk: BotSDK): Promise<void> {
    const closedDoor = (sdk.getNearbyLocs() ?? []).find(
        (l) => /door|gate/i.test(l.name) && (l.distance ?? 99) <= 2 && l.optionsWithIndex?.some((o) => /^open$/i.test(o.text))
    );
    if (closedDoor) {
        const openOpt = closedDoor.optionsWithIndex?.find((o) => /^open$/i.test(o.text));
        if (openOpt) {
            await sdk.sendInteractLoc(closedDoor.x, closedDoor.z, closedDoor.id, openOpt.opIndex);
            await sdk.waitForTicks(2).catch(() => {});
        }
    }
}

async function fastHopPath(sdk: BotSDK, target: Tile): Promise<void> {
    let p = playerPos(sdk);
    if (distTo(sdk, target.x, target.z) <= 1) return;

    const path = findLongPath(0, p.x, p.z, target.x, target.z);
    if (!path || path.length <= 1) {
        await sdk.sendWalk(target.x, target.z, true);
        await sdk.waitForTicks(2).catch(() => {});
        return;
    }

    // Step through the path in hops of ~8-12 tiles
    for (let i = 0; i < path.length; i += 10) {
        if (!sdk.isConnected()) return;
        const step = path[Math.min(i + 10, path.length - 1)];
        await handleNearbyDoors(sdk);
        await sdk.sendWalk(step.x, step.z, true);

        // Wait until within 3 tiles of this hop
        for (let t = 0; t < 12; t++) {
            if (distTo(sdk, step.x, step.z) <= 3) break;
            await sdk.waitForTicks(1).catch(() => {});
        }
    }
}

async function fastNavigateBot(name: string): Promise<void> {
    const client = await createBotClient(name);
    if (!client) return;
    const { bot, sdk } = client;

    try {
        await bot.dismissBlockingUI();
        await closeUi(bot, sdk);

        let p = playerPos(sdk);
        if (distTo(sdk, TARGET_TILE.x, TARGET_TILE.z) <= 1) {
            console.log(`[ready] ${name} is already at Yanille Bank!`);
            await sdk.disconnect();
            return;
        }

        console.log(`[fast-walk] ${name} starting sprint from (${p.x}, ${p.z}) -> Yanille (${TARGET_TILE.x}, ${TARGET_TILE.z})...`);
        await handleNearbyDoors(sdk);

        // Find nearest waypoint ahead in the corridor
        let startIdx = 0;
        let closestDist = Infinity;
        for (let i = 0; i < CORRIDOR_WAYPOINTS.length; i++) {
            const wp = CORRIDOR_WAYPOINTS[i];
            const d = distTo(sdk, wp.x, wp.z);
            if (d < closestDist) {
                closestDist = d;
                startIdx = i;
            }
        }

        // Advance through all remaining waypoints to Yanille
        for (let i = startIdx; i < CORRIDOR_WAYPOINTS.length; i++) {
            if (!sdk.isConnected()) return;
            const wp = CORRIDOR_WAYPOINTS[i];
            await fastHopPath(sdk, wp);
        }

        // Final step onto exact tile
        await handleNearbyDoors(sdk);
        await sdk.sendWalk(TARGET_TILE.x, TARGET_TILE.z, true);
        await sdk.waitForTicks(3).catch(() => {});

        const finalPos = playerPos(sdk);
        console.log(`[arrived] ${name} arrived at (${finalPos.x}, ${finalPos.z})!`);
        await sdk.disconnect();
    } catch (err: any) {
        console.warn(`[err] ${name}: ${err?.message ?? err}`);
        await sdk.disconnect().catch(() => {});
    }
}

console.log('=== Fast Sprint Walker to Yanille Bank ===');
initPathfinding();

const rosterJson = JSON.parse(readFileSync(join(process.cwd(), 'bots', 'roster.json'), 'utf-8'));
const allBotNames: string[] = rosterJson.bots
    .map((b: any) => b.name)
    .filter((name: string) => name !== 'jackthief');

// Check world state of each bot and dispatch movers
const BATCH_SIZE = 6;
for (let i = 0; i < allBotNames.length; i += BATCH_SIZE) {
    const batch = allBotNames.slice(i, i + BATCH_SIZE);
    console.log(`\n--- Sprint Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.join(', ')} ---`);
    await Promise.all(batch.map((n) => fastNavigateBot(n)));
}

console.log('\n🎉 Fast Sprint Complete! All bots moved to Yanille Bank. 🎉');
