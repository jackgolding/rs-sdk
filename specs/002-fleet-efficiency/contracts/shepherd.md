# Contract: Fleet shepherd

**Feature**: 002-fleet-efficiency | New CLI: `.cursor/skills/wake-fleet/scripts/fleet-shepherd.ts`

## Installation

`fleet-launchd.ts install` additionally installs `com.rs-sdk.fleet-shepherd`:
`StartInterval: 600`, `RunAtLoad: true`, runs `bun .cursor/skills/wake-fleet/scripts/fleet-shepherd.ts`, logs to `~/Library/Logs/rs-sdk-fleet/shepherd.out.log` / `.err.log` (rotated by `rotate-logs.ts`). Survives reboot like every other agent.

## Cycle contract (one run)

Inputs: roster (via `roster.ts`), fleet classification (via the same classifier `fleet-status.ts` uses — imported, not shelled), heartbeat tails, shepherd state file.

1. **Serialize**: acquire lockfile next to the state file; if a previous cycle holds it, exit 0 without acting (spec edge case: overlapping cycles must not double-start).
2. **Classify** every rostered bot: `running` / `wake` / `intervene` / `paused` (+ new `zero_rate` intervene reason from heartbeats).
3. **Detect restarts** since last cycle (new bun pid or new heartbeat `session` value) and append to that bot's rolling restart history.
4. **Enforce cap**: any bot exceeding 4 restarts/rolling-hour → `fleet-launchd stop {bot}`, mark `capped`, notify once. Skip capped bots in steps 5–5b. **Clear `capped` when the rolling window no longer exceeds the limit**, or when a controller is observed (operator start).
5. **Start `wake` bots** through `fleet-launchd.ts start {bot}` — never as shepherd children, never a bot with a live controller (re-check controller count immediately before starting; skip if one appeared), never `paused`, never `capped`.
5b. **Restart stuck grinders**: if `kind === intervene`, reason starts with `zero_rate`, and `bursty` is not set — `fleet-launchd.ts restart {bot}` (same 4/hour cap). Do not restart food mules / other bursty jobs. `start` cannot unstick these: they already have a controller.
6. **Notify** (deduped per bot+condition via state file): every `intervene` bot (reason, tile), every newly capped bot. Mechanism: `osascript display notification`, one banner per cycle packing multiple bots.
7. **Record** cycle completion (`lastRun`), write state atomically (temp file + rename), release lock.

Postconditions / invariants:

- A `wake` bot at cycle start is running its recorded job by cycle end, or listed in the cycle's log with a reason (FR-002's 10-minute bound = one interval).
- The shepherd never attaches a control connection itself; it only manages launchd agents.
- The shepherd never writes to `bots/**` except nothing — assignments are written by the components that already own them.
- Cycle is idempotent: re-running immediately after a successful cycle performs no actions.

## Classification extensions (in `fleet-status.ts`)

- New intervene reason `zero_rate`: running bot, heartbeats ≥30 min apart (≥90 min if roster `bursty`), identical xp+coins. Missing heartbeat data never produces `zero_rate` (degrades to no-data).
- JSON rows gain optional `xpPerHour`, `gpPerHour`, `heartbeatAgeMs`.
- The hardcoded Musa ship coordinate moves to the shared `tiles.ts` constant (single definition).

## Failure behavior

- Gateway unreachable for a bot → that bot classifies `intervene` (existing behavior); shepherd still completes the cycle for others.
- State file corrupt/missing → start fresh with empty history (worst case: one extra restart allowance), log a warning.
- Notification failure → log and continue; never abort a cycle over osascript.

## Test obligations

Decision logic is extracted into pure functions (classification → action list) so tests cover: cap arithmetic on rolling windows, capped-clear on operator start, dedupe of notifications, skip-on-live-controller race, lockfile overlap behavior — all with injected clocks and fixture states, no launchd.
