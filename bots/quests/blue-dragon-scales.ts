/**
 * Blue dragon scales, Taverley dungeon: trips from Falador west bank through the Dusty-key
 * gate to the scale spawns behind it, until the pack is full or the food runs low.
 *
 *   bun bots/quests/blue-dragon-scales.ts {botname} [--trips=N] [--sharks=N]
 *
 * The route and spots are the operator's (lib/taverley-dragons.ts, recorded on jacklove10).
 * Kit: a Dusty key, a Dragonfire / anti-dragon shield and the best melee armour banked
 * (helm, body, legs, boots, gloves, amulet, cape) worn, 6 sharks, Protect from Magic beside
 * the dragons. npc/scripts/dragon.rs2 checks the shield before %prayer12, so with the shield
 * the prayer adds nothing; it is kept while it lasts, and running out does not end a trip
 * (prayer does not refill between trips). The naked prologue leaves only what this kit puts
 * on: with just the shield, jacklove10 took ~130 damage in 500 ticks on prod (2026-10-30).
 *
 * Leaves when the pack is full, or HP < 60% with one shark left (eaten first), or at once,
 * from anywhere underground, when HP < 30%. Out: Falador Teleport (Magic 37: 1 law, 3 air,
 * 1 water; eats first below 40 HP) when the account can cast it, else back through the gate
 * (leaving needs no key), along the route and up the ladder. Auto-retaliate is off while
 * underground: the bot wears no weapon, and a retaliation (p_opnpc) cancels the walk or
 * pickup in progress; it goes back to how it was on the surface.
 * Needs a Dusty key banked (Velrak's, lib/taverley-dragons.ts). A grind, not a todo item.
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
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const SHARKS = Math.max(1, Number(arg('sharks') ?? 6));
const TRIPS = Number(arg('trips') ?? 1e9);
const FALADOR_TELEPORT_MAGIC = 37;
/** magic:falador_teleport (interface.pack), clicked on the magic tab like lost-city's Lumbridge Teleport. */
const FALADOR_TELEPORT = 1170;
const MAGIC_TAB = 6;
/** controls:com_2 / com_3 (player_controls.rs2) on ^tab_player_controls. */
const CONTROLS_TAB = 12;
const AUTO_RETALIATE_ON = 150;
const AUTO_RETALIATE_OFF = 151;
/** HP fractions: eat, leave on the last shark, bail out at once. */
const EAT_AT = 0.6;
const BAIL_AT = 0.3;
/** Never start a teleport below this (or 40% of max HP, if lower); eat first if there is food. */
const TELEPORT_MIN_HP = 40;

/**
 * Melee armour, per worn slot, best first by metal tier. `shape` breaks ties within a tier
 * (full helm over med helm, platebody over chainbody).
 */
const TIERS: Array<[RegExp, number]> = [
    [/^dragon /i, 9],
    [/^rune /i, 8],
    [/^adamant /i, 7],
    [/^mithril /i, 6],
    [/^(black|white) /i, 5],
    [/^steel /i, 4],
    [/^iron /i, 3],
    [/^bronze /i, 2],
];
const SLOTS: Array<{ slot: string; match: RegExp; shape?: RegExp; rank?: Array<[RegExp, number]> }> = [
    { slot: 'helm', match: /(full helm|med helm)$/i, shape: /full helm$/i },
    { slot: 'body', match: /(platebody|chainbody)$/i, shape: /platebody$/i },
    { slot: 'legs', match: /(platelegs|plateskirt)$/i },
    { slot: 'boots', match: /boots$/i },
    { slot: 'gloves', match: /(gloves|gauntlets|vambraces)$/i },
    {
        slot: 'amulet',
        match: /^amulet of (glory|power|strength|defence|accuracy)/i,
        rank: [
            [/glory/i, 5],
            [/power/i, 4],
            [/strength/i, 3],
            [/defence/i, 2],
            [/accuracy/i, 1],
        ],
    },
    {
        slot: 'cape',
        match: /cape/i,
        rank: [
            [/legends/i, 3],
            [/obsidian/i, 2],
        ],
    },
];
const score = (name: string, s: (typeof SLOTS)[number]) => {
    const table = s.rank ?? TIERS;
    const base = table.find(([re]) => re.test(name))?.[1] ?? 0;
    return base + (s.shape?.test(name) ? 0.5 : 0);
};

/** Inside the pen (west of the gate). */
const inPen = (q: Quest) => {
    const p = q.sdk.getState()!.player!;
    return p.worldZ > 9790 && p.worldZ < 9815 && p.worldX >= 2898 && p.worldX < DUSTY_GATE.x;
};
const underground = (q: Quest) => (q.sdk.getState()?.player?.worldZ ?? 0) > 6400;
const hp = (q: Quest) => q.sdk.getSkill('hitpoints');
const hpFrac = (q: Quest) => {
    const h = hp(q);
    return h && h.baseLevel > 0 ? h.level / h.baseLevel : 1;
};
const canTeleport = (q: Quest) => q.level('magic') >= FALADOR_TELEPORT_MAGIC;
const hasTeleport = (q: Quest) => canTeleport(q) && q.count('law rune') >= 1 && q.count('air rune') >= 3 && q.count('water rune') >= 1;
const pos = (q: Quest) => {
    const p = q.sdk.getState()!.player!;
    return { x: p.worldX, z: p.worldZ };
};
/** Switch side tab and wait until the client shows it (a click on a tab not yet open is dropped). */
async function openTab(q: Quest, tab: number): Promise<void> {
    await q.sdk.sendSetTab(tab).catch(() => undefined);
    await untilTicks(q.sdk, (s) => s.sideInterface === undefined || s.sideInterface.tabIndex === tab, 3);
    await q.sdk.waitForTicks(1);
}

const where = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return p ? `(${p.worldX},${p.worldZ})` : '(?)';
};

/** HP fell below BAIL_AT underground: stop whatever we are doing and get out. */
class Bail extends Error {}
const checkBail = (q: Quest, during: string) => {
    if (underground(q) && hpFrac(q) < BAIL_AT) throw new Bail(`HP ${hp(q)?.level} during ${during} at ${where(q)}`);
    // The runner force-exits 300s after SIGTERM: leave now, while the teleport can still land.
    if (underground(q) && q.stopRequested()) throw new Bail(`stop requested during ${during} at ${where(q)}`);
};

async function setAutoRetaliate(q: Quest, on: boolean): Promise<void> {
    if (q.sdk.getState()?.autoRetaliateEnabled === on) return;
    for (let attempt = 1; attempt <= 3; attempt++) {
        await openTab(q, CONTROLS_TAB);
        await q.sdk.sendClickComponent(on ? AUTO_RETALIATE_ON : AUTO_RETALIATE_OFF);
        if (await untilTicks(q.sdk, (s) => s.autoRetaliateEnabled === on || s.autoRetaliateEnabled === undefined, 4)) break;
    }
    await q.sdk.sendSetTab(3).catch(() => undefined);
    q.log(`scales: auto-retaliate ${q.sdk.getState()?.autoRetaliateEnabled === on ? (on ? 'on' : 'off') : `did not switch ${on ? 'on' : 'off'}`}`);
}

/** Across the cauldron room's Prison door toward the ladder (west) or the gate (east); suits of armour may wake first. */
async function throughPrisonDoor(q: Quest, toWest: boolean): Promise<void> {
    const westSide = () => (q.sdk.getState()?.player?.worldX ?? 0) < PRISON_DOOR.x;
    if (westSide() === toWest) return;
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

/** Open the nearest closed gate or door within 3 tiles (never the Prison door or the Dusty-key gate). */
async function openGateNear(q: Quest): Promise<boolean> {
    await q.sdk.scanNearbyLocs(3).catch(() => undefined);
    const p = pos(q);
    const gate = (q.sdk.getNearbyLocs() ?? [])
        .filter(
            (l) =>
                /^(gate|door)$/i.test(l.name) &&
                !(l.x === DUSTY_GATE.x && l.z === DUSTY_GATE.z) &&
                Math.max(Math.abs(l.x - p.x), Math.abs(l.z - p.z)) <= 3 &&
                l.optionsWithIndex.some((o) => /^open$/i.test(o.text)),
        )
        .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    if (!gate) return false;
    await q.sdk.sendInteractLoc(gate.x, gate.z, gate.id, gate.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
    await untilTicks(q.sdk, () => !(q.sdk.getNearbyLocs() ?? []).some((l) => l.x === gate.x && l.z === gate.z && l.id === gate.id), 5);
    return true;
}

/**
 * One leg of a recorded route. The legs are short and the operator walked them, so a plain
 * client walk first (no walkTo re-planning); goTo only if that does not arrive. A slow leg is
 * logged with what was around, to tell combat from re-planning on prod.
 */
async function leg(q: Quest, wp: Tile): Promise<void> {
    const from = pos(q);
    const dist = Math.max(Math.abs(wp.x - from.x), Math.abs(wp.z - from.z));
    const near = () => {
        const p = pos(q);
        return Math.max(Math.abs(wp.x - p.x), Math.abs(wp.z - p.z)) <= 2;
    };
    if (near()) return;
    const t0 = tickNow(q.sdk);
    const rejected0 = q.sdk.getState()?.opFeedback?.opRejectedCount ?? 0;
    let how = 'walk';
    let arrived = false;
    // A walk can be dropped (UNSET_MAP_FLAG, seen with the suits of armour on us): resend when
    // we stop short rather than waiting out the leg.
    for (let send = 1; send <= 3 && !arrived; send++) {
        if (send > 1) {
            how = `walk x${send}`;
            // Stopped short: a closed gate in the way (the iron gate at (2898,9831) is one the
            // client walk cannot pass; other players open and shut it). Open it and go on.
            if (await openGateNear(q)) how += ' (opened a gate)';
        }
        await q.sdk.sendWalk(wp.x, wp.z);
        let last = pos(q);
        let still = 0;
        arrived = await untilTicks(
            q.sdk,
            () => {
                if (near()) return true;
                const p = pos(q);
                still = p.x === last.x && p.z === last.z ? still + 1 : 0;
                last = p;
                return still >= 4;
            },
            dist + 8,
        );
        arrived = near();
    }
    if (!arrived) {
        how += '+goTo';
        await q.goTo(wp, 2);
    }
    const took = tickNow(q.sdk) - t0;
    if (took > dist + 12) {
        const s = q.sdk.getState();
        const npcs = (s?.nearbyNpcs ?? []).filter((n) => (n.distance ?? 99) <= 4).map((n) => n.name);
        q.log(
            `scales: slow leg (${from.x},${from.z})->(${wp.x},${wp.z}) ${took}t by ${how}; inCombat ${s?.player?.combat?.inCombat}, ` +
                `ops rejected ${(s?.opFeedback?.opRejectedCount ?? 0) - rejected0}, npcs within 4: ${npcs.join(', ') || 'none'}`,
        );
    }
}

/** A recorded route; the PRISON_DOOR waypoint means "cross the door" (toward the ladder when `out`). */
async function walkRoute(q: Quest, route: Tile[], out: boolean): Promise<void> {
    for (const wp of route) {
        if (!out) checkBail(q, 'the walk');
        if (wp.x === PRISON_DOOR.x && wp.z === PRISON_DOOR.z) await throughPrisonDoor(q, out);
        else await leg(q, wp);
    }
}

/** Best armour per slot from the open bank, withdrawn; slots already worn are skipped. */
async function withdrawArmour(q: Quest): Promise<string[]> {
    const worn = q.sdk.getEquipment().map((i) => i.name);
    const taken: string[] = [];
    for (const s of SLOTS) {
        if (worn.some((n) => s.match.test(n))) continue;
        const best = q.sdk
            .getBankItems()
            .filter((b) => s.match.test(b.name) && !SHIELD.test(b.name))
            .sort((a, b) => score(b.name, s) - score(a.name, s))[0];
        if (!best) continue;
        await q.bot.withdrawItem(best, 1);
        taken.push(best.name);
    }
    if (!worn.some((n) => SHIELD.test(n))) {
        const shield = q.sdk.findBankItem(SHIELD);
        if (shield) {
            await q.bot.withdrawItem(shield, 1);
            taken.push(shield.name);
        }
    }
    return taken;
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
    if (!need(FOOD)) {
        q.log('scales: no sharks banked');
        return false;
    }
    const taken = await withdrawArmour(q);
    if (taken.length) {
        await q.bot.closeBank();
        for (const name of taken) {
            const item = q.sdk.findInventoryItem(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
            if (!item) continue;
            const res = await q.bot.equipItem(item);
            if (!res.success) q.log(`scales: could not wear ${name}: ${res.message}`);
        }
        await q.bot.openBank();
        // Anything that would not go on goes back.
        for (const item of q.sdk.getInventory()) await q.bot.depositItem(item.name, -1);
    }
    q.log(`scales: wearing ${q.sdk.getEquipment().map((i) => i.name).join(', ') || 'nothing'}`);
    if (!q.sdk.getEquipment().some((i) => SHIELD.test(i.name))) {
        q.log('scales: no anti-dragon / Dragonfire shield worn or banked');
        await q.bot.closeBank();
        return false;
    }
    // HP does not refill between trips: eat banked sharks up to ~20 below max before going.
    const h = hp(q);
    let topUp = h ? Math.min(Math.ceil(Math.max(0, h.baseLevel - 20 - h.level) / 20), need(FOOD)!.count) : 0;
    if (topUp > 0) {
        await q.bot.withdrawItem(need(FOOD)!, topUp);
        await q.bot.closeBank();
        for (; topUp > 0; topUp--) {
            const shark = q.sdk.findInventoryItem(FOOD);
            if (shark) await q.bot.eatFood(shark);
        }
        await q.bot.openBank();
        for (const item of q.sdk.getInventory()) await q.bot.depositItem(item.name, -1);
    }
    await q.bot.withdrawItem(need(DUSTY_KEY)!, 1);
    const food = need(FOOD);
    if (food) await q.bot.withdrawItem(food, Math.min(SHARKS, food.count));
    if (q.count('shark') < 2) {
        q.log(`scales: only ${q.count('shark')} shark(s) left banked; not going`);
        await q.bot.closeBank();
        return false;
    }
    const law = need(/^law rune$/i);
    const air = need(/^air rune$/i);
    const water = need(/^water rune$/i);
    if (canTeleport(q) && law && air && air.count >= 3 && water) {
        await q.bot.withdrawItem(law, 1);
        await q.bot.withdrawItem(air, 3);
        await q.bot.withdrawItem(water, 1);
    } else if (canTeleport(q)) {
        q.log('scales: no Falador Teleport runes banked (1 law, 3 air, 1 water); walking out this trip');
    }
    await q.bot.closeBank();
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
    await setAutoRetaliate(q, false);
    // The operator's walk round the east side, reversed, to the gate. The loop south to
    // (2929,9756) is the only way round (sdk findLongPath takes it too).
    const tWalk = tickNow(q.sdk);
    await walkRoute(q, [...GATE_TO_LADDER].reverse(), false);
    // On the tile itself: from one off it, the first key use did nothing every trip and only
    // the retry took (qlbds1/qlbdslo1, 2026-10-30).
    await q.goTo(DUSTY_GATE_OUTSIDE, 0);
    q.log(`scales: ladder to gate in ${tickNow(q.sdk) - tWalk}t`);
    const tGate = tickNow(q.sdk);
    for (let attempt = 1; attempt <= 3 && !inPen(q); attempt++) {
        checkBail(q, 'the gate');
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

async function eatOne(q: Quest): Promise<boolean> {
    const food = q.sdk.findInventoryItem(FOOD);
    if (!food) return false;
    await q.bot.eatFood(food);
    return true;
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
    try {
        while (q.sdk.getInventory().length < 28) {
            lowest = Math.min(lowest, hp(q)?.level ?? lowest);
            checkBail(q, 'the loot');
            if (hpFrac(q) < EAT_AT) {
                const sharks = q.count('shark');
                if (sharks <= 1) {
                    if (await eatOne(q)) eaten++;
                    q.log(`scales: HP ${hp(q)?.level} with ${sharks} shark(s) left; leaving`);
                    break;
                }
                if (await eatOne(q)) eaten++;
            }
            const prayer = q.sdk.getPrayerState();
            if (prayer && prayer.prayerPoints > 0 && !q.sdk.isPrayerActive('protect_from_magic')) await q.bot.activatePrayer('protect_from_magic').catch(() => undefined);
            const p = pos(q);
            const scale = (q.sdk.getState()?.groundItems ?? [])
                .filter((g) => SCALE.test(g.name) && SCALE_SPAWNS.some((s) => s.x === g.x && s.z === g.z))
                .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
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
    } finally {
        await q.bot.deactivatePrayer('protect_from_magic').catch(() => undefined);
        q.log(`scales: loot — HP ${hp0} -> ${hp(q)?.level} (lowest ${lowest}), ${eaten} shark(s) eaten, ${q.count('shark')} left, ${q.count('blue dragon scale') - start} scales`);
    }
    return q.count('blue dragon scale') - start;
}

async function teleportOut(q: Quest): Promise<boolean> {
    if (!hasTeleport(q)) return false;
    // Never start the cast low: the dragons keep hitting until it lands.
    const floor = Math.min(TELEPORT_MIN_HP, Math.ceil((hp(q)?.baseLevel ?? 99) * 0.4));
    while ((hp(q)?.level ?? 99) < floor && (await eatOne(q))) {}
    for (let attempt = 1; attempt <= 3 && underground(q); attempt++) {
        await openTab(q, MAGIC_TAB);
        await q.sdk.sendClickComponent(FALADOR_TELEPORT);
        if (await untilTicks(q.sdk, () => !underground(q), 7)) break;
        q.log(`scales: Falador Teleport attempt ${attempt} did not take at ${where(q)} (HP ${hp(q)?.level})`);
    }
    return !underground(q);
}

/** Back the way we came: from the pen out through the gate, then the route from its nearest tile. */
async function walkOut(q: Quest): Promise<void> {
    // Leaving through the gate needs no key ("The gate locks shut behind you").
    if (inPen(q)) await q.goTo(DUSTY_GATE_OUTSIDE, 1);
    const p = pos(q);
    let from = 0;
    GATE_TO_LADDER.forEach((wp, i) => {
        if (Math.hypot(wp.x - p.x, wp.z - p.z) < Math.hypot(GATE_TO_LADDER[from]!.x - p.x, GATE_TO_LADDER[from]!.z - p.z)) from = i;
    });
    await walkRoute(q, GATE_TO_LADDER.slice(from), true);
    await q.goTo(LADDER_DUNGEON, 1);
    const up = q.sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-up/i });
    if (!up) throw new Error('scales: no ladder up in the dungeon');
    await q.bot.interactLoc(up, /climb-up/i);
    if (!(await untilTicks(q.sdk, () => !underground(q), 15))) throw new Error('scales: did not climb out');
}

async function outToBank(q: Quest): Promise<void> {
    if (await teleportOut(q)) q.log(`scales: out by Falador Teleport (HP ${hp(q)?.level})`);
    else {
        if (canTeleport(q) && hasTeleport(q)) q.log('scales: Falador Teleport did not take; walking out');
        await walkOut(q);
        q.log(`scales: out by the gate and the ladder (HP ${hp(q)?.level})`);
    }
    await setAutoRetaliate(q, true);
}

await runTask({
    id: 'blue-dragon-scales',
    hub: 'falador-west',
    task: async (q) => {
        let total = 0;
        let stopped = false;
        for (let trip = 1; trip <= TRIPS; trip++) {
            // Between trips the kit is banked: the only safe place to stop (jacklove10 was killed
            // in the dungeon by the todo-runner's 3h cap, 2026-10-31).
            if (q.stopRequested()) {
                q.log(`scales: stop requested — stopping at the bank before trip ${trip}`);
                stopped = true;
                break;
            }
            const t0 = tickNow(q.sdk);
            if (!(await bankAndKit(q))) break;
            const t1 = tickNow(q.sdk);
            let got = 0;
            let t2 = t1;
            let t3 = t1;
            try {
                await intoPen(q);
                t2 = tickNow(q.sdk);
                got = await loot(q);
            } catch (err) {
                if (!(err instanceof Bail)) throw err;
                q.log(`scales: BAIL — ${err.message}; leaving now`);
            }
            t3 = tickNow(q.sdk);
            if (t2 === t1) t2 = t3;
            await outToBank(q);
            const t4 = tickNow(q.sdk);
            total += got;
            q.log(
                `scales: trip ${trip}: ${got} scales (total ${total}); HP ${hp(q)?.level}, prayer ${q.sdk.getPrayerState()?.prayerPoints}; ` +
                    `ticks bank ${t1 - t0}, in ${t2 - t1}, loot ${t3 - t2}, out ${t4 - t3}`,
            );
        }
        await q.goTo(SAFE_BANKS['falador-west'], 3);
        await q.bot.openBank();
        for (const item of q.sdk.getInventory()) await q.bot.depositItem(item.name, -1);
        await q.bot.closeBank();
        if (stopped) throw new Error(`scales: stopped early with ${total} scales banked`);
        q.log(`scales: ${total} blue dragon scales banked — already complete`);
    },
});
