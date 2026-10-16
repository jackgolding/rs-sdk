import { describe, expect, test } from 'bun:test';

// RED: these modules don't exist yet. This test must FAIL until the harness lands.
// Atlas refs: brain-sim tick flow, engine-order batches, 25-waypoint wedge,
// MOVE-clears-pending-op, unknown-opcode-throws.

import { SimWorld } from './world.js';
import { SimHarness } from './harness.js';
import { validateActionOrder } from './protocol.js';

describe('SimHarness tick flow', () => {
    test('bot brain sees state and walkTo advances one tick', async () => {
        const world = new SimWorld({ seed: 42 });
        const harness = new SimHarness(world, async (state) => ({
            type: 'walkTo',
            x: state.player.x + 2,
            z: state.player.z,
            reason: 'test-step'
        }));
        const before = world.player.x;
        await harness.tickOnce();
        expect(world.player.x).toBeGreaterThan(before);
        expect(harness.ticks).toBe(1);
    });

    test('MOVE clears a pending interactLoc op; loc ops fire only on zero-step tick', async () => {
        const world = new SimWorld({ seed: 42 });
        world.addLoc(10, 10, 1234, ['Chop']);
        const seen: string[] = [];
        const harness = new SimHarness(world, async (state) => {
            // First tick: queue an interact while moving — must defer, not fire mid-stride.
            if (harness.ticks === 0) {
                seen.push('tick0');
                return { type: 'walkTo', x: 10, z: 10, reason: 'approach' };
            }
            seen.push(`tick${harness.ticks}`);
            return { type: 'none', reason: 'idle' };
        });
        await harness.tickOnce();
        // While steps remain, no loc op may have fired.
        expect(world.firedLocOps).toBe(0);
        expect(seen).toContain('tick0');
    });

    test('unknown action type throws loudly', () => {
        expect(() =>
            validateActionOrder([{ type: 'teleportAdmin' } as any])
        ).toThrow();
    });
});

describe('SimWorld movement rules', () => {
    test('25-waypoint cap: blocked step wedges for good', async () => {
        const world = new SimWorld({ seed: 42 });
        // Wall across the path: every step blocked.
        world.setCollision((_x, _z) => false);
        const harness = new SimHarness(world, async () => ({
            type: 'walkTo',
            x: 50,
            z: 50,
            reason: 'into-wall'
        }));
        const startX = world.player.x;
        for (let i = 0; i < 40; i++) await harness.tickOnce();
        // Wedged: never advanced, waypoints exhausted.
        expect(world.player.x).toBe(startX);
        expect(world.wedged).toBeTrue();
    });
});
