#!/usr/bin/env bash
# Retry ABGARMY01–06 and ABGARMY20 (missed from last harpoon food pass).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
mkdir -p "${HOME}/Library/Logs/rs-sdk-fleet"
LOCK="${HOME}/Library/Logs/rs-sdk-fleet/abg-food-retry.lock"
if [[ -f "$LOCK" ]]; then
  old_pid=$(cat "$LOCK" 2>/dev/null || true)
  if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "abg-food-retry already running (pid $old_pid)" >&2
    exit 1
  fi
  rm -f "$LOCK"
fi
echo $$ >"$LOCK"
trap 'rm -f "$LOCK"' EXIT

# shellcheck source=abg-food-squad-lib.sh
source "$ROOT/bots/quests/abg-food-squad-lib.sh"

START_EPOCH=$(date +%s)
log "=== abg food retry misses START epoch=$START_EPOCH ==="

run_parallel_squads \
  "jacklove1|ABGARMY01 ABGARMY02 ABGARMY03 ABGARMY04 ABGARMY05" \
  "jacklove4|ABGARMY20"

END_EPOCH=$(date +%s)
ELAPSED=$((END_EPOCH - START_EPOCH))
fed=0
for t in ABGARMY01 ABGARMY02 ABGARMY03 ABGARMY04 ABGARMY05 ABGARMY20; do
  receive_ok "${LOG_DIR}/${t}-food.log" && fed=$((fed + 1))
done
log "=== RETRY DONE — fed $fed/6 in ${ELAPSED}s ==="
