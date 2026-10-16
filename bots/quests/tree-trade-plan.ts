/**
 * Pairwise trade trees for fleet food/loot handovers.
 *
 * Reduction (gold): 1→2 and 3→4 in parallel, then 2→4.
 * Broadcast (food): source seeds one helper, then both give in parallel.
 */
import { ARDOUGNE_BANK, CATHERBY_BANK, type Tile } from './tiles';

export type Pair = { giver: string; receiver: string };

export type BroadcastPair = Pair & {
    /** Recipient-shares moved in this trade. */
    shares: number;
    /** Recipient-shares the giver still owes after this trade (0 = dump the rest). */
    hold: number;
};

export const FOOD_SQUADS: { source: string; recipients: string[] }[] = [
    {
        source: 'jacklove1',
        recipients: ['ABGARMY01', 'ABGARMY02', 'ABGARMY03', 'ABGARMY04', 'ABGARMY05']
    },
    {
        source: 'jacklove2',
        recipients: ['ABGARMY06', 'ABGARMY07', 'ABGARMY08', 'ABGARMY09', 'ABGARMY10']
    },
    {
        source: 'jacklove3',
        recipients: ['ABGARMY11', 'ABGARMY12', 'ABGARMY13', 'ABGARMY14', 'ABGARMY15']
    },
    {
        source: 'jacklove4',
        recipients: ['ABGARMY16', 'ABGARMY17', 'ABGARMY18', 'ABGARMY19', 'ABGARMY20']
    },
    { source: 'jacklove5', recipients: ['Jackpoo3', 'fatpig'] }
];

export const FOOD_MULE = 'ABGARMY01';
/** Names kept off every ABG target list. Empty while the whole army is in. */
export const ABG_SKIPPED: string[] = [];
/**
 * Overnight 1-to-1 at the Ardougne bank. 01 serves these names and nobody else
 * (so a random player cannot drain the fish pile).
 */
export const FOOD_MULE_FROM = /^(?:ABGARMY(?!01$)\d+|Jackpoo3)$/i;
/** Noted fish per mule handoff. Smaller = faster offer screen (experiment: 25, was 100). */
export const FOOD_PER_TRADE = 25;
export const FOOD_PACK_ORDER = ['swordfish', 'lobster', 'tuna', 'bass', 'cod', 'shark', 'jug of wine'] as const;

export function usesFoodMule(name: string): boolean {
    return FOOD_MULE_FROM.test(name);
}

/** Best-heal-first pack from noted inventory counts. Caps at {@link FOOD_PER_TRADE}. */
export function foodPackGive(
    counts: { name: string; count: number }[],
    perTrade = FOOD_PER_TRADE
): { item: RegExp; amount: number }[] {
    const byName = new Map<string, number>();
    for (const row of counts) {
        const key = row.name.trim().toLowerCase();
        if (!key || row.count <= 0) continue;
        byName.set(key, (byName.get(key) ?? 0) + row.count);
    }
    let left = perTrade;
    const give: { item: RegExp; amount: number }[] = [];
    for (const name of FOOD_PACK_ORDER) {
        if (left <= 0) break;
        const n = byName.get(name) ?? 0;
        if (n <= 0) continue;
        const amount = Math.min(n, left);
        give.push({ item: new RegExp(`^${name}$`, 'i'), amount });
        left -= amount;
    }
    return give;
}

export const ABG_NAMES: string[] = Array.from(
    { length: 20 },
    (_, i) => `ABGARMY${String(i + 1).padStart(2, '0')}`
).filter((n) => !isSkipped(n, ABG_SKIPPED));

/** Thieving ABGs that trade loot to {@link FOOD_MULE} for food. */
export function abgThieves(skip: string[] = []): string[] {
    return ABG_NAMES.filter((n) => n !== FOOD_MULE && !isSkipped(n, skip));
}

/** Loot reduction among thieves (high number → lower), then dump to {@link FOOD_MULE}. */
export function abgLootHolders(skip: string[] = []): string[] {
    return [...abgThieves(skip)].reverse();
}

export function abgLootPlan(skip: string[] = []): { rounds: Pair[][]; winner: string | undefined } {
    return reductionRounds(abgLootHolders(skip));
}

/** Food broadcast from {@link FOOD_MULE} out to the thieves (opposite of loot). */
export function abgFoodBroadcast(skip: string[] = []): BroadcastPair[][] {
    return broadcastRounds(FOOD_MULE, abgThieves(skip));
}

export const GOLD_EXTRAS = ['Jackpoo3'] as const;

export const JACKLOVE_NAMES: string[] = Array.from({ length: 20 }, (_, i) => `jacklove${i + 1}`);

/** East of Handelmort mansion — guard dogs patrol the west yard (~2624,3319). */
const MEET_TILES: Tile[] = [
    { x: 2656, z: 3292 },
    { x: 2664, z: 3292 },
    { x: 2672, z: 3292 },
    { x: 2656, z: 3300 },
    { x: 2664, z: 3300 },
    { x: 2672, z: 3300 },
    { x: 2656, z: 3308 },
    { x: 2664, z: 3308 },
    { x: 2672, z: 3308 },
    { x: 2656, z: 3316 },
    { x: 2664, z: 3316 },
    { x: 2672, z: 3316 },
    { x: 2656, z: 3304 }
];

/** South/west of the Catherby booths so pairs do not stack on the banker. */
const CATHERBY_MEET_TILES: Tile[] = [
    { x: 2802, z: 3436 },
    { x: 2814, z: 3436 },
    { x: 2796, z: 3440 },
    { x: 2820, z: 3440 },
    { x: 2802, z: 3446 },
    { x: 2814, z: 3446 },
    { x: 2796, z: 3448 },
    { x: 2820, z: 3448 },
    { x: 2808, z: 3434 },
    { x: 2808, z: 3450 },
    { x: 2792, z: 3444 },
    { x: 2824, z: 3444 }
];

function norm(name: string): string {
    return name.toLowerCase();
}

export function isSkipped(name: string, skip: string[]): boolean {
    const want = norm(name);
    return skip.some((s) => norm(s) === want);
}

export function goldHolders(skip: string[] = []): string[] {
    return [...ABG_NAMES, ...GOLD_EXTRAS].filter((n) => !isSkipped(n, skip));
}

export function casketHolders(skip: string[] = []): string[] {
    return JACKLOVE_NAMES.filter((n) => !isSkipped(n, skip));
}

/** Odd index gives to the next even; leftover gets a bye. Repeat until one holder. */
export function reductionRounds(holders: string[]): { rounds: Pair[][]; winner: string | undefined } {
    const rounds: Pair[][] = [];
    let live = [...holders];
    while (live.length > 1) {
        const pairs: Pair[] = [];
        const next: string[] = [];
        for (let i = 0; i + 1 < live.length; i += 2) {
            pairs.push({ giver: live[i]!, receiver: live[i + 1]! });
            next.push(live[i + 1]!);
        }
        if (live.length % 2 === 1) next.push(live[live.length - 1]!);
        rounds.push(pairs);
        live = next;
    }
    return { rounds, winner: live[0] };
}

/**
 * Source splits its recipient list in half each round. One trade per node per
 * round, so helpers start giving on the next round.
 */
export function broadcastRounds(source: string, recipients: string[]): BroadcastPair[][] {
    if (recipients.length === 0) return [];
    type Node = { name: string; feed: string[] };
    const nodes: Node[] = [{ name: source, feed: [...recipients] }];
    const rounds: BroadcastPair[][] = [];
    for (let r = 0; r < 12; r++) {
        const pairs: BroadcastPair[] = [];
        const spawned: Node[] = [];
        for (const node of nodes) {
            const others = node.feed.filter((n) => norm(n) !== norm(node.name));
            if (others.length === 0) continue;
            const take = Math.ceil(others.length / 2);
            const helperFeed = others.slice(0, take);
            const helper = helperFeed[0]!;
            node.feed = node.feed.filter((n) => !helperFeed.some((h) => norm(h) === norm(n)));
            pairs.push({
                giver: node.name,
                receiver: helper,
                shares: helperFeed.length,
                hold: node.feed.length
            });
            spawned.push({ name: helper, feed: helperFeed });
        }
        if (pairs.length === 0) break;
        rounds.push(pairs);
        nodes.push(...spawned);
    }
    return rounds;
}

export function mergeRounds<T>(squadRounds: T[][][]): T[][] {
    const max = Math.max(0, ...squadRounds.map((s) => s.length));
    return Array.from({ length: max }, (_, i) => squadRounds.flatMap((s) => s[i] ?? []));
}

export function foodPlan(skip: string[] = []): BroadcastPair[][] {
    const squads = FOOD_SQUADS.map((s) => ({
        source: s.source,
        recipients: s.recipients.filter((r) => !isSkipped(r, skip))
    })).filter((s) => s.recipients.length > 0 && !isSkipped(s.source, skip));
    return mergeRounds(squads.map((s) => broadcastRounds(s.source, s.recipients)));
}

export function goldPlan(skip: string[] = []): { rounds: Pair[][]; winner: string | undefined } {
    return reductionRounds(goldHolders(skip));
}

export function casketPlan(skip: string[] = []): { rounds: Pair[][]; winner: string | undefined } {
    return reductionRounds(casketHolders(skip));
}

export function involvedBots(skip: string[] = []): string[] {
    const names = new Set<string>();
    for (const squad of FOOD_SQUADS) {
        if (!isSkipped(squad.source, skip)) names.add(squad.source);
        for (const r of squad.recipients) {
            if (!isSkipped(r, skip)) names.add(r);
        }
    }
    for (const n of goldHolders(skip)) names.add(n);
    names.add('fatpig');
    return [...names];
}

export function meetTile(a: string, b: string): Tile {
    const jacklovePair = /^jacklove\d+$/i.test(a) && /^jacklove\d+$/i.test(b);
    const tiles = jacklovePair ? CATHERBY_MEET_TILES : MEET_TILES;
    const key = [norm(a), norm(b)].sort().join(':');
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
    return tiles[Math.abs(h) % tiles.length] ?? (jacklovePair ? CATHERBY_BANK : ARDOUGNE_BANK);
}

export function receiverTile(meet: Tile): Tile {
    return { x: meet.x + 1, z: meet.z };
}

/** `floor(count * shares / (shares + hold))`, or all of it when hold is 0. */
export function splitAmount(count: number, shares: number, hold: number): number {
    if (count <= 0 || shares <= 0) return 0;
    if (hold <= 0) return count;
    return Math.floor((count * shares) / (shares + hold));
}
