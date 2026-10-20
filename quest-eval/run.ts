/**
 * quest-eval — run quest scripts N times from fixed fixtures and gate on results.
 *
 *   bun quest-eval/run.ts                            # default suite, local world
 *   bun quest-eval/run.ts --suite quest-eval/suites/smoke.json --runs 3
 *   bun quest-eval/run.ts --only cook --runs 5 --gate 0.8
 *   bun quest-eval/run.ts --dry                      # print the plan, stage nothing
 *
 * Exit codes: 0 gate passed · 1 gate failed · 2 the harness could not run.
 * That split is deliberate: a red CI job must say whether the *script* regressed
 * or the *runner* did, without a human reading the log.
 *
 * Requires a running local world (engine on :8888, gateway on :7780) and the
 * local-only fixture materializer at `server/engine/tools/server/quest-lab-fixture.ts`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { attemptLogStamp, hashFixture, runAttempt, scriptExists } from './attempt.ts';
import { buildReport, formatMarkdown, formatReport, resolveGate } from './report.ts';
import type { AttemptResult, GateSpec, Suite, SuiteQuest } from './types.ts';

interface Args {
  suite: string;
  repoRoot: string;
  webUrl: string;
  gatewayUrl: string;
  outDir: string;
  only: string[];
  runs: number | null;
  timeoutMs: number | null;
  gate: Partial<GateSpec>;
  tickRateMs: number | null;
  dry: boolean;
  quiet: boolean;
  json: boolean;
  stopOnFail: boolean;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const [key, inline] = arg.slice(2).split('=');
    if (inline !== undefined) flags.set(key!, inline);
    else if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) flags.set(key!, argv[++i]!);
    else flags.set(key!, 'true');
  }
  const number = (key: string): number | null => {
    const raw = flags.get(key);
    if (raw === undefined) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`--${key} must be a positive number, got ${raw}`);
    return value;
  };
  return {
    suite: flags.get('suite') ?? 'quest-eval/suites/smoke.json',
    repoRoot: resolve(flags.get('repo') ?? process.cwd()),
    webUrl: (flags.get('web') ?? 'http://127.0.0.1:8888').replace(/\/$/, ''),
    gatewayUrl: (flags.get('gateway') ?? 'http://127.0.0.1:7780').replace(/\/$/, ''),
    outDir: flags.get('out') ?? 'quest-eval/reports',
    only: (flags.get('only') ?? '').split(',').map(s => s.trim()).filter(Boolean),
    runs: number('runs'),
    timeoutMs: flags.has('timeout') ? Math.round(number('timeout')! * 1000) : null,
    gate: {
      ...(flags.has('gate') ? { minPassRate: number('gate')! } : {}),
      ...(flags.has('min-runs') ? { minRuns: Math.round(number('min-runs')!) } : {}),
    },
    tickRateMs: flags.has('tickrate') ? Math.round(number('tickrate')!) : null,
    dry: flags.get('dry') === 'true',
    quiet: flags.get('quiet') === 'true',
    json: flags.get('json') === 'true',
    stopOnFail: flags.get('stop-on-fail') === 'true',
  };
}

function loadSuite(repoRoot: string, path: string): Suite {
  const full = resolve(repoRoot, path);
  if (!existsSync(full)) throw new Error(`suite not found: ${full}`);
  const suite = JSON.parse(readFileSync(full, 'utf-8')) as Suite;
  if (suite.schemaVersion !== 1) throw new Error(`suite schemaVersion must be 1, got ${JSON.stringify(suite.schemaVersion)}`);
  if (!Array.isArray(suite.quests) || !suite.quests.length) throw new Error('suite declares no quests');
  return suite;
}

/**
 * Account code for a quest: 4 chars of the quest id (or an explicit override).
 * Kept short because the engine caps usernames at 12 characters and the fixture
 * namespace requires `ql…`.
 */
function accountCode(quest: SuiteQuest): string {
  const raw = (quest.accountCode ?? quest.questId).toLowerCase().replace(/[^a-z0-9]/g, '');
  const code = raw.slice(0, 4);
  if (code.length < 2) throw new Error(`quest '${quest.questId}' needs an explicit accountCode (>=2 alnum chars)`);
  return code;
}

/**
 * One account per attempt, unique per INVOCATION: the per-run token keeps a
 * re-run from colliding with a name a previous invocation already burned (a
 * fixture name is one-shot, and a logged-out body lingers in
 * `/playerpositions` for minutes, so reusing `…r1` across runs fails closed).
 */
function accountFor(quest: SuiteQuest, attempt: number, runToken: string): string {
  const account = `qle${accountCode(quest)}${runToken}${attempt}`;
  if (!/^ql[a-z0-9_]{3,10}$/.test(account)) throw new Error(`generated account '${account}' is outside the ql… fixture namespace`);
  return account;
}

/** Short per-invocation token: 3 base36 chars of the clock, so names stay ≤12. */
function invocationToken(): string {
  return Date.now().toString(36).slice(-3);
}

function contentHash(repoRoot: string): string {
  try {
    const result = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD'], { cwd: repoRoot, stdout: 'pipe', stderr: 'pipe' });
    return new TextDecoder().decode(result.stdout).trim() || 'unrecorded';
  } catch {
    return 'unrecorded';
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const suite = loadSuite(args.repoRoot, args.suite);
  // One token per invocation: printed plans and real runs must agree on names.
  const token = invocationToken();
  const gate = resolveGate(suite, args.gate);
  const quests = args.only.length ? suite.quests.filter(q => args.only.includes(q.questId)) : suite.quests;
  if (!quests.length) throw new Error(`no quest matched --only ${args.only.join(',')}`);

  const fixtureTool = join(args.repoRoot, 'server/engine/tools/server/quest-lab-fixture.ts');
  if (!args.dry && !existsSync(fixtureTool)) {
    throw new Error(`fixture materializer missing at ${fixtureTool} — it is local-only tooling, so run quest-eval from the offline worktree`);
  }

  // Validate the whole plan before staging anything: a typo discovered on
  // quest 4 of 5 after 40 minutes of play is expensive.
  const plan = quests.map(quest => {
    if (!scriptExists(args.repoRoot, quest.script)) throw new Error(`${quest.questId}: script not found at ${quest.script}`);
    if (!existsSync(join(args.repoRoot, quest.fixture))) throw new Error(`${quest.questId}: fixture not found at ${quest.fixture}`);
    const runs = args.runs ?? quest.runs ?? suite.runs ?? gate.minRuns;
    return {
      quest,
      runs,
      timeoutMs: args.timeoutMs ?? quest.timeoutMs ?? suite.timeoutMs ?? 900_000,
      fixtureHash: hashFixture(args.repoRoot, quest.fixture),
    };
  });

  if (args.dry) {
    console.log(`suite ${suite.name}: ${plan.length} quest(s), gate ≥${(gate.minPassRate * 100).toFixed(0)}% over ≥${gate.minRuns} runs`);
    for (const entry of plan) {
      const accounts = Array.from({ length: entry.runs }, (_, i) => accountFor(entry.quest, i + 1, token));
      console.log(
        `  ${entry.quest.questId.padEnd(16)} ${entry.runs}× ${entry.quest.script} ← ${entry.quest.fixture} (${Math.round(entry.timeoutMs / 1000)}s each)`,
      );
      console.log(`  ${''.padEnd(16)} accounts: ${accounts.join(', ')}`);
    }
    return 0;
  }

  const startedAt = new Date();
  const base = join(args.repoRoot, 'quest-eval', 'reports', `${attemptLogStamp()}-${suite.name}`);
  const logsRoot = join(base, 'logs');
  mkdirSync(logsRoot, { recursive: true });
  const rev = contentHash(args.repoRoot);

  const attempts: AttemptResult[] = [];
  let harnessFailures = 0;

  outer: for (const entry of plan) {
    for (let attempt = 1; attempt <= entry.runs; attempt++) {
      const account = accountFor(entry.quest, attempt, token);
      console.log(`▶ ${entry.quest.questId} ${attempt}/${entry.runs} — ${account}`);
      const result = await runAttempt(
        {
          repoRoot: args.repoRoot,
          webUrl: args.webUrl,
          gatewayUrl: args.gatewayUrl,
          logsRoot,
          quiet: args.quiet,
          declaredTickRateMs: args.tickRateMs ?? undefined,
        },
        {
          questId: entry.quest.questId,
          script: entry.quest.script,
          fixture: entry.quest.fixture,
          account,
          attempt,
          timeoutMs: entry.timeoutMs,
          fixtureHash: entry.fixtureHash,
          contentHash: rev,
        },
      );
      attempts.push(result);
      if (result.status === 'error') harnessFailures++;
      const label = result.status.toUpperCase();
      const where = result.failureState ? ` @ ${result.failureState}` : '';
      console.log(`  ${label}${where} in ${Math.round(result.durationMs / 1000)}s (${result.recoveries} recoveries)`);
      if (result.failureReason) console.log(`  reason: ${result.failureReason}`);
      if (args.stopOnFail && result.status !== 'pass') break outer;
    }
  }

  const report = buildReport(suite.name, plan.map(p => p.quest), attempts, gate, startedAt, new Date());
  writeFileSync(join(base, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(base, 'summary.md'), formatMarkdown(report) + '\n');

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log('\n' + formatReport(report));
  console.log(`\nartifacts: ${base}`);

  // A harness failure is never a pass: an unevaluated quest must not ship.
  if (harnessFailures) return 2;
  return report.ok ? 0 : 1;
}

main()
  .then(code => process.exit(code))
  .catch((error: Error) => {
    console.error(`quest-eval: ${error.message}`);
    process.exit(2);
  });
