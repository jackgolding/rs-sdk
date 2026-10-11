# Data Model: Script Item Rates

Storage is flat files with bounded growth, same rules as `003-honest-fleet-telemetry`: `appendGrindLog` caps writes, readers use `readJsonlTail` with an explicit bound, never a whole-file read. Paths are relative to the repo root unless noted.

Item names are normalized for grouping: trim, collapse internal whitespace, compare case-insensitively. The display name is the first seen spelling. Noted and unnoted forms share a published name and therefore one group. The canonical coin name is `Coins`.

`jobKey` is the repo-relative script path plus the launch arguments that are not the character name, joined by single spaces. Example: `bots/quests/fishing-route.ts --shark`.

Clock hours are the host's local timezone. `hour` is an ISO-like local bucket `YYYY-MM-DDTHH` with no zone suffix; readers on another host must not reinterpret it.

## Item gain: `bots/{name}/gains.log` (JSONL)

One line per kept stack. Not sampled. Not a trip total and not a balance.

| Field | Type | Notes |
|-------|------|-------|
| `t` | number (ms) | Write time |
| `session` | number (ms) | `ActivitySession` session start, same as heartbeats |
| `pid` | number | Writer process |
| `jobKey` | string | Launch job, see above |
| `item` | string | Display name as passed by the caller |
| `count` | number | Integer ≥ 1 |

**Validation**: A line is ignored when `count` is not an integer ≥ 1, `item` is empty after trim, `t` is not finite, or `jobKey` is empty. Lines older than 7 days are ignored by yield and stock readers.

**Writers**: `ActivitySession.recordGain`. A thrown write is caught, warned once per session, and does not propagate.

**Relationship**: Many gains belong to one session and one `jobKey`. Summed by `jobKey` + normalized item + clock hour for a character-hour. Summed by normalized item + time range for the stock check, across characters, including hours that were omitted from the chart.

## Progress snapshot addition: `bots/{name}/heartbeat.log`

Existing 003 record. One new field.

| Field | Type | Notes |
|-------|------|-------|
| `jobKey` | string | Same value as gains from this session. Absent on snapshots written before this feature |

Snapshots without `jobKey` are still valid for 003 rates. They do not contribute presence for this feature. Validity is unchanged: Hitpoints XP > 0 and position not `(0, 0)`.

## Character-hour (computed, not stored)

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Character |
| `jobKey` | string | |
| `item` | string | Display name |
| `hour` | string | Local clock hour |
| `presenceMs` | number | See formula. Capped at 3,600,000 |
| `count` | number | Sum of gains for that item in that hour |
| `perHour` | number | `count / (presenceMs / 3_600_000)` |

**Presence**: From valid snapshots in that clock hour with that `jobKey`, sorted by `t`. Add each gap between consecutive snapshots when the gap is ≤ 10 minutes. Add 5 minutes for the last snapshot. Cap at 60 minutes.

**Included** when `presenceMs` ≥ 10 minutes. An included hour with `count = 0` is a real zero point. A shorter presence is omitted, not stored as zero.

## Script distribution (computed, not stored)

| Field | Type | Notes |
|-------|------|-------|
| `jobKey` | string | |
| `item` | string | |
| `windowMs` | number | Requested window, clipped to 7 days |
| `points` | character-hour[] | Included only |
| `median` | number \| null | Null when `points` is empty ("no samples") |
| `byCharacter` | `{ name, median, hours }[]` | That character's included points only |

**Median**: Sort `perHour` ascending. Odd count: the middle value. Even count: the mean of the two middle values. A single point is its own median.

## Bank stock snapshot: `bots/{name}/bank-stock.log` (JSONL)

At most one line per character per local clock hour. Bank contents only.

| Field | Type | Notes |
|-------|------|-------|
| `t` | number (ms) | Write time of the first capture in that hour |
| `hour` | string | Local clock hour |
| `items` | `{ id: number, name: string, count: number }[]` | Copy of `bank.items` while the bank is open |

**Append rule**: Read the latest line with a bounded tail. If its `hour` equals the current hour, do not write. Otherwise append. Older hours are never rewritten.

**Validation**: A line is ignored when `items` is missing or empty, or `bank.isOpen` was not true at capture. Empty captures are not written.

**Writers**: `ActivitySession.captureBankStock` from a script that already has the bank open, and the fleet bank observer when it saves a capture. Both call `appendHourlyBankStock`.

The existing `fleet-bank-snapshots.json` latest-only store is unchanged and is not this history.

## Fleet stock check (computed, not stored)

| Field | Type | Notes |
|-------|------|-------|
| `item` | string | Normalized match |
| `from` | string | Start hour |
| `to` | string | End hour |
| `accounts` | string[] | Characters with a stock line in both hours |
| `excluded` | string[] | Characters missing either hour |
| `stockFrom` | number | Sum of matching stack counts at `from` |
| `stockTo` | number | Sum at `to` |
| `stockDelta` | number | `stockTo - stockFrom` |
| `gains` | number | Sum of gain counts for that item with `t` in `[from, to)` across the fleet, not only `accounts` |
| `gap` | number | `stockDelta - gains` |

`gap` is reported. It is not subtracted from any script distribution. Shop price is not a field.

## State transitions

```text
acquiring step ends with a kept stack
  → recordGain once
  → later bank open does not recordGain again

bank already open, no stock line for this hour
  → append one stock line

bank already open, this hour already has a line
  → no write

valid heartbeats for ≥ 10 minutes in an hour, no gains of that item
  → character-hour perHour = 0

presence < 10 minutes
  → no character-hour (gains in that hour still count in the stock check)
```

## Relationships

```text
roster command  --compare-->  jobKey     (drift note only; not the group key)
heartbeat.jobKey  --presence-->  character-hour
gains (jobKey, item, hour)  --count-->  character-hour
character-hours  --median-->  script distribution
bank-stock (two hours) + gains in between  -->  fleet stock check
```
