# Nature Spirit (generated)

> Auto-generated from server RS2 source. Slug: `druidspirit`, varp: `%druidspirit`, complete: `druidspirit_complete` (= 110).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `druidspirit` |
| Progress varp | `%druidspirit` |
| Complete constant | `druidspirit_complete` (110) |

## NPCs

### Ulizius (`mort_myre_gate_guard`)
- Primary spawn: (3444, 3459, level 0)

### Drezel (`priestperiltrappedmonk2`)
- Primary spawn: (3440, 9895, level 0)

## Items

- `amulet_of_ghostspeak` — Ghostspeak amulet
- `apple_pie` — Apple pie
- `blankrune` — Rune essence
- `bloom_spell` — Druidic spell
- `cert_blankrune` — cert_blankrune
- `dagger_wolfbane` — Wolfbane
- `druid_pouch` — Druid pouch
- `druid_pouch_empty` — Druid pouch
- `filliman_journal` — Journal
- `meat_pie` — Meat pie
- `mirror` — Mirror
- `mortmyrebuddingstem` — Mort myre stem
- `mortmyremushroom` — Mort myre fungi
- `mortmyrepear` — Mort myre pear
- `rotten_food` — Rotten food
- `silver_sickle` — Silver sickle
- `silver_sickle_blessed` — Silver sickle(b)
- `trail_clue_medium_anagram016` — Clue scroll
- `used_bloom_spell` — A used spell

## State machine

### `druidspirit_not_started` (value 0)

**Interact:**
- opnpc1 → `mort_myre_gate_guard` (Ulizius)

**Items required:**
- Clue scroll (`trail_clue_medium_anagram016`)

### `druidspirit_nature_stone` (value 0)

### `druidspirit_spirit_stone` (value 1)

### `druidspirit_started` (value 5)

### `druidspirit_entered_swamp` (value 10)

### `druidspirit_failed_talk` (value 15)

### `druidspirit_spoken_filliman` (value 20)

### `druidspirit_shown_mirror` (value 25)

### `druidspirit_given_journal` (value 30)

### `druidspirit_received_spell` (value 35)

### `druidspirit_blessed` (value 40)

### `druidspirit_casted_spell` (value 45)

### `druidspirit_picked_fungi` (value 50)

### `druidspirit_spoken_filliman2` (value 55)

### `druidspirit_performed_ritual` (value 60)

### `druidspirit_entered_grotto` (value 65)

**Interact:**
- label → `filliman_spirit_dialogue` (filliman_spirit_dialogue)

**Dialog options (click by text):**
- `Being dead, what options do you think you have?`
- `How do I get to attack the Ghasts?`
- `I'm wearing an amulet of ghost speak!`
- `What are the things that are needed?`
- `Where would I get a silver sickle?`

**Items required:**
- Ghostspeak amulet (`amulet_of_ghostspeak`)
- Druidic spell (`bloom_spell`)
- Mort myre fungi (`mortmyremushroom`)
- Silver sickle (`silver_sickle`)

**Items consumed:**
- Journal (`filliman_journal`)
- Silver sickle (`silver_sickle`)

**Varp transitions in script:**
- → `druidspirit_entered_swamp` (10)
- → `druidspirit_failed_talk` (15)
- → `druidspirit_full_transform` (70)
- → `druidspirit_spoken_filliman2` (55)
- → `druidspirit_complete` (110)
- → `druidspirit_killed_ghast3` (105)
- → `druidspirit_blessed_sickle` (75)
- → `druidspirit_spoken_filliman` (20)
- → `druidspirit_shown_mirror` (25)
- → `druidspirit_given_journal` (30)
- → `druidspirit_received_spell` (35)
- → `druidspirit_performed_ritual` (60)

### `druidspirit_full_transform` (value 70)

**Interact:**
- opnpc1 → `priestperiltrappedmonk2` (Drezel)

**Dialog options (click by text):**
- `Sorry, not interested...`
- `Well, I'm going to look around a bit more.`
- `Where should I look for Filliman Tarlock again?`
- `Who is this Filliman?`

**Items required:**
- Rune essence (`blankrune`)
- cert_blankrune (`cert_blankrune`)
- Wolfbane (`dagger_wolfbane`)
- Silver sickle (`silver_sickle`)

**Items consumed:**
- Rune essence (`blankrune`)

**Varp transitions in script:**
- → `druidspirit_blessed` (40)
- → `druidspirit_started` (5)

### `druidspirit_blessed_sickle` (value 75)

**Interact:**
- opnpc1 → `priestperiltrappedmonk2` (Drezel)

**Dialog options (click by text):**
- `Sorry, not interested...`
- `Well, I'm going to look around a bit more.`
- `Where should I look for Filliman Tarlock again?`
- `Who is this Filliman?`

**Items required:**
- Rune essence (`blankrune`)
- cert_blankrune (`cert_blankrune`)
- Wolfbane (`dagger_wolfbane`)
- Silver sickle (`silver_sickle`)

**Items consumed:**
- Rune essence (`blankrune`)

**Varp transitions in script:**
- → `druidspirit_blessed` (40)
- → `druidspirit_started` (5)

### `druidspirit_casted_sickle_bloom` (value 80)

**Interact:**
- opnpc1 → `priestperiltrappedmonk2` (Drezel)

**Dialog options (click by text):**
- `Sorry, not interested...`
- `Well, I'm going to look around a bit more.`
- `Where should I look for Filliman Tarlock again?`
- `Who is this Filliman?`

**Items required:**
- Rune essence (`blankrune`)
- cert_blankrune (`cert_blankrune`)
- Wolfbane (`dagger_wolfbane`)
- Silver sickle (`silver_sickle`)

**Items consumed:**
- Rune essence (`blankrune`)

**Varp transitions in script:**
- → `druidspirit_blessed` (40)
- → `druidspirit_started` (5)

### `druidspirit_picked_sickle` (value 85)

**Interact:**
- opnpc1 → `priestperiltrappedmonk2` (Drezel)

**Dialog options (click by text):**
- `Sorry, not interested...`
- `Well, I'm going to look around a bit more.`
- `Where should I look for Filliman Tarlock again?`
- `Who is this Filliman?`

**Items required:**
- Rune essence (`blankrune`)
- cert_blankrune (`cert_blankrune`)
- Wolfbane (`dagger_wolfbane`)
- Silver sickle (`silver_sickle`)

**Items consumed:**
- Rune essence (`blankrune`)

**Varp transitions in script:**
- → `druidspirit_blessed` (40)
- → `druidspirit_started` (5)

### `druidspirit_added_pouch` (value 90)

**Interact:**
- opnpc1 → `priestperiltrappedmonk2` (Drezel)

**Dialog options (click by text):**
- `Sorry, not interested...`
- `Well, I'm going to look around a bit more.`
- `Where should I look for Filliman Tarlock again?`
- `Who is this Filliman?`

**Items required:**
- Rune essence (`blankrune`)
- cert_blankrune (`cert_blankrune`)
- Wolfbane (`dagger_wolfbane`)
- Silver sickle (`silver_sickle`)

**Items consumed:**
- Rune essence (`blankrune`)

**Varp transitions in script:**
- → `druidspirit_blessed` (40)
- → `druidspirit_started` (5)

### `druidspirit_killed_ghast1` (value 95)

**Interact:**
- opnpc1 → `priestperiltrappedmonk2` (Drezel)

**Dialog options (click by text):**
- `Sorry, not interested...`
- `Well, I'm going to look around a bit more.`
- `Where should I look for Filliman Tarlock again?`
- `Who is this Filliman?`

**Items required:**
- Rune essence (`blankrune`)
- cert_blankrune (`cert_blankrune`)
- Wolfbane (`dagger_wolfbane`)
- Silver sickle (`silver_sickle`)

**Items consumed:**
- Rune essence (`blankrune`)

**Varp transitions in script:**
- → `druidspirit_blessed` (40)
- → `druidspirit_started` (5)

### `druidspirit_killed_ghast2` (value 100)

**Interact:**
- opnpc1 → `priestperiltrappedmonk2` (Drezel)

**Dialog options (click by text):**
- `Sorry, not interested...`
- `Well, I'm going to look around a bit more.`
- `Where should I look for Filliman Tarlock again?`
- `Who is this Filliman?`

**Items required:**
- Rune essence (`blankrune`)
- cert_blankrune (`cert_blankrune`)
- Wolfbane (`dagger_wolfbane`)
- Silver sickle (`silver_sickle`)

**Items consumed:**
- Rune essence (`blankrune`)

**Varp transitions in script:**
- → `druidspirit_blessed` (40)
- → `druidspirit_started` (5)

### `druidspirit_killed_ghast3` (value 105)

**Interact:**
- opnpc1 → `priestperiltrappedmonk2` (Drezel)

**Dialog options (click by text):**
- `Sorry, not interested...`
- `Well, I'm going to look around a bit more.`
- `Where should I look for Filliman Tarlock again?`
- `Who is this Filliman?`

**Items required:**
- Rune essence (`blankrune`)
- cert_blankrune (`cert_blankrune`)
- Wolfbane (`dagger_wolfbane`)
- Silver sickle (`silver_sickle`)

**Items consumed:**
- Rune essence (`blankrune`)

**Varp transitions in script:**
- → `druidspirit_blessed` (40)
- → `druidspirit_started` (5)

### `druidspirit_complete` (value 110)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `mort_myre_gate_guard` (Ulizius)
- opnpc1 → `priestperiltrappedmonk2` (Drezel)

**Dialog options (click by text):**
- `Sorry, not interested...`
- `Well, I'm going to look around a bit more.`
- `Where should I look for Filliman Tarlock again?`
- `Who is this Filliman?`

**Items required:**
- Rune essence (`blankrune`)
- cert_blankrune (`cert_blankrune`)
- Wolfbane (`dagger_wolfbane`)
- Silver sickle (`silver_sickle`)
- Clue scroll (`trail_clue_medium_anagram016`)

**Items consumed:**
- Rune essence (`blankrune`)

**Varp transitions in script:**
- → `druidspirit_blessed` (40)
- → `druidspirit_started` (5)

## Source scripts

- `scripts/quests/quest_druidspirit/scripts/quest_druidspirit.rs2`
- `scripts/quests/quest_druidspirit/scripts/ghast.rs2`
- `scripts/quests/quest_druidspirit/scripts/filliman.rs2`
- `scripts/quests/quest_druidspirit/scripts/mort_myre_gate_guard.rs2`
- `scripts/areas/area_mausoleum/scripts/drezel.rs2`
- `scripts/general/scripts/quests.rs2`
