import { describe, expect, test } from 'bun:test';
import { blockedBy, classifyExit, LEGENDS_PATH, onLegendsPath, parseShort, stockArrived, waitMinutes } from './todo-logic';

const item = (questId: string, script: string, after?: string[]) => ({ questId, script: `bots/quests/${script}.ts`, ...(after ? { after } : {}) });

describe('classifyExit', () => {
    test('a journal-verified finish is done without any run record', () => {
        expect(classifyExit(0, 'x\nQUEST COMPLETE (journal-verified)\ny')).toEqual({ kind: 'done', how: 'journal' });
    });
    test('task and already-complete lines are done', () => {
        expect(classifyExit(0, 'legends-stock: already complete').kind).toBe('done');
        expect(classifyExit(0, 'TASK DONE top-up').kind).toBe('done');
    });
    test('exit 0 with no evidence goes to the run record', () => {
        expect(classifyExit(0, 'bye')).toEqual({ kind: 'grade' });
    });
    test('stock and prerequisite stops are not failures', () => {
        expect(classifyExit(4, 'NEEDS STOCK: opal ×1, rune axe ×2 — stock the account from the mule before this quest')).toEqual({
            kind: 'stock',
            short: [{ item: 'opal', count: 1 }, { item: 'rune axe', count: 2 }],
        });
        expect(classifyExit(5, 'prerequisite gate: Dragon Slayer not complete')).toEqual({ kind: 'prereq', missing: 'Dragon Slayer not complete' });
        expect(classifyExit(5, 'skill gate: account cannot do this quest yet (needs magic 59)')).toEqual({ kind: 'prereq', missing: 'account cannot do this quest yet (needs magic 59)' });
    });
    test('a lost game client is an outage, not a failure', () => {
        expect(classifyExit(6, 'game client outage outlasted the retries')).toEqual({ kind: 'outage' });
    });
    test('slots full defers; a crash fails', () => {
        expect(classifyExit(75, '').kind).toBe('deferred');
        expect(classifyExit(1, 'QUEST COMPLETE (journal-verified)')).toEqual({ kind: 'fail', why: 'exited 1' });
    });
});

test('parseShort reads the last line and names with spaces and brackets', () => {
    expect(parseShort('NEEDS STOCK: opal ×1 — a\nNEEDS STOCK: prayer potion(3) ×4 — b')).toEqual([{ item: 'prayer potion(3)', count: 4 }]);
});

describe('blockedBy', () => {
    const notDone = () => false;
    test('Heroes waits on a failed Dragon Slayer under any todo id', () => {
        const q = [item('dragon-r2', 'dragon'), item('heroes', 'heroes-quest')];
        expect(blockedBy(q[1]!, q, notDone)).toBe('dragon-r2');
    });
    test('a repeated id counts as done when any copy is', () => {
        const q = [item('upass', 'underground-pass'), item('upass-r2', 'underground-pass'), item('legends', 'legends-quest')];
        expect(blockedBy(q[2]!, q, (i) => i.questId === 'upass-r2')).toBeUndefined();
    });
    test('a prerequisite off the list does not block', () => {
        const q = [item('heroes', 'heroes-quest')];
        expect(blockedBy(q[0]!, q, notDone)).toBeUndefined();
    });
    test("an item's own after wins", () => {
        const q = [item('dragon', 'dragon'), item('x', 'other'), item('heroes', 'heroes-quest', ['x'])];
        expect(blockedBy(q[2]!, q, notDone)).toBe('x');
    });
});

test('the Legends path is the whole chain', () => {
    for (const s of ['legends-quest', 'heroes-quest', 'dragon', 'lost-city', 'shield-of-arrav', 'merlins-crystal', 'crest', 'shilo-village', 'jungle-potion', 'underground-pass', 'biohazard', 'plague-city', 'waterfall']) {
        expect(LEGENDS_PATH.has(s)).toBe(true);
    }
    expect(onLegendsPath(item('cook', 'cooks-assistant'))).toBe(false);
    expect(onLegendsPath(item('upass-r2', 'underground-pass'))).toBe(true);
});

test('waits grow and cap', () => {
    expect([1, 2, 3, 4, 5, 9].map(waitMinutes)).toEqual([30, 60, 120, 240, 240, 240]);
});

test('stock has arrived only when one fresh mule holds every line', () => {
    const s = [{ at: 1, items: { opal: 2, papyrus: 0 } }, { at: 1, items: { papyrus: 5 } }];
    expect(stockArrived([{ item: 'Opal', count: 2 }], s)).toBe(true);
    expect(stockArrived([{ item: 'opal', count: 3 }], s)).toBe(false);
    expect(stockArrived([{ item: 'opal', count: 1 }, { item: 'papyrus', count: 1 }], s)).toBe(false);
    expect(stockArrived([], s)).toBe(false);
});
