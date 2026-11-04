/**
 * Legends' Quest supplies no shop sells (lib/sources.ts `get` recipes; bots/quests/legends-stock.ts
 * banks them for the mule). Content facts, all from server/content:
 *
 *   Gems — opal, jade, red topaz come only from gem rocks (skill_mining mine.dbrow gem_rock: Mining 40,
 *     respawn 200t; gem_rock_table.dbrow: opal 60, jade 30, red topaz 15, sapphire 9, emerald 5, ruby 5,
 *     diamond 4 of 128). The only gem rocks on the map are Shilo Village's seven (loc gemrock 2111,
 *     2824-2829,2998-3003, map m44_46) inside the village, reached by Hajedy's cart from Brimhaven
 *     (hajedy.rs2: Shilo Village complete; the east gates are fenced off outside). Cut with a
 *     chisel (uncut gem used on it; gem.dbrow: opal Crafting 1, jade 13, red topaz 16; a semi-precious
 *     cut can smash into a crushed gem, stat_random 128..250 / 90..240 / 100..245). The Dig Site's
 *     panning (opal 3/40, jade 3/40) and digs give no red topaz.
 *   Lockpick — a ground spawn (obj 1523, 100t respawn) in the Yanille dungeon's spider room at
 *     (2615,9571). Rogues pickpocket one 5/128 times (pickpocket.dbrow, Thieving 32), but every rogue
 *     spawns in deep wilderness (3076,3916; Rogues' Castle 3276-3296,3924-3939). No shop stocks one.
 *     The spider room's staircase (2620,9497) is in the druids' chamber, which the town staircase
 *     (2603,3078) reaches only through loc_2559 (2601,9482: Thieving 82 and a lockpick; open from the
 *     far side). Without one: the west staircase (2569,3122), the balancing ledge (Agility 40) and the
 *     monkey bars (Agility 57 from the north; a fall of either lands in a pit with its own stairs out).
 *     Out by the door's open side and the town stairs. Poison spiders (64) spawn west of the spawn's
 *     room; chaos druids and bats on the way.
 *   Unpowered orb — glass.rs2: molten glass + a glassblowing pipe, the Orb of skill_multi3 (Crafting
 *     46). Molten glass: a bucket of sand and soda ash used on a furnace (smelting.rs2 smelt_glass,
 *     Crafting 1). Soda ash: seaweed cooked on a range (cooking_generic seaweed, never burns).
 *     No shop sells any of it. Entrana holds every input: the sand pit (2816,3341), a range
 *     (2822,3351), the furnace (2833,3351), a glassblowing pipe spawn (2822,3355) and ten seaweed
 *     spawns on the north-west shore (2803-2810,3380-3388). Only the empty buckets come along (the
 *     monks refuse weapons and armour, pickaxes included: monk_of_entrana.rs2).
 */
import type { Quest } from './run-quest';
import type { NearbyLoc } from '../../../sdk/types';
import { tickNow, untilTicks } from './ticks';
import { driveDialog } from './dialog';
import { depositAllInventory } from '../quest-supplies';
import { SAFE_BANKS } from '../safe-stops';

interface Tile {
    x: number;
    z: number;
}

const pos = (q: Quest) => {
    const p = q.sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
};
const where = (q: Quest) => `(${pos(q).x},${pos(q).z},L${pos(q).level})`;
const dist = (q: Quest, t: Tile) => Math.hypot(pos(q).x - t.x, pos(q).z - t.z);
const held = (q: Quest, re: RegExp) => q.sdk.getInventory().find((i) => re.test(i.name));
const countOf = (q: Quest, re: RegExp) => q.sdk.getInventory().filter((i) => re.test(i.name)).reduce((n, i) => n + (i.count ?? 1), 0);
const freeSlots = (q: Quest) => 28 - q.sdk.getInventory().length;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function locs(q: Quest, radius = 12): Promise<NearbyLoc[]> {
    await q.sdk.scanNearbyLocs(radius).catch(() => undefined);
    return q.sdk.getNearbyLocs() ?? [];
}

/** The loc named `name` with option `opt` nearest `near` (default: us), within `within` tiles of it. */
async function findLoc(q: Quest, name: RegExp, opt: RegExp | null, near?: Tile, within = 4): Promise<NearbyLoc | undefined> {
    const ref = near ?? pos(q);
    return (await locs(q, 14))
        .filter((l) => name.test(l.name) && (!opt || l.optionsWithIndex.some((o) => opt.test(o.text))))
        .filter((l) => !near || Math.hypot(l.x - ref.x, l.z - ref.z) <= within)
        .sort((a, b) => Math.hypot(a.x - ref.x, a.z - ref.z) - Math.hypot(b.x - ref.x, b.z - ref.z))[0];
}

/** Op `opt` on the loc named `name` near `at` until `done`; throws after four tries. */
async function opLoc(q: Quest, at: Tile, name: RegExp, opt: RegExp, done: () => boolean, label: string): Promise<void> {
    for (let attempt = 1; attempt <= 4; attempt++) {
        if (done()) return;
        const loc = await findLoc(q, name, opt, at);
        if (!loc) {
            q.log(`${label}: no ${name} with ${opt} near (${at.x},${at.z}) from ${where(q)} (attempt ${attempt})`);
            await q.sdk.waitForTicks(3);
            continue;
        }
        await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find((o) => opt.test(o.text))!.opIndex);
        await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, 30);
        if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, [], { done, ticks: 20, log: q.log });
        if (await untilTicks(q.sdk, done, 6)) return;
        q.log(`${label} did not take from ${where(q)} (attempt ${attempt})`);
    }
    throw new Error(`${label} failed at ${where(q)}`);
}

/** Use the first held `item` on the loc named `name` near `at`; true once `done`. Drives any dialog with `choices`. */
async function useOnLoc(q: Quest, item: RegExp, at: Tile, name: RegExp, done: () => boolean, choices: RegExp[] = [], ticks = 12): Promise<boolean> {
    const it = held(q, item);
    const loc = await findLoc(q, name, null, at);
    if (!it || !loc) {
        q.log(`use ${item} on ${name}: ${it ? `no ${name} near (${at.x},${at.z})` : 'none held'} at ${where(q)}`);
        return false;
    }
    // bot.useItemOnLoc routes and opens doors: the raw send at Entrana's range (inside a house) did
    // nothing on prod for four 10-minute trips (ABGARMY09, 2026-11-04). Raw send after q.reach as a fallback.
    const r = await q.bot.useItemOnLoc(it, loc).catch(() => null);
    if (!r?.success) {
        await q.reach(name).catch(() => undefined);
        await q.sdk.sendUseItemOnLoc(it.slot, loc.x, loc.z, loc.id);
    }
    await untilTicks(q.sdk, (s) => done() || !!s.dialog?.isOpen, ticks + 20);
    if (q.sdk.getDialog()?.isOpen) await driveDialog(q.sdk, choices, { done, ticks: 20, log: q.log });
    return untilTicks(q.sdk, done, ticks);
}

/** Pick up `item` lying on `spot` (we stand within a few tiles); true once one more is held. */
async function pickUpAt(q: Quest, item: RegExp, spot: Tile): Promise<boolean> {
    const g = (q.sdk.getState()?.groundItems ?? []).find((i) => item.test(i.name) && i.x === spot.x && i.z === spot.z);
    if (!g) return false;
    const before = countOf(q, item);
    await q.bot.pickupItem(g).catch(() => undefined);
    return untilTicks(q.sdk, () => countOf(q, item) > before, 15);
}

// ── gems (Shilo Village's gem rocks)

export type LegendsGem = 'opal' | 'jade' | 'red topaz';
const GEM_ROCK_ID = 2111;
/** Between the seven gem rocks (2824,2998)-(2829,3003). */
const GEM_MINE = { x: 2826, z: 3000 };
/** gem.dbrow: the level each cut needs. */
export const GEM_CUT_LEVEL: Record<LegendsGem, number> = { opal: 1, jade: 13, 'red topaz': 16 };
const UNCUT_ANY = /^uncut (opal|jade|red topaz|sapphire|emerald|ruby|diamond)$/i;
const uncut = (gem: string) => new RegExp(`^uncut ${esc(gem)}$`, 'i');
const CHISEL = /^chisel$/i;
const CRUSHED = /^crushed gem(stone)?$/i;
/** A swing self-queues server-side: wait on the bag, not the click. */
const SWING_TICKS = 40;
/** A rock that paid nothing (depleted, or someone else's) is skipped this long; respawn is 200t. */
const ROCK_COOLDOWN_TICKS = 60;
/** The mining budget for one call: ~27% a swing at Mining 99, ~8.5 rocks a red topaz. */
const GEM_BUDGET_TICKS = 6_000;

/** Cut every held uncut `gem` with the chisel. Smashes leave a crushed gem, dropped here. */
async function cutHeld(q: Quest, gem: LegendsGem): Promise<void> {
    for (let guard = 0; guard < 30; guard++) {
        const u = held(q, uncut(gem));
        const chisel = held(q, CHISEL);
        if (!u || !chisel) return;
        if (q.level('crafting') < GEM_CUT_LEVEL[gem]) throw new Error(`gems: Crafting ${q.level('crafting')} cannot cut ${gem} (needs ${GEM_CUT_LEVEL[gem]})`);
        const before = countOf(q, uncut(gem));
        await q.sdk.sendUseItemOnItem(u.slot, chisel.slot);
        if (!(await untilTicks(q.sdk, () => countOf(q, uncut(gem)) < before, 8))) {
            q.log(`gems: cutting ${gem} did not take at ${where(q)}`);
            await q.bot.dismissBlockingUI().catch(() => undefined);
            continue;
        }
        await q.bot.dismissBlockingUI().catch(() => undefined);
    }
    for (let guard = 0; guard < 6; guard++) {
        const c = held(q, CRUSHED);
        if (!c) break;
        await q.sdk.sendDropItem(c.slot);
        await untilTicks(q.sdk, () => !q.sdk.getInventory().some((i) => i.slot === c.slot && CRUSHED.test(i.name)), 4);
    }
}

const LEGENDS_GEMS: LegendsGem[] = ['opal', 'jade', 'red topaz'];
/** Cut every legends gem held that the account's Crafting allows: the other two are stock too. */
async function cutAll(q: Quest): Promise<void> {
    for (const g of LEGENDS_GEMS) if (q.level('crafting') >= GEM_CUT_LEVEL[g]) await cutHeld(q, g);
}

/**
 * Make room for one more gem (Shilo has no bank): drop the other legends gems held beyond `keep`
 * each (uncut first), then the cheapest precious uncut (sapphire, emerald, ruby; diamonds last).
 * Never the gem we are after. False when nothing could go.
 */
async function makeRoom(q: Quest, gem: LegendsGem, keep: number): Promise<boolean> {
    const drop = async (re: RegExp) => {
        const it = held(q, re);
        if (!it) return false;
        await q.sdk.sendDropItem(it.slot);
        return untilTicks(q.sdk, () => freeSlots(q) > 0, 4);
    };
    for (const other of LEGENDS_GEMS.filter((g) => g !== gem)) {
        if (q.count(`uncut ${other}`) + q.count(other) > keep && ((await drop(uncut(other))) || (await drop(new RegExp(`^${esc(other)}$`, 'i'))))) return true;
    }
    for (const precious of ['sapphire', 'emerald', 'ruby', 'diamond']) if (await drop(uncut(precious))) return true;
    for (const other of LEGENDS_GEMS.filter((g) => g !== gem)) if (await drop(uncut(other))) return true;
    return freeSlots(q) > 0;
}

/**
 * Hold `count` cut `gem`: into Shilo Village, mine its gem rocks, cut as they come. The other legends
 * gems are cut and kept (up to `count` each when the pack fills), spare sapphires and better too. Needs
 * Shilo Village complete, Mining 40, the gem's Crafting level, a pickaxe and a chisel.
 */
export async function mineShiloGems(q: Quest, gem: LegendsGem, count: number): Promise<void> {
    await cutHeld(q, gem);
    if (q.count(gem) >= count) return;
    if (q.level('mining') < 40) throw new Error(`gems: Mining ${q.level('mining')} — gem rocks need 40`);
    if (q.level('crafting') < GEM_CUT_LEVEL[gem]) throw new Error(`gems: Crafting ${q.level('crafting')} — ${gem} needs ${GEM_CUT_LEVEL[gem]}`);
    await q.ensure('chisel', 1);
    await q.ensure('pickaxe', 1);
    const { enterShiloVillage } = await import('./shilo-village');
    await enterShiloVillage(q);
    if (dist(q, GEM_MINE) > 6) await q.goTo(GEM_MINE, 3);
    const t0 = tickNow(q.sdk);
    const cooling = new Map<string, number>();
    let mined = 0;
    let dry = 0;
    while (q.count(gem) < count && tickNow(q.sdk) - t0 < GEM_BUDGET_TICKS && dry < 20) {
        if (freeSlots(q) < 1 && !(await makeRoom(q, gem, count))) throw new Error(`gems: pack full of keepers at ${q.count(gem)}/${count} ${gem}`);
        const now = tickNow(q.sdk);
        const rock = (await locs(q, 10))
            .filter((l) => l.id === GEM_ROCK_ID && l.optionsWithIndex.some((o) => /^mine$/i.test(o.text)) && (cooling.get(`${l.x},${l.z}`) ?? 0) <= now)
            .sort((a, b) => Math.hypot(a.x - GEM_MINE.x, a.z - GEM_MINE.z) - Math.hypot(b.x - GEM_MINE.x, b.z - GEM_MINE.z) || (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!rock) {
            // All seven depleted (200t respawn) or taken.
            await q.sdk.waitForTicks(10);
            dry++;
            continue;
        }
        const before = countOf(q, UNCUT_ANY);
        await q.bot.interactLoc(rock, /^mine$/i).catch(() => undefined);
        await untilTicks(
            q.sdk,
            (s) => countOf(q, UNCUT_ANY) > before || !s.nearbyLocs.some((l) => l.x === rock.x && l.z === rock.z && l.id === rock.id),
            SWING_TICKS
        );
        await q.bot.dismissBlockingUI().catch(() => undefined);
        if (countOf(q, UNCUT_ANY) > before) {
            mined++;
            dry = 0;
            await cutAll(q);
        } else dry++;
        // A gem rock gives one gem and depletes (next_loc_stage_mining): whatever happened, move on.
        cooling.set(`${rock.x},${rock.z}`, tickNow(q.sdk) + ROCK_COOLDOWN_TICKS);
    }
    await cutAll(q);
    const spare = q.sdk.getInventory().filter((i) => UNCUT_ANY.test(i.name)).map((i) => i.name.replace(/^uncut /i, ''));
    q.log(`gems: ${q.count(gem)}/${count} ${gem} after ${mined} gems in ${tickNow(q.sdk) - t0}t${spare.length ? `; also holding uncut ${spare.join(', ')}` : ''}`);
}

// ── lockpick (the Yanille dungeon's spider room)

/** The staircase outside Yanille's north-west wall (stairs_cellar 2569,3122) down to (2569,9525). */
const WEST_STAIRS_DOWN = { x: 2569, z: 3122 };
/** loc_1734 at the foot of the west staircase, back up. */
const WEST_STAIRS_UP = { x: 2569, z: 9522 };
/** The town staircase (2603,3078) and its foot (2601,9478): behind the Thieving 82 door, the way out only. */
const TOWN_STAIRS_UP = { x: 2603, z: 9478 };
const TOWN_FOOT = { x: 2601, z: 9478 };
/** loc_2559 (locked_door.dbrow: Thieving 82 + a lockpick from the stairs side, open from the druids' side). */
const LOCKED_DOOR = { x: 2601, z: 9482 };
/** balancing_ledge3 (Agility 40): from its north start (2580,9520) south to (2580,9512). */
const LEDGE = { x: 2580, z: 9519 };
const LEDGE_NORTH = { x: 2580, z: 9520 };
/** monkeybars_end2 (Agility 57 from the north end; a fall drops into the pit below). */
const MONKEYBARS = { x: 2598, z: 9494 };
const MONKEYBARS_NORTH = { x: 2599, z: 9495 };
/** The pit under the ledge and the bars, and its staircase (balance40up) back up to (2567,9524). */
const PIT_STAIRS = { x: 2578, z: 9584 };
/** The staircase down to the spider room (2620,9497) and the one back up from it (2620,9562). */
const SPIDER_STAIRS_DOWN = { x: 2620, z: 9497 };
const SPIDER_STAIRS_UP = { x: 2620, z: 9562 };
const LOCKPICK_SPAWN = { x: 2615, z: 9571 };
const LOCKPICK = /^lockpick$/i;
const inYanilleDungeon = (q: Quest) => pos(q).x >= 2560 && pos(q).x <= 2623 && pos(q).z >= 9472 && pos(q).z <= 9599;
/** The spawn's room (east of x 2604, below the druids). */
const inSpiderRoom = (q: Quest) => inYanilleDungeon(q) && pos(q).z >= 9550 && pos(q).x >= 2604;
/** The pit a ledge or monkey-bar fall lands in (west of the spider room). */
const inPit = (q: Quest) => inYanilleDungeon(q) && pos(q).z >= 9550 && pos(q).x < 2604;
/** The druids' chamber: east of the bars' south end, the spider stairs and the door's far side. */
const inDruidChamber = (q: Quest) =>
    inYanilleDungeon(q) && pos(q).z >= 9483 && pos(q).z <= 9500 && pos(q).x >= 2596 && !(pos(q).z >= 9494 && pos(q).x <= 2600);
/** The town staircase's foot, south of the locked door. */
const atTownFoot = (q: Quest) => inYanilleDungeon(q) && pos(q).z < LOCKED_DOOR.z && pos(q).x >= 2596;
/** The ledge and the bars' tries (a fall costs a climb out of the pit). */
const OBSTACLE_TRIES = 6;
/** Three visits, the spawn's respawn (100t, scaled by players online) waited out twice, and the walks. */
const LOCKPICK_BUDGET_TICKS = 2_000;

async function spiderStairsUp(q: Quest): Promise<void> {
    await q.bot.walkTo(SPIDER_STAIRS_UP.x, SPIDER_STAIRS_UP.z + 3, 1).catch(() => undefined);
    await opLoc(q, SPIDER_STAIRS_UP, /^staircase$/i, /^climb-up$/i, () => !inSpiderRoom(q), 'lockpick: spider room stairs up');
}

/** Up from the pit by its staircase into the west part. */
async function outOfPit(q: Quest): Promise<void> {
    await q.bot.walkTo(PIT_STAIRS.x, PIT_STAIRS.z - 1, 2).catch(() => undefined);
    await opLoc(q, PIT_STAIRS, /^staircase$/i, /^climb-up$/i, () => !inPit(q), 'lockpick: pit stairs');
}

/** A sharp blade for the webs (web.rs2: a knife, or anything with a slash attack used on the web). */
const BLADE = /^knife$|scimitar|sword|longsword|dagger|battleaxe|axe$/i;
/** Outside the north wall of the ruin around the west staircase. */
const WEST_RUIN_NORTH = { x: 2571, z: 3128 };

/**
 * To the west staircase: its ruin (x 2566-2573, z 3119-3125) is shut by slashable webs (2565,3124;
 * 2569/2570,3118). Cut one with the blade (half the slashes fail; a cut web grows back in 100t).
 */
async function toWestStairs(q: Quest): Promise<void> {
    if (!held(q, BLADE)) await q.ensure('knife', 1);
    for (let attempt = 1; attempt <= 10; attempt++) {
        if (dist(q, WEST_RUIN_NORTH) > 8) await q.goTo(WEST_RUIN_NORTH, 3);
        const stairs = await findLoc(q, /^staircase$/i, /^climb-down$/i, WEST_STAIRS_DOWN, 1);
        if (!stairs) throw new Error(`lockpick: no west staircase at (${WEST_STAIRS_DOWN.x},${WEST_STAIRS_DOWN.z}) from ${where(q)}`);
        if (stairs.reachable !== false) return;
        const webs = (await locs(q, 10)).filter((l) => /^web$/i.test(l.name) && l.optionsWithIndex.some((o) => /slash/i.test(o.text)) && Math.abs(l.x - WEST_STAIRS_DOWN.x) <= 5 && Math.abs(l.z - WEST_STAIRS_DOWN.z) <= 7);
        const web = webs.sort((a, b) => Number(b.reachable !== false) - Number(a.reachable !== false) || (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!web) {
            await q.sdk.waitForTicks(3);
            continue;
        }
        const blade = held(q, BLADE)!;
        await q.sdk.sendUseItemOnLoc(blade.slot, web.x, web.z, web.id);
        await untilTicks(q.sdk, () => !(q.sdk.getNearbyLocs() ?? []).some((l) => l.x === web.x && l.z === web.z && l.id === web.id), 12);
    }
    const stairs = await findLoc(q, /^staircase$/i, /^climb-down$/i, WEST_STAIRS_DOWN, 1);
    if (stairs?.reachable === false) throw new Error(`lockpick: the webs round the west staircase stayed shut (at ${where(q)})`);
}

/** Op an agility obstacle (the first option) and wait for where it lands. */
async function obstacle(q: Quest, at: Tile, name: RegExp, landed: () => boolean, label: string): Promise<void> {
    const loc = await findLoc(q, name, null, at, 2);
    if (!loc || !loc.optionsWithIndex[0]) throw new Error(`lockpick: no ${label} near (${at.x},${at.z}) from ${where(q)}`);
    await q.sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex[0].opIndex);
    await untilTicks(q.sdk, () => landed() || inPit(q), 30);
    await q.sdk.waitForTicks(3);
    q.log(`lockpick: ${label} ${inPit(q) ? 'fell into the pit' : landed() ? 'crossed' : 'did nothing'} (${where(q)})`);
}

/**
 * Into the druids' chamber the only way without Thieving 82 and a lockpick: the west staircase, the
 * ledge (Agility 40) and the monkey bars (57). A fall from either lands in the pit; out and again.
 */
async function toDruidChamber(q: Quest): Promise<void> {
    if (inDruidChamber(q)) return;
    if (q.level('agility') < 57) throw new Error(`lockpick: Agility ${q.level('agility')} — the monkey bars to the spider room need 57 (or Thieving 82 and a lockpick for the town door)`);
    for (let attempt = 1; attempt <= OBSTACLE_TRIES && !inDruidChamber(q); attempt++) {
        if (inSpiderRoom(q)) await spiderStairsUp(q);
        if (inDruidChamber(q)) break;
        if (inPit(q)) await outOfPit(q);
        if (atTownFoot(q)) await leaveYanilleDungeon(q);
        if (!inYanilleDungeon(q)) {
            await toWestStairs(q);
            await opLoc(q, WEST_STAIRS_DOWN, /^staircase$/i, /^climb-down$/i, () => inYanilleDungeon(q), 'lockpick: Yanille west dungeon stairs');
        }
        // North of the ledge: over it, south.
        if (pos(q).z >= 9516) {
            await q.bot.walkTo(LEDGE_NORTH.x, LEDGE_NORTH.z, 0).catch(() => undefined);
            await obstacle(q, LEDGE, /ledge/i, () => pos(q).z <= 9513 && !inPit(q), 'ledge');
            if (inPit(q)) continue;
        }
        // Between the ledge and the bars: swing south.
        if (pos(q).z > 9494 && pos(q).z < 9516) {
            await q.bot.walkTo(MONKEYBARS_NORTH.x, MONKEYBARS_NORTH.z, 0).catch(() => undefined);
            await obstacle(q, MONKEYBARS, /^monkeybars$/i, () => pos(q).z <= 9490 && !inPit(q), 'monkey bars');
        }
    }
    if (!inDruidChamber(q)) throw new Error(`lockpick: could not reach the druids' chamber (at ${where(q)})`);
}

/** Back up to Yanille: out of the spider room, through the door from its open side, up the town stairs. */
export async function leaveYanilleDungeon(q: Quest): Promise<void> {
    if (!inYanilleDungeon(q)) return;
    if (inPit(q)) await outOfPit(q);
    if (inSpiderRoom(q)) await spiderStairsUp(q);
    if (inDruidChamber(q)) {
        await q.bot.walkTo(LOCKED_DOOR.x, LOCKED_DOOR.z + 1, 0).catch(() => undefined);
        await opLoc(q, LOCKED_DOOR, /door/i, /^open$/i, () => atTownFoot(q), 'lockpick: the locked door (open side)');
    }
    if (atTownFoot(q)) {
        await q.bot.walkTo(TOWN_FOOT.x, TOWN_FOOT.z, 1).catch(() => undefined);
        await opLoc(q, TOWN_STAIRS_UP, /^staircase$/i, /^climb-up$/i, () => !inYanilleDungeon(q), 'lockpick: town stairs up');
    } else if (inYanilleDungeon(q)) {
        await q.bot.walkTo(WEST_STAIRS_UP.x, WEST_STAIRS_UP.z + 2, 1).catch(() => undefined);
        await opLoc(q, WEST_STAIRS_UP, /^staircase$/i, /^climb-up$/i, () => !inYanilleDungeon(q), 'lockpick: west stairs up');
    }
    if (inYanilleDungeon(q)) throw new Error(`lockpick: still in the Yanille dungeon at ${where(q)}`);
    q.log(`lockpick: out of the Yanille dungeon at ${where(q)}`);
}

/**
 * Hold `count` lockpicks: one per visit to the spider room's spawn, the respawn waited out in the
 * druids' chamber above. Agility 57 (the ledge and the monkey bars); no Thieving.
 */
export async function yanilleLockpicks(q: Quest, count: number): Promise<void> {
    const t0 = tickNow(q.sdk);
    let emptyVisits = 0;
    while (countOf(q, LOCKPICK) < count && tickNow(q.sdk) - t0 < LOCKPICK_BUDGET_TICKS && emptyVisits < 6) {
        if (!inSpiderRoom(q)) {
            await toDruidChamber(q);
            const r = await q.bot.walkTo(SPIDER_STAIRS_DOWN.x, SPIDER_STAIRS_DOWN.z - 1, 1);
            if (!r.success && dist(q, SPIDER_STAIRS_DOWN) > 3) throw new Error(`lockpick: could not walk to the spider room stairs from ${where(q)}: ${r.message}`);
            await opLoc(q, SPIDER_STAIRS_DOWN, /^staircase$/i, /^climb-down$/i, () => inSpiderRoom(q), 'lockpick: spider room stairs down');
        }
        await q.bot.walkTo(LOCKPICK_SPAWN.x + 1, LOCKPICK_SPAWN.z, 1).catch(() => undefined);
        await untilTicks(q.sdk, (s) => s.groundItems.some((g) => LOCKPICK.test(g.name)), 3);
        if (await pickUpAt(q, LOCKPICK, LOCKPICK_SPAWN)) {
            q.log(`lockpick: picked one (${countOf(q, LOCKPICK)}/${count}) at ${tickNow(q.sdk) - t0}t`);
            emptyVisits = 0;
            if (countOf(q, LOCKPICK) >= count) break;
        } else {
            emptyVisits++;
            q.log(`lockpick: none on the spawn (visit ${emptyVisits})`);
        }
        // The respawn is waited out by the stairs up top, not among the spiders.
        await spiderStairsUp(q);
        await q.sdk.waitForTicks(100);
    }
    await leaveYanilleDungeon(q);
    if (countOf(q, LOCKPICK) < count) throw new Error(`lockpick: ${countOf(q, LOCKPICK)}/${count} in ${tickNow(q.sdk) - t0}t`);
}

// ── molten glass and orbs (Entrana)

const onEntrana = (q: Quest) => pos(q).level === 0 && pos(q).x >= 2800 && pos(q).x <= 2880 && pos(q).z >= 3320 && pos(q).z <= 3400;
const PORT_SARIM_MONK = { x: 3045, z: 3236 };
const SAND_PIT = { x: 2816, z: 3341 };
const ENTRANA_RANGE = { x: 2822, z: 3351 };
const ENTRANA_FURNACE = { x: 2833, z: 3351 };
const PIPE_SPAWN = { x: 2822, z: 3355 };
const SEAWEED_SPAWNS: Tile[] = [
    { x: 2803, z: 3382 }, { x: 2804, z: 3380 }, { x: 2804, z: 3385 }, { x: 2805, z: 3381 }, { x: 2805, z: 3384 },
    { x: 2807, z: 3384 }, { x: 2807, z: 3386 }, { x: 2809, z: 3385 }, { x: 2809, z: 3388 }, { x: 2810, z: 3387 },
];
const BUCKET = /^bucket$/i;
const SAND = /^bucket of sand$/i;
const SEAWEED = /^seaweed$/i;
const SODA_ASH = /^soda ash$/i;
const GLASS = /^molten glass$/i;
const PIPE = /^glassblowing pipe$/i;
const ORB = /^unpowered orb$/i;
/** What may sail: the monks search for weapons and armour (pickaxes too); the rest stays banked anyway. */
const ENTRANA_KEEP = [BUCKET, SAND, SEAWEED, SODA_ASH, GLASS, PIPE, ORB, /^coins$/i, /rune$/i];
/** Per trip: N buckets + N seaweed (then N ash) + the pipe. */
const MAX_BATCH = 12;

async function sailToEntrana(q: Quest): Promise<void> {
    if (onEntrana(q)) return;
    await q.goTo(SAFE_BANKS.draynor, 4);
    await depositAllInventory(q.supply, ENTRANA_KEEP);
    await q.bot.closeBank().catch(() => undefined);
    await q.talk(/^monk of entrana$/i, [/yes,? okay,? i'?m ready to go/i], PORT_SARIM_MONK);
    const before = pos(q);
    const sailed = () => onEntrana(q) || pos(q).level > 0 || Math.hypot(pos(q).x - before.x, pos(q).z - before.z) > 40;
    if (!(await untilTicks(q.sdk, sailed, 40))) throw new Error(`glass: the monks did not sail us (at ${where(q)}; carrying ${q.sdk.getInventory().map((i) => i.name).join(', ')})`);
    await driveDialog(q.sdk, [], { ticks: 20, log: q.log });
    if (pos(q).level > 0) {
        await q.sdk.scanNearbyLocs(10).catch(() => undefined);
        const plank = q.sdk.findNearbyLoc(/gangplank/i);
        if (plank) await q.bot.interactLoc(plank, /cross/i);
        await untilTicks(q.sdk, () => pos(q).level === 0, 15);
    }
    if (!onEntrana(q)) throw new Error(`glass: not on Entrana after the boat (at ${where(q)})`);
    q.log(`glass: on Entrana at ${where(q)}`);
}

/** Seaweed off the north-west shore until holding `n` (two respawn cycles at most). */
async function pickSeaweed(q: Quest, n: number): Promise<void> {
    const t0 = tickNow(q.sdk);
    while (countOf(q, SEAWEED) < n && tickNow(q.sdk) - t0 < 400) {
        let took = false;
        for (const spot of SEAWEED_SPAWNS) {
            if (countOf(q, SEAWEED) >= n) break;
            if (!(q.sdk.getState()?.groundItems ?? []).some((g) => SEAWEED.test(g.name) && g.x === spot.x && g.z === spot.z)) {
                if (dist(q, spot) > 10) await q.goTo(spot, 3);
                if (!(q.sdk.getState()?.groundItems ?? []).some((g) => SEAWEED.test(g.name) && g.x === spot.x && g.z === spot.z)) continue;
            }
            took = (await pickUpAt(q, SEAWEED, spot)) || took;
        }
        if (!took && countOf(q, SEAWEED) < n) await q.sdk.waitForTicks(10);
    }
    q.log(`glass: ${countOf(q, SEAWEED)}/${n} seaweed in ${tickNow(q.sdk) - t0}t`);
}

/**
 * Hold `glass` molten glass and `orbs` unpowered orbs (orbs are blown from molten glass: Crafting 46).
 * One Entrana trip per MAX_BATCH. Inputs already held (sand, ash, glass, the pipe) are used first.
 */
export async function entranaGlass(q: Quest, want: { glass?: number; orbs?: number }): Promise<void> {
    const orbs = want.orbs ?? 0;
    const glassTarget = () => (want.glass ?? 0) + Math.max(0, orbs - countOf(q, ORB));
    if (orbs > countOf(q, ORB) && q.level('crafting') < 46) throw new Error(`glass: Crafting ${q.level('crafting')} — an orb needs 46`);
    const t0 = tickNow(q.sdk);
    for (let trip = 1; trip <= 4 && (countOf(q, GLASS) < glassTarget() || countOf(q, ORB) < orbs); trip++) {
        // Molten glass still to make this trip, and the buckets it takes.
        const n = Math.min(MAX_BATCH, glassTarget() - countOf(q, GLASS));
        if (n > 0) {
            const buckets = Math.max(0, n - countOf(q, SAND) - countOf(q, BUCKET));
            if (buckets > 0 && !onEntrana(q)) await q.ensure('bucket', countOf(q, BUCKET) + buckets);
            await sailToEntrana(q);
            // The glassblowing pipe (spawn by the range's house) for the orbs.
            if (orbs > countOf(q, ORB) && !held(q, PIPE)) {
                await q.goTo(PIPE_SPAWN, 2);
                for (let i = 0; i < 12 && !held(q, PIPE); i++) {
                    if (await pickUpAt(q, PIPE, PIPE_SPAWN)) break;
                    await q.sdk.waitForTicks(10);
                }
                if (!held(q, PIPE)) throw new Error(`glass: no glassblowing pipe at (${PIPE_SPAWN.x},${PIPE_SPAWN.z}) in 120t`);
            }
            const ash = n - countOf(q, SODA_ASH);
            if (ash > countOf(q, SEAWEED)) await pickSeaweed(q, ash);
            // Seaweed on the range: soda ash, one at a time (a count dialog is answered with its largest).
            if (held(q, SEAWEED)) await q.goTo(ENTRANA_RANGE, 3);
            for (let guard = 0; guard < 2 * MAX_BATCH && held(q, SEAWEED); guard++) {
                const before = countOf(q, SEAWEED);
                await useOnLoc(q, SEAWEED, ENTRANA_RANGE, /^range$/i, () => countOf(q, SEAWEED) < before, [/all|cook|soda/i], 10);
                await untilTicks(q.sdk, () => countOf(q, SEAWEED) === 0, before * 4);
                await q.bot.dismissBlockingUI().catch(() => undefined);
            }
            // Buckets in the sand pit.
            if (held(q, BUCKET)) await q.goTo({ x: SAND_PIT.x + 2, z: SAND_PIT.z }, 2);
            for (let guard = 0; guard < 2 * MAX_BATCH && held(q, BUCKET) && countOf(q, SAND) < n; guard++) {
                const before = countOf(q, SAND);
                await useOnLoc(q, BUCKET, SAND_PIT, /^sand pit$/i, () => countOf(q, SAND) > before, [], 6);
            }
            // Sand and ash into the furnace: one molten glass a use.
            if (held(q, SAND) && held(q, SODA_ASH)) await q.goTo(ENTRANA_FURNACE, 3);
            for (let guard = 0; guard < 2 * MAX_BATCH && held(q, SAND) && held(q, SODA_ASH) && countOf(q, GLASS) < glassTarget(); guard++) {
                const before = countOf(q, GLASS);
                await useOnLoc(q, SAND, ENTRANA_FURNACE, /^furnace$/i, () => countOf(q, GLASS) > before, [], 8);
                await q.bot.dismissBlockingUI().catch(() => undefined);
            }
            q.log(`glass: trip ${trip}: ${countOf(q, GLASS)} molten glass, ${countOf(q, SAND)} sand and ${countOf(q, SODA_ASH)} ash left`);
        }
        // Orbs: the pipe on molten glass, "Orb" in the glassblowing menu.
        for (let guard = 0; guard < 2 * MAX_BATCH && countOf(q, ORB) < orbs && held(q, GLASS); guard++) {
            const pipe = held(q, PIPE);
            const glass = held(q, GLASS);
            if (!pipe || !glass) break;
            const before = countOf(q, ORB);
            await q.sdk.sendUseItemOnItem(pipe.slot, glass.slot);
            if (!(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || countOf(q, ORB) > before, 10))) {
                q.log(`glass: the glassblowing menu did not open at ${where(q)}`);
                continue;
            }
            const d = q.sdk.getDialog();
            if (d?.isOpen) {
                const opt = d.options.find((o) => /orb/i.test(o.text) && /^make 1|^orb$|1$/i.test(o.text)) ?? d.options.find((o) => /orb/i.test(o.text));
                if (!opt) {
                    q.log(`glass: no Orb in the glassblowing menu (${d.options.map((o) => `${o.index}:${o.text}`).join(', ')})`);
                    break;
                }
                await q.sdk.sendClickDialog(opt.index);
            }
            await untilTicks(q.sdk, () => countOf(q, ORB) > before, 8);
            await q.bot.dismissBlockingUI().catch(() => undefined);
        }
        if (countOf(q, ORB) < orbs && countOf(q, GLASS) === 0 && trip >= 4) break;
    }
    q.log(`glass: ${countOf(q, GLASS)} molten glass, ${countOf(q, ORB)} unpowered orbs in ${tickNow(q.sdk) - t0}t`);
}
