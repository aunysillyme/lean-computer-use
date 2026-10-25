# Resolve failures within the brief

| Observation | Action |
|---|---|
| The same native error appears twice with the same input | Stop, report the error and evidence, and propose a different route. The retry hook blocks a third identical attempt. |
| Cold app has no usable window | Let the wrapper's bounded readiness check finish; report the error if it exits. |
| Filter prints no matching lines | Open the saved full read before deciding the field is missing. |
| Action says `effect: unverifiable` | Decide from the filtered read-back and saved evidence. |
| App is still running after cleanup | Report exit 3 and the app-running check as pending; preserve unsaved work. |
| Hook stdin is malformed or its Python file is missing | Hooks fail open. Follow the runner's stopping and approval rules yourself. |
| Driver or permission check fails | Run `npx lean-computer-use doctor`; follow its fix and the driver precautions. |
| Time or tool-call bound is reached | Stop actions, perform cleanup, and report completed and uncovered work. |

Use `osascript` for the app-running check rather than guessing a process name from the app's display name.
Check the exact desk exit-code table in the installed desk README.
The optional hooks encourage this process; they do not grant permission or replace the brief.
