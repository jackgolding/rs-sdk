# Tasks: Autonomous Activity Recovery

**Input**: Design documents from `/specs/001-autonomous-recovery/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Required (constitution V, FR-018). Write failing tests before the matching implementation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- SDK: `sdk/`
- Tests: `sdk/test/`
- Proving scripts: `bots/Jackpoo1/`, `bots/Jackpoo2/`
- Fleet viewer: `bots/watch-fleet.sh`
- Webclient: `server/webclient/src/bot/`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Spec Kit is initialized; keep public API surface honest

- [x] T001 Add a short Spec Kit pointer (constitution + when to use) to [README.md](README.md)
- [x] T002 Unexport `hasLineOfSight` from [sdk/pathfinding.ts](sdk/pathfinding.ts) (keep private or delete the wrapper; no flax caller)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared session + bank truth that every story depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Create `ActivitySession` in [sdk/activity.ts](sdk/activity.ts) per [specs/001-autonomous-recovery/contracts/activity-session.md](specs/001-autonomous-recovery/contracts/activity-session.md) (phase, progress, failure sampling, recover, stop, metrics, log/warn/error)
- [x] T004 Export `ActivitySession` from [sdk/index.ts](sdk/index.ts)
- [x] T005 Change `_openBankOnce` wait-loop success in [sdk/actions.ts](sdk/actions.ts) to `state.bank.isOpen` only; keep closing non-bank interfaces first

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 - Survive a flax trip without babysitting (Priority: P1) 🎯 MVP

**Goal**: Blocked tiles, craft-vs-bank, wrong floor, and repeat failures recover or stop; flax trip can complete unattended

**Independent Test**: Unit tests for walk/bank/activity budget; live `bun bots/Jackpoo1/bowstrings.ts` completes a trip after a stall without a human restart

### Tests for User Story 1

- [x] T006 [P] [US1] Add blocked-start `walkTo` tests in [sdk/test/walkto-blocked-start.test.ts](sdk/test/walkto-blocked-start.test.ts) (mock `isTileWalkable` / `sendWalk` using the [sdk/test/walkto-partial-path.test.ts](sdk/test/walkto-partial-path.test.ts) pattern)
- [x] T007 [P] [US1] Add bank-vs-skill-dialog tests in [sdk/test/open-bank-skill-dialog.test.ts](sdk/test/open-bank-skill-dialog.test.ts) (craft dialog closed; success only when `bank.isOpen`)
- [x] T008 [P] [US1] Add `ActivitySession` tests in [sdk/test/activity-session.test.ts](sdk/test/activity-session.test.ts) (2 min / 5-repeat stall, 4-tactic budget, stop does not dispatch further actions, sampled failure logs, log vs warn vs error)

### Implementation for User Story 1

- [x] T009 [US1] Keep/finish blocked-start stepping in [sdk/actions.ts](sdk/actions.ts) `walkTo` until T006 passes
- [x] T010 [US1] Keep/finish skill-dialog close + `bank.isOpen` in [sdk/actions.ts](sdk/actions.ts) until T007 passes
- [x] T011 [US1] Implement default recovery tactics (close UI, step off blocked tile, re-walk phase anchor) in [sdk/activity.ts](sdk/activity.ts)
- [x] T012 [US1] Wire [bots/Jackpoo1/bowstrings.ts](bots/Jackpoo1/bowstrings.ts) to `ActivitySession`: phases pick/spin/bank, `noteProgress` on inventory/XP/bank, `noteFailure` on wheel/bank misses, register floor-climb tactic, stop on budget exhaust instead of `while (true)` blind retry
- [x] T013 [US1] Sample repeated grind-log lines in [sdk/activity.ts](sdk/activity.ts) so stalls cannot spam a line every tick; **warn** during recovery, **error** on stop

**Checkpoint**: User Story 1 is independently testable

---

## Phase 3b: User Story 1b - Survive an essence trip (Priority: P1)

**Goal**: Jackpoo2 teleport → mine → portal → Varrock east bank recovers or error-stops; no bank-open spam

**Independent Test**: Ghostty Jackpoo2 pane: failed teleport / shop-instead-of-teleport / missed portal / bank fail recover within 3 minutes or show **error**; a full bag of essence is banked without a human restart

### Tests for User Story 1b

- [x] T029 [P] [US1b] Add essence-mine region and “shop is not teleport” predicate tests in [sdk/test/essence-trip.test.ts](sdk/test/essence-trip.test.ts)

### Implementation for User Story 1b

- [x] T030 [US1b] Extract the post-quest mine loop from [bots/quests/rune-mysteries.ts](bots/quests/rune-mysteries.ts) into [bots/Jackpoo2/essence.ts](bots/Jackpoo2/essence.ts) using `ActivitySession` (phases teleport/mine/portal/deposit)
- [x] T031 [US1b] Register essence recovery tactics in [bots/Jackpoo2/essence.ts](bots/Jackpoo2/essence.ts): close shop, retry NPC teleport (not trade), scan/walk to rock, use portal, re-walk Varrock east bank
- [x] T032 [US1b] On no pickaxe or quest-incomplete teleport refusal, `stop()` with **error** in [bots/Jackpoo2/essence.ts](bots/Jackpoo2/essence.ts) instead of a tight mine-fail loop
- [x] T033 [US1b] Skip teleport when already in the essence mine; `recordTrip` on essence deposit in [bots/Jackpoo2/essence.ts](bots/Jackpoo2/essence.ts)

**Checkpoint**: User Story 1b is independently testable on Jackpoo2

---

## Phase 4: User Story 2 - Watcher can see what the bot is trying (Priority: P2)

**Goal**: Phase and recovery intent appear locally, not in public chat

**Independent Test**: Ghostty panes for Jackpoo1 and Jackpoo2 — log is quiet, warn is yellow, error is red; phase intent is visible without public chat

### Tests for User Story 2

- [x] T014 [P] [US2] Add `showIntent` / `localChat` tests covering empty, dedup, and 80-char trim in [sdk/test/show-intent.test.ts](sdk/test/show-intent.test.ts)
- [x] T015 [P] [US2] Add `localChat` case coverage in [server/webclient/src/bot/ActionExecutor.test.ts](server/webclient/src/bot/ActionExecutor.test.ts) (create if missing)

### Implementation for User Story 2

- [x] T016 [US2] Confirm [sdk/index.ts](sdk/index.ts) `showIntent` and [server/webclient/src/bot/ActionExecutor.ts](server/webclient/src/bot/ActionExecutor.ts) `localChat` match [specs/001-autonomous-recovery/contracts/intent-and-interfaces.md](specs/001-autonomous-recovery/contracts/intent-and-interfaces.md)
- [x] T017 [US2] Call `session.showIntent` on every phase change and recovery tactic in [sdk/activity.ts](sdk/activity.ts), [bots/Jackpoo1/bowstrings.ts](bots/Jackpoo1/bowstrings.ts), and [bots/Jackpoo2/essence.ts](bots/Jackpoo2/essence.ts); remove duplicate script-local intent that skips the SDK channel
- [x] T034 [US2] Colorize LOG/WARN/ERROR in [bots/watch-fleet.sh](bots/watch-fleet.sh) (Ghostty/tmux tail): default/dim log, yellow warn, red error; error is the attention color

**Checkpoint**: User Stories 1, 1b, and 2 work together; Ghostty color shows who needs attention

---

## Phase 5: User Story 3 - Travel then grind without a second launch (Priority: P3)

**Goal**: One `bun bots/Jackpoo1/bowstrings.ts` travels if needed, then grinds

**Independent Test**: Start away from flax → arrive → first trip banks bowstrings without starting `to-flax.ts`

### Tests for User Story 3

- [x] T018 [P] [US3] Add a pure helper test for “already at flax vs needs travel” in [sdk/test/flax-arrival.test.ts](sdk/test/flax-arrival.test.ts) (coordinate predicate only; no live bot)

### Implementation for User Story 3

- [x] T019 [US3] Extract travel functions from [bots/Jackpoo1/to-flax.ts](bots/Jackpoo1/to-flax.ts) into [bots/Jackpoo1/travel-to-flax.ts](bots/Jackpoo1/travel-to-flax.ts) (or shared module under `bots/Jackpoo1/`) with a clear `cannot_pack` stop instead of “still has extras” when inventory is empty
- [x] T020 [US3] Call travel from [bots/Jackpoo1/bowstrings.ts](bots/Jackpoo1/bowstrings.ts) inside the same `ActivitySession` when not at flax; skip travel when T018 predicate is true
- [x] T021 [US3] Make [bots/Jackpoo1/to-flax.ts](bots/Jackpoo1/to-flax.ts) a thin wrapper that does not disconnect in a way that blocks overnight grind (wrapper optional; default operator path is bowstrings)

**Checkpoint**: Single start covers travel + grind

---

## Phase 6: User Story 4 - Doors, shops, and vertical hatches (Priority: P4)

**Goal**: Door retry ignores trapdoors; shops surface `cant_reach`; already-open bank is a no-op

**Independent Test**: Unit tests listed below pass; no live shop required for merge

### Tests for User Story 4

- [x] T022 [P] [US4] Add trapdoor/manhole/hatch exclusion tests in [sdk/test/try-open-blocking-door.test.ts](sdk/test/try-open-blocking-door.test.ts)
- [x] T023 [P] [US4] Add shop `reason: 'cant_reach'` tests in [sdk/test/open-shop-cant-reach.test.ts](sdk/test/open-shop-cant-reach.test.ts)

### Implementation for User Story 4

- [x] T024 [US4] Keep trapdoor name filter in [sdk/actions-helpers.ts](sdk/actions-helpers.ts) and [sdk/actions.ts](sdk/actions.ts) until T022 passes
- [x] T025 [US4] Keep `openShop` door retry + structured reasons in [sdk/actions.ts](sdk/actions.ts) until T023 passes

**Checkpoint**: All user stories independently functional

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Docs, check, canary notes

- [x] T026 [P] Regenerate [sdk/API.md](sdk/API.md) via `bun run docs:api` for `showIntent` and `ActivitySession`
- [x] T027 Run `bun run check` and fix type/test/doc drift
- [x] T028 [P] Confirm [specs/001-autonomous-recovery/quickstart.md](specs/001-autonomous-recovery/quickstart.md) matches flax + essence entrypoints, Ghostty color, and test file names

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Story 1 (P1)**: After Foundational — flax MVP
- **User Story 1b (P1)**: After Foundational — essence canary; parallel with US1 once session exists
- **User Story 2 (P2)**: After Foundational; integrates with US1/US1b session + watch-fleet color
- **User Story 3 (P3)**: After US1 session exists on bowstrings
- **User Story 4 (P4)**: After Foundational; parallel with US2
- **Polish**: After desired stories

### User Story Dependencies

- **User Story 1 (P1)**: No dependency on other stories
- **User Story 1b (P1)**: Same session as US1; independent script (`essence.ts`)
- **User Story 2 (P2)**: Uses ActivitySession from US1/US1b for real callers; tests and watch-fleet color can start in parallel
- **User Story 3 (P3)**: Depends on US1 grind loop existing
- **User Story 4 (P4)**: Independent of US2/US3

### Parallel Opportunities

- T006, T007, T008 together
- T014, T015 together
- T022, T023 together
- T026, T028 together
- US4 implementation can proceed while US2 tests are written

---

## Parallel Example: User Story 1

```bash
# Launch tests for User Story 1 together:
Task: "Add blocked-start walkTo tests in sdk/test/walkto-blocked-start.test.ts"
Task: "Add bank-vs-skill-dialog tests in sdk/test/open-bank-skill-dialog.test.ts"
Task: "Add ActivitySession tests in sdk/test/activity-session.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: unit tests + one live flax trip AND one essence trip watched in Ghostty (log/warn/error)
5. Then US2 intent+color, US4 door/shop tests, US3 flax handoff

### Incremental Delivery

1. Setup + Foundational → session + honest bank
2. US1 → unattended flax trip (MVP)
3. US1b → unattended essence trip (second canary)
4. US2 → watcher understands phase + Ghostty color
5. US4 → door/shop regressions locked
6. US3 → one-command flax travel+grind
7. Polish → `bun run check` + API docs

---

## Notes

- [P] tasks = different files, no dependencies
- In-flight diffs in `sdk/actions.ts`, `sdk/index.ts`, and webclient `localChat` are the starting point for T005/T009/T010/T016/T024/T025, not a license to skip tests
- Do not commit `bots/*/grind.log`
- Suggested commit after foundational+US1+US1b tests: `feat: activity session, flax and essence stall recovery`
- Spec status: **Approved** 2026-08-22
