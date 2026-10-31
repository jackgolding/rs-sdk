/**
 * Death Plateau bread, stolen: the east Baker's stall in East Ardougne, banked until the
 * bank holds `target` bread.
 *
 *   bun bots/quests/bread-stall.ts {botname} [--target=500]
 *
 * stealing.dbrow stealing_bakery_stall: Thieving 5, respawn 8t, loot cake 13 / bread 5 /
 * chocolate slice 2 of 20 — about one bread per 40 ticks, against the bakery shelf's one per
 * 100 (death-plateau-stock.ts). Chocolate slices are dropped; bread and cakes are banked.
 *
 * Stand on (2669,3310), the learnings/thieving.md safe spot east of the stall at (2667,3310).
 * A guard who sees a theft attacks (stealing_check_for_guard), and no stall can be robbed for
 * 10 ticks after combat: a dragon longsword is worn (from the bank, else the Jackpoo2 mule) so
 * the fight is short, and a cake is eaten under half HP.
 *
 * A task writes no run record; the finish logs "already complete" for todo-runner. It stops
 * at the bank on SIGTERM (q.stopRequested).
 */
import { runTask, type Quest } from './lib/run-quest';
import { tickNow, untilTicks } from './lib/ticks';
import { SAFE_BANKS } from './safe-stops';

const TARGET = Number(process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 500);
const HUB = SAFE_BANKS.ardougne;
const STALL = { x: 2667, z: 3310 };
const STAND = { x: 2669, z: 3310 };
const BREAD = /^bread$/i;
const CAKE = /^cake$/i;
const CHOCOLATE = /^chocolate slice$/i;
const SWORD = /^dragon longsword$/i;
/** No theft lands for this long while standing at the stall: something is wrong, stop. */
const STALL_TIMEOUT_TICKS = 300;

const count = (q: Quest, re: RegExp) => q.sdk.getInventory().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const bankCount = (q: Quest, re: RegExp) => q.sdk.getBankItems().filter((b) => re.test(b.name)).reduce((n, b) => n + b.count, 0);
const freeSlots = (q: Quest) => 28 - q.sdk.getInventory().length;
const me = (q: Quest) => q.sdk.getState()?.player;
const hpFrac = (q: Quest) => {
    const h = q.sdk.getSkill('hitpoints');
    return h && h.baseLevel > 0 ? h.level / h.baseLevel : 1;
};
const wearing = (q: Quest) => q.sdk.getEquipment().some((i) => SWORD.test(i.name));

let banked = 0;

/** Bank everything carried (the sword stays worn) and refresh the banked bread count. */
async function bankHaul(q: Quest): Promise<void> {
    await q.goTo(HUB, 4);
    await q.bot.openBank();
    for (const item of q.sdk.getInventory()) await q.bot.depositItem(item.name, -1);
    await untilTicks(q.sdk, () => q.sdk.getInventory().length === 0, 4);
    banked = bankCount(q, BREAD);
    await q.bot.closeBank();
}

/** A guard on us: fight it out (the sword makes it short), eating cakes under half HP. */
async function fightOff(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    while (me(q)?.combat?.inCombat && tickNow(q.sdk) - t0 < 200) {
        if (hpFrac(q) < 0.5 && count(q, CAKE) > 0) await q.bot.eatFood(CAKE).catch(() => undefined);
        const guard = (q.sdk.getNearbyNpcs() ?? []).find((n) => /guard/i.test(n.name) && n.distance <= 2 && n.inCombat && (n.hp ?? 1) > 0);
        if (guard && me(q)?.combat?.targetIndex !== guard.index) await q.bot.attack(guard).catch(() => undefined);
        await q.sdk.waitForTicks(2);
    }
    // stealing.rs2: "You can't steal from the market stall during combat!" for 10 ticks after.
    await q.sdk.waitForTicks(11);
    q.log(`stall: fight over in ${tickNow(q.sdk) - t0}t (HP ${q.sdk.getSkill('hitpoints')?.level})`);
}

/** Steal until the pack is full; returns the bread taken. */
async function stealPack(q: Quest): Promise<number> {
    const bread0 = count(q, BREAD);
    await q.goTo(STAND, 1);
    let lastTheft = tickNow(q.sdk);
    const t0 = tickNow(q.sdk);
    let thefts = 0;
    let tries = 0;
    while (freeSlots(q) > 0 && !q.stopRequested()) {
        if (tickNow(q.sdk) - lastTheft > STALL_TIMEOUT_TICKS) throw new Error(`stall: nothing stolen in ${STALL_TIMEOUT_TICKS}t at (${me(q)?.worldX},${me(q)?.worldZ})`);
        if (me(q)?.combat?.inCombat) await fightOff(q);
        if (hpFrac(q) < 0.5 && count(q, CAKE) > 0) await q.bot.eatFood(CAKE).catch(() => undefined);
        for (const slice of q.sdk.getInventory().filter((i) => CHOCOLATE.test(i.name))) await q.sdk.sendDropItem(slice.slot).catch(() => undefined);
        // The Baker spawns on the stand tile; one off it still reaches the stall.
        const p = me(q);
        if (p && Math.abs(p.worldX - STAND.x) + Math.abs(p.worldZ - STAND.z) > 1) {
            await q.sdk.sendWalk(STAND.x, STAND.z).catch(() => undefined);
            await q.sdk.waitForTicks(3);
        }
        await q.sdk.scanNearbyLocs(4).catch(() => undefined);
        const stall = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === STALL.x && l.z === STALL.z && l.optionsWithIndex.some((o) => /steal/i.test(o.text)));
        if (!stall) {
            // Robbed: the stall is a bare market loc until it respawns.
            await q.sdk.waitForTicks(2);
            continue;
        }
        const op = stall.optionsWithIndex.find((o) => /steal/i.test(o.text))!;
        const before = q.sdk.getInventory().length;
        await q.sdk.sendInteractLoc(stall.x, stall.z, stall.id, op.opIndex);
        tries++;
        if (await untilTicks(q.sdk, () => q.sdk.getInventory().length !== before, 5)) {
            lastTheft = tickNow(q.sdk);
            if (++thefts % 10 === 0) {
                const pack = ['bread', 'cake', 'chocolate slice'].map((n) => `${n} ${count(q, new RegExp(`^${n}$`, 'i'))}`).join(', ');
                q.log(`stall: ${thefts} thefts / ${tries} tries in ${tickNow(q.sdk) - t0}t; pack ${pack}, ${freeSlots(q)} free`);
            }
        }
    }
    for (const slice of q.sdk.getInventory().filter((i) => CHOCOLATE.test(i.name))) await q.sdk.sendDropItem(slice.slot).catch(() => undefined);
    return count(q, BREAD) - bread0;
}

await runTask({
    id: 'bread-stall',
    hub: 'ardougne',
    needs: [{ item: 'dragon longsword', count: 1 }],
    task: async (q) => {
        if (!(TARGET > 0)) throw new Error(`bad --target ${TARGET}`);
        if (!wearing(q)) {
            const r = await q.bot.equipItem(SWORD);
            if (!r.success && !wearing(q)) q.log(`stall: could not wield the dragon longsword (${r.message}); stealing without it`);
        }
        await bankHaul(q);
        q.log(`stall: target ${TARGET} bread; ${banked} banked`);
        const t0 = tickNow(q.sdk);
        const start = banked;
        let trips = 0;
        while (banked < TARGET && !q.stopRequested()) {
            const t = tickNow(q.sdk);
            const got = await stealPack(q);
            await bankHaul(q);
            trips++;
            const hours = ((tickNow(q.sdk) - t0) * 0.6) / 3600;
            q.log(`stall: trip ${trips}: ${got} bread in ${tickNow(q.sdk) - t}t; ${banked}/${TARGET} banked (${hours > 0 ? Math.round((banked - start) / hours) : 0}/h)`);
        }
        if (banked < TARGET) throw new Error(`stall: stopped with ${banked}/${TARGET} bread banked`);
        q.log(`stall: ${banked} bread banked — already complete`);
    },
});
