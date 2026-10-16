import { BotSDK, deriveGatewayUrl } from './sdk/index';
import { readFileSync } from 'fs';

const envPath = '/Users/jackgolding/rs-sdk/bots/Jackpoo3/bot.env';
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}
const sdk = new BotSDK({
  botUsername: process.env.BOT_USERNAME!,
  password: process.env.PASSWORD!,
  gatewayUrl: deriveGatewayUrl(process.env.SERVER),
  autoLaunchBrowser: false,
  connectTimeout: 60000,
  readyTimeout: 45000,
  showChat: false,
  autoReconnect: false,
});
await sdk.connect();
await sdk.waitForTicks(8).catch(() => {});
const p: any = sdk.getState()?.player;
console.log(`POS worldX=${p?.worldX} worldZ=${p?.worldZ} L=${p?.level}`);
await sdk.scanNearbyLocs(25).catch(() => {});
const locs = sdk.getNearbyLocs() ?? [];
console.log(`LOCS total=${locs.length}`);
for (const l of locs.filter((l: any) => /web|ladder|fence|gate/i.test(l.name))) {
  console.log(
    ` - ${l.name} id=${l.id} @${l.x},${l.z} reach=${l.reachable} opts=${l.optionsWithIndex?.map((o: any) => o.text).join('/')}`
  );
}
await sdk.disconnect().catch(() => {});
process.exit(0);
