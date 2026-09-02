# Data Model: Autonomous Activity Recovery

## ActivitySession

A long-running job bound to one `BotSDK` / `BotActions` pair.

| Field | Type | Rules |
|-------|------|--------|
| name | string | Required, stable id (`bowstrings` or `essence`) |
| phase | string | Current step; empty until `setPhase` |
| lastProgressAt | timestamp | Updated only by `noteProgress` |
| lastFailure | { code, message, at } \| null | Last `noteFailure` |
| failureCounts | map code → timestamps | Pruned to the 2-minute window |
| recoveryTacticsUsed | number | Incremented per tactic; max 4 default |
| recoveryStartedAt | timestamp \| null | Set when recovery begins; cleared on progress |
| stopReason | StopReason \| null | Terminal; session must not act after set |
| trips | number | Completed product trips |
| itemsBanked | number | Cumulative product deposited (bowstrings or essence) |
| stallMs | number | Time spent in recovery or repeating failures |
| lastSeverity | `log` \| `warn` \| `error` | Last grind-log line level |

### Validation

- Defaults: stall after 120s without progress; 5 identical failure codes in 120s; 4 tactics or 180s recovery budget.
- `noteProgress` clears `recoveryStartedAt` and resets `recoveryTacticsUsed` for the new phase.
- `noteFailure` with the same code 5 times in the window MUST trigger recovery even if wall-clock progress timeout has not fired.
- Once `stopReason` is set, `tick()` / `recover()` MUST return the stop reason and MUST NOT dispatch more game actions.

## Phase

Named step. Bowstrings uses:

`travel` → `pick` → `walk_wheel` → `spin` → `walk_bank` → `deposit`

Travel is skipped when the character is already in the flax field (approx. 2744, 3444, level 0).

Essence uses:

`teleport` → `mine` → `portal` → `walk_bank` → `deposit`

Teleport is skipped when already in the essence mine (approx. 2860–3040, 4760–4940).

## ProgressEvent

| Field | Type |
|-------|------|
| kind | `inventory` \| `xp` \| `location` \| `bank` \| `shop` \| `dialog` \| `phase` |
| at | timestamp |
| detail | optional string |

`location` counts only if worldX/worldZ/level changed, including entering or leaving the essence mine. `bank` counts only if `bank.isOpen` became true. Opening a shop during an essence teleport phase is NOT progress.

## Stall

Derived, not stored separately:

- `now - lastProgressAt >= stallMs`, or
- one failure code has ≥ `repeatFailCount` timestamps in `repeatFailWindowMs`

## RecoveryAttempt

| Field | Type |
|-------|------|
| index | 1..maxRecoveryTactics |
| tactic | `close_ui` \| `step_off` \| `rewalk` \| `reach_floor` \| custom |
| intent | string shown via `showIntent` |
| outcome | `resumed` \| `still_stalled` \| `exhausted` |

Script registers ordered tactic callbacks. SDK default tactics: close stray UI, step off blocked tile, re-walk phase anchor. Floor climb is registered by the flax script. Essence registers: close shop, retry NPC teleport, scan/walk to rock, use portal.

## Trip

One cycle that deposits the product and returns the inventory to a gatherable state.

| Field | Type |
|-------|------|
| index | incrementing |
| product | `bowstring` \| `essence` |
| quantity | count deposited this trip |
| startedAt / endedAt | timestamps |
| recoveries | count used during the trip |

## Intent

| Field | Type | Rules |
|-------|------|--------|
| text | string | Trimmed, newlines collapsed, max 80 chars |
| lastShown | string | Deduped in BotSDK |
| severity | `log` \| `warn` \| `error` | Default log; warn during recovery; error on stop |

MUST NOT be sent as public chat.

## Log line

Grind-log lines include a severity token the Ghostty viewer can color. Repeated identical **warn** lines are sampled. **error** is never sampled away (always visible).

## StopReason

| Field | Type |
|-------|------|
| code | `recovery_exhausted` \| `disconnected` \| `cannot_pack` \| `no_pickaxe` \| `quest_incomplete` \| `operator_stop` \| `arrived` (travel-only) |
| phase | string |
| lastError | string |
| location | { x, z, level } |
| recoveries | number |

## State transitions

```text
idle --setPhase--> running
running --noteProgress--> running
running --stall--> recovering
recovering --progress--> running
recovering --budget exhausted--> stopped
running --fatal / disconnect--> stopped
```

Stopped is terminal for that session instance.
