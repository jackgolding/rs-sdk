# Contract: activity telemetry (SDK)

## `BotSDK.connect()` (sdk/index.ts)

After a successful control-mode connect, the SDK calls `recordOwnership(botUsername)` from `sdk/assignment.ts`.

- Observe-mode connects are a no-op.
- If `bots/{name}/` does not exist under the repo root, it is a no-op (no throw).
- It writes the ownership record described in data-model.md, with `pid = process.pid` and `argv` = the repo-relative `process.argv.slice(1)`.
- It runs on every successful (re)connect, so after a pre-emption and a later reconnect the record points at the current controller.

`recordScriptAssignment()` (called from `runScript` and `ActivitySession`) becomes a thin alias of `recordOwnership(process.env.BOT_USERNAME)` and is kept for existing callers. `writeAssignment(name, argv, source)` is removed. The only caller outside the SDK was `fleet-status`/`fleet-launchd`, which no longer write it.

## `ActivitySession` (sdk/activity.ts)

### Config (additive)

| Field | Default | Meaning |
|-------|---------|---------|
| `heartbeatMs` | 300 000 when `grindLogPath` set | Snapshot timer interval (now wall-clock) |
| `eventsPath` | `grindLogPath` with `grind.log` → `events.log` | Structured event file |

### Behaviour changes

| Member | Before | After |
|--------|--------|-------|
| constructor | Force-writes a heartbeat immediately | Starts an unref'd timer and writes the first **valid** snapshot once skills are known; appends a `start` event |
| `maybeHeartbeat()` | Writes if the interval elapsed | Kept for compatibility; no-op when the timer is running |
| `setPhase(p)` | Calls `noteProgress('phase')`, which resets the stall timer, failure counters, and recovery state | Sets the phase, shows the intent, and logs it. Refreshes `lastProgressAt` only when the phase name changes. **Does not** clear failure counters, end an in-progress recovery, or update `lastEffectAt` |
| `noteProgress(kind)` | Resets the stall timer | Same, plus updates `lastEffectAt` for effect kinds and appends a throttled `progress` event. A `location` note whose player tile has not changed since the last credited location note is ignored |
| `noteFailure(code, msg)` | WARN line (sampled) | Same, plus an unthrottled `failure` event with a running `count` |
| `recover()` tactics | WARN lines | Same, plus a `recovery` event per tactic |
| `stop(code, …)` | ERROR line | Same, plus a `stop` event |
| `finalizeStop()` | Heartbeat + exit code | Clears the timer, writes a final valid snapshot, sets the exit code |
| `log('log', 'WARN …')` | Written at LOG | Upgraded to `warn`, prefix stripped (likewise `ERROR `) |

### Snapshot validity

`writeHeartbeat` returns without writing when `sdk.getSkills()` has no Hitpoints XP, or when the player position is `0,0`. Each valid snapshot includes `xp` (experience) and `levels` (client `baseLevel`). Readers must not convert `xp` to a level.

`fleet-rates.flagMaxedSkill` uses `levels` ≥ 99, case-insensitive. It does not use an OSRS XP threshold.

`CYCLE_FAILURE_CODES` (`teleport`, `portal`) are trip-cycle failures. They do not classify a bot as `repeat` / not-producing.

## `fleet-rates.ts`

- `computeRates(records, windowMs, now)`: groups records by `session`, drops invalid ones, sums non-negative deltas per session, and divides by the summed session durations. It returns `null` when the summed duration is under 10 minutes.
- `isZeroRate` is deleted. Its role moves to the verdict's `minutesSinceEffect` (see data-model.md).
- `lastEffectAt(records, events)` is new: the newest of the snapshots' `lastEffectAt`, the time of the newest valid in-session XP/coins increase, and the newest effect-kind `progress` event.
