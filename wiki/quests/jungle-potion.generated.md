# Jungle Potion (generated)

> Auto-generated from server RS2 source. Slug: `junglepotion`, varp: `%junglepotion`, complete: `junglepotion_complete` (= 12).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `junglepotion` |
| Progress varp | `%junglepotion` |
| Complete constant | `junglepotion_complete` (12) |

## NPCs

### Mosol Rei (`mosol_rei`)
- Primary spawn: (2883, 2951, level 0)

### Timfraku (`tbwt_timfraku`)
- Primary spawn: (2780, 3087, level 1)

### Trufitus (`trufitus`)
- Primary spawn: (2809, 3086, level 0)

## Items

- `coins` — Coins
- `mosol_wampum_belt` — Wampum belt

## State machine

### `junglepotion_not_started` (value 0)

**Journal:** I can start this quest by speaking to Trufitus Shakaya who lives in the main hut in Tai Bwo Wannai village on the island of Karamja.

### `junglepotion_get_snake_weed` (value 1)

**Journal:** I need to pick some fresh Snakeweed for Trufitus.

### `junglepotion_found_snake_weed` (value 2)

**Journal:** I picked some fresh Snakeweed for Trufitus. I need to give the Snake Weed to Trufitus.

### `junglepotion_get_ardrigal` (value 3)

**Journal:** I've given Snakeweed to Trufitus. I need to pick some fresh Ardrigal for Trufitus.

### `junglepotion_found_ardrigal` (value 4)

**Journal:** I've given Snakeweed to Trufitus. I picked some fresh Ardrigal for Trufitus. I need to give the Ardrigal to Trufitus.

### `junglepotion_get_sito_foil` (value 5)

**Journal:** I've given Snakeweed and Ardrigal to Trufitus. I need to pick some fresh Sito Foil for Trufitus.

### `junglepotion_found_sito_foil` (value 6)

**Journal:** I've given Snakeweed and Ardrigal to Trufitus. I picked some fresh Sito Foil for Trufitus. I need to give the Sito Foil to Trufitus.

### `junglepotion_get_volencia_moss` (value 7)

**Journal:** I've given Snakeweed, Ardrigal and Sito Foil to Trufitus. I need to pick some fresh Volencia Moss for Trufitus.

### `junglepotion_found_volencia_moss` (value 8)

**Journal:** I've given Snakeweed, Ardrigal and Sito Foil to Trufitus. I picked some fresh Volencia Moss for Trufitus. I need to give the Volencia Moss to Trufitus.

### `junglepotion_get_rogues_purse` (value 9)

**Journal:** I've given Snakeweed, Ardrigal, Sito Foil and Volencia Moss to Trufitus. I need to pick some fresh Rogues Purse for Trufitus.

### `junglepotion_found_rogues_purse` (value 10)

**Journal:** I've given Snakeweed, Ardrigal, Sito Foil and Volencia Moss to Trufitus. I picked some fresh Rogues Purse for Trufitus. I need to give the Rogue Purse to Trufitus.

### `junglepotion_found_all_herbs` (value 11)

**Journal:** I have given Trufitus Snakeweed, Ardrigal, Sito Foil,Volencia moss and Rogues purse. Trufitus needs to commune with the gods. I should speak to Trufitus.

### `junglepotion_complete` (value 12)

**Journal:** Quest complete.

### `junglepotion_complete_after_spoken` (value 13)

**Journal:** In Jungle Potion, Trufitus found Tai Bwo Wannai Village was safe to inhabit. To start this quest I must deliver the news to Timfraku, Chief of the village. To complete this quest I need: Level 30 Cooking Level 15 Agility Level 5 Fishing High level Agility and Herblore is a distinct advantage. I also need to be able to defeat level 48 Jogres

## Source scripts

- `scripts/quests/quest_zombiequeen/scripts/mosol_rei.rs2`
- `scripts/quests/quest_junglepotion/scripts/quest_junglepotion.rs2`
- `scripts/areas/area_karamja/scripts/trufitus.rs2`
- `scripts/areas/area_karamja/scripts/tbwt_timfraku.rs2`
- `scripts/general/scripts/quests.rs2`
