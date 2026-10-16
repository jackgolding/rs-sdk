// world.ts - Minimal SimWorld (Atlas brain-sim world.ts, adapted to BotAction level).
// Movement rules ported: 25-waypoint cap, diagonal-then-axis stepping,
// blocked step does not advance (wedges for good), loc ops only on zero-step
// ticks, MOVE clears pending op. Seeded RNG mulberry32.

export interface SimPlayer {
    x: number;
    z: number;
}

export interface SimLoc {
    x: number;
    z: number;
    id: number;
    options: string[];
}

export interface WorldOpts {
    seed?: number;
    startX?: number;
    startZ?: number;
}

export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const MAX_WAYPOINTS = 25;

export class SimWorld {
    player: SimPlayer = { x: 5, z: 5 };
    waypoints: Array<{ x: number; z: number }> = [];
    firedLocOps = 0;
    wedged = false;
    tick = 0;
    rng: () => number;
    locs: SimLoc[] = [];
    private pendingLocOp: SimLoc | null = null;
    private stuckTicks = 0;
    private destX: number | null = null;
    private destZ: number | null = null;
    private collision: (x: number, z: number) => boolean = () => true;

    constructor(opts?: WorldOpts) {
        this.rng = mulberry32(opts?.seed ?? 42);
        if (opts?.startX !== undefined) this.player.x = opts.startX;
        if (opts?.startZ !== undefined) this.player.z = opts.startZ;
    }

    setCollision(fn: (x: number, z: number) => boolean): void {
        this.collision = fn;
    }

    addLoc(x: number, z: number, id: number, options: string[]): void {
        this.locs.push({ x, z, id, options });
    }

    /** Queue a walk: straight-line waypoints, capped at 25. Clears pending loc op. */
    walkTo(x: number, z: number): void {
        // Same destination re-issued (bot retries every tick): keep waypoints
        // and stuck counter so a blocked path still wedges for good.
        if (this.destX === x && this.destZ === z && this.waypoints.length > 0) return;
        this.destX = x;
        this.destZ = z;
        this.pendingLocOp = null; // MOVE clears pending op (Atlas rule)
        this.wedged = false;
        this.stuckTicks = 0;
        const dx = x - this.player.x;
        const dz = z - this.player.z;
        const steps = Math.max(Math.abs(dx), Math.abs(dz));
        const n = Math.min(steps, MAX_WAYPOINTS);
        this.waypoints = [];
        for (let i = 1; i <= n; i++) {
            this.waypoints.push({
                x: this.player.x + Math.round((dx * i) / (steps || 1)),
                z: this.player.z + Math.round((dz * i) / (steps || 1))
            });
        }
        // Target beyond 25 waypoints: truncated — arrival never happens.
    }

    /** Advance one tick. Returns steps taken (0 or 1). */
    stepTick(): number {
        this.tick++;
        if (this.waypoints.length === 0) {
            // Zero-step tick: a pending loc op may fire.
            if (this.pendingLocOp) {
                this.firedLocOps++;
                this.pendingLocOp = null;
            }
            return 0;
        }
        const next = this.waypoints[0];
        // Try diagonal (the waypoint itself), then E/W, then N/S.
        const candidates = [
            { x: next.x, z: next.z },
            { x: next.x, z: this.player.z },
            { x: this.player.x, z: next.z }
        ];
        for (const c of candidates) {
            if (c.x === this.player.x && c.z === this.player.z) {
                this.waypoints.shift();
                this.stuckTicks = 0;
                return 1; // already there — consume waypoint
            }
            if (this.collision(c.x, c.z)) {
                this.player.x = c.x;
                this.player.z = c.z;
                if (c.x === next.x && c.z === next.z) this.waypoints.shift();
                this.stuckTicks = 0;
                return 1;
            }
        }
        // Blocked step: does not advance the waypoint (Atlas rule).
        this.stuckTicks++;
        if (this.stuckTicks >= 25) this.wedged = true;
        return 0;
    }
}
