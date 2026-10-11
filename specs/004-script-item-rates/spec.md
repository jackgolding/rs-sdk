# Feature Specification: Script Item Rates

**Feature Branch**: `004-script-item-rates`

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "Record named item gains when a fleet script already knows what it collected, and show a distribution of items per hour for each script, with the median marked. Use bank holdings only as a fleet-wide check that those items were kept, not as the script's score. Do not reconstruct rates from older prose logs, and do not walk the fleet to a bank just to measure."

## User Scenarios & Testing *(mandatory)*

### Operator context

The operator runs a fleet of characters. Each character has one roster job: a shared script plus the arguments that choose its product (shark fishing and big-net fishing are different jobs even when they share a script file). The operator wants to know how well each job collects materials — sharks per hour, coins per hour, magic logs per hour — as a distribution across characters and hours, not as one fleet total.

Today the fleet can report skill experience per hour and a rough inventory-coin increase. It cannot name the item. A banked trip is recorded as a single unlabeled quantity, and a fish that is caught and then cooked can be added into that quantity more than once. Bank holdings are a single latest picture per character, overwritten on the next capture, and they move when characters trade. Experience cannot be turned back into a count of one item.

### User Story 1 - Named yields are recorded once (Priority: P1)

When a running job finishes a step in which it already knows what it obtained, it records each item by name and count. A shark trip that keeps 8 cooked sharks and 2 raw sharks records those two facts, not "10" and not "8 cooked plus 2 raw plus the raw that were cooked." Coins the job itself receives (theft, alchemy, a sale) are recorded the same way. The record is kept every time, including when the human-readable log repeats a line and keeps only a sample.

**Why this priority**: Without a named count, no later chart can be honest. This story is useful on its own: the operator can read the latest gains for one character and see which items arrived.

**Independent Test**: Run one shark trip that cooks some of the catch and burns some. The gain list shows cooked sharks and any raw sharks still kept, each once. Burnt fish do not appear. The same units do not appear again when they are banked. A second identical human-readable log line may be sampled away; the gain record for that trip is still present.

**Acceptance Scenarios**:

1. **Given** a job has just kept 8 cooked sharks and 2 raw sharks from one trip, **When** its gains are read, **Then** the records are "cooked shark 8" and "raw shark 2", and the total number of shark items recorded for that trip is 10.
2. **Given** some of those raw sharks were cooked or burnt during the same trip, **When** gains are recorded, **Then** a fish is recorded only in the form that was kept, and burnt fish are not recorded as yield.
3. **Given** the same items are banked after they were already recorded, **When** the bank succeeds, **Then** they are not recorded a second time.
4. **Given** a job receives 500 coins by its own action, **When** gains are recorded, **Then** the record is 500 coins, whether or not those coins are banked afterwards.
5. **Given** a character receives items only by trade from another character, **When** gains are recorded, **Then** the receiver has no gain for those items, and the sender's earlier gains are unchanged.
6. **Given** the human-readable log would sample away a repeated line, **When** a new gain happens, **Then** the named gain is still stored.
7. **Given** storing a gain fails, **When** the job is still able to continue, **Then** the activity is not stopped by that failure.

---

### User Story 2 - Each script has a distribution of items per hour (Priority: P1)

The operator asks how a job is doing. For each item that job recorded, they see one distribution over the chosen window. Each point is one character-hour: items gained in that clock hour, divided by the time that character was actually on that job during the hour. The median of those points is marked. Each point can be identified as a character and an hour, and each character's own median is shown, so a stuck character sits away from the script median instead of disappearing into an average.

**Why this priority**: This is the question the operator asked. A single fleet total hides a character that has stopped collecting. The median is the summary; the points are the distribution.

**Independent Test**: Supply a known set of named gains for three characters on the same shark job over three hours, including one character with a full hour and zero sharks. Open the shark view. The points, the median, and that character's own median match the supplied gains. A character on big-net fishing does not appear on the shark view.

**Acceptance Scenarios**:

1. **Given** two characters run the shark job and a third runs the same script with different product arguments, **When** the operator opens the shark view, **Then** only the shark job's character-hours appear.
2. **Given** a character gained 20 magic logs in a clock hour and was on that job for the whole hour, **When** the distribution is shown, **Then** that point is 20 magic logs per hour.
3. **Given** a character was on the job for 30 minutes of a clock hour and gained 10 logs in that time, **When** the distribution is shown, **Then** that point is 20 logs per hour, not 10.
4. **Given** at least one item has three or more included character-hours, **When** the view is shown, **Then** every included character-hour is a point, the median of those points is marked, and each point identifies its character and hour.
5. **Given** a character stayed on the job for a full hour and gained nothing, **When** the view is shown, **Then** that hour is a zero point and that character's own median reflects it.
6. **Given** a character was on the job for less than 10 minutes in a clock hour, **When** the view is shown, **Then** that hour is omitted rather than drawn as a near-zero rate.
7. **Given** a job recorded both magic logs and coins, **When** the view is shown, **Then** each item has its own distribution, and the two are not added into one number.
8. **Given** a job has no named gains in the window, **When** the operator asks, **Then** it is reported as having no samples. No rate is invented from skill experience or from older unlabeled trip lines.
9. **Given** the operator selects a window, **When** the view is shown, **Then** the window defaults to the last 24 hours and can be lengthened up to the time gains are still retained.

---

### User Story 3 - Bank holdings check the fleet, not the script (Priority: P2)

The operator can compare two pictures of fleet bank holdings and see whether a named item actually accumulated. The change in the combined bank count is shown next to the summed gains for that item over the same period. A gap is shown as a gap. Trading a stack to a mule does not make the mule look productive and does not lower the sender's script rate. Shop price is not the score.

**Why this priority**: Gains can be recorded for items that are later lost, dropped, or converted. The bank is the check that the fleet still holds them. It is the wrong score for a script, because stock moves between characters.

**Independent Test**: Record 100 raw sharks of gains across the fleet. Move them by trade onto one mule and capture bank holdings before and after, without sending anyone to a bank for the sake of the measurement. The shark script's distribution is unchanged. The fleet-wide shark count changes by about zero across the trade. The view shows summed gains beside the stock change and does not assign the mule's stock to the mule's job.

**Acceptance Scenarios**:

1. **Given** a character's bank is already open during normal play, **When** holdings are captured, **Then** the capture is kept as history. A later capture does not erase the earlier one.
2. **Given** no bank is open, **When** a measurement is wanted, **Then** characters are not walked to a bank and no second controller is attached to open one.
3. **Given** two captures of the same accounts, **When** the operator checks an item, **Then** they see the combined bank change between those times and the summed gains of that item in between.
4. **Given** items moved from a gatherer to a mule by trade, **When** the script view and the bank check are both read, **Then** the gatherer's items-per-hour are unchanged and the mule is not credited with producing those items.
5. **Given** the bank change and the summed gains differ, **When** the check is shown, **Then** the difference is visible and is not folded back into any script's distribution.
6. **Given** holdings are valued, **When** the script view is shown, **Then** the score remains items per hour, not shop price times count.

---

### Edge Cases

- A character switches jobs inside one clock hour. Time and gains split by job. Only the minutes on a job count toward that job's point.
- A job restarts inside the hour. Gains still count. The hour is included when the time on that job totals at least 10 minutes.
- A stack counts as its stack size, not as one inventory slot. One hundred coins are 100 coins.
- Noted and unnoted forms of the same item count as that item.
- A conversion job (cooking from the bank, fletching, smelting, smithing) records the output it produced. It does not record the input again, and it does not reduce the gatherer's earlier rate.
- Items gained and then dropped, lost, or sold leave the script rate as it was. The bank check may show a gap.
- A job that acquires nothing (for example a course with no item yield) does not appear as a zero-item script. Existing experience-per-hour reporting still covers it.
- Several items in one trip produce one gain record per item name.
- An hour with a very high count stays in the distribution. The median is the summary, so one outlier does not become the script's rate.
- Gains recorded before this feature do not exist. The view does not backfill them from prose logs.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A running job MUST record a gain at the moment it already knows an item name and a kept count. Each record MUST identify the time, the character, the roster job (script plus the arguments that choose the product), the item name, and the count.
- **FR-002**: A unit MUST be recorded once, as the form in which it was kept at the end of that acquiring step. Cooking, burning, or banking that same unit MUST NOT add a second gain. Burnt products MUST NOT be recorded as yield.
- **FR-003**: Coins a job gains by its own action MUST be recorded as a coin gain. Banking, spending, or trading those coins afterwards MUST NOT change the recorded gain. An increase in the inventory coin balance alone MUST NOT be treated as this gain.
- **FR-004**: Items received by trade from another character MUST NOT be recorded as a gain. The sender's existing gains MUST stay as recorded.
- **FR-005**: A conversion job MUST record the output it produced and MUST NOT record the consumed input as a new gain.
- **FR-006**: Gain records MUST be stored for every gain. Sampling of the human-readable activity log MUST stay as it is and MUST NOT drop gain records.
- **FR-007**: A failure to store a gain MUST NOT stop the activity.
- **FR-008**: Gain records MUST be retained for at least 7 days and MUST NOT grow without a bound. Readers MUST NOT need to load an unbounded history to answer a windowed question.
- **FR-009**: The operator MUST be able to view, per roster job and per item, the distribution of items per hour over a window. The window MUST default to the last 24 hours and MUST be selectable up to the retained history.
- **FR-010**: Each included point MUST be one character-hour: the count gained in that clock hour divided by the fraction of the hour the character was on that job. The median of the included points MUST be marked. Each point MUST be identifiable by character and hour. Each character's own median MUST be shown.
- **FR-011**: A clock hour in which the character was on that job for at least 10 minutes and gained none of that item MUST be included as zero. A clock hour with less than 10 minutes on that job MUST be omitted.
- **FR-012**: Different product arguments on the same script MUST be different jobs in this view. Different items from one job MUST NOT be summed into one distribution.
- **FR-013**: A job with no gain samples in the window MUST be reported as having no samples. The view MUST NOT invent an item rate from skill experience or from unlabeled trip lines written before this feature.
- **FR-014**: Existing experience-per-hour reporting MUST keep its current meaning and MUST NOT be presented as an item count.
- **FR-015**: Bank holdings captures MUST be appended as history. A new capture MUST NOT erase an earlier one. Captures MUST happen only when a bank is already open. This feature MUST NOT walk characters to a bank and MUST NOT attach a controller to open one.
- **FR-016**: For two holdings captures, the operator MUST be able to see the combined bank change for an item and the summed gains of that item between those times. A difference MUST be shown as a difference and MUST NOT be written back into a job's distribution.
- **FR-017**: Per-character bank changes and shop-price totals MUST NOT be the script score. The script score is items per hour from gain records.
- **FR-018**: Noted and unnoted forms of one item MUST count as that item. A stack MUST count as its quantity, not as one slot.
- **FR-019**: This feature MUST NOT change game content, MUST NOT judge a rate as too slow or fast, and MUST NOT reconstruct gains from logs written before it.

### Key Entities

- **Item gain**: One kept yield. Time, character, roster job, item name, and count. Not a trip total and not a balance.
- **Character-hour**: One character, one clock hour, one job, one item. Items per hour for the time actually on that job. Omitted below 10 minutes. Zero when the character was on the job and gained none.
- **Script distribution**: The set of character-hours for one roster job and one item in a window, plus the median of those points and each character's own median.
- **Bank holdings snapshot**: One character's bank contents at a capture time. History is a sequence of these. Inventory and worn equipment are not part of it.
- **Fleet stock check**: For one item and two capture times, the change in combined bank count, the summed gains in between, and the gap between them.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a trial trip that keeps 8 cooked sharks and 2 raw sharks and burns the rest of a 12-fish catch, the gain list totals 10 shark items, split 8 and 2, with no burnt entry and no second copy after banking.
- **SC-002**: Given at least three included character-hours, the operator can read the median items per hour and identify every point's character and hour within one minute of asking.
- **SC-003**: A character that stays on a job for a full hour and gains nothing appears as a zero point, and that character's own median is lower than the script median whenever the other included points are above zero.
- **SC-004**: After a trade that moves a recorded stack from a gatherer to a mule, the gatherer's items-per-hour change by less than one item, and the mule's job does not gain that stack.
- **SC-005**: For an item measured on the same accounts at two times, the stock check shows both the combined bank change and the summed gains. In a trial where 100 items were gained and none left the fleet's banks, the two figures agree within 5%.
- **SC-006**: Asking for item rates with no gains recorded after this feature produces no item-per-hour number derived from experience or from older trip lines, for every such job.
- **SC-007**: Across a day of normal sampling of the human-readable log, every kept yield of at least one item still has a gain record.

## Assumptions

- The roster remains the list of characters and jobs. The job identity for a distribution is the roster script plus the arguments that select the product.
- "Kept" means still in the character's possession at the end of the acquiring step, in the form it has then. A fish cooked during that step is kept as the cooked item. A fish burnt during that step is not yield.
- A later, separate conversion job records its own outputs when it produces them. That does not rewrite the gatherer's gains.
- The 10-minute floor matches the existing minimum used before an experience rate is reported. It is a default so a brief restart is not drawn as a dead hour.
- The default window is the last 24 hours because a distribution needs more than one character-hour. A shorter window remains available by selection, down to whatever the operator asks, but points under 10 minutes on the job are still omitted.
- Gain history is kept at least 7 days, with the same bounded-growth rule already used for activity logs: capped writes and windowed reads.
- Bank captures stay observe-only and bank-only, as the current fleet bank picture already is. This feature adds history. It does not add inventory, equipment, or a forced bank visit.
- Shop price may still appear on the bank picture. It is not an input to items per hour.
- Experience-per-hour and the existing inventory-coin rate stay available for the questions they already answer. They are not substitutes for a named item rate.
- Out of scope: rebuilding past distributions from prose logs; turning experience into an item count; walking the fleet to a bank to measure; rating a script as good or bad; changing game content; alerting when a median drops.
