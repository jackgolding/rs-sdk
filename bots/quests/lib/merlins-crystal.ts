/**
 * Merlin's Crystal — the keep, the black candle, Excalibur, the Chaos Altar's
 * words and Thrantax.
 *
 * Content facts (quest_arthur/scripts/*.rs2, area_camelot/king_arthur.rs2,
 * sir_gawain.rs2, sir_lancelot.rs2, area_taverly/lady_of_the_lake.rs2,
 * area_catherby/candle_maker.rs2, area_seers/bees.rs2; maps m43_53, m43_54,
 * m47_50, m50_56):
 *   - King Arthur (2764,3515) starts it, Gawain (2763,3506) "how Merlin got
 *     trapped" (2), Lancelot (2759,3515,L1) "how to get into Morgan Le Faye's
 *     stronghold" (3)
 *   - from 3 the empty crate west of Arhein (2801,3442) "Hide-in" ships you to
 *     the keep's pier (^keep_crate_coord 2778,3401). Its stairs (2769,3404) lead to
 *     Sir Mordred (level 39, 38 hp). His death queue at 3 runs Morgan Le Faye's
 *     "spare my son" (4) and heals him; he stops fighting. Renegade knights
 *     (level 37, 48 hp) hunt players up to combat 74 that step next to them
 *   - the way out is the keep's front door (2763,3402): locked from outside, Open
 *     from inside drops you outside (x-1). The return crate (merlincrate_empty2) is
 *     not on the pier's plane (no crate in view there, 2026-11-01)
 *   - at 4: the candle maker (2800,3439) "Have you got any black candles?" sets a
 *     bit; with a bucket of wax he swaps it for a black candle. Wax: insect
 *     repellent on a Catherby beehive, then a bucket on it (bees.rs2)
 *   - the Lady of the Lake (2924,3405) "I seek the sword Excalibur" sets
 *     ^excalibur_started; then the Port Sarim jeweller's door (3016,3246) spawns the
 *     beggar: "Yes certainly." with bread turns him into the Lady, who hands Excalibur
 *   - the Chaos altar north of Varrock (3239,3608, Wilderness ~12) "Check" teaches the
 *     words (a bit the journal shows: "magic words from the Chaos Altar memorised")
 *   - in Camelot, bat bones dropped within a tile of the magic symbol (2780,3515)
 *     holding a lit black candle summon Thrantax: "Snarthon Candtrick Termanto" (5)
 *   - Excalibur on the giant crystal (2767,3493,L2, tower ladders 2769,3493 L0 and
 *     2767,3491 L1) frees Merlin (6); King Arthur completes it
 */
import type { Quest } from './run-quest';
import { readJournalCheckpoint } from '../../../quest-lab/journal-reader';
import { driveDialog } from './dialog';
import { tickNow, ticksToMs, untilTicks } from './ticks';
import { SAFE_BANKS } from '../safe-stops';
import { buyWaitingForRestock } from './sources';

interface Tile {
    x: number;
    z: number;
    level?: number;
}

export const JOURNAL = { label: "Merlin's Crystal", title: "Merlin's Crystal" };

export const ARTHUR = { x: 2764, z: 3515 };
export const GAWAIN = { x: 2763, z: 3506 };
const LANCELOT = { x: 2759, z: 3515, level: 1 };
/** Camelot's wooden stairs to the first floor (m42_54 woodenstairs). */
const CAMELOT_STAIRS = { x: 2751, z: 3509 };
const CATHERBY_CRATE = { x: 2801, z: 3442 };
const CANDLE_MAKER = { x: 2800, z: 3439 };
const LADY = { x: 2924, z: 3405 };
const JEWELLER_DOOR = { x: 3016, z: 3246 };
const CHAOS_ALTAR = { x: 3239, z: 3608 };
/** The road north out of Varrock, short of the Wilderness. */
const VARROCK_NORTH = { x: 3245, z: 3515 };
const MAGIC_SYMBOL = { x: 2780, z: 3515 };
const TOWER_LADDER = { x: 2769, z: 3493 };
const CRYSTAL = { x: 2767, z: 3493 };

/**
 * Below these the keep is a death risk even with sharks: renegade knights (37, 48 hp)
 * hunt anyone up to combat 74 who steps next to them, and Mordred (39, 38 hp) hits ~4.
 */
const KEEP_LEVELS: Record<string, number> = { attack: 30, strength: 30, defence: 25, hitpoints: 30 };
/** Food for the keep (mule stock: the knights and Sir Mordred). */
export const FOOD = { item: 'shark', count: 6 };
/** Best first; the first the bank holds and the account can wield is taken into the keep. */
const WEAPONS: Array<{ name: RegExp; attack: number }> = [
    { name: /^rune (scimitar|longsword|sword)$/i, attack: 40 },
    { name: /^adamant (scimitar|longsword|sword)$/i, attack: 30 },
    { name: /^mithril (scimitar|longsword|sword)$/i, attack: 20 },
    { name: /^black (scimitar|longsword|sword)$/i, attack: 10 },
    { name: /^steel (scimitar|longsword|sword)$/i, attack: 5 },
    { name: /^iron (scimitar|longsword|sword)$/i, attack: 1 },
    { name: /^bronze (scimitar|longsword|sword)$/i, attack: 1 },
];

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const near = (q: Quest, t: Tile, r: number) => Math.hypot(pos(q).x - t.x, pos(q).z - t.z) <= r;
const inBox = (p: { x: number; z: number }, x0: number, x1: number, z0: number, z1: number) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;

/** Keep Le Faye: the rock south of Camelot, reached only by Arhein's crate. */
export const inKeep = (p: { x: number; z: number; level?: number }) => inBox(p, 2764, 2786, 3390, 3410);
/** Inside the crate while it is shipped (p_teleport to 0_43_153_26_47). */
const inCrate = (p: { x: number; z: number }) => inBox(p, 2770, 2790, 9830, 9850);
/** Anywhere run-quest's goTo cannot walk out of: the keep, or the crate mid-voyage. */
export const inKeepArea = (p: { x: number; z: number; level?: number }) => inKeep(p) || inCrate(p);

export const holdsName = (q: Quest, name: RegExp) => q.sdk.getInventory().some((i) => name.test(i.name)) || q.sdk.getEquipment().some((i) => name.test(i.name));
const EXCALIBUR = /^excalibur$/i;
const LIT_CANDLE = /^lit black candle$/i;
const UNLIT_CANDLE = /^black candle$/i;

/** Newest game-message cursor, taken before an action so only replies to it match. */
function cursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}
function saidSince(q: Quest, since: number, text: RegExp): boolean {
    return (q.sdk.getState()?.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > since && text.test(m.text));
}

export async function eatIfLow(q: Quest, below = 0.5): Promise<void> {
    const p = q.sdk.getState()?.player;
    if (!p || p.hp > (p.maxHp ?? 10) * below) return;
    const food = q.sdk.getInventory().find((i) => i.optionsWithIndex?.some((o) => /^eat$/i.test(o.text)));
    if (food) await q.bot.eatFood(food).catch(() => undefined);
}

/** The loc named `name` (with option `opt`) nearest `at`, within `r` tiles of it. */
async function findLoc(q: Quest, at: Tile, name: RegExp, opt?: RegExp, r = 3) {
    await q.sdk.scanNearbyLocs(15).catch(() => undefined);
    const loc = (q.sdk.getNearbyLocs() ?? [])
        .filter((l) => name.test(l.name) && (!opt || l.optionsWithIndex.some((o) => opt.test(o.text))))
        .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
    return loc && Math.hypot(loc.x - at.x, loc.z - at.z) <= r ? loc : undefined;
}

/** Op on the loc named `name` near `at` until `done`, driving any dialog through `choices`. */
async function op(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string, choices: RegExp[] = [], ticks = 30): Promise<void> {
    for (let attempt = 1; attempt <= 4; attempt++) {
        if (done()) return;
        const loc = await findLoc(q, at, name, opt);
        if (!loc) {
            q.log(`merlin: ${label}: no ${name} with ${opt} near (${at.x},${at.z}) from ${where(q)} (attempt ${attempt})`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.bot.interactLoc(loc, opt).catch((e) => q.log(`merlin: ${label}: ${(e as Error).message}`));
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { done, ticks: 200, log: q.log });
        if (await untilTicks(q.sdk, done, 8)) return;
        q.log(`merlin: ${label} did not take from ${where(q)} (attempt ${attempt})`);
    }
    throw new Error(`merlin: ${label} failed at ${where(q)}`);
}

/** A stage's own journal line, read on demand (the altar's words are only in the journal). */
async function journalSays(q: Quest, text: string): Promise<boolean> {
    const read = await readJournalCheckpoint(q.sdk, JOURNAL, { id: `arthur:probe`, kind: 'active', all: [text] });
    return read.verdict?.verdict === 'PASS';
}

// ── sources (lib/sources.ts): the bucket of wax

const BEEHIVES = { x: 2758, z: 3443 };
const ARHEIN = { x: 2803, z: 3430, npc: /^arhein$/i };

/**
 * Insect repellent on a Catherby beehive (the bees leave), then a bucket on it: one
 * bucket of wax per pour (bees.rs2 clears %beehive_free on every take). Buckets
 * from Arhein's store when none are held (catherby.inv arheinstore).
 */
export async function beehiveWax(q: Quest, count: number): Promise<void> {
    const wax = () => q.count('bucket of wax');
    await q.ensure('insect repellent', 1);
    const buckets = count - wax() - q.count('bucket');
    if (buckets > 0) {
        await q.ensure('coins', 2 * buckets);
        await buyWaitingForRestock(q, ARHEIN, 'bucket', q.count('bucket') + buckets);
    }
    await q.goTo(BEEHIVES, 3);
    for (let misses = 0; misses < 4 && wax() < count; ) {
        const before = wax();
        const hive = (await findLoc(q, BEEHIVES, /^beehive$/i, /^take-from$/i, 8)) ?? null;
        if (!hive) throw new Error(`merlin: no beehive near (${BEEHIVES.x},${BEEHIVES.z}) from ${where(q)}`);
        const since = cursor(q);
        await q.bot.useItemOnLoc(/^insect repellent$/i, hive, { timeout: ticksToMs(20) });
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || saidSince(q, since, /insect repellent/i), 10);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 30, log: q.log });
        await q.bot.useItemOnLoc(/^bucket$/i, hive, { timeout: ticksToMs(20) });
        await untilTicks(q.sdk, (s) => wax() > before || !!s.dialog?.isOpen, 10);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done: () => false, ticks: 40, log: q.log });
        misses = wax() > before ? 0 : misses + 1;
        if (wax() === before) q.log(`merlin: beehive gave no wax (hp ${q.sdk.getState()?.player?.hp}, miss ${misses})`);
    }
    q.log(`merlin: ${wax()}/${count} bucket of wax`);
}

// ── stage 2 -> 3: Lancelot on Camelot's first floor

export async function askLancelot(q: Quest): Promise<void> {
    if (pos(q).level !== 1) await q.goTo(CAMELOT_STAIRS, 3);
    await q.talk(/^sir lancelot$/i, [/how to get into morgan le faye's stronghold/i], LANCELOT);
}

// ── stage 3 -> 4: the crate, the keep, Sir Mordred, Morgan Le Faye

/**
 * The bank holds a sword the account can wield: take the best one into the keep and wield it.
 * At the Catherby bank, a few steps from the crate. Naked prologues bank whatever was worn.
 */
async function armUp(q: Quest): Promise<void> {
    const worn = q.sdk.getEquipment().find((i) => WEAPONS.some((w) => w.name.test(i.name)));
    if (worn) return;
    let held = q.sdk.getInventory().find((i) => WEAPONS.some((w) => w.name.test(i.name)));
    if (!held) {
        await q.goTo(SAFE_BANKS.catherby, 4);
        const opened = await q.bot.openBank();
        if (!opened.success) q.log(`merlin: armUp: openBank: ${opened.message}`);
        const attack = q.level('attack');
        for (const w of WEAPONS) {
            if (attack < w.attack) continue;
            const banked = q.sdk.getBankItems().find((b) => w.name.test(b.name));
            if (!banked) continue;
            await q.bot.withdrawItem(banked, 1);
            await untilTicks(q.sdk, () => q.sdk.getInventory().some((i) => w.name.test(i.name)), 5);
            break;
        }
        await q.bot.closeBank().catch(() => undefined);
        held = q.sdk.getInventory().find((i) => WEAPONS.some((w) => w.name.test(i.name)));
    }
    if (!held) {
        q.log(`merlin: no sword in the bank — into the keep unarmed (attack ${q.level('attack')}, strength ${q.level('strength')})`);
        return;
    }
    await q.bot.equipItem(held);
    await untilTicks(q.sdk, () => q.sdk.getEquipment().some((i) => i.name === held!.name), 5);
    q.log(`merlin: wielding ${held.name} for the keep`);
}

/**
 * Out of the crate mid-voyage (0_43_153_26_47): answer "get back out?" Yes; with the chain
 * dropped, the Crate wall's Climb-out asks again (quest_arthur.rs2 leave_arhein_crate).
 * jacklove5 sat in it at 2778,9839 while the Hide-in retries looked for Arhein's crate (2026-11-02).
 */
async function leaveCrate(q: Quest): Promise<void> {
    for (let attempt = 1; attempt <= 4 && inCrate(pos(q)); attempt++) {
        if (q.sdk.getDialog()?.isOpen) {
            await driveDialog(q.sdk, [/^yes\.?$/i], { done: () => !inCrate(pos(q)), ticks: 200, log: q.log });
            continue;
        }
        const wall = await findLoc(q, pos(q), /^crate wall$/i, /^climb-out$/i, 8);
        if (!wall) {
            q.log(`merlin: in the crate at ${where(q)} with no dialog and no Crate wall (attempt ${attempt})`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.bot.interactLoc(wall, /^climb-out$/i).catch((e) => q.log(`merlin: crate wall: ${(e as Error).message}`));
        await untilTicks(q.sdk, (s) => !inCrate(pos(q)) || !!s.dialog?.isOpen, 10);
    }
}

/** Arhein's crate (op2 Hide-in): the long mesbox chain ends with "get back out?" — Yes. */
async function crateToKeep(q: Quest): Promise<void> {
    if (inKeep(pos(q))) return;
    const t0 = tickNow(q.sdk);
    if (!inCrate(pos(q))) {
        await q.goTo(CATHERBY_CRATE, 2);
        await op(q, CATHERBY_CRATE, /^crate$/i, /^hide-in$/i, () => inKeep(pos(q)) || inCrate(pos(q)), 'hide in the crate', [/^yes\.?$/i], 30);
    }
    await leaveCrate(q);
    if (!inKeep(pos(q))) throw new Error(`merlin: the crate did not land at the keep (${where(q)})`);
    q.log(`merlin: shipped to the keep at ${where(q)} in ${tickNow(q.sdk) - t0}t`);
}

/** The keep's front door (lefayeunopenabledoorl/r, 2763,3401-3402) from inside: Open drops you outside (x-1). */
const KEEP_DOOR = { x: 2763, z: 3402 };

/**
 * Out of the keep by its front door: locked from outside, but Open from inside
 * teleports you through (quest_arthur.rs2 _keep_lefaye_door). The hall's own doors
 * between the pier and the front door are opened on the way (q.reach).
 */
export async function leaveKeep(q: Quest): Promise<void> {
    if (!inKeep(pos(q)) && !inCrate(pos(q))) return;
    if (inCrate(pos(q))) {
        await leaveCrate(q);
        if (!inKeep(pos(q))) return;
    }
    if (pos(q).level !== 0) await q.climbTo(0);
    const out = () => !inKeep(pos(q)) && !inCrate(pos(q));
    for (let attempt = 1; attempt <= 4 && !out(); attempt++) {
        await fendOffKnights(q);
        await q.reach(/^large door$/i, /^knock-at$/i).catch((e) => q.log(`merlin: toward the keep door: ${(e as Error).message}`));
        const door = await findLoc(q, KEEP_DOOR, /^large door$/i, /^knock-at$/i, 2);
        if (!door) {
            q.log(`merlin: no keep front door in view from ${where(q)} (attempt ${attempt})`);
            await q.bot.walkTo(KEEP_DOOR.x + 2, KEEP_DOOR.z, 2).catch(() => undefined);
            continue;
        }
        await q.bot.interactLoc(door, /^open$/i).catch((e) => q.log(`merlin: keep door: ${(e as Error).message}`));
        await untilTicks(q.sdk, out, 15);
    }
    if (!out()) throw new Error(`merlin: could not leave the keep (${where(q)})`);
    q.log(`merlin: out of the keep's front door at ${where(q)}`);
}

/** Npcs fighting us right now (a knight's hunt, Mordred), nearest first. */
function attackers(q: Quest, name: RegExp) {
    const me = q.sdk.getState()?.player;
    const recentlyHit = me?.combat && me.combat.lastDamageTick >= 0 && tickNow(q.sdk) - me.combat.lastDamageTick < 8;
    return (q.sdk.getNearbyNpcs() ?? [])
        .filter((n) => name.test(n.name) && (n.hp ?? 1) > 0 && n.distance <= 2 && n.inCombat && (recentlyHit || me?.combat?.targetIndex === n.index))
        .sort((a, b) => a.distance - b.distance);
}

/** Fight npc `index` until it is dead, gone or `stop()` holds; eats below half health. */
async function fightUntil(q: Quest, index: number, label: string, stop: () => boolean, ticks = 600): Promise<void> {
    const t0 = tickNow(q.sdk);
    let attacks = 0;
    const target = () => (q.sdk.getNearbyNpcs() ?? []).find((n) => n.index === index && (n.hp ?? 1) > 0);
    while (tickNow(q.sdk) - t0 < ticks && !stop()) {
        if (q.sdk.getDialog()?.isOpen) return;
        await eatIfLow(q);
        const npc = target();
        if (!npc) break;
        const me = q.sdk.getState()?.player;
        if (!me?.combat?.inCombat || me.combat.targetIndex !== index) {
            attacks++;
            const res = await q.bot.attack(npc, ticksToMs(10));
            if (!res.success && attacks % 5 === 1) q.log(`merlin: ${label} attack #${attacks}: ${res.message}`);
        }
        await q.sdk.waitForTicks(2);
    }
    const p = q.sdk.getState()?.player;
    q.log(`merlin: ${label}: ${attacks} attacks in ${tickNow(q.sdk) - t0}t (hp ${p?.hp}/${p?.maxHp}, food ${foodLeft(q)})`);
}

const foodLeft = (q: Quest) => q.sdk.getInventory().filter((i) => i.optionsWithIndex?.some((o) => /^eat$/i.test(o.text))).length;

/** A renegade knight that has picked a fight: fight it off before anything else. */
async function fendOffKnights(q: Quest): Promise<void> {
    for (let i = 0; i < 4; i++) {
        const knight = attackers(q, /^renegade knight$/i)[0];
        if (!knight) return;
        q.log(`merlin: renegade knight (level ${knight.combatLevel}) attacking at ${where(q)} — fighting it off`);
        await fightUntil(q, knight.index, 'renegade knight', () => false, 300);
    }
}

/**
 * Into the keep, up to Sir Mordred, beat him to "death" and answer Morgan Le Faye:
 * "Tell me how to untrap Merlin and I might." then "OK I will go do all that.".
 */
export async function defeatMordred(q: Quest): Promise<void> {
    const weak = Object.entries(KEEP_LEVELS).filter(([skill, level]) => q.level(skill) < level);
    if (weak.length) {
        throw new Error(`merlin: too weak for Keep Le Faye (needs ${weak.map(([s, l]) => `${s} ${l} (has ${q.level(s)})`).join(', ')})`);
    }
    if (!inKeep(pos(q))) {
        await armUp(q);
        await crateToKeep(q);
    }
    if (!inKeep(pos(q))) throw new Error(`merlin: not in the keep after the crate (${where(q)})`);
    await fendOffKnights(q);
    // Up to Mordred's floor (spawn 2769,3403 on L2 in the map file; whatever plane the stairs lead to).
    const t0 = tickNow(q.sdk);
    for (let i = 0; i < 4 && !q.sdk.findNearbyNpc(/^sir mordred$/i); i++) {
        const before = pos(q).level;
        await fendOffKnights(q);
        await q.climbTo(before + 1).catch((e) => q.log(`merlin: climb in the keep: ${(e as Error).message}`));
        await untilTicks(q.sdk, () => !!q.sdk.findNearbyNpc(/^sir mordred$/i), 4);
        if (pos(q).level === before) break;
    }
    const mordred = q.sdk.findNearbyNpc(/^sir mordred$/i);
    if (!mordred) throw new Error(`merlin: no Sir Mordred in view at ${where(q)} after ${tickNow(q.sdk) - t0}t`);
    q.log(`merlin: Sir Mordred at (${mordred.x},${mordred.z}) from ${where(q)}`);
    const morgan = () => !!q.sdk.getDialog()?.isOpen;
    // His death queue only runs Morgan's scene when it can find the killer un-delayed
    // (sir_mordred.rs2 ai_queue3 p_finduid): otherwise he just dies and respawns in 50
    // ticks (qlemcalqyk2 at 400 ms + lag, 2026-11-01). Wait for him and fight again.
    for (let round = 0; round < 4 && !morgan(); round++) {
        await fendOffKnights(q);
        const alive = () => (q.sdk.getNearbyNpcs() ?? []).find((n) => /^sir mordred$/i.test(n.name) && (n.hp ?? 1) > 0);
        if (!alive() && !(await untilTicks(q.sdk, () => !!alive() || morgan(), 90))) break;
        if (morgan()) break;
        if (round > 0) q.log(`merlin: Sir Mordred is back (round ${round + 1}) — fighting again`);
        await fightUntil(q, alive()!.index, 'Sir Mordred', morgan, 900);
        await untilTicks(q.sdk, morgan, 8);
    }
    if (!morgan()) throw new Error(`merlin: Mordred fight ended with no Morgan Le Faye at ${where(q)}`);
    const seen = await driveDialog(q.sdk, [/tell me how to untrap merlin/i, /ok,? i will go do all that/i], { ticks: 200, log: q.log });
    q.log(`merlin: Morgan Le Faye: ${seen.slice(0, 160)}`);
}

// ── stage 4 -> 5: the black candle, Excalibur, the words, Thrantax

/** The candle maker: ask for a black candle, then swap the bucket of wax for it; light it. */
export async function blackCandle(q: Quest): Promise<void> {
    if (!holdsName(q, LIT_CANDLE) && !holdsName(q, UNLIT_CANDLE)) {
        for (let attempt = 1; attempt <= 3 && !holdsName(q, UNLIT_CANDLE); attempt++) {
            if (q.count('bucket of wax') < 1) throw new Error('merlin: no bucket of wax for the candle maker');
            await q.talk(/^candle maker$/i, [/have you got any black candles/i], CANDLE_MAKER);
            await untilTicks(q.sdk, () => holdsName(q, UNLIT_CANDLE), 3);
        }
        if (!holdsName(q, UNLIT_CANDLE)) throw new Error('merlin: the candle maker never gave a black candle');
        q.log('merlin: black candle from the candle maker');
    }
    if (holdsName(q, LIT_CANDLE)) return;
    for (let attempt = 1; attempt <= 3 && !holdsName(q, LIT_CANDLE); attempt++) {
        const tinder = q.sdk.getInventory().find((i) => /^tinderbox$/i.test(i.name));
        const candle = q.sdk.getInventory().find((i) => UNLIT_CANDLE.test(i.name));
        if (!tinder || !candle) throw new Error(`merlin: lighting the candle needs a tinderbox and the candle (carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
        await q.sdk.sendUseItemOnItem(tinder.slot, candle.slot);
        await untilTicks(q.sdk, () => holdsName(q, LIT_CANDLE), 6);
    }
    if (!holdsName(q, LIT_CANDLE)) throw new Error('merlin: the black candle would not light');
    q.log('merlin: lit the black candle');
}

/** The Lady of the Lake's test: ask her, then the Port Sarim jeweller's door and the beggar's bread. */
export async function getExcalibur(q: Quest): Promise<void> {
    if (holdsName(q, EXCALIBUR)) return;
    if (q.count('bread') < 1) throw new Error('merlin: no bread for the beggar');
    const seen = await q.talk(/^the lady of the lake$/i, [/i seek the sword excalibur/i], LADY);
    if (!/port sarim/i.test(seen)) q.log(`merlin: the Lady of the Lake said: ${seen.slice(0, 200)}`);
    await q.goTo({ x: JEWELLER_DOOR.x + 1, z: JEWELLER_DOOR.z }, 2);
    const done = () => holdsName(q, EXCALIBUR);
    for (let attempt = 1; attempt <= 4 && !done(); attempt++) {
        // The door's oploc1 spawns the beggar and runs his plea (or, once told "no", only spawns him).
        const door = await findLoc(q, JEWELLER_DOOR, /^door$/i, /^open$/i, 2);
        if (door) {
            await q.sdk.sendInteractLoc(door.x, door.z, door.id, door.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
            await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || done(), 15);
        }
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [/^yes,? certainly/i, /yes,? here you go/i], { done, ticks: 200, log: q.log });
        if (done()) break;
        if (q.sdk.findNearbyNpc(/^beggar$/i)) await q.talk(/^beggar$/i, [/yes,? here you go/i]);
        await untilTicks(q.sdk, done, 4);
        if (!done()) q.log(`merlin: no Excalibur yet at ${where(q)} (attempt ${attempt}, door ${door ? `${door.x},${door.z}` : 'not found'})`);
    }
    if (!done()) throw new Error(`merlin: the beggar never turned into the Lady (${where(q)})`);
    q.log('merlin: Excalibur from the Lady of the Lake');
}

/** The Chaos altar's inscription, north of Varrock in the Wilderness. Skipped when the journal shows the words. */
export async function learnWords(q: Quest): Promise<void> {
    if (await journalSays(q, 'magic words from the Chaos Altar memorised')) return;
    await q.goTo(VARROCK_NORTH, 6);
    await q.goTo({ x: CHAOS_ALTAR.x, z: CHAOS_ALTAR.z - 2 }, 3);
    const since = cursor(q);
    let read = false;
    await op(q, CHAOS_ALTAR, /^chaos altar$/i, /^check$/i, () => (read ||= saidSince(q, since, /snarthon candtrick termanto/i)) || !!q.sdk.getDialog()?.isOpen, 'check the chaos altar');
    if (q.sdk.getDialog()?.isOpen) {
        const seen = await driveDialog(q.sdk, [], { ticks: 30, log: q.log });
        read ||= /snarthon/i.test(seen);
    }
    if (!read && !(await journalSays(q, 'magic words from the Chaos Altar memorised'))) throw new Error('merlin: the chaos altar inscription was not read');
    q.log('merlin: read the chaos altar inscription');
    // Out of the Wilderness the way we came.
    await q.goTo(VARROCK_NORTH, 6);
}

/** Bat bones dropped beside Camelot's magic symbol with the lit candle held; bind Thrantax with the words. */
export async function summonThrantax(q: Quest, bound: () => Promise<boolean>): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt++) {
        if (!holdsName(q, LIT_CANDLE)) throw new Error('merlin: no lit black candle at the symbol');
        const bones = q.sdk.getInventory().find((i) => /^bat bones$/i.test(i.name));
        if (!bones) throw new Error('merlin: no bat bones at the symbol');
        await q.goTo(MAGIC_SYMBOL, 0);
        if (!near(q, MAGIC_SYMBOL, 1)) {
            await q.bot.walkTo(MAGIC_SYMBOL.x, MAGIC_SYMBOL.z, 0).catch(() => undefined);
        }
        if (!(Math.abs(pos(q).x - MAGIC_SYMBOL.x) <= 1 && Math.abs(pos(q).z - MAGIC_SYMBOL.z) <= 1)) {
            q.log(`merlin: not on the magic symbol (${where(q)}), attempt ${attempt}`);
            continue;
        }
        await q.sdk.sendDropItem(bones.slot);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 15);
        const seen = await driveDialog(q.sdk, [/^snarthon candtrick termanto$/i], { ticks: 200, log: q.log });
        q.log(`merlin: Thrantax: ${seen.slice(0, 200)}`);
        if (await bound()) return;
        // A dropped bone without the spirit (off the symbol): pick it back up.
        const ground = q.sdk.findGroundItem(/^bat bones$/i);
        if (ground) await q.bot.pickupItem(ground).catch(() => undefined);
    }
    throw new Error(`merlin: Thrantax was not bound (${where(q)})`);
}

// ── stage 5 -> 6: Excalibur on the crystal, top of Camelot's tower

export async function shatterCrystal(q: Quest): Promise<void> {
    if (!holdsName(q, EXCALIBUR)) throw new Error('merlin: no Excalibur for the crystal');
    if (pos(q).level === 0) await q.goTo(TOWER_LADDER, 2);
    if (pos(q).level < 2) await q.climbTo(2, CRYSTAL);
    const since = cursor(q);
    const freed = () => saidSince(q, since, /shatters under the force of excalibur|already freed merlin/i) || !!q.sdk.getDialog()?.isOpen;
    for (let attempt = 1; attempt <= 3 && !freed(); attempt++) {
        const r = await q.bot.useItemOnLoc(EXCALIBUR, /^giant crystal$/i, { timeout: ticksToMs(20) });
        if (!r.success) q.log(`merlin: Excalibur on the crystal: ${r.message}`);
        await untilTicks(q.sdk, freed, 10);
    }
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 60, log: q.log });
    q.log(`merlin: crystal at ${where(q)}: ${freed() ? 'shattered' : 'no effect'}`);
    await q.climbTo(0, ARTHUR);
}
