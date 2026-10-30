/**
 * Blue dragon scales, Taverley dungeon: trips from Falador west bank through the Dusty-key
 * gate to the scale spawns behind it, until the pack is full or the food runs out.
 *
 *   bun bots/quests/blue-dragon-scales.ts {botname} [--trips=N]
 *
 * The route and spots are the operator's (lib/taverley-dragons.ts, recorded on jacklove10).
 * Kit, as the operator described it: a Dusty key, a Dragonfire / anti-dragon shield worn,
 * 4 sharks, Protect from Magic beside the dragons. Out: Falador Teleport (Magic 37: 1 law,
 * 3 air, 1 water) when the account can cast it, else back through the gate (leaving needs no
 * key), up the ladder and walk. Needs a Dusty key banked (Velrak's, lib/taverley-dragons.ts).
 * Runs trip after trip; a grind, not a todo item.
 */
import { runTask, type Quest } from './lib/run-quest';
import { untilTicks } from './lib/ticks';
import { SAFE_BANKS } from './safe-stops';
import {
    DUSTY_GATE,
    DUSTY_GATE_OUTSIDE,
    GATE_TO_LADDER,
    LADDER_DUNGEON,
    LADDER_SURFACE,
    SCALE_SPAWNS,
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
    await q.bot.withdrawItem(food, SHARKS);
    if (canTeleport(q) && need(/^law rune$/i) && need(/^air rune$/i) && need(/^water rune$/i)) {
        await q.bot.withdrawItem(need(/^law rune$/i)!, 1);
        await q.bot.withdrawItem(need(/^air rune$/i)!, 3);
        await q.bot.withdrawItem(need(/^water rune$/i)!, 1);
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
    await q.bot.interactLoc(down, /climb-down/i);
    if (!(await untilTicks(q.sdk, () => underground(q), 15))) throw new Error('scales: did not get down the ladder');
    // The operator's walk round the east side, reversed, to the gate.
    for (const wp of [...GATE_TO_LADDER].reverse()) await q.goTo(wp, 2);
    await q.goTo(DUSTY_GATE_OUTSIDE, 1);
    for (let attempt = 1; attempt <= 3 && !inPen(q); attempt++) {
        await q.sdk.scanNearbyLocs(4).catch(() => undefined);
        const gate = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === DUSTY_GATE.x && l.z === DUSTY_GATE.z);
        const key = q.sdk.findInventoryItem(DUSTY_KEY);
        if (!gate || !key) throw new Error(`scales: gate ${gate ? 'found' : 'missing'}, key ${key ? 'held' : 'missing'}`);
        await q.bot.useItemOnLoc(key, gate);
        await untilTicks(q.sdk, () => inPen(q), 8);
    }
    if (!inPen(q)) throw new Error('scales: the Dusty-key gate did not let us in');
}

async function loot(q: Quest): Promise<number> {
    await q.bot.activatePrayer('protect_from_magic').catch(() => undefined);
    const start = q.count('blue dragon scale');
    let idle = 0;
    while (q.sdk.getInventory().length < 28) {
        const h = hp(q);
        if (h && h.level < h.baseLevel * 0.5) {
            const food = q.sdk.findInventoryItem(FOOD);
            if (!food) break;
            await q.bot.eatFood(food);
        }
        const prayer = q.sdk.getPrayerState();
        if (prayer && prayer.prayerPoints < 5) break;
        if (prayer && !q.sdk.isPrayerActive('protect_from_magic')) await q.bot.activatePrayer('protect_from_magic').catch(() => undefined);
        const scale = (q.sdk.getState()?.groundItems ?? [])
            .filter((g) => SCALE.test(g.name) && SCALE_SPAWNS.some((s) => s.x === g.x && s.z === g.z))
            .sort((a, b) => Math.hypot(a.x - q.sdk.getState()!.player!.worldX, a.z - q.sdk.getState()!.player!.worldZ) - Math.hypot(b.x - q.sdk.getState()!.player!.worldX, b.z - q.sdk.getState()!.player!.worldZ))[0];
        if (!scale) {
            // All five taken: wait for respawns between the spots.
            if (++idle > 400) break;
            await q.sdk.waitForTicks(1);
            continue;
        }
        idle = 0;
        await q.bot.pickupItem(scale);
    }
    await q.bot.deactivatePrayer('protect_from_magic').catch(() => undefined);
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
        if (!underground(q)) return;
        q.log('scales: Falador Teleport did not take; walking out');
    }
    // Leaving through the gate needs no key ("The gate locks shut behind you").
    await q.goTo(DUSTY_GATE_OUTSIDE, 1);
    for (const wp of GATE_TO_LADDER) await q.goTo(wp, 2);
    await q.goTo(LADDER_DUNGEON, 1);
    const up = q.sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-up/i });
    if (!up) throw new Error('scales: no ladder up in the dungeon');
    await q.bot.interactLoc(up, /climb-up/i);
    if (!(await untilTicks(q.sdk, () => !underground(q), 15))) throw new Error('scales: did not climb out');
}

await runTask({
    id: 'blue-dragon-scales',
    hub: 'falador-west',
    task: async (q) => {
        let total = 0;
        for (let trip = 1; trip <= TRIPS; trip++) {
            if (!(await bankAndKit(q))) break;
            await intoPen(q);
            const got = await loot(q);
            total += got;
            q.log(`scales: trip ${trip}: ${got} scales (total ${total}); HP ${hp(q)?.level}, prayer ${q.sdk.getPrayerState()?.prayerPoints}`);
            await outToBank(q);
        }
        await q.goTo(SAFE_BANKS['falador-west'], 3);
        await q.bot.openBank();
        for (const item of q.sdk.getInventory()) await q.bot.depositItem(item.name, -1);
        await q.bot.closeBank();
        q.log(`scales: ${total} blue dragon scales banked — already complete`);
    },
});
