// Move an OFFLINE player's saved position (used for mass-relocation while
// the engine is down for restart). Writes go through Player.save(), so the
// byte layout is always the engine's own.
//
//   cd server/engine && bun tools/server/pos-set.ts <username> <x> <z> [level] [--force] [--players-dir=data/players/main] [--web=http://localhost:8880]
//
// Refuses when the player is online unless --force (in-memory state would
// overwrite the file on next save). Keeps a .bak, reload-verifies the write.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

import InvType from '#/cache/config/InvType.js';
import ObjType from '#/cache/config/ObjType.js';
import VarPlayerType from '#/cache/config/VarPlayerType.js';
import VarBitType from '#/cache/config/VarBitType.js';
// NOTE: PlayerLoading must come before the Player value import (circular
// Player <-> NetworkPlayer import; see snapshot-apply.ts).
import { PlayerLoading } from '#/engine/entity/PlayerLoading.js';
import Player from '#/engine/entity/Player.js';
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
const [usernameArg, xArg, zArg, levelArg] = positional;
if (!usernameArg || !xArg || !zArg) {
    console.error('usage: pos-set.ts <username> <x> <z> [level] [--force] [--players-dir=...] [--web=...]');
    process.exit(1);
}
const fileKey = usernameArg.toLowerCase().replace(/[^a-z0-9]/g, '_');
const x = parseInt(xArg, 10);
const z = parseInt(zArg, 10);
const level = parseInt(levelArg ?? '0', 10);
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

InvType.load('data/pack');
ObjType.load('data/pack');
VarPlayerType.load('data/pack');
VarBitType.load('data/pack');

const player: Player = PlayerLoading.load(fileKey, new Packet(readFileSync(savPath)), null);
log(`loaded ${savPath}: was (${player.x},${player.z},l${player.level})`);
player.x = x;
player.z = z;
player.level = level;

const bytes = Buffer.from(player.save(false));
writeFileSync(`${savPath}.bak`, readFileSync(savPath));
const tmp = `${savPath}.tmp`;
writeFileSync(tmp, bytes);
renameSync(tmp, savPath);

const rawCheck = readFileSync(savPath);
const rx = rawCheck.readUInt16BE(4), rz = rawCheck.readUInt16BE(6), rl = rawCheck[8];
if (rx !== x || rz !== z || rl !== level) {
    throw new Error(`verify failed: file has (${rx},${rz},l${rl}), want (${x},${z},l${level})`);
}
log(`wrote ${savPath}: now (${rx},${rz},l${rl}), backup kept at .bak`);
process.exit(0);
