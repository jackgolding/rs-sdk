import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('prepareMulesFor', () => {
    test('asks jackthief for an unnamed source it holds, not mid-run, not itself, not on a stale snapshot', async () => {
        const root = mkdtempSync(join(tmpdir(), 'mule-'));
        mkdirSync(join(root, 'bots', '.mule-stock'), { recursive: true });
        const write = (at: number) => writeFileSync(join(root, 'bots', '.mule-stock', 'jackthief.json'), JSON.stringify({ at, items: { 'snape grass': 1055 } }));
        write(Date.now());
        const cwd = process.cwd();
        process.chdir(root);
        try {
            const { mulesFor, prepareMulesFor } = await import('./sources');
            expect(prepareMulesFor('snape grass')).toEqual(['jackthief']);
            expect(mulesFor('snape grass')).toEqual([]); // mid-run lookups unchanged
            expect(prepareMulesFor('dwellberries')).toEqual([]); // not held
            expect(prepareMulesFor('knife')).toEqual(['jackthief']); // a named mule still wins
        } finally {
            process.chdir(cwd);
        }
    });
});
