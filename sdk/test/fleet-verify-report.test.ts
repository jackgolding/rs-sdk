import { describe, expect, test } from 'bun:test';
import { auditLine, namesChanged } from '../../.cursor/skills/wake-fleet/scripts/fleet-verify-report';

describe('fleet-verify-report', () => {
    test('keeps not-producing bots with their check', () => {
        const line = auditLine(
            {
                headline: '2 producing, 1 not producing',
                summary: { producing: ['A', 'B'], notProducing: ['C'] },
                bots: [
                    { name: 'A', kind: 'producing', check: 'ok' },
                    { name: 'C', kind: 'alive-not-producing', check: 'telemetry_silent' },
                ],
            },
            1_700_000_000_000,
        );
        expect(line.producing).toBe(2);
        expect(line.notProducing).toEqual([
            { name: 'C', kind: 'alive-not-producing', check: 'telemetry_silent' },
        ]);
        expect(line.t).toBe(1_700_000_000_000);
    });

    test('treats the same names in a different order as unchanged', () => {
        expect(namesChanged(['b', 'a'], ['a', 'b'])).toBe(false);
        expect(namesChanged(['a'], ['a', 'b'])).toBe(true);
    });
});
