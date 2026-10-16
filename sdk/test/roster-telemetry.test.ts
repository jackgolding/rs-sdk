import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('roster scripts record snapshots', () => {
    test('every distinct roster script constructs ActivitySession with grindLogPath', () => {
        const roster = JSON.parse(readFileSync(join(import.meta.dir, '../../bots/roster.json'), 'utf-8')) as {
            bots: { script: string }[];
        };
        const scripts = [...new Set(roster.bots.map((bot) => bot.script))];
        expect(scripts.length).toBeGreaterThan(0);
        for (const script of scripts) {
            const source = readFileSync(join(import.meta.dir, '../..', script), 'utf-8');
            expect(source, script).toContain('new ActivitySession(');
            expect(source, script).toContain('grindLogPath');
        }
    });
});
