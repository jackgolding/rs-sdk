# Contract: ActivitySession extensions

**Feature**: 002-fleet-efficiency | Extends the session contract from `specs/001-autonomous-recovery/contracts/activity-session.md`. All additions are backward-compatible: existing callers compile and behave unchanged.

## New config (`ActivityConfig`)

| Option | Type | Default | Meaning |
|--------|------|---------|---------|
| `heartbeatMs` | number | 300_000 | Interval between progress snapshots. `0` disables (tests, one-offs). |
| `heartbeatPath` | string | derived: `bots/{name}/heartbeat.log` when `grindLogPath` is set, else disabled | Where JSONL heartbeats go. |
| `park` | recovery-tactic | none | Optional route-provided safe-park step run during a restartable stop (e.g. deposit loot if bank reachable). Bounded by the normal recovery budget; failure never blocks exit. |

## Heartbeat behavior

- On each interval tick while the session is active and live state exists: append one JSON line (schema in `heartbeat-and-report.md`) via the bounded append helper.
- First heartbeat is written at session start (so restarts are observable via the `session` field), last one on `stop()` if state is live.
- No heartbeat is written from stale/disconnected state — gaps carry meaning.
- Write failures are logged at `warn` once and never crash the session.

## Stop semantics and process exit

`stop(code, message)` gains a restartability classification:

| Stop code | Restartable | Process exit | Rationale |
|-----------|-------------|--------------|-----------|
| `recovery_exhausted` | yes | **70** | KeepAlive (`SuccessfulExit: false`) restarts in ~30s |
| new: any code passed via `stopRestartable(code, msg)` | yes | 70 | routes can opt stalls into auto-restart (e.g. death cap reached) |
| `out_of_food`, `no_pickaxe`, `cannot_regear`, `mining_level`, other terminal codes | no | 0 | restart cannot help; shepherd notifies instead |
| operator signals (SIGTERM/INT/HUP) | n/a | 143/130/129 (existing `runScript` behavior) | launchd `stop` must not trigger KeepAlive thrash — launchd treats signal-terminated jobs per its own rules; the shepherd uses `fleet-launchd stop` which boots the agent out first (existing behavior) |

Exit-code application: `ActivitySession` sets `process.exitCode`; it does not call `process.exit()` mid-flight (scripts still run their disconnect/summary path). Scripts that bypass `runScript` get the same behavior because the session owns `process.exitCode`.

### Safe-park sequence (before any restartable exit)

Order, each step bounded and failure-tolerant:

1. Decline/close any open trade.
2. Dismiss blocking dialogs; close bank/shop/any modal.
3. Run the route's `park` tactic if registered.
4. Log final ERROR line with stop code + message (existing), write final heartbeat, disconnect.

Postcondition: the character is in a state where re-running the recorded assignment can begin cleanly (no modal, no trade, no held UI).

## Tactic repeat bound (Story 3, pickpocket class)

New per-tactic contract: a registered recovery tactic declares `maxConsecutive` (default 2). The recovery engine must not invoke the same tactic more than `maxConsecutive` times in a row; it advances to the next tactic instead. The engine-level budget (`maxRecoveryTactics`, `recoveryBudgetMs`) is unchanged and still terminal. Grind-log evidence: tactic lines include the attempt counter (existing `×N` format), which must therefore never exceed the bound for a single tactic name consecutively.

## Test obligations (constitution V)

- Heartbeat cadence with injected `now` (first-at-start, interval ticks, none-when-stale, final-on-stop).
- Exit-code mapping per stop code, including `stopRestartable`.
- Safe-park order and failure tolerance (park throws → exit still proceeds).
- `maxConsecutive` enforcement (a tactic that always fails is attempted exactly its bound, then next tactic).
