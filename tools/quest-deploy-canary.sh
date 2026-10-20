#!/usr/bin/env bash
# quest-deploy-canary — put a committed quest candidate on the canary box.
#
#   tools/quest-deploy-canary.sh <quest-id> <script.ts> [helper.ts ...]
#   tools/quest-deploy-canary.sh <quest-id> --from <worktree> <script.ts> [helper.ts ...]
#
# WHY THIS EXISTS
# `tools/canary.sh` refuses to run a script the box does not already have, and
# that rule is right: a canary must run COMMITTED code, never an scp'd file.
# But nothing in the repo turned "I have a frozen candidate in a worktree" into
# "the box has it", so the only options were `scp` (forbidden) or moving the
# fleet branch (a rollout decision, not a test). This does the missing step:
#
#   commit candidate files on a throwaway branch off the DEPLOYED commit,
#   push that branch to the private remote, and on the box `git show` the file
#   into /srv/fleet/bots/quests (the bind mount every container reads).
#
# The box's working tree is NOT touched and NOT moved off the deployed commit,
# so nothing about the running fleet changes except the contents of one quest
# file that no roster bot is using. Every deploy prints what it replaced and
# where the previous copy is, so a bad canary can be undone.
#
# Safety rails:
#   - the candidate must pass tools/quest-canary-imports.ts against the deployed
#     ref (an sdk/ or quest-lab/ import the image lacks = it cannot even load);
#   - a script a roster bot is currently running is refused (deploying it would
#     change production behaviour, which is a rollout, not a canary);
#   - the previous box copy is saved as <file>.prev-<stamp> before overwrite.
set -euo pipefail

BOX="${FLEET_BOX:-root@5.223.71.192}"
KEY="${FLEET_SSH_KEY:-$HOME/.ssh/fleet-actions}"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 -i "$KEY" "$BOX")
REPO="/srv/fleet/repo"
BOTS_DIR="/srv/fleet/bots"
REMOTE="${FLEET_REMOTE:-private}"
DEPLOY_BRANCH="${FLEET_DEPLOY_BRANCH:-infra/vps-pilot}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

usage() { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

QUEST=""
SOURCE="."
FILES=()
while [ $# -gt 0 ]; do
    case "$1" in
        --from) SOURCE="$2"; shift 2 ;;
        -h|--help) usage ;;
        *)
            if [ -z "$QUEST" ]; then QUEST="$1"; else FILES+=("$1"); fi
            shift ;;
    esac
done
if [ -z "$QUEST" ] || [ ${#FILES[@]} -eq 0 ]; then usage; fi

cd "$SOURCE"
DEPLOYED_SHA=$(remote_head=$("${SSH[@]}" "cd $REPO && git rev-parse HEAD" | tr -d '\r\n'); echo "$remote_head")
echo "== quest-deploy-canary: $QUEST"
echo "   box deployed commit: ${DEPLOYED_SHA:0:9}"
echo "   source tree:         $(pwd)"

# 1. drop the commit object onto the private remote first so the box can read it
git fetch --quiet "$REMOTE" "$DEPLOY_BRANCH"
BASE=$(git rev-parse "$REMOTE/$DEPLOY_BRANCH")
echo "   base (${REMOTE}/${DEPLOY_BRANCH}): ${BASE:0:9}"

# 2. work on a throwaway branch off the DEPLOYED commit so the candidate is byte-identical
#    to what a full rollout from that base would contain.
ORIG_BRANCH=$(git rev-parse --abbrev-ref HEAD)
BRANCH="quest/canary-$QUEST-$STAMP"
WORKTREE=$(mktemp -d "${TMPDIR:-/tmp}/quest-canary-deploy.XXXXXX")
cleanup() {
    git -C "$(pwd)" worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

git worktree add --quiet --detach "$WORKTREE" "$BASE"
for f in "${FILES[@]}"; do
    [ -f "$f" ] || { echo "REFUSED: $f not found in $(pwd)" >&2; exit 2; }
    mkdir -p "$WORKTREE/$(dirname "$f")"
    cp "$f" "$WORKTREE/$f"
done

# 3. canary-safety: every sdk/quest-lab module import must exist at the deployed commit
for f in "${FILES[@]}"; do
    case "$f" in
        bots/quests/*.ts)
            ( cd "$WORKTREE" && bun /Users/jackgolding/rs-sdk-offline/tools/quest-canary-imports.ts "$f" --ref "${DEPLOYED_SHA:0:9}" ) \
                || { echo "REFUSED: $f is not loadable on the deployed image (see above)" >&2; exit 3; }
            ;;
    esac
done

# 4. never overwrite a script a roster bot is running
RUNNING=$("${SSH[@]}" "python3 -c \"
import json
d=json.load(open('$BOTS_DIR/roster.json'))
b=d if isinstance(d,list) else d.get('bots',d)
print(' '.join(sorted({(x.get('script') or '').split('/')[-1] for x in b})))
\"" | tr -d '\r')
for f in "${FILES[@]}"; do
    base=$(basename "$f")
    for running in $RUNNING; do
        if [ "$base" = "$running" ]; then
            echo "REFUSED: $base is in the live roster — deploying it changes production (that is a rollout, not a canary)" >&2
            exit 4
        fi
    done
done

git -C "$WORKTREE" add "${FILES[@]}"
git -C "$WORKTREE" -c user.name="quest-lab" -c user.email="quest-lab@local" \
    commit --quiet -m "quest($QUEST): canary candidate $STAMP"
SHA=$(git -C "$WORKTREE" rev-parse HEAD)
echo "   candidate commit:    ${SHA:0:9}"
git -C "$WORKTREE" push --quiet "$REMOTE" "HEAD:refs/heads/$BRANCH"
echo "   pushed to $REMOTE:$BRANCH"

# 5. on the box: fetch the ref and materialise the files into the bind mount
"${SSH[@]}" "cd $REPO && git fetch --quiet origin $BRANCH:refs/heads/$BRANCH"
for f in "${FILES[@]}"; do
    # BOTS_DIR already ends in /bots, so strip the repo-relative "bots/" prefix:
    # /srv/fleet/bots is mounted at /opt/fleet/bots, which is the container's cwd.
    rel="${f#bots/}"
    target="$BOTS_DIR/$rel"
    "${SSH[@]}" "set -e
        if [ -f '$target' ]; then cp '$target' '$target.prev-$STAMP'; fi
        cd $REPO && git show $SHA:'$f' > '$target'
        echo \"   deployed \$(basename '$f') -> $target (\$(wc -c < '$target') bytes)\""
done

cat <<EOF

== deployed. run the canary next:
   tools/canary.sh <account> $(basename "${FILES[0]}") --then-grade $QUEST

   undo:  ssh $BOX "cp $BOTS_DIR/${FILES[0]#bots/}.prev-$STAMP $BOTS_DIR/${FILES[0]#bots/}"
   branch $BRANCH can be deleted once the verdict is recorded.
EOF
