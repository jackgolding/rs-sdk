import { describe, expect, test } from 'bun:test';
import { inWilderness } from '../regions';
import {
    LAVA_MAZE_EAST,
    ROCKS,
    skipIfFarther,
    southOfLavaMaze,
    waypointsToRuneRocks
} from '../../bots/quests/rune-rocks-route';

describe('inWilderness', () => {
    test('true at lava maze south, false at Edgeville bank and essence mine', () => {
        expect(inWilderness(3058, 3814)).toBe(true);
        expect(inWilderness(3094, 3492)).toBe(false);
        expect(inWilderness(2926, 4818)).toBe(false);
    });
});

describe('waypointsToRuneRocks', () => {
    test('south of lava maze goes east onto the road, not north into lava', () => {
        const stuck = { x: 3058, z: 3814 };
        expect(southOfLavaMaze(stuck.x, stuck.z)).toBe(true);
        expect(skipIfFarther(stuck, { x: 3130, z: 3879 }, ROCKS)).toBe(true);

        const hops = waypointsToRuneRocks(stuck);
        expect(hops[0]).toEqual(LAVA_MAZE_EAST);
        expect(hops.map((h) => `${h.x},${h.z}`)).toContain('3130,3879');
        expect(hops[0]!.z).toBeLessThan(ROCKS.z);
        expect(hops[0]!.x).toBeGreaterThan(stuck.x);
    });

    test('from the ditch the east road still runs north', () => {
        const hops = waypointsToRuneRocks({ x: 3088, z: 3525 });
        expect(hops[0]).toEqual({ x: 3102, z: 3610 });
        expect(hops.some((h) => h.x >= 3128 && h.z >= 3833)).toBe(true);
    });
});
