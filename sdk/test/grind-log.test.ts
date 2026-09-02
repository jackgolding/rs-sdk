import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';
import { appendGrindLog, rotateLogFile } from '../grind-log';

describe('grind-log rotation', () => {
    test('leaves a small file alone and caps a large one to the tail', () => {
        const dir = mkdtempSync(join(tmpdir(), 'grind-log-'));
        const path = join(dir, 'grind.log');
        try {
            writeFileSync(path, 'keep-me\n');
            rotateLogFile(path, { maxBytes: 100, keepBytes: 50 });
            expect(readFileSync(path, 'utf-8')).toBe('keep-me\n');

            const lines = Array.from({ length: 40 }, (_, i) => `line-${String(i).padStart(3, '0')}`).join('\n') + '\n';
            writeFileSync(path, lines);
            rotateLogFile(path, { maxBytes: 80, keepBytes: 60 });
            const kept = readFileSync(path, 'utf-8');
            expect(kept.startsWith('line-000')).toBe(false);
            expect(kept).toContain('line-039');
            expect(Buffer.byteLength(kept) <= 80).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('appendGrindLog rotates after crossing the cap', () => {
        const dir = mkdtempSync(join(tmpdir(), 'grind-log-'));
        const path = join(dir, 'grind.log');
        try {
            writeFileSync(path, 'x'.repeat(50) + '\n');
            appendGrindLog(path, 'tail-line', { maxBytes: 40, keepBytes: 20 });
            const kept = readFileSync(path, 'utf-8');
            expect(kept).toContain('tail-line');
            expect(Buffer.byteLength(kept) <= 40).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
