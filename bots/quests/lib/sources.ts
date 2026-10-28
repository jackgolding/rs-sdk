/**
 * Item sources — how any quest gets an ordinary item it needs.
 *
 * One entry per item, shared by every quest. `inputs` lets the hub prologue
 * withdraw what a source consumes (shears to make wool) in the same bank visit;
 * `get` is the procedure that produces the item when the bank had none.
 * Items a quest must obtain through its own step (e.g. a quest key the game
 * records you picking up) are not sources — leave them to the transition, or
 * mark them `spawnable: false` so assisted runs never fake them.
 */
import type { Quest } from './run-quest';
import { tickNow, ticksToMs, untilTicks } from './ticks';

export interface Need {
    /** Item name as the game shows it, e.g. 'ball of wool'. */
    item: string;
    count: number;
}

export interface Source {
    /** Obj debugname for assisted spawns when it differs from the snake_cased item name. */
    obj?: string;
    /** False for items whose acquisition the quest itself tracks. Default true. */
    spawnable?: boolean;
    /** What producing `count` consumes, for the prologue's bank withdrawal. */
    inputs?: (count: number) => Need[];
    /** Produce until holding `count` in total. */
    get?: (q: Quest, count: number) => Promise<void>;
}

/** Exact, case-insensitive name match ('wool' must not match 'ball of wool'). */
export function itemPattern(item: string): RegExp {
    return new RegExp(`^${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

const LUMBRIDGE_GENERAL_STORE = { x: 3211, z: 3246, npc: /shop\s*(keeper|assistant)/i };
const LUMBRIDGE_CASTLE_STAIRS = { x: 3205, z: 3208 };
const FRED_SHEEP_PEN = { x: 3203, z: 3266 };
/** Npc id of a sheep that still has wool; a shorn one changes id. */
const UNSHEARED_SHEEP = 43;

export const SOURCES: Record<string, Source> = {
    coins: {},

    shears: {
        inputs: () => [{ item: 'coins', count: 5 }],
        get: async (q, count) => {
            await q.ensure('coins', 1);
            await buyWaitingForRestock(q, LUMBRIDGE_GENERAL_STORE, 'shears', count);
        },
    },

    wool: {
        inputs: () => [{ item: 'shears', count: 1 }],
        get: async (q, count) => {
            await q.ensure('shears', 1);
            if (q.sdk.getState()?.player?.level) await q.climbTo(0);
            await q.goTo(FRED_SHEEP_PEN, 4);
            const t0 = tickNow(q.sdk);
            let tries = 0;
            for (let misses = 0; misses < 40 && q.count('wool') < count; ) {
                const sheep = (q.sdk.getNearbyNpcs() ?? [])
                    .filter((n) => n.id === UNSHEARED_SHEEP && n.reachable !== false)
                    .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
                const before = q.count('wool');
                if (sheep) {
                    tries++;
                    const sent = messageCursor(q);
                    await q.bot.useItemOnNpc(/^shears$/i, sheep, { timeout: ticksToMs(20) });
                    // Returns on the send, before the wool lands (same as spinning). An escape
                    // or a sheep shorn by someone else ends the attempt early.
                    await untilTicks(
                        q.sdk,
                        (st) =>
                            (st.inventory ?? []).filter((i) => /^wool$/i.test(i.name)).length > before ||
                            (st.gameMessages ?? []).some((m) => (m.observationId ?? m.tick) > sent && /get away|already been shorn/i.test(m.text)),
                        12
                    );
                } else await q.sdk.waitForTicks(3);
                misses = q.count('wool') > before ? 0 : misses + 1;
            }
            q.log(`sheared ${q.count('wool')} wool in ${tickNow(q.sdk) - t0}t (${tries} attempts)`);
        },
    },

    'ball of wool': {
        inputs: (count) => [{ item: 'wool', count }],
        get: async (q, count) => {
            await q.ensure('wool', count - q.count('ball of wool'));
            if ((q.sdk.getState()?.player?.level ?? 0) !== 1) {
                await q.goTo(LUMBRIDGE_CASTLE_STAIRS, 2);
                await q.climbTo(1);
            }
            // The wheel is behind a door; useItemOnLoc does not open it ("I can't reach that!").
            await q.reach(/spinning wheel/i);
            // The wheel's Spin option batches (Make 10 at ~4 ticks a ball). Using wool on the
            // wheel spins one, and a use sent mid-spin is dropped: ~14s a ball (2026-10-28).
            for (let misses = 0; misses < 3 && q.count('ball of wool') < count && q.count('wool') > 0; ) {
                const before = q.count('wool');
                await spinBatch(q);
                misses = q.count('wool') < before ? 0 : misses + 1;
            }
            await q.climbTo(0);
        },
    },
};

/** Spin → Make 10 (wool) at the reachable wheel; returns once the wool stops going down. */
async function spinBatch(q: Quest): Promise<void> {
    await q.bot.interactLoc(/spinning wheel/i, /spin/i);
    await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen, 15);
    // Each product publishes Make X / Make 10 / Make 5, then its own label.
    const options = q.sdk.getDialog()?.options ?? [];
    // Labels carry literal backslash-n padding, so a \b before the name never matches.
    const label = options.findIndex((o) => /wool\s*$/i.test(o.text));
    const make10 = options.slice(0, Math.max(label, 0)).reverse().find((o) => /make 10/i.test(o.text));
    if (!make10) {
        q.log(`spin: no Make 10 for wool in ${JSON.stringify(options.map((o) => o.text.trim()))}`);
        await q.bot.closeInterface().catch(() => undefined);
        return;
    }
    await q.sdk.sendClickDialog(make10.index);
    let last = q.count('wool');
    for (let still = 0; still < 8 && last > 0; ) {
        await q.sdk.waitForTicks(1);
        const now = q.count('wool');
        still = now < last ? 0 : still + 1;
        last = now;
    }
    await q.bot.dismissBlockingUI();
}

/**
 * Newest game-message cursor, taken before an action so only replies to it match.
 * Message ticks are not state.tick: comparing the two matched stale escapes and
 * ended every shear instantly (43 attempts in 7s, 2026-10-28).
 */
function messageCursor(q: Quest): number {
    return Math.max(0, ...(q.sdk.getState()?.gameMessages ?? []).map((m) => m.observationId ?? m.tick));
}

/** Shops restock slowly; a bot that finds the shelf empty waits at the counter rather than failing. */
const RESTOCK_WAIT_TICKS = 2_000;

/**
 * Buy until holding `count` of `item`. When the shop has none in stock, keep the
 * shop open and wait for the restock (up to RESTOCK_WAIT_TICKS), then buy.
 */
async function buyWaitingForRestock(q: Quest, shop: { x: number; z: number; npc: RegExp }, item: string, count: number): Promise<void> {
    const { buyAtShop } = await import('../quest-supplies');
    const pattern = itemPattern(item);
    const deadline = tickNow(q.sdk) + RESTOCK_WAIT_TICKS;
    while (q.count(item) < count && tickNow(q.sdk) < deadline) {
        await buyAtShop(q.supply, shop, [{ pattern, amount: count, label: item }]);
        if (q.count(item) >= count) return;

        if (!q.sdk.getState()?.shop?.isOpen) await q.bot.openShop(shop.npc);
        const stock = () => q.sdk.getState()?.shop?.shopItems.find((i) => pattern.test(i.name));
        if (q.sdk.getState()?.shop?.isOpen && !stock()) throw new Error(`shop at (${shop.x},${shop.z}) does not sell ${item}`);
        q.log(`${item} out of stock at (${shop.x},${shop.z}) — waiting for restock`);
        const t0 = tickNow(q.sdk);
        await untilTicks(q.sdk, (s) => !s.shop?.isOpen || (s.shop.shopItems.find((i) => pattern.test(i.name))?.count ?? 0) > 0, Math.max(1, deadline - t0));
        q.log(`restock wait ${tickNow(q.sdk) - t0}t (stock now ${stock()?.count ?? '?'})`);
    }
    await q.bot.closeShop().catch(() => undefined);
}
