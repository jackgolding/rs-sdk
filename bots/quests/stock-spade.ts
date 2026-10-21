/**
 * stock-spade — provision ONE canary account with a spade, then bank it.
 *
 *   tools/canary.sh <acct> stock-spade.ts     (on the demo server)
 *   bun bots/quests/stock-spade.ts <botname>   (local, needs a stocked bank)
 *
 * WHY THIS EXISTS
 * Ernest the Chicken needs a spade, and nothing in this revision's shops near
 * Draynor/Lumbridge sells one: the only `.inv` stock lines are
 *   karamja.inv  stock21=spade,10,500   ([boozeshop], owned by Zambo 2925,3143)
 *   viking.inv   stock7/stock5=spade    (Rellekka, further)
 *   shilo.inv    stock14=spade          (Shilo, quest-locked)
 * so a canary that starts with an empty bank idles on
 * `INSUFFICIENT STOCK: spade(inv=0 bank=0 need=1)` — which is the script being
 * correct and the ACCOUNT being unstocked. Provisioning is not a quest bug, and
 * it does not belong inside the quest script (the fixture always supplies the
 * tool, so that path would never be exercised by the dev gate).
 *
 * Route: Draynor bank (coins) -> Port Sarim sailor -> Musa Point -> Zambo's bar
 * -> buy 1 spade -> customs officer -> back to Port Sarim -> Draynor bank ->
 * deposit. Idempotent: if the bank already holds a spade it says so and exits.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

import { BotSDK, deriveGatewayUrl } from '../../sdk/index';
import { BotActions } from '../../sdk/actions';
import { initPathfinding, findLongPath } from '../../sdk/pathfinding';

const argv = process.argv.slice(2);
const botArg = argv.find(a => !a.startsWith('-'));
const envPath = botArg ? join(process.cwd(), 'bots', botArg, 'bot.env') : join(dirname(import.meta.path), 'bot.env');
if (!existsSync(envPath)) throw new Error(`bot.env not found at ${envPath}`);
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1);
}
const username = process.env.BOT_USERNAME!;

const DRAYNOR_BANK = { x: 3092, z: 3243 };
const SAILOR = { x: 3028, z: 3216 };
const ZAMBO = { x: 2925, z: 3143 };
const CUSTOMS = { x: 2956, z: 3143 };
const SPADE = /^spade$/i;
const COINS = /^coins$/i;

initPathfinding();
const sdk = new BotSDK({
    botUsername: username,
    password: process.env.PASSWORD ?? '',
    gatewayUrl: deriveGatewayUrl(process.env.SERVER),
    autoLaunchBrowser: true,
    browserLaunchTimeout: 90_000,
    readyTimeout: 45_000,
    connectTimeout: 60_000,
    showChat: false,
});
const bot = new BotActions(sdk);
const log = (m: string) => console.log(m);

const pos = () => {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const distTo = (t: { x: number; z: number }) => Math.hypot(pos().x - t.x, pos().z - t.z);
const invCount = (re: RegExp) => sdk.getInventory().filter(i => re.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const bankCount = (re: RegExp) => (sdk.getState()?.bank?.items ?? []).filter(i => re.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
const onKaramja = () => { const p = pos(); return p.x >= 2880 && p.x <= 2980 && p.z >= 3120 && p.z <= 3200; };

/** Walk a planned route in <=10-tile hops, verifying displacement on each. */
async function travel(dest: { x: number; z: number }, what: string): Promise<boolean> {
    for (let plan = 0; plan < 8; plan++) {
        if (distTo(dest) <= 4) return true;
        const path = findLongPath(pos().level, pos().x, pos().z, dest.x, dest.z) as { x: number; z: number }[] | null;
        if (!path || !path.length) {
            // No graph route (ship decks and some crossings have none): walk AT
            // the destination and let the client close the last tiles.
            log(`no planned route to ${what} from ${pos().x},${pos().z} — walking directly`);
            await bot.walkTo(dest.x, dest.z, 4).catch(() => undefined);
            await sdk.waitForTicks(3);
            return distTo(dest) <= 8;
        }
        for (let i = 0; i < path.length; i += 10) {
            const wp = path[Math.min(i + 9, path.length - 1)]!;
            const before = pos();
            for (let attempt = 0; attempt < 3; attempt++) {
                await bot.walkTo(wp.x, wp.z, 3).catch(() => undefined);
                await sdk.waitForTicks(2);
                const after = pos();
                if (Math.hypot(after.x - before.x, after.z - before.z) >= 1 || Math.hypot(after.x - wp.x, after.z - wp.z) <= 3) break;
                await sdk.waitForTicks(3);
            }
        }
        log(`  ${what}: ${Math.round(distTo(dest))} tiles to go at ${pos().x},${pos().z}`);
    }
    return distTo(dest) <= 6;
}

/** Click through a dialog, picking the matching option, one click per page. */
async function chat(matchers: RegExp[], max = 40): Promise<void> {
    let lastClicked = '';
    for (let i = 0; i < max; i++) {
        const dialog = sdk.getDialog();
        if (!dialog?.isOpen) {
            await sdk.waitForTicks(1);
            if (!sdk.getDialog()?.isOpen) break;
            continue;
        }
        const options = dialog.options ?? [];
        const continueOnly = options.length > 0 && options.every(o => /^click here to continue$/i.test(o.text.trim()));
        const pick = matchers.map(re => options.find(o => re.test(o.text))).find(Boolean)
            ?? (continueOnly || options.length === 1 ? options[0] : undefined);
        if (!pick) { await sdk.waitForTicks(2); continue; }
        const signature = options.map(o => `${o.index}:${o.componentId ?? '?'}`).join('|');
        if (signature === lastClicked) { await sdk.waitForTicks(3); continue; }
        lastClicked = signature;
        log(`  dialog -> ${pick.text}`);
        await sdk.sendClickDialog(pick.index);
        await sdk.waitForTicks(3);
    }
    await bot.dismissBlockingUI().catch(() => undefined);
}

async function sail(toKaramja: boolean): Promise<boolean> {
    if (toKaramja === onKaramja()) return true;
    if (toKaramja) {
        await travel({ x: SAILOR.x, z: SAILOR.z - 2 }, 'Port Sarim sailor');
        const sailor = sdk.findNearbyNpc(/^(tobias|captain tobias|sailor)$/i) ?? sdk.findNearbyNpc(/tobias|sailor/i);
        if (!sailor) { log('sailor not found at Port Sarim'); return false; }
        await bot.talkTo(sailor).catch(() => undefined);
        await chat([/yes please/i, /karamja/i, /please/i]);
    } else {
        await travel({ x: CUSTOMS.x, z: CUSTOMS.z - 2 }, 'customs officer');
        const officer = sdk.findNearbyNpc(/customs/i);
        if (!officer) { log('customs officer not found'); return false; }
        await bot.talkTo(officer).catch(() => undefined);
        await chat([/journey on this ship/i, /can i journey/i, /^ok\.?$/i, /yes/i]);
    }
    await sdk.waitForCondition(() => (toKaramja ? onKaramja() : !onKaramja()), 30_000).catch(() => undefined);
    log(`  sailed: now ${pos().x},${pos().z} (karamja=${onKaramja()})`);
    return toKaramja === onKaramja();
}

await sdk.connect();
await sdk.waitForCondition(s => !!s.player, 60_000).catch(() => {});
log(`stock-spade ${username} @ ${pos().x},${pos().z} l${pos().level}`);

// 1. bank at Draynor: if a spade is already banked, nothing to do
await travel(DRAYNOR_BANK, 'Draynor bank');
if (!(await bot.openBank()).success) {
    await bot.closeInterface().catch(() => undefined);
    await bot.walkTo(DRAYNOR_BANK.x - 1, DRAYNOR_BANK.z, 1).catch(() => undefined);
    await bot.openBank().catch(() => undefined);
}
await sdk.waitForTicks(3);
if (bankCount(SPADE) > 0) {
    log(`bank already holds ${bankCount(SPADE)} spade(s) — nothing to do`);
    await bot.closeInterface();
    await sdk.disconnect();
    process.exit(0);
}
// coins for the purchase (500gp; carry 1k to be safe)
const carried = invCount(COINS);
if (carried < 1000) {
    const withdrew = await bot.withdrawItem(COINS, 1000 - carried).catch(() => ({ success: false } as any));
    log(`coins withdraw: success=${withdrew?.success ?? false} now ${invCount(COINS)}`);
    await sdk.waitForTicks(3);
}
await bot.closeInterface();

// 2. sail to Musa Point and buy from Zambo
if (!(await sail(true))) throw new Error('could not reach Karamja');
await travel({ x: ZAMBO.x, z: ZAMBO.z + 2 }, 'Zambo');
const opened = await bot.openShop(/zambo/i);
log(`openShop(zambo): success=${opened.success}${opened.success ? '' : ` (${opened.message ?? '?'})`}`);
if (!opened.success && !sdk.getState()?.shop?.isOpen) throw new Error('Zambo shop did not open');
const bought = await bot.buyFromShop(SPADE, 1);
log(`buy spade: success=${bought.success} bought=${bought.amountBought} ${bought.message ?? ''}`);
await bot.closeInterface().catch(() => undefined);
await sdk.waitForTicks(3);
if (invCount(SPADE) === 0) throw new Error('spade not in the inventory after buying from Zambo');

// 3. back to Draynor and bank it
if (!(await sail(false))) throw new Error('could not sail back to Port Sarim');
await travel(DRAYNOR_BANK, 'Draynor bank');
if (!(await bot.openBank()).success) {
    await bot.closeInterface().catch(() => undefined);
    await bot.walkTo(DRAYNOR_BANK.x - 1, DRAYNOR_BANK.z, 1).catch(() => undefined);
    await bot.openBank().catch(() => undefined);
}
const spade = sdk.getInventory().find(i => SPADE.test(i.name));
if (spade) {
    const dep = await bot.depositItem(spade, -1).catch(() => ({ success: false } as any));
    log(`deposit spade: success=${dep?.success ?? false}`);
}
await sdk.waitForTicks(3);
const finalBank = (sdk.getState()?.bank?.items ?? []).filter(i => SPADE.test(i.name)).reduce((n, i) => n + (i.count ?? 0), 0);
log(`DONE stock-spade: bank=${finalBank} inv=${invCount(SPADE)} @ ${pos().x},${pos().z}`);
await sdk.disconnect();
process.exit(finalBank > 0 || invCount(SPADE) > 0 ? 0 : 1);
