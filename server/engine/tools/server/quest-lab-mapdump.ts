// Dump EVERY loc placed in one map square, with ids resolved to config keys.
//
//   cd server/engine && bun tools/server/quest-lab-mapdump.ts 41 156
//
// Offline map-data query: the maze's loc layout as the engine actually has it,
// which is what the in-game scans show (and what a locfind by guessed key cannot
// tell you — the key you assume may not be the one placed there).
import { readFileSync } from 'fs';
import { unzipSync } from 'fflate';
import LocType from '#/cache/config/LocType.js';
import Packet from '#/io/Packet.js';

LocType.load('data/pack');

const [mxArg, mzArg] = process.argv.slice(2);
if (!mxArg || !mzArg) {
    console.error('usage: bun tools/server/quest-lab-mapdump.ts <mapX> <mapZ>');
    process.exit(1);
}
const mx = Number(mxArg);
const mz = Number(mzArg);
const limit = Number(process.argv[3] ?? 400);
// Optional 4th positional: a regex over the loc key (default keeps the old
// ladder/rope/portal filter). Door recon is the common other use.
const wanted = new RegExp(process.argv[4] ?? 'ladder|rope|portal|exit|maze', 'i');

const entries = unzipSync(readFileSync('data/pack/.cache/maps-server.zip'));
const landKey = `l${mx}_${mz}`;
const buf = entries[landKey];
if (!buf) {
    console.error(`no map data for ${landKey}`);
    process.exit(1);
}

// Walk the land file's loc section the same way quest-lab-locfind does: a
// delta-encoded locId stream, each with a delta-encoded packed coord stream.
const packet = new Packet(buf);
let locId = -1;
let locIdOffset = packet.gsmarts();
const rows = new Map<string, string[]>();
let total = 0;
while (locIdOffset !== 0) {
    locId += locIdOffset;
    let coord = 0;
    let coordOffset = packet.gsmarts();
    while (coordOffset !== 0) {
        coord += coordOffset - 1;
        const z = coord & 0x3f;
        const x = (coord >> 6) & 0x3f;
        const level = (coord >> 12) & 0x3;
        const type = LocType.get(locId) as { debugname?: string; name?: string } | undefined;
        const key = type?.debugname ?? type?.name ?? `id_${locId}`;
        total++;
        const pos = `${mx * 64 + x},${mz * 64 + z}`;
        if (!rows.has(pos)) rows.set(pos, []);
        const line = `${key}(${locId}) plane ${level}`;
        if (!rows.get(pos)!.includes(line)) rows.get(pos)!.push(line);
        coordOffset = packet.gsmarts();
    }
    locIdOffset = packet.gsmarts();
}
console.log(`land ${landKey}: ${total} raw placements, ${rows.size} occupied tiles`);
const hits = [...rows.entries()].filter(([, v]) => v.some((s) => wanted.test(s)));
hits.sort((a, b) => a[0].localeCompare(b[0]));
for (const [pos, names] of hits.slice(0, limit)) console.log(`${pos}: ${names.join(' + ')}`);
console.log(`(${hits.length} rows mention ladder/rope/portal/exit/maze)`);
