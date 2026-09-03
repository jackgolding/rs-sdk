# Merlin's Crystal (generated)

> Auto-generated from server RS2 source. Slug: `arthur`, varp: `%arthur`, complete: `arthur_complete` (= 7).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `arthur` |
| Progress varp | `%arthur` |
| Complete constant | `arthur_complete` (7) |

## NPCs

### Arhein (`arhein`)
- Primary spawn: (2803, 3430, level 0)

### Candle maker (`candle_maker`)
- Primary spawn: (2800, 3439, level 0)

### King Arthur (`king_arthur`)
- Primary spawn: (2764, 3515, level 0)

### The Lady of the Lake (`ladyofthelake`)
- Primary spawn: (2924, 3405, level 0)

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

### Sir Mordred (`sir_mordred`)
- Primary spawn: (2769, 3403, level 2)

### Sir Palomedes (`sir_palomedes`)
- Primary spawn: (2754, 3509, level 0)

### Sir Pelleas (`sir_pelleas`)
- Primary spawn: (2761, 3503, level 1)

### Sir Tristram (`sir_tristram`)
- Primary spawn: (2755, 3512, level 1)

## Items

- `black_full_helm` — Black full helm
- `black_platebody` — Black platebody
- `black_platelegs` — Black platelegs
- `bucket_empty` — Bucket
- `bucket_wax` — Bucket of wax
- `coins` — Coins
- `excalibur` — Excalibur
- `holy_grail` — Holy grail
- `lit_black_candle` — Lit black candle
- `magic_golden_feather` — Magic gold feather
- `unlit_black_candle` — Black candle

## State machine

### `arthur_not_started` (value 0)

**Interact:**
- opnpc1 → `sir_kay` (Sir Kay)
- opnpc1 → `sir_pelleas` (Sir Pelleas)
- opnpc1 → `sir_lancelot` (Sir Lancelot)
- opnpc1 → `sir_lucan` (Sir Lucan)
- opnpc1 → `sir_palomedes` (Sir Palomedes)
- opnpc1 → `sir_bedivere` (Sir Bedivere)
- opnpc1 → `sir_tristram` (Sir Tristram)

**Dialog options (click by text):**
- `I want to get Merlin out of the crystal.`
- `You're a little full of yourself aren't you?`

**Varp transitions in script:**
- → `arthur_spoken_lancelot` (3)

### `arthur_started` (value 1)

**Interact:**
- opnpc1 → `sir_kay` (Sir Kay)
- opnpc1 → `sir_pelleas` (Sir Pelleas)
- opnpc1 → `sir_lucan` (Sir Lucan)
- opnpc1 → `sir_palomedes` (Sir Palomedes)
- opnpc1 → `sir_gawain` (Sir Gawain)
- opnpc1 → `sir_bedivere` (Sir Bedivere)
- opnpc1 → `sir_tristram` (Sir Tristram)

**Dialog options (click by text):**
- `Any idea how to get into Morgan Le Faye's stronghold?`
- `Good day.`

**Varp transitions in script:**
- → `arthur_complete` (7)
- → `arthur_spoken_gawain` (2)

### `arthur_spoken_gawain` (value 2)

**Interact:**
- opnpc1 → `sir_lancelot` (Sir Lancelot)

**Dialog options (click by text):**
- `I want to get Merlin out of the crystal.`
- `You're a little full of yourself aren't you?`

**Varp transitions in script:**
- → `arthur_spoken_lancelot` (3)

### `arthur_spoken_lancelot` (value 3)

### `arthur_spoken_morgan_lefaye` (value 4)

### `arthur_excalibur_bound` (value 5)

### `arthur_freed_merlin` (value 6)

**Interact:**
- opnpc1 → `king_arthur` (King Arthur) → @king_arthur_merlin_free

### `arthur_complete` (value 7)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `sir_kay` (Sir Kay)
- opnpc1 → `sir_pelleas` (Sir Pelleas)
- opnpc1 → `sir_lancelot` (Sir Lancelot)
- opnpc1 → `sir_lucan` (Sir Lucan)
- opnpc1 → `sir_palomedes` (Sir Palomedes)
- opnpc1 → `sir_bedivere` (Sir Bedivere)
- opnpc1 → `sir_tristram` (Sir Tristram)
- opnpc1 → `king_arthur` (King Arthur) → @king_arthur_grailstart

**Dialog options (click by text):**
- `I want to get Merlin out of the crystal.`
- `I'd enjoy trying that.`
- `Tell me of this quest.`
- `You're a little full of yourself aren't you?`

**Varp transitions in script:**
- → `arthur_spoken_lancelot` (3)

## Source scripts

- `scripts/quests/quest_hero/scripts/quest_hero.rs2`
- `scripts/quests/quest_arthur/scripts/quest_arthur.rs2`
- `scripts/quests/quest_arthur/scripts/sir_mordred.rs2`
- `scripts/areas/area_camelot/scripts/sir_kay.rs2`
- `scripts/areas/area_camelot/scripts/sir_pelleas.rs2`
- `scripts/areas/area_camelot/scripts/sir_lancelot.rs2`
- `scripts/areas/area_camelot/scripts/sir_lucan.rs2`
- `scripts/areas/area_camelot/scripts/sir_palomedes.rs2`
- `scripts/areas/area_camelot/scripts/sir_gawain.rs2`
- `scripts/areas/area_camelot/scripts/sir_bedivere.rs2`
- `scripts/areas/area_camelot/scripts/sir_tristram.rs2`
- `scripts/areas/area_camelot/scripts/king_arthur.rs2`
- `scripts/areas/area_taverly/scripts/lady_of_the_lake.rs2`
- `scripts/areas/area_catherby/scripts/candle_maker.rs2`
- `scripts/areas/area_catherby/scripts/arhein.rs2`
- `scripts/general/scripts/quests.rs2`
