# Native app method

Every agent step re-reads the conversation available to that agent.
Put screen work in a small, fresh context and bundle predictable actions so it takes fewer steps.
The main session frames the task, checks saved evidence, and reports the result; a cheap helper or `desk-runner` performs the app work.
When no cheap helper is available, the runner handles every native app task.

1. **Frame:** name one app's bundle id, approved actions, done check, evidence path and limits in the [brief](../briefs/desk-brief.md).
2. **Snapshot:** check `osascript -e 'application "<Name>" is running'` before acting.
3. **Act:** choose background keys or typing, test one action, and chain the remaining predictable actions in one call.
4. **Read:** request all needed fields in one filtered `desk-read`; retain the full saved read for verification.
5. **Clean:** preserve evidence, run `desk-clean`, and compare the final app-running check with the initial snapshot.
6. **Verify:** the main session opens the saved evidence and checks the stated done signal before reporting.

Choose the focused method you need in [SKILL.md](../skills/lean-computer-use/SKILL.md).
The [lean-browser-use sibling](https://github.com/aunysillyme/lean-browser-use) applies the same method to web pages.
Measure your own transcript costs with `npx lean-computer-use measure --json`; this package's synthetic fixture demonstrates the calculation without making a savings claim about your setup.
