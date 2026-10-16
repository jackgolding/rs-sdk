/**
 * Item supply: inventory -> own bank -> quest mule -> shop -> fail. The
 * acquisition layer for quest prep and fresh-account speedruns. Per-quest
 * bank hacks don't scale; every need flows through one chain with one
 * missing-list at the end.
 *
 * The quest mule holds QUEST_STOCK (50-100x of every quest shopping list)
 * at Draynor bank. A quester that misses bank+shop walks to Draynor, DMs
 * the mule, and receives a trade — so speedruns never source items
 * themselves while the stockpile lasts, and fall back to shops when the
 * mule is down or out of stock.
 *
 * Shop sources are hand-verified against wiki/shops (owner NPC +
 * coordinates + stock table). Unsourced items fail loudly as UNSOURCED so
 * the next author adds a verified source or a craft path — never a guess.
 */
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { TradeItem } from '../../sdk/types';
import { walkSendHops } from './movement';
import { countItems, type QuestContext } from './quest-lib';
import type { Tile } from './tiles';

export interface ShopSource {
    /** NPC name pattern for openShop. */
    npc: RegExp;
    /** Stand tile (walkSendHops target). */
    tile: Tile;
    /** Shop file this was verified against. */
    source: string;
}

export interface SupplyNeed {
    pattern: RegExp;
    count: number;
    label: string;
    /** Where to buy when inventory + bank come up short. Empty = UNSOURCED. */
    shops?: ShopSource[];
}

/** Verified shop sources (wiki/shops stock tables + coordinates). */
export const SHOP_SOURCES: Record<string, ShopSource[]> = {
    'lobster pot': [
        { npc: /^gerrant$/i, tile: { x: 3013, z: 3225 }, source: 'gerrants-fishy-business.md' },
        { npc: /^harry$/i, tile: { x: 2834, z: 3445 }, source: 'harrys-fishing-shop.md' },
    ],
    "wizard's mind bomb": [
        { npc: /^tostig$/i, tile: { x: 2906, z: 3537 }, source: 'the-toad-and-chicken.md' },
    ],
    hammer: [{ npc: /^Tostig$/i, tile: { x: 2906, z: 3537 }, source: 'the-toad-and-chicken.md' }],
    rope: [{ npc: /^arhein$/i, tile: { x: 2803, z: 3430 }, source: 'arhein-store.md' }],
    cabbage: [{ npc: /^wydin$/i, tile: { x: 3014, z: 3204 }, source: 'food-store.md' }],
    potato: [{ npc: /^wydin$/i, tile: { x: 3014, z: 3204 }, source: 'food-store.md' }],
    onion: [{ npc: /^hudo$/i, tile: { x: 2448, z: 3509 }, source: 'grand-tree-groceries.md' }],
    silk: [{ npc: /^thessalia$/i, tile: { x: 3204, z: 3417 }, source: 'thessalia-fine-clothes.md' }],
    axe: [{ npc: /^bob$/i, tile: { x: 3232, z: 3203 }, source: 'bobs-brilliant-axes.md' }],
};

/**
 * Dialogue vendors: no shop stock, items sold through chat
 * (verified in server source, not the wiki stock tables).
 */
export interface DialogSource {
    npc: RegExp;
    tile: Tile;
    /** Dialog option that buys one unit. */
    choice: RegExp;
    expect: RegExp;
    source: string;
}

export const DIALOG_SOURCES: Record<string, DialogSource[]> = {
    beer: [
        {
            npc: /bartender/i,
            tile: { x: 3226, z: 3399 },
            choice: /finest ale/i,
            expect: /^beer$/i,
            source: 'area_varrock/scripts/bartender.rs2',
        },
    ],
};

/**
 * Ground-spawn gathering: walk a small sweep and pick up matching ground
 * items. Verified spawn areas only (binary pack files hide exact tiles).
 */
export interface GatherSource {
    center: Tile;
    radius: number;
    source: string;
}

export const GATHER_SOURCES: Record<string, GatherSource[]> = {
    plank: [{ center: { x: 2969, z: 3240 }, radius: 25, source: 'wiki/items/plank.md (Rimmington spawn)' }],
};

/**
 * Quest-mule stockpile manifest: item label -> units the mule holds for
 * handoffs (50-100x of every quest shopping list: Dragon Slayer prep +
 * Fremennik pack + spares). Stock the mule by trading these over once;
 * top up from the fleet banks when a line runs low.
 */
export const QUEST_STOCK: Record<string, number> = {
    // Dragon Slayer prep.
    "wizard's mind bomb": 100,
    'unfired bowl': 100,
    'lobster pot': 50,
    plank: 300,
    nails: 1200,
    hammer: 50,
    rope: 100,
    silk: 100,
    coins: 1_000_000,
    // Fremennik pack.
    axe: 50,
    knife: 50,
    tinderbox: 50,
    'raw shark': 200,
    cabbage: 100,
    potato: 100,
    onion: 100,
    beer: 200,
    // Cooked food buffer for any quest.
    shark: 500,
    lobster: 500,
    tuna: 500,
};

/** Draynor HQ rendezvous: the mule parks at the bank, questers come to it. */
export const MULE_BANK: Tile = { x: 3092, z: 3243 };

export interface MuleOptions {
    /** Mule account name (DM target + trade partner). Omit to skip the mule. */
    mule: string;
    /** Ms to wait for the mule trade (default 5 min). */
    timeoutMs?: number;
}

export interface SupplyRequest {
    from: string;
    needs: Array<{ label: string; count: number }>;
}

/**
 * Parse a mule DM: `quest-supply <label> x<count>, <label> x<count>`.
 * Returns null when the text is not a supply request.
 */
export function parseSupplyRequest(from: string, text: string): SupplyRequest | null {
    const match = /quest-supply\s+(.+)/i.exec(text.trim());
    if (!match) return null;
    const needs: Array<{ label: string; count: number }> = [];
    for (const part of match[1]!.split(',')) {
        const item = /(.+?)\s*x\s*(\d+)\s*$/i.exec(part.trim());
        if (!item) continue;
        needs.push({ label: item[1]!.trim(), count: Number(item[2]) });
    }
    if (needs.length === 0) return null;
    return { from, needs };
}

/**
 * Mule handoff: walk to Draynor HQ, DM the request, receive the trade.
 * Returns true when every need is now held. Never throws; a missing mule
 * just means the chain continues to shops.
 */
export async function requestFromMule(
    ctx: QuestContext,
    needs: SupplyNeed[],
    opts: MuleOptions
): Promise<boolean> {
    const { sdk, bot } = ctx;
    const pending = needs.filter((n) => countItems(sdk, n.pattern) < n.count);
    if (pending.length === 0) return true;
    try {
        await walkSendHops(sdk, [MULE_BANK], MULE_BANK, 4);
        const detail = pending.map((n) => `${n.label} x${n.count - countItems(sdk, n.pattern)}`).join(', ');
        await sdk.dm(opts.mule, `quest-supply ${detail}`).catch(() => undefined);
        ctx.log(`supply: requested from ${opts.mule}: ${detail}`);
        const want = pending.map((n) => ({ item: n.pattern, amount: n.count - countItems(sdk, n.pattern) }));
        const served = await bot.serveTrades({
            from: new RegExp(`^${opts.mule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
            give: [],
            want,
            accept: (offer: TradeItem[]) =>
                pending.some((n) =>
                    (offer ?? []).some((i: TradeItem) => n.pattern.test(i.name ?? '') && (i.count ?? 0) > 0)
                ),
            maxTrades: 1,
            timeout: opts.timeoutMs ?? 5 * 60_000,
            tradeTimeout: 90_000,
            rejectAfterMs: 60_000,
        } as never);
        const got = served && (served as { trades?: unknown[] }).trades?.length;
        ctx.log(`supply: mule trade ${got ? 'received' : 'timed out'} (${opts.mule})`);
        return pending.every((n) => countItems(sdk, n.pattern) >= n.count);
    } catch {
        return false;
    }
}

/**
 * Buy one-or-more units through NPC dialogue (bartender beer: 2 gp each).
 * Returns units gained.
 */
export async function buyFromDialog(ctx: QuestContext, need: SupplyNeed, source: DialogSource): Promise<number> {
    const { sdk, bot } = ctx;
    const before = countItems(sdk, need.pattern);
    await walkSendHops(sdk, [source.tile], source.tile, 3);
    const npc = sdk.findNearbyNpc(source.npc);
    if (!npc) {
        ctx.log(`supply: no ${source.npc} near ${source.tile.x},${source.tile.z} for ${need.label}`);
        return 0;
    }
    while (countItems(sdk, need.pattern) < need.count) {
        const had = countItems(sdk, need.pattern);
        const talk = await bot.talkTo(npc);
        if (!talk.success) break;
        await bot.navigateDialog([source.choice]);
        await sdk.waitForTicks(2).catch(() => undefined);
        await bot.dismissBlockingUI().catch(() => undefined);
        if (countItems(sdk, need.pattern) <= had) break;
    }
    const gained = countItems(sdk, need.pattern) - before;
    if (gained > 0) ctx.log(`supply: dialogue-bought ${gained} ${need.label}`);
    return Math.max(0, gained);
}

/**
 * Sweep a spawn area picking up matching ground items. Returns units gained.
 */
export async function gatherSpawn(ctx: QuestContext, need: SupplyNeed, source: GatherSource): Promise<number> {
    const { sdk, bot } = ctx;
    const before = countItems(sdk, need.pattern);
    const deadline = Date.now() + 5 * 60_000;
    let cx = source.center.x;
    let cz = source.center.z;
    while (countItems(sdk, need.pattern) < need.count && Date.now() < deadline) {
        await walkSendHops(sdk, [{ x: cx, z: cz }], { x: cx, z: cz }, 4);
        const item = sdk.findGroundItem(need.pattern);
        if (item) {
            const r = await bot.pickupItem(item);
            ctx.log(`supply: picked up ${need.label}: ${r.success ? 'ok' : r.message}`);
            await sdk.waitForTicks(2).catch(() => undefined);
            continue;
        }
        // Spiral out: next sweep point around the center.
        const angle = Date.now() / 30_000;
        cx = Math.round(source.center.x + Math.cos(angle) * source.radius);
        cz = Math.round(source.center.z + Math.sin(angle) * source.radius);
        await sdk.waitForTicks(3).catch(() => undefined);
    }
    return countItems(sdk, need.pattern) - before;
}

/**
 * Buy a need from its verified shops (no bank, no mule). Returns units
 * bought. Exported for the mule's --stock mode; quest prep should prefer
 * ensureSupplied (full chain).
 */
export async function buyFromShops(ctx: QuestContext, need: SupplyNeed): Promise<number> {
    const shops = need.shops ?? SHOP_SOURCES[need.label.toLowerCase()] ?? [];
    if (shops.length === 0) {
        ctx.log(`supply: ${need.label} UNSOURCED (no verified shop)`);
        return 0;
    }
    if (ctx.sdk.getState()?.bank?.isOpen) await ctx.bot.closeBank().catch(() => undefined);
    await takeCoins(ctx, 5_000).catch(() => undefined);
    let bought = 0;
    for (const source of shops) {
        if (countItems(ctx.sdk, need.pattern) >= need.count) break;
        try {
            bought += await buyFromSource(ctx, need, source);
        } catch {
            /* next source */
        }
    }
    return bought;
}

function coins(sdk: BotSDK): number {
    return sdk
        .getInventory()
        .reduce((n, i) => n + (/^coins$/i.test(i.name) ? (i.count ?? 0) : 0), 0);
}

/** Withdraw coins for shopping from the OPEN bank. */
async function takeCoins(ctx: QuestContext, amount: number): Promise<boolean> {
    if (coins(ctx.sdk) >= amount) return true;
    if (!ctx.sdk.getState()?.bank?.isOpen) return false;
    const match = (ctx.sdk.getBankItems?.() ?? []).find((i) => /^coins$/i.test(i.name));
    if (!match) return false;
    await ctx.bot.withdrawItem(match, amount - coins(ctx.sdk));
    await ctx.sdk.waitForTicks(2).catch(() => undefined);
    return coins(ctx.sdk) >= amount;
}

async function buyFromSource(ctx: QuestContext, need: SupplyNeed, source: ShopSource): Promise<number> {
    const { sdk, bot } = ctx;
    await walkSendHops(sdk, [source.tile], source.tile, 3);
    const opened = sdk.getState()?.shop?.isOpen || (await bot.openShop(source.npc)).success;
    if (!opened && !sdk.getState()?.shop?.isOpen) {
        ctx.log(`supply: could not open ${source.npc} for ${need.label}`);
        return 0;
    }
    const line = sdk.getState()?.shop?.shopItems.find((i) => need.pattern.test(i.name)) ?? null;
    const price = Math.max(1, line?.buyPrice ?? 1);
    if (!line || (line.count ?? 0) <= 0) {
        ctx.log(`supply: ${source.npc} out of stock for ${need.label}`);
        await bot.closeShop().catch(() => undefined);
        return 0;
    }
    const shortfall = need.count - countItems(sdk, need.pattern);
    const want = Math.min(shortfall, line.count ?? 0, Math.floor(coins(sdk) / price));
    if (want <= 0) {
        ctx.log(`supply: cannot afford ${need.label} (${coins(sdk)}gp vs ${price}gp)`);
        await bot.closeShop().catch(() => undefined);
        return 0;
    }
    const bought = await bot.buyFromShop(line, want);
    ctx.log(`supply: bought ${bought.amountBought ?? 0}/${want} ${need.label} @ ${price}gp`);
    await bot.closeShop().catch(() => undefined);
    return bought.amountBought ?? 0;
}

/**
 * Ensure every need is held: inventory, own bank, quest mule, verified
 * shops. Returns the still-missing list (empty = packed). Pass `mule` to
 * enable the trade handoff; shops need coins on hand — withdraws a 5k float
 * from the open bank first.
 */
export async function ensureSupplied(
    ctx: QuestContext,
    needs: SupplyNeed[],
    opts?: { mule?: string }
): Promise<SupplyNeed[]> {
    const missing: SupplyNeed[] = [];
    for (const need of needs) {
        if (countItems(ctx.sdk, need.pattern) >= need.count) continue;
        // Open bank top-up.
        if (ctx.sdk.getState()?.bank?.isOpen) {
            const match = (ctx.sdk.getBankItems?.() ?? []).find((i) => need.pattern.test(i.name));
            if (match) {
                await ctx.bot.withdrawItem(match, need.count - countItems(ctx.sdk, need.pattern));
                await ctx.sdk.waitForTicks(2).catch(() => undefined);
            }
        }
        if (countItems(ctx.sdk, need.pattern) >= need.count) continue;
        // Quest-mule trade before shops: the stockpile is faster and free.
        if (opts?.mule) {
            try {
                await requestFromMule(ctx, [need], { mule: opts.mule });
            } catch {
                /* shops next */
            }
            if (countItems(ctx.sdk, need.pattern) >= need.count) continue;
        }
        // Shop fallback needs a closed bank (modals conflict) and coins.
        const shops = need.shops ?? SHOP_SOURCES[need.label.toLowerCase()] ?? [];
        const dialogs = DIALOG_SOURCES[need.label.toLowerCase()] ?? [];
        const gathers = GATHER_SOURCES[need.label.toLowerCase()] ?? [];
        if (shops.length === 0 && dialogs.length === 0 && gathers.length === 0) {
            ctx.log(`supply: ${need.label} UNSOURCED (no bank stock, no verified shop)`);
            missing.push(need);
            continue;
        }
        if (ctx.sdk.getState()?.bank?.isOpen) await ctx.bot.closeBank().catch(() => undefined);
        await takeCoins(ctx, 5_000).catch(() => undefined);
        for (const source of shops) {
            if (countItems(ctx.sdk, need.pattern) >= need.count) break;
            try {
                await buyFromSource(ctx, need, source);
            } catch {
                /* next source */
            }
        }
        if (countItems(ctx.sdk, need.pattern) >= need.count) continue;
        // Dialogue vendors (beer) and ground spawns (planks) after shops.
        for (const source of dialogs) {
            if (countItems(ctx.sdk, need.pattern) >= need.count) break;
            try {
                await buyFromDialog(ctx, need, source);
            } catch {
                /* next source */
            }
        }
        if (countItems(ctx.sdk, need.pattern) >= need.count) continue;
        for (const source of gathers) {
            if (countItems(ctx.sdk, need.pattern) >= need.count) break;
            try {
                await gatherSpawn(ctx, need, source);
            } catch {
                /* next source */
            }
        }
        if (countItems(ctx.sdk, need.pattern) < need.count) {
            ctx.log(`supply: still missing ${need.label}`);
            missing.push(need);
        }
    }
    return missing;
}
