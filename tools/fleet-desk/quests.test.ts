import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { accountRow, questColumns, questsPayload } from './quests';

const NOW = Date.parse('2026-10-29T06:00:00.000Z');
const at = (iso: string) => `2026-10-29T${iso}.000Z`;

describe('accountRow', () => {
    const items = ['doric', 'gobdip', 'imp', 'ball', 'death', 'hunt'].map((questId) => ({ questId }));
    const state = {
        doric: { done: { at: at('01:00:00') } },
        gobdip: { failures: 2, lastError: 'exited 1', lastAt: at('05:30:00') },
        imp: { failures: 1, lastError: 'exited 1', lastAt: at('05:40:00') },
        death: { failures: 1, lastError: 'exited 4', lastAt: at('05:45:00') },
    };
    const log = [
        `${at('01:00:00')} [doric] QUEST COMPLETE (journal-verified)`,
        `${at('05:50:00')} todo-runner: === ball ===`,
        `${at('05:55:00')} [ball] goTo (2901,3473) from (2902,3469): 16t`,
    ];

    test('each state from todo-state + the log tail', () => {
        const { row, completions } = accountRow('ABGARMY08', items, state, log, NOW);
        expect(row.cells.doric!.state).toBe('done');
        expect(row.cells.gobdip!.state).toBe('failed');
        expect(row.cells.imp!.state).toBe('retrying');
        expect(row.cells.death!.state).toBe('stock');
        expect(row.cells.ball!.state).toBe('running');
        expect(row.cells.hunt!.state).toBe('queued');
        expect(row.running).toBe('ball');
        expect(completions).toEqual([{ at: Date.parse(at('01:00:00')), questId: 'doric', account: 'ABGARMY08' }]);
    });

    test('an old quest line is not running; a completed one is not either', () => {
        const stale = accountRow('a', items, {}, [`${at('05:00:00')} [ball] goTo`], NOW).row;
        expect(stale.running).toBeNull();
        const finished = accountRow('a', items, {}, [`${at('05:59:00')} [ball] QUEST COMPLETE (journal-verified)`], NOW).row;
        expect(finished.running).toBeNull();
    });

    test('a grind tag that is not on the list is not a quest', () => {
        expect(accountRow('a', items, {}, [`${at('05:59:00')} [thief] bank`], NOW).row.running).toBeNull();
    });
});

describe('questColumns', () => {
    test('most-listed first, with done counts', () => {
        const rows = [
            { name: 'a', running: null, cells: { doric: { state: 'done' as const }, imp: { state: 'queued' as const } } },
            { name: 'b', running: null, cells: { doric: { state: 'queued' as const } } },
        ];
        expect(questColumns(rows)).toEqual([
            { id: 'doric', label: "Doric's Quest", done: 1, listed: 2 },
            { id: 'imp', label: 'Imp Catcher', done: 0, listed: 1 },
        ]);
    });
});

describe('questsPayload', () => {
    test('reads todo.json, todo-state.json and grind.log under the bots dir', () => {
        const dir = mkdtempSync(join(tmpdir(), 'desk-quests-'));
        writeFileSync(join(dir, 'todo.json'), JSON.stringify({ accounts: { jacklove2: [{ questId: 'romeojuliet', done: { at: at('03:00:00') } }, { questId: 'demon' }] } }));
        mkdirSync(join(dir, 'jacklove2'));
        writeFileSync(join(dir, 'jacklove2', 'todo-state.json'), '{}');
        writeFileSync(
            join(dir, 'jacklove2', 'grind.log'),
            [`${at('03:00:00')} [romeojuliet] QUEST COMPLETE (journal-verified)`, `${at('05:30:00')} [romeojuliet] QUEST COMPLETE (journal-verified)`].join('\n')
        );
        const p = questsPayload(dir, Date.parse(at('02:00:00')), NOW);
        expect(p.rows.map((r) => r.name)).toEqual(['jacklove2']);
        expect(p.goal.completedSince).toBe(2);
        expect(p.goal.completedLastHour).toBe(1);
        expect(p.goal.queued).toBe(1);
        expect(p.goal.perHour).toEqual([
            { hour: at('03:00:00'), count: 1 },
            { hour: at('05:00:00'), count: 1 },
        ]);
    });

    test('no todo.json is an empty tab, not an error', () => {
        const p = questsPayload(mkdtempSync(join(tmpdir(), 'desk-quests-')), 0, NOW);
        expect(p.rows).toEqual([]);
        expect(p.columns).toEqual([]);
    });
});
