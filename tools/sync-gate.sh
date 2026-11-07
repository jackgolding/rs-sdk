#!/bin/bash
# Bring the local gate (~/rs-sdk-gate, web 8890, gateway 7790, 303 ms ticks) up to a deploy ref's SDK, client
# and quest code, so a local test runs what the fleet runs. The engine, its content and its cheat tools
# (quest-set, stat-set, cheat_stage) stay as they are, the deploy tree deleted them, and the server keeps running.
# Untracked test accounts under bots/ are not touched.
#
#   tools/sync-gate.sh [ref]     default ref: private/infra/vps-pilot (fetched first)
#
# Restart any lite runner afterwards: a running client keeps its old code.
set -euo pipefail
GATE="${GATE_DIR:-$HOME/rs-sdk-gate}"
REF="${1:-}"
cd "$GATE"
if [ -z "$REF" ]; then
  git fetch -q private infra/vps-pilot
  REF="$(git rev-parse FETCH_HEAD)"
fi
SHA="$(git rev-parse --verify "$REF^{commit}")"
# Exact copies: a file the ref deleted must not linger and hide a missing import.
git restore --source="$SHA" --staged --worktree -- sdk server/webclient bots/quests
# Overlays: the gate's fixture tools under server/engine still read older quest-lab files.
git checkout "$SHA" -- quest-lab .cursor/skills/wake-fleet bots/create-bot.ts
(cd server/webclient && bun install --silent)
bun install --silent
echo "$SHA" > .gate-sync-ref
echo "gate synced to $SHA ($(git log -1 --format=%s "$SHA" | cut -c1-70)); restart lite runners"
