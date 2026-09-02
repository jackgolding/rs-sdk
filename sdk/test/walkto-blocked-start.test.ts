import { describe, expect, test } from 'bun:test';
import { BotSDK } from '../index';
import { BotActions } from '../actions';

type PathResult = {
    success: boolean;
    waypoints: Array<{ x: number; z: number; level: number }>;
    reachedDestination?: boolean;
    error?: string;
};

function makeBot() {
    const sdk = Object.create(BotSDK.prototype) as BotSDK;
    const pos = { x: 2744, z: 3444 };
    const walks: Array<{ x: number; z: number }> = [];

    (sdk as any).getState = () => ({
        tick: 0,
        player: { worldX: pos.x, worldZ: pos.z, x: pos.x, z: pos.z, level: 0, animId: -1 },
        dialog: { isOpen: false, options: [], isWaiting: false },
        interface: { isOpen: false },
        shop: { isOpen: false },
        bank: { isOpen: false },
        nearbyLocs: [],
        gameMessages: [],
        inventory: [],
    });
    (sdk as any).sendFindPath = async (): Promise<PathResult> => ({
        success: false,
        waypoints: [],
        error: 'no path',
    });
    (sdk as any).waitForTicks = async () => {};
    (sdk as any).waitForCondition = async (pred: (s: any) => boolean) => {
        const state = (sdk as any).getState();
        if (pred(state)) return state;
        throw new Error('timeout');
    };
    (sdk as any).getNearbyLocs = () => [];
    (sdk as any).getInventory = () => [];
    (sdk as any).isDoorTemporarilyBlocked = () => false;
    (sdk as any).sendWalk = async (x: number, z: number) => {
        walks.push({ x, z });
        pos.x = x;
        pos.z = z;
        return { success: true, message: 'walk' };
    };

    const bot = new BotActions(sdk);
    (bot as any).helpers.walkStepToward = async (targetX: number, targetZ: number) => {
        pos.x = targetX;
        pos.z = targetZ;
        return { status: 'progress', pos: { ...pos } };
    };
    (bot as any).helpers.tryOpenBlockingDoor = async () => false;
    (bot as any).helpers.tileWalkable = (level: number, x: number, z: number) =>
        !(x === 2744 && z === 3444);
    (bot as any).helpers.isolatedWalkable = () => false;
    (bot as any).helpers.nearestWalkable = () => ({ x: 2745, z: 3444 });

    return { bot, pos, walks, sdk };
}

describe('walkTo() blocked start tile', () => {
    test('steps to a neighbour when standing on a blocked loc tile', async () => {
        const { bot, walks } = makeBot();
        const result = await bot.walkTo(2726, 3485, 2);
        expect(walks.length).toBeGreaterThan(0);
        expect(walks[0]).toEqual({ x: 2745, z: 3444 });
        expect(result.success).toBe(false);
        expect(result.message).not.toMatch(/no waypoints$/);
    });

    test('steps off a walkable flax-gap island when findPath has no waypoints', async () => {
        const { bot, walks } = makeBot();
        (bot as any).helpers.tileWalkable = () => true;
        (bot as any).helpers.isolatedWalkable = () => true;
        (bot as any).helpers.nearestWalkable = (
            _level: number,
            x: number,
            z: number,
            _maxR?: number,
            excludeStart?: boolean
        ) => (excludeStart ? { x: x - 1, z: z - 1 } : { x, z });
        const result = await bot.walkTo(2715, 3471, 2);
        expect(walks[0]).toEqual({ x: 2743, z: 3443 });
        expect(result.message).not.toMatch(/no waypoints$/);
    });

    test('full bag: drops 1 flax, picks a neighbour plant, then steps onto it', async () => {
        const { bot, pos, walks, sdk } = makeBot();
        const inventory = Array.from({ length: 28 }, (_, slot) => ({
            id: 1779,
            name: 'Flax',
            count: 1,
            slot,
        }));
        const locs = [
            {
                id: 2646,
                name: 'Flax',
                x: 2745,
                z: 3444,
                level: 0,
                distance: 1,
                optionsWithIndex: [{ text: 'Pick', opIndex: 1 }],
                options: ['Pick'],
                reachable: true,
            },
            {
                id: 2646,
                name: 'Flax',
                x: 2744,
                z: 3444,
                level: 0,
                distance: 0,
                optionsWithIndex: [{ text: 'Pick', opIndex: 1 }],
                options: ['Pick'],
                reachable: true,
            },
        ];
        const drops: Array<{ amount: number | 'all' }> = [];
        const interacts: Array<{ x: number; z: number }> = [];

        (sdk as any).getInventory = () => inventory;
        (sdk as any).getNearbyLocs = () => locs;
        (sdk as any).getState = () => ({
            tick: 0,
            player: { worldX: pos.x, worldZ: pos.z, x: pos.x, z: pos.z, level: 0, animId: -1 },
            dialog: { isOpen: false, options: [], isWaiting: false },
            interface: { isOpen: false },
            shop: { isOpen: false },
            bank: { isOpen: false },
            nearbyLocs: locs,
            gameMessages: [],
            inventory,
        });
        (sdk as any).sendFindPath = async (): Promise<PathResult> => ({
            success: true,
            waypoints: [
                { x: 2745, z: 3444, level: 0 },
                { x: 2715, z: 3471, level: 0 },
            ],
            reachedDestination: true,
        });
        (sdk as any).sendWalk = async (x: number, z: number) => {
            walks.push({ x, z });
            if (locs.some((l) => l.x === x && l.z === z)) {
                return { success: true, message: 'walk' };
            }
            pos.x = x;
            pos.z = z;
            return { success: true, message: 'walk' };
        };
        (sdk as any).sendInteractLoc = async (x: number, z: number) => {
            interacts.push({ x, z });
            const idx = locs.findIndex((l) => l.x === x && l.z === z);
            if (idx >= 0) locs.splice(idx, 1);
            return { success: true };
        };
        (bot as any).dropItem = async (_target: unknown, amount: number | 'all') => {
            drops.push({ amount });
            inventory.pop();
            return { success: true, slotsDropped: 1 };
        };
        (bot as any).helpers.tileWalkable = (_level: number, x: number, z: number) =>
            (x === 2744 && z === 3444) || (x === 2745 && z === 3444);
        (bot as any).helpers.isolatedWalkable = () => false;

        await bot.walkTo(2715, 3471, 2);

        expect(drops).toEqual([{ amount: 1 }]);
        expect(interacts[0]).toEqual({ x: 2745, z: 3444 });
        expect(walks).toContainEqual({ x: 2745, z: 3444 });
        expect(pos).not.toEqual({ x: 2744, z: 3444 });
    });
});
