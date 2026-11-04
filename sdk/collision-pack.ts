// Packs sdk/collision-data.json into sdk/collision-data.bin: the same zones/tiles/doors as flat
// Int32 rows, so initPathfinding reads typed arrays instead of parsing 1.27M small JS arrays
// that every bun process then kept alive (~140MB RSS per process, 2026-11-04).
//
//   bun sdk/collision-pack.ts            (the fleet image runs this at build time)
//
// Layout (little-endian Int32): [MAGIC, nZones, nTiles, nDoors, zoneW, tileW, doorW, ...zones, ...tiles, ...doors]
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export const COLLISION_MAGIC = 0x434f4c31; // "COL1"
export const COLLISION_JSON = join(import.meta.dir, 'collision-data.json');
export const COLLISION_BIN = join(import.meta.dir, 'collision-data.bin');

export function packCollision(jsonPath = COLLISION_JSON, binPath = COLLISION_BIN): number {
    const d = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
        zones: number[][];
        tiles: number[][];
        doors?: number[][];
    };
    const doors = d.doors ?? [];
    const rows = [d.zones, d.tiles, doors];
    const widths = [3, 4, 6];
    const hdr = [COLLISION_MAGIC, d.zones.length, d.tiles.length, doors.length, ...widths];
    const out = new Int32Array(hdr.length + rows.reduce((n, r, i) => n + r.length * widths[i]!, 0));
    out.set(hdr, 0);
    let o = hdr.length;
    rows.forEach((r, i) => {
        for (const row of r) {
            for (let k = 0; k < widths[i]!; k++) out[o + k] = row[k] ?? 0;
            o += widths[i]!;
        }
    });
    writeFileSync(binPath, Buffer.from(out.buffer));
    return out.byteLength;
}

if (import.meta.main) {
    const bytes = packCollision();
    console.log(`collision-data.bin: ${(bytes / 1048576).toFixed(1)}MB`);
}
