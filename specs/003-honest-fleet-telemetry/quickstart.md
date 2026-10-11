# Quickstart: validating Honest Fleet Telemetry

## Prerequisites

- The fleet is installed under launchd (`fleet-launchd.ts install`) and the gateway is reachable.
- Run every command from the repo root.

## 1. Unit gate

```bash
bun run check
```

The run must include the new and updated tests: activity heartbeat/events/severity/phase, fleet-rates per-session, fleet-shepherd (`canStart`, no same-cycle undo, re-notify), the verdict classifier, and ownership liveness. See tasks.md for the full list.

## 2. Verdict replay (Story 1 + 2)

```bash
bun .cursor/skills/wake-fleet/scripts/fleet-status.ts --pretty | head -1
```

Expect a headline of the form `N producing, M not producing: …`. Then check these conditions:

| Condition to create | How | Expected row |
|--------------------|-----|--------------|
| Hung process | `kill -STOP <owner pid>` on one bot for 12 min | `alive-not-producing`, `telemetry_silent` (then `kill -CONT`) |
| Loop without effect | Leave Jackpoo1 on its current wilderness loop, or any bot walking without banking for 16 min | `alive-not-producing`, `no_effect` |
| Pre-empted controller | A second control connection, then disconnect | grind exits 70 and launchd relaunches; `no_controller` only while the thief still holds the session |
| Churn | A bot that hits `recovery_exhausted` more than 3 times per hour (several fishing bots qualify today) | `churning`, with the relaunch count |
| Missing supplies | jackthief, as of today | `needs-supplies` |
| Foreign owner | `converge-and-accept-trade.ts --accept-only --except X` | X is **not** attributed to it; the accepted bots show `foreign-owner` |

Check the rates as well: no `xpPerHour` value in the JSON should exceed the bot's real XP gained in the hour. Compare with `heartbeat.log` by hand for two bots.

## 3. Shepherd (Story 3)

```bash
bun .cursor/skills/wake-fleet/scripts/fleet-shepherd.ts
tail -5 ~/Library/Logs/rs-sdk-fleet/shepherd.out.log
```

- A bot with 4 restarts in the last hour is started; a bot with 4 already plus one this cycle is not stopped in the same cycle.
- Over 3 consecutive cycles, `woke` never contains a name that is also in `capped` for the same cycle.
- A persistent condition re-banners after 2 h (simulate by editing `notified[code]` back by 2 h in `shepherd-state.json`).

## 4. Restart fidelity + verify (Story 4 + 5)

```bash
bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts restart jacklove7 --verify
```

- `restartCommand` in status equals `ps -o command= -p <new pid>` minus the bun path.
- `verified jacklove7: …` within 10 min, exit 0.
- `restart jackthief --verify` (no supplies) → `NOT verified`, failure reason printed, exit 1.

## 5. Signals (Story 6)

- `bots/<bot>/events.log` gets `start`, `progress`, `failure` (with a rising `count`), `recovery` and `stop` lines.
- green-dragons warnings appear as `WARN no super attack in bank`, not as `LOG WARN …`.

## Validation 2026-10-04

`bun run check` passed: typecheck, webclient typecheck, 476 tests, 1 skipped (`market-web` has no `server/engine/data/pack` in this checkout).

`fleet-status.ts --pretty` wall time was 2.07s before the hand-run shepherd and 2.12s immediately after.

| When | Headline |
|------|----------|
| Before `fleet-shepherd.ts` | 17 producing, 27 not producing |
| Immediately after (3.67s, `woke: jacklove19`, `capped: 0`, 6 notifications) | 21 producing, 23 not producing |
| After the two `--verify` restarts | 27 producing, 17 not producing |

The shepherd did not start bots already at 4 starts in the hour, and that cycle did not both start and stop anyone. `shepherd-state.json` has no `intervene:*` keys (46 bots; the capped flags that were already there stayed).

Live rows, without creating extra conditions: `no_effect` and `telemetry_silent` on several supervised owners, `repeat` (`low_hp`) on Jackpoo2 and Jackpoo4, Jackpoo1 `finished` / last exit 0, and the hourly-budget bots `capped`. No `foreign-owner` row. Pretty rates were fishing about 89k–138k xp/h and thieving about 553k–595k xp/h. Nothing in the billions.

`restart jacklove7 --verify` printed `verified jacklove7: Fishing +19250 xp after 8:54 (pid 90870)` and exited 0. The process command is `bun bots/quests/fishing-route.ts jacklove7 --shark`.

`restart jackthief --verify` printed `verified jackthief: progress bank after 1:16 (pid 89752)` and exited 0. The process command is `bun bots/quests/green-dragons.ts jackthief`. A bank progress counts as an effect, so this did not fail closed. After that, `events.log` shows `missing_supplies` with a rising count (`no super attack in bank`), and `grind.log` shows `WARN missing_supplies: no super attack in bank` rather than `LOG WARN`.

`bots/jacklove19/events.log` gained a `start` line from the shepherd restart (`message: shark`, new pid).
