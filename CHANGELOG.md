# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-10-28

### Added

- `cleanup` command: dry run by default, `--apply` ends only leased processes, children first, with SIGTERM, a 3 second wait, then SIGKILL for the same process. It prints one summary line.
- `spawn` command and `desk/desk-reap`: start a helper detached and record a lease; `desk` leases the driver daemon it starts.
- Cleanup hooks for SubagentStop (`desk-runner`), Stop and SessionEnd, registered by `install --with-hooks` and removed by `uninstall`; each exits 0 on every path.
- `doctor` check that fails when leased processes are still running.
- Runner agent and cleanup method end with the exact cleanup command.

### Fixed

- On Linux, where `ps` can report a start time up to 2 seconds early, the driver lease accepts that margin; macOS keeps its 1 second window.
- The weekly proof refresh leaves its branch and a compare link when the repository does not let Actions open pull requests.

### Changed

- Releases publish from GitHub Actions through npm Trusted Publishing, with provenance.

## [0.1.0] - 2026-10-25

### Added

- Native Mac app skill, focused methods, runner agent and desk brief.
- Background desk tools, retry guard and batching hint.
- Installer, owned-file uninstall, environment doctor and transcript measurement.
- Package proof, privacy checks and repository workflows.

[Unreleased]: https://github.com/aunysillyme/lean-computer-use/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/aunysillyme/lean-computer-use/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/aunysillyme/lean-computer-use/releases/tag/v0.1.0
