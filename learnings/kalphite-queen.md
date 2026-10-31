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

## Build order

1. Route probe (local, cheat tier): ropes ×2, burrow → chamber legs with `findLongPath`, as done for
   Brimhaven (`learnings/brimhaven-dungeon.md`).
2. Team loop on the `kbd-range.ts --melee` pattern: bank rendezvous, Protect from Magic, eat at
   55%, leave at 6 food.
3. Canary with 4 accounts of 99 melee; then scale.
