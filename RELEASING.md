# Releasing

Only the maintainer authorizes a public release.
The tag workflow is a release tool; creating a matching tag can publish to npm.

Our own tools and concepts are named with the aun- prefix; internal names never ship, and the INTERNAL_TERMS test enforces it.

## Prepare

1. Review the final diff and obtain one audit from a model family that did not author it.
2. Update [CHANGELOG.md](CHANGELOG.md), `package.json`, and both version fields in the package lock together.
3. Run `npm test`, `npm run test:py`, `npm run check`, `npm run build -- --check` and `npm run typecheck`.
4. Run `node scripts/check-terms.mjs --history` before a public flip and inspect the tarball from `npm pack --dry-run --json`.
5. Refresh package proof with `npm run proof`, review dates and commands, and rerun only checks affected by a change.
6. Preview install and uninstall from a temporary tarball installation and confirm unchanged owned files are removed.

## Owner setup

Configure npm Trusted Publishing for owner `aunysillyme`, repository `lean-computer-use`, workflow `release.yml`.
Confirm ownership of the npm name before the first publication.
Enable private vulnerability reporting, secret scanning and push protection when the repository becomes public.
Require the aggregate `Repository checks` status on the default branch.
Read back the settings into [REPO_SETTINGS.md](REPO_SETTINGS.md).
Add this package and the browser sibling to the canonical set source in the owner's `.github` repository.

The workflow uses the action commit pins copied from the proven template.
The `actions/setup-python@v5` tag is the remaining pinning step: replace it with a verified full commit SHA before enabling release automation.
The pinned workflow linter versions and digest were supplied by the template; their current upstream status is UNVERIFIED in this build.

## Publish and verify

After explicit owner approval, tag `vX.Y.Z` matching `package.json` and push the tag.
The verification job tests the tagged source, checks generated files, packs once and smoke-installs that exact tarball.
The publish job alone receives identity-token permission and publishes the downloaded tarball with provenance.
It uses Node 24 and exact npm 12.2.0 with no stored registry token.

Verify the registry after the workflow, rather than treating a green job as publication proof:

```sh
npm view lean-computer-use version --prefer-online
sh scripts/verify-registry.sh
```

Poll the registry after propagation, then inspect the published files and provenance and create the GitHub release notes.
Do not run the release workflow from a feature or build task.
