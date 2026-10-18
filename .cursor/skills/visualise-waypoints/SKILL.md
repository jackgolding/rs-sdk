---
name: visualise-waypoints
description: >-
  Opens a local map webview of walking waypoints so the user can hover a
  tile and read its (x, z) / tile id, then tell the agent which waypoints
  to change. Use only when the user asks to visualise, show, plot, or
  inspect waypoints, a walk route, or tile ids on a map.
---

# Visualise waypoints

Open a tile map of the current walking route. The user hovers tiles to
read ids, then tells you what to change. Do **not** edit waypoints until
they reply with new coordinates.

## When this applies

Only when the user asks to visualise / show / plot waypoints or tile ids.
Do not open the map just because a script contains a walk list.

## Steps

1. **Collect the live list** from the script or message in play (arrays
   named `WAYPOINTS`, `*_TO_*`, or successive `walkTo(x, z)` / `bot.walkTo`
   calls). Keep labels if they exist. Prefer `bots/quests/tiles.ts` for
   shared Kandarin lists. Skip `bot.env`. If a
   bot is named, you may add `--player x,z` from `bun sdk/cli.ts {username}`.
2. **Validate every waypoint against collision** before opening the map or
   writing anything. From the repo root, check each tile plus each leg with
   the SDK's own pathfinding (`initPathfinding`, `isTileWalkable`,
   `findLongPath` — same data the viewer colours: brown/blocked = unwalkable
   lava/water, e.g. red-dragon isle 3192,3853):

   ```bash
   bun -e "
   import { initPathfinding, isTileWalkable, isZoneAllocated, findLongPath } from './sdk/pathfinding.ts';
   initPathfinding();
   const pts = [[3200,3829],[3202,3816]];
   for (const [x,z] of pts) console.log(x+','+z, 'alloc='+isZoneAllocated(0,x,z), 'walk='+isTileWalkable(0,x,z));
   console.log('legs:', findLongPath(0, 3200,3829, 3202,3816)?.length ?? 'NO PATH');
   "
   ```

   Drop or move any tile that reads `walk=false`, and re-route any leg that
   returns `NO PATH`. Never propose, display, or write a route that clicks
   an invalid tile — re-validate user-supplied tiles the same way before
   applying them.
3. **Open the viewer** from the repo root. Run it in the **background**
   (`block_until_ms: 0`) so the local map server stays up:

   ```bash
   bun .cursor/skills/visualise-waypoints/scripts/open.ts \
     --title "Varrock mine → west bank" \
     --waypoints '[{"x":3270,"z":3380,"label":"leave mine"},{"x":3185,"z":3436,"label":"west bank"}]'
   ```

   Compact form also works: `--waypoints 3270,3380;3250,3395;3185,3436`.
   Optional: `--player 3285,3365` `--level 0` `--pad 48`.
   The map is at `http://127.0.0.1:4731/` — mention that URL.
4. Tell the user the map is open, quote the current numbered list, and
   **stop**. Ask them to hover a tile (click copies `{ x, z }`) and reply
   like: `change waypoint 3 to 3210, 3425`.
5. **After they reply**, validate their tiles against collision (step 2),
   then apply only the tiles they named. If the file is
   under `bots/`, follow preview-bot-scripts: show the full script or
   diff and wait for approval before writing.

## Waypoint shape

```ts
{ x: number; z: number; label?: string }
```

Tile **id** in the HUD is `level_mx_mz_lx_lz` (same as `CoordGrid.formatString`).
World coords `{ x, z }` are what bot scripts use.

## Do not

- Invent extra waypoints or a longer route than they asked to inspect.
- Route onto brown/blocked tiles — the viewer colours unwalkable lava/water
  brown for a reason; every waypoint and leg must pass step 2 first.
- Keep iterating the map after opening; wait for their tile ids.
- Use `/mapview` on the game server for this — it has no hover-id HUD.
