# Wilderness Lever → Ardougne

Route: Edgeville ditch → north road → (optional spider gate) → slash keep web → pull lever.

## Critical rules

1. **Never `bot.walkTo` in the wilderness** — pathfinder routes back to safe areas (Edgeville bank loop) or east into deep wildy.
2. **Use `sdk.sendWalk` only** along `WILDY_TO_LEVER` waypoints in `travel-to-flax.ts`.
3. **Spider gate detour is narrow** — only when `z >= 3895 && z < 3906 && x < 3140` (at the gate fence, not at the `3135,3865` waypoint). The old `z >= 3850` check fired at `(3135,3865)` and ping-ponged east/west forever.
4. **Members-gate corridor** — `x >= 3148 && z 3895–3905` (e.g. `(3158,3902)`) is south of the fence, west of the gate. Walk **east** to `(3224,3904)`, open, walk north through. Never `sendWalk(3135,3954)` from here; that is north through the wall.
5. **Phase order**: north road to z≈3895 first, then spider gate / corridor, then web stand `(3158,3953)`. Rejoin x≈3135 only when still south of z≈3860.
6. **Pack before ditch**: inventory = slash weapon only (axe/sword/knife). Skip bank reopen if already packed at Edgeville.

## Waypoints (sendWalk)

```
3088,3525 → 3102,3610 → 3110,3700 → 3125,3790 → 3135,3865 → 3135,3895 → 3135,3954 → 3158,3953
```

Lever: `(3154,3924)`. Web: `(3158,3951)` — do not walk onto the web tile; stand at `(3158,3953)`.
