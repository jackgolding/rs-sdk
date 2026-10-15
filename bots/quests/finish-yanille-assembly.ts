/**
 * Move all fleet bots not yet at (2613, 3094) into Yanille Bank onto JackThief's tile.
 *
 * Usage:
 *   bun bots/quests/finish-yanille-assembly.ts
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { playerPos, walkNear, closeUi, distTo } from './movement';
import { type Tile } from './tiles';

const TARGET_TILE: Tile = { x: 2613, z: 3094 };

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
    TARGET_TILE
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
            connectTimeout: 25_000,
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

async function walkSingleBot(name: string): Promise<boolean> {
    const client = await createBotClient(name);
    if (!client) return false;
    const { bot, sdk } = client;

    try {
        await bot.dismissBlockingUI();
        await closeUi(bot, sdk);

        let p = playerPos(sdk);
        if (distTo(sdk, TARGET_TILE.x, TARGET_TILE.z) <= 1.0) {
            console.log(`[done] ${name} already at Yanille (${p.x}, ${p.z})`);
            return true;
        }

        console.log(`[move] ${name} from (${p.x}, ${p.z}) -> Yanille (${TARGET_TILE.x}, ${TARGET_TILE.z})`);
        await handleNearbyDoors(sdk);

        // If in Catherby / Seers area
        if (p.x > 2700 && p.z > 3350) {
            await walkNear(bot, sdk, 2804, 3441, 3);
            for (const wp of CATHERBY_WAYPOINTS) {
                p = playerPos(sdk);
                if (distTo(sdk, wp.x, wp.z) <= 5) continue;
                await handleNearbyDoors(sdk);
                await walkNear(bot, sdk, wp.x, wp.z, 4);
            }
        }

        // If in Falador / Port Sarim
        if (p.x > 2900 && p.z > 3300) {
            await walkNear(bot, sdk, 3029, 3217, 3);
            const sailor = sdk.findNearbyNpc(/sailor|seaman|captain tobias/i);
            if (sailor) {
                await bot.talkTo(sailor);
                await bot.navigateDialog(['yes', 'pay', 'ardougne', 'travel', 'sail']);
                await sdk.waitForCondition((s) => (s.player?.worldX ?? 0) < 2800, 8000).catch(() => {});
            }
        }

        // Final walk into Yanille Bank onto exact tile
        await walkNear(bot, sdk, 2640, 3220, 5);
        await walkNear(bot, sdk, 2630, 3170, 5);
        await walkNear(bot, sdk, 2615, 3110, 4);
        await walkNear(bot, sdk, TARGET_TILE.x, TARGET_TILE.z, 0);
        await sdk.sendWalk(TARGET_TILE.x, TARGET_TILE.z, true);
        await sdk.waitForTicks(2).catch(() => {});

        const finalPos = playerPos(sdk);
        console.log(`[arrive] ${name} arrived at (${finalPos.x}, ${finalPos.z})!`);
        return true;
    } catch (err: any) {
        console.warn(`[error] ${name}: ${err?.message ?? err}`);
        return false;
    }
}

console.log('=== Step-by-Step Yanille Bank Assembler ===');
initPathfinding();

const rosterJson = JSON.parse(readFileSync(join(process.cwd(), 'bots', 'roster.json'), 'utf-8'));
const allBotNames: string[] = rosterJson.bots
    .map((b: any) => b.name)
    .filter((name: string) => name !== 'jackthief');

// Process bots in small concurrent batches of 4
const BATCH_SIZE = 4;
for (let i = 0; i < allBotNames.length; i += BATCH_SIZE) {
    const batch = allBotNames.slice(i, i + BATCH_SIZE);
    console.log(`\n--- Processing Batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.join(', ')}) ---`);
    await Promise.all(batch.map((name) => walkSingleBot(name)));
}

console.log('\n🎉 Complete! All bots processed for Yanille Bank assembly. 🎉');
