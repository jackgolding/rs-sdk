# Feature Specification: Honest Fleet Telemetry

**Feature Branch**: `003-honest-fleet-telemetry`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "The telemetry is bad. LLMs I work with keep telling me the bots are working and they aren't, or I tell them to unstuck jobs and they won't work. Spec Kit all of the review findings: (1) 'running' only means a process exists; (2) heartbeats record empty XP at session start and only fire from the outer loop, so rates are garbage and hangs are invisible; (3) the shepherd starts capped bots and stops them in the same cycle, and its notifications go silent forever; (4) the supervisor runs the roster default, not the command the status reports; (5) recovery-exhausted restart churn is invisible; (6) log sampling and mislabelled severities defeat the log detectors; (7) process matching treats any argv mention of a name as ownership; (8) phase changes count as progress."

## User Scenarios & Testing *(mandatory)*

### Operator context

The operator runs ~45 characters, each supervised by the OS service manager, with a roster file as the source of truth for membership and default jobs. Day-to-day fleet questions ("are they working?", "unstick X") are usually delegated to an AI agent that reads the fleet status tool and acts on it. The agent repeats what the tooling says, so **every false "healthy" in the tooling becomes a false claim to the operator**.

Baseline observed on 2026-10-04 at 19:47 (local), before this feature:

- The status tool reported 36 characters running and 0 needing intervention.
- Of those 36, one character had produced no progress record or log line for 4.5 hours while walking the same loop; six more had not recorded progress for 38–47 minutes.
- Eight characters had sat idle for about 2.5 hours. Every 10 minutes the supervisor started them and stopped them again in the same cycle. The operator was not notified, because the "capped" notice had fired once, 35 days earlier, and never re-armed.
- Reported XP/hour figures were wrong by orders of magnitude (one character showed 2.8 billion Woodcutting XP/hour) because each session's first progress record contained no skills.
- Fishing characters had 150–178 recovery-exhausted stops logged each, every one followed by an automatic relaunch, none visible in the status output.
- One character was recorded as owned by a fleet-wide script because its name appeared in that script's `--except` list.

---

### User Story 1 - "Working" means producing (Priority: P1)

The operator (or their agent) asks whether the fleet is working. The answer distinguishes characters that are **producing** (an observed effect — XP, coins, inventory, bank, shop, or trade — within their job's no-effect threshold) from characters that are merely **alive** (process exists) but not producing, characters that are **churning** (repeatedly stopping and relaunching), characters the supervisor has **capped**, and characters that **need supplies or a human**. The first line of the answer is a count of producing versus not producing, so a summary cannot honestly say "all working" while any character is not producing. Each non-producing character comes with the specific check that failed (no effect for N minutes, no controller attached, N relaunches in the last hour, capped since T, last error text).

**Why this priority**: This is the direct cause of the reported problem. Agents call bots healthy because the tool calls them `running` as soon as a process exists. Fixing the verdict alone stops most false claims, even before the underlying signals are improved.

**Independent Test**: Reproduce each baseline condition on one character: a hung script with a live process; a script whose controller was pre-empted; a script that stops with recovery-exhausted every few minutes; a character the supervisor has capped. Run the status tool. Each must be classified as not producing with the correct reason, and the headline count must exclude them.

**Acceptance Scenarios**:

1. **Given** a character's process is alive but no effect (XP, coins, inventory, bank, shop, or trade) has been observed for longer than its job's no-effect threshold (15 minutes by default, overridable per bot in the roster, 90 for jobs declared bursty), **When** status runs, **Then** it is reported as alive-not-producing with minutes since its last effect, and it is not counted as producing.
2. **Given** a character's process is alive but no controller is attached for it, **When** status runs, **Then** it is reported as not producing with reason "no controller".
3. **Given** a character has been relaunched more than a bounded number of times in the last hour (default 3), **When** status runs, **Then** it is reported as churning with the relaunch count and the most recent stop reason, regardless of whether a process exists at that instant.
4. **Given** the supervisor has capped a character, **When** status runs, **Then** it is reported as capped with the time it was capped and the reason, not as restartable.
5. **Given** a character's recent log shows a repeating supply shortage (for example "no super attack in bank"), **When** status runs, **Then** it is reported as needing supplies, not as restartable.
6. **Given** a character is producing, **When** status runs, **Then** it shows its production rate over the last hour and time since last effect.
7. **Given** any character is not producing, **When** status prints its summary, **Then** the first line states "N producing, M not producing" and lists the not-producing names.

---

### User Story 2 - Progress records are trustworthy (Priority: P1)

Each running activity records progress snapshots (per-skill XP, coins, position, current phase, time of last observed progress, recovery count) on a fixed wall-clock schedule, independent of whether its main loop is cycling. A snapshot is never recorded before the character's skills are known. Rates are computed within a single session, so a restart cannot appear as a burst of XP. A character whose main loop is stuck inside a long inner loop still records snapshots, and those snapshots show the time since its last real progress growing.

**Why this priority**: Every verdict in Story 1 depends on knowing when a character last made progress. Today the only progress record is broken in ways that both hide hangs and inflate rates.

**Independent Test**: Start an activity and inspect its first snapshots: none may have an empty skill set or position `0,0`. Restart it twice in 10 minutes: the computed XP/hour must stay within the bot's real range. Block an activity inside an inner loop for 20 minutes: snapshots must keep arriving, and their time-since-progress must grow past 20 minutes.

**Acceptance Scenarios**:

1. **Given** an activity has just connected and skills are not yet populated, **When** it would record its first snapshot, **Then** it waits until skills are known, or records nothing.
2. **Given** an activity's main loop is blocked in a long inner step, **When** the snapshot interval elapses, **Then** a snapshot is still recorded, carrying the time of the last observed progress.
3. **Given** a character restarted during the reporting window, **When** rates are computed, **Then** they are computed per session and summed, and no rate exceeds what the character could actually earn.
4. **Given** a roster job that runs a long activity, **When** it runs, **Then** it records snapshots; no roster job is exempt.
5. **Given** a stored snapshot has an empty skill set (written before this feature), **When** rates or stalls are computed, **Then** that snapshot is ignored.

---

### User Story 3 - The supervisor doesn't fight itself, and it keeps you informed (Priority: P1)

When a character keeps failing after restarts, the supervisor stops restarting it, keeps it stopped until its restart budget recovers, and then starts it **once**. It does not start and stop the character in the same cycle. While a problem persists, the operator is reminded at a bounded interval instead of being told once and then never again. Notifications are keyed by the kind of problem, not by free text that changes every cycle. Every action the supervisor takes (started, restarted, capped, uncapped, skipped) is visible in the status output.

**Why this priority**: As of the baseline, eight characters (18% of the fleet) had been held down for 2.5 hours by this loop, with zero notifications. It is the largest single source of idle time, and it is invisible.

**Independent Test**: Give a character five restarts within the last hour and run supervisor cycles. It must never be started and stopped in the same cycle. When the oldest restart ages out, it must be started once and left running for at least one full cycle. Keep a condition active across cycles: a reminder must fire again after the re-notify interval.

**Acceptance Scenarios**:

1. **Given** a character is at its hourly restart bound, **When** a supervisor cycle runs, **Then** it is not started in that cycle.
2. **Given** a capped character's restart count has dropped below the bound, **When** a cycle runs, **Then** it is started once and is not stopped again by that same cycle.
3. **Given** a start is followed by an immediate stop for any reason, **When** the cycle summary is written, **Then** that character is not counted as woken.
4. **Given** a needs-intervention or capped condition persists, **When** the re-notify interval elapses (default 2 hours), **Then** the operator is notified again. When the condition clears and later recurs, **Then** it notifies again immediately.
5. **Given** the status output is produced, **When** a character was started, restarted, capped, or uncapped by the supervisor in the last hour, **Then** that history (time and action) appears on its row.

---

### User Story 4 - Restarting runs the job you were told it would run (Priority: P2)

When the status tool says a character's restart command is X, a restart through the supervisor runs X, and X is always the character's roster job. If the character is currently running, or last ran, something else, the status tool shows that as drift, so the operator or their agent can see beforehand that a restart will change the job. Ownership of a character is decided by which process actually controls it, not by whether the character's name appears anywhere in a command line. A fleet-wide script that controls many characters is reported as the owner of exactly the characters it controls, and characters it explicitly excludes are never attributed to it.

**Why this priority**: "Unstick X" fails when the restart silently reverts the character to a different job, or when the tool thinks the character is already owned by an unrelated process. This is less frequent than Stories 1–3 but causes the hardest-to-diagnose failures.

**Independent Test**: Run a character on a non-default job and stop it. Status must show which command a restart will run and where that command came from. Restart through the supervisor: the running command must equal what status showed. Start a fleet-wide script with `--except A`: status must not attribute A to it.

**Acceptance Scenarios**:

1. **Given** status reports restart command X for a character, **When** the operator restarts it through the supervisor, **Then** the process that starts runs exactly X.
2. **Given** the recorded job and the roster default differ, **When** status runs, **Then** the row shows both and flags the drift.
3. **Given** a fleet-wide process excludes a character by name, **When** status runs, **Then** that character is not reported as owned by that process.
4. **Given** a process controls a character, **When** status runs, **Then** ownership is determined by the identity the process itself recorded (process id and command), and stale records for dead processes are ignored.
5. **Given** the operator edits the roster to reassign a character, **When** that character is next restarted, **Then** it runs the new roster job.
6. **Given** a character was running a one-off (non-roster) job that has stopped, **When** status runs, **Then** it shows the one-off job as drift and the roster job as what a restart would run. The supervisor does not silently resume the one-off job.

---

### User Story 5 - A restart claim is verified (Priority: P2)

Restarting a character can be done in a verify mode that waits for real progress evidence (XP gained, a trip banked, or a progress event recorded by the activity) and reports success only then. If no progress is seen within a bounded wait (default 10 minutes), it reports failure with the last observed reason. The agent playbook for waking and unsticking characters requires verify mode before claiming a fix. A live process alone no longer counts as proof.

**Why this priority**: The current playbook tells agents to confirm a restart by seeing a process ID 20 seconds later. Startup alone (route-finding setup) takes about 12 seconds, so that check passes even for jobs that die or loop seconds afterwards.

**Independent Test**: Verify-restart a healthy character: success is reported only after a progress event, with the time taken. Verify-restart a character whose job cannot progress (missing supplies): failure is reported within the wait bound, with the reason taken from its log.

**Acceptance Scenarios**:

1. **Given** a character is restarted in verify mode, **When** progress evidence appears within the wait bound, **Then** success is reported with the evidence and time to first progress.
2. **Given** a character is restarted in verify mode, **When** no progress evidence appears within the wait bound, **Then** failure is reported with the last log reason and the command exits unsuccessfully.
3. **Given** the agent playbook for waking the fleet, **When** an agent restarts characters, **Then** the playbook directs it to use verify mode and to report only verified characters as fixed.

---

### User Story 6 - Problem signals survive logging (Priority: P3)

Failures, recoveries, stops, and progress are recorded as structured events with a type and code, separate from the human-readable log. Detectors classify from those events, so a log line's sampling, repeat counter, or wording cannot hide a loop. Warnings are recorded as warnings, not as normal log lines that start with the word "WARN". Switching between phases keeps a script's short stall timer alive, so long walks aren't interrupted, but it never resets the repeat-failure counters. Phases never count as progress in the fleet verdict.

**Why this priority**: These bugs make the existing detectors silently ineffective, but Stories 1–3 deliver most of the value without them. This story hardens the signals underneath.

**Independent Test**: Make an activity fail with the same code 100 times: a repeat-failure detector must flag it, even though the text log shows only a sampled subset. Make an activity alternate between two phases while failing with the same code: in-script recovery must arm after the repeat-failure threshold, and once its no-effect threshold passes (15 minutes by default) the fleet verdict must report it as not producing.

**Acceptance Scenarios**:

1. **Given** an activity repeats the same failure code many times, **When** detectors run, **Then** the repeat count is read from structured events, not inferred from sampled text.
2. **Given** a script reports a warning, **When** it is recorded, **Then** its severity is warning in both the text log and the event record.
3. **Given** an activity alternates phases while repeating the same failure, **When** the repeat-failure threshold is reached, **Then** recovery arms, because phase changes did not clear the failure counters.
4. **Given** an activity alternates phases with no effect for longer than its job's threshold, **When** status runs, **Then** it is reported as alive-not-producing, even though its in-script stall timer kept being refreshed.
5. **Given** structured event storage, **When** it grows, **Then** it is bounded like existing logs, and reads are bounded tail reads.

---

### Edge Cases

- **Startup time**: route-finding setup takes about 12 seconds before a script can act. Verification and churn detection must not treat a starting process as failed or as producing.
- **Bursty jobs** (mules, orchestrators) legitimately go long periods without XP. Their roster flag widens thresholds, and job-specific progress events (trade completed, trip delivered) count as progress.
- **Item-only progress**: jobs that bank items without XP (or past a maxed skill) must still register progress through inventory/bank events, not only XP/coins.
- **Mid-session reconnect**: skills can be briefly empty after a reconnect, not just at startup. No snapshot may be recorded while skills are unknown.
- **Gateway unreachable or stale**: when the game client is not publishing fresh state, the verdict is "no live state" (needs a client), never producing and never restartable.
- **Fleet-wide processes**: one process controlling many characters must not mark every named character as owned, and its exclusions must be honoured.
- **Manual play / paused**: paused characters stay paused; their status must still show whether they are producing, for the operator's information.
- **Legitimate completion**: a one-off job that finishes cleanly (exit 0) is reported as finished, not as churning or needing a restart.
- **Old data**: progress records written before this feature (empty skills, no last-progress field) must be tolerated and ignored where invalid, not crash tools.
- **Supervisor overlap**: two supervisor cycles must not overlap; a slow cycle must not cause a double start.
- **Clock and rotation**: log rotation mid-read yields "insufficient data", never a false zero-rate or a false producing verdict.

## Clarifications

### Session 2026-10-04

- Q: When a character's recorded job differs from its roster default, what does a supervisor restart run? → A: The roster job, always. Live and recorded jobs that differ are reported as drift and are not auto-restarted. This replaces the "live argv → assignment → roster" restart order in the current fleet rules.
- Q: What should the supervisor do with a character that is alive but not producing? → A: Restart it once per episode, then only notify until it is producing again (FR-016).
- Q: How do phase changes interact with in-script stall and repeat-failure detection? → A: They keep the stall timer alive but never clear the failure counters. The fleet verdict ignores phases (FR-027).
- Q: How long without any effect before a character counts as not producing? → A: 15 minutes by default, overridable per bot in the roster; bursty bots 90 (FR-002a).
- Q: Where do supervisor alerts go? → A: macOS banners only. The supervisor's history appears in status output, so any agent the operator asks reports it (FR-014, FR-015). No email or push channel.
- Q: Should slow production be flagged? → A: No. Rates are reported; judging them stays with the operator (see Assumptions).

## Requirements *(mandatory)*

### Functional Requirements

**Verdict (Story 1)**

- **FR-001**: The status tool MUST classify each character into exactly one of: producing, alive-not-producing, churning, capped, needs-supplies, needs-client (no live state or logged out), foreign-owner (controlled by a process the supervisor did not start), restartable (in-game, no process), finished, paused.
- **FR-002**: "Producing" MUST require all of: a live owning process, an attached controller, fresh game state, an observed effect (XP, coins, inventory, bank, shop, or trade) within the job's no-effect threshold, and a relaunch count under the churn bound in the last hour.
- **FR-002a**: The no-effect threshold MUST default to 15 minutes, MUST be overridable per bot in the roster, and MUST be 90 minutes for bots declared bursty unless that bot sets an override.
- **FR-003**: Every non-producing verdict MUST include the specific failed check and its measured value (for example "no effect 267m", "6 relaunches/1h, last stop recovery_exhausted").
- **FR-004**: Problem detectors (repeat failures, recovery loops, route-finding failures, supply shortages) MUST run for characters with a live process, not only for characters without one.
- **FR-005**: The status summary MUST lead with "N producing, M not producing" and list the not-producing characters with their reasons.
- **FR-006**: Relaunch counts and last exit reasons for the last hour MUST be shown for every character.

**Progress records (Story 2)**

- **FR-007**: Activities MUST record progress snapshots on a wall-clock interval (default 5 minutes) that does not depend on the main loop cycling.
- **FR-008**: Each snapshot MUST include per-skill XP, coins, position, current phase, time of last observed progress, recovery count, session id, and process id.
- **FR-009**: Snapshots MUST NOT be recorded while the character's skills are unknown.
- **FR-010**: Rates MUST be computed per session and aggregated across sessions; snapshots with empty skills MUST be ignored.
- **FR-011**: Every script referenced by the roster MUST record snapshots.

**Supervisor (Story 3)**

- **FR-012**: The supervisor MUST decide whether a start would exceed the restart bound **before** starting, and MUST NOT stop a character it started in the same cycle.
- **FR-013**: A start that is immediately undone MUST NOT be counted as a wake.
- **FR-014**: Notifications MUST be keyed by condition type, MUST re-fire after a re-notify interval (default 2 hours) while the condition persists, and MUST re-arm when the condition clears.
- **FR-015**: The supervisor MUST publish its per-character actions and cap state where the status tool reads them, and the status tool MUST show them.
- **FR-016**: For an alive-not-producing character (hung or looping), the supervisor MUST restart it at most once per episode (an episode starts when the character is first classified not producing and ends when it is next classified producing). After that one restart, the supervisor only notifies, until the episode ends. The restart also counts toward the hourly restart cap.
- **FR-016a**: The supervisor MUST NOT start, restart, or stop a character whose live owner is a process it did not start (a manual run or a fleet-wide script). It MUST report such characters with the owning command instead.
- **FR-016b**: A character whose supervised job exited cleanly with a terminal (non-restartable) stop MUST be reported as finished, with its stop reason, and MUST NOT be restarted automatically.

**Restart fidelity and ownership (Story 4)**

- **FR-017**: The command the supervisor runs for a character MUST equal the restart command the status tool reports for that character.
- **FR-018**: The status tool MUST show the recorded job and the roster default when they differ, and flag the drift.
- **FR-019**: Processes MUST record their own ownership (character, process id, command, start time). The status tool MUST determine ownership from live records only, not from substring or token matches on command lines.
- **FR-020**: A fleet-wide process MUST record ownership only for the characters it actually controls; excluded characters MUST NOT be attributed to it.
- **FR-021**: A supervisor start or restart MUST always run the character's roster job. A recorded or live job that differs from the roster MUST be reported as drift, and MUST NOT be restarted automatically once it stops. A roster edit takes effect on the character's next start or restart.

**Verification (Story 5)**

- **FR-022**: The supervisor control tool MUST offer a verify mode for start and restart. It waits for progress evidence up to a bound (default 10 minutes), reports evidence and time-to-progress on success, and exits unsuccessfully with the last reason on failure.
- **FR-023**: The wake-fleet agent playbook MUST require verify mode before reporting a character as fixed, and MUST remove "process id present after ~20 seconds" as a success criterion.

**Signals (Story 6)**

- **FR-024**: Activities MUST record structured events (progress, failure with code, recovery, stop with code) in bounded storage, alongside the text log.
- **FR-025**: Detectors MUST read repeat counts and stop reasons from structured events when present, and MUST tolerate the text log's sampling suffixes when falling back to text.
- **FR-026**: Warning-level messages MUST be recorded with warning severity.
- **FR-027**: Phase changes MAY refresh a script's in-activity stall timer, but MUST NOT reset its repeat-failure counters, and MUST NOT count as an effect in the fleet verdict.

### Key Entities

- **Progress snapshot**: periodic record of one character's session: time, session id, process id, job, per-skill XP, coins, position, phase, last-progress time, recovery count.
- **Activity event**: a structured, typed record (progress, failure, recovery, stop) with a code, phase, and position; the basis for detectors.
- **Ownership record**: what a live process says it controls: character, process id, command, start time, and source (supervised or manual).
- **Fleet verdict**: per-character classification with failed check, measured value, restart command, command source, drift flag, relaunch history, and supervisor actions.
- **Supervisor state**: per-character restart times, cap state, actions taken, and notification history keyed by condition type with last-notified time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Replaying the baseline conditions (hung process, controller pre-empted, recovery churn, capped, supplies missing, stale progress records) produces zero characters wrongly reported as producing.
- **SC-002**: A character that stops producing while its process stays alive is reported as not producing within 20 minutes (the 15-minute threshold plus one 5-minute snapshot interval; 95 for bursty jobs) in 100% of trials.
- **SC-003**: Computed XP/hour for any character, across sessions with restarts, is within 10% of the XP it actually gained divided by elapsed time; no reported rate exceeds that bound.
- **SC-004**: Over 24 hours of supervisor operation, there are zero cases of a character being started and stopped by the same cycle.
- **SC-005**: A condition that persists for 6 hours produces 3 to 4 operator notifications (initial plus re-notifies), not 1.
- **SC-006**: In 100% of supervisor restarts, the command that runs equals the restart command the status tool showed beforehand.
- **SC-007**: In 100% of verify-mode restarts, a reported success is backed by a progress event, and a job that cannot progress reports failure within the wait bound plus one minute.
- **SC-008**: In a two-week period after release, the operator does not catch an agent claiming a character was working or fixed when it had produced nothing in the previous 20 minutes.

## Assumptions

- The OS service manager remains the execution mechanism for per-character jobs and the supervisor cycle (every 10 minutes).
- The roster stays the single list of characters and default jobs. Pause list semantics are unchanged.
- Bounded storage rules for logs apply to snapshots and events: rotation caps on write, bounded tail reads, never whole-file reads.
- The game server and the gateway status endpoint are not changed by this feature. Fresh/stale state rules (8 s fresh, 2 min live) stay as defined.
- Default thresholds: no-effect threshold 15 minutes (per-bot roster override; 90 bursty); churn bound 3 relaunches/hour; restart cap 4/hour; re-notify 2 hours; verify wait 10 minutes; snapshot interval 5 minutes. All are configurable defaults, not hard requirements.
- Desktop notifications remain the only alert channel (confirmed in Clarifications). Email and phone push are out of scope.
- Out of scope: fixing the specific gameplay loops found during the review (Jackpoo1's wilderness walk loop, jackthief's missing supplies, jacklove1's route-finding failure, fishing recovery-exhausted frequency). This feature makes them visible; fixing them is separate script work.
- Out of scope: per-skill productivity targets (for example "1 shark trip per hour is too slow"). This feature reports rates; judging them is operator work.
