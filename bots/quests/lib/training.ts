/**
 * Skill training — how the runner raises a skill a source or quest needs.
 *
 * One trainer per skill, shared by every quest. `q.ensureLevel(skill, level)`
 * calls it from a source (iron ore needs Mining 15) or the prepare phase, and
 * bots/quests/train-skill.ts runs it on its own as a task. A trainer gets the
 * tools it needs through q.ensure (sources.ts), never by assuming the bank.
 */
import type { Quest } from './run-quest';
import { mineAtRimmington } from './mining';
import { huntDrop, type HuntSpot, type Need } from './sources';
import { tickNow, untilTicks } from './ticks';

export interface Trainer {
    /** Tools to take from the bank when training runs on its own (train-skill.ts). */
    needs: Need[];
    train: (q: Quest, level: number) => Promise<void>;
}

export const TRAINERS: Record<string, Trainer> = {
    /** Copper at the Rimmington mine (level 1, 17.5 xp), dropped as it is mined. */
    mining: {
        needs: [{ item: 'pickaxe', count: 1 }],
        train: async (q, level) => {
            await q.ensure('pickaxe', 1);
            // Ore the quest already holds is kept; only what training mines is dropped.
            const keep = q.count('copper ore');
            await mineAtRimmington(q, 'copper ore', { until: () => q.level('mining') >= level, dropAbove: keep });
        },
    },

    /** Trees, oaks (15), willows (30) around Draynor; the logs are dropped. */
    woodcutting: {
        needs: [{ item: 'axe', count: 1 }],
        train: async (q, level) => {
            await q.ensure('axe', 1);
            await chopUntil(q, () => q.level('woodcutting') >= level, () => treeFor(q.level('woodcutting')));
            await dropAll(q, /^(willow |oak )?logs$/i);
        },
    },

    /**
     * Chop the logs the best product needs (Draynor), fletch them with a knife
     * (cut_logs.dbrow: shafts 1, shortbow 5, longbow 10, oak 20/25, willow 35/40),
     * drop what was made.
     */
    fletching: {
        needs: [
            { item: 'axe', count: 1 },
            { item: 'knife', count: 1 },
        ],
        train: async (q, level) => {
            await q.ensure('axe', 1);
            await q.ensure('knife', 1);
            const t0 = tickNow(q.sdk);
            while (q.level('fletching') < level && tickNow(q.sdk) - t0 < 30_000) {
                const product = fletchFor(q.level('fletching'), q.level('woodcutting'));
                const logs = new RegExp(`^${product.logs ? `${product.logs} ` : ''}logs$`, 'i');
                await chopUntil(q, () => freeSlots(q) === 0, () => TREES.find((t) => t.logs === product.logs)!);
                for (let misses = 0; misses < 3 && q.count(logs) > 0 && q.level('fletching') < level; ) {
                    const before = q.count(logs);
                    const res = await q.bot.fletchLogs(product.label);
                    if (!res.success) q.log(`fletching ${product.label}: ${res.message}`);
                    await untilTicks(q.sdk, () => q.count(logs) < before, 8);
                    misses = q.count(logs) < before ? 0 : misses + 1;
                }
                // Unstrung bows are named like the strung ones (cut_logs: unstrung_shortbow "Shortbow").
                await dropAll(q, /^(arrow shaft|(oak |willow )?(shortbow|longbow))$/i);
            }
            if (q.level('fletching') < level) throw new Error(`fletching stuck at ${q.level('fletching')}/${level}`);
        },
    },

    /**
     * Leather: cowhides from the Lumbridge cows, soft leather from the Al Kharid
     * tanner (1gp), crafted with needle and thread into the best item the level
     * allows (leather.dbrow), which is dropped.
     */
    crafting: {
        needs: [
            { item: 'needle', count: 1 },
            { item: 'thread', count: 10 },
            { item: 'coins', count: 300 },
        ],
        train: async (q, level) => {
            await q.ensure('needle', 1);
            const t0 = tickNow(q.sdk);
            while (q.level('crafting') < level && tickNow(q.sdk) - t0 < 60_000) {
                if (q.count('thread') < 2) await q.ensure('thread', 10);
                if (q.count('leather') === 0) {
                    const hides = Math.max(1, Math.min(24, freeSlots(q) + q.count('cowhide')));
                    if (q.count('cowhide') < hides) await huntDrop(q, LUMBRIDGE_COWS, 'cowhide', hides);
                    await tanSoftLeather(q);
                }
                for (let misses = 0; misses < 3 && q.count('leather') > 0 && q.level('crafting') < level; ) {
                    if (q.count('thread') < 1) await q.ensure('thread', 10);
                    const before = q.count('leather');
                    const res = await q.bot.craftLeather(leatherFor(q.level('crafting')));
                    if (!res.success) q.log(`crafting leather: ${res.message}`);
                    await untilTicks(q.sdk, () => q.count('leather') < before, 10);
                    misses = q.count('leather') < before ? 0 : misses + 1;
                }
                await dropAll(q, /^leather (gloves|boots|vambraces|body|chaps|cowl)$/i);
            }
            if (q.level('crafting') < level) throw new Error(`crafting stuck at ${q.level('crafting')}/${level}`);
        },
    },
};

// ── Woodcutting

interface TreeSpot {
    level: number;
    /** Loc name. */
    tree: RegExp;
    /** Log prefix ('' for plain logs). */
    logs: '' | 'oak' | 'willow';
    spot: { x: number; z: number };
}
/** Draynor (maps m48_50): trees and oaks east of the bank, willows by the water south-west of it. */
const TREES: TreeSpot[] = [
    { level: 30, tree: /^willow$/i, logs: 'willow', spot: { x: 3086, z: 3233 } },
    { level: 15, tree: /^oak$/i, logs: 'oak', spot: { x: 3113, z: 3240 } },
    { level: 1, tree: /^tree$/i, logs: '', spot: { x: 3110, z: 3230 } },
];
const treeFor = (wc: number) => TREES.find((t) => wc >= t.level)!;

const freeSlots = (q: Quest) => 28 - q.sdk.getInventory().length;

/** Drop every inventory stack matching `item`. */
async function dropAll(q: Quest, item: RegExp): Promise<void> {
    for (let guard = 0; guard < 30; guard++) {
        const it = q.sdk.getInventory().find((i) => item.test(i.name));
        if (!it) return;
        const before = q.sdk.getInventory().length;
        await q.sdk.sendDropItem(it.slot);
        await untilTicks(q.sdk, () => q.sdk.getInventory().length < before, 4);
    }
}

/** Chop `which()` trees until `until()` (the pack full of logs is dropped and chopping goes on). */
async function chopUntil(q: Quest, until: () => boolean, which: () => TreeSpot): Promise<void> {
    const t0 = tickNow(q.sdk);
    let misses = 0;
    while (!until() && tickNow(q.sdk) - t0 < 20_000) {
        const spec = which();
        if (freeSlots(q) === 0) {
            await dropAll(q, /^(willow |oak )?logs$/i);
            if (freeSlots(q) === 0) throw new Error('woodcutting: the pack is full of something other than logs');
        }
        const p = q.sdk.getState()?.player;
        if (Math.hypot((p?.worldX ?? 0) - spec.spot.x, (p?.worldZ ?? 0) - spec.spot.z) > 12) await q.goTo(spec.spot, 4);
        const tree = (q.sdk.getNearbyLocs() ?? [])
            .filter((l) => spec.tree.test(l.name) && l.reachable !== false && l.options.some((o) => /chop/i.test(o)))
            .sort((a, b) => a.distance - b.distance)[0];
        if (!tree) {
            await q.sdk.scanNearbyLocs(12).catch(() => undefined);
            await q.sdk.waitForTicks(3);
            if (++misses > 40) throw new Error(`woodcutting: no ${spec.tree} near (${spec.spot.x},${spec.spot.z})`);
            continue;
        }
        misses = 0;
        await q.bot.chopTree(tree);
    }
}

// ── Fletching

const fletchFor = (fl: number, wc: number): { label: string; logs: TreeSpot['logs'] } => {
    if (fl >= 40 && wc >= 30) return { label: 'willow long', logs: 'willow' };
    if (fl >= 35 && wc >= 30) return { label: 'willow short', logs: 'willow' };
    if (fl >= 25 && wc >= 15) return { label: 'oak long', logs: 'oak' };
    if (fl >= 20 && wc >= 15) return { label: 'oak short', logs: 'oak' };
    if (fl >= 10) return { label: 'long', logs: '' };
    if (fl >= 5) return { label: 'short', logs: '' };
    return { label: 'arrow shaft', logs: '' };
};

// ── Crafting

/** Cows in the field east of Lumbridge, by the Al Kharid toll gate. Every cow drops a cowhide. */
const LUMBRIDGE_COWS: HuntSpot = { x: 3256, z: 3275, npc: /^cow$/i };
/** The tanner, Al Kharid (npc spawn 3276,3193). */
const TANNER = { x: 3275, z: 3192 };

const leatherFor = (lvl: number): string => (lvl >= 18 ? 'chaps' : lvl >= 14 ? 'body' : lvl >= 11 ? 'vambraces' : lvl >= 7 ? 'boots' : 'gloves');

/** tanner.rs2: op3 opens the tanning interface; soft leather "All" is its first all-button (tanner:com_93). */
async function tanSoftLeather(q: Quest): Promise<void> {
    const hides = q.count('cowhide');
    if (hides === 0) return;
    await q.ensure('coins', hides);
    await q.goTo(TANNER, 3);
    const tanner = q.sdk.findNearbyNpc(/^tanner$/i);
    if (!tanner) throw new Error('crafting: no tanner in Al Kharid');
    await q.bot.interactNpc(tanner, /trade/i);
    if (!(await untilTicks(q.sdk, (s) => !!s.interface?.isOpen, 15))) throw new Error('crafting: the tanning interface did not open');
    const options = q.sdk.getState()?.interface?.options ?? [];
    const all = options.find((o) => /all/i.test(o.text));
    if (!all) throw new Error(`crafting: no "All" on the tanner (${options.map((o) => o.text).join(' | ')})`);
    await q.sdk.sendClickComponent(all.componentId);
    await untilTicks(q.sdk, () => q.count('cowhide') < hides, 8);
    await q.bot.closeInterface().catch(() => undefined);
    q.log(`tanned ${hides - q.count('cowhide')} cowhides; ${q.count('leather')} leather`);
}
