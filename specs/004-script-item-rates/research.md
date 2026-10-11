# Research: Script Item Rates

Decisions for [spec.md](spec.md). Each one is forced by a hole in the telemetry that already exists after `003-honest-fleet-telemetry`.

## R1. Where a named gain is stored

**Observed**:

- `heartbeat.log` stores skill XP and the coin stack currently in the inventory, every 5 minutes. It does not store other items. A shark that is caught and banked between two snapshots never appears as a positive delta.
- `events.log` progress lines are throttled to one per kind per 30 seconds, and the message is free text (`shark trip 4 raw=26`).
- `recordTrip` writes `Banked ${quantity}` through `ActivitySession.log`. That line usually survives sampling only because the trip number changes the text. The quantity has no item name. `fishing-route.ts` passes `caught.shark + cooked.cooked + cooked.burnt`, so one fish can be counted twice, and burnt fish count as yield.
- `grind.log` is capped at 8 MB and identical lines are sampled. It is the wrong source, and older trips cannot be rebuilt from it.

**Decision**: New file `bots/{name}/gains.log`, one JSONL object per kept stack, written by `ActivitySession.recordGain(item, count)`. The write does not go through `log()`, so sampling cannot drop it. `recordTrip` stays a prose counter and is not read for rates.

**Rationale**: The script already knows the kept breakdown at the end of the step. Recording that fact is one append. Readers tail the file the same way they tail heartbeats.

**Alternatives rejected**:

- Item maps on the heartbeat. That is a balance. Banking zeros it.
- Richer progress messages. The 30-second throttle drops trips, and free text is not a count.
- Parsing `grind.log`. Forbidden as a whole-file read, sampled, and unlabeled.
- Turning fishing XP into fish (`estimateFishFromXp` divides by 100). A shark, a lobster, and a cooked fish are not the same XP, and the spec forbids inventing item rates from experience.

## R2. What gets recorded, and what must not

**Decision**:

- `recordGain` stores a positive integer count of one item name. Zero, negative, and non-finite counts are ignored.
- The caller passes the number kept at the end of that acquiring step, in the form it has then. Cooking during the step records the cooked item, not also the raw item. Burning records nothing.
- Depositing or banking that stack does not call `recordGain` again. The bank total is never the count (magic logs currently log `bankCount` after deposit; the gain is the inventory count from before the deposit).
- Coins are the item `Coins`, recorded as the number the job received since the previous coin gain, once per bank or mule step. An inventory coin delta on the heartbeat is not this number. `gpPerHour` is unchanged.
- A trade received is not a gain. The sender does not delete the earlier gain.
- A conversion script records its output count for that step and does not record the input it consumed.
- Noted certificates use the same published name as the unnoted item (`ObjType.genCert` copies the name). Grouping by normalized name merges them. No noted prefix is required.

**Rationale**: The spec's shark trial (8 cooked, 2 raw, 2 burnt out of 12) is then a property of the caller, and the API cannot represent "burnt" or "bank balance" unless a caller passes them. Tests pin the fishing caller and the magic-log caller.

**Alternatives rejected**:

- One gain per fish, per pickpocket, or per log. Thieving at one line per coin pick is tens of thousands of lines a day and blows the 7-day cap. The spec asks for a count, not a line per unit.
- Recording both raw and cooked and subtracting later. Two facts for one fish will be summed by any honest reader.

## R3. Job identity

**Observed**: `ActivitySession.name` is a short label (`shark`, `bignet`, `magic-trees`, `thieving`). The roster job is `script` plus `args`. Shark fishing and big-net fishing share `fishing-route.ts` and differ by `--shark` versus the big-net flag. The first roster arg is the character name.

**Decision**: At session start, compute `jobKey` from `process.argv`:

- the repo-relative script path (the `bots/.../*.ts` argument);
- then every later argument except the character name (`BOT_USERNAME` or the roster name passed as an arg).

Examples: `bots/quests/fishing-route.ts --shark`, `bots/quests/magic-trees.ts`.

`jobKey` is stored on every gain and on every heartbeat from that session. The existing heartbeat field `job` (the short label) stays, so 003 readers do not change. If argv has no script path, `jobKey` falls back to the short label and those records still group together.

The yield view groups by `jobKey`, not by the current roster row. A character whose live command has drifted is shown under the job that actually ran. The row notes when that key is not the key of their current roster command.

**Rationale**: The distribution is "how well this script is doing", which is the command that produced the items. The roster remains the restart source (003). It is not a back-dated label for gains.

**Alternatives rejected**:

- Grouping only by the short label. `shark` does not say which file, and two future scripts could reuse a label.
- Grouping by the roster row at read time. A drifted session would be scored as the job it was supposed to run.

## R4. Retention and the tail reader

**Observed**: `appendGrindLog` caps a file at 8 MB and keeps the last 4 MB. `readJsonlTail` defaults to the last 256 KB and 500 records. A busy gatherer at the top of the expected range (about 90 gain lines an hour, about 200 bytes each) writes about 3 MB in 7 days. 500 records is only a few hours of that bot.

**Decision**:

- Gains and stock use `appendGrindLog` with the default 8 MB cap. At the expected rate, 7 days of gains fit in the kept 4 MB with margin. Readers drop lines older than 7 days even if the file still holds them.
- The yield and stock readers pass an explicit tail: 2 MB and 20,000 records per bot. They still never read a whole file that has grown past that tail.
- No time-based deletion beyond the existing size cap.

**Rationale**: A second rotation policy is not needed at this volume. The default tail is the part that would silently truncate a 24-hour chart, so the yield reader must not use it.

**Alternatives rejected**: A 7-day time index, or a database. The fleet is flat files on purpose.

## R5. Presence, zeros, and the 10-minute floor

**Observed**: Gain lines alone cannot show a character who was on the job and collected nothing. Heartbeats already arrive every 5 minutes with a job label, from the 003 timer, including while a long trip is in progress.

**Decision**: Time on a job inside a clock hour comes from valid heartbeats (003 validity: Hitpoints XP and a real position) whose `jobKey` matches.

- Hour buckets use the host's local timezone.
- Sort that hour's matching heartbeats.
- Presence is the sum of gaps between consecutive ones, ignoring any gap longer than 10 minutes (2× the 5-minute interval), plus 5 minutes for the last heartbeat in the hour.
- Presence is capped at 60 minutes.
- The hour is included when presence is at least 10 minutes. Otherwise it is omitted.
- Items per hour = (sum of matching gains in that clock hour) / (presence / 60). Gains in an omitted hour still exist for the stock check; they just are not a point.
- A included hour with no matching gains is the point 0.

**Rationale**: Two heartbeats 5 minutes apart produce 10 minutes of presence (one 5-minute gap plus the final 5 minutes), which is the spec's floor. One heartbeat is 5 minutes and is omitted, so a single sample is not a dead hour. A crash gap does not count as time on the job. A full run of 5-minute heartbeats fills the hour to 60 minutes.

**Alternatives rejected**:

- Dividing by the whole clock hour. A character on the job for 30 minutes would look half as productive.
- Treating "no gains" as "not on the job". That hides the stuck character the spec wants as a zero.
- Using `recordTrip` totals as presence. Trips are not minutes.

## R6. Median and the chart

**Decision**:

- The script median is the median of the included character-hour rates for that `jobKey` and item. Even counts use the mean of the two central values.
- Each character's median uses the same rule on that character's included hours only.
- `fleet-report yields` prints this as text and as JSON. It is the source of truth for tests.
- A generator writes `script-item-rates.canvas.tsx` into the same canvases directory the bank canvas uses. Data is embedded. The canvas does not connect to the game. One section per job and item: a strip of points (inline SVG, host theme tokens) with the median marked, plus a table of per-character medians. A job with no included points is a "no samples" line in the CLI and is omitted from the canvas, not drawn as zeros.
- Default window is 24 hours. `--window` accepts the same `Nh` / `Nd` form as `fleet-report rates`, and also a shorter window. Points under 10 minutes of presence are still omitted. The window is clipped to 7 days.

**Rationale**: The CLI is what `bun test` can assert. The canvas is the distribution the operator asked to look at. `BarChart` would need one category per character-hour.

**Alternatives rejected**: Rendering only a table of medians. That is a summary, not the distribution. Putting the chart only in the terminal. The spec asks for a chart the operator can open.

## R7. Bank history as a check, not a score

**Observed**: `fleet-bank-snapshots.json` keeps one snapshot per account and overwrites it. The canvas builder connects observe-only and only sees a bank that is already open. It does not walk anyone. Full banks on every natural open would be large: a fishing trip can bank every few minutes, and a full item list is kilobytes.

**Decision**:

- `bots/{name}/bank-stock.log` stores `{ t, hour, items: [{ id, name, count }] }`.
- `appendHourlyBankStock` appends only when the file's latest line is a different local clock hour. The first capture in an hour sticks. A later capture in that hour does not replace it and does not erase older hours.
- `ActivitySession.captureBankStock()` writes that line only when `bank.isOpen` and `bank.items` is non-empty. Callers invoke it while the bank is open, before close. The bank-canvas observer calls the same function when it saves a capture. No new connection, and no walk.
- The latest-only JSON store and the icon grid stay as they are. Shop price stays on that grid and is not an input to yields.
- The stock check, per item, uses accounts that have a snapshot in both the start hour and the end hour of the comparison. Combined count is the sum of that item's stack sizes (same normalized name, noted and unnoted together). Accounts missing either side are listed and excluded from both sums. The gap is combined-stock change minus summed `gains.log` counts for that item between the two times. The gap is not written back onto any job's distribution.

**Rationale**: One line per hour is enough to compare "yesterday" with "now" and stays under the log cap (about 168 lines in 7 days). Keeping the first line of the hour satisfies "a later capture must not erase an earlier one" without storing every trip.

**Alternatives rejected**:

- Appending every bank open. Tens of megabytes a week across the fleet, for a check that only needs two times.
- Using per-account bank deltas as the script rate. A mule would look productive.
- A always-on observer of 45 banks. The scripts already have the bank open; a second fleet of observe connections is a new moving part.

## R8. Who calls `recordGain` in this change

**Decision**: Shared quest scripts only.

| Script | What it records |
|--------|-----------------|
| `fishing-route.ts` | Kept raw and cooked counts by name at the end of the trip. Not burnt. Not the sum of raw + cooked + burnt. |
| `magic-trees.ts` | Magic logs in the inventory before deposit. |
| `thieving-route.ts` | Coins gained since the previous coin record, at the bank or mule step. |
| `green-dragons.ts` | Each drop kept this trip, by name, the amount just obtained. |
| `bank-fletch.ts`, `rune-rocks.ts`, `rimmington-iron.ts`, `mining-guild.ts`, `hobgoblins.ts`, `essence.ts` | `recordGain(product, deposited)` next to the existing `recordTrip`. |

`captureBankStock()` is called from those same bank steps while the bank is open, and from the canvas observer.

Per-character `bowstrings.ts` files are out of scope (preview rule, not on the roster). Jobs that acquire no item (no `recordGain` caller) show "no samples". Their XP rate is unchanged.

**Alternatives rejected**: Editing every file that calls `bot.openBank()`. Most of those are one-off quests. The spec's chart is for fleet jobs, and the API is there when the next grind needs it.
