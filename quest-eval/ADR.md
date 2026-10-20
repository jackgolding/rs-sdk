# ADR: quest-eval — scoring quest scripts offline

Status: accepted. Applies to `quest-eval/`.

## Context

Quest scripts are written (increasingly by models) against a local world, then
promoted to the live fleet. Promotion had no measurable criterion: a run was
judged by whether the bot stopped walking and the journal said something. Two
consequences:

1. Failures were discovered in production, one bot at a time, with no record of
   which state died.
2. Comparing two scripts — or two models that wrote scripts — was a matter of
   opinion.

The pieces to do better already existed: fixtures that build reproducible
starting accounts, a journal-based checkpoint layer that returns PASS / FAIL /
UNKNOWN with reasons, and structured `events.log` / `checkpoints.jsonl`
telemetry.

## Decisions

### 1. Score from checkpoint evidence, never from script optimism

A pass requires `exit 0` **and** a PASS on every required checkpoint. A run that
exits 0 without writing a run record is a failure. Rationale: a script that
thinks it succeeded is the exact failure mode this exists to catch — Vampire
Slayer "completed" on Hitpoints XP, and Druidic Ritual on Herblore XP, before the
journal layer was introduced.

Rejected: parsing the script's own stdout for "DONE". It is the same claim the
script is making.

### 2. One fresh fixture account per attempt, not one account restored N times

Re-running a quest needs a pre-quest state. Two ways to get it:

- **Restore a saved snapshot between attempts.** Fast, and it is what "fixed
  starting snapshots" literally suggests. But the engine prefers the
  `market.sqlite` checkpoint row over the `.sav`, so a restore is a two-store
  write against a live engine, in a specific order, with a ghost window to wait
  out. Get it wrong and the run *looks* clean while starting mid-quest — a
  silently invalid measurement, which is worse than a slow one.
- **Provision a fresh account from the fixture spec.** Fails closed: the
  materializer refuses any name that already has a save or a checkpoint row, so
  it cannot stage the wrong starting state. Costs one disposable `ql…` name per
  attempt.

Took the second. The fixture spec is the fixed starting snapshot; deriving an
account from it is deterministic, and it removes an entire class of
measurement-invalidating bugs. Names are burned per attempt by design
(`qle<code><token><n>`), which also means a re-run never collides with a body
still ghosting in `/playerpositions`.

Consequence to watch: accounts accumulate. Cleanup is a separate, operator-run
task (quest-lab has the deletion procedure), not something the eval loop does
inline — deleting saves while a ghost exists resurrects them.

### 3. The harness fails closed and says who failed

Attempts that never reach the quest (provisioning refused, client never logged
in, teardown left a ghost) are `error`, counted separately, and force exit code
`2`. They are *not* scored as quest failures. A gate that cannot tell "the
script regressed" from "the runner is broken" trains people to ignore it.

### 4. Gate on a rate over a minimum sample, and per quest

`minPassRate: 0.8` **and** `minRuns: 3` by default. With one run, 100% is noise.
The suite also fails if any single quest fails its own gate, so one regression is
not averaged away by healthy neighbours.

This is deliberately stricter than it may look: 2/3 = 67% fails an 80% gate. A
quest that passes two times in three is flaky, and flaky is what the fleet
cannot afford.

### 5. Pure aggregation, separate from the game

`report.ts` and `telemetry.ts` are pure functions over records and log text; only
`attempt.ts` touches processes. The gate arithmetic is therefore unit-tested
(`bun test quest-eval/tests`) on synthetic runs, and a stored `report.json` can be
re-aggregated without a world. Testing a threshold through the game would make it
the slowest, flakiest test in the repo.

### 6. Sequential by default

Quests compete for the same NPCs, spawns and shop stock. Parallel attempts would
fold interference into the pass rate. Concurrency can come later, behind a
per-quest opt-in, once the measurement is stable single-threaded.

### 7. Time to finish is measured from script start to script exit

Not from login, not including provisioning. Provisioning is harness overhead; the
number an operator cares about is how long the quest takes once it starts.

### 8. Cost is measured by the platform, and failed drafts stay in the bill

`--session` imports Hermes' own `session_model_usage` rows (billed cost, else
its estimate) for every model that touched the session — including subagents and
review traffic, because those tokens were spent producing that script. Only
`title_generation` is excluded as UI metadata.

The metric is `total spend on a model's scripts ÷ scripts that clear the gate`.
Drafts that never passed are in the numerator on purpose: a model that needs four
attempts for one working script is not cheaper than one that needs one, and a
metric that forgets failed drafts rewards burning attempts. Tokens without a rate
card are recorded `unpriced` and the report says the figure is a lower bound —
never `$0.00`, which is why `costPerPassingScriptUsd` is `null` (not zero) when
nothing passes.

Attribution is coarse by construction: a session is attributed to one quest. The
first real entry ($0.23 for Cook's Assistant) covers a session that also built the
harness, so it is an upper bound and carries a `note` saying so. Finer attribution
needs per-script authoring sessions, which is a process change, not a code change.

## Consequences

- A red gate is actionable: state, reason, and per-attempt logs are all on disk.
- Evaluating a new or rewritten script costs ~2 minutes per attempt for a short
  quest, and one disposable account each.
- The measurement is scoped honestly: maxed, supplied, fixed-spawn account, at
  the local server's tick rate. It is a regression gate, not a proof of
  production readiness.
- CI needs a machine with the local world. Unit tests and typecheck run in the
  normal `bun run check`; the game-backed suite belongs in a nightly job, with a
  `--dry` plan check in PR CI.

## Open questions

- **Cost per passing script** (model comparison) needs token accounting from the
  writing agent. The report schema has room; nothing writes it yet.
- **Flake accounting.** A quest that passes 4/5 has a flake profile worth
  tracking over time; today only the current run set is stored.
- **Sim-to-real gap.** The demo server is a different tick rate and content
  revision. A local 100% is a lower bound, not a guarantee — measuring that gap
  needs runs against the demo world, which the harness can do (`--web`/`--gateway`)
  once someone owns the cost of those accounts.
