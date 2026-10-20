# quest-eval

An eval harness for AI-written quest scripts. It runs a quest script N times from
a fixed starting state, records what actually happened, and gates on the result:

```
quest             runs    pass%   median   p90      recov  gate
cook              3/3     100%    1m58s    2m04s    0.0    PASS

gate: ≥80% over ≥3 runs — PASS
```

A script that cannot clear the gate does not reach the roster.

## Why this exists

Quest scripts used to be judged by whether a run "looked fine": the bot stopped
walking, the journal said something, XP went up. That is how a `no_shield` loop
sits in the roster with eight bots quietly failing and nobody able to say which
state they died in.

The harness replaces opinion with a number per quest: **pass rate, time to
finish, the state it failed in, and how many recoveries it needed**. Everything
else here exists to make that number trustworthy.

## Run it

The harness needs a live local world (engine `:8888`, gateway `:7780`) and the
local-only fixture materializer at
`server/engine/tools/server/quest-lab-fixture.ts`. That means it runs from the
offline worktree, where quest-lab lives:

```bash
cd ~/rs-sdk-offline
bun quest-eval/run.ts                       # suites/smoke.json
bun quest-eval/run.ts --only cook --runs 5  # narrower, more samples
bun quest-eval/run.ts --dry                 # print the plan, stage nothing
bun quest-eval/run.ts --json                # machine-readable report on stdout
```

Useful flags: `--suite`, `--only a,b`, `--runs`, `--timeout <seconds>`,
`--gate <rate>`, `--min-runs`, `--stop-on-fail`, `--quiet`, `--repo`, `--web`,
`--gateway`, `--out`.

Exit codes are part of the contract:

| code | meaning |
| --- | --- |
| `0` | gate passed |
| `1` | gate failed — the **script** regressed |
| `2` | the harness could not run — fix the **runner**, not the quest |

A CI job that reports red without saying which of those happened wastes the
reader's first five minutes; this split avoids that.

## What one attempt does

1. Refuses to stage if the account is already in the world.
2. Writes the account's `bot.env` (`SERVER` **and** `GATEWAY_URL` — a blank
   `SERVER` makes the lite runner die fetching `http://localhost/crc`).
3. Provisions a **fresh** account from the suite's fixture: maxed stats, tutorial
   complete, banked supplies, quest under test unstarted.
4. Starts the headless lite client and waits for `inGame`.
5. Runs the quest script under a time budget.
6. SIGINTs the client (clean logout) and waits for the body to leave
   `/playerpositions`.
7. Collects evidence: the run's `checkpoints.jsonl`, the script's `events.log`
   session slice, and the timings.
8. Classifies, then aggregates.

A pass means **the script exited 0 AND every required checkpoint carries a
PASS**. Not "the script said it was done": a run that exits 0 with no run record
is scored as a failure, because nothing in it is proven.

## Reading a failure

Each attempt reports a `failureState` in the vocabulary an operator thinks in:

- `checkpoint:<id>` — the checkpoint layer named the state (`checkpoint:complete`,
  `checkpoint:olaf`). This is the good case: the evidence layer knows where it
  died.
- `<phase>` — no checkpoint evidence exists (died before its first gate, or hit
  the time budget), so the last script phase is the truth.
- `harness` — the attempt never got to the quest (provisioning, login,
  teardown). Counted separately and always fails the gate.

Per-attempt artifacts land in `quest-eval/reports/<stamp>-<suite>/logs/<quest>-<account>/`:
`provision.log`, `lite.log`, `script.log`. The suite report is `report.json`
plus a `summary.md` written for PR bodies.

## Suite format

```json
{
  "schemaVersion": 1,
  "name": "smoke",
  "runs": 3,
  "timeoutMs": 600000,
  "gate": { "minPassRate": 0.8, "minRuns": 3 },
  "quests": [
    { "questId": "cook", "script": "bots/quests/cooks-assistant.ts", "fixture": "quest-lab/fixtures/cook.json", "accountCode": "cook" }
  ]
}
```

`accountCode` (≤4 alnum) seeds the account name: `qle` + code + invocation token
+ attempt, always inside the reserved `ql…` fixture namespace and ≤12 characters.

## Gate semantics

- `minRuns` is not decoration. With one sample, 100% means nothing; the gate
  refuses to call a quest passing until it has enough attempts to be wrong about.
- The suite fails if **any** quest fails its own gate, even when the overall rate
  is high — a regression in one quest must not be averaged away by a healthy
  neighbour.
- Defaults: `minPassRate: 0.8`, `minRuns: 3`.

## Cost per passing script

Comparing models needs one number: **what it cost to get a script that passes.**

```bash
# record the session that wrote (or fixed) a script — imports the agent
# platform's real token/cost rows, no self-reporting
bun quest-eval/author.ts record --quest cook --script bots/quests/cooks-assistant.ts \
  --session 20261020_105056_c08c9f

# …or tokens plus an explicit rate card
bun quest-eval/author.ts record --quest demon --script bots/quests/demon-slayer.ts \
  --model anthropic/claude-opus-4 --input-tokens 120000 --output-tokens 9000 \
  --rate-in 15 --rate-out 75

# join the ledger with the newest eval report
bun quest-eval/author.ts report
```

```
model                             scripts  passing  spend     $/passing   pass rate
deepseek/deepseek-v4.1-flash-1017 1        1        $0.23     $0.23       100%
```

Rules that make the number honest:

- **Spend is cumulative per model**, including drafts that never passed. Four
  attempts for one working script costs four attempts — a metric that drops
  failed drafts rewards burning attempts.
- **Cost comes from the platform, not the model.** With `--session`, the harness
  reads Hermes' own `session_model_usage` rows (billed cost, else estimated) for
  every model that worked in that session, including subagents and review
  traffic. Only `title_generation` is excluded.
- **Unpriced is flagged, never free.** Tokens with no rate card are recorded as
  `unpriced`, and the report says the figure is a lower bound.
- **The ledger is append-only JSONL** (`quest-eval/authorship.jsonl`). A
  correction is a new entry with a note, not an edit — cost history is evidence.

Attribution caveat: the ledger attributes a whole authoring session to one
quest. Record an entry per script, and use `--note` when a session covered more
than that script, so the number is read as the upper bound it is.

## Tests

The report and telemetry layers are pure functions over text/records, so the
gate arithmetic is unit-tested without a world:

```bash
bun test quest-eval/tests
```

## Limitations (deliberate, for now)

- **Sequential.** One attempt at a time: quests share the world's NPCs and
  resources, and parallel runs would make interference part of the measurement.
- **Fresh accounts, not restored saves.** See `ADR.md` — restoring a save needs
  surgery on a live engine, and a mis-ordered write silently evaluates a
  mid-quest start.
- **Fixed spawn state.** Every run starts from the fixture's tile and bank. That
  is the point (repeatability), but it does not prove a script that starts
  anywhere else.
- **Model comparison needs one authoring entry per script.** The accounting is
  wired (`author.ts`), but a session that wrote three scripts must be recorded
  three times with a note, or the per-script cost is an upper bound.

## CI

- Unit tests and typecheck run in the normal `bun run check`.
- The **game-backed** suite cannot run in a hosted CI runner (it needs the
  engine, the gateway, and a headless client per attempt). Wire it as a nightly
  job on a machine that has the local world, plus a `--dry` plan check in PR CI
  so a broken suite file is caught before anyone spends 40 minutes on it.
