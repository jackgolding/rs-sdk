# Quickstart: Autonomous Activity Recovery

## Prerequisites

- `bun install` at repo root
- Pathfinding data available (existing `initPathfinding()` / fetch collision as today)
- Ghostty + tmux for the fleet viewer (`bots/watch-fleet.sh`)
- Jackpoo1 able to pick flax and spin; Jackpoo2 with Rune Mysteries done and a pickaxe

## Unit checks (CI)

```bash
bun test sdk/test/walkto-blocked-start.test.ts \
         sdk/test/open-bank-skill-dialog.test.ts \
         sdk/test/try-open-blocking-door.test.ts \
         sdk/test/open-shop-cant-reach.test.ts \
         sdk/test/activity-session.test.ts \
         sdk/test/essence-trip.test.ts \
         sdk/test/flax-arrival.test.ts \
         sdk/test/show-intent.test.ts \
         sdk/test/walkto-partial-path.test.ts \
         sdk/test/temporary-door-blocklist.test.ts

bun run check
```

Expected: all tests pass; typecheck and generated API docs stay in sync if `showIntent` / `ActivitySession` are exported.

## Live canaries (operator)

Open the fleet window:

```bash
bash bots/watch-fleet.sh
```

Healthy lines are quiet (**LOG**). Recovering stalls are yellow (**WARN**). A bot that needs you is red (**ERROR**).

In another terminal:

```bash
bun bots/Jackpoo1/bowstrings.ts
bun bots/Jackpoo2/essence.ts
```

Expected:

1. Jackpoo1: if not at flax, travel runs in-process, then grind starts (no second command).
2. Jackpoo2: teleport from Aubury → mine until full → portal → Varrock east bank. Already in the mine skips teleport.
3. Local game messages show phase intent. Public chat does not.
4. Ghostty: log while healthy, warn during recovery, error only on stop. No tick-spam of "bank open failed".
5. After a named stall, recovery finishes the trip within 3 minutes or the pane goes red with a stop reason.

## 50-trip bar

Leave both canaries until each grind.log shows 50 consecutive successful trips (≥25 bowstrings / ≥25 essence) or an ERROR stop. A human restart before 50 trips means that canary is not done.

## Travel-only (optional)

If `to-flax.ts` remains, it must import the same travel function and must not be required for overnight flax grinding. Rune Mysteries walkthrough is not part of this feature's bar.
