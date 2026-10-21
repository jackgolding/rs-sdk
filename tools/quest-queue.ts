#!/usr/bin/env bun
/**
 * quest-queue — the operator's handle on the quest backlog.
 *
 *   bun tools/quest-queue.ts init                     # seed/refresh quest-lab/status.json
 *   bun tools/quest-queue.ts status [--stage canary]  # what is where
 *   bun tools/quest-queue.ts plan --limit 3            # work orders to dispatch
 *   bun tools/quest-queue.ts next --owner agent-1 --limit 3
 *   bun tools/quest-queue.ts workorder cook           # the brief a subagent works from
 *   bun tools/quest-queue.ts freeze cook --sha <sha>  # freeze the candidate
 *   bun tools/quest-queue.ts dev cook --verdict PASS --runs 3/3 --report <dir>
  bun tools/quest-queue.ts canary cook --verdict PASS --run-id <id> --account qc1
 *   bun tools/quest-queue.ts block cook --reason "..."
 *   bun tools/quest-queue.ts advance cook dev-verified
 *   bun tools/quest-queue.ts promote cook --accounts Jackpoo1,Jackpoo2
 *
 * `init` is safe to re-run: entries that carry progress are never rewound.
 * `promote` is the only command that writes the fleet's todo list, and it
 * refuses any quest that has not passed a canary.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  QueueError,
  advance,
  block,
  claim,
  collectFacts,
  freeze,
  promote,
  readQueue,
  recordCanary,
  refreshEntries,
  sortForWork,
  writeQueue,
  type CatalogueEntry,
  type QueueFile,
  type Stage,
} from '../quest-lab/queue';

const ROOT = resolve(import.meta.dir, '..');
const STATUS = join(ROOT, 'quest-lab', 'status.json');
const CATALOGUE = join(ROOT, 'quest-lab', 'catalogue.json');

const now = () => new Date().toISOString();

function flags(argv: string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      if (inline !== undefined) map.set(k, inline);
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) map.set(k, argv[++i]);
      else map.set(k, 'true');
    } else positional.push(a);
  }
  return { positional, flags: map };
}

function loadCatalogue(): CatalogueEntry[] {
  return JSON.parse(readFileSync(CATALOGUE, 'utf-8')) as CatalogueEntry[];
}

let statusPath = STATUS;
function loadQueue(): QueueFile {
  if (!existsSync(statusPath)) {
    throw new QueueError(`no queue at ${statusPath} — run 'bun tools/quest-queue.ts init' first`);
  }
  return readQueue(statusPath);
}

function save(file: QueueFile): void {
  file.generatedAt = now();
  writeQueue(statusPath, file);
}

// ── commands ────────────────────────────────────────────────────────────────

function cmdInit(file: Map<string, string>): void {
  const catalogue = loadCatalogue();
  const facts = collectFacts(ROOT, catalogue);
  const previous = existsSync(STATUS) ? readQueue(STATUS).entries : [];
  const entries = refreshEntries(previous, catalogue, id => facts.get(id)!, now());
  const added = entries.filter(e => !previous.some(p => p.id === e.id)).length;
  save({ schemaVersion: 1, generatedAt: now(), entries });
  const counts = new Map<Stage, number>();
  for (const e of entries) counts.set(e.stage, (counts.get(e.stage) ?? 0) + 1);
  console.log(`queue: ${entries.length} quests (${added} new) -> quest-lab/status.json`);
  for (const [stage, n] of [...counts].sort()) console.log(`  ${stage.padEnd(13)} ${n}`);
}

function cmdPlan(file: Map<string, string>): void {
  const limit = Number(file.get('limit') ?? 3);
  const q = loadQueue();
  const claimable = sortForWork(q.entries).filter(
    e => !e.owner && e.stage !== 'blocked' && e.stage !== 'rolled-out' && e.stage !== 'canary',
  );
  console.log(`${claimable.length} claimable · showing ${Math.min(limit, claimable.length)}\n`);
  for (const e of claimable.slice(0, limit)) console.log(workOrder(e), '\n---\n');
  console.log('dispatch one subagent per work order, then claim each with:');
  for (const e of claimable.slice(0, limit)) console.log(`  bun tools/quest-queue.ts next --owner <agent> --limit 1   # for ${e.id}`);
}

function cmdStatus(file: Map<string, string>): void {
  const q = loadQueue();
  const stage = file.get('stage');
  const rows = sortForWork(q.entries.filter(e => !stage || e.stage === stage));
  if (file.get('json') === 'true') {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
  console.log(`${pad('quest', 14)} ${pad('stage', 13)} ${pad('owner', 12)} dev canary accounts  blockers`);
  for (const e of rows) {
    console.log(
      `${pad(e.id, 14)} ${pad(e.stage, 13)} ${pad(e.owner ?? '-', 12)} ${String(e.attempts.dev).padStart(3)} ${String(
        e.attempts.canary,
      ).padStart(6)} ${pad(String(e.rolledOutTo.length), 8)}  ${e.blockers.at(-1) ?? ''}`,
    );
  }
  console.log(`\n${rows.length} shown of ${q.entries.length}`);
}

function workOrder(e: QueueFile['entries'][number]): string {
  const dir = `~/rs-sdk-quests/${e.id}`;
  // A quest id is not a filename: `viking` lives in fremennik-trials.ts.
  const file = e.script ? e.script.split('/').pop()! : `${e.id}.ts`;
  const scriptPath = e.script ?? `bots/quests/${file}`;
  return `# Work order: ${e.name} (${e.id})

stage: ${e.stage}${e.owner ? ` · owner ${e.owner}` : ''} · dev attempts ${e.attempts.dev}/${e.budget.maxDevAttempts}
script: ${e.script ?? `(none yet — create bots/quests/${file})`}
fixture: ${e.fixture ?? `(none yet — author quest-lab/fixtures/${e.id}.json)`}

## 1. Isolate
\`\`\`bash
git -C ${ROOT} worktree add ${dir} -b quest/${e.id}
cd ${dir}          # your tree: never edit ~/rs-sdk (fleet) or another agent's worktree
\`\`\`

## 2. Build gates (seconds; a red gate is not a merge)
\`\`\`bash
bun build --target=bun ${scriptPath} --outdir /tmp/preflight-${e.id}
bun test quest-lab/tests quest-eval/tests
\`\`\`

## 3. Verify locally — fresh account per attempt
\`\`\`bash
bun quest-eval/run.ts --only ${e.id} --runs 3      # gate: >=80% over >=3 runs
\`\`\`
A pass means exit 0 **and** every required checkpoint PASS. Failure states land in
\`quest-eval/reports/<stamp>-<suite>/\`; read \`report.json\` before patching.

## 4. Freeze and canary (one account, prod image, prod clock)
\`\`\`bash
git add ${scriptPath} quest-lab/fixtures/${e.id}.json && git commit -m "quest(${e.id}): candidate"
bun tools/quest-queue.ts freeze ${e.id} --sha "$(git rev-parse --short=9 HEAD)"
bun tools/canary.sh <canary-account> ${file} --then-grade ${e.id}
\`\`\`

## 5. Report
- PASS -> \`bun tools/quest-queue.ts canary ${e.id} --verdict PASS --run-id <id> --account <acct>\`
- FAIL -> same with \`--verdict FAIL\`; the quest stays in canary and the attempt is counted.
- Exhausted budget or a content blocker -> \`bun tools/quest-queue.ts block ${e.id} --reason "..."\` with evidence.

## Non-negotiables
- One SDK controller per account. Stop before probing; never run two drivers.
- A rescue is an assisted attempt, not a pass — re-run clean after the fix.
- Credit progress on slow legs (\`noteProgress\`) and emit real effects (xp/inventory),
  or the supervisor reads a working bot as dead.
- Commit scoped paths only: never sweep another agent's dirty files.
`;
}

function cmdNext(file: Map<string, string>): void {
  const owner = file.get('owner');
  const limit = Number(file.get('limit') ?? 1);
  if (!owner) throw new QueueError('next needs --owner <agent-id>');
  const q = loadQueue();
  let claimed = 0;
  for (const e of sortForWork(q.entries)) {
    if (claimed >= limit) break;
    if (e.owner || e.stage === 'blocked' || e.stage === 'rolled-out' || e.stage === 'canary') continue;
    try {
      claim(q.entries, e.id, owner, now());
      claimed++;
      console.log(workOrder(q.entries.find(x => x.id === e.id)!));
      console.log('---\n');
    } catch (err) {
      if (!(err instanceof QueueError)) throw err;
    }
  }
  if (claimed === 0) console.log('nothing claimable — every open quest is owned, in canary, blocked or rolled out');
  save(q);
}

function cmdWorkorder(argv: string[]): void {
  const q = loadQueue();
  const e = q.entries.find(x => x.id === argv[0]);
  if (!e) throw new QueueError(`no quest '${argv[0]}'`);
  console.log(workOrder(e));
}

function scriptHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
}

function cmdFreeze(file: Map<string, string>, argv: string[]): void {
  const q = loadQueue();
  const e = q.entries.find(x => x.id === argv[0]);
  if (!e) throw new QueueError(`no quest '${argv[0]}'`);
  if (!e.script) throw new QueueError(`'${e.id}' has no script`);
  const sha = file.get('sha');
  if (!sha) throw new QueueError('freeze needs --sha <commit>');
  freeze(q.entries, e.id, { sha, scriptHash: scriptHash(join(ROOT, e.script)), frozenAt: now() });
  save(q);
  console.log(`froze ${e.id} at ${sha} (script ${scriptHash(join(ROOT, e.script))}) — edit nothing until the canary has run`);
}

function cmdCanary(file: Map<string, string>, argv: string[]): void {
  const q = loadQueue();
  const verdict = (file.get('verdict') ?? '').toUpperCase();
  if (!['PASS', 'FAIL', 'UNKNOWN'].includes(verdict)) throw new QueueError('canary needs --verdict PASS|FAIL|UNKNOWN');
  const runId = file.get('run-id') ?? file.get('run');
  if (!runId) throw new QueueError('canary needs --run-id <run directory or id>');
  const e = recordCanary(q.entries, argv[0], {
    account: file.get('account') ?? 'unrecorded',
    runId,
    verdict: verdict as 'PASS' | 'FAIL' | 'UNKNOWN',
    attempts: 1,
    at: now(),
  });
  save(q);
  console.log(`${e.id}: canary ${verdict} -> ${e.stage} (attempts ${e.attempts.canary}/${e.budget.maxCanaryAttempts})`);
  if (e.stage === 'fleet-ready') console.log(`next: bun tools/quest-queue.ts promote ${e.id} --accounts <bot,bot>`);
}

function cmdBlock(file: Map<string, string>, argv: string[]): void {
  const reason = file.get('reason');
  if (!reason) throw new QueueError('block needs --reason "..."');
  const q = loadQueue();
  block(q.entries, argv[0], reason, now());
  save(q);
  console.log(`blocked ${argv[0]}: ${reason}`);
}

function cmdAdvance(argv: string[]): void {
  const q = loadQueue();
  advance(q.entries, argv[0], argv[1] as Stage, now());
  save(q);
  console.log(`${argv[0]} -> ${argv[1]}`);
}

interface TodoItem {
  questId: string;
  script: string;
  addedAt: string;
  canaryRunId: string;
  done?: { at: string; runId: string };
}
interface TodoFile {
  schemaVersion: number;
  accounts: Record<string, TodoItem[]>;
}

const BOX = process.env.FLEET_BOX ?? 'root@5.223.71.192';
const SSH_KEY = process.env.FLEET_SSH_KEY ?? `${process.env.HOME}/.ssh/fleet-actions`;
/** The fleet's todo list is fleet STATE: it lives next to roster.json in the mounted bots dir. */
const BOX_TODO = process.env.FLEET_TODO ?? `${BOX}:/srv/fleet/bots/todo.json`;

function ssh(cmd: string, input?: string): { code: number; out: string; err: string } {
  const proc = Bun.spawnSync(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-i', SSH_KEY, BOX, cmd], {
    stdin: input === undefined ? undefined : new TextEncoder().encode(input),
  });
  return { code: proc.exitCode ?? 1, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

function readTodo(localPath?: string): TodoFile {
  if (localPath) {
    if (!existsSync(localPath)) return { schemaVersion: 1, accounts: {} };
    return JSON.parse(readFileSync(localPath, 'utf-8')) as TodoFile;
  }
  const r = ssh(`cat /srv/fleet/bots/todo.json 2>/dev/null || true`);
  if (r.code !== 0) throw new QueueError(`cannot read the fleet todo list: ${r.err.trim()}`);
  if (!r.out.trim()) return { schemaVersion: 1, accounts: {} };
  return JSON.parse(r.out) as TodoFile;
}

function writeTodo(todo: TodoFile, localPath?: string): void {
  const body = `${JSON.stringify(todo, null, 2)}\n`;
  if (localPath) {
    writeFileSync(localPath, body);
    return;
  }
  const r = ssh(`cat > /srv/fleet/bots/todo.json`, body);
  if (r.code !== 0) throw new QueueError(`cannot write the fleet todo list: ${r.err.trim()}`);
}

function canaryAccounts(): string[] {
  const path = join(ROOT, 'quest-lab', 'canaries.json');
  if (!existsSync(path)) throw new QueueError('no quest-lab/canaries.json — pass --accounts explicitly');
  const file = JSON.parse(readFileSync(path, 'utf-8')) as { accounts?: { name: string }[] };
  return (file.accounts ?? []).map(a => a.name);
}

function cmdDev(file: Map<string, string>, argv: string[]): void {
  const id = argv[0];
  if (!id) throw new QueueError('dev needs a quest id');
  const verdict = (file.get('verdict') ?? '').toUpperCase();
  if (verdict !== 'PASS' && verdict !== 'FAIL') throw new QueueError('dev needs --verdict PASS|FAIL');
  const report = file.get('report');
  if (!report) throw new QueueError('dev needs --report <quest-eval report dir or summary.md>');
  const runs = file.get('runs') ?? '?';
  const q = loadQueue();
  const e = q.entries.find(x => x.id === id);
  if (!e) throw new QueueError(`no quest '${id}' in the queue`);
  // Record the attempt (capped at the budget) and the evidence path. The harness
  // writes quest-eval/reports/<stamp>-<suite>/ but nothing used to tell the queue,
  // so `advance <quest> dev-verified` always refused with "needs a recorded dev
  // attempt" no matter how many green gates existed.
  e.attempts.dev = Math.min(e.attempts.dev + 1, e.budget.maxDevAttempts);
  e.notes = [...(e.notes ?? []), `dev ${verdict} ${runs} runs — ${report}`];
  if (verdict === 'PASS') e.blockers = (e.blockers ?? []).filter(b => !b.startsWith('dev gate'));
  e.updatedAt = now();
  save(q);
  console.log(`${id}: dev ${verdict} recorded (${runs} runs, attempts ${e.attempts.dev}/${e.budget.maxDevAttempts})`);
}

function cmdPromote(file: Map<string, string>, argv: string[]): void {
  const requested = (file.get('accounts') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  // Rolling out to the standing canary set is the default: they are the accounts
  // parked at a bank specifically to take a proven quest.
  const accounts = file.get('canaries') ? canaryAccounts() : requested;
  if (accounts.length === 0) throw new QueueError('promote needs --accounts bot1,bot2 (or --canaries)');
  const localTodo = file.get('todo');
  const q = loadQueue();
  const e = promote(q.entries, argv[0], accounts, now());
  if (!e.script || !e.canary) throw new QueueError(`'${e.id}' has no script or canary evidence`);

  const todo = readTodo(localTodo);
  for (const acct of accounts) {
    const list = (todo.accounts[acct] ??= []);
    if (!list.some(i => i.questId === e.id)) {
      list.push({ questId: e.id, script: e.script, addedAt: now(), canaryRunId: e.canary.runId });
    }
  }
  writeTodo(todo, localTodo);
  save(q);
  console.log(`rolled out ${e.id} -> ${accounts.join(', ')} (${localTodo ?? BOX_TODO})`);
  console.log('point those accounts at bots/quests/todo-runner.ts to grind the list; nothing restarts mid-run');
}

// ── entry ───────────────────────────────────────────────────────────────────

const { positional, flags: f } = flags(process.argv.slice(2));
if (f.get('status')) statusPath = resolve(f.get('status')!);
const [cmd, ...rest] = positional;

try {
  switch (cmd) {
    case 'init':
      cmdInit(f);
      break;
    case 'status':
      cmdStatus(f);
      break;
    case 'plan':
      cmdPlan(f);
      break;
    case 'next':
      cmdNext(f);
      break;
    case 'workorder':
      cmdWorkorder(rest);
      break;
    case 'freeze':
      cmdFreeze(f, rest);
      break;
    case 'canary':
      cmdCanary(f, rest);
      break;
    case 'block':
      cmdBlock(f, rest);
      break;
    case 'advance':
      cmdAdvance(rest);
      break;
    case 'dev':
      cmdDev(f, rest);
      break;
    case 'promote':
      cmdPromote(f, rest);
      break;
    default:
      console.error(readFileSync(import.meta.path, 'utf-8').split('\n').slice(1, 18).join('\n').replace(/^ \* ?/gm, ''));
      process.exit(2);
  }
} catch (err) {
  if (err instanceof QueueError) {
    console.error(`refused: ${err.message}`);
    process.exit(3);
  }
  throw err;
}
