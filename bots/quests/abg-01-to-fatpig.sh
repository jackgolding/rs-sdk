#!/usr/bin/env bash
# After ABG donate sweep: dump ABGARMY01 bank loot → fatpig.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LOG_DIR="${HOME}/Library/Logs/rs-sdk-fleet"
mkdir -p "$LOG_DIR"
ORCH_LOG="${LOG_DIR}/abg-01-to-fatpig.log"
LAUNCHD="$ROOT/.cursor/skills/wake-fleet/scripts/fleet-launchd.ts"
HUB=ABGARMY01

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$ORCH_LOG"; }

stop_bot() { bun "$LAUNCHD" stop "$1" >>"$ORCH_LOG" 2>&1 || true; }
start_bot() { bun "$LAUNCHD" start "$1" >>"$ORCH_LOG" 2>&1 || true; }

: >"$ORCH_LOG"
log "=== dump $HUB loot → fatpig ==="

stop_bot fatpig
stop_bot "$HUB"
sleep 3
pkill -f "abg-bank.ts fatpig collect" 2>/dev/null || true
pkill -f "abg-bank.ts $HUB dump" 2>/dev/null || true
sleep 1

: >"${LOG_DIR}/fatpig-collect.log"
bun bots/quests/abg-bank.ts fatpig collect >>"${LOG_DIR}/fatpig-collect.log" 2>&1 &
log "  collect fatpig pid $!"
sleep 40

bun bots/quests/abg-bank.ts "$HUB" dump >>"${LOG_DIR}/${HUB}-dump.log" 2>&1 || true
sleep 5
pkill -f "abg-bank.ts fatpig collect" 2>/dev/null || true

if grep -q "Trade fatpig ok\|Dump complete" "${LOG_DIR}/${HUB}-dump.log" 2>/dev/null; then
  log "Dump finished — $(grep -c 'Trade fatpig ok' "${LOG_DIR}/${HUB}-dump.log" 2>/dev/null || echo 0) trip(s)"
else
  log "Dump miss — $(tail -1 "${LOG_DIR}/${HUB}-dump.log" 2>/dev/null || echo no log)"
fi

start_bot fatpig
sleep 2
start_bot "$HUB"
log "=== DONE ==="
