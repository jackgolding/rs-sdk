# Scorpion Catcher (generated)

> Auto-generated from server RS2 source. Slug: `scorpcatcher`, varp: `%scorpcatcher`, complete: `scorpcatcher_complete` (= 6).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `scorpcatcher` |
| Progress varp | `%scorpcatcher` |
| Complete constant | `scorpcatcher_complete` (6) |

## NPCs

### Peksa (`peksa`)
- Primary spawn: (3076, 3429, level 0)

### Seer (`seer`)
- Primary spawn: (2702, 3475, level 0)
- Other spawns: (2714, 3471, level 0); (2716, 3485, level 0); (2705, 3473, level 1)

### Thormac (`thormac`)
- Primary spawn: (2702, 3405, level 3)

## Items

- `coins` — Coins
- `last_useitem` — last_useitem
- `scorpioncagea` — Scorpion cage
- `scorpioncageab` — Scorpion cage
- `scorpioncageac` — Scorpion cage
- `scorpioncageempty` — Scorpion cage
- `scorpioncagefull` — Scorpion cage

## State machine

### `scorpcatcher_not_started` (value 0)

**Journal:** I can start this quest by speaking to Thormac who is in the Sorcerer's Tower south-west of Catherby. Requirements: Level 31 Prayer

**Interact:**
- opnpc1 → `thormac` (Thormac) → @thormac_assistance

**Dialog options (click by text):**
- `So how would I go about catching them then?`
- `What do you need assistance with?`

### `scorpcatcher_started` (value 1)

**Journal:** I need to go to the Seers' Village and talk to the Seers about the lost Kharid Scorpions.

**Interact:**
- opnpc1 → `seer` (Seer)

**Dialog options (click by text):**
- `I need to locate some scorpions.`
- `Many greetings.`
- `Where did you say that scorpion was again?`

**Items required:**
- Scorpion cage (`scorpioncagea`)
- Scorpion cage (`scorpioncageab`)
- Scorpion cage (`scorpioncageac`)
- Scorpion cage (`scorpioncagefull`)

**Varp transitions in script:**
- → `scorpcatcher_first_hint` (2)
- → `scorpcatcher_second_hint` (3)

### `scorpcatcher_first_hint` (value 2)

**Journal:** I'll need to talk to a Seer again now I've caught the first Kharid Scorpion.

**Interact:**
- opnpc1 → `seer` (Seer)

**Dialog options (click by text):**
- `I need to locate some scorpions.`
- `Many greetings.`
- `Where did you say that scorpion was again?`

**Items required:**
- Scorpion cage (`scorpioncagea`)
- Scorpion cage (`scorpioncageab`)
- Scorpion cage (`scorpioncageac`)
- Scorpion cage (`scorpioncagefull`)

**Varp transitions in script:**
- → `scorpcatcher_first_hint` (2)
- → `scorpcatcher_second_hint` (3)

### `scorpcatcher_second_hint` (value 3)

### `scorpcatcher_complete` (value 6)

**Journal:** I've spoken to Thormac and he thanked me for finding his pet Kharid Scorpions. @red@QUEST COMPLETE!

**Interact:**
- opnpc1 → `thormac` (Thormac) → @thormac_thankyou

**Dialog options (click by text):**
- `That's ok.`

## Source scripts

- `scripts/quests/quest_scorpcatcher/scripts/quest_scorpcatcher.rs2`
- `scripts/areas/area_seers/scripts/seer.rs2`
- `scripts/areas/area_seers/scripts/thormac.rs2`
- `scripts/areas/area_barbarian_village/scripts/peksa.rs2`
- `scripts/general/scripts/quests.rs2`
