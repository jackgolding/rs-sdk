# King Black Dragon — mith knives, safespot

**Aborted 2026-09-04.** The southwest-pillar tile (2706, 9818, west of
`loc_542`) was inferred from a bow video, not proven on this server. Knives
are range 4 (6 Longrange); that stand likely cannot hit, or KBD still melees
through it. Do not relaunch `kbd-range.ts` as a fleet job until a real
safespot is confirmed in-game.

Do not melee it, and do not use the lite `kbd-fast-attack` rune-2h runner
(that is a different one-item policy in `server/webclient/src/lite/fast-kbd.ts`).

Source of truth is `server/content/scripts/areas/area_wilderness/scripts/king_black_dragon.rs2`
plus map `m42_153.jm2` / `m47_160.jm2` / `m47_60.jm2`. The YouTube guide is
human strategy (bows, teams, cannon); this page is the bot loop.

## Fleet rules

1. **Accurate** until Ranged 99.
2. Then **Longrange** until Defence 99.
3. Then **Rapid**.
4. After the dragon dies: pick up **mithril knives** (then bones / hide / rares).
5. Walk back onto the safespot **before** the next spawn. Do not loot mid-fight.

Knives are 4 tiles (6 on Longrange). The video safespot was tuned for a bow
(7–10). Confirm the stand tile still hits on Accurate before parking a grind
on Rapid — if Chebyshev distance to the nearest KBD tile is 5–6, Accurate
and Rapid will no-op and only Longrange works.

## Why knives

| | |
|---|---|
| Wield | Right hand (`mithril_knife`), Ranged 20. Stackable. |
| Off-hand | **Dragonfire shield** (`antidragonbreathshield`) stays on. A bow cannot. |
| Attack rate | 3 ticks; Rapid subtracts 1 (`player_ranged.rs2`). |
| Range | `param=attackrange,4`. Longrange `+2`, cap 10. |
| Ammo | The knife **is** the ammo. Each throw: 4/5 land on `npc_coord`, 1/5 deleted (`^dropammo_chance` = 5). |

Pickup after death, not during the kill. Leaving the pillar to grab knives
while KBD is up is how you take fire / ice freeze.

Re-wield if the worn slot emptied (`"That was your last one!"`):

```javascript
if (!sdk.findEquipmentItem(/mithril kni(fe|ves)/i)) {
    const stack = sdk.findInventoryItem(/mithril kni(fe|ves)/i);
    if (stack) await bot.equipItem(stack);
}
```

## Combat styles

Thrown weapons publish Accurate / Rapid / Longrange (`weapon_thrown_table`,
`combat_thrown.if`). Resolve from state — do not hardcode indices.

```javascript
function kbdThrownStyle(state) {
    const ranged = state.skills.find((s) => s.name === 'Ranged')?.baseLevel ?? 1;
    const defence = state.skills.find((s) => s.name === 'Defence')?.baseLevel ?? 1;
    const want =
        ranged < 99 ? 'Accurate' : defence < 99 ? 'Longrange' : 'Rapid';
    const style = state.combatStyle?.styles.find(
        (s) => s.type === want || s.name === want
    );
    if (!style) throw new Error(`No ${want} style (weapon=${state.combatStyle?.weaponName})`);
    return style;
}

const style = kbdThrownStyle(sdk.getState());
if (sdk.getState().combatStyle.currentStyle !== style.index) {
    await sdk.sendSetCombatStyle(style.index);
    await sdk.waitForCondition((s) => s.combatStyle?.currentStyle === style.index, 5_000);
}
```

XP (`give_combat_experience`): Accurate and Rapid are 4× ranged; Longrange
splits 2× ranged + 2× defence. Accurate also gives the +3 ranged accuracy
bonus; Rapid does not, it only swings faster.

## Prep

Video bar: 70+ Ranged for the safespot route (70 melee if someone is tanking —
we are not). 43 Prayer is nice for the **lure** and the lava-maze ladder, not
for a working safespot.

| Slot | Item | Notes |
|------|------|--------|
| Weapon | Mithril knives | Restack from bank when the trip stack is low. |
| Shield | Dragonfire shield | Duke Horacio after Dragon Slayer. **No antifire potion** in this revision. |
| Body / chaps / vambraces | Best available d'hide | Range bonus. Magic is useless (80 mage def). |
| Amulet | Glory (charged) | Teleport only at wilderness **≤ 30** (`z ≤ 3748` on the surface). Useless at the ladder. |
| Cape / boots | What you have | |

### Live 80+ range stack (Yanille, 2026-09-04)

All five already wear mith knives ×500, dragonfire shield, d'hide chaps,
dragon vambraces, adamant full helm. Combat tab is Accurate.

| Account | Range / Def | Body | Glory | Style now |
|---------|-------------|------|-------|-----------|
| fatpig | 99 / 99 | Dragonhide body | Uncharged glory + leather boots | **Rapid** |
| jacklove2 | 89 / 99 | — | — | Accurate → Rapid at 99 range |
| jacklove3 | 88 / 97 | — | — | Accurate → Longrange at 99 range → Rapid at 99 def |
| jacklove5 | 87 / 99 | Dragonhide body | — | Accurate → Rapid at 99 range |
| jacklove1 | 87 / 99 | — | — | Accurate → Rapid at 99 range |

Bank snapshots (stale vs the Jackthief handoff) had **no extra mith knives** and
no d'hide bodies for love1/2/3. Pack dumps MSB + 10k bronze arrows + the 180
sharks down to **12 sharks, 2 antipoison, 2 prayer pots**. Missing body/glory
is not a hard fail — walk south of wildy 30 instead of rubbing.

Inventory: mith knife stack (wielded counts), 12 sharks, 2 antipoison(3) — the
lever room is full of **poison spiders**. Teleport tabs do not beat glory-30.

Dragonfire without a shield is up to 65. With the shield, fiery max is 15
(0 if an antifire timer were active — it is not). Special breaths max 10
with the shield.

## Route (Ardougne lever)

`bot.walkTo` on the surface wildy scenic-routes through lava. Use `sdk.sendWalk`
hops. **Do not** walk Edgeville ditch for this job — pull the East Ardougne
wilderness lever (`wildinlever` at **(2561, 3311)**), land in the deserted keep,
slash the north web, then hop southwest on **x=3135** to the lesser-demon gate.

Mithril knives are not a slash weapon (`slash_checker` wants `slashattack_anim`
or a kitchen `knife`). Stand south of the web at **(3158, 3949)** (inside) or
north at **(3158, 3953)** (return). Never `sendWalk` onto **(3158, 3951)**.

Stay **z=3283** from Ardougne bank west until past Handelmort, then north to the
hut door **(2564, 3310)**. First pull shows a warning — click **“Yes please,
don't show this message again.”**

| Step | Tile | Loc / note |
|------|------|------------|
| Yanille / Ardougne bank | (2613, 3091) / (2655, 3283) | Pack sharks, then walk to the hut. |
| Ardy lever | **(2561, 3311)** | `wildinlever`. Lands at **(3154, 3924)**. |
| Keep web | (3158, 3951) | Kitchen knife use-on-loc. 50% slash fail. |
| Keep road | x=**3135**, z 3954 → 3865 | West of the keep fence. Do not drift into the members corridor (`x>=3148`, z 3895–3905). |
| Lesser-demon gate | (3008, 3849) / (3008, 3850) | Members double door `loc_1596` / `loc_1597`. |
| Lesser demons | (3014–3017, 3845–3852) | Protect melee while crossing. |
| Climb-down | **(3017, 3849)** | `loc_1765`. Script: `p_teleport(0_47_160_61_15)` → **(3069, 10255)**. |

Do **not** climb `loc_1767` at (3069, 3856). That is the greater-demon / black
dragon side of the dungeon (`p_teleport` to (3016, 10249)), not the KBD lever.

Underground after the KBD ladder (this **is** wilderness ~42):

| | |
|---|---|
| Land | (3069, 10255) |
| Lever in | `dragonkinginlever` **(3067, 10253)** — `Pull` |
| Poison spiders | Packed on (3067–3069, 10253–10259) |
| Climb-up if aborting | `loc_1766` (3069, 10256) → surface (3016, 3849) |

Lever message: `"You pull the lever..."` then `"...And teleport into the Dragon's lair."` Arrival: **(2717, 9802)** next to the exit lever.

The lava-maze dungeon is in `wilderness_zones` (underground overlay, PKers, keep-3).
The KBD lair map `m42_153` is **not** — no wilderness enter, `wilderness_level` 0.
SDK `inWilderness()` is surface-only (`z` 3520–6400) and is false in both caves;
gate hops on `z > 6400` yourself (`inKbdLair` / `inLavaMazeDungeon`).

## Lair

Map square (2688–2751, 9792–9855). Multiway. KBD is **not** aggressive until
you attack (`Aggressive: No`); huntmode `king_dragon` is line-of-sight AP
(dragonfire) once in combat.

| | |
|---|---|
| Spawn | **(2716, 9817)** — SW tile of a **size 5** NPC |
| Exit lever | `dragonkingoutlever` **(2717, 9801)** → dungeon (3067, 10254) |
| Respawn | 150 ticks (90s) |
| Ice spiders | West/north rim, e.g. (2690, 9807), (2693, 9816). Not the boss. |

Always drops: dragon bones **and** black dragonhide (`ai_queue3,king_dragon`).
Then a 128-table (rune longsword 10/128, addy plate 9/128, d med 1/128, …).

### Safespot

Server comment: KBD can attack from a distance **but can be safespotted**
(imgur refs in `king_black_dragon.rs2`). `ai_applayer2` fires far dragonfire
when `npc_range > 1` **and** hunt `check_vis=lineofsight`. A working spot
breaks walk-to-melee for the 5×5 body so it cannot `opplayer2`, and you still
have a 4-tile (6 Longrange) shot.

Video: lure to the **southwest pillar**, trap it between the rocks, range,
take no damage. Map pillars:

| Loc | Tile | |
|-----|------|---|
| Stalagmite `loc_542` | **(2707, 9818)** | West of spawn, same z — likely the SW pillar |
| Chests | (2707, 9817), (2709, 9812–9814) | Extra collision west/south of spawn |
| Stalagmite `loc_542` | (2719, 9802) | South, by the exit lever |

Photo of the video safespot: player immediately **west** of the yellow
stalagmite, KBD to the **east**. That maps to stand **(2706, 9818)** (one tile
west of loc_542) and lure **(2711, 9818)**. Spawn is 10 tiles east — knives
cannot hit from the pillar until KBD walks west and wedges.

Script: `bots/quests/kbd-range.ts`. Attack with `sendInteractNpc(..., { route: false })`
so the bot does not leave the tile. If you take melee on (2706, 9818), the
wedge failed — step out and re-lure.

## Kill loop

```javascript
const KBD = /^king black dragon$/i;
const KNIVES = /mithril kni(fe|ves)/i;
const LOOT = /^(dragon bones|black d'?hide|rune longsword|dragon med|adamant platebody|…)/i;

function inLair(p) {
    return p.worldX >= 2688 && p.worldX < 2752 && p.worldZ >= 9792 && p.worldZ < 9856;
}
function onSpot(p, spot) {
    return Math.max(Math.abs(p.worldX - spot.x), Math.abs(p.worldZ - spot.z)) <= 0;
}

// 1. On the pillar before spawn.
if (!onSpot(sdk.getState().player, KBD_SAFESPOT)) {
    await bot.walkTo(KBD_SAFESPOT.x, KBD_SAFESPOT.z, 0);
}

// 2. Attack from the tile. Do not chase.
const kbd = sdk.findNearbyNpc(KBD, { reachable: true });
if (kbd) {
    await bot.attack(kbd);
    await sdk.waitForCondition(
        (s) => !s.nearbyNpcs.some((n) => KBD.test(n.name) && (n.hp ?? 1) > 0),
        180_000
    );
}

// 3. Dead → knives first (they sit on npc_coord / the death tile), then loot.
const ground = await sdk.scanGroundItems();
const knives = ground.filter((i) => KNIVES.test(i.name)).sort((a, b) => a.distance - b.distance);
for (const stack of knives) await bot.pickupItem(stack);
if (!sdk.findEquipmentItem(KNIVES)) {
    const inv = sdk.findInventoryItem(KNIVES);
    if (inv) await bot.equipItem(inv);
}
const loot = (await sdk.scanGroundItems())
    .filter((i) => LOOT.test(i.name))
    .sort((a, b) => a.distance - b.distance);
for (const item of loot.slice(0, 8)) await bot.pickupItem(item);

// 4. Back on the pillar before the 150-tick respawn.
await bot.walkTo(KBD_SAFESPOT.x, KBD_SAFESPOT.z, 0);
```

Success line for a grind: KBD despawn **and** a knife (or bones) pickup that
tick — not “attack returned success”. `bot.attack` walking off the pillar is
a failure mode; prefer `sdk.sendInteractNpc` if porcelain pathfinds.

Frozen (`"You've been frozen!"` / `"You're frozen and can't move!"`): wait,
do not `sendWalk`. Freeze is 10 ticks from icy breath.

## If the safespot fails

Far fire (`npc_range > 1`): magic defence roll, fiery max 65 / 15 with shield.
Close: 1/3 fiery, 1/3 special (toxic / ice / shock), 1/3 melee (caps ~25).
Toxic can poison (8); ice freezes; shock −2 every stat except HP.

Protect Magic (`prayer` index 12, level 37) only for a bad lure. A working
safespot should idle with prayers off.

## Bank / abort

Full inventory or knives gone: pull the **exit** lever (2717, 9801), climb
`loc_1766`, hop **north-east** on x=3135 to the keep web, pull `wildoutlever`
**(3153, 3923)** back to Ardougne, bank there. Do not `bot.walkTo` from the
ladder. If HP is trash in the dungeon, food first — poison spiders will finish
a 4 HP abort.

## Script

`bun bots/quests/kbd-range.ts {name}` — do not combine with `FAST_KBD_RUNTIME_MODE`.
Prove one kill with the grind line `KBD dead` plus knife/bones pickup before
overnight. Point roster at that file when these five should leave fishing.
