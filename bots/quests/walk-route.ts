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

import { recordTravelGap } from '../../sdk/travel';

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

/**
 * Walk a waypoint list in order. Waypoints advance by INDEX: selecting by
 * distance cannot mark one as passed and the bot walks back to it.
 */
/**
 * Which script is walking, for the gap registry. Falls back to argv's entry
 * point, which is the script itself when run as `bun bots/quests/<x>.ts <bot>`.
 */
function walkingScript(): string {
    const entry = process.argv[1] ?? 'unknown';
    return entry.includes('/bots/') ? entry.slice(entry.indexOf('bots/')) : entry.split('/').pop() ?? 'unknown';
}

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
            let reached = false;
            for (let p = 0; p < arrivalPolls; p++) {
                await host.waitTicks(pollTicks);
                if (dist(host.getPos(), step) <= tolerance) { reached = true; break; }
            }

            const now = host.getPos();
            const moved = dist(now, me);
            log(`  hop -> (${step.x},${step.z}) reached=${reached} at (${now.x},${now.z}) l${now.level} moved=${moved.toFixed(1)} distToWp=${Math.round(dist(now, target))}`);

            if (moved < 1) {
                // An obstacle on this bearing; retrying it cannot help.
                noProgress++;
                if (noProgress >= 2) {
                    const why = `no progress at (${now.x},${now.z}) l${now.level} toward (${target.x},${target.z}), ${Math.round(dist(now, target))} tiles short`;
                    log(`BLOCKED leg ${leg + 1}: ${why}`);
                    // A blocked hop is a travel gap, not just this run's bad luck:
                    // record it so the same wall becomes one work item instead of
                    // N scripts rediscovering it.
                    recordTravelGap({
                        kind: 'blocked',
                        from: now,
                        to: { x: target.x, z: target.z, level: now.level },
                        script: walkingScript(),
                        detail: why,
                    });
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
            recordTravelGap({
                kind: 'arrival-short',
                from: now,
                to: { x: target.x, z: target.z, level: now.level },
                script: walkingScript(),
                detail: why,
            });
            return { ok: false, failedLeg: leg, at: now, blocked: why };
        }
        log(`  arrived leg ${leg + 1} at (${now.x},${now.z}) l${now.level}`);
    }

    const at = host.getPos();
    log(`route complete at (${at.x},${at.z}) l${at.level}`);
    return { ok: true, at };
}
