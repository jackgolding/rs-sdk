import { expect, test } from 'bun:test';
import {
  QueueError,
  advance,
  block,
  canTransition,
  claim,
  deriveStage,
  freeze,
  promote,
  recordCanary,
  refreshEntries,
  seedEntry,
  sortForWork,
  type CatalogueEntry,
  type QueueEntry,
} from '../queue';

const now = '2026-10-20T12:00:00.000Z';
const cat = (id: string, script: string | null = `bots/quests/${id}.ts`): CatalogueEntry => ({
  id,
  name: id.toUpperCase(),
  primaryScript: script,
  blockers: [],
});

const entry = (over: Partial<QueueEntry> = {}): QueueEntry => {
  const base = seedEntry(cat('cook'), { hasScript: true, hasFixture: true, devGate: 'pass' }, now);
  return { ...base, ...over };
};

test('deriveStage walks script -> fixture -> dev gate', () => {
  expect(deriveStage({ hasScript: false, hasFixture: false, devGate: 'none' })).toBe('catalogued');
  expect(deriveStage({ hasScript: true, hasFixture: false, devGate: 'none' })).toBe('fixture');
  expect(deriveStage({ hasScript: true, hasFixture: true, devGate: 'none' })).toBe('drafting');
  expect(deriveStage({ hasScript: true, hasFixture: true, devGate: 'pass' })).toBe('dev-verified');
});

test('claim is an exclusive lock and counts an attempt', () => {
  const entries = [entry({ stage: 'drafting' })];
  const claimed = claim(entries, 'cook', 'agent-a', now);
  expect(claimed.owner).toBe('agent-a');
  expect(claimed.attempts.dev).toBe(1);
  expect(() => claim(entries, 'cook', 'agent-b', now)).toThrow(QueueError);
  // The same owner may re-claim (a retry), and it counts against the budget.
  expect(claim(entries, 'cook', 'agent-a', now).attempts.dev).toBe(2);
});

test('claiming a dev-verified quest to run its canary does not rewind it to drafting', () => {
  const entries = [entry({ stage: 'dev-verified' })];
  const claimed = claim(entries, 'cook', 'agent-a', now);
  expect(claimed.stage).toBe('dev-verified');
  expect(claimed.owner).toBe('agent-a');
});

test('claim refuses blocked, rolled-out and in-canary quests', () => {
  expect(() => claim([entry({ stage: 'blocked', blockers: ['content bug'] })], 'cook', 'a', now)).toThrow(/blocked/);
  expect(() => claim([entry({ stage: 'rolled-out' })], 'cook', 'a', now)).toThrow(/rolled out/);
  expect(() => claim([entry({ stage: 'canary' })], 'cook', 'a', now)).toThrow(/serialized/);
});

test('claim enforces the dev attempt budget', () => {
  const entries = [entry({ stage: 'drafting', attempts: { dev: 6, canary: 0 } })];
  expect(() => claim(entries, 'cook', 'a', now)).toThrow(/out of dev attempts/);
});

test('fleet-ready is impossible without a passing canary on a frozen candidate', () => {
  const entries = [entry({ stage: 'canary' })];
  expect(canTransition(entries[0], 'fleet-ready').ok).toBe(false);

  const withCandidate = [entry({ stage: 'canary', candidate: { sha: 'abc', scriptHash: 'def', frozenAt: now } })];
  expect(canTransition(withCandidate[0], 'fleet-ready').reason).toMatch(/canary/);

  recordCanary(withCandidate, 'cook', { account: 'canary1', runId: 'r1', verdict: 'PASS', attempts: 1, at: now });
  expect(withCandidate[0].stage).toBe('fleet-ready');
  expect(withCandidate[0].owner).toBeNull();
});

test('a failed canary keeps the quest in canary, and the budget eventually blocks it', () => {
  const entries = [
    entry({
      stage: 'canary',
      candidate: { sha: 'abc', scriptHash: 'def', frozenAt: now },
      budget: { maxDevAttempts: 6, maxCanaryAttempts: 2, deadline: null },
    }),
  ];
  recordCanary(entries, 'cook', { account: 'canary1', runId: 'r1', verdict: 'FAIL', attempts: 1, at: now });
  expect(entries[0].stage).toBe('canary');
  recordCanary(entries, 'cook', { account: 'canary2', runId: 'r2', verdict: 'FAIL', attempts: 1, at: now });
  expect(entries[0].stage).toBe('blocked');
  expect(entries[0].blockers.at(-1)).toMatch(/canary budget exhausted/);
});

test('rolled-out requires an account, and promote dedupes', () => {
  const entries = [entry({ stage: 'fleet-ready', canary: { account: 'c', runId: 'r', verdict: 'PASS', attempts: 1, at: now } })];
  expect(canTransition(entries[0], 'rolled-out').ok).toBe(false);
  promote(entries, 'cook', ['Jackpoo1', 'Jackpoo2'], now);
  promote(entries, 'cook', ['Jackpoo2', 'Jackpoo3'], now);
  expect(entries[0].rolledOutTo).toEqual(['Jackpoo1', 'Jackpoo2', 'Jackpoo3']);
  expect(() => promote([entry({ stage: 'canary' })], 'cook', ['x'], now)).toThrow(/fleet-ready/);
});

test('advance refuses undeclared edges and frozen work needs a script', () => {
  const entries = [entry({ stage: 'catalogued' })];
  expect(() => advance(entries, 'cook', 'fleet-ready', now)).toThrow(/not a declared transition/);
  expect(() => freeze([entry({ stage: 'drafting', script: null })], 'cook', { sha: 'a', scriptHash: 'b', frozenAt: now })).toThrow(/no script/);
});

test('a refresh never rewinds an entry that carries progress', () => {
  const progressed = entry({ stage: 'canary', owner: 'agent-a', attempts: { dev: 2, canary: 1 } });
  const fresh = refreshEntries([progressed], [cat('cook')], () => ({ hasScript: false, hasFixture: false, devGate: 'none' }), now);
  expect(fresh[0].stage).toBe('canary');
  expect(fresh[0].owner).toBe('agent-a');

  const untouchedEntry = entry({ stage: 'catalogued', script: null, fixture: null });
  const refreshed = refreshEntries([untouchedEntry], [cat('cook')], () => ({ hasScript: true, hasFixture: true, devGate: 'pass' }), now);
  expect(refreshed[0].stage).toBe('dev-verified');
});

test('block clears the owner and records the reason', () => {
  const entries = [entry({ stage: 'drafting', owner: 'agent-a' })];
  block(entries, 'cook', 'no walkable route to the tent', now);
  expect(entries[0].owner).toBeNull();
  expect(entries[0].blockers.at(-1)).toMatch(/walkable route/);
});

test('work order prefers locally proven quests over the long tail', () => {
  const entries = [
    entry({ id: 'a', stage: 'catalogued' }),
    entry({ id: 'b', stage: 'dev-verified' }),
    entry({ id: 'c', stage: 'fixture' }),
    entry({ id: 'd', stage: 'blocked' }),
  ];
  expect(sortForWork(entries).map(e => e.id)).toEqual(['b', 'c', 'a', 'd']);
});
