import { describe, expect, test } from 'bun:test';
import { activityLabel, scriptLeaf, splitLogLine } from './activity';

describe('scriptLeaf', () => {
    test('strips dirs and extensions', () => {
        expect(scriptLeaf('bots/quests/bowstrings.ts')).toBe('bowstrings');
        expect(scriptLeaf('bots/quests/questloop.sh')).toBe('questloop');
    });
});

describe('splitLogLine', () => {
    test('drops timestamps, keeps tags', () => {
        expect(splitLogLine('[8:24 PM] [thief] bank (low food)')).toEqual({ tag: 'thief', text: 'bank (low food)' });
        expect(splitLogLine('[2026-10-16T10:00:00.000Z] fletching 12k')).toEqual({ tag: null, text: 'fletching 12k' });
        expect(splitLogLine(null)).toEqual({ tag: null, text: null });
        expect(splitLogLine('   ')).toEqual({ tag: null, text: null });
        expect(splitLogLine('2026-10-14T18:04:22.761Z WARN recovery exhausted')).toEqual({ tag: null, text: 'WARN recovery exhausted' });
    });
});

describe('activityLabel', () => {
    test('paused bots lead with Paused', () => {
        expect(activityLabel({ script: 'bots/quests/bowstrings.ts', extra: '', paused: true, lastLogLine: 'banking' }))
            .toBe('Paused · bowstrings');
    });

    test('running script plus latest log line', () => {
        expect(activityLabel({ script: 'bots/quests/thieving-route.ts', extra: '--knights', paused: false, lastLogLine: '[thief] pickpocket 41k' }))
            .toBe('thieving-route --knights · thief: pickpocket 41k');
    });

    test('no log yet means starting', () => {
        expect(activityLabel({ script: 'bots/quests/fishing-route.ts', extra: '', paused: false, lastLogLine: null }))
            .toBe('fishing-route — starting…');
    });
});
