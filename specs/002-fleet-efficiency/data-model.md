# Data Model: Fleet Efficiency and Self-Healing Operations

**Feature**: 002-fleet-efficiency | **Date**: 2026-08-29

All storage is flat files with bounded growth. No database. Paths are repository-relative unless noted.

## Entities

### Roster entry (existing, extended)

Source of truth: `bots/roster.json` → `bots[]`.

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Character name; unique |
| `view` | string | Watch-pane grouping (existing) |
| `script` | string | Default job script path (existing) |
| `args` | string[] | Default job argv (existing) |
| `bursty` | boolean? | **New, optional.** True for mules/orchestrators whose output is legitimately zero for long stretches. Widens the zero-rate window from 30 to 90 minutes. Absent = false. |

Validation: `bursty` must only widen detection, never disable it. `roster.ts` passes it through; no other script reads roster directly (existing rule).

### Recorded assignment (existing, unchanged)

`bots/{name}/assignment.json`, written by `runScript`, `ActivitySession` (with `grindLogPath`), `fleet-status`, `fleet-launchd`. Restart command resolution order stays: live argv → assignment → roster default.

### Progress snapshot / heartbeat (new)

`bots/{name}/heartbeat.log` — JSON Lines, one record per interval, written by `ActivitySession` through the bounded-append helper (8 MiB cap → keep 4 MiB; rotated by `rotate-logs.ts`; gitignored via `*.log`).

| Field | Type | Notes |
|-------|------|-------|
| `t` | number | Epoch ms at capture |
| `session` | string | Session start id (epoch ms of session start); a new value marks a restart |
| `job` | string | `ActivitySession` name (e.g. `thieving-route`) |
| `xp` | object | Map of skill name → total xp (only skills with xp > 0) |
| `coins` | number | Coins in inventory + coins delta context is derived by readers, raw total stored |
| `x`, `z` | number | Position at capture |

Validation rules: record is written only when live state exists (no synthetic zeros after disconnect — a gap in time is the signal, not a zero row). Readers must tolerate a truncated first line after rotation.

State semantics for readers:
- **Rate** = (latest.xp − window-start.xp) / elapsed, same for coins.
- **Zero-rate stall** = two records ≥30 min apart (≥90 min if bursty) with identical xp totals and coins, while a bun process owns the bot.
- **No data** = file missing/unreadable/older than window → report "no data"; never classify as stalled.
- **Restart observed** = `session` value changed between consecutive records.

### Fleet classification (existing, extended)

Output row of `fleet-status.ts` (in-memory / JSON output, not persisted).

| Field | Change |
|-------|--------|
| `kind` | unchanged enum: `running` / `wake` / `intervene` / `paused` |
| `reason` | new possible value: `zero_rate` (with minutes silent) |
| `xpPerHour`, `gpPerHour` | **New, optional**: computed from heartbeat tail when available |
| `heartbeatAgeMs` | **New, optional**: staleness indicator |
| everything else | unchanged (`command`, `commandSource`, `bunPid`, `x`, `z`, …) |

### Shepherd state (new)

`~/Library/Logs/rs-sdk-fleet/shepherd-state.json` — single small JSON document owned exclusively by `fleet-shepherd.ts` (one writer; shepherd runs are serialized by a lockfile beside it, see contract).

| Field | Type | Notes |
|-------|------|-------|
| `bots.{name}.restarts` | number[] | Epoch ms of each observed restart, pruned to the rolling window (1h) |
| `bots.{name}.capped` | boolean | True once the cap tripped; cleared when the operator starts the bot again (shepherd observes a new controller and resets) |
| `bots.{name}.notified` | object | Condition key → epoch ms last notified; used to dedupe notifications until the condition changes |
| `lastRun` | number | Epoch ms of last completed cycle |

### Restart budget (policy, not storage)

| Parameter | Default | Where |
|-----------|---------|-------|
| Max automatic restarts per rolling hour | 4 | shepherd |
| Action on breach | `fleet-launchd stop {bot}`, mark capped, notify once | shepherd |
| KeepAlive restart spacing | 30s (`ThrottleInterval`, existing) | launchd plist |
| Restartable exit code | 70 | `ActivitySession` → process exit |
| Non-restartable stop | exit 0 (KeepAlive leaves it down; shepherd classifies + notifies) | `ActivitySession` |

## State transitions

### Character supervision lifecycle

```
                       script exits 70 (restartable stop)
        ┌──────────────────────────────────────────────────┐
        v                                                  │
  RUNNING ── clean exit 0 (non-restartable stop) ──> DOWN (intervene: shepherd notifies)
        │                                                  ^
        │ process killed / agent stopped                   │ cap breached
        v                                                  │
  IDLE (wake) ── shepherd start (≤10 min) ──> RUNNING ─────┘
        │
        └── paused (skip-bots.txt) ──> ignored silently
```

- `RUNNING → RUNNING` via exit-70 is handled by launchd KeepAlive (~30s), invisible to the shepherd except as a restart event counted toward the cap.
- `capped` requires operator action (a manual start); the shepherd never un-caps by itself.

### Stall-class recovery transitions (Story 3)

- **Pickpocket**: `fail/stun → tactic[i] (bounded repeats per tactic) → tactic[i+1] … → recovery_exhausted (exit 70)`. The same tactic never repeats more than its bound consecutively.
- **Wilderness death**: `death detected → respawn wait → verify bank kit → (kit ok: re-gear, resume) | (kit missing: stop 'cannot_regear', exit 0) ; deaths this session > cap: stop restartable, notify`.
- **Trade wait**: `waiting → deadline expiry → bank/hold goods → resume grind ; mule records miss → retry next round`.
- **Tile trap**: `trap tile pattern detected → named recovery tactic (warn-level log) → resume | count toward recovery budget`.
