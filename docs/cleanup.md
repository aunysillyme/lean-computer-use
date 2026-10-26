# Cleanup: nothing keeps running

After an app run, the processes the package started are ended and nothing stays running in the background. The package does this with leases: a lease is a small file recording a process id, its start time, its exact command line and the Claude Code session id. `desk` writes one when it starts the driver daemon, and `desk-reap spawn` writes one for any helper a run starts. Cleanup acts on leases and on nothing else.

## Run it

```sh
npx lean-computer-use cleanup            # dry run: lists what would end
npx lean-computer-use cleanup --apply    # ends it and prints one summary line
```

The runner calls the same tool from the installed desk folder:

```sh
"$DESK/desk-reap" cleanup --apply
```

The summary line reads `cleanup: ended=cua-driver:1 left=0`: the processes ended by name and the leased processes still alive.

| Option | Effect |
| --- | --- |
| `--apply` | End the processes. Without it nothing is touched. |
| `--all` | Every lease. Without `--session`, a run inside Claude Code covers its own session; a plain terminal covers all. |
| `--session ID` / `--run NAME` | Narrow the scope. |
| `--json` | Print the result as JSON. |

| Exit | Meaning |
| --- | --- |
| 0 | Dry run, or every leased process ended. |
| 1 | A leased process is still alive, a lease was refused, or the process list could not be read. |
| 2 | Usage error. |

## Start a helper with a lease

```sh
npx lean-computer-use spawn -- <command> [args]
```

`spawn` starts the command detached, records the lease and returns. A browser or a desktop app executable is refused before it starts, and a process whose lease cannot be written is stopped again. `--session ID` and `--run NAME` label the lease.

## What it ends

A process is ended when all of these hold:

- A lease names it, in a lease directory only your user can write, with file mode 0600.
- The live process has the same id, start time, command line and owner as its lease. A recycled process id fails this check and its stale lease is cleared. The check repeats right before each signal.
- It passes its signature, judged on the running command line: `cua-driver serve` for the driver, or a helper that is not a browser.
- It is not an ancestor of the cleanup run itself.
- For the driver: `cua-driver sessions` reports no live session.

Its children go first. Each process gets SIGTERM, then a 3 second wait, then SIGKILL only if the same process (same id, start time and command line) is still alive.

## What is left alone

- A driver you started yourself: it has no lease. `desk` starts the daemon on demand, so a driver ended here comes back on the next call.
- A driver that still reports live sessions: the line shows `busy_driver=1` and the exit code is 1.
- Apps and browsers found below a leased helper, unless they belong to the helper's own bundle: the line shows `kept_other_apps=N`.
- Processes with no lease, and processes of other users.

## Trust

Lease files are mode 0600 in a directory only your user can write, and a lease with looser permissions is ignored. A lease names a process; it never replaces the live checks above. Anyone able to write inside that directory can already signal your processes directly, so the lease directory is the boundary to protect. `LEAN_COMPUTER_USE_LEASES` moves it; the default is `~/.local/state/lean-computer-use/leases`.

## Hooks

`npx lean-computer-use install --with-hooks` registers three additive entries, all removed by `uninstall`:

| Event | Scope |
| --- | --- |
| SubagentStop, matcher `desk-runner` | The session's leases when the runner stops. |
| Stop | The session's leases at the end of a turn, unless a subagent is still running. |
| SessionEnd | The session's leases when the session ends. |

Each hook reads `session_id` (and `agent_type` for SubagentStop) from the hook payload, ends that session's leases, and exits 0 on every path, so a session is never blocked. A malformed payload does nothing.

## Check for leftovers

`npx lean-computer-use doctor` lists leased processes still running, with their age and process count, and fails when any exist. Run `cleanup --apply` to end them.
