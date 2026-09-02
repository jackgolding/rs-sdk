/**
 * Note tuna/swordfish at Catherby, walk to Ardougne south bank, trade them.
 *
 *   bun bots/quests/mule-ardy-food.ts jacklove1 give fatpig
 *   bun bots/quests/mule-ardy-food.ts jacklove2 give Jackpoo3
 *   bun bots/quests/mule-ardy-food.ts fatpig take jacklove1
 *   bun bots/quests/mule-ardy-food.ts Jackpoo3 take jacklove2
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';

const FOOD = /^(tuna|swordfish)$/i;
const FOOD_NAMES = ['tuna', 'swordfish'];
const CATHERBY_BANK = { x: 2808, z: 3443 };
const ARDY_BANK = { x: 2655, z: 3283 };
const RANGING_GUILD_DOOR = { x: 2658, z: 3439 };
const CATHERBY_TO_ARDY = [
    { x: 2808, z: 3443 },
    { x: 2788, z: 3460 },
    { x: 2758, z: 3477 },
    { x: 2726, z: 3485 },
    { x: 2695, z: 3375 },
    { x: 2662, z: 3375 },
    { x: 2662, z: 3336 },
    { x: 2662, z: 3312 },
    { x: 2655, z: 3283 }
];

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const botName = args[0] ?? '';
const role = (args[1] ?? '').toLowerCase();
const partner = args[2] ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

if (role !== 'give' && role !== 'take') {
    throw new Error('Usage: bun bots/quests/mule-ardy-food.ts <bot> give|take <partner>');
}
if (!botName || !partner) {
    throw new Error('Need bot name and partner');
}

await runScript(async ({ bot, sdk }) => {
    const log = (msg: string) => {
        console.log(msg);
        try {
            appendFileSync(GRIND_LOG, `${new Date().toISOString()} ${msg}\n`);
        } catch {
            /* ignore */
        }
    };
    const pos = () => {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0 };
    };
    const distTo = (x: number, z: number) => Math.hypot(pos().x - x, pos().z - z);
    const count = (pattern: RegExp) =>
        sdk.getInventory().filter((i) => pattern.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    const invFood = () =>
        FOOD_NAMES
            .map((name) => ({ name, count: count(new RegExp(`^${name}$`, 'i')) }))
            .filter((s) => s.count > 0);
    const foodGive = () =>
        invFood().map(({ name, count: n }) => ({
            item: new RegExp(`^${name}$`, 'i'),
            amount: n
        }));
    const foodSummary = () =>
        invFood().map((s) => `${s.count} ${s.name}`).join(', ') || 'none';

    async function closeUi() {
        if (sdk.getTradeState().isOpen) await bot.declineTrade().catch(() => {});
        const dialog = sdk.getDialog();
        if (dialog?.isOpen) {
            const cont = dialog.options?.find((o) => /continue|click here/i.test(o.text));
            if (cont) await sdk.sendClickDialog(cont.index);
            else await sdk.sendClickDialog(0);
            await sdk.waitForTicks(1);
        }
        await bot.dismissBlockingUI();
        if (sdk.getState()?.shop?.isOpen || sdk.getState()?.bank?.isOpen || sdk.getState()?.interface?.isOpen) {
            await bot.closeInterface();
        }
    }

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function walkWaypoints(wps: { x: number; z: number }[]): Promise<void> {
        const dest = wps[wps.length - 1]!;
        for (const wp of wps) {
            if (distTo(dest.x, dest.z) <= 8) return;
            const remaining = distTo(dest.x, dest.z);
            const via = Math.hypot(wp.x - dest.x, wp.z - dest.z);
            if (via >= remaining - 6) continue;
            await walkNear(wp.x, wp.z, 8);
        }
        if (distTo(dest.x, dest.z) > 6) await walkNear(dest.x, dest.z, 6);
    }

    function inRangingGuild(): boolean {
        const p = pos();
        return p.x >= 2655 && p.x <= 2685 && p.z >= 3410 && p.z <= 3445;
    }

    async function leaveRangingGuild(): Promise<void> {
        if (!inRangingGuild() && !(pos().x > 2656 && pos().z >= 3405 && pos().x < 2690)) {
            return;
        }
        log(`Leaving ranging guild @ ${pos().x},${pos().z}`);
        for (let i = 0; i < 8 && pos().x > 2656; i++) {
            const closed =
                sdk.findNearbyLoc(/^guild door$/i, { withOption: /open/i }) ??
                sdk.findNearbyLoc(/^door$/i, { withOption: /open/i });
            if (closed) {
                log(`Opening ${closed.name} @ ${closed.worldX},${closed.worldZ}`);
                await bot.openDoor(closed);
                await sdk.waitForTicks(2);
            }
            await walkNear(2673, 3434, 6);
            await walkNear(RANGING_GUILD_DOOR.x + 2, RANGING_GUILD_DOOR.z - 2, 2);
            const guildDoor =
                sdk.findNearbyLoc(/^guild door$/i) ??
                sdk.findNearbyLoc(/^door$/i, { withOption: /open/i });
            if (guildDoor) await bot.openDoor(guildDoor);
            await walkNear(2654, 3438, 3);
            log(`Guild exit attempt ${i + 1} @ ${pos().x},${pos().z}`);
        }
        log(`Left ranging guild @ ${pos().x},${pos().z}`);
    }

    async function openCatherbyBank(): Promise<boolean> {
        if (sdk.getState()?.bank?.isOpen) return true;
        await walkNear(CATHERBY_BANK.x, CATHERBY_BANK.z, 3);
        const r = await bot.openBank();
        if (r.success || sdk.getState()?.bank?.isOpen) return true;
        log(`openBank failed: ${r.message}`);
        return false;
    }

    async function depositAll(): Promise<void> {
        for (let i = 0; i < 40; i++) {
            const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0);
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            if (!r.success && !r.partial) {
                log(`Deposit ${item.name} failed: ${r.message}`);
                break;
            }
        }
    }

    async function noteBankFood(): Promise<number> {
        await closeUi();
        if (!(await openCatherbyBank())) return count(FOOD);
        await depositAll();
        for (const name of FOOD_NAMES) {
            const re = new RegExp(`^${name}$`, 'i');
            const inBank = sdk.findBankItem(re)?.count ?? 0;
            if (inBank <= 0) continue;
            const r = await bot.withdrawItem(re, -1, { asNote: true });
            log(`Noted ${name} x${inBank} ${r.success ? 'ok' : r.message}`);
        }
        await bot.closeBank();
        log(`Packed notes ${foodSummary()} @ ${pos().x},${pos().z}`);
        return count(FOOD);
    }

    await closeUi();
    log(`Ardy mule ${role} → ${partner} start @ ${pos().x},${pos().z} food=${foodSummary()}`);
    await leaveRangingGuild();

    if (role === 'give') {
        const packed = await noteBankFood();
        if (packed <= 0) {
            log('No cooked tuna/swordfish to mule');
            return;
        }
        log(`Walking to Ardougne bank`);
        await walkWaypoints(CATHERBY_TO_ARDY);
        await walkNear(ARDY_BANK.x, ARDY_BANK.z, 4);
        const deadline = Date.now() + 8 * 60_000;
        while (Date.now() < deadline && count(FOOD) > 0) {
            await closeUi();
            const give = foodGive();
            if (give.length === 0) break;
            if (!sdk.findNearbyPlayer(new RegExp(`^${partner}$`, 'i'))) {
                log(`${partner} not visible — waiting at Ardy bank`);
                await walkNear(ARDY_BANK.x, ARDY_BANK.z, 4);
                await sdk.waitForTicks(4);
                continue;
            }
            const result = await bot.trade(partner, {
                give,
                requestTimeout: 25_000,
                timeout: 45_000,
                retryOnBusy: true
            });
            log(
                `Trade ${partner} ${result.success ? 'ok' : result.reason} ${result.message} | leftover ${foodSummary()}`
            );
            if (result.success && count(FOOD) === 0) break;
            await sdk.waitForTicks(2);
        }
        log(`Give done leftover ${foodSummary()}`);
        return;
    }

    log(`Walking to Ardougne bank to take from ${partner}`);
    if (pos().x <= 2656 && pos().z >= 3420) {
        await walkNear(2662, 3375, 8);
    }
    await walkWaypoints(CATHERBY_TO_ARDY);
    await walkNear(ARDY_BANK.x, ARDY_BANK.z, 4);
    if (sdk.getTradeState().isOpen) await bot.declineTrade().catch(() => {});
    const served = await bot.serveTrades({
        from: new RegExp(`^${partner}$`, 'i'),
        give: [],
        want: [{ item: FOOD, amount: 1 }],
        maxTrades: 1,
        timeout: 10 * 60_000,
        tradeTimeout: 90_000
    });
    const last = served.trades[served.trades.length - 1];
    log(
        `Take ${partner} ${last?.success ? 'ok' : last?.reason ?? served.reason} ${served.message} | got ${foodSummary()}`
    );
});
