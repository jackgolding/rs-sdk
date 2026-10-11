# Implementation Plan: Honest Fleet Telemetry

**Branch**: `003-honest-fleet-telemetry` (work lands on `private/fleet`; SDK pieces cherry-pickable to `sdk/local`) | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-honest-fleet-telemetry/spec.md`

## Summary

Make the fleet tooling report what the bots are actually producing, so agents stop relaying false "healthy" and "fixed" claims. This takes four changes.

**1. One evidence-based verdict.** `fleet-status` assigns each bot exactly one verdict. "Producing" requires all of:

- a live owner;
- an attached controller;
- fresh game state;
- an effect (XP, coins, inventory, bank, shop or trade) within the job's threshold;
- no relaunch churn.

**2. Trustworthy inputs to that verdict.**

- Snapshots run on a timer and are never written before skills load.
- Rates are computed per session.
- A process records its own ownership on control connect.
- launchd `runs` and exit codes are sampled.
- Activities write structured events alongside the text log.

**3. A shepherd that can't undo its own starts.** It checks the restart cap before starting, never acts on processes it didn't start, and re-notifies on stable condition codes.

**4. Restarts that match what status said, and can be checked.** The roster always wins (the clarified rule), and `--verify` waits for real progress before calling a restart successful.

## Technical Context

**Language/Version**: TypeScript on Bun (repo standard)

**Primary Dependencies**: None new. The existing modules involved are:

- SDK: `sdk/activity.ts`, `sdk/assignment.ts`, `sdk/grind-log.ts`, `sdk/index.ts` (`BotSDK.connect`)
- Fleet scripts in `.cursor/skills/wake-fleet/scripts/`: `fleet-status.ts`, `fleet-shepherd.ts`, `fleet-launchd.ts`, `fleet-rates.ts`, `fleet-report.ts`, `roster.ts`, `rotate-logs.ts`
- macOS `launchctl`, `ps`, and `osascript`

**Storage**: Flat files with bounded growth, specified in data-model.md:

- `bots/{name}/assignment.json`, repurposed as the ownership record
- `bots/{name}/heartbeat.log`, with extra snapshot fields
- `bots/{name}/events.log`, new JSONL
- `~/Library/Logs/rs-sdk-fleet/shepherd-state.json`, with extra per-bot fields

**Testing**: `bun test` with injected clocks and writers, following the patterns in `sdk/test/activity-*.test.ts` and `fleet-*.test.ts`. The merge gate is `bun run check`.

**Target Platform**: The macOS host that runs the fleet under launchd.

**Project Type**: CLI tooling plus shared SDK modules inside the existing monorepo.

**Performance Goals**:

- `fleet-status` finishes in under 10 s for 45 bots (parallel gateway fetches plus 45 `launchctl print` calls).
- A shepherd cycle finishes in under 60 s.
- Snapshot cost is one line per 5 minutes per bot. Events are throttled.

**Constraints**:

- Bounded tail reads only; never read a whole log.
- One controller per bot; status and shepherd never attach.
- The roster stays the only bot list.
- Grind jobs start only through launchd.
- No gateway or server changes. The remote gateway (`rs-sdk-demo.fly.dev`) can't be assumed redeployed.
- The ownership write must not break non-Bun consumers of `sdk/index.ts`. The lite runner does not construct `BotSDK` (verified).

**Scale/Scope**: 45 bots today, and the design should hold to about 100. The work touches:

- `sdk/`: 3 files
- wake-fleet scripts: about 10 files (status, verdict, rates, shepherd, launchd, launchd-info, verify, report, roster, rotate)
- `bots/quests/`: `green-dragons.ts` and `fishing-route.ts` only (`converge-and-accept-trade.ts` needs no edit; ownership is automatic)
- rules and docs: 5 files
- tests: about 6 files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Game is source of truth**: PASS. No game or server changes; all changes are in tooling and the SDK.
- **Observe effects, not dispatch**: PASS. This feature applies Principle II to the fleet itself:
  - "producing" requires observed effects, not process liveness;
  - `--verify` requires a progress event or an XP/coins increase, not a pid;
  - `setPhase` no longer clears repeat-failure counters, and phases never count as effects. Refreshing the in-script stall timer on a phase change is a recovery trigger, not a success claim; the fleet verdict still requires an observed effect.
- **Shared porcelain**: PASS.
  - Ownership is recorded in `BotSDK.connect()`, so about 60 scripts are covered with no per-script code.
  - Timer snapshots, events, and the WARN-prefix severity fix live in `ActivitySession`, so every grind inherits them.
  - Every new export has a caller in this change: `recordOwnership` (connect), `canStart` (shepherd), `lastEffectAt` (status, verify), and the verdict classifier (status, shepherd).
- **Bounded recovery**: PASS.
  - The shepherd restarts an alive-not-producing bot at most once per episode, within the hourly cap.
  - Verify has a timeout.
  - Nothing retries forever.
  - The cap now holds a bot down instead of oscillating it.
- **Evidence-first tests**: PASS. The tests reproduce the baseline failures:
  - an empty-skills first record must not inflate rates;
  - the start-then-cap sequence must not happen in one cycle;
  - an `--except` argv must not imply ownership;
  - a hung session must keep writing snapshots;
  - phase ping-pong with repeated failures must arm recovery.

  The merge gate is `bun run check`.
- **Spec Kit scope**: PASS. This is cross-cutting supervision work that every bot inherits.

**Post-design re-check (after Phase 1)**: PASS, with one item in Complexity Tracking: `fleet-status` gains a `launchctl` dependency (R7).

## Project Structure

### Documentation (this feature)

```text
specs/003-honest-fleet-telemetry/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── fleet-status.md            # verdict JSON/pretty output contract
│   ├── activity-telemetry.md      # BotSDK ownership, ActivitySession timer/events/severity/phase, rates
│   └── shepherd-and-launchd.md    # cycle invariants, notifications, --verify
├── checklists/requirements.md
└── tasks.md                       # /speckit-tasks
```

### Source Code (repository root)

```text
sdk/
├── assignment.ts                  # recordOwnership(), readOwnership(), isOwnerLive(); drop writeAssignment/source
├── index.ts                       # BotSDK.connect(): recordOwnership on control connect
├── activity.ts                    # timer snapshots, validity, events.log, WARN-prefix severity, setPhase keeps failure counters
└── test/
    ├── activity-heartbeat.test.ts # updated: no empty first record, timer while loop blocked
    ├── activity-session.test.ts   # updated: phase ping-pong + repeat failure arms recovery; WARN upgrade
    ├── activity-events.test.ts    # new: start/progress throttle/failure count/stop
    ├── assignment-ownership.test.ts # new: --except never owns; pid reuse guard; legacy record not live
    ├── fleet-rates.test.ts        # updated: per-session rates; invalid records dropped; lastEffectAt
    ├── fleet-shepherd.test.ts     # updated: canStart, no same-cycle undo, re-notify, foreign skip
    └── fleet-verdict.test.ts      # new: precedence table, headline

.cursor/skills/wake-fleet/scripts/
├── fleet-verdict.ts               # new: pure classifier (inputs → verdict row); shared by status & shepherd tests
├── fleet-status.ts                # gather inputs (gateway, ownership, launchctl, snapshots, events, shepherd state) → classifier → output
├── fleet-rates.ts                 # per-session computeRates, lastEffectAt; delete isZeroRate in T025 (after US3 shepherd no longer calls it)
├── fleet-shepherd.ts              # canStart, runs sampling, actions log, stable notify codes, foreign/finished skip
├── launchd-info.ts                # new: launchctl print → { loaded, pid, runs, lastExit, programArgs } (shared by status, shepherd, launchd)
├── fleet-verify.ts                # new: pure verifyOutcome() for --verify
├── fleet-launchd.ts               # drop recordAssignment, --verify, --force, status runs
├── fleet-report.ts                # use per-session rates
├── roster.ts                      # delete resolveCommand; re-export ownership helpers; noEffectMinutes field
└── rotate-logs.ts                 # + events.log

bots/quests/
└── green-dragons.ts               # warnings via session.log('warn'); missing supplies via noteFailure('missing_supplies')
    fishing-route.ts, thieving-route.ts, magic-trees.ts
                                   # fishing-route: map "Cannot restock" setup_gear failures to missing_supplies

.cursor/rules/fleet-roster.mdc, .cursor/rules/wake-fleet-scripts.mdc,
.cursor/skills/wake-fleet/SKILL.md, AGENTS.md, CLAUDE.md, learnings/gateway-fleet.md
                                   # roster-wins restart rule; verdict kinds; --verify required before "fixed"
```

**Structure Decision**: Extend the existing three layers in place. The classifier is split out of `fleet-status.ts` into a new pure module, `fleet-verdict.ts`, so both the status tool and the tests can use it without network or `launchctl` calls. Everything else modifies existing files.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `fleet-status` shells out to `launchctl print` for each bot | Relaunch churn (150–178 `recovery_exhausted` stops per fishing bot) is invisible without launchd's `runs` and exit code | `stop` events alone miss crashes during the roughly 12-second startup before any session exists. A gateway-side counter would need a remote redeploy. |
