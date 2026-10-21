#!/bin/bash
# quest-lab-driver — run the canary tier unattended.
#
# The whole point: no human in the loop for the mechanical part. It reads the
# queue (`quest-lab/status.json`), and for every quest sitting in `canary` or
# `dev-verified` with budget left it deploys the frozen candidate, picks a free
# canary account, runs `tools/canary.sh --then-grade`, and records the verdict
# back into the queue. A quest that fails is NOT retried blindly: it lands in
# `quest-lab/digest.md` under NEEDS FIX, and the next agent pass reads that.
#
# What it deliberately does NOT do: edit quest scripts, promote to the roster,
# or touch a bot that is in the roster. Those are judgement calls.
#
#   tools/quest-lab-driver.sh [--once] [--interval 120]
#
# Lock: $TMPDIR/quest-lab-driver.lock — one driver per machine.
set -uo pipefail
export PATH="$HOME/.bun/bin:$PATH"

REPO="${QUEST_LAB_REPO:-$HOME/rs-sdk-offline}"
ACCOUNTS="${QUEST_LAB_ACCOUNTS:-jacklove8 jacklove9 jacklove14}"
INTERVAL=120
ONCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --once) ONCE=1; shift ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    *) shift ;;
  esac
done

cd "$REPO" || exit 1
# LOCK is overridable and the loop honours a stop file: a stale instance that is
# wedged (e.g. on a bug already fixed) must not require `kill` — process
# termination is approval-gated, and a stuck driver plus a blocked kill is a
# deadlock. `touch quest-lab/.driver-stop` retires any driver at its next tick.
LOCK="${QUEST_LAB_LOCK:-${TMPDIR:-/tmp}/quest-lab-driver.lock}"
STOPFILE="$REPO/quest-lab/.driver-stop"
DIGEST="$REPO/quest-lab/digest.md"
LOG="$REPO/quest-lab/driver.log"
# Quests whose deploy was refused (not loadable on the deployed image) are parked
# here for 6h so the loop does not retry them every tick and starve the rest of
# the queue — cook/imp sat in front of haunted and blocked it for two ticks.
SKIPFILE="$REPO/quest-lab/.driver-skip"
SKIP_TTL=21600

say() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

if ! mkdir "$LOCK" 2>/dev/null; then
  if [ "$(find "$LOCK" -maxdepth 0 -mmin +240 2>/dev/null)" ]; then
    say "stale lock (>4h) — taking it"
    rmdir "$LOCK" 2>/dev/null || true
    mkdir "$LOCK" 2>/dev/null || { say "lock busy"; exit 0; }
  else
    say "another driver holds $LOCK — exiting"
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

# Queue helpers -------------------------------------------------------------
queue_json() { python3 -c "
import json,sys
d=json.load(open('quest-lab/status.json'))
want={'canary','dev-verified'}
for e in d['entries']:
    if e['stage'] not in want: continue
    if not e.get('script'): continue
    if e['attempts']['canary'] >= e['budget']['maxCanaryAttempts']: continue
    print(e['id']+'\t'+e['script']+'\t'+str(e['attempts']['canary'])+'\t'+e['stage'])
"; }

digest() {
  local now; now=$(date -u +%FT%TZ)
  {
    echo "# quest-lab digest — $now"
    echo
    echo "## Queue"
    python3 -c "
import json
d=json.load(open('quest-lab/status.json'))
rows=[e for e in d['entries'] if e['stage'] in ('canary','dev-verified','fleet-ready','blocked','drafting')]
for e in sorted(rows,key=lambda e:(e['stage'],e['id'])):
    c=e.get('canary') or {}
    print(f\"| {e['id']} | {e['stage']} | {e['attempts']['canary']}/{e['budget']['maxCanaryAttempts']} | {c.get('verdict','-')} | {c.get('runId','-')} |\")
"
    echo
    echo "## Needs fix (canary failed and nobody is working it)"
    python3 -c "
import json
d=json.load(open('quest-lab/status.json'))
for e in d['entries']:
    c=e.get('canary') or {}
    if c.get('verdict')=='FAIL' and e['stage'] in ('canary','dev-verified','drafting'):
        print(f\"- **{e['id']}** ({e['attempts']['canary']}/{e['budget']['maxCanaryAttempts']}) last FAIL {c.get('runId','')} — read /tmp/can-*.log + the box run record\")
"
    echo
    echo "## Blocked"
    python3 -c "
import json
d=json.load(open('quest-lab/status.json'))
for e in d['entries']:
    if e['stage']=='blocked': print(f\"- **{e['id']}** — {(e.get('blockers') or ['?'])[0][:180]}\")
"
  } > "$DIGEST.tmp" && mv "$DIGEST.tmp" "$DIGEST"
}

skipped_recently() {
  local id="$1" now line ts
  now=$(date +%s)
  [ -f "$SKIPFILE" ] || return 1
  while IFS=$'\t' read -r line ts; do
    [ "$line" = "$id" ] || continue
    [ $((now - ts)) -lt "$SKIP_TTL" ] && return 0
  done < "$SKIPFILE"
  return 1
}

park_quest() {
  local id="$1"
  grep -v "^$id	" "$SKIPFILE" 2>/dev/null > "$SKIPFILE.tmp" || true
  printf '%s\t%s\n' "$id" "$(date +%s)" >> "$SKIPFILE.tmp"
  mv "$SKIPFILE.tmp" "$SKIPFILE"
}

canary_busy() {
  # NOTE: `set -o pipefail` makes the remote `grep -c` exit 1 when it counts 0
  # matches, so a piped `| grep -q '^0$'` reads that as failure and the driver
  # waits forever with nothing running (observed: 6 ticks of "already running"
  # with zero canary containers). Read the count into a variable instead.
  local n
  n=$(ssh -n -o BatchMode=yes -o ConnectTimeout=8 -i ~/.ssh/fleet-actions root@5.223.71.192 \
      "docker ps --format '{{.Names}}' | grep -c '^canary-'" 2>/dev/null | tr -d '[:space:]')
  if [ -z "${n:-}" ]; then
    return 0   # ssh failed: wait rather than collide with a live run
  fi
  [ "$n" != "0" ]
}

free_account() {
  local used skipped
  used=$(ssh -n -o BatchMode=yes -o ConnectTimeout=8 -i ~/.ssh/fleet-actions root@5.223.71.192 \
         "docker ps --format '{{.Names}}' | sed -n 's/^canary-//p'" 2>/dev/null)
  skipped=$(ssh -n -o BatchMode=yes -o ConnectTimeout=8 -i ~/.ssh/fleet-actions root@5.223.71.192 \
         "cat /srv/fleet/state/skip-bots.txt 2>/dev/null" 2>/dev/null)
  for a in $ACCOUNTS; do
    case " $used " in *" $a "*) continue ;; esac
    case " $skipped " in *" $a "*) continue ;; esac
    echo "$a"; return 0
  done
  return 1
}

# Main loop -----------------------------------------------------------------
say "driver up (repo $REPO, interval ${INTERVAL}s, accounts: $ACCOUNTS)"
while :; do
  if [ -f "$STOPFILE" ]; then
    say "stop file present — exiting"
    rm -f "$STOPFILE"
    break
  fi
  queue_json > /tmp/ql-queue.$$
  if [ ! -s /tmp/ql-queue.$$ ]; then
    say "nothing in the canary tier — sleeping"
    digest
    rm -f /tmp/ql-queue.$$
    [ "$ONCE" = 1 ] && break
    sleep 600; continue
  fi

  while IFS=$'\t' read -r id script attempts stage; do
    if canary_busy; then
      say "canary container already running — waiting"
      continue
    fi
    if skipped_recently "$id"; then
      continue
    fi
    acct=$(free_account)
    if [ -z "${acct:-}" ]; then
      say "no free canary account — waiting"
      continue
    fi
    say "canary: $id ($stage, attempt $((attempts+1))) on $acct"
    if ! tools/quest-deploy-canary.sh "$id" "$script" >>"$LOG" 2>&1; then
      say "deploy refused for $id — parked for 6h (needs a rollout, not a canary)"
      park_quest "$id"
      continue
    fi
    runlog="/tmp/ql-canary-$id-$(date -u +%H%M%S).log"
    tools/canary.sh "$acct" "$(basename "$script")" --then-grade "$id" >"$runlog" 2>&1
    verdict=$(grep -oE -- '--verdict (PASS|FAIL)' "$runlog" | tail -1 | awk '{print $2}')
    runid=$(grep -oE 'run-id [A-Za-z0-9._-]+' "$runlog" | tail -1 | awk '{print $2}')
    if [ -n "${verdict:-}" ] && [ -n "${runid:-}" ]; then
      bun tools/quest-queue.ts canary "$id" --verdict "$verdict" --run-id "$runid" --account "$acct" >>"$LOG" 2>&1
      say "canary $id: $verdict ($runid) on $acct"
    else
      say "canary $id: no verdict parsed — see $runlog"
    fi
    digest
  done < /tmp/ql-queue.$$
  rm -f /tmp/ql-queue.$$
  digest
  [ "$ONCE" = 1 ] && break
  sleep "$INTERVAL"
done
say "driver exiting"
