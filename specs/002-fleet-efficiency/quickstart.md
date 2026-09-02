# Quickstart: Validating Fleet Efficiency and Self-Healing Operations

**Feature**: 002-fleet-efficiency

Runnable scenarios proving each user story end-to-end. Contracts: [activity-session-extensions](contracts/activity-session-extensions.md), [shepherd](contracts/shepherd.md), [heartbeat-and-report](contracts/heartbeat-and-report.md). Data shapes: [data-model.md](data-model.md).

## Prerequisites

- Fleet installed under launchd: `bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts install` (now also installs `com.rs-sdk.fleet-shepherd`).
- At least a few bots running their roster jobs; `bun run check` green.

## S1 — Restartable exit → automatic restart (Story 1, KeepAlive path)

1. Pick a running bot (e.g. an ABGARMY thief). Note its bun pid from `fleet-status.ts --pretty`.
2. Simulate exhaustion: kill the process abnormally (`kill -9 <pid>`) — or wait for a real `recovery_exhausted`, which now exits 70.
3. **Expected**: within ~1 minute launchd restarts it; `fleet-status.ts` shows a new bun pid, same `command`; the bot's `heartbeat.log` shows a new `session` value; character resumes producing (xp delta on next heartbeat).

## S2 — Idle bot → shepherd start within one cycle (Story 1, shepherd path)

1. Stop a bot's agent entirely: `fleet-launchd.ts stop <bot>` — then manually re-enable it as a "forgotten" bot by loading the agent without starting the job (or simply wait with agent stopped and start it back with `fleet-launchd.ts install` minus that bot running).
2. Wait ≤10 minutes (one `StartInterval`).
3. **Expected**: shepherd cycle log (`~/Library/Logs/rs-sdk-fleet/shepherd.out.log`) records the wake; the bot is running its recorded job. A bot in `skip-bots.txt` is never touched.

## S3 — Death-loop → restart cap + notification (Story 1, bounded)

1. Force repeated immediate failure (e.g. temporarily rename the required kit in a test bot's bank so re-gear verification fails restartably, or use a disposable bot whose script exits 70 in a loop).
2. **Expected**: after 4 observed restarts within an hour, the shepherd stops the agent, `shepherd-state.json` marks it `capped`, exactly one macOS banner fires naming bot + reason. No further restarts occur until `fleet-launchd.ts start <bot>` is run manually, which clears the cap.

## S4 — Heartbeats and rates (Story 2)

1. Let the fleet run ≥1 hour.
2. `bun .cursor/skills/wake-fleet/scripts/fleet-report.ts` (and `--json`).
3. **Expected**: every active bot shows plausible non-zero xp/hr for its trained skill; command completes <30s; `bots/*/heartbeat.log` files exist, are JSONL, and stay under the size cap (verify with the rotate job or `ls -la`).

## S5 — Zero-rate stall flagged ≤30 min (Story 2)

1. Pin one bot: attach its script but block production (e.g. stand it in a safe empty area on a looping walk, or stub its action in a test copy).
2. **Expected**: within 30 minutes `fleet-status.ts` classifies it `intervene` / `zero_rate`; shepherd notifies once. A `bursty: true` roster bot in the same condition is not flagged before 90 minutes. A bot with a deleted heartbeat file reports `no data` and is not flagged.

## S6 — Stall classes (Story 3, one check per class)

- **Pickpocket escalation**: watch a thief through a forced failure streak (low HP near a baker). Grind log shows tactic names advancing, no tactic exceeding its `maxConsecutive` (`×N` never exceeds the bound consecutively for one tactic).
- **Wilderness death**: let the rune-rocks bot die once with kit banked → it re-gears and returns; empty the banked kit → it stops `cannot_regear` (exit 0) and the shepherd notifies rather than restart-looping. Third death in one session → restartable stop + notification.
- **Trade deadline**: hold the mule back during a food round. The waiting bot banks its goods and resumes its grind at the deadline; the mule's next round retries the missed partner.
- **Tile traps**: route a test bot across the Musa Point gangplank and the Edgeville lever path. Any wedge triggers the named recovery (warn-level log line with the tactic name), and the bot proceeds.

## S7 — Reallocation views (Story 4)

1. After ≥3 days of heartbeats: `fleet-report.ts supply` and `fleet-report.ts flags`.
2. **Expected**: supply view states food produced vs consumed per day with explicit surplus/deficit; flags view lists maxed-skill and zero-value candidates with reasons. Reassign one bot in `bots/roster.json`, `fleet-launchd.ts restart <bot>`, and confirm the new job appears in the next report window.

## S8 — Whole-machine reboot (edge case)

Reboot the host. **Expected**: bot agents and the shepherd return via `RunAtLoad`; no manual action; first shepherd cycle after boot wakes anything that didn't come back.

## Regression gate

`bun run check` — typecheck, webclient typecheck, and the new unit suites (heartbeat cadence, rate math, shepherd decisions, tactic bound, re-gear branch) must pass. SC-001's <5% idle over 24h unattended is measured from heartbeat gaps via `fleet-report.ts --window 24h` the morning after S1–S5 are complete.
