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
 * second pass (at once for a Legends prerequisite), and then skipped, so one bad
 * quest cannot idle an account. NEEDS STOCK and a missing prerequisite are not
 * failures: the quest waits, and comes back when the mule's stock file shows the
 * lines or after a back-off (todo-logic.ts). `bots/<Bot>/todo-rearm.json`, a list
 * of quest ids, clears their failures without freezing the runner. When
 * nothing is left the runner hands over to `--then` (the bot's normal grind,
 * run as a child so the container never exits), or parks in a sleep loop. It
 * never exits 0 on its own — the box relaunches any exit-0 script every ~16s.
 * The list stays live: quests appended to todo.json later are picked up within
 * TODO_RECHECK_MIN (default 20) by pausing the grind, so a fleet-wide rollout of
 * a newly proven quest is a todo.json append — no deploy, no restart.
 *
 * A quest whose concurrency slots are all taken is DEFERRED, not waited on: the
 * child runs with QUEST_SLOT_NOWAIT=1 and exits SLOTS_FULL_EXIT at once, the list
 * moves on (no failure counted), and the deferred quest is retried on the next
 * pass, or after the grind's next live-list check. 21 accounts used to stand idle
 * waiting on Knight's Sword's 3 slots (2026-10-30).
 *
 * Exit codes: 2 bad usage · 143 stopped by signal · otherwise the --then script's code.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// Self-contained on purpose: a container mounts only /srv/fleet/bots, so
// ../../quest-lab/* is unreachable at runtime. run-grade.ts keeps the verdict rules.
import { gradeRun } from './run-grade';
import { blockedBy, classifyExit, onLegendsPath, readMuleStocks, stockArrived, waitMinutes } from './todo-logic';

interface TodoItem {
  questId: string;
  script: string;
  args?: string[];
  /** Minutes before the runner stops the item (default TODO_QUEST_CAP_MIN): long tasks like a 30-trip scale run. */
  capMin?: number;
  addedAt: string;
  canaryRunId: string;
  done?: { at: string; runId: string };
  /** Quest ids on this list that must be done first. */
  after?: string[];
}
interface TodoFile {
  schemaVersion: number;
  accounts: Record<string, TodoItem[]>;
}
interface ItemState {
  done?: { at: string; runId: string; alreadyComplete?: boolean };
  failures?: number;
  deferredAt?: string;
  /** Slot dir (bots/.quest-slots/<id>) and its size, from the deferring child's `[slots id/max]` line. */
  slotId?: string;
  slotMax?: number;
  lastError?: string;
  lastAt?: string;
  /** Paused by NEEDS STOCK or a prerequisite gate: no failure counted. Not before `waitUntil` unless the stock arrives. */
  wait?: {
    kind: 'stock' | 'prereq';
    why: string;
    since: string;
    lastAt: string;
    until: string;
    attempts: number;
    short?: Array<{ item: string; count: number }>;
  };
}
type StateFile = Record<string, ItemState>;

const MAX_FAILURES = 2;
/** lib/no-client-waits.ts SLOTS_FULL_EXIT: the quest's slots were full and it did nothing. */
const SLOTS_FULL_EXIT = 75;
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
/** The prerequisite holding an item back, re-read before every quest (ABGARMY06 started Heroes right after Dragon Slayer failed). */
const blocker = (i: TodoItem) => blockedBy(i, queue, isDone);
const blocked = (i: TodoItem) => blocker(i) !== undefined;

/** Don't re-run a stock wait sooner than this even if the mule shows the lines: its trade may be what failed. */
const STOCK_RETRY_FLOOR_MS = 15 * 60_000;
const waiting = (i: TodoItem) => {
  const w = state[i.questId]?.wait;
  if (!w) return false;
  const now = Date.now();
  if (now >= Date.parse(w.until)) return false;
  if (w.kind !== 'stock' || now - Date.parse(w.lastAt) < STOCK_RETRY_FLOOR_MS) return true;
  return !stockArrived(w.short ?? [], readMuleStocks(botsDir));
};

/** Hand re-arms: a list of quest ids in todo-rearm.json. A running runner rewrites todo-state.json, so editing that gets clobbered. */
function applyRearms(): void {
  const path = join(botDir, 'todo-rearm.json');
  if (!existsSync(path)) return;
  const ids = readJson<string[]>(path, []);
  try {
    rmSync(path);
  } catch {
    return;
  }
  for (const id of ids) {
    const st = state[id];
    if (!st) continue;
    delete st.failures;
    delete st.lastError;
    delete st.wait;
    log(`${id} re-armed by todo-rearm.json`);
  }
  saveState();
}

const runsRoot = join(process.cwd(), 'quest-lab', 'runs');

/**
 * The newest run record this attempt produced. Matched by account and time, not by id: a todo id is
 * often not the script's own (`heroes` / `heroes-quest`, `arrav` / `shield-of-arrav`, `upass-r2`), so
 * finished quests were logged "exited 0 but wrote no run record". One quest runs per account at a time.
 */
function newestRunFor(since: number): string | null {
  if (!existsSync(runsRoot)) return null;
  let best: { dir: string; at: number } | null = null;
  for (const dir of readdirSync(runsRoot) as string[]) {
    const runPath = join(runsRoot, dir, 'run.json');
    if (!existsSync(runPath)) continue;
    const run = readJson<{ createdAt?: string; account?: string } | null>(runPath, null);
    if (!run || run.account?.toLowerCase() !== account!.toLowerCase()) continue;
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
  const proc = Bun.spawn(['bun', ...cmd], { stdout: 'pipe', stderr: 'inherit', env: { ...process.env, QUEST_SLOT_NOWAIT: '1' } });
  child = proc;
  // A wedged quest must not hold the account forever: past the cap it is a
  // failure like any other and the list moves on.
  const cap = capMs > 0 ? setTimeout(() => {
    log(`${cmd[0]} exceeded ${Math.round(capMs / 60_000)}m — stopping it (SIGTERM; it banks first)`);
    try { proc.kill('SIGTERM'); } catch { /* gone */ }
    // Past the child's own 300s drain: a SIGKILL at 30s left jacklove10 in the Taverley dungeon (2026-10-31).
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } }, 360_000);
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

/** Returns 'failed' when this attempt counted as a failure, 'outage' when the game client was gone throughout. */
async function runItem(item: TodoItem): Promise<'failed' | 'outage' | 'ok'> {
  const scriptPath = join(process.cwd(), item.script);
  const st = (state[item.questId] ??= {});
  const fail = (why: string) => {
    st.failures = (st.failures ?? 0) + 1;
    st.lastError = why;
    st.lastAt = stamp();
    saveState();
    log(`${item.questId} FAILED (${st.failures}/${MAX_FAILURES}): ${why}`);
    return 'failed' as const;
  };
  const finish = (how: string, runId: string, already = false) => {
    st.done = { at: stamp(), runId, ...(already ? { alreadyComplete: true } : {}) };
    delete st.lastError;
    delete st.deferredAt;
    delete st.wait;
    saveState();
    mirrorDone(item.questId, st.done);
    log(`${item.questId} PASS — ${how}`);
    return 'ok' as const;
  };
  const pause = (kind: 'stock' | 'prereq', why: string, short?: Array<{ item: string; count: number }>) => {
    const attempts = (st.wait?.attempts ?? 0) + 1;
    const now = Date.now();
    const minutes = waitMinutes(attempts);
    st.wait = {
      kind,
      why,
      since: st.wait?.since ?? new Date(now).toISOString(),
      lastAt: new Date(now).toISOString(),
      until: new Date(now + minutes * 60_000).toISOString(),
      attempts,
      ...(short?.length ? { short } : {}),
    };
    saveState();
    log(`${item.questId} waiting on ${kind}: ${why} (no failure counted; stop ${attempts}, back in ${minutes}m or when it arrives)`);
    return 'ok' as const;
  };
  if (!existsSync(scriptPath)) return fail(`script missing at ${item.script}`);

  log(`=== ${item.questId} on ${account} (${item.script}) ===`);
  const startedAt = Date.now();
  const { code, tail } = await runChild([item.script, account!, ...(item.args ?? [])], item.capMin ? item.capMin * 60_000 : QUEST_CAP_MS);
  if (stopping) return 'ok';
  const out = classifyExit(code, tail, SLOTS_FULL_EXIT);
  switch (out.kind) {
    case 'deferred': {
      st.deferredAt = stamp();
      const slots = /deferring \[slots ([\w.-]+)\/(\d+)\]/.exec(tail);
      if (slots) {
        st.slotId = slots[1];
        st.slotMax = Number(slots[2]);
      }
      saveState();
      log(`${item.questId} deferred: its quest slots are full — on to the next item`);
      return 'ok';
    }
    case 'stock':
      return pause('stock', out.short.map((l) => `${l.item} ×${l.count}`).join(', ') || 'NEEDS STOCK', out.short);
    case 'prereq':
      return pause('prereq', out.missing);
    case 'outage':
      return 'outage';
    case 'fail':
      return fail(out.why);
    case 'done':
      if (out.how === 'journal') return finish('journal says complete', newestRunFor(startedAt - 60_000) ?? 'journal');
      return finish(out.how, out.how, out.how === 'already-complete');
    case 'grade': {
      const dir = newestRunFor(startedAt - 60_000);
      if (!dir) return fail('exited 0 but wrote no run record');
      const grade = gradeRun(dir);
      if (grade.verdict !== 'PASS') return fail(`evidence gate: ${grade.reason} (record ${dir})`);
      return finish(grade.reason, grade.runId ?? dir);
    }
  }
}

const RECHECK_MS = Number(process.env.TODO_RECHECK_MIN ?? 20) * 60_000;
let queue = loadQueue();
const pending = () => queue.filter(i => !isDone(i) && !exhausted(i) && !blocked(i) && !waiting(i));
log(`${account} — ${pending().length} pending of ${queue.length}${thenCmd.length ? ` · then ${thenCmd.join(' ')}` : ''}`);
for (const item of pending()) {
  const f = state[item.questId]?.failures ?? 0;
  log(`  next: ${item.questId} (${item.script})${f ? ` failures=${f}` : ''}`);
}
if (dry) process.exit(0);

const OUTAGE_HOLD_MS = Number(process.env.TODO_OUTAGE_HOLD_MS ?? 300_000);

async function drain(): Promise<void> {
  // Two passes so a quest that failed once (contention, a dropped link) gets a second go after the
  // others. A Legends prerequisite gets it straight away: jacklove8's Underground Pass retry sat
  // behind its whole remaining list. The list and prerequisites are re-read before every quest.
  const tried = new Set<string>();
  let retryNow: string | null = null;
  let pass = 1;
  while (!stopping) {
    applyRearms();
    queue = loadQueue();
    const todo = pending();
    const next =
      todo.find((i) => i.questId === retryNow) ??
      todo.find((i) => !tried.has(i.questId) && onLegendsPath(i) && (state[i.questId]?.failures ?? 0) > 0) ??
      todo.find((i) => !tried.has(i.questId));
    if (!next) {
      if (todo.length === 0 || pass >= MAX_FAILURES) break;
      pass += 1;
      tried.clear();
      log(`retry pass ${pass}: ${todo.map((i) => i.questId).join(', ')}`);
      continue;
    }
    tried.add(next.questId);
    const result = await runItem(next);
    if (result === 'outage') {
      // The game server or client is gone: every quest would "fail" the same way. Hold this one (2026-11-07:
      // a server outage used up jacklove8's Legends and the stock runs' tries in 35 minutes).
      log(`${next.questId}: game client outage, no failure counted; trying it again in ${OUTAGE_HOLD_MS / 60_000}m`);
      tried.delete(next.questId);
      retryNow = next.questId;
      await Bun.sleep(OUTAGE_HOLD_MS);
      continue;
    }
    retryNow = result === 'failed' && onLegendsPath(next) ? next.questId : null;
    if (retryNow && !exhausted(next)) log(`${next.questId} is on the Legends path: retrying now`);
  }
  const doneN = queue.filter(isDone).length;
  const why = (i: TodoItem) => {
    const st = state[i.questId];
    if (st?.wait) return `waiting: ${st.wait.why}`;
    if (st?.lastError) return st.lastError;
    if (st?.deferredAt) return 'deferred: slots full';
    const b = blocker(i);
    return b ? `blocked by ${b}` : 'skipped';
  };
  const gaveUp = queue.filter((i) => !isDone(i)).map((i) => `${i.questId}(${why(i)})`);
  log(`list finished: ${doneN}/${queue.length} done${gaveUp.length ? ` · not done: ${gaveUp.join('; ')}` : ''}`);
}

/** Matches lib/no-client-waits.ts SLOT_STALE_MS: an older slot file belongs to a dead run. */
const SLOT_STALE_MS = 10 * 60_000;

/**
 * A deferred quest whose slots are still all held by live runs: stopping the grind
 * for it would only defer it again. 20 accounts waiting on Priest in Peril's 3 slots
 * each drained and restarted their grind every RECHECK_MS for nothing (2026-10-31).
 */
function stillFull(item: TodoItem): boolean {
  const st = state[item.questId];
  if (!st?.deferredAt || !st.slotId || !st.slotMax) return false;
  try {
    const dir = join(process.cwd(), 'bots', '.quest-slots', st.slotId);
    const live = readdirSync(dir).filter((f) => {
      try {
        return Date.now() - statSync(join(dir, f)).mtimeMs <= SLOT_STALE_MS;
      } catch {
        return false;
      }
    });
    return live.length >= st.slotMax;
  } catch {
    return false;
  }
}

/** True when the shared list has work this account can start now (new, retryable, or a freed slot). */
function listGrew(): boolean {
  applyRearms();
  queue = loadQueue();
  return pending().some((i) => !stillFull(i));
}

// The list is LIVE: promoting a new quest only appends to todo.json, and every
// runner already handed over to its grind notices within RECHECK_MS, pauses the
// grind (SIGTERM — grind jobs drain on it), runs the new quest, and resumes.
// Rolling a quest out to the whole fleet therefore needs no deploy and no restart.
for (;;) {
  await drain();
  if (stopping) process.exit(143);
  if (thenCmd.length) {
    // The grind runs IN THIS PROCESS (dynamic import with its own argv), not as
    // a child: a parent bun idling next to every grind cost ~26 MB per bot on a
    // box that already swaps. Picking up newly appended quests is then a
    // graceful self-stop — SIGTERM to ourselves lets the grind's own drain
    // handler run, the container restarts, and the fresh runner drains the
    // list before importing the grind again. One restart per rollout, never a
    // loop: the list only grows when a quest is promoted.
    log(`handing over to ${thenCmd.join(' ')} (in-process)`);
    for (const sig of ['SIGTERM', 'SIGINT'] as const) process.removeAllListeners(sig);
    const watch = setInterval(() => {
      if (!listGrew()) return;
      clearInterval(watch);
      log(`new quests on the list (${pending().map(i => i.questId).join(', ')}) — stopping ${thenCmd[0]} so the runner restarts into them`);
      if (process.listenerCount('SIGTERM') > 0) process.kill(process.pid, 'SIGTERM');
      setTimeout(() => process.exit(0), process.listenerCount('SIGTERM') > 0 ? 60_000 : 0);
    }, RECHECK_MS);
    process.argv = [process.argv[0]!, join(process.cwd(), thenCmd[0]!), ...thenCmd.slice(1)];
    await import(join(process.cwd(), thenCmd[0]!));
    // A grind module that returns (top-level code finished) without exiting
    // still has its timers/sockets alive; leave the process to them and the
    // watcher. Nothing more to do here.
    await new Promise<never>(() => {});
  }
  log('nothing to hand over to — parked (add --then <script> [args] to the roster args)');
  for (;;) {
    await Bun.sleep(RECHECK_MS);
    if (listGrew()) break;
    log('parked');
  }
}
