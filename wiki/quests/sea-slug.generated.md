# Sea Slug (generated)

> Auto-generated from server RS2 source. Slug: `seaslug`, varp: `%seaslugquest`, complete: `seaslug_complete` (= 12).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `seaslug` |
| Progress varp | `%seaslugquest` |
| Complete constant | `seaslug_complete` (12) |

## NPCs

### Bailey (`bailey`)
- Primary spawn: (2763, 3276, level 0)

### Caroline (`caroline`)
- Primary spawn: (2716, 3302, level 0)

### Holgart (`holgartland`)
- Primary spawn: (2720, 3306, level 0)

### Holgart (`holgartplatform`)
- Primary spawn: (2782, 3276, level 0)

### Holgart (`holgartsunkboat`)
- Primary spawn: (2799, 3320, level 0)

### Kent (`kent`)
- Primary spawn: (2793, 3321, level 0)

### Sea slug (`seaslug`)
- Primary spawn: (2761, 3284, level 0)
- Other spawns: (2766, 3274, level 0); (2766, 3277, level 0); (2766, 3286, level 0)…

## Items

- `bigoysterpearls` — Oyster pearls
- `damp_sticks` — Damp sticks
- `dry_sticks` — Dry sticks
- `pot_empty` — Pot
- `pot_flour` — Pot of flour
- `rawswamppaste` — Raw swamp paste
- `swamp_tar` — Swamp tar
- `swamppaste` — Swamp paste
- `torch_lit` — Torch
- `torch_unlit` — Torch

## State machine

### `seaslug_not_started` (value 0)

**Interact:**
- opnpc1 → `caroline` (Caroline) → @caroline_help
- opnpc1 → `holgartland` (Holgart) → @holgart_prequest

**Dialog options (click by text):**
- `I suppose so, how do I get there?`

**Varp transitions in script:**
- → `seaslug_started` (1)

### `seaslug_started` (value 1)

**Interact:**
- opnpc1 → `holgartland` (Holgart) → @holgart_wantboat

**Varp transitions in script:**
- → `seaslug_spoken_holgart` (2)

### `seaslug_spoken_holgart` (value 2)

**Interact:**
- opnpc1 → `holgartland` (Holgart) → @holgart_paste

**Dialog options (click by text):**
- `I'll come back later.`

**Items consumed:**
- Swamp paste (`swamppaste`)

**Varp transitions in script:**
- → `seaslug_boat_repaired` (3)

### `seaslug_boat_repaired` (value 3)

**Interact:**
- label → `kennith_chat` (kennith_chat)

**Varp transitions in script:**
- → `seaslug_spoken_kennith` (4)
- → `seaslug_kennith_need_escape` (8)
- → `seaslug_need_kennith_path` (10)

### `seaslug_spoken_kennith` (value 4)

**Interact:**
- opnpc1 → `holgartplatform` (Holgart) → @holgart_something_strange
- label → `kennith_chat` (kennith_chat)

**Varp transitions in script:**
- → `seaslug_sailed_kent` (5)
- → `seaslug_spoken_kennith` (4)
- → `seaslug_kennith_need_escape` (8)
- → `seaslug_need_kennith_path` (10)

### `seaslug_sailed_kent` (value 5)

**Interact:**
- opnpc1 → `holgartland` (Holgart) → @holgart_back_kent

### `seaslug_spoken_kent` (value 6)

**Interact:**
- opnpc1 → `bailey` (Bailey)

**Items required:**
- Torch (`torch_lit`)
- Torch (`torch_unlit`)

### `seaslug_lit_torch` (value 7)

**Interact:**
- label → `kennith_chat` (kennith_chat)

**Varp transitions in script:**
- → `seaslug_spoken_kennith` (4)
- → `seaslug_kennith_need_escape` (8)
- → `seaslug_need_kennith_path` (10)

### `seaslug_kennith_need_escape` (value 8)

### `seaslug_panel_opened` (value 9)

**Interact:**
- label → `kennith_chat` (kennith_chat)

**Varp transitions in script:**
- → `seaslug_spoken_kennith` (4)
- → `seaslug_kennith_need_escape` (8)
- → `seaslug_need_kennith_path` (10)

### `seaslug_need_kennith_path` (value 10)

### `seaslug_saved_kennith` (value 11)

**Interact:**
- opnpc1 → `holgartplatform` (Holgart) → @holgart_kid_shore
- opnpc1 → `caroline` (Caroline) → @caroline_savedkennith

**Varp transitions in script:**
- → `seaslug_complete` (12)

### `seaslug_complete` (value 12)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `caroline` (Caroline) → @caroline_postquest
- opnpc1 → `holgartland` (Holgart) → @holgart_fancy

**Dialog options (click by text):**
- `I'll come back later.`

## Source scripts

- `scripts/quests/quest_seaslug/scripts/quest_seaslug.rs2`
- `scripts/areas/area_fishing_platform/scripts/holgart_platform.rs2`
- `scripts/areas/area_fishing_platform/scripts/holgart_island.rs2`
- `scripts/areas/area_fishing_platform/scripts/kent.rs2`
- `scripts/areas/area_fishing_platform/scripts/bailey.rs2`
- `scripts/areas/area_fishing_platform/scripts/kennith.rs2`
- `scripts/areas/area_ardougne_east/scripts/caroline.rs2`
- `scripts/areas/area_ardougne_east/scripts/holgart_ardougne.rs2`
- `scripts/general/scripts/quests.rs2`
