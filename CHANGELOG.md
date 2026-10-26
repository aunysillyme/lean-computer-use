# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `cleanup` command: dry run by default, `--apply` ends only leased processes, children first, with SIGTERM, a 3 second wait, then SIGKILL for the same process. It prints one summary line.
- `spawn` command and `desk/desk-reap`: start a helper detached and record a lease; `desk` leases the driver daemon it starts.
- Cleanup hooks for SubagentStop (`desk-runner`), Stop and SessionEnd, registered by `install --with-hooks` and removed by `uninstall`; each exits 0 on every path.
- `doctor` check that fails when leased processes are still running.
- Runner agent and cleanup method end with the exact cleanup command.

## [0.1.0] - 2026-10-25

### Added

- Native Mac app skill, focused methods, runner agent and desk brief.
- Background desk tools, retry guard and batching hint.
- Installer, owned-file uninstall, environment doctor and transcript measurement.
- Package proof, privacy checks and repository workflows.

[Unreleased]: https://github.com/aunysillyme/lean-computer-use/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aunysillyme/lean-computer-use/releases/tag/v0.1.0
