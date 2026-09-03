# Tribal Totem (generated)

> Auto-generated from server RS2 source. Slug: `totem`, varp: `%totemquest`, complete: `totem_complete` (= 5).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `totem` |
| Progress varp | `%totemquest` |
| Complete constant | `totem_complete` (5) |

## NPCs

### Wizard Cromperty (`ardounge_wizard`)
- Primary spawn: (2683, 3326, level 0)

### Horacio (`horacio`)
- Primary spawn: (2635, 3311, level 0)

### Kangai Mau (`kangai_mau`)
- Primary spawn: (2791, 3182, level 0)

### RPDT employee (`rpdt_employee`)
- Primary spawn: (2644, 3274, level 0)
- Other spawns: (2644, 3276, level 0); (2647, 3271, level 0)

## Items

- `swordfish` — Swordfish
- `trail_clue_medium_anagram019` — Clue scroll
- `tribal_totem` — Totem
- `tribal_totem_label` — Address label

## State machine

### `totem_not_started` (value 0)

**Interact:**
- opnpc1 → `kangai_mau` (Kangai Mau) → @kangai_mau_prequest

**Dialog options (click by text):**
- `And what are you doing in Brimhaven?`

### `totem_started` (value 1)

### `totem_crate_marked` (value 2)

### `totem_crate_delivered` (value 3)

### `totem_teleported` (value 4)

### `totem_complete` (value 5)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `kangai_mau` (Kangai Mau)

**Dialog options (click by text):**
- `And what are you doing in Brimhaven?`
- `Ok, I will get it back.`
- `Tell me of this mission.`

**Items required:**
- Clue scroll (`trail_clue_medium_anagram019`)
- Totem (`tribal_totem`)

**Items consumed:**
- Totem (`tribal_totem`)

**Varp transitions in script:**
- → `totem_started` (1)

## Source scripts

- `scripts/quests/quest_totem/scripts/quest_totem.rs2`
- `scripts/areas/area_ardougne_east/scripts/horacio.rs2`
- `scripts/areas/area_ardougne_east/scripts/rdpt_employee.rs2`
- `scripts/areas/area_ardougne_east/scripts/wizard_cromperty.rs2`
- `scripts/areas/area_brimhaven/scripts/kangai_mau.rs2`
- `scripts/general/scripts/quests.rs2`
