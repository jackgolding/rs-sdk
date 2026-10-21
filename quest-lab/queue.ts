/**
 * The durable quest queue.
 *
 * Why a file and not a conversation: a chat delegation is bounded, and the
 * pipeline's whole point is that work survives it. Every quest therefore has one
 * entry here, carrying its stage, its owner, its attempt budget and the evidence
 * that justified the last transition. A subagent claims an entry, works, and
 * either advances it or records why it did not — the record is the handoff.
 *
 * Stage order (see NIGHTSHIFT.md):
 *
 *   catalogued -> fixture -> drafting -> dev-verified -> canary -> fleet-ready -> rolled-out
 *                    ^            |            |           |            |
 *                    +------------+------------+-----------+------------+--> drafting (regression)
 *
 * `blocked` is reachable from anywhere and must carry a reason.
 *
 * Transitions are guarded, not advisory: a quest cannot become `fleet-ready`
 * without a PASSING canary run, and cannot become `rolled-out` without at least
 * one account on its todo list. That is what stops "it looked fine" from
 * promoting work.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SCHEMA_VERSION = 1;

export type Stage =
  | 'catalogued'
  | 'fixture'
  | 'drafting'
  | 'dev-verified'
  | 'canary'
  | 'fleet-ready'
  | 'rolled-out'
  | 'blocked';

export type Verdict = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface Budget {
  maxDevAttempts: number;
  maxCanaryAttempts: number;
  /** ISO deadline; null means unset. */
  deadline: string | null;
}

export interface Candidate {
  /** Commit the candidate was frozen at — a canary runs committed code only. */
  sha: string;
  /** Hash of the script bytes at freeze time. */
  scriptHash: string;
  frozenAt: string;
}

export interface CanaryEvidence {
  account: string;
  runId: string;
  verdict: Verdict;
  attempts: number;
  at: string;
}

export interface Note {
  at: string;
  text: string;
}

export interface QueueEntry {
  id: string;
  name: string;
  script: string | null;
  fixture: string | null;
  stage: Stage;
  owner: string | null;
  claimedAt: string | null;
  attempts: { dev: number; canary: number };
  budget: Budget;
  candidate: Candidate | null;
  canary: CanaryEvidence | null;
  blockers: string[];
  rolledOutTo: string[];
  notes: Note[];
  updatedAt: string;
}

export interface QueueFile {
  schemaVersion: number;
  generatedAt: string;
  entries: QueueEntry[];
}

export interface CatalogueEntry {
  id: string;
  name: string;
  primaryScript: string | null;
  blockers?: string[];
}

export interface QuestFacts {
  hasScript: boolean;
  hasFixture: boolean;
  /** Result of the newest local eval that covers this quest. */
  devGate: 'pass' | 'fail' | 'none';
  /** Discovered script path when the catalogue attribution is missing. */
  script?: string | null;
}

const NEXT: Record<Stage, Stage[]> = {
  catalogued: ['fixture', 'drafting', 'blocked'],
  fixture: ['drafting', 'blocked'],
  drafting: ['dev-verified', 'fixture', 'canary', 'blocked'],
  'dev-verified': ['canary', 'drafting', 'blocked'],
  canary: ['fleet-ready', 'drafting', 'blocked'],
  'fleet-ready': ['rolled-out', 'canary', 'blocked'],
  'rolled-out': ['canary', 'blocked'],
  blocked: ['catalogued', 'fixture', 'drafting', 'canary'],
};

export const DEFAULT_BUDGET: Budget = {
  maxDevAttempts: 6,
  maxCanaryAttempts: 4,
  deadline: null,
};

/** Facts only: no ownership, no evidence. Used to seed and to refresh untouched entries. */
export function deriveStage(facts: QuestFacts): Stage {
  if (!facts.hasScript) return 'catalogued';
  if (!facts.hasFixture) return 'fixture';
  if (facts.devGate === 'pass') return 'dev-verified';
  return 'drafting';
}

function untouched(entry: QueueEntry): boolean {
  return (
    entry.owner === null &&
    entry.candidate === null &&
    entry.canary === null &&
    entry.attempts.dev === 0 &&
    entry.attempts.canary === 0 &&
    entry.rolledOutTo.length === 0 &&
    entry.stage !== 'blocked' &&
    entry.stage !== 'rolled-out'
  );
}

/** Catalogue blockers go stale: "no primary quest script yet" is false once one is found. */
function liveBlockers(cat: CatalogueEntry, facts: QuestFacts): string[] {
  return (cat.blockers ?? []).filter(b => !(facts.hasScript && /no primary quest script yet/i.test(b)));
}

export function seedEntry(cat: CatalogueEntry, facts: QuestFacts, now: string): QueueEntry {
  return {
    id: cat.id,
    name: cat.name,
    script: facts.hasScript ? (facts.script ?? cat.primaryScript) : null,
    fixture: facts.hasFixture ? `quest-lab/fixtures/${cat.id}.json` : null,
    stage: deriveStage(facts),
    owner: null,
    claimedAt: null,
    attempts: { dev: 0, canary: 0 },
    budget: { ...DEFAULT_BUDGET },
    candidate: null,
    canary: null,
    blockers: liveBlockers(cat, facts),
    rolledOutTo: [],
    notes: [],
    updatedAt: now,
  };
}

/**
 * Rebuild the queue from the catalogue, preserving every entry that carries
 * progress. A refresh must never silently rewind work: that is how a queue
 * becomes fiction.
 */
export function refreshEntries(
  previous: readonly QueueEntry[],
  catalogue: readonly CatalogueEntry[],
  factsById: (id: string) => QuestFacts,
  now: string,
): QueueEntry[] {
  const byId = new Map(previous.map(e => [e.id, e]));
  return catalogue.map(cat => {
    const facts = factsById(cat.id);
    const old = byId.get(cat.id);
    if (!old) return seedEntry(cat, facts, now);
    if (!untouched(old)) {
      return {
        ...old,
        name: cat.name,
        script: facts.hasScript ? (old.script ?? facts.script ?? cat.primaryScript) : old.script,
        fixture: facts.hasFixture ? (old.fixture ?? `quest-lab/fixtures/${cat.id}.json`) : old.fixture,
      };
    }
    const base = seedEntry(cat, facts, now);
    // Keep recorded blockers (they carry reasons), but a refresh must not resurrect a
    // stale one that live facts have disproved.
    const kept = old.blockers.filter(b => base.blockers.includes(b) || !/no primary quest script yet/i.test(b));
    return { ...base, blockers: kept.length ? kept : base.blockers };
  });
}

export class QueueError extends Error {}

function mustGet(entries: readonly QueueEntry[], id: string): QueueEntry {
  const e = entries.find(x => x.id === id);
  if (!e) throw new QueueError(`no queue entry '${id}'`);
  return e;
}

export function canTransition(entry: QueueEntry, to: Stage): { ok: boolean; reason?: string } {
  if (entry.stage === to) return { ok: false, reason: `already ${to}` };
  if (!NEXT[entry.stage].includes(to)) {
    return { ok: false, reason: `${entry.stage} -> ${to} is not a declared transition` };
  }
  if (to === 'canary' && !entry.candidate) {
    return { ok: false, reason: 'canary needs a frozen candidate (sha + script hash)' };
  }
  if (to === 'fleet-ready') {
    if (!entry.candidate) return { ok: false, reason: 'fleet-ready needs a frozen candidate' };
    if (entry.canary?.verdict !== 'PASS') {
      return { ok: false, reason: `fleet-ready needs a PASSING canary run (have ${entry.canary?.verdict ?? 'none'})` };
    }
  }
  if (to === 'rolled-out' && entry.rolledOutTo.length === 0) {
    return { ok: false, reason: 'rolled-out needs at least one account on the todo list' };
  }
  if (to === 'dev-verified' && entry.attempts.dev === 0) {
    return { ok: false, reason: 'dev-verified needs a recorded dev attempt' };
  }
  return { ok: true };
}

/**
 * Claim a quest for an owner. One owner at a time per quest, and the dev attempt
 * budget is enforced here rather than trusted to the worker.
 */
export function claim(
  entries: QueueEntry[],
  id: string,
  owner: string,
  now: string,
): QueueEntry {
  const entry = mustGet(entries, id);
  if (entry.owner && entry.owner !== owner) {
    throw new QueueError(`'${id}' is already claimed by ${entry.owner}`);
  }
  if (entry.stage === 'rolled-out') throw new QueueError(`'${id}' is already rolled out`);
  if (entry.stage === 'blocked') throw new QueueError(`'${id}' is blocked: ${entry.blockers.at(-1) ?? 'no reason'}`);
  if (entry.stage === 'canary') throw new QueueError(`'${id}' is in the canary tier — canaries are serialized`);
  if (entry.attempts.dev >= entry.budget.maxDevAttempts) {
    throw new QueueError(
      `'${id}' is out of dev attempts (${entry.attempts.dev}/${entry.budget.maxDevAttempts}) — block it with a reason and move on`,
    );
  }
  entry.owner = owner;
  entry.claimedAt = now;
  entry.attempts.dev += 1;
  // Claiming for a canary or a rollout is not a regression: only work that still
  // has to earn its dev gate falls back to drafting.
  if (entry.stage === 'catalogued' || entry.stage === 'fixture' || entry.stage === 'drafting') {
    entry.stage = 'drafting';
  }
  entry.updatedAt = now;
  return entry;
}

export function release(entries: QueueEntry[], id: string, owner: string, now: string): QueueEntry {
  const entry = mustGet(entries, id);
  if (entry.owner !== owner) throw new QueueError(`'${id}' is not owned by ${owner}`);
  entry.owner = null;
  entry.claimedAt = null;
  entry.updatedAt = now;
  return entry;
}

export function freeze(entries: QueueEntry[], id: string, candidate: Candidate): QueueEntry {
  const entry = mustGet(entries, id);
  if (!entry.script) throw new QueueError(`'${id}' has no script to freeze`);
  entry.candidate = candidate;
  entry.updatedAt = candidate.frozenAt;
  return entry;
}

/** Record a canary result. FAIL keeps the quest in canary so the next attempt is counted. */
export function recordCanary(
  entries: QueueEntry[],
  id: string,
  evidence: CanaryEvidence,
): QueueEntry {
  const entry = mustGet(entries, id);
  entry.canary = evidence;
  entry.attempts.canary += 1;
  entry.updatedAt = evidence.at;
  if (evidence.verdict === 'PASS') {
    const check = canTransition({ ...entry, stage: 'canary' }, 'fleet-ready');
    if (!check.ok) throw new QueueError(check.reason!);
    entry.stage = 'fleet-ready';
    entry.owner = null;
    entry.claimedAt = null;
  } else if (entry.attempts.canary >= entry.budget.maxCanaryAttempts) {
    entry.stage = 'blocked';
    entry.blockers.push(
      `canary budget exhausted (${entry.attempts.canary}/${entry.budget.maxCanaryAttempts}): ${evidence.runId}`,
    );
  }
  return entry;
}

export function block(entries: QueueEntry[], id: string, reason: string, now: string): QueueEntry {
  const entry = mustGet(entries, id);
  entry.stage = 'blocked';
  entry.blockers.push(reason);
  entry.owner = null;
  entry.claimedAt = null;
  entry.updatedAt = now;
  return entry;
}

export function advance(entries: QueueEntry[], id: string, to: Stage, now: string): QueueEntry {
  const entry = mustGet(entries, id);
  const check = canTransition(entry, to);
  if (!check.ok) throw new QueueError(`'${id}': ${check.reason}`);
  entry.stage = to;
  entry.updatedAt = now;
  return entry;
}

/** Roll a fleet-ready quest onto accounts' todo lists. Returns the entry. */
export function promote(entries: QueueEntry[], id: string, accounts: readonly string[], now: string): QueueEntry {
  const entry = mustGet(entries, id);
  if (entry.stage !== 'fleet-ready' && entry.stage !== 'rolled-out') {
    throw new QueueError(`'${id}' is ${entry.stage}; only fleet-ready quests roll out`);
  }
  if (accounts.length === 0) throw new QueueError('promote needs at least one account');
  for (const a of accounts) if (!entry.rolledOutTo.includes(a)) entry.rolledOutTo.push(a);
  entry.stage = 'rolled-out';
  entry.updatedAt = now;
  return entry;
}

/** Work ordering: locally-proven first, then fixture-ready, then the long tail. */
export function sortForWork(entries: readonly QueueEntry[]): QueueEntry[] {
  const rank = (s: Stage): number =>
    ({ 'dev-verified': 0, canary: 1, drafting: 2, fixture: 3, catalogued: 4, 'fleet-ready': 5, 'rolled-out': 6, blocked: 7 })[s];
  return [...entries].sort((a, b) => rank(a.stage) - rank(b.stage) || a.name.localeCompare(b.name));
}

export function readQueue(path: string): QueueFile {
  return JSON.parse(readFileSync(path, 'utf-8')) as QueueFile;
}

export function writeQueue(path: string, file: QueueFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
}

/**
 * Find the script that belongs to each quest.
 *
 * The catalogue's `primaryScript` covers only a minority of the tree and has
 * rotted before (a Pirate's Treasure script filed under Merlin's Crystal), so it
 * is used when it points at a real file and otherwise the tree is scanned:
 * filename token, the quest's display name in the file header, or the quest id
 * passed to `safeRunId`. Discovery is a seed, not an authority — an entry's
 * `script` field wins once anything has been recorded against it.
 */
export function discoverScripts(root: string, catalogue: readonly CatalogueEntry[]): Map<string, string> {
  const dir = join(root, 'bots', 'quests');
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  const files: string[] = readdirSync(dir).filter((f: string) => f.endsWith('.ts') && !f.endsWith('.graph.ts'));
  const text = new Map<string, string>(files.map((f: string) => [f, readFileSync(join(dir, f), 'utf-8')]));

  // 1. Attribution an operator already proved by running it: eval attempt records.
  const reportsRoot = join(root, 'quest-eval', 'reports');
  if (existsSync(reportsRoot)) {
    for (const stamp of (readdirSync(reportsRoot) as string[]).sort().reverse()) {
      const p = join(reportsRoot, stamp, 'report.json');
      if (!existsSync(p)) continue;
      let report: { attempts?: { questId: string; script: string }[] };
      try {
        report = JSON.parse(readFileSync(p, 'utf-8'));
      } catch {
        continue;
      }
      for (const a of report.attempts ?? []) {
        if (a?.questId && a.script && !out.has(a.questId) && existsSync(join(root, a.script))) {
          out.set(a.questId, a.script);
        }
      }
    }
  }

  // 2. Catalogue attribution when it points at a real file.
  for (const cat of catalogue) {
    if (out.has(cat.id)) continue;
    if (cat.primaryScript && existsSync(join(root, cat.primaryScript))) out.set(cat.id, cat.primaryScript);
  }

  // 3. Quest DRIVERS only (they own a run record). A gear helper that mentions a
  //    quest in its header is not that quest's script — combat-kit is not Fight Arena.
  const drivers = files.filter(f => text.get(f)!.includes('createRun('));
  for (const cat of catalogue) {
    if (out.has(cat.id)) continue;
    const id = cat.id.toLowerCase();
    const name = cat.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const hits = drivers.filter(f => {
      const body = text.get(f)!;
      return body.includes(`safeRunId('${id}'`) || body.slice(0, 2000).toLowerCase().includes(name);
    });
    if (hits.length === 1) out.set(cat.id, `bots/quests/${hits[0]}`);
  }
  return out;
}

/**
 * Derive per-quest facts from the tree and from the newest eval reports.
 *
 * A quest counts as dev-verified only if an eval report says its own gate
 * PASSED — the same arithmetic the harness used, not a re-interpretation.
 */
export function collectFacts(root: string, catalogue: readonly CatalogueEntry[]): Map<string, QuestFacts> {
  const reportsRoot = join(root, 'quest-eval', 'reports');
  const gateById = new Map<string, boolean>();
  if (existsSync(reportsRoot)) {
    const stamps = readdirSync(reportsRoot).sort().reverse();
    for (const stamp of stamps) {
      const p = join(reportsRoot, stamp, 'report.json');
      if (!existsSync(p)) continue;
      let report: { quests?: { questId: string; gate?: { ok?: boolean } }[] };
      try {
        report = JSON.parse(readFileSync(p, 'utf-8'));
      } catch {
        continue;
      }
      for (const q of report.quests ?? []) {
        if (!gateById.has(q.questId)) gateById.set(q.questId, q.gate?.ok === true);
      }
    }
  }
  const facts = new Map<string, QuestFacts>();
  const scripts = discoverScripts(root, catalogue);
  for (const cat of catalogue) {
    const script = scripts.get(cat.id) ?? null;
    const hasScript = Boolean(script && existsSync(join(root, script)));
    const hasFixture = existsSync(join(root, 'quest-lab', 'fixtures', `${cat.id}.json`));
    const gate = gateById.get(cat.id);
    facts.set(cat.id, {
      hasScript,
      hasFixture,
      script: hasScript ? script : null,
      devGate: gate === undefined ? 'none' : gate ? 'pass' : 'fail',
    });
  }
  return facts;
}
