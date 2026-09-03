# Monk's Friend (generated)

> Auto-generated from server RS2 source. Slug: `drunkmonk`, varp: `%drunkmonkquest`, complete: `drunkmonk_complete` (= 80).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `drunkmonk` |
| Progress varp | `%drunkmonkquest` |
| Complete constant | `drunkmonk_complete` (80) |

## NPCs

### Brother Cedric (`brother_cedric`)
- Primary spawn: (2614, 3259, level 0)

### Brother Omad (`brother_omad`)
- Primary spawn: (2604, 3209, level 0)

### Monk (`monk_ardougne`)
- Primary spawn: (2606, 3217, level 0)
- Other spawns: (2608, 3209, level 0); (2618, 3209, level 0); (2595, 3210, level 1)

## Items

- `childs_blanket` — Child's blanket
- `jug_water` — Jug of water
- `lawrune` — Law rune
- `logs` — Logs

## State machine

### `drunkmonk_not_started` (value 0)

**Interact:**
- opnpc1 → `monk_ardougne` (Monk)
- opnpc1 → `brother_omad` (Brother Omad) → @omad_whats_wrong

**Dialog options (click by text):**
- `Why can't you sleep, what's wrong?`

### `drunkmonk_spoken_to_omad` (value 10)

**Interact:**
- opnpc1 → `monk_ardougne` (Monk)
- opnpc1 → `brother_omad` (Brother Omad) → @omad_have_blanket

**Items consumed:**
- Child's blanket (`childs_blanket`)

**Varp transitions in script:**
- → `drunkmonk_retrieved_blanket` (20)

### `drunkmonk_retrieved_blanket` (value 20)

**Interact:**
- opnpc1 → `brother_omad` (Brother Omad) → @omad_organize_party

**Dialog options (click by text):**
- `I've no time for that, sorry.`
- `Who's Brother Cedric?`

### `drunkmonk_looking_cedric` (value 30)

**Interact:**
- opnpc1 → `brother_cedric` (Brother Cedric) → @cedric_okay

**Varp transitions in script:**
- → `drunkmonk_finding_water` (40)

### `drunkmonk_finding_water` (value 40)

**Interact:**
- opnpc1 → `brother_cedric` (Brother Cedric) → @cedric_need_water

**Items consumed:**
- Jug of water (`jug_water`)

**Varp transitions in script:**
- → `drunkmonk_given_water` (50)

### `drunkmonk_given_water` (value 50)

**Interact:**
- opnpc1 → `brother_cedric` (Brother Cedric) → @cedric_fix_cart

**Dialog options (click by text):**
- `No, I've helped enough monks today!`

**Varp transitions in script:**
- → `drunkmonk_fixing_cart` (60)

### `drunkmonk_fixing_cart` (value 60)

**Interact:**
- opnpc1 → `brother_cedric` (Brother Cedric) → @cedric_get_wood

**Items consumed:**
- Logs (`logs`)

**Varp transitions in script:**
- → `drunkmonk_fixed_cart` (70)

### `drunkmonk_fixed_cart` (value 70)

**Interact:**
- opnpc1 → `brother_cedric` (Brother Cedric) → @cedric_almost_done
- opnpc1 → `brother_omad` (Brother Omad) → @omad_party

**Dialog options (click by text):**
- `No, I've helped enough monks today!`

**Items consumed:**
- Jug of water (`jug_water`)
- Logs (`logs`)

**Varp transitions in script:**
- → `drunkmonk_finding_water` (40)
- → `drunkmonk_given_water` (50)
- → `drunkmonk_fixing_cart` (60)
- → `drunkmonk_fixed_cart` (70)

### `drunkmonk_complete` (value 80)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `monk_ardougne` (Monk)
- opnpc1 → `brother_cedric` (Brother Cedric)
- opnpc1 → `brother_omad` (Brother Omad) → @omad_postparty

**Dialog options (click by text):**
- `Can I help at all?`
- `I've no time for that, sorry.`
- `No, I've helped enough monks today!`
- `Who's Brother Cedric?`
- `Why can't you sleep, what's wrong?`

**Items consumed:**
- Child's blanket (`childs_blanket`)
- Jug of water (`jug_water`)
- Logs (`logs`)

**Varp transitions in script:**
- → `drunkmonk_finding_water` (40)
- → `drunkmonk_given_water` (50)
- → `drunkmonk_fixing_cart` (60)
- → `drunkmonk_fixed_cart` (70)
- → `drunkmonk_spoken_to_omad` (10)
- → `drunkmonk_retrieved_blanket` (20)
- → `drunkmonk_looking_cedric` (30)

## Source scripts

- `scripts/quests/quest_drunkmonk/scripts/quest_drunkmonk.rs2`
- `scripts/areas/area_ardougne_east/scripts/ardounge_monk.rs2`
- `scripts/areas/area_ardougne_east/scripts/brother_cedric.rs2`
- `scripts/areas/area_ardougne_east/scripts/brother_omad.rs2`
- `scripts/general/scripts/quests.rs2`
