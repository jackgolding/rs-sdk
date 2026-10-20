/**
 * Typed state machines for bot scripts.
 *
 * Before this, every script tracked its own phase strings by hand: a chain of
 * `await session.setPhase('travel')` calls whose control flow lived in the
 * shape of the code. That works until a loop appears — a bot that walks at a
 * shield spawn it cannot reach re-enters its own `collect` phase forever, and
 * nothing in the system knows it is a loop rather than progress. Eight bots
 * failed that way with no signal beyond a stall log.
 *
 * A script declares its graph instead: states, the outcomes each state can
 * produce, the edge each outcome takes, a per-state time budget, and explicit
 * edges for recovery. The machine runs it, records one telemetry event per
 * transition, and refuses to pretend a repeating edge is progress.
 *
 *   const graph = defineGraph({
 *     id: "cook's assistant",
 *     initial: 'inspect',
 *     states: {
 *       inspect: { run: async () => (await alreadyStarted(ctx) ? 'resume' : 'fresh'),
 *                  on: { fresh: 'bank', resume: 'travel' } },
 *       bank:    { run: withdrawSupplies, on: { ok: 'travel', short: 'gather' },
 *                  timeoutMs: 90_000, onTimeout: 'gather' },
 *       travel:  { run: walkToCook, on: { ok: 'talk' } },
 *       gather:  { run: selfSource, on: { ok: 'travel', fail: FAILED }, maxVisits: 1 },
 *       talk:    { run: handIn, on: { ok: 'verify' } },
 *       verify:  { run: proveJournal, on: { ok: DONE, bad: FAILED } },
 *     },
 *   });
 *   const result = await new Machine(graph, { onTransition: e => session.event('transition', e) }).run(ctx);
 *
 * The transition logic here is pure apart from the state bodies themselves, so
 * guards, timeouts, visit caps and loop detection are unit-tested without a
 * game (`sdk/test/fsm.test.ts`).
 */

/** Terminal target that marks a successful run. */
export const DONE = '$done';
/** Terminal target that marks a failed run. */
export const FAILED = '$failed';

export type Outcome = string;

export interface StateApi<C> {
  /** State being executed. */
  readonly state: string;
  /** 1-based visit index of this state. */
  readonly visit: number;
  /** Milliseconds since the machine started. */
  elapsedMs(): number;
  /** True when the caller asked the script to stop at the next boundary. */
  stopping(): boolean;
  /** Read-only view of the run so far, for state bodies that need history. */
  readonly path: readonly string[];
  /** Extra context, typed by the caller (sdk, bot, session, ...). */
  readonly ctx: C;
}

export interface StateSpec<C> {
  /**
   * The state's work. Returns the outcome key that selects the next edge —
   * this return value is the guard: the body decides, the graph declares where
   * each decision leads.
   *
   * Must resolve before the per-state budget; a body that overruns is treated
   * as a timeout (see `onTimeout`), and its promise is abandoned, not awaited.
   */
  run?: (ctx: C, api: StateApi<C>) => Outcome | void | Promise<Outcome | void>;
  /** outcome -> next state id, or `DONE` / `FAILED`. */
  on?: Record<string, string>;
  /** Budget for this state's body. Exceeding it follows `onTimeout`. */
  timeoutMs?: number;
  /** Edge taken on timeout (default: `on.timeout`, else FAILED). */
  onTimeout?: string;
  /** Edge taken when `run` throws (default: `on.error`, else FAILED). */
  onError?: string;
  /** How many times this state may be entered before `onVisitExceeded` fires. */
  maxVisits?: number;
  /** Edge taken when `maxVisits` is exceeded (default: FAILED). */
  onVisitExceeded?: string;
}

export interface GraphSpec<C> {
  /** Name used in telemetry and diagrams. */
  id: string;
  initial: string;
  states: Record<string, StateSpec<C>>;
  /**
   * How many times a single edge (from -> to) may repeat before the run is
   * failed as a loop. Default: unbounded, but every repeat is recorded, so a
   * loop shows up in telemetry even when it is legal.
   */
  maxEdgeRepeats?: number;
  /**
   * Hard cap on transitions. Optional, because a grinder legitimately loops
   * forever — but a graph that forgot a cap must fail as `step-limit` rather
   * than spin, which is how a hand-rolled phase loop hangs a bot.
   */
  maxSteps?: number;
  /** Default per-state budget, overridable per state. */
  defaultTimeoutMs?: number;
}

export type TransitionVia = Outcome | 'timeout' | 'error' | 'visit-limit' | 'loop-limit' | 'step-limit' | 'unhandled' | 'unknown-state';

export interface TransitionEvent {
  type: 'transition';
  machine: string;
  from: string;
  to: string;
  /** Outcome key, or the machine's own reason for overriding one. */
  via: TransitionVia;
  reason?: string;
  /** 1-based visit index of the state being left. */
  visit: number;
  /** How long that state's body ran. */
  durationMs: number;
  /** Milliseconds since the machine started. */
  elapsedMs: number;
  /** Wall clock, for joining with other telemetry files. */
  at: number;
  /** How many times this exact edge has been taken, including this one. */
  edgeRepeats: number;
}

export interface RunResult<C> {
  machine: string;
  outcome: 'done' | 'failed';
  finalState: string;
  reason: string;
  /** States entered, in order (including repeats). */
  path: string[];
  visits: Record<string, number>;
  transitions: TransitionEvent[];
  elapsedMs: number;
  ctx: C;
}

export interface MachineOptions<C> {
  /** Called once per transition — wire it to `session.event('transition', e)`. */
  onTransition?: (event: TransitionEvent) => void;
  /** Called before a state body runs. */
  onEnter?: (state: string, visit: number, ctx: C) => void | Promise<void>;
  /** Clock injection for tests. */
  now?: () => number;
  /** Stop hook: a state body may consult `api.stopping()` at a boundary. */
  stopping?: () => boolean;
}

export class FsmDefinitionError extends Error {
  constructor(readonly graphId: string, readonly problems: string[]) {
    super(`invalid graph '${graphId}': ${problems.join('; ')}`);
    this.name = 'FsmDefinitionError';
  }
}

const TERMINALS = new Set([DONE, FAILED]);

const isTerminal = (state: string): boolean => TERMINALS.has(state);

/** Declare a graph with type inference, then validate it. */
export function defineGraph<C>(spec: GraphSpec<C>): GraphSpec<C> {
  const problems = validateGraph(spec);
  if (problems.length) throw new FsmDefinitionError(spec.id, problems);
  return spec;
}

/**
 * Everything a graph must satisfy to be runnable. Returned rather than thrown so
 * a CLI can report every problem at once instead of one per edit.
 */
export function validateGraph<C>(spec: GraphSpec<C>): string[] {
  const problems: string[] = [];
  const ids = Object.keys(spec.states ?? {});
  if (!ids.length) problems.push('graph declares no states');
  if (!spec.initial) problems.push('graph has no initial state');
  else if (!spec.states[spec.initial]) problems.push(`initial state '${spec.initial}' is not declared`);
  if (spec.initial && isTerminal(spec.initial)) problems.push('initial state cannot be a terminal');

  for (const [id, state] of Object.entries(spec.states ?? {})) {
    if (isTerminal(id)) problems.push(`state '${id}' is a reserved terminal id`);
    const edges = state.on ?? {};
    for (const [outcome, target] of Object.entries(edges)) {
      if (!target) problems.push(`state '${id}' has an empty target for outcome '${outcome}'`);
      else if (!isTerminal(target) && !spec.states[target]) problems.push(`state '${id}' -> '${target}' (outcome '${outcome}') is not a declared state`);
    }
    for (const [field, target] of [
      ['onTimeout', state.onTimeout],
      ['onError', state.onError],
      ['onVisitExceeded', state.onVisitExceeded],
    ] as const) {
      if (target && !isTerminal(target) && !spec.states[target]) problems.push(`state '${id}' ${field} -> '${target}' is not a declared state`);
    }
    const hasEdges = Object.keys(edges).length > 0 || state.onTimeout !== undefined || state.onError !== undefined || state.onVisitExceeded !== undefined;
    if (!hasEdges) problems.push(`state '${id}' has no outgoing edge — every state must lead somewhere or to ${DONE}/${FAILED}`);
    if (!state.run && Object.keys(edges).length > 1) {
      problems.push(`state '${id}' declares ${Object.keys(edges).length} outcomes but no run() to choose between them`);
    }
    if (state.timeoutMs !== undefined && !(state.timeoutMs > 0)) problems.push(`state '${id}' has a non-positive timeoutMs`);
    if (state.maxVisits !== undefined && !(state.maxVisits >= 1)) problems.push(`state '${id}' has maxVisits < 1`);
  }

  // Reachability: a declared-but-unreachable state is a graph bug that would
  // otherwise sit in the diagram pretending to be a route.
  if (spec.initial && spec.states[spec.initial]) {
    const seen = new Set<string>([spec.initial]);
    const queue = [spec.initial];
    while (queue.length) {
      const id = queue.shift()!;
      const state = spec.states[id];
      if (!state) continue;
      const targets = [...Object.values(state.on ?? {}), state.onTimeout, state.onError, state.onVisitExceeded].filter(Boolean) as string[];
      for (const target of targets) {
        if (!target || isTerminal(target) || seen.has(target)) continue;
        seen.add(target);
        queue.push(target);
      }
    }
    for (const id of ids) if (!seen.has(id)) problems.push(`state '${id}' is unreachable from '${spec.initial}'`);
    // Dead ends: a run that can never reach a terminal is a machine that spins.
    const canTerminate = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, state] of Object.entries(spec.states)) {
        if (canTerminate.has(id)) continue;
        const targets = [...(Object.values(state.on ?? {}) as string[]), state.onTimeout, state.onError, state.onVisitExceeded].filter(Boolean) as string[];
        if (targets.some(target => isTerminal(target) || canTerminate.has(target))) {
          canTerminate.add(id);
          changed = true;
        }
      }
    }
    for (const id of ids) if (seen.has(id) && !canTerminate.has(id)) problems.push(`state '${id}' can never reach ${DONE} or ${FAILED}`);
  }

  if (spec.maxEdgeRepeats !== undefined && !(spec.maxEdgeRepeats >= 1)) problems.push('maxEdgeRepeats must be >= 1');
  if (spec.maxSteps !== undefined && !(spec.maxSteps >= 1)) problems.push('maxSteps must be >= 1');
  if (spec.defaultTimeoutMs !== undefined && !(spec.defaultTimeoutMs > 0)) problems.push('defaultTimeoutMs must be > 0');
  return problems;
}

class StateTimeout extends Error {
  constructor(readonly state: string, readonly budgetMs: number) {
    super(`state '${state}' exceeded its ${budgetMs}ms budget`);
    this.name = 'StateTimeout';
  }
}

async function runWithBudget<C>(
  body: StateSpec<C>['run'],
  ctx: C,
  api: StateApi<C>,
  budgetMs: number | undefined,
): Promise<Outcome | void> {
  if (!body) return undefined;
  const promise = body(ctx, api);
  if (budgetMs === undefined) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StateTimeout(api.state, budgetMs)), budgetMs);
        // Do not hold the process open for a budget that will not fire.
        (timer as { unref?: () => void }).unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resolve the next state for a state body's result.
 * Returns either a target + metadata, or the machine's own override.
 */
function resolveEdge<C>(
  spec: GraphSpec<C>,
  state: string,
  body: StateSpec<C>,
  outcome: Outcome | void,
): { to: string; via: TransitionVia } {
  const edges = body.on ?? {};
  const keys = Object.keys(edges);
  const key = outcome === undefined || outcome === ''
    ? (keys.length === 1 ? keys[0]! : 'ok')
    : String(outcome);
  const target = edges[key];
  if (!target) return { to: FAILED, via: 'unhandled' };
  return { to: target, via: key };
}

export class Machine<C> {
  private readonly graph: GraphSpec<C>;
  private readonly options: MachineOptions<C>;
  private readonly now: () => number;

  constructor(graph: GraphSpec<C>, options: MachineOptions<C> = {}) {
    const problems = validateGraph(graph);
    if (problems.length) throw new FsmDefinitionError(graph.id, problems);
    this.graph = graph;
    this.options = options;
    this.now = options.now ?? (() => Date.now());
  }

  async run(ctx: C): Promise<RunResult<C>> {
    const startedAt = this.now();
    const path: string[] = [];
    const visits: Record<string, number> = {};
    const transitions: TransitionEvent[] = [];
    const edgeCounts = new Map<string, number>();
    let current = this.graph.initial;
    let reason = '';

    const record = (event: TransitionEvent): void => {
      transitions.push(event);
      this.options.onTransition?.(event);
    };

    const step = (to: string, via: TransitionVia, from: string, visit: number, durationMs: number, why?: string): void => {
      const edge = `${from}->${to}`;
      const repeats = (edgeCounts.get(edge) ?? 0) + 1;
      edgeCounts.set(edge, repeats);
      if (why) reason = why;
      record({
        type: 'transition',
        machine: this.graph.id,
        from,
        to,
        via,
        ...(reason ? { reason } : {}),
        visit,
        durationMs,
        elapsedMs: this.now() - startedAt,
        at: Date.now(),
        edgeRepeats: repeats,
      });
      current = to;
    };

    while (!isTerminal(current)) {
      if (this.graph.maxSteps !== undefined && transitions.length >= this.graph.maxSteps) {
        // Overriding before the body runs: the cap is about the graph, not the
        // state, and a body that would take another action must not.
        reason = `machine exceeded maxSteps (${this.graph.maxSteps})`;
        step(FAILED, 'step-limit', current, visits[current] ?? 0, 0, reason);
        break;
      }
      const spec = this.graph.states[current];
      if (!spec) {
        // Only reachable if a body returned a target the validator missed.
        reason = `unknown state '${current}'`;
        step(FAILED, 'unknown-state', current, 0, 0, reason);
        break;
      }

      const visit = (visits[current] = (visits[current] ?? 0) + 1);
      path.push(current);

      if (spec.maxVisits !== undefined && visit > spec.maxVisits) {
        const to = spec.onVisitExceeded ?? FAILED;
        step(to, 'visit-limit', current, visit, 0, `state '${current}' would be entered ${visit} times (limit ${spec.maxVisits})`);
        continue;
      }

      await this.options.onEnter?.(current, visit, ctx);

      const api: StateApi<C> = {
        state: current,
        visit,
        elapsedMs: () => this.now() - startedAt,
        stopping: () => this.options.stopping?.() ?? false,
        path,
        ctx,
      };

      const stateStartedAt = this.now();
      let outcome: Outcome | void;
      try {
        outcome = await runWithBudget(spec.run, ctx, api, spec.timeoutMs ?? this.graph.defaultTimeoutMs);
      } catch (error) {
        const duration = this.now() - stateStartedAt;
        if (error instanceof StateTimeout) {
          const to = spec.onTimeout ?? spec.on?.timeout ?? FAILED;
          step(to, 'timeout', current, visit, duration, error.message);
        } else {
          const message = (error as Error)?.message ?? String(error);
          const to = spec.onError ?? spec.on?.error ?? FAILED;
          step(to, 'error', current, visit, duration, message);
        }
        continue;
      }

      const duration = this.now() - stateStartedAt;
      const { to, via } = resolveEdge(this.graph, current, spec, outcome);

      // A repeating edge is legal (recovery loops exist) but never invisible:
      // the cap turns "it kept trying" into one named failure.
      const edge = `${current}->${to}`;
      const repeats = (edgeCounts.get(edge) ?? 0) + 1;
      if (this.graph.maxEdgeRepeats !== undefined && repeats > this.graph.maxEdgeRepeats) {
        step(FAILED, 'loop-limit', current, visit, duration, `edge ${edge} repeated ${repeats} times (limit ${this.graph.maxEdgeRepeats})`);
        continue;
      }

      step(to, via, current, visit, duration, via === 'unhandled' ? `outcome '${String(outcome)}' has no edge in state '${current}'` : undefined);
    }

    const outcome: 'done' | 'failed' = current === DONE ? 'done' : 'failed';
    const lastVia = transitions.length ? transitions[transitions.length - 1]!.via : 'none';
    return {
      machine: this.graph.id,
      outcome,
      finalState: current,
      // The reason that matters is the one that caused the ending, not the
      // bookkeeping edge onto the terminal state.
      reason: outcome === 'done' ? (reason || `reached ${DONE}`) : (reason || `ended in ${current} via '${lastVia}'`),
      path,
      visits,
      transitions,
      elapsedMs: this.now() - startedAt,
      ctx,
    };
  }
}

/**
 * Render a graph as Mermaid. Edges are labelled with the outcome that selects
 * them, and `DONE` / `FAILED` collapse onto the terminal marker with the outcome
 * kept as the label — so "the shield loop" is a visible back-edge, not a phase
 * string that repeats in a log.
 */
export function toMermaid<C>(graph: GraphSpec<C>, options: { path?: readonly string[]; title?: boolean } = {}): string {
  const lines: string[] = [];
  if (options.title !== false) lines.push(`%% ${graph.id}`);
  lines.push('stateDiagram-v2');
  lines.push(`  [*] --> ${sanitize(graph.initial)}`);

  for (const [id, state] of Object.entries(graph.states)) {
    const edges = state.on ?? {};
    for (const [outcome, target] of Object.entries(edges)) {
      const to = isTerminal(target) ? '[*]' : sanitize(target);
      lines.push(`  ${sanitize(id)} --> ${to} : ${outcome}`);
    }
    if (state.onTimeout) lines.push(`  ${sanitize(id)} --> ${isTerminal(state.onTimeout) ? '[*]' : sanitize(state.onTimeout)} : timeout`);
    if (state.onError) lines.push(`  ${sanitize(id)} --> ${isTerminal(state.onError) ? '[*]' : sanitize(state.onError)} : error`);
    if (state.onVisitExceeded) lines.push(`  ${sanitize(id)} --> ${isTerminal(state.onVisitExceeded) ? '[*]' : sanitize(state.onVisitExceeded)} : visit-limit`);
    const notes: string[] = [];
    if (state.timeoutMs) notes.push(`${Math.round(state.timeoutMs / 1000)}s budget`);
    if (state.maxVisits) notes.push(`max ${state.maxVisits} visit(s)`);
    if (notes.length) lines.push(`  note right of ${sanitize(id)} : ${notes.join(', ')}`);
  }

  const visited = options.path?.filter(id => !isTerminal(id)) ?? [];
  if (visited.length) {
    lines.push(`  class ${[...new Set(visited)].map(sanitize).join(',')} visited`);
    lines.push('  classDef visited fill:#1f6feb33,stroke:#1f6feb');
  }
  return lines.join('\n');
}

/** Mermaid ids cannot carry every character a state name might; keep them readable. */
function sanitize(id: string): string {
  const clean = id.replace(/[^a-zA-Z0-9_]/g, '_');
  return /^[a-zA-Z_]/.test(clean) ? clean : `s_${clean}`;
}
