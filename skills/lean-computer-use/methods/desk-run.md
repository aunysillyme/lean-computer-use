# Run one named app

The brief is the packet: put the app, actions, evidence and stopping rules in it before starting.
The main session frames the task, verifies evidence and reports; the cheap helper or runner performs the screen actions.

1. Read the whole brief. Confirm the bundle id, permitted app, action approvals, read filter and done check.
2. Snapshot `osascript -e 'application "<Name>" is running'`. Record the answer so cleanup can preserve the user's session.
3. Use the narrowest background route: key presses or typing before element clicks. The wrapper supplies process and window ids.
4. Test one action whose result validates the route. If it succeeds, run all remaining predictable actions in one `&&` chain.
5. Use one case-insensitive substring in each `desk-read <bundle> '<filter>'`. Choose a shared substring for several fields; use two reads when two fields share none. Preserve each full saved read at the granted handoff path so the main session can inspect any other line.
6. Run cleanup and report the value, evidence, errors and final app-running check.

When a choice is necessary, enumerate the observed candidates and choose their index instead of inventing a selector or an element token.
Use only a token returned by the current app read.
This index-choice and packet approach draws on the Jev research client from typesafe-sdk; see [credits](../../../CREDITS.md).

A lone action is useful when its result decides the next action.
For predictable actions, use [same-app chaining](same-app-chaining.md).
The same error twice ends the attempt; read [failure modes](failure-modes.md).
