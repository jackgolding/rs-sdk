---
name: mining-guild
description: >-
  Run and shepherd Falador Mining Guild ore grinding for Jackpoo2/4/5
  (south room mithril > coal). Use when those miners should train
  Mining in the guild, when mining-guild.ts is idle, or when checking whether
  the guild grind is efficient enough.
---

# Mining Guild

Falador Mining Guild grind for **Jackpoo2, Jackpoo4, Jackpoo5**. Mining 60 to enter. Stay in the **south room** on mithril then coal (iron if nothing else). Do not walk north for adamant.

## Commands

```bash
bun bots/Jackpoo2/mining-guild.ts
bun bots/Jackpoo4/mining-guild.ts
bun bots/Jackpoo5/mining-guild.ts
```

Prefer launching those through launchd after the roster points at `bots/quests/mining-guild.ts` (or the per-bot wrapper). Do not start them as children of a Cursor shell.

## Loop

Bank Falador east `(3012, 3355)` → ladder `(3019, 3339)` → assigned camp (do not mine the ladder cluster) → live rocks by priority, skipping tiles another player is already on.

Camps: Jackpoo2 mithril-south-east `(3050, 9738)`, Jackpoo4 mithril-south-west `(3040, 9734)`, Jackpoo5 mithril-south-mid `(3045, 9736)`. All three stay on the south mithril/coal pile. If they wander north, walk them back. Run from **King Scorpion**. Do not withdraw or eat raw/burnt fish. Bank only when inventory is full.

## Efficiency check

From repo root:

1. `bun .cursor/skills/wake-fleet/scripts/fleet-status.ts --pretty` — `command` should be `mining-guild.ts` (`commandSource` live or assignment). If the roster default is a different job (Jackpoo2 is often rune-rocks), do not fight it: edit `bots/roster.json` first, then `fleet-launchd.ts restart JackpooN`.
2. `bun sdk/cli.ts JackpooN` — in guild (`z` ~9730–9780) or at the east bank/ladder, pickaxe equipped, ores in inv or just banked.
3. Tail `bots/JackpooN/grind.log` for `Banked` lines: `addy / mith / coal / iron` counts and Mining XP.

Healthy: XP climbing, bank trips every few minutes, mix is mostly coal/mithril with occasional adamant. Unhealthy: stuck on the ladder, standing at depleted adamant with no XP, still at Doric `(2950, 3453)`, or a wake starting `essence.ts` instead.

If idle (`wake`) and the user wants the guild loop: set that bot's `script` in `bots/roster.json` if needed, then `bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts restart JackpooN`. Do not start `bun bots/JackpooN/mining-guild.ts` from a Cursor shell, and do not restart `essence.ts` unless that is the recorded assignment. Do not steal a live controller.
