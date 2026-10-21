/**
 * quest-route-view — render one planned leg on the collision grid, as SVG.
 *
 *   bun tools/quest-route-view.ts <x1> <z1> <x2> <z2> [--level 0] [--radius 26] [--out leg.svg]
 *
 * WHY
 * "Show me the route you are trying to use" is the fastest way to settle an
 * argument about a blocked leg. The planner's own answer is a list of tiles, but
 * a list does not show WHY the walk refuses: a masked door tile, a wall the
 * client calls walkable, a gap that is 1 tile too narrow. This draws exactly
 * what `findLongPath` returns over the collision data the client uses, marks the
 * start and the goal, and rings every door the pathfinder has masked — so a
 * "no waypoints" or "stops N short" leg becomes visible instead of asserted.
 *
 * Offline only: reads sdk/collision-data.json via sdk/pathfinding, no world, no
 * account. Output is a standalone SVG (opens in any browser, attaches to chat).
 */
import { writeFileSync } from 'node:fs';

import { findLongPath, getDoorAt, isTileWalkable, initPathfinding } from '../sdk/pathfinding';

const argv = process.argv.slice(2);
const nums = argv.filter(a => !a.startsWith('--') && Number.isFinite(Number(a))).map(Number);
const flag = (name: string, dflt: number) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? dflt : Number(argv[i + 1]);
};
const outIdx = argv.indexOf('--out');
const out = outIdx === -1 ? 'route.svg' : argv[outIdx + 1]!;
if (nums.length < 4) {
    console.error('usage: bun tools/quest-route-view.ts <x1> <z1> <x2> <z2> [--level 0] [--radius 26] [--out file.svg]');
    process.exit(2);
}
const [x1, z1, x2, z2] = nums as [number, number, number, number];
const level = flag('level', 0);
const radius = flag('radius', 26);

initPathfinding();

const path = (findLongPath(level, x1, z1, x2, z2) as { x: number; z: number }[] | null) ?? [];
const W = Math.max(x2, x1) - Math.min(x2, x1) + radius * 2;
const H = Math.max(z2, z1) - Math.min(z2, z1) + radius * 2;
const minX = Math.min(x1, x2) - radius;
const maxX = Math.max(x1, x2) + radius;
const minZ = Math.min(z1, z2) - radius;
const maxZ = Math.max(z1, z2) + radius;
const cell = 14;
const cols = maxX - minX + 1;
const rows = maxZ - minZ + 1;
const px = (x: number) => (x - minX) * cell;
const py = (z: number) => (maxZ - z) * cell; // north-up

const parts: string[] = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell + 40}" height="${rows * cell + 70}" font-family="ui-monospace,Menlo,monospace">`);
parts.push(`<rect width="100%" height="100%" fill="#0f1115"/>`);

// tiles
for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
        const walk = isTileWalkable(level, x, z);
        const door = getDoorAt(level, x, z);
        const fill = door ? '#8a5a1a' : walk ? '#1b2430' : '#0a0c10';
        parts.push(`<rect x="${px(x)}" y="${py(z)}" width="${cell - 1}" height="${cell - 1}" fill="${fill}"/>`);
    }
}

// planned path
if (path.length) {
    const pts = [[x1, z1], ...path.map(p => [p.x, p.z])].map(([x, z]) => `${px(x! + 0.5)},${py(z! + 0.5)}`).join(' ');
    parts.push(`<polyline points="${pts}" fill="none" stroke="#3fa7ff" stroke-width="2.5" stroke-linejoin="round"/>`);
    for (const p of path) {
        parts.push(`<circle cx="${px(p.x + 0.5)}" cy="${py(p.z + 0.5)}" r="2.6" fill="#bfe3ff"/>`);
    }
}

// markers
const marker = (x: number, z: number, label: string, colour: string) => {
    parts.push(`<circle cx="${px(x + 0.5)}" cy="${py(z + 0.5)}" r="6" fill="none" stroke="${colour}" stroke-width="2.5"/>`);
    parts.push(`<text x="${px(x + 0.5) + 9}" y="${py(z + 0.5) - 6}" fill="${colour}" font-size="11">${label}</text>`);
};
marker(x1, z1, `start ${x1},${z1}`, '#39d353');
marker(x2, z2, `goal ${x2},${z2}`, '#ff6b6b');

const last = path[path.length - 1];
const title = `leg ${x1},${z1} -> ${x2},${z2} (l${level}) — ${path.length} waypoints` +
    (last ? `, ends ${Math.round(Math.hypot(last.x - x2, last.z - z2))} tiles from the goal` : ', NO PATH') +
    ` · ${W}x${H} tiles · brown = door tile the planner masks`;

parts.push(`<text x="10" y="${rows * cell + 28}" fill="#c9d1d9" font-size="12">${title}</text>`);
parts.push(`<text x="10" y="${rows * cell + 46}" fill="#8b949e" font-size="11">dark = unwalkable · slate = walkable · blue = findLongPath · generated offline from sdk/collision-data.json, no account used</text>`);
parts.push('</svg>');

writeFileSync(out, parts.join('\n'));
console.log(`${path.length} waypoint(s); wrote ${out}`);
if (last) console.log(`path ends at ${last.x},${last.z} — ${Math.round(Math.hypot(last.x - x2, last.z - z2))} tiles from ${x2},${z2}`);
