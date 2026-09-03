# Witch's Potion (generated)

> Auto-generated from server RS2 source. Slug: `hetty`, varp: `%hetty`, complete: `hetty_complete` (= 3).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `hetty` |
| Progress varp | `%hetty` |
| Complete constant | `hetty_complete` (3) |

## NPCs

### Hetty (`hetty`)
- Primary spawn: (2968, 3206, level 0)

## Items

- `burnt_meat` — Burnt meat
- `eye_of_newt` — Eye of newt
- `onion` — Onion
- `rats_tail` — Rats tail

## State machine

### `hetty_not_started` (value 0)

**Journal:** I can start this quest by speaking to Hetty in her house in Rimmington, West of Port Sarim

**Interact:**
- opnpc1 → `hetty` (Hetty)

**Dialog options (click by text):**
- `I am in search of a quest.`
- `Yes I'd like to improve my magic.`
- `Yes help me become one with my darker side.`

**Items required:**
- Burnt meat (`burnt_meat`)
- Eye of newt (`eye_of_newt`)
- Onion (`onion`)
- Rats tail (`rats_tail`)

**Items consumed:**
- Burnt meat (`burnt_meat`)
- Eye of newt (`eye_of_newt`)
- Onion (`onion`)
- Rats tail (`rats_tail`)

**Varp transitions in script:**
- → `hetty_objects_given` (2)
- → `hetty_started` (1)

### `hetty_started` (value 1)

**Journal:** I spoke to Hetty in her house at Rimmington. Hetty told me she could increase my magic power if I can bring her certain ingredients for a potion. Hetty needs me to bring her the following: I have an onion with me

### `hetty_objects_given` (value 2)

**Journal:** I brought her an onion, a rat's tail, a piece of burnt meat and an eye of newt which she used to make a potion. I should drink from the cauldron and improve my magic!

### `hetty_complete` (value 3)

**Journal:** Quest complete.

## Source scripts

- `scripts/quests/quest_hetty/scripts/quest_hetty.rs2`
- `scripts/areas/area_rimmington/scripts/hetty.rs2`
- `scripts/general/scripts/quests.rs2`
- `scripts/drop tables/scripts/rat.rs2`
