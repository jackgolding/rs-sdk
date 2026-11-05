/**
 * Turn everything processable in the account's bank into XP, at Al Kharid:
 *
 *   bun bots/quests/process-bank.ts {botname}
 *
 *   gems     chisel on uncut gems at the bank (opal 1 … dragonstone 55)
 *   herbs    Identify grimy herbs at the bank (guam 3 … torstol 75)
 *   cooking  raw food on the kebab shop range (3271,3180), burnt food banked
 *   smelting ore at the furnace (3272,3185): bronze, silver, steel, gold, mithril,
 *            adamant, rune, ore used on the furnace bar by bar. Coal goes to the
 *            highest bar the account will reach (lib/processing.ts planSmelting);
 *            iron ore with no coal stays banked.
 *   rings    gold bar + emerald (cut and smelted above count) at the furnace with a ring
 *            mould (banked, else Dommik's), Crafting 27; then Enchant Lvl-2 at the bank
 *            into rings of dueling, Magic 27, 3 air + 1 cosmic from the bank. Short runes:
 *            the rest stay banked as emerald rings. Runes are never bought.
 *   tanning  Ellis ("Tanner"): cowhide -> soft leather 1gp, dragonhides -> dragon leather
 *            20gp, coins from the bank; hides the coins do not cover stay banked.
 *
 * Each activity takes the lowest-level material first and re-picks after every pack,
 * so a level gained on one pack unlocks the next tier. Materials above the account's
 * level stay in the bank. One material per pack (27 + chisel, 28 otherwise), products
 * banked after each pack.
 *
 * Speed: a level-up dialog pauses the player (levelup.rs2 p_pausebutton) until it is
 * clicked (a new op also closes it), so every loop clicks it away the tick it shows and
 * fires the next action with it. Gem cuts and identifies have no delay in content
 * (uncut_gem.rs2, identify.rs2), so a whole pack's ops go out at once (burst); cooking
 * and smelting send the next use the tick the last input leaves the pack (useLoop).
 *
 * A task writes no run record, so a finish logs "already complete", the line todo-runner
 * marks done. Materials above the account's level, and any that stalled, stay banked and
 * are listed as leftovers; neither fails the run.
 */
import { runTask, type Quest } from './lib/run-quest';
import { SAFE_BANKS } from './safe-stops';
import { tickNow, untilTicks } from './lib/ticks';
import { BARS, COAL_ID, DUELING, FOODS, GEMS, HERBS, HIDES, planSmelting, slotsPerBar, type Bar, type Material } from './lib/processing';
import type { InventoryItem, NearbyLoc } from '../../sdk/types';

const HUB = SAFE_BANKS['al-kharid'];
/** Standing tile beside the real furnace (2781 at 3272,3185; 2785 at 3273,3184 is an option-less decoy). */
const FURNACE_STAND = { x: 3275, z: 3185 };
const RANGE_STAND = { x: 3272, z: 3180 };
const CHISEL = 1755;
const COINS = 995;
/** Ticks before a delay-free op (gem cut, identify) that has not landed is sent again. */
const RESEND_TICKS = 12;
/** Ticks after a use (cook, smelt) with no progress before it is sent again. */
const REFIRE_TICKS = 5;
/** Ticks with no progress before a pack of delay-free ops (burst) is given up on. */
const STALL_TICKS = 30;
/** Fires in a row that produce nothing before a pack is given up on (progressLoop). */
const MAX_DRY_FIRES = 4;
/** Ticks a furnace fire for rings gets to show a ring before the next (a ring every 3t once going). */
const RING_REFIRE_TICKS = 12;
/** NODE_XPRATE default (WorldConfig.ts); replaced by the rate measured on the first smelting pack. */
const DEFAULT_XP_RATE = 25;

/** Materials that stalled this run: not retried this run, left banked and listed as leftovers. */
const failed = new Set<number>();
const summary: string[] = [];
let xpRate: number | null = null;

const invCount = (q: Quest, id: number) => q.sdk.getInventory().filter((i) => i.id === id).reduce((n, i) => n + (i.count ?? 1), 0);
const invOf = (q: Quest, ids: number[]) => q.sdk.getInventory().filter((i) => ids.includes(i.id));
const xpOf = (q: Quest, skill: string) => q.sdk.getSkill(skill)?.experience ?? 0;
const awayFrom = (q: Quest, t: { x: number; z: number }) => {
    const p = q.sdk.getState()?.player;
    return Math.hypot((p?.worldX ?? 0) - t.x, (p?.worldZ ?? 0) - t.z);
};

const TRACE = process.env.PROCESS_BANK_TRACE === '1';
const trace = (q: Quest, msg: string) => TRACE && console.log(`  t${tickNow(q.sdk)} ${msg}`);

/** A level-up (or any single-button) dialog: click it away now. True when one was open. */
async function dismissLevelUp(q: Quest): Promise<boolean> {
    const d = q.sdk.getState()?.dialog;
    if (!d?.isOpen || d.options.length > 1) return false;
    await q.sdk.sendClickDialog(d.options[0]?.index ?? 0);
    return true;
}

async function openBank(q: Quest): Promise<void> {
    if (q.sdk.getState()?.bank?.isOpen) return;
    if (awayFrom(q, HUB) > 6) await q.goTo(HUB, 4);
    let r = await q.bot.openBank();
    if (!r.success) {
        await q.goTo(HUB, 2);
        r = await q.bot.openBank();
    }
    if (!r.success) throw new Error(`process-bank: could not open the Al Kharid bank: ${r.message}`);
}

const bankCounts = (q: Quest) => new Map(q.sdk.getBankItems().map((b) => [b.id, b.count] as [number, number]));

/** Bank everything carried except `keep` (ids). Bank must be reachable. */
async function depositAll(q: Quest, keep: number[] = []): Promise<void> {
    await openBank(q);
    let misses = 0;
    for (let i = 0; i < 30; i++) {
        const item = q.sdk.getInventory().find((it) => !keep.includes(it.id));
        if (!item) return;
        const r = await q.bot.depositItem(item, -1);
        if (r.success || r.partial) continue;
        // A deposit can land after depositItem stops waiting (jacklove6's Diamonds, ABGARMY17's
        // Sapphires, 2026-10-30): look again before calling it a failure, and retry a few times.
        await q.sdk.waitForTicks(2);
        if (!q.sdk.getInventory().some((it) => it.id === item.id)) continue;
        if (++misses > 3) throw new Error(`process-bank: deposit ${item.name}: ${r.message}`);
        q.log(`process-bank: deposit ${item.name} missed (${r.message}); retrying`);
        await openBank(q);
    }
}

/** Withdraw up to `amount` (-1 all) of a banked id; returns how many arrived. */
async function withdraw(q: Quest, id: number, amount: number): Promise<number> {
    const b = q.sdk.getBankItems().find((x) => x.id === id);
    if (!b || amount === 0) return 0;
    const before = invCount(q, id);
    await q.bot.withdrawItem(b, amount < 0 || amount >= b.count ? -1 : amount);
    return invCount(q, id) - before;
}

async function closeBank(q: Quest): Promise<void> {
    if (q.sdk.getState()?.bank?.isOpen) await q.bot.closeBank();
}

/**
 * Fire `fire` at every pending item at once and let the server work through them: the
 * engine decodes 5 user events a tick and carries the rest over, so a pack of 27 cuts
 * lands in ~6 ticks however slow our round trip is. An item still pending RESEND_TICKS
 * after its op (dropped, or a level-up got in the way) is fired again. Level-ups are
 * clicked away as they appear (the next op closes them too). False after STALL_TICKS
 * without progress.
 */
async function burst(q: Quest, pending: () => InventoryItem[], fire: (it: InventoryItem) => Promise<unknown>): Promise<boolean> {
    const firedAt = new Map<number, number>();
    let left = pending().length;
    let lastProgress = tickNow(q.sdk);
    while (left > 0) {
        if (await dismissLevelUp(q)) trace(q, 'level-up dismissed');
        const t = tickNow(q.sdk);
        const due = pending().filter((it) => t - (firedAt.get(it.slot) ?? Number.NEGATIVE_INFINITY) >= RESEND_TICKS);
        for (const it of due) firedAt.set(it.slot, t);
        await Promise.all(due.map(fire));
        if (due.length) trace(q, `fired ${due.length}, ${pending().length} pending`);
        await q.sdk.waitForTicks(1);
        const now = pending().length;
        if (now < left) lastProgress = tickNow(q.sdk);
        else if (tickNow(q.sdk) - lastProgress > STALL_TICKS) return false;
        left = now;
    }
    return true;
}

/**
 * One activity: pick the lowest-level banked material the account can do, run `pack`
 * on it, bank the products, and pick again until nothing is left at this level.
 */
async function activity(q: Quest, name: string, skill: string, materials: Material[], pack: (m: Material) => Promise<{ ok: boolean; made: number }>, keep: number[] = []): Promise<void> {
    const t0 = tickNow(q.sdk);
    const xp0 = xpOf(q, skill);
    const lvl0 = q.level(skill);
    let total = 0;
    for (;;) {
        await openBank(q);
        const bank = bankCounts(q);
        const m = materials.find((x) => (bank.get(x.id) ?? 0) > 0 && x.level <= q.level(skill) && !failed.has(x.id));
        if (!m) break;
        const tp = tickNow(q.sdk);
        const xpBefore = xpOf(q, skill);
        const res = await pack(m);
        total += res.made;
        q.log(`${name}: ${res.made} ${m.name} in ${tickNow(q.sdk) - tp}t (+${xpOf(q, skill) - xpBefore} xp, ${skill} ${q.level(skill)})`);
        if (!res.ok) {
            failed.add(m.id);
            q.log(`WARN ${name}: ${m.name} stalled; leaving the rest banked`);
        }
        await depositAll(q, keep);
    }
    if (total > 0) {
        const ticks = tickNow(q.sdk) - t0;
        const line = `${name}: ${total} done in ${ticks}t (${(ticks / total).toFixed(1)}t each), ${skill} ${lvl0} -> ${q.level(skill)} (+${xpOf(q, skill) - xp0} xp)`;
        summary.push(line);
        q.log(line);
    }
}

// ── gems: chisel + 27 uncut, cut at the bank
async function ensureChisel(q: Quest): Promise<void> {
    if (invCount(q, CHISEL) > 0) return;
    await openBank(q);
    if ((await withdraw(q, CHISEL, 1)) > 0) return;
    q.log('gems: no chisel banked — buying one from Dommik');
    await withdraw(q, COINS, 10);
    await closeBank(q);
    await q.ensure('chisel', 1);
    await depositAll(q, [CHISEL]);
}

async function gemPack(q: Quest, m: Material): Promise<{ ok: boolean; made: number }> {
    await ensureChisel(q);
    await openBank(q);
    await depositAll(q, [CHISEL]);
    const got = await withdraw(q, m.id, -1);
    await closeBank(q);
    const chisel = () => q.sdk.getInventory().find((i) => i.id === CHISEL);
    const ok = await burst(q, () => invOf(q, [m.id]), async (gem) => {
        const c = chisel();
        if (c) await q.sdk.sendUseItemOnItem(c.slot, gem.slot);
    });
    return { ok, made: got - invCount(q, m.id) };
}

// ── herbs: 28 grimy, identified at the bank
async function herbPack(q: Quest, m: Material): Promise<{ ok: boolean; made: number }> {
    await depositAll(q);
    const got = await withdraw(q, m.id, -1);
    await closeBank(q);
    const ok = await burst(q, () => invOf(q, [m.id]), async (herb) => {
        const op = herb.optionsWithIndex?.find((o) => /identify/i.test(o.text))?.opIndex ?? 1;
        await q.sdk.sendUseItem(herb.slot, op);
    });
    return { ok, made: got - invCount(q, m.id) };
}

// ── cooking: 28 raw on the range, the next one the tick the last leaves the pack
async function findLoc(q: Quest, name: RegExp, option?: RegExp): Promise<NearbyLoc | null> {
    let loc = q.sdk.findNearbyLoc(name, option ? { withOption: option } : undefined);
    if (!loc) {
        await q.sdk.scanNearbyLocs(12).catch(() => undefined);
        loc = q.sdk.findNearbyLoc(name, option ? { withOption: option } : undefined);
    }
    return loc;
}

/**
 * Use `item` on `loc` until `more()` is false: the next use goes out one tick after
 * `progress()` moves (or REFIRE_TICKS after the last), a level-up is clicked away and
 * the next use sent with it. False when progressLoop gives up.
 *
 * Measured on the 400ms gate engine behind 150ms lag (2026-10-30): a use sent the tick
 * a bar shows at the furnace often got "Nothing interesting happens" and cost a refire
 * (10 bronze in 90t); one tick later, 79t. One use per tick buys nothing for cooking
 * (6t a shrimp either way: 2 on the stove, ~4 before the next op starts) and would clear
 * smelting's weak queue (clearPendingAction -> closeModal). "Smelt X" was 68t for 10
 * bars with no level-ups but 167t at Smithing 1, where every bar levels and each
 * reopen of the interface costs ~10t; ore-on-furnace does not care about level-ups.
 */
async function useLoop(q: Quest, loc: NearbyLoc, item: number, more: () => boolean, progress: () => number): Promise<boolean> {
    return progressLoop(q, async () => {
        const it = q.sdk.getInventory().find((i) => i.id === item);
        if (it) await q.sdk.sendUseItemOnLoc(it.slot, loc.x, loc.z, loc.id);
        trace(q, `use #${item} on ${loc.name}`);
    }, more, progress);
}

/**
 * `fire` until `more()` is false: again `quiet` ticks after `progress()` moves (1 for a
 * one-product action), or `refire` ticks after the last fire finished with nothing.
 * Level-ups are clicked away and the next fire sent with them.
 *
 * Gives up (false) only after both STALL_TICKS without progress and MAX_DRY_FIRES fires
 * in a row with nothing, each given its `refire` ticks to show. Ticks alone were not
 * enough: a furnace fire (bar on, wait for the interface, click) can take 15+ ticks to
 * show its first ring under heavy lag, and a tick budget alone ran out before it did.
 */
async function progressLoop(q: Quest, fire: () => Promise<unknown>, more: () => boolean, progress: () => number, quiet = 1, refire = REFIRE_TICKS): Promise<boolean> {
    let seen = progress();
    let fired = Number.NEGATIVE_INFINITY;
    let dry = 0;
    let lastProgress = tickNow(q.sdk);
    while (more()) {
        const t = tickNow(q.sdk);
        const p = progress();
        if (p !== seen) {
            seen = p;
            dry = 0;
            lastProgress = t;
            fired = t + quiet - refire;
        }
        if (await dismissLevelUp(q)) {
            trace(q, 'level-up dismissed');
            fired = Number.NEGATIVE_INFINITY;
        }
        if (tickNow(q.sdk) - fired >= refire) {
            if (dry >= MAX_DRY_FIRES && t - lastProgress > STALL_TICKS) return false;
            await fire();
            dry++;
            // From when the fire finished: a fire that waits on an interface must not be
            // followed at once by another (a second bar on the furnace closes the first's
            // interface before it is clicked; ABGARMY04 made 0 rings in 114t, 2026-10-30).
            fired = tickNow(q.sdk);
        }
        await q.sdk.waitForTicks(1);
    }
    return true;
}

async function cookPack(q: Quest, m: Material): Promise<{ ok: boolean; made: number }> {
    await depositAll(q);
    const got = await withdraw(q, m.id, -1);
    await closeBank(q);
    if (awayFrom(q, RANGE_STAND) > 3) await q.goTo(RANGE_STAND, 2);
    const range = await findLoc(q, /^range$/i);
    if (!range) throw new Error('process-bank: no range by the kebab shop');
    // The first use walks in and opens the kebab shop door if someone shut it.
    const first = q.sdk.getInventory().find((i) => i.id === m.id);
    if (first) await q.bot.useItemOnLoc(first, range);
    const raw = () => invCount(q, m.id);
    const ok = await useLoop(q, range, m.id, () => raw() > 0, raw);
    return { ok, made: got - raw() };
}

// ── smelting: one bar type per pack, ore used on the furnace one bar at a time
// (smelting.rs2 smelt_ore_single: no interface, and nothing for a level-up to cancel;
// iron ore with 2+ coal at Smithing 30 makes steel, every other ore its own bar).
const canSmelt = (q: Quest, bar: Bar) => invCount(q, bar.ore) >= 1 && (!bar.second || invCount(q, bar.second.id) >= bar.second.per);

async function smeltPack(q: Quest, bar: Bar, n: number): Promise<{ ok: boolean; made: number }> {
    await depositAll(q);
    const ore = await withdraw(q, bar.ore, n);
    if (bar.second) await withdraw(q, bar.second.id, ore * bar.second.per);
    await closeBank(q);
    if (awayFrom(q, FURNACE_STAND) > 2) await q.goTo(FURNACE_STAND, 1);
    const furnace = await findLoc(q, /furnace/i, /smelt/i);
    if (!furnace) throw new Error('process-bank: no furnace with a Smelt option in view');
    const xp0 = xpOf(q, 'smithing');
    const ok = await useLoop(q, furnace, bar.ore, () => canSmelt(q, bar), () => invCount(q, bar.ore));
    const made = invCount(q, bar.id);
    const gained = xpOf(q, 'smithing') - xp0;
    if (made > 0 && gained > 0) xpRate = Math.round((gained * 10) / (made * bar.xp10));
    return { ok, made };
}

async function smelting(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    const xp0 = xpOf(q, 'smithing');
    const lvl0 = q.level('smithing');
    let total = 0;
    let lastPlan = '';
    for (;;) {
        await openBank(q);
        const plan = planSmelting(bankCounts(q), xpOf(q, 'smithing'), xpRate ?? DEFAULT_XP_RATE);
        const planText = BARS.filter((b) => plan.get(b.key)).map((b) => `${plan.get(b.key)} ${b.key}`).join(', ') || 'nothing';
        if (planText !== lastPlan) q.log(`smelting plan (Smithing ${q.level('smithing')}, xp rate ${xpRate ?? `${DEFAULT_XP_RATE}?`}): ${planText}`);
        lastPlan = planText;
        const bar = BARS.find((b) => (plan.get(b.key) ?? 0) > 0 && b.level <= q.level('smithing') && !failed.has(b.ore));
        if (!bar) break;
        const n = Math.min(plan.get(bar.key)!, Math.floor(28 / slotsPerBar(bar)));
        const tp = tickNow(q.sdk);
        const res = await smeltPack(q, bar, n);
        total += res.made;
        q.log(`smelting: ${res.made} ${bar.key} bars in ${tickNow(q.sdk) - tp}t (Smithing ${q.level('smithing')})`);
        if (!res.ok) {
            failed.add(bar.ore);
            q.log(`WARN smelting: ${bar.key} stalled; leaving its ore banked`);
        }
        await depositAll(q);
    }
    if (total > 0) {
        const ticks = tickNow(q.sdk) - t0;
        const line = `smelting: ${total} bars in ${ticks}t (${(ticks / total).toFixed(1)}t each), Smithing ${lvl0} -> ${q.level('smithing')} (+${xpOf(q, 'smithing') - xp0} xp)`;
        summary.push(line);
        q.log(line);
    }
}

// ── rings of dueling: gold bar + emerald at the furnace, then Enchant Lvl-2 at the bank
const D = DUELING;
/** Ticks to wait for the jewellery interface after a bar goes on the furnace (3t locally; prod is slower). */
const JEWELLERY_OPEN_TICKS = 20;
/** Up to 13 pairs a pack: mould + 13 bars + 13 emeralds = 27 slots. */
const PAIRS_PER_PACK = 13;

/** Hold one of a tool: the bank's, else its source (bought with banked coins). */
async function ensureTool(q: Quest, id: number, item: string): Promise<void> {
    if (invCount(q, id) > 0) return;
    await openBank(q);
    if ((await withdraw(q, id, 1)) > 0) return;
    q.log(`no ${item} banked — getting one`);
    await withdraw(q, COINS, 10);
    await closeBank(q);
    await q.ensure(item, 1);
    await depositAll(q, [id]);
}

async function makeRings(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    const xp0 = xpOf(q, 'crafting');
    let total = 0;
    for (;;) {
        await openBank(q);
        const bank = bankCounts(q);
        const pairs = Math.min(bank.get(D.goldBar) ?? 0, bank.get(D.emerald) ?? 0);
        if (!pairs || q.level('crafting') < D.craftingLevel || failed.has(D.emeraldRing)) break;
        await ensureTool(q, D.mould, 'ring mould');
        await depositAll(q, [D.mould]);
        const n = Math.min(pairs, PAIRS_PER_PACK);
        await withdraw(q, D.goldBar, n);
        await withdraw(q, D.emerald, n);
        await closeBank(q);
        const tp = tickNow(q.sdk);
        if (awayFrom(q, FURNACE_STAND) > 2) await q.goTo(FURNACE_STAND, 1);
        const furnace = await findLoc(q, /furnace/i, /smelt/i);
        if (!furnace) throw new Error('process-bank: no furnace with a Smelt option in view');
        const ringsHeld = () => invCount(q, D.emeraldRing);
        // Bar on furnace opens the jewellery interface; "Make 10" emerald rings runs one
        // p_delay(2) chain (a ring every 3t). Fired again only once the chain has gone quiet.
        const jewelleryOpen = () => {
            const i = q.sdk.getState()?.interface;
            return !!i?.isOpen && i.interfaceId === D.jewelleryInterface;
        };
        let opens = 0;
        let clicks = 0;
        let clicked = false; // a Make-10 already went to the interface that is up now
        const ok = await progressLoop(
            q,
            async () => {
                // Interface up and not yet clicked (it opened late): click it. Up and already
                // clicked with nothing made: it is stale (seen under 900ms lag on the gate
                // engine, 2026-10-30), so close it and start again with a bar on the furnace.
                if (jewelleryOpen() && clicked) {
                    await q.sdk.sendCloseModal();
                    await untilTicks(q.sdk, () => !jewelleryOpen(), 5);
                }
                if (!jewelleryOpen()) {
                    const bar = q.sdk.getInventory().find((i) => i.id === D.goldBar);
                    if (!bar) return;
                    await q.sdk.sendUseItemOnLoc(bar.slot, furnace.x, furnace.z, furnace.id);
                    opens++;
                    clicked = false;
                    if (!(await untilTicks(q.sdk, jewelleryOpen, JEWELLERY_OPEN_TICKS))) return;
                    await q.sdk.waitForTicks(1); // the rings inv lands with the interface; let the client have it
                }
                await q.sdk.sendClickComponentWithOption(D.ringsInv, 3, D.emeraldSlot);
                clicks++;
                clicked = true;
                trace(q, 'make 10 emerald rings');
            },
            () => invCount(q, D.goldBar) > 0 && invCount(q, D.emerald) > 0,
            ringsHeld,
            RING_REFIRE_TICKS,
            RING_REFIRE_TICKS,
        );
        if (!ok) {
            // What prod could not tell us last time.
            const st = q.sdk.getState();
            const msgs = (st?.gameMessages ?? []).slice(-6).map((m) => m.text).join(' | ');
            q.log(`WARN rings: stalled after ${opens} bar uses / ${clicks} make-10 clicks; furnace ${furnace.id} at (${furnace.x},${furnace.z}), player (${st?.player?.worldX},${st?.player?.worldZ}), interface ${st?.interface?.isOpen ? st.interface.interfaceId : 'closed'}, dialog ${st?.dialog?.isOpen ? st.dialog.options.map((o) => o.text).join('/') || 'open' : 'closed'}, held ${q.sdk.getInventory().map((i) => `${i.id}x${i.count}`).join(' ')}; last messages: ${msgs}`);
        }
        const made = ringsHeld();
        total += made;
        q.log(`rings: ${made} emerald rings in ${tickNow(q.sdk) - tp}t (Crafting ${q.level('crafting')})`);
        if (!ok) {
            failed.add(D.emeraldRing);
            q.log('WARN rings: emerald rings stalled; leaving the gold bars and emeralds banked');
        }
        await depositAll(q, [D.mould]);
    }
    if (total > 0) {
        const ticks = tickNow(q.sdk) - t0;
        const line = `rings: ${total} emerald rings in ${ticks}t (${(ticks / total).toFixed(1)}t each), +${xpOf(q, 'crafting') - xp0} crafting xp`;
        summary.push(line);
        q.log(line);
    }
}

async function enchantRings(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    let total = 0;
    for (;;) {
        await openBank(q);
        const bank = bankCounts(q);
        const n = Math.min(bank.get(D.emeraldRing) ?? 0, Math.floor((bank.get(D.air) ?? 0) / 3), bank.get(D.cosmic) ?? 0, 26);
        if (!n || q.level('magic') < D.magicLevel || failed.has(D.dueling)) break;
        await depositAll(q);
        await withdraw(q, D.air, 3 * n);
        await withdraw(q, D.cosmic, n);
        await withdraw(q, D.emeraldRing, n);
        await closeBank(q);
        const tp = tickNow(q.sdk);
        const ringsLeft = () => invCount(q, D.emeraldRing);
        const ok = await progressLoop(
            q,
            async () => {
                const ring = q.sdk.getInventory().find((i) => i.id === D.emeraldRing);
                if (ring) await q.sdk.sendSpellOnItem(ring.slot, D.enchantSpell);
                trace(q, 'enchant');
            },
            () => ringsLeft() > 0 && invCount(q, D.air) >= 3 && invCount(q, D.cosmic) >= 1,
            ringsLeft,
        );
        const made = invCount(q, D.dueling);
        total += made;
        q.log(`enchant: ${made} rings of dueling in ${tickNow(q.sdk) - tp}t (Magic ${q.level('magic')})`);
        if (!ok) {
            failed.add(D.dueling);
            q.log('WARN enchant: stalled; leaving the emerald rings banked');
        }
        await depositAll(q);
    }
    if (total > 0) {
        const ticks = tickNow(q.sdk) - t0;
        const line = `enchant: ${total} rings of dueling in ${ticks}t (${(ticks / total).toFixed(1)}t each)`;
        summary.push(line);
        q.log(line);
    }
}

// ── tanning: Ellis (npc "Tanner", spawn 3276,3193), tan-All per hide type
const TANNER = { x: 3275, z: 3192 };

async function tanHides(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    let total = 0;
    for (const hide of HIDES) {
        while (!failed.has(hide.id)) {
            await openBank(q);
            const bank = bankCounts(q);
            const n = Math.min(bank.get(hide.id) ?? 0, 27, Math.floor((bank.get(COINS) ?? 0) / hide.cost));
            if (!n) break;
            await depositAll(q);
            await withdraw(q, COINS, n * hide.cost);
            const got = await withdraw(q, hide.id, n);
            await closeBank(q);
            const tp = tickNow(q.sdk);
            if (awayFrom(q, TANNER) > 4) await q.goTo(TANNER, 3);
            const tanner = q.sdk.findNearbyNpc(/^tanner$/i);
            if (!tanner) throw new Error('process-bank: no tanner in Al Kharid');
            for (let i = 0; i < 3 && invCount(q, hide.id) > 0; i++) {
                await q.bot.interactNpc(tanner, /trade/i);
                if (!(await untilTicks(q.sdk, (s) => !!s.interface?.isOpen, 15))) continue;
                await q.sdk.sendClickComponent(hide.button);
                await untilTicks(q.sdk, () => invCount(q, hide.id) === 0, 8);
            }
            await q.bot.closeInterface().catch(() => undefined);
            const tanned = got - invCount(q, hide.id);
            total += tanned;
            q.log(`tanning: ${tanned} ${hide.name} in ${tickNow(q.sdk) - tp}t`);
            if (tanned < got) {
                failed.add(hide.id);
                q.log(`WARN tanning: ${hide.name} did not all tan; leaving the rest banked`);
            }
            await depositAll(q);
        }
    }
    if (total > 0) {
        const line = `tanning: ${total} hides in ${tickNow(q.sdk) - t0}t`;
        summary.push(line);
        q.log(line);
    }
}

/** What stays banked and why, read from the open bank. */
function leftovers(q: Quest): string[] {
    const bank = bankCounts(q);
    const out: string[] = [];
    const above = (list: Material[], skill: string) => {
        for (const m of list) {
            const n = bank.get(m.id) ?? 0;
            if (n) out.push(`${n} ${m.name} (${failed.has(m.id) ? 'stalled' : `${skill} ${m.level}`})`);
        }
    };
    above(GEMS, 'Crafting');
    above(HERBS, 'Herblore');
    above(FOODS, 'Cooking');
    for (const bar of BARS) {
        const n = bank.get(bar.ore) ?? 0;
        if (!n) continue;
        const why = failed.has(bar.ore)
            ? 'stalled'
            : q.level('smithing') < bar.level
              ? `${bar.key}: Smithing ${bar.level}`
              : bar.second
                ? `${bar.key}: no ${bar.second.id === COAL_ID ? 'coal' : 'tin'} left for it`
                : `${bar.key}: unplanned`;
        out.push(`${n} ${bar.oreName} (${why})`);
    }
    const coal = bank.get(COAL_ID) ?? 0;
    if (coal) out.push(`${coal} coal`);
    const bars = bank.get(D.goldBar) ?? 0;
    const gems = bank.get(D.emerald) ?? 0;
    const ringGate = q.level('crafting') < D.craftingLevel ? ` (rings: Crafting ${D.craftingLevel})` : failed.has(D.emeraldRing) ? ' (rings: stalled)' : ' (no partner for a ring)';
    if (bars) out.push(`${bars} gold bar${ringGate}`);
    if (gems) out.push(`${gems} emerald${ringGate}`);
    const rings = bank.get(D.emeraldRing) ?? 0;
    if (rings) out.push(`${rings} emerald ring (${q.level('magic') < D.magicLevel ? `enchant: Magic ${D.magicLevel}` : failed.has(D.dueling) ? 'enchant: stalled' : 'enchant: runes short'})`);
    for (const hide of HIDES) {
        const n = bank.get(hide.id) ?? 0;
        if (n) out.push(`${n} ${hide.name} (${failed.has(hide.id) ? 'stalled' : `tanning: ${hide.cost}gp each, coins short`})`);
    }
    return out;
}

/** --only=rings,tanning runs just those steps (gems, herbs, cooking, smelting, rings, tanning). */
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const on = (step: string) => !only || only.includes(step);

await runTask({
    id: 'process-bank',
    hub: 'al-kharid',
    // Bank, furnace and range take a crowd; the quest default of 3 queued 46 accounts for hours.
    maxConcurrent: 8,
    task: async (q) => {
        const t0 = tickNow(q.sdk);
        if (on('gems')) await activity(q, 'gems', 'crafting', GEMS, (m) => gemPack(q, m), [CHISEL]);
        if (on('herbs')) await activity(q, 'herbs', 'herblore', HERBS, (m) => herbPack(q, m));
        if (on('cooking')) await activity(q, 'cooking', 'cooking', FOODS, (m) => cookPack(q, m));
        if (on('smelting')) await smelting(q);
        if (on('rings')) {
            await makeRings(q);
            await enchantRings(q);
        }
        if (on('tanning')) await tanHides(q);
        await depositAll(q);
        const left = leftovers(q);
        await closeBank(q);
        q.log(`process-bank: ${summary.length ? summary.join('; ') : 'nothing processed'} — ${tickNow(q.sdk) - t0}t`);
        if (left.length) q.log(`process-bank: left banked: ${left.join(', ')}`);
        // A stalled material is a leftover, not a failed run: it stays banked (listed above as
        // "stalled") and the next run tries it again. Failing here charged the account a
        // failure every run for one bad furnace (ABGARMY04, 2026-10-30).
        if (failed.size) q.log(`WARN process-bank: ${failed.size} material(s) stalled this run and stay banked (see WARN lines)`);
        q.log('process-bank: already complete — nothing left this account can process');
    },
});
