#!/usr/bin/env bash
# Hub: jacklove2–20 → jacklove1 @ Catherby (cooked fish + casket/oyster loot) → jacklove1 → ABGARMY01 → thieves.
# Only jacklove1 walks Catherby↔Ardougne; other fishers stay at the pier bank.
#
# This script must not outlive a crash and steal grind jobs later:
#   - lock file lists bots; shepherd ignores them only while this pid is alive
#   - EXIT kills every abg-food-mule child and start_bot's roster jobs
#   - HUB_MAX_SEC aborts leftover phases instead of running phase 3 hours later
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LOG_DIR="${HOME}/Library/Logs/rs-sdk-fleet"
mkdir -p "$LOG_DIR"
LOCK="${LOG_DIR}/abg-food-hub.lock"
FISH_HUB=jacklove1
THIEF_HUB=ABGARMY01
TARGETS=(
  ABGARMY02 ABGARMY03 ABGARMY04 ABGARMY05 ABGARMY07 ABGARMY08 ABGARMY09 ABGARMY10
  ABGARMY11 ABGARMY12 ABGARMY13 ABGARMY14 ABGARMY15 ABGARMY16 ABGARMY17 ABGARMY18 ABGARMY19 ABGARMY20
  Jackpoo3
)
# Trade budget: ~19 Catherby (1/fisher) + 1–3 Ardougne relay + thief feed split.
COLLECT_READY_WAIT=180
GIVE_STAGGER=3
GIVE_WAVE_SIZE=4
GIVE_WAVE_TIMEOUT=180
RELAY_PRE_WAIT=45
RELAY_TIMEOUT=900
HUB_MAX_SEC="${HUB_MAX_SEC:-3600}"

# shellcheck source=abg-food-squad-lib.sh
source "$ROOT/bots/quests/abg-food-squad-lib.sh"
ORCH_LOG="${LOG_DIR}/abg-food-hub.log"

hub_bots() {
  echo "$FISH_HUB"
  echo "$THIEF_HUB"
  local n
  for n in $(seq 1 20); do echo "jacklove$n"; done
  printf '%s\n' "${TARGETS[@]}"
}

write_hub_lock() {
  {
    echo "$$"
    hub_bots | awk 'NF && !seen[$0]++'
  } >"$LOCK"
}

past_deadline() {
  [[ -n "${HUB_DEADLINE_EPOCH:-}" ]] && (( $(date +%s) >= HUB_DEADLINE_EPOCH ))
}

abort_if_deadline() {
  if past_deadline; then
    log "DEADLINE reached — aborting remaining food-hub phases"
    exit 1
  fi
}

kill_hub_roles() {
  pkill -f "abg-food-mule.ts $FISH_HUB fish-collect" 2>/dev/null || true
  pkill -f "abg-food-mule.ts $FISH_HUB relay" 2>/dev/null || true
  pkill -f "abg-food-mule.ts $FISH_HUB mule" 2>/dev/null || true
  pkill -f "abg-food-mule.ts $THIEF_HUB receive" 2>/dev/null || true
  pkill -f "abg-food-mule.ts $THIEF_HUB mule" 2>/dev/null || true
  local n
  for n in $(seq 2 20); do
    pkill -f "abg-food-mule.ts jacklove${n} give" 2>/dev/null || true
  done
  kill_receive "${TARGETS[@]}"
  pkill -f 'abg-food-mule.ts' 2>/dev/null || true
}

restore_roster_jobs() {
  local name
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    start_bot "$name"
  done < <(hub_bots | awk 'NF && !seen[$0]++')
}

hub_exit() {
  trap - EXIT INT TERM
  kill_hub_roles
  restore_roster_jobs
  rm -f "$LOCK"
}

wait_for_collect_ready() {
  local waited=0
  while (( waited < COLLECT_READY_WAIT )); do
    past_deadline && return 1
    if grep -q "accepting food + loot from fishers" "${LOG_DIR}/${FISH_HUB}-fish-collect.log" 2>/dev/null; then
      log "  $FISH_HUB ready at bank (${waited}s)"
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
  done
  log "WARN: $FISH_HUB not ready after ${COLLECT_READY_WAIT}s — starting gives anyway"
}

if [[ -f "$LOCK" ]]; then
  old_pid=$(head -1 "$LOCK" 2>/dev/null || true)
  if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "abg-food-hub already running (pid $old_pid)" >&2
    exit 1
  fi
  rm -f "$LOCK"
fi
write_hub_lock
trap hub_exit EXIT INT TERM

give_ok() {
  local f="$1"
  grep -qE "Trade jacklove1 \\(cargo\\) ok|Trade jacklove1 ok|Give done" "$f" 2>/dev/null
}

loot_give_ok() {
  give_ok "$1"
}

relay_ok() {
  local f="$1"
  grep -qE "Relay trade ${THIEF_HUB} ok|Relay done" "$f" 2>/dev/null
}

run_catherby_consolidate() {
  log "--- phase 1: jacklove2–20 → $FISH_HUB @ Catherby (food + loot) ---"
  abort_if_deadline
  stop_all_jacklove_grinds
  sleep 3
  kill_hub_roles
  sleep 1

  : >"${LOG_DIR}/${FISH_HUB}-fish-collect.log"
  bun bots/quests/abg-food-mule.ts "$FISH_HUB" fish-collect >>"${LOG_DIR}/${FISH_HUB}-fish-collect.log" 2>&1 &
  local collect_pid=$!
  log "  fish-collect $FISH_HUB pid $collect_pid"
  wait_for_collect_ready || true

  local wave_start=2
  while (( wave_start <= 20 )); do
    abort_if_deadline
    local -a wave=()
    local n
    for n in $(seq "$wave_start" $((wave_start + GIVE_WAVE_SIZE - 1))); do
      (( n > 20 )) && continue
      wave+=("$n")
    done
    local -a give_pids=()
    for n in "${wave[@]}"; do
      : >"${LOG_DIR}/jacklove${n}-give.log"
      bun bots/quests/abg-food-mule.ts "jacklove$n" give >>"${LOG_DIR}/jacklove${n}-give.log" 2>&1 &
      give_pids+=($!)
      sleep "$GIVE_STAGGER"
    done
    log "  give wave jacklove${wave[0]}–jacklove${wave[${#wave[@]}-1]} (${#give_pids[@]} givers)"
    local waited=0 pid alive
    while (( waited < GIVE_WAVE_TIMEOUT )); do
      past_deadline && break
      alive=0
      for pid in "${give_pids[@]}"; do
        kill -0 "$pid" 2>/dev/null && alive=$((alive + 1))
      done
      (( alive == 0 )) && break
      sleep 5
      waited=$((waited + 5))
    done
    for pid in "${give_pids[@]}"; do
      kill -0 "$pid" 2>/dev/null && kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    done
    wave_start=$((wave_start + GIVE_WAVE_SIZE))
  done
  sleep 3
  kill -0 "$collect_pid" 2>/dev/null && kill "$collect_pid" 2>/dev/null || true
  wait "$collect_pid" 2>/dev/null || true

  local gave=0
  for n in $(seq 2 20); do
    if give_ok "${LOG_DIR}/jacklove${n}-give.log" || loot_give_ok "${LOG_DIR}/jacklove${n}-give.log"; then
      gave=$((gave + 1))
    else
      log "  GIVE MISS jacklove$n — $(tail -1 "${LOG_DIR}/jacklove${n}-give.log" 2>/dev/null || echo no log)"
    fi
  done
  log "  Catherby consolidate: $gave/19 fishers gave food and/or loot to $FISH_HUB"
}

run_relay() {
  abort_if_deadline
  log "--- phase 2: $FISH_HUB → $THIEF_HUB @ Ardougne (food + loot) ---"
  stop_fishing_grind "$FISH_HUB"
  stop_bot "$THIEF_HUB"
  pkill -f 'bots/quests/thieving-route.ts ABGARMY01' 2>/dev/null || true
  pkill -f 'abg-food-loot-mule.ts ABGARMY01' 2>/dev/null || true
  sleep 5
  kill_hub_roles
  sleep 1

  : >"${LOG_DIR}/${THIEF_HUB}-relay-receive.log"
  bun bots/quests/abg-food-mule.ts "$THIEF_HUB" receive "$FISH_HUB" >>"${LOG_DIR}/${THIEF_HUB}-relay-receive.log" 2>&1 &
  log "  receive $THIEF_HUB pid $!"
  sleep "$RELAY_PRE_WAIT"

  : >"${LOG_DIR}/${FISH_HUB}-relay.log"
  bun bots/quests/abg-food-mule.ts "$FISH_HUB" relay >>"${LOG_DIR}/${FISH_HUB}-relay.log" 2>&1 &
  local relay_pid=$!
  local waited=0
  while kill -0 "$relay_pid" 2>/dev/null && (( waited < RELAY_TIMEOUT )); do
    past_deadline && break
    sleep 5
    waited=$((waited + 5))
  done
  kill -0 "$relay_pid" 2>/dev/null && kill "$relay_pid" 2>/dev/null || true
  wait "$relay_pid" 2>/dev/null || true
  sleep 3
  pkill -f "abg-food-mule.ts $THIEF_HUB receive $FISH_HUB" 2>/dev/null || true

  if relay_ok "${LOG_DIR}/${FISH_HUB}-relay.log" || receive_ok "${LOG_DIR}/${THIEF_HUB}-relay-receive.log"; then
    log "  RELAY ok $FISH_HUB → $THIEF_HUB"
  else
    log "  RELAY MISS — $(tail -1 "${LOG_DIR}/${FISH_HUB}-relay.log" 2>/dev/null || echo no log)"
  fi
}

run_thief_feed() {
  abort_if_deadline
  log "--- phase 3: $THIEF_HUB → ${#TARGETS[@]} thieves ---"
  run_food_squad "$THIEF_HUB" "${TARGETS[@]}"
}

START_EPOCH=$(date +%s)
export HUB_DEADLINE_EPOCH=$((START_EPOCH + HUB_MAX_SEC))
log "=== abg food hub START epoch=$START_EPOCH deadline=${HUB_DEADLINE_EPOCH} max=${HUB_MAX_SEC}s ==="

run_catherby_consolidate
run_relay
run_thief_feed

END_EPOCH=$(date +%s)
ELAPSED=$((END_EPOCH - START_EPOCH))
fed=$(grep -lE "Receive ok|Completed [1-9][0-9]* trade" "$LOG_DIR"/ABGARMY*-food.log "$LOG_DIR"/Jackpoo3-food.log "$LOG_DIR"/fatpig-food.log 2>/dev/null | wc -l | tr -d ' ')
log "=== HUB DONE — fed $fed thieves in ${ELAPSED}s ==="
