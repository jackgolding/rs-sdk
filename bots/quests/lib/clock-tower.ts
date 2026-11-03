/**
 * Clock Tower — Brother Kojo's four cogs, the cellar under the tower and its side entrances.
 *
 * Content facts (quest_cog/scripts/**, placements m40_50, m40_150):
 *   - Brother Kojo (2569,3249). The tower's spindles take one cog each (oplocu, wrong colour: "doesn't
 *     fit"): red on L0 (2568,3243), blue on L1 (2569,3240), white on L2 (2567,3241), black in the
 *     cellar (2570,9642). The spiral stairs are at (2572,3240); the cellar ladder at (2566,3242).
 *   - Only one cog can be carried at a time (inv_totalcat cog).
 *   - Red cog (2583,9613): the ogres' room south-east of the cellar.
 *   - White cog (2577,9655): behind the rat cage. Rat poison spawns at (2564,9662). The lever
 *     (2591,9661) opens the cage gate (2595,9657); poison in the food trough (2586,9654) kills the
 *     rats and frees the gate (2579,9656, "Go-through") to the cog. Its ladder (2575,9655) comes up
 *     outside the tower.
 *   - Black cog (2613,9639): in fire — only Ice gloves worn let you pick it up (the bucket-of-water
 *     route is a use-item-on-ground-obj, which the SDK cannot send).
 *   - Blue cog (2574,9633): caged from the cellar's side; reached from the ladder (2621,3261) east of
 *     Brother Cedric's cart, the passage west to the secret wall (2575,9631) "Push".
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const OBJ = { white: 20, black: 21, blue: 22, red: 23, poison: 24, iceGloves: 1580 } as const;
const COGS = [OBJ.white, OBJ.black, OBJ.blue, OBJ.red];

export const KOJO = { x: 2569, z: 3249 };
const CELLAR_LADDER = { x: 2566, z: 3242 };
const CELLAR_FOOT = { x: 2566, z: 9642 };
const STAIRS = { x: 2572, z: 3240 };
const SPINDLE: Record<number, Tile> = {
    [OBJ.red]: { x: 2568, z: 3243, level: 0 },
    [OBJ.blue]: { x: 2569, z: 3240, level: 1 },
    [OBJ.white]: { x: 2567, z: 3241, level: 2 },
    [OBJ.black]: { x: 2570, z: 9642, level: 0 },
};
const COG_AT: Record<number, Tile> = {
    [OBJ.red]: { x: 2583, z: 9613 },
    [OBJ.white]: { x: 2577, z: 9655 },
    [OBJ.black]: { x: 2613, z: 9639 },
    [OBJ.blue]: { x: 2574, z: 9633 },
};
const POISON = { x: 2564, z: 9662 };
const LEVER = { x: 2591, z: 9661 };
const CAGE_GATE = { x: 2595, z: 9657 };
const TROUGH = { x: 2586, z: 9654 };
const RAT_GATE = { x: 2579, z: 9656 };
const WHITE_LADDER = { x: 2575, z: 9655 };
const CART_LADDER = { x: 2621, z: 3261 };
const CART_FOOT = { x: 2621, z: 9661 };
const SECRET_WALL = { x: 2575, z: 9631 };

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
export const held = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id);
const wearing = (q: Quest, id: number) => q.sdk.getEquipment().some((i) => i.id === id);
const heldCog = (q: Quest) => COGS.find((c) => held(q, c));

/** The cellar and its side passages under the tower (z + 6400). */
export const inCogCellar = (p: Tile) => inBox(p, 2550, 2630, 9600, 9680);
/** The blue cog's passage, only reachable from the cart's ladder (east of x 2575, z <= 9665). */
const inBluePassage = (p: Tile) => inBox(p, 2575, 2630, 9620, 9665) && !inBox(p, 2577, 2630, 9636, 9665);

function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function said(q: Quest, since: number, text: RegExp): boolean {
    return (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > since && text.test(m.text));
}

async function locNear(q: Quest, at: Tile, name: RegExp, opt?: RegExp, within = 2) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => name.test(l.name) && (!opt || l.optionsWithIndex.some((o) => opt.test(o.text))))
        .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= within ? loc : undefined;
}

async function op(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string, ticks = 20): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const loc = await locNear(q, at, name, opt);
        if (!loc) {
            q.log(`cog: ${label}: no ${name} with ${opt} near (${at.x},${at.z}) from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 30, log: q.log });
        await untilTicks(q.sdk, done, 4);
    }
    if (!done()) throw new Error(`cog: ${label} failed at ${where(q)}`);
}

async function walk(q: Quest, to: Tile, tolerance = 1): Promise<void> {
    const res = await q.bot.walkTo(to.x, to.z, tolerance);
    if (!res.success && Math.hypot(pos(q).x - to.x, pos(q).z - to.z) > tolerance + 1) throw new Error(`cog: walk to (${to.x},${to.z}) failed: ${res.message} (at ${where(q)})`);
}

/** Pick up the ground item `id` near `at` (cogs, the rat poison). */
async function pickUp(q: Quest, id: number, at: Tile, label: string): Promise<void> {
    if (held(q, id)) return;
    await walk(q, at, 2);
    for (let i = 0; i < 6 && !held(q, id); i++) {
        await q.sdk.scanGroundItems(8).catch(() => undefined);
        const g = (q.sdk.getState()?.groundItems ?? []).find((it) => it.id === id && Math.hypot(it.x - at.x, it.z - at.z) <= 3);
        if (!g) {
            await q.sdk.waitForTicks(5);
            continue;
        }
        const since = cursor(q);
        await q.bot.pickupItem(g).catch(() => undefined);
        await untilTicks(q.sdk, (s) => held(q, id) || !!s.dialog?.isOpen || said(q, since, /too heavy|must speak|red hot/i), 10);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
        if (said(q, since, /too heavy/i)) throw new Error(`cog: already carrying a cog (${label})`);
    }
    if (!held(q, id)) throw new Error(`cog: could not pick up the ${label} at (${at.x},${at.z}) from ${where(q)}`);
    q.log(`cog: picked up the ${label}`);
}

/** Down the tower's cellar ladder. */
async function intoCellar(q: Quest): Promise<void> {
    if (inCogCellar(pos(q)) && !inBluePassage(pos(q))) return;
    if (inBluePassage(pos(q))) await outOfCellar(q);
    if (pos(q).level > 0) await q.climbTo(0);
    await q.goTo({ x: CELLAR_LADDER.x + 1, z: CELLAR_LADDER.z }, 1);
    await op(q, CELLAR_LADDER, /ladder/i, /climb-down/i, () => inCogCellar(pos(q)), 'down the cellar ladder');
}

/** Up the nearest ladder out of the cellar (the tower's, the white cog's or the cart's). */
export async function outOfCellar(q: Quest): Promise<void> {
    if (!inCogCellar(pos(q))) return;
    const ladders = [CELLAR_FOOT, { x: WHITE_LADDER.x, z: WHITE_LADDER.z }, CART_FOOT].sort(
        (a, b) => Math.hypot(a.x - pos(q).x, a.z - pos(q).z) - Math.hypot(b.x - pos(q).x, b.z - pos(q).z),
    );
    for (const ladder of ladders) {
        if (!inCogCellar(pos(q))) break;
        const loc = await locNear(q, ladder, /ladder/i, /climb-up/i, 2);
        if (!loc || loc.reachable === false) continue;
        await op(q, loc, /ladder/i, /climb-up/i, () => !inCogCellar(pos(q)), 'up out of the cellar').catch((e) => q.log((e as Error).message));
    }
    if (inCogCellar(pos(q))) throw new Error(`cog: no way up out of the cellar from ${where(q)}`);
    q.log(`cog: up out of the cellar at ${where(q)}`);
}

/** The held cog on its spindle; the tower's floors by its stairs. */
async function placeCog(q: Quest, cog: number): Promise<void> {
    const spindle = SPINDLE[cog]!;
    if (cog === OBJ.black) {
        await intoCellar(q);
        await walk(q, { x: spindle.x - 1, z: spindle.z }, 1);
    } else {
        if (inCogCellar(pos(q))) await outOfCellar(q);
        if (pos(q).level !== spindle.level) {
            if (pos(q).level === 0) await q.goTo({ x: STAIRS.x - 1, z: STAIRS.z + 1 }, 2);
            await q.climbTo(spindle.level!);
        } else if (pos(q).level === 0) {
            await q.goTo({ x: spindle.x, z: spindle.z + 1 }, 2);
        }
    }
    const since = cursor(q);
    for (let attempt = 1; attempt <= 4 && held(q, cog); attempt++) {
        const loc = await locNear(q, spindle, /^clock spindle$/i, undefined, 0);
        const item = q.sdk.getInventory().find((i) => i.id === cog);
        if (!loc || !item) {
            q.log(`cog: no spindle at (${spindle.x},${spindle.z}) from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendUseItemOnLoc(item.slot, loc.x, loc.z, loc.id);
        await untilTicks(q.sdk, () => !held(q, cog) || said(q, since, /doesn't seem to fit|already placed/i), 20);
    }
    if (held(q, cog)) throw new Error(`cog: the cog ${cog} would not go on its spindle (at ${where(q)})`);
    q.log(`cog: cog ${cog} on its spindle`);
}

// ── the four cogs

export async function redCog(q: Quest): Promise<void> {
    if (!held(q, OBJ.red)) {
        await intoCellar(q);
        await pickUp(q, OBJ.red, COG_AT[OBJ.red]!, 'red cog');
        await walk(q, { x: CELLAR_FOOT.x + 1, z: CELLAR_FOOT.z }, 2);
    }
    await placeCog(q, OBJ.red);
}

export async function whiteCog(q: Quest): Promise<void> {
    if (!held(q, OBJ.white)) {
        await intoCellar(q);
        const ratsAlive = () => !!q.sdk.findNearbyNpc(/^rat$/i);
        const pastRats = () => pos(q).x <= RAT_GATE.x - 1 && inBox(pos(q), 2570, 2578, 9650, 9662);
        if (!pastRats()) {
            await pickUp(q, OBJ.poison, POISON, 'rat poison');
            await walk(q, { x: LEVER.x, z: LEVER.z + 1 }, 1);
            const open = () => !(q.sdk.getNearbyLocs() ?? []).some((l) => l.x === CAGE_GATE.x && l.z === CAGE_GATE.z && /gate/i.test(l.name));
            await op(q, LEVER, /^lever$/i, /pull/i, open, 'the cage lever', 10).catch((e) => q.log((e as Error).message));
            // Into the cage, then the poison in the trough.
            await walk(q, { x: TROUGH.x + 1, z: TROUGH.z + 1 }, 1);
            const since = cursor(q);
            for (let attempt = 1; attempt <= 3 && held(q, OBJ.poison); attempt++) {
                const trough = await locNear(q, TROUGH, /^food trough$/i, undefined, 1);
                const poison = q.sdk.getInventory().find((i) => i.id === OBJ.poison);
                if (!trough || !poison) break;
                await q.sdk.sendUseItemOnLoc(poison.slot, trough.x, trough.z, trough.id);
                await untilTicks(q.sdk, () => !held(q, OBJ.poison), 15);
            }
            if (held(q, OBJ.poison)) throw new Error(`cog: the rat poison would not go in the trough (at ${where(q)})`);
            await untilTicks(q.sdk, () => said(q, since, /dying/i) && !ratsAlive(), 40);
            await op(q, RAT_GATE, /^gate$/i, /go-through/i, pastRats, 'the rats\' gate', 15);
        }
        await pickUp(q, OBJ.white, COG_AT[OBJ.white]!, 'white cog');
        await walk(q, { x: WHITE_LADDER.x + 1, z: WHITE_LADDER.z }, 1);
        await op(q, WHITE_LADDER, /ladder/i, /climb-up/i, () => !inCogCellar(pos(q)), 'up the white cog\'s ladder');
    }
    await placeCog(q, OBJ.white);
}

export async function blackCog(q: Quest): Promise<void> {
    if (!held(q, OBJ.black)) {
        const gloves = q.sdk.getInventory().find((i) => i.id === OBJ.iceGloves);
        if (gloves) await q.bot.equipItem(gloves).catch(() => undefined);
        if (!wearing(q, OBJ.iceGloves)) throw new Error('cog: Ice gloves are not worn for the black cog');
        await intoCellar(q);
        await pickUp(q, OBJ.black, COG_AT[OBJ.black]!, 'black cog');
    }
    await placeCog(q, OBJ.black);
    // Off again: the epilogue banks the pack, not what is worn.
    const worn = q.sdk.getEquipment().find((i) => i.id === OBJ.iceGloves);
    if (worn) await q.bot.unequipItem(worn).catch(() => undefined);
}

export async function blueCog(q: Quest): Promise<void> {
    if (!held(q, OBJ.blue)) {
        if (inCogCellar(pos(q)) && !inBluePassage(pos(q))) await outOfCellar(q);
        if (!inBluePassage(pos(q))) {
            if (pos(q).level > 0) await q.climbTo(0);
            await q.goTo({ x: CART_LADDER.x - 1, z: CART_LADDER.z }, 1);
            await op(q, CART_LADDER, /ladder/i, /climb-down/i, () => inCogCellar(pos(q)), 'down the ladder by the cart');
        }
        await walk(q, { x: SECRET_WALL.x + 1, z: SECRET_WALL.z }, 0);
        const through = () => pos(q).x <= SECRET_WALL.x;
        await op(q, SECRET_WALL, /^wall$/i, /^push$/i, through, 'the secret wall', 15);
        await pickUp(q, OBJ.blue, COG_AT[OBJ.blue]!, 'blue cog');
        // Back out the way we came: the cog's cage has no door to the cellar.
        if (pos(q).x <= SECRET_WALL.x) await op(q, SECRET_WALL, /^wall$/i, /^push$/i, () => pos(q).x > SECRET_WALL.x, 'back through the secret wall', 15);
        await walk(q, { x: CART_FOOT.x - 1, z: CART_FOOT.z }, 1);
        await op(q, CART_FOOT, /ladder/i, /climb-up/i, () => !inCogCellar(pos(q)), 'up the cart\'s ladder');
    }
    await placeCog(q, OBJ.blue);
}

