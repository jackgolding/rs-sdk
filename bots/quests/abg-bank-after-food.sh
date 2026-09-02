#!/usr/bin/env bash
# Wait until the jacklove food dump finishes, then mule ABG loot → ABGARMY01.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LOG_DIR="${HOME}/Library/Logs/rs-sdk-fleet"
ORCH_LOG="${LOG_DIR}/abg-bank-after-food.log"
mkdir -p "$LOG_DIR"
UIDN="$(id -u)"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$ORCH_LOG"; }

: >"$ORCH_LOG"
log "Waiting for food dump (com.rs-sdk.abg-food-to-01) to finish…"
while launchctl print "gui/${UIDN}/com.rs-sdk.abg-food-to-01" 2>/dev/null | grep -q "state = running"; do
  sleep 20
done
# The agent can sit in exited state; also wait until the bash pid is gone.
while pgrep -f "abg-food-to-01.sh" >/dev/null 2>&1; do
  sleep 10
done
log "Food dump finished — starting loot mule (gold, death runes, fire orbs, gold ore, blood runes, diamonds, wine)"
bash "$ROOT/bots/quests/abg-bank-orchestrate.sh"
log "Bank orchestrator exited $?"
