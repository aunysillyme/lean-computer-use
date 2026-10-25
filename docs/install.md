# Install

Use Node >=22 to run the installer.
Native app control needs macOS, Python 3 and the separately installed cua-driver.
Follow [the driver precautions](cua-driver-install.md) before granting system permissions.

```sh
npx lean-computer-use
npx lean-computer-use --uninstall
```

The first command previews its changes and asks for one confirmation.
The second is the removal alias; `npx lean-computer-use uninstall` is equivalent.
The installer copies the skill and runner to `~/.claude` and the desk tools and hooks to `~/.local/share/lean-computer-use`.
The brief template is installed with the skill at `~/.claude/skills/lean-computer-use/desk-brief.md`.
It does not install the driver or perform a vendor login.

Preview a custom target without writing:

```sh
npx lean-computer-use install --dir <host-dir> --share <share-dir> --dry-run --yes
```

`--dry` is an alias for `--dry-run`.
Use `--yes` for an unattended install after reviewing the plan.
`LEAN_COMPUTER_USE_HOME` sets the share root when `--share` is absent.
A differing existing file needs `--yes` to replace it; the installer keeps a `.bak` copy.

## Optional hooks

```sh
npx lean-computer-use install --with-hooks
```

This merges marked registrations into `<host-dir>/settings.json` after a backup.
Other settings and hooks remain in place.
Repeated installation keeps one copy of each registration.
Without this flag the installer prints the installed `settings-snippet.json` path and merge instructions.
For a manual merge, replace the hook-directory placeholder as instructed, append the snippet's event entries to the matching `hooks` arrays, and retain existing entries.
Restart the host after changing hooks, then run `npx lean-computer-use doctor`.

## Activate

Start a fresh host session so it can discover `skills/lean-computer-use/SKILL.md` and `agents/desk-runner.md`.
Ask: "Use lean-computer-use. Give desk-runner one Calculator task, verify the saved filtered read, and report cleanup."
Review the [brief template](../briefs/desk-brief.md) before handing an agent an app task.

## Other hosts

Copy `skills/lean-computer-use/` to the host's documented skill directory and point its runner at the desk tools.
Copy `briefs/desk-brief.md` into that skill directory as `desk-brief.md`.
The automatic installation target is Claude Code.

## Remove

```sh
npx lean-computer-use uninstall --dry-run
npx lean-computer-use uninstall
```

Removal uses the install manifest and preserves user-edited files.
Read [the installer contract](INSTALLER.md) for manifest recovery and manual hook cleanup.
