"""LaunchServices startup ownership uses synthetic process snapshots."""
import importlib.util
import subprocess
from pathlib import Path

import pytest

DESK = Path(__file__).resolve().parents[1]


@pytest.fixture
def launch(monkeypatch, tmp_path):
    monkeypatch.syspath_prepend(str(DESK))
    import _lease
    spec = importlib.util.spec_from_file_location("launch_resolver", DESK / "_resolve.py")
    resolver = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(resolver)
    monkeypatch.setattr(resolver, "STATE", tmp_path / "state")
    monkeypatch.setenv("LEAN_COMPUTER_USE_LEASES", str(tmp_path / "leases"))
    monkeypatch.setattr(resolver, "DRIVER_START_WAIT", 0.3)
    clock = [0.0]
    monkeypatch.setattr(resolver.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(resolver.time, "sleep", lambda seconds: clock.__setitem__(0, clock[0] + seconds))
    monkeypatch.setattr(resolver, "driver_status", lambda timeout=5: False)
    monkeypatch.setattr(resolver.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a[0], 0))
    monkeypatch.setattr(resolver.subprocess, "Popen", lambda *a, **k: pytest.fail("driver must launch via open"))
    monkeypatch.setattr(_lease, "ps_table", lambda: {})
    monkeypatch.setattr(resolver.os, "kill", lambda *a: pytest.fail("no process may be signalled"))
    monkeypatch.setattr(resolver.os, "killpg", lambda *a: pytest.fail("no process group may be signalled"))
    return resolver


def row(pid):
    import _lease
    return {"pid": pid, "ppid": 1, "uid": _lease.UID, "stat": "S",
            "start": "Sat Oct 31 12:00:00 2026", "command": "cua-driver serve"}


def snapshots(monkeypatch, *tables):
    import _lease
    pending = list(tables)

    def read():
        return pending.pop(0) if len(pending) > 1 else pending[0]

    monkeypatch.setattr(_lease, "ps_table", read)


def test_launch_uses_launchservices_and_leases_only_the_new_pid(launch, monkeypatch):
    import _lease
    calls = []
    snapshots(monkeypatch, {6788: row(6788)}, {pid: row(pid) for pid in (6788, 6789)})
    answers = iter([False, True])
    monkeypatch.setattr(launch, "driver_status", lambda timeout=5: next(answers))

    def start(command, **kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(launch.subprocess, "run", start)
    launch.ensure_driver()
    assert calls == [["open", "-g", "-a", str(launch.DRIVER_APP), "--args", "serve"]]
    [lease] = _lease.read_leases()[0]
    assert lease["pid"] == 6789 and lease["start"] == row(6789)["start"]
    assert lease["command"] == "cua-driver serve"


def test_readiness_timeout_keeps_a_late_start_leased(launch, monkeypatch):
    import _lease
    snapshots(monkeypatch, {}, {6789: row(6789)})

    def status(timeout=5):
        if timeout != 5:
            launch.time.sleep(timeout)
            raise launch.DeskError("cua-driver status timed out")
        return False

    monkeypatch.setattr(launch, "driver_status", status)
    with pytest.raises(launch.DeskError, match="launch remains leased"):
        launch.ensure_driver()
    [lease] = _lease.read_leases()[0]
    assert lease["pid"] == 6789
    assert _lease.evaluate(lease, {6789: row(6789)}, set())["state"] == "live"
    monkeypatch.setattr(launch, "driver_status", lambda timeout=5: True)
    launch.ensure_driver()
    assert _lease.read_leases()[0] == [lease]


@pytest.mark.parametrize("new_pids", [[], [6789, 6790]])
def test_unprovable_launch_leases_and_stops_nothing(launch, monkeypatch, new_pids):
    import _lease
    snapshots(monkeypatch, {6788: row(6788)}, {pid: row(pid) for pid in [6788, *new_pids]})
    message = "multiple new driver PIDs" if new_pids else "no new driver PID"
    with pytest.raises(launch.DeskError, match=message):
        launch.ensure_driver()
    assert _lease.read_leases()[0] == []


def test_second_new_pid_during_readiness_is_ambiguous(launch, monkeypatch):
    import _lease
    snapshots(monkeypatch, {}, {6789: row(6789)}, {pid: row(pid) for pid in (6789, 6790)})
    with pytest.raises(launch.DeskError, match="multiple new driver PIDs"):
        launch.ensure_driver()
    assert _lease.read_leases()[0] == []


def test_lease_write_failure_leaves_the_driver_running(launch, monkeypatch):
    import _lease
    snapshots(monkeypatch, {}, {6789: row(6789)})
    answers = iter([False, True])
    monkeypatch.setattr(launch, "driver_status", lambda timeout=5: next(answers))
    monkeypatch.setattr(_lease, "write_lease", lambda *a: (_ for _ in ()).throw(OSError("synthetic lease failure")))
    with pytest.raises(launch.DeskError, match="cannot record a lease"):
        launch.ensure_driver()
    assert _lease.read_leases()[0] == []


def test_state_failure_precedes_launch(launch, monkeypatch):
    monkeypatch.setattr(launch.subprocess, "run", lambda *a, **k: pytest.fail("launch must follow state writes"))
    monkeypatch.setattr(launch.os, "open", lambda *a, **k: (_ for _ in ()).throw(OSError("state unavailable")))
    with pytest.raises(OSError, match="state unavailable"):
        launch.ensure_driver()
