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

describe('Seers flax collision island', () => {
    test('2742,3447 is walkable but isolated, and a neighbour is connected', () => {
        initPathfinding();
        expect(isTileWalkable(0, 2742, 3447)).toBe(true);
        expect(isIsolatedWalkableTile(0, 2742, 3447)).toBe(true);
        expect(isIsolatedWalkableTile(0, 2744, 3444)).toBe(false);
        expect(nearestWalkableTile(0, 2742, 3447, 8, true)).toEqual({ x: 2741, z: 3446 });
    });
});
