# Fight Arena (generated)

> Auto-generated from server RS2 source. Slug: `arena`, varp: `%arenaquest`, complete: `arena_complete` (= 14).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `arena` |
| Progress varp | `%arenaquest` |
| Complete constant | `arena_complete` (14) |

## NPCs

### Khazard Guard (`arena_guard4`)
- Primary spawn: (2564, 3146, level 0)
- Other spawns: (2567, 3149, level 0); (2570, 3142, level 0); (2577, 3162, level 0)…

### Local (`arena_local`)
- Primary spawn: (2583, 3171, level 0)

### General Khazard (`general_khazard`)
- Primary spawn: (2606, 3154, level 0)
- Other spawns: (2610, 3143, level 2)

### Justin Servil (`justin_servil`)
- Primary spawn: (2601, 3168, level 0)

### Khazard barman (`khazard_barman`)
- Primary spawn: (2566, 3140, level 0)

### Lady Servil (`lady_servil`)
- Primary spawn: (2566, 3199, level 0)

## Items

- `beer` — Beer
- `coins` — Coins
- `ice_arrow` — Ice arrows
- `khali_brew` — Khali brew
- `khazard_cellkeys` — Khazard cell keys
- `khazard_helmet` — Khazard helmet
- `khazard_platemail` — Khazard armour
- `mappart2` — Map part
- `silverlight` — Silverlight

## State machine

### `arena_not_started` (value 0)

**Interact:**
- opnpc1 → `lady_servil` (Lady Servil)

**Dialog options (click by text):**
- `I hope you can, good luck.`

**Varp transitions in script:**
- → `arena_started` (1)

### `arena_started` (value 1)

### `arena_obtained_armour` (value 2)

**Interact:**
- opnpc1 → `lady_servil` (Lady Servil)

**Dialog options (click by text):**
- `I hope you can, good luck.`

**Varp transitions in script:**
- → `arena_started` (1)

### `arena_spoken_drunkguard` (value 3)

### `arena_given_khali_brew` (value 5)

### `arena_entered_ogre_fight` (value 6)

**Interact:**
- opnpc1 → `arena_local` (Local)
- opnpc1 → `justin_servil` (Justin Servil)

### `arena_defeated_ogre` (value 8)

**Interact:**
- opnpc1 → `justin_servil` (Justin Servil)
- opnpc1 → `general_khazard` (General Khazard)

**Varp transitions in script:**
- → `arena_sent_jail` (9)
- → `arena_freed_servils` (12)
- → `arena_defeated_genkhazard` (13)

### `arena_sent_jail` (value 9)

**Interact:**
- opnpc1 → `justin_servil` (Justin Servil)

### `arena_defeated_scorpion` (value 10)

**Interact:**
- opnpc1 → `justin_servil` (Justin Servil)

### `arena_defeated_bouncer` (value 11)

**Interact:**
- opnpc1 → `justin_servil` (Justin Servil)

### `arena_freed_servils` (value 12)

**Interact:**
- opnpc1 → `justin_servil` (Justin Servil)
- opnpc1 → `general_khazard` (General Khazard)

**Varp transitions in script:**
- → `arena_sent_jail` (9)
- → `arena_freed_servils` (12)
- → `arena_defeated_genkhazard` (13)

### `arena_defeated_genkhazard` (value 13)

**Interact:**
- opnpc1 → `justin_servil` (Justin Servil)

### `arena_complete` (value 14)

**Journal:** Quest complete.

## Source scripts

- `scripts/quests/quest_arena/scripts/khazard_ogre.rs2`
- `scripts/quests/quest_arena/scripts/hengrad.rs2`
- `scripts/quests/quest_arena/scripts/local.rs2`
- `scripts/quests/quest_arena/scripts/quest_arena.rs2`
- `scripts/quests/quest_arena/scripts/bouncer.rs2`
- `scripts/quests/quest_arena/scripts/lady_servil.rs2`
- `scripts/quests/quest_arena/scripts/justin_servil.rs2`
- `scripts/quests/quest_arena/scripts/fightslave.rs2`
- `scripts/quests/quest_arena/scripts/jeremy_servil.rs2`
- `scripts/quests/quest_arena/scripts/general_khazard.rs2`
- `scripts/quests/quest_arena/scripts/khazard_scorpion.rs2`
- `scripts/quests/quest_arena/scripts/khazard_guard.rs2`
- `scripts/quests/quest_arena/scripts/khazard_barman.rs2`
- `scripts/general/scripts/quests.rs2`
- `scripts/skill_combat/scripts/npc/npc_combat.rs2`
