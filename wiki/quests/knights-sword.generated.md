# The Knight's Sword (generated)

> Auto-generated from server RS2 source. Slug: `squire`, varp: `%squire`, complete: `squire_complete` (= 7).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `squire` |
| Progress varp | `%squire` |
| Complete constant | `squire_complete` (7) |

## NPCs

### Reldo (`reldo`)
- Primary spawn: (3209, 3495, level 0)

### Squire (`squire`)
- Primary spawn: (2977, 3342, level 0)

### Thurgo (`thurgo`)
- Primary spawn: (3001, 3144, level 0)

## Items

- `blurite_ore` — Blurite ore
- `faladian_sword` — Blurite sword
- `garlic` — Garlic
- `iron_bar` — Iron bar
- `knights_portrait` — Portrait
- `redberry_pie` — Redberry pie

## State machine

### `squire_not_started` (value 0)

### `squire_started` (value 1)

### `squire_spoken_reldo` (value 2)

**Interact:**
- opnpc1 → `thurgo` (Thurgo) → @thurgo_inquire

### `squire_given_pie` (value 3)

**Interact:**
- opnpc1 → `thurgo` (Thurgo) → @thurgo_special_sword_post_pie

### `squire_spoken_thurgo` (value 4)

### `squire_looking_portrait` (value 5)

### `squire_looking_blurite` (value 6)

### `squire_complete` (value 7)

**Journal:** Quest complete.

## Source scripts

- `scripts/quests/quest_squire/scripts/quest_squire.rs2`
- `scripts/areas/area_varrock/scripts/reldo.rs2`
- `scripts/areas/area_falador/scripts/squire.rs2`
- `scripts/areas/area_port_sarim/scripts/thurgo.rs2`
- `scripts/general/scripts/quests.rs2`
- `scripts/general_use/scripts/cupboards.rs2`
