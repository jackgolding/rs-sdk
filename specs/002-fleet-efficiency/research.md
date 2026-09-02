# Research: Fleet Efficiency and Self-Healing Operations

**Feature**: 002-fleet-efficiency | **Date**: 2026-08-29

Baseline facts were gathered from the live codebase (fleet-launchd/fleet-status/roster scripts, `sdk/activity.ts`, `sdk/grind-log.ts`, the thieving/rune-rocks/moss-giants routes, mule scripts, and `sdk/runner.ts`). Each decision below records what was chosen and why.

## R1 — How restarts happen: exit semantics first, shepherd second

**Decision**: Two complementary mechanisms.
(a) `ActivitySession` gains defined exit semantics: when a script's main loop ends because of `recovery_exhausted` (or any stop reason marked restartable), the process exits with a dedicated non-zero code (`70`, BSD `EX_SOFTWARE` region) after safe-park. The existing per-bot launchd `KeepAlive: { SuccessfulExit: false }` + `ThrottleInterval: 30` then restarts it with no new machinery.
(b) A new `fleet-shepherd.ts`, installed as a launchd `StartInterval` job (600s, same pattern as the existing 6-hour `com.rs-sdk.rotate-logs` job), handles everything KeepAlive cannot: bots whose agent was never started or was booted out, restart-cap enforcement, needs-intervention notifications, and zero-rate stalls.

**Rationale**: Research showed the plists already restart on non-zero exit — today's "idle for hours" bots exit 0 after `recovery_exhausted`, which launchd reads as success. Fixing the exit code recovers most of Story 1 with a one-line-of-behavior change per the existing supervision contract. The shepherd stays thin (classify → `launchctl`/`fleet-launchd start` → notify) instead of becoming a process manager.

**Alternatives considered**:
- *Shepherd-only (poll and restart everything)*: rejected — slower (up to one interval of idle time per failure vs ~30s via KeepAlive), and duplicates what launchd already does.
- *KeepAlive-only (no shepherd)*: rejected — cannot notify, cannot cap restarts (death-looping bot would thrash forever at 30s intervals), cannot see "agent not loaded" or "in-game but no controller" states.
- *Editor-bound `/loop` (status quo)*: rejected by spec — dies with the editor session.
- *cron*: rejected — launchd is already the repo's supervision mechanism and survives reboots with `RunAtLoad`.

## R2 — Safe-park before a restartable exit

**Decision**: `ActivitySession.stop()` for restartable reasons runs a bounded safe-park sequence before the process exits: dismiss blocking UI, decline any open trade, close bank/shop modals. Routes may register one optional `park` tactic (e.g. "deposit held loot if a bank is open/near") that runs within the same recovery budget. Park failures never block exit — worst case the bot exits where it stands.

**Rationale**: Spec FR-006. A restart into an open trade or modal fails immediately and burns the restart budget. UI-dismissal porcelain already exists (`closeUi`, `dismissBlockingUI`); this sequences it at stop time.

**Alternatives considered**: Full walk-to-bank on every exhaust — rejected: walking is exactly what often just failed; a mandatory walk turns one stall into two.

## R3 — Heartbeat storage: per-bot JSONL sidecar file

**Decision**: `ActivitySession` emits a heartbeat every 5 minutes (configurable `heartbeatMs`) to `bots/{name}/heartbeat.log` as one JSON line: `{ t, xp: {skill: totalXp…}, coins, x, z, job }`. Written through the existing bounded-append mechanism (`appendGrindLog`, 8 MiB cap → keep 4 MiB), added to `rotate-logs.ts`, and matched by the existing `*.log` gitignore rule.

**Rationale**: A separate file makes rate computation a JSON parse of a bounded tail instead of regexing free-text grind lines. At ~200 bytes/line, 5-minute cadence ≈ 57 KB/day; the 4 MiB retention keeps ~70 days of history — far beyond any report window. Reuses the write-cap and rotation rules the fleet already mandates.

**Alternatives considered**:
- *Heartbeat lines inside grind.log*: rejected — mixes machine-parsed records into a human log that routes also spam during recovery; report parsing becomes regex-fragile and rotation of noisy logs can evict heartbeats quickly.
- *SQLite or a central metrics file*: rejected — new dependency / single-writer contention across 46 processes; flat per-bot files match every existing pattern.
- *Fleet-status polling the gateway for xp*: rejected — only works while a status run happens to execute; snapshots must accumulate while nobody is looking.

## R4 — Restart cap: shepherd-owned state file

**Decision**: The shepherd maintains `~/Library/Logs/rs-sdk-fleet/shepherd-state.json`: per bot, a rolling list of observed restart events (new bun pid or new session-start heartbeat since last cycle) and notification dedupe keys. Cap: 4 automatic restarts per rolling hour (tunable). On breach: `fleet-launchd.ts stop {bot}` (boots the agent out so KeepAlive stops thrashing), mark `capped` in state, notify once. The operator (or a human-approved wake) clears it by starting the bot again; the morning report lists capped bots prominently.

**Rationale**: FR-003. Restart counting belongs to the component that can also stop the thrash (launchctl), and a small JSON file in the fleet's existing log directory needs no new conventions. Detection via pid/heartbeat change is observation-based, not log-text guessing (which the fleet rules forbid).

**Alternatives considered**:
- *Count ERROR lines in grind.log tails*: rejected — job identity/state from log text is the exact anti-pattern the roster rules banned (`inferCommand` was deleted for a reason).
- *launchd's own throttling as the cap*: rejected — ThrottleInterval only spaces restarts; it never stops them or tells anyone.

## R5 — Zero-rate stall detection and bursty jobs

**Decision**: `fleet-status.ts` gains a heuristic: a `running` bot whose last two heartbeats span ≥30 minutes with zero xp delta and zero coins delta classifies as `intervene` (reason `zero_rate`), unless its roster entry has `"bursty": true` (mules, orchestrators) — bursty bots use a 90-minute window instead of being exempt entirely. Missing/unreadable heartbeat file degrades to "no data" (no flag), per the spec's edge case.

**Rationale**: FR-009, SC-003. Position alone is a bad stall proxy (fishers legitimately stand still for hours); xp+coins deltas are the product the fleet exists to make. A longer bursty window (rather than full exemption) still catches a mule wedged overnight.

**Alternatives considered**: Per-job expected-rate thresholds — rejected for v1: needs the very data this feature starts collecting; zero-vs-nonzero is unambiguous and satisfies the success criteria.

## R6 — Trade deadlines: enforce use of what exists

**Decision**: No new timeout machinery. `bot.trade()` (60s) and `serveTrades()` (600s window / 60s per trade) already implement deadlines. The work is contract enforcement in the waiting loops: every "wait for partner" loop in the mule/route scripts must pass an explicit deadline, and on expiry the waiting side banks/holds goods safely and resumes its grind (FR-013); the mule marks missed partners and retries them next round (the `abg-food-retry-misses` orchestrator already models this — the retry list moves into the mule script's own round logic).

**Rationale**: Research showed deadlines exist at the action layer but waiting loops (`waitForTarget`-style presence polls) are where bots have historically wedged with no expiry action. Fixing the loops honors "shared porcelain over duplication" without inventing a parallel timeout system.

**Alternatives considered**: A global trade-watchdog in ActivitySession — rejected: the stall detector already arms recovery when no progress occurs; what's missing is the route-level "what to do on expiry," which is inherently route logic.

## R7 — Wilderness death handling: verify kit, cap deaths

**Decision**: Extend the existing death path in `rune-rocks.ts` / `wildy-moss-giants.ts` (both already detect respawn via `lifeId` change and continue): before walking back, verify the bank actually holds the required kit (pickaxe / bow+arrows+food); if not, `stop('cannot_regear', …)` as **non-restartable** (exit 0 → KeepAlive leaves it down, shepherd notifies). Add a per-session death cap (default 3) after which the session stops restartable-with-notification so the operator sees a pattern, not a silent grind of deaths.

**Rationale**: FR-012 and the spec's repeated-death edge case. The gap found in research was not respawn detection (works) but re-gear verification and the unbounded death count.

**Alternatives considered**: Automatic re-buy of lost kit from shops — rejected for this feature: route-specific shopping logic exists in some routes already; mandating it fleet-wide is scope creep beyond the named stall class.

## R8 — Tile-trap recoveries: named, shared, constant-driven

**Decision**: Add named recovery helpers to `bots/quests/movement.ts` — `recoverGangplank()` (wraps/extends the existing `crossGangplank`) and `recoverLeverOscillation()` — with the trap tiles (`Musa Point ship (2951,3142)`, Deserted Keep / Edgeville lever tiles from `learnings/wildy-lever.md`) promoted into `tiles.ts` constants. Routes register them as ActivitySession recovery tactics; `fleet-status.ts` replaces its hardcoded Musa coordinate with the shared constant.

**Rationale**: FR-014/FR-015. Research found lever/Musa handling duplicated route-locally while fleet-status hardcodes the same tile a third time — exactly the duplication the constitution forbids.

**Alternatives considered**: Generic "oscillation detector" (same two tiles alternating N times) — noted as a possible future tactic, but the spec names two concrete traps; ship those, keep the detector out of scope.

## R9 — Report command shape

**Decision**: `fleet-report.ts` with three views: `rates` (default; per-bot xp/hr by skill + gp/hr over `--window`, default 6h), `supply` (fleet food produced vs consumed per day, from fisher heartbeat xp→fish estimates and eat events reported in heartbeats' coin/xp context — v1 may approximate consumption from fisher output minus bank growth), and `flags` (maxed-skill reassignment candidates via level-99 detection from xp totals, zero-value output, capped/intervene bots). Reads only bounded tails of heartbeat files; completes in <30s for 46 bots.

**Rationale**: FR-008/FR-010, SC-004/SC-006. One command, machine-readable `--json` plus pretty table, mirroring `fleet-status.ts` conventions.

**Alternatives considered**: Extending `fleet-status.ts` with report flags — rejected: status is a fast classifier consumed by the shepherd every 10 minutes; the report is an operator analysis tool with different windows and output. Shared helpers live in `roster.ts`/`grind-log.ts` instead.

## R10 — Notifications

**Decision**: `osascript -e 'display notification …'` from the shepherd (the mechanism wake-fleet already documents), deduped per bot+condition via shepherd-state until the condition changes (FR-004). No new channels.

**Alternatives considered**: Email/webhook — out of scope; nothing in the spec requires off-machine delivery.

## R11 — Testing approach

**Decision**: Follow the `activity-session.test.ts` pattern: injectable `now` and `writeLog`, hand-rolled SDK mocks. New tests: heartbeat cadence and content; rate math including zero-rate/bursty/no-data branches; shepherd classification→action decisions and cap arithmetic as pure functions (extract decision logic from the CLI wrapper so it is testable without launchd); thieving per-tactic repeat bound; death re-gear verification branch. `bun run check` gates merge (constitution V).

**Alternatives considered**: End-to-end launchd tests — impractical in CI; instead quickstart.md defines the live validation runs (kill-a-bot, forced fail-loop, pinned-bot zero-rate) as operator-verifiable scenarios.
