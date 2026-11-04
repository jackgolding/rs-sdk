/**
 * Spirit-tree travel for q.goTo's long walks (area_gnome/scripts/spirit_tree.rs2).
 *
 *   tree                     loc (id)              at (SW, size)     op1 Talk-to needs  goes to
 *   Gnome Stronghold         ent (1293)            2460,3445  4x4    %grandtree done    village, Varrock, Khazard
 *   Tree Gnome Village       stronghold_ent (1294) 2543,3168  4x4    %treequest done    Khazard, Varrock, stronghold
 *   Battlefield of Khazard   loc_1317 (1317)       2555,3260  2x2    %treequest done    village only
 *   forest north of Varrock  loc_1317 (1317)       3177,3506  2x2    %treequest done    village only
 *
 * Arrivals (spirit_tree.constant): village 2542,3169; stronghold 2461,3444; Varrock 3179,3507;
 * Khazard 2555,3259 — each a step from its own tree. Spawns from maps m38_53, m39_49, m39_50,
 * m49_54 (m41_57 holds more copies, off the mainland and unused here).
 *
 * So Ardougne <-> Varrock is the young tree beside us, the village tree, and out at the far
 * young tree: two teleports instead of ~550 tiles. The young trees only go to the village,
 * and the village sits behind the maze and its loose railing (lib/tree-gnome-village.ts), so
 * the village is only ever a stop on the way, never walked to or from here.
 *
 * Never throws: any miss (journal unread, tree not found, dialog off-script, no teleport)
 * returns false and goTo walks from wherever we are. SPIRIT_TREES=off disables it.
 */
import { readJournalCheckpoint } from '../../../quest-lab/journal-reader';
import { closeUi } from '../movement';
import { inStronghold } from './gnome-stronghold';
import type { Quest } from './run-quest';
import { driveDialog } from './dialog';
import { tickNow, untilTicks } from './ticks';

interface Tile {
    x: number;
    z: number;
}

type Arrival = 'village' | 'stronghold' | 'varrock' | 'khazard';

const ARRIVAL: Record<Arrival, Tile> = {
    village: { x: 2542, z: 3169 },
    stronghold: { x: 2461, z: 3444 },
    varrock: { x: 3179, z: 3507 },
    khazard: { x: 2555, z: 3259 },
};

interface Tree {
    name: string;
    id: number;
    /** South-west tile of the loc. */
    at: Tile;
    /** Where to walk before Talk-to (its own arrival tile). */
    stand: Tile;
    /** Dialog choices per destination; the young trees have one. */
    to: Partial<Record<Arrival, Array<RegExp>>>;
    grandTree?: boolean;
}

const YOUNG = { village: [/^yes please/i] };
const KHAZARD_YOUNG: Tree = { name: 'Khazard young spirit tree', id: 1317, at: { x: 2555, z: 3260 }, stand: ARRIVAL.khazard, to: YOUNG };
const VARROCK_YOUNG: Tree = { name: 'Varrock young spirit tree', id: 1317, at: { x: 3177, z: 3506 }, stand: ARRIVAL.varrock, to: YOUNG };
const WHERE = /where can i go/i;
const VILLAGE_TREE: Tree = {
    name: 'village spirit tree',
    id: 1294,
    at: { x: 2543, z: 3168 },
    stand: ARRIVAL.village,
    to: { khazard: [WHERE, /battlefield of khazard/i], varrock: [WHERE, /north of varrock/i], stronghold: [WHERE, /gnome stronghold/i] },
};
const STRONGHOLD_TREE: Tree = {
    name: 'stronghold spirit tree',
    id: 1293,
    at: { x: 2460, z: 3445 },
    stand: ARRIVAL.stronghold,
    to: { khazard: [WHERE, /battlefield of khazard/i], varrock: [WHERE, /north of varrock/i] },
    grandTree: true,
};

/** Trips shorter than this (tiles, Chebyshev) always walk. */
const MIN_TRIP = 250;
/** Walk-equivalent tiles per teleport: the walk onto the tree, ~6 dialog pages, the jump. */
const HOP_COST = 20;
/** The shortcut must beat the straight line by this fraction and this many tiles. */
const MAX_RATIO = 0.75;
const MARGIN = 50;
/** Ticks for a tree's dialog to run to the teleport, and for the jump to land after it. */
const DIALOG_TICKS = 60;
const LAND_TICKS = 10;
const DIALOG_OPEN_TICKS = 15;

const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

interface Plan {
    /** Tree walked to first, then each teleport in order. */
    hops: Array<{ tree: Tree; dest: Arrival }>;
    cost: number;
}

/** Cheapest tree route from `from` to `to`, or null. `grandTree`: the stronghold tree is usable. */
export function planSpiritTrees(from: Tile, to: Tile, grandTree: boolean): Plan | null {
    // Arriving in the stronghold only helps a destination inside it: out through Femi's gate
    // is crossGnomeGate's job and costs more than any tree saves.
    const finals: Arrival[] = inStronghold(to) ? ['stronghold', 'khazard', 'varrock'] : ['khazard', 'varrock'];
    const plans: Plan[] = [];
    for (const young of [KHAZARD_YOUNG, VARROCK_YOUNG]) {
        for (const fin of finals) {
            if (cheb(young.stand, ARRIVAL[fin]) < 10) continue; // back where it started
            plans.push({
                hops: [
                    { tree: young, dest: 'village' },
                    { tree: VILLAGE_TREE, dest: fin },
                ],
                cost: cheb(from, young.stand) + 2 * HOP_COST + cheb(ARRIVAL[fin], to),
            });
        }
    }
    // Inside the stronghold the ent is the way out (the young trees are behind the gate).
    if (grandTree && inStronghold(from)) {
        for (const fin of ['khazard', 'varrock'] as const) {
            plans.push({ hops: [{ tree: STRONGHOLD_TREE, dest: fin }], cost: cheb(from, STRONGHOLD_TREE.stand) + HOP_COST + cheb(ARRIVAL[fin], to) });
        }
    }
    const direct = cheb(from, to);
    const best = plans.filter((p) => !p.hops.some((h) => broken.has(h.tree.name))).sort((a, b) => a.cost - b.cost)[0];
    if (!best || direct < MIN_TRIP || best.cost + MARGIN > direct * MAX_RATIO) return null;
    return best;
}

/** Trees that failed this run: later trips plan around them rather than re-walk to a dead end. */
const broken = new Set<string>();

/** Per process: one journal read per quest, and none at all for short trips. */
const done: Partial<Record<'tree' | 'grandtree', boolean>> = {};
const misses: Partial<Record<'tree' | 'grandtree', number>> = {};
const JOURNALS = {
    tree: { spec: { label: 'Tree Gnome Village', title: 'Tree Gnome Village' }, rule: { id: 'tree:complete', kind: 'complete' as const, all: ['QUEST COMPLETE'] } },
    grandtree: { spec: { label: 'The Grand Tree', title: 'The Grand Tree' }, rule: { id: 'grandtree:complete', kind: 'complete' as const, all: ['QUEST COMPLETE'] } },
};

async function questDone(q: Quest, which: 'tree' | 'grandtree'): Promise<boolean> {
    if (done[which] !== undefined) return done[which]!;
    try {
        const read = await readJournalCheckpoint(q.sdk, JOURNALS[which].spec, JOURNALS[which].rule);
        await closeUi(q.bot, q.sdk);
        const v = read.verdict?.verdict;
        // A verdict is final for this run; an unread journal (tab not streamed yet) gets two more tries.
        if (v === 'PASS' || v === 'FAIL') done[which] = v === 'PASS';
        else if ((misses[which] = (misses[which] ?? 0) + 1) >= 3) done[which] = false;
        return v === 'PASS';
    } catch {
        await closeUi(q.bot, q.sdk).catch(() => undefined);
        return false;
    }
}

let active = false;
let toldNoQuest = false;

/**
 * Take the spirit trees toward `dest` when the account can and it clearly beats walking.
 * Returns true when it teleported at least once (we are somewhere new; goTo walks the rest).
 */
export async function spiritTreeShortcut(q: Quest, dest: Tile & { level?: number }): Promise<boolean> {
    if (active || /^(off|0|false)$/i.test(process.env.SPIRIT_TREES ?? '')) return false;
    const pos = () => {
        const p = q.sdk.getState()?.player;
        return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
    };
    const from = pos();
    if (from.level !== 0 || (dest.level ?? 0) !== 0 || from.z >= 6400 || dest.z >= 6400) return false;
    // Geometry first (free), with the stronghold tree assumed: no journal read for short trips.
    if (!planSpiritTrees(from, dest, true)) return false;
    active = true;
    let hopped = false;
    try {
        if (!(await questDone(q, 'tree'))) {
            if (done.tree === false && !toldNoQuest) q.log('spirit trees: Tree Gnome Village not complete; long trips walk');
            toldNoQuest ||= done.tree === false;
            return false;
        }
        const grand = inStronghold(from) && (await questDone(q, 'grandtree'));
        const plan = planSpiritTrees(pos(), dest, grand);
        if (!plan) return false;
        const t0 = tickNow(q.sdk);
        const route = plan.hops.map((h) => `${h.tree.name} -> ${h.dest}`).join(', ');
        q.log(`spirit trees: (${from.x},${from.z}) -> (${dest.x},${dest.z}) via ${route} (est ${plan.cost} vs ${cheb(from, dest)} tiles walking)`);
        for (const [i, hop] of plan.hops.entries()) {
            // The first tree is walked to; later ones stand beside the previous arrival.
            if (cheb(pos(), hop.tree.stand) > 3) await q.goTo(hop.tree.stand, 2);
            if (!(await useTree(q, hop.tree, hop.dest))) {
                q.log(`spirit trees: ${hop.tree.name} -> ${hop.dest} failed at (${pos().x},${pos().z}) after ${tickNow(q.sdk) - t0}t; walking${i ? ' from here' : ''}`);
                broken.add(hop.tree.name);
                await closeUi(q.bot, q.sdk).catch(() => undefined);
                return hopped;
            }
            hopped = true;
        }
        q.log(`spirit trees: at ${plan.hops[plan.hops.length - 1]!.dest} (${pos().x},${pos().z}) in ${tickNow(q.sdk) - t0}t; ${cheb(pos(), dest)} tiles left to (${dest.x},${dest.z})`);
        return true;
    } catch (e) {
        q.log(`spirit trees: ${(e as Error).message}; walking from (${pos().x},${pos().z})`);
        await closeUi(q.bot, q.sdk).catch(() => undefined);
        return hopped;
    } finally {
        active = false;
    }
}

/** Talk-to `tree` and pick `dest`; true once we stand at its arrival tile. */
async function useTree(q: Quest, tree: Tree, dest: Arrival): Promise<boolean> {
    const arrival = ARRIVAL[dest];
    const landed = () => {
        const p = q.sdk.getState()?.player;
        return !!p && p.level === 0 && cheb({ x: p.worldX, z: p.worldZ }, arrival) <= 2;
    };
    const choices = tree.to[dest];
    if (!choices) return false;
    for (let attempt = 0; attempt < 2 && !landed(); attempt++) {
        const locs = await q.sdk.scanNearbyLocs(12).catch(() => [] as Awaited<ReturnType<typeof q.sdk.scanNearbyLocs>>);
        const loc = locs.find((l) => l.id === tree.id && cheb(l, tree.at) <= 1);
        if (!loc) {
            q.log(`spirit trees: no ${tree.name} (loc ${tree.id}) near (${tree.at.x},${tree.at.z})`);
            return false;
        }
        const res = await q.bot.interactLoc(loc, /talk-to/i);
        if (!res.success && !q.sdk.getDialog()?.isOpen) {
            q.log(`spirit trees: Talk-to ${tree.name}: ${res.message}`);
            continue;
        }
        // The stronghold ent's FIRST Talk-to opened no dialog on three local accounts (interactLoc said
        // "Interacted"; the second always worked, cause unknown): wait for the page, else Talk-to again.
        if (!(await untilTicks(q.sdk, (s) => !!s.dialog?.isOpen || landed(), DIALOG_OPEN_TICKS))) {
            q.log(`spirit trees: Talk-to ${tree.name} opened no dialog (${res.message}); retrying`);
            continue;
        }
        const text = await driveDialog(q.sdk, choices, { done: landed, ticks: DIALOG_TICKS, log: q.log });
        if (await untilTicks(q.sdk, landed, LAND_TICKS)) return true;
        q.log(`spirit trees: ${tree.name} did not send us to ${dest}: ${text.slice(0, 160)}`);
        // "The tree doesn't feel like talking": the quest is not done after all.
        if (/doesn't feel like talking/i.test(text)) {
            done[tree.grandTree ? 'grandtree' : 'tree'] = false;
            return false;
        }
        await closeUi(q.bot, q.sdk).catch(() => undefined);
    }
    return landed();
}
