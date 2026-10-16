#!/usr/bin/env bun
/** Live wield probe (OFFLINE ONLY). Attaches as controller to an idle lite
 *  session and diagnoses why dragon-longsword wielding no-ops.
 *  Run AFTER stopping that bot's quest script (one-controller rule).
 *  Usage: bun tools/jev-dragons/wield-probe.ts jacklove2
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';

const botArg = process.argv[2];
if (!botArg) { console.error('usage: wield-probe.ts <botname>'); process.exit(1); }
const envPath = join(process.cwd(), 'bots', botArg, 'bot.env');
if (!existsSync(envPath)) throw new Error(`missing ${envPath}`);
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}
const sdk = new BotSDK({
    botUsername: process.env.BOT_USERNAME!, password: process.env.PASSWORD!,
    gatewayUrl: process.env.GATEWAY_URL || deriveGatewayUrl(process.env.SERVER || undefined),
    connectionMode: 'control', autoLaunchBrowser: false, autoReconnect: false, showChat: false,
});
await sdk.connect();
await sdk.waitForCondition((s: any) => s.inGame && !!s.player, 60_000);
const bot = new BotActions(sdk);
const inv = () => sdk.getInventory().filter((i: any) => (i.count ?? 0) > 0)
    .map((i: any) => `slot${i.slot} x${i.count} [${i.id}] ${i.name} opts=${(i.optionsWithIndex ?? []).map((o: any) => `${o.opIndex}:${o.text}`).join('|')}`);
const eqp = () => sdk.getEquipment().filter((i: any) => (i.count ?? 0) > 0).map((i: any) => `[${i.id}] ${i.name}`);
console.log('--- INVENTORY ---'); console.log(inv().join('\n') || '(empty)');
console.log('--- WORN ---'); console.log(eqp().join('\n') || '(naked)');
const sword = sdk.getInventory().find((i: any) => /^dragon longsword$/i.test(i.name) && (i.count ?? 0) > 0);
if (!sword) { console.log('PROBE: no dragon longsword in bag. Bank has it? (check via open bank manually)'); await sdk.disconnect(); process.exit(0); }
console.log(`PROBE: wielding slot${sword.slot}...`);
const r: any = await (bot as any).equipItem(sword);
console.log('equipItem result:', JSON.stringify(r));
await new Promise(rr => setTimeout(rr, 6000));
console.log('--- WORN AFTER ---'); console.log(eqp().join('\n') || '(naked)');
console.log('--- BAG AFTER ---'); console.log(inv().join('\n') || '(empty)');
await sdk.disconnect();
process.exit(0);
