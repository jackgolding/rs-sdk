import { describe, expect, test } from 'bun:test';

import { DONE, FAILED, Machine, defineGraph, toMermaid, validateGraph, type TransitionEvent } from '../fsm';

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('linear graph', () => {
  const graph = defineGraph<{ order: string[] }>({
    id: 'linear',
    initial: 'a',
    states: {
      a: { run: ctx => { ctx.order.push('a'); return 'ok'; }, on: { ok: 'b' } },
      b: { run: ctx => { ctx.order.push('b'); return 'ok'; }, on: { ok: DONE } },
    },
  });

  test('runs to DONE and records exactly one event per transition', async () => {
    const events: TransitionEvent[] = [];
    const ctx = { order: [] as string[] };
    const result = await new Machine(graph, { onTransition: e => events.push(e) }).run(ctx);

    expect(result.outcome).toBe('done');
    expect(result.path).toEqual(['a', 'b']);
    expect(result.visits).toEqual({ a: 1, b: 1 });
    expect(events).toHaveLength(2);
    expect(events.map(e => [e.from, e.to, e.via])).toEqual([
      ['a', 'b', 'ok'],
      ['b', DONE, 'ok'],
    ]);
    expect(ctx.order).toEqual(['a', 'b']);
  });

  test('every event carries the machine id, timing and repeat count', async () => {
    const events: TransitionEvent[] = [];
    await new Machine(graph, { onTransition: e => events.push(e) }).run({ order: [] });
    for (const event of events) {
      expect(event.machine).toBe('linear');
      expect(event.type).toBe('transition');
      expect(Number.isFinite(event.durationMs)).toBe(true);
      expect(Number.isFinite(event.at)).toBe(true);
      expect(event.edgeRepeats).toBe(1);
    }
  });
});

describe('branching', () => {
  test('the state body chooses the edge, keyed by outcome', async () => {
    const graph = defineGraph<{ short: boolean; seen: string[] }>({
      id: 'branch',
      initial: 'bank',
      states: {
        // Short only on the first pass: the second visit must proceed, or this
        // graph is an intentional infinite loop.
        bank: { run: ctx => (ctx.short && !ctx.seen.includes('gather') ? 'short' : 'ok'), on: { ok: 'travel', short: 'gather' } },
        travel: { run: ctx => { ctx.seen.push('travel'); }, on: { ok: DONE } },
        gather: { run: ctx => { ctx.seen.push('gather'); return 'ok'; }, on: { ok: 'bank' } },
      },
    });

    // bank -> gather -> bank -> travel -> DONE. A recovery edge that re-enters
    // the same state is normal; what matters is that it terminates.
    const short = await new Machine(graph).run({ short: true, seen: [] });
    expect(short.outcome).toBe('done');
    expect(short.visits.bank).toBe(2);
    expect(short.visits.gather).toBe(1);

    const fine = await new Machine(graph).run({ short: false, seen: [] });
    expect(fine.path).toEqual(['bank', 'travel']);
  });

  test('a body returning nothing uses the single declared outcome', async () => {
    const graph = defineGraph<Record<string, never>>({
      id: 'void-body',
      initial: 'a',
      states: {
        a: { run: () => undefined, on: { only: 'b' } },
        b: { on: { ok: DONE } },
      },
    });
    const result = await new Machine(graph).run({});
    expect(result.outcome).toBe('done');
    expect(result.transitions[0]!.via).toBe('only');
  });
});

describe('failure paths', () => {
  test('an outcome with no edge fails the run and says why', async () => {
    const graph = defineGraph<Record<string, never>>({
      id: 'unhandled',
      initial: 'a',
      states: {
        a: { run: () => 'surprise', on: { ok: DONE } },
      },
    });
    const result = await new Machine(graph).run({});
    expect(result.outcome).toBe('failed');
    expect(result.transitions[0]!.via).toBe('unhandled');
    expect(result.reason).toContain('surprise');
  });

  test('a thrown error follows onError when declared, else fails', async () => {
    const recovered = defineGraph<Record<string, never>>({
      id: 'error-edge',
      initial: 'a',
      states: {
        a: { run: () => { throw new Error('bank closed'); }, on: { ok: DONE }, onError: 'b' },
        b: { on: { ok: DONE } },
      },
    });
    const result = await new Machine(recovered).run({});
    expect(result.outcome).toBe('done');
    expect(result.transitions[0]!.via).toBe('error');
    expect(result.transitions[0]!.reason).toBe('bank closed');

    const unhandled = defineGraph<Record<string, never>>({
      id: 'error-default',
      initial: 'a',
      states: { a: { run: () => { throw new Error('nope'); }, on: { ok: DONE } } },
    });
    const failed = await new Machine(unhandled).run({});
    expect(failed.outcome).toBe('failed');
    expect(failed.transitions[0]!.reason).toBe('nope');
  });

  test('a state that overruns its budget takes the recovery edge, not a hang', async () => {
    const graph = defineGraph<Record<string, never>>({
      id: 'timeout',
      initial: 'walk',
      states: {
        walk: { run: async () => { await sleep(60); return 'ok'; }, on: { ok: DONE }, timeoutMs: 5, onTimeout: 'retry' },
        retry: { run: () => undefined, on: { ok: FAILED } },
      },
    });
    const started = Date.now();
    const result = await new Machine(graph).run({});
    expect(result.outcome).toBe('failed');
    expect(result.transitions[0]!.via).toBe('timeout');
    expect(result.transitions[0]!.to).toBe('retry');
    expect(result.transitions[0]!.reason).toContain('budget');
    // The timeout reason survives the bookkeeping edge onto the terminal, so the
    // run reports WHY it failed, not just that it ended.
    expect(result.reason).toContain('budget');
    // It moved on at the budget rather than waiting out the body.
    expect(Date.now() - started).toBeLessThan(55);
  });

  test('maxVisits turns a re-entered state into one named failure', async () => {
    const graph = defineGraph<Record<string, never>>({
      id: 'visit-cap',
      initial: 'a',
      states: {
        a: { run: () => 'again', on: { again: 'a', ok: DONE }, maxVisits: 2 },
      },
    });
    const result = await new Machine(graph).run({});
    expect(result.outcome).toBe('failed');
    const last = result.transitions[result.transitions.length - 1]!;
    expect(last.via).toBe('visit-limit');
    expect(last.reason).toContain('limit 2');
  });

  test('maxEdgeRepeats fails a looping edge — the no_shield case', async () => {
    // The shape that used to hide: collect -> no_shield -> collect, forever.
    const graph = defineGraph<Record<string, never>>({
      id: 'shield-loop',
      initial: 'collect',
      maxEdgeRepeats: 3,
      states: {
        collect: { run: () => 'noshield', on: { noshield: 'no_shield', ok: DONE } },
        no_shield: { run: () => 'retry', on: { retry: 'collect' } },
      },
    });
    const events: TransitionEvent[] = [];
    const result = await new Machine(graph, { onTransition: e => events.push(e) }).run({});
    expect(result.outcome).toBe('failed');
    expect(result.reason).toContain('collect->no_shield');
    expect(result.reason).toContain('limit 3');
    // Every repeat was recorded, so the loop is visible in telemetry even
    // before the cap fires.
    const looping = events.filter(e => e.from === 'collect' && e.to === 'no_shield');
    expect(looping.map(e => e.edgeRepeats)).toEqual([1, 2, 3]);
    expect(events[events.length - 1]!.via).toBe('loop-limit');
  });
});

describe('step cap', () => {
  test('maxSteps fails a loop that has no other cap', async () => {
    const graph = defineGraph<Record<string, never>>({
      id: 'runaway',
      initial: 'a',
      maxSteps: 3,
      states: { a: { run: () => 'again', on: { again: 'a', ok: DONE } } },
    });
    const result = await new Machine(graph).run({});
    expect(result.outcome).toBe('failed');
    // Three real transitions, then the failing event itself is recorded too.
    expect(result.transitions).toHaveLength(4);
    expect(result.transitions[3]!.via).toBe('step-limit');
    expect(result.reason).toContain('maxSteps');
  });
});

describe('hooks', () => {
  test('onEnter runs before each state body and sees the visit index', async () => {
    const order: string[] = [];
    const graph = defineGraph<Record<string, never>>({
      id: 'hooks',
      initial: 'a',
      states: {
        a: { run: () => { order.push('body:a'); return 'again'; }, on: { again: 'a', ok: DONE }, maxVisits: 2 },
      },
    });
    await new Machine(graph, { onEnter: (state, visit) => { order.push(`enter:${state}:${visit}`); } }).run({});
    expect(order).toEqual(['enter:a:1', 'body:a', 'enter:a:2', 'body:a']);
  });

  test('a stop request is visible at the state boundary', async () => {
    let requested = false;
    const graph = defineGraph<Record<string, never>>({
      id: 'stop',
      initial: 'a',
      states: {
        a: {
          run: (_ctx, api) => {
            expect(api.stopping()).toBe(true);
            return 'ok';
          },
          on: { ok: DONE },
        },
      },
    });
    requested = true;
    const result = await new Machine(graph, { stopping: () => requested }).run({});
    expect(result.outcome).toBe('done');
  });
});

describe('validation', () => {
  const problemsFor = (spec: Parameters<typeof validateGraph>[0]) => validateGraph(spec);

  test('catches an unknown edge target', () => {
    expect(problemsFor({ id: 'g', initial: 'a', states: { a: { on: { ok: 'nope' } } } })).toContain(
      "state 'a' -> 'nope' (outcome 'ok') is not a declared state",
    );
  });

  test('catches an unreachable state', () => {
    expect(problemsFor({ id: 'g', initial: 'a', states: { a: { on: { ok: DONE } }, b: { on: { ok: DONE } } } })).toContain(
      "state 'b' is unreachable from 'a'",
    );
  });

  test('catches a dead end that can never reach a terminal', () => {
    const problems = problemsFor({ id: 'g', initial: 'a', states: { a: { on: { ok: 'b' } }, b: { on: { ok: 'a' } } } });
    expect(problems.some(p => p.includes('can never reach'))).toBe(true);
  });

  test('catches a state with no outgoing edge', () => {
    expect(problemsFor({ id: 'g', initial: 'a', states: { a: {} } })).toContain(
      "state 'a' has no outgoing edge — every state must lead somewhere or to $done/$failed",
    );
  });

  test('catches a multi-outcome state with no body to choose', () => {
    const problems = problemsFor({ id: 'g', initial: 'a', states: { a: { on: { ok: DONE, bad: FAILED } } } });
    expect(problems.some(p => p.includes('no run() to choose'))).toBe(true);
  });

  test('defineGraph throws one error listing every problem', () => {
    expect(() => defineGraph({ id: 'bad', initial: 'missing', states: { a: {} } })).toThrow(/'bad'/);
  });

  test('accepts a graph with a recovery edge and a terminal path', () => {
    expect(
      problemsFor({
        id: 'ok',
        initial: 'a',
        maxEdgeRepeats: 2,
        states: {
          a: { run: () => 'retry', on: { retry: 'b', ok: DONE }, timeoutMs: 1000 },
          b: { run: () => undefined, on: { ok: 'a' } },
        },
      }),
    ).toEqual([]);
  });
});

describe('mermaid', () => {
  const graph = defineGraph<Record<string, never>>({
    id: "cook's assistant",
    initial: 'inspect',
    states: {
      inspect: { run: () => 'fresh', on: { fresh: 'bank' } },
      bank: { run: () => 'short', on: { ok: 'travel', short: 'gather' }, timeoutMs: 90_000 },
      travel: { run: () => 'ok', on: { ok: 'verify' } },
      gather: { run: () => 'ok', on: { ok: 'travel', fail: FAILED } },
      verify: { run: () => 'ok', on: { ok: DONE, bad: FAILED } },
    },
  });

  test('renders states, labelled edges and terminal markers', () => {
    const diagram = toMermaid(graph);
    expect(diagram).toContain('stateDiagram-v2');
    expect(diagram).toContain('[*] --> inspect');
    expect(diagram).toContain('bank --> gather : short');
    expect(diagram).toContain('verify --> [*] : ok');
    expect(diagram).toContain('verify --> [*] : bad');
    expect(diagram).toContain('note right of bank : 90s budget');
  });

  test('shows a loop as a real back-edge', () => {
    const looping = defineGraph<Record<string, never>>({
      id: 'shield',
      initial: 'collect',
      states: {
        collect: { run: () => 'noshield', on: { noshield: 'no_shield', ok: DONE } },
        no_shield: { run: () => 'retry', on: { retry: 'collect' } },
      },
    });
    expect(toMermaid(looping)).toContain('no_shield --> collect : retry');
  });

  test('highlights the states a run actually visited', () => {
    const diagram = toMermaid(graph, { path: ['inspect', 'bank', 'gather', 'travel'] });
    expect(diagram).toContain('class inspect,bank,gather,travel visited');
  });
});
