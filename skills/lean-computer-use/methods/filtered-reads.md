# Read fields in one packet

Pass one case-insensitive substring per `desk-read`.
The command sends that string as the driver's `query`, then prints only `tree_markdown` lines containing the same substring, case-insensitively.
A pipe (`|`) is a literal character. The filter uses substring matching, with no regex or alternation.
The default filter is `AXStaticText`.

Choose a substring every wanted line shares, such as an element role.
`AXStaticText` matches every static text line; `--max` bounds the number of matching lines printed (40 by default).

```sh
"$DESK/desk-read" <bundle> 'AXStaticText' --max <lines>
```

When two fields share no substring, make two reads using their observed labels:

```sh
"$DESK/desk-read" <bundle> '<first field label>' --max <lines>
"$DESK/desk-read" <bundle> '<second field label>' --max <lines>
```

Every read saves the full JSON response to the printed file path, including lines outside the printed filter or line limit.
The main session can open that file to inspect any other line and verify the result.
An empty match count means the printed view has no matches; it does not establish the app's value.
Inspect the saved read before deciding that a field is missing or a task succeeded.
Copy the evidence to the granted handoff location before cleanup.

Keep navigation reads narrow.
Use a full screenshot only when it adds evidence that the accessibility read cannot supply, and only when the brief grants it.
Concise printed output with retrievable full evidence follows the same principle credited to rtk in [CREDITS.md](../../../CREDITS.md).
