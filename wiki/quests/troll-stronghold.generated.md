# Troll Stronghold (generated)

> Auto-generated from server RS2 source. Slug: `eadgar`, varp: `%eadgar_quest`, complete: `eadgar_complete` (= 110).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `eadgar` |
| Progress varp | `%eadgar_quest` |
| Complete constant | `eadgar_complete` (110) |

## NPCs

### Tegid (`eadgar_druid_washing`)
- Primary spawn: (2913, 3417, level 0)

### Burntmeat (`eadgar_troll_chief_cook`)
- Primary spawn: (2844, 10057, level 1)

### Thistle (`eadgar_troll_thistle`)
- Primary spawn: (2891, 3676, level 0)

### Parroty Pete (`eadgar_zoo_keeper_aviary`)
- Primary spawn: (2611, 3285, level 0)

### Sanfew (`sanfew`)
- Primary spawn: (2897, 3426, level 1)

## Items

- `burnt_meat` — Burnt meat
- `eadgar_alco_chunks` — Alco-chunks
- `eadgar_dirty_druid_robe` — Dirty robe
- `eadgar_drunk_parrot` — Drunk parrot
- `eadgar_fake_man` — Fake man
- `eadgar_goutweed_herb` — Goutweed
- `eadgar_ground_troll_thistle_potion` — Troll potion
- `eadgar_troll_storeroom_key` — Storeroom key
- `eadgar_troll_thistle` — Troll thistle
- `enchanted_bear_meat` — Enchanted bear
- `enchanted_beef` — Enchanted beef
- `enchanted_chicken` — Enchanted chicken
- `enchanted_rat_meat` — Enchanted rat
- `grain` — Grain
- `karamja_rum` — Karamjan rum
- `logs` — Logs
- `pineapple_chunks` — Pineapple chunks
- `plaguesample` — Plague sample
- `raw_chicken` — Raw chicken
- `thanainabarrel` — Ana in a barrel

## State machine

### `eadgar_pete_dialog_1` (value 0)

### `eadgar_given_logs` (value 1)

### `eadgar_given_clothes` (value 2)

### `eadgar_started` (value 10)

**Interact:**
- label → `eadgar_quest_dialog` (eadgar_quest_dialog) → @eadgar_quest_initial_tree

**Dialog options (click by text):**
- `I need to find some goutweed.`

### `eadgar_pete_dialog_2` (value 11)

### `eadgar_spoken_eadgar_first` (value 15)

### `eadgar_spoken_burntmeat_first` (value 20)

**Interact:**
- label → `eadgar_quest_dialog` (eadgar_quest_dialog) → @eadgar_need_goutweed

**Varp transitions in script:**
- → `eadgar_spoken_burntmeat_first` (20)

### `eadgar_spoken_burntmeat_second` (value 25)

### `eadgar_needs_parrot` (value 30)

**Interact:**
- label → `eadgar_quest_dialog` (eadgar_quest_dialog) → @eadgar_got_parrot_yet

**Dialog options (click by text):**
- `Where's the zoo?`

**Items required:**
- Drunk parrot (`eadgar_drunk_parrot`)

**Varp transitions in script:**
- → `eadgar_explained_plan` (50)

### `eadgar_explained_plan` (value 50)

**Interact:**
- label → `eadgar_quest_dialog` (eadgar_quest_dialog) → @eadgar_hasnt_hidden_parrot

**Items required:**
- Drunk parrot (`eadgar_drunk_parrot`)

### `eadgar_hid_parrot` (value 60)

**Interact:**
- label → `eadgar_quest_dialog` (eadgar_quest_dialog) → @eadgar_hid_parrot

**Varp transitions in script:**
- → `eadgar_needs_items` (70)

### `eadgar_needs_items` (value 70)

**Interact:**
- label → `eadgar_quest_dialog` (eadgar_quest_dialog) → @eadgar_how_are_you_getting_on

### `eadgar_needs_potion` (value 80)

**Interact:**
- label → `eadgar_quest_dialog` (eadgar_quest_dialog) → @eadgar_got_troll_truth_potion

**Items required:**
- Troll potion (`eadgar_ground_troll_thistle_potion`)

**Items consumed:**
- Troll potion (`eadgar_ground_troll_thistle_potion`)

**Varp transitions in script:**
- → `eadgar_needs_parrot_back` (85)

### `eadgar_needs_parrot_back` (value 85)

**Interact:**
- label → `eadgar_quest_dialog` (eadgar_quest_dialog) → @eadgar_needs_parrot_back

### `eadgar_got_parrot_back` (value 86)

**Interact:**
- label → `eadgar_quest_dialog` (eadgar_quest_dialog) → @eadgar_got_parrot_back

**Items required:**
- Drunk parrot (`eadgar_drunk_parrot`)

### `eadgar_got_fake_man` (value 87)

**Interact:**
- label → `eadgar_quest_dialog` (eadgar_quest_dialog) → @eadgar_given_fake_man_yet

**Items required:**
- Fake man (`eadgar_fake_man`)

### `eadgar_got_burnt_meat` (value 90)

### `eadgar_unlocked_storeroom` (value 100)

### `eadgar_complete` (value 110)

**Journal:** Quest complete.

## Source scripts

- `scripts/quests/quest_eadgar/scripts/eadgar_troll_thistle.rs2`
- `scripts/quests/quest_eadgar/scripts/eadgar_zoo_keeper_aviary.rs2`
- `scripts/quests/quest_eadgar/scripts/eadgar_troll_chief_cook.rs2`
- `scripts/quests/quest_eadgar/scripts/eadgar_druid_washing.rs2`
- `scripts/quests/quest_eadgar/scripts/quest_eadgar.rs2`
- `scripts/quests/quest_troll/scripts/troll_eadgar.rs2`
- `scripts/areas/area_taverly/scripts/sanfew.rs2`
- `scripts/general/scripts/quests.rs2`
- `scripts/skill_magic/scripts/spells/teleport.rs2`
