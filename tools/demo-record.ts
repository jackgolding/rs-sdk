#!/usr/bin/env bun
/**
 * show-me-how recorder: record a player's tile trail while they demo a fix.
 *   bun tools/demo-record.ts <PlayerName> [--web=http://127.0.0.1:8888] [--out=demos/]
 * Polls /playerpositions (read-only) once a second, appends on change,
 * rewrites demos/demo-<name>-<stamp>.json every poll so killing the
 * process keeps the trail. Compress to waypoints with --compress <file>.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const argv = process.argv.slice(2);
const flags = new Map<string, string>();
const positional: string[] = [];
for (const a of argv) {
    if (a.startsWith('--')) {
        const [k, v] = a.slice(2).split('=');
        flags.set(k, v ?? 'true');
    } else positional.push(a);
}

if (flags.has('compress')) {
    const file = flags.get('compress')!;
    const trail = JSON.parse(readFileSync(file, 'utf-8'));
    const pts: { x: number; z: number }[] = trail.points ?? trail;
    const waypoints: { x: number; z: number }[] = [];
    for (const p of pts) {
        const last = waypoints[waypoints.length - 1];
        const prev = waypoints[waypoints.length - 2];
        if (last && last.x === p.x && last.z === p.z) continue; // stationary
        // Drop `last` when it is collinear with prev -> p (straight line).
        if (prev && last) {
            const dx1 = last.x - prev.x;
            const dz1 = last.z - prev.z;
            const dx2 = p.x - last.x;
            const dz2 = p.z - last.z;
            if (dx1 * dz2 === dz1 * dx2 && dx1 * dx2 + dz1 * dz2 > 0) waypoints.pop();
        }
        waypoints.push({ x: p.x, z: p.z });
    }
    console.log(JSON.stringify(waypoints));
    process.exit(0);
}

const name = positional[0];
if (!name) {
    console.error('usage: bun tools/demo-record.ts <PlayerName> [--web=...] [--out=...]');
    process.exit(1);
}
const web = flags.get('web') ?? 'http://127.0.0.1:8888';
const outDir = flags.get('out') ?? join(process.cwd(), 'demos');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const file = join(outDir, `demo-${name.toLowerCase()}-${stamp}.json`);
const key = name.toLowerCase();
const points: { t: number; x: number; z: number; level: number }[] = [];
console.log(`recording ${name} from ${web} -> ${file}`);

for (;;) {
    try {
        const res = await fetch(`${web}/playerpositions`, { signal: AbortSignal.timeout(5000) });
        const players = (await res.json()) as { name: string; x: number; z: number; level: number }[];
        const me = players.find((p) => p.name.toLowerCase() === key);
        if (me) {
            const last = points[points.length - 1];
            if (!last || last.x !== me.x || last.z !== me.z || last.level !== me.level) {
                points.push({ t: Date.now(), x: me.x, z: me.z, level: me.level });
                console.log(`  @ ${me.x},${me.z} L${me.level} (${points.length} pts)`);
            }
        } else {
            console.log(`  ${name} not online`);
        }
        writeFileSync(file, JSON.stringify({ player: name, web, points }, null, 1));
    } catch (err) {
        console.log(`  poll failed: ${err instanceof Error ? err.message : err}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
}
