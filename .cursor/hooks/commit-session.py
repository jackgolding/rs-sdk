#!/usr/bin/env python3
"""Require a Session trailer on git commit, and refuse to stage bot.env."""
import json
import re
import sys

SESSION_RE = re.compile(
    r"Session:\s*[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


def emit(obj):
    sys.stdout.write(json.dumps(obj))
    sys.stdout.write("\n")


def deny(user_message, agent_message):
    emit({
        "permission": "deny",
        "user_message": user_message,
        "agent_message": agent_message,
    })


def main():
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        emit({"permission": "allow"})
        return
    command = payload.get("command") if isinstance(payload.get("command"), str) else ""
    conversation = payload.get("conversation_id") or "unknown"
    if re.search(r"\bgit\b", command) and re.search(r"\badd\b", command) and "bot.env" in command:
        deny(
            "bot.env stays untracked.",
            "Do not git add bot.env. It is a credential file.",
        )
        return
    is_commit = re.search(r"\bgit\b", command) and re.search(r"\bcommit\b", command)
    has_message = bool(re.search(r"(^|\s)(-m|--message|-F|--file)(\s|=)", command))
    if is_commit and has_message and not SESSION_RE.search(command):
        deny(
            "Commit message needs a Session trailer.",
            "Add this trailer to the commit body, then retry: Session: %s" % conversation,
        )
        return
    emit({"permission": "allow"})


if __name__ == "__main__":
    try:
        main()
    except Exception:
        emit({"permission": "allow"})
        sys.exit(0)
