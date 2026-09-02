# Implementation Plan: Autonomous Activity Recovery

**Branch**: `speckit/autonomous-recovery` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-autonomous-recovery/spec.md`

## Summary

Make the Seers flax → spin → bank loop and the Varrock essence loop (Jackpoo2) unattended by (1) finishing in-flight SDK reliability (blocked-start walk, bank vs craft window, trapdoor filter, shop door retry, local intent) and (2) adding a shared `ActivitySession` that detects stalls, runs bounded recovery, colors grind-log lines log/warn/error for the Ghostty fleet viewer, and chains flax travel into grind in one process.

## Technical Context

**Language/Version**: TypeScript 5 / Bun 1.3 (existing repo)

**Primary Dependencies**: Existing BotSDK / BotActions; webclient `ActionExecutor` for `localChat`; `bun:test` for unit tests

**Storage**: Append-only `grind.log` per bot; no new database

**Testing**: `bun test` unit tests under `sdk/test/` (mock SDK pattern from `walkto-partial-path.test.ts`); live canaries watched in Ghostty (`bots/watch-fleet.sh`) for Jackpoo1 flax and Jackpoo2 essence; `bun run check` merge gate

**Target Platform**: Local macOS/Linux operator machine talking to demo or local LostCity gateway

**Project Type**: TypeScript library (`sdk/`) + character scripts (`bots/`)

**Performance Goals**: Recover named stalls within 3 minutes; stop within 10 seconds of budget exhaustion; ≤50 identical failure log lines per minute during a stall

**Constraints**: Do not change game content. One control connection per bot. New public APIs must have an in-change caller. `hasLineOfSight` stays unexported (no caller in this feature).

**Scale/Scope**: Two proving characters (Jackpoo1 flax, Jackpoo2 essence) plus shared SDK; 50 consecutive trips each is the live bar

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Game is source of truth**: PASS — no engine/content edits; spinning wheel and bank stay as they are.
- **Observe effects, not dispatch**: PASS — bank completion uses `bank.isOpen`; progress is inventory/XP/location/window; `showIntent` is local-only.
- **Shared porcelain**: PASS — `ActivitySession` lives in `sdk/`; Jackpoo1 flax and Jackpoo2 essence are consumers. `hasLineOfSight` export is deferred (no caller).
- **Bounded recovery**: PASS — this is the feature (2 min / 5 repeats → recover; 4 tactics or 3 min → stop).
- **Evidence-first tests**: PASS — unit tests for walk, bank, doors, shop reason, activity budget; live 50-trip is a canary, not a substitute for unit tests.
- **Spec Kit scope**: PASS — cross-cutting SDK + supervision.

Post-design re-check: still PASS. Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-autonomous-recovery/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── activity-session.md
│   └── intent-and-interfaces.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
sdk/
├── activity.ts              # NEW: ActivitySession (progress, stall, recovery, metrics)
├── actions.ts               # Harden openBank / openShop / walkTo (in-flight + bank.isOpen)
├── actions-helpers.ts       # Trapdoor filter (in-flight)
├── pathfinding.ts           # Keep hasLineOfSight unexported
├── index.ts                 # showIntent (in-flight); export activity
├── runner.ts                # Optional: onDisconnect wait used by long grind
└── test/
    ├── walkto-blocked-start.test.ts
    ├── open-bank-skill-dialog.test.ts
    ├── try-open-blocking-door.test.ts
    ├── open-shop-cant-reach.test.ts
    ├── activity-session.test.ts
    └── log-severity.test.ts

server/webclient/src/bot/
├── types.ts                 # localChat action (in-flight)
└── ActionExecutor.ts        # localChat → addLocalGameMessage (in-flight)

bots/Jackpoo1/
├── bowstrings.ts            # Consume ActivitySession; chain travel then grind
└── to-flax.ts               # Keep as thin wrapper or re-export into bowstrings

bots/Jackpoo2/
└── essence.ts               # Consume ActivitySession; teleport → mine → portal → bank
                              # (extract loop from bots/quests/rune-mysteries.ts; quest remains out of this feature)

bots/watch-fleet.sh          # Ghostty/tmux viewer: color grind.log by log/warn/error
```

**Structure Decision**: Extend the existing `sdk/` library and two proving scripts. Do not add a new package. Shared recovery is a module imported by scripts, not a separate process supervisor in this feature. Fleet color is the existing Ghostty viewer, not a new dashboard.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
