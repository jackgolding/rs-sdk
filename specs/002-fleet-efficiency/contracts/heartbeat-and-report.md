# Contract: Heartbeat records and fleet report

**Feature**: 002-fleet-efficiency | New CLI: `.cursor/skills/wake-fleet/scripts/fleet-report.ts`

## Heartbeat record (JSONL, one per line)

File: `bots/{name}/heartbeat.log` (bounded 8 MiB → keep 4 MiB, rotated by `rotate-logs.ts`, gitignored by `*.log`).

```json
{"t":1756468800000,"session":1756465200000,"job":"thieving-route","xp":{"thieving":13034431,"hitpoints":812031},"coins":184203,"x":2662,"z":3305}
```

| Field | Required | Meaning |
|-------|----------|---------|
| `t` | yes | Epoch ms of capture |
| `session` | yes | Session start epoch ms; change = restart |
| `job` | yes | ActivitySession name |
| `xp` | yes | Skill → total xp (skills with xp > 0 only) |
| `coins` | yes | Total coins currently held |
| `x`, `z` | yes | Position |

Reader rules: skip unparseable lines (rotation may truncate the first line); a time gap means "not running", never interpolate; rates require ≥2 records inside the window.

## Report CLI

```
bun .cursor/skills/wake-fleet/scripts/fleet-report.ts [view] [--window 6h] [--json]
```

Views:

| View | Output |
|------|--------|
| `rates` (default) | Per bot: job, xp/hr per trained skill, gp/hr, heartbeat age, session restarts in window. Fleet totals row. |
| `supply` | Food produced/day (fisher output from xp deltas → fish-count estimates) vs consumed/day (fleet-wide), explicit surplus/deficit. |
| `flags` | Reassignment candidates with reasons: `maxed_skill` (99 in the job's trained skill), `zero_value` (sustained ~0 gp/hr and ~0 xp/hr), `capped`/`intervene` carry-overs from shepherd state. |

Contract:

- Reads only bounded tails of heartbeat files and the shepherd state file; never a whole grind.log. Completes in <30s for 46 bots (SC-004).
- `--json` emits machine-readable rows mirroring the table; pretty table is the default (mirrors `fleet-status.ts --pretty` conventions).
- Bots with no heartbeat data appear with `no data`, never fabricated zeros.
- Window parsing accepts `Nh`/`Nd`; default 6h; `supply` and `flags` default to 72h to smooth burstiness.
- Exit code 0 even when flags exist (it is a report, not a gate); non-zero only on unreadable roster.

## Shared helpers (single definitions)

- Bounded JSONL tail reader lives in `sdk/grind-log.ts` (used by report and fleet-status; replaces any ad-hoc parsing).
- Rate math (window selection, delta computation, zero-rate predicate incl. bursty widening) lives in one module consumed by both `fleet-report.ts` and `fleet-status.ts` — one definition of "stalled".

## Test obligations

Rate math with fixture JSONL: normal rates, restart mid-window (session change; xp totals monotonic so deltas remain valid), rotation-truncated first line, no-data, zero-rate vs bursty windows, maxed-skill flag at exactly the 99 xp threshold.
