import { BotSDK, deriveGatewayUrl } from './sdk/index';
import { readFileSync } from 'fs';
const envPath = '/Users/jackgolding/rs-sdk/bots/Jackpoo3/bot.env';
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}
const sdk = new BotSDK({ botUsername: process.env.BOT_USERNAME!, password: process.env.PASSWORD!, gatewayUrl: deriveGatewayUrl(process.env.SERVER), autoLaunchBrowser: false, connectTimeout: 60000, readyTimeout: 45000, showChat: false, autoReconnect: false });
await sdk.connect();
await sdk.waitForTicks(8).catch(() => {});
const p: any = sdk.getState()?.player;
console.log(`POS ${p?.worldX},${p?.worldZ} hp=${p?.hp}/${p?.maxHp} dead=${p?.isDead} combatTarget=${(p as any)?.combatTarget ?? (p as any)?.attacker ?? 'n/a'}`);
console.log(`INV: ${sdk.getInventory().map((i: any) => `${i.name}x${i.count}`).join(', ')}`);
await sdk.scanNearbyLocs(15).catch(() => {});
console.log('NPCS:', (sdk.getNearbyNpcs() ?? []).map((n: any) => `${n.name}@${n.x},${n.z}`).join(' | ') || '(none)');
console.log('WEBS:', (sdk.getNearbyLocs() ?? []).filter((l: any) => /web/i.test(l.name)).map((l: any) => `${l.name} id=${l.id} @${l.x},${l.z} reach=${l.reachable} opts=${l.optionsWithIndex?.map((o: any) => o.text).join('/')}`).join(' | ') || '(none)');
await sdk.disconnect().catch(() => {});
process.exit(0);
