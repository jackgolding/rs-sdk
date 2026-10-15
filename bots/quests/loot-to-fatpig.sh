#!/usr/bin/env bash
# Thieving + casket loot → fatpig via pairwise reduction trees (not hub-and-spoke).
#
#   bash bots/quests/loot-to-fatpig.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
exec bun bots/quests/abg-tree-orchestrate.ts --gold-only --casket "$@"
