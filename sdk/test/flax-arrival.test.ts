import { describe, expect, test } from 'bun:test';
import { atSeersFlax, SEERS_FLAX } from '../regions';
import { initPathfinding, isIsolatedWalkableTile, isTileWalkable, nearestWalkableTile } from '../pathfinding';

describe('already at Seers flax', () => {
    test('true inside the field radius', () => {
        expect(atSeersFlax(SEERS_FLAX.x, SEERS_FLAX.z)).toBe(true);
        expect(atSeersFlax(SEERS_FLAX.x + 8, SEERS_FLAX.z - 4)).toBe(true);
    });

    test('false at Seers bank / spinning wheel house', () => {
        expect(atSeersFlax(2726, 3485)).toBe(false);
        expect(atSeersFlax(2715, 3471)).toBe(false);
    });
});

describe('Seers flax approach tiles', () => {
    test('2742,3447 is walkable and connected (door-pollution island is gone)', () => {
        initPathfinding();
        // ee40a1561 regenerated collision from a fresh prod world: the old
        // export came from a local server where test bots had left doors
        // open/closed, which fenced 2742,3447 into a phantom island. Prod
        // data shows open field — every cardinal neighbour walks.
        expect(isTileWalkable(0, 2742, 3447)).toBe(true);
        expect(isIsolatedWalkableTile(0, 2742, 3447)).toBe(false);
        expect(isIsolatedWalkableTile(0, 2744, 3444)).toBe(false);
        expect(nearestWalkableTile(0, 2742, 3447, 8, true)).toEqual({ x: 2741, z: 3446 });
    });
});
