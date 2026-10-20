/**
 * Authorship accounting: what a script COST to write, so models can be compared
 * on cost per passing script.
 *
 * The metric is deliberately cumulative and unforgiving:
 *
 *   cost per passing script = every dollar spent on that model's scripts
 *                             ÷ scripts that clear the eval gate
 *
 * Drafts that never passed stay in the numerator. A model that needs four tries
 * to produce one working script is not cheaper than one that needs one, and a
 * metric that forgets failed drafts would reward burning attempts.
 *
 * Cost is never self-reported by the model: it comes either from the agent
 * platform's own usage rows (Hermes records `estimated_cost_usd` per session and
 * model in `state.db`) or from tokens multiplied by an explicit rate card.
 * Anything unpriced is flagged, not silently counted as free.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AuthorshipEntry {
  schemaVersion: 1;
  questId: string;
  /** Script the authoring session produced, relative to the repo root. */
  script: string;
  /** Content hash at record time: proves which bytes the cost bought. */
  scriptHash: string;
  model: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
  /** Spend in USD. Zero plus `unpriced` means "unknown", never "free". */
  costUsd: number;
  unpriced?: boolean;
  /** Where the numbers came from, so a reader can judge them. */
  source: 'session-import' | 'tokens-x-rates' | 'declared-cost';
  sessionId?: string;
  /** 1-based authoring attempt for this quest+model (drafts > 1 cost money too). */
  draft?: number;
  recordedAt: string;
  note?: string;
}

export interface ModelCostSummary {
  model: string;
  /** Distinct quests this model authored. */
  quests: string[];
  passingQuests: string[];
  drafts: number;
  inputTokens: number;
  outputTokens: number;
  spendUsd: number;
  /** null when nothing passed: dividing by zero must not read as '$0.00'. */
  costPerPassingScriptUsd: number | null;
  passRate: number;
  unpriced: boolean;
}

export function parseLedger(text: string): AuthorshipEntry[] {
  const entries: AuthorshipEntry[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    try {
      const parsed = JSON.parse(trimmed) as AuthorshipEntry;
      if (parsed?.schemaVersion === 1 && typeof parsed.questId === 'string' && typeof parsed.model === 'string') entries.push(parsed);
    } catch {
      /* a torn append is not a reason to lose the rest of the ledger */
    }
  }
  return entries;
}

export function readLedger(path: string): AuthorshipEntry[] {
  if (!existsSync(path)) return [];
  return parseLedger(readFileSync(path, 'utf-8'));
}

export function appendLedger(path: string, entry: AuthorshipEntry): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + '\n');
}

/**
 * Resolve spend for an entry that carries tokens but no dollar figure.
 * Returns null when the model has no rate card: the caller records `unpriced`
 * rather than inventing a price.
 */
export function priceTokens(
  inputTokens: number,
  outputTokens: number,
  rates: { inputPerMillion: number; outputPerMillion: number } | undefined,
): number | null {
  if (!rates) return null;
  const input = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0;
  const output = Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0;
  return (input / 1_000_000) * rates.inputPerMillion + (output / 1_000_000) * rates.outputPerMillion;
}

/**
 * Per-model summary. `passingQuests` is the set of quest ids that cleared the
 * eval gate in the joined report; spend always covers every recorded draft.
 */
export function summarizeAuthorship(entries: readonly AuthorshipEntry[], passingQuests: readonly string[]): ModelCostSummary[] {
  const passing = new Set(passingQuests);
  const byModel = new Map<string, AuthorshipEntry[]>();
  for (const entry of entries) {
    const list = byModel.get(entry.model) ?? [];
    list.push(entry);
    byModel.set(entry.model, list);
  }

  const summaries: ModelCostSummary[] = [];
  for (const [model, list] of byModel) {
    const quests = [...new Set(list.map(e => e.questId))].sort();
    const passingModelQuests = quests.filter(q => passing.has(q));
    const spendUsd = list.reduce((sum, e) => sum + (Number.isFinite(e.costUsd) ? e.costUsd : 0), 0);
    summaries.push({
      model,
      quests,
      passingQuests: passingModelQuests,
      drafts: list.length,
      inputTokens: list.reduce((sum, e) => sum + (e.inputTokens || 0), 0),
      outputTokens: list.reduce((sum, e) => sum + (e.outputTokens || 0), 0),
      spendUsd,
      costPerPassingScriptUsd: passingModelQuests.length ? spendUsd / passingModelQuests.length : null,
      passRate: quests.length ? passingModelQuests.length / quests.length : 0,
      unpriced: list.some(e => e.unpriced === true),
    });
  }

  // Cheapest first; models that produced nothing passing sort last.
  return summaries.sort((a, b) => {
    if (a.costPerPassingScriptUsd === null && b.costPerPassingScriptUsd === null) return a.model.localeCompare(b.model);
    if (a.costPerPassingScriptUsd === null) return 1;
    if (b.costPerPassingScriptUsd === null) return -1;
    return a.costPerPassingScriptUsd - b.costPerPassingScriptUsd;
  });
}

export function formatUsd(value: number | null): string {
  if (value === null) return '—';
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/** Table for a terminal or a PR body. */
export function formatAuthorship(summaries: readonly ModelCostSummary[]): string {
  if (!summaries.length) return 'no authorship records — record one with `bun quest-eval/author.ts record`';
  const pad = (value: string, width: number) => value.padEnd(width);
  const lines = [
    `${pad('model', 34)}${pad('scripts', 9)}${pad('passing', 9)}${pad('spend', 10)}${pad('$/passing', 12)}pass rate`,
  ];
  for (const summary of summaries) {
    lines.push(
      `${pad(summary.model, 34)}${pad(String(summary.quests.length), 9)}${pad(String(summary.passingQuests.length), 9)}${pad(formatUsd(summary.spendUsd), 10)}${pad(formatUsd(summary.costPerPassingScriptUsd), 12)}${Math.round(summary.passRate * 100)}%${summary.unpriced ? '  (includes unpriced entries)' : ''}`,
    );
  }
  return lines.join('\n');
}
