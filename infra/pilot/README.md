# Fleet VPS pilot — ABGARMY18 on Hetzner

One bot, two containers, full push-to-deploy. This is the classroom: every
file here reuses on your next project.

## Prereqs (you do these in the Hetzner console + GitHub)

1. Hetzner Cloud project → Security → API token (Read & Write). It never
   goes in chat or git — export it locally:
   `export TF_VAR_hcloud_token=<token>` (add to `~/.zshrc`, not the repo).
2. `brew install terraform` (one-off; validates + applies `terraform/`).
3. GitHub repo `rs-sdk-fleet` → Settings → Secrets → Actions:
   `VPS_HOST` (terraform output `pilot_ipv4`), `VPS_USER` (`root`),
   `VPS_SSH_KEY` (contents of `~/.ssh/id_ed25519` — the private half).

## Bring-up (in order)

```
cd infra/pilot/terraform
terraform init && terraform apply   # ~2 min; note pilot_ipv4
```

Seed secrets from the Mac (`bot.env` is gitignored by design — it travels
over SSH, never through git or Actions):

```
IP=<pilot_ipv4>
rsync -av --exclude='*.log' bots/ABGARMY18/ root@$IP:/srv/fleet/bots/ABGARMY18/
scp bots/roster.json root@$IP:/srv/fleet/bots/roster.json
```

On the box (once): read-only deploy key for the private repo, then clone:

```
ssh root@$IP
ssh-keygen -t ed25519 -f ~/.ssh/fleet-deploy -N ""   # add pub as repo deploy key (read)
git clone --branch infra/vps-pilot git@github.com:jackgolding/rs-sdk-fleet.git /srv/fleet/repo
```

Migrate the bot (two controllers fight — Mac side stops first):

```
# on the Mac (uninstall, not just stop — otherwise the shepherd wakes the
# local job and two controllers fight over the same account):
bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts stop ABGARMY18
bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts uninstall ABGARMY18
launchctl bootout gui/$(id -u)/com.rs-sdk.lite.abgarmy18
# then trigger the pipeline:
git push private infra/vps-pilot
```

## Fleet compose (all 48 bots)

`compose.fleet.yml` is GENERATED from `bots/roster.json` — never edit it:

```
python3 infra/pilot/gen-compose.py > infra/pilot/compose.fleet.yml
```

Re-run + commit whenever roster scripts/args change. The old single-bot
`compose.yml` is retired (ABGARMY18 now lives in the fleet file).

Sync bot code+state to the box (secrets travel over SSH, never git —
bot.env files are gitignored by design):

```
rsync -a --exclude='*.log' --exclude='*.md' --exclude='*.pid' --exclude='.DS_Store' bots/ root@IP:/srv/fleet/bots/
scp bots/roster.json root@IP:/srv/fleet/bots/roster.json
ssh root@IP "chmod 600 \$(find /srv/fleet/bots -name bot.env)"
```

Verify on the box: `docker compose -f infra/pilot/compose.fleet.yml ps` plus
`tail -f /srv/fleet/bots/ABGARMY18/grind.log`. Note: the Mac fleet-desk
does NOT track VPS bots — server logs + game-side effects are the source
of truth for the pilot.

## Rollback

`git push` a revert (or stop the compose project) and restart the Mac job:
`start ABGARMY18` + lite kickstart. Mac remains the fleet home until the
pilot graduates.

## Build lessons (paid for in debugging time)

- The image must contain every runtime import: `sdk/` imports
  `../server/vendor/rsmod-pathfinder`, so `server/vendor` is COPYed even
  though nothing in `server/` otherwise runs in the quest container.
  When a container crash-loops with `Cannot find module`, audit with
  `grep -rh "from '\.\." sdk/*.ts` and add the missing tree.
- Mount per-bot state (`/srv/fleet/bots/ABGARMY18:/opt/fleet/bots/ABGARMY18`),
  never the whole `bots/` dir — a wide mount shadows the image-baked
  `bots/quests/` and every quest crashes with `Module not found`.
- The box pulls git over SSH as root with the repo deploy key; after adding
  the key on GitHub, persist it with
  `git config core.sshCommand "ssh -i ~/.ssh/fleet-deploy ..."`
  or every `git pull` after the first fails.

## Phase 2 (not this pilot)

ghcr.io push/pull instead of build-on-box, Tailscale for fleet-desk,
Uptime Kuma alerts, env-driven bot list instead of one hardcoded service.
