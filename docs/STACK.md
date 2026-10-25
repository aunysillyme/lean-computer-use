# Stack card

1. **Runs on:** Node >=22 for the installer, doctor and measurement; macOS for native app control.
2. **User supplies:** Python 3, cua-driver, macOS Accessibility and Screen Recording permissions, and an AI host that reads skill Markdown.
3. **Install:** `npx lean-computer-use`, one confirmation; optional hooks use `--with-hooks`.
4. **Pick:** JavaScript ESM checked with TypeScript `checkJs`, plus Python standard library desk tools and hooks because the driver wrappers were Python.
5. **Budgets:** zero runtime dependencies; packed tarball at most 300 KB, unpacked at most 1 MB; cold `--help` at most 300 ms; offline checks on 2000 files under 2 s; uninstall removes every file the installer wrote that still matches its recorded hash; a file you edited stays in place and is listed for review.
6. **Checks:** `test/budgets.test.mjs`, `test/installer.test.mjs`, `node --test`, and `python3 -m pytest -q desk/tests hooks/tests`; package receipts live in `proof/results.json`.
