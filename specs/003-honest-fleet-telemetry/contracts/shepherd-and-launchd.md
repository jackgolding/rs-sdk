# Contract: shepherd cycle and `fleet-launchd`

## Shepherd cycle (`fleet-shepherd.ts`, every 10 min)

```text
lock → load state (drop legacy "intervene:*" keys) → sample launchd runs for every bot
     → classify (fleet-status JSON) → for each bot:
         paused                 → nothing
         restartable            → canStart ? start : cap
         capped                 → canStart ? start (once), uncap : nothing
         alive-not-producing    → supervised owner && canStart && not yet restarted for this episode
                                    ? restart : nothing
         churning               → nothing (launchd already relaunching)
         foreign-owner          → nothing (action "skip-foreign")
         finished               → nothing (action "skip-finished")
         needs-client/supplies  → nothing
       → notifications (stable codes, re-notify 2h, clear on absence)
→ save state → one banner → release lock
```

### Invariants

1. **No same-cycle undo.** A bot started or restarted in a cycle is never stopped in that cycle. A bot is stopped only to enforce a cap, and only when this cycle did not start it.
2. **Cap check before start.** `canStart(state, name, now) := pruneRestarts(restarts, now).length + 1 <= MAX_RESTARTS_PER_HOUR`.
3. **`woke` is honest.** The cycle summary's `woke` lists only bots whose start survived the cycle.
4. **Never act on foreign owners.** If a live owner has `supervised = false`, the shepherd does not start, restart, or stop that bot.
5. **Episode restart.** For one alive-not-producing episode (from first detection until the bot is producing again), the shepherd restarts the bot at most once. After that it only notifies `not_producing`.

### Notification codes

`capped`, `not_producing`, `churning`, `needs_supplies`, `needs_client`, `foreign_owner`, `finished`.

`RENOTIFY_MS = 2h`. A key is deleted on the first cycle where its condition is absent.

## `fleet-launchd.ts`

| Command | Change |
|---------|--------|
| `install`, `restart`, `start` | `recordAssignment()` is removed (ownership is written by the process on connect; supervision is the launchd-pid match). The plist format is unchanged. |
| `start <name>` | No longer kickstarts an agent that is loaded with last exit 0 (that's `finished`). Pass `--force` to kickstart anyway. |
| `status [name]` | Prints `runs` and `last exit` as well as state and pid (it already parses them). |
| `start\|restart <name> --verify [--timeout 10m]` | **New.** See below. |

### `--verify`

1. `t0 = now`. `oldPid` = the live owner pid, or null.
2. Run the normal start or restart.
3. Poll every 15 s until the timeout (default 10 min):
   - **Success** on a `progress` event of an effect kind, or a valid-snapshot XP/coins increase, from `pid != oldPid` with `t > t0`. Print `verified <name>: <evidence> after <mm:ss> (pid N)` and exit 0.
   - **Failure** on a `stop` event from the new pid. Print the code and message, then the last 5 grind lines, and exit 1.
4. On timeout, print `NOT verified <name> after <timeout>`, the newest `failure` or `stop`, and the last 5 grind lines, then exit 1.

With several names (`restart --verify A B C`), the bots are verified concurrently and the command exits 1 if any fails.
