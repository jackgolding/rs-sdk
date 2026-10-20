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

## Where a discovered problem belongs

A quest that hits a wall should not quietly carry the workaround. Decide by blast
radius:

| problem | owner | why |
| --- | --- | --- |
| movement that no script can do (pathfinder gap, blocked corridor) | the shared travel layer (`sdk/travel.ts` registry + a mover) | every script walking there will hit it |
| a door/ladder/teleport with an activation rule | a named connector in the shared layer | it is a mechanic, not a route |
| narrative one-off (an NPC escorts you, a one-time disguise) | the quest, but through the shared mover | nothing else can reuse it |

Either way it is **recorded**: every `BLOCKED` / short arrival appends to
`travel-gaps.jsonl` with coordinates, the script and the mover's reason.

```bash
bun sdk/travel-check.ts --gaps     # grouped work items, most-hit first
bun sdk/travel-check.ts            # which scripts travel with no shared mover
bun sdk/travel-check.ts --strict   # CI: fail while any script travels blind
```

Three rules that came out of the Wizards' Tower failure (three eval attempts,
three different walls, each one dying in a single script's log):

1. Cross-region legs use the shared hop walker. `bot.walkTo` plans with the
   CLIENT pathfinder, which has no graph for stretches of the map and returns
   `no waypoints` for walkable tiles — with no fallback the script just dies.
2. A state that claims a position must verify it. `enterTower` accepted "inside"
   at 3 tiles — outside the door — and sent the next step at the wrong staircase.
3. A fix lands as its own commit, with a regression test, reviewed separately
   from the quest that found it. The quest PR then just declares a route.

## Dev ↔ prod parity

Fixes get made where the failure shows up, and that is how the two trees drift:
Dwarf Cannon, Fremennik Trials and Red Dragons were all worked on in prod while
dev was being rewritten.

```bash
bun tools/quest-parity.ts --dev ~/rs-sdk-offline --prod ~/rs-sdk
bun tools/quest-parity.ts --dev … --prod … --only 'cannon|fremennik|red-dragons'
bun tools/quest-parity.ts --dev … --prod … --show red-dragons.ts   # prod -> dev diff
bun tools/quest-parity.ts --dev … --prod … --strict                # CI gate
```

| status | meaning | action |
| --- | --- | --- |
| `same` | identical bytes | nothing |
| `dev-only` | unmerged work | expected before a merge |
| **`prod-only`** | a fix dev never received | port it into dev, never assume it is gone |
| **`differs`** | both sides changed it | manual merge, never a copy in either direction |

`prod-only` and `differs` are the two that silently revert someone's work. Run
the parity check before every fleet merge and after every prod hotfix.

## The canary tier, and its rules

Between "works in dev" and "on the roster" there is exactly one useful tier: **one
account, on the production image, at the production clock and latency**, driven by
a container the deployment pipeline did not create.

```
dev (local world) ──▶ canary (1 account, prod image) ──▶ roster (supervised)
```

It is not optional. Every bug that only production has — a pathfinder that
truncates long routes, 10-tile hops refused by hedge geometry, a stronghold with no
route off its plane — was found here, on one account, instead of by 48.

**But the tier only works when it is a tool, not an improvisation.** Doing it by
hand cost us three incidents in one afternoon:

| what happened | why it happened | the rule it produced |
| --- | --- | --- |
| the shepherd recreated the roster service mid-run and pre-empted the controller | nothing had paused the bot | the tool pauses by *mechanism* (skip file + stop), never by memory |
| a `scp`'d dev file imported a module the deployed revision lacks, crashing every container that shares it | code reached prod outside git | a canary runs **committed, already-deployed** code; never a copy |
| a test container sat running long enough to look like production | no label, no expiry, no sweep | every canary is labelled and TTL'd, and `--gc` removes the expired |

```bash
tools/canary.sh <bot> <script.ts> [args...]   # run, follow, auto-restore on exit
tools/canary.sh --dry <bot> <script.ts>       # print the plan, touch nothing
tools/canary.sh --status                      # what is running as a canary
tools/canary.sh --gc                          # remove expired canaries
```

The script refuses to run if the box tree is dirty, or if the script is not on the
box (i.e. not deployed), and its `EXIT` trap restores the bot on success, failure,
`^C` or timeout.

**What a canary is not:** a place for state. Anything that should survive an hour
or be monitored — a standing harvester, a lapper, a mule — belongs in the roster,
where the shepherd heals it and the desk shows it. Discovery in a canary, permanence
in the roster, promotion through the four stages above.

## Three clocks

Timing is two axes, and the local world has neither of the prod ones:

| regime | tick | latency | purpose |
| --- | --- | --- | --- |
| **dev-fast** | 60ms | none | get from rough to locally-working: cook's 2 minutes becomes 23s |
| **dev-prod-sim** | 300ms | 150ms each way (lag proxy) | verify before a canary: same clock and RTT class as the demo server |
| **prod canary** | 300ms | ~250ms (Perth → iad) | the real thing, one account |

```bash
tools/clock-gate.sh 60  --runs 1 --min-runs 1      # fast iteration
bun tools/lag-proxy.ts --delay 150 &               # :7781 -> :7780
tools/clock-gate.sh 300 --runs 3 --gateway http://127.0.0.1:7781
```

The clock-gate rewrites `server/engine/.env`, restarts the launchd engine, runs
the suite, then restores. **It boots every local session** — only run it when
that is acceptable.

A fast clock is a development clock, never a verification one: at 20ms/tick a
two-tick settle is 40ms and races disappear. That is why the gate is at 300ms,
and why waits are written as conditions with wall-clock budgets (`bots/quests/timing.ts`,
`bots/quests/settle.ts`) rather than tick counts — a condition finishes early on
a fast clock and still fits on a slow one.

## Where the pieces live

| Stage | Artifact |
| --- | --- |
| dev build | `bots/quests/<script>.ts` + `<script>.graph.ts`, `sdk/fsm.ts` |
| dev verify | `quest-eval/` (harness, suites, reports), `quest-lab/` (fixtures, checkpoints) |
| prod test | demo server account + `bots/<canary>/` logs |
| approval | the fleet PR itself |
