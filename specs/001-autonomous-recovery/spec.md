# Feature Specification: Autonomous Activity Recovery

**Feature Branch**: `001-autonomous-recovery`

**Created**: 2026-08-22

**Status**: Approved

**Input**: User description: "Bots detect when they are stuck, recover within a bounded budget, and complete the flax-to-bowstring loop without a human restarting scripts or clicking through confused bank and craft windows." Signed off 2026-08-22 with User Story 1b (essence trip) and Ghostty color monitoring.

## User Scenarios & Testing *(mandatory)*

### Operator monitoring (applies to every live independent test)

The operator watches the existing Ghostty fleet window (one pane per character, tails that character's grind log). They MUST NOT have to read every line to know whether to intervene.

| Level | When it is used | How it must look |
|-------|-----------------|------------------|
| **log** | Routine progress (phase, trip complete, items banked) | Default / quiet color. Not attention-grabbing. |
| **warn** | Recovery in progress, or a repeated failure still inside the recovery budget | Distinct warning color (for example yellow). Glanceable: "this pane is struggling." |
| **error** | Activity stopped, disconnect, or a condition a human must fix | Distinct error color (for example red). This is the only level that means "look at me now." |

Independent tests below are passed by watching those panes, not by attaching a debugger.

---

### User Story 1 - Survive a flax trip without babysitting (Priority: P1)

An operator starts the crafter on the Seers flax loop: pick a full inventory of flax, spin it at the spinning wheel, bank the bowstrings, repeat. When the character is standing on a plant that just disappeared, is on the wrong floor of the wheel house, has a craft window open instead of the bank, or cannot open the bank because another window is in the way, the activity recovers by itself and finishes the trip.

**Why this priority**: This is the stall that already forces human restarts. If one production loop can run unattended, the same recovery rules can later cover other skills.

**Independent Test**: Run the flax-spin-bank loop from an empty inventory at the Seers flax field. Watch Jackpoo1's Ghostty pane. Inject or wait for the known stalls (wrong floor, craft window vs bank, standing on a picked plant). The trip still completes with bowstrings in the bank. The pane stays **log** while healthy, goes **warn** during recovery, and only goes **error** if the activity stops. No human restart.

**Acceptance Scenarios**:

1. **Given** the crafter is in the flax field with empty inventory, **When** the loop runs a trip, **Then** it picks flax until the bag is full, spins it, and deposits bowstrings at the Seers bank.
2. **Given** the crafter is standing on a tile that is no longer walkable after picking, **When** it next tries to move, **Then** it steps to a nearby walkable tile and continues instead of reporting that no path exists.
3. **Given** a spinning-wheel or "make item" window is open, **When** the activity tries to open the bank, **Then** it closes that window first and opens the bank window specifically, not the craft window.
4. **Given** the crafter is on the ground floor of the wheel house or cannot reach the wheel, **When** spinning is required, **Then** it uses the stairs or door, reaches the wheel, and spins without an infinite retry log.
5. **Given** the same failure (cannot open bank, cannot reach wheel) has already happened several times in a short window, **When** recovery is still possible, **Then** it changes tactic (close windows, re-walk, climb, wait) instead of immediately repeating the identical click. The fleet pane shows **warn**, not a flood of identical **log** lines.

---

### User Story 1b - Survive an essence trip without babysitting (Priority: P1)

An operator starts the miner (Jackpoo2) on the rune-essence loop after Rune Mysteries is already complete: teleport from Aubury into the essence mine, fill the bag with rune essence, leave through the portal, bank at Varrock east, repeat. When teleport does nothing, the shop opens instead of the mine, the portal is missed, rocks are not in view after a random landing, or Varrock east bank will not open, the activity recovers by itself and finishes the trip.

**Why this priority**: Same recovery rules as flax, second live production loop. Jackpoo2 already hits "teleport did nothing" and "Varrock east bank open failed" spam. If recovery only works for spinning wheels, it is not shared porcelain.

**Independent Test**: Run the essence loop from Varrock (pickaxe equipped, Rune Mysteries done). Watch Jackpoo2's Ghostty pane. Inject or wait for failed teleport, shop-instead-of-teleport, missed portal, or bank-open failure. The trip still deposits a full bag of essence. Pane is **log** / **warn** / **error** as in Operator monitoring. No human restart.

**Acceptance Scenarios**:

1. **Given** the miner is outside Aubury's shop with a pickaxe and empty essence slots, **When** the loop runs a trip, **Then** it teleports into the essence mine, mines until the bag is full, leaves through the portal, and deposits essence at Varrock east bank.
2. **Given** interacting with Aubury does not move the character into the mine (nothing happened, or the shop window opened), **When** teleport is still required, **Then** it closes the shop if open, uses the teleport option (not trade), and retries within the recovery budget instead of logging the same failure every tick.
3. **Given** the miner landed in the mine away from visible essence rocks, **When** mining is required, **Then** it scans, walks to a mineable rock, and resumes mining.
4. **Given** the bag is full in the mine, **When** banking is required, **Then** it uses the portal to leave and opens the Varrock east bank specifically, not a shop or other window.
5. **Given** Varrock east bank will not open, **When** recovery is still possible, **Then** it closes stray windows, re-walks to the booth, and retries with **warn** in the fleet pane; after budget exhaustion it **error**-stops rather than printing "bank open failed" forever.
6. **Given** the miner has no pickaxe, **When** a trip is attempted, **Then** it withdraws or buys one, or **error**-stops with a clear reason; it MUST NOT mine-fail in a tight loop.

---

### User Story 2 - Watcher can see what the bot is trying (Priority: P2)

A person watching the character or the Ghostty fleet pane can tell the current intention (walking to bank, opening shop, stepping off a blocked tile, recovering from a stall) without reading source code and without the character shouting on public chat. Severity color tells them whether to keep ignoring the pane.

**Why this priority**: Babysitting cost is mostly "is it stuck or working?" Local, deduped intent plus log/warn/error color removes that guesswork once recovery exists.

**Independent Test**: Start flax (Jackpoo1) and essence (Jackpoo2). Watch the Ghostty panes. Each phase change produces a short **log** intent. Recovery produces **warn**. A stop produces **error**. Public chat does not contain those lines. From across the room, error panes are obvious and log panes are not.

**Acceptance Scenarios**:

1. **Given** the character changes phase, **When** a watcher looks at local game messages or the fleet pane, **Then** they see a short intent for that phase at **log** level.
2. **Given** recovery starts after a stall, **When** the watcher looks again, **Then** they see **warn** that recovery is in progress and which stall it is addressing.
3. **Given** the same intent would be repeated every tick, **When** nothing has changed, **Then** it is shown once, not spammed.
4. **Given** the activity stops because recovery is exhausted, **When** the watcher looks at the pane, **Then** they see **error** and do not have to scroll to discover the stop.

---

### User Story 3 - Travel then grind without a second launch (Priority: P3)

An operator who needs the crafter moved from the starting bank to the Seers flax field starts one activity. After the character arrives, grinding begins automatically. The operator does not stop one program and start another.

**Why this priority**: Today's pipeline is a human state machine. Removing the handoff is required for "leave it overnight."

**Independent Test**: Start the crafter away from Seers flax (banked, with whatever travel prep the route needs). One start later, watch Jackpoo1's Ghostty pane: the character is at flax and has completed at least one full pick-spin-bank trip. Travel trouble is **warn**; arrival then grind is **log**.

**Acceptance Scenarios**:

1. **Given** the crafter is at a bank in Misthalin and not yet at Seers flax, **When** the operator starts the activity once, **Then** the character travels to the flax field and then enters the grind loop without a second launch.
2. **Given** travel fails in a recoverable way (closed gate, missed lever, waiting for a web to be cut), **When** progress is still possible, **Then** the activity retries within its budget and continues; it does not exit "done" while still not at flax.
3. **Given** the character is already at the flax field, **When** the operator starts the same activity, **Then** it skips travel and begins grinding.

---

### User Story 4 - Doors, shops, and vertical hatches stop causing silent stalls (Priority: P4)

When walking fails because a door is in the way, the character opens ordinary doors and gates, not trapdoors, manholes, or hatches that drop it to another level. When buying a missing tool from a shopkeeper who is behind a door or who must be talked to before the shop opens, the shop still opens.

**Why this priority**: These are the in-flight reliability fixes that already address production stalls; they must be specified and tested so they do not regress while recovery work lands.

**Independent Test**: Reproduce a blocked-door walk, a trapdoor adjacent to a failed path, and a shopkeeper who cannot be reached until a door opens or a talk option is used. Walking continues on the same level; the shop opens. If this happens during a live canary, the fleet pane stays **log** or **warn**, not silent.

**Acceptance Scenarios**:

1. **Given** pathfinding cannot reach the destination because a closed door or gate is in the way, **When** the walk retries, **Then** it opens that door or gate and does not open a trapdoor, manhole, or hatch instead.
2. **Given** a shopkeeper is behind a closed door or has no direct trade option, **When** the operator (or activity) opens that shop, **Then** the shop window opens, or the attempt fails with a specific reason such as cannot-reach rather than a generic timeout.
3. **Given** the bank is already open, **When** the activity asks to open the bank, **Then** it reports success without clicking craft or dialog buttons.

---

### Edge Cases

- What happens when recovery spends its full budget and the character is still not progressing? The activity MUST stop, leave a structured reason (last phase, last error, location), emit **error**, and MUST NOT keep clicking.
- What happens on disconnect or stale world state after a pause? The activity MUST notice that state is old or missing, reconnect or abort with a reason, emit **error**, and MUST NOT act on a snapshot older than a few seconds as if it were live.
- What happens if a level-up or other blocking dialog appears mid-loop? Recovery MUST dismiss blocking dialogs that are not the intended shop, bank, or skill-product choice, then continue.
- What happens if the spinning-wheel house, essence portal, or bank booth is crowded or temporarily unreachable? Recovery MAY wait a short time and re-path; it MUST still respect the budget.
- What happens if travel requires a slash tool the character does not have? The activity MUST try a known acquisition path or wait for another character to cut the web, then either proceed or stop with "cannot pack for wilderness" rather than looping "still has extras" when the bag is empty.
- How does the system handle a grind log growing without bound from a tight retry loop? Logging MUST not write the same failure on every game tick; repeated failures are counted, sampled, and at **warn** until stop.
- What happens if Rune Mysteries is not complete and the miner tries to teleport? The activity MUST **error**-stop with that reason (or finish the quest in a later feature). This feature's essence trip assumes the quest is done.
- What happens if Aubury's shop is open when teleport is needed? Close the shop and use teleport; do not treat the shop as progress toward mining.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A long-running activity MUST expose the current phase (for example pick, spin, bank, travel, teleport, mine, portal) and whether it observed progress in that phase.
- **FR-002**: The activity MUST treat inventory change, experience gain, location change, bank opening, shop opening, dialog advance, or (for essence) arriving in / leaving the essence mine as progress.
- **FR-003**: If no progress is observed for 2 minutes, or the same failure repeats 5 times within 2 minutes, the activity MUST enter recovery and emit **warn**.
- **FR-004**: Recovery MUST be bounded: at most 4 distinct recovery tactics, or 3 minutes wall-clock, whichever comes first. Exhaustion MUST stop the activity safely and emit **error**.
- **FR-005**: Recovery tactics MUST include closing stray windows, stepping off a blocked tile, re-walking to a known tile, and using stairs or doors to reach the needed floor. Essence recovery MUST also include closing a shop, retrying NPC teleport, scanning for rocks, and using the mine portal.
- **FR-006**: Bank success MUST mean the bank window is open. A craft, shop, quest, or level-up window MUST NOT count as the bank.
- **FR-007**: When a craft or "make item" window is open and the bank is needed, the activity MUST close that window before opening the bank.
- **FR-008**: Walking from a tile that is not walkable MUST step to a nearby walkable tile before pathing again.
- **FR-009**: Automatic door opening during a failed walk MUST ignore trapdoors, manholes, and hatches.
- **FR-010**: Opening a shop MUST retry when a door blocks the shopkeeper, and MUST be able to use talk-then-shop when the shopkeeper has no direct trade option.
- **FR-011**: Shop and bank failures MUST surface a specific reason (already open, cannot reach, wrong window, timeout) rather than only "failed."
- **FR-012**: The character MUST be able to show a short current-intent line locally (visible in the game message area and/or grind log) without sending public chat.
- **FR-013**: Intent lines MUST be deduplicated while the intent is unchanged.
- **FR-014**: Travel to the Seers flax field and the flax-spin-bank grind MUST be one operator start. Arrival at flax MUST transition into grinding without a second launch.
- **FR-015**: If the character is already at the flax field, travel MUST be skipped.
- **FR-016**: The flax trip MUST produce a full inventory conversion: flax in, bowstrings banked, inventory empty enough to pick again.
- **FR-017**: Structured trip metrics MUST be recorded: trip count, items banked, time in stall, recoveries used, stop reason.
- **FR-018**: Evidence-first tests MUST cover: stepping off a blocked start tile; bank vs craft window; trapdoor exclusion; shop cannot-reach retry; recovery stop after budget exhaustion; log vs warn vs error classification.
- **FR-019**: Unused public capabilities MUST NOT ship. Any new operator-visible action added in this feature MUST be used by the flax activity, the essence activity, or by recovery.
- **FR-020**: This feature MUST NOT change game content, wilderness rules, spinning-wheel mechanics, or essence-mine teleport rules.
- **FR-021**: The essence trip MUST produce a full inventory conversion: essence mined in the mine, portal used to leave, essence banked at Varrock east, inventory empty enough to mine again (pickaxe kept).
- **FR-022**: If the character is already in the essence mine, the trip MUST skip teleport and mine.
- **FR-023**: Essence teleport MUST use the NPC teleport option. Opening the rune shop MUST NOT count as a successful teleport.
- **FR-024**: Every grind-log line MUST carry a severity of log, warn, or error. The Ghostty fleet viewer MUST color those three levels so error is the attention color, warn is secondary, and log is quiet.
- **FR-025**: Completing Rune Mysteries is out of scope for this feature's live bar. The essence canary assumes the quest is already done.

### Key Entities

- **Activity**: A named long-running job with phases, a progress clock, a recovery budget, and a terminal stop reason.
- **Phase**: A named step of the job (travel, pick, walk to wheel, spin, walk to bank, deposit; or teleport, mine, portal, bank).
- **Progress event**: An observed world change that proves the phase is advancing.
- **Stall**: Absence of progress past the time or repeat threshold.
- **Recovery attempt**: One tactic applied after a stall, with an intent line and an outcome (progress resumed or still stalled).
- **Trip**: One full cycle that banks the product and returns the inventory to a gatherable state (bowstrings for flax; rune essence for mining).
- **Intent**: A short, local, human-readable statement of what the character is trying to do right now.
- **Log severity**: log, warn, or error on each grind-log line, mapped to color in the Ghostty fleet pane.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A crafter already at Seers flax completes 50 consecutive pick-spin-bank trips without a human restart.
- **SC-002**: At least 25 bowstrings are banked per completed trip when starting from an empty inventory (28-slot bag, flax unnoted).
- **SC-003**: The stalls named in User Story 1 (blocked tile after pick, craft window vs bank, wrong wheel floor) recover within 3 minutes in at least 9 of 10 injected or observed occurrences.
- **SC-004**: After recovery budget is exhausted, the activity stops within 10 seconds, records a stop reason, and the Ghostty pane shows **error**; it does not continue clicking.
- **SC-005**: An operator starting from a Misthalin bank reaches flax and completes one grind trip with a single start, with no second program launch.
- **SC-006**: A watcher can identify the current phase from local intent or the fleet pane within 15 seconds of a phase change.
- **SC-007**: The grind log does not grow by more than 50 identical failure lines per minute during a stall (no tick-level spam).
- **SC-008**: Operators report fewer than one manual restart per day for Jackpoo1 and for Jackpoo2 once SC-001 and SC-001b have been demonstrated.
- **SC-001b**: A miner with Rune Mysteries done completes 50 consecutive essence trips (teleport → full bag → portal → Varrock east deposit) without a human restart.
- **SC-002b**: At least 25 essence are banked per completed trip when starting from an empty bag (pickaxe kept).
- **SC-003b**: The stalls named in User Story 1b (failed teleport, shop instead of teleport, missed portal, bank-open failure) recover within 3 minutes in at least 9 of 10 injected or observed occurrences.
- **SC-009**: In the Ghostty fleet window, a healthy trip is not attention-colored; a recovering stall is warn-colored; a stopped bot is error-colored. An operator can pick the pane that needs them without reading the text.

## Assumptions

- The flax proving character is Jackpoo1 (or equivalent) already able to pick flax and spin bowstrings.
- The essence proving character is Jackpoo2 (or equivalent) with Rune Mysteries complete and a pickaxe. Quest walkthrough is not part of this feature's success bar.
- Wilderness travel may still depend on a slash tool or another character cutting the keep web; this feature must fail clearly if packing is impossible, not loop misleadingly.
- Fleet trading, quest planning, and account-level goal selection are out of scope and will be later features.
- The game server, spinning wheel, flax plants, essence mine, portal, Aubury teleport, and bank booths behave as they do today; this feature only changes how the bot observes and recovers.
- Existing high-level walk, bank, shop, and dialog actions remain the operator-facing surface; this feature hardens and supervises them rather than replacing the game.
- Unit tests may use recorded or mocked world snapshots; the 50-trip criteria are live runs watched in Ghostty, not unit tests.
- Spec Kit artifacts in this directory are the contract for the change; character-specific coordinates may live in shared route notes but the recovery rules are shared.
- The Ghostty fleet window is the existing viewer that tails each bot's grind log; this feature adds severity color, not a new dashboard product.
