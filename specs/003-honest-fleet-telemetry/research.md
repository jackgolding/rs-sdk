# Research: Honest Fleet Telemetry

Findings from the 2026-10-04 review of the live fleet (45 roster bots), plus the decisions they drive. Every decision below cites the observed failure it addresses.

## R1. What counts as "progress" for a verdict

**Observed**: Jackpoo1 (`magic-trees.ts`) walked the same wilderness road loop for 4.5 h. `fleet-status` called it `running` because a bun process existed, and `isZeroRate` never fired because no new heartbeat had been written since 07:22.

**Decision**: A character is producing only if an **effect** has been observed within the job's threshold. The threshold is 15 minutes by default, set per bot with the roster field `noEffectMinutes`, and 90 minutes for `bursty: true` bots without an override (clarified 2026-10-04). Effects are:

- (a) an XP or coins increase between two valid snapshots in the same session, or
- (b) an activity progress event of kind `xp`, `inventory`, `bank`, `shop`, or `trade`.

`location`, `phase` and `dialog` progress keep the in-activity stall timer alive, but they are not effects for the fleet verdict. A walking loop therefore does not count as producing.

**Rationale**: (a) does not depend on the script calling anything correctly. (b) covers item-only jobs (mules, a skill past 99) that gain no XP.

**Alternatives rejected**:
- Process liveness: the current behaviour, and the bug.
- Position change: a looping walk changes position.
- Grind-log mtime: Jackpoo3 was logging every minute while its last heartbeat was 38 minutes old, so active logging proves nothing.

## R2. Heartbeat scheduling and validity

**Observed**:
- The first heartbeat of every session had `xp: {}` and `x: 0, z: 0`. The constructor writes it before skills arrive (Jackpoo1 and Jackpoo3 raw records), which inflates `computeRates`: Woodcutting showed 2,801,739,887 XP/h.
- `maybeHeartbeat()` is called only from the outer loop. `fishing-route.ts` calls it once per trip (line 2578), so a 20–45 minute trip means 20–45 minutes without a record. `magic-trees.ts` never calls it.

**Decision**:
- `ActivitySession` owns an unref'd `setInterval` (default 5 minutes) that writes snapshots no matter what the loop is doing.
- A snapshot is skipped while skills are unknown. "Known" means the Hitpoints XP is above 0, since every account has at least 1,154 Hitpoints XP.
- The constructor no longer force-writes an unvalidated snapshot. The first valid snapshot is written as soon as skills are known, by polling once per second for up to 60 seconds and then falling back to the interval.
- `finalizeStop()` clears the timer and writes a final validated snapshot.
- `maybeHeartbeat()` stays as a no-op-compatible call, so existing callers don't break.

**Rationale**: A timer keeps firing even when the loop is blocked on a long await, which is exactly the hang case. If the event loop itself wedges, the snapshots stop. That staleness is a signal in its own right (R4).

**Alternatives rejected**:
- Adding `maybeHeartbeat()` calls in inner loops. It's whack-a-mole across 2,600-line scripts, and new scripts would miss it.
- A watchdog process per bot. It's an extra moving part, and the in-process timer already gives the same information.

## R3. Rates across restarts

**Observed**: `computeRates` takes the first and last record in the window across sessions. One empty record plus one full record a few minutes apart gives the whole account's XP divided by minutes.

**Decision**:
- Group records by `session`.
- Drop invalid records (empty skills, or position 0,0).
- In each session, take the XP and coins delta from first to last valid record, and clamp negative deltas to 0. Coins legitimately fall when a bot spends.
- Sum the session deltas and divide by the summed session durations.
- `isZeroRate` is replaced by the verdict's effect check (R1), compared against **now**, not against the last record.

**Alternatives rejected**: Capping at a "plausible max" XP/h per skill. That's a magic table, and it hides the bug instead of fixing it.

## R4. Snapshot staleness as a hang signal

**Decision**: If the newest snapshot from the live owner's pid is older than 2× the snapshot interval (10 minutes by default), the verdict is `alive-not-producing` with reason `telemetry silent Nm`. With timer-driven snapshots, silence means the process is wedged, or it is running code that never constructs an `ActivitySession`.

## R5. Ownership: who controls a character

**Observed**:
- `matchBun()` matches `bots/{name}/` or the name as a whitespace-delimited token anywhere in the argv. `converge-and-accept-trade.ts --accept-only --except jacklove4` was recorded as jacklove4's assignment.
- `pgrep` only sees processes whose command line contains `bun bots/`. MCP-server controllers and `bun -e` snippets are invisible to it.

**Decision**:
- The process that holds control records itself in `bots/{name}/assignment.json` (the file is repurposed as the ownership record) with `pid`, `argv`, `command` and `startedAt`.
- The record is written from `BotSDK.connect()` when `connectionMode === 'control'` and a `bots/{name}/` directory exists. That one place covers every grind script, every fleet-wide script (each per-bot `connect()` writes that bot's record), and MCP sessions.
- A record is live when `kill -0 pid` succeeds and `ps -o command= -p pid` still contains the recorded script path, which guards against pid reuse.
- **Supervised** is computed, not stored: the owner is supervised when its pid equals the pid in `launchctl print gui/$UID/com.rs-sdk.bot.{name}`. No plist change is needed, and it is correct for processes started before this feature.
- **Fallback owner**: when there is no live record but the bot's launchd agent has a pid, that pid is the owner (supervised; command taken from the agent's program arguments; `legacy: true`). This covers grind processes started before this feature, which never wrote a record and won't until they reconnect.
- `pgrep` stays only to list unowned `bun bots/` processes, for operator visibility. It is never used to decide ownership.

**Rationale**:
- Last controller wins at the gateway, and the newest `connect()` overwrites the file, so the record matches gateway semantics.
- Excluded bots are never connected, so they are never recorded.

**Alternatives rejected**:
- Sending pid/argv in the gateway handshake and exposing it from `/status`. That's ground truth, but it needs a redeploy of the remote gateway (`rs-sdk-demo.fly.dev`), and the spec assumes the gateway is unchanged.
- Per-script ownership calls. About 60 quest scripts create `BotSDK` directly.

**Check**: `sdk/index.ts` has no `fs` import today. The lite runner (`server/webclient/src/lite/runner.ts`) does not instantiate `BotSDK`. The write lives in `sdk/assignment.ts` (which already imports `fs`) and is called from `connect()`. `connect()` already runs only under Bun/Node.

## R6. Restart command source

**Clarified** (spec, Session 2026-10-04): the roster always wins.

**Decision**:
- `fleet-status` reports `restartCommand` as the roster command.
- When a live or recorded owner's command differs, it reports `drift: { owner: <command>, supervised: bool }`.
- `fleet-launchd` already writes plists from the roster. It must stop calling `writeAssignment(..., 'launchd')`, because the live process records itself on connect.
- `resolveCommand()` and its `live → assignment → roster` order are deleted.
- These rules and docs must change to match:
  - `.cursor/rules/fleet-roster.mdc`
  - `.cursor/rules/wake-fleet-scripts.mdc`
  - `.cursor/skills/wake-fleet/SKILL.md` ("How the restart command is chosen")
  - the Fleet paragraph in `AGENTS.md` and `CLAUDE.md`

## R7. Relaunch churn

**Observed**:
- Fishing bots log 150–178 `recovery_exhausted` stops each. Every one exits with code 70, and launchd relaunches it about 30 seconds later.
- jacklove10 showed `runs = 4` and `last exit code = 70` in `launchctl print`, yet `fleet-status` called it `running`.

**Decision**:
- Read `runs`, `last exit code` and `state` from `launchctl print gui/$UID/com.rs-sdk.bot.{name}`. That's one spawn per bot per status call, about 10 ms each, so roughly 0.5 seconds for 45 bots.
- The shepherd appends `{t, runs}` samples to its state every cycle, keeping 2 hours.
- `fleet-status` computes relaunches in the last hour as the current `runs` minus the oldest sample at least 60 minutes old. If no sample is that old, it uses the oldest sample available and flags `window < 1h`.
- It also counts `stop` events in the last hour (R9), as a cross-check and for the stop reasons.
- Churning means more than 3 relaunches per hour (configurable).

**Alternatives rejected**: Counting only `stop` events. That misses crashes during the roughly 12-second pathfinding startup, before any session exists.

## R8. Shepherd start-then-kill loop

**Observed**: `shepherd.out.log` printed `woke=8 capped=8 notified=0` every cycle. In `shepherd-state.json`, each of the 8 bots had restarts at `[52, 42, 32, 12, 2]` minutes ago. The sequence in `runShepherdCycle` was:

1. `expireCap` uncaps the bot, because there are 4 restarts in the window, which is not more than 4.
2. The `wake` branch starts it.
3. `recordRestart` makes it 5.
4. `shouldCap` returns true, so `launchdStop` runs, all within the same cycle.

**Decision**:
- Add `canStart(state, name, now)`, which is true only when `pruned.length + 1 <= MAX_RESTARTS_PER_HOUR`.
- `wake` and `restart` branches check it before acting. If it's false, mark the bot capped and leave it stopped. Never stop a bot this cycle started.
- `woke` counts only starts that survived the cycle.
- The cap expires when `canStart` becomes true again. At that point the bot gets one start.

## R9. Notifications

**Observed**: Keys were `intervene:${reason}`, and the reason contains varying numbers (`stale (11s old`). `shouldNotify` returns false forever once a key exists. Jackpoo5's `capped` key was 844 hours old: one notification, then silence.

**Decision**:
- Key notifications on the verdict kind plus a stable code (`capped`, `not_producing`, `churning`, `needs_supplies`, `needs_client`, `finished`, `foreign_owner`).
- Re-notify while the condition persists every `RENOTIFY_MS` (2 h).
- Delete the key on any cycle where the condition is absent, so a recurrence alerts immediately.
- Batch notifications into one banner per cycle, as today.

## R10. Structured activity events

**Decision**:
- `ActivitySession` appends JSONL to `bots/{name}/events.log`, bounded via `appendGrindLog`. The `.log` suffix keeps it inside the existing gitignore rule.
- Event types:
  - `start` — pid, job, argv
  - `progress` — kind, detail; only for effect kinds plus `location`, and throttled to one per kind per 30 s
  - `failure` — code, message, count
  - `recovery` — tactic, n
  - `stop` — code, restartable, phase, x, z
- Failures are **counted, not sampled**: each failure event carries the running count for its code.
- `rotate-logs.ts` adds `events.log`.

**Detectors**: The repeat and supply-shortage detectors read `failure` events by code. The text fallback strips `(×N)` suffixes before comparing lines, which fixes `repeatHeavy` for older logs.

**Supply shortage**: The failure codes `missing_supplies` and `setup_gear` mark it. The text fallback regex is `/no .+ in (bank|inventory)|Cannot restock|out of (food|supplies)/i`.

## R11. Severity and phase semantics

**Observed**:
- `green-dragons.ts` calls its `log()` wrapper with `'WARN no super attack in bank'`, which is written at `LOG` level. The grind line reads `LOG WARN … (×120)`.
- `setPhase()` calls `noteProgress('phase')`. That resets the stall timer and clears `failureTimes`, so phase ping-pong defeats recovery.

**Decision**:
- `ActivitySession.log('log', msg)` upgrades to `warn` when `msg` starts with `WARN ` (and to `error` for `ERROR `), stripping the prefix. That's shared porcelain, so every script benefits. `green-dragons.ts` is also fixed at the source.
- **Clarified 2026-10-04**: `setPhase()` still refreshes `lastProgressAt` (the in-activity stall timer), but it no longer clears `failureTimes`, resets the recovery counters, or touches `lastEffectAt`. Only `noteProgress()` of a non-phase kind exits an in-progress recovery and clears failures.
- The fleet verdict ignores phases entirely (R1), so phase ping-pong without effects shows up as `alive-not-producing` once the no-effect threshold passes.

**Rejected**: Making phases count for nothing at all. With the default 120 s `stallMs`, that would fire recoveries mid-walk on routes that only call `setPhase` before a long `walkTo`, unless every route was audited, causing a burst of restart churn.

## R12. Verify mode

**Decision**: `fleet-launchd.ts start|restart <name> --verify [--timeout 10m]`:

1. Record `t0` and the pre-restart owner pid.
2. Start or restart through launchd.
3. Every 15 s, tail `events.log` and `heartbeat.log` with bounded reads.
4. Succeed on the first `progress` event of an effect kind, or a valid-snapshot XP or coins increase, from a pid other than the old one with `t > t0`. Print the evidence and the time to first progress.
5. Fail early on a `stop` event from the new pid. Otherwise fail at the timeout, printing the last `failure` or `stop` reason and the last 5 grind lines.
6. Exit code: 0 on success, 1 on failure.

Running verify from a Cursor shell is safe: it only reads files, and launchd owns the bot process.

## R13. Finished vs restartable

**Decision**:
- `finished` means: the launchd agent is loaded, has no pid, its last exit code is 0, and the last `stop` event is non-restartable (or there is no stop event and exit is 0).
- `restartable` means: in-game, no owner, and either no agent or an agent whose last exit was non-zero.
- The shepherd starts `restartable` bots and leaves `finished` bots alone, notifying once per occurrence under the `finished` key.
- The current behaviour of kickstarting any loaded-with-exit-0 agent is removed.
