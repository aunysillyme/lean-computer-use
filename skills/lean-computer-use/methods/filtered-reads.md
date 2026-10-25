# Read fields in one packet

Use one `desk-read` filter covering all requested fields.
The filter is passed as a driver query; the command prints matching lines and the path to a saved full JSON read.
Use `--max <lines>` to bound the printed view when needed.
The saved file is the evidence the main session opens to verify the result.

```sh
"$DESK/desk-read" <bundle> '<field-a>|<field-b>' --max <lines>
```

Use a filter based on observed labels or the brief's named field.
An empty match count means the printed view has no matches; it does not establish the app's value.
Inspect the saved read before deciding that a field is missing or a task succeeded.
Copy the evidence to the granted handoff location before cleanup.

Keep navigation reads narrow.
Use a full screenshot only when it adds evidence that the accessibility read cannot supply, and only when the brief grants it.
Concise printed output with retrievable full evidence follows the same principle credited to rtk in [CREDITS.md](../../../CREDITS.md).
