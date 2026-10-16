#!/usr/bin/env bash
# Food mule jacklove1–5 → all thieves, then consolidate loot → fatpig, then restart.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LOG_DIR="${HOME}/Library/Logs/rs-sdk-fleet"
mkdir -p "$LOG_DIR"
ORCH_LOG="${LOG_DIR}/abg-food-then-fatpig.log"
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
log "=== food all thieves, loot → fatpig, restart ==="

run_food_squad jacklove1 ABGARMY01 ABGARMY02 ABGARMY03 ABGARMY04 ABGARMY05
run_food_squad jacklove2 ABGARMY06 ABGARMY07 ABGARMY08 ABGARMY09 ABGARMY10
run_food_squad jacklove3 ABGARMY11 ABGARMY12 ABGARMY13 ABGARMY14 ABGARMY15
run_food_squad jacklove4 ABGARMY16 ABGARMY17 ABGARMY18 ABGARMY19 ABGARMY20
run_food_squad jacklove5 Jackpoo3 fatpig

fed=$(grep -l "Receive ok" "$LOG_DIR"/*-food.log 2>/dev/null | wc -l | tr -d ' ')
log "Food pass done (Receive ok files=$fed). Starting loot consolidate → fatpig"

stop_bot fatpig
stop_bot Jackpoo3
for i in $(seq -w 1 20); do stop_bot "ABGARMY$i"; done
sleep 4
pkill -f 'abg-bank.ts' 2>/dev/null || true
sleep 2

bun bots/quests/abg-bank.ts run >>"${LOG_DIR}/abg-bank-full.log" 2>&1 || true
log "Bank consolidate finished"

start_bot fatpig
sleep 4
start_bot Jackpoo3
sleep 4
for i in $(seq -w 1 20); do start_bot "ABGARMY$i"; sleep 4; done
for n in 1 2 3 4 5; do start_bot "jacklove$n"; sleep 2; done
log "=== DONE — thieving + fishing restarted ==="
