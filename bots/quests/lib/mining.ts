/**
 * Mining primitives shared by item sources (ores for quests) and skill training.
 *
 * Rock loc ids come from skill_mining/configs/mine.dbrow + rocks.loc. Every rock
 * is named "Rocks", so only the id tells clay from tin. Tiles from offline map
 * data (see the pre-runner dorics-quest.ts header):
 *   Rimmington mine  clay (2986,3239) (2987,3240), copper (2976..2979,3245..3248),
 *                    iron (2968..2971,3237..3242) (2981,3233) (2982,3234)
 *   anchor (2980,3242) — walkable, all three ores within 14 tiles
 */
import type { Quest } from './run-quest';
import { tickNow, untilTicks } from './ticks';

export type Ore = 'clay' | 'copper ore' | 'iron ore';

export const ROCKS: Record<Ore, { ids: Set<number>; level: number }> = {
    clay: { ids: new Set([2108, 2109, 2137, 2138]), level: 1 },
    'copper ore': { ids: new Set([2090, 2091, 2119, 2120]), level: 1 },
    'iron ore': { ids: new Set([2092, 2093, 2121, 2122]), level: 15 },
};

export const RIMMINGTON_MINE = { x: 2980, z: 3242 };

/** Ticks a rock that gave nothing is skipped: depleted, or held by another miner. */
const ROCK_COOLDOWN_TICKS = 40;
/** Ticks one swing may take to land an ore before the rock is treated as dry. */
const SWING_TICKS = 40;
/** Consecutive dry swings before mining gives up. */
const MAX_MISSES = 12;

const named = (ore: Ore) => new RegExp(`^${ore}$`, 'i');

const cooling = new Map<string, number>();
const key = (r: { x: number; z: number }) => `${r.x},${r.z}`;

async function findRock(q: Quest, ore: Ore) {
    const locs = (await q.sdk.scanNearbyLocs(16).catch(() => undefined)) ?? q.sdk.getNearbyLocs() ?? [];
    const now = tickNow(q.sdk);
    const rocks = locs
        .filter((l) => ROCKS[ore].ids.has(l.id) && l.optionsWithIndex.some((o) => /^mine$/i.test(o.text)))
        .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
    return rocks.find((r) => (cooling.get(key(r)) ?? 0) <= now) ?? null;
}

/**
 * Mine `ore` at the Rimmington mine until holding `count` (or, with `drop`,
 * until `until()` holds — training mines and drops). Waits on the bag, not the
 * click: a swing self-queues server-side and lands only on a successful roll.
 */
export async function mineAtRimmington(q: Quest, ore: Ore, opts: { count?: number; until?: () => boolean; dropAbove?: number }): Promise<void> {
    const done = () => (opts.until ? opts.until() : q.count(ore) >= (opts.count ?? 0));
    if (done()) return;
    if (Math.hypot(q.sdk.getState()!.player!.worldX - RIMMINGTON_MINE.x, q.sdk.getState()!.player!.worldZ - RIMMINGTON_MINE.z) > 12) {
        await q.goTo(RIMMINGTON_MINE, 6);
    }
    const t0 = tickNow(q.sdk);
    let mined = 0;
    for (let misses = 0; misses < MAX_MISSES && !done(); ) {
        if (opts.dropAbove != null && q.count(ore) > opts.dropAbove && q.sdk.getInventory().length >= 27) {
            await dropDown(q, ore, opts.dropAbove);
        }
        const rock = await findRock(q, ore);
        if (!rock) {
            await q.sdk.waitForTicks(4);
            misses++;
            continue;
        }
        const before = q.count(ore);
        await q.bot.interactLoc(rock, /^mine$/i);
        const gained = await untilTicks(
            q.sdk,
            (s) => s.inventory.filter((i) => named(ore).test(i.name)).length > before || !s.nearbyLocs.some((l) => l.x === rock.x && l.z === rock.z && l.id === rock.id),
            SWING_TICKS
        );
        if (q.count(ore) > before) {
            mined++;
            misses = 0;
            continue;
        }
        // Rock changed (someone else got it) or never paid out: skip it a while.
        cooling.set(key(rock), tickNow(q.sdk) + ROCK_COOLDOWN_TICKS);
        if (!gained) misses++;
    }
    if (opts.dropAbove != null) await dropDown(q, ore, opts.dropAbove);
    q.log(`mined ${mined} ${ore} in ${tickNow(q.sdk) - t0}t (holding ${q.count(ore)})`);
}

/** Drop `ore` until holding `keep`. Used by training so the bag never fills. */
async function dropDown(q: Quest, ore: Ore, keep: number): Promise<void> {
    for (let guard = 0; guard < 28 && q.count(ore) > keep; guard++) {
        const item = q.sdk.getInventory().find((i) => named(ore).test(i.name));
        if (!item) return;
        const before = q.count(ore);
        await q.sdk.sendDropItem(item.slot);
        await untilTicks(q.sdk, (s) => s.inventory.filter((i) => named(ore).test(i.name)).length < before, 4);
    }
}

/**
 * Blurite: the cave under Thurgo's hut. Ladder 1759 at (3008,3150) climbs down to
 * (3008,9550); blurite rocks (loc 2110) are at (3049,9566) and (3059,9564), with
 * ice warriors and giants standing on them. One ore per trip and straight back up
 * — camping the rock is what killed accounts in the pre-runner script.
 */
const BLURITE_LADDER = { x: 3008, z: 3150 };
const BLURITE_ROCK = { x: 3047, z: 9566 };
const BLURITE_ROCK_ID = 2110;
const UNDERGROUND = (s: { player?: { worldZ?: number } | null }) => (s.player?.worldZ ?? 0) > 9000;
const FOOD = /shark|lobster|swordfish|monkfish|tuna|trout|salmon|bread|cake|meat|chicken/i;

export async function mineBlurite(q: Quest, count: number): Promise<void> {
    const ore = /^blurite ore$/i;
    const eatIfHurt = async () => {
        const p = q.sdk.getState()?.player;
        const max = q.sdk.getSkill('Hitpoints')?.baseLevel ?? 10;
        const food = q.sdk.findInventoryItem(FOOD);
        if (p && food && (p.hp ?? max) < max * 0.4) await q.bot.eatFood(food).catch(() => undefined);
    };
    for (let trip = 1; trip <= 4 && q.count(ore) < count; trip++) {
        await q.goTo(BLURITE_LADDER, 2);
        await q.sdk.scanNearbyLocs(8).catch(() => undefined);
        const down = q.sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-down/i });
        if (!down) throw new Error(`no climb-down ladder at the blurite cave (${BLURITE_LADDER.x},${BLURITE_LADDER.z})`);
        await q.bot.interactLoc(down, /climb-down/i);
        if (!(await untilTicks(q.sdk, UNDERGROUND, 20))) continue;
        await q.bot.walkTo(BLURITE_ROCK.x, BLURITE_ROCK.z, 2).catch(() => undefined);
        await q.sdk.scanNearbyLocs(20).catch(() => undefined);
        const rock = (q.sdk.getNearbyLocs() ?? []).find((l) => l.id === BLURITE_ROCK_ID && l.optionsWithIndex.some((o) => /^mine$/i.test(o.text)));
        if (rock) {
            const before = q.count(ore);
            await q.bot.interactLoc(rock, /^mine$/i);
            const start = tickNow(q.sdk);
            while (q.count(ore) <= before && tickNow(q.sdk) - start < SWING_TICKS) {
                await eatIfHurt();
                await q.sdk.waitForTicks(2);
            }
        } else q.log(`blurite trip ${trip}: no mineable rock near (${BLURITE_ROCK.x},${BLURITE_ROCK.z})`);
        q.log(`blurite trip ${trip}: ${q.count(ore)}/${count}, hp ${q.sdk.getState()?.player?.hp ?? '?'}`);
        // Back to the ladder and up, ore or not.
        await q.bot.walkTo(BLURITE_LADDER.x + 1, 9550, 2).catch(() => undefined);
        await q.sdk.scanNearbyLocs(12).catch(() => undefined);
        const up = q.sdk.findNearbyLoc(/^ladder$/i, { withOption: /climb-up/i });
        if (up) await q.bot.interactLoc(up, /climb-up/i);
        await untilTicks(q.sdk, (s) => !UNDERGROUND(s), 20);
        if (q.sdk.getState() && UNDERGROUND(q.sdk.getState()!)) throw new Error('stuck in the blurite cave');
    }
}
