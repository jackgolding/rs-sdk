/**
 * Types shared by the eval harness, its report layer and its tests.
 *
 * Nothing here imports the SDK or the engine, so the pure aggregation code can
 * be unit-tested with synthetic records (no world, no gateway, no accounts).
 */

export type Verdict = 'PASS' | 'FAIL' | 'UNKNOWN';

/** One line of a quest-lab run's `checkpoints.jsonl`. */
export interface CheckpointRecord {
  checkpointId: string;
  verdict: Verdict;
  reason?: string;
  kind?: string;
}

/** A quest the suite asks the harness to run N times from its fixture. */
export interface SuiteQuest {
  questId: string;
  /** Script to run, relative to the repo root (e.g. `bots/quests/cooks-assistant.ts`). */
  script: string;
  /** Fixture spec the account is provisioned from, relative to the repo root. */
  fixture: string;
  /**
   * Short alphanumeric code used in the per-attempt username. Derived from
   * questId when absent. The generated name must stay inside the reserved
   * `ql…` fixture namespace and within the engine's 12-character limit.
   */
  accountCode?: string;
  runs?: number;
  timeoutMs?: number;
}

export interface GateSpec {
  /** Minimum share of attempts that must pass, e.g. 0.8 for the offline CI gate. */
  minPassRate: number;
  /** Minimum attempt count a quest must have before its pass rate means anything. */
  minRuns: number;
}

export interface Suite {
  schemaVersion: 1;
  name: string;
  runs?: number;
  timeoutMs?: number;
  gate?: Partial<GateSpec>;
  quests: SuiteQuest[];
}

/**
 * How an attempt ended.
 *
 * - `pass`    script exited 0 and every required checkpoint carries a PASS
 * - `fail`    the run ended with a failed/unknown checkpoint or a non-zero exit
 * - `timeout` the attempt exceeded its budget and was stopped
 * - `error`   the harness could not stage the attempt (provision/login/teardown)
 */
export type AttemptStatus = 'pass' | 'fail' | 'timeout' | 'error';

export interface AttemptResult {
  questId: string;
  script: string;
  fixture: string;
  account: string;
  /** 1-based attempt number within the quest. */
  attempt: number;
  status: AttemptStatus;
  /**
   * Where it died, in the vocabulary the operator thinks in: `checkpoint:<id>`
   * when checkpoint evidence names the state, else the last script phase.
   */
  failureState: string | null;
  failureReason: string | null;
  durationMs: number;
  recoveries: number;
  exitCode: number | null;
  timedOut: boolean;
  runDirectory: string | null;
  passedCheckpoints: string[];
  failedCheckpoints: string[];
  missingCheckpoints: string[];
  /** Distinct script phases observed, in first-seen order. */
  phases: string[];
  lastPhase: string | null;
  notes: string[];
  logPath: string | null;
  /**
   * The clock this attempt ran on. A pass rate without one is an unanchored
   * claim: the local engine defaults to 400ms/tick while the demo server runs
   * 300ms, and `::speed` can change a session invisibly.
   */
  clock: { tickRateMs: number | null; source: string };
}

export interface QuestSummary {
  questId: string;
  runs: number;
  passes: number;
  passRate: number;
  medianMs: number;
  p90Ms: number;
  meanRecoveries: number;
  failureStates: Record<string, number>;
  statusCounts: Record<AttemptStatus, number>;
  gate: { ok: boolean; reasons: string[] };
}

export interface SuiteReport {
  schemaVersion: 1;
  suite: string;
  startedAt: string;
  finishedAt: string;
  gate: GateSpec;
  totals: {
    runs: number;
    passes: number;
    passRate: number;
    medianMs: number;
    p90Ms: number;
    meanRecoveries: number;
  };
  quests: QuestSummary[];
  attempts: AttemptResult[];
  ok: boolean;
  reasons: string[];
}
