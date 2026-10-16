// harness.ts - SimHarness: one bot brain against one SimWorld.
// Atlas rule: the bot is never edited to make a test pass — the brain is an
// unmodified (state => action) function. Encoding is deferred so apply order
// equals push order: brain act -> validate -> world apply -> tick.

import { SimWorld } from './world.js';
import { validateActionOrder } from './protocol.js';

export interface BrainState {
    player: { x: number; z: number };
    tick: number;
    wedged: boolean;
}

export type BrainFn = (state: BrainState) => Promise<Record<string, unknown>> | Record<string, unknown>;

export class SimHarness {
    ticks = 0;
    idleTicks = 0;

    constructor(
        readonly world: SimWorld,
        readonly brain: BrainFn
    ) {}

    snapshot(): BrainState {
        return {
            player: { x: this.world.player.x, z: this.world.player.z },
            tick: this.ticks,
            wedged: this.world.wedged
        };
    }

    async tickOnce(): Promise<void> {
        const action = (await this.brain(this.snapshot())) as { type: string; x?: number; z?: number };
        validateActionOrder([action as any]);
        if (action.type === 'walkTo' && typeof action.x === 'number' && typeof action.z === 'number') {
            this.world.walkTo(action.x, action.z);
            this.idleTicks = 0;
        } else if (action.type === 'none' || action.type === 'wait') {
            this.idleTicks++;
        } else {
            this.idleTicks = 0;
        }
        this.world.stepTick();
        this.ticks++;
        // Watchdog: 5s idle at 300ms ticks ≈ 16 ticks — flag desync risk.
        if (this.idleTicks > 16) {
            // Soft signal only; tests assert on idleTicks, harness never throws here.
        }
    }
}
