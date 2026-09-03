# Tree Gnome Village (generated)

> Auto-generated from server RS2 source. Slug: `tree`, varp: `%treequest`, complete: `tree_complete` (= 9).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `tree` |
| Progress varp | `%treequest` |
| Complete constant | `tree_complete` (9) |

## NPCs

### Local Gnome (`chantergnome`)
- Primary spawn: (2541, 3168, level 0)
- Other spawns: (2541, 3171, level 0); (2542, 3167, level 0); (2542, 3172, level 0)

### Commander Montai (`commander_montai`)
- Primary spawn: (2523, 3211, level 0)

### Elkoy (`elkoy`)
- Primary spawn: (2504, 3191, level 0)

### Khazard warlord (`khazard_warlord`)
- Primary spawn: (2457, 3302, level 0)

### King Bolren (`king_bolren`)
- Primary spawn: (2542, 3169, level 0)

### Kalron (`lostgnome`)
- Primary spawn: (2521, 3177, level 0)

### Remsai (`remsai`)
- Primary spawn: (2524, 3169, level 0)

### Gnome (`tracker1`)
- Primary spawn: (2502, 3261, level 0)

### Bolkoy (`treevillage_shopkeeper1`)
- Primary spawn: (2527, 3161, level 1)

## Items

- `gnome_amulet` — Gnome amulet
- `logs` — Logs
- `orb_of_protection` — Orb of protection
- `orbs_of_protection` — Orb of protection
- `plaguesample` — Plague sample
- `trail_clue_medium_anagram011` — Clue scroll

## State machine

### `tree_not_started` (value 0)

**Journal:** I can start this quest by speaking to Bolren at the center of the Tree Gnome maze, West of Port Khazard I need to be able to defeat a level 112 Warlord

**Interact:**
- opnpc1 → `king_bolren` (King Bolren)
- opnpc1 → `remsai` (Remsai)
- opnpc1 → `elkoy` (Elkoy) → @elkoy_intro
- opnpc1 → `commander_montai` (Commander Montai)
- opnpc1 → `lostgnome` (Kalron)

**Dialog options (click by text):**
- `I will find the warlord and bring back the orbs.`
- `I would be glad to help.`
- `I'll leave you to it then.`
- `No, I've had enough of your battle.`
- `Ok, I'll gather some wood.`

**Items required:**
- Orb of protection (`orb_of_protection`)
- Orb of protection (`orbs_of_protection`)
- Clue scroll (`trail_clue_medium_anagram011`)

**Items consumed:**
- Logs (`logs`)
- Orb of protection (`orb_of_protection`)
- Orb of protection (`orbs_of_protection`)

**Varp transitions in script:**
- → `tree_started` (1)
- → `tree_returned_first_orb` (7)
- → `tree_spoken_montai` (2)
- → `tree_given_logs_montai` (3)
- → `tree_finding_trackers` (4)

### `tree_started` (value 1)

**Journal:** Commander Montai, North of the maze, can help me get it

**Interact:**
- opnpc1 → `commander_montai` (Commander Montai)

**Dialog options (click by text):**
- `No, I've had enough of your battle.`
- `Ok, I'll gather some wood.`

**Items consumed:**
- Logs (`logs`)

**Varp transitions in script:**
- → `tree_spoken_montai` (2)
- → `tree_given_logs_montai` (3)
- → `tree_finding_trackers` (4)

### `tree_spoken_montai` (value 2)

**Journal:** I need to bring Montai logs to fortify their defences

**Interact:**
- opnpc1 → `tracker1` (Gnome)

### `tree_given_logs_montai` (value 3)

**Journal:** I should speak to Montai again and see what to do next

### `tree_finding_trackers` (value 4)

**Journal:** I need to head into the Battlefield and find the three Gnome trackers who have the firing coordinates and then fire the ballista!

**Interact:**
- oploc2 → `catabow` (catabow)
- opnpc1 → `tracker1` (Gnome)

**Items required:**
- Orb of protection (`orb_of_protection`)

**Varp transitions in script:**
- → `tree_ballista_fired` (5)
- → `tree_retrieved_orb` (6)
- → `tree_complete` (9)

### `tree_ballista_fired` (value 5)

**Journal:** With the Khazard stronghold exposed I should get inside and retrieve the gnomes' orb of protection.

**Interact:**
- opnpc1 → `tracker1` (Gnome)

### `tree_retrieved_orb` (value 6)

**Journal:** I should return the orb to King Bolren immediately

**Interact:**
- opnpc1 → `khazard_warlord` (Khazard warlord)
- opnpc1 → `tracker1` (Gnome)
- opnpc1 → `remsai` (Remsai)
- opnpc1 → `chantergnome` (Local Gnome)
- opnpc1 → `elkoy` (Elkoy) → @elkoy_retrieved_orb_outside
- opnpc1 → `treevillage_shopkeeper1` (Bolkoy)

**Dialog options (click by text):**
- `What have you got?`
- `Yes please.`

**Items required:**
- Orb of protection (`orb_of_protection`)
- Orb of protection (`orbs_of_protection`)

**Varp transitions in script:**
- → `tree_returned_first_orb` (7)
- → `tree_defeated_warlord` (8)
- → `tree_complete` (9)

### `tree_returned_first_orb` (value 7)

**Journal:** I should retrieve the two remaining orbs from the warlord

**Interact:**
- opnpc1 → `khazard_warlord` (Khazard warlord)
- opnpc1 → `chantergnome` (Local Gnome)
- opnpc1 → `elkoy` (Elkoy) → @elkoy_stolen_orbs_outside
- opnpc1 → `lostgnome` (Kalron)

**Dialog options (click by text):**
- `Yes please.`

**Items required:**
- Orb of protection (`orbs_of_protection`)

**Varp transitions in script:**
- → `tree_returned_first_orb` (7)
- → `tree_defeated_warlord` (8)
- → `tree_complete` (9)

### `tree_defeated_warlord` (value 8)

**Journal:** I should return them now to King Bolren where they belong

**Interact:**
- opnpc1 → `chantergnome` (Local Gnome)
- opnpc1 → `elkoy` (Elkoy) → @elkoy_hero_outside
- opnpc1 → `lostgnome` (Kalron)

### `tree_complete` (value 9)

**Journal:** I can now use the gnome's spirit tree to teleport around the world to places that are linked to the spirit tree! @red@QUEST COMPLETE!

**Interact:**
- opnpc1 → `chantergnome` (Local Gnome)
- opnpc1 → `elkoy` (Elkoy) → @elkoy_postquest_outside
- opnpc1 → `lostgnome` (Kalron)

## Source scripts

- `scripts/quests/quest_tree/scripts/quest_tree.rs2`
- `scripts/quests/quest_tree/scripts/khazard_warlord.rs2`
- `scripts/quests/quest_tree/scripts/tracker_gnome.rs2`
- `scripts/areas/area_gnome/scripts/spirit_tree.rs2`
- `scripts/areas/area_gnome/scripts/king_bolren.rs2`
- `scripts/areas/area_gnome/scripts/remsai.rs2`
- `scripts/areas/area_gnome/scripts/local_gnome.rs2`
- `scripts/areas/area_gnome/scripts/elkoy.rs2`
- `scripts/areas/area_gnome/scripts/commander_montai.rs2`
- `scripts/areas/area_gnome/scripts/bolkoy.rs2`
- `scripts/areas/area_gnome/scripts/kalron.rs2`
- `scripts/general/scripts/quests.rs2`
