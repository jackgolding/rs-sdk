/**
 * Consolidate oyster/casket loot at Catherby bank.
 * Fleet runs: use abg-food-hub.sh (jacklove1 collects food + loot → ABGARMY01).
 *
 *   bun bots/quests/mule-catherby-loot.ts jacklove20 prep
 *   bun bots/quests/mule-catherby-loot.ts fatpig prep
 *   bun bots/quests/mule-catherby-loot.ts jacklove20 receive jacklove7
 *   bun bots/quests/mule-catherby-loot.ts fatpig receive jacklove7
 *   bun bots/quests/mule-catherby-loot.ts jacklove7 give
 *   bun bots/quests/mule-catherby-loot.ts jacklove7 give fatpig
 *
 * prep    — collector: walk to Catherby bank and clear inventory.
 * give    — note bank casket loot, trade notes to jacklove20 (or argv partner).
 * receive — collector: accept one giver's noted loot and bank it.
 */
import { appendFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { walkNear as walkNearShared } from './movement';

const DEFAULT_COLLECTOR = 'jacklove20';
const CATHERBY_BANK = { x: 2808, z: 3443 };
/** North side of booths — pier tiles have no booth options. */
const BANK_STAND = { x: 2809, z: 3441 };
/** Pier → north booth row when stopped mid-fish. */
const PIER_TO_BANK = [
    { x: 2835, z: 3436 },
    { x: 2825, z: 3438 },
    { x: 2815, z: 3440 },
    BANK_STAND
];
const ARDY_TO_CATHERBY = [
    { x: 2662, z: 3336 },
    { x: 2662, z: 3375 },
    { x: 2695, z: 3375 },
    { x: 2726, z: 3485 },
    { x: 2758, z: 3477 },
    { x: 2788, z: 3460 },
    { x: 2808, z: 3443 }
];

/** Casket / oyster treasure — not fish or fishing gear. */
const LOOT = /^(coins|uncut (?:sapphire|emerald|ruby|diamond)|(?:cosmic|nature) talisman|half of a key)$/i;
const TOOL_KEEP = /^(big|large) fishing net|small fishing net|harpoon|lobster pot$/i;

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const botName = args[0] ?? '';
const roleArg = (args[1] ?? '').toLowerCase();
const partner = args[2] ?? '';
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

function inferRole(name: string): 'prep' | 'receive' | 'give' {
    if (/^(jacklove20|fatpig)$/i.test(name)) {
        if (roleArg === 'prep') return 'prep';
        if (partner) return 'receive';
    }
    return 'give';
}

const role =
    roleArg === 'prep' || roleArg === 'receive' || roleArg === 'give' ? roleArg : inferRole(botName);
const COLLECTOR = role === 'give' ? partner || DEFAULT_COLLECTOR : botName;

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    const lootStacks = () => sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && LOOT.test(i.name));
    const lootSummary = () =>
        lootStacks()
            .map((i) => `${i.count} ${i.name}`)
            .join(', ') || 'none';
    const lootGive = () => {
        const seen = new Set<string>();
        const give: { item: RegExp; amount: number }[] = [];
        for (const item of lootStacks()) {
            const key = item.name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            give.push({ item: new RegExp(`^${escapeRegex(item.name)}$`, 'i'), amount: -1 });
        }
        return give;
    };

    function inCatherby(): boolean {
        const p = pos();
        return p.x >= 2788 && p.x <= 2875 && p.z >= 3415 && p.z <= 3498 && p.z < 6400;
    }

    async function walkNearTimed(x: number, z: number, tolerance = 4, ms = 12_000): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const done = await Promise.race([
            walkNearShared(bot, sdk, x, z, tolerance),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms))
        ]);
        return done || distTo(x, z) <= tolerance + 2;
    }

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        return walkNearTimed(x, z, tolerance);
    }

    async function walkWaypoints(wps: { x: number; z: number }[]): Promise<void> {
        const dest = wps[wps.length - 1]!;
        for (const wp of wps) {
            if (distTo(dest.x, dest.z) <= 8) return;
            if (distTo(wp.x, wp.z) <= 8) continue;
            await walkNear(wp.x, wp.z, 8);
        }
        if (distTo(dest.x, dest.z) > 6) await walkNear(dest.x, dest.z, 6);
    }

    async function goToBankStand(): Promise<void> {
        if (!inCatherby()) {
            log(`Walking to Catherby from ${pos().x},${pos().z}`);
            await walkWaypoints(ARDY_TO_CATHERBY);
        }
        if (pos().z >= 3440 && closestBooth()) return;
        if (distTo(BANK_STAND.x, BANK_STAND.z) <= 2) return;
        log(`Walking to bank stand from ${pos().x},${pos().z}`);
        if (pos().z < 3440) {
            for (const wp of PIER_TO_BANK) {
                if (distTo(BANK_STAND.x, BANK_STAND.z) <= 2) break;
                await walkNearTimed(wp.x, wp.z, 4, 20_000);
            }
        } else {
            await walkNearTimed(BANK_STAND.x, BANK_STAND.z, 2, 20_000);
        }
    }

    function closestBooth() {
        return (sdk.getNearbyLocs() ?? [])
            .filter((l) => /bank booth/i.test(l.name) && (l.optionsWithIndex?.length ?? 0) > 0)
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    }

    async function openBank(): Promise<boolean> {
        if (sdk.getState()?.bank?.isOpen) return true;
        if (sdk.getTradeState().isOpen) await bot.declineTrade().catch(() => {});
        await sdk.sendCloseShop().catch(() => {});
        await sdk.sendCloseModal().catch(() => {});
        await goToBankStand();

        for (let attempt = 0; attempt < 4; attempt++) {
            const booth = closestBooth();
            if (booth && (booth.distance ?? 99) <= 3) {
                const r = await bot.interactLoc(booth, /use.quickly|bank/i);
                await sdk.waitForCondition((s) => s.bank?.isOpen === true, 6_000).catch(() => {});
                if (sdk.getState()?.bank?.isOpen) return true;
                log(`Booth attempt ${attempt + 1}: ${r.success ? 'clicked' : r.message}`);
            }
            const banker = sdk.findNearbyNpc(/banker/i);
            if (banker && (banker.distance ?? 99) <= 4) {
                const r = await bot.interactNpc(banker, /bank/i);
                await sdk.waitForCondition((s) => s.bank?.isOpen === true, 6_000).catch(() => {});
                if (sdk.getState()?.bank?.isOpen) return true;
                log(`Banker attempt ${attempt + 1}: ${r.success ? 'clicked' : r.message}`);
            }
            const opened = await bot.openBank(6_000);
            if (opened.success || sdk.getState()?.bank?.isOpen) return true;
            log(`openBank attempt ${attempt + 1}: ${opened.message}`);
            await sdk.waitForTicks(2);
        }
        return false;
    }

    async function depositAll(): Promise<void> {
        for (let i = 0; i < 40; i++) {
            if (!sdk.getState()?.interface?.isOpen) break;
            const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !TOOL_KEEP.test(it.name));
            if (!item) break;
            const r = await sdk.sendBankDeposit(item.slot, -1);
            if (!r.success) {
                log(`Deposit ${item.name} failed: ${r.message}`);
                break;
            }
            await sdk.waitForTicks(1);
        }
    }

    async function dropNonTools(): Promise<void> {
        const failed = new Set<number>();
        for (let pass = 0; pass < 35; pass++) {
            const item = sdk
                .getInventory()
                .find((i) => (i.count ?? 0) > 0 && !TOOL_KEEP.test(i.name) && !failed.has(i.slot));
            if (!item) break;
            const r = await sdk.sendDropItem(item.slot);
            if (r.success) log(`Drop ${item.name}: ok`);
            else {
                failed.add(item.slot);
                log(`Drop ${item.name}: ${r.message}`);
            }
            await sdk.waitForTicks(1);
        }
    }

    async function noteBankLoot(): Promise<number> {
        await goToBankStand();
        if (!(await openBank())) return lootStacks().reduce((n, i) => n + (i.count ?? 0), 0);
        await depositAll();
        const wanted = sdk.getBankItems().filter((i) => (i.count ?? 0) > 0 && LOOT.test(i.name));
        log(`Bank loot: ${wanted.map((i) => `${i.count} ${i.name}`).join(', ') || 'none'}`);
        if (wanted.length === 0) {
            await sdk.sendCloseModal().catch(() => {});
            return 0;
        }
        for (const item of wanted) {
            const re = new RegExp(`^${escapeRegex(item.name)}$`, 'i');
            const r = await bot.withdrawItem(re, -1, { asNote: true });
            const arrived = sdk.findInventoryItem(re);
            const noted = !!arrived && arrived.id !== item.id;
            if (r.success && noted) {
                log(`Noted ${item.name} x${item.count} ok`);
            } else {
                const plain = await bot.withdrawItem(re, -1);
                log(`Withdraw ${item.name} x${item.count} ${plain.success ? 'unnoted' : plain.message}`);
            }
        }
        await sdk.sendCloseModal().catch(() => {});
        log(`Packed loot notes ${lootSummary()} @ ${pos().x},${pos().z}`);
        return lootStacks().reduce((n, i) => n + (i.count ?? 0), 0);
    }

    async function bankLootNotes(): Promise<void> {
        if (lootStacks().length === 0) return;
        if (!(await openBank())) {
            log(`Could not bank loot notes: ${lootSummary()}`);
            return;
        }
        for (const item of [...lootStacks()]) {
            const r = await bot.depositItem(item, -1);
            log(`Bank ${item.name} x${item.count}: ${r.success ? 'ok' : r.message}`);
        }
        await sdk.sendCloseModal().catch(() => {});
        log(`Collector banked loot @ ${pos().x},${pos().z}`);
    }

    async function clearInventoryForTrade(): Promise<void> {
        log(`Clearing inv @ ${pos().x},${pos().z}`);
        if (sdk.getTradeState().isOpen) await bot.declineTrade().catch(() => {});
        await goToBankStand();
        if (await openBank()) {
            await depositAll();
            await sdk.sendCloseModal().catch(() => {});
            log(`Cleared inv via bank @ ${pos().x},${pos().z}`);
            return;
        }
        await sdk.sendCloseModal().catch(() => {});
        const nonTool = sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && !TOOL_KEEP.test(i.name));
        if (nonTool.length === 0) {
            log('Inv already clear for trade');
            return;
        }
        log('Dropping non-tools for trade space');
        await dropNonTools();
    }

    async function giveToCollector(): Promise<boolean> {
        let packed = lootStacks().reduce((n, i) => n + (i.count ?? 0), 0);
        if (packed <= 0) packed = await noteBankLoot();
        if (packed <= 0) {
            log('No loot to mule');
            return true;
        }
        if (pos().z < 3440) await goToBankStand();
        const give = lootGive();
        log(`Trading ${COLLECTOR}: ${lootSummary()}`);
        const result = await bot.trade(COLLECTOR, {
            give,
            want: [],
            retryOnBusy: true,
            requestTimeout: 120_000,
            timeout: 90_000
        });
        log(`Trade ${COLLECTOR} ${result.success ? 'ok' : result.reason} ${result.message} | leftover ${lootSummary()}`);
        return result.success || lootStacks().length === 0;
    }

    async function receiveFromGiver(name: string): Promise<boolean> {
        if (!name) throw new Error('receive requires partner name');
        await goToBankStand();
        if (freeSlots() < 4) await clearInventoryForTrade();
        log(`At bank @ ${pos().x},${pos().z} — accepting from ${name}`);
        const served = await bot.serveTrades({
            from: new RegExp(`^${escapeRegex(name)}$`, 'i'),
            give: [],
            want: [{ item: LOOT, amount: 1 }],
            maxTrades: 1,
            timeout: 5 * 60_000,
            tradeTimeout: 90_000
        });
        const last = served.trades[served.trades.length - 1];
        log(
            `Receive ${name} ${last?.success ? 'ok' : last?.reason ?? served.reason} ${served.message} | got ${lootSummary()}`
        );
        if (last?.success) await bankLootNotes();
        return last?.success === true;
    }

    const freeSlots = () => 28 - sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;

    log(`Loot mule ${role} start @ ${pos().x},${pos().z} loot=${lootSummary()}`);
    if (role === 'prep') {
        await goToBankStand();
        if (freeSlots() >= 5) {
            log(`Prep ok — ${freeSlots()} free slots @ ${pos().x},${pos().z}`);
            return;
        }
        await clearInventoryForTrade();
        log(`Prep done free=${freeSlots()} inv=${sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length} slots`);
        return;
    }
    if (role === 'give') {
        const ok = await giveToCollector();
        log(`Give done ${ok ? 'ok' : 'incomplete'} leftover ${lootSummary()}`);
        return;
    }
    const ok = await receiveFromGiver(partner);
    log(`Receive done ${ok ? 'ok' : 'incomplete'} loot=${lootSummary()}`);
});
