"""Synthetic ownership and session-probe checks, with no real process signals."""
import runpy
import subprocess
import sys
from pathlib import Path

import pytest

DESK = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DESK))
import _lease  # noqa: E402


@pytest.fixture
def driver():
    row = {"pid": 98765, "ppid": 1, "uid": _lease.UID, "stat": "S",
           "start": "Sat Oct 31 12:00:00 2026", "command": "cua-driver serve"}
    lease = {"id": "0123456789abcdef", "pid": row["pid"], "kind": "driver", "start": row["start"],
             "command": row["command"], "argv": ["cua-driver", "serve"], "session": "S", "run": "",
             "created": "2026-10-31T12:00:00Z"}
    return row, lease


@pytest.mark.parametrize("case,reason", [
    ("failure", "exited 7"), ("timeout", "timed out"),
    ("unavailable", "executable unavailable"), ("empty", "empty output"),
    ("busy", ""), ("idle", ""),
])
def test_driver_session_probe_preserves_unknown_and_live_sessions(monkeypatch, driver, case, reason):
    row, lease = driver
    monkeypatch.setattr(_lease, "scan", lambda *args: ([{"lease": lease, "state": "live", "row": row,
                                                       "kill": [], "kept": 0}], []))
    ended = []
    monkeypatch.setattr(_lease, "end_all", lambda snaps: (ended.append(snaps) or (1, 0)))
    monkeypatch.setattr(_lease, "ps_table", lambda: {})
    monkeypatch.setattr(_lease, "remove_lease", lambda *args: None)

    def probe(command, **kwargs):
        assert command == ["cua-driver", "sessions"]
        assert kwargs["timeout"] == 5
        if case == "timeout":
            raise subprocess.TimeoutExpired(command, 5)
        if case == "unavailable":
            raise FileNotFoundError("synthetic missing executable")
        output = {"empty": " \n", "busy": "session-1 attached", "idle": "No live sessions.\n"}.get(case, "")
        return subprocess.CompletedProcess(command, 7 if case == "failure" else 0, output, "")

    monkeypatch.setattr(_lease.subprocess, "run", probe)
    result = _lease.reap(apply=True)
    if case == "idle":
        assert len(ended) == 1 and result["left"] == 0 and _lease.exit_code(result) == 0
    else:
        assert ended == [] and result["left"] == 1 and _lease.exit_code(result) == 1
        if case == "busy":
            assert result["busy"] == 1 and result["unknown"] == []
        else:
            assert reason in result["unknown"][0]["reason"]
            assert "unknown_driver=1" in _lease.summary(result)


def test_graceful_stop_requires_a_single_matching_lease(monkeypatch, driver):
    row, lease = driver
    monkeypatch.setattr(_lease, "read_leases", lambda: ([], []))
    monkeypatch.setattr(_lease, "ps_table", lambda: (_ for _ in ()).throw(AssertionError("no lease needs no scan")))
    assert not _lease.owned_driver()
    monkeypatch.setattr(_lease, "read_leases", lambda: ([lease], []))
    monkeypatch.setattr(_lease, "ps_table", lambda: {row["pid"]: row})
    assert _lease.owned_driver()
    monkeypatch.setattr(_lease, "ps_table", lambda: {row["pid"]: {**row, "start": "different process"}})
    assert not _lease.owned_driver()
    monkeypatch.setattr(_lease, "ps_table", lambda: {row["pid"]: row, row["pid"] + 1: {**row, "pid": row["pid"] + 1}})
    assert not _lease.owned_driver()


@pytest.mark.parametrize("sessions,expected,stops", [
    (("idle", ""), "stopped", ["stop"]),
    (("busy", ""), "left-running-live-sessions", []),
    (("unknown", "cua-driver sessions timed out"), "stop-failed", []),
])
def test_desk_clean_stops_only_a_leased_idle_driver(monkeypatch, capsys, sessions, expected, stops):
    stop = runpy.run_path(str(DESK / "desk-clean"))["stop_driver"]
    calls = []
    answers = iter([True, False])
    monkeypatch.setitem(stop.__globals__, "driver_status", lambda *args: next(answers))
    monkeypatch.setitem(stop.__globals__, "owned_driver", lambda: True)
    monkeypatch.setitem(stop.__globals__, "driver_sessions", lambda: sessions)
    monkeypatch.setitem(stop.__globals__, "driver_command", lambda command: calls.append(command))
    assert stop() == expected
    assert calls == stops
    if sessions[0] == "unknown":
        assert "UNKNOWN: cua-driver sessions timed out" in capsys.readouterr().err


def test_desk_clean_rechecks_lease_before_graceful_stop(monkeypatch):
    stop = runpy.run_path(str(DESK / "desk-clean"))["stop_driver"]
    owners = iter([True, False])
    monkeypatch.setitem(stop.__globals__, "driver_status", lambda *args: True)
    monkeypatch.setitem(stop.__globals__, "owned_driver", lambda: next(owners))
    monkeypatch.setitem(stop.__globals__, "driver_sessions", lambda: ("idle", ""))
    monkeypatch.setitem(stop.__globals__, "driver_command", lambda *args: pytest.fail("lease no longer matches"))
    assert stop() == "left-running-unleased"


def test_clean_ignored_stop_exits_three_without_force_kill(monkeypatch):
    stop = runpy.run_path(str(DESK / "desk-clean"))["stop_driver"]
    calls = []
    clock = iter([0, 1, 2, 6])
    monkeypatch.setitem(stop.__globals__, "driver_status", lambda *args: True)
    monkeypatch.setitem(stop.__globals__, "owned_driver", lambda: True)
    monkeypatch.setitem(stop.__globals__, "driver_sessions", lambda: ("idle", ""))
    monkeypatch.setitem(stop.__globals__, "driver_command", lambda command: calls.append(command))
    monkeypatch.setattr(stop.__globals__["time"], "monotonic", lambda: next(clock))
    monkeypatch.setattr(stop.__globals__["time"], "sleep", lambda *args: None)
    # main maps stop-failed to exit 3. There is no signal fallback.
    assert stop() == "stop-failed"
    assert calls == ["stop"]
