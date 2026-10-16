---
name: fleet-bank-canvas
description: >-
  Snapshot bank contents across every roster account and render a combined,
  searchable Cursor canvas with RuneScape item icons and per-account hover
  breakdowns. Use when the user asks for the combined fleet bank, total bank
  value, item holdings across accounts, or a bank inventory canvas.
---

# Fleet bank canvas

Build the combined bank without taking control of any account.

## Run

From the repository root:

```bash
bun .cursor/skills/fleet-bank-canvas/scripts/build-bank-canvas.ts
```

### Fleet-wide fresh capture

This canvas builder does **not** open banks. A closed bank has nothing to
capture, so a run that only observes will reuse the last snapshot and still
exit 0.

To check **every** roster account, run the desk bank check. It stops running
grinds, starts lite for accounts with no live client (skip-bots are not
force-logged in), opens each account's bank, then starts those grinds again:

```bash
bun tools/fleet-desk/bank-check.ts
```

Each account follows its roster job's bank path (Ardougne for knights,
Catherby for fishers, the wilderness road for dragon jobs). A job with no
bank walks to the closest named bank, with no distance cap. `--all` on
`snapshot-nearest-banks.ts` still omits skip-bots. Yanille-only (no walk)
remains `snapshot-yanille-banks.ts`.

```bash
# Yanille stack only (no walk; skip anyone not already at Yanille bank)
bun bots/quests/snapshot-yanille-banks.ts --all
```

Without the desk bank check, the canvas mostly reuses cached snapshots (only accounts that naturally bank during the wait are captured).

The command observes every roster account concurrently. It captures a bank
only when the account's existing job naturally opens the bank, merges those
captures with the last known snapshots, renders the required item icons, and
writes:

`/Users/<user>/.cursor/projects/<workspace>/canvases/fleet-bank.canvas.tsx`

Options:

```bash
# Wait up to 15 minutes for natural bank openings (default: 3 minutes)
bun .cursor/skills/fleet-bank-canvas/scripts/build-bank-canvas.ts --wait-seconds 900

# Rebuild immediately from cached snapshots
bun .cursor/skills/fleet-bank-canvas/scripts/build-bank-canvas.ts --wait-seconds 0

# Observe only selected accounts while retaining cached snapshots for others
bun .cursor/skills/fleet-bank-canvas/scripts/build-bank-canvas.ts --bots Jackpoo1,jackthief

# Omit accounts from observe + combined totals (cache is kept)
bun .cursor/skills/fleet-bank-canvas/scripts/build-bank-canvas.ts --except jackthief --wait-seconds 0
```

After it finishes, link
`[fleet-bank](/Users/<user>/.cursor/projects/<workspace>/canvases/fleet-bank.canvas.tsx)`.
Report captured / roster coverage and name stale or missing accounts. Do not
paste the item table into chat.

## Safety and data rules

- Account names and views come from `roster.ts`; never paste another bot list.
- Connections are `observe` only. Never open banks, wake bots, stop jobs, or
  pre-empt controllers to refresh this canvas.
- A closed bank publishes no items. Wait for normal scripts to bank and retain
  the newest complete snapshot per account.
- Keep snapshot timestamps. The canvas must visibly distinguish fresh, stale,
  and missing accounts.
- Counts and combined value include bank contents only, not inventory or worn
  equipment.
- Item value is `ObjType.cost × count`, not a player-market price.
- Render icons into an embedded atlas. The canvas itself must not fetch game
  assets or import anything except `cursor/canvas`.
- If icon rendering fails, still create the canvas with item names and counts,
  and report the icon failure.

## Canvas behavior

- Show combined item count, distinct items, base value, and account coverage.
- Use a compact 32×32 icon grid with stack counts.
- Hovering an item must show its name, combined count, combined value, and
  every account holding it with that account's count.
- Support search, roster-view filtering (`all`, `fleet`, `loves`, `army`),
  per-account filtering, and sorting by value, quantity, freshness (newest
  first), or name.
- Include a compact account freshness section with relative age (`3h 12m ago`)
  and capture time per account, newest first. Click a name to filter the grid.
- Use host theme tokens. No gradients, emojis, or box-shadows.
