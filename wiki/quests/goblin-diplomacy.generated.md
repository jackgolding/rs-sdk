# Goblin Diplomacy (generated)

> Auto-generated from server RS2 source. Slug: `gobdip`, varp: `%goblinquest`, complete: `gobdip_complete` (= 6).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `gobdip` |
| Progress varp | `%goblinquest` |
| Complete constant | `gobdip_complete` (6) |

## NPCs

### General Bentnoze (`general_bentnoze`)
- Primary spawn: (2958, 3511, level 0)

### General Wartface (`general_wartface`)
- Primary spawn: (2957, 3511, level 0)

### Bartender (`rustyanchor_bartender`)
- Primary spawn: (3045, 3257, level 0)

## Items

- `barcrawl_card` — Barcrawl card
- `beer` — Beer
- `coins` — Coins
- `goblin_armour` — Goblin mail
- `goblin_armour_darkblue` — Blue goblin mail
- `goblin_armour_orange` — Orange goblin mail
- `gold_bar` — Gold bar
- `trail_clue_hard_riddle017` — Clue scroll
- `trail_clue_hard_riddle017_puzzlebox` — Puzzle box

## State machine

### `gobdip_not_started` (value 0)

**Journal:** I can start this quest by talking to the Bartender in Port Sarim.

### `gobdip_started` (value 1)

**Journal:** I spoke to the bartender in Port Sarim who heard a rumour that the goblins up by the mountain are arguing about the colour of their armour. I should investigate before it turns into a full blown war.

### `gobdip_will_bring_armour` (value 2)

**Journal:** I spoke to the bartender in Port Sarim who heard a rumour that the goblins up by the mountain are arguing about the colour of their armour. I spoke to Generals Wartface and Bentnoze in the Goblin Village and found that the goblins were on the brink of civil war over the colour of their armour. I offered to help the generals by finding another colour that they both like. I should bring the goblins some Orange Goblin Armour.

### `gobdip_gave_orange` (value 3)

**Journal:** I spoke to the bartender in Port Sarim who heard a rumour that the goblins up by the mountain are arguing about the colour of their armour. I spoke to Generals Wartface and Bentnoze in the Goblin Village and found that the goblins were on the brink of civil war over the colour of their armour. I offered to help the generals by finding another colour that they both like. I gave some Orange Goblin Armour to General Wartface and General Bentnoze, but they didn't like it. They asked me to bring them some Blue Goblin Armour to try out instead.

### `gobdip_gave_blue` (value 4)

**Journal:** I spoke to the bartender in Port Sarim who heard a rumour that the goblins up by the mountain are arguing about the colour of their armour. I spoke to Generals Wartface and Bentnoze in the Goblin Village and found that the goblins were on the brink of civil war over the colour of their armour. I offered to help the generals by finding another colour that they both like. I gave some Orange Goblin Armour to General Wartface and General Bentnoze, but they didn't like it. They asked me to bring them some Blue Goblin Armour to try out instead. I gave some Blue Goblin Armour to General Wartface and General Bentnoze, but they didn't like it. They asked me to bring them some of their original Brown Goblin Armour to try out instead.

### `gobdip_gave_brown` (value 5)

**Journal:** I spoke to the bartender in Port Sarim who heard a rumour that the goblins up by the mountain are arguing about the colour of their armour. I spoke to Generals Wartface and Bentnoze in the Goblin Village and found that the goblins were on the brink of civil war over the colour of their armour. I offered to help the generals by finding another colour that they both like. I gave some Orange Goblin Armour to General Wartface and General Bentnoze, but they didn't like it. They asked me to bring them some Blue Goblin Armour to try out instead. I gave some Blue Goblin Armour to General Wartface and General Bentnoze, but they didn't like it. They asked me to bring them some of their original Brown Goblin Armour to try out instead. I gave General Wartface and General Bentnoze some of their original Brown Goblin Armour. I should see if they liked the Brown Goblin Armour.

### `gobdip_complete` (value 6)

**Journal:** Quest complete.

**Interact:**
- label → `goblin_diplomacy_greet_general_bentnoze` (goblin_diplomacy_greet_general_bentnoze) → @goblin_diplomacy_completed

## Source scripts

- `scripts/quests/quest_gobdip/scripts/quest_gobdip.rs2`
- `scripts/areas/area_falador/scripts/goblin_village/general_wartface.rs2`
- `scripts/areas/area_falador/scripts/goblin_village/general_bentnoze.rs2`
- `scripts/areas/area_port_sarim/scripts/bartender.rs2`
- `scripts/general/scripts/quests.rs2`
