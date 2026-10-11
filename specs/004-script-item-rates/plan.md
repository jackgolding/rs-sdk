# Implementation Plan: Script Item Rates

**Branch**: `004-script-item-rates` (work lands on `private/fleet`; SDK pieces cherry-pickable to `sdk/local`) | **Date**: 2026-10-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-script-item-rates/spec.md`

## Summary

Show how well each roster job collects items, as a distribution of character-hours with a median, without treating bank stock or skill XP as that score.

Three additions, all on top of the telemetry from `003-honest-fleet-telemetry`:

1. **Named gains.** `ActivitySession.recordGain(item, count)` appends one unsampled JSONL line per kept stack. Callers pass the count they already observed for that item. A fish is recorded once, in the form that was kept. Banking it does not record it again. The prose trip line and its sampling stay as they are.
2. **A yield view.** Heartbeat presence says how long a character was on a job. Gain lines say what arrived. One pure function turns those into character-hours, a script median, and each character's own median. `fleet-report yields` prints it. A generated canvas draws one strip per job and item.
3. **An hourly bank check.** While a bank is already open, one stock line per character per clock hour is appended and never replaced. A stock command shows the fleet-wide change beside summed gains. Trades do not move the script rate.

## Technical Context

**Language/Version**: TypeScript on Bun (repo standard)

**Primary Dependencies**: None new. Existing pieces:

- SDK: `sdk/activity.ts`, `sdk/grind-log.ts` (`appendGrindLog`, `readJsonlTail`)
- Fleet: `.cursor/skills/wake-fleet/scripts/fleet-report.ts`, `fleet-rates.ts`, `roster.ts`
- Bank picture: `.cursor/skills/fleet-bank-canvas/scripts/build-bank-canvas.ts` (observe-only; latest snapshot stays)
- Chart host: `cursor/canvas` (`BarChart` is the wrong shape for hundreds of hourly points; the strip is inline SVG in the generated canvas, same constraints as the bank canvas)

**Storage**: Flat files, bounded writes, bounded tail reads. See data-model.md.

- `bots/{name}/gains.log` — one JSONL line per kept stack
- `bots/{name}/heartbeat.log` — existing snapshots, plus `jobKey`
- `bots/{name}/bank-stock.log` — at most one JSONL bank picture per clock hour

**Testing**: `bun test` on pure functions with injected clocks and writers, following `sdk/test/fleet-rates.test.ts` and `sdk/test/activity-events.test.ts`. Merge gate: `bun run check`.

**Target Platform**: The macOS host that already runs the fleet. Hour buckets use that host's local timezone.

**Project Type**: CLI tooling plus one SDK method, inside the existing monorepo. The chart is a generated canvas, not a new web app.

**Performance Goals**:

- Recording a gain is one append and must not stall the grind.
- `fleet-report yields` for the roster finishes in under 10 seconds, reading only a bounded tail per bot.
- The canvas rebuilds from that same computation. It does not connect to the game.

**Constraints**:

- Do not read a whole `grind.log`, `gains.log`, or `bank-stock.log`.
- Do not sample away gain lines. Do not change prose-log sampling.
- A failed gain or stock write must not stop the activity.
- Do not open a bank, walk a character to one, or attach a controller in order to measure.
- Do not invent an item rate from XP, from `estimateFishFromXp`, or from `Banked N` prose.
- Do not edit `bots/{username}/*.ts` (preview rule). Shared `bots/quests/` callers only.
- Game content and the gateway stay unchanged.
- Existing `xpPerHour` / `gpPerHour` keep their current meaning.

**Scale/Scope**: About 45 roster characters, almost all on `fishing-route.ts`, `thieving-route.ts`, `magic-trees.ts`, or `green-dragons.ts`. Gain volume at the busy end is well under the 8 MB log cap for 7 days (research R4). The work touches:

- `sdk/activity.ts` and `sdk/grind-log.ts` only if the tail reader needs a documented bound (the reader already accepts `tailBytes` / `maxRecords`)
- one new yield module and one new stock module under wake-fleet scripts
- `fleet-report.ts` gains two views
- roster grind scripts that already know a kept count
- the bank-canvas observer, so a manual refresh also appends hourly stock
- one canvas generator
- tests for gains, yield math, and hourly stock

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Game is source of truth**: PASS. No game, content, or gateway changes. Counts come from inventory and bank state the client already published.
- **Observe effects, not dispatch**: PASS. A gain is a count the script already observed (items still in the inventory at the end of the step, or coins it received). A stock line is written only when `bank.isOpen` and the bank has items. A successful `send*` is not a yield.
- **Shared porcelain**: PASS. `recordGain` and `captureBankStock` live on `ActivitySession`. Yield math and the hourly stock append live in one module each, shared by the report, the tests, and the canvas generator. Character scripts are not copied. Every new public method has a caller in this change: the roster grinds, plus the other shared quest scripts that already call `recordTrip`.
- **Bounded recovery**: PASS. Failed writes are swallowed after one warning, same as heartbeat and event writes. Stock capture writes at most one line per clock hour. No new retry loop.
- **Evidence-first tests**: PASS. Tests cover the spec's traps: cooked and raw recorded once, burnt omitted, a second bank write does not double the gain, trades are not gains, a full hour with no items is zero, under 10 minutes is omitted, two product flags on one script are different jobs, XP is not turned into sharks, a same-hour stock line does not erase the previous hour, and a mule transfer does not change the gatherer's rate. `bun run check` is the merge gate.
- **Spec Kit scope**: PASS. This is cross-cutting SDK and fleet reporting.

**Post-design re-check (after Phase 1)**: PASS. No constitution violation. Complexity Tracking records the two choices that look like extra surface and are not: a separate gains file, and a strip drawn in the canvas instead of `BarChart`.

## Project Structure

### Documentation (this feature)

```text
specs/004-script-item-rates/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── item-gains.md       # recordGain, gains.log, jobKey on heartbeats
│   ├── yield-view.md       # character-hour math, CLI, canvas
│   └── bank-stock.md       # hourly stock line and the fleet check
├── checklists/requirements.md
└── tasks.md                # /speckit-tasks
```

### Source Code (repository root)

```text
sdk/
├── activity.ts                 # recordGain, captureBankStock, jobKey on the heartbeat
└── test/
    ├── activity-gains.test.ts  # new: once-only write, reject bad counts, write failure does not throw
    ├── fleet-yields.test.ts    # new: median, zeros, 10-minute floor, split jobs, no XP invention
    └── bank-stock.test.ts      # new: first line in an hour sticks; next hour appends; name merge

.cursor/skills/wake-fleet/scripts/
├── fleet-yields.ts             # new: pure character-hour math
├── bank-stock.ts               # new: appendHourlyBankStock, fleet delta vs summed gains
└── fleet-report.ts             # views: yields, stock (rates/supply/flags unchanged)

.cursor/skills/fleet-bank-canvas/scripts/
└── build-bank-canvas.ts        # on a real capture, also appendHourlyBankStock; latest JSON picture stays

.cursor/skills/fleet-bank-canvas/scripts/   # or a sibling script next to fleet-report
└── build-yield-canvas.ts       # new: runs the yield computation, writes the canvas

bots/quests/
├── fishing-route.ts            # record kept raw/cooked by name; stop summing raw+cooked+burnt
├── magic-trees.ts              # record magic logs held before deposit, not the bank total
├── thieving-route.ts           # record coins gained since the previous record, once per bank/mule step
├── green-dragons.ts            # record each drop kept this trip, by name
└── bank-fletch.ts, rune-rocks.ts, rimmington-iron.ts, mining-guild.ts,
    hobgoblins.ts, essence.ts   # recordGain(product, deposited) beside the existing recordTrip
```

`bots/jackthief/bowstrings.ts` and `bots/Jackpoo1/bowstrings.ts` also call `recordTrip`. They are per-character files and are not on the roster. This change does not edit them.

**Structure Decision**: Keep the 003 split. The SDK writes facts (gains, presence, stock). Pure functions under wake-fleet compute the view. The canvas is a rendering of the CLI's JSON, generated the same way as the fleet bank canvas. The latest-only bank picture used by that canvas is left in place; history is the new per-bot stock log.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| A third JSONL file (`gains.log`) beside `heartbeat.log` and `events.log` | Gains are item counts. Heartbeats are balances. Progress events are throttled to one per kind per 30 s and carry free text. | Putting counts in the throttled progress message drops trips. Putting item maps on the 5-minute heartbeat records a balance, which returns to zero when the character banks, and misses any stack gained and banked between snapshots. |
| Strip plot as canvas SVG rather than `BarChart` | The spec's point is one character-hour. A day of the fishing roster is hundreds of points, and each point must stay identifiable. | `BarChart` categories are one bar per label. Hundreds of hourly labels are not a distribution the operator can read. A table of medians alone hides the shape the spec asks for. |
