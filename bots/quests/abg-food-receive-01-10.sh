#!/usr/bin/env bash
# Hold ABGARMY01–10 on receive until the mules finish (or 20 min).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LOG_DIR="${HOME}/Library/Logs/rs-sdk-fleet"
mkdir -p "$LOG_DIR"

for id in 01 02 03 04 05 07 08 09 10; do
  t="ABGARMY${id}"
  pkill -f "abg-food-mule.ts $t receive" 2>/dev/null || true
done
sleep 1

pids=()
for id in 01 02 03 04 05 07 08 09 10; do
  t="ABGARMY${id}"
  bun .cursor/skills/wake-fleet/scripts/fleet-launchd.ts stop "$t" >/dev/null 2>&1 || true
  bun bots/quests/abg-food-mule.ts "$t" receive >>"${LOG_DIR}/${t}-food.log" 2>&1 &
  pids+=($!)
  echo "receive $t pid $!"
  sleep 1
done

# Stay alive so launchd does not reap the children.
wait "${pids[@]}" || true
