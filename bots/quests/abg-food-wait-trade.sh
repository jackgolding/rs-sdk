#!/usr/bin/env bash
# Jacklove1–4 note Catherby food and split it across all 20 ABG accounts at Ardougne.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LOG_DIR="${HOME}/Library/Logs/rs-sdk-fleet"
mkdir -p "$LOG_DIR"
ORCH_LOG="${LOG_DIR}/abg-food-orchestrate.log"
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

run_squad() {
  local mule="$1"
  shift
  local targets=("$@")
  local csv t ok fail
  csv=$(IFS=,; echo "${targets[*]}")
  log "SQUAD $mule -> $csv"

  stop_bot "$mule"
  for t in "${targets[@]}"; do stop_bot "$t"; done
  sleep 4
  kill_receive "${targets[@]}"
  sleep 1

  for t in "${targets[@]}"; do
    : >"${LOG_DIR}/${t}-food.log"
    nohup bun bots/quests/abg-food-mule.ts "$t" receive >>"${LOG_DIR}/${t}-food.log" 2>&1 &
    log "  receive $t pid $!"
    sleep 2
  done
  sleep 25

  bun bots/quests/abg-food-mule.ts "$mule" mule "$csv" >>"${LOG_DIR}/${mule}-mule.log" 2>&1 || true
  sleep 8
  kill_receive "${targets[@]}"

  ok=0
  fail=0
  for t in "${targets[@]}"; do
    if grep -q "Receive ok" "${LOG_DIR}/${t}-food.log" 2>/dev/null; then
      log "  FED $t — restarting thieving"
      start_bot "$t"
      ok=$((ok + 1))
    else
      log "  MISS $t — $(tail -1 "${LOG_DIR}/${t}-food.log" 2>/dev/null || echo no log)"
      fail=$((fail + 1))
    fi
  done
  log "  $mule fishing restart ($ok fed, $fail missed)"
  start_bot "$mule"
}

: >"$ORCH_LOG"
for mule in jacklove1 jacklove2 jacklove3 jacklove4; do
  : >"${LOG_DIR}/${mule}-mule.log"
done

log "=== ABG food orchestrator start (jacklove1-4 → all 20) ==="

# 2 and 3 are already at Catherby bank; 1 and 4 often spawn on the pier.
run_squad jacklove2 ABGARMY06 ABGARMY07 ABGARMY08 ABGARMY09 ABGARMY10
run_squad jacklove3 ABGARMY11 ABGARMY12 ABGARMY13 ABGARMY14 ABGARMY15
run_squad jacklove1 ABGARMY01 ABGARMY02 ABGARMY03 ABGARMY04 ABGARMY05
run_squad jacklove4 ABGARMY16 ABGARMY17 ABGARMY18 ABGARMY19 ABGARMY20

fed=$(grep -l "Receive ok" "$LOG_DIR"/ABGARMY*-food.log 2>/dev/null | wc -l | tr -d ' ')
log "=== DONE fed=$fed/20 ==="
grep -h "Trade .* ok\|Receive ok\|Could not trade\|No cooked\|Mule done" \
  "$LOG_DIR"/jacklove*-mule.log "$LOG_DIR"/ABGARMY*-food.log 2>/dev/null | tee -a "$ORCH_LOG" || true
