# Legends Quest (generated)

> Auto-generated from server RS2 source. Slug: `legends`, varp: `%legendsquest`, complete: `legends_complete` (= 75).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `legends` |
| Progress varp | `%legendsquest` |
| Complete constant | `legends_complete` (75) |

## NPCs

### _legends_guard (`_legends_guard`)
- Spawn: not in map data (instanced / moved / members)

### Boulder (`boulder_legends`)
- Primary spawn: (2373, 4692, level 0)
- Other spawns: (2386, 4689, level 0); (2392, 4678, level 0)

### Echned Zekin (`echned_zekin`)
- Spawn: not in map data (instanced / moved / members)

### Gujuo (`gujuo`)
- Spawn: not in map data (instanced / moved / members)

### Irvig Senay (`irvig_senay`)
- Primary spawn: (2401, 4705, level 0)
- Other spawns: (2405, 4712, level 0); (2412, 4723, level 0); (2414, 4731, level 0)

### Jungle Forester (`jungleforester_m`)
- Primary spawn: (2764, 2944, level 0)
- Other spawns: (2798, 2944, level 0); (2824, 2940, level 0); (2863, 2941, level 0)

### Radimus Erkle (`radimus_erkle`)
- Primary spawn: (2724, 3368, level 0)
- Other spawns: (2724, 3378, level 0)

### Ranalph Devere (`ranalph_devere`)
- Primary spawn: (2408, 4698, level 0)
- Other spawns: (2417, 4699, level 0); (2424, 4701, level 0); (2428, 4696, level 0)

### San Tojalon (`san_tojalon`)
- Primary spawn: (2384, 4706, level 0)
- Other spawns: (2393, 4713, level 0); (2394, 4731, level 0); (2395, 4721, level 0)

### Ungadulu (`ungadulu_good`)
- Primary spawn: (2792, 9327, level 0)

### Olaf the Bard (`viking_olaf`)
- Primary spawn: (2673, 3683, level 0)

## Items

- `ardrigal` — Ardrigal
- `ardrigal_sol` — Ardrigal mixture
- `book_of_binding` — Book of binding
- `bowl_empty` — Bowl
- `bowl_water` — Bowl of water
- `bravery_pot` — Bravery potion
- `bronze_pickaxe` — Bronze pickaxe
- `bucket_empty` — Bucket
- `bucket_water` — Bucket of water
- `bullroarer` — Bull roarer
- `charcoal` — Charcoal
- `coins` — Coins
- `deathdagger` — Black dagger
- `deathdaggerdone` — Glowing dagger
- `earthrune` — Earth rune
- `gold_bar` — Gold bar
- `goldbowl_empty` — Gold bowl
- `goldbowl_pure` — Golden bowl
- `goldbowl_water` — Golden bowl
- `goldbowlbless_empty` — Blessed gold bowl
- `goldbowlbless_pure` — Golden bowl
- `goldbowlbless_water` — Golden bowl
- `goldbowlpic` — Sketch
- `heartcrystal` — Heart crystal
- `heartcrystal_glow` — Heart crystal
- `heartcrystal_sectiona` — Chunk of crystal
- `heartcrystal_sectionb` — Hunk of crystal
- `heartcrystal_sectionc` — Lump of crystal
- `holy_water` — Holy water
- `holyforce` — Holy force
- `jug_empty` — Jug
- `jug_water` — Jug of water
- `lawrune` — Law rune
- `lockpick` — Lockpick
- `logs` — Logs
- `machette` — Machete
- `magic_logs` — Magic logs
- `mindrune` — Mind rune
- `papyrus` — Papyrus
- `reed_hollow` — Hollow reed
- `ring_of_wealth` — Ring of wealth
- `rope` — Rope
- `scrawled_note1` — Scrawled note
- `scrawled_note2` — A scribbled note
- `scrawled_note3` — Scrumpled note
- `shamans_tome` — Shamans tome
- `snake_weed` — Snake weed
- `snakeweed_sol` — Snakeweed mixture
- `soulrune` — Soul rune
- `stafforb` — Unpowered orb
- `swamprocks1` — Rock
- `thkaramjamap` — Radimus notes
- `thkaramjamapcomp` — Radimus notes
- `thtotempole` — Yommi totem
- `thtotempolegift` — Gilded totem
- `vial_empty` — Vial
- `vial_enchanted` — Enchanted vial
- `vial_water` — Vial of water
- `viking_enchanted_strung_lyre` — Enchanted lyre
- `viking_golden_wool` — Golden wool
- `viking_musical_tree_branch` — Branch
- `viking_new_boots` — Sturdy boots
- `viking_song` — Fremennik ballad
- `viking_strung_lyre` — Lyre
- `viking_unstrung_lyre` — Unstrung lyre
- `yommiseeds` — Yommi tree seeds
- `yommiseeds_germ` — Yommi tree seeds

## State machine

### `legends_not_started` (value 0)

**Journal:** I can start this quest by speaking to Radimus Erkle in the Legends Guild, North East of Ardougne. To start this quest I need to complete the following:- 'Heroes Quest'

### `legends_jungle_west_mapped` (value 0)

### `legends_started` (value 1)

### `legends_jungle_middle_mapped` (value 1)

### `legends_mapped_jungle` (value 2)

**Journal:** I need to make friends with a native and bring back a gift which can be displayed in the Legends Guild.

### `legends_jungle_east_mapped` (value 2)

### `legends_got_bullroarer` (value 3)

**Journal:** I need to make friends with a native and bring back a gift which can be displayed in the Legends Guild.

### `legends_entered_cavern` (value 3)

### `legends_swung_bullroarer` (value 4)

**Journal:** I've met 'Gujuo', a Kharazi Jungle native. Perhaps I can make friends with him?

### `legends_asked_ungadulu_where` (value 4)

### `legends_defeated_san_final` (value 4)

### `legends_accepted_rescue_ungadulu` (value 5)

**Journal:** I agreed to help Gujuo by releasing a Shaman who is being held in some caves in North West Kharazi.

**Interact:**
- opnpc1 → `gujuo` (Gujuo) → @multi2

**Dialog options (click by text):**
- `Can you get your people together?`
- `Do you have any news?`
- `Do you know anything more about the caves?`
- `Does the Yommi tree have to have pure water?`
- `How do I bless the vessel?`
- `How do we make the totem pole?`
- `I can't find the caves...`
- `I found the source of the spring and I got the water.`
- `I have found a way into the caves!`
- `I have germinated the Yommi tree seeds.`
- `I have the Yommi tree seeds.`
- `I made the Totem pole, now what do I do with it?`
- `I want to develop friendly relations with your people.`
- `I was hoping to attract the attention of a native.`
- `I will release Ungadulu...`
- `I've found the caves, but I don't know what to do.`
- `If I went, could you help me?`
- `Metal of the sun, what is that?`
- `Ok, I won't go...`
- `Ok, thanks... Goodbye.`
- `Sorry for bothering you.`
- `The sacred water pool has dried up and I need more water.`
- `The water pool has dried up and I need more water.`
- `Ungadulu is free, he was possesed by a demon and I killed it.`
- `Ungadulu is free, he was possessed by a demon and I killed it.`
- `Ungadulu is trapped in some magical flames!`
- `Ungadulu looks a little strange.`
- `What can we do instead then?`
- `What kind of a vessel?`
- `What kind of unknown force?`
- `Where can I find Ardrigal?`
- `Where can I find Snake weed?`
- `Where can I find this metal?`
- `Where can I get more water for the Yommi tree?`
- `Where is the fertile soil?`
- `Where is the source of the spring of pure water?`
- `Yes please...`
- `Yes, I'd like to bless my gold bowl.`
- `Yes, I'd like you to bless my gold bowl.`

**Items required:**
- Gold bowl (`goldbowl_empty`)
- Golden bowl (`goldbowl_pure`)
- Golden bowl (`goldbowl_water`)
- Blessed gold bowl (`goldbowlbless_empty`)
- Golden bowl (`goldbowlbless_pure`)
- Golden bowl (`goldbowlbless_water`)
- Sketch (`goldbowlpic`)
- Yommi totem (`thtotempole`)
- Yommi tree seeds (`yommiseeds`)
- Yommi tree seeds (`yommiseeds_germ`)

**Items consumed:**
- Gold bowl (`goldbowl_empty`)
- Golden bowl (`goldbowl_pure`)
- Golden bowl (`goldbowl_water`)
- Yommi tree seeds (`yommiseeds`)
- Yommi tree seeds (`yommiseeds_germ`)

**Varp transitions in script:**
- → `legends_got_bullroarer` (3)
- → `legends_swung_bullroarer` (4)
- → `legends_defeated_nezikchened_fire` (12)
- → `legends_germinated_seeds` (13)
- → `legends_water_pool_dried_up` (14)
- → `legends_talk_gujuo_pool` (15)
- → `legends_replaced_totem` (40)
- → `legends_got_gilded_totem` (45)
- → `legends_asked_gujuo_holy_water` (8)
- → `legends_accepted_rescue_ungadulu` (5)

### `legends_asked_ungadulu_who` (value 5)

### `legends_defeated_irvig_final` (value 5)

### `legends_found_entrance` (value 6)

**Journal:** I need to get some Yommi tree seeds from Ungadulu.

**Interact:**
- opnpc1 → `gujuo` (Gujuo)

**Dialog options (click by text):**
- `Can you get your people together?`
- `Do you have any news?`
- `Do you know anything more about the caves?`
- `Does the Yommi tree have to have pure water?`
- `How do I bless the vessel?`
- `How do we make the totem pole?`
- `I can't find the caves...`
- `I found the source of the spring and I got the water.`
- `I have found a way into the caves!`
- `I have germinated the Yommi tree seeds.`
- `I have the Yommi tree seeds.`
- `I made the Totem pole, now what do I do with it?`
- `I want to develop friendly relations with your people.`
- `I was hoping to attract the attention of a native.`
- `I will release Ungadulu...`
- `I've found the caves, but I don't know what to do.`
- `If I went, could you help me?`
- `Metal of the sun, what is that?`
- `Ok, I won't go...`
- `Ok, thanks... Goodbye.`
- `Sorry for bothering you.`
- `The sacred water pool has dried up and I need more water.`
- `The water pool has dried up and I need more water.`
- `Ungadulu is free, he was possesed by a demon and I killed it.`
- `Ungadulu is free, he was possessed by a demon and I killed it.`
- `Ungadulu is trapped in some magical flames!`
- `Ungadulu looks a little strange.`
- `What can we do instead then?`
- `What kind of a vessel?`
- `What kind of unknown force?`
- `Where can I find Ardrigal?`
- `Where can I find Snake weed?`
- `Where can I find this metal?`
- `Where can I get more water for the Yommi tree?`
- `Where is the fertile soil?`
- `Where is the source of the spring of pure water?`
- `Yes please...`
- `Yes, I'd like to bless my gold bowl.`
- `Yes, I'd like you to bless my gold bowl.`

**Items required:**
- Gold bowl (`goldbowl_empty`)
- Golden bowl (`goldbowl_pure`)
- Golden bowl (`goldbowl_water`)
- Blessed gold bowl (`goldbowlbless_empty`)
- Golden bowl (`goldbowlbless_pure`)
- Golden bowl (`goldbowlbless_water`)
- Sketch (`goldbowlpic`)
- Yommi totem (`thtotempole`)
- Yommi tree seeds (`yommiseeds`)
- Yommi tree seeds (`yommiseeds_germ`)

**Items consumed:**
- Gold bowl (`goldbowl_empty`)
- Golden bowl (`goldbowl_pure`)
- Golden bowl (`goldbowl_water`)
- Yommi tree seeds (`yommiseeds`)
- Yommi tree seeds (`yommiseeds_germ`)

**Varp transitions in script:**
- → `legends_got_bullroarer` (3)
- → `legends_swung_bullroarer` (4)
- → `legends_defeated_nezikchened_fire` (12)
- → `legends_germinated_seeds` (13)
- → `legends_water_pool_dried_up` (14)
- → `legends_talk_gujuo_pool` (15)
- → `legends_replaced_totem` (40)
- → `legends_got_gilded_totem` (45)
- → `legends_asked_gujuo_holy_water` (8)
- → `legends_accepted_rescue_ungadulu` (5)

### `legends_ungadulu_called_vacu` (value 6)

### `legends_defeated_ranalph_final` (value 6)

### `legends_spoke_ungadulu` (value 7)

**Journal:** Ungadulu is acting weird and talking a lot of nonsense, perhaps someone else can help me understand what he's talking about. I need to get some Yommi tree seeds from Ungadulu.

### `legends_soul_rune_used` (value 7)

### `legends_asked_gujuo_holy_water` (value 8)

**Journal:** Gujuo said I need a blessed vessel of sun metal. I have a blessed golden bowl, now I need some sacred water.

### `legends_mind_rune_used` (value 8)

### `legends_earth_rune_used` (value 9)

### `legends_filled_bowl` (value 10)

**Journal:** I have some sacred water. Ungadulu mentioned that it may help me to get closer to him. I need get some Yommi tree seeds from Ungadulu. I found a 'book of binding' which may give some clue as to how I can release Ungadulu.

### `legends_law_rune_1_used` (value 10)

### `legends_summoned_nezikchened_fire` (value 11)

### `legends_law_rune_2_used` (value 11)

### `legends_defeated_nezikchened_fire` (value 12)

**Journal:** I have some Yommi tree seeds from Ungadulu. I need to germinate them with sacred water before planting them in fertile soil. Ungadulu studies supernatural spirits!

### `legends_opal_used` (value 12)

### `legends_germinated_seeds` (value 13)

**Journal:** I have some germinated Yommi tree seeds. I just need to plant them now in some fertile soil. Ungadulu studies supernatural spirits!

### `legends_jade_used` (value 13)

### `legends_water_pool_dried_up` (value 14)

**Journal:** I need to get some more sacred water in order for the Yommi tree to grow.

### `legends_topaz_used` (value 14)

### `legends_talk_gujuo_pool` (value 15)

**Journal:** Gujuo said the sacred water source is in the Viyeldi caves. I have made a bravery potion in order to enter the caves. I need to find the Viyeldi caves and the source of the sacred water.

### `legends_sapphire_used` (value 15)

### `legends_enter_lower_dungeon` (value 16)

**Journal:** I'm able to access the Viyeldi Caves. I need to find the source of sacred water, which may be protected.

### `legends_diamond_used` (value 16)

### `legends_crystal_pieces_smelted` (value 17)

**Journal:** I have a glowing dragon heart crystal which might help me to gain access to the sacred water.

### `legends_ruby_used` (value 17)

### `legends_heart_in_recess` (value 18)

**Journal:** I need to find the source of the sacred water and collect some so I can grow a Yommi tree.

### `legends_emerald_used` (value 18)

### `legends_pushed_boulder` (value 19)

**Journal:** A strange spirit seems to be guarding the sacred water.

### `legends_golden_bowl_uses_start` (value 19)

### `legends_received_dagger` (value 20)

### `legends_defeated_nezikchened_water` (value 22)

**Journal:** I need to collect some sacred water in order to grow a Yommi tree and make it into a totem pole.

### `legends_golden_bowl_uses_end` (value 23)

### `legends_tied_rope_winch` (value 24)

### `legends_sacred_water_collected` (value 25)

**Journal:** I can now try to grow a Yommi tree in order to make a Yommi tree totem pole.

### `legends_drank_bravery_potion` (value 25)

### `legends_smelting_chunk` (value 26)

### `legends_smelting_hunk` (value 27)

### `legends_smelting_lump` (value 28)

### `legends_killed_viyeldi` (value 29)

### `legends_collected_totem` (value 30)

**Journal:** I've got a Yommi tree totem pole, I need to place this somewhere so that Gujuo can gather his people together. Perhaps then I can make friends with the Kharazi tribe.

### `legends_given_dagger` (value 30)

### `legends_spawned_nezikchened_final` (value 32)

**Journal:** I have to defeat the demon Nezikchened in order to replace the evil totem pole.

### `legends_defeated_nezikchened_final` (value 35)

### `legends_replaced_totem` (value 40)

### `legends_got_gilded_totem` (value 45)

**Journal:** Gujuo gave me a fine gilded totem pole for freeing the Kharazi Jungle from Nezikchened's demonic power. The gilded totem pole will make a find addition to the Legends Guild.

### `legends_returned_to_radimus` (value 50)

**Journal:** Radimus asked me to join him inside the Legends Guild to discuss my reward.

### `legends_radimus_training_1` (value 55)

### `legends_radimus_training_2` (value 60)

### `legends_radimus_training_3` (value 65)

### `legends_radimus_training_4` (value 70)

### `legends_complete` (value 75)

**Journal:** Radimus Erkle asked me to go to map the Kharazi Jungle. In addition, he asked me to meet with the tribe of the Kharazi Jungle and return with some sort of gift or token to display in the Legends Guild. Once I'd mapped the jungle I met up with a Kharazi tribe member called Gujuo, he told me that his tribe was scattered throughout the jungle. He asked me to make a new Yommi tree totem pole in order to gather the peoples of the Kharazi tribe together. In the process of getting a Yommi tree, I released a Shaman from being possessed by a Demon called Nezikchened. I managed to slay the demon eventually but he kept reappearing! I eventually managed to slay the demon and replace the evil totem pole with a good one. Gujuo managed to call all of his people together and they rewarded me for my efforts with a gilded totem pole which is now on display in the Legends Guild for all to see. Radimus Erkle granted me access to the Legends' Guild facilities. @red@QUEST COMPLETE!

## Source scripts

- `scripts/quests/quest_viking/scripts/viking_olaf.rs2`
- `scripts/quests/quest_legends/scripts/radimus_erkle.rs2`
- `scripts/quests/quest_legends/scripts/radimus_notes.rs2`
- `scripts/quests/quest_legends/scripts/viyeldi.rs2`
- `scripts/quests/quest_legends/scripts/jungle_tree.rs2`
- `scripts/quests/quest_legends/scripts/irvig_senay.rs2`
- `scripts/quests/quest_legends/scripts/legends_gate.rs2`
- `scripts/quests/quest_legends/scripts/echned_zekin.rs2`
- `scripts/quests/quest_legends/scripts/nezikchened.rs2`
- `scripts/quests/quest_legends/scripts/legends_guard.rs2`
- `scripts/quests/quest_legends/scripts/quest_legends.rs2`
- `scripts/quests/quest_legends/scripts/jungle_forester.rs2`
- `scripts/quests/quest_legends/scripts/legends_boulder.rs2`
- `scripts/quests/quest_legends/scripts/san_tojalon.rs2`
- `scripts/quests/quest_legends/scripts/gujuo.rs2`
- `scripts/quests/quest_legends/scripts/ungadulu.rs2`
- `scripts/quests/quest_legends/scripts/ranalph_devere.rs2`
- `scripts/quests/quest_legends/scripts/legends_door.rs2`
- `scripts/levelrequire/scripts/levelrequire.rs2`
- `scripts/general/scripts/quests.rs2`
- `scripts/skill_herblore/scripts/brewing/brew_potion.rs2`
- `scripts/drop tables/scripts/shared_droptables.rs2`
- `scripts/skill_smithing/scripts/smithing/smithing.rs2`
