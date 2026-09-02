#!/bin/bash
# Colorize grind.log tails for Ghostty/tmux: LOG dim, WARN yellow, ERROR red.
set -euo pipefail

name="${1:?bot name}"
file="${2:?grind.log path}"

printf '\033]2;%s\007' "$name"
printf '\n======== %s ========\n' "$name"

DIM=$'\033[2m'
YELLOW=$'\033[33m'
RED=$'\033[31m'
RESET=$'\033[0m'

# Match ISO LOG|WARN|ERROR … anywhere in the line (new session format).
colorize() {
  local line="$1"
  if [[ "$line" == *" ERROR "* ]]; then
    printf '%s%s%s\n' "$RED" "$line" "$RESET"
  elif [[ "$line" == *" WARN "* ]]; then
    printf '%s%s%s\n' "$YELLOW" "$line" "$RESET"
  elif [[ "$line" == *" LOG "* ]]; then
    printf '%s%s%s\n' "$DIM" "$line" "$RESET"
  else
    printf '%s\n' "$line"
  fi
}

touch "$file"
/usr/bin/tail -n 40 -F "$file" | while IFS= read -r line || [[ -n "$line" ]]; do
  colorize "$line"
done
