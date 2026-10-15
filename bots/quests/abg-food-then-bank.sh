#!/usr/bin/env bash
# Food mule jacklove2 then jacklove1, then consolidate thieving loot → ABGARMY01.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LOG_DIR="${HOME}/Library/Logs/rs-sdk-fleet"
mkdir -p "$LOG_DIR"
ORCH_LOG="${LOG_DIR}/abg-food-then-bank.log"
LAUNCHD="$ROOT/.cursor/skills/wake-fleet/scripts/fleet-launchd.ts"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$ORCH_LOG"; }

stop_bot() { bun "$LAUNCHD" stop "$1" >>"$ORCH_LOG" 2>&1 || true; }
start_bot() { bun "$LAUNCHD" start "$1" >>"$ORCH_LOG" 2>&1 || true; }

kill_receive() {
  local t
  for t in "$@"; do
    pkill -f "abg-food-mule.ts $t receive" 2>/dev/null || true
  done
}

run_food_squad() {
  local mule="$1"
  shift
  local targets=("$@")
  local csv t
  csv=$(IFS=,; echo "${targets[*]}")
  log "FOOD $mule -> $csv"

  stop_bot "$mule"
  for t in "${targets[@]}"; do stop_bot "$t"; done
  sleep 3
  kill_receive "${targets[@]}"
  sleep 1

  for t in "${targets[@]}"; do
    : >"${LOG_DIR}/${t}-food.log"
    bun bots/quests/abg-food-mule.ts "$t" receive >>"${LOG_DIR}/${t}-food.log" 2>&1 &
    log "  receive $t pid $!"
    sleep 2
  done
  sleep 20

  bun bots/quests/abg-food-mule.ts "$mule" mule "$csv" >>"${LOG_DIR}/${mule}-mule.log" 2>&1 || true
  sleep 5
  kill_receive "${targets[@]}"

  for t in "${targets[@]}"; do
    if grep -q "Receive ok" "${LOG_DIR}/${t}-food.log" 2>/dev/null; then
      log "  FED $t"
    else
      log "  MISS $t — $(tail -1 "${LOG_DIR}/${t}-food.log" 2>/dev/null || echo no log)"
    fi
  done
}

: >"$ORCH_LOG"
log "=== food then ABG bank start ==="

run_food_squad jacklove2 ABGARMY06 ABGARMY07 ABGARMY08 ABGARMY09 ABGARMY10
run_food_squad jacklove1 ABGARMY01 ABGARMY02 ABGARMY03 ABGARMY04 ABGARMY05

fed=$(grep -l "Receive ok" "$LOG_DIR"/ABGARMY*-food.log 2>/dev/null | wc -l | tr -d ' ')
log "Food pass done (Receive ok files=$fed). Starting loot consolidate → ABGARMY01"

for i in $(seq -w 1 20); do stop_bot "ABGARMY$i"; done
sleep 4

bun bots/quests/abg-bank.ts run >>"${LOG_DIR}/abg-bank-full.log" 2>&1 || true
log "Bank consolidate finished"

for i in $(seq -w 1 20); do start_bot "ABGARMY$i"; sleep 2; done
start_bot jacklove1
start_bot jacklove2
log "=== DONE — thieving + fishing restarted ==="
