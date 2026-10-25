"""Small, local helpers shared by the native-app hooks."""
import contextlib
import fcntl
import hashlib
import json
import os
import re
import shlex
import stat
import tempfile
from pathlib import Path

NATIVE = re.compile(r"^mcp__(?:computer-use|cua-driver)__(.+)$")
PROBES = {"list_apps", "list_windows", "launch_app", "end_session", "status", "list_tools"}
DESK_COMMANDS = {"desk", "desk-read", "desk-clean"}


def target_key(value):
    if value is None:
        return None
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def command_parts(command):
    """Keep quoted text intact while finding shell command boundaries."""
    parts, current, chained = [], [], False
    quote, escaped, index = None, False, 0
    while index < len(command):
        char = command[index]
        if escaped:
            current.append(char)
            escaped = False
        elif char == "\\" and quote != "'":
            current.append(char)
            escaped = True
        elif quote:
            current.append(char)
            if char == quote:
                quote = None
        elif char in "\"'":
            current.append(char)
            quote = char
        elif char == "#" and (not current or current[-1].isspace()):
            while index < len(command) and command[index] != "\n":
                index += 1
            continue
        elif char in ";&|\n":
            tokens = shlex.split("".join(current), comments=True)
            if tokens:
                parts.append(tokens)
            current = []
            if command[index:index + 2] == "&&":
                chained = True
                index += 1
        else:
            current.append(char)
        index += 1
    tokens = shlex.split("".join(current), comments=True)
    if tokens:
        parts.append(tokens)
    return parts, chained


def native_call(payload):
    name = payload.get("tool_name")
    inputs = payload.get("tool_input", {})
    if not isinstance(inputs, dict):
        return None
    match = NATIVE.fullmatch(name) if isinstance(name, str) else None
    if match:
        target = {key: inputs[key] for key in
                  ("bundle_id", "bundle_identifier", "app_name", "app", "pid", "window_id")
                  if key in inputs}
        return {"probe": match[1] in PROBES, "read": False, "batch": False,
                "target": target_key(target or None)}
    if name != "Bash" or not isinstance(inputs.get("command"), str):
        return None
    # A here-document body is data rather than a sequence of shell commands.
    if "<<" in inputs["command"]:
        return None
    parts, chained = command_parts(inputs["command"])
    calls = [part for part in parts if Path(part[0]).name in DESK_COMMANDS]
    if not calls:
        return None
    probes = [Path(part[0]).name == "desk" and len(part) > 2 and part[2] in PROBES
              for part in calls]
    return {"probe": all(probes),
            "read": any(Path(part[0]).name in {"desk-read", "desk-clean"} for part in calls),
            "batch": chained and len(calls) >= 2,
            "target": target_key(calls[0][1] if len(calls[0]) > 1 else None)}


def fingerprint(payload):
    value = str(payload["tool_name"]) + json.dumps(payload.get("tool_input", {}),
                                                  sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(value.encode()).hexdigest()


def response_text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(response_text(item) for item in value)
    if isinstance(value, dict):
        return "\n".join(response_text(value[key]) for key in ("text", "content", "stdout", "output")
                         if key in value)
    return ""


def failed(payload):
    response = payload.get("tool_response", {})
    if isinstance(response, dict):
        if response.get("isError") is True or response.get("is_error") is True or response.get("error"):
            return True
        if payload["tool_name"] == "Bash":
            for key in ("exit_code", "exitCode", "exit_status", "returncode"):
                if isinstance(response.get(key), int) and response[key] != 0:
                    return True
            if re.match(r"^\s*desk(?:-read|-clean)?\s*:", str(response.get("stderr", "")), re.I):
                return True
    text = response_text(response).lstrip()
    return bool(re.match(r"error\b", text, re.I))


def state_root():
    default = Path(os.environ.get("TMPDIR") or "/tmp") / f"lean-computer-use-{os.getuid()}"
    path = Path(os.environ.get("LEAN_COMPUTER_USE_STATE") or default)
    path.mkdir(parents=True, mode=0o700, exist_ok=True)
    info = path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != 0o700):
        raise OSError("hook state directory must be owned by this user and mode 0700")
    return path


def private_open(path, flags):
    fd = os.open(path, flags | os.O_NOFOLLOW, 0o600)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
        os.close(fd)
        raise OSError("hook state must be a regular file owned by this user")
    os.fchmod(fd, 0o600)
    return fd


@contextlib.contextmanager
def session_state(payload):
    session = payload.get("session_id")
    if not isinstance(session, str) or not session:
        raise ValueError("session_id required")
    agent = payload.get("agent_id")
    identity = session + ("\0" + str(agent) if agent else "")
    key = hashlib.sha256(identity.encode()).hexdigest()[:24]
    root = state_root()
    path = root / (key + ".json")
    with os.fdopen(private_open(root / (key + ".lock"), os.O_CREAT | os.O_RDWR), "a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            with os.fdopen(private_open(path, os.O_RDONLY), "r", encoding="utf-8") as handle:
                value = json.load(handle)
            state = value if isinstance(value, dict) else {}
        except (FileNotFoundError, ValueError):
            state = {}
        yield state
        fd, temporary = tempfile.mkstemp(prefix=key + "-", dir=root)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(state, handle, separators=(",", ":"))
                handle.write("\n")
            os.replace(temporary, path)
        finally:
            Path(temporary).unlink(missing_ok=True)
