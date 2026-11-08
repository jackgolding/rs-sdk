#!/usr/bin/env python3
"""
Stockpile capes of legends (user, 2026-11-08): fleet-capes.timer runs this every 4 hours. It queues, at the front of
one finished account's todo list (accounts that have completed Legends, in rotation, least recently used first),
a legends-capes.ts buy-out over several restocks. The capes stay in that account's bank: a cape of legends is
tradeable=no (the first delivery to jackthief failed offer_failed ten times, 2026-11-08).
Skips a turn while the last queued run has not finished. --dry prints the choice and writes nothing.
"""
import datetime, json, os, sys

BOTS = os.environ.get("FLEET_BOTS_DIR", "/srv/fleet/bots")
STATE = os.environ.get("FLEET_STATE_DIR", "/srv/fleet/state")
MEMORY = os.path.join(STATE, "fleet-capes.json")
DRY = "--dry" in sys.argv
MULE = "jackthief"


def read(path, fallback):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return fallback


def done(acct, qid):
    s = read(os.path.join(BOTS, acct, "todo-state.json"), {})
    return bool((s.get(qid) or {}).get("done"))


def main():
    todo = read(os.path.join(BOTS, "todo.json"), {}).get("accounts", {})
    mem = read(MEMORY, {"last": {}, "pending": None})
    if mem.get("pending"):
        acct, qid = mem["pending"]
        if not done(acct, qid):
            print(f"{acct} {qid} still pending: skipping this turn")
            return
        mem["pending"] = None
    swarm = {a["name"] for a in read(os.path.join(BOTS, "swarm.json"), {}).get("accounts", [])}
    finished = [a for a, items in todo.items() if a != MULE and a not in swarm and any(i["questId"] == "legends" and (i.get("done") or done(a, "legends")) for i in items)]
    if not finished:
        print("no account has finished Legends")
        return
    acct = sorted(finished, key=lambda a: mem["last"].get(a, ""))[0]
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M")
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    buy = f"capes-{stamp}"
    meta = {"addedAt": now, "canaryRunId": "fleet-capes", "note": "user: stockpile capes of legends"}
    items = [
        {"questId": buy, "script": "bots/quests/legends-capes.ts", "args": ["--rounds=8"], "capMin": 90, **meta},
    ]
    print(f"queue {buy} on {acct}")
    if DRY:
        return
    path = os.path.join(BOTS, "todo.json")
    full = read(path, None)
    full["accounts"][acct][0:0] = items
    tmp = f"{path}.tmp-{os.getpid()}"
    with open(tmp, "w") as f:
        json.dump(full, f, indent=2)
    os.replace(tmp, path)
    mem["last"][acct] = now
    mem["pending"] = [acct, buy]
    with open(MEMORY + ".tmp", "w") as f:
        json.dump(mem, f, indent=1)
    os.replace(MEMORY + ".tmp", MEMORY)


if __name__ == "__main__":
    main()
