import { describe, expect, test } from 'bun:test';
import {
    classifyProgress,
    expectsWilderness,
    inventorySig,
    movementKind,
    nearbyPlayers,
    nextFix,
    nextGains,
    piles,
    stuckThresholdMs,
    wildernessLevel,
    xpTotal,
    type WorldPlayer
} from './classify';

describe('wildernessLevel', () => {
    test('null south of the ditch, in the essence mine, and west of the wildy x range', () => {
        expect(wildernessLevel(3094, 3492)).toBeNull();
        expect(wildernessLevel(2926, 4818)).toBeNull();
        expect(wildernessLevel(3000, 4818)).toBeNull();
        expect(wildernessLevel(2576, 4848)).toBeNull();
    });

    test('edgeville dungeon wildy starts at z=9920 on floor 0', () => {
        expect(wildernessLevel(3100, 9920, 0)).toBe(1);
        expect(wildernessLevel(3100, 9920, 1)).toBeNull();
    });

    test('one level per 8 tiles north of z=3520', () => {
        expect(wildernessLevel(3088, 3520)).toBe(1);
        expect(wildernessLevel(3088, 3527)).toBe(1);
        expect(wildernessLevel(3088, 3528)).toBe(2);
        expect(wildernessLevel(3058, 3814)).toBe(37);
    });
});

describe('stuck thresholds', () => {
    test('standing skills wait longer than a walker', () => {
        expect(stuckThresholdMs('bun bots/quests/fishing-route.ts Jackpoo3 --shark')).toBe(25 * 60_000);
        expect(stuckThresholdMs('bun bots/quests/thieving-route.ts Jackpoo2')).toBe(25 * 60_000);
        expect(stuckThresholdMs('bun bots/quests/green-dragons.ts Jackpoo9')).toBe(12 * 60_000);
        expect(stuckThresholdMs('bun bots/quests/nature-essence-run.ts Jackpoo1')).toBe(8 * 60_000);
    });

    test('only wildy jobs are expected north of the ditch', () => {
        expect(expectsWilderness('bun bots/quests/green-dragons.ts X')).toBe(true);
        expect(expectsWilderness('bun bots/quests/fishing-route.ts X --shark')).toBe(false);
    });
});

describe('nextFix', () => {
    const tile = { x: 3200, z: 3400, level: 0 };

    test('first sample has no movement', () => {
        const { fix, moved } = nextFix(undefined, 1_000, null, tile);
        expect(moved).toBeNull();
        expect(fix.since).toBe(1_000);
    });

    test('a long gap forgets the old dwell', () => {
        const prior = { ...tile, since: 0 };
        const { moved, fix } = nextFix(prior, 50 * 60_000, 0, tile);
        expect(moved).toBeNull();
        expect(fix.since).toBe(50 * 60_000);
    });

    test('same tile keeps since; a step resets it', () => {
        const prior = { ...tile, since: 5_000 };
        const held = nextFix(prior, 20_000, 10_000, tile);
        expect(held.moved).toBe(false);
        expect(held.fix.since).toBe(5_000);

        const stepped = nextFix(prior, 20_000, 10_000, { x: 3201, z: 3400, level: 0 });
        expect(stepped.moved).toBe(true);
        expect(stepped.fix.since).toBe(20_000);
    });
});

describe('movementKind', () => {
    test('seen, moving, still, stuck', () => {
        expect(movementKind(null, 0, 8 * 60_000)).toBe('seen');
        expect(movementKind(true, 0, 8 * 60_000)).toBe('moving');
        expect(movementKind(false, 60_000, 8 * 60_000)).toBe('still');
        expect(movementKind(false, 8 * 60_000, 8 * 60_000)).toBe('stuck');
    });
});

describe('progress', () => {
    const threshold = 8 * 60_000;
    const prior = { xp: 100, inv: '1:2', drySince: 0 };

    test('inventory signature ignores order and empty slots', () => {
        expect(inventorySig([{ id: 2, count: 1 }, { id: 0, count: 5 }, { id: 1, count: 3 }])).toBe('1:3,2:1');
        expect(xpTotal([{ experience: 10 }, { experience: 5 }])).toBe(15);
    });

    test('a cold sample is not "no change"', () => {
        const first = nextGains(undefined, 1_000, null, { xp: 10, inv: '1:1' });
        expect(first.xpChanged).toBeNull();
        expect(first.inventoryChanged).toBeNull();
        const held = nextGains(prior, 5_000, 1_000, { xp: 100, inv: '1:2' });
        expect(held.xpChanged).toBe(false);
        expect(held.inventoryChanged).toBe(false);
        expect(held.gain.drySince).toBe(0);
        const gained = nextGains(prior, 5_000, 1_000, { xp: 140, inv: '1:2' });
        expect(gained.xpChanged).toBe(true);
        expect(gained.gain.drySince).toBe(5_000);
    });

    test('no inventory, no xp, and no movement is stuck only after the threshold', () => {
        const flat = {
            onMap: true,
            inventoryChanged: false,
            xpChanged: false,
            moved: false,
            thresholdMs: threshold,
            stationary: true
        };
        expect(classifyProgress({ ...flat, dryMs: 60_000 })).toBe('flat');
        expect(classifyProgress({ ...flat, dryMs: threshold })).toBe('stuck');
    });

    test('no inventory, no xp, and movement is task-dependent', () => {
        const moving = {
            onMap: true,
            inventoryChanged: false,
            xpChanged: false,
            moved: true,
            dryMs: threshold,
            thresholdMs: threshold,
            stationary: false
        };
        expect(classifyProgress(moving)).toBe('task');
        expect(classifyProgress({ ...moving, stationary: true })).toBe('stuck');
        expect(classifyProgress({ ...moving, stationary: true, dryMs: 30_000 })).toBe('task');
    });

    test('xp is working; inventory without xp stays task-dependent; a missing signal is unknown', () => {
        const base = {
            onMap: true,
            dryMs: threshold,
            thresholdMs: threshold,
            stationary: true,
            moved: false
        };
        expect(classifyProgress({ ...base, inventoryChanged: false, xpChanged: true })).toBe('working');
        expect(classifyProgress({ ...base, inventoryChanged: true, xpChanged: false })).toBe('task');
        expect(classifyProgress({ ...base, inventoryChanged: null, xpChanged: false })).toBe('unknown');
        expect(classifyProgress({ ...base, inventoryChanged: false, xpChanged: false, onMap: false })).toBe('absent');
    });
});

describe('piles and nearby', () => {
    const fleet: WorldPlayer[] = [
        { name: 'A', x: 10, z: 10, level: 0 },
        { name: 'B', x: 10, z: 10, level: 0 },
        { name: 'C', x: 10, z: 10, level: 0 },
        { name: 'D', x: 40, z: 40, level: 0 }
    ];

    test('three on one tile is a pile', () => {
        expect(piles(fleet, 3)).toEqual([{ x: 10, z: 10, level: 0, names: ['A', 'B', 'C'] }]);
    });

    test('nearby stays on the same floor', () => {
        const strangers: WorldPlayer[] = [
            { name: 'Pk', x: 12, z: 11, level: 0 },
            { name: 'Down', x: 10, z: 10, level: 1 }
        ];
        expect(nearbyPlayers(fleet[0]!, fleet, strangers, 5)).toEqual({
            fleet: ['B', 'C'],
            strangers: ['Pk']
        });
    });
});
