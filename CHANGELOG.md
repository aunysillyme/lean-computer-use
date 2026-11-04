# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.4] - 2026-11-01

0.1.3 was tagged but not published to npm; 0.1.4 carries its changes.

### Fixed

- Fix website checker slowness from the HTML scanner with forward scans and joined output chunks.

## [0.1.3] - 2026-11-01

### Security

- Match `measure --tool-pattern` as literal text, so a crafted pattern cannot cause slow regular expression matching.
- Strip HTML in the website build with a character scanner, so no element start reaches generated text.
- Pin every workflow action to a full commit SHA, install CI Python packages from hash-pinned wheels only, and add Dependabot for npm and GitHub Actions.

### Fixed

- Fix the flaky spawn test: two matching reads could lease a shell before it exec'd into a browser. Observe the full startup window and require the final reads to agree before leasing.
- Leave an unleased idle driver running during `desk-clean` (#3).
- Keep leased drivers running on failed, timed-out, unavailable or empty session probes, with an UNKNOWN reason (#4).
- Keep the exact new driver PID leased even when readiness times out, including slow starts (#5).
- Accept custom `--dir` and `--share` roots in the doctor CLI (#7).
- Persist a pending install manifest before payload writes so uninstall can recover interrupted installs and preserve user files and backups (#8).
- Report invalid leases as UNKNOWN with their count and a review instruction (#9).
- Include proof receipts and scripts in the package; identify regeneration as a source-checkout command (#11).
- Release the cleanup features the README documents (#6).
- Lease the exact new PID from a pre-launch driver snapshot instead of selecting by rounded `ps lstart` (#12). Launch through LaunchServices so macOS attributes permissions to CuaDriver.

## [0.1.2] - 2026-10-29

### Added

- PostToolUse touch hook records native desktop actions and successful releases per session and subagent.
- Stop and runner SubagentStop gate requests the release once per held stretch, with the exact release tool and the `keep` command.
- `keep --reason` command holds desktop control for the user, including the session's subagents.
- `doctor` open-surfaces check fails for desktop control held more than ten minutes and never released.
- `--no-stop-gate` install flag leaves out the touch and stop gate registrations. The gate comes with `--with-hooks` by default.

### Changed

- Cleanup guide, runner and skill end the desktop control the run took before the app cleanup.
- The install manifest records the installed package version.

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

[Unreleased]: https://github.com/aunysillyme/lean-computer-use/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/aunysillyme/lean-computer-use/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/aunysillyme/lean-computer-use/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/aunysillyme/lean-computer-use/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/aunysillyme/lean-computer-use/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/aunysillyme/lean-computer-use/releases/tag/v0.1.0
