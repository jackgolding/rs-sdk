// Set an OFFLINE player's skill levels by patching their .sav (offline debug only).
//
//   cd server/engine && bun tools/server/stat-set.ts <username> <stat=level,...> [--players-dir=data/players/main] [--web=http://localhost:8888]
//
// Example: bun tools/server/stat-set.ts jacklove5 attack=99,defence=99,strength=99,hitpoints=99,ranged=99,prayer=99 --web=http://127.0.0.1:8888
//
// Loads via the engine's own PlayerLoading/Player.save (byte-perfect, CRC handled),
// keeps a .bak, reload-verifies. Refuses when the player is online unless --force
// (in-memory state would overwrite the file on next save).
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

import InvType from '#/cache/config/InvType.js';
import ObjType from '#/cache/config/ObjType.js';
import VarPlayerType from '#/cache/config/VarPlayerType.js';
import VarBitType from '#/cache/config/VarBitType.js';
import { PlayerLoading } from '#/engine/entity/PlayerLoading.js';
import Player, { getLevelByExp, getExpByLevel } from '#/engine/entity/Player.js';
import { PlayerStatMap } from '#/engine/entity/PlayerStat.js';
import Packet from '#/io/Packet.js';

const argv = process.argv.slice(2);
const flags = new Map<string, string>();
const positional: string[] = [];
for (const a of argv) {
    if (a.startsWith('--')) {
        const [k, v] = a.slice(2).split('=');
        flags.set(k, v ?? 'true');
    } else {
        positional.push(a);
    }
}
const [usernameArg, specsArg] = positional;
if (!usernameArg || !specsArg) {
    console.error('usage: stat-set.ts <username> <stat=level,...> [--players-dir=...] [--web=...]');
    process.exit(1);
}
const fileKey = usernameArg.toLowerCase().replace(/[^a-z0-9]/g, '_');
const force = flags.get('force') === 'true';
const playersDir = flags.get('players-dir') ?? 'data/players/main';
const web = flags.get('web') ?? 'http://localhost:8080';
const savPath = join(playersDir, `${fileKey}.sav`);
const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

if (!existsSync(savPath)) {
    console.error(`no save at ${savPath}`);
    process.exit(1);
}

let online: boolean | null = null;
try {
    const res = await fetch(`${web}/playerpositions`, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
        const players = (await res.json()) as { name: string }[];
        online = players.some(p => p.name.toLowerCase().replace(/[^a-z0-9]/g, '_') === fileKey);
    }
} catch { /* engine down: warn below */ }
if (online === true && !force) {
    console.error(`${fileKey} is ONLINE (${web}). Log them out first. Override with --force.`);
    process.exit(2);
}
if (online === null) log(`warn: could not reach ${web}/playerpositions; make sure ${fileKey} is offline.`);

const idx = (s: string): number => {
    const i = PlayerStatMap.get(s.toUpperCase());
    if (typeof i === 'undefined') throw new Error(`unknown stat '${s}'`);
    return i;
};

InvType.load('data/pack');
ObjType.load('data/pack');
VarPlayerType.load('data/pack');
VarBitType.load('data/pack');

const player: Player = PlayerLoading.load(fileKey, new Packet(readFileSync(savPath)), null);
for (const spec of specsArg.split(',')) {
    const [s, l] = spec.split('=');
    const level = parseInt(l, 10);
    if (!s || !(level >= 1 && level <= 99)) throw new Error(`bad spec '${spec}', want stat=1..99`);
    const i = idx(s);
    player.stats[i] = getExpByLevel(level);
    player.baseLevels[i] = level;
    player.levels[i] = level;
    log(`${s} -> ${level} (${player.stats[i]} xp)`);
}

const bytes = Buffer.from(player.save(false));
writeFileSync(`${savPath}.bak`, readFileSync(savPath));
const tmp = `${savPath}.tmp`;
writeFileSync(tmp, bytes);
renameSync(tmp, savPath);

const rawCheck = readFileSync(savPath);
for (const spec of specsArg.split(',')) {
    const [s, l] = spec.split('=');
    const xp = rawCheck.readUInt32BE(28 + idx(s) * 5);
    if (xp !== getExpByLevel(parseInt(l, 10))) throw new Error(`verify failed for ${s}: file has ${xp} xp`);
}
void getLevelByExp;
log(`wrote ${savPath}, backup kept at .bak`);
process.exit(0);
