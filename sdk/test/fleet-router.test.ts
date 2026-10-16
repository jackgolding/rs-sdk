import { describe, expect, test } from 'bun:test';
import {
    attributeOutcomes,
    decide,
    emptyMemory,
    pruneMemory,
    rankOptions,
    type RouterMemory,
} from '../../.cursor/skills/wake-fleet/scripts/fleet-router';
import type { VerdictRow } from '../../.cursor/skills/wake-fleet/scripts/fleet-verdict';

const NOW = 1_800_000_000_000;

function row(over: Partial<VerdictRow> = {}): VerdictRow {
    return {
        name: 'TestBot',
        kind: 'alive-not-producing',
        check: 'no_effect',
        reason: 'no effect recorded',
        restartCommand: 'bun bots/quests/x.ts TestBot',
        owner: { pid: 100, command: 'bun bots/quests/x.ts TestBot', supervised: true, startedAt: null, legacy: false },
        drift: null,
        controllers: 1,
        stateAge: 1000,
        x: 3200,
        z: 3200,
        minutesSinceEffect: null,
        minutesSinceSnapshot: 3,
        relaunches1h: 0,
        lastExit: null,
        lastStop: null,
        xpPerHour: {},
        gpPerHour: null,
        levels: { Thieving: 99, Fishing: 50 },
        shepherd: { capped: false, cappedAt: null, actions: [] },
        paused: false,
        ...over,
    };
}

const ctx = { levels: { Thieving: 99, Fishing: 50 }, bank: new Map() };

describe('jev router priors', () => {
    test('no_shield with thieving levels proposes thieving first', () => {
        const r = row({ lastStop: { code: 'no_shield', t: NOW - 1000 } });
        const ranked = rankOptions(r, ctx, emptyMemory());
        expect(ranked[0]!.action.kind).toBe('propose-switch');
        expect(ranked[0]!.action.target).toBe('bots/quests/thieving-route.ts');
    });

    test('no_shield without thieving falls through to fishing', () => {
        const r = row({ lastStop: { code: 'no_shield', t: NOW - 1000 } });
        const low = { levels: { Thieving: 1, Fishing: 50 }, bank: new Map() };
        const ranked = rankOptions(r, low, emptyMemory());
        expect(ranked[0]!.action.kind).toBe('propose-switch');
        expect(ranked[0]!.action.target).toBe('bots/quests/fishing-route.ts');
    });

    test('no_shield with neither level parks', () => {
        const r = row({ lastStop: { code: 'no_shield', t: NOW - 1000 } });
        const low = { levels: { Thieving: 1, Fishing: 1 }, bank: new Map() };
        const ranked = rankOptions(r, low, emptyMemory());
        expect(ranked[0]!.action.kind).toBe('pause');
    });

    test('no_pickaxe prefers the supply run', () => {
        const r = row({ lastStop: { code: 'no_pickaxe', t: NOW - 1000 } });
        const ranked = rankOptions(r, ctx, emptyMemory());
        expect(ranked[0]!.action.kind).toBe('supply');
        expect(ranked[0]!.action.target).toBe('bots/quests/buy-nurmof-pick.ts');
    });

    test('no_controller restarts', () => {
        const r = row({ check: 'no_controller', reason: 'no controller attached' });
        expect(rankOptions(r, ctx, emptyMemory())[0]!.action.kind).toBe('restart');
    });
});

describe('jev router learning', () => {
    test('observed failures demote an action below its prior sibling', () => {
        const r = row({ lastStop: { code: 'no_pickaxe', t: NOW - 1000 } });
        const memory = emptyMemory();
        memory.stats['no_pickaxe::supply'] = { s: 0, f: 5 };
        const ranked = rankOptions(r, ctx, memory);
        // supply posterior: (2+0)/(3+5) = 0.25; pause posterior: (2+0)/(3+0) = 0.67
        expect(ranked[0]!.action.kind).toBe('pause');
        expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
    });

    test('observed successes promote', () => {
        const r = row({ check: 'no_effect', reason: 'idle' });
        const memory = emptyMemory();
        memory.stats['no_effect::restart'] = { s: 6, f: 1 };
        const ranked = rankOptions(r, ctx, memory);
        expect(ranked[0]!.action.kind).toBe('restart');
        expect(ranked[0]!.score).toBeCloseTo((2 + 6) / (4 + 7), 5);
    });

    test('attribution credits producing, times out stale, supersedes', () => {
        const memory: RouterMemory = {
            ...emptyMemory(),
            attempts: [
                { t: NOW - 30 * 60 * 1000, bot: 'A', key: 'no_controller', action: 'restart', resolved: null },
                { t: NOW - 10 * 60 * 1000, bot: 'B', key: 'no_controller', action: 'restart', resolved: null },
                { t: NOW - 5 * 60 * 60 * 1000, bot: 'C', key: 'no_controller', action: 'restart', resolved: null },
                { t: NOW - 60 * 60 * 1000, bot: 'D', key: 'no_controller', action: 'restart', resolved: null },
                { t: NOW - 30 * 60 * 1000, bot: 'D', key: 'no_controller', action: 'pause', resolved: null },
            ],
        };
        const rows = [
            row({ name: 'A', kind: 'producing' }),
            row({ name: 'B', kind: 'alive-not-producing' }),
            row({ name: 'C', kind: 'alive-not-producing' }),
            row({ name: 'D', kind: 'alive-not-producing' }),
        ];
        const out = attributeOutcomes(memory, rows, NOW);
        const byBot = (b: string) => out.attempts.filter((a) => a.bot === b).map((a) => a.resolved);
        expect(byBot('A')).toEqual(['success']);
        expect(byBot('B')).toEqual([null]);
        expect(byBot('C')).toEqual(['failure']);
        expect(byBot('D')).toEqual(['superseded', null]);
        expect(out.stats['no_controller::restart']).toEqual({ s: 1, f: 1 });
    });

    test('prune drops week-old attempts but keeps stats', () => {
        const memory: RouterMemory = {
            ...emptyMemory(),
            attempts: [{ t: NOW - 8 * 24 * 60 * 60 * 1000, bot: 'A', key: 'k', action: 'restart', resolved: 'success' }],
            stats: { 'k::restart': { s: 1, f: 0 } },
        };
        const out = pruneMemory(memory, NOW);
        expect(out.attempts).toEqual([]);
        expect(out.stats['k::restart']).toEqual({ s: 1, f: 0 });
    });
});

describe('jev router gates', () => {
    test('producing/finished/capped/paused are never acted on', () => {
        const memory = emptyMemory();
        for (const kind of ['producing', 'finished', 'capped', 'paused'] as const) {
            const decisions = decide([row({ name: 'X', kind })], memory, NOW);
            expect(decisions[0]!.chosen).toBeNull();
        }
    });

    test('24h action cooldown holds', () => {
        const memory: RouterMemory = {
            ...emptyMemory(),
            attempts: [
                { t: NOW - 1000, bot: 'X', key: 'k', action: 'restart', resolved: 'failure' },
                { t: NOW - 2000, bot: 'X', key: 'k', action: 'restart', resolved: 'failure' },
            ],
        };
        const decisions = decide([row({ name: 'X' })], memory, NOW);
        expect(decisions[0]!.chosen).toBeNull();
        expect(decisions[0]!.skipped).toMatch(/cooldown/);
    });

    test('open recent attempt defers a new one', () => {
        const memory: RouterMemory = {
            ...emptyMemory(),
            attempts: [{ t: NOW - 5 * 60 * 1000, bot: 'X', key: 'k', action: 'restart', resolved: null }],
        };
        const decisions = decide([row({ name: 'X' })], memory, NOW);
        expect(decisions[0]!.chosen).toBeNull();
        expect(decisions[0]!.skipped).toMatch(/awaiting outcome/);
    });

    test('repeat noise chooses nothing', () => {
        const decisions = decide([row({ name: 'X', check: 'repeat', reason: 'stunned x55' })], emptyMemory(), NOW);
        expect(decisions[0]!.chosen).toBeNull();
    });

    test('matchPriors respects reason regex', () => {
        const r = row({ check: 'supplies', reason: 'No pickaxe in bank or on character' });
        expect(rankOptions(r, ctx, emptyMemory())[0]!.action.kind).toBe('supply');
        const other = row({ check: 'supplies', reason: 'Out of lobsters' });
        expect(rankOptions(other, ctx, emptyMemory())[0]!.action.kind).toBe('pause');
    });
});
