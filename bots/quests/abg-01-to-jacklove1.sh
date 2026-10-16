#!/usr/bin/env bash
# Dump ABGARMY01 bank loot → jacklove1 at Ardougne market.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LOG_DIR="${HOME}/Library/Logs/rs-sdk-fleet"
mkdir -p "$LOG_DIR"
LOCK="${LOG_DIR}/abg-food-hub.lock"
ORCH_LOG="${LOG_DIR}/abg-01-to-jacklove1.log"
LAUNCHD="$ROOT/.cursor/skills/wake-fleet/scripts/fleet-launchd.ts"
HUB=ABGARMY01
COLLECTOR=jacklove1

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$ORCH_LOG"; }

stop_bot() { bun "$LAUNCHD" stop "$1" >>"$ORCH_LOG" 2>&1 || true; }
start_bot() { bun "$LAUNCHD" start "$1" >>"$ORCH_LOG" 2>&1 || true; }

: >"$ORCH_LOG"
log "=== dump $HUB loot → $COLLECTOR ==="

{
  echo "$$"
  echo "$HUB"
  echo "$COLLECTOR"
} >"${LOCK}.tmp"
mv "${LOCK}.tmp" "$LOCK"

stop_bot "$COLLECTOR"
stop_bot "$HUB"
sleep 3
pkill -9 -f "abg-bank.ts $COLLECTOR collect" 2>/dev/null || true
pkill -9 -f "abg-bank.ts $HUB dump" 2>/dev/null || true
pkill -9 -f "catherby-cook-bank.ts" 2>/dev/null || true
pkill -9 -f "fishing-route.ts jacklove1" 2>/dev/null || true
sleep 1

: >"${LOG_DIR}/${COLLECTOR}-collect.log"
bun bots/quests/abg-bank.ts "$COLLECTOR" collect >>"${LOG_DIR}/${COLLECTOR}-collect.log" 2>&1 &
log "  collect $COLLECTOR pid $!"
sleep 20

bun bots/quests/abg-bank.ts "$HUB" dump "$COLLECTOR" >>"${LOG_DIR}/${HUB}-dump.log" 2>&1 || true
sleep 5
pkill -9 -f "abg-bank.ts $COLLECTOR collect" 2>/dev/null || true

if grep -q "Trade ${COLLECTOR} ok\|Dump complete" "${LOG_DIR}/${HUB}-dump.log" 2>/dev/null; then
  log "Dump finished — $(grep -c "Trade ${COLLECTOR} ok" "${LOG_DIR}/${HUB}-dump.log" 2>/dev/null || echo 0) trip(s)"
else
  log "Dump miss — $(tail -1 "${LOG_DIR}/${HUB}-dump.log" 2>/dev/null || echo no log)"
fi

if [[ "${NO_RESTORE_ROSTER:-false}" != "true" ]]; then
  start_bot "$COLLECTOR"
  sleep 2
  start_bot "$HUB"
fi
trap - EXIT INT TERM
rm -f "$LOCK"
log "=== DONE ==="
