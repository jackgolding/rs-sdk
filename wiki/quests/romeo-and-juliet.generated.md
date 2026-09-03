# Romeo & Juliet (generated)

> Auto-generated from server RS2 source. Slug: `romeojuliet`, varp: `%rjquest`, complete: `romeojuliet_complete` (= 100).

## Registry

| Field | Value |
|-------|-------|
| Quest list slug | `romeojuliet` |
| Progress varp | `%rjquest` |
| Complete constant | `romeojuliet_complete` (100) |

## NPCs

### Apothecary (`apothecary`)
- Primary spawn: (3195, 3404, level 0)

### Father Lawrence (`father_lawrence`)
- Primary spawn: (3254, 3475, level 0)

### Juliet (`juliet`)
- Primary spawn: (3158, 3425, level 1)

### Romeo (`romeo`)
- Primary spawn: (3211, 3425, level 0)

## Items

- `acne_potion` — Potion
- `cadava` — Cadava potion
- `cadavaberries` — Cadava berries
- `coins` — Coins
- `julietmessage` — Message
- `limpwurt_root` — Limpwurt root
- `red_spiders_eggs` — Red spiders' eggs
- `strength4` — Strength potion(4)

## State machine

### `romeojuliet_not_started` (value 0)

**Journal:** I can start this quest by talking to Romeo in Varrock Square.

**Interact:**
- opnpc1 → `romeo` (Romeo) → @romeojuliet_start
- opnpc1 → `juliet` (Juliet) → @juliet_start
- opnpc1 → `father_lawrence` (Father Lawrence) → @father_lawrence_prequest

**Dialog options (click by text):**
- `Certainly, I will do so straight away!`
- `I am always looking for a quest.`
- `Yes I have met him.`
- `Yes, I have seen her.`
- `Yes, I will tell her how you feel.`
- `Yes, I will tell her.`

### `romeojuliet_spoken_romeo` (value 10)

**Journal:** I have agreed to find Juliet for Romeo and tell her how he feels. For some reason he can't just do this himself. I should go and speak to Juliet. I can find her west of Varrock.

**Interact:**
- opnpc1 → `romeo` (Romeo)
- opnpc1 → `juliet` (Juliet) → @juliet_from_romeo

**Dialog options (click by text):**
- `He sent me to the Apothecary.`
- `Yes, I have seen her.`
- `Yes, I will tell her how you feel.`
- `Yes, I will tell her.`

**Items required:**
- Cadava potion (`cadava`)

**Items consumed:**
- Message (`julietmessage`)

**Varp transitions in script:**
- → `romeojuliet_spoken_romeo` (10)
- → `romeojuliet_passed_message` (30)

### `romeojuliet_spoken_juliet` (value 20)

**Journal:** I have agreed to find Juliet for Romeo and tell her how he feels. For some reason he can't just do this himself. I found Juliet on the Western edge of Varrock, and told her about Romeo. She gave me a message to take back. I should take the message from Juliet to Romeo.

**Interact:**
- opnpc1 → `romeo` (Romeo) → @romeo_messagefrom
- opnpc1 → `juliet` (Juliet) → @juliet_deliver_letter

**Items required:**
- Message (`julietmessage`)

**Items consumed:**
- Message (`julietmessage`)

**Varp transitions in script:**
- → `romeojuliet_passed_message` (30)

### `romeojuliet_passed_message` (value 30)

**Journal:** I have agreed to find Juliet for Romeo and tell her how he feels. For some reason he can't just do this himself. I found Juliet on the Western edge of Varrock, and told her about Romeo. She gave me a message to take back. I delivered the message to Romeo, and he was sad to hear that Juliet's father opposed their marriage. However, he said that Father Lawrence might be able to overcome this. I should find Father Lawrence and see how we can help

**Interact:**
- opnpc1 → `romeo` (Romeo)
- opnpc1 → `juliet` (Juliet) → @juliet_message_passed
- opnpc1 → `father_lawrence` (Father Lawrence) → @father_lawrence_help

**Dialog options (click by text):**
- `He sent me to the Apothecary.`
- `I am always looking for a quest.`
- `Yes, I have seen her.`
- `Yes, I will tell her how you feel.`
- `Yes, I will tell her.`

**Items required:**
- Cadava potion (`cadava`)
- Cadava berries (`cadavaberries`)

**Items consumed:**
- Message (`julietmessage`)

**Varp transitions in script:**
- → `romeojuliet_spoken_romeo` (10)
- → `romeojuliet_passed_message` (30)
- → `romeojuliet_spoken_father` (40)

### `romeojuliet_spoken_father` (value 40)

**Journal:** I have agreed to find Juliet for Romeo and tell her how he feels. For some reason he can't just do this himself. I found Juliet on the Western edge of Varrock, and told her about Romeo. She gave me a message to take back. I delivered the message to Romeo, and he was sad to hear that Juliet's father opposed their marriage. However, he said that Father Lawrence might be able to overcome this. I found Father Lawrence and he suggested the use of a potion to fool Juliet's father that she is dead so that Romeo and Juliet can be together in peace. I need to find the Apothecary to make a cadava potion.

**Interact:**
- opnpc1 → `romeo` (Romeo) → @romeo_father
- opnpc1 → `juliet` (Juliet) → @juliet_found_father
- opnpc1 → `father_lawrence` (Father Lawrence)

**Dialog options (click by text):**
- `He sent me to the Apothecary.`
- `I am always looking for a quest.`

**Items required:**
- Cadava potion (`cadava`)
- Cadava berries (`cadavaberries`)

**Varp transitions in script:**
- → `romeojuliet_spoken_father` (40)

### `romeojuliet_spoken_apothecary` (value 50)

**Journal:** I have agreed to find Juliet for Romeo and tell her how he feels. For some reason he can't just do this himself. I found Juliet on the Western edge of Varrock, and told her about Romeo. She gave me a message to take back. I delivered the message to Romeo, and he was sad to hear that Juliet's father opposed their marriage. However, he said that Father Lawrence might be able to overcome this. I found Father Lawrence and he suggested the use of a potion to fool Juliet's father that she is dead so that Romeo and Juliet can be together in peace. I went to the Apothecary regarding making this cadava potion, and he told me to bring him some cadava berries. I should take this cadava potion to Juliet.

**Interact:**
- opnpc1 → `romeo` (Romeo) → @romeo_potion
- opnpc1 → `juliet` (Juliet) → @juliet_potion_made
- opnpc1 → `father_lawrence` (Father Lawrence)

**Dialog options (click by text):**
- `I am always looking for a quest.`

**Items required:**
- Cadava potion (`cadava`)
- Cadava berries (`cadavaberries`)

**Items consumed:**
- Cadava potion (`cadava`)

**Varp transitions in script:**
- → `romeojuliet_juliet_crypt` (60)
- → `romeojuliet_spoken_father` (40)

### `romeojuliet_juliet_crypt` (value 60)

**Journal:** I have agreed to find Juliet for Romeo and tell her how he feels. For some reason he can't just do this himself. I found Juliet on the Western edge of Varrock, and told her about Romeo. She gave me a message to take back. I delivered the message to Romeo, and he was sad to hear that Juliet's father opposed their marriage. However, he said that Father Lawrence might be able to overcome this. I found Father Lawrence and he suggested the use of a potion to fool Juliet's father that she is dead so that Romeo and Juliet can be together in peace. I went to the Apothecary regarding making this cadava potion, and he told me to bring him some cadava berries. After the Apothecary made me the potion, I delivered it to Juliet. She asked me to tell Romeo the plan. I have to find Romeo and tell him what's happened.

**Interact:**
- opnpc1 → `romeo` (Romeo) → @romeo_allset
- opnpc1 → `juliet` (Juliet)

**Dialog options (click by text):**
- `Certainly, I will do so straight away!`
- `He sent me to the Apothecary.`
- `Yes I have met him.`
- `Yes, I have seen her.`
- `Yes, I will tell her how you feel.`
- `Yes, I will tell her.`

**Items required:**
- Cadava potion (`cadava`)
- Message (`julietmessage`)

**Items consumed:**
- Cadava potion (`cadava`)
- Message (`julietmessage`)

**Varp transitions in script:**
- → `romeojuliet_spoken_romeo` (10)
- → `romeojuliet_passed_message` (30)
- → `romeojuliet_spoken_juliet` (20)
- → `romeojuliet_juliet_crypt` (60)

### `romeojuliet_complete` (value 100)

**Journal:** Quest complete.

**Interact:**
- opnpc1 → `romeo` (Romeo)
- opnpc1 → `juliet` (Juliet) → @juliet_postquest

**Dialog options (click by text):**
- `Certainly, I will do so straight away!`
- `He sent me to the Apothecary.`
- `Yes I have met him.`
- `Yes, I have seen her.`
- `Yes, I will tell her how you feel.`
- `Yes, I will tell her.`

**Items required:**
- Cadava potion (`cadava`)
- Message (`julietmessage`)

**Items consumed:**
- Cadava potion (`cadava`)
- Message (`julietmessage`)

**Varp transitions in script:**
- → `romeojuliet_spoken_romeo` (10)
- → `romeojuliet_passed_message` (30)
- → `romeojuliet_spoken_juliet` (20)
- → `romeojuliet_juliet_crypt` (60)

## Source scripts

- `scripts/quests/quest_romeojuliet/scripts/quest_romeojuliet.rs2`
- `scripts/areas/area_varrock/scripts/romeo.rs2`
- `scripts/areas/area_varrock/scripts/apothecary.rs2`
- `scripts/areas/area_varrock/scripts/juliet.rs2`
- `scripts/areas/area_varrock/scripts/father_lawrence.rs2`
- `scripts/general/scripts/quests.rs2`
