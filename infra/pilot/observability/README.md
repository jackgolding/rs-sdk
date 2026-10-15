# VPS fleet observability

Phase 1: `fleet-status` runs on the VPS host against Docker instead of
launchd. Same verdicts, same JSON — different supervisor.

## How it works

`fleet-status.ts` selects its supervisor from `FLEET_SUPERVISOR`
(`launchd` default, `docker` on the VPS). The Docker backend
(`.cursor/skills/wake-fleet/scripts/supervisor.ts`) reads
`docker ps`/`docker inspect` for the `quest-<name>` containers and returns
the same `SupervisorInfo` shape launchd does, so `fleet-verdict.ts`
classify() is untouched.

Per-bot live files come from `FLEET_BOTS_DIR` (`/srv/fleet/bots` on the
box, repo `bots/` on the Mac). Gateway snapshots come from the remote
gateway, so they work from anywhere — but `bot.env` must exist under
`FLEET_BOTS_DIR/<Name>/`, or the status URL falls back to localhost and
every bot reads unreachable.

## Running it on the box

```bash
# one-shot over SSH (bun is installed on the host by cloud-init)
ssh root@$IP "FLEET_SUPERVISOR=docker FLEET_BOTS_DIR=/srv/fleet/bots \
  bun /srv/fleet/repo/.cursor/skills/wake-fleet/scripts/fleet-status.ts --pretty"
```

For JSON (desk/parsing): drop `--pretty`.

## What works in phase 1

- `producing` / `alive-not-producing` / `restartable` / `needs-client`
  (`logged_out`) / `needs-supplies` / `finished` / `paused` — all driven by
  gateway state + grind/heartbeat tails + container state, all portable.
- `lastExit` maps to the container exit code, `runs` to the Docker restart
  count, `state` to the container status.

## Known gaps (not bugs)

- `capped` / `churning` never fire: there is no VPS shepherd yet, so
  `shepherd-state.json` is empty and every bot reads uncapped. Docker
  `restart: unless-stopped` retries without a backoff cap — a crash loop
  spins, it does not park. Read `docker ps` restart counts, not the
  verdict, for loop detection until the shepherd lands.
- `unownedProcesses` is Mac-perspective (host pgrep) and meaningless on
  the box — ignore it there.
- Assignment pids are container-internal: the host never `kill(pid, 0)`s
  them. Docker liveness is container-running + recorded-command match,
  and `resolveSupervisorOwner` reports the host pid for display only.
- The Mac fleet-desk world map still does NOT track VPS bots — it reads
  Mac launchd. Text status over SSH is the source of truth for now.

## Roadmap

1. ~~Docker supervisor backend for fleet-status~~ (this branch)
2. Fleet-desk on the box (reads `FLEET_BOTS_DIR`, serves `/api/fleet`;
   reach it over an SSH tunnel, then Tailscale — never a public port).
3. VPS shepherd: classify → `docker restart quest-<name>` with the same
   4/hour cap, state in `/srv/fleet/state/shepherd-state.json`.
4. Alerts (Uptime Kuma or dead-man's-switch on producing count).
