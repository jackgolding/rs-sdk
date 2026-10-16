import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    isOwnerLive,
    readOwnership,
    recordOwnership,
    resolveOwner,
    type OwnershipRecord,
} from '../assignment';

const LEGACY = join(import.meta.dir, 'fixtures/telemetry/assignment-legacy.json');

function legacyRecord(): OwnershipRecord {
    return JSON.parse(readFileSync(LEGACY, 'utf-8')) as OwnershipRecord;
}

describe('ownership records', () => {
    test('recordOwnership writes pid, argv, command, startedAt, and source connect', () => {
        const root = mkdtempSync(join(tmpdir(), 'own-'));
        mkdirSync(join(root, 'bots', 'OwnerBot'), { recursive: true });
        try {
            recordOwnership('OwnerBot', {
                root,
                pid: 4242,
                argv: ['bots/quests/fishing-route.ts', 'OwnerBot'],
                now: () => '2026-10-04T12:00:00.000Z',
            });
            const record = readOwnership('OwnerBot', { root });
            expect(record).toEqual({
                name: 'OwnerBot',
                pid: 4242,
                argv: ['bots/quests/fishing-route.ts', 'OwnerBot'],
                command: 'bun bots/quests/fishing-route.ts OwnerBot',
                startedAt: '2026-10-04T12:00:00.000Z',
                source: 'connect',
            });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('recordOwnership is a no-op when bots/{name}/ is missing', () => {
        const root = mkdtempSync(join(tmpdir(), 'own-'));
        try {
            expect(() => recordOwnership('MissingBot', { root, pid: 1, argv: ['bots/quests/fishing-route.ts'] })).not.toThrow();
            expect(readOwnership('MissingBot', { root })).toBeNull();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('a legacy fixture record without a pid is never live', () => {
        const record = legacyRecord();
        expect(record.pid).toBeUndefined();
        expect(record.source).toBe('observed');
        expect(record.argv).toContain('--except');
        expect(
            isOwnerLive(record, {
                kill: () => {},
                ps: () => 'bun bots/quests/converge-and-accept-trade.ts --accept-only --except jacklove4',
            })
        ).toBe(false);
    });

    test('pid reuse: a live pid whose command lacks argv[0] is not the owner', () => {
        const record: OwnershipRecord = {
            name: 'Jackpoo1',
            pid: 36569,
            argv: ['bots/quests/magic-trees.ts', 'Jackpoo1'],
            command: 'bun bots/quests/magic-trees.ts Jackpoo1',
            source: 'connect',
        };
        expect(
            isOwnerLive(record, {
                kill: () => {},
                ps: () => 'bun bots/quests/fishing-route.ts Jackpoo1',
            })
        ).toBe(false);
        expect(
            isOwnerLive(record, {
                kill: () => {
                    throw new Error('ESRCH');
                },
                ps: () => 'bun bots/quests/magic-trees.ts Jackpoo1',
            })
        ).toBe(false);
        expect(
            isOwnerLive(record, {
                kill: () => {},
                ps: () => '/usr/local/bin/bun bots/quests/magic-trees.ts Jackpoo1',
            })
        ).toBe(true);
    });

    test('a bot named only in another process --except argv is never resolved as owned', () => {
        const root = mkdtempSync(join(tmpdir(), 'own-'));
        mkdirSync(join(root, 'bots', 'jacklove4'), { recursive: true });
        try {
            const record = legacyRecord();
            expect(record.argv.join(' ')).toContain('--except jacklove4');
            expect(resolveOwner('jacklove4', { loaded: false }, { root })).toBeNull();
            expect(
                resolveOwner('jacklove4', { loaded: true, pid: 9, programArgs: ['/usr/local/bin/bun', 'bots/quests/fishing-route.ts', 'jacklove4'] }, { root })
            ).toMatchObject({ pid: 9, legacy: true, supervised: true });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
