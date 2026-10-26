"""Cleanup contracts: only leased, provable processes end. Every process here is a fake sleeper."""
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

DESK = Path(__file__).resolve().parents[1]
HOOKS = DESK.parent / "hooks"
REAP = DESK / "desk-reap"
sys.path.insert(0, str(DESK))
import _lease  # noqa: E402

# Fakes run on node: the macOS framework Python re-execs under another name, a native binary does not.
NODE = shutil.which("node")
SLEEP = ["-e", "setTimeout(()=>{},120000)", "--"]
IGNORE_TERM = ["-e", "process.on('SIGTERM',()=>{});setTimeout(()=>{},120000)", "--"]
pytestmark = [pytest.mark.skipif(sys.platform == "win32", reason="process tools need a POSIX ps"),
              pytest.mark.skipif(NODE is None, reason="the fake processes run on node")]


def alive(pid):
    row = _lease.ps_table().get(pid)
    return bool(row) and not row["stat"].startswith("Z")


class Lab:
    def __init__(self, tmp_path):
        self.dir = tmp_path
        self.home = tmp_path / "home"
        self.bin = tmp_path / "bin"
        self.home.mkdir()
        self.bin.mkdir()
        target = os.path.realpath(NODE)
        for name in ("cua-driver", "helper", "Google Chrome"):
            (self.bin / name).symlink_to(target)
        self.leases = tmp_path / "leases"
        self.env = dict(os.environ, HOME=str(self.home), LEAN_COMPUTER_USE_LEASES=str(self.leases),
                        PYTHONDONTWRITEBYTECODE="1")
        self.env.pop("CLAUDE_CODE_SESSION_ID", None)
        self.env.pop("CLAUDE_SESSION_ID", None)
        self.pids = set()

    def reap(self, *args, env=None, timeout=30):
        return subprocess.run([sys.executable, str(REAP), *args], capture_output=True, text=True,
                              env=dict(self.env, **(env or {})), timeout=timeout)

    def spawn(self, exe="helper", code=SLEEP, extra=(), session="S1"):
        result = self.reap("spawn", "--session", session, "--", str(self.bin / exe), *code, *extra)
        assert result.returncode == 0, result.stderr
        pid = int(result.stdout.split("pid=")[1].split()[0])
        self.pids.add(pid)
        return pid

    def start(self, exe="helper", code=SLEEP, extra=()):
        child = subprocess.Popen([str(self.bin / exe), *code, *extra], stdin=subprocess.DEVNULL,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        self.pids.add(child.pid)
        return child.pid

    def hook(self, payload, shim=False):
        raw = payload if isinstance(payload, str) else json.dumps(payload)
        command = [str(HOOKS / "cleanup_hook.sh")] if shim else [sys.executable, str(HOOKS / "cleanup_hook.py")]
        return subprocess.run(command, input=raw, capture_output=True, text=True, env=self.env, timeout=30)

    def lease_files(self):
        return sorted(os.listdir(self.leases)) if self.leases.exists() else []

    def close(self):
        for lease in _lease.read_leases(self.leases)[0]:
            self.pids.add(lease["pid"])
        for pid in self.pids:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass


@pytest.fixture
def lab(tmp_path):
    value = Lab(tmp_path)
    yield value
    value.close()


def test_spawn_writes_a_private_lease_and_cleanup_ends_the_driver(lab):
    pid = lab.spawn("cua-driver", extra=["serve"])
    assert alive(pid)
    [name] = lab.lease_files()
    assert (lab.leases / name).stat().st_mode & 0o777 == 0o600
    assert lab.leases.stat().st_mode & 0o777 == 0o700
    lease = json.loads((lab.leases / name).read_text())
    assert (lease["pid"], lease["kind"], lease["session"]) == (pid, "driver", "S1")
    result = lab.reap("cleanup", "--apply", "--all")
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.strip() == "cleanup: ended=cua-driver:1 left=0"
    assert not alive(pid)
    assert lab.lease_files() == []


def test_dry_run_is_the_default_and_ends_nothing(lab):
    pid = lab.spawn("cua-driver", extra=["serve"])
    result = lab.reap("cleanup", "--all")
    assert result.returncode == 0
    assert "candidate cua-driver pid=%d processes=1" % pid in result.stdout
    assert "cleanup (dry run): would_end=cua-driver:1" in result.stdout
    assert alive(pid) and len(lab.lease_files()) == 1
    assert json.loads(lab.reap("cleanup", "--all", "--json").stdout)["apply"] is False
    assert alive(pid)


def test_unleased_driver_lookalikes_and_apps_survive(lab):
    unleased = lab.start("cua-driver", extra=["serve"])
    plain = lab.start("helper")
    refused = lab.reap("spawn", "--", str(lab.bin / "Google Chrome"), *SLEEP)
    assert refused.returncode == 2 and "browser" in refused.stderr
    app = lab.reap("spawn", "--", "/Applications/Calculator.app/Contents/MacOS/Calculator")
    assert app.returncode == 2 and "desktop app" in app.stderr
    assert lab.reap("spawn").returncode == 2 and lab.reap("spawn", "--").returncode == 2
    assert lab.reap("spawn", "--bogus", "--", "true").returncode == 2
    assert lab.lease_files() == []
    result = lab.reap("cleanup", "--apply", "--all")
    assert result.returncode == 0 and "ended=none" in result.stdout
    assert alive(unleased) and alive(plain)


def test_forged_lease_for_a_browser_is_refused(lab):
    pid = lab.start("Google Chrome", extra=["--headless", "--user-data-dir=/tmp/x"])
    row = _lease.ps_table()[pid]
    _lease.write_lease({"pid": pid, "kind": "helper", "start": row["start"], "command": row["command"],
                        "argv": row["command"].split(" "), "session": "S1", "run": "",
                        "created": "2026-01-01T00:00:00Z"}, lab.leases)
    result = lab.reap("cleanup", "--apply", "--all")
    assert result.returncode == 1 and "refused=1" in result.stdout and "browser" in result.stderr
    assert alive(pid)


def test_pid_reuse_guard_treats_a_changed_process_as_stale(lab):
    pid = lab.start("helper")
    row = _lease.ps_table()[pid]
    base = {"pid": pid, "kind": "helper", "session": "S1", "run": "", "created": "2026-01-01T00:00:00Z"}
    _lease.write_lease({**base, "start": "Mon Jan  1 00:00:00 2001", "command": row["command"], "argv": row["command"].split(" ")}, lab.leases)
    other = row["command"] + " other"
    _lease.write_lease({**base, "start": row["start"], "command": other, "argv": other.split(" ")}, lab.leases)
    result = lab.reap("cleanup", "--apply", "--all")
    assert result.returncode == 0, result.stdout
    assert "ended=none left=0 stale_leases=2" in result.stdout
    assert alive(pid) and lab.lease_files() == []


def test_a_process_that_ignores_sigterm_gets_sigkill_after_three_seconds(lab):
    pid = lab.spawn("helper", IGNORE_TERM)
    started = time.monotonic()
    result = lab.reap("cleanup", "--apply", "--all")
    took = time.monotonic() - started
    assert result.returncode == 0 and "ended=helper:1 left=0" in result.stdout
    assert took >= 2.8
    assert not alive(pid)


def test_children_end_with_the_parent_and_apps_below_it_stay(lab):
    app_dir = lab.dir / "Fake.app" / "Contents" / "MacOS"
    app_dir.mkdir(parents=True)
    (app_dir / "FakeApp").symlink_to(os.path.realpath(NODE))
    out = lab.dir / "pids.json"
    script = lab.dir / "parent.cjs"
    script.write_text(
        "const {spawn}=require('node:child_process');\n"
        f"const a=spawn({str(lab.bin / 'helper')!r},['-e','setTimeout(()=>{{}},120000)'],{{stdio:'ignore'}});\n"
        f"const b=spawn({str(app_dir / 'FakeApp')!r},['-e','setTimeout(()=>{{}},120000)'],{{stdio:'ignore'}});\n"
        f"require('node:fs').writeFileSync({str(out)!r},JSON.stringify([a.pid,b.pid]));setTimeout(()=>{{}},120000);\n")
    parent = lab.spawn("helper", [str(script)], [])
    deadline = time.monotonic() + 5
    while not out.exists() and time.monotonic() < deadline:
        time.sleep(0.05)
    child, app = json.loads(out.read_text())
    lab.pids.update((child, app))
    assert alive(child) and alive(app)
    result = lab.reap("cleanup", "--apply", "--all")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "ended=helper:2 left=0 kept_other_apps=1" in result.stdout
    assert not alive(parent) and not alive(child) and alive(app)


def test_cleanup_refuses_a_leased_ancestor_of_itself(lab):
    out = lab.dir / "result.json"
    script = lab.dir / "self.cjs"
    script.write_text(
        "const {spawnSync}=require('node:child_process');const fs=require('node:fs');\n"
        f"const dir={str(lab.leases)!r};const until=Date.now()+8000;while(Date.now()<until&&!(fs.existsSync(dir)&&fs.readdirSync(dir).length))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);\n"
        f"const r=spawnSync({sys.executable!r},[{str(REAP)!r},'cleanup','--apply','--all'],{{encoding:'utf8'}});\n"
        f"fs.writeFileSync({str(out)!r},JSON.stringify([r.status,r.stdout,r.stderr]));setTimeout(()=>{{}},120000);\n")
    pid = lab.spawn("helper", [str(script)], [])
    deadline = time.monotonic() + 10
    while not out.exists() and time.monotonic() < deadline:
        time.sleep(0.05)
    code, stdout, stderr = json.loads(out.read_text())
    assert code == 1 and "ancestor of this cleanup run" in stderr and "refused=1" in stdout
    assert alive(pid)


def test_session_scope_follows_the_named_session_and_the_environment(lab):
    a = lab.spawn("helper", SLEEP, [], session="A")
    b = lab.spawn("helper", SLEEP, ["x"], session="B")
    assert lab.reap("cleanup", "--apply", "--session", "A").returncode == 0
    assert not alive(a) and alive(b)
    assert "ended=none" in lab.reap("cleanup", "--apply", env={"CLAUDE_CODE_SESSION_ID": "other"}).stdout
    assert alive(b)
    assert lab.reap("cleanup", "--apply", env={"CLAUDE_CODE_SESSION_ID": "B"}).returncode == 0
    assert not alive(b)


def test_hooks_end_only_the_matching_session_and_always_exit_zero(lab):
    def event(name, **extra):
        return {"session_id": "S1", "hook_event_name": name, **extra}

    pid = lab.spawn("helper")
    for payload in (event("SubagentStop", agent_type="Explore"), event("Stop", background_tasks=[{"type": "subagent"}]),
                    {**event("SessionEnd"), "session_id": "S2"}, event("PreToolUse")):
        assert lab.hook(payload).returncode == 0
        assert alive(pid)
    shim = lab.hook(event("SubagentStop", agent_type="desk-runner"), shim=True)
    assert shim.returncode == 0 and shim.stdout == ""
    assert not alive(pid)
    for name in ("Stop", "SessionEnd"):
        pid = lab.spawn("helper")
        result = lab.hook(event(name, background_tasks=[]))
        assert result.returncode == 0 and result.stdout == "" and not alive(pid), name


def test_hooks_ignore_malformed_payloads(lab):
    pid = lab.spawn("helper")
    for bad in ("{malformed", "", "[]", "null", '{"session_id":5,"hook_event_name":"Stop"}', '{"hook_event_name":"Stop"}',
                '{"session_id":"","hook_event_name":"Stop"}', json.dumps({"session_id": "x" * 500, "hook_event_name": "Stop"})):
        for shim in (False, True):
            result = lab.hook(bad, shim=shim)
            assert result.returncode == 0 and result.stdout == "", bad
    assert alive(pid)


def test_a_driver_with_live_sessions_is_left_running(lab):
    fake = lab.dir / "path"
    fake.mkdir()
    sessions = fake / "cua-driver"
    sessions.write_text("#!/bin/sh\necho 'session-1 Calculator'\n")
    sessions.chmod(0o755)
    pid = lab.spawn("cua-driver", SLEEP, ["serve"])
    busy = lab.reap("cleanup", "--apply", "--all", env={"PATH": f"{fake}:{os.environ['PATH']}"})
    assert busy.returncode == 1 and "busy_driver=1" in busy.stdout and alive(pid)
    sessions.write_text("#!/bin/sh\necho 'No live sessions.'\n")
    idle = lab.reap("cleanup", "--apply", "--all", env={"PATH": f"{fake}:{os.environ['PATH']}"})
    assert idle.returncode == 0 and "ended=cua-driver:1" in idle.stdout and not alive(pid)


def test_desk_leases_only_a_daemon_that_started_after_its_own_launch(lab, monkeypatch):
    old = lab.start("cua-driver", extra=["serve"])
    time.sleep(1.2)
    marker = time.time()
    new = lab.start("cua-driver", extra=["serve"])
    monkeypatch.setenv("LEAN_COMPUTER_USE_LEASES", str(lab.leases))
    monkeypatch.setenv("CLAUDE_CODE_SESSION_ID", "S9")
    # The two processes started more than the allowed skew apart, so only the newer one is leased.
    _lease.record_driver(marker + 1.0)
    leases = _lease.read_leases(lab.leases)[0]
    assert [l["pid"] for l in leases] == [new] and leases[0]["session"] == "S9" and leases[0]["kind"] == "driver"
    assert alive(old)
    _lease.record_driver(marker + 1.0)
    assert len(_lease.read_leases(lab.leases)[0]) == 1


def test_invalid_and_unsafe_lease_files_are_ignored(lab):
    pid = lab.start("helper")
    lab.leases.mkdir(mode=0o700)
    (lab.leases / "0123456789abcdef.json").write_text("{broken")
    (lab.leases / "ffffffffffffffff.json").write_text(json.dumps({"v": 1, "id": "ffffffffffffffff", "pid": pid, "kind": "helper"}))
    (lab.leases / "notes.txt").write_text("x")
    result = lab.reap("cleanup", "--apply", "--all")
    assert result.returncode == 0 and alive(pid)
    link = lab.dir / "link"
    link.symlink_to(lab.leases, target_is_directory=True)
    assert "ended=none" in lab.reap("cleanup", "--apply", "--all", env={"LEAN_COMPUTER_USE_LEASES": str(link)}).stdout


def test_spawn_judges_the_running_command_and_stops_a_wrapper_that_becomes_a_browser(lab):
    script = lab.dir / "wrap.sh"
    script.write_text(f"#!/bin/sh\nexec {str(lab.bin / 'Google Chrome')!r} -e 'setTimeout(()=>{{}},120000)' -- --headless\n")
    script.chmod(0o755)
    result = lab.reap("spawn", "--", str(script))
    assert result.returncode == 2 and "Refused" in result.stderr
    time.sleep(0.5)
    assert not [r for r in _lease.ps_table().values() if "Google Chrome" in r["command"] and str(lab.bin) in r["command"] and not r["stat"].startswith("Z")]
    assert lab.lease_files() == []


def test_a_lease_file_other_users_could_read_is_not_trusted(lab):
    pid = lab.start("helper")
    row = _lease.ps_table()[pid]
    lease = _lease.write_lease({"pid": pid, "kind": "helper", "start": row["start"], "command": row["command"],
                                "argv": row["command"].split(" "), "session": "S1", "run": "",
                                "created": "2026-01-01T00:00:00Z"}, lab.leases)
    os.chmod(lab.leases / (lease["id"] + ".json"), 0o644)
    assert "ended=none" in lab.reap("cleanup", "--apply", "--all").stdout
    assert alive(pid)
