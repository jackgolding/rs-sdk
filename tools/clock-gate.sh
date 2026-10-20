#!/usr/bin/env bash
# Clock gate — run the eval suite at a chosen engine tick rate.
#
#   tools/clock-gate.sh 60  --runs 1 --min-runs 1        # fast: iterate quickly
#   tools/clock-gate.sh 300 --runs 3                     # prod-like: verify
#
# Why two clocks: a fast world is how you get from rough to locally-working
# quickly (cook's 2 minutes becomes well under one), but a fast clock also hides
# races — a two-tick settle is 40ms at 20ms/tick and 800ms at 400. So a script is
# developed fast and verified at the prod clock (300ms, matching fly.toml).
#
# This rewrites server/engine/.env, restarts the launchd engine, runs the suite,
# then restores the previous tick rate and restarts again. IT BOOTS EVERY LOCAL
# SESSION: lite runners die, quest scripts wait for a controller that never
# returns. Only run it when that is acceptable.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/server/engine/.env"
LABEL="com.rs-sdk.local-engine"
DOMAIN="gui/$(id -u)"

if [[ $# -lt 1 || "$1" == "-h" || "$1" == "--help" ]]; then
    echo "usage: tools/clock-gate.sh <tickMs> [quest-eval args...]" >&2
    exit 2
fi
TICK="$1"; shift
if ! [[ "$TICK" =~ ^[0-9]+$ ]] || (( TICK < 20 )); then
    echo "clock-gate: tick must be an integer >= 20 ms (engine minimum)" >&2
    exit 2
fi

# Remember what was there, so the world is left exactly as found.
PREV_TICK=""
PREV_HAD_ENV=0
if [[ -f "$ENV_FILE" ]]; then
    PREV_HAD_ENV=1
    PREV_TICK="$(grep -E '^\s*NODE_TICKRATE\s*=' "$ENV_FILE" | head -1 | sed -E 's/.*=\s*//' || true)"
    PREV_BODY="$(cat "$ENV_FILE")"
fi

restart_engine() {
    launchctl kickstart -k "$DOMAIN/$LABEL" >/dev/null 2>&1 || {
        echo "clock-gate: could not restart $LABEL (is the engine launchd-managed?)" >&2
        return 1
    }
    for _ in $(seq 1 60); do
        if curl -s --max-time 2 http://127.0.0.1:8888/playerpositions >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    echo "clock-gate: engine did not answer :8888 within 60s" >&2
    return 1
}

restore() {
    if [[ "$PREV_HAD_ENV" == "1" ]]; then
        printf '%s\n' "$PREV_BODY" > "$ENV_FILE"
    else
        rm -f "$ENV_FILE"
    fi
    restart_engine || true
}

echo "clock-gate: NODE_TICKRATE=$TICK (was ${PREV_TICK:-unset/engine default})"
{
    if [[ "$PREV_HAD_ENV" == "1" ]]; then
        grep -vE '^\s*NODE_TICKRATE\s*=' "$ENV_FILE" || true
    fi
    echo "NODE_TICKRATE=$TICK"
} > "$ENV_FILE.tmp"
mv "$ENV_FILE.tmp" "$ENV_FILE"

trap 'restore' EXIT
restart_engine

set +e
bun "$ROOT/quest-eval/run.ts" --tickrate "$TICK" "$@"
CODE=$?
set -e
echo "clock-gate: eval exit $CODE at ${TICK}ms/tick"
exit "$CODE"
