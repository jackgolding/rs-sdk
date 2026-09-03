# Priest in Peril (generated)

> Auto-generated from server RS2 source. Slug: `priestperil`, varp: `%priestperil`, complete: `priestperil_complete` (= 60).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `priestperil` |
| Progress varp | `%priestperil` |
| Complete constant | `priestperil_complete` (60) |

## NPCs

### King Roald (`king_roald`)
- Primary spawn: (3222, 3476, level 0)

### Drezel (`priestperiltrappedmonk`)
- Primary spawn: (3417, 3489, level 2)

### Drezel (`priestperiltrappedmonk2`)
- Primary spawn: (3440, 9895, level 0)

## Items

- `apple_pie` — Apple pie
- `arravcertificate` — Certificate
- `arravshield1` — Broken shield
- `arravshield2` — Broken shield
- `blankrune` — Rune essence
- `bucket_blessedwater` — Bucket of water
- `bucket_empty` — Bucket
- `bucket_murkywater` — Bucket of water
- `cert_blankrune` — cert_blankrune
- `dagger_wolfbane` — Wolfbane
- `last_useitem` — last_useitem
- `meat_pie` — Meat pie
- `pipkey_iron` — Iron key
- `silver_sickle` — Silver sickle

## State machine

### `priestperil_not_started` (value 0)

**Journal:** I can start this quest by speaking to King Roald in Varrock Palace I must be able to defeat a level 30 enemy

### `priestperil_started` (value 1)

**Journal:** I spoke to King Roald who asked me to investigate why his friend Priest Drezel has stopped communicating with him. Drezel lives in a temple to the east of Varrock Palace. I should head there and investigate what's happened to him

### `priestperil_agree_to_kill_dog` (value 2)

**Journal:** I spoke to King Roald who asked me to investigate why his friend Priest Drezel has stopped communicating with him. I headed to the temple where Drezel lives, but it was all locked shut. I spoke through the locked door to Drezel. He told me that there was an annoying dog below the temple, and has asked me to kill it for him

### `priestperil_killed_dog` (value 3)

**Journal:** I spoke to King Roald who asked me to investigate why his friend Priest Drezel has stopped communicating with him. I headed to the temple where Drezel lives, but it was all locked shut. I spoke through the locked door to Drezel. He told me that there was an annoying dog below the temple, and asked me to kill it, which I did easily. I should tell King Roald everything's fine with Drezel now I have killed that dog for him, and claim my reward

### `priestperil_return_to_drezel` (value 4)

**Journal:** I spoke to King Roald who asked me to investigate why his friend Priest Drezel has stopped communicating with him. I headed to the temple where Drezel lives, but it was all locked shut. I spoke through the locked door to Drezel. He told me that there was an annoying dog below the temple, and asked me to kill it, which I did easily. When I told Roald what I had done, he was furious. The person who told me to kill the dog wasn't Drezel at all! I must return to the temple and find out what happened to the real Drezel, or the King will have me executed!

### `priestperil_find_drezel_key` (value 5)

**Journal:** I spoke to King Roald who asked me to investigate why his friend Priest Drezel has stopped communicating with him. I headed to the temple where Drezel lives, but it was all locked shut. I spoke through the locked door to Drezel. He told me that there was an annoying dog below the temple, and asked me to kill it, which I did easily. When I told Roald what I had done, he was furious. The person who told me to kill the dog wasn't Drezel at all! I returned to the temple and found the real Drezel locked in a makeshift cell upstairs, guarded by a vampire. I need to find the key to his cell and free him! I have found a golden key on one of the monks. I have swapped it for an iron key at the monument.

### `priestperil_unlocked_drezel` (value 6)

**Journal:** I spoke to King Roald who asked me to investigate why his friend Priest Drezel has stopped communicating with him. I headed to the temple where Drezel lives, but it was all locked shut. I spoke through the locked door to Drezel. He told me that there was an annoying dog below the temple, and asked me to kill it, which I did easily. When I told Roald what I had done, he was furious. The person who told me to kill the dog wasn't Drezel at all! I returned to the temple and found the real Drezel locked in a makeshift cell upstairs, guarded by a vampire. I used a key from the monument to open the cell door but I still have to do something about that vampire I should pour some holy water on the coffin. I have some water from the River Salve.

### `priestperil_poured_blessed_water` (value 7)

**Journal:** I spoke to King Roald who asked me to investigate why his friend Priest Drezel has stopped communicating with him. I headed to the temple where Drezel lives, but it was all locked shut. I spoke through the locked door to Drezel. He told me that there was an annoying dog below the temple, and asked me to kill it, which I did easily. When I told Roald what I had done, he was furious. The person who told me to kill the dog wasn't Drezel at all! I returned to the temple and found the real Drezel locked in a makeshift cell upstairs, guarded by a vampire. I used a key from the monument to open the cell door and used Holy Water to trap the vampire in his coffin. I should speak to Drezel again

### `priestperil_meet_in_mausoleum` (value 8)

**Journal:** I spoke to King Roald who asked me to investigate why his friend Priest Drezel has stopped communicating with him. I headed to the temple where Drezel lives, but it was all locked shut. I spoke through the locked door to Drezel. He told me that there was an annoying dog below the temple, and asked me to kill it, which I did easily. When I told Roald what I had done, he was furious. The person who told me to kill the dog wasn't Drezel at all! I returned to the temple and found the real Drezel locked in a makeshift cell upstairs, guarded by a vampire. I used a key from the monument to open the cell door and and used Holy Water to trap the vampire in his coffin. I should head downstairs to the monument like Drezel asked me to, and assess what damage has been done

### `priestperil_begin_bring_essence` (value 10)

### `priestperil_end_bring_essence` (value 60)

### `priestperil_complete` (value 60)

**Journal:** Quest complete.

## Source scripts

- `scripts/quests/quest_priestperil/scripts/temple_doors.rs2`
- `scripts/quests/quest_priestperil/scripts/evil_monks.rs2`
- `scripts/quests/quest_priestperil/scripts/trapped_drezel.rs2`
- `scripts/quests/quest_priestperil/scripts/vampire_coffin.rs2`
- `scripts/quests/quest_priestperil/scripts/priestperil.rs2`
- `scripts/areas/area_varrock/scripts/king_roald.rs2`
- `scripts/areas/area_mausoleum/scripts/well.rs2`
- `scripts/areas/area_mausoleum/scripts/temple_guardian.rs2`
- `scripts/areas/area_mausoleum/scripts/monuments.rs2`
- `scripts/areas/area_mausoleum/scripts/holy_barrier.rs2`
- `scripts/areas/area_mausoleum/scripts/drezel.rs2`
- `scripts/areas/area_mausoleum/scripts/gates.rs2`
- `scripts/general/scripts/quests.rs2`
