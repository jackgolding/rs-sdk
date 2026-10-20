#!/usr/bin/env bash
# canary — run one bot on the production image, without giving it to production.
#
#   tools/canary.sh <bot> <script.ts> [args...]      # run, follow, auto-restore
#   tools/canary.sh <bot> <script.ts> --detach ...   # run, leave it (TTL'd)
#   tools/canary.sh --status                        # list canaries on the box
#   tools/canary.sh --gc                            # remove expired ones
#   tools/canary.sh --dry <bot> <script.ts> [...]   # print the plan, touch nothing
#
# WHY THIS EXISTS
# The canary tier is the only place a script meets the REAL image, the real
# network and the prod clock before 48 bots do. Doing that with hand-typed
# `docker run` was how we learned three failure modes the hard way:
#
#   - the shepherd recreated the roster service mid-run and pre-empted the
#     controller ("Not connected"), because nothing had paused the bot;
#   - code was scp'd from dev into the bind mount, unversioned, and one file
#     imported a module the deployed revision does not have -> every container
#     that shared it crashed;
#   - nothing labelled or expired the container, so a test run was one
#     interruption away from silently becoming unsupervised production.
#
# So the rules this script enforces:
#   1. Box tree clean and at the pushed tip — a canary runs COMMITTED code.
#   2. The script must already exist on the box (i.e. it was deployed). Dev-only
#      files never reach a canary by copy.
#   3. The roster bot is paused by the tool (skip file + stop), never by memory.
#   4. Every container is labelled with its bot, script and expiry, and `--gc`
#      sweeps expired ones.
#   5. An EXIT trap restores the bot — success, failure, ^C or timeout.
#
# Canary is for discovery and single-account verification. It is never a home for
# state: anything that should survive an hour, or be monitored, belongs in the
# roster (see docs/promotion.md).
set -euo pipefail

BOX="${FLEET_BOX:-root@5.223.71.192}"
KEY="${FLEET_SSH_KEY:-$HOME/.ssh/fleet-actions}"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 -i "$KEY" "$BOX")
BOTS_DIR="/srv/fleet/bots"
STATE_DIR="/srv/fleet/state"
# Run records are written under $(cwd)/quest-lab/runs. The container's cwd is
# /opt/fleet, which is NOT mounted — so without this mount every checkpoint the
# canary earned dies with the container and the run can only be judged by
# scrolling logs. The mount below puts the host dir at exactly that path, which
# is what makes `--then-grade` (and quest-canary-grade.ts --box) able to read a
# verdict from the record instead of from stdout.
RUNS_DIR="${FLEET_CANARY_RUNS:-/srv/fleet/canary-runs}"
GRADE_ID=""
LABEL_KEY="hermes.canary"

usage() {
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
}

remote() { "${SSH[@]}" "$@"; }

# ── read-only modes ──────────────────────────────────────────────────────────
status_mode() {
    remote "docker ps -a --filter label=$LABEL_KEY --format '{{.Names}}\t{{.Status}}\t{{.Label \"hermes.bot\"}}\t{{.Label \"hermes.script\"}}\t{{.Label \"hermes.expires\"}}'" \
        | while IFS=$'\t' read -r name status bot script expires; do
            printf '%s\t%s\t%s\t%s\texpires=%s\n' "$name" "$status" "$bot" "$script" "$expires"
        done
    echo "--- roster services paused: $(remote "grep -c . $STATE_DIR/skip-bots.txt 2>/dev/null || echo 0")"
}

gc_mode() {
    local now names
    now=$(date -u +%s)
    names=$(remote "docker ps -a --filter label=$LABEL_KEY --format '{{.Names}}\t{{.Label \"hermes.expires\"}}'")
    if [ -z "$names" ]; then echo "no canaries"; return 0; fi
    while IFS=$'\t' read -r name expires; do
        if [ -z "${name:-}" ]; then continue; fi
        if [ -n "${expires:-}" ] && [ "$expires" -lt "$now" ] 2>/dev/null; then
            echo "removing expired $name (expired $(date -u -r "$expires" '+%H:%M:%SZ' 2>/dev/null || echo "$expires"))"
            remote "docker rm -f $name >/dev/null"
        else
            echo "keeping $name (expires $expires)"
        fi
    done <<<"$names"
}

# ── run mode ─────────────────────────────────────────────────────────────────
BOT=""; SCRIPT=""; DETACH=0; DRY=0; TTL_MINUTES="${CANARY_TTL_MINUTES:-90}"
while [ $# -gt 0 ]; do
    case "$1" in
        --status) status_mode; exit 0 ;;
        --gc) gc_mode; exit 0 ;;
        --detach) DETACH=1; shift ;;
        --dry) DRY=1; shift ;;
        --then-grade) GRADE_ID="$2"; shift 2 ;;
        --ttl) TTL_MINUTES="$2"; shift 2 ;;
        -h|--help) usage ;;
        *)
            if [ -z "$BOT" ]; then BOT="$1"; elif [ -z "$SCRIPT" ]; then SCRIPT="$1"; else break; fi
            shift ;;
    esac
done
if [ -z "$BOT" ] || [ -z "$SCRIPT" ]; then usage; fi
ARGS=("$@")

NAME="canary-$(echo "$BOT" | tr '[:upper:]' '[:lower:]')"
SERVICE="fleet-quest-$(echo "$BOT" | tr '[:upper:]' '[:lower:]')-1"
EXPIRES=$(( $(date -u +%s) + TTL_MINUTES * 60 ))

# 1. the canary must run committed code: box clean, at the pushed tip
BRANCH_TIP=$(git -C "$(dirname "$0")/.." ls-remote private infra/vps-pilot 2>/dev/null | cut -c1-9 || true)
BOX_HEAD=$(remote "cd /srv/fleet/repo && git rev-parse --short=9 HEAD")
BOX_DIRTY=$(remote "cd /srv/fleet/repo && git status --porcelain | head -1")
if [ -n "$BOX_DIRTY" ]; then
    echo "REFUSED: box tree is dirty ($BOX_DIRTY) — a canary runs committed code, not a patched tree" >&2
    exit 3
fi
if [ -n "$BRANCH_TIP" ] && [ "$BRANCH_TIP" != "$BOX_HEAD" ]; then
    echo "warning: box is at $BOX_HEAD, branch tip is $BRANCH_TIP — running what the box has" >&2
fi

# 2. the script must already be deployed (no scp'd dev files)
if ! remote "test -f $BOTS_DIR/quests/$SCRIPT"; then
    echo "REFUSED: $SCRIPT is not on the box at $BOTS_DIR/quests — deploy it first (a canary never introduces new code by copy)" >&2
    exit 4
fi

PAUSED_BEFORE=0
if remote "grep -qxF '$BOT' $STATE_DIR/skip-bots.txt" 2>/dev/null; then PAUSED_BEFORE=1; fi

if [ "$DRY" = "1" ]; then
    if [ "$PAUSED_BEFORE" = "1" ]; then
        PAUSE_LINE="already in $STATE_DIR/skip-bots.txt (restore leaves it paused)"
        RESTORE_LINE="remove $NAME, start $SERVICE (leave paused)"
    else
        PAUSE_LINE="add to $STATE_DIR/skip-bots.txt"
        RESTORE_LINE="remove $NAME, unpause, start $SERVICE"
    fi
    cat <<EOF
plan:
  bot       $BOT   (service $SERVICE)
  script    $SCRIPT ${ARGS[*]:-}
  container $NAME   ttl ${TTL_MINUTES}m  (expires $EXPIRES)
  pause     $PAUSE_LINE
  stop      $SERVICE
  restore   on exit: $RESTORE_LINE
EOF
    exit 0
fi

LOCK="${TMPDIR:-/tmp}/rs-sdk-canary.lock"

restore() {
    local code=$?
    rmdir "$LOCK" 2>/dev/null || true
    echo "--- restoring $BOT"
    remote "docker rm -f $NAME >/dev/null 2>&1 || true"
    if [ "$PAUSED_BEFORE" = "0" ]; then
        remote "sed -i '/^${BOT}\$/d' $STATE_DIR/skip-bots.txt 2>/dev/null || true"
    fi
    remote "docker start $SERVICE >/dev/null 2>&1 || true"
    exit "$code"
}
trap restore EXIT INT TERM

# 2b. one canary at a time. Unattended, two canaries share the box, the image
#     and the skip list, and the second one's restore can unpause the first's bot.
if ! mkdir "$LOCK" 2>/dev/null; then
    echo "REFUSED: another canary is running (lock $LOCK) — canaries are serialized" >&2
    exit 5
fi

# 3. pause the roster bot, then take the controller slot
remote "grep -qxF '$BOT' $STATE_DIR/skip-bots.txt || echo '$BOT' >> $STATE_DIR/skip-bots.txt"
remote "docker stop -t 20 $SERVICE >/dev/null 2>&1 || true"
remote "docker rm -f $NAME >/dev/null 2>&1 || true"

echo "--- canary $NAME: $SCRIPT $BOT ${ARGS[*]:-} (ttl ${TTL_MINUTES}m)"
remote "mkdir -p $RUNS_DIR"
remote "docker run -d --name $NAME --restart no \
    --label $LABEL_KEY=1 --label hermes.bot=$BOT --label hermes.script=$SCRIPT --label hermes.expires=$EXPIRES \
    --network fleet_default -v $BOTS_DIR:/opt/fleet/bots \
    -v $RUNS_DIR:/opt/fleet/quest-lab/runs \
    -w /opt/fleet fleet-pilot:latest \
    bun bots/quests/$SCRIPT $BOT ${ARGS[*]:-} >/dev/null"

if [ "$DETACH" = "1" ]; then
    echo "--- detached; 'tools/canary.sh --status' / --gc later (expiry ${EXPIRES})"
    trap - EXIT INT TERM
    exit 0
fi

# 4. follow until the container exits or the operator ^C's
remote "docker logs -f $NAME" || true

# 5. grade the record it left behind (the record, never the log or exit code)
if [ -n "$GRADE_ID" ]; then
    echo "--- grading canary run for $GRADE_ID"
    bun tools/quest-canary-grade.ts --box --latest "$GRADE_ID" || true
fi
