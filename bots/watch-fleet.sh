#!/bin/bash
# Ghostty + tmux log viewer (does not start or stop bun scripts).
#
# Panes come from bots/roster.json — one tmux window per view, bots stacked
# column-major. Add or move a bot there, not here.
# Click the status bar to switch windows (mouse is on).
set -euo pipefail

ROOT="/Users/jackgolding/rs-sdk"
SESSION="rs-bots"
TMUX="${TMUX_BIN:-$(command -v tmux || true)}"
if [[ -z "$TMUX" && -x /opt/homebrew/bin/tmux ]]; then
  TMUX=/opt/homebrew/bin/tmux
fi
if [[ -z "$TMUX" ]]; then
  echo "tmux is required. Install with: brew install tmux" >&2
  exit 1
fi

tail_cmd() {
  local name="$1"
  local file="${2:-$ROOT/bots/$name/grind.log}"
  printf 'exec /bin/bash %q %q %q' \
    "$ROOT/bots/color-grind-tail.sh" "$name" "$file"
}

# Full-height column, names stacked top-to-bottom with even-ish heights.
# $1 = tmux window name, remaining args = bot names. Optional last args can
# be overridden by passing a log path via tail_for.
WIN=""
tail_for() {
  local name="$1"
  tail_cmd "$name" "$ROOT/bots/$name/grind.log"
}

add_tower() {
  local names=("$@")
  local n=${#names[@]}
  local name="${names[0]}"
  local i pct

  if ! "$TMUX" has-session -t "$SESSION" 2>/dev/null; then
    "$TMUX" new-session -d -s "$SESSION" -n "$WIN" -c "$ROOT" "$(tail_for "$name")"
  elif ! "$TMUX" list-windows -t "$SESSION" -F '#{window_name}' | grep -qx "$WIN"; then
    "$TMUX" new-window -t "$SESSION" -n "$WIN" -c "$ROOT" "$(tail_for "$name")"
  else
    "$TMUX" split-window -h -f -t "$SESSION:$WIN" -c "$ROOT" "$(tail_for "$name")"
  fi
  "$TMUX" select-pane -T "$name"

  for ((i = 1; i < n; i++)); do
    pct=$((100 * (n - i) / (n - i + 1)))
    "$TMUX" split-window -v -p "$pct" -t "$SESSION:$WIN" -c "$ROOT" "$(tail_for "${names[i]}")"
    "$TMUX" select-pane -T "${names[i]}"
  done
}

even_columns() {
  local win="$1"
  local cols="$2"
  local rows="$3"
  local width col pane i
  width=$("$TMUX" display-message -p -t "$SESSION:$win" '#{window_width}')
  col=$((width / cols))
  for ((i = 0; i < cols; i++)); do
    pane=$((i * rows))
    "$TMUX" resize-pane -t "$SESSION:$win.$pane" -x "$col"
  done
}

# Viewer only — never touch bun bot processes. Kill every session in the
# rs-bots group (leftover rs-view-* / rs-army-view keep the old window set,
# so a new roster view like "loves" never appears there).
if "$TMUX" list-sessions >/dev/null 2>&1; then
    while IFS= read -r s; do
        [[ -z "$s" ]] && continue
        "$TMUX" kill-session -t "$s" 2>/dev/null || true
    done < <("$TMUX" list-sessions -F '#{session_name} #{session_group}' 2>/dev/null | awk -v g="$SESSION" '
        $1 == g || $2 == g || $1 ~ /^rs-view-/ || $1 == "rs-army-view" { print $1 }
    ')
fi
pkill -f "SCREEN -c /tmp/rs-bots.screenrc" 2>/dev/null || true
pkill -f "screen -c /tmp/rs-bots.screenrc" 2>/dev/null || true

VIEWS=()
VIEW_COLS=0
VIEW_ROWS=0

begin_view() {
  WIN="$1"
  VIEW_COLS="$2"
  VIEW_ROWS="$3"
  VIEWS+=("$WIN")
}

end_view() {
  even_columns "$1" "$VIEW_COLS" "$VIEW_ROWS"
}

# Emits begin_view / add_tower / end_view calls from bots/roster.json.
eval "$(bun "$ROOT/.cursor/skills/wake-fleet/scripts/roster.ts" tmux)"

if [[ ${#VIEWS[@]} -eq 0 ]]; then
  echo "bots/roster.json produced no views" >&2
  exit 1
fi

"$TMUX" set-option -t "$SESSION" mouse on
"$TMUX" set-option -t "$SESSION" status-style "bg=colour235,fg=colour250"
"$TMUX" set-option -t "$SESSION" status-left " rs-bots "
"$TMUX" set-option -t "$SESSION" status-right ""
"$TMUX" set-option -t "$SESSION" pane-border-status top
"$TMUX" set-option -t "$SESSION" pane-border-format " #{pane_title} "
for view in "${VIEWS[@]}"; do
  "$TMUX" set-window-option -t "$SESSION:$view" aggressive-resize on
done

# Bring Ghostty to the viewer. Each view gets its own window so every grid
# stays visible (grouped session = independent current-window).
osascript -e 'tell application "Ghostty" to quit' >/dev/null 2>&1 || true
sleep 0.4

for i in "${!VIEWS[@]}"; do
  view="${VIEWS[$i]}"
  if [[ $i -eq 0 ]]; then
    target="$SESSION:$view"
  else
    group="rs-view-$view"
    "$TMUX" kill-session -t "$group" 2>/dev/null || true
    "$TMUX" new-session -d -s "$group" -t "$SESSION"
    "$TMUX" select-window -t "$group:$view"
    target="$group:$view"
  fi

  [[ $i -gt 0 ]] && sleep 0.3
  open -na Ghostty.app --args \
    --working-directory="$ROOT" \
    --font-size=11 \
    --window-save-state=never \
    --title="rs-$view" \
    -e "$TMUX" attach -t "$target"
done
