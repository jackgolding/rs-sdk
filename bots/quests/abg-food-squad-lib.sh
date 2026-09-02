# Shared helpers for abg-food-*.sh orchestrators.
LOG_DIR="${HOME}/Library/Logs/rs-sdk-fleet"
ORCH_LOG="${LOG_DIR}/abg-food-all.log"
LAUNCHD="${ROOT}/.cursor/skills/wake-fleet/scripts/fleet-launchd.ts"
PRE_MULE_WAIT="${PRE_MULE_WAIT:-90}"
SQUAD_TIMEOUT="${SQUAD_TIMEOUT:-1080}"
STAGGER_SEC="${STAGGER_SEC:-30}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$ORCH_LOG"; }
stop_bot() { bun "$LAUNCHD" stop "$1" >>"$ORCH_LOG" 2>&1 || true; }
start_bot() { bun "$LAUNCHD" start "$1" >>"$ORCH_LOG" 2>&1 || true; }

# Stop the grind launch agent only. Never kill lite — that logs the character out.
stop_fishing_grind() {
  local name="$1"
  stop_bot "$name"
  pkill -f "fishing-route.ts ${name}" 2>/dev/null || true
}

stop_all_jacklove_grinds() {
  local n remaining
  for n in $(seq 1 20); do stop_fishing_grind "jacklove$n"; done
  sleep 3
  pkill -f 'bots/quests/fishing-route.ts jacklove' 2>/dev/null || true
  sleep 5
  remaining=$(pgrep -fc 'fishing-route.ts jacklove' 2>/dev/null || echo 0)
  if [[ "$remaining" -gt 0 ]]; then
    log "WARN: ${remaining} jacklove fishing-route still up — SIGKILL"
    pkill -9 -f 'fishing-route.ts jacklove' 2>/dev/null || true
    sleep 2
  fi
}

kill_receive() {
  local t
  for t in "$@"; do
    pkill -f "abg-food-mule.ts $t receive" 2>/dev/null || true
  done
}

receive_ok() {
  local f="$1"
  grep -qE "Receive ok|Completed [1-9][0-9]* trade" "$f" 2>/dev/null
}

run_food_squad() {
  local mule="$1"
  shift
  local targets=("$@")
  local csv t squad_log
  csv=$(IFS=,; echo "${targets[*]}")
  squad_log="${LOG_DIR}/${mule}-food-squad.log"

  {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$mule] FOOD -> $csv"

    stop_bot "$mule"
    for t in "${targets[@]}"; do stop_bot "$t"; done
    sleep 3
    kill_receive "${targets[@]}"
    sleep 2

    for t in "${targets[@]}"; do
      : >"${LOG_DIR}/${t}-food.log"
      bun bots/quests/abg-food-mule.ts "$t" receive "$mule" >>"${LOG_DIR}/${t}-food.log" 2>&1 &
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$mule] receive $t pid $!"
    done
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$mule] waiting ${PRE_MULE_WAIT}s for receivers at market"
    local pre=0
    while (( pre < PRE_MULE_WAIT )); do
      if [[ -n "${HUB_DEADLINE_EPOCH:-}" ]] && (( $(date +%s) >= HUB_DEADLINE_EPOCH )); then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$mule] DEADLINE during pre-mule wait"
        break
      fi
      sleep 5
      pre=$((pre + 5))
    done

    bun bots/quests/abg-food-mule.ts "$mule" mule "$csv" >>"${LOG_DIR}/${mule}-mule.log" 2>&1 &
    local mule_pid=$!
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$mule] mule pid $mule_pid"

    local waited=0
    while (( waited < SQUAD_TIMEOUT )); do
      if [[ -n "${HUB_DEADLINE_EPOCH:-}" ]] && (( $(date +%s) >= HUB_DEADLINE_EPOCH )); then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$mule] DEADLINE — stopping mule"
        break
      fi
      kill -0 "$mule_pid" 2>/dev/null || break
      sleep 5
      waited=$((waited + 5))
    done
    sleep 3
    kill_receive "${targets[@]}"
    kill -0 "$mule_pid" 2>/dev/null && kill "$mule_pid" 2>/dev/null || true

    for t in "${targets[@]}"; do
      if receive_ok "${LOG_DIR}/${t}-food.log"; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$mule] FED $t"
      else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$mule] MISS $t — $(tail -1 "${LOG_DIR}/${t}-food.log" 2>/dev/null || echo no log)"
      fi
      if [[ "$t" =~ ^ABGARMY || "$t" == "Jackpoo3" || "$t" == "fatpig" ]]; then
        start_bot "$t"
      fi
    done
    start_bot "$mule"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$mule] squad done"
  } >>"$squad_log" 2>&1
}

run_parallel_squads() {
  local -a pids=()
  local spec mule
  for spec in "$@"; do
    IFS='|' read -r mule rest <<<"$spec"
    # shellcheck disable=SC2206
    local targets=($rest)
    run_food_squad "$mule" "${targets[@]}" &
    pids+=($!)
    sleep "$STAGGER_SEC"
  done
  local pid
  for pid in "${pids[@]}"; do
    wait "$pid" || log "WARN: squad pid $pid exited non-zero"
  done
}
