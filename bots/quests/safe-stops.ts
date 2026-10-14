/**
 * Safe stops and bank-to-bank legs: the routing layer that makes jobs
 * composable. Convention:
 *
 * - Stops only ever end at a bank (banked park record) or wherever a drain
 *   timed out (park record with banked: false).
 * - Starts only ever begin at a bank. A job reads the previous park record;
 *   if it is not already at its bank, it routes there via walkLeg first.
 * - No script handles every position on its route. The worst case is a walk
 *   from the nearest bank along a declared leg.
 *
 * Bank tiles come from tiles.ts (single source of truth). Corridor
 * waypoints were verified against the client collision data with
 * findLongPath; walkSendHops additionally expands long legs into <=6-tile
 * sub-hops, so legs degrade gracefully where the server disagrees.
 */
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import { readParkRecord, type ParkRecord } from '../../sdk/index';
import {
    ARDOUGNE_BANK,
    ARDY_TO_CATHERBY,
    CATHERBY_BANK,
    DRAYNOR_BANK,
    FALADOR_EAST_BANK,
    YANILLE_BANK,
    type Tile,
} from './tiles';
import { walkSendHops } from './movement';

/** Local copies in thieving-route.ts / lost-city.ts agree on this stand. */
const EDGEVILLE_BANK: Tile = { x: 3094, z: 3492 };

export type SafeBankName = 'draynor' | 'catherby' | 'ardougne' | 'yanille' | 'falador-east' | 'edgeville';

export const SAFE_BANKS: Record<SafeBankName, Tile> = {
    draynor: DRAYNOR_BANK,
    catherby: CATHERBY_BANK,
    ardougne: ARDOUGNE_BANK,
    yanille: YANILLE_BANK,
    'falador-east': FALADOR_EAST_BANK,
    edgeville: EDGEVILLE_BANK,
};

export interface RouteLeg {
    name: string;
    from: SafeBankName;
    to: SafeBankName;
    /** Corridor waypoints from `from` to `to` (excluding `from`, including `to`). */
    via: Tile[];
}

/**
 * Draynor -> Ardougne runs north around the mountain (179 client steps via
 * the Falador/Catherby side). A straight chord never crosses it — that is
 * the walk that stranded jackthief for two days. Verified with findLongPath.
 */
const DRAYNOR_TO_ARDOUGNE: Tile[] = [
    { x: 3022, z: 3276 },
    { x: 2972, z: 3286 },
    { x: 2927, z: 3355 },
    { x: 2894, z: 3396 },
    { x: 2867, z: 3442 },
    { x: 2860, z: 3490 },
    { x: 2851, z: 3488 },
    { x: 2846, z: 3453 },
    { x: 2833, z: 3435 },
    { x: 2773, z: 3426 },
    { x: 2742, z: 3366 },
    { x: 2722, z: 3343 },
    { x: 2700, z: 3322 },
    { x: 2671, z: 3295 },
    { x: 2655, z: 3283 },
];

export const ROUTE_LEGS: RouteLeg[] = [
    { name: 'draynor-ardougne', from: 'draynor', to: 'ardougne', via: DRAYNOR_TO_ARDOUGNE },
    {
        name: 'ardougne-draynor',
        from: 'ardougne',
        to: 'draynor',
        via: [...DRAYNOR_TO_ARDOUGNE].reverse().slice(1).concat([DRAYNOR_BANK]),
    },
    { name: 'ardougne-catherby', from: 'ardougne', to: 'catherby', via: ARDY_TO_CATHERBY },
    {
        name: 'catherby-ardougne',
        from: 'catherby',
        to: 'ardougne',
        via: [...ARDY_TO_CATHERBY].reverse().slice(1).concat([ARDOUGNE_BANK]),
    },
];

export function findLeg(from: SafeBankName, to: SafeBankName): RouteLeg | null {
    return ROUTE_LEGS.find((leg) => leg.from === from && leg.to === to) ?? null;
}

/** Walk a declared bank-to-bank leg. Returns true when within 8 of `to`. */
export async function walkLeg(sdk: BotSDK, from: SafeBankName, to: SafeBankName): Promise<boolean> {
    const leg = findLeg(from, to);
    if (!leg) return false;
    const dest = SAFE_BANKS[to]!;
    await walkSendHops(sdk, leg.via, dest, 4);
    const p = sdk.getState()?.player;
    return Math.hypot((p?.worldX ?? 0) - dest.x, (p?.worldZ ?? 0) - dest.z) <= 8;
}

function playerTile(sdk: BotSDK): { x: number; z: number; level: number } {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? 0, z: p?.worldZ ?? 0, level: p?.level ?? 0 };
}

export function atBank(sdk: BotSDK, name: SafeBankName, tolerance = 8): boolean {
    const tile = SAFE_BANKS[name]!;
    const p = playerTile(sdk);
    return Math.hypot(p.x - tile.x, p.z - tile.z) <= tolerance;
}

export function nearestBank(sdk: BotSDK): SafeBankName {
    const p = playerTile(sdk);
    let best: SafeBankName = 'draynor';
    let bestDist = Infinity;
    for (const [name, tile] of Object.entries(SAFE_BANKS) as Array<[SafeBankName, Tile]>) {
        const dist = Math.hypot(p.x - tile.x, p.z - tile.z);
        if (dist < bestDist) {
            bestDist = dist;
            best = name;
        }
    }
    return best;
}

/** Walk to the named bank (path-aware hops). True when within tolerance. */
export async function goToBank(sdk: BotSDK, name: SafeBankName, tolerance = 8): Promise<boolean> {
    const dest = SAFE_BANKS[name]!;
    await walkSendHops(sdk, [dest], dest, 4);
    return atBank(sdk, name, tolerance);
}

/**
 * Deposit everything except `keep` at the named bank. Opens the bank if
 * needed. Returns true when the bank is open and no non-kept items remain.
 * Jobs pass their tool keeps (e.g. law talisman); handoff cleanliness
 * otherwise defaults to deposit-all so the next job gears itself.
 */
export async function parkAtBank(
    sdk: BotSDK,
    bot: BotActions,
    name: SafeBankName,
    opts?: { keep?: RegExp[]; timeoutMs?: number }
): Promise<boolean> {
    const deadline = Date.now() + (opts?.timeoutMs ?? 120_000);
    if (!atBank(sdk, name)) {
        await goToBank(sdk, name);
    }
    if (Date.now() >= deadline) return false;
    if (!sdk.getState()?.bank?.isOpen) {
        const opened = await bot.openBank();
        if (!opened.success && !sdk.getState()?.bank?.isOpen) return false;
    }
    for (const item of sdk.getInventory()) {
        if (Date.now() >= deadline) return false;
        if ((item.count ?? 0) <= 0) continue;
        if (opts?.keep?.some((re) => re.test(item.name))) continue;
        await bot.depositItem(item, -1);
    }
    const remaining = sdk
        .getInventory()
        .some((i) => (i.count ?? 0) > 0 && !opts?.keep?.some((re) => re.test(i.name)));
    await bot.closeBank().catch(() => undefined);
    return !remaining;
}

export interface StartPosition {
    /** Where the previous job stopped (null = no record, route from nearest bank). */
    park: ParkRecord | null;
    /** Bank the previous job claims, when banked. */
    bank: SafeBankName | null;
}

/** Read the previous job's park record for this account's grind.log. */
export function startPosition(grindLogPath: string): StartPosition {
    const park = readParkRecord(grindLogPath);
    if (!park || !park.banked) return { park, bank: null };
    const entry = (Object.entries(SAFE_BANKS) as Array<[SafeBankName, Tile]>).find(
        ([, tile]) => Math.hypot(tile.x - park.x, tile.z - park.z) <= 12
    );
    return { park, bank: entry?.[0] ?? null };
}

/**
 * Handoff entry: ensure the bot starts at `want`. When the park record says
 * banked at another bank, walk the declared leg; otherwise walk from the
 * nearest bank. Returns true when at `want` (or close enough to start).
 */
export async function ensureBankStart(
    sdk: BotSDK,
    bot: BotActions,
    want: SafeBankName,
    grindLogPath: string
): Promise<boolean> {
    await bot.dismissBlockingUI().catch(() => undefined);
    if (atBank(sdk, want)) return true;
    const { bank } = startPosition(grindLogPath);
    if (bank && bank !== want) {
        if (await walkLeg(sdk, bank, want)) return true;
    }
    if (await goToBank(sdk, want)) return true;
    // Last resort: route from wherever we are via the nearest bank's legs.
    const near = nearestBank(sdk);
    if (near !== want && (await walkLeg(sdk, near, want))) return true;
    return atBank(sdk, want, 12);
}
