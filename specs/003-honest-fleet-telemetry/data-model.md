# Data Model: Honest Fleet Telemetry

All storage is flat files with bounded growth: `appendGrindLog` caps writes, and every read is a bounded tail. Paths are relative to the repo root unless noted.

## Roster entry: `bots/roster.json` (additive field)

| Field | Type | Notes |
|-------|------|-------|
| `noEffectMinutes` | integer ≥ 1, optional | Per-bot no-effect threshold. If absent: 90 when `bursty: true`, else 15. `roster.ts` rejects invalid values on load |

## Ownership record: `bots/{name}/assignment.json`

This file now records ownership only. It is no longer a restart source (see research R6). It is overwritten by whichever process most recently connected in control mode.

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Roster name (case as in roster) |
| `pid` | number | `process.pid` of the controlling process |
| `argv` | string[] | Script path (repo-relative) + args |
| `command` | string | `bun ` + argv joined |
| `startedAt` | string (ISO) | Time of the `connect()` that wrote the record |
| `source` | `'connect'` | Replaces `'launchd' \| 'observed'`; legacy values are read as non-live |

**Liveness**: The record is live when `kill(pid, 0)` succeeds **and** `ps -o command= -p pid` contains `argv[0]`. Records without a `pid` (legacy) are never live.

**Resolved owner**, computed by `fleet-status` and not stored:

1. A live record, or else
2. the bot's launchd agent pid, with the command taken from the agent's program arguments (`legacy: true`), or else
3. none.

`supervised` = the owner pid equals the launchd agent pid.

**Validation**: `argv` must be non-empty. A record whose `name` doesn't match the folder is ignored.

## Progress snapshot: `bots/{name}/heartbeat.log` (JSONL)

The existing file, with new fields added. Readers ignore records that are invalid.

| Field | Type | Notes |
|-------|------|-------|
| `t` | number (ms) | Write time |
| `session` | number (ms) | Session start; groups records for rates |
| `pid` | number | **new** |
| `job` | string | `ActivitySession.name` |
| `xp` | Record<string, number> | Skills with xp > 0. For rates, not for levels |
| `levels` | Record<string, number> | Client `baseLevel` per skill. Absent on older snapshots. Never invert `xp` to a level |
| `coins` | number | Inventory coins |
| `x`, `z` | number | Position |
| `phase` | string | **new** |
| `lastProgressAt` | number (ms) | **new**: any progress kind |
| `lastEffectAt` | number (ms) | **new**: effect kinds only (xp/inventory/bank/shop/trade) |
| `recoveries` | number | **new**: tactics used in the current recovery |
| `stopped` | string \| null | **new**: stop code, if the session has stopped |

**Valid** means `xp.Hitpoints > 0` and `(x, z) != (0, 0)`. Invalid records are dropped by every reader.

## Activity event: `bots/{name}/events.log` (JSONL)

| Field | Type | Notes |
|-------|------|-------|
| `t` | number (ms) | |
| `pid` | number | |
| `session` | number (ms) | |
| `type` | `'start' \| 'progress' \| 'failure' \| 'recovery' \| 'stop'` | |
| `kind` | ProgressKind | `progress` only |
| `code` | string | `failure` / `stop` |
| `count` | number | `failure`: running count for this code in the session |
| `tactic` | string | `recovery` only |
| `restartable` | boolean | `stop` only |
| `phase` | string | |
| `x`, `z` | number | |
| `message` | string | Truncated to 200 chars |

**Throttle**: at most one `progress` event per kind per 30 s per session. `failure`, `recovery` and `stop` events are never throttled.

## Fleet verdict: one row of `fleet-status` JSON

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | |
| `kind` | VerdictKind | See state table below |
| `check` | string | Code of the failed check (`no_effect`, `telemetry_silent`, `no_controller`, `churn`, `capped`, `supplies`, `no_live_state`, `logged_out`, `finished`, `foreign_owner`, `ok`) |
| `reason` | string | Human sentence with the measured value |
| `restartCommand` | string | Always the roster command |
| `owner` | `{ pid, command, supervised, startedAt, legacy } \| null` | Resolved owner (see ownership record) |
| `drift` | `{ owner: string } \| null` | Set when the owner command differs from `restartCommand` |
| `controllers` | number | From the gateway `/status` |
| `stateAge` | number \| null | From the gateway |
| `x`, `z` | number \| null | Only when the gateway state is live |
| `minutesSinceEffect` | number \| null | From the newest valid snapshot's `lastEffectAt`, or the XP delta, compared with **now** |
| `minutesSinceSnapshot` | number \| null | |
| `relaunches1h` | number \| null | From launchd `runs` samples |
| `lastExit` | string \| null | launchd `last exit code` |
| `lastStop` | `{ code, t } \| null` | Newest `stop` event |
| `xpPerHour` | Record<string, number> | Per-session aggregated (R3) |
| `gpPerHour` | number \| null | |
| `levels` | Record<string, number> \| null | Newest snapshot's client `baseLevel`. Null when the field is missing |
| `shepherd` | `{ capped, cappedAt, actions: {t, action}[] }` | Last 1 h, from shepherd state |
| `paused` | boolean | |

### Verdict kinds and precedence

Checks run top to bottom, and the first match wins.

| # | Kind | Condition |
|---|------|-----------|
| 1 | `paused` | Roster `paused` (skip-bots or food-hub). The row still carries every other field for information |
| 2 | `needs-client` | Gateway unreachable, `status = dead`, `inGame = false`, or `stateAge > 8 s` |
| 3 | `capped` | Shepherd state `capped = true` |
| 4 | `churning` | `relaunches1h > CHURN_MAX` (3) |
| 5 | `needs-supplies` | A `failure` event with code `missing_supplies` / `setup_gear` and count ≥ 5 in the last 30 min, or the text fallback matches ≥ 5 of the last 40 lines |
| 6 | `foreign-owner` | Live owner with `supervised = false` and a `drift`, not producing. Reported, never acted on |
| 7 | `alive-not-producing` | Live owner, and any of: `controllers = 0`; `minutesSinceSnapshot > 2 × interval`; `minutesSinceEffect > threshold` (roster `noEffectMinutes`, else 90 if bursty, else 15); no snapshot at all after 10 min of owner uptime |
| 8 | `producing` | Live owner and none of the above |
| 9 | `finished` | No live owner, launchd last exit 0, and the last stop is non-restartable or absent |
| 10 | `restartable` | In game, no live owner, not finished |

**Headline**: `summary.producing` is the count of `producing` rows. `summary.notProducing` is every other kind except `paused`.

## Shepherd state: `~/Library/Logs/rs-sdk-fleet/shepherd-state.json`

| Field | Type | Notes |
|-------|------|-------|
| `bots[name].restarts` | number[] | Start times in the rolling hour (existing) |
| `bots[name].capped` | boolean | Existing |
| `bots[name].cappedAt` | number \| null | **new** |
| `bots[name].actions` | `{ t, action: 'start' \| 'restart' \| 'cap' \| 'uncap' \| 'skip-foreign' \| 'skip-finished' }[]` | **new**, last 2 h |
| `bots[name].runsSamples` | `{ t, runs }[]` | **new**, last 2 h, one per cycle |
| `bots[name].notified` | Record<conditionCode, number> | Existing; keys become stable codes and are deleted when the condition is absent |
| `lastRun` | number | Existing |

**Migration**: Existing `notified` keys starting with `intervene:` are dropped on first load.

## State transitions (one character, per supervisor cycle)

```text
restartable --canStart--> (start) --> producing | alive-not-producing | churning
restartable --!canStart--> capped
capped --canStart--> (start once) --> ...
alive-not-producing --supervised && canStart && !restartedForThisCondition--> (restart)
alive-not-producing --already restarted for it--> stays; notify not_producing
churning --> notify churning (no restart; launchd is already relaunching)
foreign-owner --> notify foreign_owner (no action)
finished --> notify finished once (no action)
```
