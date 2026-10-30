/**
 * Priest in Peril — the fake Drezel's dog, the real Drezel's cell, the vampire, fifty essence.
 *
 *   bun bots/quests/priest-in-peril.ts {botname}
 *
 * Journal rules from quest_priestperil/scripts/priestperil_journal.rs2 (each stage
 * replaces the whole text). Dialog and mechanics from area_varrock/king_roald.rs2,
 * quest_priestperil/scripts/{temple_doors,trapped_drezel,evil_monks,vampire_coffin}.rs2
 * and area_mausoleum/scripts/{temple_guardian,gates,well,monuments,drezel}.rs2:
 *
 *   - The temple's Large doors only open at stage >= return_to_drezel; before that
 *     the door's Knock-at is where the fake Drezel hands out the dog.
 *   - Only the level-30 Monk of Zamorak drops the golden key, and only to the player
 *     it fought, before the cell is unlocked. One of the seven monuments under the
 *     mausoleum trades it for the iron key (which one is seeded): try each.
 *   - The Salve well (behind the first mausoleum gate, open from find_drezel_key)
 *     fills a bucket with murky water; Drezel blesses it (use it on him); blessed
 *     water on the coffin traps the vampire. Murky and blessed are both "Bucket of
 *     water": told apart by obj id.
 *   - Drezel then waits behind the second gate (open from meet_in_mausoleum) and
 *     takes rune essence in any number (drezel_give_blankrunes) until fifty.
 *
 * Live tiles from the pre-runner script (client scans, 2026-10-23).
 */
import type { Quest } from './lib/run-quest';
import { runQuest } from './lib/run-quest';
import { driveDialog } from './lib/dialog';
import { ticksToMs, untilTicks } from './lib/ticks';

const KING_ROALD = { x: 3222, z: 3476 };
/** Outside the temple's Large doors (3408,3488)/(3408,3489). */
const TEMPLE_DOOR = { x: 3406, z: 3488 };
const TEMPLE_INSIDE = { x: 3412, z: 3486 };
/** Cell level (plane 2): the cell door and the vampire's coffin. */
const CELL_DOOR = { x: 3415, z: 3489 };
const CELL_APPROACH = { x: 3414, z: 3489, level: 2 };
const COFFIN = { x: 3413, z: 3486 };
const MAUSOLEUM_TRAPDOOR = { x: 3405, z: 3507 };
const MAUSOLEUM_LADDER = { x: 3405, z: 9907 };
const DOG_PIT = { x: 3405, z: 9902 };
const SALVE_WELL = { x: 3423, z: 9890 };
const GATE_DREZEL = { x: 3431, z: 9897 };
const MAUSOLEUM_DREZEL = { x: 3440, z: 9895 };
const MONUMENTS = [
    { id: 3493, x: 3416, z: 9890 },
    { id: 3499, x: 3418, z: 9894 },
    { id: 3496, x: 3423, z: 9884 },
    { id: 3494, x: 3423, z: 9895 },
    { id: 3498, x: 3427, z: 9885 },
    { id: 3497, x: 3427, z: 9894 },
    { id: 3495, x: 3428, z: 9890 },
];

/** obj.pack: both waters are "Bucket of water". */
const MURKY = 2953;
const BLESSED = 2954;
/**
 * A pack of essence carried through the whole quest, with room left for the golden
 * key: with 25 plus bucket, coins and a mining pickaxe the bag was full and the
 * monk's key drop could not be picked up (2026-10-29, nostock fixture).
 */
const ESSENCE_PER_TRIP = 24;
const ESSENCE_NEEDED = 50;

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const underground = (q: Quest) => pos(q).z > 9000;
const held = (q: Quest, id: number) => q.sdk.getInventory().filter((i) => i.id === id).length;
const near = (a: { x: number; z: number }, b: { x: number; z: number }, r: number) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) <= r;

async function locNear(q: Quest, name: RegExp, at: { x: number; z: number }, r: number, option?: RegExp) {
    await q.sdk.scanNearbyLocs(Math.max(10, r + 4)).catch(() => undefined);
    return (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => name.test(l.name) && near(l, at, r) && (!option || l.options.some((o) => option.test(o))))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
}

// ── the mausoleum (under the trapdoor north of the temple)

async function enterMausoleum(q: Quest): Promise<void> {
    if (underground(q)) return;
    await leaveTemple(q);
    await q.goTo(MAUSOLEUM_TRAPDOOR, 2);
    for (let i = 0; i < 4 && !underground(q); i++) {
        const trap = await locNear(q, /trapdoor/i, MAUSOLEUM_TRAPDOOR, 2);
        if (!trap) throw new Error(`no mausoleum trapdoor near (${pos(q).x},${pos(q).z})`);
        if (trap.options.some((o) => /^open$/i.test(o))) {
            await q.bot.interactLoc(trap, /^open$/i);
            await q.sdk.waitForTicks(2);
            continue;
        }
        await q.bot.interactLoc(trap, /climb-down|climb down/i);
        await untilTicks(q.sdk, (s) => (s.player?.worldZ ?? 0) > 9000, 10);
    }
    if (!underground(q)) throw new Error('could not climb down into the mausoleum');
}

async function leaveMausoleum(q: Quest): Promise<void> {
    if (!underground(q)) return;
    await q.bot.walkTo(MAUSOLEUM_LADDER.x, MAUSOLEUM_LADDER.z - 1, 1).catch(() => undefined);
    for (let i = 0; i < 4 && underground(q); i++) {
        const ladder = await locNear(q, /ladder/i, MAUSOLEUM_LADDER, 3, /climb-up|climb up/i);
        if (!ladder) {
            q.log(`mausoleum: no ladder in view at (${pos(q).x},${pos(q).z})`);
            await q.bot.walkTo(MAUSOLEUM_LADDER.x, MAUSOLEUM_LADDER.z - 1, 1).catch(() => undefined);
            continue;
        }
        await q.bot.interactLoc(ladder, /climb-up|climb up/i);
        await untilTicks(q.sdk, (s) => (s.player?.worldZ ?? 0) < 9000, 10);
    }
    if (underground(q)) throw new Error('could not climb out of the mausoleum');
}

/** Run `fn` in the mausoleum and always come back up: the runner's legs are surface legs. */
async function inMausoleum(q: Quest, fn: () => Promise<void>): Promise<void> {
    await enterMausoleum(q);
    try {
        await fn();
    } finally {
        await leaveMausoleum(q);
    }
}

/** Walk to an underground tile; walkTo opens the metal gates on the way (gates.rs2). */
async function walkUnder(q: Quest, tile: { x: number; z: number }, tolerance = 2): Promise<void> {
    for (let i = 0; i < 3 && !near(pos(q), tile, tolerance); i++) {
        await q.bot.walkTo(tile.x, tile.z, tolerance).catch(() => undefined);
    }
    if (!near(pos(q), tile, tolerance + 2)) q.log(`walk under: stopped at (${pos(q).x},${pos(q).z}) short of (${tile.x},${tile.z})`);
}

// ── the temple

/** In through the Large doors (open from return_to_drezel), then up to `level`. */
async function intoTemple(q: Quest, level: number): Promise<void> {
    if (pos(q).level === 0 && !near(pos(q), TEMPLE_INSIDE, 6)) await q.goTo(TEMPLE_INSIDE, 2);
    if (level > 0) await q.climbTo(level);
}

const inTemple = (q: Quest) => {
    const p = pos(q);
    return p.level > 0 || (p.x >= 3409 && p.x <= 3425 && p.z >= 3477 && p.z <= 3499);
};

/**
 * Out through the Large doors. A walk out of the temple stopped on the door tile
 * (3408,3489) with "I can't reach that!" (2026-10-29): the double door closes behind
 * you (open_and_close_double_door2), so open it and step out by hand.
 */
async function leaveTemple(q: Quest): Promise<void> {
    if (!inTemple(q)) return;
    if (pos(q).level > 0) await q.climbTo(0);
    for (let i = 0; i < 3 && inTemple(q); i++) {
        const door = await locNear(q, /large door/i, { x: 3408, z: 3488 }, 3, /^open$/i);
        if (door) {
            await q.bot.interactLoc(door, /^open$/i);
            await q.sdk.waitForTicks(2);
        }
        await q.sdk.sendWalk(TEMPLE_DOOR.x - 1, TEMPLE_DOOR.z).catch(() => undefined);
        await untilTicks(q.sdk, () => !inTemple(q) && pos(q).x < 3408, 8);
    }
    if (inTemple(q)) throw new Error(`could not leave the temple (at ${pos(q).x},${pos(q).z} L${pos(q).level})`);
}

/** Knock at the Large door: the "Drezel" inside asks for the dog (temple_doors.rs2). */
async function knock(q: Quest): Promise<void> {
    await q.goTo(TEMPLE_DOOR, 2);
    const door = await locNear(q, /large door/i, { x: 3408, z: 3488 }, 3, /knock/i);
    if (!door) throw new Error(`no Large door to knock at near (${pos(q).x},${pos(q).z})`);
    await q.bot.interactLoc(door, /knock/i);
    const seen = await driveDialog(q.sdk, [/roald sent me/i, /^sure/i], { ticks: 120, log: q.log });
    q.log(`knock: …${seen.slice(-120)}`);
}

/** The temple guardian, under the mausoleum (temple_guardian.rs2: its death sets killed_dog). */
async function killDog(q: Quest): Promise<void> {
    await inMausoleum(q, async () => {
        await walkUnder(q, DOG_PIT, 3);
        for (let i = 0; i < 6; i++) {
            const dog = q.sdk.findNearbyNpc(/^temple guardian$/i);
            if (!dog) {
                q.log('temple guardian: not in view');
                await q.sdk.waitForTicks(5);
                continue;
            }
            const res = await q.bot.attack(dog, ticksToMs(15));
            if (!res.success) q.log(`temple guardian: ${res.message}`);
            if (await untilTicks(q.sdk, () => !q.sdk.getNearbyNpcs().some((n) => n.index === dog.index && (n.hp ?? 1) > 0), 80)) {
                q.log('temple guardian down');
                break;
            }
        }
        await q.sdk.waitForTicks(3);
    });
}

/** Cell door's Talk-through (trapped_drezel.rs2 oploc2): the long tale, then "Yes." */
async function talkThroughCell(q: Quest, choices: RegExp[]): Promise<void> {
    await intoTemple(q, 2);
    await q.goTo(CELL_APPROACH, 1);
    const door = await locNear(q, /cell door/i, CELL_DOOR, 2, /talk-through/i);
    if (!door) throw new Error(`no cell door near (${pos(q).x},${pos(q).z}) L${pos(q).level}`);
    await q.bot.interactLoc(door, /talk-through/i);
    if (!(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 10))) q.log('cell talk: no dialog 10t after Talk-through');
    const seen = await driveDialog(q.sdk, choices, { ticks: 600, log: q.log });
    q.log(`cell talk: …${seen.slice(-120)}`);
}

/** Level-30 monks only (evil_monks.rs2 ai_queue3 priestperilevilmonk3 drops the key). */
async function goldenKey(q: Quest): Promise<void> {
    if (q.count('golden key') > 0 || q.count('iron key') > 0) return;
    await intoTemple(q, 0);
    for (let i = 0; i < 8 && q.count('golden key') < 1; i++) {
        const loot = q.sdk.findGroundItem(/^golden key$/i);
        if (loot) {
            // A full bag cannot take the key: jacklove20 sat at 28/28 for three attempts on prod
            // (2026-10-30). Drop one essence; the hand-in trips top essence back up.
            if (q.sdk.getInventory().length >= 28) {
                await q.bot.dropItem(/^rune essence$/i, 1).catch(() => undefined);
                await q.sdk.waitForTicks(1);
            }
            await q.bot.pickupItem(loot);
            await untilTicks(q.sdk, () => q.count('golden key') > 0, 8);
            continue;
        }
        const monk = q.sdk
            .getNearbyNpcs()
            .filter((n) => /^monk of zamorak$/i.test(n.name) && n.combatLevel === 30 && n.reachable !== false)
            .sort((a, b) => Number(a.inCombat) - Number(b.inCombat) || a.distance - b.distance)[0];
        if (!monk) {
            q.log(`monk: no level-30 Monk of Zamorak in view (${q.sdk.getNearbyNpcs().filter((n) => /monk/i.test(n.name)).map((n) => n.combatLevel).join(',') || 'none'})`);
            await q.goTo(TEMPLE_INSIDE, 2);
            await q.sdk.waitForTicks(10);
            continue;
        }
        const res = await q.bot.attack(monk, ticksToMs(15));
        if (!res.success) q.log(`monk: ${res.message}`);
        await untilTicks(q.sdk, () => !q.sdk.getNearbyNpcs().some((n) => n.index === monk.index && (n.hp ?? 1) > 0), 80);
        await untilTicks(q.sdk, () => !!q.sdk.findGroundItem(/^golden key$/i), 5);
    }
    q.log(`golden key: ${q.count('golden key')} (bag ${q.sdk.getInventory().length}/28)`);
}

/** Golden key on each monument until one hands over the iron key; the bucket filled at the well. */
async function underTheTemple(q: Quest): Promise<void> {
    await inMausoleum(q, async () => {
        for (const mon of MONUMENTS) {
            if (q.count('iron key') > 0 || q.count('golden key') < 1) break;
            await walkUnder(q, mon, 1);
            await q.sdk.scanNearbyLocs(8).catch(() => undefined);
            const loc = (q.sdk.getNearbyLocs() ?? []).find((l) => l.id === mon.id);
            if (!loc) {
                q.log(`monument ${mon.id} not in view at (${pos(q).x},${pos(q).z})`);
                continue;
            }
            await q.bot.useItemOnLoc(/^golden key$/i, loc, { timeout: ticksToMs(20) });
            await untilTicks(q.sdk, () => q.count('iron key') > 0, 5);
        }
        q.log(`monuments: iron key ${q.count('iron key')}, golden key ${q.count('golden key')}`);
        if (held(q, MURKY) + held(q, BLESSED) < 1 && q.count('bucket') > 0) {
            await walkUnder(q, SALVE_WELL, 1);
            const well = await locNear(q, /^well$/i, SALVE_WELL, 2);
            if (well) {
                await q.bot.useItemOnLoc(/^bucket$/i, well, { timeout: ticksToMs(20) });
                await untilTicks(q.sdk, () => held(q, MURKY) > 0, 5);
            }
            q.log(`well: murky water ${held(q, MURKY)}`);
        }
    });
}

async function unlockCell(q: Quest): Promise<void> {
    if (q.count('iron key') < 1) return;
    await intoTemple(q, 2);
    await q.goTo(CELL_APPROACH, 1);
    const door = await locNear(q, /cell door/i, CELL_DOOR, 2);
    if (!door) throw new Error(`no cell door near (${pos(q).x},${pos(q).z}) L${pos(q).level}`);
    await q.bot.useItemOnLoc(/^iron key$/i, door, { timeout: ticksToMs(20) });
    await driveDialog(q.sdk, [], { ticks: 20, log: q.log });
    q.log(`cell: iron key ${q.count('iron key')}`);
}

/** Into the cell (Open works from unlocked_drezel); Drezel within reach. */
async function openCell(q: Quest): Promise<void> {
    await intoTemple(q, 2);
    await q.goTo(CELL_APPROACH, 1);
    const reachable = () => {
        const d = q.sdk.findNearbyNpc(/^drezel$/i);
        return !!d && d.reachable !== false;
    };
    for (let i = 0; i < 3 && !reachable(); i++) {
        const door = await locNear(q, /cell door/i, CELL_DOOR, 2, /^open$/i);
        if (!door) break;
        await q.bot.interactLoc(door, /^open$/i);
        await untilTicks(q.sdk, reachable, 6);
    }
}

/**
 * Back out of the cell (x >= 3416 on plane 2): useItemOnNpc walks in beside Drezel and
 * the door shuts behind; the planner then finds no path out and fell back to climbing
 * down a floor (2026-10-29). The door opens from inside once unlocked.
 */
async function leaveCell(q: Quest): Promise<void> {
    const inCell = () => pos(q).level === 2 && pos(q).x >= CELL_DOOR.x && Math.abs(pos(q).z - CELL_DOOR.z) <= 2;
    for (let i = 0; i < 3 && inCell(); i++) {
        const door = await locNear(q, /cell door/i, CELL_DOOR, 2, /^open$/i);
        if (door) {
            await q.bot.interactLoc(door, /^open$/i);
            await q.sdk.waitForTicks(2);
        }
        await q.sdk.sendWalk(CELL_APPROACH.x, CELL_APPROACH.z).catch(() => undefined);
        await untilTicks(q.sdk, () => !inCell(), 8);
    }
    q.log(`cell: ${inCell() ? 'STILL INSIDE' : 'out'} at (${pos(q).x},${pos(q).z})`);
}

/** Murky water blessed by Drezel (opnpcu), poured on the coffin (vampire_coffin.rs2). */
async function blessAndPour(q: Quest): Promise<void> {
    if (held(q, MURKY) + held(q, BLESSED) < 1) await underTheTemple(q);
    if (held(q, BLESSED) < 1) {
        const bucket = q.sdk.getInventory().find((i) => i.id === MURKY);
        if (!bucket) throw new Error('no murky water from the Salve well');
        await openCell(q);
        await q.bot.useItemOnNpc(bucket, /^drezel$/i, { timeout: ticksToMs(20) });
        await driveDialog(q.sdk, [], { done: () => held(q, BLESSED) > 0, ticks: 30, log: q.log });
        await untilTicks(q.sdk, () => held(q, BLESSED) > 0, 5);
        q.log(`blessed water ${held(q, BLESSED)}`);
    }
    await intoTemple(q, 2);
    await leaveCell(q);
    await q.goTo({ x: COFFIN.x, z: COFFIN.z + 2, level: 2 }, 1);
    const coffin = await locNear(q, /^coffin$/i, COFFIN, 2);
    if (!coffin) throw new Error(`no coffin near (${pos(q).x},${pos(q).z}) L${pos(q).level}`);
    const blessed = q.sdk.getInventory().find((i) => i.id === BLESSED);
    if (!blessed) throw new Error('blessed water missing at the coffin');
    await q.bot.useItemOnLoc(blessed, coffin, { timeout: ticksToMs(20) });
    await untilTicks(q.sdk, () => held(q, BLESSED) < 1, 6);
}

/** Drezel behind the second mausoleum gate (open from meet_in_mausoleum). */
async function mausoleumDrezel(q: Quest, fn: () => Promise<void>): Promise<void> {
    await inMausoleum(q, async () => {
        await walkUnder(q, GATE_DREZEL, 2);
        await walkUnder(q, MAUSOLEUM_DREZEL, 3);
        await untilTicks(q.sdk, () => !!q.sdk.findNearbyNpc(/^drezel$/i), 10);
        await fn();
    });
}

/**
 * Rune essence, a pack at a time, until Drezel has fifty (drezel_give_blankrunes). Each
 * refill asks only for what is still owed: a third pack of 24 sent a fixture whose bank
 * held exactly 60 off to mine (2026-10-29).
 */
async function handInEssence(q: Quest): Promise<void> {
    let done = false;
    let given = 0;
    for (let trip = 0; trip < 4 && !done; trip++) {
        if (trip > 0) await q.ensure('rune essence', Math.min(ESSENCE_PER_TRIP, ESSENCE_NEEDED - given));
        await mausoleumDrezel(q, async () => {
            const before = q.count('rune essence');
            await q.bot.useItemOnNpc(/^rune essence$/i, /^drezel$/i, { timeout: ticksToMs(20) });
            await untilTicks(q.sdk, () => q.count('rune essence') < before, 8);
            const seen = await driveDialog(q.sdk, [], { ticks: 40, log: q.log });
            given += before - q.count('rune essence');
            done = /that should do it/i.test(seen) || given >= ESSENCE_NEEDED;
            q.log(`essence: gave ${before - q.count('rune essence')} (${given} so far, left ${q.count('rune essence')})${done ? ', Drezel has fifty' : ''}`);
            if (q.count('rune essence') >= before) throw new Error('Drezel took no essence');
        });
        // A leftover pack means Drezel needed fewer than we brought: he is done.
        if (q.count('rune essence') > 0) done = true;
    }
}

await runQuest({
    id: 'priestperil',
    hub: 'varrock-west',
    journal: { label: 'Priest in Peril', title: 'Priest in Peril' },
    stages: [
        { id: 'unstarted', rule: { id: 'priestperil:unstarted', kind: 'unstarted', all: ['start this quest by speaking to'] } },
        { id: 'started', rule: { id: 'priestperil:started', kind: 'active', all: ['to the east of Varrock Palace'] } },
        { id: 'agree_to_kill_dog', rule: { id: 'priestperil:agree_to_kill_dog', kind: 'active', all: ['has asked me to kill it'] } },
        { id: 'killed_dog', rule: { id: 'priestperil:killed_dog', kind: 'active', all: ['claim my reward'] } },
        { id: 'return_to_drezel', rule: { id: 'priestperil:return_to_drezel', kind: 'active', all: ['will have me executed'] } },
        { id: 'find_drezel_key', rule: { id: 'priestperil:find_drezel_key', kind: 'active', all: ['to his cell and free him'] } },
        { id: 'unlocked_drezel', rule: { id: 'priestperil:unlocked_drezel', kind: 'active', all: ['still have to do something about that'] } },
        { id: 'poured_blessed_water', rule: { id: 'priestperil:poured_blessed_water', kind: 'active', all: ['should speak to Drezel again'] } },
        { id: 'meet_in_mausoleum', rule: { id: 'priestperil:meet_in_mausoleum', kind: 'active', all: ['damage has been done'] } },
        { id: 'bring_essence', rule: { id: 'priestperil:bring_essence', kind: 'active', all: ['purify the Salve'] } },
        { id: 'complete', rule: { id: 'priestperil:complete', kind: 'complete', all: ['QUEST COMPLETE'] } },
    ],
    transitions: [
        { from: 'unstarted', to: 'started', at: KING_ROALD, talk: { npc: /^king roald$/i, choices: [/^sure/i] } },
        { from: 'started', to: 'agree_to_kill_dog', run: knock },
        { from: 'agree_to_kill_dog', to: 'killed_dog', run: killDog },
        { from: 'killed_dog', to: 'return_to_drezel', at: KING_ROALD, talk: { npc: /^king roald$/i } },
        { from: 'return_to_drezel', to: 'find_drezel_key', run: (q) => talkThroughCell(q, [/tell me anyway/i, /^yes\.?$/i]) },
        {
            from: 'find_drezel_key',
            to: 'unlocked_drezel',
            needs: [{ item: 'bucket', count: 1, or: 'bucket of water' }],
            run: async (q) => {
                await goldenKey(q);
                await underTheTemple(q);
                await unlockCell(q);
            },
        },
        { from: 'unlocked_drezel', to: 'poured_blessed_water', needs: [{ item: 'bucket', count: 1, or: 'bucket of water' }], run: blessAndPour },
        {
            from: 'poured_blessed_water',
            to: 'meet_in_mausoleum',
            run: async (q) => {
                await openCell(q);
                await q.talk(/^drezel$/i);
            },
        },
        { from: 'meet_in_mausoleum', to: 'bring_essence', run: (q) => mausoleumDrezel(q, async () => void (await q.talk(/^drezel$/i))) },
        { from: 'bring_essence', to: 'complete', needs: [{ item: 'rune essence', count: ESSENCE_PER_TRIP }], run: handInEssence },
    ],
});
