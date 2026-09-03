# Rune Mysteries (generated)

> Auto-generated from server RS2 source. Slug: `runemysteries`, varp: `%runemysteries`, complete: `runemysteries_complete` (= 6).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `runemysteries` |
| Progress varp | `%runemysteries` |
| Complete constant | `runemysteries_complete` (6) |

## NPCs

### Wizard Cromperty (`ardounge_wizard`)
- Primary spawn: (2683, 3326, level 0)

### Aubury (`aubury`)
- Primary spawn: (3253, 3402, level 0)

### Duke Horacio (`duke_of_lumbridge`)
- Primary spawn: (3212, 3220, level 1)

### Brimstail (`gnome_brimstail`)
- Primary spawn: (2390, 9810, level 0)

### Wizard Distentor (`guild_wizard`)
- Primary spawn: (2594, 3089, level 0)

### Sedridor (`head_wizard`)
- Primary spawn: (3103, 9571, level 0)

## Items

- `air_talisman` — Air talisman
- `antidragonbreathshield` — Dragonfire shield
- `macro_genilamp` — Lamp
- `research_notes` — Notes
- `research_package` — Research package
- `trail_clue_medium_anagram014` — Clue scroll

## State machine

### `runemysteries_not_started` (value 0)

**Journal:** I can start this quest by speaking to Duke Horacio of Lumbridge, upstairs in Lumbridge Castle

### `runemysteries_started` (value 1)

**Journal:** I spoke to Duke Horacio and he showed me a strange talisman that had been found by one of his subjects. I agreed to take it to the Wizards' Tower, South West of Lumbridge for further examination by the wizards. I need to find the Head Wizard and give him the Talisman

### `runemysteries_given_talisman` (value 2)

**Journal:** I spoke to Duke Horacio and he showed me a strange talisman that had been found by one of his subjects. I agreed to take it to the Wizards' Tower, South West of Lumbridge for further examination by the wizards. I gave the Talisman to the Head Wizard of the Tower and agreed to help him with his research into rune stones. I should talk to the Head Wizard again

### `runemysteries_received_package` (value 3)

**Journal:** I spoke to Duke Horacio and he showed me a strange talisman that had been found by one of his subjects. I agreed to take it to the Wizards' Tower, South West of Lumbridge for further examination by the wizards. I gave the Talisman to the Head Wizard of the Tower and agreed to help him with his research into rune stones. I should take this Research Package to Aubury in Varrock

### `runemysteries_given_package` (value 4)

**Journal:** I spoke to Duke Horacio and he showed me a strange talisman that had been found by one of his subjects. I agreed to take it to the Wizards' Tower, South West of Lumbridge for further examination by the wizards. I gave the Talisman to the Head Wizard of the Tower and agreed to help him with his research into rune stones. I took the research package to Varrock and delivered it. I should speak to Aubury again when he has finished examining the research package I have delivered him.

### `runemysteries_received_notes` (value 5)

**Journal:** I spoke to Duke Horacio and he showed me a strange talisman that had been found by one of his subjects. I agreed to take it to the Wizards' Tower, South West of Lumbridge for further examination by the wizards. I gave the Talisman to the Head Wizard of the Tower and agreed to help him with his research into rune stones. I took the research package to Varrock and delivered it. Aubury was interested in the research package and gave me his own research notes to deliver to Sedridor. I should take the notes to Sedridor and see what he says

### `runemysteries_complete` (value 6)

**Journal:** Quest complete.

## Source scripts

- `scripts/quests/quest_runemysteries/scripts/quest_runemysteries.rs2`
- `scripts/areas/area_wizard_tower/scripts/sedridor.rs2`
- `scripts/areas/area_yanille/scripts/wizard_distentor.rs2`
- `scripts/areas/area_ardougne_east/scripts/wizard_cromperty.rs2`
- `scripts/areas/area_varrock/scripts/aubury.rs2`
- `scripts/areas/area_lumbridge/scripts/duke_horacio.rs2`
- `scripts/areas/area_gnome/scripts/brimstail.rs2`
- `scripts/general/scripts/xplamp/xplamp.rs2`
- `scripts/general/scripts/quests.rs2`
- `scripts/skill_runecraft/scripts/essence_mine.rs2`
