/**
 * Buy out the Legends Guild's capes of legends (Siegfried Erkle, top floor; legends_guild.inv stock6: 3 capes,
 * one back every 500 ticks) over several restocks, banking at Ardougne when the pack fills. Needs Legends' Quest
 * done (the guild's doors). A run-once task; fleet-capes timer queues it now and then (user, 2026-11-08).
 *
 *   bun bots/quests/legends-capes.ts {botname} [--rounds=6] [--also='dusty key']
 *
 * Banked in this account: a cape of legends is tradeable=no, so it cannot go to a mule.
 */
import { runTask, type Quest } from './lib/run-quest';
import { itemPattern } from './lib/sources';
import { ARDOUGNE_BANK } from './tiles';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const ROUNDS = Number(arg('rounds') ?? 6);
const ALSO = (arg('also') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
/** Siegfried Erkle's counter (wiki/shops/legends-guild-shop-of-useful-items.md). */
const SIEGFRIED = { x: 2725, z: 3381, level: 2, npc: /^siegfried erkle$/i };
const RESTOCK_TICKS = 500;
const CAPE = /^cape of legends$/i;
const COINS_FLOAT = 5000;

/** Outside the guild's gate, and a tile inside the guild hall near its stairs. */
const GATE_OUT = { x: 2728, z: 3348 };
const HALL = { x: 2729, z: 3375 };
/** The ladder up to Siegfried's room, on the first floor. */
const WEST_LADDER = { x: 2725, z: 3375 };

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
/** Up to Siegfried: on foot to the guild, through its gate (legends-quest's throughGuildGate), then up the stairs. */
async function toSiegfried(q: Quest): Promise<void> {
    if (pos(q).level === 2 && Math.hypot(pos(q).x - SIEGFRIED.x, pos(q).z - SIEGFRIED.z) <= 6) return;
    if (pos(q).z <= 3349) {
        await q.goTo(GATE_OUT, 2);
        for (let attempt = 1; attempt <= 3 && pos(q).z <= 3349; attempt++) {
            await q.sdk.scanNearbyLocs(8).catch(() => undefined);
            const gate = (q.sdk.getNearbyLocs() ?? []).find((l) => /^gate$/i.test(l.name) && Math.abs(l.x - 2728) <= 2 && Math.abs(l.z - 3349) <= 1 && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)));
            if (!gate) throw new Error(`capes: no Legends Guild gate near (${pos(q).x},${pos(q).z})`);
            await q.sdk.sendInteractLoc(gate.x, gate.z, gate.id, gate.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
            await q.sdk.waitForTicks(3);
            // It swings shut in a few ticks: a plain walk through, not walkTo (that would "open" it again).
            await q.sdk.sendWalk(2728, 3351);
            await q.sdk.waitForTicks(4);
        }
        if (pos(q).z <= 3349) throw new Error(`capes: the guild gate did not let us in (Legends' Quest done?)`);
    }
    if (pos(q).level === 0) await q.bot.walkTo(HALL.x, HALL.z, 3).catch(() => undefined);
    // The top floor is two rooms: the east ladder lands in the guild's bank, Siegfried's room has its own ladder
    // from the first floor at (2725,3375) (probed locally, 2026-11-08).
    if (pos(q).level === 2 && pos(q).x >= 2729) await q.climbTo(1, WEST_LADDER);
    if (pos(q).level < 1) await q.climbTo(1, WEST_LADDER);
    if (pos(q).level === 1) {
        await q.bot.walkTo(WEST_LADDER.x, WEST_LADDER.z + 1, 1).catch(() => undefined);
        for (let attempt = 1; attempt <= 3 && pos(q).level === 1; attempt++) {
            await q.sdk.scanNearbyLocs(6).catch(() => undefined);
            const ladder = (q.sdk.getNearbyLocs() ?? []).find((l) => /^ladder$/i.test(l.name) && Math.abs(l.x - WEST_LADDER.x) <= 1 && Math.abs(l.z - WEST_LADDER.z) <= 1 && l.optionsWithIndex.some((o) => /climb-up/i.test(o.text)));
            if (!ladder) throw new Error(`capes: no ladder up at (${WEST_LADDER.x},${WEST_LADDER.z}) from (${pos(q).x},${pos(q).z},L1)`);
            await q.sdk.sendInteractLoc(ladder.x, ladder.z, ladder.id, ladder.optionsWithIndex.find((o) => /climb-up/i.test(o.text))!.opIndex);
            await q.sdk.waitForTicks(5);
        }
    }
    if (pos(q).level !== 2) throw new Error(`capes: not up to Siegfried's floor (at ${pos(q).x},${pos(q).z},L${pos(q).level})`);
}

const held = (q: Quest, re: RegExp) => q.sdk.getInventory().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);

async function bankPack(q: Quest): Promise<number> {
    if (pos(q).level !== 0) await q.climbTo(0);
    await q.goTo(ARDOUGNE_BANK, 4);
    const r = await q.bot.openBank();
    if (!r.success && !q.sdk.getState()?.bank?.isOpen) throw new Error(`capes: bank did not open: ${r.message}`);
    for (const i of q.sdk.getInventory()) if (!/^coins$/i.test(i.name)) await q.bot.depositItem(i, -1).catch(() => undefined);
    await q.sdk.waitForTicks(2);
    if (held(q, /^coins$/i) < COINS_FLOAT) {
        const c = q.sdk.getBankItems().find((b) => /^coins$/i.test(b.name));
        if (c) await q.bot.withdrawItem(c, Math.min(c.count, COINS_FLOAT - held(q, /^coins$/i))).catch(() => undefined);
        await q.sdk.waitForTicks(2);
    }
    const banked = q.sdk.getBankItems().find((b) => CAPE.test(b.name))?.count ?? 0;
    await q.bot.closeBank().catch(() => undefined);
    return banked;
}

await runTask({
    id: 'legends-capes',
    hub: 'ardougne',
    task: async (q) => {
        let banked = await bankPack(q);
        q.log(`capes: ${banked} banked at the start`);
        let bought = 0;
        for (let round = 1; round <= ROUNDS && !q.stopRequested(); round++) {
            if (q.sdk.getInventory().length >= 26 || held(q, /^coins$/i) < 1000) banked = await bankPack(q);
            await toSiegfried(q);
            const opened = await q.bot.openShop(SIEGFRIED.npc);
            if (!opened.success) throw new Error(`capes: Siegfried's shop did not open: ${opened.message} (Legends' Quest done?)`);
            const stockOf = (re: RegExp) => q.sdk.getState()?.shop?.shopItems.find((i) => re.test(i.name))?.count ?? 0;
            const stock = stockOf(CAPE);
            const before = held(q, CAPE);
            // Bought here, shop open, on this floor: the shared buyAtShop walks to a ground-floor tile first.
            for (let i = 0; i < 6 && stockOf(CAPE) > 0 && q.sdk.getInventory().length < 28; i++) {
                const r = await q.bot.buyFromShop(CAPE, stockOf(CAPE)).catch((e: Error) => ({ success: false, message: e.message }));
                if (!r.success) {
                    q.log(`capes: buy: ${r.message}`);
                    break;
                }
                await q.sdk.waitForTicks(1);
            }
            for (const label of ALSO) {
                const re = itemPattern(label);
                if (stockOf(re) > 0 && q.sdk.getInventory().length < 28) await q.bot.buyFromShop(re, 1).catch(() => undefined);
            }
            await q.bot.closeShop().catch(() => undefined);
            bought += held(q, CAPE) - before;
            q.log(`capes: round ${round}: shop had ${stock}, bought ${held(q, CAPE) - before} (${bought} this run)`);
            if (round < ROUNDS) await q.sdk.waitForTicks(RESTOCK_TICKS);
        }
        banked = await bankPack(q);
        q.log(`capes: ${bought} bought, ${banked} banked — already complete`);
    },
});
