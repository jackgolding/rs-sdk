---
description: "Task list for Honest Fleet Telemetry"
---

# Tasks: Honest Fleet Telemetry

**Input**: Design documents from `/specs/003-honest-fleet-telemetry/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Required. Constitution Principle V applies, because this changes SDK behaviour (`ActivitySession`, `BotSDK.connect`) and fleet decision logic. Each story writes its tests first, and those tests must fail on the 2026-10-04 baseline behaviour.

**Organization**: Grouped by user story, in the priority order from spec.md. Paths are repo-relative. `WF` means `.cursor/skills/wake-fleet/scripts/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: US1–US6 from spec.md

---

## Phase 1: Setup

**Purpose**: Baseline fixtures and storage plumbing that every story's tests use.

- [X] T001 Create baseline fixtures from the 2026-10-04 review in `sdk/test/fixtures/telemetry/`:
  - `heartbeat-jackpoo1.jsonl`: an empty-skills, position-0,0 first record, then one full record 2.5 min later
  - `heartbeat-jackpoo3.jsonl`: several sessions, each starting with an empty record, then 74,250-XP steps
  - `shepherd-state-capped.json`: a bot with restarts at 52/42/32/12/2 min before a fixed `now`, `capped: true`, and a `notified.capped` 844 h old
  - `grind-tail-green-dragons.txt`: about 40 lines ending in `LOG WARN no super attack in bank (×120)`
  - `assignment-legacy.json`: a `source: "observed"` record without a `pid`, with `--except jacklove4` in its argv
- [X] T002 [P] Add `events.log` to per-bot rotation in `WF/rotate-logs.ts`, next to `grind.log` and `heartbeat.log`
- [X] T003 [P] Add `launchdInfo(name)` to the new file `WF/launchd-info.ts`. It parses `launchctl print gui/$UID/com.rs-sdk.bot.{name}` into `{ loaded, pid, runs, lastExit, state, programArgs }`, moving the regexes out of `status()` in `WF/fleet-launchd.ts`, and returns `{ loaded: false }` when the agent isn't loaded. Add a parsing test with captured `launchctl print` text in `sdk/test/launchd-info.test.ts`

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: Know who actually controls each bot. Every verdict, supervisor decision, and verification depends on it.

- [X] T004 [P] Write `sdk/test/assignment-ownership.test.ts` covering:
  - `recordOwnership` writes `pid`, `argv`, `command`, `startedAt` and `source: 'connect'`
  - it is a no-op when `bots/{name}/` is missing
  - a legacy fixture record (no `pid`) is never live
  - the pid-reuse guard: a live pid whose `ps` command lacks `argv[0]` is not live (inject the `ps` reader)
  - a bot named only in another process's `--except` argv is never resolved as owned
- [X] T005 Implement in `sdk/assignment.ts`:
  - `recordOwnership(name)`, `readOwnership(name)`, and `isOwnerLive(record, deps)` with injectable `kill`/`ps`
  - `resolveOwner(name, launchd)`: a live record, else the launchd pid with `legacy: true`, else null; `supervised` is the pid match
  - `recordScriptAssignment()` becomes an alias of `recordOwnership(process.env.BOT_USERNAME)`
  - delete `writeAssignment` and the `'launchd' | 'observed'` source union (legacy files are still readable)
- [X] T006 Call `recordOwnership(this.config.botUsername)` in `BotSDK.connect()` in `sdk/index.ts` after the handshake succeeds, and on every successful auto-reconnect, but only when `connectionMode === 'control'`. Confirm that `server/webclient` still type-checks (`bun run typecheck:webclient`)
- [X] T007 Re-export the ownership helpers from `WF/roster.ts` in place of `writeAssignment`, so the scripts that import from roster keep one import site. Also parse the optional roster field `noEffectMinutes` (an integer ≥ 1; anything else is rejected on load) into `RosterBot.noEffectMinutes`, resolved as the override if set, else 90 when `bursty`, else 15

**Checkpoint**: `bun test sdk/test/assignment-ownership.test.ts sdk/test/launchd-info.test.ts` passes. Running any grind writes a record with a live pid.

---

## Phase 3: User Story 1 - "Working" means producing (P1) 🎯 MVP

**Goal**: `fleet-status` gives each bot exactly one evidence-based verdict, with the headline count first.

**Independent Test**: Quickstart §2. Hung, looping, pre-empted, churning, and missing-supplies bots are all classified not producing, with the correct `check`, and the headline excludes them.

### Tests (write first; must fail on current `fleet-status` logic)

- [X] T008 [P] [US1] Write `sdk/test/fleet-verdict.test.ts` with one case per row of the precedence table in data-model.md, plus these baseline cases:
  - Jackpoo1: live supervised owner, newest snapshot 267 min old → `alive-not-producing`/`telemetry_silent`
  - jacklove10: `relaunches1h = 6` → `churning`
  - live owner with `controllers = 0` → `no_controller`
  - green-dragons tail fixture → `needs-supplies`
  - jacklove4 owned by converge with drift → `foreign-owner`

  Also assert the headline string format, that `summary.notProducing` excludes `paused`, and the no-effect threshold: 16 min without an effect is not producing at the default; with a bot override of 45 it is still producing at 16 min; a bursty bot with no override is still producing at 89 min
- [X] T009 [P] [US1] Extend `sdk/test/fleet-rates.test.ts` for `isValidSnapshot`, which rejects records with no Hitpoints XP or position 0,0. Test `lastEffectAt(records, events)`:
  - it ignores invalid records
  - it detects an in-session XP/coins increase and does not treat a cross-session jump as an effect
  - it accepts effect-kind `progress` events
  - it ignores `location` and `phase` events

### Implementation

- [X] T010 [US1] Implement `isValidSnapshot` and `lastEffectAt` in `WF/fleet-rates.ts`
- [X] T011 [US1] Create `WF/fleet-verdict.ts`: a pure `classify(input): VerdictRow` and `summarize(rows)`, per data-model.md and `contracts/fleet-status.md`. The input type holds the roster bot, gateway snapshot, resolved owner, launchd info, runs samples, snapshots, events, grind tail, shepherd bot state, and `now`
- [X] T012 [US1] Add pure text-fallback detectors to `WF/fleet-verdict.ts`. `repeatHeavy` strips `(×N)` suffixes and severity tokens before counting. `supplyShortage` uses the regex from research R10. Path-failure-burst and recovery-loop are moved over unchanged, but they now apply to bots with a live owner too (FR-004)
- [X] T013 [US1] Rewrite the input gathering in `WF/fleet-status.ts`:
  - fetch the gateway in parallel, and call `resolveOwner` and `launchdInfo` per bot
  - read runs samples from `shepherd-state.json`, plus bounded tails of `heartbeat.log`, `events.log` and `grind.log`
  - then call `classify`/`summarize`
  - delete `matchBun`, `resolveCommand` use, and the `writeAssignment` call. Stop calling `isZeroRate` from status (the verdict uses `lastEffectAt`). Leave the `isZeroRate` export in `fleet-rates.ts` until T025 so the pre-US3 shepherd still compiles
  - keep `pgrep` only to report `unownedProcesses` in the JSON
- [X] T014 [US1] Implement both output formats from `contracts/fleet-status.md` in `WF/fleet-status.ts`. The headline is the first line in pretty mode and a top-level `headline` in JSON. Not-producing rows sort first. Each row's `detail` shows the measured values
- [X] T015 [US1] Update `classifyFleet()` in `WF/fleet-shepherd.ts` to read the new kinds. Until T025: start only `restartable`; leave `capped`, `finished`, and `foreign-owner` alone (do **not** map `capped` onto the old wake path); restart `alive-not-producing` via the existing `shouldRestartZeroRate` helper so the pre-US3 shepherd still compiles. If `JSON.parse` fails (seen in `shepherd.err.log`: `Unexpected EOF`), log an ERROR line plus the child's stderr and skip the cycle instead of crashing
- [X] T016 [US1] Update the "Do this every time" section of `.cursor/skills/wake-fleet/SKILL.md` with the new kinds:
  - lead every reply with the headline
  - never describe the fleet as healthy while `notProducing` is non-empty
  - `bun yes` / pid present is not evidence of a fix and MUST NOT be reported as "woke" or "working" (FR-023 partial; `--verify` lands in T035)

**Checkpoint**: Running quickstart §2 against the live fleet reports Jackpoo1 and the stale-heartbeat fishers as not producing.

---

## Phase 4: User Story 2 - Progress records are trustworthy (P1)

**Goal**: Snapshots are timer-driven, never empty, and give per-session rates.

**Independent Test**: Spec US2. The first records are valid, a double restart doesn't spike rates, and a blocked loop keeps writing snapshots with `lastProgressAt` growing.

### Tests

- [X] T017 [P] [US2] Update `sdk/test/activity-heartbeat.test.ts`:
  - no record is written while the mock `getSkills()` is empty or the position is 0,0
  - the first valid record appears once skills arrive
  - with an injected timer, records keep arriving while a script promise never resolves
  - records carry `pid`, `phase`, `lastProgressAt`, `lastEffectAt`, `recoveries` and `stopped`
  - `finalizeStop()` clears the timer and writes one final record

  Add `timer?: { setInterval, clearInterval }` to `ActivityConfig` for injection
- [X] T018 [P] [US2] Update `sdk/test/fleet-rates.test.ts`. `computeRates` over the Jackpoo3 fixture equals the sum of in-session deltas over the summed session time. The Jackpoo1 fixture returns `null` (under 10 min of valid data). The old 2.8 B XP/h case cannot be produced
- [X] T019 [P] [US2] Write `sdk/test/roster-telemetry.test.ts`. For every distinct `script` in `bots/roster.json`, the source must contain `new ActivitySession(` and `grindLogPath` (FR-011)

### Implementation

- [X] T020 [US2] In `sdk/activity.ts`:
  - replace the constructor's forced heartbeat with an unref'd interval timer
  - poll once per second, for up to 60 s, for the first valid snapshot
  - validate before writing
  - add the new record fields and track `lastEffectAt` in `noteProgress` for effect kinds
  - make `maybeHeartbeat()` a no-op while the timer is active
  - make `finalizeStop()` clear the timer
- [X] T021 [US2] Rewrite `computeRates` in `WF/fleet-rates.ts` per session (research R3), delete `stallMinutes`, and update `WF/fleet-report.ts` to match. Keep the `isZeroRate` export until T025. Delete the old rate-inflation assertions in `sdk/test/fleet-rates.test.ts`
- [X] T022 [US2] Feed `minutesSinceSnapshot`, `minutesSinceEffect` and per-session `xpPerHour`/`gpPerHour` into the verdict input in `WF/fleet-status.ts`, filtered to the resolved owner's `pid` when it is present

**Checkpoint**: After restarting one fishing bot twice, its `xpPerHour` stays in the tens of thousands.

---

## Phase 5: User Story 3 - The supervisor doesn't fight itself (P1)

**Goal**: The shepherd never starts and stops a bot in the same cycle. Alerts re-fire on stable codes. Its actions show in status.

**Independent Test**: Quickstart §3 and spec US3.

### Tests

- [X] T023 [P] [US3] Update `sdk/test/fleet-shepherd.test.ts`:
  - `canStart` with 3, 4 and 5 restarts in the window
  - with the capped fixture at `now`, `planCycle` neither starts nor stops; after the 52-min restart ages out it starts exactly once, and `woke` contains that bot while `capped` does not
  - no plan ever contains both start and stop for one bot
  - re-notify at `RENOTIFY_MS`; a key is deleted when its condition is absent; legacy `intervene:*` keys are dropped on load
  - `foreign-owner` and `finished` produce no launchd action
  - an alive-not-producing bot is restarted once per episode, and the episode resets after it is producing again

  Delete the tests for the removed `shouldRestartStuckThief` and `shouldRestartZeroRate` helpers

### Implementation

- [X] T024 [US3] Split `runShepherdCycle` in `WF/fleet-shepherd.ts` into a pure `planCycle(state, rows, rosterMap, now) → { actions, state, notifications }` and an IO executor that runs `fleet-launchd start|restart|stop`
- [X] T025 [US3] Implement the following in `WF/fleet-shepherd.ts` per `contracts/shepherd-and-launchd.md`:
  - `canStart`, `cappedAt`, the per-bot `actions` log (2 h) and episode tracking
  - stable notification codes, `RENOTIFY_MS = 2h`, clear-on-absence, and dropping legacy keys in `loadState`
  - the honest `woke` list
  - delete `shouldRestartStuckThief`/`shouldRestartZeroRate`/`clearCappedOnStart`, and delete `isZeroRate` from `WF/fleet-rates.ts` plus its tests (safe now that the shepherd no longer calls it)
- [X] T026 [US3] Sample `launchdInfo(name).runs` for every roster bot at the start of each cycle into `runsSamples`, keeping 2 h, in `WF/fleet-shepherd.ts`
- [X] T027 [US3] Have `WF/fleet-status.ts` read `capped`, `cappedAt` and the last hour of `actions` from shepherd state into each row's `shepherd` field, and compute `relaunches1h` from `runsSamples` (research R7)

**Checkpoint**: Three live shepherd cycles show no bot in both `woke` and `capped`. The 8 baseline bots come back one at a time as their budgets allow.

---

## Phase 6: User Story 4 - Restart runs what status said (P2)

**Goal**: Restarts always run the roster job, drift is visible, and ownership is never guessed from argv.

**Independent Test**: Spec US4 and quickstart §4 (first bullet).

### Tests

- [X] T028 [P] [US4] Add cases to `sdk/test/fleet-verdict.test.ts`:
  - `restartCommand` always equals the roster command
  - `drift` is set when the resolved owner's command differs, and null when it matches
  - a stopped bot whose last owner ran a one-off job shows `restartCommand` = roster plus the drift
  - an unsupervised owner with drift is `foreign-owner`

### Implementation

- [X] T029 [US4] Delete `resolveCommand` from `WF/roster.ts` and every caller. `classify` in `WF/fleet-verdict.ts` sets `restartCommand` and `drift` (FR-017, FR-018, FR-021)
- [X] T030 [US4] In `WF/fleet-launchd.ts`:
  - remove `recordAssignment()` and its three call sites
  - `start` no longer kickstarts a loaded agent whose last exit was 0 unless `--force` is passed (print `finished — use --force`)
  - `status` prints `runs` and `last exit` via `launchdInfo`
- [X] T031 [US4] Update the restart-command rules to "roster always wins; live/recorded jobs that differ are drift" in:
  - `.cursor/rules/fleet-roster.mdc`
  - `.cursor/rules/wake-fleet-scripts.mdc`: drop the "fourth command source" and `writeAssignment` lines, and add "ownership is written by `BotSDK.connect`"
  - `.cursor/skills/wake-fleet/SKILL.md`: rewrite "How the restart command is chosen" and the related "Do not regress" bullets
  - the Fleet paragraph in both `AGENTS.md` and `CLAUDE.md`
  - `learnings/gateway-fleet.md`: replace the "`fleet-status` `bun` column" section

**Checkpoint**: For every supervised bot, `restartCommand` equals `ps -o command= -p <pid>` minus the bun path.

---

## Phase 7: User Story 5 - A restart claim is verified (P2)

**Goal**: `--verify` reports success only on real progress, and the playbook requires it.

**Independent Test**: Quickstart §4: a healthy bot is verified, and jackthief (missing supplies) exits 1 with its reason.

### Tests

- [X] T032 [P] [US5] Write `sdk/test/fleet-verify.test.ts` for `verifyOutcome({ events, snapshots, t0, oldPid, now, timeoutMs })`, which returns `pending | success{evidence, elapsedMs, pid} | failure{reason}`:
  - success requires an effect from a new pid with `t > t0`
  - events from `oldPid` are ignored
  - a `stop` event from the new pid fails immediately
  - the timeout fails with the newest failure reason
  - a `location`-only progress event never succeeds

### Implementation

- [X] T033 [US5] Implement `verifyOutcome` in the new file `WF/fleet-verify.ts` (pure; uses `isValidSnapshot`/`lastEffectAt` from `WF/fleet-rates.ts`)
- [X] T034 [US5] Wire `--verify` and `--timeout <Nm>` into `start`/`restart` in `WF/fleet-launchd.ts`:
  - poll bounded tails every 15 s
  - verify multiple names concurrently
  - print in the formats from `contracts/shepherd-and-launchd.md` (including the last 5 grind lines on failure)
  - exit 1 if any bot fails
- [X] T035 [US5] In `.cursor/skills/wake-fleet/SKILL.md`, replace step 5 ("After ~20s… confirm each wake now has a bun pid") with `restart|start --verify`. Only bots reported `verified` may be called fixed; the rest go under "needs intervention" with the printed reason

**Checkpoint**: Quickstart §4 passes on one healthy bot and on jackthief.

---

## Phase 8: User Story 6 - Problem signals survive logging (P3)

**Goal**: Structured events, correct severities, and phase changes that are not progress.

**Independent Test**: Spec US6. 100 identical failures are detected from events, and phase ping-pong with a repeated failure arms recovery.

### Tests

- [X] T036 [P] [US6] Write `sdk/test/activity-events.test.ts` with an injected events writer:
  - a `start` event on construct
  - `progress` throttled to one per kind per 30 s
  - `failure` events are never dropped and carry an increasing `count`, even though the text log is sampled
  - one `recovery` event per tactic
  - a `stop` event with `restartable`
- [X] T037 [P] [US6] Update `sdk/test/activity-session.test.ts`:
  - alternating `setPhase('a')`/`setPhase('b')` with a `noteFailure('x')` between each switch makes `needsRecovery()` true after `repeatFailCount` failures, so `setPhase` no longer clears failure counters
  - `setPhase` during an in-progress recovery does not end it, but a non-phase `noteProgress` does
  - `setPhase` refreshes `lastProgressAt` but not `lastEffectAt`
  - `log('log', 'WARN x')` is written as `WARN x`, and `log('log', 'ERROR y')` as `ERROR y`
- [X] T038 [P] [US6] Add cases to `sdk/test/fleet-verdict.test.ts`: repeat failures and supply shortage are detected from `failure` events when they're present, with the text fallback used only when `events.log` is missing

### Implementation

- [X] T039 [US6] Implement the `events.log` writer in `sdk/activity.ts` via `appendGrindLog`. Add an `eventsPath` config with an injectable writer, and emit `start`/`progress`/`failure`/`recovery`/`stop` per `contracts/activity-telemetry.md`
- [X] T040 [US6] In `sdk/activity.ts`, make `setPhase()` refresh only `lastProgressAt` (no `noteProgress` call, no clearing of `failureTimes` or recovery state), and add the WARN/ERROR prefix upgrade to `log()`
- [X] T041 [US6] Make the detectors in `WF/fleet-verdict.ts` prefer structured events when the tail from T013 is present; do not re-gather `events.log` in `fleet-status.ts`
- [X] T042 [US6] In `bots/quests/green-dragons.ts`, send its `log('WARN …')` calls through `session.log('warn', …)`, and report missing super attack and other kit shortfalls via `session.noteFailure('missing_supplies', …)`
- [X] T043 [US6] In `bots/quests/fishing-route.ts`, report the "Cannot restock" path with `session.noteFailure('missing_supplies', …)` instead of `setup_gear`, so a fisher waiting on Harry reads as `needs-supplies`

**Checkpoint**: `bots/{bot}/events.log` fills on a live fishing bot, and jackthief reads as `needs-supplies` from events.

---

## Phase 9: Polish & cross-cutting

- [X] T044 Run `bun run docs:api` (the `ActivityConfig` and `assignment` exports changed), then `bun run check`; both must pass
- [X] T045 Roll the change out without a fleet-wide bounce. Grind processes pick up the new SDK on their next relaunch, and the launchd-pid fallback owner covers them until then. Run the shepherd once by hand, then quickstart §§2–5 against the live fleet. Record the results, with the before/after headline and the wall time of `fleet-status.ts --pretty`, in `specs/003-honest-fleet-telemetry/quickstart.md` under a "Validation 2026-10-xx" heading
- [X] T046 [P] Remove the stale `capped`/`intervene:*` keys and stuck caps from `~/Library/Logs/rs-sdk-fleet/shepherd-state.json` (T025's `loadState` migration does this on the first new cycle; confirm it did)
- [X] T047 [P] Add a short "Telemetry you can trust" note to `learnings/gateway-fleet.md`: the verdict kinds, what counts as an effect, `--verify`, and the baseline numbers from spec.md

---

## Dependencies & execution order

- **Setup (T001–T003)**: start immediately. T002 and T003 can run in parallel.
- **Foundational (T004–T007)**: blocks every story. T004 runs alongside the T005 implementation as test-first.
- **US1 (Phase 3)**: needs Foundational. It ships useful verdicts using the existing heartbeats filtered by `isValidSnapshot`.
- **US2 (Phase 4)**: needs Foundational. It improves US1's inputs, but US1 doesn't wait for it. T022 touches `fleet-status.ts` after T013. Do not delete `isZeroRate` here (T021); T025 owns that delete.
- **US3 (Phase 5)**: needs US1 (it consumes the verdict kinds). T027 touches `fleet-status.ts` after T013.
- **US4 (Phase 6)**: needs Foundational and T011. T030 touches `fleet-launchd.ts` before T034.
- **US5 (Phase 7)**: needs US2's snapshot fields and US6's events for the best evidence. With only US2, verify falls back to snapshot XP/coins deltas.
- **US6 (Phase 8)**: needs Foundational. T039 and T040 touch `activity.ts` after T020.
- **Polish**: after the stories you intend to ship.

### Same-file ordering (no [P] between these)

- `sdk/activity.ts`: T020 → T039 → T040
- `WF/fleet-status.ts`: T013 → T014 → T022 → T027 → T041
- `WF/fleet-verdict.ts`: T011 → T012 → T029 → T041
- `WF/fleet-rates.ts`: T010 → T021 → T025 (delete `isZeroRate`)
- `WF/fleet-shepherd.ts`: T015 → T024 → T025 → T026
- `WF/fleet-launchd.ts`: T003 (extract) → T030 → T034
- `.cursor/skills/wake-fleet/SKILL.md`: T016 → T031 → T035

### Parallel examples

```text
# After Foundational, test-writing in parallel:
T008 fleet-verdict.test.ts   T009 fleet-rates.test.ts   T017 activity-heartbeat.test.ts
T023 fleet-shepherd.test.ts  T036 activity-events.test.ts

# US2 and US6 SDK work can be split across two people only if they sequence activity.ts (T020 before T039/T040).
```

## Implementation strategy

1. **MVP = Setup + Foundational + US1 + US3.** That ends the false "running" and "woke" claims, and stops the shepherd holding 8 bots down. Ship it, then run quickstart §§2–3. T016 already forbids treating a pid as proof; FR-023 / SC-008 (`--verify` in the playbook) are **not** claimed until US5.
2. **Then US2.** Correct rates and hang detection that holds for every script.
3. **Then US4 + US5.** Restarts match what status said, and the playbook requires verification.
4. **Then US6.** Hardening.

At every checkpoint, run `bun run check` and re-run `fleet-status --pretty | head -1` against the live fleet.
