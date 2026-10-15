---
name: fleet-concurrent
description: >-
  Run fleet lite, grind, wake, and launchd work concurrently. Use when starting,
  restarting, to-lite, to-chrome, or waking many bots; when writing a sleep /
  stagger / for-loop between names; or when the user says do not batch or stagger.
---

# Fleet concurrent

Default: **everything concurrently**. Do not stagger, sleep between names, or
restart one bot at a time.

Exception: **shop stock** (and the same class of shared depleting inventory —
Harry harpoons, general-store buys, GE bulk that would race one book). Only
then serialize, and only the shop step. Stagger is not a gateway, login, CPU,
or pathfinding precaution.

## Do

```bash
bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts start Name1 Name2 Name3 --force
bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts restart Name1 Name2 Name3
bun .cursor/skills/lite-client/scripts/lite-launchd.ts to-lite Name1 Name2 Name3
```

One command, all names. `start`/`restart` already loop with no delay.
`--verify` may wait in parallel; it is not a reason to serialize starts.

## Do not

```bash
# ❌ BAD — agent-invented stagger
for n in "${names[@]}"; do
  bun .../fleet-launchd.ts restart "$n"
  sleep 8
done
```

Do not add `sleep` / `Bun.sleep` between fleet names for idle-timeout, lite
login races, or `initPathfinding`. Those are handled per-process (sdk_ping,
launchd KeepAlive, lite's own login retry).

## Shop exception

Serialize only the buy/sell against one shop or one GE book. Walk, login,
controller attach, and grind restart stay concurrent. Thieving mule-bank
stagger in `thieving-route.ts` is that class of exception — do not copy it
onto wake/lite/launchd.
