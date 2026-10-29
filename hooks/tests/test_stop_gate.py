"""Stop gate contracts: touch records desktop control, the gate blocks once, keep holds it."""
import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

HOOKS = Path(__file__).resolve().parents[1]
REASON_PARTS = ("ends the control", "user already had open stay open",
                'npx --yes lean-computer-use keep --reason "<why>"', "what stays held and why")


class StopGateContracts(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix=".gate-test-", dir=HOOKS / "tests")
        self.addCleanup(self.temporary.cleanup)
        self.dir = Path(self.temporary.name) / "surfaces"
        self.env = dict(os.environ, LEAN_COMPUTER_USE_SURFACES=str(self.dir), PYTHONDONTWRITEBYTECODE="1")
        self.env.pop("CLAUDE_CODE_SESSION_ID", None)
        self.env.pop("CLAUDE_SESSION_ID", None)

    def action(self, tool="app_click", server="computer-use", **extra):
        value = {"session_id": "session", "hook_event_name": "PostToolUse",
                 "tool_name": f"mcp__{server}__{tool}", "tool_input": {}, "tool_response": {}}
        value.update(extra)
        return value

    def stop(self, **extra):
        value = {"session_id": "session", "hook_event_name": "Stop", "stop_hook_active": False,
                 "background_tasks": []}
        value.update(extra)
        return value

    def agent_stop(self, **extra):
        return self.stop(**{"hook_event_name": "SubagentStop", "agent_type": "desk-runner", "agent_id": "a1", **extra})

    def file(self, agent="", session="session"):
        identity = session + ("\0" + agent if agent else "")
        return self.dir / (hashlib.sha256(identity.encode()).hexdigest()[:24] + ".json")

    def state(self, agent="", session="session"):
        return json.loads(self.file(agent, session).read_text())

    def run_hook(self, name, payload, shim=False):
        script = HOOKS / (name + (".sh" if shim else ".py"))
        command = [str(script)] if shim else [sys.executable, str(script)]
        raw = payload if isinstance(payload, str) else json.dumps(payload)
        return subprocess.run(command, input=raw, env=self.env, capture_output=True, text=True, timeout=5)

    def silent(self, name, payload, shim=False):
        result = self.run_hook(name, payload, shim)
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""))
        return result

    def touch(self, payload=None):
        return self.silent("touch_hook", payload or self.action())

    def blocked(self, payload=None, servers=("computer-use",), shim=False):
        result = self.run_hook("stop_gate", payload or self.stop(), shim)
        self.assertEqual((result.returncode, result.stderr), (0, ""))
        value = json.loads(result.stdout)
        self.assertEqual(list(value), ["decision", "reason"])
        self.assertEqual(value["decision"], "block")
        for part in REASON_PARTS:
            self.assertIn(part, value["reason"])
        if "computer-use" in servers:
            self.assertIn("computer-use: release_full_control or app_release", value["reason"])
        if "cua-driver" in servers:
            self.assertIn("cua-driver: end_session", value["reason"])
        return value

    def keep(self, *args, env=None):
        command = [sys.executable, str(HOOKS / "_surfaces.py"), "keep", *args]
        return subprocess.run(command, env=env or self.env, capture_output=True, text=True, timeout=5)

    def test_action_dirties_and_each_successful_close_cleans_desktop(self):
        for server, tool in (("computer-use", "release_full_control"), ("computer-use", "app_release"),
                             ("cua-driver", "end_session")):
            self.touch(self.action(server=server))
            use = self.state()["surfaces"]["desktop"]
            self.assertGreater(use["lastAction"], use["lastClose"])
            self.assertFalse(use["kept"])
            self.assertIn(server, use["servers"])
            self.touch(self.action(tool, server))
            use = self.state()["surfaces"]["desktop"]
            self.assertGreaterEqual(use["lastClose"], use["lastAction"])
        self.assertEqual(self.state()["surfaces"]["desktop"]["closes"], 3)
        self.silent("stop_gate", self.stop())

    def test_state_is_private_and_holds_no_inputs(self):
        self.touch(self.action(tool_input={"text": "secret words"}, tool_response={"content": "screen text"}))
        self.assertEqual(stat.S_IMODE(self.dir.stat().st_mode), 0o700)
        self.assertNotIn("secret", self.file().read_text())
        self.assertNotIn("screen", self.file().read_text())
        self.assertEqual(self.state()["session"], hashlib.sha256(b"session").hexdigest())

    def test_red_dirty_desktop_blocks_stop_with_close_tool_and_keep_command(self):
        self.touch()
        self.blocked()
        self.assertGreater(self.state()["blockedAt"], 0)

    def test_red_active_stop_resolves_once_and_new_action_rearms(self):
        self.touch()
        self.blocked()
        self.silent("stop_gate", self.stop(stop_hook_active=True))
        use = self.state()["surfaces"]["desktop"]
        self.assertGreaterEqual(use["lastClose"], use["lastAction"])
        self.silent("stop_gate", self.stop())
        self.touch()
        self.blocked()

    def test_repeated_inactive_stop_cannot_block_twice_for_one_stretch(self):
        self.touch()
        self.blocked()
        self.silent("stop_gate", self.stop())
        self.silent("stop_gate", self.stop())

    def test_red_failed_close_closes_nothing(self):
        for response in ({"isError": True}, {"is_error": True}, {"error": "denied"}, "Error: no control held",
                         {"content": [{"type": "text", "text": "error: not granted"}]}):
            with self.subTest(response=response):
                self.file().unlink(missing_ok=True)
                self.touch()
                self.touch(self.action("release_full_control", tool_response=response))
                self.assertEqual(self.state()["surfaces"]["desktop"]["closes"], 0)
                self.blocked()

    def test_probes_neither_start_nor_clean_and_other_tools_are_ignored(self):
        probes = ["list_apps", "list_windows", "app_list_windows", "list_granted_applications",
                  "request_access", "status", "list_tools"]
        payloads = [self.action(name) for name in probes] + [self.action(name, "cua-driver") for name in probes]
        payloads += [self.action(tool_name="mcp__claude-in-chrome__navigate"), self.action(tool_name="Bash")]
        for payload in payloads:
            self.touch(payload)
        self.assertFalse(self.dir.exists())
        self.touch()
        before = self.file().read_text()
        for payload in payloads:
            self.touch(payload)
        self.assertEqual(self.file().read_text(), before)

    def test_red_close_never_starts_a_surface_or_the_state_directory(self):
        for tool in ("release_full_control", "app_release", "end_session"):
            self.touch(self.action(tool))
        self.assertFalse(self.dir.exists())
        self.silent("stop_gate", self.stop())
        self.assertFalse(self.dir.exists())

    def test_cua_driver_action_names_end_session(self):
        self.touch(self.action("click", "cua-driver"))
        self.blocked(servers=("cua-driver",))
        self.touch(self.action("end_session", "cua-driver"))
        self.silent("stop_gate", self.stop())

    def test_both_servers_name_their_close_tools(self):
        self.touch()
        self.touch(self.action("click", "cua-driver"))
        self.blocked(servers=("computer-use", "cua-driver"))

    def test_subagent_and_main_keys_stay_separate(self):
        self.touch(self.action(agent_id="a1"))
        self.assertFalse(self.file().exists())
        self.assertEqual(self.state("a1")["session"], hashlib.sha256(b"session").hexdigest())
        self.silent("stop_gate", self.stop())
        self.blocked(self.agent_stop())
        self.touch()
        self.blocked()

    def test_runner_ignores_main_use_and_other_agent_types_are_ignored(self):
        self.touch()
        self.silent("stop_gate", self.agent_stop())
        self.touch(self.action(agent_id="a1"))
        self.silent("stop_gate", self.agent_stop(agent_type="other"))
        self.blocked(self.agent_stop())

    def test_background_tasks_defer_without_resolving_or_blocking(self):
        self.touch()
        self.silent("stop_gate", self.stop(background_tasks=[{"type": "shell"}]))
        self.assertNotIn("blockedAt", self.state())
        self.blocked()

    def test_shim_preserves_block_json_on_stdout(self):
        self.silent("touch_hook", self.action(), shim=True)
        self.blocked(shim=True)

    def test_malformed_payloads_and_invalid_sessions_fail_open_silently(self):
        payloads = ["{malformed", "null", "[]", "{}", self.stop(session_id=""), self.stop(session_id="x" * 201),
                    self.stop(session_id=4), self.stop(hook_event_name="SessionEnd"),
                    self.agent_stop(agent_id=None), self.action(session_id=""), self.action(agent_id="")]
        for name in ("touch_hook", "stop_gate"):
            for payload in payloads:
                self.silent(name, payload)
        self.assertFalse(self.dir.exists())

    def test_corrupt_state_and_unsafe_directory_fail_open_silently(self):
        self.touch()
        self.file().write_text("{malformed")
        self.silent("touch_hook", self.action())
        self.silent("stop_gate", self.stop())
        self.dir.chmod(0o755)
        self.silent("touch_hook", self.action())
        self.silent("stop_gate", self.stop())
        blocker = Path(self.temporary.name) / "file"
        blocker.write_text("file")
        self.env["LEAN_COMPUTER_USE_SURFACES"] = str(blocker)
        self.silent("touch_hook", self.action())
        self.silent("stop_gate", self.stop())

    def test_state_older_than_a_day_is_pruned(self):
        self.touch(self.action(session_id="old"))
        old = self.file(session="old")
        past = time.time() - 90000
        os.utime(old, (past, past))
        self.touch()
        self.assertFalse(old.exists())

    def test_keep_holds_main_and_agent_surfaces_and_leaves_other_sessions(self):
        self.touch()
        self.touch(self.action(agent_id="a1"))
        self.touch(self.action(session_id="other"))
        result = self.keep("--reason", "review", "--session", "session")
        self.assertEqual((result.returncode, result.stdout), (0, "keep: 2 surface(s) held: review\n"))
        for agent in ("", "a1"):
            self.assertEqual(self.state(agent)["keepReason"], "review")
            self.assertTrue(self.state(agent)["surfaces"]["desktop"]["kept"])
        self.assertFalse(self.state(session="other")["surfaces"]["desktop"]["kept"])
        self.silent("stop_gate", self.stop())

    def test_red_keep_with_only_the_session_reaches_runner_state(self):
        self.touch(self.action(agent_id="a1"))
        self.assertEqual(self.keep("--reason", "review", "--session", "session").returncode, 0)
        self.silent("stop_gate", self.agent_stop())

    def test_later_action_clears_keep_and_rearms(self):
        self.touch()
        self.assertEqual(self.keep("--reason", "review", "--session", "session").returncode, 0)
        self.touch()
        self.assertNotIn("keepReason", self.state())
        self.assertFalse(self.state()["surfaces"]["desktop"]["kept"])
        self.blocked()

    def test_keep_requires_reason_and_session_and_reads_the_environment(self):
        self.touch()
        for args in ([], ["--reason", "   "], ["--reason", "x"], ["--reason", "x", "--session", "y" * 201]):
            self.assertEqual(self.keep(*args).returncode, 2, args)
        env = dict(self.env, CLAUDE_CODE_SESSION_ID="session")
        self.assertEqual(self.keep("--reason", "review", env=env).returncode, 0)
        self.assertTrue(self.state()["surfaces"]["desktop"]["kept"])

    def test_stale_counts_sessions_and_ignores_kept_or_recent(self):
        stale = [sys.executable, str(HOOKS / "_surfaces.py"), "stale"]
        count = lambda: json.loads(subprocess.run(stale, env=self.env, capture_output=True, text=True).stdout)["sessions"]
        self.assertEqual(count(), 0)
        self.touch()
        self.touch(self.action(agent_id="a1"))
        self.assertEqual(count(), 0)
        for agent in ("", "a1"):
            value = self.state(agent)
            value["surfaces"]["desktop"]["lastAction"] -= 660000
            self.file(agent).write_text(json.dumps(value))
        self.assertEqual(count(), 1)
        self.assertEqual(self.keep("--reason", "review", "--session", "session").returncode, 0)
        self.assertEqual(count(), 0)


if __name__ == "__main__":
    unittest.main()
