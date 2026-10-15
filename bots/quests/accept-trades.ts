/**
 * Multi-Bot Trade Server: Listens on all fleet bots and automatically accepts
 * any trades offered by JackThief (all windows).
 *
 * Usage:
 *   bun bots/quests/accept-trades.ts [traderName]
 *   e.g. bun bots/quests/accept-trades.ts jackthief
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';

const targetTrader = (process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'jackthief').toLowerCase();
const TRADER_REGEX = new RegExp(targetTrader, 'i');

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

async function runTradeServerForBot(client: BotClient): Promise<void> {
    const { bot, sdk, name } = client;
    console.log(`[trade-server] ${name} listening for trade requests from ${targetTrader}...`);

    while (sdk.isConnected()) {
        try {
            await bot.dismissBlockingUI();
            
            // Serve trades from target trader
            await bot.serveTrades({
                from: TRADER_REGEX,
                timeout: 3600_000, // 1 hour per serving session
                tradeTimeout: 45_000,
                onTrade: (res) => {
                    if (res.success) {
                        const rec = (res.data?.received ?? []).map((i) => `${i.name} x${i.count}`).join(', ');
                        console.log(`[trade-success] ${name} completed trade with ${res.partner ?? targetTrader}! Received: [${rec || 'nothing'}]`);
                    } else {
                        console.log(`[trade-ended] ${name} trade session ended: ${res.message}`);
                    }
                }
            });
        } catch (err: any) {
            if (!sdk.isConnected()) break;
            await sdk.waitForTicks(2).catch(() => {});
        }
    }
}

console.log(`=== Multi-Bot Trade Receiver Active (Listening for: ${targetTrader}) ===`);
initPathfinding();

const rosterJson = JSON.parse(readFileSync(join(process.cwd(), 'bots', 'roster.json'), 'utf-8'));
const fleetBotNames: string[] = rosterJson.bots
    .map((b: any) => b.name)
    .filter((name: string) => name.toLowerCase() !== targetTrader);

console.log(`Connecting ${fleetBotNames.length} receiver bots...`);

const BATCH_SIZE = 8;
const activeClients: BotClient[] = [];

for (let i = 0; i < fleetBotNames.length; i += BATCH_SIZE) {
    const batch = fleetBotNames.slice(i, i + BATCH_SIZE);
    const clients = await Promise.all(batch.map((name) => createBotClient(name)));
    const valid = clients.filter((c): c is BotClient => c !== null);
    activeClients.push(...valid);

    // Launch trade server loop for each connected client
    valid.forEach((client) => {
        runTradeServerForBot(client).catch(console.error);
    });

    await new Promise((r) => setTimeout(r, 400));
}

console.log(`\n🎉 Ready! ${activeClients.length} bots are now live and waiting to auto-accept any trades from ${targetTrader}.`);
