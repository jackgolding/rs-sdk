#!/usr/bin/env bash
# ABGARMY01 mule-initiates loot trades in batches of 4 (same shape as food orchestrator).
#
#   bash bots/quests/abg-bank-orchestrate.sh
#   bash bots/quests/abg-bank-orchestrate.sh ABGARMY08 ABGARMY09
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LOG_DIR="${HOME}/Library/Logs/rs-sdk-fleet"
mkdir -p "$LOG_DIR"
ORCH_LOG="${LOG_DIR}/abg-bank-orchestrate.log"
LAUNCHD="$ROOT/.cursor/skills/wake-fleet/scripts/fleet-launchd.ts"
HUB=ABGARMY01

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$ORCH_LOG"; }

stop_bot() { bun "$LAUNCHD" stop "$1" >>"$ORCH_LOG" 2>&1 || true; }
start_bot() { bun "$LAUNCHD" start "$1" >>"$ORCH_LOG" 2>&1 || true; }

kill_donate() {
  local t
  for t in "$@"; do
    pkill -f "abg-bank.ts $t donate" 2>/dev/null || true
  done
  pkill -f "abg-bank.ts $HUB mule" 2>/dev/null || true
}

run_batch() {
  local targets=("$@")
  local csv t
  csv=$(IFS=,; echo "${targets[*]}")
  log "BANK $HUB mule <- $csv"

  stop_bot "$HUB"
  for t in "${targets[@]}"; do stop_bot "$t"; done
  sleep 4
  kill_donate "${targets[@]}"
  sleep 1

  for t in "${targets[@]}"; do
    : >"${LOG_DIR}/${t}-bank.log"
    bun bots/quests/abg-bank.ts "$t" donate >>"${LOG_DIR}/${t}-bank.log" 2>&1 &
    log "  donate $t pid $!"
    sleep 2
  done
  sleep 25

  bun bots/quests/abg-bank.ts "$HUB" mule "$csv" >>"${LOG_DIR}/${HUB}-mule.log" 2>&1 || true
  sleep 5
  kill_donate "${targets[@]}"

  for t in "${targets[@]}"; do
    if grep -q "Donate ok" "${LOG_DIR}/${t}-bank.log" 2>/dev/null; then
      log "  BANKED $t — restarting thieving"
      start_bot "$t"
    else
      log "  MISS $t — $(tail -1 "${LOG_DIR}/${t}-bank.log" 2>/dev/null || echo no log)"
      start_bot "$t"
    fi
  done
}

: >"$ORCH_LOG"
: >"${LOG_DIR}/${HUB}-mule.log"

if [[ $# -gt 0 ]]; then
  log "=== ABG bank pair/batch start ($*) ==="
  stop_bot "$HUB"
  run_batch "$@"
  start_bot "$HUB"
  log "=== DONE ==="
  exit 0
fi

log "=== ABG bank orchestrator start (01 mule, batches of 4) ==="
stop_bot "$HUB"

run_batch ABGARMY02 ABGARMY03 ABGARMY04 ABGARMY05
run_batch ABGARMY07 ABGARMY08 ABGARMY09 ABGARMY10
run_batch ABGARMY11 ABGARMY12 ABGARMY13 ABGARMY14
run_batch ABGARMY15 ABGARMY16 ABGARMY17 ABGARMY18
run_batch ABGARMY19 ABGARMY20 Jackpoo3

start_bot "$HUB"
log "=== DONE ==="
grep -h "Trade .* ok\|Donate ok\|Could not trade\|Nothing to trade\|Mule done" \
  "$LOG_DIR/${HUB}-mule.log" "$LOG_DIR"/ABGARMY*-bank.log "$LOG_DIR"/Jackpoo3-bank.log 2>/dev/null \
  | tee -a "$ORCH_LOG" || true
