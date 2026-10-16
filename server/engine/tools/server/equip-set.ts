// Forge items directly into an OFFLINE player's worn equipment (offline debug only).
// Bypasses the wield click entirely — for items the SDK can't equip.
//
//   cd server/engine && bun tools/server/equip-set.ts <username> <slot=objId[:count],...> [--players-dir=data/players/main] [--web=http://127.0.0.1:8888]
//
// Worn slots (equip.constant): hat 0, back 1, front 2, rhand(weapon) 3,
// torso 4, lhand(shield) 5, arms 6, legs 7, head 8, hands 9, feet 10, jaw 11.
// Example: bun tools/server/equip-set.ts jacklove2 3=1305 --web=http://127.0.0.1:8888
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

import InvType from '#/cache/config/InvType.js';
import ObjType from '#/cache/config/ObjType.js';
import VarPlayerType from '#/cache/config/VarPlayerType.js';
import VarBitType from '#/cache/config/VarBitType.js';
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
const [usernameArg, specsArg] = positional;
if (!usernameArg || !specsArg) {
    console.error('usage: equip-set.ts <username> <slot=objId[:count],...>');
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

InvType.load('data/pack');
ObjType.load('data/pack');
VarPlayerType.load('data/pack');
VarBitType.load('data/pack');

const player: Player = PlayerLoading.load(fileKey, new Packet(readFileSync(savPath)), null);
const worn = player.getInventory(InvType.getId('worn'));
if (!worn) throw new Error('no worn inventory on player');
for (const spec of specsArg.split(',')) {
    const [s, o] = spec.split('=');
    const slot = parseInt(s, 10);
    const [idStr, countStr] = (o ?? '').split(':');
    const id = parseInt(idStr, 10);
    const count = parseInt(countStr ?? '1', 10);
    if (!(slot >= 0) || !(id > 0) || !(count > 0)) throw new Error(`bad spec '${spec}', want slot=objId[:count]`);
    worn.set(slot, { id, count });
    log(`worn slot ${slot} -> obj ${id} x${count}`);
}

const bytes = Buffer.from(player.save(false));
writeFileSync(`${savPath}.bak`, readFileSync(savPath));
const tmp = `${savPath}.tmp`;
writeFileSync(tmp, bytes);
renameSync(tmp, savPath);
log(`wrote ${savPath}, backup kept at .bak`);
process.exit(0);
