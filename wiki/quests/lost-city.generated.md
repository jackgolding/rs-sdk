# Lost City (generated)

> Auto-generated from server RS2 source. Slug: `zanaris`, varp: `%zanaris`, complete: `zanaris_complete` (= 6).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `zanaris` |
| Progress varp | `%zanaris` |
| Complete constant | `zanaris_complete` (6) |

## NPCs

### Archer (`archeradventurerpg`)
- Primary spawn: (3145, 3200, level 0)

### Monk (`monkadventurerpg`)
- Primary spawn: (3147, 3202, level 0)

### Warrior (`warrioradventurerpg`)
- Primary spawn: (3145, 3202, level 0)

### Wizard (`wizardadventuterpg`)
- Primary spawn: (3148, 3200, level 0)

### Shamus (`zanarisleprechaun`)
- Spawn: not in map data (instanced / moved / members)

## Items

- `black_full_helm` — Black full helm
- `black_platebody` — Black platebody
- `black_platelegs` — Black platelegs
- `dramen_branch` — Dramen branch
- `dramen_staff` — Dramen staff

## State machine

### `zanaris_not_started` (value 0)

**Interact:**
- opnpc1 → `zanarisleprechaun` (Shamus)
- opnpc1 → `monkadventurerpg` (Monk)
- opnpc1 → `wizardadventuterpg` (Wizard)
- opnpc1 → `archeradventurerpg` (Archer)
- opnpc1 → `warrioradventurerpg` (Warrior)

**Dialog options (click by text):**
- `How does it fit in a shed then?`
- `I'm not sure.`
- `If it's hidden how are you planning to find it?`
- `Please tell me.`
- `Please tell me?`
- `What are you camped here for?`
- `Who's Zanaris?`

**Varp transitions in script:**
- → `zanaris_spoken_shamus` (2)
- → `zanaris_started` (1)

### `zanaris_started` (value 1)

**Interact:**
- opnpc1 → `zanarisleprechaun` (Shamus)
- opnpc1 → `monkadventurerpg` (Monk)
- opnpc1 → `wizardadventuterpg` (Wizard)
- opnpc1 → `archeradventurerpg` (Archer)
- opnpc1 → `warrioradventurerpg` (Warrior)

**Dialog options (click by text):**
- `How does it fit in a shed then?`
- `I'm not sure.`
- `If it's hidden how are you planning to find it?`
- `Please tell me.`
- `Please tell me?`
- `What are you camped here for?`
- `Who's Zanaris?`

**Varp transitions in script:**
- → `zanaris_spoken_shamus` (2)
- → `zanaris_started` (1)

### `zanaris_spoken_shamus` (value 2)

### `zanaris_spirit_defeated` (value 3)

### `zanaris_tree_chopped` (value 4)

### `zanaris_staff_made` (value 5)

### `zanaris_complete` (value 6)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `warrioradventurerpg` (Warrior)

**Dialog options (click by text):**
- `If it's hidden how are you planning to find it?`
- `Please tell me.`
- `Please tell me?`
- `What are you camped here for?`
- `Who's Zanaris?`

**Varp transitions in script:**
- → `zanaris_started` (1)

## Source scripts

- `scripts/quests/quest_zanaris/scripts/shamus.rs2`
- `scripts/quests/quest_zanaris/scripts/tree_spirit.rs2`
- `scripts/quests/quest_zanaris/scripts/quest_zanaris.rs2`
- `scripts/quests/quest_hero/scripts/quest_hero.rs2`
- `scripts/levelrequire/scripts/levelrequire.rs2`
- `scripts/areas/area_lumbridge/scripts/monk_zanaris.rs2`
- `scripts/areas/area_lumbridge/scripts/wizard_zanaris.rs2`
- `scripts/areas/area_lumbridge/scripts/archer_zanaris.rs2`
- `scripts/areas/area_lumbridge/scripts/warrior_zanaris.rs2`
- `scripts/general/scripts/quests.rs2`
