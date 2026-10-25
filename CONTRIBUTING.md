# Contributing

Help with a host adapter, a desk rule, a documentation fix, or a reproducible failure.
Start a focused issue using the [issue forms](https://github.com/aunysillyme/lean-computer-use/issues/new/choose).
For security reports, follow [SECURITY.md](SECURITY.md).

Read [AGENTS.md](AGENTS.md), [the installer contract](docs/INSTALLER.md), and the method relevant to your change.
Use synthetic transcripts and fake executables in tests.
Keep app content, private paths, credentials and personal contact details out of the tree and commit messages.

Run the checks for the behavior you changed, then the repository suite before review:

```sh
npm test
npm run test:py
npm run check
npm run build -- --check
npm run typecheck
```

Changes to an exit code need a documented case and a regression test.
Changes to install or uninstall need a temporary-directory round trip and an edited-file preservation case.
Keep runtime dependencies at zero.
Credit a technique or reused material in [CREDITS.md](CREDITS.md) and [PROVENANCE.md](docs/PROVENANCE.md).

Read [CLA.md](CLA.md) and tick its agreement box in the pull request.
Keep the change focused, include commands and outcomes, and name what remains unverified.
Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
