# Prince Ali Rescue (generated)

> Auto-generated from server RS2 source. Slug: `prince`, varp: `%princequest`, complete: `prince_complete` (= 110).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `prince` |
| Progress varp | `%princequest` |
| Complete constant | `prince_complete` (110) |

## NPCs

### Aggie (`aggie`)
- Primary spawn: (3086, 3259, level 0)

### Hassan (`hassan`)
- Primary spawn: (3302, 3163, level 0)

### Joe (`joe`)
- Primary spawn: (3123, 3245, level 0)

### Lady Keli (`lady_keli`)
- Primary spawn: (3128, 3244, level 0)

### Leela (`leela`)
- Primary spawn: (3113, 3263, level 0)

### Ned (`ned`)
- Primary spawn: (3100, 3258, level 0)

### Osman (`osman`)
- Primary spawn: (3286, 3180, level 0)

### Prince Ali (`prince_ali_prison`)
- Primary spawn: (3123, 3242, level 0)

## Items

- `ashes` — Ashes
- `ball_of_wool` — Ball of wool
- `beer` — Beer
- `blondwig` — Wig
- `bluedye` — Blue dye
- `bronze_bar` — Bronze bar
- `bucket_water` — Bucket of water
- `coins` — Coins
- `dragonmap` — Crandor map
- `jug_water` — Jug of water
- `keyprint` — Key print
- `onion` — Onion
- `pink_skirt` — Pink skirt
- `plainwig` — Wig
- `pot_flour` — Pot of flour
- `princeskey` — Bronze key
- `redberries` — Redberries
- `reddye` — Red dye
- `rope` — Rope
- `skinpaste` — Paste
- `softclay` — Soft clay
- `woadleaf` — Woad leaf
- `yellowdye` — Yellow dye

## State machine

### `prince_not_started` (value 0)

**Journal:** I can start this quest by speaking to Hassan in Al-Kharid Palace.

**Interact:**
- opnpc1 → `hassan` (Hassan)
- opnpc1 → `osman` (Osman) → @osman_prequest

**Dialog options (click by text):**
- `Can I help you? You must need some help here in the desert.`
- `You don't seem very tough. Who are you?`

**Varp transitions in script:**
- → `prince_started` (10)

### `prince_keymade` (value 1)

### `prince_keyclaimed` (value 2)

### `prince_started` (value 10)

**Journal:** I started this quest by speaking to Hassan in Al-Kharid Palace. He told me I should speak to Osman the spy master. I should go and speak to Osman for details on the quest.

**Interact:**
- opnpc1 → `osman` (Osman) → @osman_instructions

**Dialog options (click by text):**
- `What is the first thing I must do?`

### `prince_spoken_osman` (value 20)

**Journal:** Prince Ali has been kidnapped but luckily the spy Leela has found he is being held near draynor village. I will need to disguise the Prince and tie up his captor to free him from their clutches. To do this I should: Talk to Leela near Draynor Village for advice I have a duplicate of the key with me

### `prince_prep_finished` (value 30)

**Journal:** Prince Ali has been kidnapped but luckily the spy Leela has found he is being held near draynor village. I will need to disguise the Prince and tie up his captor to free him from their clutches. Before I can free Prince Ali, I need to deal with the Guard. Leela suggested I speak with the Guard to try and determine any weaknesses he might have.

**Interact:**
- opnpc1 → `joe` (Joe) → @joe_distract

**Dialog options (click by text):**
- `I have some beer here, fancy one?`

### `prince_guard_drunk` (value 40)

**Journal:** Prince Ali has been kidnapped but luckily the spy Leela has found he is being held near draynor village. I will need to disguise the Prince and tie up his captor to free him from their clutches. I also had to prevent the Guard from seeing what I was up to, by getting him drunk. The last thing I need to do is deal with Lady Keli. Leela suggested I use some Rope to tie her up.

### `prince_tied_keli` (value 50)

**Journal:** Prince Ali has been kidnapped but luckily the spy Leela has found he is being held near draynor village. I will need to disguise the Prince and tie up his captor to free him from their clutches. I also had to prevent the Guard from seeing what I was up to, by getting him drunk. With the guard disposed of, I used my rope to tie up Lady Keli in a cupboard, so I could disguise the Prince. I can now free Prince Ali. I'll need to make sure I give him his disguise when I do.

### `prince_saved` (value 100)

**Journal:** Prince Ali has been kidnapped but luckily the spy Leela has found he is being held near draynor village. I will need to disguise the Prince and tie up his captor to free him from their clutches. I also had to prevent the Guard from seeing what I was up to, by getting him drunk. With the guard disposed of, I used my rope to tie up Lady Keli in a cupboard, so I could disguise the Prince. I then used a wig, a skirt and some skin paste to make the prince look like Lady Keli so he could escape to his freedom with Leela after unlocking his cell door. I should return to Hassan to claim my reward.

**Interact:**
- opnpc1 → `osman` (Osman)

**Dialog options (click by text):**
- `Explain the first thing again.`
- `Thank you. I will try to find the other items.`
- `What is the first thing I must do?`
- `You don't seem very tough. Who are you?`

**Items required:**
- Bronze key (`princeskey`)

**Items consumed:**
- Bronze bar (`bronze_bar`)
- Coins (`coins`)
- Key print (`keyprint`)

**Varp transitions in script:**
- → `prince_spoken_osman` (20)

### `prince_complete` (value 110)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `osman` (Osman)

**Dialog options (click by text):**
- `Explain the first thing again.`
- `Thank you. I will try to find the other items.`
- `What is the first thing I must do?`
- `You don't seem very tough. Who are you?`

**Items required:**
- Bronze key (`princeskey`)

**Items consumed:**
- Bronze bar (`bronze_bar`)
- Coins (`coins`)
- Key print (`keyprint`)

**Varp transitions in script:**
- → `prince_spoken_osman` (20)

## Source scripts

- `scripts/quests/quest_prince/scripts/quest_prince.rs2`
- `scripts/areas/area_draynor/scripts/ned.rs2`
- `scripts/areas/area_draynor/scripts/prince_ali.rs2`
- `scripts/areas/area_draynor/scripts/lady_keli.rs2`
- `scripts/areas/area_draynor/scripts/joe_guard.rs2`
- `scripts/areas/area_draynor/scripts/leela.rs2`
- `scripts/areas/area_draynor/scripts/aggie.rs2`
- `scripts/areas/area_alkharid/scripts/hassan.rs2`
- `scripts/areas/area_alkharid/scripts/border_gate.rs2`
- `scripts/areas/area_alkharid/scripts/osman.rs2`
- `scripts/general/scripts/quests.rs2`
