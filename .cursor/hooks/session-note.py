#!/usr/bin/env python3
"""Stop hook: append a session note. Never edits skills or follows up."""
import json
import os
import re
import sys
from datetime import datetime, timezone

NOTES_ENV = "SESSION_NOTES_DIR"


def emit(obj):
    sys.stdout.write(json.dumps(obj))
    sys.stdout.write("\n")


def repo_root(payload):
    roots = payload.get("workspace_roots") or []
    if roots and isinstance(roots[0], str):
        return roots[0]
    return os.getcwd()


def notes_dir(root):
    override = os.environ.get(NOTES_ENV)
    if override:
        return override
    return os.path.join(root, ".cursor", "session-notes")


def safe_id(value):
    text = value if isinstance(value, str) and value else "unknown"
    return re.sub(r"[^A-Za-z0-9._-]", "_", text)[:80]


def rel_path(root, path):
    if not isinstance(path, str) or not path:
        return None
    try:
        rel = os.path.relpath(path, root)
    except ValueError:
        return None
    if rel.startswith("..") or os.path.isabs(rel):
        return None
    return rel


def pending_path(root, payload):
    directory = os.path.join(notes_dir(root), "pending")
    return os.path.join(directory, safe_id(payload.get("conversation_id")))


def record_edit(payload):
    root = repo_root(payload)
    rel = rel_path(root, payload.get("file_path"))
    if not rel or rel.startswith(".cursor/session-notes/"):
        return
    path = pending_path(root, payload)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    existing = []
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as handle:
            existing = [line.strip() for line in handle if line.strip()]
    if rel not in existing:
        existing.append(rel)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(existing) + "\n")


def last_ask(transcript_path):
    if not isinstance(transcript_path, str) or not os.path.isfile(transcript_path):
        return ""
    size = os.path.getsize(transcript_path)
    with open(transcript_path, "rb") as handle:
        handle.seek(max(0, size - 65536))
        data = handle.read().decode("utf-8", "replace")
    matches = re.findall(r"<user_query>\s*(.*?)\s*</user_query>", data, re.S)
    if not matches:
        return ""
    text = " ".join(matches[-1].split())
    return text[:240]


def write_note(payload):
    root = repo_root(payload)
    path = pending_path(root, payload)
    if not os.path.isfile(path):
        return
    with open(path, "r", encoding="utf-8") as handle:
        rels = []
        for line in handle:
            rel = line.strip()
            if rel and rel not in rels:
                rels.append(rel)
    os.remove(path)
    skills = [rel for rel in rels if rel.startswith(".cursor/skills/")]
    files = [rel for rel in rels if rel not in skills]
    if not skills and not files:
        return
    directory = notes_dir(root)
    # This hook's only write is under session-notes. It does not open skills.
    if os.path.basename(directory) != "session-notes" and NOTES_ENV not in os.environ:
        return
    os.makedirs(directory, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    month = stamp[:7]
    note_path = os.path.join(directory, "notes-%s.md" % month)
    if not note_path.startswith(os.path.abspath(directory) + os.sep):
        return
    lines = ["", "## %s" % stamp, "Session: %s" % (payload.get("conversation_id") or "unknown")]
    status = payload.get("status")
    if status:
        lines.append("Status: %s" % status)
    ask = last_ask(payload.get("transcript_path"))
    if ask:
        lines.append("Ask: %s" % ask)
    if files:
        lines.append("Files: %s" % ", ".join(files))
    if skills:
        lines.append("Skills edited by the agent (this hook did not change them): %s" % ", ".join(skills))
    with open(note_path, "a", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


def main():
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        emit({})
        return
    event = payload.get("hook_event_name") or ""
    if event == "afterFileEdit":
        record_edit(payload)
    elif event == "stop":
        write_note(payload)
    emit({})


if __name__ == "__main__":
    try:
        main()
    except Exception:
        emit({})
        sys.exit(0)
