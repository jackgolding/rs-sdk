# Waterfall Quest (generated)

> Auto-generated from server RS2 source. Slug: `waterfall`, varp: `%waterfall_quest`, complete: `waterfall_complete` (= 10).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `waterfall` |
| Progress varp | `%waterfall_quest` |
| Complete constant | `waterfall_complete` (10) |

## NPCs

### _legends_guard (`_legends_guard`)
- Spawn: not in map data (instanced / moved / members)

### Almera (`almera_waterfall_quest`)
- Primary spawn: (2522, 3498, level 0)

### Gerald (`gerald_waterfall_quest`)
- Primary spawn: (2528, 3414, level 0)

### Golrie (`golrie_waterfall_quest`)
- Primary spawn: (2515, 9581, level 0)

### Hadley (`hadley_waterfall_quest`)
- Primary spawn: (2516, 3428, level 0)

## Items

- `arrow_shaft` — Arrow shaft
- `ball_of_wool` — Ball of wool
- `baxtorian_book_waterfall_quest` — Book on baxtorian
- `baxtorian_key_waterfall_quest` — A key
- `bow_string` — Bow string
- `diamond` — Diamond
- `dragon_leather` — Dragon leather
- `dragon_leather_black` — Dragon leather
- `dragon_leather_blue` — Dragon leather
- `dragon_leather_red` — Dragon leather
- `glarials_amulet_waterfall_quest` — Glarial's amulet
- `glarials_pebble_waterfall_quest` — Glarial's pebble
- `glarials_urn_empty_waterfall_quest` — Glarial's urn
- `glarials_urn_full_waterfall_quest` — Glarial's urn
- `gold_bar` — Gold bar
- `golrie_key_waterfall_quest` — A key
- `hard_leather` — Hard leather
- `headless_arrow` — Headless arrow
- `knife` — Knife
- `leather` — Leather
- `logs` — Logs
- `magic_logs` — Magic logs
- `maple_logs` — Maple logs
- `mithril_seed` — Mithril seeds
- `needle` — Needle
- `oak_logs` — Oak logs
- `thread` — Thread
- `willow_logs` — Willow logs
- `yew_logs` — Yew logs

## State machine

### `waterfall_not_started` (value 0)

**Interact:**
- opnpc1 → `almera_waterfall_quest` (Almera)
- apnpc1 → `hudon_waterfall_quest` (Hudon)
- oploc1 → `glarials_tombstone_waterfall_quest` (glarials_tombstone_waterfall_quest)
- opnpc1 → `gerald_waterfall_quest` (Gerald)

**Dialog options (click by text):**
- `I'm afraid I'm in a rush.`

**Items required:**
- Arrow shaft (`arrow_shaft`)
- Ball of wool (`ball_of_wool`)
- Book on baxtorian (`baxtorian_book_waterfall_quest`)
- A key (`baxtorian_key_waterfall_quest`)
- Bow string (`bow_string`)
- Dragon leather (`dragon_leather`)
- Dragon leather (`dragon_leather_black`)
- Dragon leather (`dragon_leather_blue`)
- Dragon leather (`dragon_leather_red`)
- Glarial's amulet (`glarials_amulet_waterfall_quest`)
- Glarial's urn (`glarials_urn_full_waterfall_quest`)
- A key (`golrie_key_waterfall_quest`)
- Hard leather (`hard_leather`)
- Headless arrow (`headless_arrow`)
- Knife (`knife`)
- Leather (`leather`)
- Logs (`logs`)
- Magic logs (`magic_logs`)
- Maple logs (`maple_logs`)
- Needle (`needle`)
- Oak logs (`oak_logs`)
- Thread (`thread`)
- Willow logs (`willow_logs`)
- Yew logs (`yew_logs`)

**Items consumed:**
- Glarial's amulet (`glarials_amulet_waterfall_quest`)
- Glarial's urn (`glarials_urn_full_waterfall_quest`)

**Varp transitions in script:**
- → `waterfall_started` (1)
- → `waterfall_spoken_to_hudon` (2)
- → `waterfall_opened_book_on_baxtorian` (3)
- → `waterfall_entered_glarial_tomb` (4)
- → `waterfall_entered_waterfall` (5)
- → `waterfall_entered_puzzle_room` (6)
- → `waterfall_placed_amulet` (8)
- → `waterfall_complete` (10)

### `waterfall_started` (value 1)

**Interact:**
- apnpc1 → `hudon_waterfall_quest` (Hudon)
- opnpc1 → `gerald_waterfall_quest` (Gerald)

**Varp transitions in script:**
- → `waterfall_spoken_to_hudon` (2)

### `waterfall_spoken_to_hudon` (value 2)

**Interact:**
- apnpc1 → `hudon_waterfall_quest` (Hudon)

**Varp transitions in script:**
- → `waterfall_spoken_to_hudon` (2)

### `waterfall_opened_book_on_baxtorian` (value 3)

**Interact:**
- apnpc1 → `hudon_waterfall_quest` (Hudon)
- opnpc1 → `golrie_waterfall_quest` (Golrie)

**Items required:**
- A key (`golrie_key_waterfall_quest`)

**Items consumed:**
- A key (`golrie_key_waterfall_quest`)

**Varp transitions in script:**
- → `waterfall_spoken_to_hudon` (2)

### `waterfall_entered_glarial_tomb` (value 4)

**Interact:**
- apnpc1 → `hudon_waterfall_quest` (Hudon)

**Varp transitions in script:**
- → `waterfall_spoken_to_hudon` (2)

### `waterfall_entered_waterfall` (value 5)

### `waterfall_entered_puzzle_room` (value 6)

### `waterfall_placed_amulet` (value 8)

### `waterfall_poured_ashes` (value 10)

### `waterfall_complete` (value 10)

**Journal:** Quest complete.

**Interact:**
- apnpc1 → `hudon_waterfall_quest` (Hudon)

**Varp transitions in script:**
- → `waterfall_spoken_to_hudon` (2)

## Source scripts

- `scripts/quests/quest_waterfall/scripts/hadley.rs2`
- `scripts/quests/quest_waterfall/scripts/almera.rs2`
- `scripts/quests/quest_waterfall/scripts/hudon.rs2`
- `scripts/quests/quest_waterfall/scripts/golrie.rs2`
- `scripts/quests/quest_waterfall/scripts/quest_waterfall.rs2`
- `scripts/quests/quest_waterfall/scripts/gerald.rs2`
- `scripts/quests/quest_waterfall/scripts/baxtorian_book.rs2`
- `scripts/quests/quest_legends/scripts/legends_guard.rs2`
- `scripts/general/scripts/quests.rs2`
