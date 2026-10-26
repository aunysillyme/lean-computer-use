"""Contract tests: every desktop call goes to a temporary fake executable."""
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import pytest


DESK_DIR = Path(__file__).resolve().parents[1]
BUNDLE = "com.apple.calculator"

FAKE_DRIVER = r'''
import json
import os
import sys
from pathlib import Path

config = json.loads(Path(os.environ["FAKE_CUA_CONFIG"]).read_text())
with Path(os.environ["FAKE_DRIVER_LOG"]).open("a") as handle:
    handle.write(json.dumps(["cua-driver", *sys.argv[1:]]) + "\n")
driver_state = Path(os.environ["FAKE_DRIVER_STATE"])
running = (driver_state.read_text() == "running" if driver_state.exists()
           else config.get("_driver_running", True))
if sys.argv[1] == "status":
    print(config.get("_status_text", "Cua Driver daemon is running" if running
                     else "Cua Driver daemon is not running"))
    sys.exit(config.get("_status_exit", 0 if running else 1))
if sys.argv[1] == "sessions":
    print(config.get("_sessions", "No live sessions"))
    sys.exit(config.get("_sessions_exit", 0))
if sys.argv[1] == "stop":
    if not config.get("_ignore_stop"):
        driver_state.write_text("stopped")
    sys.exit(0)
log = Path(os.environ["FAKE_CUA_LOG"])
counters_path = Path(os.environ["FAKE_CUA_COUNTS"])
args = json.loads(sys.argv[3])
tool = sys.argv[2]
with log.open("a") as handle:
    handle.write(json.dumps({"tool": tool, "args": args}) + "\n")
if sys.argv[1] != "call":
    print(json.dumps({"error": "fake expected cua-driver call"}))
    sys.exit(2)
if tool != "launch_app":
    if type(args.get("pid")) is not int:
        print(json.dumps({"error": "pid must be an integer"}))
        sys.exit(2)
    if type(args.get("window_id")) is not int:
        print(json.dumps({"error": "window_id must be an integer"}))
        sys.exit(2)
try:
    counts = json.loads(counters_path.read_text())
except FileNotFoundError:
    counts = {}
index = counts.get(tool, 0)
counts[tool] = index + 1
counters_path.write_text(json.dumps(counts))
responses = config.get(tool, [{"result": {"effect": "applied"}}])
response = responses[min(index, len(responses) - 1)]
print(json.dumps(response["result"]))
sys.exit(response.get("returncode", 0))
'''

FAKE_OPEN = r'''
import json
import os
import sys
from pathlib import Path

config = json.loads(Path(os.environ["FAKE_CUA_CONFIG"]).read_text())
with Path(os.environ["FAKE_DRIVER_LOG"]).open("a") as handle:
    handle.write(json.dumps(["open", *sys.argv[1:]]) + "\n")
code = config.get("_open_exit", 0)
if not code and config.get("_open_starts", True):
    Path(os.environ["FAKE_DRIVER_STATE"]).write_text("running")
sys.exit(code)
'''


class FakeDesktop:
    def __init__(self, root):
        self.root = root
        self.state = root / "state"
        self.log = root / "calls.jsonl"
        self.config = root / "responses.json"
        fake_bin = root / "bin"
        fake_bin.mkdir()
        fake = fake_bin / "cua-driver"
        fake.write_text("#!/usr/bin/env python3\n" + FAKE_DRIVER)
        fake.chmod(0o755)
        opener = fake_bin / "open"
        opener.write_text("#!/usr/bin/env python3\n" + FAKE_OPEN)
        opener.chmod(0o755)
        # Interpreter paths can contain spaces. Keep an env-compatible symlink
        # and exclude the real driver entirely, even if fake execution fails.
        (fake_bin / "python3").symlink_to(sys.executable)
        self.env = dict(os.environ, PATH=str(fake_bin),
                        DESK_STATE_DIR=str(self.state), LEAN_COMPUTER_USE_LEASES=str(root / "leases"), FAKE_CUA_LOG=str(self.log),
                        FAKE_DRIVER_LOG=str(root / "driver.jsonl"),
                        FAKE_DRIVER_STATE=str(root / "driver-state"),
                        FAKE_CUA_CONFIG=str(self.config), FAKE_CUA_COUNTS=str(root / "counts.json"))
        self.responses = {}
        self.set_responses("launch_app", self.launch())

    def launch(self, window_id=11, windows=None):
        return {"pid": os.getpid(), "windows": windows or [
            {"window_id": window_id, "is_main": True, "is_minimized": False},
        ]}

    def set_responses(self, tool, *results, returncodes=None):
        codes = returncodes or [0] * len(results)
        self.responses[tool] = [{"result": result, "returncode": code}
                                for result, code in zip(results, codes)]
        self.config.write_text(json.dumps(self.responses))

    def run(self, script="desk", *args, bundle=BUNDLE):
        return subprocess.run([sys.executable, str(DESK_DIR / script), bundle, *args],
                              env=self.env, capture_output=True, text=True, timeout=20)

    def driver_calls(self):
        return [json.loads(line) for line in (self.root / "driver.jsonl").read_text().splitlines()]

    def configure_driver(self, **config):
        self.responses.update(config)
        self.config.write_text(json.dumps(self.responses))

    def calls(self, tool=None):
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        return [call for call in calls if tool is None or call["tool"] == tool]


@pytest.fixture
def tmp_path():
    with tempfile.TemporaryDirectory(prefix=".desk-test-", dir=DESK_DIR / "tests") as directory:
        yield Path(directory)


@pytest.fixture
def desktop(tmp_path):
    return FakeDesktop(tmp_path)


def test_pid_window_cache_second_call_does_not_launch_app(desktop):
    first = desktop.run("desk", "click", '{"element_token":"button-1"}')
    second = desktop.run("desk", "click", '{"element_token":"button-2"}')
    assert first.returncode == second.returncode == 0, (first.stderr, second.stderr)
    assert json.loads(first.stdout)["cached"] is False
    assert json.loads(second.stdout)["cached"] is True
    assert len(desktop.calls("launch_app")) == 1
    clicks = desktop.calls("click")
    assert [(call["args"]["pid"], call["args"]["window_id"]) for call in clicks] == [
        (os.getpid(), 11), (os.getpid(), 11),
    ]
    cache = json.loads((desktop.state / "apps.json").read_text())
    assert cache[BUNDLE] == {"pid": os.getpid(), "window_id": 11}


def test_cold_start_waits_for_window_readiness(desktop):
    pending = {"error": "app window is warming up", "detail": {
        "bundle_id": BUNDLE,
        "launch_state": {"process_running": True, "requested": True, "window_ready": False},
        "windows": [],
    }}
    desktop.set_responses("launch_app", pending, desktop.launch(), returncodes=[1, 0])
    result = desktop.run("desk", "click", '{"element_token":"button-1"}')
    assert result.returncode == 0, result.stderr
    assert len(desktop.calls("launch_app")) == 2
    assert len(desktop.calls("click")) == 1
    assert json.loads(result.stdout)["window_id"] == 11


def test_unknown_bundle_exits_two_with_one_line_error(desktop):
    desktop.set_responses("launch_app", {"error": "unknown bundle id"}, returncodes=[1])
    result = desktop.run("desk", "click", "{}", bundle="invalid.unknown.application")
    assert result.returncode == 2
    assert result.stdout == ""
    assert len(result.stderr.splitlines()) == 1
    assert "invalid.unknown.application" in result.stderr
    assert "unknown bundle id" in result.stderr
    assert len(desktop.calls("launch_app")) == 1
    assert not desktop.calls("click")


def test_missing_pid_is_rejected_and_desk_injects_both_ids(desktop):
    rejected = subprocess.run(["cua-driver", "call", "click", '{"element_token":"button-1"}'],
                              env=desktop.env, capture_output=True, text=True, timeout=10)
    assert rejected.returncode == 2
    assert json.loads(rejected.stdout)["error"] == "pid must be an integer"
    result = desktop.run("desk", "click", '{"element_token":"button-1"}')
    assert result.returncode == 0, result.stderr
    accepted = desktop.calls("click")[-1]["args"]
    assert accepted == {"element_token": "button-1", "pid": os.getpid(), "window_id": 11}


def test_caller_cannot_override_resolved_pid_or_window_id(desktop):
    result = desktop.run("desk", "click", '{"element_token":"button-1","pid":"bad","window_id":999}')
    assert result.returncode == 0, result.stderr
    args = desktop.calls("click")[-1]["args"]
    assert args["pid"] == os.getpid()
    assert args["window_id"] == 11


@pytest.mark.parametrize("script", ["desk", "desk-read"])
def test_secure_field_value_never_printed(desktop, script):
    secret = "FAKE_PRIVATE_SECURE_VALUE"
    driver_result = {
        "tree_markdown": f'AXSecureTextField value="{secret}"\nAXStaticText value="visible"',
        "message": {"role": "AXSecureTextField", "value": secret},
        "nodes": [{"role": "AXSecureTextField", "value": secret}],
    }
    desktop.set_responses("get_window_state", driver_result)
    args = ("get_window_state", "{}") if script == "desk" else ("AXSecureTextField",)
    result = desktop.run(script, *args)
    assert result.returncode == 0, result.stderr
    assert secret not in result.stdout + result.stderr
    assert "REDACTED" in result.stdout
    # The complete response remains available privately for the independent read-back.
    files = list(desktop.state.glob("get_window_state-*.json" if script == "desk" else "tree-*.json"))
    assert len(files) == 1
    assert json.loads(files[0].read_text()) == driver_result
    assert stat.S_IMODE(files[0].stat().st_mode) == 0o600


@pytest.mark.parametrize("script,query", [
    ("desk-read", "AXValue"),
    ("desk-read", "AXStaticText"),
    ("desk", None),
])
def test_secure_continuation_value_redacted_before_read_filter(desktop, script, query):
    secret = "FAKE_PRIVATE_SECURE_VALUE"
    tree = f'AXSecureTextField\n  AXValue: {secret}\nAXStaticText value="visible"'
    driver_result = {"tree_markdown": tree, "message": tree}
    desktop.set_responses("get_window_state", driver_result)
    args = (query,) if script == "desk-read" else ("get_window_state", "{}")
    result = desktop.run(script, *args)
    assert result.returncode == 0, result.stderr
    assert secret not in result.stdout + result.stderr
    if script == "desk-read":
        header, *lines = result.stdout.splitlines()
        if query == "AXValue":
            assert lines == ["[AXSecureTextField REDACTED]"]
        else:
            assert lines == ['AXStaticText value="visible"']
        saved = Path(json.loads(re.search(r"file=(.*)$", header).group(1)))
        assert desktop.calls("get_window_state")[0]["args"]["query"] == query
    else:
        summary = json.loads(result.stdout)
        assert summary["message"].splitlines() == ["[AXSecureTextField REDACTED]",
                                                  "[AXSecureTextField REDACTED]",
                                                  'AXStaticText value="visible"']
        saved = Path(summary["file"])
    assert json.loads(saved.read_text()) == driver_result


def test_role_name_inside_secure_value_does_not_end_redaction(desktop):
    secret = "FAKE_PRIVATE_SECURE_VALUE AXStaticText secret_tail"
    desktop.set_responses("get_window_state", {
        "tree_markdown": f'AXSecureTextField\n  AXValue: {secret}\nAXStaticText value="visible"',
    })
    result = desktop.run("desk-read", "AXValue")
    assert result.returncode == 0, result.stderr
    assert secret not in result.stdout + result.stderr
    assert "REDACTED" in result.stdout


def test_secure_parent_role_redacts_summary_message(desktop):
    secret = "FAKE_PRIVATE_SECURE_VALUE"
    desktop.set_responses("get_window_state", {
        "role": "AXSecureTextField", "value": secret, "message": "Read value: " + secret,
    })
    result = desktop.run("desk", "get_window_state", "{}")
    assert result.returncode == 0, result.stderr
    assert secret not in result.stdout + result.stderr


def test_desk_read_filters_compact_lines_and_saves_full_json(desktop):
    driver_result = {"tree_markdown": '  AXStaticText value="42"\nAXButton value="private button"\n'
                     'axstatictext value="second"', "extra": {"complete": True}}
    desktop.set_responses("get_window_state", driver_result)
    result = desktop.run("desk-read", "AXStaticText")
    assert result.returncode == 0, result.stderr
    header, *lines = result.stdout.splitlines()
    assert lines == ['AXStaticText value="42"', 'axstatictext value="second"']
    assert "shown=2/2" in header
    assert "private button" not in result.stdout
    saved = Path(json.loads(re.search(r"file=(.*)$", header).group(1)))
    assert saved.parent == desktop.state
    assert json.loads(saved.read_text()) == driver_result
    args = desktop.calls("get_window_state")[0]["args"]
    assert args == {"include_screenshot": False, "query": "AXStaticText",
                    "pid": os.getpid(), "window_id": 11}
    assert stat.S_IMODE(desktop.state.stat().st_mode) == 0o700


def test_desk_read_treats_a_pipe_in_the_filter_as_literal_text(desktop):
    driver_result = {"tree_markdown": 'AXStaticText value="42"\nAXButton value="Continue"'}
    desktop.set_responses("get_window_state", driver_result)
    result = desktop.run("desk-read", "AXStaticText|AXButton")
    assert result.returncode == 0, result.stderr
    header, *lines = result.stdout.splitlines()
    assert lines == []
    assert "shown=0/0" in header
    saved = Path(json.loads(re.search(r"file=(.*)$", header).group(1)))
    assert json.loads(saved.read_text()) == driver_result
    assert desktop.calls("get_window_state")[0]["args"]["query"] == "AXStaticText|AXButton"


def test_desk_read_filter_matches_case_insensitively(desktop):
    driver_result = {"tree_markdown": 'AXStaticText value="42"\naxstatictext value="second"\nAXButton'}
    desktop.set_responses("get_window_state", driver_result)
    result = desktop.run("desk-read", "aXsTaTiCtExT")
    assert result.returncode == 0, result.stderr
    header, *lines = result.stdout.splitlines()
    assert lines == ['AXStaticText value="42"', 'axstatictext value="second"']
    assert "shown=2/2" in header
    assert desktop.calls("get_window_state")[0]["args"]["query"] == "aXsTaTiCtExT"


def test_resolve_chooses_main_non_minimized_window(desktop):
    windows = [{"window_id": 10, "is_main": True, "is_minimized": True},
               {"window_id": 11, "is_main": False, "is_minimized": False},
               {"window_id": 12, "is_main": True, "is_minimized": False}]
    desktop.set_responses("launch_app", desktop.launch(windows=windows))
    result = desktop.run("desk", "click", "{}")
    assert result.returncode == 0, result.stderr
    assert desktop.calls("click")[0]["args"]["window_id"] == 12


def test_window_error_reresolves_once_and_uses_new_window(desktop):
    desktop.set_responses("launch_app", desktop.launch(11), desktop.launch(21))
    desktop.set_responses("click", {"error": "window_id_not_found"},
                          {"effect": "applied"}, returncodes=[1, 0])
    result = desktop.run("desk", "click", "{}")
    assert result.returncode == 0, result.stderr
    assert len(desktop.calls("launch_app")) == 2
    assert [call["args"]["window_id"] for call in desktop.calls("click")] == [11, 21]


def test_state_override_prunes_old_files_and_keeps_recent_files(desktop):
    desktop.state.mkdir(mode=0o700)
    (desktop.state / ".desk-state").write_text("")
    old = desktop.state / "read-ab12cd34.json"
    old.write_text("{}")
    expired = time.time() - 8 * 24 * 60 * 60
    os.utime(old, (expired, expired))
    recent = desktop.state / "read-ef56ab78.json"
    recent.write_text("{}")
    result = desktop.run("desk", "click", "{}")
    assert result.returncode == 0, result.stderr
    assert not old.exists()
    assert recent.exists()
    assert (desktop.state / "apps.json").exists()


def test_window_error_retries_no_more_than_once(desktop):
    desktop.set_responses("click", {"error": "window_id_not_found"}, returncodes=[1])
    result = desktop.run("desk", "click", "{}")
    assert result.returncode == 1
    assert len(desktop.calls("launch_app")) == len(desktop.calls("click")) == 2


def test_entry_points_are_executable():
    for name in ("desk", "desk-read", "_resolve.py"):
        assert os.access(DESK_DIR / name, os.X_OK), name


# --- Round 1 regressions (F4, F7, F8) ---

def test_f4_type_text_partial_failure_is_never_resent(desktop):
    desktop.set_responses("type_text", {"error": "typed 3 of 7 characters then window lost focus"},
                          {"effect": "applied"}, returncodes=[1, 0])
    result = desktop.run("desk", "type_text", '{"text":"abcdefg"}')
    assert result.returncode == 1
    assert [call["tool"] for call in desktop.calls()] == ["launch_app", "type_text"]
    # The cache is dropped so the next call re-resolves, but nothing was re-sent.
    assert BUNDLE not in json.loads((desktop.state / "apps.json").read_text())


@pytest.mark.parametrize("tool", ["press_key", "click", "set_value"])
def test_f4_actions_with_generic_window_errors_are_not_retried(desktop, tool):
    desktop.set_responses(tool, {"error": "window lost focus"}, {"effect": "applied"}, returncodes=[1, 0])
    result = desktop.run("desk", tool, "{}")
    assert result.returncode == 1
    assert [call["tool"] for call in desktop.calls()] == ["launch_app", tool]


@pytest.mark.parametrize("error", ["window_id_not_found", "No such window", "Window not found"])
def test_f4_pure_window_not_found_still_retries_an_action(desktop, error):
    desktop.set_responses("launch_app", desktop.launch(11), desktop.launch(21))
    desktop.set_responses("type_text", {"error": error}, {"effect": "applied"}, returncodes=[1, 0])
    result = desktop.run("desk", "type_text", '{"text":"a"}')
    assert result.returncode == 0, result.stderr
    assert [call["args"]["window_id"] for call in desktop.calls("type_text")] == [11, 21]


@pytest.mark.parametrize("tool", ["get_window_state", "list_windows", "verify_state"])
def test_f4_read_tools_retry_on_any_window_error(desktop, tool):
    desktop.set_responses("launch_app", desktop.launch(11), desktop.launch(21))
    desktop.set_responses(tool, {"error": "window no longer exists"}, {"ok": True}, returncodes=[1, 0])
    result = desktop.run("desk", tool, "{}")
    assert result.returncode == 0, result.stderr
    assert len(desktop.calls(tool)) == 2


def test_f7_prune_keeps_files_desk_did_not_write(desktop):
    desktop.state.mkdir(mode=0o700)
    (desktop.state / ".desk-state").write_text("")
    expired = time.time() - 8 * 24 * 60 * 60
    keep = [desktop.state / "important-notes.txt", desktop.state / "notes.json",
            desktop.state / "my-config.json"]
    for path in keep:
        path.write_text("keep")
        os.utime(path, (expired, expired))
    result = desktop.run("desk", "click", "{}")
    assert result.returncode == 0, result.stderr
    assert all(path.exists() for path in keep)


def test_f7_prune_removes_old_files_desk_really_wrote(desktop):
    first = desktop.run("desk", "get_window_state", "{}")
    assert first.returncode == 0, first.stderr
    written = Path(json.loads(first.stdout)["file"])
    expired = time.time() - 8 * 24 * 60 * 60
    os.utime(written, (expired, expired))
    os.utime(desktop.state / "apps.json", (expired, expired))
    second = desktop.run("desk", "click", "{}")
    assert second.returncode == 0, second.stderr
    assert not written.exists()


def test_f8_secure_marker_after_the_value_still_redacts_the_value_line(desktop):
    secret = "FAKE_PRIVATE_SECURE_VALUE"
    tree = f'AXTextField\n  AXValue: {secret}\n  AXSubrole: AXSecureTextField\nAXStaticText value="visible"'
    desktop.set_responses("get_window_state", {"tree_markdown": tree})
    result = desktop.run("desk-read", "AXValue")
    assert result.returncode == 0, result.stderr
    assert secret not in result.stdout + result.stderr
    assert "REDACTED" in result.stdout


def test_f8_secure_marker_after_value_in_desk_summary(desktop):
    secret = "FAKE_PRIVATE_SECURE_VALUE"
    tree = f'AXTextField\n  AXValue: {secret}\n  AXSubrole: AXSecureTextField\nAXStaticText value="visible"'
    desktop.set_responses("get_window_state", {"message": tree})
    result = desktop.run("desk", "get_window_state", "{}")
    assert result.returncode == 0, result.stderr
    assert secret not in result.stdout + result.stderr
    assert 'AXStaticText value="visible"' in json.loads(result.stdout)["message"]


def test_f8_padded_secure_role_in_dict_is_redacted(desktop):
    secret = "FAKE_PRIVATE_SECURE_VALUE"
    desktop.set_responses("get_window_state", {"message": {"role": " AXSecureTextField\n", "value": secret}})
    result = desktop.run("desk", "get_window_state", "{}")
    assert result.returncode == 0, result.stderr
    assert secret not in result.stdout + result.stderr


FAKE_CLEAN_TOOL = r'''
import json
import os
import sys
import time
from pathlib import Path

tool = Path(sys.argv[0]).name
if tool == "osascript" and any("is running" in arg for arg in sys.argv[1:]):
    tool = "osascript-running"
with Path(os.environ["FAKE_CLEAN_LOG"]).open("a") as handle:
    handle.write(json.dumps({"tool": tool, "args": sys.argv[1:]}) + "\n")
config = json.loads(Path(os.environ["FAKE_CLEAN_CONFIG"]).read_text())
counts_path = Path(os.environ["FAKE_CLEAN_COUNTS"])
counts = json.loads(counts_path.read_text()) if counts_path.exists() else {}
index = counts.get(tool, 0)
counts[tool] = index + 1
counts_path.write_text(json.dumps(counts))
entries = config.get(tool, [99])
entry = entries[min(index, len(entries) - 1)]
if not isinstance(entry, dict):
    entry = {"code": entry}
time.sleep(entry.get("sleep", 0))
print(entry.get("out", ""))
sys.exit(entry.get("code", 0))
'''


@pytest.fixture
def cleanup(desktop):
    fake_bin = desktop.root / "bin"
    for name in ("osascript", "pgrep", "kill", "pkill"):
        fake = fake_bin / name
        fake.write_text("#!/usr/bin/env python3\n" + FAKE_CLEAN_TOOL)
        fake.chmod(0o755)
    log = desktop.root / "cleanup.jsonl"
    log.touch()
    config = desktop.root / "cleanup-config.json"
    config.write_text(json.dumps({"osascript": [0], "osascript-running": [{"code": 0, "out": "false"}]}))
    desktop.env.update(FAKE_CLEAN_LOG=str(log), FAKE_CLEAN_CONFIG=str(config),
                       FAKE_CLEAN_COUNTS=str(desktop.root / "cleanup-counts.json"),
                       DESK_CLEAN_WAIT_S="1")
    desktop.state.mkdir(mode=0o700)
    (desktop.state / ".desk-state").write_text("")
    (desktop.state / "apps.json").write_text(json.dumps({BUNDLE: {"name": "Calculator"}}))
    yield desktop
    calls = [json.loads(line) for line in log.read_text().splitlines()]
    assert all(call["tool"] not in {"kill", "pkill", "pgrep"} for call in calls)
    assert not desktop.log.exists(), "cleanup must not call desktop tools"
    assert all(call[1] in {"sessions", "status", "stop"} for call in desktop.driver_calls())


def cleanup_calls(cleanup):
    return [json.loads(line) for line in (cleanup.root / "cleanup.jsonl").read_text().splitlines()]


def test_clean_own_files_removed_foreign_files_directories_symlinks_kept(cleanup):
    own = cleanup.state / "get_window_state-ab12cd34.json"
    own.write_text("{}")
    foreign = [cleanup.state / name for name in ("notes.json", "my-config.json", "notes.txt")]
    for path in foreign:
        path.write_text("keep")
    directory = cleanup.state / "tree-ab12cd34.json"
    directory.mkdir()
    linked = cleanup.state / "read-ab12cd34.json"
    linked.symlink_to(foreign[0])
    result = cleanup.run("desk-clean")
    assert result.returncode == 0, result.stderr
    assert result.stdout == "cleanup: app=left-open state_files_removed=2 remaining_own_files=0 driver=stopped\n"
    assert not own.exists() and not (cleanup.state / "apps.json").exists()
    assert all(path.read_text() == "keep" for path in foreign)
    assert directory.is_dir() and linked.is_symlink()
    assert cleanup_calls(cleanup) == []


def test_clean_preserves_other_bundle_cache_entries(cleanup):
    cache = cleanup.state / "apps.json"
    other = {"pid": 123, "window_id": 45}
    cache.write_text(json.dumps({BUNDLE: {"name": "Calculator"}, "com.other.app": other}))
    result = cleanup.run("desk-clean")
    assert result.returncode == 0, result.stderr
    assert json.loads(cache.read_text()) == {"com.other.app": other}
    assert stat.S_IMODE(cache.stat().st_mode) == 0o600
    assert result.stdout == "cleanup: app=left-open state_files_removed=0 remaining_own_files=1 driver=stopped\n"


def test_clean_launched_by_run_quits_with_explicit_name(cleanup):
    result = cleanup.run("desk-clean", "--app-name", "Calculator", "--launched-by-run")
    assert result.returncode == 0, result.stderr
    assert result.stdout == "cleanup: app=quit state_files_removed=1 remaining_own_files=0 driver=stopped\n"
    assert cleanup_calls(cleanup) == [
        {"tool": "osascript", "args": ["-e", 'quit app "Calculator"']},
        {"tool": "osascript-running", "args": ["-e", 'application "Calculator" is running']},
    ]


def test_clean_without_launch_flag_never_quits_even_with_name(cleanup):
    result = cleanup.run("desk-clean", "--app-name", "Calculator")
    assert result.returncode == 0, result.stderr
    assert "app=left-open" in result.stdout
    assert cleanup_calls(cleanup) == []


@pytest.mark.parametrize("source", ["apps", "launch-result"])
def test_clean_uses_cached_launch_name(cleanup, source):
    if source == "launch-result":
        (cleanup.state / "apps.json").write_text(json.dumps({BUNDLE: {"pid": 123, "window_id": 11}}))
        (cleanup.state / "launch_app-ab12cd34.json").write_text(
            json.dumps({"bundle_id": BUNDLE, "name": "Calculator"}))
    result = cleanup.run("desk-clean", "--launched-by-run")
    assert result.returncode == 0, result.stderr
    assert "app=quit" in result.stdout
    assert cleanup_calls(cleanup)[0]["args"] == ["-e", 'quit app "Calculator"']


def set_clean(cleanup, **config):
    Path(cleanup.env["FAKE_CLEAN_CONFIG"]).write_text(json.dumps(config))


RUNNING = {"code": 0, "out": "true"}
STOPPED = {"code": 0, "out": "false"}


def test_clean_waits_for_exit_without_force_kill(cleanup):
    set_clean(cleanup, osascript=[0], **{"osascript-running": [RUNNING, STOPPED]})
    result = cleanup.run("desk-clean", "--launched-by-run")
    assert result.returncode == 0, result.stderr
    assert "app=quit" in result.stdout
    assert [call["tool"] for call in cleanup_calls(cleanup)] == ["osascript", "osascript-running", "osascript-running"]


def test_clean_still_running_exits_three_and_removes_state(cleanup):
    cleanup.env["DESK_CLEAN_WAIT_S"] = "0.15"
    set_clean(cleanup, osascript=[0], **{"osascript-running": [RUNNING]})
    started = time.monotonic()
    result = cleanup.run("desk-clean", "--launched-by-run")
    assert result.returncode == 3, result.stderr
    assert time.monotonic() - started < 2
    assert result.stdout == "cleanup: app=still-running state_files_removed=1 remaining_own_files=0 driver=stopped\n"
    assert result.stderr == ""
    assert not (cleanup.state / "apps.json").exists()


def test_clean_missing_name_fails_safely_and_still_cleans_state(cleanup):
    (cleanup.state / "apps.json").write_text(json.dumps({BUNDLE: {"pid": 123, "window_id": 11}}))
    # A cached result belonging to another bundle cannot select the app to quit.
    (cleanup.state / "launch_app-ab12cd34.json").write_text(
        json.dumps({"bundle_id": "com.other.app", "name": "Other"}))
    result = cleanup.run("desk-clean", "--launched-by-run")
    assert result.returncode == 2
    assert "--app-name" in result.stderr
    assert len(result.stderr.splitlines()) == 1
    assert "remaining_own_files=0" in result.stdout
    assert cleanup_calls(cleanup) == []


def test_clean_escapes_applescript_name(cleanup):
    result = cleanup.run("desk-clean", "--app-name", 'Some "App" \\ Name', "--launched-by-run")
    assert result.returncode == 0, result.stderr
    assert cleanup_calls(cleanup)[0]["args"] == ["-e", 'quit app "Some \\"App\\" \\\\ Name"']


@pytest.mark.parametrize("check", [{"code": 2, "out": ""}, {"code": 0, "out": "maybe"}])
def test_clean_is_running_check_error_never_reports_quit(cleanup, check):
    set_clean(cleanup, osascript=[0], **{"osascript-running": [check]})
    result = cleanup.run("desk-clean", "--launched-by-run")
    assert result.returncode == 2
    assert "app=still-running" in result.stdout
    assert "is-running" in result.stderr
    assert not (cleanup.state / "apps.json").exists()


# D1: display name differs from the process name, so pgrep finds nothing while the app runs.
def test_d1_process_name_differs_but_app_still_running_exits_three(cleanup):
    cleanup.env["DESK_CLEAN_WAIT_S"] = "0.15"
    set_clean(cleanup, osascript=[0], pgrep=[1], **{"osascript-running": [RUNNING]})
    result = cleanup.run("desk-clean", "--app-name", "Example Editor", "--launched-by-run")
    assert result.returncode == 3, result.stdout + result.stderr
    assert "app=still-running" in result.stdout


# D2: a slow quit command while the app runs is still-running, not an osascript failure.
def test_d2_quit_timeout_with_app_running_exits_three(cleanup):
    cleanup.env.update(DESK_CLEAN_WAIT_S="0.15", DESK_CLEAN_QUIT_TIMEOUT_S="0.3")
    set_clean(cleanup, osascript=[{"code": 0, "sleep": 6}], **{"osascript-running": [RUNNING]})
    result = cleanup.run("desk-clean", "--launched-by-run")
    assert result.returncode == 3, result.stdout + result.stderr
    assert "app=still-running" in result.stdout


# D2: a failing quit command for an app that is already closed is a clean quit.
def test_d2_quit_nonzero_with_app_not_running_reports_quit(cleanup):
    set_clean(cleanup, osascript=[1], **{"osascript-running": [STOPPED]})
    result = cleanup.run("desk-clean", "--launched-by-run")
    assert result.returncode == 0, result.stderr
    assert "app=quit" in result.stdout


# D3: a dir without the marker, or not mode 0700, is never emptied.
@pytest.mark.parametrize("fault", ["no-marker", "mode-0755"])
def test_d3_state_dir_not_a_desk_dir_keeps_every_file(cleanup, fault):
    victim = cleanup.state / "tsconfig-template.json"  # matches the own-file pattern
    victim.write_text("keep")
    if fault == "no-marker":
        (cleanup.state / ".desk-state").unlink()
    else:
        cleanup.state.chmod(0o755)
    try:
        result = cleanup.run("desk-clean")
    finally:
        cleanup.state.chmod(0o700)
    assert result.returncode == 2
    assert len(result.stderr.splitlines()) == 1 and "refusing" in result.stderr
    assert victim.read_text() == "keep" and (cleanup.state / "apps.json").exists()


def test_d3_prune_skips_unmarked_populated_dir(desktop):
    desktop.state.mkdir(mode=0o700)
    old = desktop.state / "read-ab12cd34.json"
    old.write_text("{}")
    expired = time.time() - 8 * 24 * 60 * 60
    os.utime(old, (expired, expired))
    result = desktop.run("desk", "click", "{}")
    assert result.returncode == 0, result.stderr
    assert old.exists() and not (desktop.state / ".desk-state").exists()


def test_d3_prepare_state_writes_private_marker_in_new_dir(desktop):
    result = desktop.run("desk", "click", "{}")
    assert result.returncode == 0, result.stderr
    marker = desktop.state / ".desk-state"
    assert marker.is_file() and stat.S_IMODE(marker.stat().st_mode) == 0o600


# D4: an unreadable apps.json must not stop the rest of the cleanup.
def test_d4_unreadable_cache_still_deletes_other_own_files(cleanup):
    own = cleanup.state / "read-ab12cd34.json"
    own.write_text("{}")
    cache = cleanup.state / "apps.json"
    cache.chmod(0)
    try:
        result = cleanup.run("desk-clean")
    finally:
        if cache.exists():
            cache.chmod(0o600)
    assert result.returncode == 0, result.stderr
    assert result.stdout.startswith("cleanup: app=left-open state_files_removed=")
    assert not own.exists()


def test_clean_is_idempotent_with_missing_state_directory(cleanup):
    cleanup.env["DESK_STATE_DIR"] = str(cleanup.root / "absent-state")
    result = cleanup.run("desk-clean")
    assert result.returncode == 0, result.stderr
    assert result.stdout == "cleanup: app=left-open state_files_removed=0 remaining_own_files=0 driver=stopped\n"
    assert not Path(cleanup.env["DESK_STATE_DIR"]).exists()


def test_clean_entry_point_is_executable():
    assert os.access(DESK_DIR / "desk-clean", os.X_OK)


@pytest.mark.parametrize("script", ["desk", "desk-read"])
def test_driver_starts_on_demand_through_app_with_private_marker(desktop, script):
    desktop.configure_driver(_driver_running=False)
    args = ("click", "{}") if script == "desk" else ("AXStaticText",)
    result = desktop.run(script, *args)
    assert result.returncode == 0, result.stderr
    calls = desktop.driver_calls()
    assert calls[:3] == [["cua-driver", "status"],
                         ["open", "-g", "-a", "/Applications/CuaDriver.app", "--args", "serve"],
                         ["cua-driver", "status"]]
    assert sum(call[0] == "open" for call in calls) == 1
    marker = desktop.state / "driver-started"
    assert marker.is_file() and stat.S_IMODE(marker.stat().st_mode) == 0o600


@pytest.mark.parametrize("script", ["desk", "desk-read"])
def test_driver_already_running_does_not_start_app(desktop, script):
    args = ("click", "{}") if script == "desk" else ("AXStaticText",)
    result = desktop.run(script, *args)
    assert result.returncode == 0, result.stderr
    assert all(call[0] != "open" for call in desktop.driver_calls())
    assert not (desktop.state / "driver-started").exists()


def test_driver_open_failure_exits_two_without_desktop_calls(desktop):
    desktop.configure_driver(_driver_running=False, _open_exit=7)
    result = desktop.run("desk", "click", "{}")
    assert result.returncode == 2
    assert len(result.stderr.splitlines()) == 1
    assert "open exited 7" in result.stderr
    assert not desktop.log.exists()


def test_driver_start_timeout_exits_two_without_desktop_calls(desktop):
    desktop.configure_driver(_driver_running=False, _open_starts=False)
    result = desktop.run("desk-read", "AXStaticText")
    assert result.returncode == 2
    assert len(result.stderr.splitlines()) == 1
    assert "daemon not running within 10 s" in result.stderr
    assert not desktop.log.exists()


def test_clean_stops_driver_without_start_marker(cleanup):
    result = cleanup.run("desk-clean")
    assert result.returncode == 0, result.stderr
    assert "driver=stopped" in result.stdout
    assert cleanup.driver_calls() == [["cua-driver", "sessions"], ["cua-driver", "status"],
                                      ["cua-driver", "stop"], ["cua-driver", "status"]]


def test_clean_removes_driver_start_marker(cleanup):
    marker = cleanup.state / "driver-started"
    marker.write_text("")
    result = cleanup.run("desk-clean")
    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_clean_live_session_preserves_second_runs_driver(cleanup):
    cleanup.configure_driver(_sessions="session-2: attached")
    result = cleanup.run("desk-clean")
    assert result.returncode == 0, result.stderr
    assert "driver=left-running-live-sessions" in result.stdout
    assert cleanup.driver_calls() == [["cua-driver", "sessions"], ["cua-driver", "status"]]
    assert not Path(cleanup.env["FAKE_DRIVER_STATE"]).exists()


def test_clean_ignored_stop_exits_three_without_force_kill(cleanup):
    cleanup.configure_driver(_ignore_stop=True)
    started = time.monotonic()
    result = cleanup.run("desk-clean")
    assert result.returncode == 3, result.stderr
    assert "driver=stop-failed" in result.stdout
    assert 5 <= time.monotonic() - started < 8
    assert cleanup.driver_calls().count(["cua-driver", "stop"]) == 1
    assert not Path(cleanup.env["FAKE_DRIVER_STATE"]).exists()


def test_clean_already_stopped_does_not_stop_again(cleanup):
    cleanup.configure_driver(_driver_running=False)
    result = cleanup.run("desk-clean")
    assert result.returncode == 0, result.stderr
    assert "driver=already-stopped" in result.stdout
    assert cleanup.driver_calls() == [["cua-driver", "sessions"], ["cua-driver", "status"]]


@pytest.mark.parametrize("config", [{"_sessions_exit": 1}, {"_status_text": "status unavailable"}])
def test_clean_unknown_driver_state_fails_without_stopping(cleanup, config):
    cleanup.configure_driver(**config)
    result = cleanup.run("desk-clean")
    assert result.returncode == 3
    assert "driver=stop-failed" in result.stdout
    assert ["cua-driver", "stop"] not in cleanup.driver_calls()


@pytest.mark.parametrize("script,args", [("desk", ("click", "{}")),
                                         ("desk-read", ("AXStaticText",))])
@pytest.mark.parametrize("code", [1, 7])
def test_driver_failure_exit_code_is_preserved(desktop, script, args, code):
    tool = "click" if script == "desk" else "get_window_state"
    desktop.set_responses(tool, {"error": "synthetic action failure"}, returncodes=[code])
    result = desktop.run(script, *args)
    assert result.returncode == code


@pytest.mark.parametrize("script,args", [("desk", ("click", "{}")),
                                         ("desk-read", ("AXStaticText",))])
def test_error_result_without_driver_failure_exits_one(desktop, script, args):
    tool = "click" if script == "desk" else "get_window_state"
    desktop.set_responses(tool, {"error": "synthetic result failure"})
    result = desktop.run(script, *args)
    assert result.returncode == 1


@pytest.mark.parametrize("script,args", [("desk", ("click", "[]")),
                                         ("desk", ("click", "{")),
                                         ("desk-read", ("AXStaticText", "--max", "-1"))])
def test_invalid_arguments_exit_two_without_desktop_call(desktop, script, args):
    result = desktop.run(script, *args)
    assert result.returncode == 2
    assert not desktop.log.exists()


@pytest.mark.parametrize("script", ["desk", "desk-read", "desk-clean"])
def test_help_exit_zero_and_missing_arguments_exit_two(script):
    command = [sys.executable, str(DESK_DIR / script)]
    help_result = subprocess.run([*command, "--help"], capture_output=True, text=True, timeout=5)
    missing = subprocess.run(command, capture_output=True, text=True, timeout=5)
    assert help_result.returncode == 0
    assert missing.returncode == 2


def test_documented_exit_table_names_real_cases():
    rows = json.loads((DESK_DIR / "exit-codes.json").read_text())
    source = Path(__file__).read_text()
    for row in rows:
        assert "def " + row["test"] + "(" in source
        assert row["command"] in {"desk", "desk-read", "desk-clean"}
        assert row["exit"] in {"0", "1", "2", "3", "other nonzero"}
    assert len({(row["command"], row["exit"]) for row in rows}) == len(rows)


def _resolver(monkeypatch, tmp_path):
    monkeypatch.syspath_prepend(str(DESK_DIR))
    monkeypatch.setenv("DESK_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("LEAN_COMPUTER_USE_LEASES", str(tmp_path / "leases"))
    sys.modules.pop("_resolve", None)
    import _resolve
    return _resolve


def test_slow_status_probe_keeps_polling_until_daemon_runs(monkeypatch, tmp_path):
    resolver = _resolver(monkeypatch, tmp_path)
    answers = iter([False, "slow", True])

    def status(timeout=5):
        answer = next(answers)
        if answer == "slow":
            raise resolver.DeskError("cua-driver status timed out")
        return answer

    monkeypatch.setattr(resolver, "driver_status", status)
    monkeypatch.setattr(resolver.subprocess, "run",
                        lambda *a, **k: subprocess.CompletedProcess(a, 0, "", ""))
    resolver.ensure_driver()
    assert (tmp_path / "state" / "driver-started").exists()


def test_open_timeout_is_reported_as_itself_not_as_a_missing_window(monkeypatch, tmp_path):
    resolver = _resolver(monkeypatch, tmp_path)
    monkeypatch.setattr(resolver, "driver_status", lambda timeout=5: False)

    def slow_open(*args, **kwargs):
        raise subprocess.TimeoutExpired(args[0], 5)

    monkeypatch.setattr(resolver.subprocess, "run", slow_open)
    with pytest.raises(resolver.DeskError, match="open timed out"):
        resolver.resolve("com.apple.calculator")


def test_driver_started_by_desk_is_stopped_when_its_lease_cannot_be_recorded(monkeypatch, tmp_path):
    resolver = _resolver(monkeypatch, tmp_path)
    import _lease
    stops = []
    answers = [False, True]
    monkeypatch.setattr(resolver, "driver_status", lambda timeout=5: answers.pop(0))
    monkeypatch.setattr(resolver.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 0, "", ""))
    monkeypatch.setattr(resolver, "driver_command", lambda command, timeout=5: stops.append(command))
    monkeypatch.setattr(_lease, "record_driver", lambda launched: (_ for _ in ()).throw(OSError("lease directory unusable")))
    with pytest.raises(resolver.DeskError, match="cannot record a lease"):
        resolver.ensure_driver()
    assert stops == ["stop"]


def test_driver_started_by_desk_is_leased_for_this_session(monkeypatch, tmp_path):
    resolver = _resolver(monkeypatch, tmp_path)
    import _lease
    seen = []
    answers = [False, True]
    monkeypatch.setattr(resolver, "driver_status", lambda timeout=5: answers.pop(0))
    monkeypatch.setattr(resolver.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 0, "", ""))
    monkeypatch.setattr(_lease, "record_driver", lambda launched: seen.append(launched))
    resolver.ensure_driver()
    assert len(seen) == 1 and seen[0] <= time.time()
    # A daemon that was already running is never leased.
    monkeypatch.setattr(resolver, "driver_status", lambda timeout=5: True)
    resolver.ensure_driver()
    assert len(seen) == 1
