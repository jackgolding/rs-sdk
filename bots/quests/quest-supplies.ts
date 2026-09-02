/**
 * Shared shop / bank helpers for bots/quests/*.ts scripts.
 */
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';

export type SupplyCtx = {
    bot: BotActions;
    sdk: BotSDK;
    log: (msg: string) => void;
    intent: (msg: string) => void;
    walkNear: (x: number, z: number, tolerance?: number) => Promise<boolean>;
    closeUi: () => Promise<void>;
};

export const SHOPS = {
    WYDIN: { x: 3014, z: 3204, npc: /wydin/i },
    THESSALIA: { x: 3204, z: 3417, npc: /thessalia/i },
    HORVIK: { x: 3229, z: 3438, npc: /horvik/i },
    PEKSA: { x: 3076, z: 3429, npc: /peksa/i },
    VARROCK_GEN: { x: 3218, z: 3415, npc: /shop\s*(keeper|assistant)/i },
    FALADOR_GEN: { x: 2957, z: 3386, npc: /shop\s*(keeper|assistant)/i },
    LUMBRIDGE_GEN: { x: 3211, z: 3246, npc: /shop\s*(keeper|assistant)/i },
    ZAMBO: { x: 2925, z: 3143, npc: /zambo/i },
    JIMINUA: { x: 2767, z: 3122, npc: /jiminua/i },
    DRAYNOR_BANK: { x: 3092, z: 3245 },
    VARROCK_EAST_BANK: { x: 3253, z: 3420 },
    FALADOR_EAST_BANK: { x: 3012, z: 3355 },
    EDGEVILLE_BANK: { x: 3094, z: 3492 }
} as const;

const EDGEVILLE_DUNGEON = {
    LADDER: { x: 3096, z: 9867 },
    WILDY_GATE: { x: 3103, z: 9909 },
    BARS_SOUTH: { x: 3120, z: 9963 },
    BARS_NORTH: { x: 3121, z: 9971 },
    BARS_LINE: 9968
} as const;

const FOOD = /^(lobster|swordfish|tuna|shark|trout|salmon|bread|cake|wine|meat pie)$/i;

const COINS = /^coins$/i;

export function invCount(sdk: BotSDK, pattern: RegExp): number {
    return sdk.getInventory().reduce((n, i) => n + (pattern.test(i.name) ? (i.count ?? 1) : 0), 0);
}

export function coinCount(sdk: BotSDK): number {
    return sdk.findInventoryItem(COINS)?.count ?? 0;
}

export function nearestBank(
    x: number,
    z: number
): { x: number; z: number } {
    const banks = [
        SHOPS.DRAYNOR_BANK,
        SHOPS.VARROCK_EAST_BANK,
        SHOPS.FALADOR_EAST_BANK,
        SHOPS.EDGEVILLE_BANK
    ];
    return banks.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0]!;
}

export async function ensureCoins(ctx: SupplyCtx, min: number): Promise<boolean> {
    if (coinCount(ctx.sdk) >= min) return true;
    const p = ctx.sdk.getState()?.player;
    const bank = nearestBank(p?.worldX ?? 0, p?.worldZ ?? 0);
    ctx.intent(`Withdrawing coins at bank (need ${min} gp)`);
    await ctx.closeUi();
    await ctx.walkNear(bank.x, bank.z, 3);
    if (!(ctx.sdk.getState()?.bank?.isOpen || (await ctx.bot.openBank()).success)) {
        ctx.log('Could not open bank for coins');
        return coinCount(ctx.sdk) >= min;
    }
    const inBank = ctx.sdk.findBankItem(COINS);
    if (inBank) {
        const need = Math.max(min - coinCount(ctx.sdk), 0);
        const w = await ctx.bot.withdrawItem(inBank, Math.min(need + 50, inBank.count ?? need + 50));
        if (!w.success) ctx.log(`Coin withdraw: ${w.message}`);
    }
    await ctx.bot.closeBank();
    return coinCount(ctx.sdk) >= min;
}

export async function withdrawFromBank(
    ctx: SupplyCtx,
    pattern: RegExp,
    amount: number,
    bank = nearestBank(ctx.sdk.getState()?.player?.worldX ?? 0, ctx.sdk.getState()?.player?.worldZ ?? 0)
): Promise<boolean> {
    if (invCount(ctx.sdk, pattern) >= amount) return true;
    await ctx.closeUi();
    await ctx.walkNear(bank.x, bank.z, 3);
    if (!(ctx.sdk.getState()?.bank?.isOpen || (await ctx.bot.openBank()).success)) return false;
    const item = ctx.sdk.findBankItem(pattern);
    if (item) await ctx.bot.withdrawItem(item, amount);
    await ctx.bot.closeBank();
    return invCount(ctx.sdk, pattern) >= amount;
}

export async function buyAtShop(
    ctx: SupplyCtx,
    shop: { x: number; z: number; npc: RegExp },
    items: Array<{ pattern: RegExp; amount: number; label?: string }>
): Promise<void> {
    const missing = items.filter((i) => invCount(ctx.sdk, i.pattern) < i.amount);
    if (missing.length === 0) return;

    ctx.intent(`Buying ${missing.map((i) => i.label ?? i.pattern.source).join(', ')}`);
    await ctx.closeUi();
    await ctx.walkNear(shop.x, shop.z, 3);

    let opened = await ctx.bot.openShop(shop.npc);
    if (!opened.success) {
        const keeper = ctx.sdk.findNearbyNpc(shop.npc);
        if (keeper) {
            const trade = await ctx.bot.interactNpc(keeper, /trade/i);
            if (!trade.success) ctx.log(`trade shop: ${trade.message}`);
            await ctx.sdk.waitForCondition((s) => !!s.shop?.isOpen, 8_000).catch(() => {});
        }
    }

    if (!ctx.sdk.getState()?.shop?.isOpen) {
        ctx.log(`Shop not open @ ${shop.x},${shop.z}`);
        return;
    }

    for (const item of missing) {
        const have = invCount(ctx.sdk, item.pattern);
        const need = item.amount - have;
        if (need <= 0) continue;
        const buy = await ctx.bot.buyFromShop(item.pattern, need);
        if (!buy.success) ctx.log(`Buy ${item.label ?? item.pattern.source}: ${buy.message}`);
    }
    await ctx.bot.closeShop();
}

export async function pickupGround(
    ctx: SupplyCtx,
    pattern: RegExp,
    scanRadius = 20
): Promise<boolean> {
    if (invCount(ctx.sdk, pattern) > 0) return true;
    let item = ctx.sdk.findGroundItem(pattern);
    if (!item) item = (await ctx.sdk.scanFindGroundItem(pattern, scanRadius)) ?? null;
    if (!item) return false;
    const r = await ctx.bot.pickupItem(item);
    return r.success || invCount(ctx.sdk, pattern) > 0;
}

export async function ensureItem(
    ctx: SupplyCtx,
    pattern: RegExp,
    amount: number,
    opts: {
        label?: string;
        shop?: { x: number; z: number; npc: RegExp };
        bankFirst?: boolean;
        coinsNeeded?: number;
        ground?: boolean;
    } = {}
): Promise<boolean> {
    if (invCount(ctx.sdk, pattern) >= amount) return true;

    if (opts.coinsNeeded) await ensureCoins(ctx, opts.coinsNeeded);

    if (opts.bankFirst) {
        const bank = nearestBank(ctx.sdk.getState()?.player?.worldX ?? 0, ctx.sdk.getState()?.player?.worldZ ?? 0);
        if (await withdrawFromBank(ctx, pattern, amount, bank)) return true;
    }

    if (opts.ground) {
        for (let i = 0; i < 3 && invCount(ctx.sdk, pattern) < amount; i++) {
            if (await pickupGround(ctx, pattern)) break;
            await ctx.sdk.waitForTicks(2);
        }
        if (invCount(ctx.sdk, pattern) >= amount) return true;
    }

    if (opts.shop) {
        await buyAtShop(ctx, opts.shop, [{ pattern, amount, label: opts.label }]);
    }

    return invCount(ctx.sdk, pattern) >= amount;
}

function playerPos(sdk: BotSDK): { x: number; z: number; hp: number; maxHp: number } {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, hp: p?.hp ?? 10, maxHp: p?.maxHp ?? 10 };
}

function inEdgevilleDungeon(sdk: BotSDK): boolean {
    return playerPos(sdk).z > 6400;
}

function northOfMonkeyBars(sdk: BotSDK): boolean {
    const p = playerPos(sdk);
    return inEdgevilleDungeon(sdk) && p.z >= EDGEVILLE_DUNGEON.BARS_LINE;
}

async function eatIfLow(ctx: SupplyCtx): Promise<void> {
    const p = playerPos(ctx.sdk);
    if (p.hp > p.maxHp - 8) return;
    const food = ctx.sdk.getInventory().find((i) => FOOD.test(i.name));
    if (food) await ctx.bot.eatFood(food);
}

async function swingMonkeyBars(ctx: SupplyCtx, dir: 'north' | 'south'): Promise<boolean> {
    const wantNorth = dir === 'north';
    if (wantNorth && northOfMonkeyBars(ctx.sdk)) return true;
    if (!wantNorth && inEdgevilleDungeon(ctx.sdk) && !northOfMonkeyBars(ctx.sdk)) return true;

    const stand = wantNorth ? EDGEVILLE_DUNGEON.BARS_SOUTH : EDGEVILLE_DUNGEON.BARS_NORTH;
    await ctx.walkNear(stand.x, stand.z, 2);
    for (let attempt = 0; attempt < 4; attempt++) {
        const bars =
            ctx.sdk.findNearbyLoc(/monkey\s*bars/i, { withOption: /swing across/i }) ??
            ctx.sdk.findNearbyLoc(/monkey\s*bars/i);
        if (!bars) break;
        await ctx.bot.interactLoc(bars, /swing across/i);
        await ctx.sdk
            .waitForCondition(() => {
                const z = ctx.sdk.getState()?.player?.worldZ ?? 0;
                return wantNorth ? z >= EDGEVILLE_DUNGEON.BARS_LINE : z < EDGEVILLE_DUNGEON.BARS_LINE && z > 6400;
            }, 12_000)
            .catch(() => {});
        if (wantNorth === northOfMonkeyBars(ctx.sdk)) return true;
    }
    return wantNorth === northOfMonkeyBars(ctx.sdk);
}

async function leaveEastCave(ctx: SupplyCtx): Promise<void> {
    const p = playerPos(ctx.sdk);
    if (!inEdgevilleDungeon(ctx.sdk) || northOfMonkeyBars(ctx.sdk) || p.x < 3126) return;
    await ctx.walkNear(3124, 9948, 3);
    await ctx.walkNear(3116, 9952, 3);
    await ctx.walkNear(3108, 9936, 4);
}

export async function climbEdgevilleDungeonToSurface(ctx: SupplyCtx): Promise<boolean> {
    if (!inEdgevilleDungeon(ctx.sdk)) return true;
    for (let attempt = 0; attempt < 4 && inEdgevilleDungeon(ctx.sdk); attempt++) {
        await eatIfLow(ctx);
        if (northOfMonkeyBars(ctx.sdk)) await swingMonkeyBars(ctx, 'south');
        await leaveEastCave(ctx);
        const p = playerPos(ctx.sdk);
        if (p.z >= EDGEVILLE_DUNGEON.WILDY_GATE.z) {
            await ctx.walkNear(EDGEVILLE_DUNGEON.WILDY_GATE.x, EDGEVILLE_DUNGEON.WILDY_GATE.z + 6, 3);
            const gate = ctx.sdk.findNearbyLoc(/gate/i, { withOption: /open/i });
            if (gate) await ctx.bot.openDoor(gate);
            await ctx.walkNear(EDGEVILLE_DUNGEON.WILDY_GATE.x, EDGEVILLE_DUNGEON.WILDY_GATE.z - 6, 3);
        }
        await ctx.walkNear(EDGEVILLE_DUNGEON.LADDER.x, EDGEVILLE_DUNGEON.LADDER.z, 2);
        const ladder = ctx.sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-up/i });
        if (ladder) {
            await ctx.bot.interactLoc(ladder, /climb-up/i);
            await ctx.sdk.waitForCondition((s) => (s.player?.worldZ ?? 0) < 6400, 10_000).catch(() => {});
        }
    }
    return !inEdgevilleDungeon(ctx.sdk);
}

export async function openEdgevilleBank(ctx: SupplyCtx): Promise<boolean> {
    await ctx.closeUi();
    if (inEdgevilleDungeon(ctx.sdk)) {
        ctx.intent('Leaving Edgeville dungeon');
        if (!(await climbEdgevilleDungeonToSurface(ctx))) {
            ctx.log('Could not leave Edgeville dungeon');
            return false;
        }
    }
    if (ctx.sdk.getState()?.shop?.isOpen) await ctx.bot.closeShop();
    if (ctx.sdk.getState()?.bank?.isOpen) {
        const p = playerPos(ctx.sdk);
        if (Math.hypot(p.x - SHOPS.EDGEVILLE_BANK.x, p.z - SHOPS.EDGEVILLE_BANK.z) <= 10) return true;
        await ctx.bot.closeBank();
    }
    const p = playerPos(ctx.sdk);
    if (p.x > 3120 || p.z < 3460) {
        if (p.z < 3320) await ctx.walkNear(3088, 3320, 8);
        if (p.z < 3420) await ctx.walkNear(3088, 3420, 8);
    }
    ctx.intent('Edgeville bank');
    await ctx.walkNear(SHOPS.EDGEVILLE_BANK.x, SHOPS.EDGEVILLE_BANK.z, 4);
    if (ctx.sdk.getState()?.bank?.isOpen) return true;
    const opened = await ctx.bot.openBank();
    if (!opened.success) ctx.log(`openBank failed: ${opened.message}`);
    await ctx.sdk.waitForCondition((s) => !!s.bank?.isOpen, 8_000).catch(() => {});
    return !!ctx.sdk.getState()?.bank?.isOpen;
}

export async function depositAllInventory(ctx: SupplyCtx, keep: RegExp[] = []): Promise<void> {
    const keepItem = (name: string) => keep.some((p) => p.test(name));
    if (!ctx.sdk.getState()?.bank?.isOpen) {
        const opened = await ctx.bot.openBank();
        if (!opened.success) {
            ctx.log(`openBank before deposit: ${opened.message}`);
            return;
        }
        await ctx.sdk.waitForCondition((s) => !!s.bank?.isOpen, 8_000).catch(() => {});
    }
    if (!ctx.sdk.getState()?.bank?.isOpen) {
        ctx.log('Bank not open — skipping deposit');
        return;
    }
    for (const eq of [...ctx.sdk.getEquipment()]) {
        const r = await ctx.bot.unequipItem(eq);
        if (!r.success) ctx.log(`Unequip ${eq.name}: ${r.message}`);
        await ctx.sdk.waitForTicks(1);
    }
    for (let i = 0; i < 32; i++) {
        const item = ctx.sdk.getInventory().find((it) => (it.count ?? 0) > 0 && !keepItem(it.name));
        if (!item) break;
        const r = await ctx.bot.depositItem(item, -1);
        ctx.log(`Deposit ${item.name}: ${r.success || r.partial ? 'ok' : r.message}`);
        if (!r.success && !r.partial) break;
    }
}

export async function depositEverythingAtEdgeville(ctx: SupplyCtx, keep: RegExp[] = []): Promise<boolean> {
    ctx.intent('Edgeville bank — deposit all');
    if (!(await openEdgevilleBank(ctx))) return false;
    await depositAllInventory(ctx, keep);
    await ctx.bot.closeBank();
    return true;
}
