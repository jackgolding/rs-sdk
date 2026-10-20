# Promotion flow: dev → verify → prod test → approved merge

Every change to a bot script or the SDK follows the same four stages. Each stage
has a gate, and a stage is not skipped because the change "looks small" — the
expensive failures in this fleet were all small changes that worked locally.

```
build in dev ──▶ verify in dev ──▶ test in prod ──▶ approved prod merge
   (compiles)      (eval gate)       (one canary)      (human + evidence)
```

## 1. Build in dev

Where: the offline worktree (`~/rs-sdk-offline`) — never the fleet checkout.

Gates, all cheap and all runnable without a world:

```bash
bun build --target=bun bots/quests/<script>.ts --outdir /tmp/preflight   # compiles (bun target, not browser)
bun sdk/fsm-cli.ts bots/quests/<script>.graph.ts --check                 # every declared graph is valid
bun test sdk/test/fsm.test.ts quest-eval/tests quest-lab/tests           # unit tests
bun run typecheck                                                        # in the fleet checkout for sdk/ changes
```

A graph that fails `--check` (dangling edge, unreachable state, a state that can
never reach `DONE`/`FAILED`) fails here, not in production. This stage costs
seconds and catches the whole class of "the route was never reachable".

## 2. Verify in dev

Where: the same offline worktree, against the local engine + gateway.

```bash
bun quest-eval/run.ts --runs 3            # the gate: ≥80% pass rate over ≥3 runs
bun quest-eval/run.ts --suite quest-eval/suites/<suite>.json --runs 3
```

This is the stage that makes the rest trustworthy:

- a **fresh fixture account per attempt**, so every run starts from the same
  state and a clean pass rate means the script is repeatable, not lucky;
- failure **states**, not just pass/fail: `checkpoint:<id>` when the evidence
  layer names it, the script phase otherwise;
- recovery counts and time-to-finish per attempt;
- artifacts on disk (`quest-eval/reports/<stamp>-<suite>/`) — attach them to the
  PR instead of describing the run in prose.

A red gate means the SCRIPT regressed; exit code 2 means the harness broke and
nothing was proven. Neither is a merge.

## 3. Test in prod

Where: the demo server, on ONE canary account — not the roster.

```bash
bun bots/create-bot.ts <canary> --server=rs-sdk-demo.fly.dev   # or reuse a parked canary
bun bots/quests/<script>.ts <canary>
```

Watch, don't assume: the first live run's `checkpoints.jsonl`, its `events.log`
transitions, and the journal-verified completion. Prod differs from dev in ways
the local world cannot show — link latency (a step loop can overshoot a
publication), grants behind a modal, prices, and the supervisor's health verdict.
That is why this stage exists and why one account is enough to learn from.

Record: run id, the checkpoint verdicts, the transition route, and anything the
operator had to rescue. A rescue is an assisted attempt, not a pass — it needs a
fresh re-run after the fix.

## 4. Approved prod merge

Merge only when 1-3 are green and the evidence is attached:

- [ ] build gates green (compile, graph check, unit tests, typecheck)
- [ ] `quest-eval` gate green, report attached
- [ ] canary run journal-verified complete, route + checkpoints attached
- [ ] no manual rescue in the canary run
- [ ] the script is frozen between the canary and the merge (no drive-by edits)

The merge itself is the human gate: the operator approves, the PR lands on the
fleet branch, and only then does the roster see the script. Nothing promotes
itself — the harness and the canary produce evidence, the human decides.

Rollback is a revert of that merge commit plus a roster switch away from the
script; the frozen candidate stays on the branch, so re-promoting after a fix is
another pass through the same four gates.

## Where the pieces live

| Stage | Artifact |
| --- | --- |
| dev build | `bots/quests/<script>.ts` + `<script>.graph.ts`, `sdk/fsm.ts` |
| dev verify | `quest-eval/` (harness, suites, reports), `quest-lab/` (fixtures, checkpoints) |
| prod test | demo server account + `bots/<canary>/` logs |
| approval | the fleet PR itself |
