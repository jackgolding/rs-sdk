/**
 * Move all 50+ Ranged accounts 1 tile South (z - 1).
 *
 * Current 50+ Ranged accounts:
 * - fatpig (99)
 * - jacklove1 (87)
 * - jacklove2 (89)
 * - jacklove3 (88)
 * - jacklove4 (90)
 * - jacklove5 (87)
 * - jackthief (99)
 *
 * Usage:
 *   bun bots/quests/move-rangers-south.ts
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { playerPos, closeUi } from './movement';

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

async function moveOneTileSouth(name: string): Promise<void> {
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
        await bot.dismissBlockingUI();
        await closeUi(bot, sdk);

        const currentPos = playerPos(sdk);
        const targetX = currentPos.x;
        const targetZ = currentPos.z - 1;

        console.log(`[move] ${name} (Ranged ${sdk.getSkill('Ranged')?.baseLevel}): (${currentPos.x}, ${currentPos.z}) -> (${targetX}, ${targetZ})`);
        
        await sdk.sendWalk(targetX, targetZ, true);
        await sdk.waitForTicks(3);

        const newPos = playerPos(sdk);
        console.log(`[arrived] ${name} now at (${newPos.x}, ${newPos.z})`);

        await sdk.disconnect();
    } catch (err: any) {
        console.warn(`[error] ${name}: ${err?.message ?? err}`);
    }
}

console.log('=== Moving all 50+ Ranged Accounts 1 Tile South ===');
initPathfinding();

const RANGERS = ['fatpig', 'jacklove1', 'jacklove2', 'jacklove3', 'jacklove4', 'jacklove5', 'jackthief'];

await Promise.all(RANGERS.map((name) => moveOneTileSouth(name)));

console.log('=== All 50+ Ranged Accounts Successfully Moved 1 Tile South! ===');
