#!/bin/bash
# Local-dev fleet watch (offline worktree). Viewer only — never starts/stops bots.
# Separate from live fleet watch:
#   live  = ~/rs-sdk/bots/watch-fleet.sh         -> SESSION rs-bots, Ghostty titles rs-<view>
#   local = this file                           -> SESSION rs-local, Ghostty titles rs-local-<view>
# Panes come from ~/rs-sdk-offline/bots/roster.json — one tmux window per view.
set -euo pipefail

ROOT="/Users/jackgolding/rs-sdk-offline"
SESSION="rs-local"
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

# Viewer only — kill ONLY our own rs-local sessions, never rs-bots / rs-view-*.
if "$TMUX" list-sessions >/dev/null 2>&1; then
    while IFS= read -r s; do
        [[ -z "$s" ]] && continue
        "$TMUX" kill-session -t "$s" 2>/dev/null || true
    done < <("$TMUX" list-sessions -F '#{session_name} #{session_group}' 2>/dev/null | awk -v g="$SESSION" '
        $1 == g || $2 == g || $1 ~ /^rs-local-view-/ { print $1 }
    ')
fi

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

# Emitted as bash for eval below; begin_view/add_tower are defined above.
# NOTE: offline roster.ts is stale (bad sdk/assignment import), so read the
# offline roster.json directly instead of calling it.
eval "$(python3 - "$ROOT/bots/roster.json" <<'EOF'
import json, math, sys
with open(sys.argv[1]) as f:
    r = json.load(f)
views = r.get('views', [])
bots = r.get('bots', [])
def q(s):
    return "'" + str(s).replace("'", "'\\''") + "'"
for v in views:
    name, cols = v['name'], int(v['columns'])
    names = [b['name'] for b in bots if b.get('view') == name]
    if not names:
        continue
    rows = math.ceil(len(names) / cols)
    print(f"begin_view {q(name)} {cols} {rows}")
    for i in range(0, len(names), rows):
        print('add_tower ' + ' '.join(q(n) for n in names[i:i+rows]))
    print(f"end_view {q(name)}")
EOF
)"

if [[ ${#VIEWS[@]} -eq 0 ]]; then
  echo "bots/roster.json produced no views" >&2
  exit 1
fi

"$TMUX" set-option -t "$SESSION" mouse on
"$TMUX" set-option -t "$SESSION" status-style "bg=colour235,fg=colour250"
"$TMUX" set-option -t "$SESSION" status-left " rs-local "
"$TMUX" set-option -t "$SESSION" status-right ""
"$TMUX" set-option -t "$SESSION" pane-border-status top
"$TMUX" set-option -t "$SESSION" pane-border-format " #{pane_title} "
for view in "${VIEWS[@]}"; do
  "$TMUX" set-window-option -t "$SESSION:$view" aggressive-resize on
done

# NOTE: deliberately no `Ghostty quit` here — live fleet watch owns its own
# Ghostty windows and quitting would close them. We just add windows alongside.
for i in "${!VIEWS[@]}"; do
  view="${VIEWS[$i]}"
  if [[ $i -eq 0 ]]; then
    target="$SESSION:$view"
  else
    group="rs-local-view-$view"
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
    --title="rs-local-$view" \
    -e "$TMUX" attach -t "$target"
done
