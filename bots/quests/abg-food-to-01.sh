#!/usr/bin/env bash
# Dump all jacklove cooked food → ABGARMY01, then 01 feeds ABGs with empty banks.
#
# Bank-pack logs (latest): 06/07/17/20 have 0 food; everyone else already packs 25.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LOG_DIR="${HOME}/Library/Logs/rs-sdk-fleet"
mkdir -p "$LOG_DIR"
ORCH_LOG="${LOG_DIR}/abg-food-to-01.log"
LAUNCHD="$ROOT/.cursor/skills/wake-fleet/scripts/fleet-launchd.ts"
HUB=ABGARMY01
HUNGRY=(ABGARMY07 ABGARMY17 ABGARMY20)

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$ORCH_LOG"; }

stop_bot() { bun "$LAUNCHD" stop "$1" >>"$ORCH_LOG" 2>&1 || true; }
start_bot() { bun "$LAUNCHD" start "$1" >>"$ORCH_LOG" 2>&1 || true; }

kill_food() {
  local t
  pkill -f "abg-food-mule.ts $HUB collect" 2>/dev/null || true
  pkill -f "abg-food-mule.ts $HUB mule" 2>/dev/null || true
  pkill -f "abg-food-mule.ts $HUB receive" 2>/dev/null || true
  for t in "$@"; do
    pkill -f "abg-food-mule.ts $t " 2>/dev/null || true
  done
}

run_dump() {
  local mule="$1"
  log "DUMP $mule -> $HUB"
  stop_bot "$mule"
  stop_bot "$HUB"
  sleep 3
  kill_food "$mule"
  sleep 1

  : >"${LOG_DIR}/${HUB}-collect.log"
  bun bots/quests/abg-food-mule.ts "$HUB" collect >>"${LOG_DIR}/${HUB}-collect.log" 2>&1 &
  log "  collect $HUB pid $!"
  sleep 20

  bun bots/quests/abg-food-mule.ts "$mule" mule "$HUB" >>"${LOG_DIR}/${mule}-dump.log" 2>&1 || true
  sleep 5
  kill_food "$mule"

  if grep -q "Receive ok\|Trade ${HUB} ok\|Trade Abgarmy01 ok" \
      "${LOG_DIR}/${HUB}-collect.log" "${LOG_DIR}/${mule}-dump.log" 2>/dev/null; then
    log "  DUMPED $mule"
  else
    log "  MISS $mule — $(tail -1 "${LOG_DIR}/${mule}-dump.log" 2>/dev/null || echo no log)"
  fi
  start_bot "$mule"
}

run_feed() {
  local csv t
  csv=$(IFS=,; echo "${HUNGRY[*]}")
  log "FEED $HUB -> $csv"
  stop_bot "$HUB"
  for t in "${HUNGRY[@]}"; do stop_bot "$t"; done
  sleep 3
  kill_food "${HUNGRY[@]}"
  sleep 1

  for t in "${HUNGRY[@]}"; do
    : >"${LOG_DIR}/${t}-food.log"
    bun bots/quests/abg-food-mule.ts "$t" receive "$HUB" >>"${LOG_DIR}/${t}-food.log" 2>&1 &
    log "  receive $t pid $!"
    sleep 2
  done
  sleep 20

  bun bots/quests/abg-food-mule.ts "$HUB" mule "$csv" >>"${LOG_DIR}/${HUB}-feed.log" 2>&1 || true
  sleep 5
  kill_food "${HUNGRY[@]}"

  for t in "${HUNGRY[@]}"; do
    if grep -q "Receive ok" "${LOG_DIR}/${t}-food.log" 2>/dev/null; then
      log "  FED $t — restarting thieving"
    else
      log "  MISS $t — $(tail -1 "${LOG_DIR}/${t}-food.log" 2>/dev/null || echo no log)"
    fi
    start_bot "$t"
  done
}

: >"$ORCH_LOG"
for n in 1 2 3 4 5; do : >"${LOG_DIR}/jacklove${n}-dump.log"; done
: >"${LOG_DIR}/${HUB}-feed.log"

log "=== jacklove1-5 dump all food -> $HUB, then feed empty banks ==="
log "Hungry (bank pack 0): ${HUNGRY[*]}"

run_dump jacklove2
run_dump jacklove3
run_dump jacklove1
run_dump jacklove4
run_dump jacklove5
run_feed

start_bot "$HUB"
log "=== DONE ==="
grep -h "Trade .* ok\|Receive ok\|Dumping all\|Could not trade\|Mule done\|Packed notes" \
  "$LOG_DIR"/jacklove*-dump.log "$LOG_DIR/${HUB}-collect.log" "$LOG_DIR/${HUB}-feed.log" \
  "$LOG_DIR"/ABGARMY*-food.log 2>/dev/null | tee -a "$ORCH_LOG" || true
