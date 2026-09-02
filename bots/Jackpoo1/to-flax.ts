/**
 * Travel-only wrapper around {@link travelToSeersFlax}.
 * Overnight flax grinding is `bun bots/Jackpoo1/bowstrings.ts` (travel then grind).
 *
 *   bun bots/Jackpoo1/to-flax.ts
 */
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { readFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';
import { travelToSeersFlax } from './travel-to-flax';

function loadBotEnv(): void {
    const envPath = join(dirname(import.meta.path), 'bot.env');
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
}

loadBotEnv();

const username = process.env.BOT_USERNAME!;
const password = process.env.PASSWORD!;
const server = process.env.SERVER;
const GRIND_LOG = join(dirname(import.meta.path), 'grind.log');

function log(msg: string): void {
    console.log(msg);
    try {
        appendFileSync(GRIND_LOG, `${new Date().toISOString()} LOG ${msg}\n`);
    } catch {
        /* ignore */
    }
}

console.log('Warming pathfinder...');
initPathfinding();

const sdk = new BotSDK({
    botUsername: username,
    password,
    gatewayUrl: deriveGatewayUrl(server),
    autoLaunchBrowser: true,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false
});

console.log('Opening/attaching the game client...');
await sdk.connect();
const bot = new BotActions(sdk);

try {
    const result = await travelToSeersFlax({ sdk, bot, log });
    log(`to-flax ${result}`);
    if (result !== 'arrived') process.exitCode = 1;
} catch (err) {
    console.error('Script error:', err);
    throw err;
}

console.log('Travel finished; leaving the browser client attached for bowstrings.');
