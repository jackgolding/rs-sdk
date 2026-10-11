# Contract: item gains

## `ActivitySession.recordGain(item, count)` (`sdk/activity.ts`)

Records one kept stack. Does not reset recovery, does not move `lastEffectAt`, and does not replace `noteProgress` or `recordTrip`.

| Input | Rule |
|-------|------|
| `item` | Non-empty string after trim. Stored as passed, minus leading and trailing whitespace. |
| `count` | Integer ≥ 1. Anything else returns without writing. |

**Write**: Append one [item gain](../data-model.md) line to `bots/{name}/gains.log` via `appendGrindLog`. The path is `grindLogPath` with `grind.log` replaced by `gains.log`. When `grindLogPath` is unset, the method returns without writing.

**Failure**: A throw from the append is caught. The first failure in the session logs one warning. The method does not throw and does not stop the activity.

**Not a gain**:

- The same stack later deposited or banked.
- A trade received.
- Burnt food.
- A bank balance.
- An inventory coin increase that the script did not pass to `recordGain`.

Callers in this change are listed in [research R8](../research.md). They pass the kept count for that step. `fishing-route.ts` must not pass `raw + cooked + burnt` as one count.

## `jobKey`

Computed once at `ActivitySession` construction from `process.argv`, as in [data-model.md](../data-model.md). Stored on the session and copied onto gains and heartbeats.

Heartbeat records gain an optional `jobKey` field. 003 fields and validity rules are unchanged. Snapshots that fail the 003 validity check are still not written.

## `ActivitySession.recordTrip`

Unchanged. It remains a prose trip counter. Yield math does not read it.

## Prose log

`ActivitySession.log` sampling is unchanged. Gain lines are not written through `log()`.
