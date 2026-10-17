#!/usr/bin/env python3
"""Selective rollout planner for the VPS fleet deploy.

Usage: python3 infra/pilot/rollout.py BEFORE NOW [EXTRA ...]

Compares git refs BEFORE..NOW plus any EXTRA quest filenames (for
repo-vs-live-mount drift) and prints shell assignments:

  NEED_BUILD=0/1            # sdk/server/Dockerfile/support-code changed
  CONFIG_UP="quest-a ..."   # roster script/args changed -> plain `up -d`
  CODE_UP="quest-b ..."     # quest file changed, config same -> --force-recreate
  LITE_UP="lite-c ..."      # brand-new bots need their lite side too
  REMOVED="name ..."        # bots dropped from the roster (manual cleanup)

Lite services are never restarted by quest-only changes: the lite runner
does not import quest code, so a quest update cannot break it.
"""
import json
import subprocess
import sys


def sh(*args):
    return subprocess.run(
        args, capture_output=True, text=True, check=True
    ).stdout


def load_roster(ref_or_path, from_git):
    if from_git:
        raw = sh("git", "show", f"{ref_or_path}:bots/roster.json")
    else:
        with open("bots/roster.json") as f:
            raw = f.read()
    data = json.loads(raw)
    bots = data if isinstance(data, list) else data.get("bots", data)
    return {b["name"]: b for b in bots}


def main():
    before, now = sys.argv[1], sys.argv[2]
    extra = sys.argv[3:]
    changed = sh("git", "diff", "--name-only", before, now).split()

    build_triggers = ("sdk/", "server/", "tools/fleet-desk/",
                      ".cursor/skills/wake-fleet/scripts/")
    need_build = any(
        c.startswith(build_triggers) or c == "infra/pilot/Dockerfile"
        for c in changed
    )

    code_files = {
        c.split("bots/quests/")[1]
        for c in changed
        if c.startswith("bots/quests/")
    } | set(extra)

    try:
        old = load_roster(before, from_git=True)
    except subprocess.CalledProcessError:
        old = {}
    new = load_roster("bots/roster.json", from_git=False)

    config_up, lite_up, removed = [], [], []
    for name, bot in new.items():
        slug = name.lower()
        prev = old.get(name)
        if prev is None:
            lite_up.append(f"lite-{slug}")
            config_up.append(f"quest-{slug}")
        elif (prev.get("script") != bot.get("script")
              or prev.get("args", [name]) != bot.get("args", [name])):
            config_up.append(f"quest-{slug}")
    for name in old:
        if name not in new:
            removed.append(name)

    script_of = {b["name"]: b.get("script", "") for b in new.values()}
    code_up = []
    for fname in sorted(code_files):
        path = f"bots/quests/{fname}"
        for name, script in script_of.items():
            if script == path and f"quest-{name.lower()}" not in config_up:
                code_up.append(f"quest-{name.lower()}")

    print(f"NEED_BUILD={1 if need_build else 0}")
    print(f'CONFIG_UP="{" ".join(sorted(set(config_up)))}"')
    print(f'CODE_UP="{" ".join(sorted(set(code_up)))}"')
    print(f'LITE_UP="{" ".join(sorted(set(lite_up)))}"')
    print(f'REMOVED="{" ".join(sorted(set(removed)))}"')


if __name__ == "__main__":
    main()
