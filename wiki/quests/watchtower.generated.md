# Watch Tower (generated)

> Auto-generated from server RS2 source. Slug: `regicide`, varp: `%regicide_quest`, complete: `regicide_complete` (= 15).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `regicide` |
| Progress varp | `%regicide_quest` |
| Complete constant | `regicide_complete` (15) |

## NPCs

### Chemist (`chemist`)
- Primary spawn: (2934, 3210, level 0)

### Elena (`elena2`)
- Primary spawn: (2592, 3336, level 0)

### King Lathas (`king_lathas`)
- Primary spawn: (2578, 3293, level 1)

### Lord Iorwerth (`lord_iorwerth`)
- Primary spawn: (2205, 3252, level 0)

### General Hining (`regicide_general_hining`)
- Primary spawn: (2187, 3149, level 0)

### Elf Tracker (`regicide_old_camp_tracker`)
- Primary spawn: (2257, 3149, level 0)

### Tyras guard (`regicide_tyras_camp_guard`)
- Primary spawn: (2188, 3171, level 0)

### Tyras guard (`regicide_tyras_lazy_guard`)
- Primary spawn: (2181, 3184, level 0)

### Quartermaster (`regicidegeneralshopkeeper`)
- Primary spawn: (2194, 3140, level 0)

## Items

- `ball_of_wool` — Ball of wool
- `bucket_empty` — Bucket
- `cave_unicorn_horn` — Unicorn horn
- `caveorb1` — Orb of light
- `caveorb2` — Orb of light
- `caveorb3` — Orb of light
- `caveorb4` — Orb of light
- `caverailing` — Piece of railing
- `coins` — Coins
- `cooked_rabbit` — Cooked rabbit
- `deathrune` — Death rune
- `distillator` — Distillator
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
- `limestone` — Limestone
- `liquid_honey` — Liquid honey
- `meat_pie` — Meat pie
- `othainian_amulet` — Amulet of othanian
- `paladinbadge1` — Paladin's badge
- `paladinbadge2` — Paladin's badge
- `paladinbadge3` — Paladin's badge
- `plaguesample` — Plague sample
- `pot_empty` — Pot
- `regicide_alchemy` — Big book of bangs
- `regicide_barrel_empty` — Barrel
- `regicide_barrel_lid` — Barrel bomb
- `regicide_barrel_lid_fused` — Barrel bomb
- `regicide_barrel_naphtha` — Barrel of naphtha
- `regicide_barrel_naphtha_quicklime_mix` — Naphtha mix
- `regicide_barrel_naphtha_sulphar_mix` — Naphtha mix
- `regicide_barrel_tar` — Barrel of coal-tar
- `regicide_cloth` — Cloth
- `regicide_crystal_pendant` — Crystal pendant
- `regicide_iorwerth_message` — Iorwerths message
- `regicide_quest_kings_summons` — King's message
- `regicide_quicklime` — Quicklime
- `regicide_quicklime_dust` — Pot of quicklime
- `regicide_sulphar` — Sulphur
- `regicide_sulphar_dust` — Ground sulphur
- `salmon` — Salmon
- `sulphuric_broline` — Sulphuric broline
- `touch_paper` — Touch paper
- `trail_clue_hard_riddle018` — Clue scroll
- `trail_clue_hard_riddle018_puzzlebox` — Puzzle box
- `upassdwarfbrew` — Dwarf brew
- `zamrobebottom` — Robe of zamorak
- `zamrobetop` — Robe of zamorak

## State machine

### `regicide_not_started` (value 0)

**Journal:** King Lathas will send word when I can start this quest.

### `regicide_koftik_food` (value 0)

### `regicide_received_message` (value 1)

**Journal:** A courier has given me a message. I have been sent for by King Lathas. I must go to his castle in Ardougne.

### `regicide_down_well` (value 1)

### `regicide_spoken_lathas` (value 2)

**Journal:** King Lathas has asked me to re-enter the underground pass. Now that the Well of Voyage is repaired I'm to go to the realm beyond. Once there I must assassinate his brother. I'm told that a group of elves there will assist me.

### `regicide_seen_guard` (value 2)

### `regicide_spoken_scouts` (value 3)

**Journal:** I have met a elvish scout party, who said I should go see Lord Iorwerth. He can be found at his camp in the north west of the woodland.

### `regicide_given_rabbit` (value 3)

### `regicide_spoken_iorwerth` (value 4)

**Journal:** Lord Iorwerth has offered the help of one of his trackers, who I'm to meet with at a camp Tyras recently abandoned. The abandoned camp is to the south east. Lord Iorwerth asked that I tell him of my findings.

### `regicide_spoken_tracker` (value 5)

**Journal:** Lord Iorwerth has given me his pendant as proof that I am not the intruder that the tracker believes me to be.

### `regicide_chemist_chat` (value 5)

### `regicide_shown_pendant` (value 6)

**Journal:** After proving that I was not a bandit the tracker has offered his help. He has told me to search the west side of the camp for any trace of Tyras's men.

**Interact:**
- opnpc1 → `regicide_old_camp_tracker` (Elf Tracker)

**Items required:**
- Crystal pendant (`regicide_crystal_pendant`)

**Varp transitions in script:**
- → `regicide_spoken_tracker2` (8)
- → `regicide_shown_pendant` (6)
- → `regicide_spoken_tracker` (5)

### `regicide_found_footprints` (value 7)

**Journal:** I have found some tracks leading off into the undergrowth but I am unable to follow them.

**Interact:**
- opnpc1 → `regicide_old_camp_tracker` (Elf Tracker)

**Items required:**
- Crystal pendant (`regicide_crystal_pendant`)

**Varp transitions in script:**
- → `regicide_spoken_tracker2` (8)
- → `regicide_shown_pendant` (6)
- → `regicide_spoken_tracker` (5)

### `regicide_spoken_tracker2` (value 8)

**Journal:** I asked the tracker about the tracks, he told me of signs to look for and how to pass the dense woodland.

### `regicide_defeated_guard` (value 9)

**Journal:** Pushing my way through the undergrowth I encountered a soldier, one of King Tyras's men I guess.

### `regicide_entered_camp` (value 10)

**Journal:** I have found the camp of King Tyras hidden in the woods The king is in his tent and is well guarded. I should go and tell Lord Iorwerth what I've found out.

**Interact:**
- opnpc1 → `regicide_old_camp_tracker` (Elf Tracker)

**Items required:**
- Crystal pendant (`regicide_crystal_pendant`)

**Varp transitions in script:**
- → `regicide_spoken_tracker2` (8)
- → `regicide_shown_pendant` (6)
- → `regicide_spoken_tracker` (5)

### `regicide_spoken_iorwerth2` (value 11)

**Journal:** Lord Iorwerth has given me a book. It may be of help. The book talks of things that go bang. The bomb was quite hard to make but I have it now. Now I just need a way to give Tyras my gift.

**Interact:**
- opnpc1 → `regicide_old_camp_tracker` (Elf Tracker)

**Items required:**
- Crystal pendant (`regicide_crystal_pendant`)

**Varp transitions in script:**
- → `regicide_spoken_tracker2` (8)
- → `regicide_shown_pendant` (6)
- → `regicide_spoken_tracker` (5)

### `regicide_killed_tyras` (value 12)

**Journal:** The catapult provided a great way to deliver my gift to King Tyras and no one is any the wiser it was me. I should tell Lord Iorwerth then return to King Lathas.

**Interact:**
- opnpc1 → `regicide_old_camp_tracker` (Elf Tracker)

**Items required:**
- Crystal pendant (`regicide_crystal_pendant`)

**Varp transitions in script:**
- → `regicide_spoken_tracker2` (8)
- → `regicide_shown_pendant` (6)
- → `regicide_spoken_tracker` (5)

### `regicide_reported_iorwerth` (value 13)

**Journal:** Lord Iorwerth has given me a message to carry to King Lathas. He also mentioned a pass over the mountains.

### `regicide_spoken_arianwyn` (value 14)

**Journal:** When returning home I met an elf who showed me the truth of who's side I really was on. I'm sure I'll be seeing him again.

### `regicide_complete` (value 15)

**Journal:** I have told King Lathas about Tyras's death. He thanked me and gave me lots of gold. I have been told my services will continue to be of use and word will be sent at the time. @red@QUEST COMPLETE!

**Interact:**
- opnpc1 → `lord_iorwerth` (Lord Iorwerth)
- opnpc1 → `king_lathas` (King Lathas)

**Dialog options (click by text):**
- `I don't understand...`

**Items required:**
- Iorwerths message (`regicide_iorwerth_message`)
- Clue scroll (`trail_clue_hard_riddle018`)
- Puzzle box (`trail_clue_hard_riddle018_puzzlebox`)

**Items consumed:**
- Iorwerths message (`regicide_iorwerth_message`)
- Puzzle box (`trail_clue_hard_riddle018_puzzlebox`)

**Varp transitions in script:**
- → `regicide_reported_iorwerth` (13)
- → `regicide_spoken_iorwerth2` (11)
- → `regicide_spoken_iorwerth` (4)
- → `regicide_spoken_lathas` (2)

## Source scripts

- `scripts/quests/quest_upass/scripts/quest_upass.rs2`
- `scripts/quests/quest_biohazard/scripts/chemist.rs2`
- `scripts/quests/quest_regicide/scripts/regicide_tyras_lazy_guard.rs2`
- `scripts/quests/quest_regicide/scripts/regicide_camp_tracker.rs2`
- `scripts/quests/quest_regicide/scripts/regicidegeneralshopkeeper.rs2`
- `scripts/quests/quest_regicide/scripts/tyras_guard.rs2`
- `scripts/quests/quest_regicide/scripts/regicide_general_hining.rs2`
- `scripts/quests/quest_regicide/scripts/regicide_kings_messenger.rs2`
- `scripts/quests/quest_regicide/scripts/regicide_arandar_gate_guard.rs2`
- `scripts/quests/quest_regicide/scripts/idris.rs2`
- `scripts/quests/quest_regicide/scripts/quest_regicide.rs2`
- `scripts/quests/quest_regicide/scripts/lord_iorwerth.rs2`
- `scripts/levelrequire/scripts/levelrequire.rs2`
- `scripts/areas/area_ardougne_east/scripts/king_lathas.rs2`
- `scripts/areas/area_ardougne_east/scripts/elena.rs2`
- `scripts/general/scripts/quests.rs2`
