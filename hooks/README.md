# Native-app hooks

The optional hooks help a runner stop a repeated error, combine small actions and end the processes it leased. Install their registrations with `npx lean-computer-use --with-hooks`. The installer merges [settings-snippet.json](settings-snippet.json) into the selected Claude Code settings file, substitutes the installed hook folder for `__HOOKS_DIR__`, and marks the entries `lean-computer-use`. Uninstall removes those marked entries while preserving other settings.

Claude Code calls a self-locating shell shim with a JSON payload on stdin. The shim runs its neighboring Python file, which imports `_common.py`. Python uses only its standard library. The hooks run locally and make no network requests. Nothing watches their state or alerts when a hook fails open; the runner still stops and reports after the same error twice.

| Hook | Trigger | Result |
| --- | --- | --- |
| `native_retry_guard.sh` | PreToolUse and PostToolUse for native MCP tools and desk commands | Records an error result and blocks a third attempt with identical tool name and input after two errors |
| `native_batch_nudge.sh` | PostToolUse for native MCP tools and desk commands | Adds one non-blocking context hint after consecutive single actions |
| `cleanup_hook.sh` | SubagentStop (matcher `desk-runner`), Stop and SessionEnd | Ends the session's leased processes through `desk/desk-reap`; always exits 0 |
| `touch_hook.sh` | PostToolUse for native MCP tools | Records desktop actions and successful releases per session and subagent; always exits 0 |
| `stop_gate.sh` | Stop and SubagentStop (matcher `desk-runner`) | Blocks once per held stretch with the release tool and the `keep` command; always exits 0 |

MCP matchers cover `mcp__computer-use__.*` and `mcp__cua-driver__.*`. Bash has its own registration. The scripts match `desk`, `desk-read` and `desk-clean` only when one is the first word of a command segment. Quoted arguments and unrelated shell commands stay outside that match. Here-document payloads are ignored.

## State and closed loop

State lives under `LEAN_COMPUTER_USE_STATE`, or under `${TMPDIR:-/tmp}/lean-computer-use-<uid>` by default. The directory must be owned by the current user with mode 0700. State and lock files use mode 0600. A session's filename is its SHA-256 prefix; a subagent id joins that identity when present. Each hook updates its own section under one file lock. Inputs and responses are represented by hashes rather than saved screen text.

The retry hook records explicit error flags, response text starting with `error`, and failing desk command responses. A success with the same input clears that error count. A successful call to a different target also clears it. A different failed call starts a new count. Probe tools (`list_apps`, `list_windows`, `launch_app`, `end_session`, `status`, `list_tools`) never count or block.

The batch hint appears once per streak. A probe, a filtered `desk-read`, cleanup, or a call chaining desk commands with `&&` resets the streak. The runner chains the remaining actions, reads once, and returns the saved read for independent verification.

## Cleanup hook

`cleanup_hook.sh` reads `session_id` (and `agent_type` for SubagentStop) from the payload and ends only that session's leases. Stop is skipped while a subagent is still running; SessionEnd and the runner's own stop clean up later. It prints nothing to stdout and exits 0 for malformed input, a missing script or any internal error. See [desk-reap](../desk/README.md#cleanup-with-desk-reap).

## Stop gate

`touch_hook.py` and `stop_gate.py` share `_surfaces.py`, which the `keep` command and the `doctor` open-surfaces check also run, so one module decides what counts as held. Its state lives under `LEAN_COMPUTER_USE_SURFACES`, or `~/.local/state/lean-computer-use/surfaces` by default, in a directory of mode 0700 with one 0600 file per session or subagent. See [the stop gate](../docs/cleanup.md#the-stop-gate).

## Failure and verification

Malformed JSON, a missing session id, an unsafe state path, or an internal exception allows the tool call. A missing neighboring Python file also allows it. Exit 2 from the retry guard is the sole exit-code block; the stop gate requests its one block through Stop decision JSON on stdout; its stderr tells the runner to stop, report the error, and try a different approach. The hint uses PostToolUse `additionalContext` JSON on stdout and always exits 0.

Run `python3 -m pytest -q hooks/tests` with the package acceptance suite. The same contracts can run without pytest using `python3 -m unittest discover -s hooks/tests`. They send synthetic stdin payloads, use temporary state under the test folder, verify secure file modes, and invoke both shims. The Python sources and settings snippet in this folder are the source of truth.
