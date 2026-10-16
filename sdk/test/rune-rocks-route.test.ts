import { describe, expect, test } from 'bun:test';
import { inWilderness } from '../regions';
import {
    CHAOS_ALTAR,
    KBD_LADDER,
    LAVA_MAZE_EAST,
    ROCKS,
    chaosAltarHops,
    clickAhead,
    hobToDitchHops,
    inGreenDragons,
    returnToHobHops,
    skipIfFarther,
    southOfLavaMaze,
    waypointsToRuneRocks,
    westToRocksHops
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

function expectShortSafeHops(hops: { x: number; z: number }[]): void {
    expect(hops.length).toBeGreaterThan(5);
    for (let i = 1; i < hops.length; i++) {
        const step = Math.max(Math.abs(hops[i]!.x - hops[i - 1]!.x), Math.abs(hops[i]!.z - hops[i - 1]!.z));
        expect(step).toBeLessThanOrEqual(3);
        expect(inGreenDragons(hops[i]!.x, hops[i]!.z)).toBe(false);
    }
}

describe('west lava-maze route', () => {
    test('outbound stays west of the dragons and passes the KBD ladder', () => {
        const hops = westToRocksHops();
        expect(hops[0]).toEqual({ x: 3088, z: 3525 });
        expect(hops[hops.length - 1]).toEqual({ x: 3060, z: 3885 });
        expectShortSafeHops(hops);
        const nearKbd = hops.some((h) => Math.hypot(h.x - KBD_LADDER.x, h.z - KBD_LADDER.z) <= 15);
        expect(nearKbd).toBe(true);
        expect(hops.some((h) => h.x >= 3115 && h.z >= 3780 && h.z < 3880)).toBe(false);
    });

    test('the return reaches the hobgoblin mine without the east road', () => {
        const hops = returnToHobHops();
        expect(hops[0]).toEqual({ x: 3060, z: 3885 });
        expect(hops[hops.length - 1]).toEqual({ x: 3080, z: 3762 });
        expectShortSafeHops(hops);
        expect(hops.some((h) => Math.hypot(h.x - KBD_LADDER.x, h.z - KBD_LADDER.z) <= 15)).toBe(true);
    });

    test('hobgoblin to the ditch stays south of the dragons', () => {
        const hops = hobToDitchHops();
        expect(hops[0]).toEqual({ x: 3080, z: 3762 });
        expect(hops[hops.length - 1]).toEqual({ x: 3088, z: 3525 });
        expectShortSafeHops(hops);
    });

    test('a clear stretch is one click, not a 3-tile hop', () => {
        const hops = westToRocksHops();
        const start = hops.findIndex((h) => h.x === 2983 && h.z === 3665);
        expect(start).toBeGreaterThan(0);
        const from = hops[start]!;
        const click = clickAhead(from, hops, start);
        expect(click.straight).toBe(true);
        const reach = Math.max(Math.abs(click.tile.x - from.x), Math.abs(click.tile.z - from.z));
        expect(reach).toBeGreaterThan(8);
        expect(reach).toBeLessThanOrEqual(18);
        expect(inGreenDragons(click.tile.x, click.tile.z)).toBe(false);
    });

    test('a tree on the chord stays a short hop', () => {
        const hops = westToRocksHops();
        const start = hops.findIndex((h) => h.x === 2984 && h.z === 3662);
        expect(start).toBeGreaterThan(0);
        const click = clickAhead(hops[start]!, hops, start);
        expect(click.straight).toBe(false);
        expect(click.tile).toEqual(hops[start + 1]!);
    });

    test('chaos altar click stops before the temple door', () => {
        const hops = chaosAltarHops();
        const start = hops.findIndex((h) => h.x > 2958);
        expect(start).toBeGreaterThanOrEqual(0);
        const click = clickAhead(hops[start]!, hops, start, (x, z) => x === 2958 && (z === 3820 || z === 3821));
        expect(click.tile.x).toBeGreaterThan(2958);
    });

    test('chaos altar hops leave the west road', () => {
        const hops = chaosAltarHops();
        expect(hops[0]).toEqual({ x: 2984, z: 3820 });
        expect(hops[hops.length - 1]).toEqual({ x: 2949, z: 3818 });
        expectShortSafeHops(hops);
        expect(Math.hypot(hops[hops.length - 1]!.x - CHAOS_ALTAR.x, hops[hops.length - 1]!.z - CHAOS_ALTAR.z)).toBeLessThanOrEqual(4);
    });
});
