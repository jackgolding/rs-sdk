# Holy Grail (generated)

> Auto-generated from server RS2 source. Slug: `grail`, varp: `%grail`, complete: `grail_complete` (= 10).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `grail` |
| Progress varp | `%grail` |
| Complete constant | `grail_complete` (10) |

## NPCs

### Black Knight Titan (`black_knight_titan`)
- Primary spawn: (2791, 4722, level 0)

### Galahad (`brother_galahad`)
- Primary spawn: (2612, 3474, level 0)

### The Fisher King (`fisher_king`)
- Primary spawn: (2762, 4688, level 1)

### Crone (`grail_crone`)
- Spawn: not in map data (instanced / moved / members)

### High Priest (`high_priest_of_entrana`)
- Primary spawn: (2851, 3349, level 0)

### King Arthur (`king_arthur`)
- Primary spawn: (2764, 3515, level 0)

### Merlin (`merlin`)
- Spawn: not in map data (instanced / moved / members)

### Sir Bedivere (`sir_bedivere`)
- Primary spawn: (2766, 3511, level 1)

### Sir Gawain (`sir_gawain`)
- Primary spawn: (2763, 3506, level 0)

### Sir Kay (`sir_kay`)
- Primary spawn: (2761, 3497, level 0)

### Sir Lancelot (`sir_lancelot`)
- Primary spawn: (2759, 3515, level 1)

### Sir Lucan (`sir_lucan`)
- Primary spawn: (2754, 3515, level 0)

### Sir Palomedes (`sir_palomedes`)
- Primary spawn: (2754, 3509, level 0)

### Sir Pelleas (`sir_pelleas`)
- Primary spawn: (2761, 3503, level 1)

### Sir Percival (`sir_percival`)
- Spawn: not in map data (instanced / moved / members)

### Sir Tristram (`sir_tristram`)
- Primary spawn: (2755, 3512, level 1)

## Items

- `cup_of_tea` — Cup of tea
- `excalibur` — Excalibur
- `holy_grail` — Holy grail
- `holy_table_napkin` — Holy table napkin
- `magic_golden_feather` — Magic gold feather
- `magic_whistle` — Magic whistle

## State machine

### `grail_not_started` (value 0)

**Journal:** I can start this quest by speaking to King Arthur at Camelot Castle, just North West of Catherby To complete this quest I must be able to defeat a Level 120 Black Knight Titan.

### `grail_started` (value 2)

**Journal:** King Arthur has sent me questing for the Holy Grail of legend. I should start my quest by speaking to Merlin in his study next to the Camelot library for directions to it.

### `grail_spoken_merlin` (value 3)

**Journal:** Merlin suggested two things to help find the Grail: Speak to Galahad who lives West of McGrubor's Wood. Talk to someone on a 'Holy Island' he can't remember.

### `grail_spoken_crone` (value 4)

**Journal:** According to a Crone on Entrana I need to go to where the 'Six Heads' face and blow a magic whistle there. To get the Magic Whistle I need to carry something from the Realm of the Fisher King to a Haunted House...

### `grail_failed_defeat_titan` (value 7)

**Journal:** I need to find a weapon that can defeat him somehow.

### `grail_finding_percival` (value 8)

**Journal:** The Fisher King is very sick. He has asked me to find his son Sir Percival, a Knight of the Round Table. King Arthur gave me a magic golden feather to help locate Sir Percival - I should use it to find him!

**Interact:**
- opnpc1 → `sir_percival` (Sir Percival) → @percival_found
- opnpc1 → `king_arthur` (King Arthur)

**Dialog options (click by text):**
- `How did you end up in a sack?`
- `I want to become a Knight of the Round Table!`
- `I'd enjoy trying that.`
- `Tell me of this quest.`

**Items required:**
- Holy grail (`holy_grail`)

**Varp transitions in script:**
- → `grail_given_whistle` (9)
- → `grail_started` (2)

### `grail_given_whistle` (value 9)

**Journal:** I honoured the Fisher King's request to find his son, and used a Magic Golden Feather to track him down. When he heard of his father's illness he rushed back to the Grail Castle using a Magic Whistle that I gave him. Now I have the Grail with me. I should take it to Arthur.

**Interact:**
- opnpc1 → `sir_percival` (Sir Percival)
- opnpc1 → `merlin` (Merlin)

**Dialog options (click by text):**
- `Come with me, I shall make you a king.`
- `How did you end up in a sack?`
- `Thank you for the advice.`

**Items required:**
- Magic whistle (`magic_whistle`)

**Items consumed:**
- Magic whistle (`magic_whistle`)

**Varp transitions in script:**
- → `grail_given_whistle` (9)
- → `grail_started` (2)
- → `grail_spoken_merlin` (3)

### `grail_complete` (value 10)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `sir_percival` (Sir Percival)
- opnpc1 → `merlin` (Merlin)
- opnpc1 → `king_arthur` (King Arthur)

**Dialog options (click by text):**
- `Come with me, I shall make you a king.`
- `How did you end up in a sack?`
- `I want to become a Knight of the Round Table!`
- `I'd enjoy trying that.`
- `Tell me of this quest.`
- `Thank you for the advice.`

**Items required:**
- Holy grail (`holy_grail`)
- Magic whistle (`magic_whistle`)

**Items consumed:**
- Magic whistle (`magic_whistle`)

**Varp transitions in script:**
- → `grail_given_whistle` (9)
- → `grail_started` (2)
- → `grail_spoken_merlin` (3)

## Source scripts

- `scripts/quests/quest_grail/scripts/sir_percival.rs2`
- `scripts/quests/quest_grail/scripts/quest_grail.rs2`
- `scripts/quests/quest_grail/scripts/fisher_king.rs2`
- `scripts/quests/quest_grail/scripts/grail_crone.rs2`
- `scripts/quests/quest_grail/scripts/black_knight_titan.rs2`
- `scripts/areas/area_camelot/scripts/sir_kay.rs2`
- `scripts/areas/area_camelot/scripts/sir_pelleas.rs2`
- `scripts/areas/area_camelot/scripts/merlin.rs2`
- `scripts/areas/area_camelot/scripts/sir_lancelot.rs2`
- `scripts/areas/area_camelot/scripts/sir_lucan.rs2`
- `scripts/areas/area_camelot/scripts/sir_palomedes.rs2`
- `scripts/areas/area_camelot/scripts/sir_gawain.rs2`
- `scripts/areas/area_camelot/scripts/sir_bedivere.rs2`
- `scripts/areas/area_camelot/scripts/sir_tristram.rs2`
- `scripts/areas/area_camelot/scripts/king_arthur.rs2`
- `scripts/areas/area_seers/scripts/brother_galahad.rs2`
- `scripts/areas/area_entrana/scripts/high_priest_of_entrana.rs2`
- `scripts/general/scripts/quests.rs2`
