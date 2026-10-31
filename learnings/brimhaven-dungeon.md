# Brimhaven Dungeon — route to the iron and steel dragons

Source of truth: `server/content/scripts/areas/area_karamja/scripts/karam_dungeon.rs2`,
spawns in `maps/m42_147.jm2` (npc 1591 iron_dragon, 1592 steel_dragon), drops in
`drop tables/scripts/{iron,steel}_dragon.rs2` (dragon platelegs, soul runes).
Obstacle tiles probed in-game on the local server (qlck1, 2026-10-31).

## Entry

- Saniboch (`tribesman_doorman`) takes **875 coins** once (`%karam_dungeon_varbit`);
  then the tree (`dungeon_tree_closed`) teleports to **(2713, 9564)**.
- Exit loc `karam_dungeon_exit` teleports to (2745, 3152), by Saniboch.

## Cheapest route: Agility 12, axe for Woodcutting 34

Offline `findLongPath` cannot see through the vines (they are locs, not doors),
so the route is legs between obstacles. Each leg below is pathfinder-reachable.

| Leg | From | Obstacle | Gate |
|---|---|---|---|
| 1 | entry (2713,9564) | Vines (2690,9564) `Chop-down` → (2689,9564) | axe, WC 10 |
| 2 | (2689,9564) | Stepping stone (2649,9561) `Jump-from` → (2646,9556) | Agility 12; a fall costs hp/10+1 and drops you back |
| 3 | (2646,9556) | Vines (2675,9479) `Chop-down` → (2676,9479) | WC 34 |
| 4 | (2676,9479) | Vines (2694,9482) `Chop-down` → (2695,9482) | WC 34 |
| 5 | (2695,9482) | walk to the dragons | — |

Dragons seen: iron (2703,9435), (2712,9447); steel (2706,9450), (2716,9442).
Baby red dragons sit at (2710,9499) by the second pipe.

Not needed for this route: vines 2 (2683,9569) and 3 (2673,9499), pipe 1
(2655,9567↔9571, Agility 34), pipe 2 (2698,9493↔9498, Agility 22, lands by the
dragons from the baby-red side), bamboo log (Agility 30).

## Fighting them

`metal_dragon.rs2`: in melee range 3 in 4 attacks are a headbutt (`npc_default_attack`,
blocked by Protect from Melee) and 1 in 4 is dragonfire (anti-dragon shield caps it;
"metal dragon breath does not take prot magic into account"). From range they only
breathe fire. Stand in melee range with Protect from Melee and a dragonfire shield.
Not wilderness: no PKers, so armour can be worn.
