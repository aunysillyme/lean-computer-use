#!/usr/bin/env python3
"""Desktop-control state shared by the touch hook, the stop gate, keep and doctor.

One file per main session or subagent records when native control was last used and last
released. It stores timestamps, counts, server names and a session hash, never screen text.
"""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import re
import stat
import sys
import tempfile
import time
from pathlib import Path

RUNNER = "desk-runner"
SERVER = re.compile(r"^mcp__(computer-use|cua-driver)__(.+)$")
PROBES = {"list_apps", "list_windows", "app_list_windows", "list_granted_applications",
          "request_access", "status", "list_tools"}
CLOSES = {"release_full_control", "app_release", "end_session"}
CLOSE_TOOLS = {"computer-use": "release_full_control or app_release", "cua-driver": "end_session"}
FILE = re.compile(r"^[0-9a-f]{24}\.json$")
DAY_MS = 86_400_000
STALE_MS = 600_000


def now_ms():
    return int(time.time() * 1000)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def valid_id(value):
    return isinstance(value, str) and 0 < len(value) <= 200 and "\0" not in value


def surfaces_dir(env=None):
    env = os.environ if env is None else env
    if env.get("LEAN_COMPUTER_USE_SURFACES"):
        return Path(env["LEAN_COMPUTER_USE_SURFACES"])
    base = env.get("XDG_STATE_HOME") or str(Path.home() / ".local" / "state")
    return Path(base) / "lean-computer-use" / "surfaces"


def private(info, mode):
    return info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == mode


def checked_dir(create):
    path = Path(os.path.abspath(surfaces_dir()))
    for ancestor in reversed(path.parents):
        if ancestor.is_symlink():
            raise OSError("surface state path must not pass through a symlink")
    if create:
        path.mkdir(parents=True, mode=0o700, exist_ok=True)
    elif not os.path.lexists(path):
        return None
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or not private(info, 0o700):
        raise OSError("surface state directory must be owned by this user and mode 0700")
    return path


def is_dirty(use):
    """Control used since its last successful release and not held for the user."""
    return (isinstance(use, dict) and not use.get("kept")
            and isinstance(use.get("lastAction"), int) and use["lastAction"] > (use.get("lastClose") or 0))


def is_pending(use):
    """Dirty control the gate has not yet resolved for this stretch."""
    return is_dirty(use) and (use.get("resolvedAt") or 0) < use["lastAction"]


def read(path):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return {}
    with os.fdopen(fd, "r", encoding="utf-8") as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or not private(info, 0o600):
            raise OSError("surface state must be a regular file owned by this user with mode 0600")
        value = json.load(handle)
    return value if isinstance(value, dict) else {}


def write(path, state):
    fd, temporary = tempfile.mkstemp(prefix=".tmp-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(state, handle, separators=(",", ":"))
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


@contextlib.contextmanager
def locked(create=True):
    """Hold the directory lock, prune files older than a day, and yield the directory."""
    root = checked_dir(create)
    if root is None:
        yield None
        return
    fd = os.open(root / ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "a+") as lock:
        info = os.fstat(lock.fileno())
        if not stat.S_ISREG(info.st_mode) or not private(info, 0o600):
            raise OSError("surface lock must be a regular file owned by this user with mode 0600")
        fcntl.flock(lock, fcntl.LOCK_EX)
        cutoff = time.time() - DAY_MS / 1000
        for entry in root.iterdir():
            info = entry.lstat()
            if (FILE.match(entry.name) or entry.name.startswith(".tmp-")) and stat.S_ISREG(info.st_mode) and info.st_mtime < cutoff:
                entry.unlink(missing_ok=True)
        yield root


def key_file(root, session, agent=None):
    return root / (digest(session + ("\0" + agent if agent else ""))[:24] + ".json")


def touch(payload):
    """PostToolUse: an action dirties the desktop surface; a successful close cleans it."""
    if not isinstance(payload, dict) or payload.get("hook_event_name") != "PostToolUse":
        return
    match = SERVER.fullmatch(payload.get("tool_name") or "") if isinstance(payload.get("tool_name"), str) else None
    session, agent = payload.get("session_id"), payload.get("agent_id")
    if not match or not valid_id(session) or (agent is not None and not valid_id(agent)):
        return
    server, name = match[1], match[2]
    close = name in CLOSES
    if close:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from _common import failed
        if failed(payload):
            return
    elif name in PROBES:
        return
    with locked(create=not close) as root:
        if root is None:
            return
        path = key_file(root, session, agent)
        state = read(path)
        surfaces = state.setdefault("surfaces", {})
        if close and "desktop" not in surfaces:
            return
        state["session"] = digest(session)
        moment = now_ms()
        use = surfaces.setdefault("desktop", {"firstAction": moment, "lastAction": 0, "lastClose": 0,
                                              "actions": 0, "closes": 0, "kept": False, "servers": []})
        if close:
            use["lastClose"] = max(moment, use["lastAction"])
            use["closes"] += 1
        else:
            for item in surfaces.values():
                item["kept"] = False
            state.pop("keepReason", None)
            state.pop("blockedAt", None)
            use["lastAction"] = max(moment, use["lastClose"] + 1)
            use["actions"] += 1
            if server not in use["servers"]:
                use["servers"].append(server)
        write(path, state)


def block_reason(servers):
    tools = "; ".join(f"{server}: {CLOSE_TOOLS[server]}" for server in sorted(servers) if server in CLOSE_TOOLS)
    return (f"Release the desktop control this run took ({tools}). Releasing it ends the control, "
            "so apps the user already had open stay open. To hold the control for the user, run "
            "npx --yes lean-computer-use keep --reason \"<why>\". Then say what stays held and why in the reply.")


def gate(payload):
    """Stop and runner SubagentStop: block once per dirty stretch, then resolve silently."""
    if not isinstance(payload, dict) or not valid_id(payload.get("session_id")):
        return None
    session, agent = payload["session_id"], None
    event = payload.get("hook_event_name")
    if event == "SubagentStop":
        agent = payload.get("agent_id")
        if payload.get("agent_type") != RUNNER or not valid_id(agent):
            return None
    elif event == "Stop":
        tasks = payload.get("background_tasks")
        if isinstance(tasks, list) and tasks:
            return None
    else:
        return None
    with locked(create=False) as root:
        if root is None:
            return None
        path = key_file(root, session, agent)
        state = read(path)
        dirty = [use for name, use in (state.get("surfaces") or {}).items() if name == "desktop" and is_pending(use)]
        if not dirty:
            return None
        if payload.get("stop_hook_active") is True or "blockedAt" in state:
            # Silence the gate for this stretch only; lastClose still records the last real release.
            for use in dirty:
                use["resolvedAt"] = use["lastAction"]
            write(path, state)
            return None
        state["blockedAt"] = now_ms()
        write(path, state)
        servers = {server for use in dirty for server in use.get("servers") or []} or set(CLOSE_TOOLS)
        return {"decision": "block", "reason": block_reason(servers)}


def keep(reason, session):
    """Hold every recorded surface of the session, its subagents included."""
    count = 0
    with locked(create=False) as root:
        if root is None:
            return 0
        main = key_file(root, session)
        for entry in sorted(root.iterdir()):
            if not FILE.match(entry.name) or not stat.S_ISREG(entry.lstat().st_mode):
                continue
            try:
                state = read(entry)
            except (OSError, ValueError):
                if entry == main:
                    raise
                continue
            if entry != main and state.get("session") != digest(session):
                continue
            state["session"] = digest(session)
            for use in (state.get("surfaces") or {}).values():
                use["kept"] = True
                count += 1
            state["keepReason"] = reason
            write(entry, state)
    return count


def stale():
    """Sessions whose desktop surface stayed dirty for more than ten minutes."""
    sessions, cutoff = set(), now_ms() - STALE_MS
    with locked(create=False) as root:
        for entry in sorted(root.iterdir()) if root else []:
            if not FILE.match(entry.name) or not stat.S_ISREG(entry.lstat().st_mode):
                continue
            state = read(entry)
            for use in (state.get("surfaces") or {}).values():
                if is_dirty(use) and use["lastAction"] < cutoff:
                    sessions.add(state.get("session") or entry.name)
    return len(sessions)


def hook(kind):
    """Hook entry: read stdin, act, and exit 0 on every path."""
    try:
        payload = json.load(sys.stdin)
        if kind == "touch":
            touch(payload)
        else:
            result = gate(payload)
            if result:
                print(json.dumps(result))
    except Exception:
        pass
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="_surfaces.py")
    commands = parser.add_subparsers(dest="command", required=True)
    held = commands.add_parser("keep")
    held.add_argument("--reason", required=True)
    held.add_argument("--session")
    commands.add_parser("stale")
    args = parser.parse_args(argv)
    if args.command == "stale":
        print(json.dumps({"sessions": stale()}))
        return 0
    reason = args.reason.strip()
    session = args.session or os.environ.get("CLAUDE_CODE_SESSION_ID") or os.environ.get("CLAUDE_SESSION_ID") or ""
    if not reason:
        print("keep requires --reason TEXT.", file=sys.stderr)
        return 2
    if not valid_id(session):
        print("keep requires --session ID or a session environment variable (at most 200 characters).", file=sys.stderr)
        return 2
    print(f"keep: {keep(reason, session)} surface(s) held: {reason}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
