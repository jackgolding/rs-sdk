import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gradeRun } from '../canary';

const line = (checkpointId: string, verdict: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ observedAt: new Date().toISOString(), checkpointId, verdict, reason: 'journal predicate satisfied', kind: 'active', rawLines: [], ...extra });

function run(required: string[], checkpoints: string[], runFile: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'canary-'));
  writeFileSync(
    join(dir, 'run.json'),
    JSON.stringify({
      runId: 'viking-c1-2026',
      questId: 'viking',
      account: 'canary1',
      mode: 'canary',
      scriptHash: 'abc',
      requiredCheckpoints: required,
      ...runFile,
    }),
  );
  writeFileSync(join(dir, 'checkpoints.jsonl'), `${checkpoints.join('\n')}\n`);
  return dir;
}

const completeLine = (text = 'QUEST COMPLETE!') =>
  line('complete', 'PASS', { kind: 'complete', rawLines: [{ componentId: 1, rawText: `@red@${text}`, text }] });

test('a full PASS run grades PASS', () => {
  const dir = run(['started', 'complete'], [line('started', 'PASS'), completeLine()]);
  const result = gradeRun(dir);
  expect(result.verdict).toBe('PASS');
  expect(result.detail.passed).toBe(2);
  expect(result.detail.completionLine).toBe('QUEST COMPLETE!');
});

test('the LAST verdict per checkpoint wins, so a late PASS clears an early FAIL', () => {
  const dir = run(['started', 'complete'], [line('started', 'FAIL'), line('started', 'PASS'), completeLine()]);
  expect(gradeRun(dir).verdict).toBe('PASS');
});

test('a missing checkpoint FAILS and is named', () => {
  const dir = run(['started', 'olaf', 'complete'], [line('started', 'PASS'), completeLine()]);
  const result = gradeRun(dir);
  expect(result.verdict).toBe('FAIL');
  expect(result.reason).toMatch(/missing PASS: olaf/);
});

test('an explicit FAIL checkpoint names the checkpoint, not just "failed"', () => {
  const dir = run(['started', 'complete'], [line('started', 'FAIL'), completeLine()]);
  const result = gradeRun(dir);
  expect(result.verdict).toBe('FAIL');
  expect(result.reason).toMatch(/checkpoint FAIL: started/);
});

test('an empty required list is a FAIL — a run that requires nothing proves nothing', () => {
  const dir = run([], [line('started', 'PASS')]);
  const result = gradeRun(dir);
  expect(result.verdict).toBe('FAIL');
  expect(result.reason).toMatch(/requires nothing/);
});

test('a complete checkpoint without the journal completion line is a FAIL', () => {
  const dir = run(['complete'], [completeLine('I should go speak to Brundt')]);
  const result = gradeRun(dir);
  expect(result.verdict).toBe('FAIL');
  expect(result.reason).toMatch(/no "quest complete" journal line/);
});

test('no run.json is a FAIL with a harness-shaped reason', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canary-empty-'));
  mkdirSync(dir, { recursive: true });
  const result = gradeRun(dir);
  expect(result.verdict).toBe('FAIL');
  expect(result.reason).toMatch(/never started/);
});
