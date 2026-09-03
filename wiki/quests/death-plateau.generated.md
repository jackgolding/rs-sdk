# Death Plateau (generated)

> Auto-generated from server RS2 source. Slug: `death`, varp: `%death_equiproom`, complete: `death_complete` (= 80).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `death` |
| Progress varp | `%death_equiproom` |
| Complete constant | `death_complete` (80) |

## NPCs

### _citizen_burthorpe (`_citizen_burthorpe`)
- Spawn: not in map data (instanced / moved / members)

### Harold (`death_guard_equiproom`)
- Primary spawn: (2905, 3539, level 1)

### Eohric (`death_headservant`)
- Primary spawn: (2902, 3565, level 1)

### Denulth (`death_ig_commander`)
- Primary spawn: (2896, 3528, level 0)

### Saba (`death_saba`)
- Primary spawn: (2270, 4759, level 0)

### Tenzing (`death_sherpa`)
- Primary spawn: (2820, 3556, level 0)

### Dunstan (`death_smithy`)
- Primary spawn: (2919, 3574, level 0)

### Sanfew (`sanfew`)
- Primary spawn: (2897, 3426, level 1)

## Items

- `asgarnian_ale` — Asgarnian ale
- `blurberry_special` — Blurberry special
- `bread` — Bread
- `coins` — Coins
- `death_climbingboots` — Climbing boots
- `death_combination` — Combination
- `death_entrancecert` — Certificate
- `death_iou` — Iou
- `death_secretwaymap` — Secret way map
- `death_spikedboots` — Spiked boots
- `eadgar_dirty_druid_robe` — Dirty robe
- `eadgar_goutweed_herb` — Goutweed
- `enchanted_bear_meat` — Enchanted bear
- `enchanted_beef` — Enchanted beef
- `enchanted_chicken` — Enchanted chicken
- `enchanted_rat_meat` — Enchanted rat
- `iron_bar` — Iron bar
- `law_talisman` — Law talisman
- `premade_blurberry_special` — Blurberry special
- `steel_claws` — Steel claws
- `trail_clue_medium_anagram015` — Clue scroll
- `trout` — Trout

## State machine

### `death_not_started` (value 0)

**Journal:** I can start this quest by speaking to Denulth who is in his tent at the Imperial Guard camp in Burthorpe

**Interact:**
- opnpc1 → `death_smithy` (Dunstan) → @multi2
- opnpc1 → `death_ig_commander` (Denulth)

**Dialog options (click by text):**
- `Can I have another law talisman?`
- `Can you put some spikes on my Climbing boots?`
- `Can you remind me of the quest I am on?`
- `Do you have any quests for me?`
- `How goes your fight with the trolls?`
- `I'll get Godric back!`
- `I'm looking for the guard that was on last night.`
- `I'm sorry to hear that.`
- `Is it OK if I use your anvil?`
- `No but perhaps I could try and find one?`
- `Yes, but I still want them.`

**Items required:**
- Climbing boots (`death_climbingboots`)
- Combination (`death_combination`)
- Certificate (`death_entrancecert`)
- Secret way map (`death_secretwaymap`)
- Iron bar (`iron_bar`)

**Items consumed:**
- Climbing boots (`death_climbingboots`)
- Combination (`death_combination`)
- Certificate (`death_entrancecert`)
- Secret way map (`death_secretwaymap`)
- Iron bar (`iron_bar`)

**Varp transitions in script:**
- → `death_complete` (80)
- → `death_unlocked_door` (70)
- → `death_started` (10)

### `death_haroldroll_lower` (value 0)

### `death_map_lower` (value 0)

### `death_spoken_saba` (value 1)

### `death_spoken_tenzing` (value 2)

### `death_spoken_smithy` (value 3)

### `death_haroldroll_upper` (value 3)

### `death_map_upper` (value 3)

### `death_got_entrancecert` (value 4)

### `death_playerroll_lower` (value 4)

### `death_bet_lower` (value 4)

### `death_given_cert` (value 5)

### `death_given_supplies` (value 6)

### `death_got_map` (value 7)

### `death_playerroll_upper` (value 7)

### `death_scouted_area` (value 8)

### `death_goldclaimed` (value 8)

### `death_started` (value 10)

### `death_bet_upper` (value 13)

### `death_spoken_headservant` (value 20)

**Journal:** Eohric said that the equipment room guard is staying at the local inn, the Toad and Chicken

### `death_spoken_harold` (value 30)

**Journal:** The equipment room guard is staying at the local inn, the Toad and Chicken. The guard wouldn't talk to me!

### `death_spoken_headservant2` (value 40)

**Journal:** Eohric says to buy the guard a drink

### `death_given_ale` (value 50)

### `death_given_iou` (value 55)

### `death_found_combo` (value 60)

### `death_unlocked_door` (value 70)

### `death_complete` (value 80)

**Journal:** I offered to help Denulth by finding another way up Death Plateau. I also needed to find the combination to the equipment room and unlock the door. The equipment room guard is staying at the local inn, the Toad and Chicken. The guard wouldn't talk to me! I bought the guard a drink and he seemed more helpful. I gambled with the guard until he ran out of money. He wrote me an IOU. It turned out the IOU was written on the back of the combination! I put the stone balls in the right places on the stone mechanism and unlocked the door. I found the sherpa's house. I gave Tenzing the ten loaves of bread, ten cooked trout and the Spiked boots. Tenzing has given me a map of the secret way. I checked the secret way and it is safe for the Imperial Guard to use. I have given Dunstan the certificate to prove that his son has been signed up for the Imperial Guard. Dunstan made me the Spiked boots. I gave Denulth the secret way map and the combination. Denulth gave me some Steel claws and trained me in attack. I'm now an honorary member of the Imperial Guard! @red@QUEST COMPLETE!

**Interact:**
- opnpc1 → `death_guard_equiproom` (Harold)
- opnpc1 → `death_saba` (Saba)
- opnpc1 → `death_ig_commander` (Denulth)

**Dialog options (click by text):**
- `Can you remind me of the quest I am on?`
- `Do you have any quests for me?`
- `How goes your fight with the trolls?`
- `I'll get Godric back!`
- `I'm looking for the guard that was on last night.`
- `I'm sorry to hear that.`
- `No but perhaps I could try and find one?`
- `Where were you when you last had the combination?`
- `Would you like to gamble?`
- `You're the guard that was on duty last night?`

**Items required:**
- Asgarnian ale (`asgarnian_ale`)
- Blurberry special (`blurberry_special`)
- Combination (`death_combination`)
- Secret way map (`death_secretwaymap`)
- Blurberry special (`premade_blurberry_special`)
- Clue scroll (`trail_clue_medium_anagram015`)

**Items consumed:**
- Asgarnian ale (`asgarnian_ale`)
- Blurberry special (`blurberry_special`)
- Coins (`coins`)
- Combination (`death_combination`)
- Secret way map (`death_secretwaymap`)
- Blurberry special (`premade_blurberry_special`)

**Varp transitions in script:**
- → `death_given_iou` (55)
- → `death_spoken_harold` (30)
- → `death_given_ale` (50)
- → `death_spoken_headservant2` (40)
- → `death_unlocked_door` (70)
- → `death_started` (10)

## Source scripts

- `scripts/quests/quest_death/scripts/death_guard_equiproom.rs2`
- `scripts/quests/quest_death/scripts/death_saba.rs2`
- `scripts/quests/quest_death/scripts/quest_death.rs2`
- `scripts/quests/quest_death/scripts/death_smithy.rs2`
- `scripts/quests/quest_death/scripts/death_sherpa.rs2`
- `scripts/quests/quest_death/scripts/death_ig_commander.rs2`
- `scripts/quests/quest_death/scripts/death_headservant.rs2`
- `scripts/areas/area_burthorpe/scripts/citizen_burthorpe.rs2`
- `scripts/areas/area_taverly/scripts/sanfew.rs2`
- `scripts/general/scripts/quests.rs2`
- `scripts/skill_smithing/scripts/smithing/smithing.rs2`
