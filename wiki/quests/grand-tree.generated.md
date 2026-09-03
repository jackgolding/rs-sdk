# The Grand Tree (generated)

> Auto-generated from server RS2 source. Slug: `grandtree`, varp: `%grandtree`, complete: `grandtree_complete` (= 160).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `grandtree` |
| Progress varp | `%grandtree` |
| Complete constant | `grandtree_complete` (160) |

## NPCs

### Anita (`grandtree_anita`)
- Primary spawn: (2390, 3514, level 1)

### Black Demon (`grandtree_blackdemon`)
- Spawn: not in map data (instanced / moved / members)

### Femi (`grandtree_femi`)
- Primary spawn: (2459, 3382, level 0)

### Foreman (`grandtree_foreman`)
- Primary spawn: (2999, 3043, level 0)

### Glough (`grandtree_glough`)
- Primary spawn: (2478, 3463, level 1)

### Hazelmere (`grandtree_hazelmere`)
- Primary spawn: (2678, 3086, level 1)

### King Narnode Shareen (`grandtree_narnode`)
- Primary spawn: (2466, 3497, level 0)
- Other spawns: (2464, 9897, level 0)

## Items

- `coins` — Coins
- `grandtree_barksample` — Bark sample
- `grandtree_daconiarock` — Daconia rock
- `grandtree_gloughskey` — Glough's key
- `grandtree_invasionplans` — Invasion plans
- `grandtree_journal` — Glough's journal
- `grandtree_order` — Lumber order
- `grandtree_scroll` — Hazelmere's scroll
- `grandtree_translationbook` — Translation book
- `grandtree_twigo` — Twigs
- `grandtree_twigt` — Twigs
- `grandtree_twigu` — Twigs
- `grandtree_twigz` — Twigs
- `plaguesample` — Plague sample
- `trail_clue_hard_riddle021` — Clue scroll
- `trail_clue_hard_riddle021_puzzlebox` — Puzzle box
- `trail_clue_medium_anagram001` — Clue scroll
- `trail_clue_medium_anagram001_challenge` — Challenge scroll
- `trail_clue_medium_anagram013` — Clue scroll

## State machine

### `grandtree_not_started` (value 0)

### `grandtree_started` (value 10)

**Interact:**
- opnpc1 → `grandtree_hazelmere` (Hazelmere)

**Items required:**
- Bark sample (`grandtree_barksample`)
- Clue scroll (`trail_clue_medium_anagram001`)
- Challenge scroll (`trail_clue_medium_anagram001_challenge`)

**Items consumed:**
- Bark sample (`grandtree_barksample`)

**Varp transitions in script:**
- → `grandtree_spoken_hazelmere` (20)

### `grandtree_spoken_hazelmere` (value 20)

**Interact:**
- opnpc1 → `grandtree_hazelmere` (Hazelmere) → @hazelmere_write_scroll

### `grandtree_relayed_message_narnode` (value 30)

### `grandtree_spoken_glough` (value 40)

### `grandtree_found_prisoner` (value 50)

### `grandtree_spoken_prisoner` (value 60)

### `grandtree_found_journal` (value 70)

**Interact:**
- opnpc1 → `grandtree_glough` (Glough)
- apnpc1 → `grandtree_charlie` (Charlie)

**Varp transitions in script:**
- → `grandtree_spoken_glough` (40)
- → `grandtree_clue_charlie` (100)
- → `grandtree_spoken_prisoner` (60)

### `grandtree_released_prison` (value 80)

**Interact:**
- apnpc1 → `grandtree_charlie` (Charlie)

**Varp transitions in script:**
- → `grandtree_clue_charlie` (100)
- → `grandtree_spoken_prisoner` (60)

### `grandtree_obtained_lumber_order` (value 90)

**Interact:**
- opnpc1 → `grandtree_glough` (Glough)
- apnpc1 → `grandtree_charlie` (Charlie)

**Varp transitions in script:**
- → `grandtree_spoken_glough` (40)
- → `grandtree_clue_charlie` (100)
- → `grandtree_spoken_prisoner` (60)

### `grandtree_clue_charlie` (value 100)

**Interact:**
- opnpc1 → `grandtree_glough` (Glough)

**Varp transitions in script:**
- → `grandtree_spoken_glough` (40)

### `grandtree_found_invasion_plans` (value 110)

**Interact:**
- apnpc1 → `grandtree_charlie` (Charlie)

**Varp transitions in script:**
- → `grandtree_clue_charlie` (100)
- → `grandtree_spoken_prisoner` (60)

### `grandtree_given_twigs` (value 120)

### `grandtree_unlocked_trapdoor` (value 130)

### `grandtree_defeated_black_demon` (value 140)

### `grandtree_searching_daconia` (value 150)

**Interact:**
- opnpc1 → `grandtree_narnode` (King Narnode Shareen)

**Dialog options (click by text):**
- `All with be fine on the third night.`
- `I gave the man Daconia rocks.`
- `I think so!`
- `I'm sorry, I don't want to get involved.`
- `King Narnode must be stopped, he is a madman!`
- `The tree is fine, you have nothing to fear.`
- `Time is of the essence! We must move quickly.`
- `You must use force!`
- `You seem worried, what's up?`

**Items required:**
- Bark sample (`grandtree_barksample`)
- Daconia rock (`grandtree_daconiarock`)
- Invasion plans (`grandtree_invasionplans`)
- Translation book (`grandtree_translationbook`)

**Items consumed:**
- Invasion plans (`grandtree_invasionplans`)
- Twigs (`grandtree_twigo`)
- Twigs (`grandtree_twigt`)
- Twigs (`grandtree_twigu`)
- Twigs (`grandtree_twigz`)

**Varp transitions in script:**
- → `grandtree_searching_daconia` (150)
- → `grandtree_given_twigs` (120)
- → `grandtree_found_prisoner` (50)
- → `grandtree_started` (10)
- → `grandtree_relayed_message_narnode` (30)
- → `grandtree_released_prison` (80)

### `grandtree_complete` (value 160)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `grandtree_narnode` (King Narnode Shareen)

**Dialog options (click by text):**
- `All with be fine on the third night.`
- `I gave the man Daconia rocks.`
- `I think so!`
- `I'm sorry, I don't want to get involved.`
- `King Narnode must be stopped, he is a madman!`
- `The tree is fine, you have nothing to fear.`
- `Time is of the essence! We must move quickly.`
- `You must use force!`
- `You seem worried, what's up?`

**Items required:**
- Bark sample (`grandtree_barksample`)
- Daconia rock (`grandtree_daconiarock`)
- Invasion plans (`grandtree_invasionplans`)
- Translation book (`grandtree_translationbook`)

**Items consumed:**
- Invasion plans (`grandtree_invasionplans`)
- Twigs (`grandtree_twigo`)
- Twigs (`grandtree_twigt`)
- Twigs (`grandtree_twigu`)
- Twigs (`grandtree_twigz`)

**Varp transitions in script:**
- → `grandtree_searching_daconia` (150)
- → `grandtree_given_twigs` (120)
- → `grandtree_found_prisoner` (50)
- → `grandtree_started` (10)
- → `grandtree_relayed_message_narnode` (30)
- → `grandtree_released_prison` (80)

## Source scripts

- `scripts/quests/quest_grandtree/scripts/quest_grandtree.rs2`
- `scripts/quests/quest_grandtree/scripts/king_narnode.rs2`
- `scripts/quests/quest_grandtree/scripts/foreman.rs2`
- `scripts/quests/quest_grandtree/scripts/glough.rs2`
- `scripts/quests/quest_grandtree/scripts/grandtree_black_demon.rs2`
- `scripts/quests/quest_grandtree/scripts/anita.rs2`
- `scripts/quests/quest_grandtree/scripts/charlie.rs2`
- `scripts/quests/quest_grandtree/scripts/femi.rs2`
- `scripts/areas/area_gnome/scripts/spirit_tree.rs2`
- `scripts/areas/area_gnome/scripts/gnome_gate.rs2`
- `scripts/areas/area_gnome/scripts/hazelmere.rs2`
- `scripts/areas/area_gnome/scripts/gnome_glider.rs2`
- `scripts/general/scripts/quests.rs2`
