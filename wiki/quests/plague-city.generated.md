# Plague City (generated)

> Auto-generated from server RS2 source. Slug: `elena`, varp: `%elenaquest`, complete: `elena_complete` (= 29).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `elena` |
| Progress varp | `%elenaquest` |
| Complete constant | `elena_complete` (29) |

## NPCs

### Alrena (`alrena`)
- Primary spawn: (2573, 3333, level 0)

### Bravek (`bravek`)
- Primary spawn: (2536, 3314, level 0)

### Clerk (`clerk`)
- Primary spawn: (2528, 3317, level 0)

### Man (`dskin_w_ardoungecitizen1`)
- Primary spawn: (2465, 3307, level 0)
- Other spawns: (2482, 3293, level 0); (2509, 3325, level 0); (2520, 3279, level 0)…

### Woman (`dskin_w_ardoungecitizen2`)
- Primary spawn: (2453, 3307, level 0)
- Other spawns: (2480, 3300, level 0); (2511, 3322, level 0); (2519, 3267, level 0)…

### Edmond (`edmond`)
- Primary spawn: (2568, 3334, level 0)
- Other spawns: (2535, 9719, level 0)

### Elena (`elenap`)
- Primary spawn: (2541, 9672, level 0)

### Jethick (`jethick`)
- Primary spawn: (2540, 3305, level 0)

### Mourner (`mourner2`)
- Primary spawn: (2543, 3329, level 0)
- Other spawns: (2524, 3292, level 0); (2536, 3294, level 0); (2538, 3321, level 0)

### Mourner (`mournertwa`)
- Primary spawn: (2582, 3329, level 0)

## Items

- `ardougnescroll` — A magic scroll
- `bucket_empty` — Bucket
- `doctor_gown` — Doctors' gown
- `dwellberries` — Dwellberries
- `elena_picture` — Picture
- `elenakey` — A small key
- `gasmask` — Gas mask
- `hangover_cure` — Hangover cure
- `karamja_rum` — Karamjan rum
- `mournerkeytw` — Key
- `plaguesample` — Plague sample
- `rope` — Rope
- `scruffy_note` — A scruffy note
- `thanainabarrel` — Ana in a barrel
- `turnip_book` — Book
- `warrant` — Warrant

## State machine

### `quest_elena_not_started` (value 0)

**Journal:** I can start this quest by speaking to Edmond who is in East Ardougne There aren't any requirements for this Quest.

**Interact:**
- opnpc1 → `mournertwa` (Mourner)
- opnpc1 → `alrena` (Alrena)
- opnpc1 → `edmond` (Edmond)

**Dialog options (click by text):**
- `Can I help find her?`
- `Do you have any more of those scrolls?`
- `Tell me more about the plague.`
- `What are the symptoms?`
- `What's happened to her?`
- `Who are you?`

**Items required:**
- A magic scroll (`ardougnescroll`)
- Dwellberries (`dwellberries`)

**Items consumed:**
- Dwellberries (`dwellberries`)

**Varp transitions in script:**
- → `quest_elena_gasmask` (2)
- → `elena_complete` (29)

### `quest_elena_started` (value 1)

**Journal:** I need to get some Dwellberries for Alrena so she can make me a Gasmask I'm told I'll find some in McGrubor's wood

**Interact:**
- opnpc1 → `mournertwa` (Mourner)
- opnpc1 → `alrena` (Alrena)
- opnpc1 → `edmond` (Edmond)

**Dialog options (click by text):**
- `Can I help find her?`
- `Do you have any more of those scrolls?`
- `Tell me more about the plague.`
- `What are the symptoms?`
- `What's happened to her?`
- `Who are you?`

**Items required:**
- A magic scroll (`ardougnescroll`)
- Dwellberries (`dwellberries`)

**Items consumed:**
- Dwellberries (`dwellberries`)

**Varp transitions in script:**
- → `quest_elena_gasmask` (2)
- → `elena_complete` (29)

### `quest_elena_gasmask` (value 2)

**Journal:** I need to talk to Edmond about getting into West Ardougne

**Interact:**
- opnpc1 → `mournertwa` (Mourner)

**Dialog options (click by text):**
- `What are the symptoms?`
- `Who are you?`

### `quest_elena_mud_patch4` (value 7)

**Journal:** Now I need to dig a tunnel into West Ardougne

### `quest_elena_opened_tunnel` (value 8)

**Journal:** I need to find a way out of the sewers and into West Ardougne

**Interact:**
- opnpc1 → `mournertwa` (Mourner)

**Dialog options (click by text):**
- `What are the symptoms?`
- `Who are you?`

### `quest_elena_tied_rope` (value 9)

**Journal:** I've tied a rope to the sewer grill but I need help to pull it off.

**Interact:**
- opnpc1 → `mournertwa` (Mourner)

**Dialog options (click by text):**
- `What are the symptoms?`
- `Who are you?`

### `quest_elena_opened_pipe` (value 10)

**Journal:** Edmond told me to look out for an old family friend named Jethick.

### `quest_elena_spoken_martha_ted` (value 22)

**Journal:** The Rehnisons' daughter Milli may have seen Elena.

### `quest_elena_spoke_to_milli` (value 23)

**Journal:** I need to get access to the Plague House. Milli said it was to the south of the city.

**Interact:**
- oploc1 → `rehnisondoorshut` (rehnisondoorshut)

**Dialog options (click by text):**
- `But I think a kidnap victim is in here.`
- `Good point.`

**Items required:**
- Book (`turnip_book`)
- Warrant (`warrant`)

**Items consumed:**
- Book (`turnip_book`)

### `quest_elena_spoke_to_bravek` (value 26)

**Journal:** I need to bring Bravek the Hangover Cure when I work it out.

**Interact:**
- opnpc1 → `bravek` (Bravek) → @bravek_give_hangover_cure

**Items required:**
- Hangover cure (`hangover_cure`)

**Items consumed:**
- Hangover cure (`hangover_cure`)

### `quest_elena_spoke_cured_bravek` (value 27)

**Journal:** I've given Bravek the Hangover Cure and he has given me a warrant to enter the plague House. I need to get into the Plague House and find Elena.

**Interact:**
- opnpc1 → `bravek` (Bravek) → @bravek_thanks_again_for_the_hangover_cure
- oploc1 → `plaguekeybarrel` (plaguekeybarrel)

**Dialog options (click by text):**
- `Have you caught the plague?`

**Items required:**
- A small key (`elenakey`)
- Warrant (`warrant`)

### `quest_elena_freed_elena` (value 28)

**Journal:** I should go and talk to Edmond again.

### `elena_complete` (value 29)

**Journal:** Quest complete.

## Source scripts

- `scripts/quests/quest_elena/scripts/mourner.rs2`
- `scripts/quests/quest_elena/scripts/bravek.rs2`
- `scripts/quests/quest_elena/scripts/plaguehouse.rs2`
- `scripts/quests/quest_elena/scripts/elena_teleport_scroll.rs2`
- `scripts/quests/quest_elena/scripts/doors.rs2`
- `scripts/quests/quest_elena/scripts/alrena.rs2`
- `scripts/quests/quest_elena/scripts/sewerpipe.rs2`
- `scripts/quests/quest_elena/scripts/edmond.rs2`
- `scripts/quests/quest_elena/scripts/elena.rs2`
- `scripts/quests/quest_elena/scripts/jethick.rs2`
- `scripts/quests/quest_elena/scripts/quest_elena.rs2`
- `scripts/quests/quest_elena/scripts/mud_patch.rs2`
- `scripts/quests/quest_elena/scripts/rehnisons.rs2`
- `scripts/quests/quest_elena/scripts/cupboard.rs2`
- `scripts/areas/area_ardougne_east/scripts/doors.rs2`
- `scripts/areas/area_ardougne_west/scripts/mourner.rs2`
- `scripts/areas/area_ardougne_west/scripts/man.rs2`
- `scripts/areas/area_ardougne_west/scripts/doors.rs2`
- `scripts/areas/area_ardougne_west/scripts/clerk.rs2`
- `scripts/areas/area_ardougne_west/scripts/woman.rs2`
- `scripts/general/scripts/quests.rs2`
- `scripts/skill_magic/scripts/spells/teleport.rs2`
