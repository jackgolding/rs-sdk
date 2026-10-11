# Quickstart: Script Item Rates

Validation guide for [spec.md](spec.md). Contracts: [item gains](contracts/item-gains.md), [yield view](contracts/yield-view.md), [bank stock](contracts/bank-stock.md). Math and fields: [data-model.md](data-model.md).

Run from the repo root. Unit tests do not connect to the game. Live checks use bots that are already playing; do not start a second controller and do not walk anyone to a bank.

## 1. Pure math and the gain writer

```bash
bun test sdk/test/activity-gains.test.ts sdk/test/fleet-yields.test.ts sdk/test/bank-stock.test.ts
```

Expected:

- `recordGain('Cooked shark', 8)` then `recordGain('Raw shark', 2)` writes two lines. A following call with the bank total does not add a third shark line. `recordGain('Burnt shark', 0)` writes nothing.
- A thrown append logs one warning and does not reject.
- Three character-hours of shark gains, plus one character with ≥ 10 minutes of `jobKey` heartbeats and zero shark gains, produce a zero point for that character and a script median that is not pulled to that character's value alone (the median is the middle of all included points).
- Two heartbeats 5 minutes apart are included (10 minutes of presence). One heartbeat is omitted.
- `bots/quests/fishing-route.ts --shark` and `bots/quests/fishing-route.ts` (no shark flag) are different jobs.
- A fixture with fishing XP and no gain lines is `no samples`, not a shark rate.
- A stock line in hour H is not replaced by a second capture in hour H. Hour H+1 appends.
- Moving a recorded stack from one account's stock line to another's changes `stockDelta` by about zero and does not change the gatherer's `perHour`.

## 2. The shark trip, once callers land

On one character already running `fishing-route.ts --shark`, after a trip that keeps cooked and raw sharks and burns some:

```bash
# bounded tail; do not open the whole file
bun -e '
import { readJsonlTail } from "./sdk/grind-log.ts";
const rows = readJsonlTail("./bots/Jackpoo3/gains.log", { tailBytes: 64_000, maxRecords: 20 });
console.log(rows.slice(-6));
'
```

Expected for that trip: one line per kept form, counts matching what was kept, no burnt line, and no second pair of lines after the bank closes. Swap the character name for whichever shark bot just banked.

`fleet-report rates` still shows fishing XP per hour. That number is not a shark count.

## 3. The distribution

```bash
bun .cursor/skills/wake-fleet/scripts/fleet-report.ts yields --window 24h
bun .cursor/skills/wake-fleet/scripts/fleet-report.ts yields --window 24h --json
bun .cursor/skills/fleet-bank-canvas/scripts/build-yield-canvas.ts --window 24h
```

Expected:

- Each shark job shows a median and one point per included character-hour. A character who was heartbeating on that job for a full hour and gained nothing is a zero point, named.
- Big-net points are not on the shark job.
- Jobs with no gains print `no samples` and do not show a fabricated number.
- The canvas opens beside the chat with one strip per job and item that has points. Axes are clock hour and items per hour. The median is marked. The caption names gain records and heartbeat presence as the source.

Until callers have been writing gains for a few hours, `no samples` is the correct report. Do not fill the chart from `grind.log` or from XP.

## 4. Bank check

Capture only happens when a bank is already open (the grind banking on its own, or the existing observe-only canvas builder). Do not run `snapshot-nearest-banks.ts` as part of this validation.

After two different clock hours have a `bank-stock.log` line for the same accounts:

```bash
bun .cursor/skills/wake-fleet/scripts/fleet-report.ts stock --item "raw shark" --json
```

Expected: included accounts, excluded accounts, stock change, summed gains, and the gap. Trading sharks onto a mule does not change the shark job's median. The mule's job does not gain a shark point from the trade.

A trial that gained 100 of an item and lost none from the included banks should show stock change and summed gains within 5% of each other (spec SC-005). A larger gap is reported as a gap, not patched.

## 5. Merge gate

```bash
bun run check
```

`rates`, `supply`, and `flags` still run. A gains write failure in a unit test does not fail the session.
