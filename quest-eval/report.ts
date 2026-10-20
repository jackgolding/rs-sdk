/**
 * Pure aggregation and the CI gate.
 *
 * The gate is the point of the harness: a quest script should not reach the
 * roster unless it passes offline at least `minPassRate` of `minRuns` attempts.
 * Keeping the arithmetic pure means the threshold itself is unit-tested rather
 * than trusted, and a report can be rebuilt from stored JSON without a world.
 */
import type {
  AttemptResult,
  AttemptStatus,
  CheckpointRecord,
  GateSpec,
  QuestSummary,
  Suite,
  SuiteQuest,
  SuiteReport,
} from './types.ts';
import { verdictGroups } from './telemetry.ts';

export const DEFAULT_GATE: GateSpec = { minPassRate: 0.8, minRuns: 3 };

export function resolveGate(suite: Pick<Suite, 'gate'> | undefined, override?: Partial<GateSpec>): GateSpec {
  const merged = { ...DEFAULT_GATE, ...(suite?.gate ?? {}), ...(override ?? {}) };
  if (!(merged.minPassRate > 0 && merged.minPassRate <= 1)) throw new Error(`minPassRate must be in (0,1], got ${merged.minPassRate}`);
  if (!Number.isInteger(merged.minRuns) || merged.minRuns < 1) throw new Error(`minRuns must be a positive integer, got ${merged.minRuns}`);
  return merged;
}

export interface ClassificationInput {
  exitCode: number | null;
  timedOut: boolean;
  /** Set when the harness itself failed to stage or tear down the attempt. */
  harnessError?: string | null;
  records: readonly CheckpointRecord[];
  requiredCheckpoints: readonly string[];
  lastPhase: string | null;
}

/**
 * Decide pass/fail from evidence, never from the script's own optimism.
 *
 * A non-zero exit or any checkpoint that is not PASS is a failure, and the
 * failing checkpoint ID is the state the operator cares about ("it died in
 * `olaf`"), with the last phase as a fallback for runs that never reached a
 * checkpoint.
 */
export function classifyAttempt(input: ClassificationInput): {
  status: AttemptStatus;
  failureState: string | null;
  failureReason: string | null;
  passedCheckpoints: string[];
  failedCheckpoints: string[];
  missingCheckpoints: string[];
} {
  const groups = verdictGroups(input.records, input.requiredCheckpoints);
  const base = {
    passedCheckpoints: groups.passed,
    failedCheckpoints: groups.failed,
    missingCheckpoints: groups.missing,
  };

  if (input.harnessError) {
    return { ...base, status: 'error', failureState: 'harness', failureReason: input.harnessError };
  }
  if (input.timedOut) {
    return { ...base, status: 'timeout', failureState: input.lastPhase ?? 'unknown', failureReason: 'attempt exceeded its time budget' };
  }
  const failingCheckpoint = groups.failed[0] ?? groups.missing[0];
  // No evidence at all means the script died before its first checkpoint: naming
  // a checkpoint it never reached would be a fiction, so report the phase.
  const hasEvidence = input.records.length > 0;
  if (input.exitCode !== 0 || failingCheckpoint) {
    if (!hasEvidence) {
      return {
        ...base,
        status: 'fail',
        failureState: input.lastPhase ?? 'unknown',
        failureReason: `script exited ${input.exitCode ?? 'without a status'} before recording any checkpoint`,
      };
    }
    const reason = failingCheckpoint
      ? (input.records.find(r => r.checkpointId === failingCheckpoint)?.reason ?? 'checkpoint not proven')
      : `script exited ${input.exitCode ?? 'without a status'}`;
    return {
      ...base,
      status: 'fail',
      failureState: failingCheckpoint ? `checkpoint:${failingCheckpoint}` : (input.lastPhase ?? 'unknown'),
      failureReason: String(reason).slice(0, 300),
    };
  }
  return { ...base, status: 'pass', failureState: null, failureReason: null };
}

export function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Nearest-rank p90: small samples stay honest instead of interpolating a fiction. */
export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

function mean(values: readonly number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

const EMPTY_STATUS_COUNTS = (): Record<AttemptStatus, number> => ({ pass: 0, fail: 0, timeout: 0, error: 0 });

export function summarizeQuest(questId: string, attempts: readonly AttemptResult[], gate: GateSpec): QuestSummary {
  const runs = attempts.length;
  const passes = attempts.filter(a => a.status === 'pass').length;
  const passRate = runs ? passes / runs : 0;
  const durations = attempts.filter(a => a.status === 'pass').map(a => a.durationMs);
  const failureStates: Record<string, number> = {};
  const statusCounts = EMPTY_STATUS_COUNTS();
  for (const attempt of attempts) {
    statusCounts[attempt.status]++;
    if (attempt.status !== 'pass' && attempt.failureState) {
      failureStates[attempt.failureState] = (failureStates[attempt.failureState] ?? 0) + 1;
    }
  }

  const reasons: string[] = [];
  if (runs < gate.minRuns) reasons.push(`only ${runs} run(s); the gate needs ${gate.minRuns}`);
  if (passRate < gate.minPassRate) reasons.push(`pass rate ${(passRate * 100).toFixed(0)}% is below ${(gate.minPassRate * 100).toFixed(0)}%`);
  const errors = statusCounts.error;
  if (errors) reasons.push(`${errors} attempt(s) failed in the harness, not in the quest`);

  return {
    questId,
    runs,
    passes,
    passRate,
    medianMs: median(durations),
    p90Ms: percentile(durations, 90),
    meanRecoveries: mean(attempts.map(a => a.recoveries)),
    failureStates,
    statusCounts,
    gate: { ok: reasons.length === 0, reasons },
  };
}

export function buildReport(
  suiteName: string,
  quests: readonly SuiteQuest[],
  attempts: readonly AttemptResult[],
  gate: GateSpec,
  startedAt: Date,
  finishedAt: Date,
): SuiteReport {
  const summaries = quests.map(quest =>
    summarizeQuest(
      quest.questId,
      attempts.filter(a => a.questId === quest.questId),
      gate,
    ),
  );
  const runs = attempts.length;
  const passes = attempts.filter(a => a.status === 'pass').length;
  const passingDurations = attempts.filter(a => a.status === 'pass').map(a => a.durationMs);
  const reasons: string[] = [];
  for (const summary of summaries) {
    if (!summary.gate.ok) reasons.push(`${summary.questId}: ${summary.gate.reasons.join('; ')}`);
  }
  // Suite-level gate: no quest may fail its own gate, and the whole suite must
  // clear the same pass rate over at least one quest's worth of runs.
  if (runs && passes / runs < gate.minPassRate) {
    reasons.push(`suite pass rate ${((passes / runs) * 100).toFixed(0)}% is below ${(gate.minPassRate * 100).toFixed(0)}%`);
  }
  if (!runs) reasons.push('no attempts were run');

  return {
    schemaVersion: 1,
    suite: suiteName,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    gate,
    totals: {
      runs,
      passes,
      passRate: runs ? passes / runs : 0,
      medianMs: median(passingDurations),
      p90Ms: percentile(passingDurations, 90),
      meanRecoveries: mean(attempts.map(a => a.recoveries)),
    },
    quests: summaries,
    attempts: [...attempts],
    ok: reasons.length === 0,
    reasons,
  };
}

export function formatDuration(ms: number): string {
  if (!ms) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}

/** Operator-facing table. Kept narrow so it reads in a terminal and in a PR body. */
export function formatReport(report: SuiteReport): string {
  const lines: string[] = [];
  const pad = (value: string, width: number) => value.padEnd(width);
  lines.push(`${report.suite} — ${report.totals.passes}/${report.totals.runs} attempts passed (${(report.totals.passRate * 100).toFixed(0)}%)`);
  const clocks = [...new Set(report.attempts.map(a => (a.clock?.tickRateMs ? `${a.clock.tickRateMs}ms/tick (${a.clock.source})` : a.clock?.source ?? 'clock unknown')))];
  lines.push(`measured on: ${clocks.join(' · ')}`);
  lines.push('');
  lines.push(
    `${pad('quest', 18)}${pad('runs', 8)}${pad('pass%', 8)}${pad('median', 9)}${pad('p90', 9)}${pad('recov', 7)}gate`,
  );
  for (const quest of report.quests) {
    const runs = `${quest.passes}/${quest.runs}`;
    lines.push(
      `${pad(quest.questId, 18)}${pad(runs, 8)}${pad(`${Math.round(quest.passRate * 100)}%`, 8)}${pad(formatDuration(quest.medianMs), 9)}${pad(formatDuration(quest.p90Ms), 9)}${pad(quest.meanRecoveries.toFixed(1), 7)}${quest.gate.ok ? 'PASS' : 'FAIL'}`,
    );
    for (const [state, count] of Object.entries(quest.failureStates).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ✗ ${state} ×${count}`);
    }
  }
  lines.push('');
  lines.push(
    `gate: ≥${(report.gate.minPassRate * 100).toFixed(0)}% over ≥${report.gate.minRuns} runs — ${report.ok ? 'PASS' : 'FAIL'}`,
  );
  for (const reason of report.reasons) lines.push(`  · ${reason}`);
  return lines.join('\n');
}

/** Markdown twin of the table, written next to report.json for PR bodies/ADRs. */
export function formatMarkdown(report: SuiteReport): string {
  const clocks = [...new Set(report.attempts.map(a => (a.clock?.tickRateMs ? `${a.clock.tickRateMs}ms/tick (${a.clock.source})` : a.clock?.source ?? 'clock unknown')))];
  const lines = [
    `# quest-eval: ${report.suite}`,
    '',
    `Generated ${report.finishedAt} · gate ≥${(report.gate.minPassRate * 100).toFixed(0)}% over ≥${report.gate.minRuns} runs · clock ${clocks.join(', ')}`,
    '',
    '| quest | runs | pass rate | median | p90 | recoveries | gate |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const quest of report.quests) {
    lines.push(
      `| ${quest.questId} | ${quest.passes}/${quest.runs} | ${Math.round(quest.passRate * 100)}% | ${formatDuration(quest.medianMs)} | ${formatDuration(quest.p90Ms)} | ${quest.meanRecoveries.toFixed(1)} | ${quest.gate.ok ? 'PASS' : 'FAIL'} |`,
    );
  }
  lines.push('', `**Overall:** ${report.totals.passes}/${report.totals.runs} (${(report.totals.passRate * 100).toFixed(0)}%) — ${report.ok ? 'gate PASS' : 'gate FAIL'}`);
  const failures = report.quests.filter(q => Object.keys(q.failureStates).length);
  if (failures.length) {
    lines.push('', '## Failure states', '');
    for (const quest of failures) {
      lines.push(`- **${quest.questId}**`);
      for (const [state, count] of Object.entries(quest.failureStates).sort((a, b) => b[1] - a[1])) {
        lines.push(`  - \`${state}\` ×${count}`);
      }
    }
  }
  for (const reason of report.reasons) lines.push(`- ${reason}`);
  return lines.join('\n');
}
