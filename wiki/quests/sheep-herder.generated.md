# Sheep Herder (generated)

> Auto-generated from server RS2 source. Slug: `sheepherder`, varp: `%sheepherderquest`, complete: `sheepherder_complete` (= 3).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `sheepherder` |
| Progress varp | `%sheepherderquest` |
| Complete constant | `sheepherder_complete` (3) |

## NPCs

### Councillor Halgrive (`councillor_halgrive`)
- Primary spawn: (2617, 3299, level 0)

### Doctor Orbon (`doctor_orbon`)
- Primary spawn: (2614, 3306, level 0)

### Farmer Brumty (`farmer_brumty`)
- Primary spawn: (2600, 3358, level 0)

### Diseased sheep 1 (`herder_plaguesheep_1`)
- Primary spawn: (2609, 3344, level 0)
- Other spawns: (2610, 3343, level 0); (2610, 3345, level 0)

## Items

- `coins` — Coins
- `plague_jacket` — Plague jacket
- `plague_trousers` — Plague trousers
- `poisoned_feed` — Feed

## State machine

### `sheepherder_not_started` (value 0)

**Journal:** I can start this quest by speaking to Councillor Halgrive near to the Zoo in East Ardougne.

**Interact:**
- opnpc1 → `farmer_brumty` (Farmer Brumty) → @farmer_brumty_before_sheep_herder
- opnpc1 → `councillor_halgrive` (Councillor Halgrive) → @halgrive_before_sheep_herder
- opnpc1 → `doctor_orbon` (Doctor Orbon) → @doctor_orbon_before_sheep_herder

### `sheepherder_tasked_with_talking_to_dr_orbon` (value 1)

**Journal:** I need to get some protective clothing from Dr Orbon who is in the church just north of Ardougne Zoo

**Interact:**
- opnpc1 → `farmer_brumty` (Farmer Brumty) → @farmer_brumty_before_talking_to_orbon
- opnpc1 → `councillor_halgrive` (Councillor Halgrive) → @halgrive_before_obtaining_plague_gear
- opnpc1 → `doctor_orbon` (Doctor Orbon) → @doctor_orbon_looking_for_protective_clothing

### `sheepherder_tasked_with_disposing_of_sheep` (value 2)

**Journal:** I equipped a prod and then I used it to herd the diseased sheep to a pen where I could safely kill them and incinerate their bones. I should return to Councillor Halgrive to collect the reward he has promised me for my hard work.

**Interact:**
- opnpc1 → `farmer_brumty` (Farmer Brumty) → @farmer_brumty_during_sheep_herder
- opnpc1 → `councillor_halgrive` (Councillor Halgrive) → @halgrive_before_incinerating_sheep
- opnpc1 → `doctor_orbon` (Doctor Orbon) → @doctor_orbon_post_clothing_purchase

### `sheepherder_complete` (value 3)

**Journal:** I returned to let Councillor Halgrive know that the plagued sheep were no more and claimed my reward. @red@QUEST COMPLETE!

**Interact:**
- opnpc1 → `farmer_brumty` (Farmer Brumty) → @farmer_brumty_after_sheep_herder
- opnpc1 → `councillor_halgrive` (Councillor Halgrive) → @halgrive_after_sheep_herder
- opnpc1 → `doctor_orbon` (Doctor Orbon) → @doctor_orbon_after_sheep_herder

**Items required:**
- Plague jacket (`plague_jacket`)
- Plague trousers (`plague_trousers`)

**Items consumed:**
- Coins (`coins`)

**Varp transitions in script:**
- → `sheepherder_not_started` (0)
- → `sheepherder_tasked_with_talking_to_dr_orbon` (1)
- → `sheepherder_tasked_with_disposing_of_sheep` (2)

## Source scripts

- `scripts/quests/quest_sheepherder/scripts/npcs/farmer_brumty.rs2`
- `scripts/quests/quest_sheepherder/scripts/npcs/councillor_halgrive.rs2`
- `scripts/quests/quest_sheepherder/scripts/npcs/doctor_orbon.rs2`
- `scripts/quests/quest_sheepherder/scripts/npcs/diseased_sheep.rs2`
- `scripts/quests/quest_sheepherder/scripts/quest_sheepherder.rs2`
- `scripts/quests/quest_sheepherder/scripts/locs/sheepherder_gate.rs2`
- `scripts/general/scripts/quests.rs2`
