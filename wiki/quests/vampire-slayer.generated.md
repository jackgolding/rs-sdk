# Vampire Slayer (generated)

> Auto-generated from server RS2 source. Slug: `vampire`, varp: `%vampire`, complete: `vampire_complete` (= 3).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `vampire` |
| Progress varp | `%vampire` |
| Complete constant | `vampire_complete` (3) |

## NPCs

### Dr Harlow (`harlow`)
- Primary spawn: (3277, 3492, level 0)

### Morgan (`morgan`)
- Primary spawn: (3098, 3268, level 0)

### Roavar (`werewolfinnkeeper`)
- Primary spawn: (3493, 3471, level 0)

## Items

- `beer` — Beer
- `coins` — Coins
- `garlic` — Garlic
- `hammer` — Hammer
- `ice_arrow` — Ice arrows
- `mappart2` — Map part
- `moonlight_mead` — Moonlight mead
- `silverlight` — Silverlight
- `stake` — Stake
- `trail_clue_medium_anagram017` — Clue scroll

## State machine

### `quest_vampire_not_started` (value 0)

**Journal:** I can start this quest by speaking to Morgan who is in Draynor Village. Requirements: Must be able to kill a level 34 Vampire.

**Interact:**
- opnpc1 → `morgan` (Morgan) → @morgan_before_vampire_slayer

**Dialog options (click by text):**
- `No, vampires are scary!`

### `quest_vampire_started` (value 1)

**Journal:** I spoke to Morgan in Draynor Village. He told me that the locals are being attacked by a terrifying Vampire! I need to speak to Dr Harlow who can normally be found in the Jolly Boar Inn North East of Varrock.

**Interact:**
- opnpc1 → `harlow` (Dr Harlow) → @harlow_during_vampire_slayer

**Dialog options (click by text):**
- `No, you've had enough.`

### `quest_vampire_spoke_to_harlow` (value 2)

**Journal:** I spoke to Morgan in Draynor Village. He told me that the locals are being attacked by a terrifying Vampire! I have spoken to Dr Harlow. He seemed terribly drunk, and he kept asking me to buy him drinks. I should see what advice Dr Harlow can give me about killing Vampires.

**Interact:**
- opnpc1 → `harlow` (Dr Harlow) → @harlow_during_vampire_slayer_buy_beer

**Dialog options (click by text):**
- `No, you've had enough.`

**Items required:**
- Stake (`stake`)

**Items consumed:**
- Beer (`beer`)

### `vampire_complete` (value 3)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `morgan` (Morgan) → @morgan_after_vampire_slayer

**Dialog options (click by text):**
- `No, vampires are scary!`

## Source scripts

- `scripts/quests/quest_vampire/scripts/quest_vampire.rs2`
- `scripts/quests/quest_vampire/scripts/count_draynor.rs2`
- `scripts/areas/area_draynor/scripts/morgan.rs2`
- `scripts/areas/area_varrock/scripts/harlow.rs2`
- `scripts/areas/area_canifis/scripts/werewolfinnkeeper.rs2`
- `scripts/general/scripts/quests.rs2`
- `scripts/skill_combat/scripts/npc/npc_combat.rs2`
