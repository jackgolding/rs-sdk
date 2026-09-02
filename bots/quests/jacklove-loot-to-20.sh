#!/usr/bin/env bash
# Note casket loot from jacklove fishers → a collector at Catherby bank, then restart fishing.
#
#   bash bots/quests/jacklove-loot-to-20.sh           # jacklove1–19 → jacklove20
#   bash bots/quests/jacklove-loot-to-20.sh fatpig     # jacklove1–20 → fatpig
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LOG_DIR="${HOME}/Library/Logs/rs-sdk-fleet"
mkdir -p "$LOG_DIR"
ORCH_LOG="${LOG_DIR}/jacklove-loot-to-20.log"
LAUNCHD="$ROOT/.cursor/skills/wake-fleet/scripts/fleet-launchd.ts"
HUB="${1:-jacklove20}"
GIVERS=()
if [[ "$HUB" == "fatpig" ]]; then
  for n in $(seq 1 20); do GIVERS+=("jacklove${n}"); done
else
  for n in $(seq 1 19); do GIVERS+=("jacklove${n}"); done
fi

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$ORCH_LOG"; }

stop_bot() { bun "$LAUNCHD" stop "$1" >>"$ORCH_LOG" 2>&1 || true; }
start_bot() { bun "$LAUNCHD" start "$1" >>"$ORCH_LOG" 2>&1 || true; }

kill_pair() {
  local giver="$1"
  pkill -f "mule-catherby-loot.ts ${giver} give" 2>/dev/null || true
  pkill -f "mule-catherby-loot.ts ${HUB} receive ${giver}" 2>/dev/null || true
}

run_pair() {
  local giver="$1"
  log "PAIR $giver -> $HUB"
  stop_bot "$giver"
  stop_bot "$HUB"
  sleep 4
  kill_pair "$giver"
  sleep 2

  : >"${LOG_DIR}/${giver}-loot.log"
  : >"${LOG_DIR}/${HUB}-recv-${giver}.log"

  bun bots/quests/mule-catherby-loot.ts "$HUB" receive "$giver" >>"${LOG_DIR}/${HUB}-recv-${giver}.log" 2>&1 &
  local recv_pid=$!
  log "  receive $HUB from $giver pid $recv_pid"
  sleep 40

  bun bots/quests/mule-catherby-loot.ts "$giver" give "$HUB" >>"${LOG_DIR}/${giver}-loot.log" 2>&1 &
  local give_pid=$!
  log "  give $giver pid $give_pid"

  local waited=0
  while (( waited < 420 )); do
    local alive=0
    kill -0 "$recv_pid" 2>/dev/null && alive=$((alive + 1))
    kill -0 "$give_pid" 2>/dev/null && alive=$((alive + 1))
    (( alive == 0 )) && break
    sleep 2
    waited=$((waited + 2))
  done
  sleep 2
  kill_pair "$giver"

  if grep -qiE "Trade ${HUB} ok|Receive ${giver} ok" \
      "${LOG_DIR}/${giver}-loot.log" "${LOG_DIR}/${HUB}-recv-${giver}.log" 2>/dev/null; then
    log "  OK $giver"
  elif grep -q "No loot to mule" "${LOG_DIR}/${giver}-loot.log" 2>/dev/null; then
    log "  SKIP $giver (no loot)"
  else
    log "  MISS $giver — giver: $(tail -1 "${LOG_DIR}/${giver}-loot.log" 2>/dev/null || echo ?) | hub: $(tail -1 "${LOG_DIR}/${HUB}-recv-${giver}.log" 2>/dev/null || echo ?)"
  fi

  start_bot "$giver"
}

pkill -f 'mule-catherby-loot' 2>/dev/null || true
sleep 1

: >"$ORCH_LOG"
log "=== noted casket loot -> $HUB (${#GIVERS[@]} givers) ==="

for t in "${GIVERS[@]}" "$HUB"; do stop_bot "$t"; done
sleep 5

log "PREP $HUB — clear inventory"
bun bots/quests/mule-catherby-loot.ts "$HUB" prep >>"${LOG_DIR}/${HUB}-prep.log" 2>&1 || true
pkill -f "mule-catherby-loot.ts ${HUB} prep" 2>/dev/null || true

for g in "${GIVERS[@]}"; do
  run_pair "$g"
  sleep 2
done

start_bot "$HUB"
log "=== DONE ==="
grep -hE "Trade ${HUB} ok|Receive .* ok|Bank loot|Collector banked|No loot|Packed loot|Prep done" \
  "$LOG_DIR"/jacklove*-loot.log "$LOG_DIR"/${HUB}-recv-*.log "$LOG_DIR/${HUB}-prep.log" 2>/dev/null | tee -a "$ORCH_LOG" || true
