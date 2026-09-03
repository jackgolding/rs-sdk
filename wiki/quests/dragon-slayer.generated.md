# Dragon Slayer (generated)

> Auto-generated from server RS2 source. Slug: `dragon`, varp: `%dragonquest`, complete: `dragon_complete` (= 10).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `dragon` |
| Progress varp | `%dragonquest` |
| Complete constant | `dragon_complete` (10) |

## NPCs

### _sailor (`_sailor`)
- Spawn: not in map data (instanced / moved / members)

### Ned (`dragonslayer_ned`)
- Primary spawn: (3046, 9640, level 3)
- Other spawns: (2854, 3235, level 0)

### Duke Horacio (`duke_of_lumbridge`)
- Primary spawn: (3212, 3220, level 1)

### Guild master (`guildmaster`)
- Primary spawn: (3191, 3362, level 0)

### Klarense (`klarense`)
- Primary spawn: (3047, 3204, level 0)

### Ned (`ned`)
- Primary spawn: (3100, 3258, level 0)

### Oziach (`oziach`)
- Primary spawn: (3069, 3517, level 0)

### Olaf the Bard (`viking_olaf`)
- Primary spawn: (2673, 3683, level 0)

## Items

- `air_talisman` — Air talisman
- `antidragonbreathshield` — Dragonfire shield
- `ball_of_wool` — Ball of wool
- `black_full_helm` — Black full helm
- `black_platebody` — Black platebody
- `black_platelegs` — Black platelegs
- `coins` — Coins
- `dragonmap` — Crandor map
- `mappart1` — Map part
- `mappart2` — Map part
- `mappart3` — Map part
- `melzarkey` — Maze key
- `nails` — Nails
- `plainwig` — Wig
- `rope` — Rope
- `trail_clue_easy_vague012` — Clue scroll
- `trail_clue_hard_riddle014` — Clue scroll
- `trail_clue_hard_riddle014_puzzlebox` — Puzzle box
- `viking_enchanted_strung_lyre` — Enchanted lyre
- `viking_golden_wool` — Golden wool
- `viking_musical_tree_branch` — Branch
- `viking_new_boots` — Sturdy boots
- `viking_song` — Fremennik ballad
- `viking_strung_lyre` — Lyre
- `viking_unstrung_lyre` — Unstrung lyre
- `woodplank` — Plank

## State machine

### `quest_dragon_not_started` (value 0)

**Journal:** I can start this quest by speaking to the Guildmaster in the Champions' Guild, south-west of Varrock. I will need to be able to defeat a level 83 dragon. To enter the Champions' Guild I need 32 Quest Points.

### `quest_dragon_spoken_to_guildmaster` (value 1)

**Journal:** I should speak to Oziach, who lives by the cliffs to the west of Edgeville.

### `quest_dragon_spoken_to_oziach` (value 2)

**Journal:** I should return to Oziach for more detailed instructions.

### `quest_dragon_bought_ship` (value 3)

**Journal:** I should return to Oziach for more detailed instructions.

### `quest_dragon_repaired_ship` (value 7)

**Journal:** To defeat the dragon I will need to find a map to Crandor, a ship, a captain to take me there and some kind of protection against the dragon's breath. I bought a ship in Port Sarim called the Lady Lumbridge. I still need to find a captain for my ship.

### `quest_dragon_ned_given_map` (value 8)

**Journal:** I bought a ship in Port Sarim called the Lady Lumbridge. Captain Ned from Draynor Village has agreed to sail the ship to Crandor for me. Now I should go to my ship in Port Sarim and set sail for Crandor!

### `quest_dragon_sailed_to_crandor` (value 9)

**Journal:** Now that I have found the secret passage leading from Karamja to Crandor I don't need to worry about having a seaworthy ship or a captain fit to sail it anymore.

### `dragon_complete` (value 10)

**Journal:** Quest complete.

## Source scripts

- `scripts/quests/quest_viking/scripts/viking_olaf.rs2`
- `scripts/quests/quest_hero/scripts/quest_hero.rs2`
- `scripts/quests/quest_dragon/scripts/elvarg.rs2`
- `scripts/quests/quest_dragon/scripts/dragonslayer_ned.rs2`
- `scripts/quests/quest_dragon/scripts/crandor_map.rs2`
- `scripts/quests/quest_dragon/scripts/crandor.rs2`
- `scripts/quests/quest_dragon/scripts/lady_lumbridge.rs2`
- `scripts/quests/quest_dragon/scripts/quest_dragon.rs2`
- `scripts/levelrequire/scripts/levelrequire.rs2`
- `scripts/areas/area_draynor/scripts/ned.rs2`
- `scripts/areas/area_varrock/scripts/guild_master.rs2`
- `scripts/areas/area_edgeville/scripts/oziach.rs2`
- `scripts/areas/area_lumbridge/scripts/duke_horacio.rs2`
- `scripts/areas/area_port_sarim/scripts/sailors.rs2`
- `scripts/areas/area_port_sarim/scripts/klarense.rs2`
- `scripts/general/scripts/quests.rs2`
