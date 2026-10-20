/**
 * Readers for the two telemetry channels a quest run already writes:
 *
 * - `bots/<account>/events.log` — structured JSONL from `ActivitySession`
 *   (one `session` id per script process, a `phase` on every line, `recovery`
 *   events per recovery tactic, and a final `stop` event with a code).
 * - `quest-lab/runs/<run-id>/` — the run identity plus append-only checkpoint
 *   evidence (`checkpoints.jsonl`), which is where a run's real state lives.
 *
 * Everything here is pure text -> data so it is testable without a world.
 * Missing files return empty results, never throw: a harness that crashes while
 * diagnosing a crashed run is worse than one that reports a thin observation.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { CheckpointRecord, Verdict } from './types.ts';

export interface EventLine {
  t: number;
  pid?: number;
  /** Identifies one script process. Every line of one run shares this value. */
  session: number;
  phase?: string;
  type: string;
  code?: string;
  kind?: string;
  message?: unknown;
  [key: string]: unknown;
}

/** Parse JSONL, skipping blank and malformed lines (a truncated tail is normal). */
export function parseJsonl<T = Record<string, unknown>>(text: string): T[] {
  const out: T[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      /* a half-written last line is not an error */
    }
  }
  return out;
}

export function parseEventLines(text: string): EventLine[] {
  return parseJsonl<EventLine>(text).filter(line => Number.isFinite(line?.t) && typeof line?.type === 'string');
}

/**
 * Slice out the events that belong to one attempt.
 *
 * The events file is appended to forever, so the only reliable separator is the
 * `session` id: take the last session that appears at or after the attempt
 * started. A run whose script never connected produces no slice, which is
 * itself the diagnosis ("the script died before it registered a session").
 */
export function sessionSlice(lines: readonly EventLine[], startedAtMs: number): { session: number | null; lines: EventLine[] } {
  let session: number | null = null;
  for (const line of lines) {
    if (line.t >= startedAtMs) session = line.session;
  }
  if (session === null) return { session: null, lines: [] };
  return { session, lines: lines.filter(line => line.session === session) };
}

export interface SessionObservation {
  lastPhase: string | null;
  phases: string[];
  recoveries: number;
  stopCode: string | null;
  /** Last 200-char message from the session, handy in a failure report. */
  lastMessage: string | null;
}

export function observeSession(lines: readonly EventLine[]): SessionObservation {
  const phases: string[] = [];
  let recoveries = 0;
  let stopCode: string | null = null;
  let lastMessage: string | null = null;
  for (const line of lines) {
    if (typeof line.phase === 'string' && line.phase && !phases.includes(line.phase)) phases.push(line.phase);
    if (line.type === 'recovery') recoveries++;
    if (line.type === 'stop') stopCode = typeof line.code === 'string' ? line.code : 'stop';
    if (typeof line.message === 'string' && line.message) lastMessage = line.message;
  }
  return {
    lastPhase: phases.length ? phases[phases.length - 1]! : null,
    phases,
    recoveries,
    stopCode,
    lastMessage,
  };
}

/** One attempt's view of the events channel, keyed off the attempt start time. */
export function observeAttemptEvents(text: string, startedAtMs: number): SessionObservation {
  return observeSession(sessionSlice(parseEventLines(text), startedAtMs).lines);
}

export function readText(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : null;
  } catch {
    return null;
  }
}

export interface RunRecord {
  directory: string;
  runId: string;
  questId?: string;
  account?: string;
  requiredCheckpoints?: string[];
  createdAt?: string;
}

/** Latest checkpoint verdict per checkpoint id; later records win. */
export function latestVerdicts(records: readonly CheckpointRecord[]): Map<string, CheckpointRecord> {
  const latest = new Map<string, CheckpointRecord>();
  for (const record of records) {
    if (typeof record?.checkpointId !== 'string') continue;
    latest.set(record.checkpointId, record);
  }
  return latest;
}

export function verdictGroups(records: readonly CheckpointRecord[], required: readonly string[]): {
  passed: string[];
  failed: string[];
  missing: string[];
} {
  const latest = latestVerdicts(records);
  const passed: string[] = [];
  const failed: string[] = [];
  const missing: string[] = [];
  for (const id of required) {
    const verdict: Verdict | undefined = latest.get(id)?.verdict;
    if (verdict === 'PASS') passed.push(id);
    else if (verdict === 'FAIL') failed.push(id);
    else missing.push(id); // UNKNOWN and absent are the same thing: not proven.
  }
  return { passed, failed, missing };
}

/**
 * Find the run directory an attempt created.
 *
 * The script owns the run id (quest + account + timestamp), so the harness
 * searches instead of dictating: newest run whose identity names this account
 * and quest. Returns null when the script died before writing its identity.
 */
export function findRunDirectory(runsRoot: string, account: string, questId: string): RunRecord | null {
  if (!existsSync(runsRoot)) return null;
  const candidates: { path: string; mtime: number }[] = [];
  for (const name of readdirSync(runsRoot)) {
    const path = join(runsRoot, name);
    try {
      if (!statSync(path).isDirectory()) continue;
    } catch {
      continue;
    }
    candidates.push({ path, mtime: statSync(path).mtimeMs });
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  for (const candidate of candidates) {
    const raw = readText(join(candidate.path, 'run.json'));
    if (!raw) continue;
    try {
      const record = JSON.parse(raw) as RunRecord;
      const accountMatches = (record.account ?? '').toLowerCase() === account.toLowerCase();
      const questMatches = !record.questId || record.questId === questId;
      if (accountMatches && questMatches) return { ...record, directory: candidate.path };
    } catch {
      continue;
    }
  }
  return null;
}
