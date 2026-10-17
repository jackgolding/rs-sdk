import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const modulePath = resolve(import.meta.dir, '../evidence.ts');
const journal = { label: 'Druidic Ritual', interfaceId: 8134, title: 'Druidic Ritual' };
const observed = {
  inGame: true, isOpen: true, interfaceId: 8134, revision: 12, stateAgeMs: 10,
  textComponents: [
    { componentId: 2, type: 4, rawText: 'Druidic Ritual', text: 'Druidic Ritual' },
    { componentId: 3, type: 4, rawText: '@red@QUEST COMPLETE!', text: 'QUEST COMPLETE!' },
  ],
};

describe('quest journal button targeting', () => {
  test('resolves the quest button by its visible label, tolerating case and spacing', async () => {
    const { findJournalButton } = await import(modulePath);
    const options = [
      { componentId: 7351, text: 'Demon Slayer' },
      { componentId: 7355, text: "Druidic Ritual" },
      { componentId: 7367, text: 'Lost City' },
    ];
    expect(findJournalButton(options, 'Druidic Ritual')).toBe(7355);
    expect(findJournalButton(options, '  druidic ritual ')).toBe(7355);
    expect(findJournalButton(options, 'Lost City')).toBe(7367);
  });

  test('refuses to guess: absent, ambiguous or blank labels resolve to null', async () => {
    const { findJournalButton } = await import(modulePath);
    const options = [
      { componentId: 7355, text: 'Druidic Ritual' },
      { componentId: 7356, text: 'Druidic Ritual' },
      { componentId: 7357, text: 'Druidic Ritual (members)' },
    ];
    expect(findJournalButton(options, 'Druidic Ritual')).toBeNull(); // duplicated -> ambiguous
    expect(findJournalButton(options, 'Missing Quest')).toBeNull();
    expect(findJournalButton(options, '   ')).toBeNull();
    expect(findJournalButton([], 'Druidic Ritual')).toBeNull();
  });
});

describe('journal predicates read emphasis from raw text', () => {
  // The Cook's Assistant journal states the same ingredient differently by state:
  //   "@str@I have an egg with me|"                 (have it, struck through)
  //   "@dbl@an @dre@egg|"                            (still needed)
  // Normalising deletes that distinction entirely.
  // Must carry Cook's Assistant's OWN journal heading, not Druidic Ritual's:
  // evaluateJournal rejects a wrong-quest journal before any predicate runs.
  const cookJournal = { label: "Cook's Assistant", interfaceId: 8134, title: "The Cook's Quest" };
  const withEgg = { ...observed, textComponents: [
    { componentId: 1, type: 4, rawText: "@dre@The Cook's Quest", text: "The Cook's Quest" },
    { componentId: 2, type: 4, rawText: '@str@I have an egg with me|', text: 'I have an egg with me|' },
  ] };
  const needsEgg = { ...observed, textComponents: [
    { componentId: 1, type: 4, rawText: "@dre@The Cook's Quest", text: "The Cook's Quest" },
    { componentId: 2, type: 4, rawText: '@dbl@an @dre@egg|', text: 'an egg|' },
  ] };

  test('a raw predicate distinguishes have-it from need-it', async () => {
    const { evaluateJournal } = await import(modulePath);
    const rule = { id: 'egg', kind: 'active' as const, all: [], rawAll: ['@str@I have an egg'] };
    expect(evaluateJournal(cookJournal, rule, withEgg, 11).verdict).toBe('PASS');
    expect(evaluateJournal(cookJournal, rule, needsEgg, 11).verdict).toBe('FAIL');
  });

  test('the same ingested state would be invisible to a prose-only predicate', async () => {
    const { evaluateJournal } = await import(modulePath);
    // Prose-only rule cannot separate the two states -> both pass, which is why
    // rawAll exists.
    const proseOnly = { id: 'egg-prose', kind: 'active' as const, all: ['egg'] };
    expect(evaluateJournal(cookJournal, proseOnly, withEgg, 11).verdict).toBe('PASS');
    expect(evaluateJournal(cookJournal, proseOnly, needsEgg, 11).verdict).toBe('PASS');
  });

  test('rawNone rejects the outstanding form and an invalid raw pattern is UNKNOWN', async () => {
    const { evaluateJournal } = await import(modulePath);
    const rule = { id: 'egg-out', kind: 'active' as const, all: [], rawNone: ['@dbl@an @dre@egg'] };
    expect(evaluateJournal(cookJournal, rule, withEgg, 11).verdict).toBe('PASS');
    expect(evaluateJournal(cookJournal, rule, needsEgg, 11).verdict).toBe('FAIL');
    const bad = { id: 'bad', kind: 'active' as const, all: [], rawAll: ['['] };
    expect(evaluateJournal(cookJournal, bad, withEgg, 11).verdict).toBe('UNKNOWN');
  });
});

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
