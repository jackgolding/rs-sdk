import { describe, expect, test } from 'bun:test';
import { planBankWalk } from './job-bank';

describe('planBankWalk', () => {
    test('knights follow the Ardougne bank road', () => {
        const plan = planBankWalk(
            { script: 'bots/quests/thieving-route.ts', args: ['--knights'] },
            { x: 2656, z: 3316 }
        );
        expect(plan.source).toBe('job');
        expect(plan.bank.name).toBe('Ardougne');
        expect(plan.ditch).toBe(false);
        expect(plan.points[plan.points.length - 1]).toEqual({ x: 2655, z: 3283 });
        expect(plan.points.some((tile) => tile.z === 3312)).toBe(true);
    });

    test('a wilderness job walks south to its bank', () => {
        const plan = planBankWalk({ script: 'bots/quests/green-dragons.ts', args: [] }, { x: 3100, z: 3820 });
        expect(plan.source).toBe('job');
        expect(plan.bank.name).toBe('Edgeville');
        expect(plan.ditch).toBe(true);
        expect(plan.points[0]!.z).toBeLessThan(3820);
        expect(plan.points[plan.points.length - 1]).toMatchObject({ x: 3094, z: 3492 });
    });

    test('a job with no bank uses the closest bank at any distance', () => {
        const plan = planBankWalk({ script: 'bots/quests/accept-trades.ts', args: [] }, { x: 3208, z: 3220 });
        expect(plan.source).toBe('closest');
        expect(plan.bank.name).toBe('Lumbridge');
        expect(plan.points.length).toBeGreaterThan(0);
    });

    test('mining guild climbs out before Falador east', () => {
        const plan = planBankWalk({ script: 'bots/quests/mining-guild.ts', args: [] }, { x: 3040, z: 9740 });
        expect(plan.climb).toBe('mining-guild');
        expect(plan.bank.name).toBe('Falador east');
        expect(plan.source).toBe('job');
    });
});
