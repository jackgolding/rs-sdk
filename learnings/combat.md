# Combat

Successful patterns for combat training.

## Attacking NPCs

Use `bot.attack()` for cleaner code, or raw SDK for more control:

```typescript
// Porcelain method (recommended)
const attack = await bot.attack(/cow/i);
if (!attack.success) console.warn(attack.reason, attack.message);

// Raw SDK dispatch (observe combat state afterwards)
const state = sdk.getState();
const npc = state?.nearbyNpcs.find(n => /cow/i.test(n.name));
const attackOpt = npc?.optionsWithIndex.find(o => /attack/i.test(o.text));
if (npc && attackOpt) {
    await sdk.sendInteractNpc(npc.index, attackOpt.opIndex);
    await sdk.waitForCondition(s => s.player?.combat.inCombat === true, 5_000);
}
```

## Combat Style Cycling

Combat-style indices depend on the equipped weapon the SDK reads
the table from the combat tab the server installed, so resolve indices from state

```typescript
const targetSkill = 'Defence';
// A controlled style lists every skill it trains, so match against trainsSkills.
const style = sdk.getState()?.combatStyle?.styles.find(
    candidate => candidate.trainsSkills.includes(targetSkill),
);
if (!style) {
    throw new Error(`No ${targetSkill} style is available for the equipped weapon`);
}
await sdk.sendSetCombatStyle(style.index);
await sdk.waitForCondition(
    state => state.combatStyle?.currentStyle === style.index,
    5_000,
);
```

## Checking Combat State

```typescript
const state = sdk.getState();
const inCombat = state?.player?.combat.inCombat ?? false;

// Animation is a useful heuristic, but is not specific to combat.
const isAnimating = (state?.player?.animId ?? -1) !== -1;
```

## Safe Training Locations

| Location | Coordinates | Targets | Notes |
|----------|-------------|---------|-------|
| Lumbridge cows | (3253, 3290) | Cows | Safe, good for all levels. South gate at (3253, 3266) |
| Lumbridge goblins | (3252, 3230) | Goblins, rats | Mixed enemies. Cluster runs NE from here — nothing at the old (3240, 3220) waypoint |
| Lumbridge chickens | (3237, 3295) | Chickens | Very safe, feathers drop |
| Al Kharid warriors | ~(3293, 3170) | `Al-Kharid warrior` (lvl 9) | Faster XP, kebabs nearby for food, can hit hard via multicombat vs low combat levels. |

## Cow Field Details (Proven from 200+ kills)

The cow field is fenced with a gate on the south side:
- **Field center**: ~(3253, 3290)
- **South gate position**: (3253, 3266)
- **Inside cow pen**: x between 3242-3265, z between 3255-3298

```typescript
function isInsideCowPen(x, z) {
    return x >= 3242 && x <= 3265 && z >= 3255 && z <= 3298;
}
```

## Opening Gates

Cow field and chicken coop have fenced gates:

```typescript
// Check for gate blocking path
const gate = sdk.getState()?.nearbyLocs.find(l => /gate/i.test(l.name));
if (gate) {
    const openOpt = gate.optionsWithIndex.find(o => /^open$/i.test(o.text));
    if (openOpt) {
        await bot.openDoor(gate);
    }
}
```

## Finding New Targets

After killing an NPC, find the next one quickly:

```typescript
async function findTarget(pattern) {
    const state = sdk.getState();
    if (!state) return null;

    return state.nearbyNpcs
        .filter(n => pattern.test(n.name))
        .filter(n => n.optionsWithIndex.some(o => /attack/i.test(o.text)))
        .sort((a, b) => a.distance - b.distance)[0] ?? null;
}
```

## Looting Ground Items

**CRITICAL**: Use `sdk.scanGroundItems()` NOT `state.nearbyLocs` for dropped items!

```typescript
// WRONG - nearbyLocs is for static objects (trees, rocks, etc.)
const wrongLoot = sdk.getState()?.nearbyLocs.filter(i => /hide/i.test(i.name));  // Won't work!

// CORRECT - scanGroundItems() for drops
const groundItems = await sdk.scanGroundItems();
const loot = groundItems.filter(i => /hide|bones|coins/i.test(i.name));
```

### Limit Pickups Per Loop

Pick up a few items (e.g. 3), then return to combat. Prevents getting stuck in infinite loot loops:

```typescript
const MAX_PICKUPS = 3;
const groundItems = await sdk.scanGroundItems();
const loot = groundItems
    .filter(i => /hide|bones/i.test(i.name))
    .filter(i => i.distance < 5)
    .slice(0, MAX_PICKUPS);

for (const item of loot) {
    await bot.pickupItem(item);
    await new Promise(r => setTimeout(r, 500));
}
// Back to combat
```

## Error Handling for Long Runs (Critical!)

Timeouts and errors are frequent in crowded areas. Wrap attacks in try/catch:

```typescript
// This pattern enabled consistent 10-minute runs
try {
    await bot.attack(/cow/i);
} catch (err) {
    console.log(`Attack timed out, trying next cow`);
    continue;  // Don't crash - just find another target
}
```

### Common Messages and Handling

| Message | Meaning | Response |
|---------|---------|----------|
| "I'm already under attack" | Crowded area, NPC in combat | Find different target |
| "I can't reach that!" | Obstacle or fence | Move closer, check gates |
| Attack timeout | Target died/moved | Try next NPC |

### State Validation

Browser glitches sometimes return invalid positions. Validate state before acting:

```typescript
const player = sdk.getState()?.player;
if (!player || player.worldX === 0 || player.worldZ === 0) {
    console.log('Invalid state - waiting for sync');
    await new Promise(r => setTimeout(r, 2000));
    continue;
}

// Also catch impossible position changes (>500 tiles = glitch)
if (Math.abs(player.worldX - lastX) > 500) {
    console.log('Position glitch detected, skipping action');
    continue;
}
```

## Auto-Train Lowest Combat Stat

For balanced progression, automatically train whichever stat is lowest:

```typescript
function getLowestCombatStat(state) {
    const skills = state.skills;
    const atk = skills.find(s => s.name === 'Attack')?.baseLevel ?? 1;
    const str = skills.find(s => s.name === 'Strength')?.baseLevel ?? 1;
    const def = skills.find(s => s.name === 'Defence')?.baseLevel ?? 1;

    if (def <= atk && def <= str) return 'Defence';
    if (str <= atk) return 'Strength';
    return 'Attack';
}

const state = sdk.getState();
if (!state) throw new Error('No world state');
const stat = getLowestCombatStat(state);
const style = state.combatStyle?.styles.find(option => option.trainsSkills.includes(stat));
if (!style) throw new Error(`No style trains ${stat} with the equipped weapon`);
await sdk.sendSetCombatStyle(style.index);
console.log(`Training ${stat} with ${style.name}`);
```

This pattern enabled balanced 60+ in all melee stats.

## Player attack range

Hard cap is **10 tiles**. Nothing a player can fire goes further. Source:
`player_attackrange` in `server/content/scripts/skill_combat/scripts/player/player_combat.rs2`
(`min(..., 10)`), and click-cast spells use the engine default `apRange` of 10.

Weapon range comes from the item `attackrange` param. Longrange style adds +2,
still capped at 10. Autocast Magic ignores the weapon and always returns 10.

The **magic longbow special is not extra range**. A normal magic longbow shot
is already 10. The spec is Powershot: guaranteed hit (no accuracy roll), +10
effective Ranged for max hit, 35% energy.

| Attack | Tiles | Longrange |
|--------|-------|-----------|
| Melee | 1 | — |
| Halberd / polearm | 2 | — |
| Darts | 3 | 5 |
| Knives / thrown axes | 4 | 6 |
| Javelins | 5 | 7 |
| Shortbows (incl. magic shortbow), crossbow | 7 | 9 |
| Longbows (incl. magic longbow), ogre bow | **10** | **10** (already capped) |
| Magic (autocast or click-cast) | **10** | — |

KBD mith-knife safespot (Accurate → Longrange → Rapid, loot knives after death): [`kbd.md`](kbd.md).

### Magic longbow vs magic shortbow

Both require 50 Ranged and have +69 range attack.

| | Magic longbow | Magic shortbow |
|---|---|---|
| Attack range | 10 (the cap) | 7 (9 on Longrange) |
| Attack speed | 6 | 4 (default shortbow) |
| Special (35% energy) | Powershot — one guaranteed hit, +10 Ranged | Snapshot — two arrows, needs 2 ammo, +10 Ranged, 43% accuracy bonus |

Use the shortbow for DPS (speed + two-hit spec). Use any longbow, or Magic,
when you need the 10-tile window. Config: `server/content/scripts/skill_combat/configs/ranged/bows.obj`.
Specs: `pvm_magic_longbow.rs2` / `pvm_magic_shortbow.rs2`.
