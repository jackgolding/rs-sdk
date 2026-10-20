import { describe, expect, test } from 'bun:test';

import { formatAuthorship, formatUsd, parseLedger, priceTokens, summarizeAuthorship } from '../authoring.ts';
import type { AuthorshipEntry } from '../authoring.ts';

const entry = (overrides: Partial<AuthorshipEntry>): AuthorshipEntry => ({
  schemaVersion: 1,
  questId: 'cook',
  script: 'bots/quests/cooks-assistant.ts',
  scriptHash: 'abc',
  model: 'model-a',
  inputTokens: 100_000,
  outputTokens: 10_000,
  costUsd: 0.5,
  source: 'session-import',
  recordedAt: '2026-10-20T00:00:00.000Z',
  ...overrides,
});

describe('priceTokens', () => {
  test('applies per-million rates', () => {
    expect(priceTokens(1_000_000, 1_000_000, { inputPerMillion: 3, outputPerMillion: 15 })).toBe(18);
    expect(priceTokens(500_000, 0, { inputPerMillion: 3, outputPerMillion: 15 })).toBe(1.5);
  });

  test('no rate card means unknown, not free', () => {
    expect(priceTokens(1_000, 1_000, undefined)).toBeNull();
  });

  test('negative or non-finite token counts cannot produce a negative bill', () => {
    expect(priceTokens(-5_000, Number.NaN, { inputPerMillion: 10, outputPerMillion: 10 })).toBe(0);
  });
});

describe('parseLedger', () => {
  test('keeps valid entries and survives torn or foreign lines', () => {
    const text = [
      JSON.stringify(entry({})),
      '',
      '{"schemaVersion":2,"questId":"x","model":"y"}',
      '{"partial":',
      JSON.stringify(entry({ questId: 'demon', model: 'model-b' })),
    ].join('\n');
    const entries = parseLedger(text);
    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.questId)).toEqual(['cook', 'demon']);
  });
});

describe('summarizeAuthorship', () => {
  test('counts every draft in spend and divides only by passing scripts', () => {
    const entries = [
      // Two failed drafts on `demon`, then one that passed: all three count.
      entry({ model: 'model-a', questId: 'demon', draft: 1, costUsd: 0.4 }),
      entry({ model: 'model-a', questId: 'demon', draft: 2, costUsd: 0.3 }),
      entry({ model: 'model-a', questId: 'demon', draft: 3, costUsd: 0.3 }),
      entry({ model: 'model-a', questId: 'cook', costUsd: 0.2 }),
    ];
    const [summary] = summarizeAuthorship(entries, ['demon']);
    expect(summary!.quests).toEqual(['cook', 'demon']);
    expect(summary!.passingQuests).toEqual(['demon']);
    expect(summary!.spendUsd).toBeCloseTo(1.2);
    expect(summary!.costPerPassingScriptUsd).toBeCloseTo(1.2);
    expect(summary!.drafts).toBe(4);
    expect(summary!.passRate).toBe(0.5);
  });

  test('nothing passing reports null, never $0.00', () => {
    const [summary] = summarizeAuthorship([entry({ costUsd: 2 })], []);
    expect(summary!.costPerPassingScriptUsd).toBeNull();
    expect(formatUsd(summary!.costPerPassingScriptUsd)).toBe('—');
  });

  test('models are ranked by cost per passing script, empty ones last', () => {
    const entries = [
      entry({ model: 'expensive', questId: 'cook', costUsd: 3 }),
      entry({ model: 'cheap', questId: 'cook', costUsd: 0.3 }),
      entry({ model: 'failed-only', questId: 'demon', costUsd: 1 }),
    ];
    const summaries = summarizeAuthorship(entries, ['cook']);
    expect(summaries.map(s => s.model)).toEqual(['cheap', 'expensive', 'failed-only']);
    expect(summaries[0]!.costPerPassingScriptUsd).toBeCloseTo(0.3);
    expect(summaries[2]!.costPerPassingScriptUsd).toBeNull();
  });
  test('unpriced entries are flagged so the number reads as a lower bound', () => {
    const [summary] = summarizeAuthorship([entry({ costUsd: 0.5 }), entry({ questId: 'demon', costUsd: 0, unpriced: true })], ['cook', 'demon']);
    expect(summary!.unpriced).toBe(true);
    expect(formatAuthorship([summary!])).toContain('unpriced');
  });

  test('the table shows spend and cost per passing script', () => {
    const summaries = summarizeAuthorship([entry({ costUsd: 0.3 })], ['cook']);
    const table = formatAuthorship(summaries);
    expect(table).toContain('model-a');
    expect(table).toContain('$0.30');
    expect(table).toContain('100%');
  });

  test('an empty ledger says how to start one instead of printing nothing', () => {
    expect(formatAuthorship([])).toContain('author.ts record');
  });
});
