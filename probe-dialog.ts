import { BotSDK, deriveGatewayUrl } from './sdk/index';
import { readFileSync } from 'fs';

const envPath = '/Users/jackgolding/rs-sdk/bots/Jackpoo5/bot.env';
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
  autoLaunchBrowser: false, connectTimeout: 60000, readyTimeout: 45000,
  showChat: false, autoReconnect: false,
});
await sdk.connect();
await sdk.waitForTicks(5).catch(() => {});
await sdk.scanNearbyLocs(12).catch(() => {});
const gundai: any = sdk.getNearbyNpcs().find((n: any) => /gundai/i.test(n.name));
console.log('GUNDAI:', gundai ? `@${gundai.x},${gundai.z} opts=${gundai.optionsWithIndex?.map((o: any) => o.text).join('/')}` : 'NOT SEEN');
if (gundai) {
  const talk = gundai.optionsWithIndex.find((o: any) => /talk/i.test(o.text));
  await sdk.sendInteractNpc(gundai.index, talk?.opIndex ?? 1, { route: false });
  for (let i = 0; i < 6; i++) {
    await sdk.waitForTicks(2).catch(() => {});
    const d: any = sdk.getDialog();
    if (d?.isOpen) {
      console.log(`DIALOG t+${i}: waiting=${d.isWaiting} npc=${d.npcName ?? ''} text=${JSON.stringify((d.text ?? '').slice(0, 160))}`);
      console.log(`OPTIONS: ${(d.options ?? []).map((o: any) => `[${o.index}] ${o.text}`).join(' | ')}`);
      break;
    }
    if (i === 5) console.log('DIALOG: never opened');
  }
  console.log('BANK OPEN:', !!sdk.getState()?.bank?.isOpen);
}
await sdk.disconnect().catch(() => {});
process.exit(0);
