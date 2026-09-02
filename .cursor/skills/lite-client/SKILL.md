---
name: lite-client
description: >-
  Move rs-sdk bot accounts onto the headless lite client (no Chrome) or back
  to a browser tab. Use when the user asks to run bots headless, switch to
  lite, leave lite, cut Chrome CPU, or move jacklove/Jackpoo/fatpig/jackthief
  on or off the lite client, including ABGARMY.
---

# Lite client

The lite client is a protocol-only game session: same gateway the grind
scripts already attach to, no Chromium, no 3D rasterizer. It is the cheap
way to keep an account logged in. Headless Chrome is not — it still paints.

Lite **is** the login. Grind launchd only runs the controller. If lite exits,
the character logs out.

Never start lite (or grind) as a child of a Cursor shell. Task cancel kills
the process group. Always go through launchd:

```bash
bun .cursor/skills/lite-client/scripts/lite-launchd.ts to-lite jacklove1 jacklove2
bun .cursor/skills/lite-client/scripts/lite-launchd.ts to-chrome jacklove1
bun .cursor/skills/lite-client/scripts/lite-launchd.ts status
bun .cursor/skills/lite-client/scripts/lite-launchd.ts stop jacklove1
```

Working directory for the runner is `server/webclient` (the `#/*` import map).
The script sets that. Do not `cd` and `bun src/lite/runner.ts` from chat.

If lite exits immediately with `Cannot find package 'fflate'`, install webclient
deps once: `bun install --cwd server/webclient`.

## Move to lite

1. Confirm `bots/{name}/bot.env` exists.
2. `to-lite` the named bots (staggers 4s). It starts `com.rs-sdk.lite.{name}`,
   waits until the gateway shows `inGame`, restarts the grind launch agent
   (`com.rs-sdk.bot.{name}`), then closes matching Chrome tabs.
3. Same account cannot be in Chrome and lite — the second login kicks the first.
4. Grind scripts that construct `BotSDK` with `autoLaunchBrowser: true` will
   reopen Chrome if lite dies. Prefer `false` on bots you keep on lite.

## Move to Chrome

1. `to-chrome` the named bots. It stops lite, opens the bot client URL, waits
   for `inGame`, restarts grind.
2. Do not print the client URL (it contains the password).

## Afterward

Re-run `bun .cursor/skills/wake-fleet/scripts/fleet-status.ts --pretty`.
Lite bots should be `running` with `inGame true`. `client logged out` means
lite failed to stay up — check `~/Library/Logs/rs-sdk-fleet/lite-{name}.err.log`.
Bot names come from `bots/roster.json`; do not maintain a separate lite roster.

Leave bots the user still wants to watch in Chrome. Mix is fine across accounts.
