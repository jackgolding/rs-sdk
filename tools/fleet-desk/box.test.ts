import { expect, test } from 'bun:test';
import { countDrops, parseMeminfo } from './box';

test('parseMeminfo reads kB lines as MB', () => {
    const m = parseMeminfo('MemTotal:       15982592 kB\nMemAvailable:    1371136 kB\nSwapTotal: 12582908 kB\nSwapFree: 10340352 kB\n');
    expect(m.MemTotal).toBe(15608);
    expect(m.MemAvailable).toBe(1339);
    expect(m.SwapTotal! - m.SwapFree!).toBe(2190);
});

test('countDrops counts only recent controller-down lines', () => {
    const now = Date.parse('2026-11-02T04:00:00.000Z');
    const tail = [
        '2026-11-02T02:30:00.000Z WARN controller down: SDK controller disconnected — waiting 600s before relaunch',
        '2026-11-02T03:30:00.000Z WARN controller down: SDK state 4427s stale — waiting 600s before relaunch',
        '2026-11-02T03:31:00.000Z LOG Banked 0',
        '2026-11-02T03:59:00.000Z WARN controller down: SDK controller disconnected',
    ].join('\n');
    expect(countDrops(tail, now - 3_600_000)).toBe(2);
});
