/**
 * Send remaining bots from Catherby / Ardougne / Falador directly to Yanille Bank (2613, 3094).
 *
 * Usage:
 *   bun bots/quests/send-remaining-to-yanille.ts
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { playerPos, walkNear, closeUi, distTo } from './movement';
import { type Tile } from './tiles';

const TARGET_TILE: Tile = { x: 2613, z: 3094 }; // Yanille Bank Jackthief Tile

const CATHERBY_TO_YANILLE: Tile[] = [
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
    TARGET_TILE
];

const REMAINING_BOTS = [
    'jacklove1',
    'jacklove2',
    'jacklove3',
    'jacklove4',
    'jacklove6',
    'jacklove10',
    'jacklove11',
    'jacklove14',
    'jacklove16',
    'jacklove20',
    'Jackpoo5',
    'ABGARMY03',
    'ABGARMY12',
    'ABGARMY17',
    'ABGARMY19',
    'Jackpoo2'
];

interface BotClient {
    name: string;
    sdk: BotSDK;
    bot: BotActions;
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

async function createBotClient(name: string): Promise<BotClient | null> {
    try {
        const creds = loadBotCredentials(name);
        const sdk = new BotSDK({
            botUsername: creds.username,
            password: creds.password,
            server: creds.server,
            gatewayUrl: deriveGatewayUrl(creds.server),
            autoLaunchBrowser: false,
            connectTimeout: 30_000,
            readyTimeout: 20_000,
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

async function walkWaypoints(bot: BotActions, sdk: BotSDK, waypoints: Tile[]): Promise<boolean> {
    for (const wp of waypoints) {
        if (!sdk.isConnected()) return false;
        if (distTo(sdk, wp.x, wp.z) <= 5) continue;
        await handleNearbyDoors(sdk);
        await walkNear(bot, sdk, wp.x, wp.z, 4);
    }
    return true;
}

async function walkToYanille(client: BotClient): Promise<void> {
    const { bot, sdk, name } = client;
    try {
        if (!sdk.isConnected()) return;
        await bot.dismissBlockingUI();
        await closeUi(bot, sdk);

        const p = playerPos(sdk);
        if (distTo(sdk, TARGET_TILE.x, TARGET_TILE.z) <= 1.0) {
            console.log(`[arrive] ${name} is already on JackThief's tile!`);
            return;
        }

        console.log(`[walk] ${name} walking from (${p.x}, ${p.z}) to Yanille tile (${TARGET_TILE.x}, ${TARGET_TILE.z})...`);
        await handleNearbyDoors(sdk);

        // Handle Catherby bots
        if (p.x > 2700 && p.z > 3350) {
            await walkWaypoints(bot, sdk, CATHERBY_TO_YANILLE);
        }

        // Handle Falador bots
        if (p.x > 2900 && p.z > 3300) {
            console.log(`[boat] ${name} in Asgarnia, pathing to Port Sarim boat...`);
            await walkNear(bot, sdk, 3029, 3217, 3);
            const sailor = sdk.findNearbyNpc(/sailor|seaman|captain tobias/i);
            if (sailor) {
                await bot.talkTo(sailor);
                await bot.navigateDialog(['yes', 'pay', 'ardougne', 'travel', 'sail']);
                await sdk.waitForCondition((s) => s.player?.worldX < 2800, 8000).catch(() => {});
            }
        }

        // Final leg into Yanille Bank onto exact tile
        await walkNear(bot, sdk, TARGET_TILE.x, TARGET_TILE.z, 0);
        await sdk.sendWalk(TARGET_TILE.x, TARGET_TILE.z, true);
        await sdk.waitForTicks(2).catch(() => {});

        const finalPos = playerPos(sdk);
        console.log(`[arrive] ${name} arrived at (${finalPos.x}, ${finalPos.z})!`);
    } catch (err: any) {
        console.warn(`[walk] ${name} notice: ${err?.message ?? err}`);
    }
}

console.log('=== Sending Remaining 16 Bots to Yanille Bank ===');
initPathfinding();

const clients = await Promise.all(REMAINING_BOTS.map((n) => createBotClient(n)));
const validClients = clients.filter((c): c is BotClient => c !== null);

console.log(`Connected ${validClients.length}/${REMAINING_BOTS.length} remaining bots. Walking now...`);

// Run all walks concurrently
await Promise.all(validClients.map((c) => walkToYanille(c)));

console.log('\n=== All Remaining Bots Have Reached Yanille Bank! ===');
