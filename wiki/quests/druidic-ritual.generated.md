# Druidic Ritual (generated)

> Auto-generated from server RS2 source. Slug: `druid`, varp: `%druidquest`, complete: `druid_complete` (= 4).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `druid` |
| Progress varp | `%druidquest` |
| Complete constant | `druid_complete` (4) |

## NPCs

### Kaqemeex (`kaqemeex`)
- Primary spawn: (2924, 3486, level 0)

### Sanfew (`sanfew`)
- Primary spawn: (2897, 3426, level 1)

### Trufitus (`trufitus`)
- Primary spawn: (2809, 3086, level 0)

## Items

- `coins` — Coins
- `eadgar_dirty_druid_robe` — Dirty robe
- `eadgar_goutweed_herb` — Goutweed
- `enchanted_bear_meat` — Enchanted bear
- `enchanted_beef` — Enchanted beef
- `enchanted_chicken` — Enchanted chicken
- `enchanted_rat_meat` — Enchanted rat
- `macro_genilamp` — Lamp
- `mosol_wampum_belt` — Wampum belt
- `raw_bear_meat` — Raw bear meat
- `raw_beef` — Raw beef
- `raw_chicken` — Raw chicken
- `raw_rat_meat` — Raw rat meat

## State machine

### `druid_not_started` (value 0)

**Journal:** I can start this quest by speaking to Kaqemeex who is at the Druids Circle just North of Taverley

### `druid_started` (value 1)

**Journal:** I told Kaqemeex I would help them prepare their ceremony. I should speak to Sanfew in the village to the South

### `druid_spoken_sanfew` (value 2)

**Journal:** I told Kaqemeex I would help them prepare their ceremony. Sanfew told me for the ritual they would need me to place raw bear meat, raw chicken, raw rat meat and raw beef in the Cauldron of Thunder in the dungeon South of Taverley

### `druid_given_ingredients` (value 3)

**Journal:** I told Kaqemeex I would help them prepare their ceremony. The ceremony required various meats being placed in the Cauldron of Thunder. I did this and gave them to Sanfew. I should speak to Kaqemeex again and claim my reward

### `druid_complete` (value 4)

**Journal:** Quest complete.

## Source scripts

- `scripts/quests/quest_druid/scripts/quest_druid.rs2`
- `scripts/areas/area_karamja/scripts/trufitus.rs2`
- `scripts/areas/area_taverly/scripts/kaqemeex.rs2`
- `scripts/areas/area_taverly/scripts/sanfew.rs2`
- `scripts/general/scripts/xplamp/xplamp.rs2`
- `scripts/general/scripts/quests.rs2`
