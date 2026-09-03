# Shield of Arrav (generated)

> Auto-generated from server RS2 source. Slug: `blackarmgang`, varp: `%blackarmgang`, complete: `blackarmgang_complete` (= 4).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `blackarmgang` |
| Progress varp | `%blackarmgang` |
| Complete constant | `blackarmgang_complete` (4) |

## NPCs

### Curator (`curator`)
- Primary spawn: (3255, 3445, level 0)

### Garv (`garv`)
- Primary spawn: (2776, 3186, level 0)

### Katrine (`katrine`)
- Primary spawn: (3186, 3385, level 0)

### King Roald (`king_roald`)
- Primary spawn: (3222, 3476, level 0)

### Straven (`straven`)
- Primary spawn: (3246, 9780, level 0)

### Tramp (`tramppg`)
- Primary spawn: (3208, 3391, level 0)

## Items

- `arravcertificate` — Certificate
- `arravshield1` — Broken shield
- `arravshield2` — Broken shield
- `black_full_helm` — Black full helm
- `black_platebody` — Black platebody
- `black_platelegs` — Black platelegs
- `chocolate_cake` — Chocolate cake
- `coins` — Coins
- `digplainletter` — Unstamped letter
- `fruit_blast` — Fruit blast
- `id_papers` — Id papers
- `intelligence_report` — Scroll
- `level1certificate` — Level 1 certificate
- `level2certificate` — Level 2 certificate
- `level3certificate` — Level 3 certificate
- `master_thief_armband` — Thieves' armband
- `petecandlestick` — Pete's candlestick
- `phoenix_crossbow` — Phoenix crossbow
- `phoenixkey2` — Key
- `recommendedletter` — Stamped letter
- `the_shield_of_arrav` — Book

## State machine

### `blackarmgang_not_started` (value 0)

### `blackarmgang_started` (value 1)

**Journal:** I also spoke to the Tramp in Varrock. According to him there is a criminal organisation known as the 'Black Arm Gang' down an alley near to him. I should speak to their leader, Katrine, about joining.

### `blackarmgang_spoken_katrine` (value 2)

**Journal:** I also spoke to the Tramp in Varrock. According to him there is a criminal organisation known as the 'Black Arm Gang' down an alley near to him. I should speak to their leader, Katrine, about joining.

**Interact:**
- opnpc1 → `katrine` (Katrine) → @katrine_got_yet

**Items consumed:**
- Phoenix crossbow (`phoenix_crossbow`)

**Varp transitions in script:**
- → `blackarmgang_joined` (3)

### `blackarmgang_joined` (value 3)

**Journal:** To start this quest, I spoke to the Tramp in Varrock. He gave me the location of the Black Arm Gang HQ. He directed me to speak to Katrine in the Gang Headquarters. I spoke to Katrine in the Black Arm Gang Headquarters. She offered to let me join the gang in return for stealing two Phoenix Crossbows from the Phoenix Gang. With the help of a Fellow Adventurer, I was able to obtain two Phoenix Crossbows. I gave them to Katrine and she allowed me to join the Black Arm Gang. I searched the Black Arm Gang Headquarters and found what seemed to be half of the Shield of Arrav. A Fellow Adventurer also found a Shield Half and gave it to me. I took them both to the Curator in Varrock Museum who confirmed they were genuine. The Curator gave me two Certificates. I should now give one to a Fellow Adventurer and take my Certificate to King Roald in Varrock Palace to collect my reward.

### `blackarmgang_complete` (value 4)

**Journal:** To start this quest, I spoke to the Tramp in Varrock. He gave me the location of the Black Arm Gang HQ. He directed me to speak to Katrine in the Gang Headquarters. I spoke to Katrine in the Black Arm Gang Headquarters. She offered to let me join the gang in return for stealing two Phoenix Crossbows from the Phoenix Gang. With the help of a Fellow Adventurer, I was able to obtain two Phoenix Crossbows. I gave them to Katrine and she allowed me to join the Black Arm Gang. I searched the Black Arm Gang Headquarters and found half of the Shield of Arrav. A Fellow Adventurer found the other Shield Half and we took both Shield Halves to the Curator at the Varrock Museum who confirmed they were genuine. The Curator gave me and a Fellow Adventurer a Certificate each. I took my Certificate to King Roald in Varrock Palace and he rewarded me for helping to return the Shield of Arrav.

## Source scripts

- `scripts/quests/quest_hero/scripts/npcs/garv.rs2`
- `scripts/quests/quest_hero/scripts/quest_hero.rs2`
- `scripts/quests/quest_hero/scripts/locs/brimhaven_blackarm_hq.rs2`
- `scripts/quests/quest_hero/scripts/locs/brimhaven_scarface_mansion.rs2`
- `scripts/quests/quest_blackarmgang/scripts/quest_blackarmgang.rs2`
- `scripts/areas/area_varrock/scripts/straven.rs2`
- `scripts/areas/area_varrock/scripts/curator.rs2`
- `scripts/areas/area_varrock/scripts/katrine.rs2`
- `scripts/areas/area_varrock/scripts/king_roald.rs2`
- `scripts/areas/area_varrock/scripts/tramp.rs2`
- `scripts/general/scripts/quests.rs2`
