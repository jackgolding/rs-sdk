#!/usr/bin/env bash
# Bignet fishers (jacklove6–20) are included in the hub pass — same script as abg-food-all.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec bash "$ROOT/bots/quests/abg-food-hub.sh" "$@"
