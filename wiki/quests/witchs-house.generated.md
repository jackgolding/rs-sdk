# Witch's House (generated)

> Auto-generated from server RS2 source. Slug: `horror`, varp: `%horrorquest`, complete: `horror_complete` (= 10).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `horror` |
| Progress varp | `%horrorquest` |
| Complete constant | `horror_complete` (10) |

## NPCs

### Gunnjorn (`gunnjorn`)
- Primary spawn: (2540, 3548, level 0)

### Dagannoth (`horror_dagannoth_jr4`)
- Spawn: not in map data (instanced / moved / members)

### Larrissa (`horror_girlfriend_prequest`)
- Primary spawn: (2508, 3635, level 0)

### Jossik (`horror_lighthousekeeeper_injured`)
- Primary spawn: (2518, 4633, level 0)

## Items

- `coins` — Coins
- `guthixbook_complete` — Book of balance
- `hammer` — Hammer
- `horror_casket` — Rusty casket
- `horror_diary1` — Journal
- `horror_diary2` — Diary
- `horror_diary3` — Manual
- `horror_key` — Lighthouse key
- `molten_glass` — Molten glass
- `nails` — Nails
- `saradominbook_complete` — Holy book
- `swamp_tar` — Swamp tar
- `unfinished_guthixbook` — Damaged book
- `unfinished_saradominbook` — Damaged book
- `unfinished_zamorakbook` — Damaged book
- `woodplank` — Plank
- `zamorakbook_complete` — Unholy book

## State machine

### `horror_not_started` (value 0)

**Journal:** I can start this quest by speaking to Larrissa at the Lighthouse to the North of the Barbarian Outpost. To complete this quest I need: Level 35 agility Level 13 or higher magic will be an advantage I must also be able to defeat strong level 100 enemies

### `horror_started` (value 1)

**Journal:** Larrissa is very worried about her boyfriend Jossik. I need to repair the bridge leading to Rellekka.

**Interact:**
- opnpc1 → `horror_girlfriend_prequest` (Larrissa)

**Dialog options (click by text):**
- `But how can I help?`
- `How can I fix the bridge?`
- `Okay, I'll help!`
- `Where is your cousin?`
- `With what?`

**Items required:**
- Lighthouse key (`horror_key`)

**Varp transitions in script:**
- → `horror_entered_lighthouse` (2)
- → `horror_started` (1)

### `horror_entered_lighthouse` (value 2)

**Interact:**
- opnpc1 → `horror_girlfriend_prequest` (Larrissa)

**Dialog options (click by text):**
- `But how can I help?`
- `How can I fix the bridge?`
- `Okay, I'll help!`
- `Where is your cousin?`
- `With what?`

**Items required:**
- Lighthouse key (`horror_key`)

**Varp transitions in script:**
- → `horror_entered_lighthouse` (2)
- → `horror_started` (1)

### `horror_fixing_lighthouse` (value 3)

**Interact:**
- opnpc1 → `horror_girlfriend_prequest` (Larrissa)

**Dialog options (click by text):**
- `But how can I help?`
- `How can I fix the bridge?`
- `Okay, I'll help!`
- `Where is your cousin?`
- `With what?`

**Items required:**
- Lighthouse key (`horror_key`)

**Varp transitions in script:**
- → `horror_entered_lighthouse` (2)
- → `horror_started` (1)

### `horror_repaired_lighthouse` (value 4)

**Journal:** I must search this place and find out what has happened to Larrissa's boyfriend Jossik!

**Interact:**
- opnpc1 → `horror_girlfriend_prequest` (Larrissa)
- opnpc1 → `horror_lighthousekeeeper_injured` (Jossik)

**Dialog options (click by text):**
- `But how can I help?`
- `Buy a book of Guthix`
- `Buy a book of Saradomin`
- `Buy a book of Zamorak`
- `Can I see your wares?`
- `How can I fix the bridge?`
- `Okay, I'll help!`
- `Where is your cousin?`
- `With what?`

**Items required:**
- Rusty casket (`horror_casket`)
- Lighthouse key (`horror_key`)

**Items consumed:**
- Coins (`coins`)
- Rusty casket (`horror_casket`)

**Varp transitions in script:**
- → `horror_entered_lighthouse` (2)
- → `horror_started` (1)

### `horror_defeated_dagjr` (value 5)

**Journal:** I must defeat these sea monsters to save him!

**Interact:**
- opnpc1 → `horror_girlfriend_prequest` (Larrissa)
- opnpc1 → `horror_lighthousekeeeper_injured` (Jossik)

**Dialog options (click by text):**
- `But how can I help?`
- `Buy a book of Guthix`
- `Buy a book of Saradomin`
- `Buy a book of Zamorak`
- `Can I see your wares?`
- `How can I fix the bridge?`
- `Okay, I'll help!`
- `Where is your cousin?`
- `With what?`

**Items required:**
- Rusty casket (`horror_casket`)
- Lighthouse key (`horror_key`)

**Items consumed:**
- Coins (`coins`)
- Rusty casket (`horror_casket`)

**Varp transitions in script:**
- → `horror_entered_lighthouse` (2)
- → `horror_started` (1)

### `horror_complete` (value 10)

**Journal:** I travelled to an isolated lighthouse north of the Barbarian outpost, to find a Fremennik girl called Larrissa locked outside, and worried about her boyfriend Jossik. I recovered a spare key from Larrissa's cousin Gunnjorn and repaired the bridge to Rellekka with some planks. After I entered the lighthouse, and repaired the lighting mechanism, I discovered a strange wall that blocked the entrance to an underground cavern, where Jossik was. After I killed some strange sea monsters, I managed to get Jossik out of the cavern and back to the lighthouse. I found a strange casket on the dead body of the sea monster, which Jossik said he could tell me about. @red@QUEST COMPLETE!

**Interact:**
- opnpc1 → `horror_girlfriend_prequest` (Larrissa)

**Dialog options (click by text):**
- `But how can I help?`
- `How can I fix the bridge?`
- `Okay, I'll help!`
- `Where is your cousin?`
- `With what?`

**Items required:**
- Lighthouse key (`horror_key`)

**Varp transitions in script:**
- → `horror_entered_lighthouse` (2)
- → `horror_started` (1)

## Source scripts

- `scripts/quests/quest_horror/scripts/horror_girlfriend.rs2`
- `scripts/quests/quest_horror/scripts/quest_horror.rs2`
- `scripts/quests/quest_horror/scripts/horror_dagannoth.rs2`
- `scripts/quests/quest_horror/scripts/horror_lighthousekeeper.rs2`
- `scripts/areas/area_barbarian_outpost/scripts/gunnjorn.rs2`
- `scripts/general/scripts/quests.rs2`
