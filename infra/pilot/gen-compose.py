#!/usr/bin/env python3
"""Generate compose.fleet.yml from bots/roster.json — one lite+quest pair per bot.

Mirrors the macOS launchd topology (com.rs-sdk.lite.<name> /
com.rs-sdk.bot.<name>): restart policies, 700s quest drain, capped logs.
Usage: python3 infra/pilot/gen-compose.py > infra/pilot/compose.fleet.yml
Re-run whenever roster scripts/args change; commit the output.
"""
import json
import os

HEADER = """# GENERATED from bots/roster.json — do not edit by hand.
# Regenerate: python3 infra/pilot/gen-compose.py > infra/pilot/compose.fleet.yml
# Mirrors launchd per-bot pairs: restart ≈ KeepAlive, 700s quest drain ≈ ExitTimeOut.
name: fleet
"""

BASE = """x-runner: &runner
  build:
    context: ../..
    dockerfile: infra/pilot/Dockerfile
  image: fleet-pilot:latest
"""

SVC = """  {svc}:
    <<: *runner
    working_dir: {workdir}
    command: {cmd}
    volumes:
      # Whole bots tree (quests + every per-bot dir + roster.json): quest
      # scripts import sibling bots (e.g. bowstrings -> ../Jackpoo1/...), so
      # per-bot mounts break cross-imports and shadowing is avoided by
      # syncing host quests too. See README sync command.
      - /srv/fleet/bots:/opt/fleet/bots
{extra}    restart: unless-stopped
"""

LOGGING = """    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "3"
"""


def sh(words):
    out = []
    for w in words:
        if any(c in w for c in ' \t"'):
            w = '"' + w.replace('"', '\\"') + '"'
        out.append(w)
    return "[" + ", ".join('"%s"' % w for w in words) + "]"


# One process for every account in bots/swarm.json (server/webclient/src/lite/
# swarm-jobs.ts): those accounts get NO lite-/quest- pair below. ~10 MiB per
# account instead of ~400 MiB. They must also be in skip-bots.txt until
# fleet-status learns to read swarm-status.json, or the shepherd will try to wake them.
SWARM = """  swarm:
    <<: *runner
    working_dir: /opt/fleet/server/webclient
    command: ["bun", "/opt/fleet/bots/quests/swarm-jobs.ts", "--config=/opt/fleet/bots/swarm.json"]
    volumes:
      - /srv/fleet/bots:/opt/fleet/bots
""" + LOGGING + """    # SIGTERM parks every account at its bank (<=120s) before logging out.
    stop_grace_period: 150s
    mem_limit: 768m
    restart: unless-stopped
"""


def swarm_names():
    if not os.path.exists("bots/swarm.json"):
        return set()
    with open("bots/swarm.json") as f:
        return {a["name"] for a in json.load(f).get("accounts", [])}


def main():
    with open("bots/roster.json") as f:
        r = json.load(f)
    bots = r if isinstance(r, list) else r.get("bots", r)
    in_swarm = swarm_names()
    print(HEADER)
    print(BASE)
    print("services:")
    if in_swarm:
        print(SWARM, end="")
    for b in sorted(bots, key=lambda x: x["name"].lower()):
        name = b["name"]
        if name in in_swarm:
            continue
        slug = name.lower()
        script = b["script"]
        args = b.get("args", [name])
        extra_lite = LOGGING
        print(SVC.format(svc="lite-" + slug, name=name,
                         workdir="/opt/fleet/server/webclient",
                         cmd=sh(["bun", "src/lite/runner.ts", name]),
                         extra=extra_lite), end="")
        extra_quest = ("      - /srv/fleet/bots/roster.json:/opt/fleet/bots/roster.json:ro\n"
                       + LOGGING +
                       "    stop_grace_period: 700s\n")
        print(SVC.format(svc="quest-" + slug, name=name,
                         workdir="/opt/fleet",
                         cmd=sh(["bun", script] + args),
                         extra=extra_quest), end="")


if __name__ == "__main__":
    main()
