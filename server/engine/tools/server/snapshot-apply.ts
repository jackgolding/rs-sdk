// Recreate a snapshotted player on the LOCAL server by writing their .sav.
//
//   cd server/engine && bun ../../tools/snapshot-player/apply.ts <snapshot.json> [--dry-run] [--force] [--players-dir=data/players/main] [--web=http://localhost:8080]
//
// What it does: loads the local .sav if one exists (preserving bank, quest
// varps incl. quest points, appearance, playtime, recovery items) and
// overwrites position, all 21 skill XPs, backpack inventory and worn
// equipment from the snapshot. No local save yet -> builds a fresh player
// from the engine defaults. Writes go through Player.save(), so the byte
// layout is always the engine's own (no hand-rolled SAV_VERSION to rot).
//
// The target must be OFFLINE on the local world: while the world holds the
// character, in-memory state wins and the next autosave/logout overwrites
// this file. Refuses when the player is online unless --force.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

import InvType from '#/cache/config/InvType.js';
import ObjType from '#/cache/config/ObjType.js';
import VarPlayerType from '#/cache/config/VarPlayerType.js';
import VarBitType from '#/cache/config/VarBitType.js';
// NOTE: PlayerLoading must come before the Player value import. Player.js and
// NetworkPlayer.js import each other; entering through PlayerLoading evaluates
// NetworkPlayer first so `extends Player` resolves (importing Player first
// crashes with "Cannot access 'Player' before initialization").
import { PlayerLoading } from '#/engine/entity/PlayerLoading.js';
import Player, { getLevelByExp } from '#/engine/entity/Player.js';
import Packet from '#/io/Packet.js';
import { fromBase37, toBase37 } from '#/util/JString.js';

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
if (!positional[0]) {
    console.error('usage: apply.ts <snapshot.json> [--dry-run] [--force] [--players-dir=data/players/main] [--web=...]');
    process.exit(1);
}
const dryRun = flags.get('dry-run') === 'true';
const force = flags.get('force') === 'true';
const playersDir = flags.get('players-dir') ?? 'data/players/main';
const web = flags.get('web') ?? 'http://localhost:8080';

interface Stack { slot: number; id: number; name?: string; count: number }
interface Snapshot {
    tool: string; version: number; username: string; fileKey: string; server: string; snapshotAt: string;
    player: { x: number; z: number; level: number; runEnergy: number };
    skills: { name: string; level: number; baseLevel: number; experience: number }[];
    inventory: Stack[]; equipment: Stack[];
}

const snap = JSON.parse(readFileSync(positional[0], 'utf-8')) as Snapshot;
if (snap.tool !== 'snapshot-player' || snap.version !== 1) throw new Error('not a snapshot-player v1 file');
if (!Array.isArray(snap.skills) || snap.skills.length !== 21) throw new Error(`snapshot has ${snap.skills?.length} skills, need 21`);

const fileKey = (snap.fileKey || snap.username).toLowerCase().replace(/[^a-z0-9]/g, '_');
const savPath = join(playersDir, `${fileKey}.sav`);
const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

// ---- target must be offline locally ----
let online: boolean | null = null;
try {
    const res = await fetch(`${web}/playerpositions`, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
        const players = (await res.json()) as { name: string }[];
        online = players.some(p => p.name.toLowerCase().replace(/[^a-z0-9]/g, '_') === fileKey);
    }
} catch { /* web down or unreachable: warn below */ }
if (online === true && !force) {
    console.error(`${fileKey} is ONLINE on the local world (${web}). Log them out first (in-memory state would overwrite this file on next save). Override with --force.`);
    process.exit(2);
}
if (online === null) log(`warn: could not reach ${web}/playerpositions; make sure ${fileKey} is offline locally.`);

// ---- engine config (same minimum as backfill-quest-points.ts) ----
InvType.load('data/pack');
ObjType.load('data/pack');
VarPlayerType.load('data/pack');
VarBitType.load('data/pack');
const INV = InvType.getId('inv');
const WORN = InvType.getId('worn');
if (INV === -1 || WORN === -1) throw new Error('inv/worn inventory types not found in data/pack');

// ---- base: existing save (preserves bank, quests, appearance) or fresh ----
let player: Player;
let hadSave = false;
if (existsSync(savPath)) {
    player = PlayerLoading.load(fileKey, new Packet(readFileSync(savPath)), null);
    hadSave = true;
    log(`loaded existing local save ${savPath} (playtime=${player.playtime}, bank/quests/appearance preserved)`);
} else {
    let hashInput = snap.username;
    try { toBase37(hashInput); } catch { hashInput = fileKey; }
    const n37 = toBase37(hashInput);
    player = new Player(fromBase37(n37), n37, n37);
    for (let i = 0; i < 21; i++) {
        player.stats[i] = 0;
        player.baseLevels[i] = 1;
        player.levels[i] = 1;
    }
    log(`no local save; building fresh player for "${snap.username}"`);
}

// ---- position ----
player.x = snap.player.x;
player.z = snap.player.z;
player.level = snap.player.level;
player.runenergy = snap.player.runEnergy;

// ---- stats: exact XP; boosted levels restored to max (fresh-login state) ----
for (let i = 0; i < 21; i++) {
    const xp = Math.max(0, Math.floor(snap.skills[i].experience));
    player.stats[i] = xp;
    player.baseLevels[i] = getLevelByExp(xp);
    player.levels[i] = player.baseLevels[i];
}

// ---- inventories: clear, then set snapshotted slots ----
function applyStacks(invId: number, label: string, stacks: Stack[]): void {
    const inv = player.getInventory(invId);
    if (!inv) throw new Error(`no ${label} inventory on player`);
    for (let s = 0; s < inv.capacity; s++) inv.set(s, null);
    let skipped = 0;
    for (const st of stacks) {
        if (!Number.isInteger(st.slot) || st.slot < 0 || st.slot >= inv.capacity) throw new Error(`${label} slot ${st.slot} out of range (capacity ${inv.capacity})`);
        if (!Number.isInteger(st.count) || st.count < 1) throw new Error(`${label}[${st.slot}]: bad count ${st.count}`);
        if (!ObjType.get(st.id)) {
            log(`warn: ${label}[${st.slot}]: unknown obj ${st.id} (${st.name ?? '?'}) on this rev - skipped`);
            skipped++;
            continue;
        }
        inv.set(st.slot, { id: st.id, count: st.count });
    }
    log(`${label}: ${stacks.length - skipped} stacks written${skipped ? `, ${skipped} skipped` : ''}`);
}
applyStacks(INV, 'inventory', snap.inventory);
applyStacks(WORN, 'equipment', snap.equipment);

player.combatLevel = player.getCombatLevel();

const bytes = Buffer.from(player.save(false));

if (dryRun) {
    log(`[dry-run] would write ${savPath} (${bytes.length} bytes). combat=${player.combatLevel} pos=(${player.x},${player.z},l${player.level})`);
    process.exit(0);
}

// ---- atomic write + reload verify ----
mkdirSync(playersDir, { recursive: true });
if (hadSave) writeFileSync(`${savPath}.bak`, readFileSync(savPath));
const tmp = `${savPath}.tmp`;
writeFileSync(tmp, bytes);
renameSync(tmp, savPath);

const check = PlayerLoading.load(fileKey, new Packet(readFileSync(savPath)), null);
const invCount = check.getInventory(INV)?.itemsFiltered.length ?? -1;
const wornCount = check.getInventory(WORN)?.itemsFiltered.length ?? -1;
if (check.x !== snap.player.x || check.stats[0] !== Math.floor(snap.skills[0].experience)) {
    throw new Error('verify failed: reloaded save does not match snapshot');
}
log(`wrote ${savPath} (${bytes.length} bytes, backup ${hadSave ? 'kept at .bak' : 'n/a (new file)'})`);
log(`verified: pos=(${check.x},${check.z},l${check.level}) atk_xp=${check.stats[0]} inv_stacks=${invCount} worn=${wornCount} combat=${check.combatLevel}`);
log(`preserved from local save: bank, quest varps/points, appearance, playtime. NOT snapshotted (SDK-blind): bank, quests.`);
log(`log in locally as ${snap.username} (any password works on first login - the account auto-registers and picks up this save).`);
process.exit(0);
