# The Tourist Trap (generated)

> Auto-generated from server RS2 source. Slug: `tbwt`, varp: `%tbwt_main`, complete: `tbwt_complete` (= 6).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `tbwt` |
| Progress varp | `%tbwt_main` |
| Complete constant | `tbwt_complete` (6) |

## NPCs

### Monkey (`monkey`)
- Primary spawn: (2820, 3193, level 0)
- Other spawns: (2873, 3148, level 0); (2877, 3154, level 0); (2879, 3161, level 0)…

### Lubufu (`tbwt_lubufu`)
- Primary spawn: (2770, 3169, level 0)

### Tamayu (`tbwt_tamayu`)
- Primary spawn: (2844, 3042, level 0)

### Tiadeche (`tbwt_tiadeche`)
- Primary spawn: (2528, 4589, level 0)
- Other spawns: (2912, 3118, level 0)

### Timfraku (`tbwt_timfraku`)
- Primary spawn: (2780, 3087, level 1)

### Tinsay (`tbwt_tinsay`)
- Primary spawn: (2764, 2976, level 0)

### Trufitus (`trufitus`)
- Primary spawn: (2809, 3086, level 0)

## Items

- `banana` — Banana
- `bones` — Bones
- `coins` — Coins
- `karamja_rum` — Karamjan rum
- `mm_normal_monkey_bones` — mm_normal_monkey_bones
- `mosol_wampum_belt` — Wampum belt
- `seaweed` — Seaweed
- `silk` — Silk
- `tbwt_banana_in_karamja_rum` — tbwt_banana_in_karamja_rum
- `tbwt_burnt_jogre_bones` — Burnt jogre bones
- `tbwt_burnt_jogre_bones_in_cooked_karambwanji_paste` — Pasty jogre bones
- `tbwt_burnt_jogre_bones_in_raw_karambwanji_paste` — Pasty jogre bones
- `tbwt_burnt_jogre_bones_marinated_in_karambwanji` — Marinated j' bones
- `tbwt_cleaning_cloth` — tbwt_cleaning_cloth
- `tbwt_cooked_karambwanji_paste` — tbwt_cooked_karambwanji_paste
- `tbwt_crafting_manual` — tbwt_crafting_manual
- `tbwt_jogre_bones` — Jogre bones
- `tbwt_jogre_bones_in_cooked_karambwanji_paste` — Pasty jogre bones
- `tbwt_jogre_bones_in_raw_karambwanji_paste` — Pasty jogre bones
- `tbwt_jogre_bones_marinated_in_karambwanji` — Marinated j' bones
- `tbwt_karambwan_vessel` — tbwt_karambwan_vessel
- `tbwt_karambwan_vessel_loaded_with_karambwanji` — Karambwan vessel
- `tbwt_monkey_corpse` — tbwt_monkey_corpse
- `tbwt_monkey_skin` — tbwt_monkey_skin
- `tbwt_raw_karambwan` — Raw karambwan
- `tbwt_raw_karambwanji` — Raw karambwanji
- `tbwt_raw_karambwanji_paste` — tbwt_raw_karambwanji_paste
- `tbwt_seaweed_in_monkey_corpse` — tbwt_seaweed_in_monkey_corpse
- `tbwt_seaweed_in_monkey_skin_sandwich` — tbwt_seaweed_in_monkey_skin_sandwich
- `tbwt_sliced_banana` — tbwt_sliced_banana
- `tbwt_sliced_banana_in_karamja_rum` — tbwt_sliced_banana_in_karamja_rum

## State machine

### `tbwt_not_started` (value 0)

**Interact:**
- opnpc1 → `tbwt_timfraku` (Timfraku)

**Dialog options (click by text):**
- `Can you tell me more about Tamayu?`
- `Can you tell me more about your sons?`
- `I am a roving adventurer.`
- `Oh it was nothing really.`
- `Well there's a simple explanation for that...`
- `What do you do here?`
- `Where is this place?`
- `Why should I leave?`
- `Your gratitude is all I deserve.`

**Varp transitions in script:**
- → `tbwt_spoke_to_timfraku` (1)
- → `tbwt_timfraku_asked_for_help` (2)
- → `tbwt_started` (3)
- → `tbwt_received_gold_reward` (5)

### `tbwt_timfraku_title_start` (value 0)

### `tbwt_timfraku_rovingadventurer` (value 0)

### `tbwt_tiadeche_unknown` (value 0)

### `tbwt_tamayu_unknown` (value 0)

### `tbwt_tinsay_unknown` (value 0)

### `tbwt_lubufu_unknown` (value 0)

### `tbwt_spoke_to_timfraku` (value 1)

**Interact:**
- opnpc1 → `tbwt_timfraku` (Timfraku) → @tbwt_timfraku_spoke_to_timfraku

**Dialog options (click by text):**
- `Well there's a simple explanation for that...`
- `Your gratitude is all I deserve.`

### `tbwt_timfraku_title_end` (value 1)

### `tbwt_timfraku_travellingexplorer` (value 1)

### `tbwt_tiadeche_intro` (value 1)

### `tbwt_tamayu_intro` (value 1)

### `tbwt_tinsay_intro` (value 1)

### `tbwt_lubufu_intro` (value 1)

### `tbwt_timfraku_asked_for_help` (value 2)

**Interact:**
- opnpc1 → `tbwt_timfraku` (Timfraku) → @tbwt_timfraku_readytohelp

### `tbwt_tiadeche_received_karambwan` (value 2)

### `tbwt_timfraku_wanderingwayfarer` (value 2)

### `tbwt_tiadeche_return_when_caught_karambwan` (value 2)

### `tbwt_tamayu_slay_shaikahan` (value 2)

### `tbwt_tinsay_fetch_bananarum` (value 2)

### `tbwt_lubufu_initialops` (value 2)

### `tbwt_started` (value 3)

**Interact:**
- opnpc1 → `tbwt_timfraku` (Timfraku)

**Dialog options (click by text):**
- `Can you tell me more about Tamayu?`
- `Can you tell me more about your sons?`
- `I am a roving adventurer.`
- `Oh it was nothing really.`
- `Well there's a simple explanation for that...`
- `What do you do here?`
- `Where is this place?`
- `Why should I leave?`
- `Your gratitude is all I deserve.`

**Varp transitions in script:**
- → `tbwt_spoke_to_timfraku` (1)
- → `tbwt_timfraku_asked_for_help` (2)
- → `tbwt_started` (3)
- → `tbwt_received_gold_reward` (5)

### `tbwt_tamayu_agility_count_start` (value 3)

### `tbwt_timfraku_nobody` (value 3)

### `tbwt_tiadeche_caught_karambwan` (value 3)

### `tbwt_tamayu_watched_cutscene` (value 3)

### `tbwt_tinsay_given_bananarum` (value 3)

### `tbwt_lubufu_asked_what_do` (value 3)

### `tbwt_completed_all_brothers` (value 4)

**Journal:** I have convinced them to return to the village. I must speak with Timfraku.

**Interact:**
- opnpc1 → `tbwt_timfraku` (Timfraku) → @tbwt_timfraku_completed_brother_tasks

**Dialog options (click by text):**
- `Oh it was nothing really.`

### `tbwt_tiadeche_request_manual` (value 4)

### `tbwt_tamayu_complete` (value 4)

### `tbwt_tinsay_fetch_seaweedsandwich` (value 4)

### `tbwt_lubufu_offered_to_help` (value 4)

### `tbwt_received_gold_reward` (value 5)

**Interact:**
- opnpc1 → `tbwt_timfraku` (Timfraku) → @tbwt_timfraku_complete_quest

### `tbwt_tamayu_agility_count_end` (value 5)

### `tbwt_tiadeche_player_received_manual` (value 5)

### `tbwt_tamayu_claimed_final_reward` (value 5)

### `tbwt_tinsay_given_seaweedsandwich` (value 5)

### `tbwt_lubufu_fetch_karambwanji` (value 5)

### `tbwt_tamayu_received_acceptable_spear` (value 6)

### `tbwt_tiadeche_complete` (value 6)

### `tbwt_tinsay_fetch_marinatedbones` (value 6)

### `tbwt_complete` (value 6)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `tbwt_timfraku` (Timfraku) → @tbwt_timfraku_post_tbwt

**Dialog options (click by text):**
- `What do you do here?`

## Source scripts

- `scripts/quests/quest_tbwt/scripts/tbwt_lubufu.rs2`
- `scripts/quests/quest_tbwt/scripts/tbwt_tamayu.rs2`
- `scripts/quests/quest_tbwt/scripts/monkey.rs2`
- `scripts/quests/quest_tbwt/scripts/quest_tbwt.rs2`
- `scripts/quests/quest_tbwt/scripts/tbwt_tiadeche.rs2`
- `scripts/quests/quest_tbwt/scripts/tbwt_tinsay.rs2`
- `scripts/areas/area_karamja/scripts/trufitus.rs2`
- `scripts/areas/area_karamja/scripts/tbwt_timfraku.rs2`
- `scripts/general/scripts/quests.rs2`
