#!/usr/bin/env bash
# Full thieving mule cycle:
#   1. jacklove2–20 → jacklove1 → ABGARMY01 → thieves (abg-food-hub.sh)
#   2. ABGARMY02–20 + Jackpoo3 → coins/loot → ABGARMY01
#   3. ABGARMY01 bank → fatpig
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

log "--- food: hub jacklove2–20 → jacklove1 → ABGARMY01 → all thieves ---"
bash "$ROOT/bots/quests/abg-food-hub.sh" >>"$CYCLE_LOG" 2>&1 || log "WARN: food pass exited non-zero"

log "--- loot: coins + pickpocket loot → ABGARMY01 ---"
bash "$ROOT/bots/quests/abg-bank-orchestrate.sh" >>"$CYCLE_LOG" 2>&1 || log "WARN: bank pass exited non-zero"

log "--- hub dump: ABGARMY01 → fatpig ---"
bash "$ROOT/bots/quests/abg-01-to-fatpig.sh" >>"$CYCLE_LOG" 2>&1 || log "WARN: fatpig dump exited non-zero"

log "--- restart jacklove fishers ---"
for n in $(seq 1 20); do start_bot "jacklove$n"; sleep 2; done

log "=== thief mule cycle done ==="
