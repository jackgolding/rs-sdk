/**
 * Shield of Arrav — two accounts, one per gang, each ending with its own certificate.
 *
 * Content facts (quests/quest_blackarmgang/scripts/{quest_blackarmgang,blackarmgang_journal,
 * arrav_book}.rs2, areas/area_varrock/scripts/{reldo,baraek,straven,katrine,tramp,weaponsmaster,
 * curator,king_roald}.rs2, drop tables/scripts/jonny_the_beard.rs2; npc/loc/obj ids from
 * pack/*.pack; spawns from maps m49_52, m50_52, m50_53, m50_54, m50_152):
 *
 *   Phoenix gang (%phoenixgang)
 *   - Reldo (3209,3495, palace library) "I'm in search of a quest." -> 1. The bookcase
 *     (3212,3493, op2 Check) hands 'The Shield of Arrav' at 1; reading it -> 2 (the varp moves as
 *     the book opens). Reldo again -> 3. Baraek (3218,3435) "Can you tell me where I can find the
 *     Phoenix Gang?" -> "Okay. Have 20 gold coins." -> 4 (20 coins).
 *   - The hideout: a cellar ladder (3244,3383) in a room whose only door is its west one
 *     (3241,3382); down to (3244,9783). Straven (3246,9780) by the locked door (3247,9779):
 *     "I know who you are!" -> "I'd like to offer you my services." -> 8.
 *   - Jonny the Beard (lvl 2, 8hp, Blue Moon Inn 3223,3395, respawn 74t) always drops the
 *     intelligence report. Straven takes it -> 9 and hands the weapon-store key (phoenixkey2,
 *     tradeable; he replaces a lost one).
 *   - Joined, the hideout door opens by itself; the chest (3235,9761: Open, then Search) holds
 *     arravshield1 unless one is held or BANKED.
 *
 *   Black Arm gang (%blackarmgang)
 *   - The tramp (3208,3391) "Is there anything down this alleyway?" -> "Do you think they would
 *     let me join?" -> 1 (refused to a Phoenix member). Katrine (3186,3385) "I've heard you're the
 *     Black Arm Gang." -> "I'd rather not reveal my sources." -> "I want to become a member of
 *     your gang." -> "Well, you can give me a try can't you?" -> "Ok, no problem." -> 2.
 *     Katrine takes two Phoenix crossbows -> 3.
 *   - Joined, the inner door (3185,3388) opens; stairs (3188,3389) up; the cupboard (3188,3385,L1,
 *     approached from the east: Open, then Search) holds arravshield2 unless held or BANKED.
 *
 *   The crossbows: two ground spawns upstairs in the Phoenix weapon store (3243,3383 and
 *   3245,3385, L1). Its door (3251,3385) only opens to phoenixkey2 used on it from outside
 *   (oplocu); from inside, Open lets you out. Ladder (3252,3384) up. Taking a crossbow while the
 *   Weaponsmaster (lvl 23, 20hp, respawn 700t) is within 10 tiles is refused ("That's Stravens'!"
 *   to a Phoenix member; he attacks anyone else), so he dies first. The PHOENIX account does
 *   this here and trades the crossbows over: it holds the key and is already a fighter, and it
 *   saves a key trade (the wiki's "partner retrieves them" route).
 *
 *   Both: the curator (3255,3445) turns BOTH halves, for an account in either gang, into TWO
 *   certificates (arravcertificate, tradeable). King Roald (3222,3476) takes one from an account
 *   in a gang that has not claimed -> complete (+600 coins). So: the Black Arm account hands its
 *   half over, the Phoenix account takes both to the curator and hands one certificate back.
 *
 * The pair: each account publishes its stage, what it holds and what it is waiting to RECEIVE in
 * bots/.quest-pairs/shield-of-arrav/<account>.json (bots/ is shared by the fleet's containers).
 * The receiver stands at MEET in serveTrades; the giver trades only once the partner's file says
 * it is serving that item and the partner is in view (the fleet trade rule: only the giver calls
 * bot.trade, crossing trade calls race "is busy").
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { NearbyNpc, TradeItem } from '../../../sdk/types';
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, ticksToMs, untilTicks } from './ticks';
import { findLoc, holds, op, pos, useOn, where } from './plague-city';

type Tile = { x: number; z: number; level?: number };

/** Obj ids (pack/obj.pack). The two halves share the name "Broken shield". */
export const OBJ = {
    book: 757,
    key: 759,
    report: 761,
    half1: 763,
    half2: 765,
    crossbow: 767,
    certificate: 769,
} as const;

export const RELDO = { x: 3209, z: 3495 };
const BOOKCASE = { x: 3212, z: 3493 };
export const BARAEK = { x: 3218, z: 3435 };
/** Inside the cellar-ladder room (its door is the west one, 3241,3382). */
const LADDER_ROOM = { x: 3243, z: 3382 };
const CELLAR_LADDER = { x: 3244, z: 3383 };
const HIDEOUT_LADDER = { x: 3244, z: 9783 };
const STRAVEN = { x: 3246, z: 9780 };
const PHOENIX_DOOR = { x: 3247, z: 9779 };
const CHEST = { x: 3235, z: 9761 };
const JONNY = { x: 3223, z: 3395 };
/** The weapon store: door (north edge of 3251,3385), stood at from the street side. */
const STORE_DOOR = { x: 3251, z: 3385 };
const STORE_OUTSIDE = { x: 3251, z: 3386 };
const STORE_LADDER = { x: 3252, z: 3384 };
const CROSSBOW_SPAWNS: Tile[] = [
    { x: 3243, z: 3383, level: 1 },
    { x: 3245, z: 3385, level: 1 },
];
export const TRAMP = { x: 3208, z: 3391 };
export const KATRINE = { x: 3186, z: 3385 };
const BA_DOOR = { x: 3185, z: 3388 };
const BA_STAIRS = { x: 3188, z: 3389 };
const CUPBOARD = { x: 3188, z: 3385, level: 1 };
/** Partner silence (no new beat or stage) a hand-off waits out before failing. */
const PARTNER_SILENT_TICKS = 4000;
export const CURATOR = { x: 3255, z: 3445 };
export const KING = { x: 3222, z: 3476 };
/** Where the pair trades: open ground in Varrock square, between both gangs and the museum. */
export const MEET = { x: 3213, z: 3426 };

/**
 * Max ticks one hand-off waits on the partner while it is still making progress (~100 min on the
 * 300ms prod clock: the Black Arm side reaches Katrine long before the Phoenix side has the
 * crossbows). A partner that stops publishing fails sooner (PARTNER_SILENT_TICKS).
 */
const PARTNER_WAIT_TICKS = 20000;
const UNDERGROUND_Z = 6400;

export type Gang = 'phoenix' | 'blackarm';
/** What a receiver is standing in serveTrades for. */
type Wanted = 'crossbows' | 'half' | 'cert';

export interface PairState {
    account: string;
    gang: Gang;
    partner: string;
    stage: string;
    has: { crossbows: number; half1: number; half2: number; certs: number };
    serving: Wanted | null;
    /** Bumped on every publish: a partner whose beat stops moving has stopped running. */
    beat: number;
}

export interface Pair {
    account: string;
    gang: Gang;
    partner: string;
}

const PAIR_DIR = () => join(process.cwd(), 'bots', '.quest-pairs', 'shield-of-arrav');
let beat = 0;

const held = (q: Quest, id: number) => q.sdk.getInventory().filter((i) => i.id === id).reduce((n, i) => n + (i.count ?? 1), 0);

/** Write our pair file (atomic rename: the partner may read it mid-write). */
export function publish(q: Quest, pair: Pair, serving: Wanted | null = null): void {
    const state: PairState = {
        account: pair.account,
        gang: pair.gang,
        partner: pair.partner,
        stage: q.stage,
        has: { crossbows: held(q, OBJ.crossbow), half1: held(q, OBJ.half1), half2: held(q, OBJ.half2), certs: held(q, OBJ.certificate) },
        serving,
        beat: ++beat,
    };
    try {
        mkdirSync(PAIR_DIR(), { recursive: true });
        const path = join(PAIR_DIR(), `${pair.account.toLowerCase()}.json`);
        writeFileSync(`${path}.tmp`, JSON.stringify(state) + '\n');
        renameSync(`${path}.tmp`, path);
    } catch (err) {
        q.log(`arrav: could not publish the pair state: ${(err as Error).message}`);
    }
}

export function readPartner(pair: Pair): PairState | null {
    const path = join(PAIR_DIR(), `${pair.partner.toLowerCase()}.json`);
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as PairState;
    } catch {
        return null;
    }
}

const describePartner = (p: PairState | null) =>
    p ? `${p.account} at ${p.stage}${p.serving ? `, waiting for ${p.serving}` : ''} (crossbows ${p.has.crossbows}, halves ${p.has.half1}/${p.has.half2}, certs ${p.has.certs})` : 'no pair file yet';

/** Ticks since the partner's pair file last changed (beat or stage), tracked across polls. */
function silence(q: Quest, pair: Pair): () => number {
    let last = JSON.stringify(readPartner(pair));
    let at = tickNow(q.sdk);
    return () => {
        const now = JSON.stringify(readPartner(pair));
        if (now !== last) {
            last = now;
            at = tickNow(q.sdk);
        }
        return tickNow(q.sdk) - at;
    };
}

const nameRe = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

/**
 * Stand at MEET and take trades from the partner until `done`, publishing that we are serving
 * `what`. Bounded by PARTNER_WAIT_TICKS / PARTNER_SILENT_TICKS; throws when the partner never delivers.
 */
async function receive(q: Quest, pair: Pair, what: Wanted, item: RegExp, done: () => boolean): Promise<void> {
    if (done()) return;
    await leaveBuildings(q);
    await q.goTo(MEET, 3);
    const t0 = tickNow(q.sdk);
    const quiet = silence(q, pair);
    let lastNote = -Infinity;
    q.log(`arrav: at the meeting spot, waiting for ${pair.partner} to trade the ${what}`);
    while (!done()) {
        const waited = tickNow(q.sdk) - t0;
        if (waited > PARTNER_WAIT_TICKS || quiet() > PARTNER_SILENT_TICKS) {
            publish(q, pair, null);
            throw new Error(`arrav: ${pair.partner} did not trade the ${what} in ${waited}t (silent ${quiet()}t; ${describePartner(readPartner(pair))})`);
        }
        if (waited - lastNote >= 300) {
            q.log(`arrav: waiting for the ${what} ${waited}t; partner ${describePartner(readPartner(pair))}`);
            lastNote = waited;
        }
        publish(q, pair, what);
        // Short sessions, so the pair file's beat keeps moving while we stand here.
        await q.bot
            .serveTrades({
                from: nameRe(pair.partner),
                give: [],
                accept: (offer: TradeItem[]) => (offer ?? []).some((i) => item.test(i.name ?? '')),
                maxTrades: 1,
                timeout: ticksToMs(100),
                tradeTimeout: ticksToMs(200),
            })
            .catch((e) => q.log(`arrav: serveTrades: ${(e as Error).message}`));
        await q.sdk.waitForTicks(1);
    }
    publish(q, pair, null);
    q.log(`arrav: received the ${what} from ${pair.partner} after ${tickNow(q.sdk) - t0}t`);
}

/**
 * Trade `give` to the partner at MEET once its pair file says it is serving `what` and it is in
 * view. `delivered` reads the partner's file (it already has the item: a resumed run).
 */
async function hand(q: Quest, pair: Pair, what: Wanted, give: { item: RegExp; amount: number }, delivered: (p: PairState) => boolean): Promise<void> {
    const t0 = tickNow(q.sdk);
    await leaveBuildings(q);
    await q.goTo(MEET, 3);
    const quiet = silence(q, pair);
    let lastNote = -Infinity;
    for (;;) {
        const partner = readPartner(pair);
        if (partner && delivered(partner)) {
            q.log(`arrav: ${pair.partner} already has the ${what}`);
            return;
        }
        const waited = tickNow(q.sdk) - t0;
        if (waited > PARTNER_WAIT_TICKS || quiet() > PARTNER_SILENT_TICKS) throw new Error(`arrav: could not hand the ${what} to ${pair.partner} in ${waited}t (${describePartner(partner)})`);
        if (waited - lastNote >= 300) {
            q.log(`arrav: holding the ${what} for ${pair.partner} ${waited}t; partner ${describePartner(partner)}`);
            lastNote = waited;
        }
        publish(q, pair, null);
        const seen = q.sdk.findNearbyPlayer(nameRe(pair.partner));
        if (partner?.serving === what && seen) {
            const before = q.sdk.getInventory().filter((i) => give.item.test(i.name)).length;
            const res = await q.bot.trade(seen, {
                give: [give],
                want: [],
                requestTimeout: ticksToMs(60),
                timeout: ticksToMs(200),
                retryOnBusy: true,
            });
            q.log(`arrav: trade ${what} -> ${pair.partner}: ${res.success ? 'done' : `failed (${res.reason ?? res.message})`}`);
            const after = q.sdk.getInventory().filter((i) => give.item.test(i.name)).length;
            if (res.success || after < before) {
                publish(q, pair, null);
                return;
            }
        }
        await q.sdk.waitForTicks(10);
    }
}

// ── buildings walkTo cannot leave: the hideout (underground), the weapon store, Black Arm rooms

/** Underground below the Phoenix building (the hideout and its corridor). */
export const inPhoenixHideout = (p: Tile) => p.x >= 3220 && p.x <= 3265 && p.z >= 9750 && p.z <= 9790;

/** Inside the hideout's locked part: the ladder up is not reachable. */
async function behindPhoenixDoor(q: Quest): Promise<boolean> {
    if (!inPhoenixHideout(pos(q))) return false;
    await q.sdk.scanNearbyLocs(30).catch(() => undefined);
    const ladder = (q.sdk.getNearbyLocs() ?? []).find((l) => /^ladder$/i.test(l.name) && l.x === HIDEOUT_LADDER.x && l.z === HIDEOUT_LADDER.z);
    return !ladder || ladder.reachable === false;
}

/** Weapon store interior: x 3250-3253, z 3381-3385 (L0 behind the keyed door, and its L1). */
const inStore = (p: Tile) => p.x >= 3250 && p.x <= 3253 && p.z >= 3381 && p.z <= 3385 && (p.level ?? 0) === 0;
/** Upstairs over the store and the hideout building: crossbows and the Weaponsmaster. */
const storeUpstairs = (p: Tile) => (p.level ?? 0) === 1 && p.x >= 3236 && p.x <= 3253 && p.z >= 3378 && p.z <= 3390;
/** Black Arm back room (walls x 3181/3190, behind the door on z 3388) and the house's upstairs. */
const inBlackArmBack = (p: Tile) =>
    ((p.level ?? 0) === 0 && p.x >= 3182 && p.x <= 3189 && p.z >= 3388 && p.z <= 3392) || ((p.level ?? 0) === 1 && p.x >= 3181 && p.x <= 3190 && p.z >= 3382 && p.z <= 3393);

/** In one of the quest's buildings walkTo cannot leave (run-quest's goTo and prologue call leaveBuildings). */
export const inArravBuilding = (p: Tile) => inPhoenixHideout(p) || inStore(p) || storeUpstairs(p) || inBlackArmBack(p);

/** Out of the hideout, the weapon store or the Black Arm rooms, to the street. Idempotent. */
export async function leaveBuildings(q: Quest): Promise<void> {
    if (storeUpstairs(pos(q))) {
        await climbLadder(q, STORE_LADDER, /climb-down/i, () => pos(q).level === 0);
    }
    if (inStore(pos(q))) {
        await op(q, STORE_DOOR, /^door$/i, /^open$/i, () => !inStore(pos(q)), 'out of the weapon store', [], 10);
    }
    if (inPhoenixHideout(pos(q))) {
        if (await behindPhoenixDoor(q)) await throughPhoenixDoor(q, false);
        await climbLadder(q, HIDEOUT_LADDER, /climb-up/i, () => pos(q).z < UNDERGROUND_Z);
    }
    if (inBlackArmBack(pos(q))) {
        if (pos(q).level === 1) await q.climbTo(0, BA_STAIRS);
        if (pos(q).z >= BA_DOOR.z) await op(q, BA_DOOR, /^door$/i, /^open$/i, () => pos(q).z < BA_DOOR.z, 'out of the Black Arm back room', [], 10);
    }
}

async function climbLadder(q: Quest, at: Tile, opt: RegExp, done: () => boolean): Promise<void> {
    for (let i = 0; i < 4 && !done(); i++) {
        await q.sdk.scanNearbyLocs(10).catch(() => undefined);
        const ladder = (q.sdk.getNearbyLocs() ?? [])
            .filter((l) => /ladder/i.test(l.name) && l.optionsWithIndex.some((o) => opt.test(o.text)))
            .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z))[0];
        if (!ladder) throw new Error(`arrav: no ladder (${opt}) near (${at.x},${at.z}) from ${where(q)}`);
        const res = await q.bot.interactLoc(ladder, opt);
        if (!res.success) q.log(`arrav: ladder at (${ladder.x},${ladder.z}): ${res.message}`);
        await untilTicks(q.sdk, done, 30);
    }
    if (!done()) throw new Error(`arrav: the ladder at (${at.x},${at.z}) did not take us (${where(q)})`);
}

/** Down the cellar ladder into the hideout's front corridor (Straven, the locked door). */
async function enterHideout(q: Quest): Promise<void> {
    if (inPhoenixHideout(pos(q))) return;
    await leaveBuildings(q);
    if (pos(q).level !== 0) await q.climbTo(0);
    // The ladder's room opens only to the west (3241,3382): walkTo onto a tile inside it.
    await q.goTo(LADDER_ROOM, 1);
    await climbLadder(q, CELLAR_LADDER, /climb-down/i, () => inPhoenixHideout(pos(q)));
    q.log(`arrav: down into the Phoenix hideout ${where(q)}`);
}

/**
 * The hideout door: inward once joined (it opens itself), outward always. At stage 8 with
 * Straven beside it, Open plays his "How's your little mission going?" instead.
 */
async function throughPhoenixDoor(q: Quest, inward: boolean): Promise<void> {
    const want = async () => (await behindPhoenixDoor(q)) === inward;
    if (await want()) return;
    // From inside, the door is ~20 tiles off at the chest: walk up to it first (the door's own
    // tile is the inside one; open_hideout_door teleports you to the far side).
    if (!inward) await q.goTo(PHOENIX_DOOR, 1).catch((e) => q.log(`arrav: ${(e as Error).message}`));
    for (let attempt = 1; attempt <= 4; attempt++) {
        const door = await findLoc(q, PHOENIX_DOOR, /^door$/i, /^open$/i);
        if (!door) {
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(door.x, door.z, door.id, door.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || Math.hypot((s.player?.worldX ?? 0) - door.x, (s.player?.worldZ ?? 0) - door.z) <= 1, 30);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 40, log: q.log });
        await q.sdk.waitForTicks(3);
        if (await want()) {
            q.log(`arrav: ${inward ? 'into' : 'out of'} the Phoenix hideout ${where(q)}`);
            return;
        }
    }
    throw new Error(`arrav: the hideout door did not let us ${inward ? 'in' : 'out'} (${where(q)})`);
}

/** Straven, from the hideout's front corridor (Heroes' Quest talks to him too). */
export async function talkStraven(q: Quest, choices: Array<RegExp | string>): Promise<string> {
    await enterHideout(q);
    if (await behindPhoenixDoor(q)) await throughPhoenixDoor(q, false);
    return q.talk(/^straven$/i, choices);
}

/** Eat anything edible when below `below` of max hp. */
async function eatIfLow(q: Quest, below = 0.5): Promise<void> {
    const p = q.sdk.getState()?.player;
    if (!p || p.hp > (p.maxHp ?? 10) * below) return;
    const food = q.sdk.getInventory().find((i) => i.optionsWithIndex?.some((o) => /^eat$/i.test(o.text)));
    if (food) await q.bot.eatFood(food).catch(() => undefined);
}

/**
 * Kill the nearest `npc` (one at a time, by index) until `done`, bounded by `ticks`.
 * Below 30% hp with nothing to eat it stops: the caller retreats.
 */
async function kill(q: Quest, npc: RegExp, done: () => boolean, ticks: number, label: string): Promise<boolean> {
    const t0 = tickNow(q.sdk);
    let fought: number | null = null;
    let attacks = 0;
    while (!done() && tickNow(q.sdk) - t0 < ticks) {
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 6 });
        await eatIfLow(q);
        const me = q.sdk.getState()?.player;
        if (me && me.hp <= (me.maxHp ?? 10) * 0.3 && !q.sdk.getInventory().some((i) => i.optionsWithIndex.some((o) => /^eat$/i.test(o.text)))) {
            q.log(`arrav: hp ${me.hp}/${me.maxHp} fighting the ${label} with no food — backing off`);
            return false;
        }
        const live = (q.sdk.getNearbyNpcs() ?? []).filter((n) => npc.test(n.name) && (n.hp ?? 1) > 0 && n.reachable !== false);
        const target: NearbyNpc | undefined = (fought !== null ? live.find((n) => n.index === fought) : undefined) ?? live.sort((a, b) => a.distance - b.distance)[0];
        if (!target) {
            if (fought !== null && (await untilTicks(q.sdk, done, 6))) break;
            fought = null;
            await q.sdk.waitForTicks(5);
            continue;
        }
        fought = target.index;
        if (!me?.combat?.inCombat || me.combat.targetIndex !== target.index) {
            attacks++;
            const res = await q.bot.attack(target, ticksToMs(20)).catch((e) => ({ success: false, message: (e as Error).message }));
            if (!res.success && attacks % 5 === 1) q.log(`arrav: attack ${label} #${attacks}: ${res.message}`);
        }
        await q.sdk.waitForTicks(2);
    }
    return done();
}

/** Ground item `id` within a tile of `tile` (same plane), picked up. */
async function pickUpAt(q: Quest, tile: Tile, id: number, done: () => boolean, ticks = 60): Promise<boolean> {
    const t0 = tickNow(q.sdk);
    while (!done() && tickNow(q.sdk) - t0 < ticks) {
        await q.sdk.scanGroundItems(8).catch(() => undefined);
        const ground = (q.sdk.getState()?.groundItems ?? []).find((g) => g.id === id && Math.abs(g.x - tile.x) <= 1 && Math.abs(g.z - tile.z) <= 1);
        if (!ground) {
            await q.sdk.waitForTicks(5);
            continue;
        }
        const before = held(q, id);
        const res = await q.bot.pickupItem(ground).catch((e) => ({ success: false, message: (e as Error).message }));
        if (!res.success) q.log(`arrav: pick up ${ground.name} at (${ground.x},${ground.z}): ${res.message}`);
        await untilTicks(q.sdk, () => held(q, id) > before, 8);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { ticks: 10 });
    }
    return done();
}

/**
 * A shut container (Open turns it into its open twin, which has Search): open it if shut, then
 * search until `done`. Read fresh each time — right after a climb the loc list is still the old
 * floor's (the cupboard read as missing and was never opened, 2026-11-03).
 */
async function openAndSearch(q: Quest, at: Tile, name: RegExp, done: () => boolean, label: string): Promise<void> {
    for (let attempt = 1; attempt <= 6 && !done(); attempt++) {
        const open = await findLoc(q, at, name, /^search$/i);
        if (open) {
            await op(q, at, name, /^search$/i, done, `search ${label}`, [], 15).catch((e) => q.log(`arrav: ${(e as Error).message}`));
            continue;
        }
        const shut = await findLoc(q, at, name, /^open$/i);
        if (shut) {
            // The client walks us to its approach side (forceapproach) and the loc swaps in place.
            await q.sdk.sendInteractLoc(shut.x, shut.z, shut.id, shut.optionsWithIndex.find((o) => /^open$/i.test(o.text))!.opIndex);
            await untilTicks(q.sdk, () => false, 12);
            continue;
        }
        q.log(`arrav: no ${label} in view from ${where(q)} (attempt ${attempt})`);
        await q.sdk.waitForTicks(3);
    }
    if (!done()) throw new Error(`arrav: searching ${label} gave nothing (${where(q)})`);
}

// ── Phoenix gang

export async function startAtReldo(q: Quest): Promise<void> {
    await q.talk(/^reldo$/i, [/i'm in search of a quest/i], RELDO);
}

/** The bookcase's book (op2 Check, at stage 1 and none held), then read it (-> 2). */
export async function readBook(q: Quest): Promise<void> {
    if (!holds(q, OBJ.book)) {
        await q.goTo(BOOKCASE, 2);
        await op(q, BOOKCASE, /^bookcase$/i, /^check$/i, () => holds(q, OBJ.book), 'the Shield of Arrav book from the bookcase', [], 15);
    }
    const book = q.sdk.getInventory().find((i) => i.id === OBJ.book)!;
    const read = book.optionsWithIndex.find((o) => /^read$/i.test(o.text));
    await q.sdk.sendUseItem(book.slot, read?.opIndex ?? 1);
    // The varp moves as the book opens (arrav_book.rs2 open_arrav_book); closing it is enough.
    await untilTicks(q.sdk, (s) => !!s.interface?.isOpen || !!s.dialog?.isOpen, 10);
    await q.sdk.waitForTicks(2);
    await q.bot.closeInterface().catch(() => undefined);
}

export async function askReldoAgain(q: Quest): Promise<void> {
    await q.talk(/^reldo$/i, [], RELDO);
}

export async function bribeBaraek(q: Quest): Promise<void> {
    await q.talk(/^baraek$/i, [/where i can find the phoenix gang/i, /have 20 gold coins/i], BARAEK);
}

export async function meetStraven(q: Quest): Promise<void> {
    await talkStraven(q, [/i know who you are/i, /offer you my services/i]);
}

/** Jonny the Beard in the Blue Moon Inn; his report drops where he dies (lootdrop, ours). */
export async function killJonny(q: Quest): Promise<void> {
    await leaveBuildings(q);
    const got = () => holds(q, OBJ.report);
    for (let attempt = 1; attempt <= 3 && !got(); attempt++) {
        await q.goTo(JONNY, 4);
        let dead: Tile | null = null;
        const killed = await kill(
            q,
            /^jonny the beard$/i,
            () => {
                if (got()) return true;
                const drop = (q.sdk.getState()?.groundItems ?? []).find((g) => g.id === OBJ.report);
                if (drop) dead = { x: drop.x, z: drop.z };
                return !!drop;
            },
            600,
            'Jonny the Beard'
        );
        if (killed && dead && !got()) await pickUpAt(q, dead, OBJ.report, got, 40);
        if (!got()) q.log(`arrav: no report yet after attempt ${attempt} ${where(q)}`);
    }
    if (!got()) throw new Error(`arrav: no intelligence report from Jonny the Beard (${where(q)})`);
    q.log('arrav: took the intelligence report');
}

export async function reportToStraven(q: Quest): Promise<void> {
    await talkStraven(q, []);
}

/** The hideout chest (Open, then Search) for the Phoenix half. */
export async function searchChest(q: Quest): Promise<void> {
    if (holds(q, OBJ.half1)) return;
    await enterHideout(q);
    await throughPhoenixDoor(q, true);
    await q.goTo({ x: CHEST.x, z: CHEST.z + 1 }, 1);
    await openAndSearch(q, CHEST, /chest/i, () => holds(q, OBJ.half1), 'the hideout chest');
    q.log('arrav: found the Phoenix half of the shield');
    await leaveBuildings(q);
}

/** Up the weapon store (key on its door), the Weaponsmaster killed, both crossbows taken. */
async function fetchCrossbows(q: Quest): Promise<void> {
    const enough = () => held(q, OBJ.crossbow) >= 2;
    if (enough()) return;
    if (!holds(q, OBJ.key)) {
        // Straven replaces a lost key (straven.rs2 straven_gangmember_dialogues case 2).
        await talkStraven(q, []);
        if (!holds(q, OBJ.key)) throw new Error('arrav: no weapon store key, and Straven did not hand a spare');
    }
    const t0 = tickNow(q.sdk);
    for (let attempt = 1; attempt <= 4 && !enough(); attempt++) {
        if (!storeUpstairs(pos(q))) {
            if (!inStore(pos(q))) {
                await leaveBuildings(q);
                await q.goTo(STORE_OUTSIDE, 1);
                await useOn(q, OBJ.key, STORE_DOOR, /^door$/i, () => inStore(pos(q)), 'the key on the weapon store door', 15);
            }
            await climbLadder(q, STORE_LADDER, /climb-up/i, () => storeUpstairs(pos(q)));
        }
        // He stops any pickup while within 10 tiles: kill him first (respawn 700t). Just up the
        // ladder the npc list has not caught up yet: the first run found no one, walked to the
        // crossbows and was refused at both.
        const master = () => (q.sdk.getNearbyNpcs() ?? []).find((n) => /^weaponsmaster$/i.test(n.name) && (n.hp ?? 1) > 0);
        await untilTicks(q.sdk, () => !!master(), 8);
        if (master()) {
            const won = await kill(q, /^weaponsmaster$/i, () => !master(), 400, 'Weaponsmaster');
            if (!won) {
                // Down the ladder to get our breath back; he does not follow.
                await climbLadder(q, STORE_LADDER, /climb-down/i, () => pos(q).level === 0);
                q.log(`arrav: resting below the store (hp ${q.sdk.getState()?.player?.hp})`);
                await untilTicks(q.sdk, (s) => (s.player?.hp ?? 0) >= (s.player?.maxHp ?? 10) * 0.8, 1500);
                continue;
            }
            q.log(`arrav: the Weaponsmaster is dead (${tickNow(q.sdk) - t0}t)`);
        }
        for (const spawn of CROSSBOW_SPAWNS) {
            if (enough()) break;
            const before = held(q, OBJ.crossbow);
            await q.goTo(spawn, 1).catch((e) => q.log(`arrav: ${(e as Error).message}`));
            await pickUpAt(q, spawn, OBJ.crossbow, () => held(q, OBJ.crossbow) > before, 60);
        }
    }
    if (!enough()) throw new Error(`arrav: only ${held(q, OBJ.crossbow)} Phoenix crossbows after four tries (${where(q)})`);
    q.log(`arrav: took two Phoenix crossbows in ${tickNow(q.sdk) - t0}t`);
    await leaveBuildings(q);
}

/** Partner stages before Katrine has the crossbows. */
const BEFORE_BLACKARM_JOINED = new Set(['b_unstarted', 'b_started', 'b_katrine', 'b_key', 'b_crossbows']);

/**
 * Phoenix, holding its half: the Black Arm partner's crossbows first (if it still needs them),
 * then the partner's half in trade.
 */
export async function phoenixSwap(q: Quest, pair: Pair): Promise<void> {
    publish(q, pair);
    const partner = readPartner(pair);
    const needsCrossbows = !partner || (BEFORE_BLACKARM_JOINED.has(partner.stage) && partner.has.crossbows < 2);
    if (needsCrossbows) {
        await fetchCrossbows(q);
        await hand(q, pair, 'crossbows', { item: /^phoenix crossbow$/i, amount: 2 }, (p) => p.has.crossbows >= 2 || !BEFORE_BLACKARM_JOINED.has(p.stage));
    }
    await receive(q, pair, 'half', /^broken shield$/i, () => holds(q, OBJ.half2));
}

// ── Black Arm gang

export async function askTramp(q: Quest): Promise<void> {
    await q.talk(/^tramp$/i, [/anything down this alleyway/i, /would let me join/i], TRAMP);
}

export async function joinKatrine(q: Quest): Promise<void> {
    await q.talk(
        /^katrine$/i,
        [/you're the black arm gang/i, /rather not reveal my sources/i, /become a member of your gang/i, /give me a try/i, /ok, no problem/i],
        KATRINE
    );
}

/** Black Arm before joining: the crossbows from the Phoenix partner. */
export async function receiveCrossbows(q: Quest, pair: Pair): Promise<void> {
    publish(q, pair);
    await receive(q, pair, 'crossbows', /^phoenix crossbow$/i, () => held(q, OBJ.crossbow) >= 2);
}

export async function crossbowsToKatrine(q: Quest): Promise<void> {
    await q.talk(/^katrine$/i, [], KATRINE);
}

/** The partner has the Black Arm half (or is past needing it). */
const PHOENIX_HAS_BOTH = new Set(['p_both', 'p_certs2', 'p_cert1', 'complete']);

/** Upstairs in the Black Arm house: the cupboard's half. */
async function searchCupboard(q: Quest): Promise<void> {
    if (holds(q, OBJ.half2)) return;
    if (!inBlackArmBack(pos(q))) {
        await q.goTo({ x: BA_DOOR.x, z: BA_DOOR.z - 1 }, 1);
        await op(q, BA_DOOR, /^door$/i, /^open$/i, () => pos(q).z >= BA_DOOR.z, 'into the Black Arm back room', [], 10);
    }
    if (pos(q).level !== 1) {
        await q.goTo({ x: BA_STAIRS.x, z: BA_STAIRS.z - 1 }, 2).catch(() => undefined);
        await q.climbTo(1, BA_STAIRS);
    }
    // No walk to it: upstairs is one room (east wall x 3189), and the cupboard's east approach
    // tile is not a plain walkTo target from the stairs. The op routes us there.
    await openAndSearch(q, CUPBOARD, /^cupboard$/i, () => holds(q, OBJ.half2), 'the Black Arm cupboard');
    q.log('arrav: found the Black Arm half of the shield');
    await leaveBuildings(q);
}

/**
 * Black Arm, joined, holding nothing: the cupboard's half, unless the partner already holds both
 * halves (we handed ours over before a restart) — then only its certificate is owed to us.
 */
export async function blackArmJoined(q: Quest, pair: Pair): Promise<void> {
    publish(q, pair);
    const partner = readPartner(pair);
    if (partner && (PHOENIX_HAS_BOTH.has(partner.stage) || partner.has.half2 > 0)) {
        q.log(`arrav: ${pair.partner} has our half already — waiting for a certificate`);
        await receiveCert(q, pair);
        return;
    }
    await searchCupboard(q);
}

/** Black Arm with its half: to the partner, then a certificate back. */
export async function blackArmSwap(q: Quest, pair: Pair): Promise<void> {
    publish(q, pair);
    await hand(q, pair, 'half', { item: /^broken shield$/i, amount: 1 }, (p) => p.has.half2 > 0 || PHOENIX_HAS_BOTH.has(p.stage));
    await receiveCert(q, pair);
}

async function receiveCert(q: Quest, pair: Pair): Promise<void> {
    await receive(q, pair, 'cert', /^certificate$/i, () => holds(q, OBJ.certificate));
}

// ── both gangs

/** Both halves: two certificates. */
export async function toCurator(q: Quest): Promise<void> {
    await leaveBuildings(q);
    await q.talk(/^curator$/i, [], CURATOR);
}

/** Two certificates: one to the partner (unless it already has one or is done). */
export async function giveCert(q: Quest, pair: Pair): Promise<void> {
    publish(q, pair);
    await hand(q, pair, 'cert', { item: /^certificate$/i, amount: 1 }, (p) => p.has.certs > 0 || p.stage === 'complete');
}

export async function claimReward(q: Quest): Promise<void> {
    await leaveBuildings(q);
    await q.talk(/^king roald$/i, [], KING);
}
