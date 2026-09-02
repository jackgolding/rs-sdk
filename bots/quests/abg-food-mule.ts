/**
 * Hub mule: jacklove2–20 → jacklove1 @ Catherby (food + casket/oyster loot) → jacklove1 → ABGARMY01 → thieves.
 *
 *   bun bots/quests/abg-food-mule.ts jacklove1 fish-collect   # hub: take food + loot notes at Catherby
 *   bun bots/quests/abg-food-mule.ts jacklove7 give            # note bank food/loot, trade all to jacklove1
 *   bun bots/quests/abg-food-mule.ts jacklove1 relay           # pack everything, walk to Ardougne → ABGARMY01
 *   bun bots/quests/abg-food-mule.ts ABGARMY01 receive jacklove1
 *   bun bots/quests/abg-food-mule.ts ABGARMY01 mule ABGARMY07,ABGARMY08
 *
 * Legacy (per-squad): jackloveN mule + ABG receive jackloveN — prefer abg-food-hub.sh.
 */
import { appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runScript } from '../../sdk/runner';

const FOOD = /^(cod|bass|tuna|swordfish|lobster|shark|jug of wine)$/i;
const FOOD_NAMES = ['cod', 'bass', 'tuna', 'swordfish', 'lobster', 'shark', 'jug of wine'] as const;
/** Casket opens, oyster banks, and other treasure — not cooked fish. */
const LOOT =
    /^(coins|uncut (?:sapphire|emerald|ruby|diamond)|(?:cosmic|nature) talisman|half of a key|(?:oyster|clam)s?)$/i;
const CARGO =
    /^(cod|bass|tuna|swordfish|lobster|shark|coins|uncut (?:sapphire|emerald|ruby|diamond)|(?:cosmic|nature) talisman|half of a key|(?:oyster|clam)s?)$/i;
const CATHERBY_BANK = { x: 2808, z: 3443 };
const ARDOUGNE_BANK = { x: 2655, z: 3283 };
const ARDOUGNE_MARKET = { x: 2662, z: 3312 };
const CATHERBY_PIER = { x: 2837, z: 3431 };
const RANGING_GUILD_DOOR = { x: 2658, z: 3439 };
const PIER_TO_BANK = [
    { x: 2832, z: 3438 },
    { x: 2818, z: 3442 },
    { x: 2808, z: 3443 }
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
const CATHERBY_TO_ARDY = [...ARDY_TO_CATHERBY].reverse();

const FISH_HUB = 'jacklove1';
const THIEF_HUB = 'ABGARMY01';
const FISH_GIVERS = /^Jacklove(?!1$)\d+$/i;
const HUB_FEED_TARGETS = [
    'ABGARMY02',
    'ABGARMY03',
    'ABGARMY04',
    'ABGARMY05',
    'ABGARMY07',
    'ABGARMY08',
    'ABGARMY09',
    'ABGARMY10',
    'ABGARMY11',
    'ABGARMY12',
    'ABGARMY13',
    'ABGARMY14',
    'ABGARMY15',
    'ABGARMY16',
    'ABGARMY17',
    'ABGARMY18',
    'ABGARMY19',
    'ABGARMY20',
    'Jackpoo3',
    'fatpig'
];

const MULES: Record<string, { from: RegExp; targets: string[] }> = {
    jacklove1: {
        from: /^Jacklove1$/i,
        targets: ['ABGARMY01', 'ABGARMY02', 'ABGARMY03', 'ABGARMY04', 'ABGARMY05']
    },
    jacklove2: {
        from: /^Jacklove2$/i,
        targets: ['ABGARMY07', 'ABGARMY08', 'ABGARMY09', 'ABGARMY10']
    },
    jacklove3: {
        from: /^Jacklove3$/i,
        targets: ['ABGARMY11', 'ABGARMY12', 'ABGARMY13', 'ABGARMY14', 'ABGARMY15']
    },
    jacklove4: {
        from: /^Jacklove4$/i,
        targets: ['ABGARMY16', 'ABGARMY17', 'ABGARMY18', 'ABGARMY19', 'ABGARMY20']
    },
    jacklove5: {
        from: /^Jacklove5$/i,
        targets: ['Jackpoo3', 'fatpig']
    },
    jacklove6: {
        from: /^Jacklove6$/i,
        targets: ['ABGARMY01', 'ABGARMY02', 'ABGARMY03', 'ABGARMY04', 'ABGARMY05']
    },
    jacklove7: {
        from: /^Jacklove7$/i,
        targets: ['ABGARMY07', 'ABGARMY08', 'ABGARMY09', 'ABGARMY10']
    },
    jacklove8: {
        from: /^Jacklove8$/i,
        targets: ['ABGARMY11', 'ABGARMY12', 'ABGARMY13', 'ABGARMY14', 'ABGARMY15']
    },
    jacklove9: {
        from: /^Jacklove9$/i,
        targets: ['ABGARMY16', 'ABGARMY17', 'ABGARMY18', 'ABGARMY19', 'ABGARMY20']
    },
    jacklove10: {
        from: /^Jacklove10$/i,
        targets: ['Jackpoo3', 'fatpig']
    },
    jacklove11: {
        from: /^Jacklove11$/i,
        targets: ['ABGARMY01', 'ABGARMY02', 'ABGARMY03', 'ABGARMY04', 'ABGARMY05']
    },
    jacklove12: {
        from: /^Jacklove12$/i,
        targets: ['ABGARMY07', 'ABGARMY08', 'ABGARMY09', 'ABGARMY10']
    },
    jacklove13: {
        from: /^Jacklove13$/i,
        targets: ['ABGARMY11', 'ABGARMY12', 'ABGARMY13', 'ABGARMY14', 'ABGARMY15']
    },
    jacklove14: {
        from: /^Jacklove14$/i,
        targets: ['ABGARMY16', 'ABGARMY17', 'ABGARMY18', 'ABGARMY19', 'ABGARMY20']
    },
    jacklove15: {
        from: /^Jacklove15$/i,
        targets: ['Jackpoo3', 'fatpig']
    },
    jacklove16: {
        from: /^Jacklove16$/i,
        targets: ['ABGARMY01', 'ABGARMY02', 'ABGARMY03', 'ABGARMY04', 'ABGARMY05']
    },
    jacklove17: {
        from: /^Jacklove17$/i,
        targets: ['ABGARMY07', 'ABGARMY08', 'ABGARMY09', 'ABGARMY10']
    },
    jacklove18: {
        from: /^Jacklove18$/i,
        targets: ['ABGARMY11', 'ABGARMY12', 'ABGARMY13', 'ABGARMY14', 'ABGARMY15']
    },
    jacklove19: {
        from: /^Jacklove19$/i,
        targets: ['ABGARMY16', 'ABGARMY17', 'ABGARMY18', 'ABGARMY19', 'ABGARMY20']
    },
    jacklove20: {
        from: /^Jacklove20$/i,
        targets: ['Jackpoo3', 'fatpig']
    },
    abgarmy01: {
        from: /^ABGARMY01$/i,
        targets: HUB_FEED_TARGETS
    },
    fatpig: {
        from: /^fatpig$/i,
        targets: [
            'ABGARMY02',
            'ABGARMY03',
            'ABGARMY04',
            'ABGARMY05',
            'ABGARMY08',
            'ABGARMY09',
            'ABGARMY10',
            'ABGARMY13',
            'ABGARMY14',
            'ABGARMY15',
            'ABGARMY16',
            'ABGARMY17',
            'ABGARMY18',
            'ABGARMY20'
        ]
    },
    jackpoo3: {
        from: /^Jackpoo3$/i,
        targets: ['fatpig']
    }
};

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const botName = args[0] ?? '';
const roleArg = (args[1] ?? '').toLowerCase();
/** Optional: ABGARMY08,ABGARMY10 — only trade these (must be in mule's squad, except dump-to-01). */
const targetOverride = (args[2] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^(ABGARMY\d+|Jackpoo3|fatpig)$/i.test(s))
    .map((s) => (/^ABGARMY/i.test(s) ? s.toUpperCase() : s));
const GRIND_LOG = join(process.cwd(), 'bots', botName, 'grind.log');

function muleForAbg(name: string): string | null {
    const want = name.toLowerCase();
    for (const [mule, cfg] of Object.entries(MULES)) {
        if (cfg.targets.some((t) => t.toLowerCase() === want)) return mule;
    }
    return null;
}

type FoodRole = 'mule' | 'receive' | 'collect' | 'give' | 'fish-collect' | 'relay';

function inferRole(name: string): FoodRole {
    if (/^jacklove([2-9]|1[0-9]|20)$/i.test(name)) return 'give';
    if (/^jacklove1$/i.test(name)) return 'fish-collect';
    if (/^(ABGARMY01|fatpig|Jackpoo3)$/i.test(name) && targetOverride.length > 0) return 'mule';
    if (/^ABGARMY\d+$/i.test(name) || /^(Jackpoo3|fatpig)$/i.test(name)) return 'receive';
    throw new Error(
        `Usage: bun bots/quests/abg-food-mule.ts {jacklove1-20|ABGARMYxx|Jackpoo3|fatpig} [give|fish-collect|relay|mule|receive|collect] [targets|fromMule]`
    );
}

const role: FoodRole =
    roleArg === 'mule' ||
    roleArg === 'receive' ||
    roleArg === 'collect' ||
    roleArg === 'give' ||
    roleArg === 'fish-collect' ||
    roleArg === 'relay'
        ? roleArg
        : inferRole(botName);
const receiveFromMule = role === 'receive' ? (args[2] ?? '').trim() : '';

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
    const countFood = () =>
        sdk.getInventory().filter((i) => FOOD.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
    const lootStacks = () => sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && LOOT.test(i.name));
    const countLoot = () => lootStacks().reduce((n, i) => n + (i.count ?? 1), 0);
    const countCargo = () => countFood() + countLoot();
    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lootSummary = () =>
        lootStacks()
            .map((i) => `${i.count} ${i.name}`)
            .join(', ') || 'none';
    const cargoSummary = () => {
        const parts = [foodSummary(), lootSummary()].filter((s) => s !== 'none');
        return parts.join(' | ') || 'none';
    };
    const foodSummary = () => {
        const parts: string[] = [];
        for (const name of FOOD_NAMES) {
            const n = sdk
                .getInventory()
                .filter((i) => new RegExp(`^${name}$`, 'i').test(i.name))
                .reduce((s, i) => s + (i.count ?? 1), 0);
            if (n > 0) parts.push(`${n} ${name}`);
        }
        return parts.join(', ') || 'none';
    };
    const foodGiveAll = () =>
        FOOD_NAMES.map((name) => {
            const count = sdk
                .getInventory()
                .filter((i) => new RegExp(`^${name}$`, 'i').test(i.name))
                .reduce((s, i) => s + (i.count ?? 1), 0);
            return { name, count, item: new RegExp(`^${name}$`, 'i') };
        })
            .filter((s) => s.count > 0)
            .map(({ item, count }) => ({ item, amount: count }));
    const lootGiveAll = () => {
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
    const cargoGiveAll = () => [...foodGiveAll(), ...lootGiveAll()];
    const usesCatherbyBank = () => role === 'give' || role === 'fish-collect' || role === 'relay';

    async function closeUi() {
        if (sdk.getTradeState().isOpen) await bot.declineTrade().catch(() => {});
        for (let i = 0; i < 8; i++) {
            const dialog = sdk.getDialog();
            if (!dialog?.isOpen) break;
            const cont = dialog.options?.find((o) => /continue|click here/i.test(o.text));
            if (cont) {
                log(`Dismissing dialog: ${cont.text}`);
                await sdk.clickDialogByText(/continue|click here/i).catch(() => sdk.sendClickDialog(cont.index));
            } else if ((dialog.options?.length ?? 0) <= 1) {
                await sdk.sendClickDialog(dialog.options?.[0]?.index ?? 0);
            } else {
                break;
            }
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
        log(`walkTo(${x},${z}): ${r.success ? 'ok' : r.message} @ ${pos().x},${pos().z}`);
        return r.success || distTo(x, z) <= tolerance + 2;
    }

    async function walkWaypoints(wps: { x: number; z: number }[]): Promise<void> {
        const dest = wps[wps.length - 1]!;
        for (const wp of wps) {
            if (distTo(dest.x, dest.z) <= 8) return;
            const remaining = distTo(dest.x, dest.z);
            const via = Math.hypot(wp.x - dest.x, wp.z - dest.z);
            if (via >= remaining - 6) continue;
            if (distTo(wp.x, wp.z) <= 8) continue;
            log(`Waypoint ${wp.x},${wp.z} @ ${pos().x},${pos().z}`);
            await sdk.sendWalk(wp.x, wp.z, true);
            await sdk.waitForCondition(() => distTo(wp.x, wp.z) <= 12, 20_000).catch(() => {});
        }
        if (distTo(dest.x, dest.z) > 6) {
            await sdk.sendWalk(dest.x, dest.z, true);
            await sdk.waitForCondition(() => distTo(dest.x, dest.z) <= 8, 25_000).catch(() => {});
        }
    }

    async function stepOffHouseDoor(): Promise<void> {
        const p = pos();
        if (p.x !== 2672 || p.z < 3304 || p.z > 3312) return;
        log(`Stepping west off house door @ ${p.x},${p.z}`);
        await sdk.sendWalk(2669, 3311, true);
        await sdk.waitForTicks(3);
        if (pos().x === 2672) await walkNear(2669, 3311, 1);
    }

    async function goToMarket(): Promise<void> {
        const p = pos();
        if (p.z >= 3520 && p.x >= 2940 && p.x <= 3400) {
            log(`In wilderness @ ${p.x},${p.z} — waiting to reach Ardougne (no pathfind)`);
            await sdk
                .waitForCondition(
                    (s) => {
                        const x = s.player?.worldX ?? 0;
                        const z = s.player?.worldZ ?? 0;
                        return x > 2500 && x < 2750 && z > 3240 && z < 6400;
                    },
                    20 * 60_000
                )
                .catch(() => {});
        }
        await leaveRangingGuild();
        await stepOffHouseDoor();
        log(`Walking to Ardougne market @ ${pos().x},${pos().z}`);
        await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 6);
        if (distTo(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z) > 12) {
            await leaveRangingGuild();
            await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 6);
        }
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

    async function freeInvAtArdougneBank(): Promise<void> {
        const used = sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
        const empty = 28 - used;
        if (empty >= 4) return;
        log(`Freeing inventory at Ardougne bank (${empty} empty)`);
        await walkNear(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
        const opened = await bot.openBank();
        if (!opened.success && !sdk.getState()?.bank?.isOpen) {
            log(`Bank open failed: ${opened.message}`);
            return;
        }
        await depositAll();
        await bot.closeBank();
    }

    function findSquadPlayer(name: string) {
        const want = name.toLowerCase();
        return sdk.getNearbyPlayers()?.find((p) => p.name.toLowerCase() === want) ?? null;
    }

    async function waitForTarget(name: string, ms = 120_000): Promise<boolean> {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
            if (findSquadPlayer(name)) return true;
            log(`${name} not at market yet — waiting`);
            await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 6);
            await sdk.waitForTicks(3);
        }
        return !!findSquadPlayer(name);
    }

    async function openNearbyDoors(): Promise<void> {
        for (let i = 0; i < 3; i++) {
            const door = sdk.findNearbyLoc(/^(door|gate)$/i, { withOption: /open/i });
            if (!door || (door.distance ?? 99) > 3) break;
            const opt = door.optionsWithIndex?.find((o) => /^open$/i.test(o.text));
            log(`Opening ${door.name} @ ${door.x},${door.z} opt=${opt?.opIndex ?? 1}`);
            await sdk.sendInteractLoc(door.x, door.z, door.id, opt?.opIndex ?? 1);
            await sdk.waitForTicks(2);
            await sdk.sendWalk(door.x, door.z, true);
            await sdk.waitForTicks(3);
            if (distTo(door.x, door.z) <= 1 && sdk.findNearbyLoc(/^(door|gate)$/i, { withOption: /open/i })) {
                // still inside — step west/south toward the bank
                await sdk.sendWalk(door.x - 1, door.z, true);
                await sdk.waitForTicks(3);
            }
        }
    }

    async function openCatherbyBank(): Promise<boolean> {
        if (sdk.getState()?.bank?.isOpen) return true;
        await openNearbyDoors();
        if (distTo(CATHERBY_BANK.x, CATHERBY_BANK.z) > 10) {
            log(`Rushing pier → bank @ ${pos().x},${pos().z}`);
            await walkWaypoints(PIER_TO_BANK);
        }
        await walkNear(CATHERBY_BANK.x, CATHERBY_BANK.z, 3);
        for (let i = 0; i < 4; i++) {
            if (sdk.getState()?.bank?.isOpen) return true;
            const r = await bot.openBank();
            log(`openBank ${r.success ? 'ok' : r.message} @ ${pos().x},${pos().z}`);
            if (r.success || sdk.getState()?.bank?.isOpen) return true;
            await sdk.waitForTicks(2);
        }
        return !!sdk.getState()?.bank?.isOpen;
    }

    async function openArdougneBank(): Promise<boolean> {
        if (sdk.getState()?.bank?.isOpen) return true;
        await walkNear(ARDOUGNE_BANK.x, ARDOUGNE_BANK.z, 3);
        for (let i = 0; i < 4; i++) {
            if (sdk.getState()?.bank?.isOpen) return true;
            const r = await bot.openBank();
            log(`openBank ${r.success ? 'ok' : r.message} @ ${pos().x},${pos().z}`);
            if (r.success || sdk.getState()?.bank?.isOpen) return true;
            await sdk.waitForTicks(2);
        }
        return !!sdk.getState()?.bank?.isOpen;
    }

    async function depositAll(keep?: RegExp): Promise<void> {
        for (let i = 0; i < 40; i++) {
            const item = sdk
                .getInventory()
                .find((it) => (it.count ?? 0) > 0 && !(keep && keep.test(it.name)));
            if (!item) break;
            const r = await bot.depositItem(item, -1);
            if (!r.success && !r.partial) break;
        }
    }

    async function noteBankFood(): Promise<number> {
        await closeUi();
        const already = countFood();
        const jackloveMule = /^jacklove\d+$/i.test(botName) && role === 'mule';
        const ardyMule = /^(ABGARMY01|fatpig|Jackpoo3)$/i.test(botName);
        const atArdyMarket = distTo(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z) <= 15;
        const atCatherby = usesCatherbyBank() || (!ardyMule && /^jacklove\d+$/i.test(botName) && role !== 'mule');
        // Jackloves with a full note stack: skip bank and walk straight to Ardougne (legacy mule only).
        if (already >= 50 && jackloveMule) {
            log(`Already packed notes: ${foodSummary()} — skipping bank, heading to Ardougne`);
            return already;
        }
        if (already >= 50 && role === 'relay') {
            log(`Already packed notes: ${foodSummary()} — topping up from bank before relay`);
        }
        // fatpig: always bank-pack so a dump sitting in inventory is merged with the bank pile.
        if (already >= 50 && (ardyMule || atArdyMarket) && !/^fatpig$/i.test(botName) && !atCatherby) {
            log(`Already packed notes: ${foodSummary()} — skipping bank`);
            return already;
        }
        if (already >= 50 && !atCatherby) log(`Already packed notes: ${foodSummary()} — topping up from bank`);
        else if (already >= 50) log(`Already packed notes: ${foodSummary()} — topping up from bank`);
        else log(`Walking to ${atCatherby ? 'Catherby' : 'Ardougne'} bank to note food @ ${pos().x},${pos().z}`);
        const opened = atCatherby ? await openCatherbyBank() : await openArdougneBank();
        if (!opened) {
            log(`Could not open ${atCatherby ? 'Catherby' : 'Ardougne'} bank`);
            return already;
        }
        await depositAll();
        const bankState = sdk.getState()?.bank;
        if (!bankState?.noteMode) {
            log(`Clicking bank note toggle @ ${pos().x},${pos().z}`);
            await sdk.sendClickComponent(5386);
            await sdk.waitForTicks(2);
        } else {
            log('Bank already in note mode');
        }
        for (const name of FOOD_NAMES) {
            const re = new RegExp(`^${name}$`, 'i');
            const bankItem = sdk.findBankItem(re);
            if (!bankItem || (bankItem.count ?? 0) <= 0) continue;
            const before = countFood();
            const r = await sdk.sendBankWithdraw(bankItem.slot, -1);
            await sdk.waitForCondition(() => countFood() > before, 3_000).catch(() => {});
            log(`Withdraw ${name} x${bankItem.count} ${r.success ? 'ok' : r.message} now=${foodSummary()}`);
        }
        await bot.closeBank();
        log(`Packed food notes: ${foodSummary()}`);
        return countFood();
    }

    async function noteBankLoot(): Promise<number> {
        await closeUi();
        const atCatherby = usesCatherbyBank() || /^jacklove\d+$/i.test(botName);
        log(`Noting bank loot @ ${pos().x},${pos().z}`);
        const opened = atCatherby ? await openCatherbyBank() : await openArdougneBank();
        if (!opened) {
            log(`Could not open bank for loot`);
            return countLoot();
        }
        // Keep already-packed food notes. depositAll() here used to dump the
        // fish pile back into the bank, so the Ardougne relay walked in with
        // 110 coins and ABGARMY01 stayed empty.
        await depositAll(FOOD);
        const bankState = sdk.getState()?.bank;
        if (!bankState?.noteMode) {
            await sdk.sendClickComponent(5386);
            await sdk.waitForTicks(2);
        }
        const wanted = (sdk.getBankItems() ?? []).filter((i) => (i.count ?? 0) > 0 && LOOT.test(i.name));
        log(`Bank loot: ${wanted.map((i) => `${i.count} ${i.name}`).join(', ') || 'none'}`);
        for (const item of wanted) {
            const re = new RegExp(`^${escapeRegex(item.name)}$`, 'i');
            const before = countLoot();
            const r = await bot.withdrawItem(re, -1, { asNote: true });
            if (!r.success) await bot.withdrawItem(re, -1).catch(() => {});
            await sdk.waitForCondition(() => countLoot() > before, 3_000).catch(() => {});
            log(`Noted loot ${item.name} x${item.count} ${r.success ? 'ok' : 'fallback'}`);
        }
        await bot.closeBank();
        log(`Packed loot notes: ${lootSummary()}`);
        return countLoot();
    }

    function computeShares(nTargets: number) {
        const give: { item: RegExp; amount: number; name: string }[] = [];
        for (const name of FOOD_NAMES) {
            const total = sdk
                .getInventory()
                .filter((i) => new RegExp(`^${name}$`, 'i').test(i.name))
                .reduce((s, i) => s + (i.count ?? 1), 0);
            const amount = Math.floor(total / nTargets);
            if (amount >= 1) {
                give.push({
                    name,
                    amount,
                    item: new RegExp(`^${name}$`, 'i')
                });
            }
        }
        return give;
    }

    async function bankCargoNotes(): Promise<void> {
        if (countCargo() === 0) return;
        if (!(await openCatherbyBank())) return;
        for (const item of sdk.getInventory().filter((i) => (i.count ?? 0) > 0 && CARGO.test(i.name))) {
            await bot.depositItem(item, -1).catch(() => {});
        }
        await bot.closeBank();
        log(`Banked cargo notes for space @ ${pos().x},${pos().z}`);
    }

    async function packAllBankCargo(): Promise<number> {
        await noteBankFood();
        await noteBankLoot();
        log(`Packed cargo notes: ${cargoSummary()}`);
        return countCargo();
    }

    async function noteBankCargo(): Promise<number> {
        await closeUi();
        if (!(await openCatherbyBank())) return countCargo();
        await depositAll();
        const bankState = sdk.getState()?.bank;
        if (!bankState?.noteMode) {
            await sdk.sendClickComponent(5386);
            await sdk.waitForTicks(2);
        }
        for (const name of FOOD_NAMES) {
            const bankItem = sdk.findBankItem(new RegExp(`^${name}$`, 'i'));
            if (!bankItem || (bankItem.count ?? 0) <= 0) continue;
            const before = countFood();
            await sdk.sendBankWithdraw(bankItem.slot, -1);
            await sdk.waitForCondition(() => countFood() > before, 3_000).catch(() => {});
        }
        for (const item of (sdk.getBankItems() ?? []).filter((i) => (i.count ?? 0) > 0 && LOOT.test(i.name))) {
            const re = new RegExp(`^${escapeRegex(item.name)}$`, 'i');
            const before = countLoot();
            const r = await bot.withdrawItem(re, -1, { asNote: true });
            if (!r.success) await bot.withdrawItem(re, -1).catch(() => {});
            await sdk.waitForCondition(() => countLoot() > before, 3_000).catch(() => {});
        }
        await bot.closeBank();
        log(`Packed cargo notes: ${cargoSummary()}`);
        return countCargo();
    }

    async function tradeAllToHub(label: string, kind: 'food' | 'loot' | 'cargo'): Promise<boolean> {
        await walkNear(CATHERBY_BANK.x, CATHERBY_BANK.z, 4);
        const deadline = Date.now() + 8 * 60_000;
        while (Date.now() < deadline) {
            const offer =
                kind === 'cargo' ? cargoGiveAll() : kind === 'food' ? foodGiveAll() : lootGiveAll();
            if (offer.length === 0) return true;
            const result = await bot.trade(label, {
                give: offer,
                want: [],
                requestTimeout: 25_000,
                timeout: 60_000,
                retryOnBusy: true
            });
            log(`Trade ${label} (${kind}) ${result.success ? 'ok' : result.reason} | leftover ${cargoSummary()}`);
            if (
                result.success &&
                (kind === 'cargo'
                    ? countCargo() === 0
                    : kind === 'food'
                      ? countFood() === 0
                      : countLoot() === 0)
            ) {
                return true;
            }
            await walkNear(CATHERBY_BANK.x, CATHERBY_BANK.z, 4);
            await sdk.waitForTicks(2);
        }
        return kind === 'cargo' ? countCargo() === 0 : kind === 'food' ? countFood() === 0 : countLoot() === 0;
    }

    async function runGive(): Promise<void> {
        const packed = await noteBankCargo();
        if (packed > 0) await tradeAllToHub(FISH_HUB, 'cargo');
        else log('No cooked food or casket/oyster loot notes in bank');
        log('Returning to Catherby pier for fishing');
        await walkNear(CATHERBY_PIER.x, CATHERBY_PIER.z, 6);
        log(`Give done leftover ${cargoSummary()} @ ${pos().x},${pos().z}`);
    }

    async function runFishCollect(): Promise<void> {
        await walkNear(CATHERBY_BANK.x, CATHERBY_BANK.z, 4);
        log('At Catherby bank — accepting food + loot from fishers');
        let trades = 0;
        let idleRounds = 0;
        const deadline = Date.now() + 40 * 60_000;
        while (Date.now() < deadline && trades < 22) {
            const used = sdk.getInventory().filter((i) => (i.count ?? 0) > 0).length;
            if (28 - used < 3 && countCargo() > 0) {
                log('Inventory tight — banking cargo notes');
                await closeUi();
                await bankCargoNotes();
            }
            const served = await bot.serveTrades({
                from: FISH_GIVERS,
                give: [],
                want: [{ item: CARGO, amount: 1 }],
                maxTrades: 1,
                timeout: 75_000,
                tradeTimeout: 90_000
            });
            if (served.trades.some((t) => t.success)) {
                trades++;
                idleRounds = 0;
                log(`Collect trade ${trades} ok | now ${cargoSummary()}`);
                continue;
            }
            idleRounds++;
            // Stay until the wave timeout covers all 19 givers — do not leave
            // after a few idle serveTrades rounds (gaps between waves are ~3 min).
            if (trades >= 19 && idleRounds >= 2) break;
            await walkNear(CATHERBY_BANK.x, CATHERBY_BANK.z, 4);
            await sdk.waitForTicks(2);
        }
        await closeUi();
        await packAllBankCargo();
        log(`Fish-collect done ${trades} trades | packed ${cargoSummary()}`);
    }

    async function runRelay(): Promise<void> {
        const packed = await packAllBankCargo();
        if (packed <= 0) {
            log('No food or loot notes to relay');
            return;
        }
        log(`Relay → ${THIEF_HUB}: ${cargoSummary()}`);
        if (distTo(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z) > 10) {
            await walkWaypoints(CATHERBY_TO_ARDY);
            await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 5);
        }
        const deadline = Date.now() + 25 * 60_000;
        while (Date.now() < deadline && countCargo() > 0) {
            const give = cargoGiveAll();
            if (give.length === 0) break;
            if (!findSquadPlayer(THIEF_HUB)) {
                log(`${THIEF_HUB} not at market — waiting`);
                await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 5);
                await sdk.waitForTicks(3);
                continue;
            }
            const result = await bot.trade(THIEF_HUB, {
                give,
                want: [],
                requestTimeout: 25_000,
                timeout: 90_000,
                retryOnBusy: true
            });
            log(`Relay trade ${THIEF_HUB} ${result.success ? 'ok' : result.reason} | leftover ${cargoSummary()}`);
            await sdk.waitForTicks(1);
        }
        log('Returning to Catherby pier for fishing');
        await walkWaypoints(ARDY_TO_CATHERBY);
        await walkNear(CATHERBY_PIER.x, CATHERBY_PIER.z, 6);
        log(`Relay done leftover ${cargoSummary()} @ ${pos().x},${pos().z}`);
    }

    async function runMule(): Promise<void> {
        if (/^jacklove([2-9]|1[0-9]|20)$/i.test(botName)) {
            throw new Error(`${botName} should use give at Catherby (hub ${FISH_HUB}), not mule`);
        }
        if (/^jacklove1$/i.test(botName) && targetOverride.length === 1 && /^ABGARMY01$/i.test(targetOverride[0]!)) {
            await runRelay();
            return;
        }
        const cfg = MULES[botName.toLowerCase()];
        const dumpTo01 =
            /^jacklove[1-5]$/i.test(botName) &&
            targetOverride.length === 1 &&
            /^ABGARMY01$/i.test(targetOverride[0]!);
        if (!cfg && !dumpTo01) throw new Error(`${botName} is not a food mule (use jacklove1-5, ABGARMY01, fatpig, or Jackpoo3)`);

        let targets = cfg?.targets ?? ['ABGARMY01'];
        if (dumpTo01) {
            targets = ['ABGARMY01'];
            log('Dumping all food notes to ABGARMY01');
        } else if (targetOverride.length > 0) {
            const allowed = cfg?.targets ?? targetOverride;
            targets = targetOverride.filter((t) => allowed.some((s) => s.toLowerCase() === t.toLowerCase()));
            if (targets.length === 0) throw new Error(`No valid targets in ${botName} squad: ${targetOverride.join(', ')}`);
            log(`Trading subset only: ${targets.join(', ')}`);
        }

        const packed = await noteBankFood();
        if (packed <= 0) {
            log('No cooked cod/bass/tuna/swordfish/lobster/shark notes in bank — cook/deposit first');
            return;
        }

        const shares = computeShares(targets.length);
        if (shares.length === 0) {
            log('Not enough food notes for a split');
            return;
        }
        log(`Split plan (${targets.length}-way): ${shares.map((s) => `${s.amount} ${s.name}`).join(', ')}`);

        if (distTo(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z) > 10) {
            log(`Walking to Ardougne market for ${targets.length} ABG trades`);
            if (!/^(ABGARMY01|fatpig|Jackpoo3)$/i.test(botName) && /^jacklove\d+$/i.test(botName))
                await walkWaypoints(CATHERBY_TO_ARDY);
            await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 5);
        }
        await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 5);

        const remaining = [...targets];
        const squadDeadline = Date.now() + 16 * 60_000;
        while (remaining.length > 0 && Date.now() < squadDeadline) {
            let traded = false;
            for (const target of [...remaining]) {
                const player = findSquadPlayer(target);
                if (!player) continue;
                const give = shares.map(({ item, amount }) => ({ item, amount }));
                log(`Trade ${player.name}: ${shares.map((s) => `${s.amount} ${s.name}`).join(', ')}`);
                const result = await bot.trade(player.name, {
                    give,
                    want: [],
                    requestTimeout: 20_000,
                    timeout: 60_000,
                    retryOnBusy: true
                });
                log(`Trade ${player.name} ${result.success ? 'ok' : result.reason} ${result.message}`);
                if (result.success) {
                    remaining.splice(remaining.indexOf(target), 1);
                    traded = true;
                }
                await sdk.waitForTicks(1);
            }
            if (remaining.length === 0) break;
            log(`Still waiting for: ${remaining.join(', ')}`);
            await walkNear(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z, 5);
            await sdk.waitForTicks(3);
        }
        if (remaining.length > 0) {
            log(`WARN missed trade partners (retry next round): ${remaining.join(', ')}`);
            try {
                const missPath = join(import.meta.dir, '..', botName, 'missed-trades.json');
                writeFileSync(missPath, JSON.stringify({ at: Date.now(), missed: remaining }, null, 2));
            } catch {
                /* best effort */
            }
        }

        if (/^(ABGARMY01|fatpig|Jackpoo3)$/i.test(botName)) {
            log(`Mule done leftover ${foodSummary()} @ ${pos().x},${pos().z}`);
            return;
        }
        if (!/^jacklove\d+$/i.test(botName)) return;
        log('Returning to Catherby pier for fishing');
        await walkNear(CATHERBY_PIER.x, CATHERBY_PIER.z, 6);
        log(`Mule done leftover ${foodSummary()} @ ${pos().x},${pos().z}`);
    }

    async function runReceive(
        from: RegExp,
        muleLabel: string,
        maxTrades: number,
        acceptCargo = false
    ): Promise<void> {
        await closeUi();
        await stepOffHouseDoor();
        log(`Receive start @ ${pos().x},${pos().z} — waiting for ${muleLabel}${acceptCargo ? ' (food+loot)' : ''}`);
        await leaveRangingGuild();
        await freeInvAtArdougneBank();
        if (distTo(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z) > 8) await goToMarket();
        if (distTo(ARDOUGNE_MARKET.x, ARDOUGNE_MARKET.z) > 12) {
            log(`Still not at market @ ${pos().x},${pos().z} — not accepting yet`);
            await goToMarket();
        }
        log(`At market @ ${pos().x},${pos().z} — accepting trade from ${muleLabel}`);

        const wantItem = acceptCargo ? CARGO : FOOD;
        const served = await bot.serveTrades({
            from,
            give: [],
            want: [{ item: wantItem, amount: 1 }],
            maxTrades,
            timeout: 25 * 60_000,
            tradeTimeout: 60_000
        });
        const last = served.trades[served.trades.length - 1];
        log(
            `Receive ${last?.success ? 'ok' : last?.reason ?? served.reason} ${served.message} | got ${acceptCargo ? cargoSummary() : foodSummary()}`
        );
    }

    await closeUi();
    await stepOffHouseDoor();
    log(`ABG food ${role} start @ ${pos().x},${pos().z}`);
    if (role === 'give') await runGive();
    else if (role === 'fish-collect') await runFishCollect();
    else if (role === 'relay') await runRelay();
    else if (role === 'mule') await runMule();
    else if (role === 'collect') await runReceive(/^Jacklove1$/i, FISH_HUB, 12, true);
    else {
        if (/^jacklove\d+$/i.test(receiveFromMule)) {
            const escaped = receiveFromMule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const hubRelay = /^jacklove1$/i.test(receiveFromMule);
            await runReceive(new RegExp(`^${escaped}$`, 'i'), receiveFromMule, hubRelay ? 12 : 1, hubRelay);
        } else if (targetOverride[0]) {
            const fromName = targetOverride[0]!;
            const escaped = fromName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            await runReceive(new RegExp(`^${escaped}$`, 'i'), fromName, 1);
        } else {
            const muleKey = muleForAbg(botName);
            if (!muleKey) throw new Error(`${botName} is not in an ABG food squad`);
            await runReceive(MULES[muleKey]!.from, muleKey, 1);
        }
    }
});
