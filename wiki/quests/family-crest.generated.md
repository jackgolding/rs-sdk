# Family Crest (generated)

> Auto-generated from server RS2 source. Slug: `crest`, varp: `%crestquest`, complete: `crest_complete` (= 11).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `crest` |
| Progress varp | `%crestquest` |
| Complete constant | `crest_complete` (11) |

## NPCs

### _legends_guard (`_legends_guard`)
- Spawn: not in map data (instanced / moved / members)

### Man (`avan`)
- Primary spawn: (3295, 3285, level 0)

### Boot (`boot_the_dwarf`)
- Primary spawn: (2965, 9811, level 0)

### Caleb (`caleb_fitzharmon`)
- Primary spawn: (2819, 3451, level 0)

### Dimintheis (`dimintheis`)
- Primary spawn: (3279, 3404, level 0)

### Gem trader (`gem_trader`)
- Primary spawn: (3288, 3212, level 0)

### Johnathon (`johnathon_fitzharmon`)
- Primary spawn: (3279, 3503, level 1)

### Kebab seller (`kebab_seller`)
- Primary spawn: (3272, 3182, level 0)

### Silk trader (`silk_trader`)
- Primary spawn: (3299, 3204, level 0)

### Zeke (`zeke`)
- Primary spawn: (3288, 3190, level 0)

## Items

- `avan_crest` — Crest part
- `bass` — Bass
- `caleb_crest` — Crest part
- `coins` — Coins
- `family_crest` — Family crest
- `gauntlets_of_chaos` — Chaos gauntlets
- `gauntlets_of_cooking` — Cooking gauntlets
- `gauntlets_of_goldsmithing` — Goldsmith gauntlet
- `johnathon_crest` — Crest part
- `kebab` — Kebab
- `last_useitem` — last_useitem
- `perfect_ruby_necklace` — 'perfect' necklace
- `perfect_ruby_ring` — 'perfect' ring
- `salmon` — Salmon
- `shrimp` — Shrimps
- `silk` — Silk
- `steel_gauntlets` — Steel gauntlets
- `swordfish` — Swordfish
- `trail_clue_medium_anagram006` — Clue scroll
- `trail_clue_medium_anagram006_challenge` — Challenge scroll
- `tuna` — Tuna

## State machine

### `crest_not_started` (value 0)

**Journal:** I can start this quest by speaking to Dimintheis in East Varrock To complete this quest I need: Level 40 Mining Level 40 Crafting Level 40 Smithing Level 59 Magic I also need to be able to defeat a level 170 Demon

**Interact:**
- opnpc1 → `caleb_fitzharmon` (Caleb) → @caleb_fitzharmon_prequest

**Dialog options (click by text):**
- `Nothing, I will be on my way.`

### `crest_wind_blast_used` (value 0)

### `crest_spoken_dimintheis` (value 1)

**Journal:** I need to find his son Caleb. The last Dimintheis heard of him he was a great chef beyond White Wolf Mountain

**Interact:**
- opnpc1 → `caleb_fitzharmon` (Caleb) → @caleb_fitzharmon_start

**Dialog options (click by text):**
- `Are you Caleb Fitzharmon?`

### `crest_water_blast_used` (value 1)

### `crest_spoken_caleb` (value 2)

**Journal:** Caleb will let me have his piece in return for: I have cooked Tuna with me

**Interact:**
- opnpc1 → `caleb_fitzharmon` (Caleb) → @caleb_fitzharmon_fish

**Dialog options (click by text):**
- `Uh... what happened to the rest of it?`

**Items consumed:**
- Bass (`bass`)
- Salmon (`salmon`)
- Shrimps (`shrimp`)
- Swordfish (`swordfish`)
- Tuna (`tuna`)

**Varp transitions in script:**
- → `crest_caleb_piece` (3)

### `crest_earth_blast_used` (value 2)

### `crest_caleb_piece` (value 3)

**Journal:** I have one crest piece, I need to find the other two

**Interact:**
- opnpc1 → `caleb_fitzharmon` (Caleb) → @caleb_fitzharmon_salad

**Dialog options (click by text):**
- `Uh... what happened to the rest of it?`

### `crest_fire_blast_used` (value 3)

### `crest_caleb_where` (value 4)

**Journal:** Caleb told me his brother Avan is on a treasure hunt in the desert somewhere - I should search for him there

**Interact:**
- opnpc1 → `caleb_fitzharmon` (Caleb) → @caleb_fitzharmon_avan

### `crest_north_room_lever` (value 4)

### `crest_spoken_gem_trader` (value 5)

**Journal:** The Al-Kharid Gem Trader told me that Avan is wearing a yellow cape, and headed into the desert by the scorpions

**Interact:**
- opnpc1 → `avan` (Man) → @avan_intro

**Dialog options (click by text):**
- `Why are you hanging around in a scorpion pit?`

### `crest_north_lever` (value 5)

### `crest_spoken_avan` (value 6)

**Journal:** I should find a dwarf named Boot who lives somewhere in the mountains and knows where to find 'Perfect Gold'

**Interact:**
- opnpc1 → `avan` (Man) → @avan_gold

### `crest_south_lever` (value 6)

### `crest_spoken_boot` (value 7)

**Journal:** Avan will give me his crest piece if I can bring him a ruby ring and ruby necklace made from 'perfect gold' Boot told me 'perfect gold' can be found underground somewhere East of Ardougne, but is difficult to get to I have a ruby ring made of 'perfect gold' with me

**Interact:**
- opnpc1 → `avan` (Man) → @avan_jewelry

**Items consumed:**
- 'perfect' necklace (`perfect_ruby_necklace`)
- 'perfect' ring (`perfect_ruby_ring`)

**Varp transitions in script:**
- → `crest_avan_piece` (8)

### `crest_cooking_gauntlets_chosen` (value 7)

### `crest_avan_piece` (value 8)

**Journal:** The final crest piece is with their brother Johnathon who is a magical demon hunter at a tavern near the wilderness

**Interact:**
- opnpc1 → `avan` (Man) → @avan_where
- opnpc1 → `johnathon_fitzharmon` (Johnathon) → @johnathon_fitzharmon_intro

**Varp transitions in script:**
- → `crest_spoken_johnathon` (9)

### `crest_goldsmithing_gauntlets_chosen` (value 8)

### `crest_spoken_johnathon` (value 9)

**Journal:** I found Johnathon looking very ill at the Jolly Boar Inn

**Interact:**
- opnpc1 → `johnathon_fitzharmon` (Johnathon) → @johnathon_fitzharmon_spider

### `crest_chaos_gauntlets_chosen` (value 9)

### `crest_cured_johnathon` (value 10)

**Journal:** Johnathon lost his piece of the family crest to a demon named Chronozon under the Air Obelisk in the Wilderness Chronozon is very powerful. I need to hit him with each of the four spells of death before he can be defeated

**Interact:**
- opnpc1 → `johnathon_fitzharmon` (Johnathon) → @johnathon_fitzharmon_postcure

### `crest_complete` (value 11)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `caleb_fitzharmon` (Caleb) → @caleb_fitzharmon_gauntlets
- opnpc1 → `avan` (Man) → @avan_gauntlets
- opnpc1 → `johnathon_fitzharmon` (Johnathon) → @johnathon_fitzharmon_gauntlets

**Dialog options (click by text):**
- `Are you Caleb Fitzharmon?`
- `I am still working on it.`
- `Nothing, I will be on my way.`
- `Ok, I will get those.`
- `That sounds good to me.`
- `That sounds good, improve them for me.`
- `Uh... what happened to the rest of it?`
- `Why are you hanging around in a scorpion pit?`
- `Yes, please do that for me.`

**Items required:**
- Crest part (`avan_crest`)
- Crest part (`caleb_crest`)

**Items consumed:**
- Bass (`bass`)
- last_useitem (`last_useitem`)
- 'perfect' necklace (`perfect_ruby_necklace`)
- 'perfect' ring (`perfect_ruby_ring`)
- Salmon (`salmon`)
- Shrimps (`shrimp`)
- Steel gauntlets (`steel_gauntlets`)
- Swordfish (`swordfish`)
- Tuna (`tuna`)

**Varp transitions in script:**
- → `crest_caleb_piece` (3)
- → `crest_caleb_where` (4)
- → `crest_spoken_caleb` (2)
- → `crest_spoken_avan` (6)
- → `crest_avan_piece` (8)
- → `crest_spoken_johnathon` (9)
- → `crest_cured_johnathon` (10)

## Source scripts

- `scripts/quests/quest_crest/scripts/crest_caleb.rs2`
- `scripts/quests/quest_crest/scripts/crest_man.rs2`
- `scripts/quests/quest_crest/scripts/crest_dimintheis.rs2`
- `scripts/quests/quest_crest/scripts/crest_chronozon.rs2`
- `scripts/quests/quest_crest/scripts/crest_boot.rs2`
- `scripts/quests/quest_crest/scripts/quest_crest.rs2`
- `scripts/quests/quest_crest/scripts/crest_johnathon.rs2`
- `scripts/quests/quest_legends/scripts/legends_guard.rs2`
- `scripts/areas/area_alkharid/scripts/gem_trader.rs2`
- `scripts/areas/area_alkharid/scripts/zeke.rs2`
- `scripts/areas/area_alkharid/scripts/kebab_seller.rs2`
- `scripts/areas/area_alkharid/scripts/silk_trader.rs2`
- `scripts/general/scripts/quests.rs2`
