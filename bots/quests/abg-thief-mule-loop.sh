#!/usr/bin/env bash
# Run abg-thief-mule-cycle.sh every 3 hours (launchd-safe background loop).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="${HOME}/Library/Logs/rs-sdk-fleet"
mkdir -p "$LOG_DIR"
LOOP_LOG="${LOG_DIR}/abg-thief-mule-loop.log"
INTERVAL=$((3 * 60 * 60))

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOOP_LOG"; }

log "Loop armed — interval ${INTERVAL}s (3h), pid $$"

while true; do
  log "=== cycle tick ==="
  bash "$ROOT/bots/quests/abg-thief-mule-cycle.sh" >>"$LOOP_LOG" 2>&1 || log "WARN: cycle failed"
  log "Sleeping ${INTERVAL}s until next cycle"
  sleep "$INTERVAL"
done
