/**
 * Canary grading — the same evidence rule as the dev gate, applied to a run that
 * happened on the production image.
 *
 * The dev harness (`quest-eval`) stages a fresh fixture locally, so it can only
 * ever prove logic. A canary run is proof of the WIRE: real latency, real
 * content revision, real supervisor. Its verdict therefore comes from the run
 * record the script wrote on the box (`run.json` + `checkpoints.jsonl`), never
 * from the script's exit code, its log, or its own DONE line.
 *
 * Two guards make this gate honest:
 * - an EMPTY `requiredCheckpoints` is a FAIL — a resumed run that requires
 *   nothing proves nothing, and this is exactly how a dead script would promote
 *   itself;
 * - a passing `complete` checkpoint must carry the journal's own completion
 *   line, because "the script said it finished" is the failure mode the whole
 *   pipeline exists to catch.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCheckpoints, summarizeRun } from './records';

export interface RunFile {
  runId: string;
  questId: string;
  account: string;
  mode: string;
  scriptHash: string;
  requiredCheckpoints: string[];
}

export interface CanaryGrade {
  verdict: 'PASS' | 'FAIL';
  reason: string;
  detail: {
    runId: string | null;
    questId: string | null;
    account: string | null;
    mode: string | null;
    scriptHash: string | null;
    required: number;
    passed: number;
    missing: string[];
    failed: string[];
    checkpoints: { id: string; verdict: string; reason: string | null }[];
    completionLine: string | null;
  };
}

export function gradeRun(directory: string): CanaryGrade {
  const runPath = join(directory, 'run.json');
  const empty = {
    runId: null,
    questId: null,
    account: null,
    mode: null,
    scriptHash: null,
    required: 0,
    passed: 0,
    missing: [],
    failed: [],
    checkpoints: [],
    completionLine: null,
  };
  if (!existsSync(runPath)) {
    return { verdict: 'FAIL', reason: 'no run.json — the run never started', detail: empty };
  }

  const run = JSON.parse(readFileSync(runPath, 'utf-8')) as RunFile;
  const summary = summarizeRun(directory);
  const latest = new Map(readCheckpoints(directory).map(r => [r.checkpointId, r]));
  const checkpoints = (run.requiredCheckpoints ?? []).map(id => ({
    id,
    verdict: latest.get(id)?.verdict ?? 'MISSING',
    reason: latest.get(id)?.reason ?? null,
  }));
  const completeRecord = latest.get('complete');
  const completionLine =
    (completeRecord?.rawLines ?? [])
      .map(l => (l as { text?: string }).text ?? '')
      .find(t => /quest complete/i.test(t)) ?? null;

  const detail = {
    runId: run.runId ?? null,
    questId: run.questId ?? null,
    account: run.account ?? null,
    mode: run.mode ?? null,
    scriptHash: run.scriptHash ?? null,
    required: checkpoints.length,
    passed: checkpoints.filter(c => c.verdict === 'PASS').length,
    missing: summary.missing,
    failed: summary.failed,
    checkpoints,
    completionLine,
  };

  if (detail.required === 0) {
    return {
      verdict: 'FAIL',
      reason: 'requiredCheckpoints is empty — a run that requires nothing proves nothing',
      detail,
    };
  }
  if (!summary.ok) {
    return {
      verdict: 'FAIL',
      reason: summary.failed.length
        ? `checkpoint FAIL: ${summary.failed.join(', ')}`
        : `missing PASS: ${summary.missing.join(', ')}`,
      detail,
    };
  }
  if (!completionLine) {
    return {
      verdict: 'FAIL',
      reason: 'complete checkpoint passed but carries no "quest complete" journal line',
      detail,
    };
  }
  return {
    verdict: 'PASS',
    reason: `${detail.passed}/${detail.required} checkpoints, journal: "${completionLine}"`,
    detail,
  };
}
