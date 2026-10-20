# State machines (`sdk/fsm.ts`)

Scripts used to encode their control flow as a sequence of `setPhase()` calls —
phase strings with the real structure living in the shape of the code. That works
until something loops. A bot that walks at a shield spawn it cannot reach
re-entered its own `collect` phase forever: eight bots failed that way and
nothing in the system could say *which state* was looping, only that a stall log
had grown.

A graph makes that loop a fact you can see, count and cap.

## Declaring one

```ts
import { DONE, FAILED, defineGraph, Machine } from './sdk/fsm';

export const graph = defineGraph<Ctx>({
    id: 'bank-report',
    initial: 'travel',
    maxEdgeRepeats: 3,          // insurance: a repeating edge cannot run forever
    states: {
        travel: {
            run: async (ctx) => (await walk(ctx) ? 'arrived' : 'blocked'),
            on: { arrived: 'open', blocked: 'next-bank' },
            timeoutMs: 600_000,
        },
        open: {
            run: async (ctx) => (await tryOpen(ctx) ? 'open' : ctx.attempts >= 3 ? 'exhausted' : 'retry'),
            on: { open: 'report', retry: 'open', exhausted: 'next-bank' },   // self-loop
            timeoutMs: 90_000,
        },
        'next-bank': { run: nextBank, on: { next: 'travel', none: FAILED }, timeoutMs: 5_000 },
        report: { run: report, on: { ok: DONE }, timeoutMs: 120_000 },
    },
});
```

Rules the validator enforces before anything runs:

- every edge target is a declared state, or `DONE` / `FAILED`;
- every declared state is reachable from `initial`;
- every reachable state can still reach a terminal (no spinning islands);
- a state with several outcomes must have a `run` that can choose between them;
- recovery edges (`onTimeout`, `onError`, `onVisitExceeded`) count as real
  edges for both reachability and termination.

`defineGraph` throws once with **every** problem listed; `validateGraph` returns
the list, which is what the CLI uses.

## Running one

```ts
const machine = new Machine(graph, {
    onTransition: (e) => session.event('transition', e, `${e.from} -> ${e.to} (${e.via})`),
    stopping: () => session.isStoppedOrRequested(),
});
const result = await machine.run(ctx);   // { outcome, reason, path, visits, transitions, elapsedMs }
```

`result.outcome` is `'done'` (reached `DONE`) or `'failed'`, and `result.reason`
is the reason that *caused* the ending — a timeout that led to a failure keeps
saying "exceeded its budget", not "ended in $failed".

## The outcome is the guard

A state body returns a string; the graph says where each string leads. Guards are
that returned key, which keeps the decision in one place (the body, where the
world's state is readable) and the routing in another (the graph, where it can be
drawn and checked without a server). A body that returns `undefined` may only be
used in a state with exactly one outgoing outcome.

## What each guarantee costs

| Guarantee | Behaviour | Cost |
| --- | --- | --- |
| `timeoutMs` | body exceeding its budget follows `onTimeout` (or `on.timeout`, else `FAILED`) | the abandoned promise keeps running; SDK actions are individually bounded, so it cannot wedge the client, but the body must not assume it was awaited |
| `maxVisits` | entering a state more than N times takes `onVisitExceeded` (default `FAILED`) | counts are global to the run; a per-bank reset is the body's job (keep the counter in `ctx`) |
| `maxEdgeRepeats` | the Nth+1 repeat of one edge fails the run as `loop-limit`, naming the edge | legal recovery loops must stay under the cap |
| `maxSteps` | a hard transition cap for graphs that forgot the others | grinders legitimately loop: leave it unset unless the graph should terminate |

## Telemetry: one event per transition

Every edge writes exactly one event, including the machine's own overrides
(`timeout`, `error`, `visit-limit`, `loop-limit`, `step-limit`, `unhandled`):

```json
{"type":"transition","machine":"bank-report","from":"open","to":"report","via":"open",
 "visit":1,"durationMs":1192,"elapsedMs":1203,"edgeRepeats":1}
```

`edgeRepeats` is what makes a loop auditable: `collect -> no_shield` at
`edgeRepeats: 3` is a bot in a cycle, not a bot making progress. Wire it to
`ActivitySession.event()` and it lands in `events.log`; the third argument also
puts a readable line in `grind.log`.

## Diagrams and CI

```bash
bun sdk/fsm-cli.ts bots/quests/bank-report.graph.ts          # mermaid
bun sdk/fsm-cli.ts bots/quests/bank-report.graph.ts --write   # …also a .mmd
bun sdk/fsm-cli.ts bots/quests/bank-report.graph.ts --check   # exit 1 if invalid
```

```
stateDiagram-v2
  [*] --> travel
  travel --> open : arrived
  travel --> next_bank : blocked
  open --> report : open
  open --> open : retry
  open --> next_bank : exhausted
  next_bank --> travel : next
  next_bank --> [*] : none
  report --> [*] : ok
```

`--check` belongs in CI: a dangling edge or an unreachable state fails the build
instead of becoming a bot that walks in circles for twenty minutes.

## Converting a script

The pattern that worked on `bank-report` and Cook's Assistant:

1. **Split the file.** `<name>.graph.ts` holds the declaration; `<name>.ts` keeps
   the world code (walking, banking, dialogs) and runs the machine.
2. **Give the graph verbs, not the SDK.** The context exposes capabilities —
   `readStage`, `bankForSupplies`, `travelToCook`, `acceptQuest`, `handIn`,
   `checkpoint` — so the graph file imports nothing that needs a client. That is
   what makes `fsm-cli --check` runnable in CI and the graph testable with fakes.
3. **Move each `setPhase(...)` onto a state.** The old phase names become state
   ids, and `onEnter` updates the session phase — so the log's phase can no
   longer disagree with the control flow.
4. **Turn every `throw` into an edge.** A throw used to mean "the script dies
   here". Now it is either `onError` (with a named retry edge) or the body
   returns a failing outcome that routes to `FAILED` with a reason. Anything left
   throwing is a bug you can see in the diagram as a missing edge.
5. **Keep the checkpoint gate inside `verify`.** Completion is still proven by
   journal evidence; the machine decides what happens when it is not proven.
6. **Prove no regression with the eval harness.** `bun quest-eval/run.ts` runs the
   converted script N times from a fixed fixture; a rewrite that changes
   behaviour shows up as a dropped pass rate or a new failure state.

Cook's Assistant before/after: same six phases, same ~2 minutes, and the route
is now data:

```
inspect -> bank -> travel -> start -> handin -> verify      (6 transitions)
```

## Limits

- The machine is sequential: one active state, no parallel regions. Parallel
  work belongs in a state body or a second script.
- It does not own the SDK client or the session — the caller passes them in
  `ctx`, which is what keeps the graph importable without a world.
- Timeout bodies are abandoned, not cancelled (see the table above).
- A done run says nothing about *why* each state's work succeeded; that is what
  the quest-lab checkpoint layer (journal evidence) is for. The machine records
  transitions, not gameplay truth.
