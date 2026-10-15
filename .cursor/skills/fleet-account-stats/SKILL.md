---
name: fleet-account-stats
description: >-
  Snapshot live combat and skill levels for every roster account and render
  them as a Cursor canvas table. Use when the user asks for account stats,
  skill levels, combat levels, hiscores, a stats table, who is 99, who is
  90+ attack, whether a job matches combat stats, fleet performance that
  needs levels, reassignment by skill, or to regenerate the fleet
  account-stats canvas. Never invert heartbeat XP into a level.
---

# Fleet account stats

Dump every roster bot's combat / skill levels (observe-only) and put them
in a canvas table. Do not paste a 46×19 markdown table in chat.

## Do this every time

1. Read `~/.cursor/skills-cursor/canvas/SKILL.md` and write the canvas
   there (`.canvas.tsx` under the workspace `canvases/` directory). Import
   only from `cursor/canvas`.
2. From the **repo root**, dump live stats:

   ```bash
   bun .cursor/skills/fleet-account-stats/scripts/dump-skills.ts
   ```

   JSON on stdout. Names come from `roster.ts` — do not paste a second bot
   list. Redirect stderr if SDK logout noise buries the JSON.
3. Write `[fleet-account-stats](/Users/<user>/.cursor/projects/<workspace>/canvases/fleet-account-stats.canvas.tsx)`
   (absolute path, markdown link). Embed the dump inline — no `fetch()`.
4. Chat reply: one-line highs (max combat / total, 99 clusters), then the
   canvas link. Do not dump the full table in the transcript.

## Dump rules

- The script connects as **`observe`**. Never `control`, never
  `autoLaunchBrowser`, never `bun sdk/cli.ts` in a way that takes the
  controller. Last controller wins and grind jobs die.
- Do not use gateway `GET /gateway/state/:bot` on fly.dev — that path hangs.
  The dump uses the observe WebSocket (same as `sdk/cli.ts` fallback).
- Skip placeholder skills `Stat18` / `Stat19` (always 1). Total is the sum
  of named skills.
- Offline rows keep `error` set; still list them in the canvas (omit empty
  sections, not empty rows that have a name + error).
- Concurrency default 6 (`--concurrency N`, max 16).

## Canvas shape

- Title the finding (who is highest, what the clusters are), not "Stats".
- Summary `Stat`s: account count, max combat, max total, a 99 count that
  matters (often Thieving or Fishing).
- `Table`: Account, Cmb, Tot, then short skill headers (Atk, Str, Def, HP,
  Rng, Pry, Mag, Cook, WC, Flet, Fish, FM, Craft, Smith, Mine, Herb, Agil,
  Thiev, RC). Sticky header, striped, numbers right-aligned.
- Filter/sort with `useCanvasState` (`all` / roster `view`, sort by total /
  combat / name). Group using each row's `view` (`fleet`, `loves`, `army`),
  not a hardcoded name table.
- Caption: live observe snapshot, timestamp, roster size.
- Bold 99s; dim 1s. No gradients, emojis, or box-shadows.

## Do not

- Wake, restart, or steal a running grind to read skills.
- `readFileSync` whole `grind.log` files for XP.
- Invent levels from heartbeat XP unless observe failed **and** you label
  the row as heartbeat-derived.
