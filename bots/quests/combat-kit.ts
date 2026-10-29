/**
 * Combat kit provisioning for quest scripts.
 *
 * Two quests here need to kill monsters far above their own combat level
 * brackets (Fight Arena's Bouncer lvl 132, Tree Gnome Village's Khazard
 * warlord lvl 112), so a channel that out-ranges them matters more than raw
 * melee stats:
 *
 *   1. BANK FIRST (primary). The account's own bank is the first source: the
 *      script looks for a full range loadout (bow + arrows + optional
 *      body/legs) or a magic loadout (staff + combat runes), withdraws the best
 *      tier it finds, wears it and picks the matching combat style.
 *   2. BUY WITH COINS (fallback). When the bank holds no weapon/ammo, the
 *      script withdraws coins and buys the missing pieces from the nearest
 *      shop that actually stocks them (Lowe in Varrock for bows/arrows, Zaff
 *      and Aubury in Varrok[sic] for staves/runes, the Ardougne west general
 *      store or the Tree Gnome Stronghold shop as the near-Kandarin option).
 *
 * Shop stock comes from the pinned content (the area `.inv` shop configs), and
 * every buy is a normal `bot.buyFromShop` — nothing here needs the local dev
 * hacks, so the scripts stay portable to the demo server.
 *
 * Everything is logged as an effects line (`kit: ...`) so a run that stalls
 * with a bare weapon is distinguishable from one that never entered the bank
 * phase (see quest-robustness rule 7).
 */
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import { Spells } from '../../sdk/spells';
import { ensureBankStart, SAFE_BANKS, type SafeBankName } from './safe-stops';
import { walkNear as walkNearHelper } from './movement';

export type CombatMode = 'range' | 'magic';

export interface KitCtx {
    bot: BotActions;
    sdk: BotSDK;
    log: (msg: string) => void;
    intent: (msg: string) => void;
    walkNear: (x: number, z: number, tolerance?: number) => Promise<boolean>;
}

export interface KitOutcome {
    mode: CombatMode;
    weapon: string | null;
    ammo: number;
    runes: number;
    food: number;
    /** Where the loadout came from — evidence for the run log. */
    source: 'bank' | 'shop' | 'mixed' | 'none';
    spell: number | null;
}

const COINS = /^coins$/i;
const FOOD = /^(shark|swordfish|lobster|tuna|bass|salmon|trout|bread|cake|wine|meat pie)$/i;

/** Best-first. Metal tiers are enough — every bow here fires at 99 Ranged. */
const RANGE_WEAPONS = [
    /^magic shortbow$/i,
    /^magic longbow$/i,
    /^yew shortbow$/i,
    /^yew longbow$/i,
    /^willow shortbow$/i,
    /^willow longbow$/i,
    /^oak shortbow$/i,
    /^oak longbow$/i,
    /^shortbow$/i,
    /^longbow$/i
];
const ARROWS = [
    /^rune arrows?$/i,
    /^adamant arrows?$/i,
    /^mithril arrows?$/i,
    /^steel arrows?$/i,
    /^iron arrows?$/i,
    /^bronze arrows?$/i
];
const RANGE_BODY = [/^black d'?hide body$/i, /^red d'?hide body$/i, /^studded body$/i, /^leather body$/i];
const RANGE_LEGS = [/^black d'?hide chaps$/i, /^red d'?hide chaps$/i, /^studded chaps$/i, /^leather chaps$/i];
const MAGIC_WEAPONS = [
    /^staff of fire$/i,
    /^staff of air$/i,
    /^staff of water$/i,
    /^staff of earth$/i,
    /^battlestaff$/i,
    /^magic staff$/i,
    /^staff$/i
];
const MAGIC_BODY = [/^wizards? robe$/i, /^blue robe top$/i, /^monk'?s robe$/i];
const MAGIC_HAT = [/^wizards hat$/i, /^blue wizard hat$/i, /^black wizard hat$/i];
/** Fire Bolt: 1 chaos + 4 fire + 3 air per cast (magic_combat_spells.dbrow). */
const MAGIC_RUNES: Array<{ re: RegExp; label: string; perCast: number }> = [
    { re: /^chaos runes?$/i, label: 'chaos', perCast: 1 },
    { re: /^fire runes?$/i, label: 'fire', perCast: 4 },
    { re: /^air runes?$/i, label: 'air', perCast: 3 }
];

interface ShopDef {
    name: string;
    x: number;
    z: number;
    npc: RegExp;
    /** Item patterns this shop is trusted to sell. */
    sells: RegExp[];
}

/**
 * Only shops whose stock is verified in the pinned content. Lowe/Zaff/Aubury
 * live in Varrock (a long haul from Port Khazard) — they are the reliable
 * high-tier source, so they are also the pair a "just give it money" run uses.
 */
const SHOPS: Record<string, ShopDef> = {
    lowe: {
        name: "Lowe's Archery Emporium (Varrock)",
        x: 3232,
        z: 3423,
        npc: /lowe/i,
        sells: [/^shortbow$/i, /^longbow$/i, /^oak (short|long)bow$/i, /^(bronze|iron|steel) arrows?$/i]
    },
    zaff: {
        name: "Zaff's staff shop (Varrock)",
        x: 3203,
        z: 3433,
        npc: /zaff/i,
        sells: [/^staff of (air|water|earth|fire)$/i, /^magic staff$/i, /^staff$/i]
    },
    aubury: {
        name: "Aubury's rune shop (Varrock)",
        x: 3253,
        z: 3402,
        npc: /aubury/i,
        sells: [/^(air|fire|water|earth|mind|body|chaos|death) runes?$/i]
    }
};

function invCount(sdk: BotSDK, re: RegExp): number {
    return sdk.getInventory().reduce((n, i) => n + (re.test(i.name) ? (i.count ?? 0) : 0), 0);
}

function bankCount(sdk: BotSDK, re: RegExp): number {
    return sdk.getBankItems().reduce((n, i) => n + (re.test(i.name) ? (i.count ?? 0) : 0), 0);
}

function coinCount(sdk: BotSDK): number {
    return sdk.findInventoryItem(COINS)?.count ?? 0;
}

function equipped(sdk: BotSDK, re: RegExp): boolean {
    return sdk.getEquipment().some((i) => re.test(i.name));
}

async function ensureBankOpen(ctx: KitCtx): Promise<boolean> {
    if (ctx.sdk.getState()?.bank?.isOpen) return true;
    const opened = await ctx.bot.openBank();
    if (!opened.success && !ctx.sdk.getState()?.bank?.isOpen) {
        ctx.log(`kit: bank did not open (${opened.message})`);
        return false;
    }
    // Contents sync lags isOpen — never read an "empty" bank on the first tick.
    for (let i = 0; i < 10 && !(ctx.sdk.getBankItems().length > 0); i++) {
        await ctx.sdk.waitForTicks(2).catch(() => undefined);
    }
    return !!ctx.sdk.getState()?.bank?.isOpen;
}

/** Deposit everything except `keep`; bank must already be open. */
async function depositAll(ctx: KitCtx, keep: RegExp[]): Promise<void> {
    if (!(await ensureBankOpen(ctx))) return;
    // Unequipping (like equipping) closes the bank interface in this client,
    // so the bank is re-opened before every deposit instead of once up front.
    for (const eq of [...ctx.sdk.getEquipment()]) {
        if (keep.some((re) => re.test(eq.name))) continue;
        const r = await ctx.bot.unequipItem(eq);
        if (!r.success) ctx.log(`kit: unequip ${eq.name}: ${r.message}`);
        await ctx.sdk.waitForTicks(1).catch(() => undefined);
    }
    for (let i = 0; i < 32; i++) {
        const item = ctx.sdk
            .getInventory()
            .find((it) => (it.count ?? 0) > 0 && !keep.some((re) => re.test(it.name)));
        if (!item) break;
        if (!ctx.sdk.getState()?.bank?.isOpen && !(await ensureBankOpen(ctx))) {
            ctx.log(`kit: bank closed before depositing ${item.name} — carrying it instead`);
            break;
        }
        const r = await ctx.bot.depositItem(item, -1);
        if (!r.success && !r.partial) {
            ctx.log(`kit: deposit ${item.name} failed: ${r.message}`);
            if (!(await ensureBankOpen(ctx))) break;
            continue;
        }
        await ctx.sdk.waitForTicks(1).catch(() => undefined);
    }
}

/** Withdraw `need` of the first bank stack matching, re-verifying the bank is open. */
async function withdrawBest(ctx: KitCtx, patterns: RegExp[], need: number, label: string): Promise<number> {
    for (const re of patterns) {
        const have = invCount(ctx.sdk, re);
        if (have >= need) return have;
        let bank = ctx.sdk.getBankItems().find((i) => re.test(i.name) && (i.count ?? 0) > 0);
        if (!bank) continue;
        if (!ctx.sdk.getState()?.bank?.isOpen && !(await ensureBankOpen(ctx))) return invCount(ctx.sdk, re);
        bank = ctx.sdk.getBankItems().find((i) => re.test(i.name) && (i.count ?? 0) > 0);
        if (!bank) continue;
        const want = Math.min(need - have, bank.count ?? need);
        const r = await ctx.bot.withdrawItem(bank, want);
        ctx.log(`kit: withdraw ${label} (${bank.name} x${want}): ${r.success || r.partial ? 'ok' : r.message}`);
        await ctx.sdk.waitForTicks(2).catch(() => undefined);
        return invCount(ctx.sdk, re);
    }
    return invCount(ctx.sdk, patterns[0]!);
}

async function equipFromInventory(ctx: KitCtx, re: RegExp, label: string): Promise<boolean> {
    if (equipped(ctx.sdk, re)) return true;
    const item = ctx.sdk.findInventoryItem(re);
    if (!item) return false;
    const before = ctx.sdk.getEquipment().map((i) => i.name).join(',');
    const r = await ctx.bot.equipItem(item);
    await ctx.sdk.waitForTicks(1).catch(() => undefined);
    const after = ctx.sdk.getEquipment().map((i) => i.name).join(',');
    const held = equipped(ctx.sdk, re);
    ctx.log(`kit: equip ${label} (${item.name}): ${held ? 'ok' : `NO-OP ${r.success ? '' : r.message}`}`);
    if (!held && before === after) ctx.log(`kit: wield refused — check levelrequire content for ${item.name}`);
    return held;
}

/** Ranged: Rapid is the default shortbow style; melee-style training is irrelevant here. */
async function setStyle(ctx: KitCtx, want: RegExp): Promise<void> {
    const styles = ctx.sdk.getState()?.combatStyle?.styles ?? [];
    const style = styles.find((s) => want.test(s.name) || want.test(s.type ?? ''));
    if (!style) {
        ctx.log(`kit: no style matching ${want} (weapon=${ctx.sdk.getState()?.combatStyle?.weaponName ?? '?'})`);
        return;
    }
    if (ctx.sdk.getState()?.combatStyle?.currentStyle === style.index) return;
    await ctx.sdk.sendSetCombatStyle(style.index).catch(() => undefined);
    ctx.log(`kit: combat style -> ${style.name}`);
}

function nearestShop(from: { x: number; z: number }, names: string[]): ShopDef | null {
    let best: ShopDef | null = null;
    let bestDist = Infinity;
    for (const name of names) {
        const shop = SHOPS[name]!;
        const dist = Math.hypot(shop.x - from.x, shop.z - from.z);
        if (dist < bestDist) {
            bestDist = dist;
            best = shop;
        }
    }
    return best;
}

async function buyFromShop(ctx: KitCtx, shop: ShopDef, wants: RegExp[]): Promise<string[]> {
    const bought: string[] = [];
    ctx.intent(`Buying ${wants.map((w) => w.source).join(', ')} at ${shop.name}`);
    await ctx.sdk.scanNearbyLocs(6).catch(() => undefined);
    if (!(await ctx.walkNear(shop.x, shop.z, 3))) {
        ctx.log(`kit: could not reach ${shop.name} @${shop.x},${shop.z}`);
        return bought;
    }
    let opened = await ctx.bot.openShop(shop.npc);
    for (let attempt = 0; attempt < 3 && !ctx.sdk.getState()?.shop?.isOpen; attempt++) {
        const door = ctx.sdk.findNearbyLoc(/door/i, { withOption: /open/i });
        if (door && (door.distance ?? 99) <= 3) await ctx.bot.openDoor(door).catch(() => undefined);
        await ctx.sdk.waitForTicks(3).catch(() => undefined);
        opened = await ctx.bot.openShop(shop.npc);
        if (opened.success || ctx.sdk.getState()?.shop?.isOpen) break;
    }
    if (!ctx.sdk.getState()?.shop?.isOpen) {
        ctx.log(`kit: ${shop.name} shop did not open (${opened.message})`);
        return bought;
    }
    for (const want of wants) {
        const line = ctx.sdk.getState()?.shop?.shopItems.find((i) => want.test(i.name));
        if (!line || (line.count ?? 0) <= 0) {
            ctx.log(`kit: ${shop.name} has no stock matching ${want} (not a supply step to retry)`);
            continue;
        }
        const amount = want.source.includes('staff') || /bow/i.test(want.source) ? 1 : 200;
        const r = await ctx.bot.buyFromShop(want, amount);
        ctx.log(`kit: buy ${line.name} x${r.amountBought ?? 0} @${shop.name}: ${r.success || r.partial ? 'ok' : r.message}`);
        if ((r.amountBought ?? 0) > 0) bought.push(line.name);
        await ctx.sdk.waitForTicks(2).catch(() => undefined);
    }
    await ctx.bot.closeShop().catch(() => undefined);
    return bought;
}

/**
 * Prepare a combat loadout. Always starts by banking at `bankName` (quest
 * convention: a run begins banked and empty), then packs weapons/ammo/food.
 */
export async function prepareCombatKit(
    ctx: KitCtx,
    opts: {
        mode: CombatMode;
        bank: SafeBankName;
        grindLogPath: string;
        food?: number;
        arrows?: number;
        runes?: number;
        /** Allow the coin-buy fallback when the bank has no weapon/ammo. */
        buyIfMissing?: boolean;
    }
): Promise<KitOutcome> {
    const food = opts.food ?? 12;
    const arrows = opts.arrows ?? 300;
    const runeCasts = opts.runes ?? 150;
    const outcome: KitOutcome = {
        mode: opts.mode,
        weapon: null,
        ammo: 0,
        runes: 0,
        food: 0,
        source: 'none',
        spell: opts.mode === 'magic' ? Spells.FIRE_BOLT : null
    };
    const bankTile = SAFE_BANKS[opts.bank]!;

    ctx.intent(`Banking at ${opts.bank} for a ${opts.mode} kit`);
    const atBank = await ensureBankStart(ctx.sdk, ctx.bot, opts.bank, opts.grindLogPath);
    if (!(await ctx.walkNear(bankTile.x, bankTile.z, 4))) {
        ctx.log(`kit: could not reach ${opts.bank} bank @${bankTile.x},${bankTile.z} (atBank=${atBank})`);
    }
    await depositAll(ctx, []);
    if (!(await ensureBankOpen(ctx))) {
        ctx.log('kit: bank unavailable — cannot check for a bank kit');
    }
    const bankCoins = ctx.sdk.getBankItems().find((i) => COINS.test(i.name))?.count ?? 0;

    // ---- plan, read entirely while the bank is open -----------------------
    // Equipping an item closes the bank interface in this client, so every
    // bank read has to happen up front: counting after the first equip is how
    // a stocked bank reported "no arrows, no food".
    const plan = {
        bow: opts.mode === 'range' ? (RANGE_WEAPONS.find((re) => bankCount(ctx.sdk, re) > 0) ?? null) : null,
        arrows: opts.mode === 'range' ? (ARROWS.find((re) => bankCount(ctx.sdk, re) > 0) ?? null) : null,
        staff: opts.mode === 'magic' ? (MAGIC_WEAPONS.find((re) => bankCount(ctx.sdk, re) > 0) ?? null) : null,
        body: (opts.mode === 'range' ? RANGE_BODY : MAGIC_BODY).find((re) => bankCount(ctx.sdk, re) > 0) ?? null,
        legs: opts.mode === 'range' ? (RANGE_LEGS.find((re) => bankCount(ctx.sdk, re) > 0) ?? null) : (MAGIC_HAT.find((re) => bankCount(ctx.sdk, re) > 0) ?? null),
        runes: MAGIC_RUNES.filter((r) => bankCount(ctx.sdk, r.re) >= r.perCast),
        food: bankCount(ctx.sdk, FOOD) > 0,
        bankArrows: plan_arrows(ctx, opts.mode)
    };
    ctx.log(
        `kit: bank plan bow=${plan.bow?.source ?? '-'} arrows=${plan.arrows?.source ?? '-'} staff=${plan.staff?.source ?? '-'} runes=${plan.runes.map((r) => r.label).join('/') || '-'} food=${plan.food}`
    );

    // ---- execute the withdrawals (bank stays the only source here) --------
    let fromBank = false;
    if (plan.bow) {
        await ensureBankOpen(ctx);
        if ((await withdrawBest(ctx, [plan.bow], 1, 'bow')) > 0) fromBank = true;
    }
    if (plan.staff) {
        await ensureBankOpen(ctx);
        if ((await withdrawBest(ctx, [plan.staff], 1, 'staff')) > 0) fromBank = true;
    }
    if (plan.arrows) {
        await ensureBankOpen(ctx);
        if ((await withdrawBest(ctx, [plan.arrows], arrows, 'arrows')) > 0) fromBank = true;
    }
    for (const rune of plan.runes) {
        await ensureBankOpen(ctx);
        await withdrawBest(ctx, [rune.re], runeCasts * rune.perCast, `${rune.label} runes`);
        fromBank = true;
    }
    for (const [pattern, label] of [
        [plan.body, 'body'],
        [plan.legs, 'legs/hat']
    ] as const) {
        if (!pattern) continue;
        await ensureBankOpen(ctx);
        await withdrawBest(ctx, [pattern], 1, label);
    }
    if (plan.food) {
        await ensureBankOpen(ctx);
        await withdrawBest(ctx, [FOOD], food, 'food');
    }
    await ctx.bot.closeBank().catch(() => undefined);

    // ---- wear it (bank now closed) ---------------------------------------
    if (opts.mode === 'range') {
        if (plan.bow) await equipFromInventory(ctx, plan.bow, 'bow');
        if (plan.body) await equipFromInventory(ctx, plan.body, 'body');
        if (plan.legs) await equipFromInventory(ctx, plan.legs, 'legs');
    } else {
        if (plan.staff) await equipFromInventory(ctx, plan.staff, 'staff');
        if (plan.body) await equipFromInventory(ctx, plan.body, 'robe');
        if (plan.legs) await equipFromInventory(ctx, plan.legs, 'hat');
    }

    if (opts.mode === 'range') {
        if (!ctx.sdk.getEquipment().some((i) => /bow/i.test(i.name))) await equipFromInventory(ctx, /bow/i, 'bow');
        await equipAmmo(ctx, plan.arrows);
    } else if (!ctx.sdk.getEquipment().some((i) => /staff/i.test(i.name))) {
        await equipFromInventory(ctx, /staff/i, 'staff');
    }

    // ---- shop fallback: coins in the bank, buy what the bank lacked -------
    // Readiness is judged from what is HELD (equipped or carried), never from
    // the bank plan: an account that walked in already wearing its bow must
    // not trek to Varrock for a second one.
    const weaponPattern = opts.mode === 'range' ? /bow/i : /staff/i;
    const held = (re: RegExp) =>
        ctx.sdk.getEquipment().some((i) => re.test(i.name)) || ctx.sdk.getInventory().some((i) => re.test(i.name) && (i.count ?? 0) > 0);
    let noWeapon = !held(weaponPattern);
    // Ammo only counts when it is in the QUIVER: ranged reads
    // `inv_getobj(worn, ^wearpos_quiver)` (player_ranged.rs2:81), so arrows in the
    // bag fire nothing — every attack answers "There is no ammo left in your
    // quiver." and deals no damage while `bot.attack` still reports success.
    const ammoInPack = () =>
        ARROWS.reduce(
            (n, re) =>
                n +
                ((ctx.sdk.getEquipmentItem(QUIVER_SLOT) && re.test(ctx.sdk.getEquipmentItem(QUIVER_SLOT)!.name))
                    ? (ctx.sdk.getEquipmentItem(QUIVER_SLOT)!.count ?? 1)
                    : 0) +
                invCount(ctx.sdk, re),
            0
        );
    let needAmmo = opts.mode === 'range' && ammoInPack() < 50;
    let missingRunes = opts.mode === 'magic' ? MAGIC_RUNES.filter((r) => invCount(ctx.sdk, r.re) < runeCasts) : [];
    if ((noWeapon || needAmmo || missingRunes.length > 0) && opts.buyIfMissing !== false && bankCoins >= 500) {
        if (!(await ensureBankOpen(ctx))) {
            ctx.log('kit: cannot reach the bank for coins — skipping the shop fallback');
        } else {
            const coins = ctx.sdk.findBankItem(COINS);
            if (coins) await ctx.bot.withdrawItem(coins, Math.min(bankCoins, 20_000));
            await ctx.bot.closeBank().catch(() => undefined);
            ctx.log(`kit: bank had no complete ${opts.mode} kit — shopping with ${coinCount(ctx.sdk)}gp`);
            const shop = nearestShop(
                { x: bankTile.x, z: bankTile.z },
                opts.mode === 'range' ? ['lowe'] : ['zaff', 'aubury']
            );
            let fromShop = false;
            if (shop) {
                const wants =
                    opts.mode === 'range'
                        ? [/^longbow$/i, /^iron arrows?$/i]
                        : noWeapon
                          ? [/^staff of fire$/i, /^chaos runes?$/i, /^fire runes?$/i, /^air runes?$/i]
                          : missingRunes.map((r) => r.re);
                const bought = await buyFromShop(ctx, shop, wants);
                fromShop = bought.length > 0;
                if (opts.mode === 'range') await equipFromInventory(ctx, /bow/i, 'bow');
                else await equipFromInventory(ctx, /staff/i, 'staff');
            }
            noWeapon = !held(weaponPattern);
            needAmmo = opts.mode === 'range' && ammoInPack() < 50;
            missingRunes = opts.mode === 'magic' ? MAGIC_RUNES.filter((r) => invCount(ctx.sdk, r.re) < runeCasts) : [];
            if (fromShop && fromBank) outcome.source = 'mixed';
            else if (fromShop) outcome.source = 'shop';
        }
    }

    outcome.weapon =
        ctx.sdk.getEquipment().find((i) => (opts.mode === 'range' ? /bow/i : /staff/i).test(i.name))?.name ?? null;
    outcome.ammo = ARROWS.reduce((n, re) => n + invCount(ctx.sdk, re), 0);
    outcome.runes = MAGIC_RUNES.reduce((n, r) => n + invCount(ctx.sdk, r.re), 0);
    outcome.food = invCount(ctx.sdk, FOOD);
    if (outcome.source === 'none' && (fromBank || outcome.weapon)) outcome.source = 'bank';
    if (outcome.source === 'none' && opts.mode === 'range' && !outcome.weapon) {
        ctx.log('kit: NO WEAPON — the quest fights will be bare-handed (stock the bank or fund the account)');
    }
    if (outcome.food < 3) ctx.log(`kit: WARNING only ${outcome.food} food — the bank stocks no food?`);
    if (opts.mode === 'range') await setStyle(ctx, /rapid|accurate/i);

    ctx.log(
        `kit: ${outcome.mode} source=${outcome.source} weapon=${outcome.weapon ?? 'NONE'} ammo=${outcome.ammo} runes=${outcome.runes} food=${outcome.food} bankCoins=${bankCoins}`
    );
    return outcome;
}

/** Arrow tiers present in the bank (diagnostics only). */
function plan_arrows(ctx: KitCtx, mode: CombatMode): string {
    if (mode !== 'range') return '-';
    return ARROWS.filter((re) => bankCount(ctx.sdk, re) > 0).map((re) => re.source).join(',') || '-';
}

export interface KillOptions {
    label: string;
    mode: CombatMode;
    /** Bound on the fight (default 3 minutes — these are not grind targets). */
    maxMs?: number;
    /** Spell component for magic mode. */
    spell?: number;
    /** Give up early once the NPC has been absent this many consecutive polls. */
    gonePolls?: number;
    /**
     * Restrict which matches count as the target. Content reuses one name for a
     * decoy and the real spawn (Fight Arena: the static arena_ogre at 2608,3165
     * sits on the far side of the pen fence, while the fightable ogre spawns
     * inside it) — without this, `findNearbyNpc` picks the nearest match and the
     * walk answers "path stops N tiles short" on a target that can never be hit.
     */
    where?: (npc: { x: number; z: number; name: string }) => boolean;
}

/**
 * Quiver slot in the `worn` inventory. NOT the enum ordinals in
 * general/configs/slotspace.enum — the worn inventory is indexed by the engine's
 * own wear-pos ids (ObjType.getWearPosId: quiver = 13, hands = 9, legs = 7), and
 * `player_ranged.rs2` reads `inv_getobj(worn, ^wearpos_quiver)`.
 */
const QUIVER_SLOT = 13;

/**
 * Wield one stack of arrows into the QUIVER. Without this a ranged kit fires
 * nothing: `player_ranged.rs2` takes ammo from `worn, ^wearpos_quiver`, so
 * arrows carried in the bag only ever print "There is no ammo left in your
 * quiver." — an attack that reports success and deals no damage.
 */
async function equipAmmo(ctx: KitCtx, pattern: RegExp | null): Promise<boolean> {
    const worn = ctx.sdk.getEquipmentItem(QUIVER_SLOT);
    if (worn && ARROWS.some((re) => re.test(worn.name))) return true;
    const stack =
        (pattern ? ctx.sdk.findInventoryItem(pattern) : null) ??
        ARROWS.map((re) => ctx.sdk.findInventoryItem(re)).find((i) => i != null) ??
        null;
    if (!stack) {
        ctx.log('kit: no arrows in the bag to wield — ranged will fire nothing');
        return false;
    }
    const r = await ctx.bot.equipItem(stack).catch((e: unknown) => ({ success: false, message: String(e) }));
    const now = ctx.sdk.getEquipmentItem(QUIVER_SLOT);
    const ok = !!now && ARROWS.some((re) => re.test(now.name));
    ctx.log(`kit: equip arrows (${stack.name}): ${ok ? `ok quiver=${now?.count}` : (r as { message?: string }).message}`);
    return ok;
}

/**
 * Nearest name+place match, preferring a reachable, attack-option NPC — the
 * `where` half of KillOptions. `findNearbyNpc` has no position predicate, so a
 * decoy outside the fence would otherwise win on distance alone.
 */
function pickWhere(
    sdk: KitCtx['sdk'],
    pattern: RegExp,
    where: (npc: { x: number; z: number; name: string }) => boolean
): ReturnType<KitCtx['sdk']['findNearbyNpc']> {
    const all = (sdk.getNearbyNpcs() ?? []).filter((n) => pattern.test(n.name) && where(n));
    if (!all.length) return null;
    const attackable = all.filter((n) => (n.optionsWithIndex ?? []).some((o) => /attack/i.test(o.text)));
    const reachable = (list: typeof all) => list.filter((n) => n.reachable !== false);
    const pool =
        reachable(attackable).length > 0
            ? reachable(attackable)
            : reachable(all).length > 0
              ? reachable(all)
              : all;
    return [...pool].sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0] ?? null;
}

export async function killTarget(ctx: KitCtx, pattern: RegExp, opts: KillOptions): Promise<boolean> {
    const deadline = Date.now() + (opts.maxMs ?? 180_000);
    let gone = 0;
    let starved = false;
    const need = opts.gonePolls ?? 5;
    ctx.intent(`Fighting ${opts.label}`);
    while (Date.now() < deadline) {
        const p = ctx.sdk.getState()?.player;
        if (!p) {
            await ctx.sdk.waitForTicks(2).catch(() => undefined);
            continue;
        }
        if (p.isDead) {
            ctx.log(`${opts.label}: died — resuming after respawn`);
            return false;
        }
        if (p.hp > 0 && p.maxHp > 0 && p.hp <= p.maxHp - 15) {
            const food = ctx.sdk.findInventoryItem(FOOD);
            if (food) {
                await ctx.bot.eatFood(food).catch(() => undefined);
                await ctx.sdk.waitForTicks(1).catch(() => undefined);
                continue;
            }
            // Out of food is NOT a reason to stop swinging: the old `continue`
            // here skipped the attack every poll, so a starving bot stood still
            // taking hits until the fight timed out (Fight Arena 04:58Z: 121
            // "no food left" lines, 99 -> 26hp, zero damage dealt). Log once and
            // keep attacking.
            if (!starved) {
                ctx.log(`${opts.label}: no food left at ${p.hp}/${p.maxHp}hp — fighting on`);
                starved = true;
            }
        }
        const npc = opts.where ? pickWhere(ctx.sdk, pattern, opts.where) : ctx.sdk.findNearbyNpc(pattern, { withOption: /attack/i }) ?? ctx.sdk.findNearbyNpc(pattern);
        if (!npc) {
            gone++;
            if (gone >= need) {
                ctx.log(`${opts.label}: target gone (${gone} clean polls)`);
                return true;
            }
            await ctx.sdk.waitForTicks(2).catch(() => undefined);
            continue;
        }
        gone = 0;
        if (p.combat?.inCombat && (npc.distance ?? 99) <= 10) {
            await ctx.sdk.waitForTicks(2).catch(() => undefined);
            continue;
        }
        if (opts.mode === 'magic') {
            const r = await ctx.bot.castSpell(npc, opts.spell ?? Spells.FIRE_BOLT, 4_000).catch((e: unknown) => ({ success: false, message: String(e) }));
            if (!r.success) ctx.log(`${opts.label}: cast -> ${r.message}`);
        } else {
            const r = await ctx.bot.attack(npc, 4_000).catch((e: unknown) => ({ success: false, message: String(e) }));
            if (!r.success) ctx.log(`${opts.label}: attack -> ${r.message}`);
        }
        await ctx.sdk.waitForTicks(2).catch(() => undefined);
    }
    ctx.log(`${opts.label}: fight timed out at ${ctx.sdk.getState()?.player?.worldX},${ctx.sdk.getState()?.player?.worldZ}`);
    return false;
}

/** Convenience for scripts that already have their own walkNear. */
export function kitCtx(bot: BotActions, sdk: BotSDK, log: (m: string) => void, intent: (m: string) => void): KitCtx {
    return {
        bot,
        sdk,
        log,
        intent,
        walkNear: (x, z, tol = 3) => walkNearHelper(bot, sdk, x, z, tol)
    };
}
