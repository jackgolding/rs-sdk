# Imp Catcher (generated)

> Auto-generated from server RS2 source. Slug: `imp`, varp: `%imp`, complete: `imp_complete` (= 2).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `imp` |
| Progress varp | `%imp` |
| Complete constant | `imp_complete` (2) |

## NPCs

### Wizard Mizgog (`wizard_mizgog`)
- Primary spawn: (3103, 3163, level 2)

## Items

- `amulet_of_accuracy` — Amulet of accuracy
- `black_bead` — Black bead
- `red_bead` — Red bead
- `white_bead` — White bead
- `yellow_bead` — Yellow bead

## State machine

### `imp_not_started` (value 0)

**Journal:** I can start this quest by talking to Wizard Mizgog in the Wizards' Tower.

**Interact:**
- opnpc1 → `wizard_mizgog` (Wizard Mizgog)

**Dialog options (click by text):**
- `Give me a quest please.`
- `Give me a quest!`
- `Got any more quests?`

**Items required:**
- Black bead (`black_bead`)
- Red bead (`red_bead`)
- White bead (`white_bead`)
- Yellow bead (`yellow_bead`)

**Items consumed:**
- Black bead (`black_bead`)
- Red bead (`red_bead`)
- White bead (`white_bead`)
- Yellow bead (`yellow_bead`)

**Varp transitions in script:**
- → `imp_started` (1)

### `imp_started` (value 1)

**Journal:** I have spoken to Wizard Mizgog. I have collected all the missing beads and need to return them to Wizard Mizgog.

**Interact:**
- opnpc1 → `wizard_mizgog` (Wizard Mizgog)

**Dialog options (click by text):**
- `Give me a quest please.`
- `Give me a quest!`
- `Got any more quests?`

**Items required:**
- Black bead (`black_bead`)
- Red bead (`red_bead`)
- White bead (`white_bead`)
- Yellow bead (`yellow_bead`)

**Items consumed:**
- Black bead (`black_bead`)
- Red bead (`red_bead`)
- White bead (`white_bead`)
- Yellow bead (`yellow_bead`)

**Varp transitions in script:**
- → `imp_started` (1)

### `imp_complete` (value 2)

**Journal:** Quest complete.

## Source scripts

- `scripts/quests/quest_imp/scripts/quest_imp.rs2`
- `scripts/areas/area_wizard_tower/scripts/wizard_mizgog.rs2`
- `scripts/general/scripts/quests.rs2`
