# Kalphite Queen — plan from server content (not yet scripted)

Sources: `server/content/scripts/areas/area_kalphite/scripts/kalphite_queen.rs2`,
`kalphite_locs.rs2`, `drop tables/scripts/kalphite_queen.rs2`, `maps/multiway.csv`.

## Where

- Burrow entrance (loc 3827) at **(3227, 3108)**: use a **rope** on it once (`oplocu`,
  `kalphite_burrow_entrance_withrope`), then climb down.
- Chamber entrance (loc 3830) at **(3509, 9497)**: a second **rope**.
- Queen (npc 1158 `kalphite_queen`) spawns at **(3474, 9496)** (`maps/m54_148.jm2`).
- The chamber is **multiway** (64 `0_54_148`/`0_55_148`/`0_54_147` entries): a team shares a kill.
- Guardians, soldiers and workers stand between the burrow and the chamber; workers also spawn
  during the fight (`kalphite_worker_spawn_rate`).

## Fight

- Phase 1 `kalphite_queen`, then `npc_changetype_keepall(kalphite_flyingqueen)` on death: two
  health bars per kill.
- **Magic** (`kalphite_queen_mage_huntall`): bounces across *every* player in range, max 31,
  zero under Protect from Magic (`check_protect_prayer(^magic_style)`).
- **Ranged**: max 31, zero under Protect from Missiles, and drains 1 prayer point.
- **Melee** in phase 2 (`kalphite_flyingqueen_melee_attack`).
- One protection prayer at a time, so a team splits damage: everyone on Protect from Magic (the
  attack that hits all of them) and eats through the ranged and melee.

## Loot

- `dragon_chainbody` **1/128** per kill (`$random = 121`), amulet of power 7/128, wine of zamorak,
  jewels, and the usual rune/coins rolls. No wilderness: armour is fine.

## Route (probed in-game on the local server, qlck1, 2026-11-01)

1. Surface burrow at (3227,3108): use a rope on it, then `Climb-down` → lair at **(3483,9510) plane 2**
   (a `Rope` loc with Climb-up marks the way out at (3483,9509)).
2. `findLongPath(2, 3483,9510 → 3509,9496)`: 24 legs; `bot.walkTo(3507,9497)` arrives.
3. Kalphite Guardians (141) and a Soldier (85) stand at the chamber entrance, workers (28) roam; they poison.
4. Rope on the chamber entrance (3509,9497), climb → **(3508,9493) plane 0**, the Queen's level;
   she spawns at (3474,9496), ~34 tiles west. Guardians stand inside too (3498,9496/9507).
5. The burrow is inside the desert wall: from Al Kharid bank `findLongPath` stops at (3231,3147).
   The way in is the **Shantay Pass** (`area_alkharid/scripts/shantay_pass.rs2`, a Shantay pass
   from the shop), then ~80 tiles west through the desert, where `desert_heat.rs2` drains hp
   without waterskins (timer 150, longer with desert robes).
6. Bring 2 ropes per entry if the ropes despawn (`^lootdrop_duration`), antipoison, food.

## Build order

1. Route probe (local, cheat tier): ropes ×2, burrow → chamber legs with `findLongPath`, as done for
   Brimhaven (`learnings/brimhaven-dungeon.md`).
2. Team loop on the `kbd-range.ts --melee` pattern: bank rendezvous, Protect from Magic, eat at
   55%, leave at 6 food.
3. Canary with 4 accounts of 99 melee; then scale.
