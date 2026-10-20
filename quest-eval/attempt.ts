/**
 * One eval attempt: stage a fixed starting state, run the script once, collect
 * evidence, tear the account down.
 *
 * Why a fresh fixture account per attempt instead of a restored save file:
 * fixture provisioning is the only staging path that fails closed (it refuses
 * an account that already carries a save or a Grand Exchange checkpoint row, so
 * it can never silently evaluate the wrong starting state). Re-using a name
 * needs save surgery against a live engine between attempts, and a mis-ordered
 * write there produces a run that *looks* clean while starting mid-quest. One
 * disposable `ql…` name per attempt removes that entire class of mistake.
 *
 * The account is torn down with SIGINT (a clean logout). Ghosted entities are
 * noted, never retried in a loop: a ghost means the next attempt's provisioning
 * will refuse that name, and the operator needs to see that, not have it hidden.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { classifyAttempt } from './report.ts';
import { findRunDirectory, observeAttemptEvents, parseJsonl, readText } from './telemetry.ts';
import type { AttemptResult, CheckpointRecord } from './types.ts';

export interface AttemptContext {
  repoRoot: string;
  /** Engine web origin, e.g. `http://127.0.0.1:8888`. */
  webUrl: string;
  /** Gateway HTTP origin, e.g. `http://127.0.0.1:7780`. */
  gatewayUrl: string;
  /** Per-run log directory (one `.log` per stream so failures stay diagnosable). */
  logsRoot: string;
  quiet?: boolean;
  /** Declared tick rate for this run set (from `--tickrate`), when known. */
  declaredTickRateMs?: number;
}

export interface AttemptPlan {
  questId: string;
  /** Script path relative to the repo root. */
  script: string;
  /** Fixture path relative to the repo root. */
  fixture: string;
  account: string;
  attempt: number;
  timeoutMs: number;
  fixtureHash: string;
  contentHash: string;
}

const READY_TIMEOUT_MS = 90_000;
const TEARDOWN_GRACE_MS = 20_000;
const GHOST_SETTLE_MS = 60_000;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * The engine's tick rate, as declared. Order: an explicit override, the engine
 * .env, the harness process env, then "unknown" — never a guess. `::speed`
 * overrides a live session and is invisible here, which is why the report calls
 * this "declared" rather than "measured".
 */
function declaredClock(repoRoot: string, override?: number): { tickRateMs: number | null; source: string } {
    if (override) return { tickRateMs: override, source: 'flag' };
    const envPath = join(repoRoot, 'server', 'engine', '.env');
    if (existsSync(envPath)) {
        for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
            const match = /^\s*NODE_TICKRATE\s*=\s*(\d+)/.exec(line);
            if (match) return { tickRateMs: Number(match[1]), source: 'server/engine/.env' };
        }
    }
    const fromEnv = Number(process.env.NODE_TICKRATE);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return { tickRateMs: fromEnv, source: 'NODE_TICKRATE' };
    return { tickRateMs: null, source: 'unknown (engine default)' };
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function fetchJson(url: string, timeoutMs = 5_000): Promise<any | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** Names currently in the world, or null when presence cannot be determined. */
async function onlineKeys(webUrl: string): Promise<Set<string> | null> {
  const positions = await fetchJson(`${webUrl}/playerpositions`);
  if (!Array.isArray(positions)) return null;
  return new Set(positions.map((p: any) => String(p?.name ?? '').toLowerCase()));
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number, intervalMs = 1_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await sleep(intervalMs);
  }
  return false;
}

function tail(path: string, limit = 1_200): string {
  const text = readText(path);
  if (!text) return '(no output)';
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `…${trimmed.slice(-limit)}`;
}

/** Append a stream to a log file as it arrives, so a hanging run is still diagnosable. */
function tee(stream: ReadableStream<Uint8Array>, logPath: string): void {
  const decoder = new TextDecoder();
  void (async () => {
    try {
      for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
        appendFileSync(logPath, decoder.decode(chunk, { stream: true }));
      }
    } catch {
      /* the process died mid-write; the log already holds what arrived */
    }
  })();
}

interface Spawned {
  proc: ReturnType<typeof Bun.spawn>;
  logPath: string;
}

function spawnLogged(cmd: string[], options: { cwd: string; logPath: string; env?: Record<string, string> }): Spawned {
  appendFileSync(options.logPath, `\n$ ${cmd.join(' ')}\n  cwd: ${options.cwd}\n`);
  const proc = Bun.spawn({
    cmd,
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  tee(proc.stdout as unknown as ReadableStream<Uint8Array>, options.logPath);
  tee(proc.stderr as unknown as ReadableStream<Uint8Array>, options.logPath);
  return { proc, logPath: options.logPath };
}

function randomPassword(length = 12): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

/**
 * Write the account's `bot.env`, including BOTH lines the lite runner needs:
 * `SERVER` (cache origin) and `GATEWAY_URL` (control traffic). A blank SERVER
 * makes the runner fetch checksums from `http://localhost/crc` and die.
 */
function writeBotEnv(repoRoot: string, account: string, ctx: AttemptContext): Record<string, string> {
  const dir = join(repoRoot, 'bots', account);
  mkdirSync(dir, { recursive: true });
  const server = ctx.webUrl.replace(/^https?:\/\//, '');
  const env = {
    BOT_USERNAME: account,
    PASSWORD: randomPassword(),
    SERVER: server,
    GATEWAY_URL: ctx.gatewayUrl.replace(/^http/, 'ws'),
    // Local eval traffic must not page the humans: this is a disposable bot.
    TELEMETRY: 'false',
  };
  const body = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  writeFileSync(join(dir, 'bot.env'), body);
  return env;
}

export async function runAttempt(ctx: AttemptContext, plan: AttemptPlan): Promise<AttemptResult> {
  const attemptLogs = join(ctx.logsRoot, `${plan.questId}-${plan.account}`);
  mkdirSync(attemptLogs, { recursive: true });
  const provisionLog = join(attemptLogs, 'provision.log');
  const liteLog = join(attemptLogs, 'lite.log');
  const scriptLog = join(attemptLogs, 'script.log');

  const notes: string[] = [];
  let lite: Spawned | null = null;
  let harnessError: string | null = null;
  let exitCode: number | null = null;
  let timedOut = false;
  let startedAtMs = Date.now();
  let finishedAtMs = startedAtMs;

  const announce = (message: string) => {
    if (!ctx.quiet) console.log(`  ${message}`);
  };

  try {
    const before = await onlineKeys(ctx.webUrl);
    if (before === null) throw new Error(`engine did not answer ${ctx.webUrl}/playerpositions`);
    if (before.has(plan.account.toLowerCase())) {
      throw new Error(`'${plan.account}' is already in the world — refusing to stage over it`);
    }

    const env = writeBotEnv(ctx.repoRoot, plan.account, ctx);

    announce(`provisioning ${plan.account} from ${plan.fixture}`);
    // Absolute fixture path: the materializer runs from `server/engine` and
    // resolves relative paths against ITS cwd, not the repo root.
    const fixtureAbs = join(ctx.repoRoot, plan.fixture);
    const provision = spawnLogged(['bun', 'tools/server/quest-lab-fixture.ts', fixtureAbs, plan.account], {
      cwd: join(ctx.repoRoot, 'server', 'engine'),
      logPath: provisionLog,
    });
    const provisionExit = await provision.proc.exited;
    if (provisionExit !== 0) {
      throw new Error(`fixture provisioning exited ${provisionExit}: ${tail(provisionLog)}`);
    }

    announce(`starting lite runner for ${plan.account}`);
    lite = spawnLogged(['bun', 'src/lite/runner.ts', plan.account], {
      cwd: join(ctx.repoRoot, 'server', 'webclient'),
      logPath: liteLog,
      // SERVER and GATEWAY_URL both come from bot.env: the runner builds its
      // cache origin from SERVER and dies on a blank one.
      env,
    });

    const ready = await waitFor(async () => {
      const status = await fetchJson(`${ctx.gatewayUrl}/status/${plan.account}`);
      return status?.inGame === true;
    }, READY_TIMEOUT_MS);
    if (!ready) throw new Error(`lite runner never reached inGame: ${tail(liteLog)}`);

    announce(`running ${plan.script} (timeout ${Math.round(plan.timeoutMs / 1000)}s)`);
    startedAtMs = Date.now();
    const script = spawnLogged(['bun', plan.script, plan.account], {
      cwd: ctx.repoRoot,
      logPath: scriptLog,
      env: {
        QUEST_LAB_MODE: 'staging',
        QUEST_LAB_FIXTURE_HASH: plan.fixtureHash,
        QUEST_LAB_CONTENT_HASH: plan.contentHash,
      },
    });

    const raced = await Promise.race([
      script.proc.exited.then(code => ({ kind: 'exit' as const, code })),
      sleep(plan.timeoutMs).then(() => ({ kind: 'timeout' as const, code: null })),
    ]);
    finishedAtMs = Date.now();
    if (raced.kind === 'timeout') {
      timedOut = true;
      notes.push('attempt hit its time budget; script was stopped');
      script.proc.kill('SIGINT');
      const afterStop = await Promise.race([script.proc.exited, sleep(15_000).then(() => null)]);
      if (typeof afterStop === 'number') exitCode = afterStop;
      else {
        script.proc.kill('SIGKILL');
        notes.push('script ignored SIGINT for 15s and was killed');
      }
    } else {
      exitCode = raced.code;
    }

    // Give the script's append-only records a moment to land before reading them.
    await sleep(1_000);
  } catch (error) {
    harnessError = (error as Error).message;
    finishedAtMs = Date.now();
  } finally {
    if (!harnessError) {
      // Small courtesy: a harness failure should still attempt a clean logout.
    }
    if (lite) {
      const keys = await onlineKeys(ctx.webUrl);
      if (keys?.has(plan.account.toLowerCase())) {
        lite.proc.kill('SIGINT');
        await Promise.race([lite.proc.exited, sleep(TEARDOWN_GRACE_MS)]);
        const gone = await waitFor(async () => {
          const now = await onlineKeys(ctx.webUrl);
          return now !== null && !now.has(plan.account.toLowerCase());
        }, GHOST_SETTLE_MS);
        if (!gone) notes.push('account still listed in /playerpositions after logout (ghost) — the name is burned');
      }
    }
  }

  // ── Evidence ──────────────────────────────────────────────────────────────
  const eventsText = readText(join(ctx.repoRoot, 'bots', plan.account, 'events.log')) ?? '';
  const observation = observeAttemptEvents(eventsText, startedAtMs);
  const run = findRunDirectory(join(ctx.repoRoot, 'quest-lab', 'runs'), plan.account, plan.questId);
  const records = run ? parseJsonl<CheckpointRecord>(readText(join(run.directory, 'checkpoints.jsonl')) ?? '') : [];
  const required = run?.requiredCheckpoints ?? [];

  const classified = classifyAttempt({
    exitCode,
    timedOut,
    harnessError,
    records,
    requiredCheckpoints: required,
    lastPhase: observation.lastPhase,
  });

  // A zero exit with no run record is not a pass: nothing in it is proven.
  let status = classified.status;
  let failureState = classified.failureState;
  let failureReason = classified.failureReason;
  if (status === 'pass' && !run) {
    status = 'fail';
    failureState = 'no-run-record';
    failureReason = 'script exited 0 but wrote no quest-lab run record, so no checkpoint evidence exists';
  }
  if (!run && status !== 'error') notes.push('no quest-lab run record was written for this attempt');

  return {
    questId: plan.questId,
    script: plan.script,
    fixture: plan.fixture,
    account: plan.account,
    attempt: plan.attempt,
    status,
    failureState,
    failureReason,
    durationMs: Math.max(0, finishedAtMs - startedAtMs),
    recoveries: observation.recoveries,
    exitCode,
    timedOut,
    runDirectory: run?.directory ?? null,
    passedCheckpoints: classified.passedCheckpoints,
    failedCheckpoints: classified.failedCheckpoints,
    missingCheckpoints: classified.missingCheckpoints,
    phases: observation.phases,
    lastPhase: observation.lastPhase,
    notes,
    logPath: attemptLogs,
    clock: declaredClock(ctx.repoRoot, ctx.declaredTickRateMs),
  };
}

/** Collision-resistant, filesystem-safe log directory stamp. */
export function attemptLogStamp(): string {
  return stamp();
}

/** True when a script path exists under the repo root. */
export function scriptExists(repoRoot: string, script: string): boolean {
  return existsSync(join(repoRoot, script));
}

/** Fixture text hash: proves two attempts started from the same spec. */
export function hashFixture(repoRoot: string, fixture: string): string {
  const text = readFileSync(join(repoRoot, fixture), 'utf-8');
  return Bun.hash(text).toString(16);
}
