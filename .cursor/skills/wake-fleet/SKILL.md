---
name: wake-fleet
description: >-
  Wake idle rs-sdk fleet scripts and report bots that need a human or a
  different fix. Use when bots are idle, offline, AFK, unattended, have no
  controller, scripts were aborted, the fleet is down, or the user asks to
  wake, restart, or shepherd Jackpoo/jacklove/fatpig/jackthief/ABGARMY.
---

# Wake fleet

Keep the fleet moving: restart scripts that died while the browser stayed
logged in, and **tell the user** about anything a blind restart would make
worse.

Roster: **`bots/roster.json`** is the single source of truth for which bots
exist and what each one runs by default. `fleet-status.ts`, `fleet-launchd.ts`,
and `bots/watch-fleet.sh` all read it. Inspect it with
`bun .cursor/skills/wake-fleet/scripts/roster.ts`. Adding or reassigning a bot
is a one-file edit there — never hardcode a bot list in a script.

Temporary opt-outs: names in `.cursor/skills/wake-fleet/skip-bots.txt` classify as `paused` — never wake them.

## Do this every time

1. Classify the fleet from the **repo root** (`working_directory` = workspace path):

   ```bash
   bun .cursor/skills/wake-fleet/scripts/fleet-status.ts --pretty
   bun .cursor/skills/wake-fleet/scripts/fleet-status.ts
   ```

   The JSON script prints `summary.running` / `summary.wake` / `summary.intervene` / `summary.paused` and a `command` per bot. Trust it over improvising `ps`/`curl`.

2. **Leave `running` alone.** A live bun process already owns that character.

3. **Wake each `wake` bot through launchd.** Do not start long-running bot jobs as
   children of a Cursor shell: ending or aborting the task will terminate the
   whole process group. Install the per-bot supervisors once:

   ```bash
   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts install
   ```

   After installation, wake or restart one bot with:

   ```bash
   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts start BotName
   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts restart BotName
   ```

   `install` staggers the fleet by 4s. Do not steal a bot that gained a
   controller between classify and start.

4. **Do not wake `paused` bots.** `paused` = skip-bots.txt (leave alone, no banner). For most `intervene`, list them for the user (see Notify). Exception: idle **`zero_rate` grinders** (not `bursty`) — bounce with `fleet-launchd.ts restart`. Do not edit `bots/**` to unstick them in this pass unless the user asked for a script change.

5. After ~20s, re-run the status script. Confirm each wake now has a bun pid / controller. Anything still idle becomes intervene.

6. Reply with three lists: still running, woke, needs intervention. If you woke none and none need help, say the fleet is healthy.

## Wake rules

- Run **existing** scripts only. Preview-bot-scripts still applies: do not write, overwrite, or extend `bots/**/*.ts` here.
- Do not add recovery scaffolding, extra files, or a longer duration than the script already uses.
- Do not launch a second copy of a command that is already in `ps`.
- Do not `pkill` a live bun job to “refresh” it.
- Do not use `nohup ... &` from a Cursor shell for fleet jobs. `nohup` only
  ignores SIGHUP; task cancellation still kills those descendants.
- The browser is supposed to already be in-game. A wake attaches; if `fleet-status` said `wake`, that is enough.
- One controller per character. Last controller wins — never attach “just to look” in control mode.
- Inspect supervisor state with
  `bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts status`. Stop a bot
  with `... stop BotName`; this boots its launch agent out so KeepAlive does
  not immediately restart it.
- To change what a bot runs by default, edit `bots/roster.json` and re-run
  `fleet-launchd.ts install` (or `restart BotName`) so its plist is rewritten.
  Do not edit the roster to unstick a bot in a wake pass.

## Notify (intervention)

Lead the user-facing reply with **Needs intervention** when that list is non-empty. One bullet per bot: name, tile, and why a restart is the wrong move.

Typical reasons the classifier already flags:

- Client `dead` / `inGame: false` — need a browser or lite login, not another bun job
- Stale ticks (>8s) — client tab frozen
- Musa Point ship `(2951,3142)` — gangplank/path loop
- Same grind.log line 6+ times, pathfinding burst, recovery `×20+`
- Waiting at Ardougne bank for Fatpig with no food
- Controller attached but no matching bun process (other agent or stale SDK)

If this pass is unattended (`/loop` or similar) and `intervene` is non-empty, also fire a macOS banner:

```bash
osascript -e 'display notification "<bot>: <short reason>" with title "rs-sdk fleet"'
```

One notification; pack multiple bots into the body if needed. Still print the full list in chat.

## Fleet shepherd (automatic, no Cursor session)

`fleet-launchd install` also installs `com.rs-sdk.caffeinate` (`caffeinate -dims`) so the display and machine stay awake. Reinstall just that agent with `bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts caffeinate`. Remove it with a full `uninstall` (no bot name).

`fleet-launchd install` also installs `com.rs-sdk.fleet-shepherd` (every 10 minutes):

```bash
bun .cursor/skills/wake-fleet/scripts/fleet-shepherd.ts   # one cycle manually
```

The shepherd classifies via `fleet-status.ts`, starts `wake` bots through `fleet-launchd start`, **`fleet-launchd restart`s `zero_rate` grinders** (any roster job except `bursty` mules — they already have a controller, so `start` is a no-op), **expires `capped` once the rolling hour no longer exceeds 4 restarts** (otherwise Jackpoo miners stay dead forever), caps restarts at **4/hour** per bot (then stops the agent and notifies), and fires one macOS banner per cycle for other `intervene` bots. Restartable script stops exit with code **70** so per-bot launchd `KeepAlive` restarts within ~30s.

## Production rates (`fleet-report.ts`)

Heartbeats land in `bots/{name}/heartbeat.log` (JSONL, 5 min, rotated). One command:

```bash
bun .cursor/skills/wake-fleet/scripts/fleet-report.ts rates [--window 6h]
bun .cursor/skills/wake-fleet/scripts/fleet-report.ts supply
bun .cursor/skills/wake-fleet/scripts/fleet-report.ts flags
```

`fleet-status.ts` flags `zero_rate` when a running bot has no xp/coins delta for 30 minutes (90 for roster `bursty: true` mules). Reassign bots by editing `bots/roster.json` only.

## Loop (manual / editor-bound)

To keep shepherding: `/loop 5m wake the fleet` (or `/loop 10m`). Each tick is a full classify → wake → notify. Do not start a second loop if one is already running.

## How the restart command is chosen

Never guessed from log text. Three sources, most-trusted first:

1. **Live `argv`** — if a bun process owns the bot, that process's own command line is what it is doing. Ground truth.
2. **Recorded assignment** (`bots/{name}/assignment.json`) — written by
   `runScript`, by `ActivitySession` when `grindLogPath` is set, whenever
   `fleet-status` observes a live bun process, and whenever `fleet-launchd`
   starts one. This is how a bot that just died gets restarted onto the job
   it was actually doing.
3. **Roster default** (`bots/roster.json`) — used only when a bot has no process and no recorded assignment.

Each bot's `commandSource` in the JSON output says which of `live` /
`assignment` / `roster` was used. A `roster` source on a bot you expected to
have history means its assignment cache was never written — worth a look, but
the roster default is still a safe restart.

Grind logs are still read, but only for the intervene heuristics below (looping
lines, recovery spam, pathfinding bursts) — never to identify the job.

## Do not regress

These already bit this fleet. Do not reintroduce them:

- A second bot list (`FLEET`, `DEFAULT_CMD`, a name table in the skill, hardcoded `add_tower` in `watch-fleet.sh`). Edit `bots/roster.json` instead.
- `inferCommand()` / matching grind-log phrases to pick a script. Log text is a lie when the bot last ran something else; `commandSource` exists so you can see `live` vs `assignment` vs `roster`.
- Starting grind jobs as children of a Cursor shell (`bun bots/...`, `nohup`, `&`). Launchd only.
- `readFileSync` on `bots/*/grind.log` (jacklove1's file has exceeded 1 GB). `grindTail` is a bounded seek; keep it that way. Caps: `sdk/grind-log.ts` on write, plus `bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts rotate` (6-hour launchd job).
- Copying a shared route into `bots/{name}/` to "fix one bot." Change `bots/quests/` and point the roster at it. Overnight loops use `ActivitySession` (`LOG`/`WARN`/`ERROR`); see `.cursor/skills/grind-scripts/SKILL.md`.
- Restoring `.gitignore` `bots/*/`. Track scripts; ignore only `bot.env`, `*.log`, `*.pid`, `assignment.json`.

After editing `fleet-status.ts` or `fleet-launchd.ts`, confirm `command` for running bots still matches `pgrep -fl 'bun bots/'`, and that installed plists still match `roster.json` script+args.
