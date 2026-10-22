import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendBankOpen, bankOpenLogPath } from '../bank-open-log';

describe('bank open log', () => {
    test('every open appends a full-dump line', () => {
        const root = mkdtempSync(join(tmpdir(), 'bankopens-'));
        const items = [{ id: 1, name: 'Raw shark', count: 10 }];
        expect(appendBankOpen('Ada', items, 1_000, { root })).toBe(true);
        expect(appendBankOpen('Ada', [{ id: 1, name: 'Raw shark', count: 11 }], 1_500, { root })).toBe(true);
        const lines = readFileSync(bankOpenLogPath('Ada', root), 'utf-8').trim().split('\n');
        expect(lines.length).toBe(2);
        expect(JSON.parse(lines[0]!).items[0].count).toBe(10);
        expect(JSON.parse(lines[1]!).items[0].count).toBe(11);
    });

    test('empty bank and missing name write nothing', () => {
        const root = mkdtempSync(join(tmpdir(), 'bankopens-'));
        expect(appendBankOpen('Ada', [], 1_000, { root })).toBe(false);
        expect(appendBankOpen('', [{ id: 1, name: 'Coins', count: 5 }], 1_000, { root })).toBe(false);
    });
});
