#!/usr/bin/env python3
"""Lease-based cleanup: end only the processes this package started and can prove.

A lease is a small file written by `desk-reap spawn` (or by desk when it starts the driver
daemon). It records the process id, start time and exact command line. A process is ended
only when the live process still matches its lease and passes a strict signature check.
"""
import calendar
import json
import os
import re
import secrets
import signal
import stat
import subprocess
import sys
import time
from pathlib import Path

TERM_WAIT = 3.0
KILL_WAIT = 1.5
POLL = 0.1
ID = re.compile(r"^[0-9a-f]{16}$")
ROW = re.compile(r"^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$")
BROWSER = re.compile(r"^(?:google[ -]chrome|chromium|chrome|headless_shell|microsoft[ -]edge|msedge|brave|vivaldi|opera|firefox|"
                     r"safari|arc)(?![A-Za-z0-9_])", re.I)
DRIVER = re.compile(r"^(?:.*/)?cua-driver(?: .*)? serve(?: .*)?$")
PS = next((path for path in ("/bin/ps", "/usr/bin/ps") if os.path.exists(path)), "ps")
UID = os.getuid() if hasattr(os, "getuid") else -1


def lease_dir(env=None):
    env = os.environ if env is None else env
    if env.get("LEAN_COMPUTER_USE_LEASES"):
        return Path(env["LEAN_COMPUTER_USE_LEASES"]).resolve()
    base = env.get("XDG_STATE_HOME") or str(Path.home() / ".local" / "state")
    return Path(base) / "lean-computer-use" / "leases"


def session_from_env(env=None):
    env = os.environ if env is None else env
    return env.get("CLAUDE_CODE_SESSION_ID") or env.get("CLAUDE_SESSION_ID") or ""


def ps_table():
    result = subprocess.run([PS, "-axww", "-o", "pid=,ppid=,uid=,stat=,lstart=,command="], capture_output=True,
                            text=True, timeout=8, env=dict(os.environ, LC_ALL="C"))
    if result.returncode:
        raise OSError("ps failed")
    rows = {}
    for line in result.stdout.splitlines():
        match = ROW.match(line)
        if match:
            pid = int(match[1])
            rows[pid] = {"pid": pid, "ppid": int(match[2]), "uid": int(match[3]), "stat": match[4],
                         "start": " ".join(match[5].split()), "command": match[6]}
    return rows


def ps_one(pid):
    result = subprocess.run([PS, "-ww", "-p", str(pid), "-o", "pid=,ppid=,uid=,stat=,lstart=,command="],
                            capture_output=True, text=True, timeout=8, env=dict(os.environ, LC_ALL="C"))
    match = ROW.match(result.stdout.splitlines()[0]) if result.stdout.strip() else None
    if not match:
        return None
    return {"pid": int(match[1]), "ppid": int(match[2]), "uid": int(match[3]), "stat": match[4],
            "start": " ".join(match[5].split()), "command": match[6]}


def is_live(row):
    return bool(row) and not row["stat"].startswith("Z")


def ancestors(table, pid=None):
    pid = os.getpid() if pid is None else pid
    chain = {pid}
    row = table.get(pid)
    while row and row["ppid"] > 0 and row["ppid"] not in chain:
        chain.add(row["ppid"])
        row = table.get(row["ppid"])
    return chain


def classify(argv):
    """Return (kind, reason). kind is None when the command may not be leased."""
    if not isinstance(argv, list) or not argv or any(not isinstance(a, str) or "\0" in a for a in argv):
        return None, "the command is empty or malformed"
    exe = os.path.basename(argv[0])
    if exe == "cua-driver" and "serve" in argv[1:]:
        return "driver", ""
    if BROWSER.match(exe):
        return None, "a browser is never leased here"
    if ".app/Contents/MacOS/" in argv[0]:
        return None, "a desktop app executable is never leased"
    return "helper", ""


def live_kind(command):
    """Judge the running command line. Interpreters re-exec, so the live text is the ground truth."""
    if DRIVER.match(command):
        return "driver", ""
    if BROWSER.match(os.path.basename(command.split(" -")[0])):
        return None, "a browser is never ended here"
    return "helper", ""


def label_of(lease):
    return "cua-driver" if lease["kind"] == "driver" else os.path.basename(lease["argv"][0])


# Leases -------------------------------------------------------------------------
def secure_dir(directory):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = directory.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode) or (UID != -1 and info.st_uid != UID):
        raise OSError("unsafe lease directory")
    if stat.S_IMODE(info.st_mode) & 0o077:
        os.chmod(directory, 0o700)


def write_lease(entry, directory=None):
    directory = directory or lease_dir()
    secure_dir(directory)
    lease_id = secrets.token_hex(8)
    lease = {"v": 1, "id": lease_id, **entry}
    fd = os.open(directory / (lease_id + ".json"), os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(lease) + "\n")
    return lease


def valid(lease, lease_id):
    return (isinstance(lease, dict) and lease.get("v") == 1 and lease.get("id") == lease_id
            and type(lease.get("pid")) is int and lease["pid"] > 1 and lease.get("kind") in ("driver", "helper")
            and all(isinstance(lease.get(k), str) for k in ("start", "command", "session", "run", "created"))
            and isinstance(lease.get("argv"), list) and lease["argv"] and all(isinstance(a, str) for a in lease["argv"]))


def read_leases(directory=None):
    directory = directory or lease_dir()
    leases, invalid = [], []
    try:
        info = directory.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            return leases, [str(directory)]
        names = sorted(os.listdir(directory))
    except OSError:
        return leases, invalid
    for name in names:
        match = re.match(r"^([0-9a-f]{16})\.json$", name)
        if not match:
            continue
        path = directory / name
        try:
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or (UID != -1 and info.st_uid != UID) or stat.S_IMODE(info.st_mode) & 0o077:
                raise ValueError("not ours")
            lease = json.loads(path.read_text(encoding="utf-8"))
            if not valid(lease, match[1]):
                raise ValueError("invalid")
            leases.append(lease)
        except (OSError, ValueError):
            invalid.append(str(path))
    return leases, invalid


def remove_lease(lease, directory=None):
    directory = directory or lease_dir()
    if not ID.match(lease["id"]):
        return
    path = directory / (lease["id"] + ".json")
    try:
        if stat.S_ISREG(path.lstat().st_mode):
            path.unlink()
    except OSError:
        pass


# Scan: decide, without touching anything, what each lease proves ----------------
def protected_app(row, leader):
    """A descendant that is a browser or a desktop app outside the leader's own bundle stays running."""
    command = row["command"]
    if BROWSER.match(os.path.basename(command.split(" -")[0])):
        return True
    if ".app/Contents/" not in command:
        return False
    bundle = leader["command"].split(".app/")[0] + ".app/" if ".app/" in leader["command"] else None
    if bundle and command.startswith(bundle):
        return False
    return "/Python.app/Contents/" not in command


def subtree(table, root):
    children = {}
    for row in table.values():
        children.setdefault(row["ppid"], []).append(row)
    order, kept = [], 0
    leader = table[root]

    def walk(row):
        nonlocal kept
        for child in sorted(children.get(row["pid"], []), key=lambda r: r["pid"]):
            if not is_live(child) or child["pid"] == row["pid"]:
                continue
            if child["uid"] != UID or protected_app(child, leader):
                kept += 1
                continue
            walk(child)
            order.append({k: child[k] for k in ("pid", "start", "command", "uid")})

    walk(leader)
    return order, kept


def evaluate(lease, table, mine):
    row = table.get(lease["pid"])
    if not is_live(row):
        return {"lease": lease, "state": "gone"}
    if row["uid"] != UID or row["start"] != lease["start"] or row["command"] != lease["command"]:
        return {"lease": lease, "state": "reused"}

    def refuse(reason):
        return {"lease": lease, "state": "refused", "reason": reason}

    kind, reason = live_kind(row["command"])
    if kind is None:
        return refuse(reason)
    if kind != lease["kind"]:
        return refuse("the lease kind does not match the running command")
    if lease["pid"] in mine:
        return refuse("it is an ancestor of this cleanup run")
    kill, kept = subtree(table, lease["pid"])
    if any(item["pid"] in mine for item in kill):
        return refuse("it contains an ancestor of this cleanup run")
    return {"lease": lease, "state": "live", "row": row, "kill": kill, "kept": kept}


def scan(session=None, run=None, directory=None):
    table = ps_table()
    mine = ancestors(table)
    leases, invalid = read_leases(directory)
    items = [evaluate(lease, table, mine) for lease in leases
             if (not session or lease["session"] == session) and (not run or lease["run"] == run)]
    return items, invalid


# Reap ---------------------------------------------------------------------------
def signal_pid(pid, name):
    try:
        os.kill(pid, name)
    except OSError:
        pass


def same_process(row, snap):
    return is_live(row) and row["uid"] == snap["uid"] and row["start"] == snap["start"] and row["command"] == snap["command"]


def signal_if_same(snap, name):
    """Read the single process again right before each signal, so a recycled pid has a few milliseconds to appear."""
    try:
        row = ps_one(snap["pid"])
    except (OSError, subprocess.TimeoutExpired):
        return
    if same_process(row, snap):
        signal_pid(snap["pid"], name)


def end_all(snaps):
    def survivors():
        table = ps_table()
        return [s for s in snaps if same_process(table.get(s["pid"]), s)]

    def settle(seconds):
        limit = time.monotonic() + seconds
        while True:
            time.sleep(POLL)
            live = survivors()
            if not live or time.monotonic() >= limit:
                return live

    for snap in survivors():
        signal_if_same(snap, signal.SIGTERM)
    live = settle(TERM_WAIT)
    if live:
        # Only a process that still matches its snapshot gets SIGKILL.
        for snap in live:
            signal_if_same(snap, signal.SIGKILL)
        live = settle(KILL_WAIT)
    return len(snaps) - len(live), len(live)


def driver_busy():
    """True when the shared driver reports live sessions. An unanswered query does not block cleanup."""
    try:
        result = subprocess.run(["cua-driver", "sessions"], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return False
    text = result.stdout.strip().rstrip(".")
    return result.returncode == 0 and bool(text) and text != "No live sessions"


def parse_created(value):
    try:
        return calendar.timegm(time.strptime(value[:19], "%Y-%m-%dT%H:%M:%S"))
    except ValueError:
        return time.time()


def reap(apply=False, session=None, run=None, directory=None):
    items, invalid = scan(session, run, directory)
    result = {"apply": apply, "candidates": [], "stale": 0, "refused": [], "busy": 0, "kept": 0,
              "invalid": len(invalid), "ended": {}, "left": 0}
    for item in items:
        lease = item["lease"]
        if item["state"] in ("gone", "reused"):
            result["stale"] += 1
            if apply:
                remove_lease(lease, directory)
            continue
        if item["state"] == "refused":
            result["refused"].append({"id": lease["id"], "pid": lease["pid"], "reason": item["reason"]})
            continue
        name = label_of(lease)
        result["candidates"].append({"id": lease["id"], "name": name, "kind": lease["kind"], "pid": lease["pid"],
                                     "processes": len(item["kill"]) + 1,
                                     "age_seconds": max(0, int(time.time() - parse_created(lease["created"]))),
                                     "session": lease["session"], "run": lease["run"]})
        result["kept"] += item["kept"]
        if not apply:
            result["ended"][name] = result["ended"].get(name, 0) + len(item["kill"]) + 1
            continue
        if lease["kind"] == "driver" and driver_busy():
            result["busy"] += 1
            result["left"] += len(item["kill"]) + 1
            continue
        row = item["row"]
        ended, left = end_all([*item["kill"], {k: row[k] for k in ("pid", "start", "command", "uid")}])
        result["ended"][name] = result["ended"].get(name, 0) + ended
        result["left"] += left
        after = ps_table().get(lease["pid"])
        if not is_live(after) or after["start"] != lease["start"]:
            remove_lease(lease, directory)
    return result


def names(counts):
    parts = [re.sub(r"[\s,:]+", "_", name) + ":" + str(n) for name, n in counts.items() if n > 0]
    return ",".join(parts) or "none"


def summary(result):
    extra = ""
    if result["stale"]:
        extra += f" stale_leases={result['stale']}"
    if result["refused"]:
        extra += f" refused={len(result['refused'])}"
    if result["busy"]:
        extra += f" busy_driver={result['busy']}"
    if result["kept"]:
        extra += f" kept_other_apps={result['kept']}"
    if not result["apply"]:
        return f"cleanup (dry run): would_end={names(result['ended'])}{extra}"
    return f"cleanup: ended={names(result['ended'])} left={result['left']}{extra}"


def exit_code(result):
    return 1 if result["apply"] and (result["left"] or result["refused"]) else 0


def age_text(seconds):
    if seconds < 90:
        return f"{seconds}s"
    if seconds < 5400:
        return f"{round(seconds / 60)}m"
    if seconds < 172800:
        return f"{round(seconds / 3600)}h"
    return f"{round(seconds / 86400)}d"


# Writers: spawn, and the driver lease desk records after it starts the daemon ---
def settled_row(pid):
    """A wrapper or interpreter may re-exec just after start; wait until two reads agree."""
    previous = None
    for _ in range(10):
        row = ps_one(pid)
        if not is_live(row):
            return None
        if previous and previous["command"] == row["command"] and previous["start"] == row["start"]:
            return row
        previous = row
        time.sleep(0.1)
    return previous


def kill_group(child):
    """The child leads its own session, so its group holds exactly it and what it started."""
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except OSError:
        child.kill()


def spawn(command, session=None, run=""):
    kind, reason = classify(command)
    if kind is None:
        raise ValueError(f"Refused: {reason}.")
    try:
        child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 start_new_session=True)
    except OSError:
        raise ValueError(f"Could not start {command[0]}.") from None
    try:
        row = settled_row(child.pid)
        if row is None:
            raise RuntimeError("The command exited right away; no lease was written.")
        live, live_reason = live_kind(row["command"])
        if live != kind:
            raise ValueError(f"Refused: {live_reason or 'the running command differs from the one requested'}.")
        return write_lease({"pid": child.pid, "kind": kind, "start": row["start"], "command": row["command"], "argv": command,
                            "session": session_from_env() if session is None else session, "run": run,
                            "created": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"})
    except RuntimeError:
        raise
    except ValueError:
        kill_group(child)
        raise
    except Exception:
        kill_group(child)
        raise ValueError("Could not record the lease, so the process was stopped.") from None


def record_driver(launched_at):
    """After desk starts the daemon itself, lease the one `cua-driver serve` that began with that launch.

    More than one candidate is ambiguous (another session may have started its own), so nothing is leased."""
    table = ps_table()
    known = {(l["pid"], l["start"]) for l in read_leases()[0]}
    found = []
    for row in table.values():
        if row["uid"] != UID or not is_live(row) or live_kind(row["command"])[0] != "driver":
            continue
        try:
            began = time.mktime(time.strptime(row["start"], "%a %b %d %H:%M:%S %Y"))
        except ValueError:
            continue
        # ps reports start to the second, and Linux derives it from a whole-second boot time,
        # so a process started at the launch can read up to 2 seconds early.
        if began >= launched_at - 2:
            found.append(row)
    if len(found) != 1 or (found[0]["pid"], found[0]["start"]) in known:
        return None
    row = found[0]
    return write_lease({"pid": row["pid"], "kind": "driver", "start": row["start"], "command": row["command"],
                        "argv": row["command"].split(" "), "session": session_from_env(), "run": "",
                        "created": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"})


# Hook: SubagentStop, Stop and SessionEnd, never blocking ------------------------
RUNNER = "desk-runner"


def hook_main(stream=None):
    try:
        payload = json.load(stream or sys.stdin)
        if not isinstance(payload, dict):
            return 0
        session = payload.get("session_id")
        if not isinstance(session, str) or not session or len(session) > 200:
            return 0
        event = payload.get("hook_event_name")
        if event == "SubagentStop":
            if payload.get("agent_type") != RUNNER:
                return 0
        elif event == "Stop":
            tasks = payload.get("background_tasks")
            if isinstance(tasks, list) and any(isinstance(t, dict) and t.get("type") == "subagent" for t in tasks):
                return 0
        elif event != "SessionEnd":
            return 0
        result = reap(apply=True, session=session)
        if any(result["ended"].values()) or result["left"] or result["refused"]:
            print(summary(result), file=sys.stderr)
    except Exception:
        pass
    return 0
