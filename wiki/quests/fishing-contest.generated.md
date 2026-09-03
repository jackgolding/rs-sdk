# Fishing Contest (generated)

> Auto-generated from server RS2 source. Slug: `fishingcompo`, varp: `%fishingcompo`, complete: `fishingcompo_complete` (= 5).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `fishingcompo` |
| Progress varp | `%fishingcompo` |
| Complete constant | `fishingcompo_complete` (5) |

## NPCs

### Fishing spot (`0_41_53_compofishspot`)
- Primary spawn: (2630, 3435, level 0)

### Bonzo (`bonzo`)
- Primary spawn: (2641, 3439, level 0)

### Grandpa Jack (`grandpa_jack`)
- Primary spawn: (2650, 3452, level 0)

### A Sinister Stranger (`sinister_stranger`)
- Primary spawn: (2637, 3440, level 0)

### Mountain Dwarf (`tunnel_dwarf`)
- Primary spawn: (2820, 3487, level 0)
- Other spawns: (2821, 3487, level 0); (2876, 3483, level 0); (2877, 3483, level 0)

## Items

- `coins` — Coins
- `fishing_competition_pass` — Fishing pass
- `garlic` — Garlic
- `hemenster_fishing_trophy` — Fishing trophy
- `raw_giant_carp` — Raw giant carp
- `raw_sardine` — Raw sardine
- `raw_shrimp` — Raw shrimps
- `red_vine_worm` — Red vine worm

## State machine

### `fishingcompo_not_started` (value 0)

**Interact:**
- oploc1 → `tunnelstairstop` (tunnelstairstop) → @tunnel_dwarf_stairs
- opnpc1 → `tunnel_dwarf` (Mountain Dwarf) → @tunnel_dwarf_start

**Dialog options (click by text):**
- `I didn't want to anyway.`
- `I don't have one of them.`
- `I was just wondering what was down those stairs?`

**Items required:**
- Fishing pass (`fishing_competition_pass`)

**Items consumed:**
- Garlic (`garlic`)

**Varp transitions in script:**
- → `fishingcompo_complete` (5)
- → `fishingcompo_garlic_comp` (3)

### `fishingcompo_started` (value 1)

### `fishingcompo_in_comp` (value 2)

### `fishingcompo_garlic_comp` (value 3)

### `fishingcompo_won_comp` (value 4)

### `fishingcompo_complete` (value 5)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `tunnel_dwarf` (Mountain Dwarf)

**Dialog options (click by text):**
- `And how am I meant to do that?`
- `Fortunately I'm alright at fishing!`
- `I didn't want to anyway.`
- `I need another competition pass.`
- `I was just wondering what was down those stairs?`
- `Ooh... is this a shortcut to somewhere?`
- `Well, let's be friends!`
- `Why not?`

**Items required:**
- Fishing pass (`fishing_competition_pass`)
- Fishing trophy (`hemenster_fishing_trophy`)

**Items consumed:**
- Fishing trophy (`hemenster_fishing_trophy`)

**Varp transitions in script:**
- → `fishingcompo_started` (1)
- → `fishingcompo_won_comp` (4)

## Source scripts

- `scripts/quests/quest_fishingcompo/scripts/quest_fishingcompo.rs2`
- `scripts/quests/quest_fishingcompo/scripts/hemenster_fishing.rs2`
- `scripts/areas/area_white_wolf_mountain/scripts/mountain_dwarf.rs2`
- `scripts/areas/area_seers/scripts/hemenster/sinister_stranger.rs2`
- `scripts/areas/area_seers/scripts/hemenster/grandpa_jack.rs2`
- `scripts/areas/area_seers/scripts/hemenster/bonzo.rs2`
- `scripts/general/scripts/quests.rs2`
