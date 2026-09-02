# Feature Specification: Fleet Efficiency and Self-Healing Operations

**Feature Branch**: `002-fleet-efficiency`

**Created**: 2026-08-29

**Status**: Draft

**Input**: User description: "Make the bot fleet more efficient. Recurring problems from operations history: bots that hit recovery_exhausted sit idle for hours until a human runs a wake pass; the shepherd loop only exists while the operator's editor is open; there is no xp/hr / gp/hr telemetry so 'alive but stalled' bots go unnoticed; the same stall classes recur (pickpocket recovery loops on the 19-bot thieving squad, wilderness death hangs on rune-rock and moss-giant routes, trade/mule deadlocks, known tile traps). Fleet goals: jackthief maxes and unlocks endgame quests, stockpile semi-renewable competitive resources (rune ore), and build an army capable of group PvP in the wilderness — reallocation decisions need real rate data."

## User Scenarios & Testing *(mandatory)*

### Operator monitoring context

The fleet is 40+ characters supervised per-bot by the operating system's service manager, with a roster file as the single source of truth for who exists and what they run by default. The operator is frequently away (asleep, at work). Today, a stopped script stays stopped until a human or an editor-bound loop notices. These stories remove the human from that loop.

---

### User Story 1 - The fleet heals itself overnight (Priority: P1)

The operator goes to bed with the fleet running. During the night several scripts stop — some exhaust their recovery budget, some crash, some finish a one-off job. Each affected character is put back to work on its recorded job within minutes, without any human action. In the morning the operator sees a fleet that is still working, plus a short record of what was restarted and why. Characters that a restart cannot help (logged out, frozen client, repeated immediate failure) are surfaced as needing intervention instead of being blindly restarted forever.

**Why this priority**: Operations history shows idle time is the dominant efficiency loss — whole squads have sat idle for 4+ hours after morning failures, and on any given afternoon ~20% of the fleet has been found idle. No per-script improvement comes close to recovering that much lost production.

**Independent Test**: Stop a running bot's script manually. Within one shepherd cycle (≤10 minutes) the character is working its recorded job again with no human action. Separately: force a bot to fail immediately after each restart and confirm it is restarted only a bounded number of times before being flagged for intervention with a notification.

**Acceptance Scenarios**:

1. **Given** a character is in-game with no controlling script, **When** the next shepherd cycle runs, **Then** the character is restarted onto its recorded job (live assignment first, roster default as fallback) within 10 minutes.
2. **Given** a restarted character fails again immediately (dies, exhausts recovery) more than a bounded number of times per hour, **When** the limit is reached, **Then** restarts pause for that character and the operator is notified with the character name, location, and reason.
3. **Given** a character's client is logged out or frozen (stale state), **When** the shepherd classifies it, **Then** it is reported as needing intervention and is not restarted in a loop.
4. **Given** a character already has a live controller, **When** the shepherd runs, **Then** that character is left alone — the shepherd never creates a second controller.
5. **Given** a character is on the operator's pause list, **When** the shepherd runs, **Then** that character is skipped silently.
6. **Given** the operator's editor is closed and the machine is running, **When** scripts stop overnight, **Then** shepherd cycles still happen (the shepherd's lifetime is independent of any editor or chat session).
7. **Given** an activity stops because its recovery budget is exhausted, **When** it stops, **Then** the character is first moved to a safe, restartable situation (goods banked or held safely, no open trade or window) so the subsequent automatic restart can succeed.

---

### User Story 2 - The operator sees production rates at a glance (Priority: P2)

The operator runs one command and sees, for every character, its production rate (experience per hour by skill, coins per hour) over a chosen recent window, computed from periodically recorded progress snapshots. Characters that are "running" but producing nothing are flagged automatically — both in the report and by the shepherd, which treats sustained zero output as a stall even when the process looks healthy.

**Why this priority**: Every efficiency review so far has been hand-computed by diffing snapshots in chat. Without rates there is no way to detect silent stalls, compare jobs, or make the reallocation decisions the fleet goals require. Depends on nothing in Story 1, but Story 4 depends on it.

**Independent Test**: Let the fleet run for an hour, run the report command, and verify each active character shows a plausible non-zero rate. Then pin one character in place (no production) while its script keeps running and verify it is flagged as zero-rate within 30 minutes.

**Acceptance Scenarios**:

1. **Given** a character is running a grind, **When** progress snapshots are recorded, **Then** each snapshot captures enough state (per-skill experience, coins, position, timestamp) to compute rates later, and the record's storage is bounded (rotation-safe, no unbounded file growth).
2. **Given** snapshots exist, **When** the operator runs the report, **Then** they see per-character experience/hour and coins/hour over the requested window in one command, without reading any raw logs.
3. **Given** a character's script is alive but the character has produced nothing for 30 minutes, **When** the shepherd or report evaluates it, **Then** the character is flagged as stalled rather than counted as healthy.
4. **Given** a character has reached the maximum level in the skill its job trains, **When** the report runs, **Then** the character is flagged as a reassignment candidate.

---

### User Story 3 - Known stall classes recover instead of dying (Priority: P3)

The recurring failure patterns from operations history stop killing sessions. A thief whose pickpocketing keeps failing escalates (bank, eat, return) instead of repeating one tactic dozens of times. A character that dies in the wilderness detects the respawn, re-equips from the bank, and resumes — up to a bounded number of deaths per session. A character waiting on a trade partner gives up after a deadline, banks its goods, and resumes its grind; the mule side retries missed partners on its next round. Characters no longer wedge permanently on the known tile traps (island gangplank, bank/wilderness-lever oscillation).

**Why this priority**: These four classes account for most intervention flags in operations history — two of the 19 thieves were stuck in 20–40x recovery repeats at the time of writing, and the rune-rock miner has died-then-hung on three separate days. Fixing them multiplies the value of Story 1 (fewer restarts needed at all) but requires Story 1's safety net to be worthwhile on its own.

**Independent Test**: Each class is testable alone: observe a thief surviving a forced pickpocket failure streak by escalating; force a wilderness death and observe re-gear and resume; hold back a trade partner and observe the waiting character bank and resume at the deadline; route a character through each known trap tile and observe it exit.

**Acceptance Scenarios**:

1. **Given** a thief's pickpocket attempts keep failing, **When** the same recovery tactic has been tried a small bounded number of times, **Then** the activity escalates to a different tactic (heal, bank, relocate, return) instead of repeating the identical one 20+ times.
2. **Given** a character dies in the wilderness during a resource run, **When** it respawns, **Then** it re-equips from its bank and returns to the route, and after a bounded number of deaths in one session it stops safely with a clear reason.
3. **Given** a character is waiting for a trade partner, **When** a deadline passes without the trade, **Then** it safely stores its goods and resumes productive work, and the counterparty is retried in a later round rather than lost.
4. **Given** a character enters a known trap situation (island gangplank, bank/lever oscillation), **When** the trap pattern is detected, **Then** a named recovery gets it moving again and the event is visible as a warning, not an endless identical log line.

---

### User Story 4 - Reallocation decisions come from data (Priority: P4)

Using the rate report, the operator answers: how much food does the fleet consume versus how much the fishing squad produces, which characters are training already-maxed skills, and which jobs yield the most toward the fleet goals (endgame quest unlocks, rune ore stockpile, wilderness-capable army). The operator then reassigns characters by editing the roster only, and can verify a week later — from the same report — that fleet-wide production went up.

**Why this priority**: This is the payoff of the program, but it is an operator decision loop on top of Story 2's data; it ships last and has no automation of its own beyond report views.

**Independent Test**: Run the report's supply/demand view after several days of snapshots; verify it states fleet food consumption vs production per day and lists reassignment candidates. Make one roster reassignment and verify the affected character's new job appears in the next report window.

**Acceptance Scenarios**:

1. **Given** several days of snapshots, **When** the operator runs the supply/demand view, **Then** food produced and food consumed per day are both reported, with the surplus or deficit explicit.
2. **Given** reassignment candidates exist (maxed skill, zero-value output, surplus role), **When** the report runs, **Then** they are listed with the reason.
3. **Given** the operator edits the roster to reassign a character, **When** the character is next restarted, **Then** it runs the new job with no other file edits required.

---

### Edge Cases

- Two shepherd cycles overlap (previous one slow): the second must not double-start a character or fight the first.
- A character gains a controller between classification and restart: the restart must be skipped (never steal a live bot).
- The restart cap is hit while the operator is asleep: the character stays paused-with-notification; the next morning's report must make it obvious.
- Snapshot recording breaks (disk full, log rotated mid-read): rate report degrades to "no data" for that character rather than reporting a false zero-rate stall.
- A character legitimately produces nothing for a while (mule in transit, quest cutscene): zero-rate flagging must tolerate job types whose output is bursty, or the operator will learn to ignore the flag.
- Death in the wilderness with the bank kit also lost (repeated deaths): re-gear must verify the kit exists before walking back, and stop safely when it cannot re-gear.
- The whole machine reboots: supervisors and the shepherd must come back without a human.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST periodically classify every rostered character as running, restartable, needs-intervention, or paused, on a schedule that continues when no editor or chat session is open.
- **FR-002**: The system MUST automatically restart every restartable character onto its recorded job (most-trusted source first: live command, recorded assignment, roster default) within 10 minutes of it becoming restartable.
- **FR-003**: The system MUST bound automatic restarts per character per hour; past the bound it MUST stop restarting and notify the operator with character, location, and reason.
- **FR-004**: The system MUST notify the operator (desktop notification) when any character is classified needs-intervention, at most once per character per condition until it changes.
- **FR-005**: The system MUST never start a second controller for a character that has a live one, and MUST honor the operator's pause list.
- **FR-006**: When an activity stops due to exhausted recovery, it MUST leave the character in a restartable situation: no open trade, window, or held state that would make an automatic restart fail, with goods banked or safely held.
- **FR-007**: Every long-running activity MUST record progress snapshots (per-skill experience, coins, position, timestamp) at a fixed interval, stored with bounded growth.
- **FR-008**: The system MUST provide a single command that reports per-character experience/hour and coins/hour over an operator-chosen window, computed from snapshots.
- **FR-009**: The system MUST flag a character whose script is alive but whose snapshots show no production for 30 minutes, excluding job types declared bursty.
- **FR-010**: The report MUST flag reassignment candidates: characters training a maxed skill, and roles whose aggregate output exceeds fleet demand (starting with food supply vs consumption).
- **FR-011**: Pickpocketing recovery MUST escalate through distinct tactics with a small per-tactic bound; the identical tactic MUST NOT repeat more than that bound consecutively.
- **FR-012**: Wilderness resource routes MUST handle death: detect respawn, re-equip from the bank after verifying the kit exists, resume the route, and stop safely with a clear reason after a bounded number of deaths per session.
- **FR-013**: Any activity waiting on a trade partner MUST enforce a deadline, after which it stores its goods safely and resumes productive work; the mule side MUST retry missed partners in a later round.
- **FR-014**: The known trap situations (island gangplank, bank/wilderness-lever oscillation) MUST have named, shared recoveries visible as warnings when triggered.
- **FR-015**: All shared behavior above (snapshots, escalation, death handling, trade deadlines, trap recoveries) MUST live in shared modules used by all affected characters, not per-character copies.

### Key Entities

- **Roster entry**: A character plus its default job; the single source of truth for fleet membership and defaults.
- **Recorded assignment**: The job a character was last actually running; preferred over the roster default at restart.
- **Progress snapshot**: A timestamped record of a character's per-skill experience, coins, and position; the raw material for all rate reporting.
- **Fleet classification**: The periodic verdict per character (running / restartable / needs-intervention / paused) with a reason and the command that would restart it.
- **Restart budget**: The per-character bound on automatic restarts per hour, with its exhaustion state and notification record.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Over any 24-hour unattended period, fleet idle time (characters in-game with no controller, excluding paused and needs-intervention) is under 5%, with zero manual wake passes.
- **SC-002**: A character whose script stops is back on its job within 10 minutes, measured from process exit to first new progress evidence, in at least 95% of cases where a restart can help.
- **SC-003**: A silent stall (running script, no production) is flagged within 30 minutes of production ceasing.
- **SC-004**: The operator obtains fleet-wide production rates with one command in under 30 seconds, replacing manual snapshot diffing.
- **SC-005**: Over a 7-day window after Story 3 ships, none of the four named stall classes (pickpocket repeat, wilderness death hang, trade deadlock, known tile traps) appears as a needs-intervention reason.
- **SC-006**: The operator can state fleet food surplus/deficit per day from the report and has reassigned the fishing squad accordingly, with fleet-wide coins/hour and experience/hour visibly higher than the pre-program baseline captured in week one.

## Assumptions

- The host machine stays powered on and logged in; per-character supervision via the OS service manager (already in place) remains the execution mechanism, and the shepherd runs under the same manager.
- `bots/roster.json` remains the single source of truth for fleet membership and default jobs; reassignment is a roster edit plus supervisor refresh, per existing fleet rules.
- The bounded-recovery semantics from feature 001 (autonomous activity recovery) stay in force; this feature adds the layer above it (what happens after an activity stops) and widens tactic coverage, it does not replace 001's in-activity recovery.
- Grind-log growth limits and bounded tail reads (existing rules) apply to snapshot storage and report reads.
- Operational work driven by this feature — jackthief's quest sequencing toward endgame unlocks, choosing which characters mine rune ore, PvP squad training rotations — is out of scope here: those are roster/ops decisions and per-goal scripts that consume this feature's data, not part of the supervision/telemetry system itself.
- A group-PvP squad-coordination capability (rally, target-calling) is a separate future feature; this spec only ensures the army-building prerequisites (uptime, rates, combat-training stall fixes) are in place.
- Restart notification uses the desktop notification mechanism already used by the wake-fleet skill; no new notification channel is introduced.
