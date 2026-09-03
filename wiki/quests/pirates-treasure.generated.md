# Pirate's Treasure (generated)

> Auto-generated from server RS2 source. Slug: `hunt`, varp: `%hunt`, complete: `hunt_complete` (= 4).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `hunt` |
| Progress varp | `%hunt` |
| Complete constant | `hunt_complete` (4) |

## NPCs

### Customs officer (`customs_officer`)
- Primary spawn: (2772, 3225, level 0)
- Other spawns: (2772, 3231, level 0); (2773, 3229, level 0); (2953, 3147, level 0)…

### Luthas (`luthas`)
- Primary spawn: (2939, 3154, level 0)

### Redbeard Frank (`redbeard_frank`)
- Primary spawn: (3053, 3250, level 0)

### Wydin (`wydin`)
- Primary spawn: (3014, 3204, level 0)

## Items

- `banana` — Banana
- `chest_key` — Chest key
- `coins` — Coins
- `emerald` — Emerald
- `gold_ring` — Gold ring
- `karamja_rum` — Karamjan rum
- `piratemessage` — Pirate message
- `tbwt_sliced_banana_in_karamja_rum` — tbwt_sliced_banana_in_karamja_rum
- `trail_clue_medium_anagram012` — Clue scroll
- `white_apron` — White apron

## State machine

### `hunt_not_started` (value 0)

**Journal:** I can start this quest by speaking to Redbeard Frank who is at Port Sarim. There aren't any requirements for this quest.

### `hunt_fetch_rum` (value 1)

**Journal:** I have spoken to Redbeard Frank. He has agreed to tell me the location of some treasure for some Karamja Rum. I have the rum, and now I need to find a way to get the rum off Karamja. This might be tricky, as the Customs Officers are searching people for it.

### `hunt_received_key` (value 2)

**Journal:** I have spoken to Redbeard Frank. He has agreed to tell me the location of some treasure for some Karamja Rum. I have smuggled some rum off Karamja, and retrieved it from the back room of Wydin's shop. I have given the rum to Redbeard Frank. He has told me that the treasure is hidden in the chest in the upstairs room of the Blue Moon Inn in Varrock. I have opened the chest in the Blue Moon, and found a note inside. I think it will tell me where to dig.

### `hunt_read_note` (value 3)

**Journal:** I have spoken to Redbeard Frank. He has agreed to tell me the location of some treasure for some Karamja Rum. I have smuggled some rum off Karamja, and retrieved it from the back room of Wydin's shop. I have given the rum to Redbeard Frank. He has told me that the treasure is hidden in the chest in the upstairs room of the Blue Moon Inn in Varrock. I have opened the chest in the Blue Moon, and found a note inside. I think it will tell me where to dig. The note reads 'Visit the city of the White Knights. In the park, Saradomin points to the X which marks the spot.'

### `hunt_complete` (value 4)

**Journal:** Quest complete.

## Source scripts

- `scripts/quests/quest_hunt/scripts/redbeard_frank.rs2`
- `scripts/quests/quest_hunt/scripts/pirate_message.rs2`
- `scripts/quests/quest_hunt/scripts/food_store.rs2`
- `scripts/quests/quest_hunt/scripts/banana_crate.rs2`
- `scripts/quests/quest_hunt/scripts/luthas.rs2`
- `scripts/quests/quest_hunt/scripts/dig.rs2`
- `scripts/areas/area_karamja/scripts/customs_officer.rs2`
- `scripts/areas/area_port_sarim/scripts/wydin.rs2`
- `scripts/general/scripts/quests.rs2`
