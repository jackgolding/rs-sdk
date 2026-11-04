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
        // Koftik's food, once (koftik.rs2: 2 bread and a stew).
        await talkThrough(q.sdk, q.bot, /^koftik$/i, [], q.log).catch(() => '');
        await closeDialogs(q);
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
type Pocket = 'WELL' | 'SOUTH' | 'TRACKER' | 'RIVER' | 'CAMP' | 'WOODS' | 'NORTHWOODS' | 'APPROACH' | 'TYRAS';
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
