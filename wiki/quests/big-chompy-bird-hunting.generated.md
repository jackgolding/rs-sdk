# Big Chompy Bird Hunting (generated)

> Auto-generated from server RS2 source. Slug: `chompybird`, varp: `%chompybird`, complete: `chompybird_complete` (= 65).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `chompybird` |
| Progress varp | `%chompybird` |
| Complete constant | `chompybird_complete` (65) |

## NPCs

### Bugs (`bugs`)
- Primary spawn: (2640, 9391, level 0)

### Fycie (`fycie`)
- Primary spawn: (2650, 9393, level 0)

### Rantz (`rantz`)
- Primary spawn: (2630, 2981, level 0)

## Items

- `achey_tree_logs` — Achey tree logs
- `bloated_toad` — Bloated toad
- `cabbage` — Cabbage
- `cbhat1` — Chompy bird hat
- `cbhat10` — Chompy bird hat
- `cbhat11` — Chompy bird hat
- `cbhat12` — Chompy bird hat
- `cbhat13` — Chompy bird hat
- `cbhat14` — Chompy bird hat
- `cbhat15` — Chompy bird hat
- `cbhat16` — Chompy bird hat
- `cbhat17` — Chompy bird hat
- `cbhat18` — Chompy bird hat
- `cbhat2` — Chompy bird hat
- `cbhat3` — Chompy bird hat
- `cbhat4` — Chompy bird hat
- `cbhat5` — Chompy bird hat
- `cbhat6` — Chompy bird hat
- `cbhat7` — Chompy bird hat
- `cbhat8` — Chompy bird hat
- `cbhat9` — Chompy bird hat
- `chisel` — Chisel
- `coins` — Coins
- `cooked_chompy` — Cooked chompy
- `cooked_s_chompy` — Seasoned chompy
- `doogleleaves` — Doogle leaves
- `empty_ogre_bellows` — Ogre bellows
- `equa_leaves` — Equa leaves
- `feather` — Feather
- `filled_ogre_bellow3` — Ogre bellows (3)
- `knife` — Knife
- `ogre_arrow` — Ogre arrow
- `ogre_arrow_shaft` — Ogre arrow shaft
- `ogre_bow` — Ogre bow
- `ogre_headless_arrow` — Flighted ogre arrow
- `onion` — Onion
- `potato` — Potato
- `raw_chompy` — Raw chompy
- `ruined_chompy` — Ruined chompy
- `tomato` — Tomato
- `trail_clue_medium_anagram020` — Clue scroll
- `wolf_bones` — Wolf bones
- `wolfbone_arrowheads` — Wolfbone arrowtips

## State machine

### `chompybird_not_started` (value 0)

**Journal:** I can start this quest by speaking to the ogre Rantz who lives East of the Ogre City, North of the Swamp Pool. To complete this quest I need: Level 5 Fletching

**Interact:**
- opnpc1 → `fycie` (Fycie)
- opnpc1 → `bugs` (Bugs)
- opnpc1 → `rantz` (Rantz)

**Dialog options (click by text):**
- `How do I make the 'stabbers' again?`
- `How do I make the 'stabbers'?`
- `How do we make the chompys come?`
- `How many chompies do I have to stick?`
- `I'm actually quite strong... please let me try.`
- `Oh, keep trying then... you might hit one through pure luck.`
- `Ok, I'll give you 10 bright pretties.`
- `Ok, I'll give you 50 bright pretties.`
- `What are 'stabbers'?`
- `What are the hats like?`
- `What's a 'chompy'?`
- `Yes, I'll buy the bow.`

**Items required:**
- Bloated toad (`bloated_toad`)
- Chisel (`chisel`)
- Knife (`knife`)
- Ogre arrow (`ogre_arrow`)
- Ogre bow (`ogre_bow`)
- Raw chompy (`raw_chompy`)
- Clue scroll (`trail_clue_medium_anagram020`)

**Items consumed:**
- Coins (`coins`)
- Cooked chompy (`cooked_chompy`)
- Seasoned chompy (`cooked_s_chompy`)
- Ogre arrow (`ogre_arrow`)

**Varp transitions in script:**
- → `chompybird_started` (5)
- → `chompybird_shown_toad` (25)
- → `chompybird_rantz_gave_player_bow` (45)
- → `chompybird_told_to_cook_chompy` (55)
- → `chompybird_player_killed_chompy` (50)
- → `chompybird_chompy_cooked` (60)
- → `chompybird_not_started` (0)
- → `chompybird_given_arrows` (10)
- → `chompybird_kids_play_with_toad` (15)
- → `chompybird_rantz_tried_to_shoot_chompy` (40)

### `chompybird_varbit_made_arrows` (value 0)

### `chompybird_varbit_rantz_flavour` (value 1)

### `chompybird_varbit_bugs_flavour_start` (value 2)

### `chompybird_varbit_bugs_flavour_end` (value 3)

### `chompybird_varbit_fycie_flavour_start` (value 4)

### `chompybird_started` (value 5)

**Journal:** I agreed to get Rants some 'stabbers'

**Interact:**
- opnpc1 → `fycie` (Fycie)
- opnpc1 → `bugs` (Bugs)

**Dialog options (click by text):**
- `Ok, I'll give you 10 bright pretties.`
- `Ok, I'll give you 50 bright pretties.`

**Items required:**
- Chisel (`chisel`)
- Knife (`knife`)
- Clue scroll (`trail_clue_medium_anagram020`)

**Items consumed:**
- Coins (`coins`)

### `chompybird_varbit_fycie_flavour_end` (value 5)

### `chompybird_varbit_bought_feathers` (value 6)

### `chompybird_varbit_bought_scratchers` (value 7)

### `chompybird_given_arrows` (value 10)

**Journal:** Rantz says I need to get some 'fatsy toadies' to make the chompy come.

### `chompybird_kids_play_with_toad` (value 15)

### `chompybird_removed_rock_from_chest` (value 20)

### `chompybird_shown_toad` (value 25)

**Journal:** I should drop a toad in the spot Rantz showed to me

### `chompybird_dropped_toad` (value 30)

### `chompybird_chompy_bird_spawned` (value 35)

### `chompybird_rantz_tried_to_shoot_chompy` (value 40)

### `chompybird_rantz_gave_player_bow` (value 45)

### `chompybird_player_killed_chompy` (value 50)

**Journal:** Rantz stands no chance of shooting a chompy bird - he'll starve to death if I don't help him. I should take this raw chompy to Rantz.

### `chompybird_told_to_cook_chompy` (value 55)

**Journal:** That cheeky ogre Rantz has asked me to cook the chompy for him and his kids, and they want it seasoning as well!

### `chompybird_chompy_cooked` (value 60)

**Journal:** I've cooked the chompy for that cheeky ogre and his kids, I'd better take it to them before they starve!

### `chompybird_complete` (value 65)

**Journal:** Once I had Rantz's bow, it was easy to hunt chompy birds using the nearby swamp toads. I cooked and seasoned a Chompy Bird for Rantz and his family. In return for this I got some experience in : Fletching, cooking and ranged. Plus I kept an ogre bow. @red@QUEST COMPLETE!

## Source scripts

- `scripts/quests/quest_chompybird/scripts/raw_chompy.rs2`
- `scripts/quests/quest_chompybird/scripts/fycie.rs2`
- `scripts/quests/quest_chompybird/scripts/ogre_chest.rs2`
- `scripts/quests/quest_chompybird/scripts/quest_chompybird.rs2`
- `scripts/quests/quest_chompybird/scripts/bloated_toad.rs2`
- `scripts/quests/quest_chompybird/scripts/bugs.rs2`
- `scripts/quests/quest_chompybird/scripts/chompy_bird.rs2`
- `scripts/quests/quest_chompybird/scripts/ogre_bow.rs2`
- `scripts/quests/quest_chompybird/scripts/rantz.rs2`
- `scripts/general/scripts/quests.rs2`
- `scripts/skill_fletching/scripts/ogre_arrows.rs2`
