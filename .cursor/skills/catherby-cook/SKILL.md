---
name: catherby-cook
description: >-
  Cook all raw food in bank and inventory using the Catherby range for any bot.
  Use when the user asks to cook food in bank/inventory at Catherby or process raw fish.
---

# Catherby Bank Cooking

Automated routine to cook all raw food in inventory and bank using the Catherby range `(2817, 3444)` and Catherby Bank `(2809, 3441)`.

## Usage

Run `fishing-route.ts` with `--cook-all`:

```bash
bun bots/quests/fishing-route.ts <botName> --cook-all
```

Example:
```bash
bun bots/quests/fishing-route.ts jacklove1 --cook-all
```

Or using the dedicated `catherby-cook-bank.ts` script:
```bash
bun bots/quests/catherby-cook-bank.ts <botName>
```

## Routine Flow

1. **Inventory Check**: If the bot is already holding raw food, pathfinds to the Catherby range house, handles the door, and cooks the batch.
2. **Bank Loop**:
   - Walks to Catherby Bank `(2809, 3441)`.
   - Opens the bank booth.
   - Deposits all cooked and burnt items.
   - Scans bank for any remaining `raw *` items.
   - Withdraws up to 28 raw items.
   - Repeats until all raw food in bank and inventory is cooked and banked.
3. **Completion**: Logs clean status and finishes automatically.
