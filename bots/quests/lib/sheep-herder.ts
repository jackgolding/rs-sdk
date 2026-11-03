/**
 * Sheep Herder — prodding the four diseased sheep into Farmer Brumty's pen, north of
 * East Ardougne.
 *
 * Content facts (quest_sheepherder/scripts/*, configs/*, maps m40_51 / m40_52):
 *   - The pen (sheepherder_in_pen: x 2595-2609, z 3351-3364) is entered by the gate at
 *     (2594,3361)/(2594,3362). Its Open teleports you through; from the west side it
 *     wants the plague jacket AND trousers worn. The prod (obj 278) lies in the pen at
 *     (2604,3357); the furnace (2605,3360, 3x3, approached from the east) burns bones.
 *   - A sheep only moves when prodded with the prod wielded: npc_walk one tile AWAY from
 *     the player (coord_direction: the dominant axis, so stand cardinally behind it).
 *     A prod while the sheep stands in the gate zone (sheepherder_pen_gate: x 2592-2594,
 *     z 3360-3363) jumps it into the pen (bit 1 of its 3-bit field) as a temporary npc
 *     (150 ticks). Between prods the sheep's ai_timer (10-30 ticks) puts it back in
 *     wander mode, which walks it toward its spawn — so prod steadily.
 *   - Feed (obj 279, never consumed) used on a sheep INSIDE the pen kills it and drops
 *     its own bones (280-283) at its tile; bones on the furnace set the field to 6.
 *   - Three spawns of each sheep (m40_52 npc 292-295); only the type matters.
 */
import type { NearbyNpc } from '../../../sdk/types';
import { isFlagged, isTileWalkable } from '../../../sdk/pathfinding';
import type { Quest } from './run-quest';
import { readJournalCheckpoint } from '../../../quest-lab/journal-reader';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
}

export const OBJ = { prod: 278, feed: 279, jacket: 284, trousers: 285 } as const;

export interface SheepDef {
    n: number;
    word: string;
    name: RegExp;
    bones: number;
    /** The three spawns (m40_52). */
    spawns: Tile[];
}

export const SHEEP: SheepDef[] = [
    { n: 1, word: 'first', name: /^diseased sheep 1$/i, bones: 280, spawns: [{ x: 2609, z: 3344 }, { x: 2610, z: 3343 }, { x: 2610, z: 3345 }] },
    { n: 2, word: 'second', name: /^diseased sheep 2$/i, bones: 281, spawns: [{ x: 2621, z: 3367 }, { x: 2622, z: 3366 }, { x: 2623, z: 3367 }] },
    { n: 3, word: 'third', name: /^diseased sheep 3$/i, bones: 282, spawns: [{ x: 2560, z: 3389 }, { x: 2561, z: 3388 }, { x: 2561, z: 3390 }] },
    { n: 4, word: 'fourth', name: /^diseased sheep 4$/i, bones: 283, spawns: [{ x: 2610, z: 3391 }, { x: 2611, z: 3390 }, { x: 2612, z: 3391 }] },
];

/** The quest's journal button and title. */
export const JOURNAL = { label: 'Sheep Herder', title: 'Sheep Herder' };

const GATE = { x: 2594, z: 3361 };
/** West of the gate, outside; and the tile Open lands you on inside. */
const GATE_OUT = { x: 2593, z: 3361 };
const GATE_IN = { x: 2595, z: 3361 };
const PROD_SPAWN = { x: 2604, z: 3357 };
const FURNACE = { x: 2605, z: 3360 };
/** East of the furnace (forceapproach=east). */
const FURNACE_FRONT = { x: 2608, z: 3361 };

const inBox = (p: Tile, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
export const inPen = (p: Tile) => inBox(p, 2595, 2609, 3351, 3364);
const inGateZone = (p: Tile) => inBox(p, 2592, 2594, 3360, 3363);

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z})`;
const holds = (q: Quest, id: number) => q.sdk.getInventory().some((i) => i.id === id) || q.sdk.getEquipment().some((i) => i.id === id);
const wearing = (q: Quest, id: number) => q.sdk.getEquipment().some((i) => i.id === id);
const tileOf = (n: NearbyNpc): Tile => ({ x: n.tileX ?? n.x, z: n.tileZ ?? n.z });

// ── the sheep's route: cardinal steps the prod can make

const BLOCK = { W: 2359560, E: 2359680, S: 2359554, N: 2359584 };
const DIRS = [
    { dx: 1, dz: 0, into: BLOCK.W },
    { dx: -1, dz: 0, into: BLOCK.E },
    { dx: 0, dz: 1, into: BLOCK.S },
    { dx: 0, dz: -1, into: BLOCK.N },
] as const;
const key = (t: Tile) => `${t.x},${t.z}`;
const edgeKey = (a: Tile, b: Tile) => `${key(a)}>${key(b)}`;

/**
 * Edges the static snapshot gets wrong: its doors are masked open, but the pen gate
 * stays shut for a sheep (and for a player, it teleports).
 */
const blockedEdges = new Set<string>();
for (const z of [3361, 3362]) {
    blockedEdges.add(edgeKey({ x: 2594, z }, { x: 2595, z }));
    blockedEdges.add(edgeKey({ x: 2595, z }, { x: 2594, z }));
}
/**
 * Edges a prod failed on, until the wall-clock time stored: another npc standing there
 * blocks a sheep for a moment (warrior women, goblins and the other sheep 3s by its spawn).
 */
const avoidEdges = new Map<string, number>();
const AVOID_MS = 20_000;

function canStep(a: Tile, dx: number, dz: number, into: number): boolean {
    const b = { x: a.x + dx, z: a.z + dz };
    const k = edgeKey(a, b);
    if (blockedEdges.has(k)) return false;
    const until = avoidEdges.get(k);
    if (until !== undefined) {
        if (until > Date.now()) return false;
        avoidEdges.delete(k);
    }
    return isTileWalkable(0, b.x, b.z) && !isFlagged(b.x, b.z, 0, into);
}

/**
 * Shortest prod route from `from` into the gate zone: each step needs the tile behind
 * the sheep walkable and open to it (the player prods from there). Outside the pen only.
 */
export function sheepRoute(from: Tile, limit = 120): Tile[] | null {
    const prev = new Map<string, Tile | null>([[key(from), null]]);
    const queue: Tile[] = [from];
    while (queue.length) {
        const cur = queue.shift()!;
        if (inGateZone(cur)) {
            const out: Tile[] = [];
            for (let t: Tile | null = cur; t; t = prev.get(key(t)) ?? null) out.unshift(t);
            return out;
        }
        if (Math.abs(cur.x - from.x) > limit || Math.abs(cur.z - from.z) > limit) continue;
        for (const d of DIRS) {
            const next = { x: cur.x + d.dx, z: cur.z + d.dz };
            const behind = { x: cur.x - d.dx, z: cur.z - d.dz };
            if (prev.has(key(next)) || inPen(next)) continue;
            if (!canStep(cur, d.dx, d.dz, d.into)) continue;
            // The player stands behind: walkable, and no wall between it and the sheep.
            if (!isTileWalkable(0, behind.x, behind.z) || inPen(behind) || !canStep(behind, d.dx, d.dz, d.into)) continue;
            prev.set(key(next), cur);
            queue.push(next);
        }
    }
    return null;
}

// ── journal

export type SheepStatus = 'todo' | 'herded' | 'killed' | 'done';

/** Per-sheep progress from the journal lines (sheepherder_journal.rs2), or null if the journal did not open. */
export async function sheepStatus(q: Quest): Promise<Record<number, SheepStatus> | null> {
    const read = await readJournalCheckpoint(q.sdk, JOURNAL, { id: 'sheepherder:probe', kind: 'active', all: ['Councillor Halgrive'] });
    await q.bot.closeInterface().catch(() => undefined);
    const text = read.rawLines.map((l) => l.text).join(' ');
    if (!text) return null;
    const out: Record<number, SheepStatus> = {};
    const allDone = /should return to\s*Councillor Halgrive|QUEST COMPLETE/i.test(text);
    for (const s of SHEEP) {
        if (allDone || new RegExp(`killed the ${s.word} sheep and incinerated`, 'i').test(text)) out[s.n] = 'done';
        else if (new RegExp(`killed the ${s.word} sheep\\. Now I must incinerate`, 'i').test(text)) out[s.n] = 'killed';
        else if (new RegExp(`herded the ${s.word} sheep to the pen`, 'i').test(text)) out[s.n] = 'herded';
        else out[s.n] = 'todo';
    }
    return out;
}

// ── kit

async function equip(q: Quest, id: number, label: string): Promise<void> {
    if (wearing(q, id)) return;
    const item = q.sdk.getInventory().find((i) => i.id === id);
    if (!item) throw new Error(`sheepherder: no ${label} to wear (carrying ${q.sdk.getInventory().map((i) => i.name).join(', ') || 'nothing'})`);
    const res = await q.bot.equipItem(item);
    if (!res.success && !(await untilTicks(q.sdk, () => wearing(q, id), 4))) throw new Error(`sheepherder: could not wear the ${label}: ${res.message}`);
}

/** The feed from Halgrive and the suit from Orbon, worn. */
export async function ensureKit(q: Quest, halgrive: Tile, orbon: Tile): Promise<void> {
    if (!holds(q, OBJ.feed)) {
        q.log('sheepherder: no feed — Halgrive hands out more');
        await q.talk(/^councillor halgrive$/i, [], halgrive);
        if (!holds(q, OBJ.feed)) throw new Error('sheepherder: Halgrive gave no feed');
    }
    if (!holds(q, OBJ.jacket) || !holds(q, OBJ.trousers)) {
        q.log('sheepherder: no protective suit — buying another from Doctor Orbon');
        await q.ensure('coins', 100);
        await q.talk(/^doctor orbon$/i, [/ok,? i'?ll take it/i], orbon);
        if (!holds(q, OBJ.jacket) || !holds(q, OBJ.trousers)) throw new Error('sheepherder: Doctor Orbon sold no suit');
    }
    await equip(q, OBJ.jacket, 'plague jacket');
    await equip(q, OBJ.trousers, 'plague trousers');
}

// ── the pen

async function gateLoc(q: Quest) {
    await q.sdk.scanNearbyLocs(8).catch(() => undefined);
    return (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => /^gate$/i.test(l.name) && l.optionsWithIndex.some((o) => /^open$/i.test(o.text)) && Math.abs(l.x - GATE.x) <= 1 && Math.abs(l.z - 3361.5) <= 1.5)
        .sort((a, b) => Math.hypot(a.x - pos(q).x, a.z - pos(q).z) - Math.hypot(b.x - pos(q).x, b.z - pos(q).z))[0];
}

/** Through the pen gate, in or out (its Open teleports you across). */
async function crossGate(q: Quest, wantIn: boolean): Promise<void> {
    for (let attempt = 1; attempt <= 4; attempt++) {
        if (inPen(pos(q)) === wantIn) return;
        if (Math.hypot(pos(q).x - GATE.x, pos(q).z - GATE.z) > 3) {
            // Near the gate, a plain walk: walkTo plans through the gate (masked open in its map) and
            // stalled 147 ticks two tiles away, while the penned sheep's 150 ticks ran out.
            if (wantIn && Math.hypot(pos(q).x - GATE.x, pos(q).z - GATE.z) > 12) await q.goTo(GATE_OUT, 1);
            else if (wantIn) {
                await q.sdk.sendWalk(GATE_OUT.x, GATE_OUT.z, true);
                await untilTicks(q.sdk, () => Math.hypot(pos(q).x - GATE_OUT.x, pos(q).z - GATE_OUT.z) <= 1, 20);
            } else {
                await q.sdk.sendWalk(GATE_IN.x, GATE_IN.z, true);
                await untilTicks(q.sdk, () => Math.hypot(pos(q).x - GATE_IN.x, pos(q).z - GATE_IN.z) <= 1, 20);
            }
        }
        const gate = await gateLoc(q);
        if (!gate) {
            q.log(`sheepherder: no pen gate in view from ${where(q)}`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        const opt = gate.optionsWithIndex.find((o) => /^open$/i.test(o.text))!;
        await q.sdk.sendInteractLoc(gate.x, gate.z, gate.id, opt.opIndex);
        if (await untilTicks(q.sdk, () => inPen(pos(q)) === wantIn || !!q.sdk.getDialog()?.isOpen, 15)) {
            if (q.sdk.getDialog()?.isOpen) {
                const said = await driveDialog(q.sdk, [], { ticks: 30, log: q.log });
                if (inPen(pos(q)) !== wantIn) q.log(`sheepherder: gate refused: ${said.slice(0, 160)}`);
            }
        }
        if (await untilTicks(q.sdk, () => inPen(pos(q)) === wantIn, 4)) {
            q.log(`sheepherder: ${wantIn ? 'into' : 'out of'} the pen at ${where(q)}`);
            return;
        }
    }
    throw new Error(`sheepherder: could not get ${wantIn ? 'into' : 'out of'} the pen (at ${where(q)})`);
}
export const leavePen = (q: Quest) => crossGate(q, false);

/** The prod from its spawn in the pen, wielded. */
async function ensureProd(q: Quest): Promise<void> {
    if (!holds(q, OBJ.prod)) {
        await crossGate(q, true);
        await q.sdk.sendWalk(PROD_SPAWN.x, PROD_SPAWN.z, true);
        await untilTicks(q.sdk, () => Math.hypot(pos(q).x - PROD_SPAWN.x, pos(q).z - PROD_SPAWN.z) <= 1, 20);
        for (let i = 0; i < 15 && !holds(q, OBJ.prod); i++) {
            await q.sdk.scanGroundItems(6).catch(() => undefined);
            const ground = (q.sdk.getState()?.groundItems ?? []).find((g) => g.id === OBJ.prod);
            if (!ground) {
                await q.sdk.waitForTicks(10);
                continue;
            }
            await q.sdk.sendPickup(ground.x, ground.z, ground.id);
            await untilTicks(q.sdk, () => holds(q, OBJ.prod), 10);
        }
        if (!holds(q, OBJ.prod)) throw new Error('sheepherder: no prod at its spawn in the pen');
        q.log('sheepherder: picked up the prod');
    }
    await equip(q, OBJ.prod, 'prod');
}

// ── herding

const sheepIn = (q: Quest, s: SheepDef) => (q.sdk.getNearbyNpcs() ?? []).filter((n) => s.name.test(n.name));

/** The sheep of type `s` outside the pen with the shortest prod route, walking to its spawns to find one. */
async function findSheep(q: Quest, s: SheepDef): Promise<{ npc: NearbyNpc; route: Tile[] }> {
    for (let look = 0; look < 6; look++) {
        const options = sheepIn(q, s)
            .filter((n) => !inPen(tileOf(n)))
            .map((npc) => ({ npc, route: sheepRoute(tileOf(npc)) }))
            .filter((o): o is { npc: NearbyNpc; route: Tile[] } => !!o.route)
            .sort((a, b) => a.route.length - b.route.length);
        if (options[0]) return options[0];
        const spawn = s.spawns[look % s.spawns.length]!;
        q.log(`sheepherder: no reachable ${s.name.source} in view from ${where(q)} — walking to its spawn (${spawn.x},${spawn.z})`);
        await q.goTo(spawn, 5);
        await untilTicks(q.sdk, () => sheepIn(q, s).length > 0, 5);
    }
    throw new Error(`sheepherder: no reachable diseased sheep ${s.n} found`);
}

/** Get the player onto `t` (a short hop with the client's own routing, which knows the shut gates). */
async function stepTo(q: Quest, t: Tile): Promise<boolean> {
    if (pos(q).x === t.x && pos(q).z === t.z) return true;
    const far = Math.hypot(pos(q).x - t.x, pos(q).z - t.z) > 14;
    if (far) await q.bot.walkTo(t.x, t.z, 0).catch(() => undefined);
    else await q.sdk.sendWalk(t.x, t.z, true);
    return untilTicks(q.sdk, () => pos(q).x === t.x && pos(q).z === t.z, far ? 30 : 12);
}

/** Prod sheep `s` along its route until it jumps into the pen. Returns false when it slipped away (find it again). */
async function herdOnce(q: Quest, s: SheepDef, npcIndex: number, budget: number): Promise<boolean> {
    const t0 = tickNow(q.sdk);
    let fails = 0;
    let since = cursor(q);
    while (tickNow(q.sdk) - t0 < budget) {
        if (jumped(q, since)) return true;
        const npc = (q.sdk.getNearbyNpcs() ?? []).find((n) => n.index === npcIndex);
        if (!npc) {
            q.log(`sheepherder: sheep ${s.n} (#${npcIndex}) out of view from ${where(q)}`);
            return false;
        }
        const at = tileOf(npc);
        if (inPen(at)) return true;
        const route = sheepRoute(at);
        if (!route) {
            q.log(`sheepherder: no prod route for sheep ${s.n} from (${at.x},${at.z})`);
            return false;
        }
        // In the gate zone already: any prod from behind jumps it in; else the next step.
        const next = route[1] ?? (() => {
            const d = DIRS.find((d) => {
                const b = { x: at.x - d.dx, z: at.z - d.dz };
                return isTileWalkable(0, b.x, b.z) && !inPen(b) && canStep(b, d.dx, d.dz, d.into);
            })!;
            return { x: at.x + d.dx, z: at.z + d.dz };
        })();
        const dx = next.x - at.x;
        const dz = next.z - at.z;
        const behind = { x: at.x - dx, z: at.z - dz };
        const me = pos(q);
        // Two tiles straight behind (the last push went this way): the prod's own approach steps onto
        // `behind`, its nearest tile beside the sheep, so no separate walk — a round trip saved per
        // tile, which is what keeps the sheep from wandering home between prods.
        const inLine = me.x === at.x - 2 * dx && me.z === at.z - 2 * dz && canStep(me, dx, dz, DIRS.find((d) => d.dx === dx && d.dz === dz)!.into);
        if (!inLine) {
            if (!(await stepTo(q, behind))) {
                if (++fails > 12) throw new Error(`sheepherder: cannot get behind sheep ${s.n} at (${at.x},${at.z}) from ${where(q)}`);
                continue;
            }
            // It may have wandered while we walked round.
            const now = (q.sdk.getNearbyNpcs() ?? []).find((n) => n.index === npcIndex);
            if (!now || tileOf(now).x !== at.x || tileOf(now).z !== at.z) continue;
        }
        since = cursor(q);
        await q.sdk.sendInteractNpc(npcIndex, 1, { route: inLine });
        const moved = await untilTicks(
            q.sdk,
            () => {
                const n = (q.sdk.getNearbyNpcs() ?? []).find((m) => m.index === npcIndex);
                return jumped(q, since) || !n || tileOf(n).x !== at.x || tileOf(n).z !== at.z;
            },
            inLine ? 6 : 5
        );
        if (q.sdk.getDialog()?.isOpen) {
            const said = await driveDialog(q.sdk, [], { ticks: 20, log: q.log });
            throw new Error(`sheepherder: prodding sheep ${s.n} answered: ${said.slice(0, 200)}`);
        }
        if (jumped(q, since)) return true;
        const after = (q.sdk.getNearbyNpcs() ?? []).find((m) => m.index === npcIndex);
        if (moved && after && tileOf(after).x === next.x && tileOf(after).z === next.z) {
            fails = 0;
            continue;
        }
        if (!moved && !inGateZone(at)) {
            // Blocked for now (another npc there) or for good: route round that edge for a while.
            avoidEdges.set(edgeKey(at, next), Date.now() + AVOID_MS);
            if (++fails > 20) throw new Error(`sheepherder: sheep ${s.n} will not move from (${at.x},${at.z})`);
            const npcsThere = (q.sdk.getNearbyNpcs() ?? []).filter((n) => tileOf(n).x === next.x && tileOf(n).z === next.z).map((n) => n.name);
            q.log(
                `sheepherder: sheep ${s.n} did not step (${at.x},${at.z}) -> (${next.x},${next.z}) from ${where(q)}${npcsThere.length ? ` [${npcsThere.join(', ')} there]` : ''}: ${linesSinceText(q, since) || 'no message'}`
            );
        }
    }
    return false;
}

function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
const linesSinceText = (q: Quest, since: number) =>
    (q.sdk.getState()?.gameMessages ?? [])
        .filter((m) => (m.observationId ?? m.tick) > since)
        .map((m) => m.text)
        .join(' / ');
const jumped = (q: Quest, since: number) =>
    (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > since && /jumps over the gate/i.test(m.text));

/** Herd sheep `s` into the pen. */
async function herd(q: Quest, s: SheepDef): Promise<void> {
    if (inPen(pos(q))) await crossGate(q, false);
    const t0 = tickNow(q.sdk);
    for (let round = 1; round <= 5; round++) {
        const { npc, route } = await findSheep(q, s);
        q.log(`sheepherder: herding sheep ${s.n} (#${npc.index}) from (${tileOf(npc).x},${tileOf(npc).z}), ${route.length - 1} steps to the gate`);
        if (await herdOnce(q, s, npc.index, 300 + 30 * route.length)) {
            q.log(`sheepherder: sheep ${s.n} jumped into the pen after ${tickNow(q.sdk) - t0}t`);
            return;
        }
    }
    throw new Error(`sheepherder: sheep ${s.n} never reached the pen`);
}

/** In the pen: feed sheep `s` (the temporary one the gate made), pick up its bones. */
async function kill(q: Quest, s: SheepDef): Promise<void> {
    await crossGate(q, true);
    for (let attempt = 1; attempt <= 4 && !holds(q, s.bones); attempt++) {
        const npc = sheepIn(q, s).find((n) => inPen(tileOf(n)));
        if (!npc) {
            const bonesOnGround = (await q.sdk.scanGroundItems(15).catch(() => [])).find((g) => g.id === s.bones);
            if (bonesOnGround) {
                await q.sdk.sendPickup(bonesOnGround.x, bonesOnGround.z, bonesOnGround.id);
                await untilTicks(q.sdk, () => holds(q, s.bones), 15);
                continue;
            }
            throw new Error(`sheepherder: sheep ${s.n} is not in the pen (it lasts 150 ticks there)`);
        }
        const feed = q.sdk.getInventory().find((i) => i.id === OBJ.feed)!;
        await q.sdk.sendUseItemOnNpc(feed.slot, npc.index);
        await untilTicks(q.sdk, () => !!q.sdk.getDialog()?.isOpen || !sheepIn(q, s).some((n) => n.index === npc.index), 20);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 30, log: q.log });
        await untilTicks(q.sdk, () => !sheepIn(q, s).some((n) => n.index === npc.index), 6);
        for (let i = 0; i < 6 && !holds(q, s.bones); i++) {
            const bones = (await q.sdk.scanGroundItems(10).catch(() => [])).find((g) => g.id === s.bones);
            if (!bones) {
                await q.sdk.waitForTicks(2);
                continue;
            }
            await q.sdk.sendPickup(bones.x, bones.z, bones.id);
            await untilTicks(q.sdk, () => holds(q, s.bones), 15);
        }
    }
    if (!holds(q, s.bones)) throw new Error(`sheepherder: no bones from sheep ${s.n}`);
    q.log(`sheepherder: killed sheep ${s.n}, holding its bones`);
}

/** Bones of sheep `s` into the furnace (in the pen). */
async function burn(q: Quest, s: SheepDef): Promise<void> {
    await crossGate(q, true);
    for (let attempt = 1; attempt <= 3 && holds(q, s.bones); attempt++) {
        await stepTo(q, FURNACE_FRONT);
        await q.sdk.scanNearbyLocs(8).catch(() => undefined);
        const furnace = (q.sdk.getNearbyLocs() ?? []).find((l) => /^furnace$/i.test(l.name) && Math.abs(l.x - FURNACE.x) <= 2 && Math.abs(l.z - FURNACE.z) <= 2);
        if (!furnace) throw new Error(`sheepherder: no furnace in the pen near ${where(q)}`);
        const bones = q.sdk.getInventory().find((i) => i.id === s.bones)!;
        const since = cursor(q);
        await q.sdk.sendUseItemOnLoc(bones.slot, furnace.x, furnace.z, furnace.id);
        await untilTicks(q.sdk, () => (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > since && /burn to dust/i.test(m.text)), 15);
    }
    if (holds(q, s.bones)) throw new Error(`sheepherder: sheep ${s.n}'s bones would not burn`);
    q.log(`sheepherder: burned sheep ${s.n}'s bones`);
}

/** Every sheep not yet disposed of: herd, kill, burn. Ends outside the pen. */
export async function disposeAll(q: Quest, halgrive: Tile, orbon: Tile): Promise<void> {
    if (inPen(pos(q))) await crossGate(q, false);
    await ensureKit(q, halgrive, orbon);
    await ensureProd(q);
    try {
        let status = await sheepStatus(q);
        if (!status) status = await sheepStatus(q);
        if (!status) throw new Error('sheepherder: could not read the journal');
        q.log(`sheepherder: sheep ${SHEEP.map((s) => `${s.n}:${status![s.n]}`).join(' ')}`);
        // Nearest the pen first: 2 (north-east), 4 (north), 3 (far north-west), 1 (south-east, round the farm).
        for (const n of [2, 4, 3, 1]) {
            const s = SHEEP.find((x) => x.n === n)!;
            if (status[n] === 'done') continue;
            if (!holds(q, s.bones)) {
                // 'herded' with no sheep left in the pen (it lasts 150 ticks) needs herding again.
                const penned = inPen(pos(q)) && sheepIn(q, s).some((m) => inPen(tileOf(m)));
                if (!penned) await herd(q, s);
                await kill(q, s);
            }
            await burn(q, s);
        }
    } finally {
        if (inPen(pos(q))) await crossGate(q, false).catch((e) => q.log(`sheepherder: leaving the pen: ${(e as Error).message}`));
    }
}
