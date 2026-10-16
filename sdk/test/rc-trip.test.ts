import { describe, expect, test } from 'bun:test';
import {
    AIR_XP_TENTHS,
    ENERGY_MAX,
    airCycle,
    coverSteps,
    idlingEnablesARun,
    runEnergyLoss,
    runEnergyRecover,
    runesPerEssence,
    timeTrip,
    type TripEvent
} from '../../bots/quests/rc-trip';
import {
    AIR_ALTAR,
    AIR_ENTER,
    AIR_EXIT,
    AIR_RUINS,
    pathOntoLoc,
    pathOntoTile,
    planAirRoute,
    worldTile
} from '../../bots/quests/rc-route';

describe('run energy', () => {
    test('matches Player.updateEnergy at the weight clamps', () => {
        expect(runEnergyLoss(0)).toBe(67);
        expect(runEnergyLoss(69)).toBe(67);
        expect(runEnergyLoss(64_000)).toBe(134);
        expect(runEnergyRecover(1)).toBe(8);
        expect(runEnergyRecover(99)).toBe(24);
    });

    test('one idle tick can enable a run, and it still covers no ground', () => {
        for (const agility of [1, 99]) {
            expect(idlingEnablesARun(agility, 0)).toBe(true);
            expect(runEnergyRecover(agility)).toBeGreaterThan(0);
        }
        const stood = timeTrip(
            [
                { type: 'idle', ticks: 1 },
                { type: 'move', steps: 2, weightGrams: 0 }
            ],
            0,
            1
        );
        const walked = timeTrip([{ type: 'move', steps: 3, weightGrams: 0 }], 0, 1);
        expect(stood.ticks).toBe(2);
        expect(walked.ticks).toBe(2);
        expect(walked.runTicks).toBe(1);
    });

    test('greedy run-until-empty matches an exhaustive search', () => {
        const loss = runEnergyLoss(0);
        const recover = runEnergyRecover(1);
        const memo = new Map<string, number>();
        const optimal = (left: number, energy: number): number => {
            if (left <= 0) return 0;
            const key = `${left}:${energy}`;
            const hit = memo.get(key);
            if (hit !== undefined) return hit;
            let best = 1 + optimal(left - 1, Math.min(ENERGY_MAX, energy + recover));
            if (energy > 0 && left >= 2) {
                best = Math.min(best, 1 + optimal(left - 2, Math.max(0, energy - loss)));
            }
            memo.set(key, best);
            return best;
        };
        expect(coverSteps(40, 500, 1, 0).ticks).toBe(optimal(40, 500));
        expect(coverSteps(69, ENERGY_MAX, 1, 69).ticks).toBe(35);
        expect(coverSteps(75, ENERGY_MAX, 1, 69).ticks).toBe(38);
    });
});

describe('air cycle', () => {
    const steps = { outboundSteps: 69, toAltarSteps: 2, toPortalSteps: 2, returnSteps: 75 };

    test('a full bar runs every pair, including at max weight', () => {
        const light = airCycle(steps);
        expect(light.ticks).toBe(88);
        expect(light.ms).toBe(88 * 600);
        expect(light.ranEveryPair).toBe(true);
        expect(light.energy).toBeGreaterThan(0);
        expect(light.essencePerHour).toBeCloseTo(27 / (88 * 0.6 / 3600), 5);

        const heavy = airCycle(steps, { wornGrams: 64_000, rcLevel: 99 });
        expect(heavy.ranEveryPair).toBe(true);
        expect(runesPerEssence(99)).toBe(10);
        expect(AIR_XP_TENTHS / 10).toBe(5);
    });

    test('p_delay does not refill, and the steps after it walk then run', () => {
        const locked = timeTrip([{ type: 'locked', ticks: 4 }], 0, 99);
        expect(locked.energy).toBe(0);
        expect(locked.runTicks).toBe(0);

        const events: TripEvent[] = [
            { type: 'locked', ticks: 4 },
            { type: 'move', steps: 4, weightGrams: 0 }
        ];
        const clock = timeTrip(events, 0, 99);
        expect(clock.lockedTicks).toBe(4);
        expect(clock.runTicks).toBe(1);
        expect(clock.ticks).toBe(7);
    });
});

describe('air route', () => {
    test('dbrow coords are the entrance and the exit', () => {
        expect(worldTile('0_44_75_25_30')).toEqual(AIR_ENTER);
        expect(worldTile('0_46_51_39_24')).toEqual(AIR_EXIT);
        expect(worldTile('0_46_51_41_28')).toEqual({ x: 2985, z: 3292 });
    });

    test('Falador east booth 3012,3355 is the shortest stand', () => {
        const route = planAirRoute();
        expect(route.stand).toEqual({ x: 3012, z: 3355 });
        expect(route.approach).toEqual({ x: 2985, z: 3294 });
        expect(route.outboundSteps).toBe(69);
        expect(route.returnSteps).toBe(75);
        expect(route.altarStand).toEqual({ x: 2843, z: 4832 });
        expect(route.toAltarSteps).toBe(2);
        expect(route.portalStand).toEqual({ x: 2841, z: 4829 });
        expect(route.toPortalSteps).toBe(2);

        const west = pathOntoLoc({ x: 2945, z: 3368 }, AIR_RUINS);
        const draynor = pathOntoLoc({ x: 3092, z: 3243 }, AIR_RUINS);
        expect(west.reached).toBe(true);
        expect(draynor.reached).toBe(true);
        expect(west.steps).toBeGreaterThan(route.outboundSteps);
        expect(draynor.steps).toBeGreaterThan(route.outboundSteps);
        expect(pathOntoTile(AIR_EXIT, route.stand).steps).toBe(route.returnSteps);
        expect(AIR_ALTAR.x).toBe(2843);
    });
});
