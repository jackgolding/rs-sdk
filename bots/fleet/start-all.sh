#!/usr/bin/env bash
# Start the 12-bot fleet with staggered launches (one bun process per bot).
#
#   ./bots/fleet/start-all.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LOGDIR="$ROOT/bots/fleet/logs"
mkdir -p "$LOGDIR"

launch() {
    local name="$1"
    local script="$2"
    if pgrep -f "bun ${script}" >/dev/null 2>&1; then
        echo "skip $name (already running)"
        return 0
    fi
    echo "start $name → bun $script"
    nohup bun "$script" >>"$LOGDIR/${name}.log" 2>&1 &
    sleep 5
}

# Jackloves leave Draynor first for Lumbridge quest
launch jacklove1 bots/jacklove1/script.ts
launch jacklove2 bots/jacklove2/script.ts
launch jacklove3 bots/jacklove3/script.ts
launch jacklove4 bots/jacklove4/script.ts
launch jacklove5 bots/jacklove5/script.ts

# Long-distance travellers next
launch Jackpoo1 bots/Jackpoo1/magic-shortbows.ts
launch Jackpoo3 bots/Jackpoo3/thieving.ts
launch Jackpoo4 bots/Jackpoo4/rune-rocks.ts
launch jackthief bots/jackthief/smelt-steel.ts

# Local grinds
launch Jackpoo2 bots/Jackpoo2/mining-guild.ts
launch Jackpoo5 bots/Jackpoo5/mining-guild.ts
launch fatpig bots/fatpig/range-druids.ts

echo "Fleet launch complete — logs in bots/fleet/logs/"
