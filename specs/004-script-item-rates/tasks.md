# Tasks: Script Item Rates

**Input**: Design documents from `/specs/004-script-item-rates/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Required. SDK behavior change under Evidence-First Tests.

## Phase 1: Setup

- [X] T001 Confirm specs/004-script-item-rates design docs and roster callers in bots/quests

## Phase 2: Foundational

- [X] T002 Add jobKeyFromArgv, rosterJobKey, localHour, and normalizeItemName in sdk/job-key.ts

## Phase 3: User Story 1 - Named yields (P1)

- [X] T003 [US1] Add recordGain, jobKey on heartbeats, and captureBankStock in sdk/activity.ts
- [X] T004 [US1] Cover gain writes and a failed write in sdk/test/activity-gains.test.ts
- [X] T005 [US1] Record kept fish by name in bots/quests/fishing-route.ts
- [X] T006 [US1] Record magic logs before deposit in bots/quests/magic-trees.ts
- [X] T007 [US1] Record pickpocket coins in bots/quests/thieving-route.ts
- [X] T008 [US1] Record picked drops in bots/quests/green-dragons.ts
- [X] T009 [US1] Record deposited products in bots/quests/bank-fletch.ts, rune-rocks.ts, rimmington-iron.ts, mining-guild.ts, hobgoblins.ts, and essence.ts

## Phase 4: User Story 2 - Distribution (P1)

- [X] T010 [US2] Implement computeYields in .cursor/skills/wake-fleet/scripts/fleet-yields.ts
- [X] T011 [US2] Cover median, zeros, the 10-minute floor, and no XP invention in sdk/test/fleet-yields.test.ts
- [X] T012 [US2] Add the yields view to .cursor/skills/wake-fleet/scripts/fleet-report.ts
- [X] T013 [US2] Generate the distribution canvas from .cursor/skills/fleet-bank-canvas/scripts/build-yield-canvas.ts

## Phase 5: User Story 3 - Bank check (P2)

- [X] T014 [US3] Implement hourly stock append and computeStockCheck in sdk/bank-stock.ts
- [X] T015 [US3] Cover same-hour stickiness and a mule transfer in sdk/test/bank-stock.test.ts
- [X] T016 [US3] Add the stock view to .cursor/skills/wake-fleet/scripts/fleet-report.ts
- [X] T017 [US3] Append hourly stock from .cursor/skills/fleet-bank-canvas/scripts/build-bank-canvas.ts

## Phase 6: Polish

- [X] T018 Run the new unit tests and typecheck
- [X] T019 Restart roster jobs through fleet-launchd so the new gain calls are live
