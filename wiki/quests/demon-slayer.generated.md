# Demon Slayer (generated)

> Auto-generated from server RS2 source. Slug: `demon`, varp: `%demonstart`, complete: `demon_complete` (= 30).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `demon` |
| Progress varp | `%demonstart` |
| Complete constant | `demon_complete` (30) |

## NPCs

### Gypsy (`aris`)
- Primary spawn: (3203, 3424, level 0)

### Captain Rovin (`captain_rovin`)
- Primary spawn: (3204, 3496, level 2)

### Sir Prysin (`sir_prysin`)
- Primary spawn: (3204, 3473, level 0)

### Traiborn (`traiborn`)
- Primary spawn: (3112, 3162, level 1)

## Items

- `bones` — Bones
- `bucket_empty` — Bucket
- `bucket_water` — Bucket of water
- `coins` — Coins
- `ice_arrow` — Ice arrows
- `mappart2` — Map part
- `silverlight` — Silverlight
- `silverlight_key_1` — Key
- `silverlight_key_2` — Key
- `silverlight_key_3` — Key
- `spinach_roll` — Spinach roll
- `trail_clue_hard_riddle015` — Clue scroll

## State machine

### `demon_not_started` (value 0)

**Journal:** I can start this quest by speaking to the Gypsy in the tent in Varrock's main square I must be able to defeat an apocalyptic demon!

### `demon_talked_aris` (value 1)

**Journal:** I spoke to the Gypsy in Varrock Square who saw my future. Unfortunately it involved killing a demon who nearly destroyed Varrock over 150 years ago. To defeat the demon I need the magical sword of Silverlight. I should ask Sir Prysin in Varrock Palace where it is.

### `demon_key_hunt` (value 2)

### `demon_find_bones` (value 3)

### `demon_got_traiborn_key` (value 28)

### `demon_silverlight` (value 29)

**Journal:** I spoke to the Gypsy in Varrock Square who saw my future. Unfortunately it involved killing a demon who nearly destroyed Varrock over 150 years ago. I reclaimed the magical sword Silverlight from Sir Prysin. Now I should go to the stone circle south of the city and destroy Delrith using Silverlight!

### `demon_complete` (value 30)

**Journal:** Quest complete.

## Source scripts

- `scripts/quests/quest_demon/scripts/demon_slayer.rs2`
- `scripts/areas/area_draynor/scripts/traiborn.rs2`
- `scripts/areas/area_varrock/scripts/sir_prysin.rs2`
- `scripts/areas/area_varrock/scripts/captain_rovin.rs2`
- `scripts/areas/area_varrock/scripts/gypsy.rs2`
- `scripts/general/scripts/quests.rs2`
- `scripts/npc/scripts/dark_wizard.rs2`
- `scripts/skill_combat/scripts/npc/npc_combat.rs2`
