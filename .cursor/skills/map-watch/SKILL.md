---
name: map-watch
description: >-
  Read the public world map (/mapview, /playerpositions) to see where roster
  bots actually stand, flag ones that have not moved, and list other players
  in the wilderness. Use when bots look stuck, positions disagree with
  fleet-status, the user mentions the map view, or asks who is in the
  wilderness.
---

# Map watch

The game server publishes every online player at `GET /playerpositions`. That
is the feed behind `/mapview/`. Those tiles are server positions. Gateway
coords from `fleet-status` can be hours stale — when they disagree, trust
this feed.

`level` on the feed is the **floor** (0 = surface), not combat level. The
feed has no combat level, hitpoints, or equipment.

This skill only reads. It does not log in, walk, attack, or trade.

## Do this every time

1. From the **repo root**:

   ```bash
   bun .cursor/skills/map-watch/scripts/map-watch.ts
   ```

   JSON on stdout. Origin is the first roster `bot.env` `SERVER`, else
   `https://rs-sdk-demo.fly.dev`. Override with `--origin`.

   ```bash
   bun .cursor/skills/map-watch/scripts/map-watch.ts --pretty
   bun .cursor/skills/map-watch/scripts/map-watch.ts --gap 15
   ```

   `--gap 15` samples twice, 15 seconds apart. Use it when `summary.seen`
   is most of the fleet (no dwell history yet) or the user wants to know
   who is moving right now.

2. Movement comes from the map. Inventory and xp come from the gateway's
   last frame (`GET /state/:name`), and only when that frame is under 2
   minutes old. The script stores both clocks in
   `~/Library/Logs/rs-sdk-fleet/map-watch.json`. Inventory is the sorted
   `id:count` list, not the coin count.

   `kind` is the combination:

   | inventory | xp | movement | kind |
   | --- | --- | --- | --- |
   | no | no | no, past the job threshold | `stuck` |
   | no | no | no, under the threshold | `flat` |
   | no | no | yes | `task` |
   | yes | no | either | `task` |
   | either | yes | either | `working` |
   | not observed | | | `unknown` |

   A standing job (fishing, thieving, mining, woodcutting, cooking,
   fletching, smithing, herblore, alchemy) that stays `task` with no xp
   and no inventory change past the threshold is `stuck`. A walking job
   in that cell is travel. Thresholds: 25 min standing, 12 min green
   dragons and KBD, 8 min otherwise. A gap over 45 minutes resets the
   clocks. A missing inventory or xp sample is `unknown`, never `stuck`.

3. Reply with who is `stuck`, who is `unexpectedWildy`, and who is `absent`.
   For `stuck`, quote tile, how long gains have been flat, and `detail`.
   Mention `task` on a standing job by name. A walking job in `task` is
   travel. Mention piles (4+ roster bots on one tile). Point at `mapUrl`.
   Do not paste the full wilderness list unless they asked who is out there.

4. For a stuck or confusing bot, then run fleet-status and compare:

   ```bash
   bun .cursor/skills/wake-fleet/scripts/fleet-status.ts --pretty
   ```

   Map tile wins over gateway `x,z`. `absent` here plus `inGame` on the
   gateway means the gateway login is stale, or the bot is on another
   origin. Do not wake or restart from this skill unless they asked to
   wake the fleet.

## Wilderness list

`wilderness` in the JSON is every **non-roster** player inside
`wilderness_zones`: x 2944–3391, z 3520–6399, floors 0–3, plus the Edgeville
dungeon copy (same x, z 9920–12799, floor 0). Level is `(z - zone south edge) / 8 + 1`.
The essence mine is excluded. The KBD lair is not in those zones.

That list is a later input for a group hunt. It is not actionable yet:
without combat level the wilderness bracket is unknown. Do not walk a bot
at someone, attack, or start a hunt from this skill. When the operator
asks who is in the wilderness, summarize the list (name, wildy level,
tile, nearest roster bot). When they ask to go kill someone, say combat
level is missing from `/playerpositions` and stop.

`unexpectedWildy` means a roster bot is north of the ditch on a job that
is not green dragons, KBD, or another wilderness route.

## Do not

- Open a browser client or call `bot.walkTo` / `bot.attack` to "check".
- Call a bot stuck from a still tile alone. No inventory change, no xp, and no movement is the stuck cell.
- Treat a Yanille bank pile, by itself, as a bug.
- Use `/mapview` hover tiles for route editing — that is `visualise-waypoints`.
