/**
 * Brimhaven Agility Arena: tickets for toadflax (the only toadflax source in this revision).
 *
 * Mechanics (server/content/scripts/minigames/game_agilityarena):
 *   - Cap'n Izzy No-Beard (2807,3190) takes 200 coins ("Pay", op3); the ladder (2809,3194) goes down
 *     to the arena, plane 3 of m43_149. Leaving by the ladder up clears the paid bit: 200 per entry.
 *   - 24 platforms ("rooms") on a 5x5 grid, 11 tiles apart, each with a Ticket Dispenser in the
 *     middle (pillar_coords.enum); the 25th, north-east, holds the ladder up. Every 98 ticks the
 *     clerk's timer moves the arrow (hint_coord) to a different random pillar, world-wide.
 *   - Tag (op1) the pillar under the arrow once per window. The first tag of a streak pays nothing;
 *     each consecutive window tagged after it pays one ticket. Missing a window ends the streak.
 *   - Platforms are linked by obstacles (op1) or trapped bridges (walk over). Fails cost
 *     5% hp + 2: obstacles drop you into the pit below (climbing ropes lead back up), traps push
 *     you back. Floor spikes, pressure pads and hand holds need Agility 20, spinning blades and
 *     poison darts 40 (darts also drain 2 Agility).
 *   - Pirate Jackie the Fruit (2811,3192) "Trade" (op3) opens agilityarena_trade: toadflax 3
 *     tickets (com_89), snapdragon 10, pirate's hook 800, or Agility xp.
 *
 * The arrow is the server's hint arrow: state.hintArrow (sdk/webclient 2026-11-05). On an older
 * client it is absent and the run falls back to probing pillars (a wrong one says so).
 */
import type { Quest } from './run-quest';
import { tickNow, untilTicks } from './ticks';
import type { NearbyLoc } from '../../../sdk/types';

/** South-west corner of m43_149: arena local coords are offsets from here. */
const AX = 2752;
const AZ = 9536;
const ARENA_LEVEL = 3;
export const ARENA_ENTRANCE = { x: 2809, z: 3192 };
const LADDER_DOWN = { x: 2809, z: 3194 };
/** Room 24's ladder up (local 53,54). */
const LADDER_UP = { x: AX + 53, z: AZ + 54 };
const ENTRY_FEE = 200;
export const TICKETS_PER_TOADFLAX = 3;
/** agilityarena_trade:com_89 "Buy for 3 tickets" (interface.pack 8382). */
const TOADFLAX_BUTTON = 8382;
const TRADE_INTERFACE = 8292;
/** Ticks between arrow moves (agilityarena_clerk.rs2: map_clock + 98). */
const WINDOW = 98;
const ENTRY_ROOM = 24;
/** ARENA_DEBUG=1: log every hop. */
const DEBUG = process.env.ARENA_DEBUG === '1';
/** ARENA_NO_ARROW=1: ignore state.hintArrow, as on a client that predates it (tests the probing fallback). */
const NO_ARROW = process.env.ARENA_NO_ARROW === '1';

const TICKET = /^agility arena ticket$/i;
const FOOD = /^(shark|swordfish|lobster|monkfish|bass|tuna|salmon|trout)$/i;

type Pt = { x: number; z: number };
const L = (x: number, z: number): Pt => ({ x: AX + x, z: AZ + z });

/** Pillar (and room centre) of room r: pillar_coords.enum. */
export function pillarOf(r: number): Pt {
    return L(9 + 11 * (r % 5), 10 + 11 * Math.floor(r / 5));
}

/** Room under a tile on the arena plane, null on a bridge, in the pit or outside. Interiors are 5x5. */
export function roomOf(p: { x: number; z: number; level: number }): number | null {
    if (p.level !== ARENA_LEVEL) return null;
    const lx = p.x - AX - 7;
    const lz = p.z - AZ - 8;
    if (lx < 0 || lz < 0) return null;
    const c = Math.floor(lx / 11);
    const r = Math.floor(lz / 11);
    if (c > 4 || r > 4 || lx % 11 > 4 || lz % 11 > 4) return null;
    return c + 5 * r;
}

export const inArena = (p: { x: number; z: number; level: number }) =>
    p.x >= AX && p.x < AX + 64 && p.z >= AZ && p.z < AZ + 64 && (p.level === ARENA_LEVEL || p.level === 0);

/** stat_random(agility, low, high) out of 256, at `lvl`. */
const pass = (lvl: number, low: number, high: number) => Math.min(1, (low + ((high - low) * (lvl - 1)) / 98) / 256);

type Kind = 'op' | 'walk' | 'planks';
interface Edge {
    a: number;
    b: number;
    kind: Kind;
    name: string;
    /** op: the obstacle's end on each side (the one nearer the start is used). planks: the row ends' x. */
    locs?: Pt[];
    /** Agility below this fails (traps) or refuses (hand holds) every time. */
    min?: number;
    /** stat_random bounds of the roll that can fail. */
    roll?: [number, number];
}

// Read off m43_149.jm2 plane 3 (each room-pair's bridge) and agilityarena.rs2 / _zones.rs2.
const OBST = {
    ledge: [140, 370] as [number, number],
    monkey: [160, 400] as [number, number],
    hand: [80, 280] as [number, number],
    log: [180, 420] as [number, number],
    rope: [200, 440] as [number, number],
    swing: [100, 310] as [number, number],
    pillar: [120, 340] as [number, number],
    wall: [220, 460] as [number, number],
    spikes: [60, 250] as [number, number],
    pads: [40, 230] as [number, number],
    saw: [30, 210] as [number, number],
    darts: [20, 190] as [number, number],
};
const op = (a: number, b: number, name: keyof typeof OBST, locs: Array<[number, number]>, min?: number): Edge => ({
    a, b, kind: 'op', name, locs: locs.map(([x, z]) => L(x, z)), roll: OBST[name], min,
});
const walk = (a: number, b: number, name: keyof typeof OBST | 'blades', min?: number): Edge => ({
    a, b, kind: 'walk', name, min, roll: name === 'blades' ? undefined : OBST[name],
});
export const EDGES: Edge[] = [
    // rows (west-east)
    op(0, 1, 'ledge', [[12, 10], [17, 10]]),
    op(1, 2, 'monkey', [[22, 9], [29, 9]]),
    op(2, 3, 'hand', [[33, 8], [40, 8]], 20),
    op(3, 4, 'ledge', [[45, 10], [50, 10]]),
    { a: 5, b: 6, kind: 'planks', name: 'planks', locs: [L(12, 0), L(17, 0)] },
    walk(6, 7, 'saw', 40),
    walk(7, 8, 'darts', 40),
    walk(8, 9, 'pads', 20),
    op(10, 11, 'swing', [[14, 33], [15, 31]]),
    walk(11, 12, 'darts', 40),
    op(12, 13, 'pillar', [[34, 32], [39, 32]]),
    walk(13, 14, 'spikes', 20),
    op(15, 16, 'log', [[12, 43], [17, 43]]),
    walk(16, 17, 'saw', 40),
    walk(17, 18, 'blades'),
    walk(18, 19, 'pads', 20),
    op(20, 21, 'ledge', [[12, 54], [17, 54]]),
    op(21, 22, 'wall', [[25, 54]]),
    op(22, 23, 'hand', [[33, 56], [40, 56]], 20),
    { a: 23, b: 24, kind: 'planks', name: 'planks', locs: [L(45, 0), L(50, 0)] },
    // columns (south-north)
    op(0, 5, 'pillar', [[9, 13], [9, 18]]),
    walk(10, 15, 'spikes', 20),
    walk(15, 20, 'blades'),
    walk(1, 6, 'spikes', 20),
    op(6, 11, 'rope', [[20, 23], [20, 30]]),
    op(11, 16, 'monkey', [[19, 34], [19, 41]]),
    walk(16, 21, 'pads', 20),
    walk(2, 7, 'blades'),
    op(7, 12, 'wall', [[31, 26]]),
    walk(12, 17, 'saw', 40),
    op(17, 22, 'rope', [[31, 45], [31, 52]]),
    op(3, 8, 'rope', [[42, 12], [42, 19]]),
    op(8, 13, 'monkey', [[41, 23], [41, 30]]),
    walk(13, 18, 'darts', 40),
    op(18, 23, 'log', [[42, 46], [42, 51]]),
    op(4, 9, 'log', [[53, 13], [53, 18]]),
    op(9, 14, 'wall', [[53, 26]]),
    op(14, 19, 'pillar', [[53, 35], [53, 40]]),
    op(19, 24, 'swing', [[52, 48], [54, 49]]),
];

/** Expected ticks to cross: a fall costs a pit walk and a climb, a trap a push back. */
function edgeCost(e: Edge, agility: number): number {
    if (e.min && agility < e.min) return Infinity;
    const base = e.kind === 'walk' ? 8 : 12;
    if (!e.roll) return base + (e.name === 'blades' ? 4 : 0);
    const p = Math.max(0.05, pass(agility, e.roll[0], e.roll[1]));
    // Poison darts also drain 2 Agility a hit, which can drop the account under their 40 gate.
    const failCost = e.name === 'darts' ? 40 : e.kind === 'walk' ? 12 : 40;
    return base + ((1 - p) / p) * failCost;
}

/** Cheapest route between rooms: Dijkstra over EDGES. */
export function route(from: number, to: number, agility: number): Edge[] | null {
    const dist = new Array(25).fill(Infinity);
    const prev: Array<Edge | null> = new Array(25).fill(null);
    const done = new Array(25).fill(false);
    dist[from] = 0;
    for (;;) {
        let u = -1;
        for (let i = 0; i < 25; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
        if (u < 0 || u === to) break;
        done[u] = true;
        for (const e of EDGES) {
            if (e.a !== u && e.b !== u) continue;
            const v = e.a === u ? e.b : e.a;
            const d = dist[u] + edgeCost(e, agility);
            if (d < dist[v]) {
                dist[v] = d;
                prev[v] = e;
            }
        }
    }
    if (dist[to] === Infinity) return null;
    const path: Edge[] = [];
    for (let v = to; v !== from; ) {
        const e = prev[v]!;
        path.unshift(e);
        v = e.a === v ? e.b : e.a;
    }
    return path;
}

/** Route cost in expected ticks (for the probing fallback's ordering). */
export function routeCost(from: number, to: number, agility: number): number {
    const r = route(from, to, agility);
    return r ? r.reduce((n, e) => n + edgeCost(e, agility), 0) : Infinity;
}

// ── runtime ──────────────────────────────────────────────────────────────────

const here = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const tickets = (q: Quest) => q.count(TICKET);
const agility = (q: Quest) => q.sdk.getSkill('Agility')?.level ?? q.level('agility');

/** The pillar room under the arrow; undefined: the client cannot see arrows (older image). */
function arrowRoom(q: Quest): number | null | undefined {
    const s = q.sdk.getState();
    if (!s || !('hintArrow' in s) || NO_ARROW) return undefined;
    const h = (s as { hintArrow?: { kind: string; x?: number; z?: number } | null }).hintArrow;
    if (!h || h.kind !== 'tile') return null;
    for (let r = 0; r < 24; r++) {
        const p = pillarOf(r);
        if (p.x === h.x && p.z === h.z) return r;
    }
    return null;
}

/** Game messages since tick `t0`. */
const messagesSince = (q: Quest, t0: number) => (q.sdk.getState()?.gameMessages ?? []).filter((m) => m.tick >= t0 && m.type === 0).map((m) => m.text);

async function dismiss(q: Quest): Promise<void> {
    for (let i = 0; i < 4 && q.sdk.getDialog()?.isOpen; i++) {
        await q.bot.dismissBlockingUI().catch(() => undefined);
        await untilTicks(q.sdk, (s) => !s.dialog?.isOpen, 2);
    }
}

async function eatIfLow(q: Quest): Promise<void> {
    const hp = q.sdk.getSkill('Hitpoints');
    if (!hp || hp.level > Math.max(10, hp.baseLevel * 0.5)) return;
    const food = q.sdk.getInventory().find((i) => FOOD.test(i.name));
    if (!food) {
        if (hp.level <= Math.max(6, hp.baseLevel * 0.25)) throw new Error(`arena: hp ${hp.level}/${hp.baseLevel} and no food`);
        return;
    }
    await q.bot.eatFood(food).catch(() => undefined);
}

async function locAt(q: Quest, at: Pt, name?: RegExp): Promise<NearbyLoc | undefined> {
    const match = (l: NearbyLoc) => l.x === at.x && l.z === at.z && (!name || name.test(l.name)) && l.optionsWithIndex.length > 0;
    const near = q.sdk.getState()?.nearbyLocs.find(match);
    if (near) return near;
    const scanned = await q.sdk.scanNearbyLocs(16).catch(() => [] as NearbyLoc[]);
    return scanned.find(match);
}

/**
 * Walk to a tile on the arena plane (the client routes; a trap on the way stops the walk: a
 * pass dives you over it, a fail pushes you back). Retries once the player stands still.
 */
async function stepTo(q: Quest, t: Pt, ticks = 20, tries = 4): Promise<boolean> {
    for (let i = 0; i < tries; i++) {
        const p = here(q);
        if (p.x === t.x && p.z === t.z) return true;
        await q.sdk.sendWalk(t.x, t.z, true).catch(() => undefined);
        const t0 = tickNow(q.sdk);
        let last = '';
        let still = 0;
        await untilTicks(
            q.sdk,
            (s) => {
                const key = `${s.player?.worldX},${s.player?.worldZ}`;
                still = key === last ? still + 1 : 0;
                last = key;
                return (s.player?.worldX === t.x && s.player?.worldZ === t.z) || s.player?.level !== ARENA_LEVEL || !!s.dialog?.isOpen || (tickNow(q.sdk) - t0 >= 3 && still >= 3);
            },
            ticks,
        );
        await dismiss(q);
        if (here(q).level !== ARENA_LEVEL) return false;
    }
    const p = here(q);
    return p.x === t.x && p.z === t.z;
}

/** The interior tile of room `r` nearest `from`. */
function entryTile(r: number, from: Pt): Pt {
    const c = pillarOf(r);
    return { x: Math.max(c.x - 2, Math.min(c.x + 2, from.x)), z: Math.max(c.z - 2, Math.min(c.z + 2, from.z)) };
}

/** Back up from the pit: the nearest climbing rope. */
async function climbOutOfPit(q: Quest): Promise<void> {
    for (let i = 0; i < 4 && here(q).level === 0 && inArena(here(q)); i++) {
        await dismiss(q);
        const ropes = (await q.sdk.scanNearbyLocs(20).catch(() => [] as NearbyLoc[])).filter((l) => /^climbing rope$/i.test(l.name));
        ropes.sort((a, b) => (b.reachable ? 1 : 0) - (a.reachable ? 1 : 0) || a.distance - b.distance);
        const rope = ropes[0];
        if (!rope) throw new Error(`arena: in the pit at ${here(q).x},${here(q).z} with no climbing rope in view`);
        const climb = rope.optionsWithIndex.find((o) => /climb/i.test(o.text));
        await q.sdk.sendInteractLoc(rope.x, rope.z, rope.id, climb?.opIndex ?? 1).catch(() => undefined);
        await untilTicks(q.sdk, (s) => s.player?.level === ARENA_LEVEL, 30);
    }
    if (here(q).level !== ARENA_LEVEL) throw new Error(`arena: could not climb out of the pit at ${here(q).x},${here(q).z}`);
}

/** The plank row with no broken plank on the outer middles (change_planks: one row is all whole). */
async function plankRow(q: Quest, e: Edge, fromWest: boolean): Promise<Pt | null> {
    const [w, east] = e.locs!;
    const zs = e.a === 5 ? [20, 21, 22] : [53, 54, 55];
    const locs = await q.sdk.scanNearbyLocs(16).catch(() => [] as NearbyLoc[]);
    // Whole middles: agilityarena_plank_middle / plank2_middle / plank3_middle (loc.pack 3573-3575);
    // broken is plank_broke1 (3576). Only a row seen whole counts: a loc missed by the scan is no proof.
    const whole = (x: number, z: number) => locs.some((l) => l.x === x && l.z === AZ + z && l.id >= 3573 && l.id <= 3575);
    for (const z of zs) {
        if ([1, 2, 3, 4].every((dx) => whole(w!.x + dx, z))) return { x: fromWest ? w!.x : east!.x, z: AZ + z };
    }
    return null;
}

/** Cross one edge from its end `from` to room `to`. True once standing in `to`. */
async function cross(q: Quest, e: Edge, to: number): Promise<boolean> {
    const start = here(q);
    const dest = pillarOf(to);
    if (e.kind === 'walk') {
        const t = entryTile(to, start);
        await stepTo(q, t, 25);
    } else {
        let target: Pt | null = null;
        if (e.kind === 'planks') {
            const fromWest = dest.x > start.x;
            target = await plankRow(q, e, fromWest);
            if (!target) {
                await q.sdk.waitForTicks(2);
                return false;
            }
        } else {
            target = [...e.locs!].sort((a, b) => Math.hypot(a.x - start.x, a.z - start.z) - Math.hypot(b.x - start.x, b.z - start.z))[0]!;
        }
        const loc = await locAt(q, target);
        if (!loc) {
            q.log(`arena: no ${e.name} at ${target.x - AX},${target.z - AZ}`);
            return false;
        }
        const t0 = tickNow(q.sdk);
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex[0]!.opIndex).catch(() => undefined);
        // Arrive and run the obstacle (forcemoves, 2-tick hand holds): into `to`, into the pit, or off
        // the start tile and still (a low wall lands on the bridge; a stumble puts you back).
        let last = '';
        let still = 0;
        await untilTicks(
            q.sdk,
            (s) => {
                const p = { x: s.player?.worldX ?? 0, z: s.player?.worldZ ?? 0, level: s.player?.level ?? 0 };
                const key = `${p.x},${p.z},${p.level}`;
                still = key === last ? still + 1 : 0;
                last = key;
                const moved = p.x !== start.x || p.z !== start.z;
                return p.level !== ARENA_LEVEL || roomOf(p) === to || (tickNow(q.sdk) - t0 >= 4 && moved && roomOf(p) !== roomOf(start) && still >= 3);
            },
            30,
        );
        if (here(q).level !== ARENA_LEVEL) {
            q.log(`arena: fell off the ${e.name} (${tickNow(q.sdk) - t0}t)`);
            await untilTicks(q.sdk, () => false, 3);
            await climbOutOfPit(q);
            return roomOf(here(q)) === to;
        }
        if (roomOf(here(q)) !== to) await stepTo(q, entryTile(to, here(q)), 12);
    }
    await dismiss(q);
    if (here(q).level === 0) await climbOutOfPit(q);
    return roomOf(here(q)) === to;
}

/** Tag the pillar of the room we stand in. Returns the outcome from the game messages. */
async function tag(q: Quest, r: number): Promise<'ticket' | 'first' | 'wrong' | 'already' | 'none'> {
    const p = pillarOf(r);
    const loc = await locAt(q, p, /^ticket dispenser$/i);
    if (!loc) return 'none';
    const t0 = tickNow(q.sdk);
    const before = tickets(q);
    await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => /tag/i.test(o.text))?.opIndex ?? 1).catch(() => undefined);
    const outcome = () => {
        if (tickets(q) > before) return 'ticket' as const;
        const msgs = messagesSince(q, t0).join(' | ');
        if (/received an agility arena ticket/i.test(msgs)) return 'ticket' as const;
        if (/flashing arrow/i.test(msgs)) return 'wrong' as const;
        if (/one ticket at a time/i.test(msgs)) return 'already' as const;
        if (/tag the next|more than one pillar/i.test(msgs)) return 'first' as const;
        return null;
    };
    await untilTicks(q.sdk, () => outcome() !== null, 15);
    // The mesbox / objbox follows the message: left open it blocks the player's arrow timer.
    await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 3);
    await dismiss(q);
    return outcome() ?? 'none';
}

/** Walk room to room to `goal`, replanning when `abort` says the goal moved. */
async function travel(q: Quest, goal: number, abort: () => boolean): Promise<boolean> {
    for (let hop = 0; hop < 16 && !abort(); hop++) {
        if (here(q).level === 0) await climbOutOfPit(q);
        let r = roomOf(here(q));
        if (r === null) {
            // On a bridge: back into the nearest room.
            const p = here(q);
            let best = 0;
            for (let i = 0; i < 25; i++) if (Math.hypot(pillarOf(i).x - p.x, pillarOf(i).z - p.z) < Math.hypot(pillarOf(best).x - p.x, pillarOf(best).z - p.z)) best = i;
            await stepTo(q, entryTile(best, p), 12);
            r = roomOf(here(q));
            if (r === null) return false;
        }
        if (r === goal) return true;
        const path = route(r, goal, agility(q));
        if (!path) throw new Error(`arena: no route from room ${r} to ${goal} at Agility ${agility(q)}`);
        const e = path[0]!;
        const next = e.a === r ? e.b : e.a;
        await eatIfLow(q);
        const th = tickNow(q.sdk);
        const ok = await cross(q, e, next);
        if (DEBUG) q.log(`arena: hop ${r}→${next} ${e.name} ${ok ? 'ok' : `FAILED (now ${here(q).x - AX},${here(q).z - AZ} L${here(q).level}: ${messagesSince(q, th).slice(-3).join(' / ')})`} ${tickNow(q.sdk) - th}t`);
    }
    return roomOf(here(q)) === goal;
}

/**
 * In the arena: tag arrow pillars until holding `want` tickets, `deadline` passes or the food is
 * gone. Returns tickets held.
 */
export async function earnTickets(q: Quest, want: number, maxTicks: number): Promise<number> {
    const t0 = tickNow(q.sdk);
    let lastLog = t0;
    let tagged = -1;
    let streak = 0;
    const probed = new Set<number>();
    let probeWindowStart = t0;
    while (tickets(q) < want && tickNow(q.sdk) - t0 < maxTicks && !q.stopRequested()) {
        if (here(q).level === 0) await climbOutOfPit(q);
        await eatIfLow(q);
        if (!q.sdk.getInventory().some((i) => FOOD.test(i.name)) && (q.sdk.getSkill('Hitpoints')?.level ?? 99) < (q.sdk.getSkill('Hitpoints')?.baseLevel ?? 99) * 0.5) {
            q.log('arena: out of food at half hp: leaving');
            break;
        }
        const arrow = arrowRoom(q);
        if (tickNow(q.sdk) - lastLog >= 300) {
            lastLog = tickNow(q.sdk);
            q.log(`arena: ${tickets(q)}/${want} tickets after ${lastLog - t0}t (arrow ${arrow ?? '?'}, in room ${roomOf(here(q)) ?? '-'}, hp ${q.sdk.getSkill('Hitpoints')?.level})`);
        }
        let goal: number;
        if (arrow === undefined) {
            // Older client, no arrow: probe the cheapest untried pillar; a window is ~98 ticks.
            if (tickNow(q.sdk) - probeWindowStart > WINDOW) {
                probed.clear();
                probeWindowStart = tickNow(q.sdk);
            }
            const from = roomOf(here(q)) ?? ENTRY_ROOM;
            const cands = [...Array(24).keys()].filter((r) => !probed.has(r) && r !== tagged);
            if (cands.length === 0) {
                probed.clear();
                continue;
            }
            goal = cands.sort((a, b) => routeCost(from, a, agility(q)) - routeCost(from, b, agility(q)))[0]!;
        } else if (arrow === null) {
            await untilTicks(q.sdk, () => arrowRoom(q) !== null, 10);
            continue;
        } else {
            goal = arrow;
            if (goal === tagged) {
                // Already tagged this window: wait for the arrow to move. No dialog may stay open:
                // the arrow (a NORMAL player timer) only moves while the player is free.
                for (let i = 0; i < WINDOW + 5 && arrowRoom(q) === goal; i += 2) {
                    await dismiss(q);
                    await untilTicks(q.sdk, () => arrowRoom(q) !== goal, 2);
                }
                continue;
            }
        }
        const reached = await travel(q, goal, () => arrow !== undefined && arrowRoom(q) !== goal);
        if (!reached) continue;
        const res = await tag(q, goal);
        if (res === 'ticket' || res === 'first' || res === 'already') {
            tagged = goal;
            streak = res === 'first' ? 1 : streak + 1;
            probed.clear();
            probeWindowStart = tickNow(q.sdk);
            q.log(`arena: tagged pillar ${goal} (${res}) — ${tickets(q)} tickets, ${tickNow(q.sdk) - t0}t`);
        } else if (res === 'wrong') {
            probed.add(goal);
        }
    }
    return tickets(q);
}

/** From Brimhaven: pay Cap'n Izzy and climb down. */
export async function enterArena(q: Quest): Promise<void> {
    if (inArena(here(q))) return;
    if (q.count('coins') < ENTRY_FEE) throw new Error(`arena: ${q.count('coins')} coins, need ${ENTRY_FEE} for Cap'n Izzy`);
    await q.goTo(ARENA_ENTRANCE, 2);
    for (let attempt = 0; attempt < 3 && !inArena(here(q)); attempt++) {
        const ladder = await locAt(q, LADDER_DOWN, /^ladder$/i);
        if (!ladder) throw new Error('arena: no ladder down by Cap\'n Izzy');
        const coins = q.count('coins');
        await q.sdk.sendInteractLoc(ladder.x, ladder.z, ladder.id, ladder.optionsWithIndex.find((o) => /climb/i.test(o.text))?.opIndex ?? 1).catch(() => undefined);
        await untilTicks(q.sdk, (s) => inArena({ x: s.player?.worldX ?? 0, z: s.player?.worldZ ?? 0, level: s.player?.level ?? 0 }) || !!s.dialog?.isOpen, 20);
        if (inArena(here(q))) break;
        // Not paid: "Ahoy there! Pay up first!". Pay is op3 and needs no dialog.
        await dismiss(q);
        const izzy = q.sdk.findNearbyNpc(/^cap'n izzy no-beard$/i);
        const pay = izzy?.optionsWithIndex.find((o) => /^pay$/i.test(o.text));
        if (!izzy || !pay) throw new Error("arena: Cap'n Izzy not in view to pay");
        await q.sdk.sendInteractNpc(izzy.index, pay.opIndex).catch(() => undefined);
        await untilTicks(q.sdk, () => q.count('coins') < coins || !!q.sdk.getDialog()?.isOpen, 20);
        await dismiss(q);
        q.log(`arena: paid Cap'n Izzy (${coins} → ${q.count('coins')} coins)`);
    }
    if (!inArena(here(q))) throw new Error('arena: could not get down the ladder');
    q.log(`arena: in at ${here(q).x},${here(q).z} (room ${roomOf(here(q))})`);
}

/** Back to room 24 and up the ladder. */
export async function leaveArena(q: Quest): Promise<void> {
    if (!inArena(here(q))) return;
    await travel(q, ENTRY_ROOM, () => false);
    for (let i = 0; i < 3 && inArena(here(q)); i++) {
        const ladder = await locAt(q, LADDER_UP, /^ladder$/i);
        if (!ladder) throw new Error('arena: no ladder up in the entry room');
        await q.sdk.sendInteractLoc(ladder.x, ladder.z, ladder.id, ladder.optionsWithIndex.find((o) => /climb/i.test(o.text))?.opIndex ?? 1).catch(() => undefined);
        await untilTicks(q.sdk, (s) => (s.player?.worldZ ?? 0) < 9000, 20);
    }
    if (inArena(here(q))) throw new Error('arena: could not climb the ladder out');
}

/** Pirate Jackie: tickets for toadflax, 3 each. Returns toadflax bought. */
export async function buyToadflax(q: Quest, n: number): Promise<number> {
    const before = q.count('toadflax');
    const jackie = () => q.sdk.findNearbyNpc(/^pirate jackie the fruit$/i);
    if (!jackie()) await q.goTo(ARENA_ENTRANCE, 2);
    // Fresh off the ladder the npc list lags a tick or two.
    await untilTicks(q.sdk, () => !!jackie(), 10);
    const npc = jackie();
    if (!npc) throw new Error('arena: Pirate Jackie not in view');
    const trade = npc.optionsWithIndex.find((o) => /^trade$/i.test(o.text));
    await q.sdk.sendInteractNpc(npc.index, trade?.opIndex ?? 3).catch(() => undefined);
    await untilTicks(q.sdk, (s) => s.modalInterface === TRADE_INTERFACE, 20);
    if (q.sdk.getState()?.modalInterface !== TRADE_INTERFACE) throw new Error(`arena: Jackie's exchange did not open (modal ${q.sdk.getState()?.modalInterface})`);
    for (let i = 0; i < n && tickets(q) >= TICKETS_PER_TOADFLAX && q.sdk.getInventory().length < 28; i++) {
        const t = tickets(q);
        await q.sdk.sendClickComponent(TOADFLAX_BUTTON).catch(() => undefined);
        await untilTicks(q.sdk, () => tickets(q) < t, 6);
        if (tickets(q) >= t) break;
    }
    await q.bot.closeInterface().catch(() => undefined);
    return q.count('toadflax') - before;
}

const hpLow = (q: Quest) => (q.sdk.getSkill('Hitpoints')?.level ?? 0) < (q.sdk.getSkill('Hitpoints')?.baseLevel ?? 0) * 0.5;
const hasFood = (q: Quest) => q.sdk.getInventory().some((i) => FOOD.test(i.name));

/**
 * Toadflax from the arena: from wherever we are (the mainland: Barnaby's boat), into the arena,
 * tickets until `count` toadflax are bought, and back out to Brimhaven. Needs 200 coins an entry
 * (plus the boat); eats whatever food is held.
 */
export async function arenaToadflax(q: Quest, count: number, opts: { maxTicks?: number } = {}): Promise<void> {
    const { toJungle } = await import('./jungle-potion');
    const t0 = tickNow(q.sdk);
    const budget = opts.maxTicks ?? 20_000;
    for (let trip = 0; trip < 4 && q.count('toadflax') < count && !q.stopRequested(); trip++) {
        const short = count - q.count('toadflax');
        const want = short * TICKETS_PER_TOADFLAX;
        if (tickets(q) < want) {
            if (budget - (tickNow(q.sdk) - t0) <= 200) break;
            if (!inArena(here(q))) {
                await toJungle(q, ARENA_ENTRANCE, 3);
                await enterArena(q);
            }
            const left = budget - (tickNow(q.sdk) - t0);
            const te = tickNow(q.sdk);
            const got = await earnTickets(q, want, left);
            q.log(`arena: ${got}/${want} tickets in ${tickNow(q.sdk) - te}t`);
            await leaveArena(q);
        } else if (inArena(here(q))) {
            await leaveArena(q);
        }
        if (tickets(q) >= TICKETS_PER_TOADFLAX) {
            if (!q.sdk.findNearbyNpc(/^pirate jackie the fruit$/i)) await toJungle(q, ARENA_ENTRANCE, 3);
            const bought = await buyToadflax(q, short);
            q.log(`arena: bought ${bought} toadflax (${q.count('toadflax')}/${count}, ${tickets(q)} tickets left) after ${tickNow(q.sdk) - t0}t`);
        }
        if (q.count('toadflax') < count && !hasFood(q) && hpLow(q)) break;
    }
    if (q.count('toadflax') < count) throw new Error(`arena: ${q.count('toadflax')}/${count} toadflax after ${tickNow(q.sdk) - t0}t`);
}
