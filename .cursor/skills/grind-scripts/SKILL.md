---
name: grind-scripts
description: >-
  Author overnight rs-sdk grind loops in bots/quests with ActivitySession,
  shared movement/tiles, roster argv, and LOG/WARN/ERROR grind lines. Use when
  writing or changing thieving, fishing, mining, or any long-running bot
  route; when copying a script per character; when adding walkNear or a
  private grind.log writer; or when a fleet job should survive unattended.
---

# Grind scripts

Overnight / fleet loops are shared modules plus roster identity, not
per-character 2k-line copies.

## Default shape

1. Put the loop in `bots/quests/{job}.ts`.
2. Point `bots/roster.json` at that file with `args: ["BotName"]` (and flags).
3. Per-character entry is at most:

```typescript
process.argv[2] = 'ABGARMY01';
await import('../quests/thieving-route.ts');
```

4. Wrap the loop in `ActivitySession` with `grindLogPath: bots/{name}/grind.log`.
5. `session.log` / `noteFailure` / `setPhase` / `recover` / `stop` — every
   grind line carries `LOG`, `WARN`, or `ERROR` (Ghostty color). Silent
   `appendFileSync` writers make the army panes look identical.
6. After roster edits: `bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts restart BotName`.

## Do

- Import tiles from `bots/quests/tiles.ts` and walk/door/gangplank from `bots/quests/movement.ts` (or SDK porcelain).
- Let `ActivitySession` record `assignment.json` (`grindLogPath` set). `runScript` does the same.
- Cap logs via `appendGrindLog` if you are not going through `session.log`.
- Start/stop the job with launchd, not a Cursor-shell `bun`.

## Do not

- Copy `thieving-route.ts` or `fishing-route.ts` into `bots/JackpooN/` to fix one account. Edit the shared file; gate extras on `username` or argv (`SHOP_ARROWS` is the pattern).
- Guess the running job from `grind.log` text. That is `inferCommand()`, deleted on purpose.
- `readFileSync` a whole `grind.log`.
- Restore `.gitignore` `bots/*/`.
- Add a second bot list (`FLEET`, `DEFAULT_CMD`, hardcoded `add_tower`).

Existing canaries: `bots/quests/thieving-route.ts`, `fishing-route.ts`, `mining-guild.ts`, `bots/Jackpoo1/bowstrings.ts`.

## Prove the loop, then patch the hop

Do not call an overnight job fixed because it "attempts" the next obstacle, pit
climb is faster, or XP dribbles from deaths. Pick **one grind line** that can
only fire on the real success (for wilderness agility: `Wildy lap N` plus 4989
XP or `"You reach the top."`). Watch that line with a **bounded grind tail**,
`bun sdk/cli.ts {name}` (position, HP, nearby locs, recent messages), and
`fleet-status.ts`. Restart via `fleet-launchd.ts`, never a Cursor-shell `bun`.

Read the **server script** for the activity before inventing recovery:
obstacle order, fail coords, loc ids, varps, XP. Map `level` / gnome facts do
not copy onto other courses (wilderness log is plane 0; loc_1759 is the pit,
not a way down to the log).

In the wilderness, `bot.walkTo` / `bot.interactLoc` pathfind around lava,
through fences, and into void. Use `sdk.sendWalk` in **2–3 tile hops** that
cannot go the wrong way, and `sdk.sendInteractLoc`. A long `sendWalk` to a
sensible tile will still take the scenic route; if the trail goes north around
the course, the hop is too far. Same class of no-op: Ardougne **Handelmort
yard** (`leaveHandelmortMansion`) — `walkNear`/`walkTo` to the east street
does not move; hop `sdk.sendWalk` toward `HANDELMORT_SAFE_EAST`.

`inferStep` from (x,z) is for **resume and pit-exit only**. Running it after
every stall skips varp (stones → log while falling, pipe → log at Mage Arena
z≥3960, rocks from the pit-exit trees). Fail slides and forcemoves are not
success — wait for XP or the exact tile the server uses (`x <= x0-7` on the
wildy log, not −4).

When empty + low HP on a dangerous loop, **leave and bank** (then restart the
lap from the first obstacle). Speeding up the death is not a fix. Course-specific
notes: `learnings/agility.md`.
