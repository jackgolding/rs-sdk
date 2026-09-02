#!/usr/bin/env bash
# Feed all thieving bots via hub: jacklove2–20 → jacklove1 @ Catherby → ABGARMY01 → thieves.
# See abg-food-hub.sh for the full flow.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec bash "$ROOT/bots/quests/abg-food-hub.sh" "$@"
