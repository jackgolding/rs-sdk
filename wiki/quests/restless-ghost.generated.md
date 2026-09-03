# The Restless Ghost (generated)

> Auto-generated from server RS2 source. Slug: `priest`, varp: `%prieststart`, complete: `priest_complete` (= 5).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `priest` |
| Progress varp | `%prieststart` |
| Complete constant | `priest_complete` (5) |

## NPCs

### Father Aereck (`father_aereck`)
- Primary spawn: (3244, 3206, level 0)

### Father Urhney (`father_urhney`)
- Primary spawn: (3235, 3153, level 0)

### Restless ghost (`ghostx`)
- Spawn: not in map data (instanced / moved / members)

## Items

- `amulet_of_ghostspeak` — Ghostspeak amulet
- `ghostskull` — Skull

## State machine

### `priest_not_started` (value 0)

**Interact:**
- opnpc1 → `father_aereck` (Father Aereck) → @father_aereck_default

**Dialog options (click by text):**
- `Oh, THAT Saradomin...`
- `Who's Saradomin?`
- `You don't understand. This is a computer game!`

**Varp transitions in script:**
- → `priest_started` (1)

### `priest_started` (value 1)

### `priest_spoken_urhney` (value 2)

**Interact:**
- opnpc1 → `ghostx` (Restless ghost)

**Dialog options (click by text):**
- `Did he really?`
- `Goodbye. Thanks for the chat.`
- `My brother had EXACTLY the same problem.`
- `No I can't.`
- `Sorry I don't speak ghost.`
- `Sorry, I don't speak ghost.`
- `Yep, now tell me what the problem is.`
- `Yes, ok. Do you know WHY you're a ghost?`
- `Yes, ok. Do you know why you're a ghost?`

**Items required:**
- Ghostspeak amulet (`amulet_of_ghostspeak`)

**Varp transitions in script:**
- → `priest_complete` (5)
- → `priest_spoken_ghost` (3)

### `priest_spoken_ghost` (value 3)

### `priest_obtained_skull` (value 4)

### `priest_complete` (value 5)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `father_aereck` (Father Aereck) → @father_aereck_default

**Dialog options (click by text):**
- `Oh, THAT Saradomin...`
- `Who's Saradomin?`
- `You don't understand. This is a computer game!`

**Varp transitions in script:**
- → `priest_started` (1)

## Source scripts

- `scripts/quests/quest_priest/scripts/restless_ghost.rs2`
- `scripts/quests/quest_priest/scripts/quest_priest.rs2`
- `scripts/areas/area_lumbridge/scripts/father_aereck.rs2`
- `scripts/areas/area_lumbridge/scripts/father_urhney.rs2`
- `scripts/general/scripts/quests.rs2`
