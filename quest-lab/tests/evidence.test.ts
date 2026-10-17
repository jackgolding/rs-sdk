import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const modulePath = resolve(import.meta.dir, '../evidence.ts');
const journal = { buttonId: 1, interfaceId: 8134, title: 'Druidic Ritual' };
const observed = {
  inGame: true, isOpen: true, interfaceId: 8134, revision: 12, stateAgeMs: 10,
  textComponents: [
    { componentId: 2, type: 4, rawText: 'Druidic Ritual', text: 'Druidic Ritual' },
    { componentId: 3, type: 4, rawText: '@red@QUEST COMPLETE!', text: 'QUEST COMPLETE!' },
  ],
};

describe('quest journal evidence', () => {
  test('maxed XP never substitutes for the requested quest stage', async () => {
    const { evaluateJournal } = await import(modulePath);
    const fresh = { ...observed, herbloreXp: 9984580, textComponents: [observed.textComponents[0], { componentId: 3, type: 4, rawText: 'I can start this quest by speaking to Kaqemeex', text: 'I can start this quest by speaking to Kaqemeex' }] };
    expect(evaluateJournal(journal, { id: 'complete', kind: 'complete', all: ['QUEST COMPLETE!'] }, fresh, 11).verdict).toBe('FAIL');
    expect(evaluateJournal(journal, { id: 'start', kind: 'unstarted', all: ['I can start this quest'] }, observed, 11).verdict).toBe('FAIL');
    expect(evaluateJournal(journal, { id: 'empty', kind: 'complete', all: [] }, observed, 11).verdict).toBe('UNKNOWN');
    expect(evaluateJournal(journal, { id: 'invalid', kind: 'active', all: ['['] }, observed, 11).verdict).toBe('UNKNOWN');
  });
  test('rejects stale, disconnected, missing or wrong-quest observations as UNKNOWN', async () => {
    const { evaluateJournal } = await import(modulePath);
    const rule = { id: 'complete', kind: 'complete', all: ['QUEST COMPLETE!'] };
    for (const changed of [
      { revision: 11 }, { revision: NaN }, { stateAgeMs: 6000 }, { stateAgeMs: -1 },
      { inGame: false }, { isOpen: false }, { interfaceId: 999 },
      { textComponents: undefined }, { textComponents: [] },
      { textComponents: observed.textComponents.slice(1) },
    ]) {
      expect(evaluateJournal(journal, rule, { ...observed, ...changed }, 11).verdict).toBe('UNKNOWN');
    }
  });
  test('accepts a fresh explicitly completed journal belonging to the target quest', async () => {
    expect(existsSync(modulePath)).toBe(true);
    const { evaluateJournal } = await import(modulePath);
    expect(evaluateJournal(journal, { id: 'complete', kind: 'complete', all: ['QUEST COMPLETE!'] }, observed, 11).verdict).toBe('PASS');
  });
});
