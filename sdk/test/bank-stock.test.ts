import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendHourlyBankStock, computeStockCheck } from '../bank-stock';
import { readJsonlTail } from '../grind-log';
import { hourStartMs } from '../job-key';

describe('bank stock', () => {
    test('the first line in an hour sticks and the next hour appends', () => {
        const root = mkdtempSync(join(tmpdir(), 'stock-'));
        const hourOf = (t: number) => (t < 2_000 ? '2026-10-05T14' : '2026-10-05T15');
        const items = [{ id: 1, name: 'Raw shark', count: 10 }];
        expect(appendHourlyBankStock('Ada', items, 1_000, { root, hourOf })).toBe(true);
        expect(appendHourlyBankStock('Ada', [{ id: 1, name: 'Raw shark', count: 99 }], 1_500, { root, hourOf })).toBe(false);
        expect(appendHourlyBankStock('Ada', [{ id: 1, name: 'Raw shark', count: 40 }], 2_000, { root, hourOf })).toBe(true);
        const lines = readJsonlTail<{ hour: string; items: { count: number }[] }>(
            join(root, 'bots', 'Ada', 'bank-stock.log')
        );
        expect(lines.map((line) => line.hour)).toEqual(['2026-10-05T14', '2026-10-05T15']);
        expect(lines[0]!.items[0]!.count).toBe(10);
    });

    test('sharks traded to a mule stay in the fleet total next to the gatherer gain', () => {
        const from = hourStartMs('2026-10-05T14');
        const check = computeStockCheck(
            [
                {
                    name: 'Fisher',
                    lines: [
                        { t: from, hour: '2026-10-05T14', items: [{ id: 1, name: 'Raw shark', count: 0 }] },
                        { t: from + 3_600_000, hour: '2026-10-05T15', items: [{ id: 1, name: 'Raw shark', count: 0 }] },
                    ],
                },
                {
                    name: 'Mule',
                    lines: [
                        { t: from, hour: '2026-10-05T14', items: [{ id: 1, name: 'Raw shark', count: 0 }] },
                        { t: from + 3_600_000, hour: '2026-10-05T15', items: [{ id: 1, name: 'Raw shark', count: 100 }] },
                    ],
                },
            ],
            [{ t: from + 1_800_000, item: 'Raw shark', count: 100 }],
            'raw shark',
            '2026-10-05T14',
            '2026-10-05T15'
        );
        expect(check.stockDelta).toBe(100);
        expect(check.gains).toBe(100);
        expect(check.gap).toBe(0);
        expect(check.accounts.sort()).toEqual(['Fisher', 'Mule']);
    });
});
