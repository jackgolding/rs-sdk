/**
 * Authorship ledger CLI — what a quest script cost to write.
 *
 *   # record the session that wrote (or fixed) a script, importing the agent
 *   # platform's own token/cost rows rather than trusting a self-report
 *   bun quest-eval/author.ts record --quest cook --script bots/quests/cooks-assistant.ts \
 *     --session 20261020_105056_c08c9f
 *
 *   # …or record tokens plus an explicit rate card
 *   bun quest-eval/author.ts record --quest demon --script bots/quests/demon-slayer.ts \
 *     --model anthropic/claude-opus-4 --input-tokens 120000 --output-tokens 9000 \
 *     --rate-in 15 --rate-out 75
 *
 *   # join the ledger with the newest eval report
 *   bun quest-eval/author.ts report
 *   bun quest-eval/author.ts report --eval quest-eval/reports/<stamp>/report.json --json
 *
 * The ledger is append-only JSONL: cost history is evidence, so entries are
 * never edited in place — a correction is another entry, and the note says why.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Database } from 'bun:sqlite';

import { appendLedger, formatAuthorship, formatUsd, priceTokens, readLedger, summarizeAuthorship } from './authoring.ts';
import type { AuthorshipEntry } from './authoring.ts';

const DEFAULT_LEDGER = 'quest-eval/authorship.jsonl';
const DEFAULT_STATE_DB = join(process.env.HOME ?? '', '.hermes', 'state.db');

interface Parsed {
  command: string;
  flags: Map<string, string>;
}

function parse(argv: string[]): Parsed {
  const [command, ...rest] = argv;
  if (!command) throw new Error('usage: author.ts <record|report> [--flag value ...]');
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const [key, inline] = arg.slice(2).split('=');
    if (inline !== undefined) flags.set(key!, inline);
    else if (rest[i + 1] && !rest[i + 1]!.startsWith('--')) flags.set(key!, rest[++i]!);
    else flags.set(key!, 'true');
  }
  return { command, flags };
}

function require_(flags: Map<string, string>, key: string): string {
  const value = flags.get(key);
  if (!value || value === 'true') throw new Error(`--${key} is required`);
  return value;
}

function numberFlag(flags: Map<string, string>, key: string): number | null {
  const raw = flags.get(key);
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${key} must be a non-negative number, got ${raw}`);
  return value;
}

interface UsageRow {
  model: string;
  provider: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

/**
 * Import the agent platform's own usage rows for one session.
 *
 * `title_generation` is dropped: it is UI metadata, not authoring. Everything
 * else counts, including subagent and review traffic — those tokens were spent
 * producing this script, so excluding them would flatter the model.
 */
function importSessionUsage(stateDb: string, sessionId: string): UsageRow[] {
  if (!existsSync(stateDb)) throw new Error(`no agent usage database at ${stateDb} (pass --state-db)`);
  const db = new Database(stateDb, { readonly: true });
  try {
    const rows = db
      .query<{ model: string; provider: string; calls: number; inp: number; out: number; cache: number; est: number; act: number }, [string]>(
        `SELECT model,
                billing_provider AS provider,
                SUM(api_call_count) AS calls,
                SUM(input_tokens) AS inp,
                SUM(output_tokens) AS out,
                SUM(cache_read_tokens) AS cache,
                SUM(estimated_cost_usd) AS est,
                SUM(actual_cost_usd) AS act
           FROM session_model_usage
          WHERE session_id = ? AND task != 'title_generation'
          GROUP BY model, billing_provider`,
      )
      .all(sessionId);
    if (!rows.length) throw new Error(`session '${sessionId}' has no usage rows in ${stateDb}`);
    return rows.map(row => ({
      model: row.model,
      provider: row.provider || 'unknown',
      calls: row.calls,
      inputTokens: row.inp,
      outputTokens: row.out,
      cacheReadTokens: row.cache,
      // Prefer billed cost; fall back to the platform's estimate. A row with
      // neither is unpriced, and the entry says so.
      costUsd: row.act > 0 ? row.act : row.est,
    }));
  } finally {
    db.close();
  }
}

function record(flags: Map<string, string>): number {
  const ledger = resolve(flags.get('ledger') ?? DEFAULT_LEDGER);
  const questId = require_(flags, 'quest');
  const script = require_(flags, 'script');
  if (!existsSync(script)) throw new Error(`script not found: ${script}`);
  const scriptHash = Bun.hash(readFileSync(script, 'utf-8')).toString(16);
  const note = flags.get('note');
  const draft = numberFlag(flags, 'draft') ?? undefined;
  const recordedAt = new Date().toISOString();

  const sessionId = flags.get('session');
  const base = {
    schemaVersion: 1 as const,
    questId,
    script,
    scriptHash,
    draft,
    recordedAt,
    ...(note ? { note } : {}),
  };

  if (sessionId) {
    const rows = importSessionUsage(resolve(flags.get('state-db') ?? DEFAULT_STATE_DB), sessionId);
    for (const row of rows) {
      const entry: AuthorshipEntry = {
        ...base,
        model: row.model,
        provider: row.provider,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        costUsd: row.costUsd,
        source: 'session-import',
        ...(row.costUsd > 0 ? {} : { unpriced: true }),
        sessionId,
      };
      appendLedger(ledger, entry);
      console.log(
        `recorded ${row.model}: ${row.inputTokens.toLocaleString()} in / ${row.outputTokens.toLocaleString()} out, ${formatUsd(row.costUsd)}${row.costUsd > 0 ? '' : ' (unpriced)'} for ${questId}`,
      );
    }
    return 0;
  }

  const model = require_(flags, 'model');
  const inputTokens = numberFlag(flags, 'input-tokens') ?? 0;
  const outputTokens = numberFlag(flags, 'output-tokens') ?? 0;
  const explicitCost = numberFlag(flags, 'cost-usd');
  const rateIn = numberFlag(flags, 'rate-in');
  const rateOut = numberFlag(flags, 'rate-out');

  let costUsd = explicitCost ?? 0;
  let source: AuthorshipEntry['source'] = 'declared-cost';
  let unpriced = false;
  if (explicitCost === null) {
    if (rateIn === null || rateOut === null) throw new Error('pass --cost-usd, or both --rate-in and --rate-out');
    const priced = priceTokens(inputTokens, outputTokens, { inputPerMillion: rateIn, outputPerMillion: rateOut });
    if (priced === null) {
      unpriced = true;
    } else {
      costUsd = priced;
      source = 'tokens-x-rates';
    }
  }

  const entry: AuthorshipEntry = {
    ...base,
    model,
    provider: flags.get('provider'),
    inputTokens,
    outputTokens,
    costUsd,
    source,
    ...(unpriced ? { unpriced: true } : {}),
  };
  appendLedger(ledger, entry);
  console.log(`recorded ${model}: ${formatUsd(costUsd)}${unpriced ? ' (unpriced)' : ''} for ${questId} -> ${ledger}`);
  return 0;
}

function newestEvalReport(repoRoot: string): string {
  const root = join(repoRoot, 'quest-eval', 'reports');
  if (!existsSync(root)) throw new Error('no eval reports yet — run `bun quest-eval/run.ts` first');
  const candidates = readdirSync(root)
    .map(name => join(root, name, 'report.json'))
    .filter(path => existsSync(path))
    .map(path => ({ path, mtime: statSync(path).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!candidates.length) throw new Error('no eval reports yet — run `bun quest-eval/run.ts` first');
  return candidates[0]!.path;
}

function report(flags: Map<string, string>): number {
  const ledger = resolve(flags.get('ledger') ?? DEFAULT_LEDGER);
  const entries = readLedger(ledger);
  const evalPath = resolve(flags.get('eval') ?? newestEvalReport(process.cwd()));
  const evalReport = JSON.parse(readFileSync(evalPath, 'utf-8')) as { suite: string; finishedAt: string; quests: { questId: string; gate: { ok: boolean } }[] };
  const passing = evalReport.quests.filter(q => q.gate.ok).map(q => q.questId);
  const summaries = summarizeAuthorship(entries, passing);

  if (flags.get('json') === 'true') {
    console.log(JSON.stringify({ ledger, eval: evalPath, passing, models: summaries }, null, 2));
    return 0;
  }

  console.log(`authorship vs ${evalReport.suite} (${evalReport.finishedAt})`);
  console.log(`passing quests: ${passing.length ? passing.join(', ') : '(none)'}\n`);
  console.log(formatAuthorship(summaries));
  const unpriced = summaries.filter(s => s.unpriced);
  if (unpriced.length) {
    console.log(`\nnote: unpriced entries for ${unpriced.map(s => s.model).join(', ')} — cost per passing script is a lower bound`);
  }
  return 0;
}

function main(): number {
  const { command, flags } = parse(process.argv.slice(2));
  if (command === 'record') return record(flags);
  if (command === 'report') return report(flags);
  throw new Error(`unknown command '${command}' (expected record or report)`);
}

try {
  process.exit(main());
} catch (error) {
  console.error(`author: ${(error as Error).message}`);
  process.exit(2);
}
