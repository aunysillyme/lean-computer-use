# Installer contract

## Commands

| Command | Behavior |
|---|---|
| `npx lean-computer-use` | Preview an install and ask for confirmation. |
| `npx lean-computer-use install --yes` | Apply the previewed install without a prompt. |
| `npx lean-computer-use install --with-hooks` | Also merge marked native hook registrations. |
| `npx lean-computer-use install --dir <path> --share <path>` | Use explicit host and share roots. |
| `npx lean-computer-use uninstall` | Remove unchanged files recorded in the manifest. |
| `npx lean-computer-use --uninstall` | Alias for `uninstall`. |
| `npx lean-computer-use install --dry-run` | Show the same action plan with no writes. |
| `npx lean-computer-use uninstall --dry` | Preview removal; `--dry` equals `--dry-run`. |

Default host root: `~/.claude`.
Default share root: `~/.local/share/lean-computer-use`.
`LEAN_COMPUTER_USE_HOME` overrides the default share root; `--share` takes precedence.
`--dir` and `--share` may name absolute target roots.
Recorded paths inside each root must remain relative, contained and free of symlinks.

## Install ownership

The installer writes the skill under `skills/lean-computer-use`, the runner under `agents/desk-runner.md`, and desk tools and hook files under the share root.
It copies packaged `briefs/desk-brief.md` to `<claude dir>/skills/lean-computer-use/desk-brief.md` as an owned skill file, with the same hash, backup and removal rules.
It replaces `__DESK_DIR__` in the runner with the installed desk directory.
Desk scripts are executable.
It records paths, file hashes and created directories in `<share>/install-manifest.json`.

The installer previews before mutation and asks `y/N` unless `--yes` is supplied.
A non-interactive install requires `--yes`.
A differing existing file is preserved unless replacement is approved with `--yes`; replacement keeps a `.bak`.
The manifest records enough ownership information to preserve or restore prior content on removal.
The installer never installs third-party tools, runs vendor logins, or changes global settings without confirmation.

## Hook merge

`--with-hooks` backs up `settings.json`, preserves all other keys and registrations, and adds marked entries idempotently.
MCP native tools and Bash have separate matchers.
The Bash handler checks that the first word of a command segment is `desk`, `desk-read` or `desk-clean` before it applies native behavior.
Uninstall removes only entries carrying this install's marker.
If the snippet was pasted manually, inspect the printed manual steps and remove only those pasted entries yourself.

## Safe removal

Uninstall reads the manifest and rechecks each target before unlinking it.
Removal budget: uninstall removes every file the installer wrote that still matches its recorded hash; a file you edited stays in place and is listed for review.
Traversal, absolute recorded paths and symlink targets are refused.
It removes a directory only when this install created it and it is empty.
The manifest is removed last.
Backups of replaced content are restored according to their recorded ownership.

`--dry-run` performs the same validation and reports the same planned actions without writing.
With no manifest, uninstall exits 2 and names the missing manifest path.
Restore the manifest from your backup or follow its reported manual cleanup steps after reviewing each file.
Do not delete a shared skill directory or an entire settings file as a substitute.

## Verification

`test/installer.test.mjs` exercises temporary roots, dry runs, replacement backup, settings merge, edited-file preservation and install/uninstall restoration.
`npx lean-computer-use doctor --json` compares installed files with the package and reports optional hook registration.
All tests use temporary paths and fake commands.
