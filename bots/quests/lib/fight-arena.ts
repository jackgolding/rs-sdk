/**
 * Fight Arena — Khazard's arena, its doors, cells and pen fights.
 *
 * Map facts (maps/m40_49; quest_arena/scripts/*.rs2; Hermes' probe notes,
 * quest-lab/PROBE-NOTES-arena.md on quest/arena):
 *   - fightarena_door1 is guarded (arena_guard1 within 5): from outside it says
 *     "This door appears to be locked." and, at stage >= obtained_armour with the
 *     Khazard helmet and armour WORN, the guard lets you through (you land on the
 *     door tile). Two placements: (2585,3141) — the jail corridor's west end — and
 *     (2617,3171) — the north end of the cell wing where Jeremy is held.
 *   - the jail corridor is the z 3141 row from (2585,3141) east to the guard room
 *     mouth (2606,3141); the cells (Hengrad, the slaves) are north of it behind
 *     arena_prisondoor, which only the quest's own scripts open
 *   - the bored guard (arena_guard2, npc 254) stands at (2615,3141) in the room
 *     east of the corridor
 *   - Jeremy's cell door arena_jeremydoor (2617,3167): use the cell keys on it and
 *     the quest walks you both into the pen and starts the ogre fight
 *   - the pen is ^arena_lower_coord..^arena_upper_coord (2581,3151)-(2606,3171);
 *     the mobs' static placements on x 2608 are decoys outside it — only a mob
 *     released into the pen counts. Jeremy's arena copy (npc 266) releases the
 *     next one when talked to.
 *   - out of the pen: fightarena_door2 (2606,3152) clicked from inside forcemoves
 *     you to (2607,3151) once the Servils are free
 */
import type { NearbyNpc } from '../../../sdk/types';
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, ticksToMs, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
}

export const LADY_SERVIL = { x: 2566, z: 3199 };
export const BARMAN = { x: 2566, z: 3140 };
const ARMOUR_CHEST = { x: 2613, z: 3189 };
const WEST_DOOR = { x: 2585, z: 3141 };
const WEST_DOOR_OUTSIDE = { x: 2583, z: 3141 };
const CORRIDOR_MOUTH = { x: 2606, z: 3141 };
const GUARD2 = { x: 2614, z: 3141 };
const WING_DOOR = { x: 2617, z: 3171 };
const WING_DOOR_OUTSIDE = { x: 2617, z: 3173 };
const JEREMY_DOOR = { x: 2617, z: 3167 };
const ARENA_DOOR = { x: 2606, z: 3152 };

const GUARD2_ID = 254;
const HENGRAD_ID = 263;
const JEREMY_ARENA_ID = 266;

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z})`;
const inBox = (t: Tile, x0: number, x1: number, z0: number, z1: number) => t.x >= x0 && t.x <= x1 && t.z >= z0 && t.z <= z1;
export const inPen = (t: Tile) => inBox(t, 2581, 2606, 3151, 3171);
const inCells = (t: Tile) => inBox(t, 2586, 2603, 3142, 3145);
const inCorridor = (t: Tile) => inBox(t, 2585, 2606, 3140, 3141);
const inGuardRoom = (t: Tile) => inBox(t, 2607, 2619, 3139, 3146);
/** Between the pen's exit (fightarena_door2 drops you at 2607,3151) and the corridor mouth. */
const inBackRoom = (t: Tile) => inBox(t, 2606, 2612, 3142, 3151);
const inWing = (t: Tile) => inBox(t, 2617, 2618, 3155, 3171);

/** Op `opt` on the loc at `at` until `done`, driving an open dialog to its end before any re-click. */
async function op(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string, choices: RegExp[] = []): Promise<void> {
    const drive = async () => {
        for (let i = 0; i < 3 && q.sdk.getDialog()?.isOpen && !done(); i++) await driveDialog(q.sdk, choices, { done, ticks: 120, log: q.log });
    };
    for (let attempt = 1; attempt <= 4; attempt++) {
        if (done()) return;
        if (q.sdk.getDialog()?.isOpen) await drive();
        if (done()) return;
        await q.sdk.scanNearbyLocs(10).catch(() => undefined);
        const loc = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === at.x && l.z === at.z && name.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)));
        if (!loc) {
            q.log(`arena: ${label}: no ${name} with ${opt} at (${at.x},${at.z}) from ${where(q)} (attempt ${attempt})`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(at.x, at.z, loc.id, loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 30);
        await drive();
        if (await untilTicks(q.sdk, done, 6)) return;
        q.log(`arena: ${label} did not take from ${where(q)} (attempt ${attempt})`);
    }
    throw new Error(`arena: ${label} failed at ${where(q)}`);
}

/** Walk an exact row/lane with client-planned clicks of at most `step` tiles. */
async function chord(q: Quest, to: Tile, label: string, tolerance = 0, step = 5): Promise<void> {
    const near = () => Math.max(Math.abs(pos(q).x - to.x), Math.abs(pos(q).z - to.z)) <= tolerance;
    for (let tries = 0; tries < 30 && !near(); tries++) {
        const from = pos(q);
        const len = Math.max(Math.abs(to.x - from.x), Math.abs(to.z - from.z));
        const k = Math.min(1, step / Math.max(len, 1));
        const hop = { x: from.x + Math.round((to.x - from.x) * k), z: from.z + Math.round((to.z - from.z) * k) };
        await q.sdk.sendWalk(hop.x, hop.z, true);
        // A guard standing on the lane refuses the step without being a wall: wait it out.
        if (!(await untilTicks(q.sdk, () => pos(q).x === hop.x && pos(q).z === hop.z, 10))) await q.sdk.waitForTicks(2);
    }
    if (!near()) throw new Error(`arena: ${label}: stuck at ${where(q)} short of (${to.x},${to.z})`);
}

/** Talk to the npc with this id (several share the name "Khazard Guard" / "Jeremy Servil"). */
async function talkId(q: Quest, id: number, choices: RegExp[] = [], label = `npc ${id}`): Promise<string> {
    const find = () => (q.sdk.getNearbyNpcs() ?? []).find((n) => n.id === id);
    if (!(await untilTicks(q.sdk, () => !!find(), 15))) throw new Error(`arena: ${label} not in view from ${where(q)}`);
    const res = await q.bot.talkTo(find()!);
    if (!res.success) q.log(`arena: talk ${label}: ${res.message}`);
    const seen = await driveDialog(q.sdk, choices, { ticks: 150, log: q.log });
    q.log(`arena: ${label}: ${seen.slice(0, 200)}`);
    return seen;
}

/** Let a dialog that reopens after a pause (cutscene forcemoves, npc walks) arrive, and drive it to its end. */
export async function settle(q: Quest, rounds = 4): Promise<void> {
    for (let i = 0; i < rounds; i++) {
        if (!(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 10))) return;
        await driveDialog(q.sdk, [], { ticks: 120, log: q.log });
    }
}

// ── Gear

const HELM = /^khazard helmet$/i;
const ARMOUR = /^khazard armour$/i;

async function wear(q: Quest, item: RegExp): Promise<void> {
    if (q.sdk.getEquipment().some((i) => item.test(i.name))) return;
    const held = q.sdk.findInventoryItem(item);
    if (!held) throw new Error(`arena: no ${item} to wear`);
    await q.bot.equipItem(held);
    if (!(await untilTicks(q.sdk, () => q.sdk.getEquipment().some((i) => item.test(i.name)), 5))) throw new Error(`arena: could not wear ${held.name}`);
}

/** The guards and doors only treat you as one of them with both pieces WORN. */
export async function wearDisguise(q: Quest): Promise<void> {
    await wear(q, HELM);
    await wear(q, ARMOUR);
}

/** Bow in hand, arrows in the quiver (player_ranged.rs2 takes ammo from the quiver slot only). */
async function wearBow(q: Quest): Promise<void> {
    await wear(q, /^magic shortbow$/i);
    await wear(q, /^rune arrow$/i);
}

// ── Steps

/** arena_guard_chest_shut -> Open, then arena_guard_chest_open -> Search: the helmet and armour. */
export async function takeArmour(q: Quest): Promise<void> {
    const have = () => q.count('khazard helmet') + q.count('khazard armour') + q.sdk.getEquipment().filter((i) => HELM.test(i.name) || ARMOUR.test(i.name)).length >= 2;
    if (!have()) {
        await q.goTo(ARMOUR_CHEST, 2);
        await op(q, ARMOUR_CHEST, /^chest$/i, /^open$/i, () => (q.sdk.getNearbyLocs() ?? []).some((l) => l.x === ARMOUR_CHEST.x && l.z === ARMOUR_CHEST.z && l.options.some((o) => /search/i.test(o))) || have(), 'open the chest');
        await op(q, ARMOUR_CHEST, /^chest$/i, /^search$/i, have, 'search the chest');
        await settle(q, 1);
    }
    await wearDisguise(q);
}

/** Into the bored guard's room: through the west door (in disguise), along the corridor, east into the room. */
async function toGuardRoom(q: Quest): Promise<void> {
    if (inGuardRoom(pos(q))) return;
    await wearDisguise(q);
    if (!inCorridor(pos(q))) {
        await q.goTo(WEST_DOOR_OUTSIDE, 1);
        await op(q, WEST_DOOR, /door/i, /^open$/i, () => inCorridor(pos(q)), 'west door in');
    }
    await chord(q, CORRIDOR_MOUTH, 'corridor east');
    const res = await q.bot.walkTo(GUARD2.x, GUARD2.z, 2);
    if (!inGuardRoom(pos(q))) throw new Error(`arena: into the guard room: ${res.message} at ${where(q)}`);
}

/** Back out the way in: west along the corridor and through the west door. */
export async function leaveGuardRoom(q: Quest): Promise<void> {
    if (!inGuardRoom(pos(q)) && !inCorridor(pos(q)) && !inBackRoom(pos(q))) return;
    // The way out of the arena buildings is the corridor's west door; north through
    // the cell wing walkTo strands at the prison doors (2617,3158).
    if (!inCorridor(pos(q))) {
        const res = await q.bot.walkTo(CORRIDOR_MOUTH.x, CORRIDOR_MOUTH.z, 0);
        if (!inCorridor(pos(q))) throw new Error(`arena: to the corridor mouth: ${res.message} at ${where(q)}`);
    }
    await chord(q, WEST_DOOR, 'corridor west');
    await op(q, WEST_DOOR, /door/i, /^open$/i, () => !inCorridor(pos(q)), 'west door out');
}

export async function talkGuard2(q: Quest): Promise<void> {
    await toGuardRoom(q);
    await talkId(q, GUARD2_ID, [/fancy a drink/i], 'the bored guard');
}

/** khazard_barman.rs2: "I'd like a Khali brew please." (5gp; offered from spoken_drunkguard on). */
export async function buyBrew(q: Quest): Promise<void> {
    if (q.count('khali brew') > 0) return;
    await leaveGuardRoom(q);
    await q.talk(/^khazard barman$/i, [/khali brew/i], BARMAN);
    if (q.count('khali brew') < 1) throw new Error(`arena: no Khali brew after the barman (coins ${q.count('coins')})`);
}

/** Into the cell wing (in disguise), keys on Jeremy's door: he is freed and you are both walked into the pen. */
export async function freeJeremy(q: Quest): Promise<void> {
    await wearDisguise(q);
    await wearBow(q);
    if (!inWing(pos(q)) && !inPen(pos(q))) {
        await leaveGuardRoom(q);
        await q.goTo(WING_DOOR_OUTSIDE, 1);
        await op(q, WING_DOOR, /door/i, /^open$/i, () => inWing(pos(q)), 'cell wing door in');
    }
    if (inWing(pos(q))) {
        await q.bot.walkTo(JEREMY_DOOR.x, JEREMY_DOOR.z, 0);
        const keys = q.sdk.findInventoryItem(/^khazard cell keys$/i);
        if (!keys) throw new Error('arena: no cell keys');
        await q.sdk.scanNearbyLocs(6).catch(() => undefined);
        const door = (q.sdk.getNearbyLocs() ?? []).find((l) => l.x === JEREMY_DOOR.x && l.z === JEREMY_DOOR.z);
        if (!door) throw new Error(`arena: no cell door at (${JEREMY_DOOR.x},${JEREMY_DOOR.z}) from ${where(q)}`);
        await q.sdk.sendUseItemOnLoc(keys.slot, JEREMY_DOOR.x, JEREMY_DOOR.z, door.id);
        // free_jeremy_servil: a few pages, a walk, then @arena_enter teleports into the pen.
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || inPen(pos(q)), 20);
        for (let i = 0; i < 6 && !inPen(pos(q)); i++) await settle(q, 1);
        await untilTicks(q.sdk, () => inPen(pos(q)), 30);
        await settle(q, 2);
    }
    q.log(`arena: after the cell keys at ${where(q)} (in pen: ${inPen(pos(q))})`);
}

// ── Pen fights

const penMob = (q: Quest, name: RegExp): NearbyNpc | undefined =>
    (q.sdk.getNearbyNpcs() ?? [])
        .filter((n) => name.test(n.name) && inPen(n) && (n.hp ?? 1) > 0)
        .sort((a, b) => a.distance - b.distance)[0];

async function eatIfLow(q: Quest): Promise<void> {
    const p = q.sdk.getState()?.player;
    if (!p || p.hp > (p.maxHp ?? 99) * 0.65) return;
    const food = q.sdk.findInventoryItem(/^shark$/i);
    if (!food) return;
    await q.bot.eatFood(food).catch(() => undefined);
}

/**
 * Kill one mob released into the pen. If none is in it, Jeremy's arena copy
 * releases the stage's mob (jeremy_servil.rs2) — or starts the ogre fight.
 * Returns once the mob we fought is dead or gone; the runner reads the journal.
 */
export async function penFight(q: Quest, name: RegExp, label: string, then?: RegExp): Promise<void> {
    if (!inPen(pos(q))) throw new Error(`arena: ${label}: not in the pen (${where(q)})`);
    await wearBow(q);
    await settle(q, 1);
    const t0 = tickNow(q.sdk);
    let attacks = 0;
    let releases = 0;
    let kills = 0;
    let want = name;
    let fought: number | null = null;
    const alive = (index: number) => (q.sdk.getNearbyNpcs() ?? []).some((n) => n.index === index && (n.hp ?? 1) > 0);
    while (tickNow(q.sdk) - t0 < 1200 && inPen(pos(q))) {
        if (fought !== null && !alive(fought)) {
            kills++;
            fought = null;
            if (!then) break;
            // `then`: Khazard sends the next one in as this one dies (the scorpion's
            // death releases Bouncer): fight it now rather than stand there while it hits
            // (a bot idling through the journal read died to Bouncer, 2026-10-29).
            want = then;
            if (!(await untilTicks(q.sdk, () => !!penMob(q, want) || !inPen(pos(q)), 10))) break;
            continue;
        }
        const mob: ReturnType<typeof penMob> = fought !== null ? (q.sdk.getNearbyNpcs() ?? []).find((n) => n.index === fought) : penMob(q, want);
        if (!mob) {
            if (q.sdk.getDialog()?.isOpen) {
                await settle(q, 1);
                continue;
            }
            if (await untilTicks(q.sdk, () => !!penMob(q, want), 8)) continue;
            if (kills > 0 || releases++ >= 3) break;
            q.log(`arena: ${label}: none in the pen — asking Jeremy`);
            await talkId(q, JEREMY_ARENA_ID, [], 'Jeremy (arena)');
            await settle(q, 2);
            continue;
        }
        fought = mob.index;
        await eatIfLow(q);
        const me = q.sdk.getState()?.player;
        if (!me?.combat?.inCombat || me.combat.targetIndex !== mob.index) {
            attacks++;
            const res = await q.bot.attack(mob, ticksToMs(10));
            if (!res.success) q.log(`arena: ${label} attack #${attacks}: ${res.message}`);
        }
        await q.sdk.waitForTicks(2);
        if (q.sdk.getDialog()?.isOpen) await settle(q, 2);
    }
    // The death handler's dialog (Khazard's lines, the walk to the cells) follows the kill.
    await settle(q, 4);
    q.log(`arena: ${label}: ${kills} killed in ${tickNow(q.sdk) - t0}t (${attacks} attacks, hp ${q.sdk.getState()?.player?.hp}, at ${where(q)})`);
}

/** sent_jail: Hengrad's talk in the cells ends with the lead guard marching you into the pen. */
async function hengradToPen(q: Quest): Promise<void> {
    if (inPen(pos(q))) return;
    await talkId(q, HENGRAD_ID, [], 'Hengrad');
    await untilTicks(q.sdk, (s) => inPen(pos(q)) || !!s.dialog?.isOpen, 40);
    for (let i = 0; i < 6 && !inPen(pos(q)); i++) {
        await settle(q, 1);
        await untilTicks(q.sdk, () => inPen(pos(q)), 10);
    }
    if (!inPen(pos(q))) throw new Error(`arena: Hengrad's guard never took us to the pen (${where(q)})`);
}

/**
 * Back into the pen from anywhere: the cells (Hengrad, at sent_jail) or the jail
 * corridor's west door, which at stages 9-11 says "So you're back for more are
 * you?" and runs @arena_enter (khazard guard within 5 of it).
 */
export async function toPen(q: Quest): Promise<void> {
    if (inPen(pos(q))) return;
    if (inCells(pos(q))) return hengradToPen(q);
    await wearDisguise(q).catch(() => undefined);
    if (inGuardRoom(pos(q)) || inCorridor(pos(q))) await leaveGuardRoom(q);
    await q.goTo(WEST_DOOR_OUTSIDE, 1);
    await op(q, WEST_DOOR, /door/i, /^open$/i, () => inPen(pos(q)), 'west door back into the pen');
    await settle(q, 2);
}

/** Talk to Jeremy's arena copy (defeated_ogre: Khazard's "well done" sends you to the cells). */
export async function talkJeremyArena(q: Quest, choices: RegExp[] = []): Promise<void> {
    await talkId(q, JEREMY_ARENA_ID, choices, 'Jeremy (arena)');
    await settle(q, 3);
}

/** Out of the pen through fightarena_door2 (from inside it forcemoves you to 2607,3151). */
export async function leavePen(q: Quest): Promise<void> {
    if (inPen(pos(q))) await op(q, ARENA_DOOR, /door/i, /^open$/i, () => !inPen(pos(q)), 'arena door out');
    await leaveGuardRoom(q);
}
