// Read a player's quest varps from the AUTHORITATIVE source.
//
// The journal is client-visible and therefore portable, but this reads the
// server's own state so the two can be compared: PlayerLoading prefers the
// market.sqlite checkpoint row over the `.sav`, so this reads whichever the
// engine would actually load at login rather than assuming the file.
//
// THIS IS NOT A LIVE-STATE ORACLE. The engine autosaves on
// World.PLAYER_SAVERATE = 1500 ticks (~10-15 min) plus on logout, so both the
// row and the file can lag the running game by up to that long. It answers
// "what would load at next login", which is the right question for fixture
// validation and the wrong one for verifying an action just performed. To check
// live state, read the game (journal/inventory), or make the player log out
// cleanly first. A stale read was mistaken for a failed quest once already.
//
//   cd server/engine && bun tools/server/quest-lab-varp-read.ts <username> [--name=cookquest,...]
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Database } from 'bun:sqlite';

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
    } else positional.push(a);
}
const usernameArg = positional[0];
if (!usernameArg) { console.error('usage: quest-lab-varp-read.ts <username> [--name=varp,...] [--players-dir=...] [--checkpoint-db=...]'); process.exit(1); }

const fileKey = usernameArg.toLowerCase().replace(/[^a-z0-9]/g, '_');
const playersDir = flags.get('players-dir') ?? 'data/players/main';
const checkpointDb = flags.get('checkpoint-db') ?? process.env.GE_DATABASE ?? 'data/market.sqlite';
const savPath = join(playersDir, `${fileKey}.sav`);

InvType.load('data/pack');
ObjType.load('data/pack');
VarPlayerType.load('data/pack');
VarBitType.load('data/pack');

// Which bytes would the engine actually load?
let bytes: Uint8Array | null = null;
let source = 'none';
if (existsSync(checkpointDb)) {
    try {
        const db = new Database(checkpointDb, { readonly: true });
        const row = db.query<{ save: Uint8Array }, [string]>('SELECT save FROM accounts WHERE owner=?').get(fileKey);
        db.close();
        if (row?.save) { bytes = new Uint8Array(row.save); source = `checkpoint row in ${checkpointDb}`; }
    } catch (e) { console.error(`checkpoint read failed: ${(e as Error).message}`); }
}
if (!bytes && existsSync(savPath)) { bytes = new Uint8Array(readFileSync(savPath)); source = savPath; }
if (!bytes) { console.error(`no save for ${fileKey}`); process.exit(2); }

const player: Player = PlayerLoading.load(fileKey, new Packet(bytes), null);

const names = (flags.get('name') ?? '').split(',').map(s => s.trim()).filter(Boolean);
if (names.length === 0) {
    // No filter: report every non-zero varp that has a name, so nothing is hidden.
    const out: Record<string, number> = {};
    for (let id = 0; id < player.vars.length; id++) {
        const value = player.vars[id];
        if (!value) continue;
        const name = VarPlayerType.get(id)?.debugname;
        if (name) out[name] = value;
    }
    console.log(JSON.stringify({ username: fileKey, source, nonZeroNamedVarps: out }, null, 2));
} else {
    const out: Record<string, number | null> = {};
    const missing: string[] = [];
    for (const name of names) {
        const id = VarPlayerType.getId(name);
        if (id === -1) { missing.push(name); out[name] = null; continue; }
        out[name] = player.vars[id] ?? 0;
    }
    console.log(JSON.stringify({ username: fileKey, source, varps: out, unknownNames: missing }, null, 2));
}

// Inventory + bank contents: proves whether a hand-in actually consumed items,
// which distinguishes "the quest completed" from "the snapshot is stale".
const invName = (id: number) => ObjType.get(id)?.name ?? `obj${id}`;
const inv = player.getInventory(InvType.getId('inv'));
const bankInv = player.getInventory(InvType.getId('bank'));
const carry = (inv?.itemsFiltered ?? []).map(i => `${invName(i.id)}x${i.count}`);
const banked = (bankInv?.itemsFiltered ?? []).map(i => `${invName(i.id)}x${i.count}`);
console.log(JSON.stringify({ inventory: carry, bank: banked }, null, 2));
process.exit(0);
