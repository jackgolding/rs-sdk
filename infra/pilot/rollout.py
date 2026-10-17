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
import os
import subprocess
import sys
from pathlib import Path

# Workflow runs this from infra/pilot/ — resolve the repo root so relative
# paths (bots/roster.json) and git commands work from anywhere.
ROOT = Path(__file__).resolve().parents[2]


def sh(*args):
    return subprocess.run(
        args, capture_output=True, text=True, check=True, cwd=ROOT
    ).stdout


def load_roster(ref_or_path, from_git):
    if from_git:
        raw = sh("git", "show", f"{ref_or_path}:bots/roster.json")
    else:
        p = Path(ref_or_path)
        raw = p.read_text() if p.is_absolute() else (ROOT / p).read_text()
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
        old_git = load_roster(before, from_git=True)
    except subprocess.CalledProcessError:
        old_git = {}
    # Live mount is the real source of truth for what is RUNNING: failed
    # deploys advance the git HEAD without rolling, so BEFORE..NOW alone
    # would silently drop unrolled changes on the next run. Union both.
    live_path = os.environ.get("LIVE_ROSTER", "")
    try:
        live = load_roster(live_path, from_git=False) if live_path else {}
    except (OSError, ValueError):
        live = {}
    new = load_roster("bots/roster.json", from_git=False)

    config_up, lite_up, removed = [], [], []
    for name, bot in new.items():
        slug = name.lower()
        script, args = bot.get("script"), bot.get("args", [name])
        prev_git = old_git.get(name)
        prev_live = live.get(name)
        if prev_git is None and prev_live is None:
            lite_up.append(f"lite-{slug}")
            config_up.append(f"quest-{slug}")
        elif ((prev_git is not None
               and (prev_git.get("script") != script
                    or prev_git.get("args", [name]) != args))
              or (prev_live is not None
                  and (prev_live.get("script") != script
                       or prev_live.get("args", [name]) != args))):
            config_up.append(f"quest-{slug}")
    for name in live:
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
