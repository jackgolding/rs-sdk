# Contract: yield view

Pure function in `.cursor/skills/wake-fleet/scripts/fleet-yields.ts`. No network, no `launchctl`, no whole-file reads.

## Inputs

| Input | Source |
|-------|--------|
| Gains | `readJsonlTail` of each `bots/{name}/gains.log`, `tailBytes` 2_000_000, `maxRecords` 20_000 |
| Presence | Same bound on `heartbeat.log`, 003-valid snapshots that have `jobKey` |
| Roster | `rosterBots()`, used to list characters and to set `drift` when the live `jobKey` is not the roster command with the character name removed |
| `now` | Injected in tests; `Date.now()` in the CLI |
| `windowMs` | Default 24 hours. Clipped to 7 days |

Lines older than 7 days, or failing validation in [data-model.md](../data-model.md), are dropped before the math.

## `computeYields(input) → YieldReport`

Hour rules, presence, inclusion, and median are defined in [data-model.md](../data-model.md). This contract adds the report shape.

```text
YieldReport
  windowMs
  jobs: JobYield[]          # sorted by jobKey
  noSamples: string[]       # roster jobKeys that have zero included points in the window

JobYield
  jobKey
  drift: { name, rosterJobKey }[]    # characters seen on this jobKey whose roster key differs; may be empty
  items: ItemYield[]                 # sorted by item display name

ItemYield
  item
  median                         # number; the job is omitted from `jobs` when it has no included points at all
  points: CharacterHour[]        # included only, sorted by hour then name
  byCharacter: { name, median, hours }[]   # sorted by name
```

A roster job with no included points for any item appears in `noSamples` and not in `jobs`. Experience rates are not consulted. `estimateFishFromXp` is not consulted.

`CharacterHour.perHour` is the exact ratio, not a pre-rounded integer.

## CLI

```text
bun .cursor/skills/wake-fleet/scripts/fleet-report.ts yields [--window 24h] [--json]
```

- Default view of `fleet-report` stays `rates`. `yields` is opt-in.
- Text output, per job then per item: the median, each character's median, and the points as `name hour perHour`.
- A `noSamples` job prints `no samples` and no number.
- `--json` prints `YieldReport`.
- Exit code 0 when the report was computed, including when every job has no samples. Exit code 1 only for a bad `--window` token (same acceptance as `parseWindowArg`: digits plus `h` or `d`).

`rates`, `supply`, and `flags` are unchanged, including `gpPerHour` and `estimateFishFromXp`.

## Canvas

```text
bun .cursor/skills/fleet-bank-canvas/scripts/build-yield-canvas.ts [--window 24h]
```

Reads the same `computeYields` result. Writes `script-item-rates.canvas.tsx` under the project canvases directory already used by `build-bank-canvas.ts`. Embedded data only. No game connection.

For each `ItemYield`:

- Title is the job key, the item, and the window.
- A strip of one point per character-hour, median marked, axes labeled in clock hour and items per hour.
- A table of character, hours included, and that character's median.
- Caption states the source is gain records plus heartbeat presence, and the median rule.

`noSamples` jobs are named in one line and do not get an empty chart.

The canvas is a view. Tests assert `computeYields` and the CLI JSON, not the SVG.
