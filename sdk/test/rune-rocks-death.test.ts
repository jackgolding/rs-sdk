import { describe, expect, test } from 'bun:test';

/** Decision helpers mirrored from rune-rocks death handling. */
function shouldStopForDeathCap(deaths: number, max: number): boolean {
    return deaths >= max;
}

function shouldStopCannotRegear(hasKit: boolean): boolean {
    return !hasKit;
}

describe('rune-rocks death branches', () => {
    test('death cap triggers at 3 deaths', () => {
        expect(shouldStopForDeathCap(2, 3)).toBe(false);
        expect(shouldStopForDeathCap(3, 3)).toBe(true);
    });

    test('cannot regear when bank kit missing', () => {
        expect(shouldStopCannotRegear(false)).toBe(true);
        expect(shouldStopCannotRegear(true)).toBe(false);
    });
});
