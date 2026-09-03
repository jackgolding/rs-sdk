# Biohazard (generated)

> Auto-generated from server RS2 source. Slug: `biohazard`, varp: `%biohazard`, complete: `biohazard_complete` (= 16).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `biohazard` |
| Progress varp | `%biohazard` |
| Complete constant | `biohazard_complete` (16) |

## NPCs

### DeVinci (`Artist1`)
- Primary spawn: (2933, 3219, level 0)

### Guard (`bioguard1`)
- Primary spawn: (3263, 3407, level 0)

### Nurse Sarah (`bionurse`)
- Primary spawn: (2516, 3274, level 0)

### Chemist (`chemist`)
- Primary spawn: (2934, 3210, level 0)

### Hops (`drunk1`)
- Primary spawn: (2931, 3219, level 0)

### Elena (`elena2`)
- Primary spawn: (2592, 3336, level 0)

### Chancy (`gambler1`)
- Primary spawn: (2935, 3219, level 0)

### Guidor (`guidor`)
- Primary spawn: (3285, 3381, level 0)

### Guidor's wife (`guidors_wife`)
- Primary spawn: (3281, 3383, level 0)

### Jerico (`jerico`)
- Primary spawn: (2612, 3324, level 0)

### Kilron (`kilron`)
- Primary spawn: (2556, 3266, level 0)

### King Lathas (`king_lathas`)
- Primary spawn: (2578, 3293, level 1)

### Shop keeper (`lathas_shopkeeper`)
- Primary spawn: (2514, 3385, level 0)

### Mourner (`mourner2`)
- Primary spawn: (2543, 3329, level 0)
- Other spawns: (2524, 3292, level 0); (2536, 3294, level 0); (2538, 3321, level 0)

### Omart (`omart`)
- Primary spawn: (2559, 3266, level 0)

## Items

- `birdfeed` — Bird feed
- `bucket_empty` — Bucket
- `cave_unicorn_horn` — Unicorn horn
- `caveorb1` — Orb of light
- `caveorb2` — Orb of light
- `caveorb3` — Orb of light
- `caveorb4` — Orb of light
- `caverailing` — Piece of railing
- `deathrune` — Death rune
- `distillator` — Distillator
- `doctor_gown` — Doctors' gown
- `doomion_amulet` — Amulet of doomion
- `ethenea` — Ethanea
- `firerune` — Fire rune
- `holthion_amulet` — Amulet of holthion
- `ibandoll` — Doll of iban
- `ibans_ashes` — Iban's ashes
- `ibansdove` — Iban's dove
- `ibansshadow` — Iban's shadow
- `ibanstaff` — Staff of iban
- `klanks_gauntlets` — Klank's gauntlets
- `liquid_honey` — Liquid honey
- `meat_pie` — Meat pie
- `mournerkeytw` — Key
- `othainian_amulet` — Amulet of othanian
- `paladinbadge1` — Paladin's badge
- `paladinbadge2` — Paladin's badge
- `paladinbadge3` — Paladin's badge
- `pigeoncage` — Pigeon cage
- `pigeons` — Pigeon cage
- `plaguesample` — Plague sample
- `priest_gown` — Priest gown
- `priest_robe` — Priest gown
- `regicide_alchemy` — Big book of bangs
- `regicide_iorwerth_message` — Iorwerths message
- `rottenapples` — Rotten apples
- `salmon` — Salmon
- `sulphuric_broline` — Sulphuric broline
- `touch_paper` — Touch paper
- `upassdwarfbrew` — Dwarf brew
- `zamrobebottom` — Robe of zamorak
- `zamrobetop` — Robe of zamorak

## State machine

### `biohazard_not_started` (value 0)

**Journal:** I can start this quest by speaking to Elena who is in East Ardougne

### `biohazard_started` (value 1)

**Journal:** I need to talk to Jerico about getting over the wall and into West Ardougne

### `biohazard_spoken_jerico` (value 2)

**Journal:** Omart will be able to get me over the wall He's waiting at the South end of the wall

**Interact:**
- opnpc1 → `jerico` (Jerico)

**Dialog options (click by text):**
- `Maybe you could shout and scream, and call them away?`

**Varp transitions in script:**
- → `biohazard_spoken_jerico` (2)

### `biohazard_used_birdfeed` (value 3)

**Journal:** I've chucked some birdfeed onto the Watch Tower

### `biohazard_released_pigeons` (value 4)

**Journal:** The Watch Tower is now surrounded by flapping pigeons! Maybe I can sneak over the wall while the mourners are distracted

**Interact:**
- opnpc1 → `jerico` (Jerico)
- opnpc1 → `omart` (Omart)

**Dialog options (click by text):**
- `Maybe you could shout and scream, and call them away?`
- `Ok, lets do it.`

**Varp transitions in script:**
- → `biohazard_spoken_jerico` (2)

### `biohazard_climbed_ladder` (value 5)

**Interact:**
- opnpc1 → `jerico` (Jerico)

**Dialog options (click by text):**
- `Maybe you could shout and scream, and call them away?`

**Varp transitions in script:**
- → `biohazard_spoken_jerico` (2)

### `biohazard_poisoned_stew` (value 6)

**Journal:** I have rather unkindly poisoned the mourners' stew by putting rotten apples into it! At least the mourners aren't very nice people, so I don't feel bad about this

### `biohazard_found_distillator` (value 7)

**Journal:** I managed to find Elena's distillator Now I can return the distillator to Elena

### `biohazard_given_distillator` (value 10)

**Journal:** Elena's asked me to take the following items to Guidor who lives in Varrock Plague Sample from Elena Elena gave me the Plague Sample

### `biohazard_spoken_chemist` (value 12)

**Journal:** The Varrock guards are out looking for someone carrying suspicious materials. I must smuggle the items to Guidor secretly

**Interact:**
- opnpc1 → `guidor` (Guidor)
- opnpc1 → `guidors_wife` (Guidor's wife)

**Dialog options (click by text):**
- `I've come to ask your assistance in stopping a plague.`
- `No! Well, yes...`
- `That's why Elena wanted you to do it.`

**Items required:**
- Ethanea (`ethenea`)
- Liquid honey (`liquid_honey`)
- Plague sample (`plaguesample`)
- Priest gown (`priest_gown`)
- Priest gown (`priest_robe`)
- Sulphuric broline (`sulphuric_broline`)
- Touch paper (`touch_paper`)

**Items consumed:**
- Ethanea (`ethenea`)
- Liquid honey (`liquid_honey`)
- Plague sample (`plaguesample`)
- Sulphuric broline (`sulphuric_broline`)
- Touch paper (`touch_paper`)

**Varp transitions in script:**
- → `biohazard_found_secret` (14)

### `biohazard_found_secret` (value 14)

**Journal:** Guidor's findings were very interesting Apparently there is no Plague! I should see what Elena thinks of this

**Interact:**
- opnpc1 → `guidors_wife` (Guidor's wife)
- opnpc1 → `elena2` (Elena)

**Dialog options (click by text):**
- `I just find it hard to say goodbye sometimes.`
- `I'll try to retrieve it for you.`

**Items required:**
- Distillator (`distillator`)
- Ethanea (`ethenea`)
- Liquid honey (`liquid_honey`)
- Plague sample (`plaguesample`)
- Priest gown (`priest_gown`)
- Priest gown (`priest_robe`)
- Sulphuric broline (`sulphuric_broline`)

**Items consumed:**
- Distillator (`distillator`)

**Varp transitions in script:**
- → `biohazard_reported_elena` (15)
- → `biohazard_given_distillator` (10)
- → `biohazard_started` (1)

### `biohazard_reported_elena` (value 15)

**Journal:** I've told Elena Guidor's findings, she was horrified! I need to confront the King of East Ardougne

**Interact:**
- opnpc1 → `elena2` (Elena)

**Dialog options (click by text):**
- `I just find it hard to say goodbye sometimes.`
- `I'll try to retrieve it for you.`

**Items required:**
- Distillator (`distillator`)
- Ethanea (`ethenea`)
- Liquid honey (`liquid_honey`)
- Plague sample (`plaguesample`)
- Sulphuric broline (`sulphuric_broline`)

**Items consumed:**
- Distillator (`distillator`)

**Varp transitions in script:**
- → `biohazard_reported_elena` (15)
- → `biohazard_given_distillator` (10)
- → `biohazard_started` (1)

### `biohazard_complete` (value 16)

**Journal:** I've spoken to King Lathas, he admits the Plague was fake! I have been given permission to use the Royal Training Gounds which are located North West of Ardougne @red@QUEST COMPLETE!

**Interact:**
- opnpc1 → `elena2` (Elena)

**Dialog options (click by text):**
- `I just find it hard to say goodbye sometimes.`
- `I'll try to retrieve it for you.`

**Items required:**
- Distillator (`distillator`)
- Ethanea (`ethenea`)
- Liquid honey (`liquid_honey`)
- Plague sample (`plaguesample`)
- Sulphuric broline (`sulphuric_broline`)

**Items consumed:**
- Distillator (`distillator`)

**Varp transitions in script:**
- → `biohazard_reported_elena` (15)
- → `biohazard_given_distillator` (10)
- → `biohazard_started` (1)

## Source scripts

- `scripts/quests/quest_elena/scripts/mud_patch.rs2`
- `scripts/quests/quest_upass/scripts/quest_upass.rs2`
- `scripts/quests/quest_biohazard/scripts/guidor.rs2`
- `scripts/quests/quest_biohazard/scripts/chemist.rs2`
- `scripts/quests/quest_biohazard/scripts/hops.rs2`
- `scripts/quests/quest_biohazard/scripts/jerico.rs2`
- `scripts/quests/quest_biohazard/scripts/quest_biohazard.rs2`
- `scripts/quests/quest_biohazard/scripts/guidors_wife.rs2`
- `scripts/quests/quest_biohazard/scripts/chancy.rs2`
- `scripts/quests/quest_biohazard/scripts/devinci.rs2`
- `scripts/areas/area_combat_training/scripts/combat_training_camp.rs2`
- `scripts/areas/area_ardougne_east/scripts/king_lathas.rs2`
- `scripts/areas/area_ardougne_east/scripts/elena.rs2`
- `scripts/areas/area_ardougne_west/scripts/mourner.rs2`
- `scripts/areas/area_ardougne_west/scripts/doors.rs2`
- `scripts/areas/area_ardougne_west/scripts/kilron.rs2`
- `scripts/areas/area_ardougne_west/scripts/nurse_sarah.rs2`
- `scripts/areas/area_ardougne_west/scripts/omart.rs2`
- `scripts/areas/area_varrock/scripts/east_gate.rs2`
- `scripts/general/scripts/quests.rs2`
