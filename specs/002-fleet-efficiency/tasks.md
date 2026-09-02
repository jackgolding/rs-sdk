# Tasks: Fleet Efficiency and Self-Healing Operations

**Input**: Design documents from `/specs/002-fleet-efficiency/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Required (constitution V — SDK porcelain and fleet supervision changes). Write failing tests before the matching implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- SDK: `sdk/`, tests in `sdk/test/`
- Fleet scripts: `.cursor/skills/wake-fleet/scripts/`
- Shared routes: `bots/quests/`
- Roster: `bots/roster.json` (via `roster.ts` only in scripts)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Wire documentation so operators and agents discover the new tooling

- [x] T001 Add shepherd + fleet-report sections to [.cursor/skills/wake-fleet/SKILL.md](.cursor/skills/wake-fleet/SKILL.md) (install via `fleet-launchd install`, run `fleet-report.ts`, restart-cap behavior)
- [x] T002 Add a short Spec Kit pointer for feature `002-fleet-efficiency` in [README.md](README.md) linking to [specs/002-fleet-efficiency/quickstart.md](specs/002-fleet-efficiency/quickstart.md)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared read/math/roster primitives that multiple stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Add bounded JSONL tail reader (`readJsonlTail`) to [sdk/grind-log.ts](sdk/grind-log.ts) per [specs/002-fleet-efficiency/contracts/heartbeat-and-report.md](specs/002-fleet-efficiency/contracts/heartbeat-and-report.md) (skip unparseable lines, never read whole file)
- [x] T004 [P] Create shared rate-math module [.cursor/skills/wake-fleet/scripts/fleet-rates.ts](.cursor/skills/wake-fleet/scripts/fleet-rates.ts) (xp/coins deltas, zero-rate predicate, bursty window widening, maxed-skill at 99)
- [x] T005 [P] Extend [bots/roster.json](bots/roster.json) schema usage and [.cursor/skills/wake-fleet/scripts/roster.ts](.cursor/skills/wake-fleet/scripts/roster.ts) to pass optional `bursty` flag on roster entries
- [x] T006 [P] Add failing rate-math tests in [sdk/test/fleet-rates.test.ts](sdk/test/fleet-rates.test.ts) (normal rates, restart mid-window, no-data, zero-rate vs bursty 90m, rotation-truncated first line, maxed-skill flag)

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 - The fleet heals itself overnight (Priority: P1) 🎯 MVP

**Goal**: `recovery_exhausted` and other restartable stops exit 70 after safe-park; launchd KeepAlive restarts within ~30s; a 10-minute shepherd wakes idle bots, caps restarts at 4/hour, and notifies on intervention

**Independent Test**: Kill a running bot's bun process or wait for `recovery_exhausted` → new pid within 1 min; stop a bot's agent → shepherd restarts it within one 10-min cycle; force 5 immediate failures → capped + one macOS notification (quickstart S1–S3)

### Tests for User Story 1

- [x] T007 [P] [US1] Add safe-park and exit-code mapping tests in [sdk/test/activity-session-exit.test.ts](sdk/test/activity-session-exit.test.ts) (`recovery_exhausted` → exitCode 70, `cannot_regear` → 0, park failure still exits, trade/modal dismissed first)
- [x] T008 [P] [US1] Add shepherd decision tests in [sdk/test/fleet-shepherd.test.ts](sdk/test/fleet-shepherd.test.ts) (4/hour cap, capped clear on operator start, notification dedupe, skip live controller, overlapping lockfile)

### Implementation for User Story 1

- [x] T009 [US1] Implement restartable vs terminal stop classification and `stopRestartable()` in [sdk/activity.ts](sdk/activity.ts) per [specs/002-fleet-efficiency/contracts/activity-session-extensions.md](specs/002-fleet-efficiency/contracts/activity-session-extensions.md)
- [x] T010 [US1] Implement safe-park sequence (decline trade, close modals, optional `park` tactic) before restartable stop in [sdk/activity.ts](sdk/activity.ts)
- [x] T011 [US1] Set `process.exitCode = 70` on restartable stops and ensure grind routes honor it on disconnect in [sdk/activity.ts](sdk/activity.ts) and [bots/quests/thieving-route.ts](bots/quests/thieving-route.ts) / [bots/quests/rune-rocks.ts](bots/quests/rune-rocks.ts) main loops (routes that bypass `runScript`)
- [x] T012 [US1] Create [.cursor/skills/wake-fleet/scripts/fleet-shepherd.ts](.cursor/skills/wake-fleet/scripts/fleet-shepherd.ts) with lockfile, classify → wake → cap → notify cycle per [specs/002-fleet-efficiency/contracts/shepherd.md](specs/002-fleet-efficiency/contracts/shepherd.md)
- [x] T013 [US1] Add `shepherd-state.json` read/write (rolling restart history, capped flag, notification dedupe) in [.cursor/skills/wake-fleet/scripts/fleet-shepherd.ts](.cursor/skills/wake-fleet/scripts/fleet-shepherd.ts)
- [x] T014 [US1] Implement `osascript` desktop notifications (one banner per cycle, pack multiple bots) in [.cursor/skills/wake-fleet/scripts/fleet-shepherd.ts](.cursor/skills/wake-fleet/scripts/fleet-shepherd.ts)
- [x] T015 [US1] Install `com.rs-sdk.fleet-shepherd` launchd agent (`StartInterval: 600`, `RunAtLoad: true`) in [.cursor/skills/wake-fleet/scripts/fleet-launchd.ts](.cursor/skills/wake-fleet/scripts/fleet-launchd.ts) alongside existing rotate job

**Checkpoint**: User Story 1 is independently testable — fleet self-heals without editor `/loop`

---

## Phase 4: User Story 2 - The operator sees production rates at a glance (Priority: P2)

**Goal**: Heartbeats every 5 min to `bots/{name}/heartbeat.log`; one-command `fleet-report.ts rates`; `fleet-status.ts` flags zero-rate stalls

**Independent Test**: Fleet runs 1h → `bun .cursor/skills/wake-fleet/scripts/fleet-report.ts` shows plausible xp/hr per bot in <30s; pin a bot → `intervene` / `zero_rate` within 30 min (quickstart S4–S5)

### Tests for User Story 2

- [x] T016 [P] [US2] Add heartbeat cadence tests in [sdk/test/activity-heartbeat.test.ts](sdk/test/activity-heartbeat.test.ts) (first at start, interval ticks, none when stale, final on stop, write failure warns once)

### Implementation for User Story 2

- [x] T017 [US2] Add `heartbeatMs`, `heartbeatPath`, and JSONL heartbeat emission in [sdk/activity.ts](sdk/activity.ts) per [specs/002-fleet-efficiency/contracts/heartbeat-and-report.md](specs/002-fleet-efficiency/contracts/heartbeat-and-report.md)
- [x] T018 [US2] Add `bots/*/heartbeat.log` rotation to [.cursor/skills/wake-fleet/scripts/rotate-logs.ts](.cursor/skills/wake-fleet/scripts/rotate-logs.ts) (same 8→4 MiB cap as grind logs)
- [x] T019 [US2] Create `rates` view in [.cursor/skills/wake-fleet/scripts/fleet-report.ts](.cursor/skills/wake-fleet/scripts/fleet-report.ts) (`--window`, `--json`, fleet totals row)
- [x] T020 [US2] Extend [.cursor/skills/wake-fleet/scripts/fleet-status.ts](.cursor/skills/wake-fleet/scripts/fleet-status.ts) with `zero_rate` intervene reason and optional `xpPerHour` / `gpPerHour` / `heartbeatAgeMs` using [fleet-rates.ts](.cursor/skills/wake-fleet/scripts/fleet-rates.ts)
- [x] T021 [P] [US2] Mark `bursty: true` on mule/orchestrator roster entries in [bots/roster.json](bots/roster.json) (e.g. `ABGARMY01`, any food-mule-only jobs)

**Checkpoint**: User Story 2 is independently testable — rates and silent-stall detection without US3/US4

---

## Phase 5: User Story 3 - Known stall classes recover instead of dying (Priority: P3)

**Goal**: Pickpocket tactics escalate with per-tactic bounds; wilderness deaths verify bank kit and cap per session; trade waits expire and mule retries; named gangplank/lever recoveries in shared movement

**Independent Test**: Each stall class passes its quickstart S6 scenario; over 7 days none appear as intervene reasons (SC-005)

### Tests for User Story 3

- [x] T022 [P] [US3] Add `maxConsecutive` tactic-bound tests in [sdk/test/thieving-escalation.test.ts](sdk/test/thieving-escalation.test.ts) (same tactic never exceeds bound; advances to next tactic)
- [x] T023 [P] [US3] Add death re-gear branch tests for kit-present vs kit-missing and deaths-per-session cap in [sdk/test/rune-rocks-death.test.ts](sdk/test/rune-rocks-death.test.ts)

### Implementation for User Story 3

- [x] T024 [US3] Implement `maxConsecutive` per recovery tactic (default 2) in [sdk/activity.ts](sdk/activity.ts)
- [x] T025 [US3] Set per-tactic `maxConsecutive` and escalation order on pickpocket recovery tactics in [bots/quests/thieving-route.ts](bots/quests/thieving-route.ts)
- [x] T026 [P] [US3] Add Musa ship `(2951,3142)` and Deserted Keep / Edgeville lever tile constants to [bots/quests/tiles.ts](bots/quests/tiles.ts) (from `learnings/wildy-lever.md`)
- [x] T027 [US3] Add `recoverGangplank()` and `recoverLeverOscillation()` helpers to [bots/quests/movement.ts](bots/quests/movement.ts) and register as recovery tactics in [bots/quests/thieving-route.ts](bots/quests/thieving-route.ts) and [bots/quests/fishing-route.ts](bots/quests/fishing-route.ts)
- [x] T028 [US3] Replace hardcoded Musa ship coordinate in [.cursor/skills/wake-fleet/scripts/fleet-status.ts](.cursor/skills/wake-fleet/scripts/fleet-status.ts) with shared constant from [bots/quests/tiles.ts](bots/quests/tiles.ts)
- [x] T029 [US3] Add bank-kit verification before wildy return, re-gear from bank, and deaths-per-session cap (default 3) in [bots/quests/rune-rocks.ts](bots/quests/rune-rocks.ts); `cannot_regear` as non-restartable stop
- [x] T030 [P] [US3] Mirror death/re-gear/cap contract in [bots/quests/wildy-moss-giants.ts](bots/quests/wildy-moss-giants.ts)
- [x] T031 [US3] Add explicit trade-wait deadlines with bank-and-resume on expiry in [bots/quests/abg-food-mule.ts](bots/quests/abg-food-mule.ts) and any route scripts with `waitForTarget`-style partner loops
- [x] T032 [US3] Record missed trade partners and retry them on the mule's next round in [bots/quests/abg-food-mule.ts](bots/quests/abg-food-mule.ts) (generalize pattern from [bots/quests/abg-food-retry-misses.sh](bots/quests/abg-food-retry-misses.sh))

**Checkpoint**: User Story 3 is independently testable — four named stall classes no longer wedge sessions

---

## Phase 6: User Story 4 - Reallocation decisions come from data (Priority: P4)

**Goal**: `fleet-report.ts supply` and `flags` views answer food surplus/deficit and reassignment candidates; operator reassigns via roster only

**Independent Test**: After ≥3 days of heartbeats, `fleet-report.ts supply` and `flags` match quickstart S7; one roster edit + `fleet-launchd restart` shows new job in next report window

### Implementation for User Story 4

- [x] T033 [US4] Add `supply` view (food produced vs consumed per day, explicit surplus/deficit) to [.cursor/skills/wake-fleet/scripts/fleet-report.ts](.cursor/skills/wake-fleet/scripts/fleet-report.ts)
- [x] T034 [US4] Add `flags` view (`maxed_skill`, `zero_value`, `capped`/`intervene` carry-over) to [.cursor/skills/wake-fleet/scripts/fleet-report.ts](.cursor/skills/wake-fleet/scripts/fleet-report.ts)
- [x] T035 [US4] Surface capped bots prominently in `flags` output and document reallocation workflow in [.cursor/skills/wake-fleet/SKILL.md](.cursor/skills/wake-fleet/SKILL.md)

**Checkpoint**: User Story 4 is independently testable — operator can reassign fishing squad from data

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Validation, merge gate, deployment

- [x] T036 Run [specs/002-fleet-efficiency/quickstart.md](specs/002-fleet-efficiency/quickstart.md) scenarios S1–S8 on the live fleet and fix any gaps found
- [x] T037 [P] Ensure `bun run check` passes with all new tests in [sdk/test/](sdk/test/)
- [x] T038 Deploy shepherd to operator machine: `bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts install` and verify `launchctl list | grep rs-sdk` shows `com.rs-sdk.fleet-shepherd`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS all user stories**
- **User Story 1 (Phase 3)**: Depends on Foundational — **MVP**; no dependency on US2–US4
- **User Story 2 (Phase 4)**: Depends on Foundational; independent of US1 (heartbeats help US1 diagnostics but are not required for restart)
- **User Story 3 (Phase 5)**: Depends on Foundational; benefits from US1 exit semantics (T009–T011) before shipping to production
- **User Story 4 (Phase 6)**: Depends on US2 heartbeats and T004 rate math
- **Polish (Phase 7)**: Depends on desired user stories being complete

### User Story Dependencies

| Story | Can start after | Blocks | Notes |
|-------|-----------------|--------|-------|
| US1 (P1) | Phase 2 | — | Ship first for overnight idle fix |
| US2 (P2) | Phase 2 | US4 | Heartbeats + rates |
| US3 (P3) | Phase 2 (+ US1 for prod) | — | Stall fixes; test each class alone |
| US4 (P4) | US2 | — | Report views only |

### Within Each User Story

- Tests (T007–T008, T016, T022–T023) written and failing before implementation tasks in that story
- `sdk/activity.ts` changes are sequential within a story (T009 before T010 before T011; T017 after US1 exit work if same file — **do US1 activity changes T009–T011 before US2 T017**)
- `fleet-shepherd.ts` (T012–T014) after activity exit semantics (T009–T011)

### Parallel Opportunities

- **Phase 2**: T004, T005, T006 in parallel after T003
- **US1 tests**: T007 ∥ T008
- **US2**: T021 in parallel with T019 once T017 lands
- **US3**: T026 ∥ T029 prep; T030 after T029 pattern; T022 ∥ T023
- **Polish**: T037 ∥ T038 (after T036)

---

## Parallel Example: User Story 1

```bash
# Tests first (parallel):
# T007 safe-park/exit tests in sdk/test/activity-session-exit.test.ts
# T008 shepherd decision tests in sdk/test/fleet-shepherd.test.ts

# Then sequential on sdk/activity.ts:
# T009 → T010 → T011

# Shepherd (parallel after activity exit work):
# T012 fleet-shepherd.ts core cycle
# T013 state file (same file, same developer)
# T014 notifications (same file)
# T015 fleet-launchd install hook
```

---

## Parallel Example: User Story 3

```bash
# Tests first (parallel):
# T022 thieving-escalation.test.ts
# T023 rune-rocks-death.test.ts

# SDK tactic bound:
# T024 sdk/activity.ts maxConsecutive

# Route fixes (parallel where noted):
# T025 thieving-route.ts
# T026 tiles.ts [P]
# T027 movement.ts + route registration
# T029 rune-rocks.ts
# T030 wildy-moss-giants.ts [P] after T29 pattern
# T031–T032 abg-food-mule.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T002)
2. Complete Phase 2: Foundational (T003–T006) — minimal for US1: T003 optional; US1 needs T004 only if shepherd imports fleet-rates later; **US1 minimum foundation: T003 optional, skip T004–T006 for bare MVP** — but constitution wants T006 before merge; do full Phase 2.
3. Complete Phase 3: User Story 1 (T007–T015)
4. **STOP and VALIDATE**: quickstart S1–S3; leave fleet unattended overnight; morning idle <5%
5. Deploy with T038

### Incremental Delivery

1. Setup + Foundational → shared primitives ready
2. **US1** → overnight self-healing (MVP)
3. **US2** → visibility (rates, zero-rate flags)
4. **US3** → fewer restarts needed (stall class fixes)
5. **US4** → reallocation data (fishing squad cut, jackthief quest routing decisions)
6. Polish → full quickstart + `bun run check`

### Suggested first session (tonight)

T003 → T007–T011 → T012–T015 → T038. That ships self-healing before heartbeats.

---

## Notes

- Never `readFileSync` whole `grind.log` or `heartbeat.log` — bounded tails only (fleet rules)
- Shepherd starts bots via `fleet-launchd.ts start`, never as Cursor-shell children
- Do not copy routes per character — all stall fixes in `bots/quests/`
- `bursty: true` is roster-only; combat-training ramp may need more fishers than old 2–3 estimate — use US4 `supply` view before cutting jackloves
- Group PvP squad script is **out of scope** (separate future feature per spec Assumptions)
