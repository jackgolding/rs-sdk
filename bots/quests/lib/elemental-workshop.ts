/**
 * Elemental Workshop I — the route and mechanics (bots/quests/elemental-workshop.ts is the definition).
 *
 * Content facts (quest_elemental_workshop/scripts/{quest_elemental_workshop,elemental_workshop_shield_book,
 * elemental_earth}.rs2; placements m42_54 / m42_154); route cross-checked with rs-stun-toolkit's
 * q-elemental-workshop.ts spec. Progress is a bit field (%elemental_workshop_bits) the journal shows part of:
 *   - Bookcase (loc 3389, 2716,3481) Search -> Battered book. Read it (opheld1) -> bit 1; a knife on it -> Battered key
 *     (bit 2).
 *   - Odd looking wall (3390/3391, 2709-2710,3495) in the smithy: the key used on it opens it; the spiral stairs (3415,
 *     2710,3497) teleport to the workshop (2716,9888), bit 13. The stairs up (3416, 2714,9887) land at (2709,3497),
 *     behind the wall, which Push opens from that side.
 *   - Water: valve 1 (3404, 2726,9908) toggles bit 4 only while bit 3 is off; valve 2 (3405, 2713,9908) toggles bit 3;
 *     the water lever (3406, 2722,9906) with both set starts the wheel (bit 5), else resets both ("flow gates
 *     resetting"); pulled while flowing it stops the wheel. All three are toggles: one op each, judged by message.
 *   - Box 1 (3394, 2717,9894) a stone bowl; box 2 (3395, 2700,9887) a needle and box 4 (3397, 2724,9894) leather, once
 *     each. Bellows (3410, 2734,9882) Fix with needle + leather + thread, Crafting 20 -> bit 6. The air lever (3409,
 *     2734,9887) with bits 5+6 -> bit 9 ("The bellows pump air down the pipe."), pulled again it stops.
 *   - A Pile of Rock (3403) Mine (Mining 20 + a usable pickaxe) spawns an Earth elemental (35 hp) that drops the
 *     Elemental ore.
 *   - The bowl on a lava trough (3414, 2714,9871) fills; on the furnace (3413, 2724,9874) lights it (bit 7). The ore on
 *     the lit furnace with air blowing and 4 coal -> Elemental metal. The metal on a workbench (3402, 2722,9887) with a
 *     hammer, Smithing 20 and the book -> Elemental shield, quest complete.
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const OBJ = { book: 2886, key: 2887, bowl: 2888, bowlFull: 2889, ore: 2892, bar: 2893 } as const;
const LOC = {
    bookcase: 3389,
    wallR: 3390,
    wallL: 3391,
    stairsDown: 3415,
    stairsUp: 3416,
    box1: 3394,
    box2: 3395,
    box4: 3397,
    valve1: 3404,
    valve2: 3405,
    waterLever: 3406,
    rock: 3403,
    bellows: 3410,
    airLever: 3409,
    trough: 3414,
    furnace: 3413,
    workbench: 3402,
} as const;

/** earth_elemental_rock_version (npc.pack 1023). */
const NPC_ROCK_ELEMENTAL = 1023;
const BOOKCASE = { x: 2716, z: 3481 };
const ODD_WALL = { x: 2709, z: 3495 };
/** Outside the odd wall (the smithy) and the pocket behind it with the stairs. */
const SMITHY = { x: 2709, z: 3493 };
const STAIRS_TOP = { x: 2710, z: 3497 };
const STAIRS_UP = { x: 2714, z: 9887 };
const BOX1 = { x: 2717, z: 9894 };
const BOX2 = { x: 2700, z: 9887 };
const BOX4 = { x: 2724, z: 9894 };
const VALVE1 = { x: 2726, z: 9908 };
const VALVE2 = { x: 2713, z: 9908 };
const WATER_LEVER = { x: 2722, z: 9906 };
const ROCK = { x: 2706, z: 9904 };
const BELLOWS = { x: 2734, z: 9882 };
const AIR_LEVER = { x: 2734, z: 9887 };
const TROUGH = { x: 2714, z: 9871 };
const FURNACE = { x: 2724, z: 9874 };
const WORKBENCH = { x: 2722, z: 9887 };
/** The Coal Trucks' coal rocks (coalrock1/2, 2574-2581,3474-3485), west of Seers. */
const COAL_TRUCKS = { x: 2578, z: 3482 };
const COAL_ROCKS = new Set([2096, 2097]);

const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
export const holds = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id);

export const inWorkshop = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2685, 2745, 9865, 9920);
/** The pocket behind the odd wall, where the stairs up land. */
const inWallPocket = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2708, 2711, 3496, 3499);
export const inWorkshopArea = (p: Tile) => inWorkshop(p) || inWallPocket(p);

/** Game messages since `t0`. */
const messagesSince = (q: Quest, t0: number) => (q.sdk.getState()?.gameMessages ?? []).filter((m) => m.tick >= t0 && m.type === 0).map((m) => m.text);
const heard = (q: Quest, t0: number, re: RegExp) => messagesSince(q, t0).some((m) => re.test(m));
const lastHeard = (q: Quest, t0: number, res: RegExp[]) => messagesSince(q, t0).filter((m) => res.some((r) => r.test(m))).pop();

async function locById(q: Quest, id: number, at: Tile, within = 3) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? []).filter((l) => l.id === id).sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= within ? loc : undefined;
}

/** Op1 a loc once (by id, near `at`); walks close first. */
async function opOnce(q: Quest, id: number, at: Tile, label: string): Promise<boolean> {
    if (Math.hypot(pos(q).x - at.x, pos(q).z - at.z) > 6) await q.bot.walkTo(at.x, at.z, 2).catch(() => undefined);
    const loc = await locById(q, id, at);
    if (!loc) {
        q.log(`ew: ${label}: loc ${id} not in view near (${at.x},${at.z}) from ${where(q)}`);
        return false;
    }
    await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, 1);
    return true;
}

/** Op1 on loc `id` until `done`, re-sending only after a bounded wait. */
async function opUntil(q: Quest, id: number, at: Tile, done: () => boolean, label: string, ticks = 15): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        if (!(await opOnce(q, id, at, label))) {
            await q.sdk.waitForTicks(3);
            continue;
        }
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 15 });
    }
    if (!done()) throw new Error(`ew: ${label} failed at ${where(q)}`);
}

/** Use inventory item `item` on loc `id` near `at` until `done`. */
async function useOn(q: Quest, item: number, id: number, at: Tile, done: () => boolean, label: string, ticks = 12): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const inv = q.sdk.getInventory().find((i) => i.id === item);
        if (!inv) throw new Error(`ew: ${label}: no item ${item} held`);
        if (Math.hypot(pos(q).x - at.x, pos(q).z - at.z) > 6) await q.bot.walkTo(at.x, at.z, 2).catch(() => undefined);
        const loc = await locById(q, id, at);
        if (!loc) {
            q.log(`ew: ${label}: loc ${id} not in view from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendUseItemOnLoc(inv.slot, loc.x, loc.z, loc.id);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 10 });
    }
    if (!done()) throw new Error(`ew: ${label} failed at ${where(q)}`);
}

/**
 * One pull/turn of a toggle (valve, lever) and its message. Re-sends only when no message of `results` came back in
 * the wait — a second op that lands turns it straight back.
 */
async function toggle(q: Quest, id: number, at: Tile, results: RegExp[], label: string): Promise<string> {
    const first = tickNow(q.sdk);
    for (let attempt = 1; attempt <= 3; attempt++) {
        // A late reply to the last op (a slow walk to the loc, prod latency): take it rather than toggle again.
        if (attempt > 1 && (await untilTicks(q.sdk, () => !!lastHeard(q, first, results), 6))) {
            const m = lastHeard(q, first, results)!;
            q.log(`ew: ${label}: ${m} (late)`);
            return m;
        }
        const t0 = tickNow(q.sdk);
        if (!(await opOnce(q, id, at, label))) {
            await q.sdk.waitForTicks(3);
            continue;
        }
        if (await untilTicks(q.sdk, () => !!lastHeard(q, t0, results), 20)) {
            // A late second message would mean a double op: give it a moment and report the last.
            await q.sdk.waitForTicks(3);
            const m = lastHeard(q, t0, results)!;
            q.log(`ew: ${label}: ${m}`);
            return m;
        }
        q.log(`ew: ${label}: no reply (attempt ${attempt}) at ${where(q)}`);
    }
    throw new Error(`ew: ${label}: no reply at ${where(q)}`);
}

// ── surface

/** The bookcase in the house by the Seers bank, then read the book. */
export async function findBook(q: Quest): Promise<void> {
    if (!holds(q, OBJ.book)) {
        await q.goTo(BOOKCASE, 3);
        await q.reach(/^bookcase$/i, /^search$/i).catch(() => undefined);
        // The house door shut: "I can't reach that!" ×4 (jacklove2, jacklove13, 2026-11-05). Open the nearest
        // closed door and search again.
        for (let attempt = 1; attempt <= 3 && !holds(q, OBJ.book); attempt++) {
            const ok = await opUntil(q, LOC.bookcase, BOOKCASE, () => holds(q, OBJ.book), 'search the bookcase').then(() => true).catch((e) => {
                q.log(`ew: ${(e as Error).message} (attempt ${attempt})`);
                return false;
            });
            if (ok) break;
            await q.sdk.scanNearbyLocs(8).catch(() => undefined);
            const p = q.sdk.getState()?.player;
            const door = (q.sdk.getNearbyLocs() ?? [])
                .filter((l) => /door/i.test(l.name) && l.options.some((o) => /^open$/i.test(o)))
                .sort((a, b) => Math.hypot(a.x - (p?.worldX ?? 0), a.z - (p?.worldZ ?? 0)) - Math.hypot(b.x - (p?.worldX ?? 0), b.z - (p?.worldZ ?? 0)))[0];
            if (!door) break;
            q.log(`ew: opening ${door.name} at (${door.x},${door.z})`);
            await q.bot.openDoor(door).catch(() => undefined);
            await q.sdk.waitForTicks(2);
        }
        if (!holds(q, OBJ.book)) throw new Error(`ew: search the bookcase failed (no way in)`);
    }
    await readBook(q);
}

/** Read the book (bit 1): it opens a book interface, closed again here. */
export async function readBook(q: Quest): Promise<void> {
    const book = q.sdk.getInventory().find((i) => i.id === OBJ.book);
    if (!book) throw new Error('ew: no Battered book to read');
    const t0 = tickNow(q.sdk);
    for (let attempt = 1; attempt <= 3 && !heard(q, t0, /flip the book open/i); attempt++) {
        await q.sdk.sendUseItem(book.slot, 1);
        await untilTicks(q.sdk, () => heard(q, t0, /flip the book open/i), 8);
    }
    await q.bot.closeInterface().catch(() => undefined);
    if (!heard(q, t0, /flip the book open/i)) throw new Error('ew: the book did not open');
}

/** A knife on the book: the Battered key (bit 2). */
export async function slashBook(q: Quest): Promise<void> {
    if (holds(q, OBJ.key)) return;
    for (let attempt = 1; attempt <= 3 && !holds(q, OBJ.key); attempt++) {
        const knife = q.sdk.getInventory().find((i) => /^knife$/i.test(i.name));
        const book = q.sdk.getInventory().find((i) => i.id === OBJ.book);
        if (!knife || !book) throw new Error(`ew: need a knife and the book (carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
        await q.sdk.sendUseItemOnItem(knife.slot, book.slot);
        await untilTicks(q.sdk, () => holds(q, OBJ.key), 8);
    }
    if (!holds(q, OBJ.key)) throw new Error('ew: no Battered key from the book');
}

/** The key on the odd wall, then down the spiral stairs (bit 13). */
export async function enterWorkshop(q: Quest): Promise<void> {
    if (inWorkshop(pos(q))) return;
    if (!inWallPocket(pos(q))) {
        await q.goTo(SMITHY, 2);
        await useOn(q, OBJ.key, LOC.wallL, ODD_WALL, () => inWallPocket(pos(q)) || pos(q).z >= 3496, 'the key on the odd wall', 10);
        // The wall swings open; step through to the stairs.
        if (!inWallPocket(pos(q))) await q.bot.walkTo(STAIRS_TOP.x, STAIRS_TOP.z - 1, 0).catch(() => undefined);
    }
    await opUntil(q, LOC.stairsDown, STAIRS_TOP, () => inWorkshop(pos(q)), 'down the spiral stairs', 10);
    q.log(`ew: in the workshop at ${where(q)}`);
}

/** Up the stairs and out through the odd wall (Push opens it from behind). */
export async function leaveWorkshop(q: Quest): Promise<void> {
    if (inWorkshop(pos(q))) await opUntil(q, LOC.stairsUp, STAIRS_UP, () => !inWorkshop(pos(q)), 'up the spiral stairs', 10);
    for (let attempt = 1; attempt <= 4 && inWallPocket(pos(q)); attempt++) {
        const wall = await locById(q, LOC.wallL, ODD_WALL, 2) ?? (await locById(q, LOC.wallR, { x: 2710, z: 3495 }, 2));
        if (wall) {
            const op = wall.optionsWithIndex.find((o) => /^push$/i.test(o.text));
            await q.sdk.sendInteractLoc(wall.x, wall.z, wall.id, op?.opIndex ?? 1);
        }
        await untilTicks(q.sdk, () => !inWallPocket(pos(q)), 6);
        if (inWallPocket(pos(q))) await q.bot.walkTo(SMITHY.x, SMITHY.z, 1).catch(() => undefined);
    }
    if (inWallPocket(pos(q))) throw new Error(`ew: stuck behind the odd wall at ${where(q)}`);
}

// ── the workshop

/** The stone bowl from box 1 (any form held counts). */
async function bowl(q: Quest): Promise<void> {
    if (holds(q, OBJ.bowl) || holds(q, OBJ.bowlFull)) return;
    await opUntil(q, LOC.box1, BOX1, () => holds(q, OBJ.bowl), 'the stone bowl from box 1');
}

const WATER_ON = /water wheel starting up/i;
const WATER_OFF = /water wheel coming to a standstill/i;
const WATER_RESET = /flow gates resetting/i;
const HANDLE = /you turn the handle|valve seems locked off/i;

/** Valves and the water lever until the wheel turns (bit 5). */
export async function startWater(q: Quest): Promise<void> {
    await bowl(q);
    // The valves' state is unknown on a resume: one pull either starts the wheel or resets both gates.
    let r = await toggle(q, LOC.waterLever, WATER_LEVER, [WATER_ON, WATER_OFF, WATER_RESET], 'water lever');
    for (let pass = 1; pass <= 3 && !WATER_ON.test(r); pass++) {
        // A pull while it ran stopped it: pull again to start (the gates stay open).
        if (WATER_OFF.test(r)) {
            r = await toggle(q, LOC.waterLever, WATER_LEVER, [WATER_ON, WATER_OFF, WATER_RESET], 'water lever');
            continue;
        }
        // Gates reset (both closed): valve 1 first (it only turns while valve 2 is shut), then valve 2.
        await toggle(q, LOC.valve1, VALVE1, [HANDLE], 'valve 1');
        await toggle(q, LOC.valve2, VALVE2, [HANDLE], 'valve 2');
        r = await toggle(q, LOC.waterLever, WATER_LEVER, [WATER_ON, WATER_OFF, WATER_RESET], 'water lever');
    }
    if (!WATER_ON.test(r)) throw new Error(`ew: the water wheel would not start (${r})`);
}

const FOOD = /^(shark|manta ray|monkfish|swordfish|lobster|bass|tuna)$/i;
async function eatIfLow(q: Quest): Promise<void> {
    const p = q.sdk.getState()?.player;
    if (!p || p.hp > (p.maxHp ?? 10) * 0.5) return;
    const food = q.sdk.getInventory().find((i) => FOOD.test(i.name));
    if (food) await q.bot.eatFood(food).catch(() => undefined);
}

/** A melee weapon wielded for the elemental. */
async function wield(q: Quest): Promise<void> {
    const weapon = q.sdk.getInventory().find((i) => /scimitar|longsword|sword|whip|battleaxe|mace|dagger/i.test(i.name));
    if (weapon) await q.bot.equipItem(weapon).catch(() => undefined);
}

/** Mine a Pile of Rock: the Earth elemental it spawns drops the Elemental ore. */
export async function elementalOre(q: Quest): Promise<void> {
    if (holds(q, OBJ.ore) || holds(q, OBJ.bar)) return;
    await wield(q);
    const t0 = tickNow(q.sdk);
    // Only the rock's own elemental (earth_elemental_rock_version) drops the ore; the workshop's wandering earth
    // elementals (elemental_earth, same name) drop runes and coins.
    const elemental = () => (q.sdk.getNearbyNpcs() ?? []).filter((n) => n.id === NPC_ROCK_ELEMENTAL).sort((a, b) => a.distance - b.distance)[0];
    const oreOnGround = () => (q.sdk.getState()?.groundItems ?? []).find((g) => g.id === OBJ.ore);
    while (!holds(q, OBJ.ore) && tickNow(q.sdk) - t0 < 800) {
        await eatIfLow(q);
        const g = oreOnGround();
        if (g) {
            await q.bot.pickupItem(g).catch(() => undefined);
            await untilTicks(q.sdk, () => holds(q, OBJ.ore), 8);
            continue;
        }
        const npc = elemental();
        if (npc) {
            await q.bot.attack(npc).catch(() => undefined);
            await untilTicks(q.sdk, () => !elemental() || !!oreOnGround() || (q.sdk.getState()?.player?.hp ?? 99) < (q.sdk.getState()?.player?.maxHp ?? 99) * 0.5, 30);
            continue;
        }
        const rock = await locById(q, LOC.rock, ROCK, 12);
        if (!rock) {
            await q.bot.walkTo(ROCK.x, ROCK.z, 2).catch(() => undefined);
            continue;
        }
        await q.sdk.sendInteractLoc(rock.x, rock.z, rock.id, 1);
        await untilTicks(q.sdk, () => !!elemental() || !!q.sdk.getDialog()?.isOpen, 15);
        if (q.sdk.getDialog()?.isOpen) {
            const text = await driveDialog(q.sdk, [], { ticks: 8 });
            if (/pickaxe/i.test(text)) throw new Error(`ew: no usable pickaxe for the elemental rock (${text})`);
        }
    }
    if (!holds(q, OBJ.ore)) throw new Error(`ew: no Elemental ore in ${tickNow(q.sdk) - t0}t`);
    q.log(`ew: Elemental ore in ${tickNow(q.sdk) - t0}t`);
}

/** Needle (box 2) and leather (box 4) when not carried, then Fix the bellows (bit 6). */
export async function fixBellows(q: Quest): Promise<void> {
    if (q.count(/^needle$/i) === 0) await opUntil(q, LOC.box2, BOX2, () => q.count(/^needle$/i) > 0, 'the needle from box 2').catch((e) => q.log(String(e)));
    if (q.count(/^leather$/i) === 0) await opUntil(q, LOC.box4, BOX4, () => q.count(/^leather$/i) > 0, 'the leather from box 4').catch((e) => q.log(String(e)));
    if (q.count(/^needle$/i) === 0 || q.count(/^leather$/i) === 0 || q.count(/^thread$/i) === 0) {
        throw new Error(`ew: the bellows need a needle, leather and thread (carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
    }
    const t0 = tickNow(q.sdk);
    await opUntil(q, LOC.bellows, BELLOWS, () => heard(q, t0, /stitch the leather|already look fixed/i), 'fix the bellows');
}

const AIR_ON = /bellows pump air/i;
const AIR_OFF = /bellows stop pumping/i;
const AIR_NONE = /nothing happens; the lever resets/i;

/** The air lever until the bellows pump (bit 9). */
async function airOn(q: Quest): Promise<void> {
    let r = await toggle(q, LOC.airLever, AIR_LEVER, [AIR_ON, AIR_OFF, AIR_NONE], 'air lever');
    if (AIR_OFF.test(r)) r = await toggle(q, LOC.airLever, AIR_LEVER, [AIR_ON, AIR_OFF, AIR_NONE], 'air lever');
    if (!AIR_ON.test(r)) throw new Error(`ew: the bellows will not pump (${r}) — is the water wheel running?`);
}

/** Lava from the trough into the furnace (bit 7). */
export async function lightFurnace(q: Quest): Promise<void> {
    await bowl(q);
    if (!holds(q, OBJ.bowlFull)) {
        // The trough is 1x5; stand at its north-east end (the spec: the planner's reach test chose a tile 4 off).
        await q.bot.walkTo(TROUGH.x + 1, TROUGH.z + 1, 0).catch(() => undefined);
        await useOn(q, OBJ.bowl, LOC.trough, TROUGH, () => holds(q, OBJ.bowlFull), 'the bowl in the lava trough', 10);
    }
    const t0 = tickNow(q.sdk);
    await useOn(q, OBJ.bowlFull, LOC.furnace, FURNACE, () => heard(q, t0, /bursts in to life|makes little difference/i), 'lava into the furnace', 15);
}

/** The ore and 4 coal in the furnace: the Elemental metal. Air on first only if the furnace says it is not hot enough
 * (the air lever is a toggle: pulling it while it blows stops it). */
export async function smeltBar(q: Quest): Promise<void> {
    if (holds(q, OBJ.bar)) return;
    if (q.count(/^coal$/i) < 4) throw new Error(`ew: 4 coal needed, holding ${q.count(/^coal$/i)}`);
    for (let pass = 1; pass <= 2 && !holds(q, OBJ.bar); pass++) {
        const t0 = tickNow(q.sdk);
        await useOn(q, OBJ.ore, LOC.furnace, FURNACE, () => holds(q, OBJ.bar) || heard(q, t0, /needs to be hotter|cold and useless/i), 'the ore into the furnace', 15);
        if (heard(q, t0, /cold and useless/i)) throw new Error('ew: the furnace is not lit');
        if (!holds(q, OBJ.bar) && heard(q, t0, /needs to be hotter/i)) await airOn(q);
    }
    if (!holds(q, OBJ.bar)) throw new Error('ew: no Elemental metal from the furnace');
}

/** Bellows fixed, air blowing; then lava in the furnace. */
export async function bellowsAndFurnace(q: Quest): Promise<void> {
    await fixBellows(q);
    await airOn(q);
    await lightFurnace(q);
}

/** The metal on the workbench (hammer, book): the Elemental shield. */
export async function makeShield(q: Quest, done: () => Promise<boolean>): Promise<void> {
    if (!holds(q, OBJ.book)) throw new Error('ew: the workbench wants the Battered book');
    await useOn(q, OBJ.bar, LOC.workbench, WORKBENCH, () => !holds(q, OBJ.bar), 'the metal on the workbench', 15);
    for (let i = 0; i < 5 && !(await done()); i++) await q.sdk.waitForTicks(3);
}

// ── coal for prepare (lib/sources.ts 'coal')

/** Mine `count` coal at the Coal Trucks (Mining 30, any usable pickaxe held). */
export async function mineCoal(q: Quest, count: number): Promise<void> {
    if (q.count(/^coal$/i) >= count) return;
    await q.goTo(COAL_TRUCKS, 4);
    const t0 = tickNow(q.sdk);
    for (let misses = 0; q.count(/^coal$/i) < count && misses < 12 && tickNow(q.sdk) - t0 < 1500; ) {
        await q.sdk.scanNearbyLocs(12).catch(() => undefined);
        const rock = (q.sdk.getNearbyLocs() ?? []).filter((l) => COAL_ROCKS.has(l.id) && l.reachable !== false).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!rock) {
            misses++;
            await q.sdk.waitForTicks(5);
            continue;
        }
        const before = q.count(/^coal$/i);
        await q.bot.interactLoc(rock, /^mine$/i).catch(() => undefined);
        if (!(await untilTicks(q.sdk, (s) => q.count(/^coal$/i) > before || !s.nearbyLocs.some((l) => l.x === rock.x && l.z === rock.z && l.id === rock.id), 40))) misses++;
    }
    q.log(`ew: ${q.count(/^coal$/i)} coal at the Coal Trucks in ${tickNow(q.sdk) - t0}t`);
}
