"""Hook contracts use stdin payloads and isolated, run-owned state."""
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOOKS = Path(__file__).resolve().parents[1]
RETRY = "native_retry_guard"
NUDGE = "native_batch_nudge"


class HookContracts(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix=".hook-test-", dir=HOOKS / "tests")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.state = self.root / "state"
        self.env = dict(os.environ, LEAN_COMPUTER_USE_STATE=str(self.state), PYTHONDONTWRITEBYTECODE="1")

    def payload(self, event="PostToolUse", tool="mcp__cua-driver__click", inputs=None,
                response=None, session="test-session", agent=None):
        value = {"session_id": session, "hook_event_name": event, "tool_name": tool,
                 "tool_input": inputs if inputs is not None else {"pid": 42, "window_id": 7, "x": 10},
                 "tool_response": response if response is not None else {"isError": True}}
        if agent is not None:
            value["agent_id"] = agent
        return value

    def run_hook(self, name=RETRY, payload=None, raw=None, shim=False, folder=HOOKS):
        script = folder / (name + (".sh" if shim else ".py"))
        command = [str(script)] if shim else [sys.executable, str(script)]
        return subprocess.run(command, input=raw if raw is not None else json.dumps(payload or self.payload()),
                              env=self.env, capture_output=True, text=True, timeout=5)

    def errors(self, count=2, **options):
        for _ in range(count):
            self.assertEqual(self.run_hook(payload=self.payload(**options)).returncode, 0)

    def pre(self, **options):
        return self.run_hook(payload=self.payload(event="PreToolUse", **options))

    def nudge(self, **options):
        return self.run_hook(NUDGE, self.payload(response={"ok": True}, **options))

    def test_first_and_second_identical_error_pass_third_is_blocked(self):
        self.assertEqual(self.pre().returncode, 0)
        self.errors(1)
        self.assertEqual(self.pre().returncode, 0)
        self.errors(1)
        blocked = self.pre()
        self.assertEqual(blocked.returncode, 2)
        self.assertEqual(blocked.stdout, "")
        self.assertIn("Stop and report", blocked.stderr)
        self.assertIn("different approach", blocked.stderr)

    def test_identical_input_key_order_uses_same_fingerprint(self):
        self.errors()
        blocked = self.pre(inputs={"x": 10, "window_id": 7, "pid": 42})
        self.assertEqual(blocked.returncode, 2)

    def test_changed_input_is_a_new_approach(self):
        self.errors()
        self.assertEqual(self.pre(inputs={"pid": 42, "window_id": 7, "x": 11}).returncode, 0)

    def test_success_of_same_fingerprint_resets_errors(self):
        self.errors()
        self.run_hook(payload=self.payload(response={"ok": True}))
        self.assertEqual(self.pre().returncode, 0)

    def test_success_on_different_target_resets_errors(self):
        self.errors()
        self.run_hook(payload=self.payload(tool="mcp__computer-use__type_text",
                                          inputs={"pid": 51, "window_id": 8}, response={"ok": True}))
        self.assertEqual(self.pre().returncode, 0)

    def test_success_on_same_target_with_different_input_keeps_error(self):
        self.errors()
        self.run_hook(payload=self.payload(tool="mcp__computer-use__type_text",
                                          inputs={"pid": 42, "window_id": 7}, response={"ok": True}))
        self.assertEqual(self.pre().returncode, 2)

    def test_different_failed_call_starts_new_error_count(self):
        self.errors()
        changed = {"pid": 42, "window_id": 7, "x": 11}
        self.errors(1, inputs=changed)
        self.assertEqual(self.pre(inputs=changed).returncode, 0)
        self.assertEqual(self.pre().returncode, 0)

    def test_sessions_and_subagents_have_separate_counts(self):
        self.errors()
        self.assertEqual(self.pre(session="other-session").returncode, 0)
        self.assertEqual(self.pre(agent="runner-one").returncode, 0)
        self.errors(agent="runner-one")
        self.assertEqual(self.pre(agent="runner-one").returncode, 2)
        self.assertEqual(self.pre(agent="runner-two").returncode, 0)

    def test_probe_tools_never_count_or_block(self):
        for prefix in ("mcp__computer-use__", "mcp__cua-driver__"):
            for name in ("list_apps", "list_windows", "launch_app", "end_session", "status", "list_tools"):
                with self.subTest(tool=prefix + name):
                    self.errors(3, tool=prefix + name)
                    self.assertEqual(self.pre(tool=prefix + name).returncode, 0)
        self.assertFalse(self.state.exists())

    def test_bash_probe_tools_never_count_or_block(self):
        for name in ("list_apps", "list_windows", "launch_app", "end_session", "status", "list_tools"):
            options = {"tool": "Bash", "inputs": {"command": f"desk com.example.app {name} '{{}}'"}}
            self.errors(3, **options)
            self.assertEqual(self.pre(**options).returncode, 0)
        self.assertFalse(self.state.exists())

    def test_native_error_response_shapes_are_counted(self):
        responses = [{"isError": True}, {"is_error": True}, "Error: synthetic failure",
                     {"content": [{"type": "text", "text": "  ERROR: synthetic failure"}]},
                     {"error": "synthetic failure"}]
        for index, response in enumerate(responses):
            with self.subTest(response=response):
                options = {"session": f"shape-{index}", "response": response}
                self.errors(**options)
                self.assertEqual(self.pre(session=options["session"]).returncode, 2)

    def test_bash_nonzero_and_desk_stderr_are_counted(self):
        responses = [{"exit_code": 1}, {"exitCode": 7}, {"returncode": 2},
                     {"stderr": "desk: synthetic failure"}, {"stderr": "desk-read: synthetic failure"}]
        for index, response in enumerate(responses):
            options = {"session": f"bash-{index}", "tool": "Bash",
                       "inputs": {"command": "desk com.example.app click '{}'"}}
            self.errors(response=response, **options)
            self.assertEqual(self.pre(**options).returncode, 2)

    def test_bash_only_matches_command_segment_first_word(self):
        ignored = ["echo desk com.example.app click '{}'", "python3 desk com.example.app click '{}'",
                   "printf '%s' 'desk com.example.app click'", "echo '&&' desk com.example.app click",
                   "echo 'a; desk com.example.app click'", "echo \\; desk com.example.app click",
                   "# desk com.example.app click", "echo ready # note && desk com.example.app click",
                   "# note; desk com.example.app click",
                   "cat <<TEXT\ndesk com.example.app click\nTEXT"]
        for command in ignored:
            with self.subTest(command=command):
                options = {"tool": "Bash", "inputs": {"command": command}}
                self.errors(3, **options)
                self.assertEqual(self.pre(**options).returncode, 0)
        self.assertFalse(self.state.exists())

    def test_bash_accepts_path_and_later_command_segment(self):
        commands = ["'/example folder/desk' com.example.app click '{}'",
                    "echo ready; desk com.example.app click '{}'",
                    "echo ready\ndesk-read com.example.app AXStaticText",
                    '"$DESK/desk-clean" com.example.app']
        for index, command in enumerate(commands):
            options = {"session": f"segment-{index}", "tool": "Bash", "inputs": {"command": command}}
            self.errors(**options)
            self.assertEqual(self.pre(**options).returncode, 2)

    def test_malformed_stdin_and_missing_session_fail_open(self):
        for name in (RETRY, NUDGE):
            for raw in ("{", "null", "[]", "3", json.dumps({"tool_name": "mcp__cua-driver__click"})):
                with self.subTest(hook=name, raw=raw):
                    result = self.run_hook(name, raw=raw)
                    self.assertEqual(result.returncode, 0)
                    self.assertEqual(result.stdout + result.stderr, "")

    def test_internal_state_error_fails_open(self):
        self.state.write_text("synthetic obstruction")
        for name in (RETRY, NUDGE):
            self.assertEqual(self.run_hook(name).returncode, 0)

    def test_unsafe_state_directory_fails_open(self):
        self.state.mkdir(mode=0o755)
        for name in (RETRY, NUDGE):
            self.assertEqual(self.run_hook(name).returncode, 0)
        self.assertEqual(list(self.state.iterdir()), [])

    def test_state_is_private_and_does_not_retain_payload(self):
        self.errors()
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode), 0o700)
        digest = hashlib.sha256(b"test-session").hexdigest()[:24]
        self.assertTrue((self.state / (digest + ".json")).is_file())
        for path in self.state.iterdir():
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertNotIn("synthetic failure", path.read_text())
            self.assertNotIn("window_id", path.read_text())

    def test_default_state_root_uses_tempdir_and_uid(self):
        self.env.pop("LEAN_COMPUTER_USE_STATE")
        self.env["TMPDIR"] = str(self.root)
        self.errors()
        default = self.root / f"lean-computer-use-{os.getuid()}"
        self.assertTrue(default.is_dir())
        self.assertEqual(stat.S_IMODE(default.stat().st_mode), 0o700)
        self.assertEqual(self.pre().returncode, 2)

    def test_symlink_state_directory_fails_open(self):
        target = self.root / "owned-directory"
        target.mkdir(mode=0o700)
        self.state.symlink_to(target, target_is_directory=True)
        self.assertEqual(self.run_hook().returncode, 0)
        self.assertEqual(list(target.iterdir()), [])

    def test_corrupt_state_recovers_without_blocking(self):
        self.state.mkdir(mode=0o700)
        digest = hashlib.sha256(b"test-session").hexdigest()[:24]
        (self.state / (digest + ".json")).write_text("{")
        self.assertEqual(self.pre().returncode, 0)
        self.errors()
        self.assertEqual(self.pre().returncode, 2)

    def test_symlink_state_file_fails_open_and_preserves_target(self):
        self.state.mkdir(mode=0o700)
        target = self.root / "keep.json"
        target.write_text('{"keep":true}')
        digest = hashlib.sha256(b"test-session").hexdigest()[:24]
        (self.state / (digest + ".json")).symlink_to(target)
        self.assertEqual(self.run_hook().returncode, 0)
        self.assertEqual(target.read_text(), '{"keep":true}')

    def test_missing_python_file_shims_fail_open(self):
        for name in (RETRY, NUDGE):
            shutil.copy2(HOOKS / (name + ".sh"), self.root)
            result = self.run_hook(name, shim=True, folder=self.root)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout + result.stderr, "")

    def test_retry_shim_preserves_only_block_exit(self):
        self.errors()
        result = self.run_hook(payload=self.payload(event="PreToolUse"), shim=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.run_hook(shim=True, raw="{").returncode, 0)

    def test_batch_nudge_once_per_streak(self):
        results = [self.nudge() for _ in range(4)]
        self.assertEqual([bool(result.stdout) for result in results], [False, True, False, False])
        hint = json.loads(results[1].stdout)["hookSpecificOutput"]
        self.assertEqual(hint["hookEventName"], "PostToolUse")
        self.assertIn("ONE call", hint["additionalContext"])
        self.assertIn("filtered desk-read", hint["additionalContext"])
        self.assertTrue(all(result.returncode == 0 for result in results))

    def test_batch_probe_resets_streak(self):
        self.nudge()
        self.assertTrue(self.nudge().stdout)
        self.assertEqual(self.nudge(tool="mcp__cua-driver__list_windows").stdout, "")
        self.assertEqual(self.nudge().stdout, "")
        self.assertTrue(self.nudge().stdout)

    def test_batch_filtered_read_and_cleanup_reset_streak(self):
        for index, command in enumerate(("desk-read com.example.app AXStaticText", "desk-clean com.example.app")):
            options = {"session": f"reset-{index}"}
            self.nudge(**options)
            self.assertTrue(self.nudge(**options).stdout)
            self.assertEqual(self.nudge(tool="Bash", inputs={"command": command}, **options).stdout, "")
            self.assertEqual(self.nudge(**options).stdout, "")

    def test_batch_chained_desk_commands_reset_streak(self):
        self.nudge()
        chained = "desk com.example.app click '{}' && desk com.example.app press_key '{}'"
        self.assertEqual(self.nudge(tool="Bash", inputs={"command": chained}).stdout, "")
        self.assertEqual(self.nudge().stdout, "")
        self.assertTrue(self.nudge().stdout)

    def test_batch_quoted_operator_is_still_a_single_action(self):
        command = "desk com.example.app type_text '{\"text\":\"a && b\"}'"
        self.assertEqual(self.nudge(tool="Bash", inputs={"command": command}).stdout, "")
        self.assertTrue(self.nudge(tool="Bash", inputs={"command": command}).stdout)

    def test_batch_unrelated_bash_is_ignored(self):
        self.nudge()
        self.assertEqual(self.nudge(tool="Bash", inputs={"command": "printf 'ready'"}).stdout, "")
        self.assertTrue(self.nudge().stdout)

    def test_batch_pre_event_and_foreign_tools_are_ignored(self):
        self.assertEqual(self.run_hook(NUDGE, self.payload(event="PreToolUse")).stdout, "")
        self.assertEqual(self.nudge(tool="Read").stdout, "")
        self.assertFalse(self.state.exists())

    def test_hooks_share_state_without_overwriting_each_other(self):
        self.errors()
        self.nudge()
        self.assertEqual(self.pre().returncode, 2)
        self.assertTrue(self.nudge().stdout)

    def test_settings_registers_native_and_narrow_bash_entries(self):
        snippet = json.loads((HOOKS / "settings-snippet.json").read_text())
        for event in ("PreToolUse", "PostToolUse"):
            entries = snippet["hooks"][event]
            self.assertEqual({item["matcher"] for item in entries},
                             {"mcp__computer-use__.*|mcp__cua-driver__.*", "Bash"})
            self.assertTrue(all(item["marker"] == "lean-computer-use" for item in entries))
            self.assertTrue(all("__HOOKS_DIR__" in hook["command"] for item in entries for hook in item["hooks"]))


if __name__ == "__main__":
    unittest.main()
