// chaos.ts - Chaos switchboard (Atlas Part 2: SIM_DOORS / SIM_DROP / SIM_NET_LATE).
// All off by default. Standing rule: proof lanes run with all on at once;
// single switches are for reproducing one bug. Own PRNG so world RNG untouched.

import { SimWorld } from './world.js';
import { mulberry32 } from './world.js';

export interface ChaosOpts {
    doors?: boolean;
    doorsFlipEvery?: number;
    doorsFlipFrac?: number;
    dropTicks?: number;
    netLateProb?: number;
    deadlineMs?: number;
    seed?: number;
}

interface Pending {
    action: Record<string, unknown>;
    due: number;
    seq: number;
}

export class ChaosSwitchboard {
    doorsOpen = 0;
    flips = 0;
    flushed: Record<string, unknown>[] = [];
    delayedCount = 0;
    deadlineTicks = 0;
    totalTicks = 0;

    private rng: () => number;
    private doorState: boolean[] = [];
    private dropRemaining = 0;
    private dropQueue: Record<string, unknown>[] = [];
    private netQueue: Pending[] = [];
    private seq = 0;
    private tick = 0;
    private doorTicks = 0;

    constructor(
        readonly world: SimWorld,
        readonly opts: ChaosOpts = {}
    ) {
        this.rng = mulberry32(opts.seed ?? 1234);
    }

    /** Randomize door open/closed at boot using the scripts' own geometry (here: loc list). */
    boot(): void {
        if (!this.opts.doors) return;
        this.doorState = this.world.locs.map(() => this.rng() < 0.5);
        this.doorsOpen = this.doorState.filter(Boolean).length;
    }

    startDrop(ticks: number): void {
        this.dropRemaining = ticks;
    }

    /**
     * Gate one outbound action. Returns the action to send now, or null to hold.
     * DROP holds everything; NET_LATE may delay 1-2 ticks with head-of-line
     * blocking so bytes stay in order, arrive late, never lost.
     */
    gateAction(action: Record<string, unknown>, nowTick: number): Record<string, unknown> | null {
        if (this.dropRemaining > 0) {
            this.dropQueue.push(action);
            return null;
        }
        const p = this.opts.netLateProb ?? 0;
        if (p > 0) {
            // Jitter on: EVERYTHING goes through the ordered queue (even
            // delay-0), so bytes stay in order, arrive late, never lost.
            // Consumers collect via drain(). Returns null always here.
            const delay = this.rng() < p ? 1 + Math.floor(this.rng() * 2) : 0;
            if (delay > 0) this.delayedCount++;
            this.netQueue.push({ action, due: nowTick + delay, seq: this.seq++ });
            return null;
        }
        return action;
    }

    /** Drain due delayed actions in order (head-of-line blocking preserves order). */
    drain(nowTick: number): Record<string, unknown>[] {
        const out: Record<string, unknown>[] = [];
        while (this.netQueue.length > 0 && this.netQueue[0].due <= nowTick) {
            out.push(this.netQueue.shift()!.action);
        }
        return out;
    }

    onTick(nowTick: number): void {
        this.tick = nowTick;
        // Doors flip on tick count, not tick number (works from any start tick).
        if (this.opts.doors) {
            const every = this.opts.doorsFlipEvery ?? 300;
            const frac = this.opts.doorsFlipFrac ?? 0.1;
            this.doorTicks++;
            if (this.doorTicks % every === 0 && this.doorState.length > 0) {
                const n = Math.max(1, Math.round(this.doorState.length * frac));
                for (let i = 0; i < n; i++) {
                    const idx = Math.floor(this.rng() * this.doorState.length);
                    this.doorState[idx] = !this.doorState[idx];
                }
                this.doorsOpen = this.doorState.filter(Boolean).length;
                this.flips++;
            }
        }
        // Drop countdown; flush in order when the outage ends.
        if (this.dropRemaining > 0) {
            this.dropRemaining--;
            if (this.dropRemaining === 0 && this.dropQueue.length > 0) {
                this.flushed.push(...this.dropQueue);
                this.dropQueue = [];
            }
        }
    }

    /** Record one tick's wall time; count ticks that ran on the deadline. */
    recordTick(ms: number): void {
        this.totalTicks++;
        if (ms > (this.opts.deadlineMs ?? 200)) this.deadlineTicks++;
    }
}
