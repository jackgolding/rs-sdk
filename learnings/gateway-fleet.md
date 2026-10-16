# Gateway & fleet scale

How rs-sdk keeps many accounts logged in, what `fleet-status` actually measures,
and why mixing lite, Chrome, and batch scripts breaks at ~40+ bots.

## Three layers per account

| Layer | What it is | Examples |
|-------|------------|----------|
| **Game client** | The real login; publishes world state every tick | lite runner, Chrome tab |
| **SDK controller** | Script attachment for actions | `converge-and-accept-trade.ts`, grind routes |
| **Observer** | Read-only SDK (chat CLI, `sdk/cli.ts --observe`) | Does not steal control |

Gateway rules (`server/gateway/gateway.ts`):

- **One game client per username.** A second login kicks the first (lite vs Chrome vs relog).
- **One SDK controller per username** (last controller wins). A new `control` connection disconnects the old one.
- **State freshness:** game client must publish state every tick. `stateAge > 8000ms` → `stale`. No tick for a long time → coords freeze at last value (can look like Catherby when the player is already in Yanille). Tooling now labels snapshots older than **2 minutes** as `STALE(…)` / **no live state** — never trust those coords.

`fleet-status.ts` and `sdk/cli.ts` read the **gateway snapshot**, not what you see in a Chrome tab. Trust the operator's manual report when it disagrees with a stale snapshot.

### Login code 4 is often transient, not a ban

Lite `err.log` may show `LoginError: Account disabled (code 4)` when:

- The account is **already logged in** elsewhere (Chrome, another lite attempt, login-too-fast race).
- A previous session is still tearing down on the game server.

Discord/community pattern: *"logged too fast — next login worked."* Code 5 is the explicit "already logged in" response; this server sometimes returns 4 for the same situation.

**Lite runner** now retries codes 4, 5, and 16 up to 3 times with 5s / 15s / 30s backoff instead of thrashing forever.

**`lite-launchd.ts`** skips `to-lite` / `restart` / `start` when the gateway already has a **fresh** in-game session (`stateAge < 8s`) and lite is not the holder — avoids colliding with a live Chrome/manual session.

**Do not** call an account permanently disabled from a single code 4 in err.log. Check operator view, out.log `'logged into'`, and `stateAge`.

## What “keeping them open” costs

At fleet scale (~46 accounts):

- **Lite** = one Bun process + one gateway WS + one game connection per account. Cheap vs Chrome, but 40+ processes add up.
- **SDK scripts** = separate controller connections on top of lite. `converge-and-accept-trade.ts` connects the whole roster in batches of 8 and holds them forever.
- **Chrome manual** = valid game client, but conflicts with lite and with scripts that preempt controllers.

The gateway is not usually the bottleneck. **Operational overlap** is: too many clients fighting for the same username, or zombie controllers holding dead state.

## Failure modes we hit

### Stale gateway coords (jacklove4 pattern)

- User moves account manually in Chrome (or account is in-world but lite login is thrashing).
- Gateway `/status` keeps `inGame: true` with **hours-old** `stateAge` and frozen coords (e.g. Catherby while player is at Yanille).
- `fleet-status` now shows `inGame: STALE(19h)` and `xz: stale(19h)` instead of confident Catherby coords.
- **Fix:** stop competing lite/login attempts; for manual play, `lite-launchd.ts stop Name` and skip in scripts. Only `to-lite` when gateway has no fresh session.

### Chrome ↔ lite kick

- `to-lite` closes Chrome tabs and logs in via lite.
- `to-chrome` stops lite and opens Chrome.
- Never run both on the same account.

### Overlapping fleet scripts

Multiple `converge-and-accept-trade.ts` processes (accept-only + walk subsets) preempt each other's controllers and orphan state. Run **one** fleet-wide accept loop, or per-bot roster jobs — not both plus one-off walk batches.

### Zombie grind, no controller (red-dragons / fishing-route pattern)

Lite stays in-game (fresh `stateAge`) but `/status` shows `controllers: []`. The bun pid is still up, so launchd KeepAlive does nothing. This is the recurring "controllers keep disconnecting" failure.

Root cause: **Bun.serve WebSocket `idleTimeout` defaults to 10s.** The lite/game client sends a state frame every tick, so it never idles. An SDK controller often sits in `waitForCondition` / hunt without sending, the hosted gateway closes it, and until this fix the grind did not come back:

1. **BotSDK reconnect could stop.** `onerror` did not close the socket, so `onclose` never scheduled the next attempt. `scheduleReconnect`'s `catch` also did not reschedule.
2. **ActivitySession did not watch the connection.** Awaits never settled. `red-dragons.ts` and `fishing-route.ts` do not use `runScript`'s `onDisconnect` abort.
3. **Half-open sockets.** Fly can drop the server side while the client still reads `OPEN` — no `disconnected` event, frozen `getStateAge()`.

We cannot patch the hosted gateway. We do not need to. Any inbound WebSocket frame resets Bun's 10s idle timer; unknown `sdk_*` types are ignored.

- BotSDK sends `sdk_ping` every 3s (plus a protocol ping when Bun exposes `ws.ping`). 8s was too close: this Mac runs ~46 lite + ~46 grind processes, so timers slip.
- Failed reconnects reschedule; `onerror` closes the socket.
- ActivitySession treats state age >90s or a dropped socket as a client blip and **waits on the same process** (default 10 minutes) before exiting **70**. Exiting at 90s relaunched every bot every half minute, spent the 4/hour cap, and left the fleet off after the gateway came back. A give-up exit still lets launchd start a fresh controller when the client stays dead.

This is rare on Discord because most people run 1–3 bots. A quiet SDK socket on a loaded event loop is a fleet-scale failure, not a server bug.

Pre-emption still disables auto-reconnect (last controller wins). Do not treat a live grind pid as attached. Start or restart every named bot in one launchd command — do not stagger for pathfinding or idle-timeout. Serialize only for shared shop stock.

### `fleet-status` verdict

`fleet-status` gives each bot one kind. `producing` requires a live owner, an attached controller, fresh gateway state, and an effect (XP, coins, inventory, bank, shop, or trade) inside the bot's no-effect window. A bun pid, or a process whose command line merely mentions the name, is not that. Check `kind`, `check`, `minutesSinceEffect`, and `stateAge`. `bun yes` from older notes is not a column anymore.

## Clean ownership model

| Intent | Lite | Chrome | Script controller |
|--------|------|--------|-------------------|
| Overnight grind | on | off | roster launchd job |
| Yanille stack / accept trades | on | off | **one** accept script |
| Manual play | **off** | on | **none** (kill converge on that bot) |
| Chat only | either | either | `sdk/chat.ts` (observe) |

Manual accounts: `lite-launchd.ts stop Name`, kill any converge/controller, add to `skip-bots.txt` or `--except`, do not re-`to-lite` until manual session ends.

## Commands

```bash
# Classify fleet (check stateAge + controllers)
bun .cursor/skills/wake-fleet/scripts/fleet-status.ts --pretty

# Live read without stealing control
bun sdk/cli.ts BotName --observe

# Release script controller (connect then disconnect preempts)
bun -e '... BotSDK connect + disconnect ...'  # or kill the converge bun pid

# Lite ↔ Chrome
bun .cursor/skills/lite-client/scripts/lite-launchd.ts stop Name      # manual Chrome
bun .cursor/skills/lite-client/scripts/lite-launchd.ts to-lite Name   # headless login
```

## Diagnosing login (signal priority)

When asked “is this account online?” check in this order:

| Priority | Signal | Means |
|----------|--------|--------|
| 1 | Operator sees them in-game | Ground truth |
| 2 | `~/Library/Logs/rs-sdk-fleet/lite-{name}.out.log` → `'name' logged into …` | Lite game login succeeded |
| 3 | `lite-launchd.ts status` → `lite running (pid …)` | Launchd keeping session alive |
| 4 | `stateAge < 8000` **and** tick advancing (`cli --observe`) | Fresh gateway snapshot |
| 5 | `fleet-status` `inGame: true` alone | **Not sufficient** — can be zombie hours old; look for `STALE(…)` label |

**Do not** call login failed from:

- `inGame=true` with `stateAge` over 2 minutes — tooling reports **no live state**; coords are unreliable.
- A single `Account disabled` (code 4) in err.log — often a login race; lite retries with backoff. Check operator view and out.log.
- `to-lite` timing out at 90s while lite launchd is still retrying in the background.

**No Chrome tab does not mean logged out.** Lite is a full headless game client — accounts stay in-world with only `bun src/lite/runner.ts {name}` running.

## Fleet bring-up playbook (46 accounts)

Proven sequence from fleet assembly at Yanille:

1. **Log everyone in:** `lite-launchd.ts to-lite` for logged-out names (one command, concurrent). Retry `stop` + `start` up to ~10× on stubborn accounts (same as hammering Chrome login).
2. **Kill controller noise:** one `converge-and-accept-trade.ts --accept-only` with `--except` for manual/walk accounts — not several overlapping converge processes.
3. **Route stragglers:** `finish-yanille-assembly.ts` (batch walk) for accounts not at bank.
4. **Stack on jackthief tile `(2613, 3094)`:** batch `sendWalk` for accounts already at Yanille; `walkNear` + south waypoints for accounts slightly north (e.g. `2633,3208`).
5. **Manual Chrome accounts:** `lite-launchd.ts stop Name` first; add to `skip-bots.txt` / `--except`; no lite, no converge controller.

### Gateway state never refreshes (jacklove4 at Yanille, tooling shows Catherby)

Symptoms: player is **in-game at Yanille** (operator confirms), lite runner is up, but `/status` and `cli` show `STALE(20h)` with frozen tick **6** and old Catherby coords.

**Root cause (two bugs):**

1. **Lite runner gateway reconnect self-kill.** Each gateway WS reconnect used a new `clientId`. The fly.dev gateway treated it as session takeover and sent `save_and_disconnect` to the **old** WebSocket. The old socket's `onmessage` still called `runner.stop()`, killing the live game session — even though it was the same process reconnecting. Fixed in `server/webclient/src/lite/runner.ts`: stable `clientId` per process, ignore messages on superseded sockets, `sendState()` immediately on gateway connect.

2. **Gateway zombie bot session.** `botSessions` kept a dead WebSocket (`readyState !== OPEN`) as "existing session", blocking new registrations or preserving `lastStateReceivedAt` from hours ago. State frames from lite were dropped because the WS was never registered in `wsToType`. Fixed in `server/gateway/gateway.ts`: only takeover when existing WS is **OPEN**; don't preserve stale timestamps from dead sessions.

**Deploy note:** lite picks up (1) on `lite-launchd restart`. Gateway fix (2) requires redeploying `rs-sdk-demo.fly.dev` — until then `/status` may stay stale even when the player is live.

**Snapshot blocked:** `snapshot-yanille-banks.ts` reads state via the gateway relay. With a zombie snapshot it pathfinds from Catherby and `openBank` hangs. Fix the gateway pipe first, then snapshot.

## Bank canvas + fleet at Yanille

`build-bank-canvas.ts` is **observe-only** — it will not open banks. For fresh fleet-wide capture:

1. Start canvas observer: `build-bank-canvas.ts --wait-seconds 900` (background).
2. While observing, open banks: `snapshot-yanille-banks.ts` with all roster names (accounts must be within Yanille bank radius).
3. Canvas merges new captures with `fleet-bank-snapshots.json`.

Running canvas alone after a stack with no bank opens → mostly cached data + `jackthief` only.

## Telemetry you can trust

`fleet-status` kinds, first match wins: `paused`, `needs-client`, `capped`, `churning`, `needs-supplies`, `foreign-owner`, `alive-not-producing`, `producing`, `finished`, `restartable`. The headline is `N producing, M not producing`. Paused bots are omitted from `notProducing`.

An **effect** is an in-session XP or coins increase, or a progress event of kind `xp`, `inventory`, `bank`, `shop`, or `trade`. `location` and `phase` keep the in-script stall timer alive and are not effects. The default no-effect window is 15 minutes, 90 when the roster says `bursty`, or `noEffectMinutes` when that bot sets it.

`fleet-launchd start|restart --verify` reports success only after an effect from the new pid. A pid by itself is not a fix.

Baseline on 2026-10-04 before this change: status said 36 running and 0 needing intervention, while one character had produced nothing for 4.5 hours, six more had no progress record for 38–47 minutes, eight were started and stopped every cycle for ~2.5 hours, one rate printed 2.8 billion Woodcutting XP/hour, fishing bots had 150–178 `recovery_exhausted` stops each, and one character was owned by a script only because its name was in `--except`.

## Do not regress

- Do not trust gateway coords when `Updated: … ago` is minutes or hours, or user says they moved manually.
- Do not use `inGame=true` as login-success criteria in retry loops — require `stateAge < 8000`.
- Do not stack multiple `converge-and-accept-trade.ts` instances without `--except` for manual/walk subsets.
- Do not `to-lite` accounts the user is controlling in Chrome.
- Trades from converge/accept scripts → **stdout**, not `grind.log`.
