# Gertrude's Cat (generated)

> Auto-generated from server RS2 source. Slug: `fluffs`, varp: `%fluffs`, complete: `fluffs_complete` (= 6).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `fluffs` |
| Progress varp | `%fluffs` |
| Complete constant | `fluffs_complete` (6) |

## NPCs

### Gertrude (`gertrude`)
- Primary spawn: (3151, 3410, level 0)

## Items

- `bucket_empty` — Bucket
- `bucket_milk` — Bucket of milk
- `chocolate_cake` — Chocolate cake
- `coins` — Coins
- `doogleleaves` — Doogle leaves
- `felinemedal` — Cat training medal
- `gertrudekittens` — Fluffs' kitten
- `raw_sardine` — Raw sardine
- `seasoned_sardine` — Seasoned sardine
- `stew` — Stew
- `trail_clue_hard_map001` — Clue scroll

## State machine

### `fluffs_not_started` (value 0)

**Interact:**
- label → `fluffs_boy_dialogue` (fluffs_boy_dialogue)
- opnpc1 → `gertrude` (Gertrude)

**Dialog options (click by text):**
- `I'm not paying you a penny.`
- `Tell me sonny, or I will hurt you.`
- `Well, I suppose I could.`
- `Yes please.`

**Items required:**
- Cat training medal (`felinemedal`)
- Fluffs' kitten (`gertrudekittens`)
- Clue scroll (`trail_clue_hard_map001`)

**Items consumed:**
- Bucket of milk (`bucket_milk`)
- Coins (`coins`)
- Doogle leaves (`doogleleaves`)
- Fluffs' kitten (`gertrudekittens`)
- Raw sardine (`raw_sardine`)
- Seasoned sardine (`seasoned_sardine`)

**Varp transitions in script:**
- → `fluffs_paid_boy` (2)
- → `fluffs_gave_milk` (3)
- → `fluffs_gave_sardine` (4)
- → `fluffs_rescued` (5)
- → `fluffs_complete` (6)
- → `fluffs_started` (1)

### `fluffs_started` (value 1)

**Interact:**
- opnpc1 → `gertrude` (Gertrude)

**Dialog options (click by text):**
- `Well, I suppose I could.`
- `Yes please.`

**Items required:**
- Cat training medal (`felinemedal`)

**Items consumed:**
- Coins (`coins`)

**Varp transitions in script:**
- → `fluffs_complete` (6)
- → `fluffs_started` (1)

### `fluffs_paid_boy` (value 2)

**Interact:**
- opnpc1 → `gertrude` (Gertrude)

**Dialog options (click by text):**
- `Well, I suppose I could.`
- `Yes please.`

**Items required:**
- Cat training medal (`felinemedal`)

**Items consumed:**
- Coins (`coins`)

**Varp transitions in script:**
- → `fluffs_complete` (6)
- → `fluffs_started` (1)

### `fluffs_gave_milk` (value 3)

**Interact:**
- opnpc1 → `gertrude` (Gertrude)

**Dialog options (click by text):**
- `Well, I suppose I could.`
- `Yes please.`

**Items required:**
- Cat training medal (`felinemedal`)

**Items consumed:**
- Coins (`coins`)

**Varp transitions in script:**
- → `fluffs_complete` (6)
- → `fluffs_started` (1)

### `fluffs_gave_sardine` (value 4)

**Interact:**
- opnpc1 → `gertrude` (Gertrude)

**Dialog options (click by text):**
- `Well, I suppose I could.`
- `Yes please.`

**Items required:**
- Cat training medal (`felinemedal`)

**Items consumed:**
- Coins (`coins`)

**Varp transitions in script:**
- → `fluffs_complete` (6)
- → `fluffs_started` (1)

### `fluffs_rescued` (value 5)

**Interact:**
- opnpc1 → `gertrude` (Gertrude)

**Dialog options (click by text):**
- `Well, I suppose I could.`
- `Yes please.`

**Items required:**
- Cat training medal (`felinemedal`)

**Items consumed:**
- Coins (`coins`)

**Varp transitions in script:**
- → `fluffs_complete` (6)
- → `fluffs_started` (1)

### `fluffs_complete` (value 6)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `gertrude` (Gertrude)

**Dialog options (click by text):**
- `Well, I suppose I could.`
- `Yes please.`

**Items required:**
- Cat training medal (`felinemedal`)

**Items consumed:**
- Coins (`coins`)

**Varp transitions in script:**
- → `fluffs_complete` (6)
- → `fluffs_started` (1)

## Source scripts

- `scripts/quests/quest_fluffs/scripts/quest_fluffs.rs2`
- `scripts/areas/area_varrock/scripts/gertrude.rs2`
- `scripts/general/scripts/quests.rs2`
