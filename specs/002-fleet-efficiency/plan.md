# Implementation Plan: Fleet Efficiency and Self-Healing Operations

**Branch**: `002-fleet-efficiency` | **Date**: 2026-08-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-fleet-efficiency/spec.md`

## Summary

Close the gap between "a script stopped" and "a human noticed": make `recovery_exhausted` exits restartable by launchd's existing `KeepAlive` (non-zero exit + safe-park before exit), add a scheduled shepherd launchd job that classifies the fleet, starts idle bots, enforces a per-bot restart cap, and fires desktop notifications; add periodic progress heartbeats to `ActivitySession` plus a one-command rate report (xp/hr, gp/hr, food supply/demand, reassignment flags); and fix the four recurring stall classes (pickpocket tactic repeats, wilderness death re-gear, trade waiting deadlines, named tile-trap recoveries) in the shared modules all affected bots already use.

Key discovery from research: bot launch agents already restart on non-zero exit (`KeepAlive` / `SuccessfulExit: false`, `ThrottleInterval: 30`). Today's idle-for-hours failure mode exists because `ActivitySession.stop('recovery_exhausted', …)` leads to a clean exit 0. Most of Story 1 is exit-semantics plus a thin scheduled classifier, not new supervision machinery.

## Technical Context

**Language/Version**: TypeScript on Bun (repo standard; all fleet scripts and SDK are Bun-run `.ts`)

**Primary Dependencies**: None new. Existing: `sdk/activity.ts` (ActivitySession), `sdk/grind-log.ts` (bounded append/rotate), `.cursor/skills/wake-fleet/scripts/{roster,fleet-status,fleet-launchd,rotate-logs}.ts`, macOS `launchd` (per-bot LaunchAgents + existing 6-hour rotate job pattern), `osascript` desktop notifications (already used by wake-fleet)

**Storage**: Flat files, all bounded: `bots/{name}/heartbeat.log` (new, JSONL, rotated by the same cap mechanism as grind logs), `bots/{name}/assignment.json` (existing), `~/Library/Logs/rs-sdk-fleet/shepherd-state.json` (new, small restart-history state), launchd plists in `~/Library/LaunchAgents/`

**Testing**: `bun test` (sdk/test/*.test.ts, hand-rolled mocks with injectable `now`/`writeLog`, per `activity-session.test.ts` pattern); merge gate is `bun run check` (typecheck + webclient typecheck + tests)

**Target Platform**: macOS host (launchd), always-on machine already running the fleet

**Project Type**: CLI tooling + shared library modules inside an existing monorepo (no service, no UI)

**Performance Goals**: Shepherd cycle completes in <60s for 46 bots; report command answers in <30s (SC-004); heartbeat write cost negligible (one line / 5 min / bot)

**Constraints**: Never read whole grind logs (bounded tails only — jacklove1's log exceeded 1 GB historically); one controller per character (shepherd must never attach or double-start); roster remains single source of truth; grind jobs start only via launchd, never as Cursor-shell children; heartbeat storage must be rotation-safe

**Scale/Scope**: 46 rostered bots today; design should tolerate ~100. Four code areas: `sdk/` (2 files), wake-fleet scripts (4 files, 2 new), `bots/quests/` (4 route/movement files), tests

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Game is source of truth**: PASS — no game/server content changes; everything is SDK, fleet scripts, and shared bot modules.
- **Observe effects, not dispatch**: PASS — restart success is measured by new progress evidence (heartbeat deltas), not process spawn; zero-rate detection uses observed xp/coins, not process liveness; death re-gear verifies bank kit exists before walking back.
- **Shared porcelain**: PASS — heartbeats and safe-stop land in `ActivitySession` (every grind inherits them); trap recoveries move into `bots/quests/movement.ts`/`tiles.ts`; no per-character copies. Every new export has an in-change caller (shepherd, report, routes).
- **Bounded recovery**: PASS — this feature exists to enforce it at fleet level: restart cap per bot per hour with stop-and-notify on exhaustion; per-tactic repeat bounds in thieving; death-per-session caps in wilderness routes; trade deadlines.
- **Evidence-first tests**: PASS — unit tests for heartbeat scheduling/rate math/classification/backoff with injected clocks; integration-style tests for the thieving escalation and death re-gear decision branches; `bun run check` is the merge gate.
- **Spec Kit scope**: PASS — cross-cutting supervision/fleet-protocol feature, exactly what the constitution names as requiring Spec Kit.

**Post-design re-check (after Phase 1)**: PASS — no new violations introduced by the design. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-fleet-efficiency/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── activity-session-extensions.md   # heartbeat, safe-stop, exit semantics
│   ├── shepherd.md                      # shepherd cycle, restart cap, notifications
│   └── heartbeat-and-report.md          # heartbeat record schema, report CLI
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
sdk/
├── activity.ts                  # + heartbeat emission, safeStop/park hook, exit-code semantics
├── grind-log.ts                 # + bounded tail/JSONL read helper (shared by status/report)
└── test/
    ├── activity-heartbeat.test.ts       # new
    ├── fleet-rates.test.ts              # new (rate math, zero-rate, bursty)
    └── thieving-escalation.test.ts      # new (tactic repeat bound)

.cursor/skills/wake-fleet/scripts/
├── roster.ts                    # + per-bot `bursty` flag passthrough
├── fleet-status.ts              # + zero-rate heuristic from heartbeats; rate fields in JSON
├── fleet-launchd.ts             # + install shepherd StartInterval job (like rotate job)
├── fleet-shepherd.ts            # new: classify → start idle → enforce cap → notify
├── fleet-report.ts              # new: xp/hr, gp/hr, food supply/demand, reassignment flags
└── rotate-logs.ts               # + rotate bots/*/heartbeat.log

bots/
├── roster.json                  # + `bursty: true` on mule/orchestrator entries
└── quests/
    ├── thieving-route.ts        # per-tactic repeat bound + escalation order
    ├── rune-rocks.ts            # death: verify bank kit before return; deaths-per-session cap
    ├── wildy-moss-giants.ts     # same death contract
    ├── movement.ts              # named trap recoveries (gangplank, lever oscillation)
    └── tiles.ts                 # Musa gangplank + Deserted Keep lever tiles (constants)
```

**Structure Decision**: Extend the existing three layers in place — SDK porcelain (`sdk/`), fleet tooling (`.cursor/skills/wake-fleet/scripts/`), shared routes (`bots/quests/`). Two genuinely new files (`fleet-shepherd.ts`, `fleet-report.ts`) both live beside the fleet scripts they compose with; everything else is a modification of an existing module, honoring the roster/fleet rules already in force.

## Complexity Tracking

No constitution violations to justify. New surface is limited to two CLI scripts with immediate callers (launchd job, operator) and additive `ActivitySession` config; no new abstraction layers, no unused exports.
