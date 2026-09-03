# Temple of Ikov (generated)

> Auto-generated from server RS2 source. Slug: `ikov`, varp: `%ikov`, complete: `ikov_completed_armadyl` (= 80).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `ikov` |
| Progress varp | `%ikov` |
| Complete constant | `ikov_completed_armadyl` (80) |

## NPCs

### _guardian_of_armadyl (`_guardian_of_armadyl`)
- Spawn: not in map data (instanced / moved / members)

### Fire Warrior of Lesarkus (`ikov_firewarrior`)
- Spawn: not in map data (instanced / moved / members)

### Lucien (`ikov_lucien1`)
- Primary spawn: (2573, 3321, level 0)

### Winelda (`ikov_winelda`)
- Primary spawn: (2656, 9875, level 0)

## Items

- `ice_arrow` — Ice arrows
- `ikov_lever` — Lever
- `ikov_pendantofarmardyl` — Armadyl pendant
- `ikov_pendantoflucien` — Pendant of lucien
- `ikov_shinykey` — Shiny key
- `ikov_staffofarmardyl` — Staff of armadyl
- `limpwurt_root` — Limpwurt root

## State machine

### `ikov_not_started` (value 0)

### `ikov_lever` (value 0)

### `ikov_bridge` (value 1)

### `ikov_started` (value 10)

### `ikov_disabled_trap` (value 20)

### `ikov_pulled_lever` (value 30)

### `ikov_defeated_fire_warrior` (value 40)

### `ikov_spoken_winelda` (value 50)

**Interact:**
- opnpc1 → `ikov_winelda` (Winelda)

**Dialog options (click by text):**
- `Nah, not bothered!`

**Items required:**
- Limpwurt root (`limpwurt_root`)

**Items consumed:**
- Limpwurt root (`limpwurt_root`)

**Varp transitions in script:**
- → `ikov_paid_winelda` (60)
- → `ikov_spoken_winelda` (50)

### `ikov_paid_winelda` (value 60)

### `ikov_helping_armadyl` (value 70)

### `ikov_completed_armadyl` (value 80)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `ikov_lucien1` (Lucien)

**Dialog options (click by text):**
- `I'm a mighty hero!`
- `That sounds like a laugh!`
- `Why can't you get it yourself?`
- `Yes! Here it is.`

**Items required:**
- Staff of armadyl (`ikov_staffofarmardyl`)

**Varp transitions in script:**
- → `ikov_paid_winelda` (60)
- → `ikov_started` (10)
- → `ikov_helping_armadyl` (70)

## Source scripts

- `scripts/quests/quest_ikov/scripts/fire_warrior_of_leskarus.rs2`
- `scripts/quests/quest_ikov/scripts/lucien.rs2`
- `scripts/quests/quest_ikov/scripts/ikov_dungeon.rs2`
- `scripts/quests/quest_ikov/scripts/guardian_of_armadyl.rs2`
- `scripts/quests/quest_ikov/scripts/quest_ikov.rs2`
- `scripts/quests/quest_ikov/scripts/winelda.rs2`
- `scripts/general/scripts/quests.rs2`
