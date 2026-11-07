#!/usr/bin/env python3
"""
Fleet watch: run by fleet-watch.timer every 5 minutes, so nobody's session has to be watching.

Flags to /srv/fleet/state/fleet-alerts.log (and stdout, so the journal has it):
  DEATH        a quest run logged a death (run-quest's "DEATH at", or the older lines)
  GAVE_UP      a Legends-path quest used its last try
  REARMED      ...and its failures were only stock or a missing record, so it was re-armed
  STALLED      a running account has logged nothing for STALL_MIN minutes
  DOWN         a rostered account's container isn't running
  STOCK_WAIT   a quest has been waiting on stock for STOCK_WAIT_MIN minutes

Re-arming writes bots/<Bot>/todo-rearm.json, which todo-runner consumes; it never touches
todo-state.json (a running runner would clobber that) and restarts nothing. It's allowed only for
recent failures that spent no game progress. The same (account, quest) is re-armed at most REARM_MAX times
a day, so a real fault still ends in GAVE_UP. Anything else is only recorded.

  --dry   report, write nothing (no offsets, no alerts, no re-arms)

Environment for tests: FLEET_BOTS_DIR, FLEET_STATE_DIR, FLEET_WATCH_RUNNING (comma-separated
lower-case account names instead of asking docker).
"""
import calendar
import json
import os
import re
import subprocess
import sys
import time

BOTS = os.environ.get("FLEET_BOTS_DIR", "/srv/fleet/bots")
STATE = os.environ.get("FLEET_STATE_DIR", "/srv/fleet/state")
ALERTS = os.path.join(STATE, "fleet-alerts.log")
MEMORY = os.path.join(STATE, "fleet-watch.json")
DRY = "--dry" in sys.argv

STALL_MIN = 45
# A serve-only mule logs only when asked.
MULE_STALL_MIN = 360
STOCK_WAIT_MIN = 120
REPEAT_S = 6 * 3600
# A failure older than this was settled by hand or doesn't matter: never re-armed or flagged.
RECENT_S = 6 * 3600
REARM_MAX = 2
DAY_S = 24 * 3600

# Keep equal to todo-logic.ts LEGENDS_PATH (todo-logic.test.ts checks).
LEGENDS_PATH = {
    "legends-quest", "heroes-quest", "shield-of-arrav", "lost-city", "merlins-crystal", "dragon",
    "crest", "shilo-village", "jungle-potion", "underground-pass", "biohazard", "plague-city", "waterfall",
}
DEATH = re.compile(r"DEATH at \(|Died @|player died|Oh dear, you are dead")
SAFE_FAILURE = re.compile(r"^exited 4$|wrote no run record")


def read_json(path, fallback):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return fallback


def write_json(path, data):
    tmp = f"{path}.tmp-{os.getpid()}"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, path)


def lines_of(path):
    try:
        with open(path) as f:
            return [l.strip() for l in f if l.strip() and not l.startswith("#")]
    except OSError:
        return []


def running_accounts():
    env = os.environ.get("FLEET_WATCH_RUNNING")
    if env is not None:
        return set(filter(None, env.split(",")))
    out = subprocess.run(["docker", "ps", "--format", "{{.Names}}"], capture_output=True, text=True, timeout=60).stdout
    return {m.group(1) for m in map(re.compile(r"^fleet-quest-(.+)-1$").match, out.split()) if m}


def script_key(script):
    return os.path.basename(script).removesuffix(".ts")


def new_lines(path, offsets):
    """Lines appended since the last run. The first sight of a file starts at its end: no history flood."""
    try:
        size = os.path.getsize(path)
    except OSError:
        return []
    start = offsets.get(path)
    offsets[path] = size
    if start is None or size <= start:
        return []
    with open(path, errors="replace") as f:
        f.seek(start)
        return f.read().splitlines()


def iso_seconds(stamp):
    """Epoch seconds of an ISO UTC stamp; 0 if it isn't one."""
    try:
        return calendar.timegm(time.strptime(stamp[:19], "%Y-%m-%dT%H:%M:%S"))
    except (TypeError, ValueError):
        return 0


def main():
    mem = read_json(MEMORY, {"offsets": {}, "said": {}, "rearmed": {}})
    now = time.time()
    alerts = []

    def say(key, kind, account, text, repeat=None):
        last = mem["said"].get(key)
        if last is not None and (repeat is None or now - last < repeat):
            return
        mem["said"][key] = now
        alerts.append(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now))} {kind} {account}: {text}")

    roster = read_json(os.path.join(BOTS, "roster.json"), {})
    bots = roster.get("bots", roster) if isinstance(roster, dict) else roster
    todo = read_json(os.path.join(BOTS, "todo.json"), {}).get("accounts", {})
    swarm = {a["name"].lower() for a in read_json(os.path.join(BOTS, "swarm.json"), {}).get("accounts", [])}
    skip = {s.lower() for s in lines_of(os.path.join(STATE, "skip-bots.txt"))}
    running = running_accounts()

    for bot in bots:
        name = bot["name"]
        low = name.lower()
        d = os.path.join(BOTS, name)
        grind = os.path.join(d, "grind.log")

        for line in new_lines(grind, mem["offsets"]):
            if DEATH.search(line):
                stamp = line.split(" ", 1)[0]
                say(f"death:{name}:{stamp}", "DEATH", name, line[:200])

        state = read_json(os.path.join(d, "todo-state.json"), {})
        items = next((v for k, v in todo.items() if k.lower() == low), [])
        finished = {script_key(i.get("script", "")) for i in items if i.get("done") or (state.get(i["questId"]) or {}).get("done")}
        for item in items:
            qid = item["questId"]
            st = state.get(qid) or {}
            if item.get("done") or st.get("done"):
                continue
            wait = st.get("wait")
            if wait and wait.get("kind") == "stock":
                since = iso_seconds(wait["since"])
                if now - since >= STOCK_WAIT_MIN * 60:
                    say(f"stock:{name}:{qid}:{wait['since']}", "STOCK_WAIT", name, f"{qid} has waited since {wait['since']} for {wait.get('why')}", REPEAT_S)
            key_script = script_key(item.get("script", ""))
            if key_script not in LEGENDS_PATH or (st.get("failures") or 0) < 2:
                continue
            # Old news, or settled by a later copy of the quest (`heroes-2`) or by Legends itself.
            if now - iso_seconds(st.get("lastAt")) > RECENT_S or key_script in finished or "legends-quest" in finished:
                continue
            err = st.get("lastError") or ""
            key = f"{name}:{qid}"
            done_at = [t for t in mem["rearmed"].get(key, []) if now - t < DAY_S]
            if SAFE_FAILURE.search(err) and len(done_at) < REARM_MAX:
                # Don't stack re-arms on one the runner hasn't picked up yet (it may still be the old runner).
                rearm = os.path.join(d, "todo-rearm.json")
                if not os.path.exists(rearm):
                    if not DRY:
                        write_json(rearm, sorted(set(read_json(rearm, [])) | {qid}))
                    mem["rearmed"][key] = done_at + [now]
                    say(f"rearm:{key}:{now}", "REARMED", name, f"{qid} failed only with: {err}")
                continue
            say(f"gaveup:{key}:{st.get('lastAt')}", "GAVE_UP", name, f"{qid}: {err[:160]}")

        if low in swarm or low in skip:
            continue
        if low not in running:
            say(f"down:{name}", "DOWN", name, "container is not running and the account is not on skip-bots or swarm", REPEAT_S)
            continue
        mem["said"].pop(f"down:{name}", None)
        latest = max((os.path.getmtime(p) for p in (grind, os.path.join(d, "events.log")) if os.path.exists(p)), default=0)
        limit = MULE_STALL_MIN if "quest-mule" in " ".join(map(str, bot.get("args", []))) else STALL_MIN
        if latest and now - latest >= limit * 60:
            say(f"stall:{name}", "STALLED", name, f"no log line for {int((now - latest) / 60)}m", REPEAT_S)
        elif latest:
            mem["said"].pop(f"stall:{name}", None)

    for a in alerts:
        print(a)
    if DRY:
        return
    if alerts:
        with open(ALERTS, "a") as f:
            f.write("\n".join(alerts) + "\n")
    mem["said"] = {k: v for k, v in mem["said"].items() if now - v < 14 * DAY_S}
    write_json(MEMORY, mem)


if __name__ == "__main__":
    main()
