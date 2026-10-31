"""Driver startup ownership is established before readiness, using a synthetic child."""
import importlib.util
import plistlib
import signal
import subprocess
from pathlib import Path

import pytest

DESK = Path(__file__).resolve().parents[1]


@pytest.fixture
def launch(monkeypatch, tmp_path):
    monkeypatch.syspath_prepend(str(DESK))
    spec = importlib.util.spec_from_file_location("launch_resolver", DESK / "_resolve.py")
    resolver = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(resolver)
    monkeypatch.setattr(resolver, "STATE", tmp_path / "state")
    monkeypatch.setattr(resolver, "DRIVER_APP", tmp_path / "CuaDriver.app")
    contents = resolver.DRIVER_APP / "Contents"
    contents.mkdir(parents=True)
    (contents / "Info.plist").write_bytes(plistlib.dumps({"CFBundleExecutable": "cua-driver"}))
    return resolver


def test_readiness_timeout_keeps_a_late_start_leased(launch, monkeypatch, tmp_path):
    import _lease
    directory = tmp_path / "leases"
    monkeypatch.setenv("LEAN_COMPUTER_USE_LEASES", str(directory))
    probes = []
    child = subprocess.CompletedProcess([], None)
    child.pid = 6789
    clock = iter([0.0, 0.0, 0.0, 1.0])
    monkeypatch.setattr(launch, "DRIVER_START_WAIT", 0.5)
    monkeypatch.setattr(launch.time, "monotonic", lambda: next(clock))
    monkeypatch.setattr(launch.time, "sleep", lambda seconds: None)
    row = {"pid": child.pid, "ppid": 1, "uid": _lease.UID, "stat": "S",
           "start": "Sat Oct 31 12:00:00 2026",
           "command": str(launch.driver_executable()) + " serve"}
    monkeypatch.setattr(_lease, "settled_row", lambda pid: row if pid == child.pid else None)

    def status(timeout=5):
        probes.append(len(_lease.read_leases(directory)[0]))
        return False

    monkeypatch.setattr(launch, "driver_status", status)
    monkeypatch.setattr(launch.subprocess, "Popen", lambda *args, **kwargs: child)
    with pytest.raises(launch.DeskError, match="launch remains leased"):
        launch.ensure_driver()
    assert probes == [0, 1]
    leases = _lease.read_leases(directory)[0]
    assert [entry["pid"] for entry in leases] == [child.pid]
    assert _lease.evaluate(leases[0], {child.pid: row}, set())["state"] == "live"
    # The same child may finish startup after the caller's readiness deadline.
    monkeypatch.setattr(launch, "driver_status", lambda timeout=5: True)
    launch.ensure_driver()
    assert [entry["pid"] for entry in _lease.read_leases(directory)[0]] == [child.pid]


def test_launch_uses_the_bundle_executable_and_a_fresh_session(launch, monkeypatch):
    import _lease
    calls = []
    answers = iter([False, True])
    child = subprocess.CompletedProcess([], None)
    child.pid = 6789

    def start(command, **kwargs):
        calls.append((command, kwargs))
        return child

    monkeypatch.setattr(launch, "driver_status", lambda timeout=5: next(answers))
    monkeypatch.setattr(launch.subprocess, "Popen", start)
    monkeypatch.setattr(_lease, "record_driver", lambda launched, pid=None: {"pid": pid})
    launch.ensure_driver()
    [command] = [call[0] for call in calls]
    assert command == [str(launch.DRIVER_APP / "Contents" / "MacOS" / "cua-driver"), "serve"]
    assert calls[0][1]["start_new_session"] is True
    assert all(calls[0][1][name] == subprocess.DEVNULL for name in ("stdin", "stdout", "stderr"))


@pytest.mark.parametrize("failure", ["raise", "empty"])
def test_lease_failure_stops_only_the_launched_group(launch, monkeypatch, failure):
    import _lease
    ended = []

    class Child:
        pid = 6789

        def wait(self, timeout):
            ended.append(("wait", timeout))
            return -signal.SIGKILL

    def record(launched, pid=None):
        if failure == "raise":
            raise OSError("synthetic lease failure")
        return None

    monkeypatch.setattr(launch, "driver_status", lambda timeout=5: False)
    monkeypatch.setattr(launch.subprocess, "Popen", lambda *args, **kwargs: Child())
    monkeypatch.setattr(_lease, "record_driver", record)
    monkeypatch.setattr(launch.os, "killpg", lambda pid, name: ended.append((pid, name)))
    monkeypatch.setattr(launch, "driver_command", lambda *a, **k: pytest.fail("shared stop is forbidden"))
    with pytest.raises(launch.DeskError, match="it was stopped"):
        launch.ensure_driver()
    assert ended == [(Child.pid, signal.SIGKILL), ("wait", 5)]


@pytest.mark.parametrize("executable", ["", "..", "../other", "dir/other", "bad\nname", ["cua-driver"]])
def test_app_executable_metadata_must_name_one_file(launch, executable):
    (launch.DRIVER_APP / "Contents" / "Info.plist").write_bytes(
        plistlib.dumps({"CFBundleExecutable": executable}))
    with pytest.raises(launch.DeskError, match="invalid app executable metadata"):
        launch.driver_executable()


def test_state_failure_precedes_launch(launch, monkeypatch):
    monkeypatch.setattr(launch, "driver_status", lambda timeout=5: False)
    monkeypatch.setattr(launch.subprocess, "Popen", lambda *a, **k: pytest.fail("launch must follow state writes"))
    monkeypatch.setattr(launch.os, "open", lambda *a, **k: (_ for _ in ()).throw(OSError("state unavailable")))
    with pytest.raises(OSError, match="state unavailable"):
        launch.ensure_driver()
