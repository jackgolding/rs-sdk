/**
 * Dwarf Cannon — the Black Guard's camp north-west of the Fishing Guild, its watchtower, the goblin
 * cave and Nulodion's workshop.
 *
 * Content facts (quest_mcannon/scripts/**, ladders.rs2; placements m39/40_52..54, m40_153, m47_53):
 *   - Commander Lawgof (2571,3463): "Yeah, I'd love to help." gives six railings (0 -> 1).
 *   - Six damaged railings (locs 15-20 at (2556,3475) (2558,3472) (2557,3464) (2559,3462) (2564,3460)
 *     (2572,3460)), Inspect -> "Try to replace the railing." (Crafting roll; a fail cuts you for <= 3).
 *     All six, then Lawgof (1 -> 2).
 *   - The watchtower ladder (2570,3441) only opens from 2; its L1 ladder (2570,3443) to L2, where the
 *     dwarf remains lie (2567,3444). Remains to Lawgof (2 -> 3).
 *   - The cave entrance (2622,3392) sets 3 -> 4 and drops you at (2620,9797). The crate (2571,9850)
 *     frees Lolk (4 -> 5). Out by the mud pile (2621,9796) to (2623,3391).
 *   - Lawgof: "Ok, I'll see what I can do." -> tool kit (5 -> 6). The shed door (2576,3461), the
 *     broken cannon (2577,3461): Inspect (6 -> 7), Inspect again for the parts menu (Pipe, Barrel,
 *     Axle, Shaft; each a Smithing/Crafting roll), Inspect with all four fixed (-> 8).
 *   - Lawgof: "Ok then, just for you!" (8 -> 9). Nulodion (3011,3453) behind the door (3015,3453),
 *     north of Falador: notes and mould (-> 10). Lawgof takes them (complete).
 */
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const OBJ = { remains: 0, toolkit: 1, notes: 3, mould: 4, railing: 14 } as const;

export const LAWGOF = { x: 2571, z: 3463 };
export const NULODION = { x: 3011, z: 3453 };
const RAILINGS: Array<{ x: number; z: number; id: number }> = [
    { x: 2556, z: 3475, id: 15 },
    { x: 2558, z: 3472, id: 16 },
    { x: 2557, z: 3464, id: 17 },
    { x: 2559, z: 3462, id: 18 },
    { x: 2564, z: 3460, id: 19 },
    { x: 2572, z: 3460, id: 20 },
];
const TOWER_LADDER = { x: 2570, z: 3441 };
const TOWER_LADDER_L1 = { x: 2570, z: 3443 };
const REMAINS = { x: 2567, z: 3444 };
const CAVE = { x: 2622, z: 3392 };
const CRATE = { x: 2571, z: 9850 };
const MUD_PILE = { x: 2621, z: 9796 };
const SHED_DOOR = { x: 2576, z: 3461 };
const CANNON = { x: 2577, z: 3461 };
const NULODION_DOOR = { x: 3015, z: 3453 };

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
export const held = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id);

/** The goblin cave under the Fishing Guild's hill. */
export const inGoblinCave = (p: Tile) => inBox(p, 2550, 2640, 9780, 9870);
/** The watchtower's upper floors. */
const inTower = (p: Tile) => (p.level ?? 0) > 0 && inBox(p, 2562, 2576, 3436, 3448);
export const inCannonArea = (p: Tile) => inGoblinCave(p) || inTower(p);

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

async function op(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string, choices: RegExp[] = [], ticks = 15): Promise<void> {
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        const loc = await locNear(q, at, name, opt);
        if (!loc) {
            q.log(`cannon: ${label}: no ${name} with ${opt} near (${at.x},${at.z}) from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { done, ticks: 30, log: q.log });
        await untilTicks(q.sdk, done, 4);
    }
    if (!done()) throw new Error(`cannon: ${label} failed at ${where(q)}`);
}

// ── 1: the railings

export async function fixRailings(q: Quest): Promise<void> {
    const t0 = tickNow(q.sdk);
    for (const railing of RAILINGS) {
        let fixed = false;
        for (let attempt = 1; attempt <= 12 && !fixed; attempt++) {
            if (!held(q, OBJ.railing)) {
                // Lawgof hands out another when the pack has none.
                await q.talk(/^dwarf commander$/i, [], LAWGOF);
                if (!held(q, OBJ.railing)) throw new Error('cannon: no railing to fit');
            }
            if (Math.hypot(pos(q).x - railing.x, pos(q).z - railing.z) > 3) await q.goTo(railing, 2);
            const since = cursor(q);
            await q.sdk.sendInteractLoc(railing.x, railing.z, railing.id, 1);
            await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || said(q, since, /already fixed this railing|nothing interesting/i), 15);
            if (said(q, since, /already fixed this railing/i)) {
                fixed = true;
                break;
            }
            await driveDialog(q.sdk, [/try to replace the railing/i], { ticks: 20, log: q.log });
            await untilTicks(q.sdk, () => said(q, since, /with no problems|cut yourself/i), 12);
            fixed = said(q, since, /with no problems/i);
            const hp = q.sdk.getSkill('hitpoints');
            if (hp && hp.level < 15) await q.sdk.waitForTicks(30);
        }
        if (!fixed) throw new Error(`cannon: the railing at (${railing.x},${railing.z}) would not go in`);
    }
    q.log(`cannon: six railings fixed (${tickNow(q.sdk) - t0}t)`);
}

// ── 2: the watchtower's remains

export async function fetchRemains(q: Quest): Promise<void> {
    if (held(q, OBJ.remains)) return;
    if (!inTower(pos(q))) {
        await q.goTo({ x: TOWER_LADDER.x, z: TOWER_LADDER.z - 1 }, 1);
        await op(q, TOWER_LADDER, /ladder/i, /climb-up/i, () => pos(q).level === 1, 'up the watchtower');
    }
    if (pos(q).level === 1) await op(q, TOWER_LADDER_L1, /ladder/i, /climb-up/i, () => pos(q).level === 2, 'up the watchtower\'s second ladder');
    for (let i = 0; i < 5 && !held(q, OBJ.remains); i++) {
        await q.sdk.scanGroundItems(8).catch(() => undefined);
        const g = (q.sdk.getState()?.groundItems ?? []).find((it) => it.id === OBJ.remains);
        if (!g) {
            await q.sdk.waitForTicks(5);
            continue;
        }
        await q.bot.pickupItem(g).catch(() => undefined);
        await untilTicks(q.sdk, () => held(q, OBJ.remains), 8);
    }
    if (!held(q, OBJ.remains)) throw new Error(`cannon: no dwarf remains at (${REMAINS.x},${REMAINS.z}) (from ${where(q)})`);
    await leaveTower(q);
}

async function leaveTower(q: Quest): Promise<void> {
    for (let i = 0; i < 3 && inTower(pos(q)); i++) {
        const now = pos(q).level;
        const at = now === 2 ? TOWER_LADDER_L1 : TOWER_LADDER;
        await op(q, at, /ladder/i, /climb-down/i, () => pos(q).level < now, 'down the watchtower');
    }
}

// ── 3 -> 5: the goblin cave

export async function rescueLolk(q: Quest): Promise<void> {
    const start = cursor(q);
    const freed = () => said(q, start, /runs off into the caverns|search the crate but find nothing/i);
    if (!inGoblinCave(pos(q))) {
        await q.goTo({ x: CAVE.x, z: CAVE.z + 1 }, 2);
        await op(q, CAVE, /cave entrance/i, /enter/i, () => inGoblinCave(pos(q)), 'into the goblin cave');
    }
    await q.bot.walkTo(CRATE.x, CRATE.z - 1, 2).catch(() => undefined);
    for (let attempt = 1; attempt <= 3 && !freed(); attempt++) {
        const crate = await locNear(q, CRATE, /^crate$/i, /search/i, 1);
        if (!crate) {
            q.log(`cannon: no crate at (${CRATE.x},${CRATE.z}) from ${where(q)}`);
            await q.bot.walkTo(CRATE.x, CRATE.z - 1, 1).catch(() => undefined);
            continue;
        }
        await q.sdk.sendInteractLoc(crate.x, crate.z, crate.id, crate.optionsWithIndex.find((o) => /search/i.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 15);
        await driveDialog(q.sdk, [], { ticks: 40, log: q.log });
        await q.sdk.waitForTicks(3);
    }
}

export async function leaveCave(q: Quest): Promise<void> {
    if (!inGoblinCave(pos(q))) return;
    await q.bot.walkTo(MUD_PILE.x, MUD_PILE.z + 1, 2).catch(() => undefined);
    await op(q, MUD_PILE, /mud pile/i, /climb/i, () => !inGoblinCave(pos(q)), 'over the mud pile', [], 15);
    q.log(`cannon: out of the goblin cave at ${where(q)}`);
}

// ── 6 -> 8: the cannon

export async function fixCannon(q: Quest, fixed: () => Promise<boolean>): Promise<void> {
    await q.goTo({ x: SHED_DOOR.x - 1, z: SHED_DOOR.z }, 1);
    const inShed = () => pos(q).x >= SHED_DOOR.x;
    if (!inShed()) {
        await op(q, SHED_DOOR, /^door$/i, /^open$/i, () => !q.sdk.getNearbyLocs()?.some((l) => l.x === SHED_DOOR.x && l.z === SHED_DOOR.z && /^door$/i.test(l.name) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text))) || inShed(), 'the shed door');
    }
    const parts = ['Pipe', 'Barrel', 'Axle', 'Shaft'];
    const done = new Set<string>();
    const t0 = tickNow(q.sdk);
    for (let attempt = 1; attempt <= 40 && !(await fixed()); attempt++) {
        const cannon = await locNear(q, CANNON, /broken multicannon/i, /inspect/i, 3);
        if (!cannon) throw new Error(`cannon: no broken multicannon near ${where(q)}`);
        const since = cursor(q);
        await q.sdk.sendInteractLoc(cannon.x, cannon.z, cannon.id, cannon.optionsWithIndex.find((o) => /inspect/i.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || said(q, since, /strange dwarf contraption|can't quite find the problem/i), 12);
        if (!q.sdk.getDialog()?.isOpen) {
            await q.sdk.waitForTicks(2);
            continue;
        }
        // The parts menu (multi5_header): the first part not yet known fixed.
        const part = parts.find((p) => !done.has(p)) ?? 'None';
        await driveDialog(q.sdk, [new RegExp(`^${part}$`, 'i')], { ticks: 20, log: q.log });
        await untilTicks(q.sdk, () => said(q, since, /manage to fix it|fail to fix it|already fixed this part/i), 12);
        if (said(q, since, /manage to fix it|already fixed this part/i)) done.add(part);
        await q.sdk.waitForTicks(2);
    }
    if (!(await fixed())) throw new Error(`cannon: the cannon is still broken after ${tickNow(q.sdk) - t0}t`);
    q.log(`cannon: the multicannon is fixed (${tickNow(q.sdk) - t0}t)`);
}

// ── 9 -> 10: Nulodion

export async function seeNulodion(q: Quest): Promise<void> {
    await q.goTo({ x: NULODION_DOOR.x + 1, z: NULODION_DOOR.z }, 2);
    const inside = () => pos(q).x <= NULODION_DOOR.x - 1 && inBox(pos(q), 3005, 3014, 3448, 3458);
    if (!inside()) {
        const door = await locNear(q, NULODION_DOOR, /^door$/i, /^open$/i, 1);
        if (door) await q.bot.openDoor(door).catch(() => undefined);
    }
    await q.talk(/^nulodion$/i, []);
    if (!held(q, OBJ.notes) || !held(q, OBJ.mould)) throw new Error('cannon: Nulodion gave no notes/mould');
}

/** Out of the goblin cave or the watchtower (run-quest's goTo). */
export async function leaveCannonArea(q: Quest): Promise<void> {
    if (inGoblinCave(pos(q))) await leaveCave(q);
    if (inTower(pos(q))) await leaveTower(q);
}
