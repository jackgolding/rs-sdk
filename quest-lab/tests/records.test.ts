import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const modulePath = resolve(import.meta.dir, '../records.ts');
const dirs: string[] = [];
const temp = () => { const p = mkdtempSync(join(tmpdir(), 'ql-records-')); dirs.push(p); return p; };
afterEach(() => dirs.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })));
const identity = { questId: 'cook', account: 'qlcookdev', mode: 'development', scriptHash: 'a', fixtureHash: 'b', contentHash: 'c', requiredCheckpoints: ['unstarted','complete'] };
test('builds a filesystem-safe run id from free-form parts like ISO stamps', async () => {
  const { safeRunId } = await import(modulePath);
  // ISO timestamps carry uppercase T/Z; run ids must be lowercase-safe.
  expect(safeRunId('cook', 'qlcook3', '2026-10-17T16:29:44.743Z')).toBe('cook-qlcook3-2026-10-17t16-29-44-743z');
  // Path traversal, separators and other junk can never survive.
  expect(safeRunId('cook', '../../etc/passwd')).not.toContain('..');
  expect(safeRunId('cook', '../../etc/passwd')).not.toContain('/');
  expect(safeRunId('cook', 'a b\\c')).toBe('cook-a-b-c');
  expect(safeRunId('cook').length).toBeLessThanOrEqual(64);
});

test('creates immutable run identity and appends complete unsampled checkpoint evidence', async () => {
  expect(existsSync(modulePath)).toBe(true);
  const { createRun, appendCheckpoint } = await import(modulePath);
  const root = temp();
  const run = createRun(root, 'cook-001', identity);
  const evidence = { checkpointId: 'unstarted', verdict: 'PASS', reason: 'journal', rawLines: [{ rawText: '@str@' + 'x'.repeat(4000) }], kind: 'unstarted' };
  appendCheckpoint(run.directory, evidence);
  expect(JSON.parse(readFileSync(join(run.directory, 'run.json'),'utf8')).account).toBe('qlcookdev');
  expect(JSON.parse(readFileSync(join(run.directory, 'checkpoints.jsonl'),'utf8')).rawLines[0].rawText.length).toBe(4005);
  expect(() => createRun(root, 'cook-001', identity)).toThrow();
});
