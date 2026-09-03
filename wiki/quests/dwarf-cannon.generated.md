# Dwarf Cannon (generated)

> Auto-generated from server RS2 source. Slug: `mcannon`, varp: `%mcannon`, complete: `mcannon_complete` (= 11).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `mcannon` |
| Progress varp | `%mcannon` |
| Complete constant | `mcannon_complete` (11) |

## NPCs

### Dwarf youngster (`dwarfchildtw1`)
- Spawn: not in map data (instanced / moved / members)

### Dwarf Commander (`lawgof2`)
- Primary spawn: (2571, 3463, level 0)

### Dwarf (`mcannonguard`)
- Primary spawn: (3016, 3448, level 0)
- Other spawns: (3016, 3450, level 0); (3017, 3447, level 0); (3021, 3447, level 0)…

### Nulodion (`nulodion`)
- Primary spawn: (3011, 3453, level 0)

## Items

- `ammo_mould` — Ammo mould
- `coins` — Coins
- `mcannonball` — Cannonball
- `mcannonbook` — Instruction manual
- `mcannonrailing1_obj` — Railing
- `mcannonremains` — Dwarf remains
- `mcannontoolkit` — Tool kit
- `nulodions_notes` — Nulodion's notes.
- `twpart1` — Cannon base
- `twpart2` — Cannon stand
- `twpart3` — Cannon barrels
- `twpart4` — Cannon furnace

## State machine

### `mcannon_not_started` (value 0)

**Interact:**
- opnpc1 → `lawgof2` (Dwarf Commander) → @lawgof2_start_quest

### `mcannon_tasked_with_fixing_railings` (value 1)

**Interact:**
- opnpc1 → `lawgof2` (Dwarf Commander) → @lawgof2_how_goes_fixing_those_fences

**Varp transitions in script:**
- → `mcannon_tasked_with_fixing_railings` (1)
- → `mcannon_tasked_with_checking_guard_tower` (2)

### `mcannon_tasked_with_checking_guard_tower` (value 2)

**Interact:**
- opnpc1 → `lawgof2` (Dwarf Commander) → @lawgof2_how_goes_finding_the_guard

**Items consumed:**
- Dwarf remains (`mcannonremains`)

**Varp transitions in script:**
- → `mcannon_tasked_with_checking_guard_tower` (2)
- → `mcannon_tasked_with_finding_goblin_cave` (3)

### `mcannon_tasked_with_finding_goblin_cave` (value 3)

**Interact:**
- opnpc1 → `lawgof2` (Dwarf Commander) → @lawgof2_how_goes_finding_the_goblin_cave

### `mcannon_tasked_with_finding_gilobs_son` (value 4)

**Interact:**
- opnpc1 → `lawgof2` (Dwarf Commander) → @lawgof2_how_goes_finding_gilobs_son

### `mcannon_return_to_dwarf_commander` (value 5)

**Interact:**
- opnpc1 → `lawgof2` (Dwarf Commander) → @lawgof2_found_gilobs_son

### `mcannon_tasked_with_fixing_cannon` (value 6)

### `mcannon_inspected_cannon_first_time` (value 7)

### `mcannon_has_repaired_cannon` (value 8)

**Interact:**
- opnpc1 → `lawgof2` (Dwarf Commander) → @lawgof2_repaired_cannon

### `mcannon_tasked_with_speaking_to_nulodion` (value 9)

**Interact:**
- opnpc1 → `lawgof2` (Dwarf Commander) → @lawgof2_havent_spoken_to_nulodion
- opnpc3 → `nulodion` (Nulodion) → @mcannon_speak_with_nulodion_first_time

**Varp transitions in script:**
- → `mcannon_tasked_with_speaking_to_nulodion` (9)
- → `mcannon_return_to_dwarf_commander_with_notes` (10)

### `mcannon_return_to_dwarf_commander_with_notes` (value 10)

**Interact:**
- opnpc1 → `lawgof2` (Dwarf Commander) → @lawgof2_spoken_to_nulodion
- opnpc3 → `nulodion` (Nulodion) → @mcannon_speak_with_nulodion_should_return_to_dwarf_commander

**Items required:**
- Ammo mould (`ammo_mould`)
- Nulodion's notes. (`nulodions_notes`)

**Items consumed:**
- Ammo mould (`ammo_mould`)
- Nulodion's notes. (`nulodions_notes`)

### `mcannon_complete` (value 11)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `lawgof2` (Dwarf Commander) → @lawgof2_post_quest
- opnpc3 → `nulodion` (Nulodion) → @nulodion_post_quest

**Items consumed:**
- Ammo mould (`ammo_mould`)
- Dwarf remains (`mcannonremains`)
- Nulodion's notes. (`nulodions_notes`)

**Varp transitions in script:**
- → `mcannon_not_started` (0)
- → `mcannon_tasked_with_fixing_railings` (1)
- → `mcannon_tasked_with_checking_guard_tower` (2)
- → `mcannon_tasked_with_finding_goblin_cave` (3)
- → `mcannon_return_to_dwarf_commander` (5)
- → `mcannon_tasked_with_fixing_cannon` (6)
- → `mcannon_has_repaired_cannon` (8)
- → `mcannon_tasked_with_speaking_to_nulodion` (9)

## Source scripts

- `scripts/quests/quest_mcannon/scripts/cannon_setup.rs2`
- `scripts/quests/quest_mcannon/scripts/quest_mcannon.rs2`
- `scripts/quests/quest_mcannon/scripts/npcs/dwarfchildtw1.rs2`
- `scripts/quests/quest_mcannon/scripts/npcs/lawgof2.rs2`
- `scripts/quests/quest_mcannon/scripts/npcs/mcannonguard.rs2`
- `scripts/quests/quest_mcannon/scripts/npcs/nulodion.rs2`
- `scripts/quests/quest_mcannon/scripts/objs/dwarf_remains.rs2`
- `scripts/quests/quest_mcannon/scripts/locs/mcannon_crate.rs2`
- `scripts/quests/quest_mcannon/scripts/locs/mcannon_cave.rs2`
- `scripts/quests/quest_mcannon/scripts/locs/mcannon_broken_cannon.rs2`
- `scripts/quests/quest_mcannon/scripts/locs/railings.rs2`
- `scripts/quests/quest_mcannon/scripts/locs/mcannon_doors.rs2`
- `scripts/quests/quest_mcannon/scripts/locs/mcannon_ladders.rs2`
- `scripts/general/scripts/quests.rs2`
