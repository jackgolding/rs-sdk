import { describe, expect, test } from 'bun:test';

import { buildReport, classifyAttempt, DEFAULT_GATE, formatReport, median, percentile, resolveGate, summarizeQuest } from '../report.ts';
import type { AttemptResult, SuiteQuest } from '../types.ts';

const attempt = (overrides: Partial<AttemptResult>): AttemptResult => ({
  questId: 'cook',
  script: 'bots/quests/cooks-assistant.ts',
  fixture: 'quest-lab/fixtures/cook.json',
  account: 'qlecookr1',
  attempt: 1,
  status: 'pass',
  failureState: null,
  failureReason: null,
  durationMs: 60_000,
  recoveries: 0,
  exitCode: 0,
  timedOut: false,
  runDirectory: '/runs/cook',
  passedCheckpoints: ['unstarted', 'active', 'complete'],
  failedCheckpoints: [],
  missingCheckpoints: [],
  phases: ['start', 'travel', 'verify'],
  lastPhase: 'verify',
  notes: [],
  logPath: '/logs',
  clock: { tickRateMs: 400, source: 'server/engine/.env' },
  ...overrides,
});

describe('classifyAttempt', () => {
  const required = ['unstarted', 'active', 'complete'];

  test('a clean exit with every checkpoint PASS is a pass', () => {
    const result = classifyAttempt({
      exitCode: 0,
      timedOut: false,
      records: required.map(id => ({ checkpointId: id, verdict: 'PASS' })),
      requiredCheckpoints: required,
      lastPhase: 'verify',
    });
    expect(result.status).toBe('pass');
    expect(result.failureState).toBeNull();
  });

  test('an UNKNOWN checkpoint fails the run and names the state', () => {
    const result = classifyAttempt({
      exitCode: 0,
      timedOut: false,
      records: [
        { checkpointId: 'unstarted', verdict: 'PASS' },
        { checkpointId: 'active', verdict: 'UNKNOWN', reason: 'journal not open' },
      ],
      requiredCheckpoints: required,
      lastPhase: 'start-quest',
    });
    expect(result.status).toBe('fail');
    expect(result.failureState).toBe('checkpoint:active');
    expect(result.failureReason).toBe('journal not open');
  });

  test('a non-zero exit with no checkpoint evidence falls back to the last phase', () => {
    const result = classifyAttempt({
      exitCode: 1,
      timedOut: false,
      records: [],
      requiredCheckpoints: required,
      lastPhase: 'travel',
    });
    expect(result.status).toBe('fail');
    // Died before its first checkpoint: the phase is the truth, not a checkpoint name.
    expect(result.failureState).toBe('travel');
    expect(result.failureReason).toContain('exit');
  });

  test('a timeout reports the phase it was stuck in, not a checkpoint', () => {
    const result = classifyAttempt({
      exitCode: null,
      timedOut: true,
      records: [{ checkpointId: 'unstarted', verdict: 'PASS' }],
      requiredCheckpoints: required,
      lastPhase: 'travel',
    });
    expect(result.status).toBe('timeout');
    expect(result.failureState).toBe('travel');
    expect(result.failureReason).toContain('time budget');
  });

  test('a harness failure is never scored against the quest', () => {
    const result = classifyAttempt({
      exitCode: null,
      timedOut: false,
      harnessError: 'fixture provisioning exited 2',
      records: [],
      requiredCheckpoints: required,
      lastPhase: null,
    });
    expect(result.status).toBe('error');
    expect(result.failureState).toBe('harness');
  });
});

describe('gate arithmetic', () => {
  test('median and nearest-rank p90', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3); // 2.5 rounded: small samples stay integral ms
    expect(percentile([10, 20, 30, 40], 90)).toBe(40);
    expect(percentile([10], 90)).toBe(10);
    expect(median([])).toBe(0);
  });

  test('2 of 3 runs passes the 80% gate; 1 of 3 does not', () => {
    const twoOfThree = summarizeQuest('cook', [attempt({}), attempt({}), attempt({ status: 'fail', failureState: 'checkpoint:active' })], DEFAULT_GATE);
    expect(twoOfThree.passRate).toBeCloseTo(2 / 3);
    // 66% is below 80%, so a 2/3 run set FAILS the gate. This is the honest
    // reading: with three samples a flaky quest cannot be called passing.
    expect(twoOfThree.gate.ok).toBe(false);

    const fourOfFive = summarizeQuest('cook', Array.from({ length: 5 }, (_, i) => attempt({ attempt: i + 1, status: i === 0 ? 'fail' : 'pass' })), DEFAULT_GATE);
    expect(fourOfFive.passRate).toBeCloseTo(0.8);
    expect(fourOfFive.gate.ok).toBe(true);
  });

  test('too few runs fails the gate even at 100%', () => {
    const summary = summarizeQuest('cook', [attempt({})], DEFAULT_GATE);
    expect(summary.gate.ok).toBe(false);
    expect(summary.gate.reasons.join(' ')).toContain('needs 3');
  });

  test('harness errors are called out separately from quest failures', () => {
    const summary = summarizeQuest('cook', [attempt({}), attempt({}), attempt({ status: 'error', failureState: 'harness' })], DEFAULT_GATE);
    expect(summary.gate.reasons.join(' ')).toContain('harness');
  });

  test('gate defaults and overrides are validated', () => {
    expect(resolveGate(undefined)).toEqual(DEFAULT_GATE);
    expect(resolveGate({ gate: { minPassRate: 0.5 } })).toEqual({ minPassRate: 0.5, minRuns: 3 });
    expect(() => resolveGate(undefined, { minPassRate: 2 })).toThrow();
    expect(() => resolveGate(undefined, { minRuns: 0 })).toThrow();
  });
});

describe('buildReport', () => {
  const quests: SuiteQuest[] = [{ questId: 'cook', script: 'a.ts', fixture: 'a.json' }];

  test('one failing quest fails the suite', () => {
    const report = buildReport(
      'smoke',
      quests,
      [attempt({}), attempt({}), attempt({ status: 'fail', failureState: 'checkpoint:active' }), attempt({ questId: 'cook', attempt: 4, status: 'pass' })],
      DEFAULT_GATE,
      new Date(0),
      new Date(1_000),
    );
    // 3 of 4 is 75%: below the suite gate, and the quest summary agrees.
    expect(report.ok).toBe(false);
    expect(report.reasons.length).toBeGreaterThan(0);
  });

  test('a clean suite reports medians from passing runs only and formats a table', () => {
    const report = buildReport(
      'smoke',
      quests,
      [attempt({ attempt: 1, durationMs: 60_000 }), attempt({ attempt: 2, durationMs: 90_000 }), attempt({ attempt: 3, durationMs: 120_000, recoveries: 3 })],
      DEFAULT_GATE,
      new Date(0),
      new Date(1_000),
    );
    expect(report.ok).toBe(true);
    expect(report.totals.medianMs).toBe(90_000);
    expect(report.quests[0]!.meanRecoveries).toBe(1);
    const table = formatReport(report);
    expect(table).toContain('cook');
    expect(table).toContain('100%');
    expect(table).toContain('gate:');
  });

  test('an empty run set is a failure, not a vacuous pass', () => {
    const report = buildReport('smoke', quests, [], DEFAULT_GATE, new Date(0), new Date(1));
    expect(report.ok).toBe(false);
    expect(report.reasons.join(' ')).toContain('no attempts');
  });
});
