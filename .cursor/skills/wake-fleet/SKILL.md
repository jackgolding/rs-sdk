---
name: wake-fleet
description: >-
  Wake idle rs-sdk fleet scripts and report bots that need a human or a
  different fix. Use when bots are idle, offline, AFK, unattended, have no
  controller, scripts were aborted, the fleet is down, gateway state is stale,
  fleet-scale login conflicts (lite vs Chrome vs SDK), or the user asks to
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

## Gateway & fleet scale

Full reference: [`learnings/gateway-fleet.md`](../../learnings/gateway-fleet.md).

Per account: **one game client** (lite or Chrome) + **at most one SDK controller**. Last controller wins. `fleet-status` coords come from the game client's gateway snapshot — not from a Chrome tab if a zombie script holds stale state.

Before reporting position, login, or routing a bot:

1. **Trust the operator** if they see the account in-game.
2. Check lite **out.log** for `'name' logged into` and `lite-launchd.ts status`.
3. Check `stateAge` in `fleet-status` (stale if >8s; hours-old = frozen lie). `inGame: true` alone is not enough.
4. Confirm with `bun sdk/cli.ts Name --observe` — tick should advance, not stay at ~6.

Fleet bring-up at Yanille: see [`learnings/gateway-fleet.md`](../../learnings/gateway-fleet.md) § Fleet bring-up playbook.

**Manual Chrome accounts:** `lite-launchd.ts stop Name`, kill any converge/controller on that bot, add to `skip-bots.txt` or script `--except`. Do not `to-lite` them.

**Do not run multiple `converge-and-accept-trade.ts` processes** without disjoint `--except` lists — they preempt each other and orphan controllers. Prefer one accept-only loop for the Yanille stack.

## Do this every time

1. Classify the fleet from the **repo root** (`working_directory` = workspace path):

   ```bash
   bun .cursor/skills/wake-fleet/scripts/fleet-status.ts --pretty
   bun .cursor/skills/wake-fleet/scripts/fleet-status.ts
   ```

   The first line is the headline: `N producing, M not producing: …`. **Lead every reply with that headline.** Never describe the fleet as healthy while `notProducing` is non-empty. Trust `kind` / `check` / `reason` over `ps` or `curl`.

2. **Leave `producing` alone.** One verdict per bot, first match wins: `paused`, `needs-client`, `capped`, `churning`, `needs-supplies`, `foreign-owner`, `alive-not-producing`, `producing`, `finished`, `restartable`.

3. **Start `restartable` bots, and restart `alive-not-producing` bots, through launchd.** Do not start long-running bot jobs as children of a Cursor shell. Do not start `capped`, `finished`, `foreign-owner`, `churning`, `needs-supplies`, or `needs-client` — report those.

   ```bash
   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts install
   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts start BotName --verify
   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts restart BotName --verify
   ```

   Pass every name in one command. Do not `sleep` between bots. `--verify` waits for an effect (default 10 minutes). A loaded agent whose last exit was 0 is finished; pass `--force` to kickstart it anyway.

   **Stop and switch drain first.** When the user asks to stop a bot or move
   it to a different job, the grind banks before exiting so the next job
   starts from a bank instead of mid-route (safe-stop convention — stops end
   at banks, starts begin at banks, handoff via `park.json` + declared legs
   in `bots/quests/safe-stops.ts`):

   ```bash
   # Stop: SIGTERMs the grind, waits for the bank park (holds the shepherd
   # so nothing restarts it mid-drain). Plain `stop` stays abrupt — only
   # for wedged drains.
   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts stop BotName --drain
   # Switch jobs: edit bots/roster.json first, then drain + start the new job.
   bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts switch BotName --verify
   ```

   Never hand-stop a bot while the shepherd is mid-cycle without holding it
   (`stop --drain` / `switch` do this automatically) — a shepherd bootout
   landing during a drain reads as a second SIGTERM and kills the drain
   (the old quest-mule died this way). One driver at a time: if another
   agent session is working the fleet, coordinate so only one session
   issues stops / switches / restarts — concurrent drivers steal the same
   controllers and each other's drains read as failures.

4. **Do not wake `paused` bots.** `paused` = skip-bots.txt or a live food-hub lock.

5. **Only bots printed `verified` may be called fixed.** Anything else goes under "needs intervention" with the printed reason. A bun pid, `bun yes`, or "the process is up" is not evidence of a fix and must not be reported as woke or working.

6. Reply with the headline, then who is producing and who is not (kind, check, reason). If `notProducing` is empty, the fleet is producing.

## Wake rules

- Run **existing** scripts only. Preview-bot-scripts still applies: do not write, overwrite, or extend `bots/**/*.ts` here.
- Do not add recovery scaffolding, extra files, or a longer duration than the script already uses.
- Do not launch a second copy of a command that is already in `ps`.
- Do not `pkill` a live bun job to “refresh” it.
- Do not use `nohup ... &` from a Cursor shell for fleet jobs. `nohup` only
  ignores SIGHUP; task cancellation still kills those descendants.
- The browser is supposed to already be in-game. A start attaches; `restartable` means the client is in game and no owner is live.
- One controller per character. Last controller wins — never attach “just to look” in control mode.
- Inspect supervisor state with
  `bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts status`. Stop a bot
  with `... stop BotName`; this boots its launch agent out so KeepAlive does
  not immediately restart it.
- To change what a bot runs by default, edit `bots/roster.json` and re-run
  `fleet-launchd.ts install` (or `restart BotName`) so its plist is rewritten.
  Do not edit the roster to unstick a bot in a wake pass.

## Notify (intervention)

Lead the user-facing reply with the headline, then **Needs intervention** when `notProducing` is non-empty. One bullet per bot: name, kind, check, and the measured reason.

Typical reasons the classifier already flags:

- `needs-client` / `logged_out` or `no_live_state` — browser or lite login, not another bun job
- `needs-supplies` — missing kit or a restock; a restart will not create the item
- `churning` — more than 3 relaunches in the last hour; launchd is already restarting it
- `capped` — restart budget spent; leave it stopped until the hour rolls
- `foreign-owner` — a process the shepherd did not start holds the controller
- `finished` — clean exit 0; do not kickstart unless the operator passes `--force`
- `alive-not-producing` — process is up but there is no effect, no controller, or the snapshot timer went silent

If this pass is unattended (`/loop` or similar) and `intervene` is non-empty, also fire a macOS banner:

```bash
osascript -e 'display notification "<bot>: <short reason>" with title "rs-sdk fleet"'
```

One notification; pack multiple bots into the body if needed. Still print the full list in chat.

## Fleet shepherd (automatic, no Cursor session)

`fleet-launchd install` does **not** install caffeinate. Opt in with `bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts caffeinate` (`caffeinate -dims`). Remove it with a full `uninstall` (no bot name).

`fleet-launchd install` also installs `com.rs-sdk.fleet-shepherd` (every 10 minutes):

```bash
bun .cursor/skills/wake-fleet/scripts/fleet-shepherd.ts   # one cycle manually
```

`fleet-verify-report.ts` is a separate read-only launchd job (`com.rs-sdk.fleet-verify`, every 30 minutes). It appends a verdict snapshot and can notify. It does not restart bots and it is not a coding agent. Install it with `bun .cursor/skills/wake-fleet/scripts/fleet-verify-report.ts install`. Shepherd remains the only unattended restarter.

The shepherd classifies via `fleet-status.ts`, then plans one action per bot. It starts `restartable` bots only when `canStart` (one more start still fits in 4/hour) and otherwise marks them capped without stopping a bot it just started. A capped bot is started once when the budget allows. An `alive-not-producing` bot with a supervised owner is restarted at most once per episode, then only notified until it is producing again. `foreign-owner`, `finished`, `churning`, `needs-supplies`, and `needs-client` get no launchd action. Notifications use stable codes and re-fire every 2 hours while the condition holds. `woke` lists only starts that survived the cycle. Restartable script stops (`script_error`, `recovery_exhausted`) exit with code **70** so per-bot launchd `KeepAlive` restarts within ~30s.

## Production rates (`fleet-report.ts`)

Heartbeats land in `bots/{name}/heartbeat.log` (JSONL, 5 min, rotated). One command:

```bash
bun .cursor/skills/wake-fleet/scripts/fleet-report.ts rates [--window 6h]
bun .cursor/skills/wake-fleet/scripts/fleet-report.ts supply
bun .cursor/skills/wake-fleet/scripts/fleet-report.ts flags
```

A bot is not producing when no effect (XP, coins, inventory, bank, shop, or trade) has been seen within `noEffectMinutes` (roster override, else 90 when `bursty`, else 15). Reassign bots by editing `bots/roster.json` only.

Do not turn heartbeat `xp` into a skill level. This world is not OSRS.
`fleet-status` JSON `levels` (and the pretty `levels` column) is the client
`baseLevel` from the newest heartbeat. Use that, a grind `Atk 99` line, or
`bun .cursor/skills/fleet-account-stats/scripts/dump-skills.ts` (observe).
XP in a status row is a **rate**, not a level. Snapshots without `levels`
are old — say so; do not invert XP.

## Loop (manual / editor-bound)

To keep shepherding: `/loop 5m wake the fleet` (or `/loop 10m`). Each tick is a full classify → wake → notify. Do not start a second loop if one is already running.

## How the restart command is chosen

The roster always wins. `restartCommand` in `fleet-status` is the roster job, and `fleet-launchd start|restart` runs that job. A live or recorded command that differs is `drift`: it is shown on the row and is not what a restart runs.

Ownership is written by `BotSDK.connect` when `connectionMode` is `control` (`bots/{name}/assignment.json`: pid, argv, command, startedAt, `source: "connect"`). That file records who holds the controller. It is not a restart source. A name that appears only in another process's `--except` argv is not that bot's owner.

Grind logs and `events.log` are read for supply, repeat, and recovery detectors — never to identify the job. Do not bring back `resolveCommand()` or `inferCommand()`.

## Do not regress

These already bit this fleet. Do not reintroduce them:

- A second bot list (`FLEET`, `DEFAULT_CMD`, a name table in the skill, hardcoded `add_tower` in `watch-fleet.sh`). Edit `bots/roster.json` instead.
- `inferCommand()` / `resolveCommand()` / matching grind-log phrases or argv text to pick a script or an owner. The roster job is the restart. Drift is reported, not resumed. Ownership is the control connection's own record.
- Starting grind jobs as children of a Cursor shell (`bun bots/...`, `nohup`, `&`). Launchd only.
- Counting `fleet-launchd start` as a restart when the agent was already loaded with a live pid (or loaded-dead without `kickstart`). That filled the 4/hour cap and `stop`ped the fleet.
- `readFileSync` on `bots/*/grind.log` (jacklove1's file has exceeded 1 GB). `grindTail` is a bounded seek; keep it that way. Caps: `sdk/grind-log.ts` on write, plus `bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts rotate` (6-hour launchd job).
- Copying a shared route into `bots/{name}/` to "fix one bot." Change `bots/quests/` and point the roster at it. Overnight loops use `ActivitySession` (`LOG`/`WARN`/`ERROR`); see `.cursor/skills/grind-scripts/SKILL.md`.
- Restoring `.gitignore` `bots/*/`. Track scripts; ignore only `bot.env`, `*.log`, `*.pid`, `assignment.json`.

After editing `fleet-status.ts` or `fleet-launchd.ts`, confirm `restartCommand` matches the roster and that installed plists still match `roster.json` script+args. Do not treat a live pid as proof the bot is producing.
