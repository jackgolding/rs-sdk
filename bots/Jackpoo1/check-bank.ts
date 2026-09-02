import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding } from '../../sdk/pathfinding';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';

const SEERS_BANK = { x: 2726, z: 3485 };

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
initPathfinding();

const sdk = new BotSDK({
    botUsername: process.env.BOT_USERNAME!,
    password: process.env.PASSWORD!,
    gatewayUrl: deriveGatewayUrl(process.env.SERVER),
    autoLaunchBrowser: true,
    connectTimeout: 60_000,
    showChat: false
});

await sdk.connect();
const bot = new BotActions(sdk);
await bot.skipTutorial();
await bot.walkTo(SEERS_BANK.x, SEERS_BANK.z, 2);

const open = await bot.openBank();
console.log('openBank:', open.success, open.message);
await sdk.waitForCondition((s) => s.bank?.isOpen === true, 5_000).catch(() => {});
const st = sdk.getState();
console.log('bank.isOpen:', st?.bank?.isOpen, 'interface:', st?.interface?.isOpen);

const items = sdk.getBankItems();
const summary = new Map<string, number>();
for (const item of items) {
    summary.set(item.name, (summary.get(item.name) ?? 0) + item.count);
}

const interesting = [...summary.entries()]
    .filter(([name]) => /knife|log|bow|bowstring|magic/i.test(name))
    .sort((a, b) => a[0].localeCompare(b[0]));

console.log('Relevant bank items:');
for (const [name, count] of interesting) console.log(`  ${name}: ${count}`);
console.log(`Total bank slots used: ${items.length}`);

await bot.closeBank();
await sdk.disconnect();
