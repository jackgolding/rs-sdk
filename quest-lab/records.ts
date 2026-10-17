import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RunIdentity {
  questId: string;
  account: string;
  mode: 'development' | 'staging';
  scriptHash: string;
  fixtureHash: string;
  contentHash: string;
  requiredCheckpoints: string[];
}
export interface CheckpointEvidenceRecord {
  checkpointId: string;
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN';
  reason: string;
  kind?: string;
  rawLines?: unknown[];
  evidence?: Record<string, unknown>;
}
export interface RunHandle { directory: string; identity: RunIdentity }

const RUN_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * Build a filesystem-safe run id from free-form parts (quest name, account,
 * an ISO timestamp). Callers naturally pass stamps like
 * `2026-10-17T16:29:44.743Z`, whose uppercase T/Z and dots are not safe run-id
 * characters, so normalising here keeps every caller from having to know the
 * rules — and makes separator or traversal input impossible to smuggle through.
 */
export function safeRunId(...parts: string[]): string {
  const id = parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  assertSafeRunId(id);
  return id;
}

function assertSafeRunId(runId: string): void {
  if (!RUN_ID.test(runId) || runId.includes('..')) throw new Error(`unsafe run id: ${runId}`);
}

/** Creates a fresh run directory. Never overwrites an existing run. */
export function createRun(root: string, runId: string, identity: RunIdentity): RunHandle {
  assertSafeRunId(runId);
  const directory = join(root, runId);
  if (existsSync(directory)) throw new Error(`run already exists: ${directory}`);
  mkdirSync(directory, { recursive: true });
  const record = { schemaVersion: 1, runId, createdAt: new Date().toISOString(), ...identity };
  writeFileSync(join(directory, 'run.json'), JSON.stringify(record, null, 2));
  writeFileSync(join(directory, 'checkpoints.jsonl'), '');
  return { directory, identity };
}

/** Appends checkpoint evidence verbatim — never sampled or truncated. */
export function appendCheckpoint(directory: string, evidence: CheckpointEvidenceRecord): void {
  const line = JSON.stringify({ observedAt: new Date().toISOString(), ...evidence });
  appendFileSync(join(directory, 'checkpoints.jsonl'), line + '\n');
}

export function readCheckpoints(directory: string): CheckpointEvidenceRecord[] {
  const path = join(directory, 'checkpoints.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8').split('\n').filter(Boolean).map((line: string) => JSON.parse(line) as CheckpointEvidenceRecord);
}

/** Promotion gate: every required checkpoint must have a PASS and none may be UNKNOWN. */
export function summarizeRun(directory: string): { ok: boolean; missing: string[]; failed: string[] } {
  const { requiredCheckpoints } = JSON.parse(readFileSync(join(directory, 'run.json'), 'utf-8')) as RunIdentity;
  const records = readCheckpoints(directory);
  const latest = new Map<string, CheckpointEvidenceRecord>();
  for (const r of records) latest.set(r.checkpointId, r);
  const missing = requiredCheckpoints.filter(id => latest.get(id)?.verdict !== 'PASS');
  const failed = requiredCheckpoints.filter(id => latest.get(id)?.verdict === 'FAIL');
  return { ok: missing.length === 0, missing, failed };
}
