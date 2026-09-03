# Sheep Shearer (generated)

> Auto-generated from server RS2 source. Slug: `sheep`, varp: `%sheep`, complete: `sheep_complete` (= 22).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `sheep` |
| Progress varp | `%sheep` |
| Complete constant | `sheep_complete` (22) |

## NPCs

### Councillor Halgrive (`councillor_halgrive`)
- Primary spawn: (2617, 3299, level 0)

### Doctor Orbon (`doctor_orbon`)
- Primary spawn: (2614, 3306, level 0)

### Farmer Brumty (`farmer_brumty`)
- Primary spawn: (2600, 3358, level 0)

### Fred the Farmer (`fred_the_farmer`)
- Primary spawn: (3189, 3273, level 0)

### Diseased sheep 1 (`herder_plaguesheep_1`)
- Primary spawn: (2609, 3344, level 0)
- Other spawns: (2610, 3343, level 0); (2610, 3345, level 0)

## Items

- `ball_of_wool` — Ball of wool
- `coins` — Coins
- `last_useitem` — last_useitem
- `plague_jacket` — Plague jacket
- `plague_trousers` — Plague trousers
- `poisoned_feed` — Feed

## State machine

### `sheep_not_started` (value 0)

### `sheep_started` (value 1)

### `sheep_last_wool` (value 20)

### `sheep_complete` (value 22)

**Journal:** Quest complete.

## Source scripts

- `scripts/quests/quest_sheepherder/scripts/npcs/farmer_brumty.rs2`
- `scripts/quests/quest_sheepherder/scripts/npcs/councillor_halgrive.rs2`
- `scripts/quests/quest_sheepherder/scripts/npcs/doctor_orbon.rs2`
- `scripts/quests/quest_sheepherder/scripts/npcs/diseased_sheep.rs2`
- `scripts/quests/quest_sheepherder/scripts/quest_sheepherder.rs2`
- `scripts/quests/quest_sheepherder/scripts/locs/sheepherder_gate.rs2`
- `scripts/quests/quest_sheepherder/scripts/locs/sheepherder_furnace.rs2`
- `scripts/quests/quest_sheep/scripts/quest_sheep.rs2`
- `scripts/areas/area_lumbridge/scripts/fred_the_farmer.rs2`
- `scripts/general/scripts/quests.rs2`
