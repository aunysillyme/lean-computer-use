#!/usr/bin/env python3
"""Shared cua-driver calls, app resolution and private desk state."""
import json
import os
import re
import stat
import subprocess
import tempfile
import time
from pathlib import Path

STATE = Path(os.environ.get("DESK_STATE_DIR", "~/.local/state/desk")).expanduser()
CACHE = STATE / "apps.json"
# prepare_state writes this marker; deletion (prune, desk-clean) needs it in the dir.
MARKER = ".desk-state"
DRIVER_MARKER = "driver-started"
DRIVER_START_WAIT = 10.0
WINDOW_WAIT = 5.0
# Only files desk itself writes are ever pruned: apps.json plus tempfile-named
# "<tool>-<8 random [a-z0-9_]>.json" results. Anything else in the dir is not ours.
OWN_FILES = re.compile(r"^(?:apps|[A-Za-z0-9_-]+-[a-z0-9_]{8})\.json$")
READ_TOOLS = {"get_window_state", "list_windows", "list_apps", "verify_state"}
WINDOW_GONE = re.compile(r"window_id_not_found|no such window|window not found", re.I)


class DeskError(Exception):
    """A safe, one-line error suitable for stderr."""


def state_is_ours():
    """True only for a real desk state dir: marker present, our uid, mode 0700."""
    try:
        info = STATE.stat()
        marker = (STATE / MARKER).lstat()
    except OSError:
        return False
    return (stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o700
            and stat.S_ISREG(marker.st_mode) and marker.st_uid == os.getuid())


def prepare_state():
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    marker = STATE / MARKER
    # Only claim a directory that is new or empty; a populated foreign dir stays unmarked.
    if not os.path.lexists(marker) and not any(STATE.iterdir()):
        try:
            os.close(os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600))
        except FileExistsError:
            pass
    if not state_is_ours():
        return
    cutoff = time.time() - 7 * 24 * 60 * 60
    for path in STATE.iterdir():
        try:
            if (OWN_FILES.match(path.name) and path.is_file() and not path.is_symlink()
                    and path.stat().st_mtime < cutoff):
                path.unlink()
        except FileNotFoundError:
            pass


def save_json(value, filename=None, prefix="read"):
    prepare_state()
    prefix = re.sub(r"[^A-Za-z0-9_-]", "_", prefix)
    fd, name = tempfile.mkstemp(prefix=prefix + "-", suffix=".json", dir=STATE)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False)
        handle.write("\n")
    if filename is not None:
        os.replace(name, filename)
        return Path(filename)
    return Path(name)


def driver_command(command, timeout=5):
    try:
        return subprocess.run(["cua-driver", command], capture_output=True,
                              text=True, timeout=timeout)
    except OSError:
        raise DeskError(f"cua-driver {command}: executable unavailable") from None
    except subprocess.TimeoutExpired:
        raise DeskError(f"cua-driver {command} timed out") from None


def driver_status(timeout=5):
    result = driver_command("status", timeout)
    if result.returncode == 0 and "daemon is running" in result.stdout:
        return True
    if "not running" in result.stdout + result.stderr:
        return False
    return None


def record_driver_lease(launched):
    """Record a lease for the daemon this call started, so cleanup can prove it owns it.

    A daemon that cannot be tracked is stopped again: nothing may keep running without an owner on record."""
    try:
        from _lease import record_driver
        record_driver(launched)
    except Exception:
        try:
            driver_command("stop")
        except DeskError:
            pass
        raise DeskError("cannot record a lease for the cua-driver daemon this call started; it was stopped") from None


def ensure_driver():
    if driver_status() is True:
        return
    prepare_state()
    launched = time.time()
    try:
        result = subprocess.run(["open", "-g", "-a", "/Applications/CuaDriver.app", "--args", "serve"],
                                capture_output=True, text=True, timeout=5)
    except OSError:
        raise DeskError("cannot start cua-driver: open executable unavailable") from None
    except subprocess.TimeoutExpired:
        raise DeskError("cannot start cua-driver: open timed out") from None
    if result.returncode:
        raise DeskError(f"cannot start cua-driver: open exited {result.returncode}")
    # Keep launch ownership even if the daemon does not become ready in time.
    fd = os.open(STATE / DRIVER_MARKER,
                 os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as handle:
        os.fchmod(handle.fileno(), 0o600)
    deadline = time.monotonic() + DRIVER_START_WAIT
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise DeskError("cannot start cua-driver: daemon not running within 10 s")
        try:
            if driver_status(min(2, remaining)) is True:
                record_driver_lease(launched)
                return
        except DeskError as error:
            # One slow status probe is not a failed start; keep polling until the deadline.
            if "timed out" not in str(error):
                raise
        time.sleep(min(0.1, max(0, deadline - time.monotonic())))


def call(tool, args, timeout=30):
    ensure_driver()
    try:
        result = subprocess.run(
            ["cua-driver", "call", tool, json.dumps(args)],
            capture_output=True, text=True, timeout=timeout,
        )
    except FileNotFoundError:
        raise DeskError("cua-driver executable not found") from None
    except subprocess.TimeoutExpired:
        raise DeskError("cua-driver call timed out") from None
    try:
        return result.returncode, json.loads(result.stdout)
    except ValueError:
        # Raw driver output can contain private UI data. Save it, never echo it.
        return result.returncode or 1, {"error": "invalid cua-driver JSON", "raw": result.stdout + result.stderr}


def alive(pid):
    if type(pid) is not int or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def app_cache():
    try:
        with CACHE.open(encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def invalidate(bid):
    cache = app_cache()
    cache.pop(bid, None)
    save_json(cache, filename=CACHE, prefix="apps")


def window_rank(w):
    # Multi-window apps (Electron) list hidden 39px strips before the real window, none flagged main.
    b = w.get("bounds") if isinstance(w.get("bounds"), dict) else {}
    area = (b.get("width") or 0) * (b.get("height") or 0)
    return (bool(w.get("is_main")), bool(w.get("is_on_screen")),
            bool(w.get("on_current_space")), bool(w.get("title")), area)


def resolve(bid):
    prepare_state()
    cache = app_cache()
    entry = cache.get(bid)
    if (isinstance(entry, dict) and alive(entry.get("pid"))
            and type(entry.get("window_id")) is int):
        return entry["pid"], entry["window_id"], True
    deadline = time.monotonic() + WINDOW_WAIT
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        try:
            rc, launch = call("launch_app", {"bundle_id": bid}, timeout=remaining)
        except DeskError as error:
            if str(error) == "cua-driver call timed out":
                break
            raise
        if not isinstance(launch, dict):
            break
        detail = launch.get("detail")
        detail = detail if isinstance(detail, dict) else {}
        windows = launch.get("windows") or detail.get("windows") or []
        visible = [w for w in windows if isinstance(w, dict) and not w.get("is_minimized")
                   and type(w.get("window_id")) is int]
        window = max(visible, key=window_rank) if visible else None
        pid = launch.get("pid") or detail.get("pid")
        if not rc and type(pid) is int and pid > 0 and window:
            cache[bid] = {"pid": pid, "window_id": window["window_id"]}
            save_json(cache, filename=CACHE, prefix="apps")
            return pid, window["window_id"], False
        error = str(launch.get("error") or "").lower()
        if any(term in error for term in ("not found", "unknown bundle", "invalid bundle", "no application")):
            break
        time.sleep(min(0.3, max(0, deadline - time.monotonic())))
    safe_bid = bid.replace("\n", " ").replace("\r", " ")
    raise DeskError(f"cannot resolve app {safe_bid}: unknown bundle id or no usable window within 5 s")


def window_error(rc, result):
    return (rc != 0 or isinstance(result, dict) and bool(result.get("error"))) and "window" in str(result).lower()


def retry_safe(tool, result):
    """Re-sending is safe for reads, or when the window never existed for the call."""
    if tool in READ_TOOLS:
        return True
    error = result.get("error") if isinstance(result, dict) else result
    return bool(WINDOW_GONE.search(str(error)))


def run_tool(bid, tool, args):
    pid, wid, cached = resolve(bid)
    args = dict(args, pid=pid, window_id=wid)
    rc, result = call(tool, args)
    if window_error(rc, result):
        invalidate(bid)
        if not retry_safe(tool, result):
            # An action may have partly landed (typed 3 of 7 characters): never re-send it.
            return rc, result, pid, wid, cached
        pid, wid, cached = resolve(bid)
        args.update(pid=pid, window_id=wid)
        rc, result = call(tool, args)
    return rc, result, pid, wid, cached


NODE_START = re.compile(
    r"^\s*(?:[-*+|>]\s*)?(?:\[[^\]\n]+\]\s*)?(?:\d+[:.)]\s*)?"
    r"(?:\*\*|`)?AX(?:SecureTextField|StaticText|Button|TextField|TextArea|Window|Group|Menu(?:Item|Bar)?|"
    r"Row|Cell|Table|ScrollArea|SplitGroup|Toolbar|CheckBox|RadioButton|"
    r"PopUpButton|ComboBox|Slider|Image|Link|List|Outline|TabGroup|"
    r"ScrollBar|ProgressIndicator|Application)\b")


def redact(value):
    """Never echo a secure node or a markdown line containing its value."""
    if isinstance(value, dict):
        if any(v.strip() == "AXSecureTextField" for v in value.values() if isinstance(v, str)):
            return {"role": "AXSecureTextField", "value": "[REDACTED]"}
        return {k: redact(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v) for v in value]
    if isinstance(value, str):
        # A node runs from its node-start line to the next one. If any line of it names
        # AXSecureTextField, whether before or after the value, every line of the node is
        # replaced (one output line per input line, so line-aligned callers keep working).
        lines = value.splitlines()
        out, node = [], []

        def flush():
            secure = any("AXSecureTextField" in line for line in node)
            out.extend("[AXSecureTextField REDACTED]" if secure else line for line in node)
            node.clear()

        for line in lines:
            if NODE_START.search(line):
                flush()
            node.append(line)
        flush()
        return "\n".join(out)
    return value
