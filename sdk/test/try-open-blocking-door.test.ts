import { describe, expect, test } from 'bun:test';
import { ActionHelpers, isVerticalExitName } from '../actions-helpers';
import type { BotSDK } from '../index';

describe('tryOpenBlockingDoor vertical exits', () => {
    test('isVerticalExitName matches trapdoors, manholes, hatches, magic doors only', () => {
        expect(isVerticalExitName('Trapdoor')).toBe(true);
        expect(isVerticalExitName('Manhole')).toBe(true);
        expect(isVerticalExitName('Hatch')).toBe(true);
        expect(isVerticalExitName('Magic door')).toBe(true);
        expect(isVerticalExitName('Door')).toBe(false);
        expect(isVerticalExitName('Gate')).toBe(false);
    });

    test('opens a door and ignores a nearer trapdoor', async () => {
        const opened: Array<{ x: number; z: number }> = [];
        const sdk = {
            getNearbyLocs: () => [
                {
                    name: 'Trapdoor',
                    x: 1,
                    z: 1,
                    distance: 1,
                    optionsWithIndex: [{ text: 'Open', opIndex: 1 }],
                },
                {
                    name: 'Door',
                    x: 5,
                    z: 5,
                    distance: 4,
                    optionsWithIndex: [{ text: 'Open', opIndex: 1 }],
                },
            ],
        } as unknown as BotSDK;
        const helpers = new ActionHelpers(sdk);
        (helpers as any).openDoorAt = async (x: number, z: number) => {
            opened.push({ x, z });
            return 'opened';
        };
        const ok = await helpers.tryOpenBlockingDoor();
        expect(ok).toBe(true);
        expect(opened).toEqual([{ x: 5, z: 5 }]);
    });
});
