/**
 * Shared long-distance travel: plan, walk, re-plan, verify.
 *
 * Three things this exists to stop, all observed on the live fleet:
 *
 * 1. **`findLongPath` returns a TRUNCATED path silently.** Prod: Ardougne from
 *    the gnome stronghold planned as 2 points ending 215 tiles short, with no
 *    indication. Appending the destination to that stub gave the walker a
 *    215-tile leg that the client refuses to start, so the bot stood still while
 *    every layer reported success. A plan here is COMPLETE or PARTIAL: walk a
 *    partial and re-plan from its end.
 * 2. **Arrival is a verified distance**, never a success flag: `walkRoute`
 *    returns ok when it reaches the last waypoint of whatever plan it was given.
 * 3. **Routes only exist within a plane.** A bot on an upper level (an agility
 *    course platform, a guild floor) has no route anywhere until it climbs down.
 *
 * Recorded failures land in the travel gap registry through `walk-route`.
 */
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import { findLongPath } from '../../sdk/pathfinding';
import { hopSend, playerPos } from './movement';
import { walkRoute } from './walk-route';

export interface Tile {
    x: number;
    z: number;
}

export interface TravelOptions {
    log?: (message: string) => void;
    /** How close counts as arrived (Chebyshev-ish, straight line). */
    tolerance?: number;
    /** Safety cap on plan->walk cycles. */
    maxPlans?: number;
    /**
     * Called when the walker is blocked or the plan frontier stops advancing.
     * Return true to accept where we are (a camp is a radius, not a tile).
     */
    acceptShortOf?: (distance: number, at: { x: number; z: number; level: number }) => boolean;
}

export interface TravelResult {
    ok: boolean;
    at: { x: number; z: number; level: number };
    reason?: string;
    plans: number;
}

const DEFAULT_TOLERANCE = 8;

/** Climb down to plane 0 before planning; findLongPath plans within one plane only. */
export async function normalisePlane(sdk: BotSDK, bot: BotActions, log: (m: string) => void = () => {}): Promise<boolean> {
    for (let attempt = 0; attempt < 3 && (sdk.getState()?.player?.level ?? 0) > 0; attempt++) {
        const level = sdk.getState()?.player?.level ?? 0;
        await sdk.scanNearbyLocs(12).catch(() => undefined);
        const down = (sdk.getNearbyLocs() ?? [])
            .filter((l) => /stair|ladder/i.test(l.name) && (l.optionsWithIndex ?? []).some((o) => /climb-down|climb down|down/i.test(o.text)))
            .sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99))[0];
        if (!down) {
            log(`on plane ${level} with no climbable loc in range — cannot normalise`);
            return false;
        }
        const res = await bot.interactLoc(down, /climb-down|climb down|down/i).catch((e: unknown) => ({ success: false, message: String(e) }));
        log(`climb-down ${down.name} (${down.x},${down.z}) from l${level}: ok=${res.success}`);
        for (let wait = 0; wait < 20 && (sdk.getState()?.player?.level ?? level) === level; wait++) await sdk.waitForTicks(1);
        log(`  plane now l${sdk.getState()?.player?.level} at ${playerPos(sdk).x},${playerPos(sdk).z}`);
    }
    return (sdk.getState()?.player?.level ?? 0) === 0;
}

/** One plan for the remaining journey: complete when it actually reaches the destination. */
export function planJourney(level: number, from: Tile, dest: Tile): { waypoints: Tile[]; complete: boolean } {
    try {
        const path = findLongPath(level, from.x, from.z, dest.x, dest.z) as Tile[] | null;
        if (!path || !path.length) {
            const d = Math.hypot(dest.x - from.x, dest.z - from.z);
            return { waypoints: d <= 10 ? [{ x: dest.x, z: dest.z }] : [], complete: false };
        }
        const out: Tile[] = [];
        for (let i = 0; i < path.length; i += 8) {
            const t = path[Math.min(i + 7, path.length - 1)]!;
            out.push({ x: t.x, z: t.z });
        }
        const last = path[path.length - 1]!;
        const complete = Math.hypot(last.x - dest.x, last.z - dest.z) <= DEFAULT_TOLERANCE;
        const tail = out[out.length - 1]!;
        if (complete && (tail.x !== dest.x || tail.z !== dest.z)) out.push({ x: dest.x, z: dest.z });
        return { waypoints: out, complete };
    } catch {
        return { waypoints: [], complete: false };
    }
}

export async function travelTo(sdk: BotSDK, bot: BotActions, dest: Tile, options: TravelOptions = {}): Promise<TravelResult> {
    const log = options.log ?? (() => {});
    const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
    const maxPlans = options.maxPlans ?? 24;

    if ((sdk.getState()?.player?.level ?? 0) > 0) await normalisePlane(sdk, bot, log);

    const host = {
        getPos: () => playerPos(sdk),
        walk: (x: number, z: number) => hopSend(sdk, x, z, 10),
        waitTicks: (n: number) => sdk.waitForTicks(n),
    };

    let frontier: string | null = null;
    let blocked: string | undefined;

    for (let plans = 0; plans < maxPlans; plans++) {
        const now = playerPos(sdk);
        const d = Math.hypot(now.x - dest.x, now.z - dest.z);
        if (d <= tolerance) return { ok: true, at: now, plans };

        const { waypoints, complete } = planJourney(now.level, now, dest);
        if (!waypoints.length) {
            if (options.acceptShortOf?.(d, now)) return { ok: true, at: now, reason: 'accepted short of destination', plans };
            return { ok: false, at: now, reason: `no route from (${now.x},${now.z}) l${now.level} — ${Math.round(d)} tiles away`, plans };
        }

        const res = await walkRoute(host, waypoints, { maxHop: 10, tolerance: 3, log });
        const after = playerPos(sdk);
        if (!res.ok) blocked = res.blocked;
        if (Math.hypot(after.x - dest.x, after.z - dest.z) <= tolerance) return { ok: true, at: after, plans };

        const key = `${after.x},${after.z}`;
        if (key === frontier) {
            if (options.acceptShortOf?.(Math.hypot(after.x - dest.x, after.z - dest.z), after)) {
                return { ok: true, at: after, reason: 'frontier stuck, accepted short', plans };
            }
            return { ok: false, at: after, reason: `plan frontier stuck at (${key}) l${after.level}, ${Math.round(Math.hypot(after.x - dest.x, after.z - dest.z))} tiles short`, plans };
        }
        frontier = key;
        log(`   ${Math.round(Math.hypot(after.x - dest.x, after.z - dest.z))} tiles to go — re-planning from (${key})`);
        if (!complete && !res.ok) log(`   blocked at (${key}) — re-planning from here`);
    }

    const at = playerPos(sdk);
    return { ok: false, at, reason: `gave up after ${maxPlans} plans${blocked ? ` (${blocked})` : ''}`, plans: maxPlans };
}
