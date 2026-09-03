# Hazeel Cult (generated)

> Auto-generated from server RS2 source. Slug: `hazeelcult`, varp: `%hazeelcultquest`, complete: `hazeelcult_complete` (= 9).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `hazeelcult` |
| Progress varp | `%hazeelcultquest` |
| Complete constant | `hazeelcult_complete` (9) |

## NPCs

### Alomone (`alomone_hazeel_cultist`)
- Primary spawn: (2609, 9670, level 0)

### Butler Jones (`butler_jones_hazeel_cultist`)
- Primary spawn: (2569, 3272, level 0)
- Other spawns: (2573, 3269, level 1)

### Claus the chef (`claus_carnillean`)
- Primary spawn: (2566, 9670, level 0)

### Clivet (`clivet_hazeel_cultist`)
- Primary spawn: (2566, 9683, level 0)

### Guard (`guard_carnillean`)
- Primary spawn: (2570, 3275, level 0)

### Hazeel Cultist (`hazeel_cultist`)
- Primary spawn: (2602, 9680, level 0)
- Other spawns: (2605, 9670, level 0); (2607, 9680, level 0); (2608, 9674, level 0)…

### Philipe Carnillean (`philipe_carnillean`)
- Primary spawn: (2565, 3273, level 0)

### Ceril Carnillean (`sir_ceril_carnillean`)
- Primary spawn: (2565, 3271, level 0)
- Other spawns: (2573, 3268, level 1)

## Items

- `carnillean_armour` — Carnillean armour
- `carnilleanchestkey` — Key
- `coins` — Coins
- `hazeel_scroll` — Scroll of hazeel
- `mark_of_hazeel` — Mark of hazeel
- `poison` — Poison

## State machine

### `hazeelcult_not_started` (value 0)

**Interact:**
- opnpc1 → `guard_carnillean` (Guard)
- opnpc1 → `philipe_carnillean` (Philipe Carnillean) → @philipe_toys
- opnpc1 → `clivet_hazeel_cultist` (Clivet)
- opnpc1 → `sir_ceril_carnillean` (Ceril Carnillean)

**Dialog options (click by text):**
- `No thanks. I've got other plans.`
- `No. I won't do it.`
- `What do you mean?`
- `What's wrong?`
- `You're crazy, I'd never help you.`

**Items required:**
- Carnillean armour (`carnillean_armour`)
- Scroll of hazeel (`hazeel_scroll`)
- Mark of hazeel (`mark_of_hazeel`)
- Poison (`poison`)

**Items consumed:**
- Carnillean armour (`carnillean_armour`)

**Varp transitions in script:**
- → `hazeelcult_finished_side_task` (6)
- → `hazeelcult_spoken_clivet` (3)
- → `hazeelcult_clivet_decision` (4)
- → `hazeelcult_started` (2)

### `hazeelcult_goodside` (value 0)

### `hazeelcult_evilside` (value 1)

### `hazeelcult_started` (value 2)

**Interact:**
- opnpc1 → `clivet_hazeel_cultist` (Clivet)

**Dialog options (click by text):**
- `No. I won't do it.`
- `What do you mean?`
- `You're crazy, I'd never help you.`

**Items required:**
- Scroll of hazeel (`hazeel_scroll`)
- Mark of hazeel (`mark_of_hazeel`)
- Poison (`poison`)

**Varp transitions in script:**
- → `hazeelcult_spoken_clivet` (3)
- → `hazeelcult_clivet_decision` (4)

### `hazeelcult_spoken_clivet` (value 3)

**Interact:**
- opnpc1 → `clivet_hazeel_cultist` (Clivet)

**Dialog options (click by text):**
- `No. I won't do it.`
- `What do you mean?`
- `You're crazy, I'd never help you.`

**Items required:**
- Scroll of hazeel (`hazeel_scroll`)
- Mark of hazeel (`mark_of_hazeel`)
- Poison (`poison`)

**Varp transitions in script:**
- → `hazeelcult_spoken_clivet` (3)
- → `hazeelcult_clivet_decision` (4)

### `hazeelcult_clivet_decision` (value 4)

**Interact:**
- opnpc1 → `hazeel_cultist` (Hazeel Cultist)
- opnpc1 → `alomone_hazeel_cultist` (Alomone)
- opnpc1 → `clivet_hazeel_cultist` (Clivet)

**Dialog options (click by text):**
- `No. I won't do it.`
- `What do you mean?`
- `You're crazy, I'd never help you.`

**Items required:**
- Scroll of hazeel (`hazeel_scroll`)
- Mark of hazeel (`mark_of_hazeel`)
- Poison (`poison`)

**Varp transitions in script:**
- → `hazeelcult_finished_side_task` (6)
- → `hazeelcult_spoken_clivet` (3)
- → `hazeelcult_clivet_decision` (4)

### `hazeelcult_poured_poison` (value 5)

**Interact:**
- opnpc1 → `guard_carnillean` (Guard)
- opnpc1 → `hazeel_cultist` (Hazeel Cultist)
- opnpc1 → `philipe_carnillean` (Philipe Carnillean)

**Varp transitions in script:**
- → `hazeelcult_finished_side_task` (6)

### `hazeelcult_finished_side_task` (value 6)

**Interact:**
- opnpc1 → `philipe_carnillean` (Philipe Carnillean)

### `hazeelcult_given_armour_or_scroll` (value 7)

### `hazeelcult_complete` (value 9)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `butler_jones_hazeel_cultist` (Butler Jones)
- opnpc1 → `claus_carnillean` (Claus the chef)

**Dialog options (click by text):**
- `Have you any more info on the Carnilleans?`

**Items required:**
- Scroll of hazeel (`hazeel_scroll`)
- Mark of hazeel (`mark_of_hazeel`)

**Items consumed:**
- Poison (`poison`)

**Varp transitions in script:**
- → `hazeelcult_finished_side_task` (6)
- → `hazeelcult_given_armour_or_scroll` (7)
- → `hazeelcult_clivet_decision` (4)
- → `hazeelcult_poured_poison` (5)

## Source scripts

- `scripts/quests/quest_hazeelcult/scripts/carnillean_guard.rs2`
- `scripts/quests/quest_hazeelcult/scripts/hazeel_cultist.rs2`
- `scripts/quests/quest_hazeelcult/scripts/butler_jones.rs2`
- `scripts/quests/quest_hazeelcult/scripts/philipe_carnillean.rs2`
- `scripts/quests/quest_hazeelcult/scripts/alomone.rs2`
- `scripts/quests/quest_hazeelcult/scripts/quest_hazeelcult.rs2`
- `scripts/quests/quest_hazeelcult/scripts/clivet.rs2`
- `scripts/quests/quest_hazeelcult/scripts/claus_the_chef.rs2`
- `scripts/quests/quest_hazeelcult/scripts/ceril_carnillean.rs2`
- `scripts/general/scripts/quests.rs2`
