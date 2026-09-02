/**
 * Clock-synced loot reduction + food broadcast for ABGARMY overnight.
 *
 * Pack → parallel 20→19 / 18→17 / … → dump winner→01 → 01 splits food back out.
 */
import {
    FOOD_MULE,
    abgFoodBroadcast,
    abgLootPlan,
    type BroadcastPair,
    type Pair
} from './tree-trade-plan';

export const TREE_PERIOD_MS = 24 * 60_000;
export const SLOT_MS = 90_000;

export function sameBot(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

export function treeLayout(skip: string[] = []) {
    const loot = abgLootPlan(skip);
    const food = abgFoodBroadcast(skip);
    return {
        loot,
        food,
        winner: loot.winner,
        lootRounds: loot.rounds.length,
        foodRounds: food.length,
        treeSlots: 1 + loot.rounds.length + 1 + food.length,
        mule: FOOD_MULE
    };
}

export type TreePhase =
    | { kind: 'idle' }
    | { kind: 'pack' }
    | { kind: 'loot'; index: number; pair: Pair | undefined }
    | { kind: 'dump'; winner: string }
    | { kind: 'food'; index: number; pair: BroadcastPair | undefined };

export function slotRemaining(now = Date.now()): number {
    const elapsed = now % TREE_PERIOD_MS;
    return SLOT_MS - (elapsed % SLOT_MS);
}

export function treeEpoch(now = Date.now()): number {
    return Math.floor(now / TREE_PERIOD_MS);
}

export function treePhase(name: string, now = Date.now(), skip: string[] = []): TreePhase {
    const layout = treeLayout(skip);
    const elapsed = now % TREE_PERIOD_MS;
    const treeMs = layout.treeSlots * SLOT_MS;
    if (elapsed >= treeMs) return { kind: 'idle' };
    const slot = Math.floor(elapsed / SLOT_MS);
    if (slot === 0) return { kind: 'pack' };
    if (slot <= layout.lootRounds) {
        const round = layout.loot.rounds[slot - 1]!;
        const pair = round.find((p) => sameBot(p.giver, name) || sameBot(p.receiver, name));
        return { kind: 'loot', index: slot - 1, pair };
    }
    if (slot === 1 + layout.lootRounds) {
        return { kind: 'dump', winner: layout.winner ?? FOOD_MULE };
    }
    const fi = slot - 2 - layout.lootRounds;
    const round = layout.food[fi]!;
    const pair = round.find((p) => sameBot(p.giver, name) || sameBot(p.receiver, name));
    return { kind: 'food', index: fi, pair };
}

export function inTreeWork(name: string, now = Date.now()): boolean {
    const p = treePhase(name, now);
    if (p.kind === 'idle') return false;
    if (p.kind === 'pack') return true;
    if (p.kind === 'loot') return !!p.pair;
    if (p.kind === 'dump') return sameBot(name, p.winner) || sameBot(name, FOOD_MULE);
    if (p.kind === 'food') return !!p.pair;
    return false;
}
