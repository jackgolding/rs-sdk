# The night shift: unattended quest development

The target state, in one sentence: **say "build a script for every quest", and
work happens until every quest is either fleet-ready or blocked with evidence —
without anyone watching it.**

Three things make that safe, and all three are files, not habits:

| concern | artifact | what it enforces |
| --- | --- | --- |
| what to do next, and how far each quest has got | `quest-lab/status.json` (`tools/quest-queue.ts`) | one owner per quest, attempt budgets, and transitions that refuse to skip the canary |
| whether a run actually worked | `quest-lab/canary.ts` (`tools/quest-canary-grade.ts`) | PASS only from the run record + the journal's completion line; an empty required list fails |
| which accounts grind which quests | fleet state `bots/todo.json` (`bots/quests/todo-runner.ts`) | only canary-PASSED quests ever land on a list, and a run that fails the evidence gate stops the list |

## The pieces

```
quest-lab/catalogue.json     68 quests derived from pinned content (ids, journal, blockers)
quest-lab/status.json        the queue: stage, owner, attempts, candidate, canary, evidence
tools/quest-queue.ts         init | status | next | workorder | freeze | canary | block | promote
quest-eval/run.ts            dev gate: fresh fixture per attempt, >=80% over >=3 runs
tools/canary.sh              canary tier: one account, deployed image, pause + TTL + restore
tools/quest-canary-grade.ts  grades a canary run record (local or straight off the box)
bots/quests/todo-runner.ts   an account grinds its todo list, one quest at a time
```

Stages and who may move them:

```
catalogued ─▶ fixture ─▶ drafting ─▶ dev-verified ─▶ canary ─▶ fleet-ready ─▶ rolled-out
                ▲            ▲            ▲              │            │
                └────────────┴────────────┴──────────────┘            │
                            regression: back to drafting              │
                                                                      └─▶ todo.json
blocked ◀── any stage, with a reason (budget exhausted, content blocker, no route)
```

`fleet-ready` is impossible without a **PASSING canary**; `rolled-out` is
impossible without at least one account on a todo list. Those two guards are the
whole reason the queue is code and not a spreadsheet.

## Running a night

Preconditions (the operator does these once, before sleeping):

1. Fleet tree deployed and clean on the box; the canary image is `fleet-pilot:latest`.
2. `tools/quest-parity.ts --dev ~/rs-sdk-offline --prod ~/rs-sdk` reports no
   `prod-only` / `differs` quests — otherwise the night starts by reverting
   someone's fix.
3. A parked canary account on the demo server (never a roster bot).
4. Do not run `tools/clock-gate.sh` during the night: it rewrites the engine tick
   and restarts the launchd engine, which boots every local session.

Start:

```bash
cd ~/rs-sdk-offline
bun tools/quest-queue.ts init                     # refresh facts, never rewinds progress
bun tools/quest-queue.ts status                   # what is where right now
```

Then dispatch. Each quest developer gets ONE quest and its own tree:

```bash
bun tools/quest-queue.ts next --owner agent-1 --limit 1     # claims + prints the work order
bun tools/quest-queue.ts workorder <quest>                  # the same brief on demand
```

The brief is self-contained: isolated worktree, build gates, the eval command,
the freeze step, the canary command, and the exact queue commands to report back
with. A subagent needs no context beyond it.

## Concurrency, and why it is capped

- **One controller per account.** A second SDK connection pre-empts the first and
  the survivor reads stale state. Parallelism therefore comes from *different
  accounts*, never from a second driver on one.
- **Start at three quest writers.** `quest-eval` is sequential within a run and
  quests share the local world's NPCs and resources; two agents hunting the same
  spawn measure each other's interference, not their scripts.
- **Canaries are strictly serialized.** `tools/canary.sh` takes a roster service
  slot and pauses it; two at once fight over the same box and the same image.
  The queue refuses to claim a quest that is already in `canary` for this reason.
- **Shared code is parent-owned.** A movement gap or a door mechanic found by one
  quest writer belongs in the shared travel layer, fixed once, on its own commit —
  never patched inside the quest that found it.

## Budgets, and when the night stops

| budget | default | what happens at the limit |
| --- | --- | --- |
| dev attempts per quest | 6 | `claim` refuses; block it with the evidence and move on |
| canary attempts per quest | 4 | the entry is `blocked` automatically, naming the last run id |
| two identical failures | rule of the pipeline | stop launching runs, write a throwaway probe, patch once from the diagnostic dump |
| wall clock | operator's call | `status` is the resume point; nothing is hidden in a transcript |

A blocked quest is a *result*: it carries the run records that justify it. An
agent that ends the night with 12 `fleet-ready` and 20 blocked-with-evidence has
done its job; one that reports 30 "working" scripts has not.

## Promoting

```bash
bun tools/quest-canary-grade.ts --box --latest viking         # PASS/FAIL, from the record
bun tools/quest-queue.ts canary viking --verdict PASS --run-id <id> --account <acct>
bun tools/quest-queue.ts promote viking --accounts Jackpoo1,Jackpoo2
```

`promote` writes the fleet todo list (`/srv/fleet/bots/todo.json`) and nothing
else. The accounts' roster entries still have to point at
`bots/quests/todo-runner.ts`, and that switch happens at a **stage boundary** —
never mid-run.

The runner executes one quest at a time, grades each run with the same evidence
rule, marks the item done, and stops the list on the first failure. It does not
retry: a failed run leaves a record, and the next attempt is a decision, not a
loop.

## What is deliberately NOT automatic

- **The merge.** `fleet-ready` means "evidence exists"; it does not merge, and
  nothing in this pipeline edits the roster on its own.
- **The canary account's provisioning.** The demo server is not ours; a canary
  account is created and parked by the operator, and a canary attempt uses a
  fresh account rather than a fixture (the fixture materialiser is local-only).
- **Content defects.** A quest whose door cannot be climbed from any neighbour is
  a content blocker: `block` it with the scan dump. Never work around it silently.

## Appendix: the instruction that starts a night

Give the parent agent this, verbatim (or say "build a script for every quest"):

> Run the night shift on the rs-sdk quest queue.
>
> 1. `cd ~/rs-sdk-offline && bun tools/quest-queue.ts init && bun tools/quest-queue.ts status`.
>    Run `bun tools/quest-parity.ts --dev ~/rs-sdk-offline --prod ~/rs-sdk --strict` and report
>    drift — do not "fix" it by copying in either direction.
> 2. `bun tools/quest-queue.ts plan --limit 3` and dispatch ONE subagent per work order. Each
>    subagent: claims its quest (`next --owner <its-id> --limit 1`), works only in its printed
>    worktree, and stops at a FROZEN CANDIDATE. Subagents never run the canary.
> 3. You run canaries, one at a time: `tools/canary.sh <acct> <file> --then-grade <quest>`, then
>    record it with `quest-queue.ts canary ... --verdict PASS|FAIL`.
> 4. Promote only `fleet-ready` quests, only to accounts the operator named.
> 5. Stop and report if three quests in a row block on the same failure class, if the local
>    engine is down, or if the canary box is dirty.
>
> Never edit `~/rs-sdk`, never edit `bots/roster.json`, never run `tools/clock-gate.sh`, and
> record authorship spend with `quest-eval/author.ts record` for each script delivered.
>
> Final report: fleet-ready (with run ids), blocked (with reasons and evidence paths), and what
> you did not get to.

## The canary set

Three accounts are parked at **Edgeville bank** for this tier (`quest-lab/canaries.json`),
switched there via `bots/quests/edgeville-bank-all.ts` so a failed quest leaves them
at a bank with an empty pack rather than stranded mid-dungeon:

| account | combat | banked at | Magic / WC / Craft / Fletch / Agility / RC / Mining |
| --- | --- | --- | --- |
| jacklove8 | 123 | 3094,3489 | 1 / 1 / 1 / 1 / 1 / 1 / 1 |
| jacklove9 | 123 | 3094,3489 | 1 / 1 / 1 / 1 / 1 / 1 / 1 |
| jacklove14 | 112 | 3094,3489 | 1 / 1 / 1 / 1 / 1 / 1 / 1 |

All three are 99 Cooking/Fishing/Thieving with combat 112-123 and Prayer 61-76, so
the fight-and-cook quests are canary-ready today with **no training**.

Rules:

- One canary at a time. The canary takes the account from the bank, runs the
  candidate, and returns it to `edgeville-bank-all.ts`.
- A canary is never rostered onto a grind. A training leg is a *temporary*
  switch that ends back at the bank, and it is recorded in `canaries.json`
  (`trainedFor`) so the next quest knows what was lifted.
- Canary levels are a snapshot from the gateway frame, not live truth. Re-read
  before issuing any level-gated leg — a leg whose target is already met
  restart-loops.

### Training before a quest

Quest gates bind on the weakest skill, so plan legs weakest-first:

```bash
bun tools/quest-training.ts --levels '{"Woodcutting":1,"Crafting":1,"Fletching":1}' \
  --goal Woodcutting=40,Crafting=40,Fletching=25
```

That prints one roster script per leg. Issue them one at a time, re-reading the
level between legs, and park the account again when the last leg lands.

Known gaps in the trainer registry (`bots/quests/training.ts`) — check before
promising a quest:

- **Fletching below 25**: `bank-fletch` reads yew/magic logs only (Fletch 65+),
  so its `minLevel: 1` entry is wrong for a fresh account. Low-level fletching
  needs normal/oak logs and has no trainer yet.
- **Prayer**: no trainer at all.
- Crafting is covered by `sheep-shearer --until=10` → `bowstrings` (needs flax)
  or `cut-gems`; `doric-iron-knives` is Smithing-first and wants iron bars.
