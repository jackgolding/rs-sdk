import { describe, expect, test } from 'bun:test';
import { computeYields, medianOf, type YieldBotInput } from '../../.cursor/skills/wake-fleet/scripts/fleet-yields';

const HOUR = (h: number) => `2026-10-05T${String(h).padStart(2, '0')}`;
const at = (h: number, minute: number) => Date.parse(`2026-10-05T${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);

function beat(h: number, minutes: number[], jobKey: string) {
    return minutes.map((minute) => ({
        t: at(h, minute),
        jobKey,
        x: 2800,
        z: 3400,
        xp: { Hitpoints: 1154 },
    }));
}

const SHARK = 'bots/quests/fishing-route.ts --shark';
const NET = 'bots/quests/fishing-route.ts --bignet';

describe('computeYields', () => {
    test('median, a zero hour, the 10-minute floor, and separate product flags', () => {
        const full = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
        const bots: YieldBotInput[] = [
            {
                name: 'A',
                rosterJobKey: SHARK,
                heartbeats: beat(14, full, SHARK),
                gains: [{ t: at(14, 20), jobKey: SHARK, item: 'Shark', count: 20 }],
            },
            {
                name: 'B',
                rosterJobKey: SHARK,
                heartbeats: beat(14, full, SHARK),
                gains: [{ t: at(14, 20), jobKey: SHARK, item: 'Shark', count: 10 }],
            },
            {
                name: 'C',
                rosterJobKey: SHARK,
                heartbeats: beat(14, full, SHARK),
                gains: [],
            },
            {
                name: 'D',
                rosterJobKey: SHARK,
                heartbeats: beat(14, [0], SHARK),
                gains: [{ t: at(14, 1), jobKey: SHARK, item: 'Shark', count: 50 }],
            },
            {
                name: 'E',
                rosterJobKey: NET,
                heartbeats: beat(14, full, NET),
                gains: [{ t: at(14, 10), jobKey: NET, item: 'Raw bass', count: 5 }],
            },
        ];
        const report = computeYields({
            now: at(15, 0),
            windowMs: 24 * 3_600_000,
            hourOf: (t) => HOUR(new Date(t).getHours()),
            bots,
        });
        const shark = report.jobs.find((job) => job.jobKey === SHARK);
        const sharks = shark?.items.find((item) => item.item === 'Shark');
        expect(sharks?.points.map((point) => point.name).sort()).toEqual(['A', 'B', 'C']);
        expect(sharks?.points.find((point) => point.name === 'C')?.perHour).toBe(0);
        expect(sharks?.median).toBe(10);
        expect(sharks?.points.some((point) => point.name === 'D')).toBe(false);
        expect(report.jobs.find((job) => job.jobKey === NET)?.items[0]?.item).toBe('Raw bass');
        expect(shark?.items.some((item) => item.item === 'Raw bass')).toBe(false);
    });

    test('fishing XP without gain lines is no samples', () => {
        const report = computeYields({
            now: at(15, 0),
            windowMs: 3_600_000,
            hourOf: (t) => HOUR(new Date(t).getHours()),
            bots: [
                {
                    name: 'A',
                    rosterJobKey: SHARK,
                    heartbeats: beat(14, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55], SHARK),
                    gains: [],
                },
            ],
        });
        expect(report.jobs).toHaveLength(0);
        expect(report.noSamples).toEqual([SHARK]);
    });

    test('two heartbeats five minutes apart are included; one is not', () => {
        const bots: YieldBotInput[] = [
            {
                name: 'A',
                rosterJobKey: SHARK,
                heartbeats: beat(14, [0, 5], SHARK),
                gains: [{ t: at(14, 4), jobKey: SHARK, item: 'Shark', count: 5 }],
            },
            {
                name: 'B',
                rosterJobKey: SHARK,
                heartbeats: beat(14, [0], SHARK),
                gains: [{ t: at(14, 0), jobKey: SHARK, item: 'Shark', count: 5 }],
            },
        ];
        const report = computeYields({
            now: at(15, 0),
            windowMs: 3_600_000,
            hourOf: (t) => HOUR(new Date(t).getHours()),
            bots,
        });
        const points = report.jobs[0]!.items[0]!.points;
        expect(points.map((point) => point.name)).toEqual(['A']);
        expect(points[0]!.presenceMs).toBe(10 * 60_000);
        expect(points[0]!.perHour).toBe(30);
    });
});

describe('medianOf', () => {
    test('even counts average the two middle values', () => {
        expect(medianOf([1, 100])).toBe(50.5);
        expect(medianOf([4])).toBe(4);
    });
});
