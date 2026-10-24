/**
 * todo-runner — an account grinds its own todo list, one quest at a time, then
 * goes back to its normal job.
 *
 * Roster entry:
 *   bots/quests/todo-runner.ts <botname> [--then <script> [args…]]
 *
 * The list lives in fleet state (`/srv/fleet/bots/todo.json`, mounted at
 * /opt/fleet/bots/todo.json in a container), because only quests that PASSED a
 * canary are ever appended to it (`quest-queue.ts promote`). The list is the
 * PLAN; per-account progress lives next to the bot in
 * `bots/<Bot>/todo-state.json`, so 48 containers finishing quests at the same
 * time never race each other on one shared file. Legacy `done` markers inside
 * todo.json are still honoured (and mirrored best-effort).
 *
 * Why a parent process instead of a chain of `--then` handoffs: each quest gets a
 * FRESH SDK controller and the previous one has exited before the next starts.
 * Two controllers on one account pre-empt each other, so the sequencing is
 * strictly one-at-a-time.
 *
 * A failed quest no longer stops the list: it is recorded, retried once on a
 * second pass, and then skipped, so one bad quest cannot idle an account. When
 * nothing is left the runner hands over to `--then` (the bot's normal grind,
 * run as a child so the container never exits), or parks in a sleep loop. It
 * never exits 0 on its own — the box relaunches any exit-0 script every ~16s.
 * The list stays live: quests appended to todo.json later are picked up within
 * TODO_RECHECK_MIN (default 20) by pausing the grind, so a fleet-wide rollout of
 * a newly proven quest is a todo.json append — no deploy, no restart.
 *
 * Exit codes: 2 bad usage · 143 stopped by signal · otherwise the --then script's code.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// Self-contained on purpose: a container mounts only /srv/fleet/bots, so
// ../../quest-lab/* is unreachable at runtime. run-grade.ts keeps the verdict rules.
import { gradeRun } from './run-grade';

interface TodoItem {
  questId: string;
  script: string;
  args?: string[];
  addedAt: string;
  canaryRunId: string;
  done?: { at: string; runId: string };
}
interface TodoFile {
  schemaVersion: number;
  accounts: Record<string, TodoItem[]>;
}
interface ItemState {
  done?: { at: string; runId: string; alreadyComplete?: boolean };
  failures?: number;
  lastError?: string;
  lastAt?: string;
}
type StateFile = Record<string, ItemState>;

const MAX_FAILURES = 2;
const QUEST_CAP_MS = Number(process.env.TODO_QUEST_CAP_MIN ?? 180) * 60_000;
const argv = process.argv.slice(2);
const thenAt = argv.indexOf('--then');
const thenCmd = thenAt >= 0 ? argv.slice(thenAt + 1) : [];
const own = thenAt >= 0 ? argv.slice(0, thenAt) : argv;
const account = own.find(a => !a.startsWith('-'));
const dry = own.includes('--dry');
if (!account) {
  console.error('usage: bots/quests/todo-runner.ts <botname> [--dry] [--then <script> [args…]]');
  process.exit(2);
}

const stamp = () => new Date().toISOString();
const log = (msg: string) => console.log(`${stamp()} todo-runner: ${msg}`);
const botsDir = join(process.cwd(), 'bots');
const todoPath = process.env.TODO_FILE ?? join(botsDir, 'todo.json');

function resolveBotDir(): string {
  try {
    const hit = (readdirSync(botsDir) as string[]).find(d => d.toLowerCase() === account!.toLowerCase());
    if (hit) return join(botsDir, hit);
  } catch { /* fall through */ }
  return join(botsDir, account!);
}
const botDir = resolveBotDir();
const statePath = join(botDir, 'todo-state.json');

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}
function writeAtomic(path: string, data: unknown): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
}

function loadQueue(): TodoItem[] {
  if (!existsSync(todoPath)) return [];
  const todo = readJson<TodoFile>(todoPath, { schemaVersion: 1, accounts: {} });
  const key = Object.keys(todo.accounts ?? {}).find(a => a.toLowerCase() === account!.toLowerCase());
  return key ? todo.accounts[key]! : [];
}

const state: StateFile = readJson<StateFile>(statePath, {});
function saveState(): void {
  try {
    mkdirSync(botDir, { recursive: true });
    writeAtomic(statePath, state);
  } catch (err) {
    log(`WARN could not write ${statePath}: ${(err as Error).message}`);
  }
}

/** Best-effort mirror of a done marker into todo.json (re-read + atomic swap). */
function mirrorDone(questId: string, done: NonNullable<ItemState['done']>): void {
  try {
    const todo = readJson<TodoFile | null>(todoPath, null);
    if (!todo) return;
    const key = Object.keys(todo.accounts ?? {}).find(a => a.toLowerCase() === account!.toLowerCase());
    const item = key ? todo.accounts[key]!.find(i => i.questId === questId) : undefined;
    if (!item || item.done) return;
    item.done = { at: done.at, runId: done.runId };
    writeAtomic(todoPath, todo);
  } catch (err) {
    log(`WARN could not mirror done for ${questId} into todo.json: ${(err as Error).message}`);
  }
}

const isDone = (i: TodoItem) => Boolean(i.done || state[i.questId]?.done);
const exhausted = (i: TodoItem) => (state[i.questId]?.failures ?? 0) >= MAX_FAILURES;

const runsRoot = join(process.cwd(), 'quest-lab', 'runs');

/** The newest run record this attempt produced, matched by quest id + account. */
function newestRunFor(questId: string, since: number): string | null {
  if (!existsSync(runsRoot)) return null;
  let best: { dir: string; at: number } | null = null;
  for (const dir of readdirSync(runsRoot) as string[]) {
    const runPath = join(runsRoot, dir, 'run.json');
    if (!existsSync(runPath)) continue;
    const run = readJson<{ questId?: string; createdAt?: string; account?: string } | null>(runPath, null);
    if (!run || run.questId !== questId) continue;
    if (run.account && run.account.toLowerCase() !== account!.toLowerCase()) continue;
    const at = Date.parse(run.createdAt ?? '') || 0;
    if (at < since) continue;
    if (!best || at > best.at) best = { dir: join(runsRoot, dir), at };
  }
  return best?.dir ?? null;
}

let child: ReturnType<typeof Bun.spawn> | null = null;
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    stopping = true;
    log(`${sig} — forwarding to child and stopping`);
    if (!child) process.exit(143);
    try { child.kill(sig); } catch { /* already gone */ }
    setTimeout(() => process.exit(143), 25_000);
  });
}

/** Run a script as a child, streaming its output; keep a tail for verdict hints. */
async function runChild(cmd: string[], capMs = 0): Promise<{ code: number; tail: string }> {
  const proc = Bun.spawn(['bun', ...cmd], { stdout: 'pipe', stderr: 'inherit' });
  child = proc;
  // A wedged quest must not hold the account forever: past the cap it is a
  // failure like any other and the list moves on.
  const cap = capMs > 0 ? setTimeout(() => {
    log(`${cmd[0]} exceeded ${Math.round(capMs / 60_000)}m — killing it`);
    try { proc.kill('SIGTERM'); } catch { /* gone */ }
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } }, 30_000);
  }, capMs) : null;
  let tail = '';
  const reader = proc.stdout.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    process.stdout.write(value);
    tail = (tail + dec.decode(value, { stream: true })).slice(-65_536);
  }
  const code = (await proc.exited) ?? 1;
  if (cap) clearTimeout(cap);
  child = null;
  return { code, tail };
}

async function runItem(item: TodoItem): Promise<void> {
  const scriptPath = join(process.cwd(), item.script);
  const st = (state[item.questId] ??= {});
  const fail = (why: string) => {
    st.failures = (st.failures ?? 0) + 1;
    st.lastError = why;
    st.lastAt = stamp();
    saveState();
    log(`${item.questId} FAILED (${st.failures}/${MAX_FAILURES}): ${why}`);
  };
  if (!existsSync(scriptPath)) return fail(`script missing at ${item.script}`);

  log(`=== ${item.questId} on ${account} (${item.script}) ===`);
  const startedAt = Date.now();
  const { code, tail } = await runChild([item.script, account!, ...(item.args ?? [])], QUEST_CAP_MS);
  if (stopping) return;
  if (code !== 0) return fail(`exited ${code}`);

  const dir = newestRunFor(item.questId, startedAt - 60_000);
  if (!dir) {
    // Scripts that probe the journal first answer an already-finished account
    // with this line and leave nothing to grade — that IS done for this account.
    if (/already (been )?complete|already completed/i.test(tail)) {
      st.done = { at: stamp(), runId: 'already-complete', alreadyComplete: true };
      saveState();
      mirrorDone(item.questId, st.done);
      log(`${item.questId} already complete on ${account} — marked done`);
      return;
    }
    return fail('exited 0 but wrote no run record');
  }
  const grade = gradeRun(dir);
  if (grade.verdict !== 'PASS') return fail(`evidence gate: ${grade.reason} (record ${dir})`);

  st.done = { at: stamp(), runId: grade.runId ?? dir };
  delete st.lastError;
  saveState();
  mirrorDone(item.questId, st.done);
  log(`${item.questId} PASS — ${grade.reason}`);
}

const RECHECK_MS = Number(process.env.TODO_RECHECK_MIN ?? 20) * 60_000;
let queue = loadQueue();
const pending = () => queue.filter(i => !isDone(i) && !exhausted(i));
log(`${account} — ${pending().length} pending of ${queue.length}${thenCmd.length ? ` · then ${thenCmd.join(' ')}` : ''}`);
for (const item of pending()) {
  const f = state[item.questId]?.failures ?? 0;
  log(`  next: ${item.questId} (${item.script})${f ? ` failures=${f}` : ''}`);
}
if (dry) process.exit(0);

async function drain(): Promise<void> {
  // Two passes so a quest that failed once (contention, a dropped link) gets a
  // second go after the others; then the list is finished either way.
  for (let pass = 1; pass <= MAX_FAILURES && !stopping; pass++) {
    const todo = pending();
    if (todo.length === 0) break;
    if (pass > 1) log(`retry pass ${pass}: ${todo.map(i => i.questId).join(', ')}`);
    for (const item of todo) {
      if (stopping) break;
      await runItem(item);
    }
  }
  const doneN = queue.filter(isDone).length;
  const gaveUp = queue.filter(i => !isDone(i)).map(i => `${i.questId}(${state[i.questId]?.lastError ?? 'skipped'})`);
  log(`list finished: ${doneN}/${queue.length} done${gaveUp.length ? ` · gave up: ${gaveUp.join('; ')}` : ''}`);
}

/** True when the shared list gained work for this account since the last drain. */
function listGrew(): boolean {
  queue = loadQueue();
  return pending().length > 0;
}

// The list is LIVE: promoting a new quest only appends to todo.json, and every
// runner already handed over to its grind notices within RECHECK_MS, pauses the
// grind (SIGTERM — grind jobs drain on it), runs the new quest, and resumes.
// Rolling a quest out to the whole fleet therefore needs no deploy and no restart.
for (;;) {
  await drain();
  if (stopping) process.exit(143);
  if (thenCmd.length) {
    log(`handing over to ${thenCmd.join(' ')}`);
    const run = runChild(thenCmd);
    let exited: { code: number } | null = null;
    let paused = false;
    run.then(r => { exited = r; });
    while (!exited && !stopping) {
      await Promise.race([run, Bun.sleep(RECHECK_MS)]);
      if (exited || stopping) break;
      if (listGrew()) {
        log(`new quests on the list (${pending().map(i => i.questId).join(', ')}) — pausing ${thenCmd[0]}`);
        paused = true;
        try { child?.kill('SIGTERM'); } catch { /* gone */ }
        await run;
        break;
      }
    }
    if (stopping) process.exit(143);
    if (paused) continue;
    // The grind ended on its own: surface its exit code to the supervisor.
    process.exit((exited as { code: number } | null)?.code ?? 1);
  }
  log('nothing to hand over to — parked (add --then <script> [args] to the roster args)');
  for (;;) {
    await Bun.sleep(RECHECK_MS);
    if (listGrew()) break;
    log('parked');
  }
}
