// Build a FRESH, maxed, banked account for quest development (local only).
//
//   cd server/engine && bun tools/server/quest-lab-fixture.ts <fixture.json> <username> \
//     [--web=http://127.0.0.1:8888] [--players-dir=data/players/main] [--checkpoint-db=data/market.sqlite]
//
//   --inspect   resolve and print the fixture, write nothing
//
// Local-only tooling. The scripts it produces fixtures for must still be written
// against client-visible state only, because the demo server cannot be changed.
//
// A fixture name is ONE-SHOT. The first login enrols a Grand Exchange
// checkpoint row for the account, and from then on the `.sav` is not
// authoritative; this tool will refuse to re-provision that name. Changing a
// fixture therefore means a new name.
//
// Safety: fixtures are FRESH-ONLY and fail closed. The username must sit in the
// reserved `ql…` namespace, the account must be provably offline, and it must
// have neither a save file nor a Grand Exchange checkpoint row. That last guard
// is the important one: PlayerLoading.load prefers the market.sqlite row over
// the `.sav`, so patching a save for an account that already has a row yields
// work the next login silently discards. None of the older save tools check it.
//
// The write goes through the engine's own Player.save(), then round-trips
// through PlayerLoading.load — trustworthy here precisely because the account
// was proven to have no checkpoint row.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { Database } from 'bun:sqlite';

import InvType from '#/cache/config/InvType.js';
import ObjType from '#/cache/config/ObjType.js';
import VarPlayerType from '#/cache/config/VarPlayerType.js';
import VarBitType from '#/cache/config/VarBitType.js';
// PlayerLoading must be imported before the Player value import: Player and
// NetworkPlayer import each other, and entering through Player crashes with
// "Cannot access 'Player' before initialization".
import { PlayerLoading } from '#/engine/entity/PlayerLoading.js';
import Player, { getExpByLevel } from '#/engine/entity/Player.js';
import { PlayerStatMap } from '#/engine/entity/PlayerStat.js';
import { Inventory } from '#/engine/Inventory.js';
import Packet from '#/io/Packet.js';

import { assertFreshAccount, fileKeyFor, parseFixture } from './quest-lab-fixture-lib.js';

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
const [fixtureArg, usernameArg] = positional;
if (!fixtureArg || !usernameArg) {
    console.error('usage: quest-lab-fixture.ts <fixture.json> <username> [--inspect] [--web=...] [--players-dir=...] [--checkpoint-db=...]');
    process.exit(1);
}

const inspectOnly = flags.get('inspect') === 'true';
// Explicit loopback default. The older tools default to a dead :8080 and merely
// warn when it answers nothing, which silently disables their presence check.
const web = flags.get('web') ?? 'http://127.0.0.1:8888';
const playersDir = flags.get('players-dir') ?? 'data/players/main';
const checkpointDb = flags.get('checkpoint-db') ?? process.env.GE_DATABASE ?? 'data/market.sqlite';

const fileKey = fileKeyFor(usernameArg);
const savPath = join(playersDir, `${fileKey}.sav`);
const log = (...args: unknown[]) => console.log(...args);

const fixture = parseFixture(readFileSync(fixtureArg, 'utf-8'));
log(`fixture '${fixture.questId}' for ${fileKey} (${savPath})`);

// ── Gather observations, then fail closed ───────────────────────────────────
let positions: string[] | null = null;
try {
    const res = await fetch(`${web}/playerpositions`, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) positions = ((await res.json()) as { name: string }[]).map(p => p.name);
} catch {
    /* left null: assertFreshAccount refuses */
}

function readCheckpointOwners(path: string): string[] {
    if (!existsSync(path)) return [];
    try {
        const db = new Database(path, { readonly: true });
        try {
            const rows = db.query<{ owner: string }, []>('SELECT owner FROM accounts').all();
            return rows.map(r => r.owner);
        } finally {
            db.close();
        }
    } catch (error) {
        throw new Error(`could not read checkpoint rows from ${path}: ${(error as Error).message}`);
    }
}

try {
    assertFreshAccount({
        username: usernameArg,
        positions,
        savExists: existsSync(savPath),
        checkpointOwners: readCheckpointOwners(checkpointDb),
    });
} catch (error) {
    // Refuse legibly and non-zero: an unexplained stack reads like a crash,
    // and a fixture written against the wrong identity is worse than none.
    // A fixture name is ONE-SHOT: the first login enrols a Grand Exchange
    // checkpoint row for it, after which the save file is no longer
    // authoritative and this tool refuses the name for good. Re-provisioning a
    // changed fixture means a new name (qlcook2, qlcook3, ...), which is also
    // what staging needs. Reconcile the row offline only if you must reuse one.
    console.error(`REFUSED: ${(error as Error).message}`);
    console.error('hint: fixture names are one-shot — provision a fresh name for a changed fixture');
    process.exit(2);
}

// ── Load content config, resolve every name BEFORE writing ─────────────────
InvType.load('data/pack');
ObjType.load('data/pack');
VarPlayerType.load('data/pack');
VarBitType.load('data/pack');

const invId = (name: string): number => {
    const id = InvType.getId(name);
    if (id === -1) throw new Error(`unknown inventory type '${name}'`);
    return id;
};
const objId = (name: string): number => {
    const id = ObjType.getId(name);
    if (id === -1) throw new Error(`unknown object '${name}' — check server/content/pack/obj.pack`);
    return id;
};
const varpId = (name: string): number => {
    const id = VarPlayerType.getId(name);
    if (id === -1) throw new Error(`unknown varp '${name}'`);
    return id;
};

const bank = fixture.bank.map(e => ({ id: objId(e.name), count: e.count, name: e.name }));
const worn = fixture.worn.map(e => ({ id: objId(e.name), slot: e.slot, name: e.name }));
const varps = Object.entries(fixture.varps).map(([name, value]) => ({ id: varpId(name), value, name }));
const targetVarp = varpId(fixture.target.varp);
const tutorialVarp = varpId('tutorial');
const TUTORIAL_COMPLETE = 1000; // ^tutorial_complete, general/configs/quest.constant:1
if (targetVarp === tutorialVarp) throw new Error('target varp must not be the tutorial varp');

log(`resolved: ${bank.length} bank item(s), ${worn.length} worn item(s), ${varps.length} varp(s), target ${fixture.target.varp}=${fixture.target.unstarted}`);

if (inspectOnly) {
    log('--inspect: nothing written');
    process.exit(0);
}

// ── Build the account through the engine's own objects ─────────────────────
// An empty packet takes PlayerLoading's fresh-player path (stats zeroed, level 1s).
const player: Player = PlayerLoading.load(fileKey, new Packet(new Uint8Array(0)), null);

let maxed = 0;
for (const [, index] of PlayerStatMap) {
    player.stats[index] = getExpByLevel(99);
    player.baseLevels[index] = 99;
    player.levels[index] = 99;
    maxed++;
}

player.vars[tutorialVarp] = TUTORIAL_COMPLETE; // fixtures start past Tutorial Island
for (const entry of varps) player.vars[entry.id] = entry.value;
player.vars[targetVarp] = fixture.target.unstarted; // the quest under test stays unstarted

player.x = fixture.position.x;
player.z = fixture.position.z;
player.level = fixture.position.level;

function ensureInventory(typeId: number): Inventory {
    const existing = player.getInventory(typeId);
    if (existing) return existing;
    // Mirrors the engine's own lazy creation (Player.ts:1536-1538).
    const created = Inventory.fromType(typeId);
    player.invs.set(typeId, created);
    return created;
}

// Start with an empty backpack: supplies belong in the bank, and the script is
// expected to deposit-then-withdraw anyway.
ensureInventory(invId('inv'));
ensureInventory(invId('worn'));
const bankInv = ensureInventory(invId('bank'));
for (const entry of bank) bankInv.set(bankInv.nextFreeSlot, { id: entry.id, count: entry.count });
const wornInv = ensureInventory(invId('worn'));
for (const entry of worn) wornInv.set(entry.slot, { id: entry.id, count: 1 });

// ── Write atomically, then round-trip verify ───────────────────────────────
const bytes = Buffer.from(player.save(false));
const tmp = `${savPath}.tmp`;
writeFileSync(tmp, bytes);
renameSync(tmp, savPath);

// Raw byte checks first: independent of the loader.
const raw = readFileSync(savPath);
if (raw.readUInt16BE(0) !== PlayerLoading.SAV_MAGIC) throw new Error('verify failed: bad save magic');
if (raw.readUInt16BE(2) !== PlayerLoading.SAV_VERSION) throw new Error('verify failed: bad save version');
const rawX = raw.readUInt16BE(4);
const rawZ = raw.readUInt16BE(6);
const rawLevel = raw[8];
if (rawX !== fixture.position.x || rawZ !== fixture.position.z || rawLevel !== fixture.position.level) {
    throw new Error(`verify failed: file has (${rawX},${rawZ},l${rawLevel})`);
}
for (const [, index] of PlayerStatMap) {
    const xp = raw.readUInt32BE(28 + index * 5);
    if (xp !== getExpByLevel(99)) throw new Error(`verify failed: stat ${index} has ${xp} xp`);
}

// Then a full reload. Trustworthy only because this account was proven to have
// no checkpoint row — otherwise the loader could read a stale checkpoint and
// this check would be measuring the wrong thing.
const reloaded: Player = PlayerLoading.load(fileKey, new Packet(readFileSync(savPath)), null);
if (reloaded.vars[targetVarp] !== fixture.target.unstarted) throw new Error('verify failed: target quest not unstarted');
if (reloaded.vars[tutorialVarp] !== TUTORIAL_COMPLETE) throw new Error('verify failed: tutorial not complete');
for (const entry of varps) {
    if (reloaded.vars[entry.id] !== entry.value) throw new Error(`verify failed: varp ${entry.name}`);
}
const reloadedBank = reloaded.getInventory(invId('bank'))?.itemsFiltered ?? [];
for (const entry of bank) {
    const found = reloadedBank.find(s => s.id === entry.id);
    if (!found || found.count !== entry.count) throw new Error(`verify failed: bank item '${entry.name}'`);
}

log(JSON.stringify({
    username: fileKey,
    savePath: resolve(savPath),
    bytes: bytes.length,
    questId: fixture.questId,
    skillsMaxed: maxed,
    position: fixture.position,
    bank: bank.map(e => ({ name: e.name, id: e.id, count: e.count })),
    worn: worn.map(e => ({ name: e.name, id: e.id, slot: e.slot })),
    targetVarp: { name: fixture.target.varp, value: fixture.target.unstarted },
    tutorial: 'complete',
    verified: true,
}, null, 2));

process.exit(0);
