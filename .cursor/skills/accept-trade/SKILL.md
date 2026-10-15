---
name: accept-trade
description: >-
  Auto-accept all trade requests and trade screens (both offer and confirmation windows)
  from JackThief (or any designated bot) across all fleet accounts. Use for Yanille
  stack trades; see learnings/gateway-fleet.md for fleet-scale controller rules.
---

# Accept Trade Skill

Automatically connects all fleet accounts (or a specific bot) to listen for incoming trade requests and automatically accept both trade screens (`trademain` offer window and `tradeconfirm` confirmation window).

## Usage

```bash
# Listen on all fleet accounts for trades from JackThief
bun bots/quests/accept-trades.ts jackthief

# Listen on all fleet accounts for trades from another account
bun bots/quests/accept-trades.ts {senderName}
```

## How It Works

- Connects to the accounts using `BotSDK`.
- Listens for `"X wishes to trade with you."` trade requests.
- Accepts the trade request.
- Automatically confirms the first offer window (`trademain`).
- Automatically confirms the second confirmation window (`tradeconfirm`).
- Logs all received items to the console and loops continuously for subsequent trades.

## Fleet scale

- Prefer **one** fleet-wide accept loop (`converge-and-accept-trade.ts --accept-only` or `accept-trades.ts`), not several overlapping converge processes.
- `--except` manual Chrome accounts and anyone with a walk-only subset running.
- Trade lines go to **script stdout**, not `bots/{name}/grind.log`.
- Gateway architecture and stale-state pitfalls: [`learnings/gateway-fleet.md`](../../learnings/gateway-fleet.md).
