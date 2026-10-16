import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { assignRosterScript, parseExtraArgs, scriptError, setSkipList } from './roster-edit';
import { tailFile } from './tail';

describe('roster edits', () => {
    test('rejects scripts outside bots/quests', () => {
        expect(scriptError('bots/Jackpoo1/script.ts', () => true)).toMatch(/bots\/quests/);
        expect(scriptError('bots/quests/../roster.json', () => true)).toMatch(/bots\/quests/);
        expect(scriptError('bots/quests/fishing-route.ts', () => false)).toMatch(/does not exist/);
        expect(scriptError('bots/quests/fishing-route.ts', () => true)).toBeNull();
    });

    test('parses extra flags and keeps the account name first', () => {
        expect(parseExtraArgs('  --knights  --foo=1 ')).toEqual(['--knights', '--foo=1']);
        expect(() => parseExtraArgs('--bad flag;rm')).toThrow(/Bad argument/);
        const roster = {
            bots: [{ name: 'Jackpoo1', view: 'fleet', script: 'bots/quests/thieving-route.ts', args: ['Jackpoo1', '--knights'] }],
        };
        const assigned = assignRosterScript(roster, 'jackpoo1', 'bots/quests/fishing-route.ts', '--bignet');
        expect(assigned).toEqual({ name: 'Jackpoo1', args: ['Jackpoo1', '--bignet'] });
        expect(roster.bots[0]!.script).toBe('bots/quests/fishing-route.ts');
    });

    test('skip list adds and removes one name', () => {
        const start = '# hold\nfatpig\n';
        const paused = setSkipList(start, 'Jackpoo1', true);
        expect(paused).toBe('# hold\nfatpig\nJackpoo1\n');
        expect(setSkipList(paused, 'jackpoo1', false)).toBe('# hold\nfatpig\n');
    });
});

describe('tailFile', () => {
    test('reads the end of a file without needing the head', () => {
        const dir = mkdtempSync(join(tmpdir(), 'fleet-desk-'));
        const path = join(dir, 'grind.log');
        const head = 'HEAD-MARKER should drop\n'.repeat(20_000);
        const tail = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') + '\n';
        writeFileSync(path, head + tail);
        const lines = tailFile(path, 5);
        expect(lines).toEqual(['line 25', 'line 26', 'line 27', 'line 28', 'line 29']);
        expect(lines.join('\n')).not.toContain('HEAD-MARKER');
    });
});
