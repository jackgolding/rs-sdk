# Hero's Quest (generated)

> Auto-generated from server RS2 source. Slug: `hero`, varp: `%heroquest`, complete: `hero_complete` (= 15).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `hero` |
| Progress varp | `%heroquest` |
| Complete constant | `hero_complete` (15) |

## NPCs

### _legends_guard (`_legends_guard`)
- Spawn: not in map data (instanced / moved / members)

### Achietties (`achietties`)
- Primary spawn: (2903, 3510, level 0)

### Alfonse the waiter (`alfonse_the_waiter`)
- Primary spawn: (2793, 3188, level 0)

### Charlie the cook (`charlie_the_cook`)
- Primary spawn: (2790, 3191, level 0)

### Garv (`garv`)
- Primary spawn: (2776, 3186, level 0)

### Grip (`grip`)
- Primary spawn: (2774, 3192, level 0)

### Grubor (`grubor`)
- Primary spawn: (2812, 3171, level 0)

### High Priest (`high_priest_of_entrana`)
- Primary spawn: (2851, 3349, level 0)

### Katrine (`katrine`)
- Primary spawn: (3186, 3385, level 0)

### Straven (`straven`)
- Primary spawn: (3246, 9780, level 0)

### Trobert (`trobert`)
- Primary spawn: (2806, 3174, level 0)

### Agnar (`viking_man`)
- Primary spawn: (2642, 3677, level 0)

### Olaf the Bard (`viking_olaf`)
- Primary spawn: (2673, 3683, level 0)

## Items

- `black_full_helm` — Black full helm
- `black_platebody` — Black platebody
- `black_platelegs` — Black platelegs
- `hot_feather` — Fire feather
- `ice_gloves` — Ice gloves
- `id_papers` — Id papers
- `intelligence_report` — Scroll
- `lava_eel` — Lava eel
- `master_thief_armband` — Thieves' armband
- `misc_key` — Miscellaneous key
- `petecandlestick` — Pete's candlestick
- `phoenix_crossbow` — Phoenix crossbow
- `phoenixkey2` — Key
- `viking_enchanted_strung_lyre` — Enchanted lyre
- `viking_golden_wool` — Golden wool
- `viking_musical_tree_branch` — Branch
- `viking_new_boots` — Sturdy boots
- `viking_song` — Fremennik ballad
- `viking_strung_lyre` — Lyre
- `viking_unstrung_lyre` — Unstrung lyre

## State machine

### `hero_not_started` (value 0)

### `hero_started` (value 1)

### `hero_phoenix_gangmember_spoken` (value 2)

### `hero_phoenix_talked_alfonse` (value 3)

### `hero_phoenix_talked_charlie` (value 4)

### `hero_phoenix_killed_grip` (value 5)

### `hero_phoenix_obtained_armband` (value 6)

### `hero_blackarm_gangmember_spoken` (value 7)

### `hero_blackarm_hq_door_unlocked` (value 8)

### `hero_blackarm_id_papers_obtained` (value 9)

### `hero_blackarm_mansion_unlocked` (value 10)

### `hero_blackarm_id_papers_given` (value 11)

### `hero_blackarm_looted_chest` (value 12)

### `hero_blackarm_obtained_armband` (value 13)

### `hero_complete` (value 15)

**Journal:** Quest complete.

## Source scripts

- `scripts/quests/quest_viking/scripts/viking_olaf.rs2`
- `scripts/quests/quest_viking/scripts/viking_citizen.rs2`
- `scripts/quests/quest_hero/scripts/npcs/charlie_the_cook.rs2`
- `scripts/quests/quest_hero/scripts/npcs/trobert.rs2`
- `scripts/quests/quest_hero/scripts/npcs/grip.rs2`
- `scripts/quests/quest_hero/scripts/npcs/garv.rs2`
- `scripts/quests/quest_hero/scripts/npcs/grubor.rs2`
- `scripts/quests/quest_hero/scripts/objs/fire_feather.rs2`
- `scripts/quests/quest_hero/scripts/quest_hero.rs2`
- `scripts/quests/quest_hero/scripts/locs/brimhaven_restaurant.rs2`
- `scripts/quests/quest_hero/scripts/locs/brimhaven_blackarm_hq.rs2`
- `scripts/quests/quest_hero/scripts/locs/brimhaven_scarface_mansion.rs2`
- `scripts/quests/quest_legends/scripts/legends_guard.rs2`
- `scripts/levelrequire/scripts/levelrequire.rs2`
- `scripts/areas/area_brimhaven/scripts/alfonse_the_waiter.rs2`
- `scripts/areas/area_varrock/scripts/straven.rs2`
- `scripts/areas/area_varrock/scripts/katrine.rs2`
- `scripts/areas/areas_heroes_guild/scripts/achietties.rs2`
- `scripts/areas/areas_heroes_guild/scripts/heroes_entrance.rs2`
- `scripts/areas/area_entrana/scripts/high_priest_of_entrana.rs2`
- `scripts/areas/area_entrana/scripts/entrana_monk.rs2`
- `scripts/general/scripts/quests.rs2`
- `scripts/drop tables/scripts/entrana_firebird.rs2`
- `scripts/drop tables/scripts/grip.rs2`
