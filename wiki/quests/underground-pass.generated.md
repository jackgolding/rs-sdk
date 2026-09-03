# Underground Pass (generated)

> Auto-generated from server RS2 source. Slug: `upass`, varp: `%upass`, complete: `upass_complete` (= 10).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `upass` |
| Progress varp | `%upass` |
| Complete constant | `upass_complete` (10) |

## NPCs

### _legends_guard (`_legends_guard`)
- Spawn: not in map data (instanced / moved / members)

### Koftik (`caveguide1`)
- Primary spawn: (2436, 3315, level 0)

### Iban disciple (`ibanmonk`)
- Primary spawn: (2021, 4710, level 1)
- Other spawns: (2022, 4712, level 1); (2025, 4710, level 1); (2025, 4713, level 1)…

### King Lathas (`king_lathas`)
- Primary spawn: (2578, 3293, level 1)

### Nilhoof (`upassdwarf1`)
- Primary spawn: (2315, 9806, level 0)

### Klank (`upassdwarf2`)
- Primary spawn: (2323, 9804, level 0)

### Dark mage (`upassmage`)
- Primary spawn: (2457, 3309, level 0)

## Items

- `2dose1attack` — Attack potion(2)
- `2doseprayerrestore` — Prayer potion(2)
- `3dose2attack` — Super attack(3)
- `3dosestatrestore` — Restore potion(3)
- `bread` — Bread
- `brokenibanstaff` — Broken iban staff
- `bucket_empty` — Bucket
- `cave_unicorn_horn` — Unicorn horn
- `caveorb1` — Orb of light
- `caveorb2` — Orb of light
- `caveorb3` — Orb of light
- `caveorb4` — Orb of light
- `caverailing` — Piece of railing
- `cavewitchcat` — Witches cat
- `coins` — Coins
- `damp_cloth` — Damp cloth
- `deathrune` — Death rune
- `doomion_amulet` — Amulet of doomion
- `firerune` — Fire rune
- `holthion_amulet` — Amulet of holthion
- `ibandoll` — Doll of iban
- `ibans_ashes` — Iban's ashes
- `ibansdove` — Iban's dove
- `ibansshadow` — Iban's shadow
- `ibanstaff` — Staff of iban
- `klanks_gauntlets` — Klank's gauntlets
- `meat_pie` — Meat pie
- `meat_pizza` — Meat pizza
- `old_journal` — History of iban
- `othainian_amulet` — Amulet of othanian
- `paladinbadge1` — Paladin's badge
- `paladinbadge2` — Paladin's badge
- `paladinbadge3` — Paladin's badge
- `regicide_iorwerth_message` — Iorwerths message
- `regicide_quest_kings_summons` — King's message
- `rope` — Rope
- `salmon` — Salmon
- `stew` — Stew
- `tinderbox` — Tinderbox
- `upassdwarfbrew` — Dwarf brew
- `zamrobebottom` — Robe of zamorak
- `zamrobetop` — Robe of zamorak

## State machine

### `upass_not_started` (value 0)

**Interact:**
- opnpc1 → `king_lathas` (King Lathas)

**Dialog options (click by text):**
- `I don't understand...`

**Items required:**
- Iorwerths message (`regicide_iorwerth_message`)

**Items consumed:**
- Iorwerths message (`regicide_iorwerth_message`)

### `upass_spoken_koftik` (value 1)

### `upass_blood_on_doll` (value 1)

### `upass_passed_bridge` (value 2)

### `upass_dove_on_doll` (value 2)

### `upass_entered_second_area` (value 3)

### `upass_ashes_on_doll` (value 3)

### `upass_killed_unicorn` (value 4)

### `upass_shadow_on_doll` (value 4)

### `upass_entered_main_area` (value 5)

**Interact:**
- opnpc1 → `upassdwarf1` (Nilhoof)

**Items required:**
- Doll of iban (`ibandoll`)
- History of iban (`old_journal`)

**Varp transitions in script:**
- → `upass_spoken_nilhoof` (6)

### `upass_orb1_bit` (value 5)

### `upass_spoken_nilhoof` (value 6)

**Interact:**
- opnpc1 → `upassdwarf1` (Nilhoof)

**Items required:**
- Doll of iban (`ibandoll`)
- History of iban (`old_journal`)

**Varp transitions in script:**
- → `upass_spoken_nilhoof` (6)

### `upass_orb2_bit` (value 6)

### `upass_found_doll` (value 7)

**Interact:**
- opnpc1 → `upassdwarf1` (Nilhoof)

**Items required:**
- Doll of iban (`ibandoll`)
- History of iban (`old_journal`)

**Varp transitions in script:**
- → `upass_spoken_nilhoof` (6)

### `upass_orb3_bit` (value 7)

### `upass_confronted_iban` (value 8)

### `upass_orb4_bit` (value 8)

### `upass_defeated_iban` (value 9)

**Interact:**
- opnpc1 → `caveguide1` (Koftik)
- opnpc1 → `king_lathas` (King Lathas)

**Dialog options (click by text):**
- `I don't understand...`
- `I'll take my chances.`
- `No, not yet.`
- `Not to worry, probably just litter.`

**Items required:**
- Damp cloth (`damp_cloth`)
- Iorwerths message (`regicide_iorwerth_message`)

**Items consumed:**
- Iorwerths message (`regicide_iorwerth_message`)

**Varp transitions in script:**
- → `upass_not_started` (0)
- → `upass_spoken_koftik` (1)

### `upass_dropped_cat` (value 9)

### `upass_read_journal_of_randas` (value 10)

### `upass_complete` (value 10)

**Journal:** King Lathas will send word when I can start this quest.

**Interact:**
- opnpc1 → `caveguide1` (Koftik)
- opnpc1 → `king_lathas` (King Lathas)

**Dialog options (click by text):**
- `I don't understand...`
- `I'll take my chances.`
- `No, not yet.`
- `Not to worry, probably just litter.`

**Items required:**
- Damp cloth (`damp_cloth`)
- Iorwerths message (`regicide_iorwerth_message`)

**Items consumed:**
- Iorwerths message (`regicide_iorwerth_message`)

**Varp transitions in script:**
- → `upass_not_started` (0)
- → `upass_spoken_koftik` (1)

## Source scripts

- `scripts/quests/quest_upass/scripts/upass_obstacles.rs2`
- `scripts/quests/quest_upass/scripts/sir_carl.rs2`
- `scripts/quests/quest_upass/scripts/iban_disciple.rs2`
- `scripts/quests/quest_upass/scripts/holthion.rs2`
- `scripts/quests/quest_upass/scripts/doomion.rs2`
- `scripts/quests/quest_upass/scripts/nilhoof.rs2`
- `scripts/quests/quest_upass/scripts/othainian.rs2`
- `scripts/quests/quest_upass/scripts/koftik.rs2`
- `scripts/quests/quest_upass/scripts/kardia.rs2`
- `scripts/quests/quest_upass/scripts/quest_upass.rs2`
- `scripts/quests/quest_upass/scripts/sir_jerro.rs2`
- `scripts/quests/quest_upass/scripts/sir_harry.rs2`
- `scripts/quests/quest_upass/scripts/upass_bridge.rs2`
- `scripts/quests/quest_upass/scripts/kalrag.rs2`
- `scripts/quests/quest_upass/scripts/klank.rs2`
- `scripts/quests/quest_legends/scripts/legends_guard.rs2`
- `scripts/quests/quest_regicide/scripts/regicide_kings_messenger.rs2`
- `scripts/areas/area_ardougne_east/scripts/king_lathas.rs2`
- `scripts/areas/area_ardougne_west/scripts/darkmage.rs2`
- `scripts/general/scripts/quests.rs2`
