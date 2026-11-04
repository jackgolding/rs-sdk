/**
 * Regicide — the route and mechanics (bots/quests/regicide.ts is the definition).
 *
 * Content facts (quest_regicide/scripts/*.rs2, area_ardougne_east/scripts/king_lathas.rs2, quest_upass/scripts/
 * quest_upass.rs2 open_iban_door, music/scripts/move.rs2):
 *   - The King's messenger: login starts a 400-1200 tick timer once Underground Pass is complete; he spawns beside you
 *     and talks (the summons, 1). King Lathas (2578,3293,L1): "...How may I serve the kingdom?" (2).
 *   - At >= 2 Iban's temple doors (2143,4647,L1), opened from the east, lead into the ruined temple's copy (m31_73,
 *     2013,4711,L1): Koftik (food once) and the Well of Voyage (4004, 2008,4711) -> the voyage temple (2343,9622);
 *     its exit (4007, 2312,9623) -> Tirannwn (2312,3216). The well back (4005, 2341,9622) returns to the temple copy,
 *     and its doors from the west back into Iban's cavern (x + 128).
 *   - Entering mapsquares 35_49 / 35_50 / 36_50 at stage 2 starts a 20-30 tick timer: Idris and two elves (3).
 *   - The Arandar gate (2384/2386,3334) opens from the south at any stage (north only after 12); the dense-wood
 *     cross-overs need stage >= 8 and Agility 56; pitfalls are jumped (op a side, an Agility roll; a fall is 15
 *     damage into the pits at m36_150, out by the hand holds).
 *   - Lord Iorwerth (2205,3252): "Your scouts said..." (4).
 */
import type { Quest } from './run-quest';
import { driveDialog, talkThrough } from './dialog';
import { tickNow, untilTicks } from './ticks';
import { advance, toPlatform } from './underground-pass';
import { closeUi } from '../movement';
import { survive } from './troll-stronghold';
import { wieldWeapon } from './myreque';
import { GROUPS, itemPattern, needMet, SOURCES, type Need } from './sources';
import { SAFE_BANKS } from '../safe-stops';
import { depositAllInventory } from '../quest-supplies';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

const LOC = {
    templeDoorR: 3333,
    templeDoorL: 3334,
    well1: 4004,
    well2: 4005,
    voyageEntrance: 4006,
    voyageExit: 4007,
    pitfallSide: 3925,
    handHolds: 3927,
} as const;

export const LATHAS = { x: 2578, z: 3293, level: 1 };
const CASTLE_STAIRS = { x: 2573, z: 3295 };
/** Iban's temple doors, approached from the east on the temple platform. */
const TEMPLE_DOOR = { x: 2143, z: 4647, level: 1 };
const TEMPLE_DOOR_STAND = { x: 2145, z: 4647, level: 1 };
const WELL1 = { x: 2008, z: 4711, level: 1 };
const VOYAGE_EXIT = { x: 2312, z: 9623 };
const TIRANNWN_ARRIVAL = { x: 2312, z: 3216 };
const IORWERTH = { x: 2205, z: 3252 };

const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

// ── regions
/** The ruined temple's copy with the Well of Voyage (m31_73, level 1). */
export const inTempleCopy = (p: Tile) => (p.level ?? 0) === 1 && inBox(p, 1984, 2047, 4672, 4735);
/** The voyage temple and Isafdar's spike pits under it (m36_150). */
export const inVoyageTemple = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2304, 2367, 9600, 9663);
/** Tirannwn south of the Arandar gate: Isafdar's woods, Iorwerth's and Tyras's camps. */
export const inTirannwn = (p: Tile) => (p.level ?? 0) === 0 && inBox(p, 2140, 2380, 3090, 3333);
export const inRegicideArea = (p: Tile) => inTempleCopy(p) || inVoyageTemple(p) || inTirannwn(p);

async function locById(q: Quest, id: number, at: Tile, within = 3) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? []).filter((l) => l.id === id).sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= within ? loc : undefined;
}

async function closeDialogs(q: Quest): Promise<void> {
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    if (q.sdk.getState()?.interface?.isOpen) await q.sdk.sendCloseModal().catch(() => undefined);
}

async function walk(q: Quest, t: Tile, tolerance = 1): Promise<boolean> {
    for (let i = 0; i < 3 && cheb(pos(q), t) > tolerance; i++) {
        await q.bot.walkTo(t.x, t.z, tolerance).catch(() => undefined);
        if (cheb(pos(q), t) > tolerance) await q.sdk.waitForTicks(2);
    }
    return cheb(pos(q), t) <= tolerance;
}

/** Op `op` on loc `id` near `at` until `done` (blind op when the scan misses it; the client routes). */
async function opLoc(q: Quest, id: number, at: Tile, op: number, done: () => boolean, label: string, opts: { tries?: number; ticks?: number; choices?: RegExp[] } = {}): Promise<void> {
    for (let attempt = 1; attempt <= (opts.tries ?? 4) && !done(); attempt++) {
        await closeDialogs(q);
        const loc = await locById(q, id, at);
        await q.sdk.sendInteractLoc(loc?.x ?? at.x, loc?.z ?? at.z, id, op);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, opts.ticks ?? 20);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, opts.choices ?? [], { done, ticks: 30 });
        await untilTicks(q.sdk, done, 6);
        if (!done()) q.log(`regicide: ${label}: attempt ${attempt} did not take at ${where(q)}`);
    }
    if (!done()) throw new Error(`regicide: ${label} failed at ${where(q)}`);
}

const FOOD = /^(shark|manta ray|monkfish|swordfish|lobster|bass|tuna|stew|bread)$/i;
export async function eatIfLow(q: Quest, below = 0.55): Promise<void> {
    const p = q.sdk.getState()?.player;
    if (!p || p.hp > (p.maxHp ?? 10) * below) return;
    const food = q.sdk.getInventory().find((i) => FOOD.test(i.name));
    if (food) await q.bot.eatFood(food).catch(() => undefined);
}

// ── out (run-quest's goTo and prologue)

const MAGIC_TAB = 6;
/** Teleports out of Tirannwn and the temples: Falador, Camelot, Lumbridge, Varrock (the runes the kit carries). */
async function teleportOut(q: Quest): Promise<boolean> {
    const magic = q.level('magic');
    const c = (re: RegExp) => q.count(re);
    const law = c(/^law rune$/i);
    const air = c(/^air rune$/i);
    const options = [
        { name: 'Falador', id: 1170, ok: magic >= 37 && law >= 1 && air >= 3 && c(/^water rune$/i) >= 1 },
        { name: 'Camelot', id: 1174, ok: magic >= 45 && law >= 1 && air >= 5 },
        { name: 'Varrock', id: 1164, ok: magic >= 25 && law >= 1 && air >= 3 && c(/^fire rune$/i) >= 1 },
        { name: 'Lumbridge', id: 1167, ok: magic >= 31 && law >= 1 && air >= 3 && c(/^earth rune$/i) >= 1 },
    ].filter((o) => o.ok);
    for (const spell of options) {
        for (let attempt = 1; attempt <= 3 && inRegicideArea(pos(q)); attempt++) {
            await q.sdk.sendSetTab(MAGIC_TAB).catch(() => undefined);
            await q.sdk.waitForTicks(1);
            await q.sdk.sendClickComponent(spell.id);
            await untilTicks(q.sdk, () => !inRegicideArea(pos(q)), 8);
        }
        if (!inRegicideArea(pos(q))) {
            q.log(`regicide: ${spell.name} Teleport out to ${where(q)}`);
            return true;
        }
    }
    return false;
}

/** Out of Isafdar's spike pits by the hand holds. */
async function outOfPit(q: Quest): Promise<void> {
    if (!inVoyageTemple(pos(q)) || pos(q).z < 9640) return;
    await q.sdk.scanNearbyLocs(8).catch(() => undefined);
    const holds = (q.sdk.getNearbyLocs() ?? []).filter((l) => l.id === LOC.handHolds).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
    if (!holds) return;
    await opLoc(q, LOC.handHolds, holds, 1, () => !inVoyageTemple(pos(q)), 'climb the hand holds out of the pit', { ticks: 10 });
}

/**
 * run-quest's goTo/prologue: out of Tirannwn and the temples. A pit first (hand holds), then a teleport; with no
 * runes, the Arandar gate from the south (it opens from that side at any stage) when the woods let us reach it.
 */
export async function leaveRegicide(q: Quest): Promise<void> {
    await closeDialogs(q);
    await outOfPit(q);
    if (!inRegicideArea(pos(q))) return;
    if (await teleportOut(q)) return;
    if (inTirannwn(pos(q))) {
        await walk(q, { x: 2385, z: 3331 }, 2);
        await opLoc(q, 3945, { x: 2384, z: 3334 }, 1, () => pos(q).z > 3334, 'the Arandar gate north', { ticks: 15 }).catch((e: Error) => q.log(e.message));
        if (!inRegicideArea(pos(q))) return;
    }
    throw new Error(`regicide: stranded at ${where(q)} — no teleport runes and no walk out`);
}

// ── the steps

/** Wait at the hub for the King's messenger (login timer 400-1200 ticks) and take his summons (1). */
export async function messenger(q: Quest, received: () => Promise<boolean>): Promise<void> {
    const t0 = tickNow(q.sdk);
    // The summons' item name is not the debugname: read the journal after each dialog and every ~150 ticks.
    let lastRead = t0;
    let dialogs = 0;
    while (tickNow(q.sdk) - t0 < 1600 && !(await quickReceived())) {
        if (q.sdk.getDialog()?.isOpen) {
            const seen = await driveDialog(q.sdk, [], { ticks: 30, log: q.log });
            q.log(`regicide: messenger: ${seen.slice(-120)}`);
            dialogs++;
            continue;
        }
        const npc = q.sdk.findNearbyNpc(/^kings messenger$/i);
        if (npc && npc.distance <= 6) {
            await q.bot.talkTo(npc).catch(() => undefined);
            await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 8);
            continue;
        }
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || !!q.sdk.findNearbyNpc(/^kings messenger$/i), 25);
    }
    await closeDialogs(q);
    q.log(`regicide: the summons after ${tickNow(q.sdk) - t0}t`);
    async function quickReceived() {
        if (dialogs > 0 || tickNow(q.sdk) - lastRead > 150) {
            lastRead = tickNow(q.sdk);
            dialogs = 0;
            return received();
        }
        return false;
    }
}

/** King Lathas upstairs in his castle (2). */
export async function lathas(q: Quest, spoken: () => Promise<boolean>): Promise<void> {
    for (let attempt = 1; attempt <= 3 && !(await spoken()); attempt++) {
        if (pos(q).level !== 1) {
            await q.goTo(CASTLE_STAIRS, 2);
            await q.climbTo(1, LATHAS);
        }
        await walk(q, LATHAS, 3);
        const seen = await talkThrough(q.sdk, q.bot, /^king lathas$/i, [], q.log);
        q.log(`regicide: Lathas: ${seen.slice(-120)}`);
    }
}

/** Through the Underground Pass to Iban's temple doors, into the ruined temple, down the Well of Voyage to Tirannwn. */
export async function toTirannwn(q: Quest): Promise<void> {
    if (inTirannwn(pos(q))) return;
    if (!inTempleCopy(pos(q)) && !inVoyageTemple(pos(q))) {
        await advance(q, 'CAVERN');
        await toPlatform(q, 'TEMPLE');
        await walk(q, TEMPLE_DOOR_STAND, 1);
        await opLoc(q, LOC.templeDoorL, TEMPLE_DOOR, 1, () => inTempleCopy(pos(q)), "Iban's temple doors", { ticks: 15 });
    }
    if (inTempleCopy(pos(q))) {
        await walk(q, { x: WELL1.x + 2, z: WELL1.z }, 1);
        await opLoc(q, LOC.well1, WELL1, 1, () => inVoyageTemple(pos(q)), 'the Well of Voyage', { ticks: 15 });
    }
    if (inVoyageTemple(pos(q))) {
        await outOfPit(q);
        if (inVoyageTemple(pos(q))) {
            await walk(q, { x: VOYAGE_EXIT.x + 1, z: VOYAGE_EXIT.z }, 1);
            await opLoc(q, LOC.voyageExit, VOYAGE_EXIT, 1, () => inTirannwn(pos(q)), 'out of the voyage temple', { ticks: 15 });
        }
    }
    if (!inTirannwn(pos(q))) throw new Error(`regicide: not in Tirannwn (at ${where(q)})`);
    q.log(`regicide: in Tirannwn at ${where(q)}`);
}

/** Idris and the elves: entering the woods' mapsquares at stage 2 starts their timer (3). */
export async function scouts(q: Quest, met: () => Promise<boolean>): Promise<void> {
    await toTirannwn(q);
    for (let attempt = 1; attempt <= 4 && !(await met()); attempt++) {
        const t0 = tickNow(q.sdk);
        while (tickNow(q.sdk) - t0 < 120) {
            await eatIfLow(q);
            if (q.sdk.getDialog()?.isOpen) {
                const seen = await driveDialog(q.sdk, [], { ticks: 60, log: q.log });
                q.log(`regicide: scouts: ${seen.slice(-160)}`);
                if (await met()) return;
                continue;
            }
            const idris = q.sdk.findNearbyNpc(/^idris$/i);
            if (idris && idris.distance <= 3) {
                await q.sdk.waitForTicks(2);
                continue;
            }
            await q.sdk.waitForTicks(3);
        }
        // No scouts: back into the voyage temple and out again (the mapsquare entry restarts their timer).
        q.log(`regicide: no scouts in ${tickNow(q.sdk) - t0}t at ${where(q)}: re-entering the woods`);
        await walk(q, { x: TIRANNWN_ARRIVAL.x + 1, z: TIRANNWN_ARRIVAL.z }, 1);
        await opLoc(q, LOC.voyageEntrance, { x: 2313, z: 3215 }, 1, () => inVoyageTemple(pos(q)), 'into the voyage temple', { ticks: 15 }).catch((e: Error) => q.log(e.message));
        if (inVoyageTemple(pos(q))) await opLoc(q, LOC.voyageExit, VOYAGE_EXIT, 1, () => inTirannwn(pos(q)), 'out of the voyage temple', { ticks: 15 });
    }
}

/**
 * Jump a pitfall: stand on `stand` (the tile beside the side loc), op the side loc; an Agility roll lands 3 tiles on
 * (`landed`), a miss drops into the pits (15 damage) and the hand holds put us back near it.
 */
async function jumpPitfall(q: Quest, side: Tile, stand: Tile, landed: () => boolean, label: string): Promise<void> {
    for (let attempt = 1; attempt <= 5 && !landed(); attempt++) {
        await eatIfLow(q);
        await outOfPit(q);
        await walk(q, stand, 0);
        await q.sdk.sendInteractLoc(side.x, side.z, LOC.pitfallSide, 1);
        await untilTicks(q.sdk, () => landed() || inVoyageTemple(pos(q)), 15);
        await q.sdk.waitForTicks(2);
        if (inVoyageTemple(pos(q))) q.log(`regicide: ${label}: fell into the pits`);
    }
    await outOfPit(q);
    if (!landed()) throw new Error(`regicide: could not jump ${label} (at ${where(q)})`);
}

/**
 * Pass a woodspring trap (op "Pass", an Agility roll). It is 3 tiles wide (x to x+2) and standing on its two east
 * tiles springs it (8 damage, thrown east): stand just off its ends, never on it.
 */
async function passWoodspring(q: Quest, trap: Tile, stand: Tile, passed: () => boolean, label: string): Promise<void> {
    for (let attempt = 1; attempt <= 6 && !passed(); attempt++) {
        await eatIfLow(q);
        await walk(q, stand, 0);
        await q.sdk.sendInteractLoc(trap.x, trap.z, 3922, 1);
        await untilTicks(q.sdk, passed, 10);
        await q.sdk.waitForTicks(2);
    }
    if (!passed()) throw new Error(`regicide: could not pass ${label} (at ${where(q)})`);
}

/**
 * Isafdar's pockets, joined by traps and (from stage 8, Agility 56) the dense wood's cross-overs. Client collision,
 * 2026-11-04; every join was checked offline with the trap tiles forced open:
 *   WELL       the well's exit, north of the first pitfall (2266-2268,3202-3204)
 *   SOUTH      south of it, east of the woodspring (2235-2237,3181)
 *   TRACKER    west of the woodspring: the old camp, the tracker, the footprints
 *   RIVER      north of the second pitfall (2208-2210,3202-3204), east of the log (2197-2201,3237)
 *   CAMP       west of the log: Lord Iorwerth's camp
 *   WOODS      west of the old camp's cross-over (2232,3148); the guard's tile (2231,3149)
 *   NORTHWOODS north of the tripwire (2215,3154)
 *   APPROACH   north of the three cross-overs at x 2216 (z 3161-3169): Tyras's camp's approach and the catapult
 *   TYRAS      south of the three cross-overs at x 2187 (z 3163-3169): Tyras's camp
 */
type Pocket = 'WELL' | 'SOUTH' | 'TRACKER' | 'RIVER' | 'CAMP' | 'WOODS' | 'NORTHWOODS' | 'APPROACH' | 'TYRAS' | 'LIME';
const POCKETS: Array<{ name: Pocket; at: Tile }> = [
    { name: 'WELL', at: { x: 2269, z: 3205 } },
    { name: 'SOUTH', at: { x: 2266, z: 3199 } },
    { name: 'TRACKER', at: { x: 2233, z: 3181 } },
    { name: 'RIVER', at: { x: 2209, z: 3205 } },
    { name: 'CAMP', at: { x: 2196, z: 3237 } },
    { name: 'WOODS', at: { x: 2231, z: 3149 } },
    { name: 'NORTHWOODS', at: { x: 2215, z: 3155 } },
    { name: 'APPROACH', at: { x: 2217, z: 3169 } },
    { name: 'TYRAS', at: { x: 2188, z: 3162 } },
    /** The limestone rocks (2317-2325,3265-3272), east over the pitfall at 2276-2278,3261-3263 from SOUTH's north end. */
    { name: 'LIME', at: { x: 2279, z: 3262 } },
];
const pocketAt = (name: Pocket) => POCKETS.find((p) => p.name === name)!.at;

function reachable(q: Quest, t: Tile): boolean {
    const p = pos(q);
    if (p.level !== 0) return false;
    if (p.x === t.x && p.z === t.z) return true;
    const path = q.sdk.findPath(t.x, t.z, 2000);
    const last = path.waypoints.at(-1);
    return path.reachedDestination === true || (!!last && last.x === t.x && last.z === t.z);
}
function pocket(q: Quest): Pocket | null {
    if (!inTirannwn(pos(q))) return null;
    for (const p of POCKETS) if (reachable(q, p.at)) return p.name;
    // The one-tile gaps between the old camp's cross-overs: oldCampWest goes on from either.
    if (pos(q).z === 3149 && (pos(q).x === 2234 || pos(q).x === 2237)) return 'TRACKER';
    return null;
}

/**
 * Cross a dense-wood obstacle (op "Enter"): stand on `stand` (within one tile of the content's start square), op the
 * loc, and the exact-move lands on the far side (`landed`). Stage >= 8 and Agility 56 (quest_regicide.rs2).
 */
async function crossOver(q: Quest, loc: { id: number; x: number; z: number }, stand: Tile, landed: Tile, label: string): Promise<void> {
    const there = () => pos(q).x === landed.x && pos(q).z === landed.z;
    for (let attempt = 1; attempt <= 4 && !there(); attempt++) {
        await eatIfLow(q);
        await walk(q, stand, 0);
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, 1);
        await untilTicks(q.sdk, there, 12);
        await q.sdk.waitForTicks(2);
        if (!there() && q.sdk.getDialog()?.isOpen) break; // the camp guard's challenge: fought by the caller
    }
    if (!there()) throw new Error(`regicide: could not cross ${label} (at ${where(q)})`);
}

/**
 * Step over a tripwire (an Agility roll; a snag is damage, the step still happens). The step moves 2 tiles past the
 * wire (a teleport, the exact-move, another teleport: (2215,3153) -> (2215,3156)), so `landed` is a predicate.
 */
async function stepOver(q: Quest, wire: Tile, stand: Tile, landed: () => boolean, label: string): Promise<void> {
    const there = landed;
    for (let attempt = 1; attempt <= 4 && !there(); attempt++) {
        await eatIfLow(q);
        await walk(q, stand, 0);
        await q.sdk.sendInteractLoc(wire.x, wire.z, 3921, 1);
        await untilTicks(q.sdk, there, 12);
        await q.sdk.waitForTicks(2);
    }
    if (!there()) throw new Error(`regicide: could not step over ${label} (at ${where(q)})`);
}

const X1 = 3937;
const X2 = 3938;
const X3 = 3939;
const X1_CAMP = 3999;
const X2_CAMP = 3998;

/**
 * West over the old camp's three cross-overs (x 2238, 2235, 2232 at z 3148; 2 wide, a one-tile gap between). Landing on
 * (2231,3149) at stage 8 calls the old camp's guard (quest_regicide.rs2 spawn_tyras_guard).
 */
async function oldCampWest(q: Quest): Promise<void> {
    if (pos(q).x > 2237 || pos(q).z !== 3149) await crossOver(q, { id: X3, x: 2238, z: 3148 }, { x: 2240, z: 3149 }, { x: 2237, z: 3149 }, 'the old camp cross-over (2238) west');
    if (pos(q).x > 2234) await crossOver(q, { id: X2, x: 2235, z: 3148 }, { x: 2237, z: 3149 }, { x: 2234, z: 3149 }, 'the old camp cross-over (2235) west');
    await crossOver(q, { id: X1, x: 2232, z: 3148 }, { x: 2234, z: 3149 }, { x: 2231, z: 3149 }, 'the old camp cross-over (2232) west');
}

/** The joins: each is a function crossing from `a` to `b` (the reverse is listed separately). */
const EDGES: Array<{ a: Pocket; b: Pocket; go: (q: Quest, there: () => boolean) => Promise<void> }> = [
    { a: 'SOUTH', b: 'LIME', go: (q, t) => jumpPitfall(q, { x: 2276, z: 3262 }, { x: 2275, z: 3262 }, t, 'the pitfall east to the limestone') },
    { a: 'LIME', b: 'SOUTH', go: (q, t) => jumpPitfall(q, { x: 2278, z: 3262 }, { x: 2279, z: 3262 }, t, 'the pitfall west from the limestone') },
    { a: 'WELL', b: 'SOUTH', go: (q, t) => jumpPitfall(q, { x: 2267, z: 3204 }, { x: 2267, z: 3205 }, t, 'the pitfall south of the well') },
    { a: 'SOUTH', b: 'WELL', go: (q, t) => jumpPitfall(q, { x: 2267, z: 3202 }, { x: 2267, z: 3201 }, t, 'the pitfall north to the well') },
    { a: 'SOUTH', b: 'TRACKER', go: (q, t) => passWoodspring(q, { x: 2235, z: 3181 }, { x: 2238, z: 3181 }, t, 'the woodspring west') },
    { a: 'TRACKER', b: 'SOUTH', go: (q, t) => passWoodspring(q, { x: 2235, z: 3181 }, { x: 2234, z: 3181 }, t, 'the woodspring east') },
    { a: 'TRACKER', b: 'RIVER', go: (q, t) => jumpPitfall(q, { x: 2209, z: 3202 }, { x: 2209, z: 3201 }, t, 'the pitfall north to the river') },
    { a: 'RIVER', b: 'TRACKER', go: (q, t) => jumpPitfall(q, { x: 2209, z: 3204 }, { x: 2209, z: 3205 }, t, 'the pitfall south from the river') },
    {
        a: 'RIVER',
        b: 'CAMP',
        go: async (q, t) => {
            await walk(q, { x: 2202, z: 3237 }, 0);
            await opLoc(q, 3931, { x: 2201, z: 3237 }, 1, t, 'the log west over the river', { ticks: 15 });
        },
    },
    {
        a: 'CAMP',
        b: 'RIVER',
        go: async (q, t) => {
            await walk(q, { x: 2196, z: 3237 }, 0);
            await opLoc(q, 3931, { x: 2197, z: 3237 }, 1, t, 'the log east over the river', { ticks: 15 });
        },
    },
    { a: 'TRACKER', b: 'WOODS', go: (q) => oldCampWest(q) },
    {
        a: 'WOODS',
        b: 'TRACKER',
        go: async (q) => {
            if (pos(q).x < 2234) await crossOver(q, { id: X1, x: 2232, z: 3148 }, { x: 2231, z: 3149 }, { x: 2234, z: 3149 }, 'the old camp cross-over (2232) east');
            if (pos(q).x < 2237) await crossOver(q, { id: X2, x: 2235, z: 3148 }, { x: 2234, z: 3149 }, { x: 2237, z: 3149 }, 'the old camp cross-over (2235) east');
            await crossOver(q, { id: X3, x: 2238, z: 3148 }, { x: 2237, z: 3149 }, { x: 2240, z: 3149 }, 'the old camp cross-over (2238) east');
        },
    },
    { a: 'WOODS', b: 'NORTHWOODS', go: (q) => stepOver(q, { x: 2215, z: 3154 }, { x: 2215, z: 3153 }, () => pos(q).z >= 3155, 'the tripwire north') },
    { a: 'NORTHWOODS', b: 'WOODS', go: (q) => stepOver(q, { x: 2215, z: 3154 }, { x: 2215, z: 3155 }, () => pos(q).z <= 3153, 'the tripwire south') },
    {
        a: 'NORTHWOODS',
        b: 'APPROACH',
        go: async (q) => {
            if (pos(q).z < 3163) await crossOver(q, { id: X3, x: 2216, z: 3161 }, { x: 2217, z: 3160 }, { x: 2217, z: 3163 }, 'the cross-over (2216,3161) north');
            if (pos(q).z < 3166) await crossOver(q, { id: X2, x: 2216, z: 3164 }, { x: 2217, z: 3163 }, { x: 2217, z: 3166 }, 'the cross-over (2216,3164) north');
            await crossOver(q, { id: X3, x: 2216, z: 3167 }, { x: 2217, z: 3166 }, { x: 2217, z: 3169 }, 'the cross-over (2216,3167) north');
        },
    },
    {
        a: 'APPROACH',
        b: 'NORTHWOODS',
        go: async (q) => {
            if (pos(q).z > 3166) await crossOver(q, { id: X3, x: 2216, z: 3167 }, { x: 2217, z: 3169 }, { x: 2217, z: 3166 }, 'the cross-over (2216,3167) south');
            if (pos(q).z > 3163) await crossOver(q, { id: X2, x: 2216, z: 3164 }, { x: 2217, z: 3166 }, { x: 2217, z: 3163 }, 'the cross-over (2216,3164) south');
            await crossOver(q, { id: X3, x: 2216, z: 3161 }, { x: 2217, z: 3163 }, { x: 2217, z: 3160 }, 'the cross-over (2216,3161) south');
        },
    },
    {
        a: 'APPROACH',
        b: 'TYRAS',
        go: async (q) => {
            if (pos(q).z > 3168) await crossOver(q, { id: X2_CAMP, x: 2187, z: 3169 }, { x: 2188, z: 3171 }, { x: 2188, z: 3168 }, "the cross-over into Tyras's camp (2187,3169)");
            if (pos(q).z > 3165) await crossOver(q, { id: X3, x: 2187, z: 3166 }, { x: 2188, z: 3168 }, { x: 2188, z: 3165 }, 'the cross-over (2187,3166) south');
            await crossOver(q, { id: X1_CAMP, x: 2187, z: 3163 }, { x: 2188, z: 3165 }, { x: 2188, z: 3162 }, 'the cross-over (2187,3163) south');
        },
    },
    {
        a: 'TYRAS',
        b: 'APPROACH',
        go: async (q) => {
            if (pos(q).z < 3165) await crossOver(q, { id: X1_CAMP, x: 2187, z: 3163 }, { x: 2188, z: 3162 }, { x: 2188, z: 3165 }, 'the cross-over (2187,3163) north');
            if (pos(q).z < 3168) await crossOver(q, { id: X3, x: 2187, z: 3166 }, { x: 2188, z: 3165 }, { x: 2188, z: 3168 }, 'the cross-over (2187,3166) north');
            await crossOver(q, { id: X2_CAMP, x: 2187, z: 3169 }, { x: 2188, z: 3168 }, { x: 2188, z: 3171 }, 'the cross-over out of the camp (2187,3169)');
        },
    },
];

/** The pocket route from `from` to `goal` (breadth first over EDGES). */
function route(from: Pocket, goal: Pocket): Pocket[] | null {
    const prev = new Map<Pocket, Pocket | null>([[from, null]]);
    const queue: Pocket[] = [from];
    while (queue.length) {
        const p = queue.shift()!;
        if (p === goal) break;
        for (const e of EDGES.filter((x) => x.a === p)) {
            if (prev.has(e.b)) continue;
            prev.set(e.b, p);
            queue.push(e.b);
        }
    }
    if (!prev.has(goal)) return null;
    const path: Pocket[] = [];
    for (let p: Pocket | null = goal; p; p = prev.get(p) ?? null) path.unshift(p);
    return path;
}

/** Across Isafdar's pockets to `goal` (from Tirannwn, or through the pass first). */
export async function toPocket(q: Quest, goal: Pocket): Promise<void> {
    await outOfPit(q);
    await toTirannwn(q);
    for (let legs = 0; legs < 16; legs++) {
        await eatIfLow(q);
        await outOfPit(q);
        const here = pocket(q);
        if (!here) throw new Error(`regicide: lost in Isafdar at ${where(q)}`);
        if (here === goal) return;
        const path = route(here, goal);
        if (!path) throw new Error(`regicide: no way from ${here} to ${goal}`);
        const next = path[1]!;
        const edge = EDGES.find((e) => e.a === here && e.b === next)!;
        q.log(`regicide: ${here} -> ${next} (toward ${goal})`);
        await edge.go(q, () => reachable(q, pocketAt(next)));
    }
    throw new Error(`regicide: too many hops toward ${goal} (at ${where(q)})`);
}

export async function toIorwerth(q: Quest): Promise<void> {
    await toPocket(q, 'CAMP');
    if (!(await walk(q, IORWERTH, 4))) throw new Error(`regicide: could not walk to Lord Iorwerth (at ${where(q)})`);
}

async function talkIorwerth(q: Quest): Promise<string> {
    await toIorwerth(q);
    const seen = await talkThrough(q.sdk, q.bot, /^lord iorwerth$/i, [], q.log);
    await closeUi(q.bot, q.sdk);
    q.log(`regicide: Iorwerth: ${seen.slice(-160)}`);
    return seen;
}

/** West through Isafdar to Lord Iorwerth's camp (4). */
export async function iorwerth(q: Quest, spoken: () => Promise<boolean>): Promise<void> {
    for (let attempt = 1; attempt <= 3 && !(await spoken()); attempt++) await talkIorwerth(q);
}

const TRACKER = { x: 2257, z: 3149 };
const FOOTPRINTS = { x: 2241, z: 3150 };
const hasPendant = (q: Quest) => q.count(/^crystal pendant$/i) > 0 || q.sdk.getEquipment().some((e) => /^crystal pendant$/i.test(e.name));

async function talkTracker(q: Quest): Promise<string> {
    await toPocket(q, 'TRACKER');
    if (!(await walk(q, TRACKER, 4))) throw new Error(`regicide: could not walk to the tracker (at ${where(q)})`);
    const seen = await talkThrough(q.sdk, q.bot, /^elf tracker$/i, [], q.log);
    await closeUi(q.bot, q.sdk);
    q.log(`regicide: tracker: ${seen.slice(-160)}`);
    return seen;
}

/** The tracker (5: no proof), Iorwerth's crystal pendant, the tracker again with it (6). */
export async function pendant(q: Quest, shown: () => Promise<boolean>): Promise<void> {
    for (let attempt = 1; attempt <= 3 && !(await shown()); attempt++) {
        if (!hasPendant(q)) {
            await talkTracker(q);
            if (await shown()) return;
            await talkIorwerth(q);
        }
        await talkTracker(q);
    }
}

/** The footprints on the old camp's west side (7). */
export async function footprints(q: Quest, found: () => Promise<boolean>): Promise<void> {
    await toPocket(q, 'TRACKER');
    for (let attempt = 1; attempt <= 3 && !(await found()); attempt++) {
        await walk(q, { x: FOOTPRINTS.x + 1, z: FOOTPRINTS.z }, 1);
        await q.sdk.sendInteractLoc(FOOTPRINTS.x, FOOTPRINTS.z, 3941, 1);
        await q.sdk.waitForTicks(6);
    }
}

/** The tracker on what to look for (8). */
export async function trackerTracks(q: Quest, told: () => Promise<boolean>): Promise<void> {
    for (let attempt = 1; attempt <= 3 && !(await told()); attempt++) await talkTracker(q);
}

/** Fight the Tyras guard on us (or in view) until it dies. */
async function fightGuard(q: Quest, done: () => Promise<boolean>): Promise<boolean> {
    const stop = survive(q, 0.5);
    try {
        const t0 = tickNow(q.sdk);
        let seen = false;
        while (tickNow(q.sdk) - t0 < 400) {
            if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
            const g = q.sdk.findNearbyNpc(/^tyras guard$/i);
            if (!g) {
                if (seen && (await done())) return true;
                if (!seen && tickNow(q.sdk) - t0 > 20) return false;
                await q.sdk.waitForTicks(3);
                continue;
            }
            seen = true;
            if (!(q.sdk.getState()?.player?.combat?.inCombat ?? false)) await q.bot.attack(g).catch(() => undefined);
            await q.sdk.waitForTicks(3);
        }
        return done();
    } finally {
        stop();
    }
}

/** West over the old camp's cross-over at stage 8: a Tyras guard springs out (9) and is killed. */
export async function guard(q: Quest, defeated: () => Promise<boolean>): Promise<void> {
    await wieldWeapon(q);
    for (let attempt = 1; attempt <= 3 && !(await defeated()); attempt++) {
        if (pocket(q) !== 'WOODS') await toPocket(q, 'TRACKER');
        if (pocket(q) === 'TRACKER') await oldCampWest(q);
        if (await fightGuard(q, defeated)) return;
        // The old camp's guard comes once (regicide_seen_guard): the camp's own cross-over calls another before 9.
        q.log('regicide: no guard at the old camp; trying the camp cross-over');
        await toPocket(q, 'APPROACH');
        await crossOver(q, { id: X2_CAMP, x: 2187, z: 3169 }, { x: 2188, z: 3171 }, { x: 2188, z: 3168 }, "the cross-over into Tyras's camp").catch((e: Error) => q.log(e.message));
        if (await fightGuard(q, defeated)) return;
    }
}

/** Into Tyras's camp past its cross-overs (10). */
export async function intoCamp(q: Quest, entered: () => Promise<boolean>): Promise<void> {
    await wieldWeapon(q);
    for (let attempt = 1; attempt <= 3 && !(await entered()); attempt++) await toPocket(q, 'TYRAS');
}

/** Iorwerth again: the Big Book o' Bangs (11). */
export async function book(q: Quest, given: () => Promise<boolean>): Promise<void> {
    for (let attempt = 1; attempt <= 3 && !(await given()); attempt++) await talkIorwerth(q);
}

// ── the bomb (stage 11 -> 12)

/** Bomb-chain items by obj id (names repeat: two "Barrel bomb", two "Naphtha mix"). */
export const BOMB = {
    sulphur: 3209,
    limestone: 3211,
    quicklime: 3213,
    quicklimeDust: 3214,
    sulphurDust: 3215,
    barrel: 3216,
    lid: 3218,
    fused: 3219,
    tar: 3220,
    naphtha: 3221,
    naphthaSulphur: 3222,
    naphthaQuicklime: 3223,
    cloth: 3224,
    rawRabbit: 3226,
    cookedRabbit: 3228,
    message: 3207,
} as const;
const ids = (q: Quest, ...want: number[]) => q.sdk.getInventory().filter((i) => want.includes(i.id)).reduce((n, i) => n + (i.count ?? 1), 0);
const bankIds = (q: Quest, ...want: number[]) => (q.sdk.isBankOpen() ? q.sdk.getBankItems().filter((b) => want.includes(b.id)).reduce((n, b) => n + b.count, 0) : 0);
/** Held, or banked while the bank is open (the kit is evaluated at the hub). */
const own = (q: Quest, ...want: number[]) => ids(q, ...want) + bankIds(q, ...want);
const slotOf = (q: Quest, id: number) => q.sdk.getInventory().find((i) => i.id === id);

/** What the bomb still lacks, by line. Each line is done once any later form of it exists. */
export function bombState(q: Quest) {
    const B = BOMB;
    const fused = own(q, B.fused) > 0;
    const lid = fused || own(q, B.lid) > 0;
    return {
        fused,
        /** A barrel of naphtha (or anything made from one). */
        naphtha: lid || own(q, B.naphtha, B.naphthaSulphur, B.naphthaQuicklime) > 0,
        /** Coal tar for the still: two barrels, so a failed still run has a second go. */
        tar: own(q, B.tar),
        sulphur: lid || own(q, B.naphthaSulphur) > 0 || own(q, B.sulphurDust, B.sulphur) > 0,
        quicklime: lid || own(q, B.naphthaQuicklime) > 0 || own(q, B.quicklimeDust, B.quicklime, B.limestone) > 0,
        cloth: fused || own(q, B.cloth) > 0,
        rabbit: own(q, B.cookedRabbit, B.rawRabbit) > 0,
        cooked: own(q, B.cookedRabbit) > 0,
    };
}
/** True when Tirannwn still holds something the bomb needs (barrels and tar, sulphur, limestone, the cloth, a rabbit). */
export function needsTirannwn(q: Quest): boolean {
    const s = bombState(q);
    return (!s.naphtha && s.tar === 0) || !s.sulphur || !s.quicklime || !s.cloth || !s.rabbit;
}
/** True when the outside work is left: the still, the furnace, the mix, the fuse or the rabbit's cooking. */
export function needsOutside(q: Quest): boolean {
    const s = bombState(q);
    return !s.fused || !s.cooked;
}

const CAMP_BARRELS = [
    { x: 2205, z: 3257 },
    { x: 2208, z: 3259 },
];
const LOOM = { x: 2198, z: 3249 };
const TAR_PIT = { x: 2263, z: 3127 };
const SULPHUR_ROCKS = { x: 2258, z: 3128 };
const RABBITS = { x: 2241, z: 3163 };
const LIMESTONE = { x: 2322, z: 3267 };

async function pickUp(q: Quest, id: number, near: Tile, want: number, label: string, waitTicks = 200): Promise<void> {
    const t0 = tickNow(q.sdk);
    while (ids(q, id) < want && tickNow(q.sdk) - t0 < waitTicks) {
        await q.sdk.scanGroundItems(12).catch(() => undefined);
        const g = (q.sdk.getState()?.groundItems ?? []).filter((i) => i.id === id).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!g) {
            await walk(q, near, 2);
            await q.sdk.waitForTicks(5);
            continue;
        }
        const before = ids(q, id);
        await q.bot.pickupItem(g).catch(() => undefined);
        await untilTicks(q.sdk, () => ids(q, id) > before, 10);
    }
    if (ids(q, id) < want) throw new Error(`regicide: ${label}: ${ids(q, id)}/${want} after ${tickNow(q.sdk) - t0}t`);
}

/** Use inventory item `id` on loc `locId` near `at` until `done`. */
async function useOnLoc(q: Quest, id: number, locId: number, at: Tile, done: () => boolean, label: string, ticks = 12): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        await closeDialogs(q);
        const item = slotOf(q, id);
        if (!item) throw new Error(`regicide: ${label}: item ${id} not held`);
        const loc = await locById(q, locId, at, 4);
        await q.sdk.sendUseItemOnLoc(item.slot, loc?.x ?? at.x, loc?.z ?? at.z, locId);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 15 });
        await untilTicks(q.sdk, done, 4);
    }
    if (!done()) throw new Error(`regicide: ${label} failed at ${where(q)}`);
}

/** Use item `a` on item `b` (by id) until `done`. */
async function useOnItem(q: Quest, a: number, b: number, done: () => boolean, label: string): Promise<void> {
    for (let attempt = 1; attempt <= 3 && !done(); attempt++) {
        await closeDialogs(q);
        const x = slotOf(q, a);
        const y = slotOf(q, b);
        if (!x || !y) throw new Error(`regicide: ${label}: ${!x ? a : b} not held`);
        await q.sdk.sendUseItemOnItem(x.slot, y.slot);
        await untilTicks(q.sdk, done, 6);
    }
    if (!done()) throw new Error(`regicide: ${label} failed`);
}

/** Tirannwn's part: barrels (Iorwerth's camp) and the cloth (his loom), coal tar and sulphur by the old camp, rabbits, limestone. */
export async function gatherTirannwn(q: Quest): Promise<void> {
    const B = BOMB;
    let s = bombState(q);
    // Two barrels of tar unless the naphtha is made; a barrel already held counts.
    const barrelsWanted = s.naphtha ? 0 : Math.max(0, 2 - s.tar);
    if (barrelsWanted > ids(q, B.barrel) || !s.cloth) {
        await toPocket(q, 'CAMP');
        if (barrelsWanted > ids(q, B.barrel)) await pickUp(q, B.barrel, CAMP_BARRELS[0]!, barrelsWanted, 'barrels in Iorwerth\'s camp', 300);
        if (!s.cloth) {
            if (q.count(/^ball of wool$/i) < 4) throw new Error(`regicide: the loom wants 4 balls of wool (held ${q.count(/^ball of wool$/i)})`);
            await walk(q, { x: LOOM.x - 1, z: LOOM.z + 1 }, 1);
            const wool = q.sdk.getInventory().find((i) => /^ball of wool$/i.test(i.name))!;
            await useOnLoc(q, wool.id, 787, LOOM, () => ids(q, B.cloth) > 0, 'weave the cloth on the loom');
        }
    }
    s = bombState(q);
    if (ids(q, B.barrel) > 0 || !s.sulphur || !s.rabbit) {
        await toPocket(q, 'TRACKER');
        while (ids(q, B.barrel) > 0) {
            const before = ids(q, B.tar);
            await walk(q, { x: TAR_PIT.x, z: TAR_PIT.z + 2 }, 1);
            await useOnLoc(q, B.barrel, 3975, TAR_PIT, () => ids(q, B.tar) > before, 'fill a barrel with coal tar');
        }
        if (!bombState(q).sulphur) {
            await walk(q, { x: SULPHUR_ROCKS.x, z: SULPHUR_ROCKS.z + 1 }, 1);
            await q.sdk.scanNearbyLocs(8).catch(() => undefined);
            const rock = (q.sdk.getNearbyLocs() ?? []).filter((l) => [3962, 3963, 3964].includes(l.id)).sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (!rock) throw new Error(`regicide: no sulphur formation near ${where(q)}`);
            await opLoc(q, rock.id, rock, 1, () => ids(q, B.sulphur) > 0, 'break off sulphur');
        }
        if (ids(q, B.sulphur) > 0 && q.count(/^pestle and mortar$/i) > 0) {
            const pestle = q.sdk.getInventory().find((i) => /^pestle and mortar$/i.test(i.name))!;
            await useOnItem(q, pestle.id, B.sulphur, () => ids(q, B.sulphurDust) > 0, 'grind the sulphur');
        }
        if (!bombState(q).rabbit) await huntRabbit(q);
    }
    if (!bombState(q).quicklime) {
        await toPocket(q, 'LIME');
        const t0 = tickNow(q.sdk);
        while (ids(q, B.limestone) < 1 && tickNow(q.sdk) - t0 < 300) {
            await walk(q, { x: LIMESTONE.x - 1, z: LIMESTONE.z }, 3);
            await q.sdk.scanNearbyLocs(8).catch(() => undefined);
            const rock = (q.sdk.getNearbyLocs() ?? [])
                .filter((l) => [4027, 4028, 4029].includes(l.id) && l.options?.some((o) => /^mine$/i.test(o)))
                .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
            if (!rock) {
                await q.sdk.waitForTicks(5);
                continue;
            }
            await q.bot.interactLoc(rock, /^mine$/i).catch(() => undefined);
            await untilTicks(q.sdk, () => ids(q, B.limestone) > 0, 25);
        }
        if (ids(q, B.limestone) < 1) throw new Error('regicide: no limestone mined');
    }
    q.log(`regicide: Tirannwn's bomb parts in hand: ${JSON.stringify(bombState(q))}`);
}

/** Two rabbits by the old camp (a raw rabbit each), cooked outside. */
async function huntRabbit(q: Quest): Promise<void> {
    const B = BOMB;
    const t0 = tickNow(q.sdk);
    await wieldWeapon(q);
    while (ids(q, B.rawRabbit) < 2 && tickNow(q.sdk) - t0 < 400) {
        const raw = (q.sdk.getState()?.groundItems ?? []).find((g) => g.id === B.rawRabbit && (g.distance ?? 99) <= 10);
        if (raw) {
            await q.bot.pickupItem(raw).catch(() => undefined);
            await q.sdk.waitForTicks(2);
            continue;
        }
        const rabbit = q.sdk.findNearbyNpc(/^rabbit$/i);
        if (!rabbit) {
            await walk(q, RABBITS, 3);
            await q.sdk.waitForTicks(5);
            continue;
        }
        await q.bot.attack(rabbit).catch(() => undefined);
        await untilTicks(q.sdk, () => !(q.sdk.getNearbyNpcs() ?? []).some((n) => n.index === rabbit.index) || (q.sdk.getState()?.groundItems ?? []).some((g) => g.id === B.rawRabbit), 20);
        await q.sdk.waitForTicks(2);
    }
    if (ids(q, B.rawRabbit) < 1) throw new Error('regicide: no raw rabbit');
}

// ── the outside part: the still, the furnace, the mixing, the fuse, the rabbit

const STILL = { x: 2927, z: 3212 };
const RIMMINGTON_RANGE = { x: 2970, z: 3209 };
const FALADOR_FURNACE = { x: 2975, z: 3368 };
const STILL_IF = { coal: 5061, valveUp: 6174, tarUp: 6176, close: 5030 };

/**
 * The fractionalizing still (regicide_fractionalizing_still.rs2): its softtimer runs every 2 ticks from the moment the
 * interface opens; with the tar regulator full (+2 pressure) and the pressure valve one notch open (-2) the pressure
 * stays put, and every cycle the heat needle is in the green (6..11) adds 2 to the total; 26 makes the naphtha on close.
 * The needles are not sent to the client, so this keeps a model in lockstep and feeds coal by it (.ql/still.ts: add
 * coal when the modelled temperature is <= 30 and the heat <= 6; 6-8 coal, robust to a one-cycle lag).
 */
async function runStill(q: Quest): Promise<boolean> {
    const B = BOMB;
    if (q.count(/^coal$/i) < 8) throw new Error(`regicide: the still wants coal (held ${q.count(/^coal$/i)})`);
    const before = ids(q, B.naphtha);
    await walk(q, { x: STILL.x + 1, z: STILL.z }, 1);
    const tar = slotOf(q, B.tar);
    if (!tar) throw new Error('regicide: no barrel of coal-tar for the still');
    const loc = await locById(q, 4026, STILL, 4);
    await q.sdk.sendUseItemOnLoc(tar.slot, loc?.x ?? STILL.x, loc?.z ?? STILL.z, 4026);
    if (!(await untilTicks(q.sdk, (s) => !!s.interface?.isOpen, 15))) {
        q.log(`regicide: the still did not open (at ${where(q)})`);
        return false;
    }
    const t0 = tickNow(q.sdk);
    // Tar regulator to full (29 -> 31), the pressure valve one notch (26 -> 27).
    await q.sdk.sendClickComponent(STILL_IF.tarUp);
    await q.sdk.sendClickComponent(STILL_IF.tarUp);
    await q.sdk.sendClickComponent(STILL_IF.valveUp);
    const m = { temp: 0, heat: 0, total: 0 };
    const cycle = () => {
        const bump = (v: number) => (m.heat = Math.max(0, Math.min(12, m.heat + v)));
        if (m.temp === 0) bump(-1);
        if (m.temp > 80) bump(2);
        if (m.temp === 80) bump(-1);
        else if (m.temp > 50) bump(1);
        if (m.temp > 0) m.temp = Math.max(0, m.temp - (5 + 6 * m.heat));
        if (m.heat >= 6 && m.heat <= 11) m.total += 2;
    };
    let coal = 0;
    let cycles = 0;
    while (m.total < 30 && tickNow(q.sdk) - t0 < 160 && q.sdk.getState()?.interface?.isOpen) {
        if (m.temp <= 30 && m.heat <= 6 && q.count(/^coal$/i) > 0) {
            await q.sdk.sendClickComponent(STILL_IF.coal);
            m.temp += 60;
            coal++;
        }
        // One modelled cycle per 2 server ticks since the interface opened.
        const target = t0 + 2 * (cycles + 1);
        await untilTicks(q.sdk, () => tickNow(q.sdk) >= target, 4);
        cycle();
        cycles++;
    }
    await q.sdk.waitForTicks(2);
    await q.sdk.sendClickComponent(STILL_IF.close).catch(() => undefined);
    await q.sdk.sendCloseModal().catch(() => undefined);
    await untilTicks(q.sdk, () => ids(q, B.naphtha) > before, 6);
    q.log(`regicide: still: ${cycles} cycles, ${coal} coal, model total ${m.total} -> naphtha ${ids(q, B.naphtha) > before ? 'yes' : 'no'}`);
    return ids(q, B.naphtha) > before;
}

/** Outside Tirannwn: naphtha at the still, quicklime at the Falador furnace, both dusts, the mix, the fuse, the cooked rabbit. */
export async function makeBomb(q: Quest): Promise<void> {
    const B = BOMB;
    const pestle = () => q.sdk.getInventory().find((i) => /^pestle and mortar$/i.test(i.name));
    if (!bombState(q).naphtha) {
        await q.goTo(STILL, 4);
        for (let attempt = 1; attempt <= 2 && !bombState(q).naphtha && ids(q, B.tar) > 0; attempt++) await runStill(q);
        if (!bombState(q).naphtha) throw new Error('regicide: the still made no naphtha');
    }
    if (!bombState(q).cooked && ids(q, B.rawRabbit) > 0) {
        await q.goTo(RIMMINGTON_RANGE, 2);
        for (let i = 0; i < 3 && ids(q, B.cookedRabbit) < 1 && ids(q, B.rawRabbit) > 0; i++) {
            const before = ids(q, B.rawRabbit);
            await useOnLoc(q, B.rawRabbit, 2728, RIMMINGTON_RANGE, () => ids(q, B.rawRabbit) < before, 'cook a rabbit on the range', 15).catch((e: Error) => q.log(e.message));
            await closeDialogs(q);
        }
        if (ids(q, B.cookedRabbit) < 1) throw new Error('regicide: no cooked rabbit (both burnt?)');
    }
    if (!bombState(q).fused && ids(q, B.limestone) > 0 && !ids(q, B.quicklime)) {
        await q.goTo(FALADOR_FURNACE, 3);
        await useOnLoc(q, B.limestone, 2781, FALADOR_FURNACE, () => ids(q, B.quicklime) > 0, 'burn the limestone', 15);
    }
    await eatIfLow(q);
    if (ids(q, B.quicklime) > 0 && pestle()) await useOnItem(q, pestle()!.id, B.quicklime, () => ids(q, B.quicklimeDust) > 0, 'grind the quicklime into a pot');
    if (ids(q, B.sulphur) > 0 && pestle()) await useOnItem(q, pestle()!.id, B.sulphur, () => ids(q, B.sulphurDust) > 0, 'grind the sulphur');
    // Into the naphtha, either order: the second makes the barrel bomb.
    const barrel = () => slotOf(q, B.naphtha) ?? slotOf(q, B.naphthaSulphur) ?? slotOf(q, B.naphthaQuicklime);
    if (ids(q, B.quicklimeDust) > 0 && (ids(q, B.naphtha) > 0 || ids(q, B.naphthaSulphur) > 0)) await useOnItem(q, B.quicklimeDust, barrel()!.id, () => ids(q, B.quicklimeDust) === 0, 'quicklime into the naphtha');
    if (ids(q, B.sulphurDust) > 0 && (ids(q, B.naphtha) > 0 || ids(q, B.naphthaQuicklime) > 0)) await useOnItem(q, B.sulphurDust, barrel()!.id, () => ids(q, B.sulphurDust) === 0, 'sulphur into the naphtha');
    if (ids(q, B.lid) > 0 && ids(q, B.cloth) > 0) await useOnItem(q, B.cloth, B.lid, () => ids(q, B.fused) > 0, 'the cloth fuse');
    if (!bombState(q).fused) throw new Error(`regicide: no fused barrel bomb yet: ${JSON.stringify(bombState(q))}`);
    q.log('regicide: the barrel bomb is fused');
}

const CATAPULT = { x: 2185, z: 3183 };

/** Back in Tirannwn: a cooked rabbit for the catapult's guard, then the bomb on the catapult (12). */
export async function catapult(q: Quest, killed: () => Promise<boolean>): Promise<void> {
    const B = BOMB;
    await toPocket(q, 'APPROACH');
    for (let attempt = 1; attempt <= 3 && !(await killed()); attempt++) {
        await walk(q, { x: CATAPULT.x + 2, z: CATAPULT.z - 2 }, 2);
        // The catapult's guard (regicide_tyras_lazy_guard, spawn 2181,3184) is named Tyras guard too: the nearest to the catapult.
        const guard = (q.sdk.getNearbyNpcs() ?? []).filter((n) => /^tyras guard$/i.test(n.name)).sort((a, b) => Math.hypot(a.x - 2181, a.z - 3184) - Math.hypot(b.x - 2181, b.z - 3184))[0];
        const rabbit = slotOf(q, B.cookedRabbit);
        if (rabbit && guard) {
            await q.sdk.sendUseItemOnNpc(rabbit.slot, guard.index);
            await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 12);
            await driveDialog(q.sdk, [], { ticks: 30, log: q.log });
        } else q.log(`regicide: catapult: rabbit ${!!rabbit}, guard ${guard?.name ?? 'none'} (npcs ${(q.sdk.getNearbyNpcs() ?? []).slice(0, 6).map((n) => n.name).join(', ')})`);
        const bomb = slotOf(q, B.fused);
        if (!bomb) throw new Error('regicide: no fused barrel bomb for the catapult');
        await q.sdk.sendUseItemOnLoc(bomb.slot, CATAPULT.x, CATAPULT.z, 3976);
        // The launch: forcewalks, the flight, the tent fire, back by the catapult (~20 ticks).
        await untilTicks(q.sdk, () => ids(q, B.fused) === 0, 20);
        await untilTicks(q.sdk, () => inTirannwn(pos(q)) && !q.sdk.getDialog()?.isOpen, 30);
        await closeDialogs(q);
    }
}

/** Lord Iorwerth: the deed is done, his letter for Lathas (13). */
export async function letter(q: Quest, given: () => Promise<boolean>): Promise<void> {
    for (let attempt = 1; attempt <= 3 && !(await given()); attempt++) await talkIorwerth(q);
}

/** Ardougne's market zone east of the castle (quest_regicide.rs2 [zone,0_40_51_24_32]): Arianwyn reads the letter (14). */
const ARIANWYN_ZONE = { x: 2591, z: 3298 };
const ARIANWYN_OUTSIDE = { x: 2592, z: 3290 };
export async function arianwyn(q: Quest, met: () => Promise<boolean>): Promise<void> {
    let reads = 0;
    const quickMet = async () => ++reads % 10 === 0 && (await met());
    for (let attempt = 1; attempt <= 3 && !(await met()); attempt++) {
        if (ids(q, BOMB.message) < 1) throw new Error("regicide: Iorwerth's message is not held");
        // Out of the zone and back in: the zone trigger runs on entry.
        await q.goTo(ARIANWYN_OUTSIDE, 2);
        await q.goTo(ARIANWYN_ZONE, 1);
        const t0 = tickNow(q.sdk);
        while (tickNow(q.sdk) - t0 < 120 && !(await quickMet())) {
            if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 20, log: q.log });
            else if (q.sdk.getState()?.interface?.isOpen) await q.sdk.sendCloseModal().catch(() => undefined);
            else await q.sdk.waitForTicks(2);
        }
        await closeDialogs(q);
    }
}

/** King Lathas with the letter: complete. */
export async function reportLathas(q: Quest, done: () => Promise<boolean>): Promise<void> {
    await lathas(q, done);
}

// ── kits and the in-run restock between the bomb's phases

/** Through the pass and out again: bow and arrows for the chasm, rope for the swing, spade for the mud, teleport runes out. */
export const passKitNeeds = (): Need[] => [
    { item: 'bow', count: 1 },
    { item: 'bronze arrow', count: 5 },
    { item: 'tinderbox', count: 1 },
    { item: 'rope', count: 2 },
    { item: 'spade', count: 1 },
    { item: 'melee weapon', count: 1 },
    { item: 'law rune', count: 2 },
    { item: 'air rune', count: 6 },
    { item: 'water rune', count: 2 },
];
/** Tirannwn's gathering trip (28: kit 10, pestle, 4 wool, pickaxe, 4 sharks, then 2 barrels, sulphur, limestone, 2 rabbits). */
export function gatherNeeds(q: Quest): Need[] {
    const s = bombState(q);
    return [
        ...passKitNeeds(),
        { item: 'pestle and mortar', count: 1 },
        ...(s.cloth ? [] : [{ item: 'ball of wool', count: 4 }]),
        ...(s.quicklime ? [] : [{ item: 'pickaxe', count: 1 }]),
        // Traps only (8-15 a hit) and rabbits: 4 sharks, room for the parts.
        { item: 'shark', count: 4 },
    ];
}
/** The still (coal), the furnace and grinding (pestle, a pot for the quicklime). */
export function outsideNeeds(q: Quest): Need[] {
    const s = bombState(q);
    return [
        ...(s.naphtha ? [] : [{ item: 'coal', count: 16 }]),
        { item: 'pestle and mortar', count: 1 },
        ...(s.fused || own(q, BOMB.naphthaQuicklime, BOMB.quicklimeDust) > 0 ? [] : [{ item: 'pot', count: 1 }]),
    ];
}
/** Back to the catapult (and on to Iorwerth). */
export const finalNeeds = (): Need[] => [...passKitNeeds(), { item: 'shark', count: 4 }];

/** The bomb's next phase, as the account stands (bank included while it is open). */
export function bombPhase(q: Quest): 'gather' | 'outside' | 'final' {
    if (needsTirannwn(q)) return 'gather';
    if (needsOutside(q)) return 'outside';
    return 'final';
}

const BOMB_IDS = Object.values(BOMB) as number[];

/**
 * Between phases in one run: out of Tirannwn, to the Ardougne hub, everything banked, then the bomb's items (all of
 * them, by id) and `needs` withdrawn; whatever the bank lacks is sourced (q.ensure).
 */
export async function restock(q: Quest, needs: Need[]): Promise<void> {
    if (inRegicideArea(pos(q))) await leaveRegicide(q);
    await q.goTo(SAFE_BANKS.ardougne, 4);
    await depositAllInventory(q.supply);
    if (!q.sdk.isBankOpen()) await q.bot.openBank().catch(() => undefined);
    // Once the bomb is fused, its spares (a second tar barrel, a raw rabbit) stay banked: the pack is the pass kit.
    const spare: number[] = q.sdk.getBankItems().some((b) => b.id === BOMB.fused) ? [BOMB.tar, BOMB.barrel, BOMB.rawRabbit, BOMB.naphtha] : [];
    for (const b of q.sdk.getBankItems().filter((x) => BOMB_IDS.includes(x.id) && !spare.includes(x.id))) {
        if (q.sdk.getInventory().length >= 27) break;
        await q.bot.withdrawItem(b, b.count).catch(() => undefined);
        await q.sdk.waitForTicks(1);
    }
    for (const n of needs) {
        const have = q.count(n.item);
        if (have >= n.count) continue;
        const names = GROUPS[n.item]?.filter((m) => q.level(m.skill) >= m.level).map((m) => m.item) ?? [n.item];
        const banked = names.map((x) => q.sdk.findBankItem(itemPattern(x))).find(Boolean);
        if (banked) {
            await q.bot.withdrawItem(banked, Math.min(banked.count, n.count - have)).catch(() => undefined);
            await q.sdk.waitForTicks(1);
        }
    }
    await q.bot.closeBank().catch(() => undefined);
    // Mule stock (sharks) is best effort here: what the bank holds goes, a shortfall is not a stop mid-quest.
    for (const n of needs) if (!needMet(q, n) && !SOURCES[n.item]?.mule) await q.ensure(n.item, n.count);
    q.log(`regicide: restocked for the next phase: ${q.sdk.getInventory().map((i) => `${i.name}${(i.count ?? 1) > 1 ? ` x${i.count}` : ''}`).join(', ')}`);
}

/** Stage 11 -> 12 in phases: Tirannwn's parts, the bomb outside, then the catapult; a restock at the hub between them. */
export async function bombAndCatapult(q: Quest, killed: () => Promise<boolean>): Promise<void> {
    if (await killed()) return;
    if (bombPhase(q) === 'gather') {
        await gatherTirannwn(q);
        await restock(q, outsideNeeds(q));
    }
    if (bombPhase(q) === 'outside') {
        if (inRegicideArea(pos(q))) await restock(q, outsideNeeds(q));
        await makeBomb(q);
        await restock(q, finalNeeds());
    }
    if (bombPhase(q) !== 'final') throw new Error(`regicide: the bomb is not ready: ${JSON.stringify(bombState(q))}`);
    await catapult(q, killed);
}
