# Shilo Village (generated)

> Auto-generated from server RS2 source. Slug: `mortton`, varp: `%morttonquest`, complete: `mortton_quest_complete` (= 85).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `mortton` |
| Progress varp | `%morttonquest` |
| Complete constant | `mortton_quest_complete` (85) |

## NPCs

### Razmire Keelgan (`razmire_keelgan`)
- Spawn: not in map data (instanced / moved / members)

### Ulsquire Shauncy (`ulsquire_shauncy`)
- Spawn: not in map data (instanced / moved / members)

## Items

- `coins` — Coins
- `flamtaer_hammer` — flamtaer_hammer
- `limestone` — Limestone
- `limestonebrick` — Limestone brick
- `oliveoil3` — Olive oil(3)
- `rock` — Rock
- `serum_book` — Diary
- `shade_bones1` — Loar remains
- `swamppaste` — Swamp paste
- `tinderbox` — Tinderbox
- `unidentified_rogues_purse` — Unidentified herb
- `unidentified_tarromin` — Herb
- `woodplank` — Plank

## State machine

### `mortton_read_diary` (value 5)

**Journal:** I made my way down through Mort Myre and I found the town of Mort'ton. I discovered a diary which had some interesting notes in it. Maybe it was important?

### `mortton_made_serum` (value 10)

**Journal:** I made serum 207 from tarromin, water and ashes by using Herbi Flax's diary. I wonder what the serum is used for? I used the serum on a local NPC and I've been able to ask a few questions about the place.

### `mortton_kill_shades` (value 15)

**Journal:** I have to kill five shades.

### `mortton_killed_1_shade` (value 20)

**Journal:** I've killed one shade, I need to kill another four.

### `mortton_killed_2_shades` (value 25)

**Journal:** I've killed two shades, I need to kill another three.

### `mortton_killed_3_shades` (value 30)

**Journal:** I've killed three shades, I need to kill another two.

### `mortton_killed_4_shades` (value 35)

**Journal:** I've killed four shades, I need to kill another one.

### `mortton_killed_5_shades` (value 40)

**Journal:** I've killed all five shades, I should return to Razmire now.

### `mortton_shades_to_razmire` (value 45)

**Journal:** I should show the shade remains to Ulsquire.

### `mortton_shades_to_ulsquire` (value 47)

**Journal:** Ulsquire seems to know a lot about this area, maybe if I investigate around here a little more I can help the locals.

### `mortton_ulsquire_temple` (value 50)

**Journal:** Ulsquire seems to know a lot about this area, he's quite interested in 'Flaemtaer temple' and wishes he could rebuild it.

### `mortton_rebuild_temple` (value 55)

**Journal:** I've started rebuilding the temple using limestone bricks, wooden planks and nails. I wonder what power the temple has, if any? I have some olive oil which Ulsquire said may be useful when the temple is constructed.

### `mortton_can_light_altar` (value 60)

**Journal:** There must be some way to make use of the altar that appears in the middle of the temple.

### `mortton_created_sacred_oil` (value 65)

**Journal:** Ulsquire said something about putting the Shades to rest by giving them a holy cremation, maybe this oil can help?

### `mortton_created_pyre_logs` (value 70)

**Journal:** Maybe the pyre logs are connected to the Shade remains?

### `mortton_logs_on_pyre` (value 75)

**Journal:** I need to put the shade remains on the funeral pyre and then light it in order to put the shade spirit to rest.

### `mortton_lit_pyre` (value 80)

**Journal:** The shades spirit was released, I should tell Ulsquire.

### `mortton_quest_complete` (value 85)

**Journal:** I travelled to the town of Mort'ton where the people had an affliction. I found the diary of 'Herbi Flax' and managed to work out the ingredients for a special serum. The serum worked on the afflicted and I was able to speak to several villagers. After slaying five shades and helping to rebuild a sacred temple, I was able to put the shades spirits to rest. The town has pretty much returned to normal, except for all the shade activity, but now I have a way to put the shades spirits to rest and gain access to their treasure filled lairs! @red@QUEST COMPLETE!

## Source scripts

- `scripts/quests/quest_mortton/scripts/razmire_keelgan.rs2`
- `scripts/quests/quest_mortton/scripts/quest_mortton.rs2`
- `scripts/quests/quest_mortton/scripts/ulsquire_shauncy.rs2`
- `scripts/quests/quest_mortton/scripts/serum_book.rs2`
- `scripts/minigames/game_mortton/scripts/flamtaer_temple.rs2`
- `scripts/minigames/game_mortton/scripts/mortton_pyre.rs2`
- `scripts/minigames/game_mortton/scripts/mortton_shades.rs2`
- `scripts/general/scripts/quests.rs2`
- `scripts/skill_herblore/scripts/brewing/brew_potion.rs2`
- `scripts/skill_herblore/scripts/herblore.rs2`
- `scripts/skill_fletching/scripts/cut_logs.rs2`
