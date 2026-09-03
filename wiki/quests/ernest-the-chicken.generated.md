# Ernest the Chicken (generated)

> Auto-generated from server RS2 source. Slug: `haunted`, varp: `%haunted`, complete: `haunted_complete` (= 3).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `haunted` |
| Progress varp | `%haunted` |
| Complete constant | `haunted_complete` (3) |

## NPCs

### Professor Oddenstein (`professor_oddenstein`)
- Primary spawn: (3110, 3367, level 2)

### Veronica (`veronica`)
- Primary spawn: (3110, 3330, level 0)

## Items

- `closet_key` — Key
- `coins` — Coins
- `fish_food` — Fish food
- `oil_can` — Oil can
- `poison` — Poison
- `poisoned_fish_food` — Poisoned fish food
- `pressure_gauge` — Pressure gauge
- `rubber_tube` — Rubber tube

## State machine

### `haunted_not_started` (value 0)

**Journal:** I can start this quest by speaking to Veronica who is outside Draynor Manor There aren't any requirements for this quest

**Interact:**
- opnpc1 → `veronica` (Veronica) → @haunted_start

**Dialog options (click by text):**
- `Aha, sounds like a quest. I'll help.`

**Varp transitions in script:**
- → `haunted_started` (1)

### `haunted_started` (value 1)

**Journal:** I have spoken to Veronica I need to find Ernest He went into Draynor Manor and hasn't returned

**Interact:**
- opnpc1 → `professor_oddenstein` (Professor Oddenstein) → @oddenstein_looking

**Dialog options (click by text):**
- `I'm glad Veronica didn't actually get engaged to a chicken.`
- `I'm looking for a guy called Ernest.`

### `haunted_spoken_to_oddenstein` (value 2)

**Journal:** I have spoken to Veronica I've spoken to Dr Oddenstein, and discovered Ernest is a chicken I need to bring Dr Oddenstein parts for his machine 1 Oil Can

**Interact:**
- opnpc1 → `professor_oddenstein` (Professor Oddenstein) → @oddenstein_items

**Dialog options (click by text):**
- `I'm glad Veronica didn't actually get engaged to a chicken.`
- `I'm looking for a guy called Ernest.`
- `What does this machine do?`

**Items required:**
- Oil can (`oil_can`)
- Pressure gauge (`pressure_gauge`)
- Rubber tube (`rubber_tube`)

**Items consumed:**
- Oil can (`oil_can`)
- Pressure gauge (`pressure_gauge`)
- Rubber tube (`rubber_tube`)

**Varp transitions in script:**
- → `haunted_spoken_to_oddenstein` (2)
- → `haunted_complete` (3)

### `haunted_complete` (value 3)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `veronica` (Veronica) → @veronica_postquest

**Dialog options (click by text):**
- `Aha, sounds like a quest. I'll help.`

**Varp transitions in script:**
- → `haunted_started` (1)
- → `haunted_spoken_to_oddenstein` (2)

## Source scripts

- `scripts/quests/quest_haunted/scripts/quest_haunted.rs2`
- `scripts/areas/area_draynor/scripts/veronica.rs2`
- `scripts/areas/area_draynor/scripts/professor_oddenstein.rs2`
- `scripts/general/scripts/quests.rs2`
