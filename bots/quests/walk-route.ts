// Shared hop walker for quest scripts.
//
// Copied from the rs-sdk-movement skill (see that skill for the rules and why
// each one exists). A raw sendWalk to a distant tile is silently dropped, and
// re-issuing walks every few ticks makes a bot oscillate between waypoints with
// zero net progress while every hop looks healthy. This walks one capped hop at
// a time, waits for arrival, measures displacement and fails with a diagnostic.
//
// Hop walker for rs-sdk bots.
//
// Why this exists: a raw `sendWalk` to a distant tile is silently dropped, and
// re-issuing walks every few ticks makes the bot oscillate between waypoints
// with zero net progress while every hop looks fine. This walks one capped hop
// at a time, waits for arrival, measures displacement, and fails with a
// diagnostic instead of looping forever.
//
// Minimal host surface, so it is testable without a live client:
//   getPos()    -> { x, z, level }
//   walk(x, z)  -> Promise
//   waitTicks(n)-> Promise

export interface WalkHost {
    getPos(): { x: number; z: number; level: number };
    walk(x: number, z: number): Promise<unknown>;
    waitTicks(ticks: number): Promise<unknown>;
}

export interface Tile { x: number; z: number }

export interface WalkOptions {
    /** Max tiles per hop. Above ~15 the client accepts and never starts. */
    maxHop?: number;
    /** How close counts as arrived at a waypoint or hop. */
    tolerance?: number;
    /** Polls of `pollTicks` while waiting for a hop to land. */
    arrivalPolls?: number;
    pollTicks?: number;
    /** Hops allowed per leg before giving up. */
    maxHopsPerLeg?: number;
    log?: (line: string) => void;
}

export interface WalkResult {
    ok: boolean;
    /** Waypoint index that failed, when ok is false. */
    failedLeg?: number;
    at: { x: number; z: number; level: number };
    /** Populated when ok is false: why, and how far short. */
    blocked?: string;
}

const dist = (a: Tile, b: Tile): number => Math.hypot(a.x - b.x, a.z - b.z);

/** Polls without movement that end a hop: the walk finished short or was refused. */
const STILL_POLLS = 3;

/**
 * Wait for one hop to land. Returns early once the player has stopped moving:
 * a hop the client walks around a fence ends short, and polling the full budget
 * afterwards cost minutes per refusal (sheep pen and Fred's farmhouse, 2026-10-28).
 */
async function waitForHop(host: WalkHost, step: Tile, tolerance: number, polls: number, pollTicks: number): Promise<boolean> {
    let last = host.getPos();
    let still = 0;
    for (let p = 0; p < polls; p++) {
        await host.waitTicks(pollTicks);
        const now = host.getPos();
        if (dist(now, step) <= tolerance) return true;
        still = now.x === last.x && now.z === last.z ? still + 1 : 0;
        if (still >= STILL_POLLS) return false;
        last = now;
    }
    return false;
}

/**
 * Walk a waypoint list in order. Waypoints advance by INDEX: selecting by
 * distance cannot mark one as passed and the bot walks back to it.
 */
export async function walkRoute(
    host: WalkHost,
    waypoints: readonly Tile[],
    options: WalkOptions = {}
): Promise<WalkResult> {
    const {
        maxHop = 12,
        tolerance = 3,
        arrivalPolls = 30,
        pollTicks = 2,
        maxHopsPerLeg = 25,
        log = () => {},
    } = options;

    for (let leg = 0; leg < waypoints.length; leg++) {
        const target = waypoints[leg]!;
        const from = host.getPos();
        log(`leg ${leg + 1}/${waypoints.length} -> (${target.x},${target.z}) from (${from.x},${from.z}) l${from.level} dist=${Math.round(dist(from, target))}`);

        let noProgress = 0;

        for (let hop = 0; hop < maxHopsPerLeg && dist(host.getPos(), target) > tolerance; hop++) {
            const me = host.getPos();
            const remaining = dist(me, target);
            const step: Tile = remaining <= maxHop
                ? target
                : {
                    x: Math.round(me.x + ((target.x - me.x) / remaining) * maxHop),
                    z: Math.round(me.z + ((target.z - me.z) / remaining) * maxHop),
                };

            await host.walk(step.x, step.z);

            // Wait for arrival at THIS hop before issuing another walk, or the
            // in-progress walk is interrupted and the bot oscillates.
            const reached = await waitForHop(host, step, tolerance, arrivalPolls, pollTicks);

            const now = host.getPos();
            const moved = dist(now, me);
            log(`  hop -> (${step.x},${step.z}) reached=${reached} at (${now.x},${now.z}) l${now.level} moved=${moved.toFixed(1)} distToWp=${Math.round(dist(now, target))}`);

            if (moved < 1) {
                // A refused hop is usually a too-long chord through hedge/wall
                // geometry, not a dead end: shrink the step and try again from the
                // same tile before calling the leg blocked. Observed live on the
                // gnome-stronghold exit: every 10-tile hop was refused and the bot
                // moved 3.6 tiles in four minutes while the PLAN was complete
                // (findLongPath had a full route from the same tile).
                const shortRemaining = dist(now, target);
                if (shortRemaining > 2) {
                    const shrink = Math.max(2, Math.min(6, Math.round(shortRemaining / 2)));
                    const near: Tile = shortRemaining <= shrink
                        ? target
                        : {
                            x: Math.round(now.x + ((target.x - now.x) / shortRemaining) * shrink),
                            z: Math.round(now.z + ((target.z - now.z) / shortRemaining) * shrink),
                        };
                    log(`  hop refused — retrying a ${shrink}-tile step to (${near.x},${near.z})`);
                    await host.walk(near.x, near.z);
                    await waitForHop(host, near, tolerance, arrivalPolls, pollTicks);
                    if (dist(host.getPos(), now) >= 1) {
                        noProgress = 0;
                        continue;
                    }
                }
                // An obstacle on this bearing, even at short range.
                noProgress++;
                if (noProgress >= 2) {
                    const why = `no progress at (${now.x},${now.z}) l${now.level} toward (${target.x},${target.z}), ${Math.round(dist(now, target))} tiles short`;
                    log(`BLOCKED leg ${leg + 1}: ${why}`);
                    return { ok: false, failedLeg: leg, at: now, blocked: why };
                }
            } else {
                noProgress = 0;
            }
        }

        const now = host.getPos();
        if (dist(now, target) > tolerance) {
            const why = `leg ${leg + 1} exhausted hops at (${now.x},${now.z}) l${now.level}, ${Math.round(dist(now, target))} tiles short of (${target.x},${target.z})`;
            log(`BLOCKED: ${why}`);
            return { ok: false, failedLeg: leg, at: now, blocked: why };
        }
        log(`  arrived leg ${leg + 1} at (${now.x},${now.z}) l${now.level}`);
    }

    const at = host.getPos();
    log(`route complete at (${at.x},${at.z}) l${at.level}`);
    return { ok: true, at };
}
