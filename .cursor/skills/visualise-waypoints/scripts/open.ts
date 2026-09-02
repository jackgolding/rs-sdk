#!/usr/bin/env bun
/**
 * Build a hover-for-tile-id map of walking waypoints and open it.
 *
 *   bun .cursor/skills/visualise-waypoints/scripts/open.ts \
 *     --title "Mine to bank" \
 *     --waypoints '[{"x":3270,"z":3380,"label":"leave mine"},{"x":3185,"z":3436}]'
 *
 *   bun .cursor/skills/visualise-waypoints/scripts/open.ts \
 *     --waypoints 3270,3380;3250,3395;3185,3436 --player 3285,3365
 */
import { readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { initPathfinding, isTileWalkable, isZoneAllocated } from '../../../../sdk/pathfinding.ts';

const ROOT = resolve(dirname(import.meta.path), '../../../..');
const VIEWER = join(dirname(import.meta.path), 'viewer.html');
const OUT = join(tmpdir(), 'rs-sdk-waypoints.html');

type Waypoint = { x: number; z: number; label?: string };

const LANDMARKS: Array<{ x: number; z: number; name: string }> = [
    { x: 3222, z: 3218, name: 'Lumbridge' },
    { x: 3253, z: 3290, name: 'Cow field' },
    { x: 3092, z: 3243, name: 'Draynor bank' },
    { x: 3185, z: 3436, name: 'Varrock west bank' },
    { x: 3285, z: 3365, name: 'SE Varrock mine' },
    { x: 2946, z: 3368, name: 'Falador east bank' },
    { x: 3012, z: 3355, name: 'Falador east bank' },
    { x: 3269, z: 3167, name: 'Al Kharid bank' },
    { x: 2725, z: 3490, name: "Seers' bank" },
    { x: 2744, z: 3444, name: 'Seers flax' }
];

function arg(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    if (i === -1) return undefined;
    return process.argv[i + 1];
}

function has(flag: string): boolean {
    return process.argv.includes(flag);
}

function parseWaypoints(raw: string): Waypoint[] {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
        const parsed = JSON.parse(trimmed) as Array<Partial<Waypoint> & { X?: number; Z?: number }>;
        return parsed.map((p, i) => {
            const x = p.x ?? p.X;
            const z = p.z ?? p.Z;
            if (!Number.isFinite(x) || !Number.isFinite(z)) {
                throw new Error(`Waypoint ${i + 1} is missing x/z`);
            }
            return { x: x as number, z: z as number, label: p.label };
        });
    }
    return trimmed.split(/[;|]/).map((pair, i) => {
        const [xs, zs, ...rest] = pair.split(',').map((s) => s.trim());
        const x = Number(xs);
        const z = Number(zs);
        if (!Number.isFinite(x) || !Number.isFinite(z)) {
            throw new Error(`Cannot parse waypoint ${i + 1}: "${pair}"`);
        }
        const label = rest.length ? rest.join(',') : undefined;
        return { x, z, label };
    });
}

function parseXZ(raw: string | undefined): { x: number; z: number } | undefined {
    if (!raw) return undefined;
    const [xs, zs] = raw.split(',').map((s) => s.trim());
    const x = Number(xs);
    const z = Number(zs);
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
        throw new Error(`Expected x,z got "${raw}"`);
    }
    return { x, z };
}

function usage(): never {
    console.error(`Usage:
  bun .cursor/skills/visualise-waypoints/scripts/open.ts --waypoints <json|x,z;x,z> [options]

Options:
  --title TEXT
  --player x,z
  --level N          default 0
  --pad N            tiles of margin (default 40)
  --out PATH         default ${OUT}
  --port N           local server port (default 4731)
  --no-open          write HTML but do not serve or launch a browser
`);
    process.exit(2);
}

if (has('--help') || has('-h')) usage();

const rawWaypoints = arg('--waypoints');
if (!rawWaypoints) usage();

const waypoints = parseWaypoints(rawWaypoints);
if (waypoints.length === 0) {
    console.error('Need at least one waypoint.');
    process.exit(1);
}

const player = parseXZ(arg('--player'));
const level = Number(arg('--level') ?? 0);
const pad = Math.max(8, Number(arg('--pad') ?? 40));
const title = arg('--title') ?? 'Waypoints';
const out = arg('--out') ?? OUT;

const xs = [...waypoints.map((w) => w.x), player?.x].filter((n): n is number => n != null);
const zs = [...waypoints.map((w) => w.z), player?.z].filter((n): n is number => n != null);
let originX = Math.min(...xs) - pad;
let originZ = Math.min(...zs) - pad;
let maxX = Math.max(...xs) + pad;
let maxZ = Math.max(...zs) + pad;

const MAX = 640;
if (maxX - originX + 1 > MAX) {
    const mid = Math.round((originX + maxX) / 2);
    originX = mid - (MAX >> 1);
    maxX = originX + MAX - 1;
}
if (maxZ - originZ + 1 > MAX) {
    const mid = Math.round((originZ + maxZ) / 2);
    originZ = mid - (MAX >> 1);
    maxZ = originZ + MAX - 1;
}

const width = maxX - originX + 1;
const height = maxZ - originZ + 1;

initPathfinding();

const tiles: number[] = new Array(width * height);
for (let z = originZ; z <= maxZ; z++) {
    for (let x = originX; x <= maxX; x++) {
        const i = (z - originZ) * width + (x - originX);
        if (!isZoneAllocated(level, x, z)) tiles[i] = 0;
        else tiles[i] = isTileWalkable(level, x, z) ? 1 : 2;
    }
}

const landmarks = LANDMARKS.filter(
    (lm) => lm.x >= originX && lm.x <= maxX && lm.z >= originZ && lm.z <= maxZ
);

const payload = {
    title,
    level,
    originX,
    originZ,
    width,
    height,
    tiles: tiles.join(''),
    waypoints,
    player: player ?? null,
    landmarks
};

const html = readFileSync(VIEWER, 'utf8').replace(
    '__PAYLOAD__',
    JSON.stringify(payload).replace(/</g, '\\u003c')
);
writeFileSync(out, html);

console.log(`Wrote ${out}`);
console.log(`Waypoints (${waypoints.length}):`);
for (const [i, wp] of waypoints.entries()) {
    const label = wp.label ? `  ${wp.label}` : '';
    console.log(`  ${i + 1}. ${wp.x}, ${wp.z}${label}`);
}
console.log('Hover a tile for (x, z) and id (level_mx_mz_lx_lz). Click copies { x, z }.');

if (has('--no-open')) process.exit(0);

const port = Number(arg('--port') ?? 4731);
const url = `http://127.0.0.1:${port}/`;
let ownsServer = false;
try {
    Bun.serve({
        port,
        fetch() {
            return new Response(Bun.file(out), {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }
    });
    ownsServer = true;
    console.log(`Serving ${url}`);
} catch {
    console.log(`Port ${port} busy; reusing ${url}`);
}

const proc = Bun.spawn(['open', url], { cwd: ROOT, stdout: 'ignore', stderr: 'inherit' });
await proc.exited;
if (ownsServer) await new Promise(() => {});
