/**
 * quest-room-map — draw one room, its pockets and DOORWAYS, and the path between two tiles.
 *
 *   bun tools/quest-room-map.ts <x1> <z1> <x2> <z2> --level 2 [--door x,z ...] [--from x,z --to x,z]
 *
 * Why this exists: `initPathfinding` masks every door tile (~2690 of them), so
 * BFS and findLongPath answer "no route" or stop short for any target on the far
 * side of a doorway — a room reads as two disconnected pockets. That is the
 * squire's Sir Vyvin room, and it is invisible in coordinates alone. This draws
 * the room from the SAME collision data the client uses, overlays the door tiles
 * the map data places (which the planner masks), and prints the shortest path
 * with door tiles treated as passable — i.e. what a human sees: "walk through
 * the door".
 *
 * Output: an ASCII map (one char per tile) plus the ordered tile list to walk
 * (raw `sendWalk` steps, since the planner cannot produce this route).
 */
import { findLongPath, getDoorAt, isTileWalkable, initPathfinding } from '../sdk/pathfinding';

const argv = process.argv.slice(2);
const nums: number[] = [];
const doors: { x: number; z: number }[] = [];
let from: { x: number; z: number } | null = null;
let to: { x: number; z: number } | null = null;
let level = 0;
for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--level') { level = Number(argv[++i]); continue; }
    if (a === '--door') { const [x, z] = argv[++i]!.split(',').map(Number); doors.push({ x: x!, z: z! }); continue; }
    if (a === '--from') { const [x, z] = argv[++i]!.split(',').map(Number); from = { x: x!, z: z! }; continue; }
    if (a === '--to') { const [x, z] = argv[++i]!.split(',').map(Number); to = { x: x!, z: z! }; continue; }
    const n = Number(a);
    if (Number.isFinite(n)) nums.push(n);
}
if (nums.length < 4) {
    console.error('usage: bun tools/quest-room-map.ts <x1> <z1> <x2> <z2> --level N [--door x,z]... [--from x,z --to x,z]');
    process.exit(2);
}
const [x1, z1, x2, z2] = nums as [number, number, number, number];
initPathfinding();

// Discover doors in the box as well as the ones passed in: the map's door tiles
// are exactly what the planner refuses to cross, and forgetting one makes a
// room look sealed when it is not.
const doorSet = new Set<string>(doors.map(d => `${d.x},${d.z}`));
for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
    for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) {
        if (getDoorAt(level, x, z)) doorSet.add(`${x},${z}`);
    }
}
const open = (x: number, z: number) => isTileWalkable(level, x, z) || doorSet.has(`${x},${z}`);
const inBox = (x: number, z: number) => x >= Math.min(x1, x2) && x <= Math.max(x1, x2) && z >= Math.min(z1, z2) && z <= Math.max(z1, z2);

/** BFS with door tiles passable (what a human walking through an open door sees). */
function route(a: { x: number; z: number }, b: { x: number; z: number }): { x: number; z: number }[] | null {
    const key = (x: number, z: number) => `${x},${z}`;
    const prev = new Map<string, string | null>();
    const seen = new Set<string>([key(a.x, a.z)]);
    const queue: { x: number; z: number }[] = [a];
    prev.set(key(a.x, a.z), null);
    while (queue.length) {
        const cur = queue.shift()!;
        if (cur.x === b.x && cur.z === b.z) break;
        // 8-way, like the game: a diagonal is only blocked when BOTH orthogonals
        // beside it are — corner-cutting through a single wall is legal, and a
        // 4-way BFS reports "no path" across a diagonal gap that a player walks.
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as [number, number][]) {
            const nx = cur.x + dx;
            const nz = cur.z + dz;
            if (!inBox(nx, nz) || !open(nx, nz)) continue;
            if (dx !== 0 && dz !== 0 && !open(cur.x + dx, cur.z) && !open(cur.x, cur.z + dz)) continue;
            const k = key(nx, nz);
            if (seen.has(k)) continue;
            seen.add(k);
            prev.set(k, key(cur.x, cur.z));
            queue.push({ x: nx, z: nz });
        }
    }
    if (!prev.has(key(b.x, b.z))) return null;
    const out: { x: number; z: number }[] = [];
    let cur: string | null = key(b.x, b.z);
    while (cur) {
        const [x, z] = cur.split(',').map(Number);
        out.push({ x: x!, z: z! });
        cur = prev.get(cur) ?? null;
    }
    return out.reverse();
}

const path = from && to ? route(from, to) : null;
const onPath = new Set((path ?? []).map(p => `${p.x},${p.z}`));

const rows: string[] = [];
for (let z = Math.max(z1, z2); z >= Math.min(z1, z2); z--) {
    let row = '';
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
        const k = `${x},${z}`;
        if (from && x === from.x && z === from.z) row += 'S';
        else if (to && x === to.x && z === to.z) row += 'G';
        else if (doorSet.has(k)) row += onPath.has(k) ? 'D' : 'd';
        else if (!isTileWalkable(level, x, z)) row += '#';
        else row += onPath.has(k) ? '+' : '.';
    }
    rows.push(`${String(z).padStart(5)} ${row}`);
}
const minX = Math.min(x1, x2);
console.log(`room ${x1},${z1} -> ${x2},${z2} · level ${level}`);
console.log(rows.join('\n'));
console.log(`      ${Array.from({ length: Math.max(x1, x2) - minX + 1 }, (_, i) => String((minX + i) % 10)).join('')}`);
console.log(`legend: # wall · . walkable · d door (masked to the planner) · D door on the route · S start · G goal · + path`);
console.log(`doors found in box: ${[...doorSet].join(' ') || '(none)'}`);
if (path) {
    console.log(`\npath (${path.length} tiles, door tiles passable) — raw sendWalk steps for the script:`);
    console.log(path.map(p => `${p.x},${p.z}`).join(' -> '));
} else if (from && to) {
    console.log('\nno path even with doors passable — the target is in a different plane or a walled-off pocket');
}
