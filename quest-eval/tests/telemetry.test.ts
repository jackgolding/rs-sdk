import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  findRunDirectory,
  latestVerdicts,
  observeAttemptEvents,
  observeSession,
  parseEventLines,
  parseJsonl,
  sessionSlice,
  verdictGroups,
} from '../telemetry.ts';

const line = (session: number, t: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ t, pid: 1, session, phase: 'start', type: 'progress', message: 'x', ...extra });

describe('parseJsonl', () => {
  test('skips blank and half-written lines instead of throwing', () => {
    const text = `${line(1, 10)}\n\n{"t":11,\n${line(1, 12)}\n`;
    expect(parseJsonl(text)).toHaveLength(2);
  });

  test('rejects objects with no timestamp or type', () => {
    const text = '{"hello":"world"}\n' + line(1, 10);
    expect(parseEventLines(text)).toHaveLength(1);
  });
});

describe('sessionSlice', () => {
  const lines = parseEventLines([line(100, 1_000), line(200, 5_000), line(200, 6_000), line(300, 9_000)].join('\n'));

  test('takes the session that started at or after the attempt start', () => {
    // Only the sessions that exist at read time participate; the stale 100
    // session from an earlier attempt must not leak in.
    const during = lines.filter(l => l.t <= 6_000);
    const slice = sessionSlice(during, 4_000);
    expect(slice.session).toBe(200);
    expect(slice.lines).toHaveLength(2);
  });

  test('a later session in the same file wins — one file, many attempts', () => {
    expect(sessionSlice(lines, 8_000).session).toBe(300);
  });

  test('returns nothing when no session began after the attempt started', () => {
    const slice = sessionSlice(lines, 10_000);
    expect(slice.session).toBeNull();
    expect(slice.lines).toHaveLength(0);
  });

  test('ignores events from earlier attempts that share the file', () => {
    const slice = sessionSlice(lines, 8_000);
    expect(slice.session).toBe(300);
    expect(slice.lines.every(l => l.session === 300)).toBe(true);
  });
});

describe('observeSession', () => {
  test('reports phase order, recovery count and the stop code', () => {
    const lines = parseEventLines(
      [
        line(1, 1, { phase: 'start', type: 'start', code: 'ready' }),
        line(1, 2, { phase: 'travel', type: 'progress' }),
        line(1, 3, { phase: 'travel', type: 'recovery', tactic: 'walk-back' }),
        line(1, 4, { phase: 'travel', type: 'recovery', tactic: 'rescan' }),
        line(1, 5, { phase: 'hand-in', type: 'stop', code: 'done' }),
      ].join('\n'),
    );
    const observation = observeSession(lines);
    expect(observation.phases).toEqual(['start', 'travel', 'hand-in']);
    expect(observation.lastPhase).toBe('hand-in');
    expect(observation.recoveries).toBe(2);
    expect(observation.stopCode).toBe('done');
  });

  test('an empty slice is a null phase, not a crash', () => {
    expect(observeAttemptEvents('', Date.now()).lastPhase).toBeNull();
  });
});

describe('checkpoint evidence', () => {
  const records = [
    { checkpointId: 'unstarted', verdict: 'PASS' as const },
    { checkpointId: 'active', verdict: 'UNKNOWN' as const, reason: 'journal not open' },
    { checkpointId: 'active', verdict: 'PASS' as const },
    { checkpointId: 'complete', verdict: 'FAIL' as const, reason: 'still says I need an egg' },
  ];

  test('the latest record for a checkpoint wins', () => {
    const latest = latestVerdicts(records);
    expect(latest.get('active')?.verdict).toBe('PASS');
  });

  test('UNKNOWN and absent are both unproven; FAIL is called out separately', () => {
    const groups = verdictGroups(records, ['unstarted', 'active', 'complete', 'never-recorded']);
    expect(groups.passed).toEqual(['unstarted', 'active']);
    expect(groups.failed).toEqual(['complete']);
    expect(groups.missing).toEqual(['never-recorded']);
  });
});

describe('findRunDirectory', () => {
  test('picks the newest run whose identity matches the account and quest', () => {
    const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'quest-eval-'));
    const runs = join(root, 'runs');
    // Deterministic mtimes: directory mtime ordering is the selection rule, and
    // a test that leans on wall-clock creation order flakes on fast filesystems.
    const write = (id: string, identity: Record<string, unknown>, secondsAgo: number) => {
      const dir = join(runs, id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'run.json'), JSON.stringify(identity));
      const when = new Date(Date.now() - secondsAgo * 1_000);
      utimesSync(dir, when, when);
    };
    write('cook-old', { runId: 'cook-old', questId: 'cook', account: 'qlecookr1' }, 300);
    write('cook-new', { runId: 'cook-new', questId: 'cook', account: 'qlecookr1', requiredCheckpoints: ['complete'] }, 60);
    write('demon-new', { runId: 'demon-new', questId: 'demon', account: 'qledemonr1' }, 30);
    // Newest of all, and it must still be skipped: wrong account.
    write('other-new', { runId: 'other-new', questId: 'cook', account: 'qlecookr2' }, 1);

    const found = findRunDirectory(runs, 'qlecookr1', 'cook');
    expect(found?.runId).toBe('cook-new');
    expect(found?.requiredCheckpoints).toEqual(['complete']);
    expect(findRunDirectory(runs, 'nobody', 'cook')).toBeNull();
  });
});
