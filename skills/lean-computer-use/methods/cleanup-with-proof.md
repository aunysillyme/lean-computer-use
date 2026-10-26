# Clean up with proof

Cleanup runs on success, failure and a bound reached.
Preserve the final saved read at the granted evidence handoff path first.
End only driver sessions this run started and release only locks it acquired.
Stop only background tasks and processes it started.

Run the cleanup command:

```sh
"$DESK/desk-clean" <bundle> --app-name <Name>
```

Add `--launched-by-run` only when the initial app-running snapshot was false and this run launched the app.
The command requests a gentle quit when that flag is present, removes owned desk state, and stops the daemon when no live sessions remain.
Leave an app that was already running open.
Never force-kill an app or the shared daemon.

Check `osascript -e 'application "<Name>" is running'` after cleanup and compare it with the initial snapshot.
Exit 3 means cleanup is pending, including an app that is still running; report the pending item and its evidence.

Start every other background process with `"$DESK/desk-reap" spawn -- <command>`, which records a lease.
Run the last cleanup command after the app check:

```sh
"$DESK/desk-reap" cleanup --apply
```

It ends only leased processes of the session, children first: SIGTERM, a 3 second wait, then SIGKILL for the same process only. The `cleanup:` line it prints joins the report; exit 1 means a leased process is still alive.
Registered hooks repeat it when the runner stops, a turn ends or the session ends, and `doctor` lists any leftover.

End the report with one cleanup line: initial and final app-running answers, the `cleanup:` line, and any pending resource.
