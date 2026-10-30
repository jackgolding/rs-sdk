/**
 * Death Plateau mule stock: 50 premade Blurberry specials, 50 bread and 50 trout, banked
 * on this account (a trade moves them to the mule, Jackpoo2, afterwards).
 *
 *   bun bots/quests/death-plateau-stock.ts {botname} [--target=50]
 *
 * Starts and ends naked at the Ardougne bank (the gnome banks are all on L1, which the
 * runner's hub cannot be). Any item the bank already holds `target` of is skipped.
 *
 *   bread     the Ardougne Baker's Stall (ardougne_east.inv bakery: bread 10, +1 per 100t),
 *             a short walk from the hub. The shelf is taken first, and the rest is waited out
 *             at the end: a shelf only restocks up to its base 10, so time away banks at most 10.
 *   specials  the Blurberry Bar, Grand Tree L1 (gnome.inv blurberrybar: premade blurberry
 *             special 10, +1 per 100t). 50 means ~4000t of restock from the first buy.
 *   trout     fly-fished on the stronghold's river (0_37_53_freshfish Lure spots) while the
 *             bar restocks, cooked on the range beside the bar, banked at the Grand Tree bank.
 *             Salmon (about half the catch at Fishing 30+) is dropped. Needs Fishing 20 and
 *             Cooking 15; a fly fishing rod and feathers come from the bank, else Gerrant's
 *             (Port Sarim).
 *
 * Shop stock is shared world-wide (scope=shared): other buyers slow the restock waits.
 * A task writes no run record; the finish logs "already complete" for todo-runner.
 */
import { runTask, type Quest } from './lib/run-quest';
import { tickNow, untilTicks } from './lib/ticks';
import { buyAtShop } from './quest-supplies';
import {
    BAR_RANGE,
    BAR_RANGE_LOC,
    BLURBERRY_BAR,
    climbGrandTree,
    crossGnomeGate,
    GRAND_TREE_BANK,
    leaveGrandTree,
    STRONGHOLD_FISHING,
} from './lib/gnome-stronghold';
import { SAFE_BANKS } from './safe-stops';

const TARGET = Number(process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? process.env.DP_STOCK_TARGET ?? 50);
const HUB = SAFE_BANKS.ardougne;
/** Between the two Bakers (2653,3307) and (2672,3309): both trade the one shared stall. */
const BAKERY = { x: 2662, z: 3307 };
const GERRANT = { x: 3013, z: 3225, npc: /^gerrant$/i };

const SPECIAL = /^blurberry special$/i;
const BREAD = /^bread$/i;
const TROUT = /^trout$/i;
const RAW_TROUT = /^raw trout$/i;
const RAW_SALMON = /^raw salmon$/i;
const ROD = /^fly fishing rod$/i;
const FEATHER = /^feather$/i;
const COINS = /^coins$/i;
const KEEP = [COINS, ROD, FEATHER];

/**
 * Both shops restock one unit per 100 ticks (World.ts: tick % stockrate). A wait at the shelf
 * gives up after this long with no new unit (another buyer taking them, or a broken shop).
 */
const RESTOCK_GAP_TICKS = 600;
/** Fishing: re-click a spot after this long without a catch (spots move), give up after STALL. */
const FISH_RECLICK_TICKS = 12;
const FISH_STALL_TICKS = 250;
/** Cooking: next use this long after the last one shows nothing; give up after STALL. */
const COOK_REFIRE_TICKS = 6;
const COOK_STALL_TICKS = 60;
/** Feathers per wanted trout: at Fishing 99 roughly 45% of catches are trout, the rest salmon. */
const FEATHERS_PER_TROUT = 2.6;
/** Worst-case unit prices as stock runs down (bread base 12, specials base 30). */
const BREAD_MAX_GP = 30;
const SPECIAL_MAX_GP = 75;
const FEATHER_GP = 6;
const ROD_GP = 20;

/** Banked counts, refreshed whenever the bank is open. */
const banked = { special: 0, bread: 0, trout: 0 };

const count = (q: Quest, re: RegExp) => q.sdk.getInventory().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const bankCount = (q: Quest, re: RegExp) => q.sdk.getBankItems().filter((b) => re.test(b.name)).reduce((n, b) => n + b.count, 0);
const freeSlots = (q: Quest) => 28 - q.sdk.getInventory().length;
const short = (q: Quest, kind: keyof typeof banked, re: RegExp) => Math.max(0, TARGET - banked[kind] - count(q, re));
const troutShort = (q: Quest) => Math.max(0, TARGET - banked.trout - count(q, TROUT) - count(q, RAW_TROUT));
const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};

function readBank(q: Quest): void {
    banked.special = bankCount(q, SPECIAL);
    banked.bread = bankCount(q, BREAD);
    banked.trout = bankCount(q, TROUT);
}

const status = () => `specials ${banked.special}/${TARGET}, bread ${banked.bread}/${TARGET}, trout ${banked.trout}/${TARGET} banked`;

/** A single-button dialog (level-up, cooking message): click it away. True when one was open. */
async function dismissOne(q: Quest): Promise<boolean> {
    const d = q.sdk.getState()?.dialog;
    if (!d?.isOpen || d.options.length > 1) return false;
    await q.sdk.sendClickDialog(d.options[0]?.index ?? 0);
    return true;
}

async function openBank(q: Quest, where: string): Promise<void> {
    if (q.sdk.getState()?.bank?.isOpen) return;
    let r = await q.bot.openBank();
    if (!r.success) {
        await q.sdk.waitForTicks(2);
        r = await q.bot.openBank();
    }
    if (!r.success && !q.sdk.getState()?.bank?.isOpen) throw new Error(`could not open the ${where} bank: ${r.message}`);
}

/** Bank everything but the kept tools and coins, then re-read the stock counts. */
async function bankHaul(q: Quest, where: string): Promise<void> {
    await openBank(q, where);
    for (let i = 0, misses = 0; i < 40; i++) {
        const item = q.sdk.getInventory().find((it) => !KEEP.some((re) => re.test(it.name)));
        if (!item) break;
        const r = await q.bot.depositItem(item, -1);
        if (r.success || r.partial) continue;
        // A deposit can land after depositItem stops waiting (process-bank.ts): look again.
        await q.sdk.waitForTicks(2);
        if (!q.sdk.getInventory().some((it) => it.id === item.id)) continue;
        if (++misses > 3) throw new Error(`deposit ${item.name} at ${where}: ${r.message}`);
    }
    await q.sdk.waitForTicks(1);
    readBank(q);
    await q.bot.closeBank().catch(() => undefined);
    q.log(`banked at ${where}: ${status()}`);
}

/** Withdraw up to `amount` of `re` from the open bank; returns what is held after. */
async function withdraw(q: Quest, re: RegExp, amount: number): Promise<number> {
    const want = amount - count(q, re);
    const b = q.sdk.findBankItem(re);
    if (want > 0 && b) {
        await q.bot.withdrawItem(b, Math.min(want, b.count));
        await untilTicks(q.sdk, () => count(q, re) > 0, 4);
    }
    return count(q, re);
}

/**
 * Buy `re` from an open-able shop until `stillShort()` is 0 or the pack is full. With
 * `waitTicks` > 0, hold the shop open and buy each restock as it lands, giving up after that
 * long without a new unit; otherwise take what is on the shelf and go.
 */
async function buyFromShelf(q: Quest, npc: RegExp, re: RegExp, label: string, stillShort: () => number, waitTicks: number): Promise<number> {
    const before = count(q, re);
    if (!q.sdk.getState()?.shop?.isOpen) {
        const r = await q.bot.openShop(npc);
        if (!r.success && !q.sdk.getState()?.shop?.isOpen) throw new Error(`${label}: the shop did not open: ${r.message}`);
    }
    const stock = () => q.sdk.getState()?.shop?.shopItems?.find((s) => re.test(s.name));
    if (!stock()) throw new Error(`${label}: the shop does not list it`);
    let lastUnit = tickNow(q.sdk);
    let waited = 0;
    while (stillShort() > 0 && freeSlots(q) > 0) {
        const s = stock();
        if (!q.sdk.getState()?.shop?.isOpen) break;
        if (s && s.count > 0) {
            if (count(q, COINS) < s.buyPrice) throw new Error(`${label}: out of coins (${count(q, COINS)} carried, ${s.buyPrice} each)`);
            const n = Math.min(s.count, stillShort(), freeSlots(q));
            const had = count(q, re);
            const r = await q.bot.buyFromShop(re, n);
            if (count(q, re) === had) {
                q.log(`${label}: buy of ${n} failed: ${r.message}`);
                await q.sdk.waitForTicks(2);
            }
            lastUnit = tickNow(q.sdk);
            continue;
        }
        if (waitTicks <= 0) break;
        const t0 = tickNow(q.sdk);
        if (t0 - lastUnit > waitTicks) {
            q.log(`${label}: no restock in ${waitTicks}t; leaving with ${count(q, re) - before}`);
            break;
        }
        await untilTicks(q.sdk, () => (stock()?.count ?? 0) > 0 || !q.sdk.getState()?.shop?.isOpen, waitTicks);
        waited += tickNow(q.sdk) - t0;
    }
    await q.bot.closeShop().catch(() => undefined);
    const got = count(q, re) - before;
    q.log(`${label}: bought ${got}${waited ? ` (${waited}t waiting for restock)` : ''}; carrying ${count(q, re)}`);
    return got;
}

/** Fly-fish until the pack is full or the trout carried cover the shortfall. Salmon is dropped. */
async function fishPack(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    await q.goTo(STRONGHOLD_FISHING, 6);
    let feathers = count(q, FEATHER);
    let lastCatch = tickNow(q.sdk);
    let clicked = Number.NEGATIVE_INFINITY;
    let caught = 0;
    while (troutShort(q) > 0 && freeSlots(q) > 0 && count(q, FEATHER) > 0) {
        const now = tickNow(q.sdk);
        const f = count(q, FEATHER);
        if (f !== feathers) {
            caught += feathers - f;
            feathers = f;
            lastCatch = now;
            clicked = now;
        }
        if (await dismissOne(q)) clicked = Number.NEGATIVE_INFINITY;
        const salmon = q.sdk.getInventory().find((i) => RAW_SALMON.test(i.name));
        if (salmon) await q.sdk.sendDropItem(salmon.slot);
        if (now - lastCatch > FISH_STALL_TICKS) throw new Error(`trout: no catch in ${FISH_STALL_TICKS}t at ${pos(q).x},${pos(q).z}`);
        if (now - clicked >= FISH_RECLICK_TICKS) {
            const spot = (q.sdk.getState()?.nearbyNpcs ?? [])
                .filter((n) => /^fishing spot$/i.test(n.name) && n.optionsWithIndex.some((o) => /^lure$/i.test(o.text)))
                .sort((a, b) => a.distance - b.distance)[0];
            if (!spot) {
                await q.goTo(STRONGHOLD_FISHING, 3);
            } else {
                const op = spot.optionsWithIndex.find((o) => /^lure$/i.test(o.text))!;
                await q.sdk.sendInteractNpc(spot.index, op.opIndex);
            }
            clicked = tickNow(q.sdk);
        }
        await q.sdk.waitForTicks(1);
    }
    // The last catch can still be on its way when the loop's condition ends it.
    await q.sdk.waitForTicks(2);
    const stray = q.sdk.getInventory().filter((i) => RAW_SALMON.test(i.name));
    for (const s of stray) await q.sdk.sendDropItem(s.slot);
    if (count(q, FEATHER) === 0 && troutShort(q) > 0) q.log('trout: out of feathers');
    q.log(`trout: fished ${caught} (${count(q, RAW_TROUT)} raw trout kept) in ${tickNow(q.sdk) - t0}t; ${count(q, FEATHER)} feathers left`);
}

/** Cook every raw trout carried on the range beside the bar. */
async function cookTrout(q: Quest): Promise<void> {
    if (count(q, RAW_TROUT) === 0) return;
    const t0 = tickNow(q.sdk);
    await q.goTo(BAR_RANGE, 2);
    const raw = () => count(q, RAW_TROUT);
    let seen = raw();
    let fired = Number.NEGATIVE_INFINITY;
    let progressAt = tickNow(q.sdk);
    while (raw() > 0) {
        const now = tickNow(q.sdk);
        if (raw() !== seen) {
            seen = raw();
            progressAt = now;
            fired = Number.NEGATIVE_INFINITY;
        }
        if (await dismissOne(q)) fired = Number.NEGATIVE_INFINITY;
        if (now - progressAt > COOK_STALL_TICKS) throw new Error(`trout: cooking stalled with ${raw()} raw at ${pos(q).x},${pos(q).z},L${pos(q).level}`);
        if (now - fired >= COOK_REFIRE_TICKS) {
            const it = q.sdk.getInventory().find((i) => RAW_TROUT.test(i.name));
            if (it) await q.sdk.sendUseItemOnLoc(it.slot, BAR_RANGE_LOC.x, BAR_RANGE_LOC.z, BAR_RANGE_LOC.id);
            fired = tickNow(q.sdk);
        }
        await q.sdk.waitForTicks(1);
    }
    await dismissOne(q);
    q.log(`trout: cooked to ${count(q, TROUT)} trout (${count(q, /^burnt/i)} burnt) in ${tickNow(q.sdk) - t0}t`);
}

/** A fly fishing rod and enough feathers in the pack (bank first, then Gerrant). */
async function fishingKit(q: Quest, feathers: number): Promise<void> {
    await openBank(q, 'Ardougne');
    await withdraw(q, ROD, 1);
    await withdraw(q, FEATHER, feathers);
    await q.bot.closeBank().catch(() => undefined);
    if (count(q, ROD) >= 1 && count(q, FEATHER) >= feathers) return;
    const want = [
        { pattern: ROD, amount: 1, label: 'fly fishing rod' },
        { pattern: FEATHER, amount: feathers, label: 'feather' },
    ];
    const cost = (count(q, ROD) ? 0 : ROD_GP) + Math.max(0, feathers - count(q, FEATHER)) * FEATHER_GP;
    if (count(q, COINS) < cost) throw new Error(`trout: the bank has ${count(q, ROD) ? '' : 'no fly fishing rod and '}${count(q, FEATHER)}/${feathers} feathers, and ${count(q, COINS)} coins carried will not buy the rest (~${cost}gp)`);
    const t0 = tickNow(q.sdk);
    q.log(`trout: rod ${count(q, ROD)}, feathers ${count(q, FEATHER)}/${feathers} — buying the rest from Gerrant, Port Sarim`);
    await buyAtShop(q.supply, GERRANT, want);
    if (count(q, ROD) < 1 || count(q, FEATHER) < Math.min(feathers, 20)) {
        throw new Error(`trout: Gerrant did not sell the kit (rod ${count(q, ROD)}, feathers ${count(q, FEATHER)})`);
    }
    q.log(`trout: kit bought in ${tickNow(q.sdk) - t0}t (rod ${count(q, ROD)}, feathers ${count(q, FEATHER)})`);
}

/** The bakery: what is on the shelf now (`waitTicks` 0), or wait out restocks to the target. */
async function breadLeg(q: Quest, waitTicks: number): Promise<void> {
    const need = () => short(q, 'bread', BREAD);
    while (need() > 0) {
        const t0 = tickNow(q.sdk);
        await q.goTo(BAKERY, 4);
        const got = await buyFromShelf(q, /^baker$/i, BREAD, 'bread', need, waitTicks);
        await q.goTo(HUB, 4);
        await bankHaul(q, 'Ardougne');
        q.log(`bread leg: ${got} in ${tickNow(q.sdk) - t0}t`);
        if (got === 0 || waitTicks <= 0) break;
    }
}

/** Specials and trout inside the stronghold; trout fishing fills the bar's restock waits. */
async function strongholdLeg(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    const needSpecials = () => short(q, 'special', SPECIAL);
    await crossGnomeGate(q, true);
    q.log(`stronghold: in after ${tickNow(q.sdk) - t0}t`);
    try {
        let trips = 0;
        while (needSpecials() > 0 || troutShort(q) > 0) {
            if (++trips > 40) throw new Error(`stronghold: still short after ${trips - 1} trips (${status()})`);
            const fishing = troutShort(q) > 0 && count(q, FEATHER) > 0 && count(q, ROD) > 0;
            if (troutShort(q) > 0 && !fishing) q.log('trout: no rod or feathers left; stopping trout here');
            if (fishing) {
                await leaveGrandTree(q);
                await fishPack(q);
            }
            await climbGrandTree(q);
            await cookTrout(q);
            if (needSpecials() > 0) {
                await q.goTo(BLURBERRY_BAR, 3);
                // While trout remain, only take the shelf; once they are done, wait out the restocks.
                const wait = troutShort(q) > 0 && fishing ? 0 : RESTOCK_GAP_TICKS;
                await buyFromShelf(q, /^barman$/i, SPECIAL, 'specials', needSpecials, wait);
            }
            await q.goTo(GRAND_TREE_BANK, 2);
            await bankHaul(q, 'Grand Tree');
            if (troutShort(q) > 0 && !fishing && needSpecials() === 0) break;
        }
    } finally {
        // Out through the gate even on a failure: the epilogue's walk to Ardougne has no route from inside.
        await leaveGrandTree(q).catch((e) => q.log(`stronghold: leaving the tree: ${(e as Error).message}`));
        await crossGnomeGate(q, false).catch((e) => q.log(`stronghold: leaving: ${(e as Error).message}`));
    }
    q.log(`stronghold leg: ${tickNow(q.sdk) - t0}t; ${status()}`);
}

await runTask({
    id: 'death-plateau-stock',
    hub: 'ardougne',
    task: async (q) => {
        const t0 = tickNow(q.sdk);
        if (!(TARGET > 0)) throw new Error(`bad --target ${TARGET}`);
        await openBank(q, 'Ardougne');
        readBank(q);
        const want = { special: short(q, 'special', SPECIAL), bread: short(q, 'bread', BREAD), trout: troutShort(q) };
        q.log(`death-plateau-stock: target ${TARGET}; ${status()}`);
        if (!want.special && !want.bread && !want.trout) {
            await q.bot.closeBank().catch(() => undefined);
            return q.log(`death-plateau-stock: bank holds ${TARGET} of each — already complete`);
        }
        if (want.trout && (q.level('fishing') < 20 || q.level('cooking') < 15)) {
            throw new Error(`trout needs Fishing 20 and Cooking 15 (have ${q.level('fishing')}/${q.level('cooking')})`);
        }
        const feathers = Math.ceil(want.trout * FEATHERS_PER_TROUT) + 10;
        // Twice the worst case: unspent coins are banked again at the end.
        const budget = 2 * (want.special * SPECIAL_MAX_GP + want.bread * BREAD_MAX_GP + (want.trout ? ROD_GP + feathers * FEATHER_GP : 0));
        const coinsBanked = bankCount(q, COINS);
        const minimum = want.special * 30 + want.bread * 12;
        if (coinsBanked < minimum) {
            await q.bot.closeBank().catch(() => undefined);
            throw new Error(`death-plateau-stock: ${coinsBanked} coins banked; ${want.special} specials and ${want.bread} bread cost at least ${minimum}`);
        }
        await withdraw(q, COINS, Math.min(coinsBanked, budget));
        await q.bot.closeBank().catch(() => undefined);
        q.log(`death-plateau-stock: short ${want.special} specials, ${want.bread} bread, ${want.trout} trout; carrying ${count(q, COINS)} coins`);

        // The bread shelf first; it refills (to 10 at most) while we are in the stronghold.
        if (want.bread) {
            const tb = tickNow(q.sdk);
            await breadLeg(q, 0);
            q.log(`leg bread (shelf): ${tickNow(q.sdk) - tb}t`);
        }
        if (want.trout) await fishingKit(q, feathers);
        if (want.special || want.trout) {
            const ts = tickNow(q.sdk);
            await strongholdLeg(q);
            await q.goTo(HUB, 4);
            q.log(`leg stronghold (specials + trout, there and back): ${tickNow(q.sdk) - ts}t`);
        }
        if (short(q, 'bread', BREAD) > 0) {
            const tb = tickNow(q.sdk);
            await breadLeg(q, RESTOCK_GAP_TICKS);
            q.log(`leg bread (restocks): ${tickNow(q.sdk) - tb}t`);
        }
        await q.goTo(HUB, 4);
        await bankHaul(q, 'Ardougne');
        const done = banked.special >= TARGET && banked.bread >= TARGET && banked.trout >= TARGET;
        q.log(`death-plateau-stock: ${status()} in ${tickNow(q.sdk) - t0}t${done ? ' — already complete' : ' — SHORT, run again'}`);
        if (!done) throw new Error(`death-plateau-stock: still short: ${status()}`);
    },
});
