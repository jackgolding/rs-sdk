/**
 * ABGARMY01 is the loot mule (same shape as jacklove food mule).
 * Donors note loot and serve; 01 finds them by name and initiates.
 *
 *   bun bots/quests/abg-bank.ts ABGARMY01 mule
 *   bun bots/quests/abg-bank.ts ABGARMY01 mule ABGARMY08,ABGARMY09
 *   bun bots/quests/abg-bank.ts ABGARMY08 donate
 *   bun bots/quests/abg-bank.ts fatpig collect
 *   bun bots/quests/abg-bank.ts ABGARMY01 dump
 */
import { appendFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';
import { abgThieves } from './tree-trade-plan';

const HUB = 'ABGARMY01';
const DONORS = [...abgThieves(), 'Jackpoo3'];
const HUB_PLAYER = new RegExp(`^${HUB}$`, 'i');
const MULE_FOOD = /^(tuna|swordfish|lobster|shark|cod|bass)$/i;
const SLASH = /^(bronze |iron |steel |mithril |adamant |rune )?(axe|sword|scimitar|dagger|claws|battleaxe|longsword|2h sword)$|^knife$/i;
const ARDOUGNE_BANK = { x: 2655, z: 3283 };
const ARDOUGNE_MARKET = { x: 2662, z: 3312 };
const HUB_MEET = { x: 2646, z: 3306 };
/** Give all gold — donors do not need a coin float for Ardougne thieving. */
const KEEP_COINS = 0;
const BANK_WHEN_SLOTS = 20;

function inArdougneMarket(x: number, z: number): boolean {
    return x >= 2620 && x <= 2690 && z >= 3280 && z <= 3330;
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const rawName = args[0] ?? '';
const botName = /^abgarmy\d+$/i.test(rawName) ? rawName.toUpperCase() : rawName;
const roleArg = (args[1] ?? '').toLowerCase();
const targetOverride = (args[2] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^(ABGARMY\d+|Jackpoo3)$/i.test(s))
    .map((s) => (/^ABGARMY/i.test(s) ? s.toUpperCase() : s))
    .filter((s) => s !== HUB);

function inferRole(name: string): 'mule' | 'donate' | 'dump' | 'collect' {
    if (name.toLowerCase() === HUB.toLowerCase()) return 'mule';
    if (DONORS.some((d) => d.toLowerCase() === name.toLowerCase())) return 'donate';
    throw new Error(
        `Usage: bun bots/quests/abg-bank.ts {ABGARMY01 mule|ABGARMYxx donate|ABGARMY01 dump|fatpig collect} [targets]`
    );
}

const role =
    roleArg === 'mule' || roleArg === 'donate' || roleArg === 'dump' || roleArg === 'collect'
        ? roleArg
        : rawName.toUpperCase() === 'RUN'
          ? 'run'
          : inferRole(botName);

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bankItemLabel(name: string, count: number): string {
    if (/^coins?$/i.test(name)) return 'gold';
    const n = name.toLowerCase();
    if (count !== 1 && /rune$/i.test(n)) return `${n}s`;
    return n;
}

function isEatFood(name: string): boolean {
    return MULE_FOOD.test(name) || /^kebab$/i.test(name);
}

function isKeep(name: string): boolean {
    return isEatFood(name) || SLASH.test(name);
}

function usedSlots(sdk: import('../../sdk/index').BotSDK): number {
    return sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
}

async function runMule(
    targets: string[],
    { bot, sdk }: { bot: import('../../sdk/actions').BotActions; sdk: import('../../sdk/index').BotSDK }
) {
    const GRIND_LOG = join(process.cwd(), 'bots', HUB, 'grind.log');
    const log = (msg: string) => {
        console.log(msg);
        try {
            appendFileSync(GRIND_LOG, `${new Date().toISOString()} ${msg}\n`);
        } catch {
            /* ignore */
        }
    };
    const logBank = () => {
        const parts = sdk
            .getBankItems()
            .filter((i) => (i.count ?? 0) > 0)
            .map((i) => `${i.count} ${bankItemLabel(i.name, i.count ?? 0)}`);
        if (parts.length) log(`LOG ${parts.join(' ')}`);
    };
    const pos = () => {
        const p = sdk.getState()?.player;
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0 };
    };
    const distTo = (x: number, z: number) => Math.hypot(pos().x - x, pos().z - z);

    function findDonor(name: string) {
        const want = name.toLowerCase();
        return sdk.getNearbyPlayers()?.find((p) => p.name.toLowerCase() === want) ?? null;
    }

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function goToMarket(): Promise<void> {
        const p = pos();
        if (inArdougneMarket(p.x, p.z)) {
            if (distTo(HUB_MEET.x, HUB_MEET.z) > 8) {
                await sdk.sendWalk(HUB_MEET.x, HUB_MEET.z, true);
                await Bun.sleep(2_000);
            }
            return;
        }
        await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 6);
        await walkNear(HUB_MEET.x, HUB_MEET.z, 3);
    }

    async function bankLoot(): Promise<void> {
        await walkNear(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
        const opened = await bot.openBank();
        if (!opened.success && !sdk.getState()?.bank?.isOpen) {
            log(`Bank open failed: ${opened.message}`);
            return;
        }
        for (let i = 0; i < 40; i++) {
            const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !isKeep(it.name));
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            if (!r.success && !r.partial) break;
        }
        await sdk.waitForTicks(1);
        logBank();
        await bot.closeBank();
        log(`Banked loot, ${usedSlots(sdk)} inv slots @ ${pos().x},${pos().z}`);
    }

    log(`ABG bank mule start @ ${pos().x},${pos().z} targets=${targets.join(',')}`);
    await bot.dismissBlockingUI();
    await goToMarket();
    log(`Mule waiting for donors @ ${pos().x},${pos().z}`);

    const remaining = [...targets];
    const squadDeadline = Date.now() + 25 * 60_000;
    while (remaining.length > 0 && Date.now() < squadDeadline) {
            for (const target of [...remaining]) {
            const player = findDonor(target);
            if (!player) continue;
            if (player.distance > 8) {
                await sdk.sendWalk(player.x, player.z, true);
                await Bun.sleep(2_000);
            }
            if (!findDonor(target)) continue;
            log(`Trade ${target}: want loot`);
            const result = await bot.trade(target, {
                give: [],
                want: [{ item: /.+/i, amount: 1 }],
                requestTimeout: 30_000,
                timeout: 90_000,
                retryOnBusy: true
            });
            log(`Trade ${target} ${result.success ? 'ok' : result.reason} ${result.message}`);
            if (result.success) {
                remaining.splice(remaining.indexOf(target), 1);
                if (usedSlots(sdk) >= BANK_WHEN_SLOTS) {
                    log('Inventory filling — banking before next donor');
                    await bankLoot();
                    await goToMarket();
                }
            }
            await sdk.waitForTicks(2);
        }
        if (remaining.length === 0) break;
        log(`Still waiting for: ${remaining.join(', ')}`);
        await goToMarket();
        await sdk.waitForTicks(8);
    }
    if (remaining.length > 0) log(`Could not trade: ${remaining.join(', ')}`);

    await bankLoot();
    log(`Mule done @ ${pos().x},${pos().z}`);
}

async function runDonate(
    donorName: string,
    { bot, sdk }: { bot: import('../../sdk/actions').BotActions; sdk: import('../../sdk/index').BotSDK }
) {
    const GRIND_LOG = join(process.cwd(), 'bots', donorName, 'grind.log');
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

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const p = pos();
        if (!inArdougneMarket(p.x, p.z) && p.x >= 2600 && p.x <= 2700 && p.z >= 3100 && p.z <= 3250) {
            log(`Walking north to Ardougne market from ${p.x},${p.z}`);
            await sdk.sendWalk(2655, 3283, true);
            await sdk.waitForTicks(4);
        }
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    function lootGiveList(): { item: RegExp; amount: number }[] {
        const give: { item: RegExp; amount: number }[] = [];
        const seen = new Set<string>();
        for (const item of sdk.getInventory()) {
            const count = item.count ?? 0;
            if (count <= 0) continue;
            if (isKeep(item.name)) continue;
            if (/^coins$/i.test(item.name) && count <= KEEP_COINS) continue;
            const key = item.name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            give.push({ item: new RegExp(`^${escapeRegex(item.name)}$`, 'i'), amount: -1 });
        }
        return give;
    }

    async function prepareNotedLoot(): Promise<number> {
        const cur = pos();
        if (cur.x >= 2635 && cur.x <= 2649 && cur.z >= 3298 && cur.z <= 3311) {
            const dest = { x: 2650, z: 3306 };
            const hops = [{ x: Math.min(cur.x + 5, dest.x), z: cur.z }, { x: dest.x, z: cur.z }, dest];
            for (const hop of hops) {
                const p = pos();
                if (!(p.x >= 2635 && p.x <= 2649 && p.z >= 3298 && p.z <= 3311)) break;
                const until = Date.now() + 10_000;
                while (distTo(hop.x, hop.z) > 2 && Date.now() < until) {
                    void sdk.sendWalk(hop.x, hop.z, true).catch(() => {});
                    await Bun.sleep(500);
                }
            }
        }
        await walkNear(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
        let opened = sdk.getState()?.bank?.isOpen;
        for (let attempt = 0; attempt < 4 && !opened; attempt++) {
            const r = await bot.openBank();
            if (r.success || sdk.getState()?.bank?.isOpen) {
                opened = true;
                break;
            }
            await sdk.waitForTicks(2);
        }
        if (!opened) {
            log(`Bank open failed @ ${pos().x},${pos().z}`);
            return 0;
        }
        for (let i = 0; i < 40; i++) {
            const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0);
            if (!item) break;
            await bot.depositItem(item, -1);
        }
        await sdk.waitForTicks(1);
        const bankState = sdk.getState()?.bank;
        if (!bankState?.noteMode) {
            log('Clicking bank note toggle');
            await sdk.sendClickComponent(5386);
            await sdk.waitForTicks(2);
        }
        let noted = 0;
        for (const item of sdk.getBankItems()) {
            if ((item.count ?? 0) <= 0) continue;
            if (isEatFood(item.name)) continue;
            if (/^coins$/i.test(item.name)) continue;
            const before = usedSlots(sdk);
            const r = await bot.withdrawItem(item.name, -1, { asNote: true });
            if (r.success) noted += item.count ?? 0;
            else {
                const fallback = await sdk.sendBankWithdraw(item.slot, -1);
                if (fallback.success) noted += item.count ?? 0;
            }
            await sdk.waitForCondition(() => usedSlots(sdk) !== before, 4_000).catch(() => {});
        }
        const bankCoins = sdk.findBankItem(/^coins$/i)?.count ?? 0;
        const tradeCoins = Math.max(0, bankCoins - KEEP_COINS);
        if (tradeCoins > 0) await bot.withdrawItem(/^coins$/i, tradeCoins);
        await bot.closeBank();
        return noted + tradeCoins;
    }

    log(`ABG bank donate start @ ${pos().x},${pos().z}`);
    await bot.dismissBlockingUI();
    await prepareNotedLoot();
    const give = lootGiveList();
    if (give.length === 0) {
        log('Nothing to trade — skipping');
        return;
    }
    const lootSummary = sdk
        .getInventory()
        .filter((i) => (i.count ?? 0) > 0 && !isKeep(i.name))
        .map((i) => `${i.count} ${i.name}`)
        .join(', ');
    log(`Serving ${give.length} stack(s) to ${HUB}: ${lootSummary}`);

    const p = pos();
    if (!inArdougneMarket(p.x, p.z) || distTo(HUB_MEET.x, HUB_MEET.z) > 10) {
        if (!inArdougneMarket(pos().x, pos().z)) {
            await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 6);
        }
        await sdk.sendWalk(HUB_MEET.x, HUB_MEET.z, true);
        await Bun.sleep(2_000);
    }
    log(`Waiting for mule ${HUB} @ ${pos().x},${pos().z}`);

    const served = await bot.serveTrades({
        from: HUB_PLAYER,
        give,
        want: [],
        maxTrades: 1,
        timeout: 20 * 60_000,
        tradeTimeout: 90_000
    });
    const last = served.trades[served.trades.length - 1];
    log(`Donate ${last?.success ? 'ok' : last?.reason ?? served.reason} ${served.message}`);
}

async function runDumpToJacklove1({
    bot,
    sdk
}: {
    bot: import('../../sdk/actions').BotActions;
    sdk: import('../../sdk/index').BotSDK;
}) {
    const GRIND_LOG = join(process.cwd(), 'bots', HUB, 'grind.log');
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

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    function lootGiveList(): { item: RegExp; amount: number }[] {
        const give: { item: RegExp; amount: number }[] = [];
        const seen = new Set<string>();
        for (const item of sdk.getInventory()) {
            const count = item.count ?? 0;
            if (count <= 0) continue;
            if (isKeep(item.name)) continue;
            const key = item.name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            give.push({ item: new RegExp(`^${escapeRegex(item.name)}$`, 'i'), amount: -1 });
        }
        return give;
    }

    function lootSummary(): string {
        return (
            sdk
                .getInventory()
                .filter((i) => (i.count ?? 0) > 0 && !isKeep(i.name))
                .map((i) => `${i.count} ${i.name}`)
                .join(', ') || 'none'
        );
    }

    async function packLootTrip(): Promise<number> {
        await walkNear(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
        const opened = await bot.openBank();
        if (!opened.success && !sdk.getState()?.bank?.isOpen) {
            log(`Bank open failed: ${opened.message}`);
            return lootGiveList().length;
        }
        for (let i = 0; i < 40; i++) {
            const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !isKeep(it.name));
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            if (!r.success && !r.partial) break;
        }
        await sdk.waitForTicks(1);
        const bankState = sdk.getState()?.bank;
        if (!bankState?.noteMode) {
            log('Clicking bank note toggle');
            await sdk.sendClickComponent(5386);
            await sdk.waitForTicks(2);
        }
        let withdrawn = 0;
        for (const item of sdk.getBankItems()) {
            if ((item.count ?? 0) <= 0) continue;
            if (isEatFood(item.name) || /^coins$/i.test(item.name)) continue;
            if (usedSlots(sdk) >= 20 || withdrawn >= 10) break;
            const before = usedSlots(sdk);
            await sdk.sendBankWithdraw(item.slot, -1);
            await sdk.waitForCondition(() => usedSlots(sdk) !== before, 4_000).catch(() => {});
            if (usedSlots(sdk) > before) withdrawn++;
        }
        const bankCoins = sdk.findBankItem(/^coins$/i)?.count ?? 0;
        if (bankCoins > 0 && usedSlots(sdk) < 24 && withdrawn < 10) {
            await bot.withdrawItem(/^coins$/i, bankCoins);
        }
        await bot.closeBank();
        return lootGiveList().length;
    }

    log(`ABG dump → jacklove1 start @ ${pos().x},${pos().z}`);
    await bot.dismissBlockingUI();

    for (let trip = 1; trip <= 12; trip++) {
        const stacks = await packLootTrip();
        if (stacks <= 0) {
            log(trip === 1 ? 'Nothing to dump — bank and inv are clean of loot' : 'Dump complete — no loot left');
            break;
        }
        log(`Trip ${trip}: ${lootSummary()}`);
        if (!inArdougneMarket(pos().x, pos().z) || distTo(HUB_MEET.x, HUB_MEET.z) > 10) {
            await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 6);
            await sdk.sendWalk(HUB_MEET.x, HUB_MEET.z, true);
            await Bun.sleep(2_000);
        }
        const deadline = Date.now() + 180_000;
        while (Date.now() < deadline && !sdk.getNearbyPlayers()?.some((p) => /^jacklove1$/i.test(p.name))) {
            log('jacklove1 not at market yet — waiting');
            await sdk.waitForTicks(6);
        }
        let traded = false;
        for (let attempt = 1; attempt <= 8 && !traded; attempt++) {
            const result = await bot.trade(/^jacklove1$/i, {
                give: lootGiveList(),
                want: [],
                requestTimeout: 30_000,
                timeout: 90_000,
                retryOnBusy: true
            });
            log(`Trade jacklove1 ${result.success ? 'ok' : result.reason} ${result.message}`);
            if (result.success) {
                traded = true;
                break;
            }
            const full = result.reason === 'no_space' || /inventory space/i.test(result.message ?? '');
            if (!full) {
                log('Dump stopped — jacklove1 trade failed');
                break;
            }
            log(`jacklove1 full (attempt ${attempt}) — waiting for them to bank`);
            await sdk.waitForTicks(20);
        }
        if (!traded) break;
        await sdk.waitForTicks(2);
    }
    log(`Dump done leftover ${lootSummary()} @ ${pos().x},${pos().z}`);
}

async function runJacklove1Collect({
    bot,
    sdk
}: {
    bot: import('../../sdk/actions').BotActions;
    sdk: import('../../sdk/index').BotSDK;
}) {
    const GRIND_LOG = join(process.cwd(), 'bots', 'jacklove1', 'grind.log');
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

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function bankLoot(): Promise<void> {
        await walkNear(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
        const opened = await bot.openBank();
        if (!opened.success && !sdk.getState()?.bank?.isOpen) {
            log(`Bank open failed: ${opened.message}`);
            return;
        }
        const skipped = new Set<string>();
        for (let i = 0; i < 50; i++) {
            const item = sdk.getInventory().find(
                (it) => (it.count ?? 0) > 0 && !isEatFood(it.name) && !skipped.has(it.name.toLowerCase())
            );
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            if (!r.success && !r.partial) skipped.add(item.name.toLowerCase());
        }
        for (let i = 0; i < 40; i++) {
            const food = sdk.getInventory().filter((it) => (it.count ?? 0) > 0 && isEatFood(it.name));
            if (food.length <= 4) break;
            const extra = food[food.length - 1]!;
            const r = await bot.depositItem(extra, -1);
            if (!r.success && !r.partial) break;
        }
        await bot.closeBank();
        log(
            `Banked loot, ${usedSlots(sdk)} inv slots @ ${pos().x},${pos().z} leftover=${sdk
                .getInventory()
                .filter((i) => (i.count ?? 0) > 0)
                .map((i) => `${i.count} ${i.name}`)
                .join(', ') || 'empty'}`
        );
    }

    log(`jacklove1 collect from ${HUB} start @ ${pos().x},${pos().z}`);
    await bot.dismissBlockingUI();
    if (!inArdougneMarket(pos().x, pos().z) && distTo(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z) > 15) {
        const CATHERBY_TO_ARDY = [
            { x: 2808, z: 3443 },
            { x: 2788, z: 3460 },
            { x: 2758, z: 3477 },
            { x: 2726, z: 3485 },
            { x: 2695, z: 3375 },
            { x: 2662, z: 3375 },
            { x: 2662, z: 3336 }
        ];
        log(`Walking Catherby → Ardougne @ ${pos().x},${pos().z}`);
        for (const wp of CATHERBY_TO_ARDY) {
            if (distTo(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z) <= 10) break;
            await walkNear(wp.x, wp.z, 8);
        }
    }
    await bankLoot();
    if (!inArdougneMarket(pos().x, pos().z) || distTo(HUB_MEET.x, HUB_MEET.z) > 10) {
        await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 6);
        await sdk.sendWalk(HUB_MEET.x, HUB_MEET.z, true);
        await Bun.sleep(2_000);
    }
    log(`Waiting for mule ${HUB} @ ${pos().x},${pos().z}`);

    const windowEnd = Date.now() + 20 * 60_000;
    let got = 0;
    while (Date.now() < windowEnd) {
        const served = await bot.serveTrades({
            from: HUB_PLAYER,
            give: [],
            want: [{ item: /.+/i, amount: 1 }],
            maxTrades: 1,
            timeout: Math.min(3 * 60_000, windowEnd - Date.now()),
            tradeTimeout: 90_000
        });
        const last = served.trades[served.trades.length - 1];
        if (last?.success) {
            got++;
            log(`Collect ok ${served.message}`);
            await bankLoot();
            await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 6);
            await sdk.sendWalk(HUB_MEET.x, HUB_MEET.z, true);
            await Bun.sleep(2_000);
        } else {
            log(`Collect ${last?.reason ?? served.reason} ${served.message}`);
            if (served.reason === 'timeout' && got > 0) break;
            if (Date.now() >= windowEnd) break;
        }
    }
    log(`jacklove1 collect done (${got} trip(s)) @ ${pos().x},${pos().z}`);
}

async function runDumpToFatpig({
    bot,
    sdk
}: {
    bot: import('../../sdk/actions').BotActions;
    sdk: import('../../sdk/index').BotSDK;
}) {
    const GRIND_LOG = join(process.cwd(), 'bots', HUB, 'grind.log');
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

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    function lootGiveList(): { item: RegExp; amount: number }[] {
        const give: { item: RegExp; amount: number }[] = [];
        const seen = new Set<string>();
        for (const item of sdk.getInventory()) {
            const count = item.count ?? 0;
            if (count <= 0) continue;
            if (isKeep(item.name)) continue;
            const key = item.name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            give.push({ item: new RegExp(`^${escapeRegex(item.name)}$`, 'i'), amount: -1 });
        }
        return give;
    }

    function lootSummary(): string {
        return (
            sdk
                .getInventory()
                .filter((i) => (i.count ?? 0) > 0 && !isKeep(i.name))
                .map((i) => `${i.count} ${i.name}`)
                .join(', ') || 'none'
        );
    }

    async function packLootTrip(): Promise<number> {
        await walkNear(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
        const opened = await bot.openBank();
        if (!opened.success && !sdk.getState()?.bank?.isOpen) {
            log(`Bank open failed: ${opened.message}`);
            return lootGiveList().length;
        }
        for (let i = 0; i < 40; i++) {
            const item = sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !isKeep(it.name));
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            if (!r.success && !r.partial) break;
        }
        await sdk.waitForTicks(1);
        const bankState = sdk.getState()?.bank;
        if (!bankState?.noteMode) {
            log('Clicking bank note toggle');
            await sdk.sendClickComponent(5386);
            await sdk.waitForTicks(2);
        }
        let withdrawn = 0;
        for (const item of sdk.getBankItems()) {
            if ((item.count ?? 0) <= 0) continue;
            if (isEatFood(item.name) || /^coins$/i.test(item.name)) continue;
            if (usedSlots(sdk) >= 20 || withdrawn >= 10) break;
            const before = usedSlots(sdk);
            await sdk.sendBankWithdraw(item.slot, -1);
            await sdk.waitForCondition(() => usedSlots(sdk) !== before, 4_000).catch(() => {});
            if (usedSlots(sdk) > before) withdrawn++;
        }
        const bankCoins = sdk.findBankItem(/^coins$/i)?.count ?? 0;
        if (bankCoins > 0 && usedSlots(sdk) < 24 && withdrawn < 10) {
            await bot.withdrawItem(/^coins$/i, bankCoins);
        }
        await bot.closeBank();
        return lootGiveList().length;
    }

    log(`ABG dump → fatpig start @ ${pos().x},${pos().z}`);
    await bot.dismissBlockingUI();

    for (let trip = 1; trip <= 12; trip++) {
        const stacks = await packLootTrip();
        if (stacks <= 0) {
            log(trip === 1 ? 'Nothing to dump — bank and inv are clean of loot' : 'Dump complete — no loot left');
            break;
        }
        log(`Trip ${trip}: ${lootSummary()}`);
        if (!inArdougneMarket(pos().x, pos().z) || distTo(HUB_MEET.x, HUB_MEET.z) > 10) {
            await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 6);
            await sdk.sendWalk(HUB_MEET.x, HUB_MEET.z, true);
            await Bun.sleep(2_000);
        }
        const deadline = Date.now() + 180_000;
        while (Date.now() < deadline && !sdk.getNearbyPlayers()?.some((p) => /^fatpig$/i.test(p.name))) {
            log('fatpig not at market yet — waiting');
            await sdk.waitForTicks(6);
        }
        let traded = false;
        for (let attempt = 1; attempt <= 8 && !traded; attempt++) {
            const result = await bot.trade(/^fatpig$/i, {
                give: lootGiveList(),
                want: [],
                requestTimeout: 30_000,
                timeout: 90_000,
                retryOnBusy: true
            });
            log(`Trade fatpig ${result.success ? 'ok' : result.reason} ${result.message}`);
            if (result.success) {
                traded = true;
                break;
            }
            const full = result.reason === 'no_space' || /inventory space/i.test(result.message ?? '');
            if (!full) {
                log('Dump stopped — fatpig trade failed');
                break;
            }
            log(`fatpig full (attempt ${attempt}) — waiting for them to bank`);
            await sdk.waitForTicks(20);
        }
        if (!traded) break;
        await sdk.waitForTicks(2);
    }
    log(`Dump done leftover ${lootSummary()} @ ${pos().x},${pos().z}`);
}

async function runFatpigCollect({
    bot,
    sdk
}: {
    bot: import('../../sdk/actions').BotActions;
    sdk: import('../../sdk/index').BotSDK;
}) {
    const GRIND_LOG = join(process.cwd(), 'bots', 'fatpig', 'grind.log');
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

    async function walkNear(x: number, z: number, tolerance = 4): Promise<boolean> {
        if (distTo(x, z) <= tolerance) return true;
        const r = await bot.walkTo(x, z, Math.min(tolerance, 3));
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    function inRangingGuild(): boolean {
        const p = pos();
        return p.x >= 2655 && p.x <= 2685 && p.z >= 3410 && p.z <= 3445;
    }

    async function leaveRangingGuild(): Promise<void> {
        if (!inRangingGuild()) return;
        log(`Leaving ranging guild @ ${pos().x},${pos().z}`);
        for (let i = 0; i < 8 && inRangingGuild(); i++) {
            const closed =
                sdk.findNearbyLoc(/^guild door$/i, { withOption: /open/i }) ??
                sdk.findNearbyLoc(/^(door|gate)$/i, { withOption: /open/i });
            if (closed) {
                const opt = closed.optionsWithIndex?.find((o) => /^open$/i.test(o.text));
                log(`Opening ${closed.name} @ ${closed.x},${closed.z}`);
                await sdk.sendInteractLoc(closed.x, closed.z, closed.id, opt?.opIndex ?? 1);
                await sdk.waitForTicks(2);
            }
            await walkNear(2654, 3438, 2);
            log(`Guild exit attempt ${i + 1} @ ${pos().x},${pos().z}`);
        }
        log(`Left ranging guild @ ${pos().x},${pos().z}`);
    }

    async function bankLoot(): Promise<void> {
        await walkNear(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
        const opened = await bot.openBank();
        if (!opened.success && !sdk.getState()?.bank?.isOpen) {
            log(`Bank open failed: ${opened.message}`);
            return;
        }
        const skipped = new Set<string>();
        for (let i = 0; i < 50; i++) {
            const item = sdk.getInventory().find(
                (it) => (it.count ?? 0) > 0 && !isEatFood(it.name) && !skipped.has(it.name.toLowerCase())
            );
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            if (!r.success && !r.partial) skipped.add(item.name.toLowerCase());
        }
        for (let i = 0; i < 40; i++) {
            const food = sdk.getInventory().filter((it) => (it.count ?? 0) > 0 && isEatFood(it.name));
            if (food.length <= 4) break;
            const extra = food[food.length - 1]!;
            const r = await bot.depositItem(extra, -1);
            if (!r.success && !r.partial) break;
        }
        await bot.closeBank();
        log(
            `Banked loot, ${usedSlots(sdk)} inv slots @ ${pos().x},${pos().z} leftover=${sdk
                .getInventory()
                .filter((i) => (i.count ?? 0) > 0)
                .map((i) => `${i.count} ${i.name}`)
                .join(', ') || 'empty'}`
        );
    }

    log(`fatpig collect from ${HUB} start @ ${pos().x},${pos().z}`);
    await bot.dismissBlockingUI();
    await leaveRangingGuild();
    await bankLoot();
    if (!inArdougneMarket(pos().x, pos().z) || distTo(HUB_MEET.x, HUB_MEET.z) > 10) {
        await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 6);
        await sdk.sendWalk(HUB_MEET.x, HUB_MEET.z, true);
        await Bun.sleep(2_000);
    }
    log(`Waiting for mule ${HUB} @ ${pos().x},${pos().z}`);

    const windowEnd = Date.now() + 20 * 60_000;
    let got = 0;
    while (Date.now() < windowEnd) {
        const served = await bot.serveTrades({
            from: HUB_PLAYER,
            give: [],
            want: [{ item: /.+/i, amount: 1 }],
            maxTrades: 1,
            timeout: Math.min(3 * 60_000, windowEnd - Date.now()),
            tradeTimeout: 90_000
        });
        const last = served.trades[served.trades.length - 1];
        if (last?.success) {
            got++;
            log(`Collect ok ${served.message}`);
            await bankLoot();
            await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 6);
            await sdk.sendWalk(HUB_MEET.x, HUB_MEET.z, true);
            await Bun.sleep(2_000);
        } else {
            log(`Collect ${last?.reason ?? served.reason} ${served.message}`);
            if (served.reason === 'timeout' && got > 0) break;
            if (Date.now() >= windowEnd) break;
        }
    }
    log(`fatpig collect done (${got} trip(s)) @ ${pos().x},${pos().z}`);
}

if (role === 'run') {
    const batches: string[][] = [];
    for (let i = 0; i < DONORS.length; i += 4) batches.push(DONORS.slice(i, i + 4));
    for (const batch of batches) {
        const csv = batch.join(',');
        console.log(`\n=== mule batch ${csv} ===`);
        const donors = batch.map((donor) =>
            Bun.spawn(['bun', 'bots/quests/abg-bank.ts', donor, 'donate'], {
                cwd: process.cwd(),
                stdout: 'inherit',
                stderr: 'inherit'
            })
        );
        const readyDeadline = Date.now() + 3 * 60_000;
        const startedAt = Date.now();
        const ready = (name: string) => {
            try {
                return readFileSync(join(process.cwd(), 'bots', name, 'grind.log'), 'utf8')
                    .split('\n')
                    .some((line) => {
                        if (!line.includes('Waiting for mule')) return false;
                        const ts = Date.parse(line.slice(0, 24));
                        return Number.isFinite(ts) && ts >= startedAt - 2_000;
                    });
            } catch {
                return false;
            }
        };
        while (Date.now() < readyDeadline && !batch.every(ready)) await Bun.sleep(2_000);
        const mule = Bun.spawn(['bun', 'bots/quests/abg-bank.ts', HUB, 'mule', csv], {
            cwd: process.cwd(),
            stdout: 'inherit',
            stderr: 'inherit'
        });
        await mule.exited;
        for (const d of donors) {
            d.kill();
            await d.exited;
        }
        await Bun.sleep(3_000);
    }
} else if (role === 'mule') {
    const targets =
        targetOverride.length > 0 ? targetOverride.filter((t) => DONORS.some((d) => d.toLowerCase() === t.toLowerCase())) : DONORS;
    if (targets.length === 0) throw new Error(`No valid mule targets: ${(args[2] ?? '').trim() || '(none)'}`);
    await runScript((ctx) => runMule(targets, ctx));
} else if (role === 'dump') {
    const targetMule = (args[2] ?? '').toLowerCase();
    if (targetMule === 'jacklove1') {
        await runScript((ctx) => runDumpToJacklove1(ctx));
    } else {
        await runScript((ctx) => runDumpToFatpig(ctx));
    }
} else if (role === 'collect') {
    if (/^jacklove1$/i.test(botName)) {
        await runScript((ctx) => runJacklove1Collect(ctx));
    } else {
        await runScript((ctx) => runFatpigCollect(ctx));
    }
} else {
    await runScript((ctx) => runDonate(botName, ctx));
}
