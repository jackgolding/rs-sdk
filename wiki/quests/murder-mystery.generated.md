# Murder Mystery (generated)

> Auto-generated from server RS2 source. Slug: `murder`, varp: `%murderquest`, complete: `murder_complete` (= 2).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `murder` |
| Progress varp | `%murderquest` |
| Complete constant | `murder_complete` (2) |

## NPCs

### Anna (`anna_sinclair`)
- Primary spawn: (2734, 3575, level 0)

### Bob (`bob_sinclair`)
- Primary spawn: (2748, 3559, level 0)

### Carol (`carol_sinclair`)
- Primary spawn: (2734, 3581, level 1)

### David (`david_sinclair`)
- Primary spawn: (2739, 3581, level 0)

### Donovan the Family Handyman (`donovan_the_family_handyman`)
- Primary spawn: (2745, 3576, level 1)

### Elizabeth (`elizabeth_sinclair`)
- Primary spawn: (2746, 3581, level 1)

### Frank (`frank_sinclair`)
- Primary spawn: (2742, 3577, level 0)

### Gossip (`gossipy_man`)
- Primary spawn: (2735, 3560, level 0)
- Other spawns: (2742, 3555, level 0)

### Hobbes (`hobbes_the_butler`)
- Primary spawn: (2736, 3575, level 0)

### Louisa (`louisa_the_cook`)
- Primary spawn: (2734, 3581, level 0)

### Mary (`mary_the_maid`)
- Primary spawn: (2736, 3576, level 1)

### Guard (`murderguard`)
- Primary spawn: (2739, 3577, level 0)
- Other spawns: (2741, 3562, level 0)

### Pierre (`pierre_the_family_dog_handler`)
- Primary spawn: (2750, 3576, level 0)

### Poison Salesman (`poison_salesman`)
- Primary spawn: (2695, 3495, level 0)
- Other spawns: (2737, 3491, level 0)

### Stanford (`stanford_the_gardener`)
- Primary spawn: (2731, 3579, level 0)

## Items

- `coins` — Coins
- `murderbook` — Silver book
- `murderbookdust` — Silver book
- `murderbottle` — Silver bottle
- `murderbottledust` — Silver bottle
- `murdercup` — Silver cup
- `murdercupdust` — Silver cup
- `murderfingerprint` — Killers' print
- `murderfingerprint1` — Unknown print
- `murderfingerprinta` — Annas' print
- `murderfingerprintb` — Bobs' print
- `murderfingerprintc` — Carols' print
- `murderfingerprintd` — Davids' print
- `murderfingerprinte` — Elizabeths' print
- `murderfingerprintf` — Franks' print
- `murdernecklace` — Silver necklace
- `murdernecklacedust` — Silver necklace
- `murderneedle` — Silver needle
- `murderneedledust` — Silver needle
- `murderpaper` — Flypaper
- `murderpot` — Silver pot
- `murderpot2` — Pungent pot
- `murderpotdust` — Silver pot
- `murderthreadb` — Criminals' thread
- `murderthreadg` — Criminals' thread
- `murderthreadr` — Criminals' thread
- `murderweapon` — Criminals' dagger
- `murderweapondust` — Criminals' dagger
- `pot_empty` — Pot
- `pot_flour` — Pot of flour
- `trail_clue_easy_vague028` — Clue scroll
- `trail_clue_medium_anagram009` — Clue scroll
- `viking_low_alcahol_beerkeg` — Low alcohol keg

## State machine

### `murder_not_started` (value 0)

**Journal:** I can start this quest by speaking to one of the Guards at the Sinclair Mansion, North of the Seer's Village

**Interact:**
- opnpc1 → `gossipy_man` (Gossip)
- opnpc1 → `stanford_the_gardener` (Stanford)
- opnpc1 → `mary_the_maid` (Mary)
- opnpc1 → `murderguard` (Guard)
- opnpc1 → `frank_sinclair` (Frank)
- opnpc1 → `pierre_the_family_dog_handler` (Pierre)
- opnpc1 → `carol_sinclair` (Carol)
- opnpc1 → `elizabeth_sinclair` (Elizabeth)
- opnpc1 → `anna_sinclair` (Anna)
- opnpc1 → `david_sinclair` (David)
- opnpc1 → `bob_sinclair` (Bob)
- opnpc1 → `louisa_the_cook` (Louisa)
- opnpc1 → `donovan_the_family_handyman` (Donovan the Family Handyman)
- opnpc1 → `hobbes_the_butler` (Hobbes)
- opnpc1 → `poison_salesman` (Poison Salesman)

**Dialog options (click by text):**
- `I KNOW it was Anna.`
- `I have proof one of the family lied about the poison.`
- `I have proof that it wasn't any of the servants.`
- `I'm certain it was Bob.`
- `It can ONLY Be Donovan the handyman.`
- `It was SO obviously Louisa the cook.`
- `It was an intruder!`
- `It was one of the women...`
- `Patented Multi Purpose Poison?`
- `Sure, I'll help.`
- `Talk about the Murder Mystery Quest`
- `Tell me about Anna.`
- `Tell me about Bob.`
- `Tell me about Lord Sinclair.`
- `What can you tell me about the Sinclairs?`
- `What should I be doing to help again?`
- `Who do you think is responsible?`
- `Yes`

**Items required:**
- Pungent pot (`murderpot2`)
- Criminals' thread (`murderthreadb`)
- Criminals' thread (`murderthreadg`)
- Criminals' thread (`murderthreadr`)
- Clue scroll (`trail_clue_easy_vague028`)
- Clue scroll (`trail_clue_medium_anagram009`)

**Items consumed:**
- Coins (`coins`)

**Varp transitions in script:**
- → `murder_started` (1)

### `murder_started` (value 1)

**Journal:** Lord Sinclair, a prominent nobleman, had been horribly murdered at his mansion. The guards had been sent to investigate his murder, but have been completely stuck. One of the guards has asked me for my help in solving the murder. I should examine the crime scene very closely for evidence, and investigate everybody in the area carefully I have found some coloured thread. It might be useful.

**Interact:**
- opnpc1 → `gossipy_man` (Gossip)
- opnpc1 → `stanford_the_gardener` (Stanford)
- opnpc1 → `mary_the_maid` (Mary)
- opnpc1 → `frank_sinclair` (Frank)
- opnpc1 → `pierre_the_family_dog_handler` (Pierre)
- opnpc1 → `carol_sinclair` (Carol)
- opnpc1 → `elizabeth_sinclair` (Elizabeth)
- opnpc1 → `anna_sinclair` (Anna)
- opnpc1 → `david_sinclair` (David)
- opnpc1 → `bob_sinclair` (Bob)
- opnpc1 → `louisa_the_cook` (Louisa)
- opnpc1 → `donovan_the_family_handyman` (Donovan the Family Handyman)
- opnpc1 → `hobbes_the_butler` (Hobbes)
- opnpc1 → `poison_salesman` (Poison Salesman)

**Dialog options (click by text):**
- `Patented Multi Purpose Poison?`
- `Talk about the Murder Mystery Quest`
- `Tell me about Anna.`
- `Tell me about Bob.`
- `Tell me about Lord Sinclair.`
- `What can you tell me about the Sinclairs?`
- `Who do you think is responsible?`
- `Yes`

**Items required:**
- Pungent pot (`murderpot2`)
- Criminals' thread (`murderthreadb`)
- Criminals' thread (`murderthreadg`)
- Criminals' thread (`murderthreadr`)
- Clue scroll (`trail_clue_easy_vague028`)
- Clue scroll (`trail_clue_medium_anagram009`)

**Items consumed:**
- Coins (`coins`)

### `murder_found_thread` (value 1)

### `murder_found_fingerprints` (value 2)

### `murder_complete` (value 2)

**Journal:** One of the guards asked me for my help in solving the murder. After careful examination of the crime scene and interrogating all suspects, I worked out who was guilty. I took the evidence I had collected to the Guards and explained how it could identify the killer. Impressed with my deductions, the killer was arrested and I was given a fair reward for my help in solving the crime. @red@QUEST COMPLETE!

## Source scripts

- `scripts/quests/quest_murder/scripts/gossip.rs2`
- `scripts/quests/quest_murder/scripts/stanford.rs2`
- `scripts/quests/quest_murder/scripts/mary.rs2`
- `scripts/quests/quest_murder/scripts/murder_guard.rs2`
- `scripts/quests/quest_murder/scripts/frank.rs2`
- `scripts/quests/quest_murder/scripts/pierre.rs2`
- `scripts/quests/quest_murder/scripts/carol.rs2`
- `scripts/quests/quest_murder/scripts/elizabeth.rs2`
- `scripts/quests/quest_murder/scripts/anna.rs2`
- `scripts/quests/quest_murder/scripts/david.rs2`
- `scripts/quests/quest_murder/scripts/bob.rs2`
- `scripts/quests/quest_murder/scripts/louisa.rs2`
- `scripts/quests/quest_murder/scripts/donovan.rs2`
- `scripts/quests/quest_murder/scripts/quest_murder.rs2`
- `scripts/quests/quest_murder/scripts/hobbes.rs2`
- `scripts/areas/area_seers/scripts/poison_salesman.rs2`
- `scripts/general/scripts/quests.rs2`
