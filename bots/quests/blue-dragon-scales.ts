/**
 * Blue dragon scales, Taverley dungeon: trips from Falador west bank through the Dusty-key
 * gate to the scale spawns behind it, until the pack is full or the food runs out.
 *
 *   bun bots/quests/blue-dragon-scales.ts {botname} [--trips=N]
 *
 * The route and spots are the operator's (lib/taverley-dragons.ts, recorded on jacklove10).
 * Kit, as the operator described it: a Dusty key, a Dragonfire / anti-dragon shield worn,
 * 4 sharks, Protect from Magic beside the dragons (npc/scripts/dragon.rs2 checks the shield
 * before %prayer12, so with the shield worn the prayer adds nothing: it is kept while it lasts
 * and running out of it does not end a trip; prayer does not refill between trips). Out: Falador Teleport (Magic 37: 1 law,
 * 3 air, 1 water) when the account can cast it, else back through the gate (leaving needs no
 * key), up the ladder and walk. Needs a Dusty key banked (Velrak's, lib/taverley-dragons.ts).
 * Runs trip after trip; a grind, not a todo item.
 */
import { runTask, type Quest } from './lib/run-quest';
import { tickNow, untilTicks } from './lib/ticks';
import { SAFE_BANKS } from './safe-stops';
import {
    DUSTY_GATE,
    DUSTY_GATE_OUTSIDE,
    GATE_TO_LADDER,
    LADDER_DUNGEON,
    LADDER_SURFACE,
    PRISON_DOOR,
    SCALE_SPAWNS,
    type Tile,
} from './lib/taverley-dragons';

const SCALE = /^blue dragon scale$/i;
const SHIELD = /^(dragonfire|anti-dragon) shield$/i;
const DUSTY_KEY = /^dusty key$/i;
const FOOD = /^shark$/i;
const SHARKS = 4;
const FALADOR_TELEPORT_MAGIC = 37;
/** magic:falador_teleport (interface.pack), clicked on the magic tab like lost-city's Lumbridge Teleport. */
const FALADOR_TELEPORT = 1170;
const MAGIC_TAB = 6;
const TRIPS = Number(process.argv.find((a) => a.startsWith('--trips='))?.split('=')[1] ?? 1e9);
/** Inside the pen (west of the gate). */
const inPen = (q: Quest) => {
    const p = q.sdk.getState()!.player!;
    return p.worldZ > 9790 && p.worldZ < 9815 && p.worldX >= 2898 && p.worldX < DUSTY_GATE.x;
};
const underground = (q: Quest) => (q.sdk.getState()?.player?.worldZ ?? 0) > 6400;
const hp = (q: Quest) => q.sdk.getSkill('hitpoints');
const canTeleport = (q: Quest) => q.level('magic') >= FALADOR_TELEPORT_MAGIC;

const where = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return p ? `(${p.worldX},${p.worldZ})` : '(?)';
};

/** Across the cauldron room's Prison door, whichever side we are on (suits of armour may wake first). */
async function throughPrisonDoor(q: Quest): Promise<void> {
    const westSide = () => (q.sdk.getState()?.player?.worldX ?? 0) < PRISON_DOOR.x;
    const fromWest = westSide();
    const crossed = () => westSide() !== fromWest;
    const t0 = tickNow(q.sdk);
    // A plain client walk to the door tile: walkTo's door handling routed *through* this door to
    // reach the tile beside it (cant_reach, then ~270 ticks of retries; qlbds1 2026-10-30).
    const side = { x: fromWest ? PRISON_DOOR.x - 1 : PRISON_DOOR.x, z: PRISON_DOOR.z };
    const atSide = () => {
        const p = q.sdk.getState()?.player;
        return !!p && p.worldX === side.x && p.worldZ === side.z;
    };
    await q.sdk.sendWalk(side.x, side.z);
    if (!(await untilTicks(q.sdk, atSide, 20))) await q.goTo(side, 0);
    for (let attempt = 1; attempt <= 5 && !crossed(); attempt++) {
        await q.sdk.scanNearbyLocs(3).catch(() => undefined);
        const door = (q.sdk.getNearbyLocs() ?? []).find(
            (l) => /^prison door$/i.test(l.name) && l.x === PRISON_DOOR.x && Math.abs(l.z - PRISON_DOOR.z) <= 1 && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)),
        );
        if (!door) {
            q.log(`scales: no Prison door at (${PRISON_DOOR.x},${PRISON_DOOR.z}) from ${where(q)} (attempt ${attempt})`);
            await q.sdk.waitForTicks(2);
            continue;
        }
        await q.sdk.sendInteractLoc(door.x, door.z, door.id, door.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
        if (await untilTicks(q.sdk, crossed, 6)) break;
        q.log(`scales: Prison door attempt ${attempt} did not let us through from ${where(q)} (a suit of armour wakes on the first opens)`);
    }
    if (!crossed()) throw new Error(`scales: could not get through the Prison door at ${where(q)}`);
    q.log(`scales: through the Prison door ${fromWest ? 'east' : 'west'} in ${tickNow(q.sdk) - t0}t`);
}

/** A recorded route; the PRISON_DOOR waypoint means "cross the door". */
async function walkRoute(q: Quest, route: Tile[]): Promise<void> {
    for (const wp of route) {
        if (wp.x === PRISON_DOOR.x && wp.z === PRISON_DOOR.z) await throughPrisonDoor(q);
        else await q.goTo(wp, 2);
    }
}

async function bankAndKit(q: Quest): Promise<boolean> {
    await q.goTo(SAFE_BANKS['falador-west'], 3);
    await q.bot.openBank();
    for (const item of q.sdk.getInventory()) await q.bot.depositItem(item.name, -1);
    const need = (re: RegExp) => q.sdk.findBankItem(re);
    if (!need(DUSTY_KEY)) {
        q.log('scales: no Dusty key banked — get one from Velrak first');
        return false;
    }
    if (!q.sdk.getEquipment().some((i) => SHIELD.test(i.name))) {
        const shield = need(SHIELD);
        if (!shield) {
            q.log('scales: no anti-dragon / Dragonfire shield banked');
            return false;
        }
        await q.bot.withdrawItem(shield, 1);
    }
    await q.bot.withdrawItem(need(DUSTY_KEY)!, 1);
    const food = need(FOOD);
    if (!food) {
        q.log('scales: no sharks banked');
        return false;
    }
    // HP does not refill between trips: eat banked sharks up to ~20 below max before going.
    const h = hp(q);
    let topUp = h ? Math.min(Math.ceil(Math.max(0, h.baseLevel - 20 - h.level) / 20), food.count) : 0;
    if (topUp > 0) await q.bot.withdrawItem(food, topUp);
    const rest = need(FOOD);
    if (rest) await q.bot.withdrawItem(rest, SHARKS);
    if (topUp > 0) {
        await q.bot.closeBank();
        for (; topUp > 0; topUp--) {
            const shark = q.sdk.findInventoryItem(FOOD);
            if (shark) await q.bot.eatFood(shark);
        }
        await q.bot.openBank();
        // Keep exactly SHARKS for the trip.
        const extra = q.count('shark') - SHARKS;
        if (extra > 0) await q.bot.depositItem(FOOD, extra);
    }
    if (q.count('shark') === 0) {
        q.log('scales: no sharks left after topping up HP');
        await q.bot.closeBank();
        return false;
    }
    if (canTeleport(q) && need(/^law rune$/i) && need(/^air rune$/i) && need(/^water rune$/i)) {
        await q.bot.withdrawItem(need(/^law rune$/i)!, 1);
        await q.bot.withdrawItem(need(/^air rune$/i)!, 3);
        await q.bot.withdrawItem(need(/^water rune$/i)!, 1);
    } else if (canTeleport(q)) {
        q.log('scales: no Falador Teleport runes banked (1 law, 3 air, 1 water); walking out this trip');
    }
    await q.bot.closeBank();
    const shield = q.sdk.getInventory().find((i) => SHIELD.test(i.name));
    if (shield) await q.bot.equipItem(shield);
    return true;
}

async function intoPen(q: Quest): Promise<void> {
    await q.goTo(LADDER_SURFACE, 1);
    await q.reach(/^ladder$/i, /climb-down/i).catch(() => undefined);
    const down = q.sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-down/i });
    if (!down) throw new Error('scales: no Taverley dungeon ladder down');
    const tLadder = tickNow(q.sdk);
    await q.bot.interactLoc(down, /climb-down/i);
    if (!(await untilTicks(q.sdk, () => underground(q), 15))) throw new Error('scales: did not get down the ladder');
    q.log(`scales: down the ladder in ${tickNow(q.sdk) - tLadder}t`);
    // The operator's walk round the east side, reversed, to the gate.
    await walkRoute(q, [...GATE_TO_LADDER].reverse());
    // On the tile itself: from one off it, the first key use did nothing every trip and only
    // the retry took (qlbds1/qlbdslo1, 2026-10-30).
    await q.goTo(DUSTY_GATE_OUTSIDE, 0);
    const tGate = tickNow(q.sdk);
    for (let attempt = 1; attempt <= 3 && !inPen(q); attempt++) {
        await q.sdk.scanNearbyLocs(4).catch(() => undefined);
        const gate = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === DUSTY_GATE.x && l.z === DUSTY_GATE.z);
        const key = q.sdk.findInventoryItem(DUSTY_KEY);
        if (!gate || !key) throw new Error(`scales: gate ${gate ? 'found' : 'missing'}, key ${key ? 'held' : 'missing'}`);
        // The raw send, gated on being inside: bot.useItemOnLoc sat out its 10 s timeout after the
        // gate had already let us through (167 ticks at 60 ms, qlbds1 2026-10-30).
        const used = await q.sdk.sendUseItemOnLoc(key.slot, gate.x, gate.z, gate.id);
        if (!(await untilTicks(q.sdk, () => inPen(q), 10))) q.log(`scales: Dusty key on the gate, attempt ${attempt}: ${used.message} (at ${where(q)})`);
    }
    if (!inPen(q)) throw new Error('scales: the Dusty-key gate did not let us in');
    q.log(`scales: through the Dusty-key gate in ${tickNow(q.sdk) - tGate}t`);
}

async function loot(q: Quest): Promise<number> {
    await q.bot.activatePrayer('protect_from_magic').catch(() => undefined);
    const prayed = await untilTicks(q.sdk, () => q.sdk.isPrayerActive('protect_from_magic'), 3);
    q.log(`scales: Protect from Magic ${prayed ? 'on' : 'did not turn on'} (prayer ${q.sdk.getPrayerState()?.prayerPoints})`);
    const start = q.count('blue dragon scale');
    const hp0 = hp(q)?.level ?? 0;
    let idle = 0;
    let eaten = 0;
    let lowest = hp0;
    while (q.sdk.getInventory().length < 28) {
        const h = hp(q);
        if (h) lowest = Math.min(lowest, h.level);
        if (h && h.level < h.baseLevel * 0.5) {
            const food = q.sdk.findInventoryItem(FOOD);
            if (!food) {
                q.log(`scales: out of food at HP ${h.level}; leaving`);
                break;
            }
            await q.bot.eatFood(food);
            eaten++;
        }
        const prayer = q.sdk.getPrayerState();
        if (prayer && prayer.prayerPoints > 0 && !q.sdk.isPrayerActive('protect_from_magic')) await q.bot.activatePrayer('protect_from_magic').catch(() => undefined);
        const scale = (q.sdk.getState()?.groundItems ?? [])
            .filter((g) => SCALE.test(g.name) && SCALE_SPAWNS.some((s) => s.x === g.x && s.z === g.z))
            .sort((a, b) => Math.hypot(a.x - q.sdk.getState()!.player!.worldX, a.z - q.sdk.getState()!.player!.worldZ) - Math.hypot(b.x - q.sdk.getState()!.player!.worldX, b.z - q.sdk.getState()!.player!.worldZ))[0];
        if (!scale) {
            // All five taken: wait for respawns between the spots.
            if (++idle > 400) {
                q.log('scales: no scale respawned in 400 ticks; leaving');
                break;
            }
            await q.sdk.waitForTicks(1);
            continue;
        }
        idle = 0;
        await q.bot.pickupItem(scale);
    }
    await q.bot.deactivatePrayer('protect_from_magic').catch(() => undefined);
    q.log(`scales: loot done — HP ${hp0} -> ${hp(q)?.level} (lowest ${lowest}), ${eaten} shark(s) eaten, ${q.count('shark')} left`);
    return q.count('blue dragon scale') - start;
}

async function outToBank(q: Quest): Promise<void> {
    if (canTeleport(q) && q.count('law rune') > 0) {
        for (let attempt = 1; attempt <= 3 && underground(q); attempt++) {
            await q.sdk.sendSetTab(MAGIC_TAB).catch(() => undefined);
            await q.sdk.waitForTicks(1);
            await q.sdk.sendClickComponent(FALADOR_TELEPORT);
            await untilTicks(q.sdk, () => !underground(q), 10);
        }
        if (!underground(q)) {
            q.log('scales: out by Falador Teleport');
            return;
        }
        q.log('scales: Falador Teleport did not take; walking out');
    }
    // Leaving through the gate needs no key ("The gate locks shut behind you").
    await q.goTo(DUSTY_GATE_OUTSIDE, 1);
    await walkRoute(q, GATE_TO_LADDER);
    await q.goTo(LADDER_DUNGEON, 1);
    const up = q.sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-up/i });
    if (!up) throw new Error('scales: no ladder up in the dungeon');
    await q.bot.interactLoc(up, /climb-up/i);
    if (!(await untilTicks(q.sdk, () => !underground(q), 15))) throw new Error('scales: did not climb out');
    q.log('scales: out by the gate and the ladder');
}

await runTask({
    id: 'blue-dragon-scales',
    hub: 'falador-west',
    task: async (q) => {
        let total = 0;
        for (let trip = 1; trip <= TRIPS; trip++) {
            const t0 = tickNow(q.sdk);
            if (!(await bankAndKit(q))) break;
            const t1 = tickNow(q.sdk);
            await intoPen(q);
            const t2 = tickNow(q.sdk);
            const got = await loot(q);
            const t3 = tickNow(q.sdk);
            total += got;
            await outToBank(q);
            const t4 = tickNow(q.sdk);
            q.log(
                `scales: trip ${trip}: ${got} scales (total ${total}); HP ${hp(q)?.level}, prayer ${q.sdk.getPrayerState()?.prayerPoints}; ` +
                    `ticks bank ${t1 - t0}, in ${t2 - t1}, loot ${t3 - t2}, out ${t4 - t3}`,
            );
        }
        await q.goTo(SAFE_BANKS['falador-west'], 3);
        await q.bot.openBank();
        for (const item of q.sdk.getInventory()) await q.bot.depositItem(item.name, -1);
        await q.bot.closeBank();
        q.log(`scales: ${total} blue dragon scales banked — already complete`);
    },
});
