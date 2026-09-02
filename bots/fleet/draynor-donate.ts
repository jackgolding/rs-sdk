/**
 * Bank everything locally, walk to Draynor bank empty, then trade noted
 * resources to Jackthief in repeated trips.
 *
 *   bun bots/fleet/draynor-donate.ts Jackpoo2
 */
import { runScript } from '../../sdk/runner';
import type { BotSDK } from '../../sdk/index';
import type { BotActions } from '../../sdk/actions';
import type { TradeItemSpec } from '../../sdk/types';
import { appendFileSync } from 'fs';
import { join } from 'path';

const DRAYNOR_BANK = { x: 3092, z: 3243 };
const MULE = /jackthief/i;

/** Major banks — sorted by distance when reaching one before travel. */
const BANKS = [
    { x: 3092, z: 3243, name: 'Draynor' },
    { x: 3253, z: 3420, name: 'Varrock east' },
    { x: 3185, z: 3436, name: 'Varrock west' },
    { x: 2726, z: 3485, name: 'Seers' },
    { x: 2946, z: 3368, name: 'Falador west' },
    { x: 3012, z: 3351, name: 'Falador east' },
    { x: 2655, z: 3283, name: 'Ardougne' },
    { x: 2860, z: 3427, name: 'Catherby' },
    { x: 3046, z: 9776, name: 'Mining guild' },
    { x: 3088, z: 3242, name: 'Draynor booth' },
];

function dist2(ax: number, az: number, bx: number, bz: number): number {
    const dx = ax - bx;
    const dz = az - bz;
    return dx * dx + dz * dz;
}

/** Ore, essence, uncut gems — not cut diamonds (those go to valuables donors). */
const MINER_LOOT =
    /pure essence|rune essence|mithril ore|adamantite ore|^coal$|^iron ore$|uncut/i;

/** Cooked food only — no raw fish. */
const COOKED_FOOD =
    /^(?!raw )(shrimps?|anchovies|sardine|herring|trout|salmon|tuna|lobster|swordfish|shark|cake|bread|meat pie|pizza|karambwan|chocolate|wine)/i;

const VALUABLES = /^(coins|blood rune|chaos rune|fire orb|diamond)$/i;
const BOWS = /^magic longbow$/i;

const ROLE_BY_BOT: Record<string, RegExp> = {
    Jackpoo2: MINER_LOOT,
    Jackpoo4: MINER_LOOT,
    Jackpoo5: MINER_LOOT,
    jacklove1: COOKED_FOOD,
    jacklove2: COOKED_FOOD,
    jacklove3: COOKED_FOOD,
    jacklove4: COOKED_FOOD,
    jacklove5: COOKED_FOOD,
    Jackpoo3: VALUABLES,
    fatpig: VALUABLES,
    Fatpig: VALUABLES,
    Jackpoo1: BOWS,
};

function log(msg: string): void {
    const line = `${new Date().toISOString()} ${msg}`;
    console.log(line);
    const user = process.env.BOT_USERNAME;
    if (user) {
        try {
            appendFileSync(join(process.cwd(), 'bots', user, 'grind.log'), line + '\n');
        } catch {
            /* optional */
        }
    }
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildGiveSpecs(sdk: BotSDK, pattern: RegExp): TradeItemSpec[] {
    const seen = new Set<number>();
    const specs: TradeItemSpec[] = [];
    for (const item of sdk.getInventory()) {
        if (!pattern.test(item.name)) continue;
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        specs.push({ item: new RegExp(`^${escapeRegex(item.name)}$`, 'i'), amount: -1 });
    }
    return specs;
}

async function escapeToSurface(bot: BotActions, sdk: BotSDK): Promise<void> {
    for (let i = 0; i < 12; i++) {
        const z = sdk.getState()?.player.worldZ ?? 0;
        if (z < 5000) return;
        const ladder = sdk.findNearbyLoc(/ladder/i, { reachable: true });
        if (!ladder) break;
        log(`Climbing up from z=${z}`);
        await bot.interactLoc(ladder, /climb-up/i);
        await sdk.waitForCondition(
            s => (s.player.worldZ ?? 0) < z || Math.abs((s.player.worldZ ?? 0) - z) > 5,
            15_000
        ).catch(() => {});
    }
}

async function reachBank(bot: BotActions, sdk: BotSDK): Promise<void> {
    await escapeToSurface(bot, sdk);

    const tryOpen = async (): Promise<boolean> => {
        const opened = await bot.openBank(12_000);
        if (opened.success) {
            await bot.closeBank();
            return true;
        }
        return false;
    };

    if (await tryOpen()) return;

    const p = sdk.getState()?.player;
    if (!p) throw new Error('No player state');
    const underground = p.worldZ > 5000;
    const candidates = underground
        ? BANKS.filter(b => b.z > 5000)
        : BANKS.filter(b => b.z < 5000);
    const ordered = [...candidates].sort(
        (a, b) => dist2(p.worldX, p.worldZ, a.x, a.z) - dist2(p.worldX, p.worldZ, b.x, b.z)
    );

    for (const bank of ordered) {
        log(`Walking to ${bank.name} bank (${bank.x},${bank.z})`);
        const walk = await bot.walkTo(bank.x, bank.z, 4);
        if (!walk.success) {
            log(`walkTo ${bank.name} failed: ${walk.message}`);
            continue;
        }
        if (await tryOpen()) {
            log(`Reached ${bank.name} bank`);
            return;
        }
    }

    throw new Error('Could not reach any bank');
}

async function bankEverything(bot: BotActions, sdk: BotSDK): Promise<void> {
    await reachBank(bot, sdk);

    // Unequip before opening — wielded tools block a clean deposit pass.
    for (const eq of [...sdk.getEquipment()]) {
        await bot.unequipItem(eq.name);
    }

    let opened = await bot.openBank(20_000);
    if (!opened.success) {
        const booth = sdk.getNearbyLocs()
            .filter(l => /bank booth|bank chest/i.test(l.name) && l.optionsWithIndex.length > 0)
            .sort((a, b) => a.distance - b.distance)[0];
        if (booth) {
            await bot.walkTo(booth.x, booth.z, 1);
            opened = await bot.openBank(20_000);
        }
    }
    if (!opened.success) throw new Error(`openBank failed: ${opened.message}`);

    for (let pass = 0; pass < 12; pass++) {
        for (const eq of [...sdk.getEquipment()]) {
            await bot.unequipItem(eq.name);
        }
        for (const item of [...sdk.getInventory()]) {
            await bot.depositItem(item, -1);
        }
        if (sdk.getInventory().length === 0 && sdk.getEquipment().length === 0) break;

        // Stuck with gear on — close, unequip in the open world, retry.
        await bot.closeBank();
        for (const eq of [...sdk.getEquipment()]) {
            await bot.unequipItem(eq.name);
        }
        await sdk.waitForTicks(2).catch(() => {});
        const retry = await bot.openBank(15_000);
        if (!retry.success) break;
    }

    await bot.closeBank();

    const inv = sdk.getInventory();
    const eq = sdk.getEquipment();
    const left = [...inv, ...eq].map(i => `${i.name}x${i.count}`).join(', ') || 'empty';
    if (inv.length > 0 || eq.length > 0) {
        throw new Error(`Refusing to travel — not fully banked: ${left}`);
    }
    log('Fully banked — inventory and equipment empty');
}

function assertEmptyForTravel(sdk: BotSDK): void {
    const inv = sdk.getInventory();
    const eq = sdk.getEquipment();
    if (inv.length > 0 || eq.length > 0) {
        const left = [...inv, ...eq].map(i => `${i.name}x${i.count}`).join(', ');
        throw new Error(`Refusing to walk — still carrying: ${left}`);
    }
}

async function withdrawNotedBatch(
    bot: BotActions,
    sdk: BotSDK,
    pattern: RegExp
): Promise<number> {
    const bankItems = sdk.getState()?.bank.items.filter(i => pattern.test(i.name)) ?? [];
    if (bankItems.length === 0) return 0;

    let withdrawn = 0;
    for (const item of bankItems) {
        const free = 28 - sdk.getInventory().length;
        if (free <= 0) break;
        const res = await bot.withdrawItem(item, -1, { asNote: true });
        if (res.success) withdrawn++;
    }
    return withdrawn;
}

async function tradeBatchToMule(
    bot: BotActions,
    sdk: BotSDK,
    pattern: RegExp
): Promise<boolean> {
    const specs = buildGiveSpecs(sdk, pattern);
    if (specs.length === 0) return false;

    const result = await bot.trade(MULE, {
        give: specs,
        want: [],
        retryOnBusy: true,
        requestTimeout: 45_000,
        timeout: 120_000,
    });

    if (!result.success) {
        log(`Trade failed: ${result.message} (${result.reason ?? 'unknown'})`);
        return false;
    }

    const gave = result.gave.map(i => `${i.name}x${i.count}`).join(', ') || 'items';
    log(`Traded to Jackthief: ${gave}`);
    return true;
}

async function runDonor(bot: BotActions, sdk: BotSDK, pattern: RegExp): Promise<void> {
    const name = sdk.getState()?.player.name ?? process.env.BOT_USERNAME ?? 'bot';
    log(`Draynor donate start — ${name}`);

    if (sdk.getState()?.player.isDead) {
        log('Waiting to respawn...');
        await sdk.waitForCondition(s => !s.player.isDead, 60_000).catch(() => {});
    }

    await bankEverything(bot, sdk);
    assertEmptyForTravel(sdk);

    const p = sdk.getState()?.player;
    const atDraynor = p && dist2(p.worldX, p.worldZ, DRAYNOR_BANK.x, DRAYNOR_BANK.z) < 400;
    if (!atDraynor) {
        log('Walking to Draynor bank (verified empty)');
        assertEmptyForTravel(sdk);
        const walk = await bot.walkTo(DRAYNOR_BANK.x, DRAYNOR_BANK.z, 4);
        if (!walk.success) {
            log(`walkTo Draynor failed: ${walk.message}`);
            return;
        }
    } else {
        log('Already at Draynor — skipping travel');
    }

    let trips = 0;
    while (true) {
        const opened = await bot.openBank(15_000);
        if (!opened.success) {
            log(`openBank at Draynor failed: ${opened.message}`);
            break;
        }

        const remaining =
            sdk.getState()?.bank.items.filter(i => pattern.test(i.name)).length ?? 0;
        if (remaining === 0) {
            await bot.closeBank();
            log('No more matching items in bank — done');
            break;
        }

        const n = await withdrawNotedBatch(bot, sdk, pattern);
        await bot.closeBank();

        if (n === 0) {
            log('Could not withdraw noted items — stopping');
            break;
        }

        const traded = await tradeBatchToMule(bot, sdk, pattern);
        if (!traded) break;
        trips++;
    }

    log(`Draynor donate finished — ${trips} trade trip(s)`);
}

await runScript(async ({ bot, sdk }) => {
    const username = process.env.BOT_USERNAME ?? sdk.getState()?.player.name;
    if (!username) throw new Error('BOT_USERNAME not set');
    const pattern = ROLE_BY_BOT[username];
    if (!pattern) {
        throw new Error(`No donate role configured for ${username}`);
    }
    await runDonor(bot, sdk, pattern);
});
