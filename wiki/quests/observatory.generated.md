# Observatory Quest (generated)

> Auto-generated from server RS2 source. Slug: `itgronigen`, varp: `%itgronigen`, complete: `itgronigen_complete` (= 7).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `itgronigen` |
| Progress varp | `%itgronigen` |
| Complete constant | `itgronigen_complete` (7) |

## NPCs

### Observatory assistant (`observatory_assistant`)
- Primary spawn: (2442, 3189, level 0)

### Observatory professor (`observatory_professor`)
- Primary spawn: (2438, 3186, level 0)

### Spirit of Scorpius (`spirit_of_scorpius`)
- Primary spawn: (2465, 3227, level 0)

## Items

- `1dose2strength` — Super strength(1)
- `1doseantipoison` — Antipoison(1)
- `amulet_of_defence` — Amulet of defence
- `black_2h_sword` — Black 2h sword
- `blessedsnake` — Unholy symbol
- `bronze_bar` — Bronze bar
- `jug_wine` — Jug of wine
- `keep_key` — Keep key
- `lawrune` — Law rune
- `lens` — Lens
- `lens_mould` — Lens mould
- `maple_longbow` — Maple longbow
- `molten_glass` — Molten glass
- `stringsnake` — Unpowered symbol
- `trail_chart` — Chart
- `tuna` — Tuna
- `uncut_sapphire` — Uncut sapphire
- `unholy_symbol_mould` — Unholy mould
- `waterrune` — Water rune
- `weapon_poison` — Weapon poison
- `woodplank` — Plank

## State machine

### `itgronigen_not_started` (value 0)

**Interact:**
- opnpc1 → `observatory_professor` (Observatory professor) → @professor_initial

**Dialog options (click by text):**
- `I am lost!!!`
- `Sounds interesting, what can I do for you?`

**Varp transitions in script:**
- → `itgronigen_started` (1)

### `itgronigen_started` (value 1)

**Interact:**
- opnpc1 → `observatory_professor` (Observatory professor) → @professor_planks

**Items consumed:**
- Plank (`woodplank`)

**Varp transitions in script:**
- → `itgronigen_given_planks` (2)

### `itgronigen_given_planks` (value 2)

**Interact:**
- opnpc1 → `observatory_professor` (Observatory professor) → @professor_bronze

**Items required:**
- Bronze bar (`bronze_bar`)

**Items consumed:**
- Bronze bar (`bronze_bar`)

**Varp transitions in script:**
- → `itgronigen_given_bronze` (3)

### `itgronigen_given_bronze` (value 3)

**Interact:**
- opnpc1 → `observatory_professor` (Observatory professor) → @professor_glass

**Items required:**
- Molten glass (`molten_glass`)

**Items consumed:**
- Molten glass (`molten_glass`)

**Varp transitions in script:**
- → `itgronigen_given_glass` (4)

### `itgronigen_given_glass` (value 4)

**Interact:**
- opnpc1 → `observatory_professor` (Observatory professor) → @professor_mould

**Items required:**
- Lens mould (`lens_mould`)

**Varp transitions in script:**
- → `itgronigen_given_mould` (5)

### `itgronigen_given_mould` (value 5)

**Interact:**
- opnpc1 → `observatory_professor` (Observatory professor) → @professor_lens
- opnpc1 → `observatory_assistant` (Observatory assistant)

**Dialog options (click by text):**
- `I can't find any planks!`
- `I can't find the lens mould.`
- `I can't make the lens!`
- `I can't see any bronze around.`
- `I'm having problems getting glass.`
- `Yes, what do you two do here?`

**Items required:**
- Lens (`lens`)
- Lens mould (`lens_mould`)

**Items consumed:**
- Lens (`lens`)
- Lens mould (`lens_mould`)

**Varp transitions in script:**
- → `itgronigen_sent_telescope` (6)
- → `itgronigen_claimed_wine` (8)

### `itgronigen_sent_telescope` (value 6)

**Interact:**
- oploc1 → `obs_dungeonladderdown` (obs_dungeonladderdown)
- opnpc1 → `observatory_professor` (Observatory professor)
- opnpc1 → `observatory_assistant` (Observatory assistant)

**Dialog options (click by text):**
- `Do you need any more help with the telescope?`
- `I am lost!!!`
- `I can see a constellation.`
- `I can't find any planks!`
- `I can't find the lens mould.`
- `I can't make the lens!`
- `I can't see any bronze around.`
- `I'm having problems getting glass.`
- `Sounds interesting, what can I do for you?`
- `Yes, what do you two do here?`

**Items required:**
- Bronze bar (`bronze_bar`)
- Lens (`lens`)
- Lens mould (`lens_mould`)
- Molten glass (`molten_glass`)

**Items consumed:**
- Bronze bar (`bronze_bar`)
- Keep key (`keep_key`)
- Lens (`lens`)
- Lens mould (`lens_mould`)
- Molten glass (`molten_glass`)
- Plank (`woodplank`)

**Varp transitions in script:**
- → `itgronigen_not_started` (0)
- → `itgronigen_complete` (7)
- → `itgronigen_given_glass` (4)
- → `itgronigen_given_planks` (2)
- → `itgronigen_given_bronze` (3)
- → `itgronigen_given_mould` (5)
- → `itgronigen_sent_telescope` (6)
- → `itgronigen_started` (1)
- → `itgronigen_claimed_wine` (8)

### `itgronigen_complete` (value 7)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `observatory_assistant` (Observatory assistant)

**Dialog options (click by text):**
- `I can't find any planks!`
- `I can't find the lens mould.`
- `I can't make the lens!`
- `I can't see any bronze around.`
- `I'm having problems getting glass.`
- `Yes, what do you two do here?`

**Varp transitions in script:**
- → `itgronigen_claimed_wine` (8)

## Source scripts

- `scripts/quests/quest_itgronigen/scripts/spirit_of_scorpius.rs2`
- `scripts/quests/quest_itgronigen/scripts/quest_itgronigen.rs2`
- `scripts/quests/quest_itgronigen/scripts/observatory_professor.rs2`
- `scripts/quests/quest_itgronigen/scripts/observatory_assistant.rs2`
- `scripts/general/scripts/quests.rs2`
- `scripts/drop tables/scripts/chaos_druid.rs2`
