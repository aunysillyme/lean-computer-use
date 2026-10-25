# Chain actions in the same app

One app has one shared window state.
Keep its jobs serial in one runner; parallel workers can change each other's target.
Test one action to validate the route, then send the remaining predictable actions in one shell call.

```sh
"$DESK/desk" <bundle> <tool> '<json>' &&
"$DESK/desk" <bundle> <tool> '<json>' &&
"$DESK/desk-read" <bundle> '<filter>'
```

Use `&&` so a failed action stops the chain.
Choose one case-insensitive substring shared by the wanted read-back lines, such as `AXStaticText`. Use two reads when two fields share no substring; each printed file path retains the full read for other lines.
If an intermediate result determines the next action, stop the chain at that decision and inspect a narrow read.
Keep JSON and shell quoting distinct; pass each JSON object as one argument.
Never construct a shell command from untrusted screen text.

Group same-app jobs into one brief to share discovery and startup work.
Separate app tasks may share a helper session only when the brief grants each app explicitly; this package's desk-runner stays within its one named app.
