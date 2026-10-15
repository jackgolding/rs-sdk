#!/usr/bin/env bash
# Full thieving mule cycle:
#   1. jacklove2–20 → jacklove1 → ABGARMY01 → thieves (abg-food-hub.sh)
#   2. ABGARMY02–20 + Jackpoo3 → coins/loot → ABGARMY01 (abg-bank-orchestrate.sh)
#   3. ABGARMY01 bank → jacklove1 (abg-01-to-jacklove1.sh)
#   4. Restart jacklove1–20 on fishing
#
# Do not write skip-bots.txt. The hub lock pauses shepherd only while the hub
# pid is alive; EXIT restores roster launchd jobs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LOG_DIR="${HOME}/Library/Logs/rs-sdk-fleet"
mkdir -p "$LOG_DIR"
CYCLE_LOG="${LOG_DIR}/abg-thief-mule-cycle.log"
LAUNCHD="$ROOT/.cursor/skills/wake-fleet/scripts/fleet-launchd.ts"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$CYCLE_LOG"; }
start_bot() { bun "$LAUNCHD" start "$1" >>"$CYCLE_LOG" 2>&1 || true; }

log "=== thief mule cycle start ==="

log "--- food: hub jacklove2–20 → jacklove1 → ABGARMY01 ---"
NO_RESTORE_ROSTER=true NO_THIEF_FEED=true bash "$ROOT/bots/quests/abg-food-hub.sh" >>"$CYCLE_LOG" 2>&1 || log "WARN: food pass exited non-zero"

log "--- loot: coins + pickpocket loot → ABGARMY01 ---"
NO_START_HUB=true bash "$ROOT/bots/quests/abg-bank-orchestrate.sh" >>"$CYCLE_LOG" 2>&1 || log "WARN: bank pass exited non-zero"

log "--- hub dump: ABGARMY01 → jacklove1 ---"
NO_RESTORE_ROSTER=true bash "$ROOT/bots/quests/abg-01-to-jacklove1.sh" >>"$CYCLE_LOG" 2>&1 || log "WARN: jacklove1 dump exited non-zero"

rm -f "${LOG_DIR}/abg-food-hub.lock"

log "--- restart jacklove fishers & thieves ---"
for n in $(seq 1 20); do start_bot "jacklove$n"; sleep 1; done
for n in $(seq 1 20); do start_bot "ABGARMY$n"; sleep 1; done
start_bot "Jackpoo3"

log "=== thief mule cycle done ==="
