# Contract: bank stock check

## `appendHourlyBankStock(name, items, now)` (`.cursor/skills/wake-fleet/scripts/bank-stock.ts`)

| Input | Rule |
|-------|------|
| `name` | Roster character name. File is `bots/{name}/bank-stock.log`. |
| `items` | Non-empty list of `{ id, name, count }` copied from an open bank. Empty list returns without writing. |
| `now` | Used for `t` and the local `hour` bucket. |

Read the latest stock line with a bounded tail (64 KB, 5 records is enough to see the last hour). If that line's `hour` equals the current local hour, return without writing. Otherwise append one [bank stock snapshot](../data-model.md) through `appendGrindLog`.

A thrown append is caught by the caller and must not propagate out of `captureBankStock` or the canvas observer.

## `ActivitySession.captureBankStock()`

Reads `sdk.getState()`. Writes only when `bank.isOpen` is true and `bank.items.length > 0`. Does not open the bank, walk, or send packets. Does not move `lastEffectAt`.

Call sites: the bank steps in [research R8](../research.md), invoked while the bank is still open, and `build-bank-canvas.ts` after it saves a capture. The latest-only `fleet-bank-snapshots.json` write stays.

## `computeStockCheck(input) → StockCheck`

Inputs are bounded tails of `bank-stock.log` and `gains.log` (same 2 MB / 20,000 record bound as yields), an item name, and two hour buckets `from` and `to` with `from < to`.

Account selection, sums, and `gap` are defined on the fleet stock check in [data-model.md](../data-model.md).

- Gains counted in `gains` are fleet-wide for that item, not only the accounts that had both snapshots.
- `gap` is not applied to any `JobYield`.
- Shop price is not read.

## CLI

```text
bun .cursor/skills/wake-fleet/scripts/fleet-report.ts stock --item "raw shark" [--from YYYY-MM-DDTHH] [--to YYYY-MM-DDTHH] [--json]
```

- `--item` is required. Missing `--from` / `--to` means the oldest and newest distinct hours present in the tailed stock logs.
- Text output: item, the two hours, accounts included, accounts excluded, stock change, summed gains, gap.
- `--json` prints `StockCheck`.
- Exit code 1 when `--item` is missing or the hour token does not match `YYYY-MM-DDTHH`. Exit code 0 when the check runs, including when every account is excluded (the numbers are then zero and `excluded` lists them).

This command does not connect to the game and does not launch `snapshot-nearest-banks.ts`.
