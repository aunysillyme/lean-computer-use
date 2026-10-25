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

Each step is marked R (reversible) or I (irreversible). Run them in this order, after the maintainer's explicit approval of each.

1. R: Resolve the GitHub Actions billing block so the `Repository checks` workflow can start. Jobs on a private repository did not start on 2026-10-25.
2. I: Flip the repository public: `gh repo edit aunysillyme/lean-computer-use --visibility public --accept-visibility-change-consequences`.
3. R: Apply the public-only settings, then read each back into [REPO_SETTINGS.md](REPO_SETTINGS.md): private vulnerability reporting, secret scanning and push protection, Dependabot alerts and security updates, branch protection requiring the aggregate `Repository checks` status with no force pushes, and the required reviewer `aunysillyme` on the `release` environment (already created with its `v*` tag policy).
4. R: Push a no-op commit and confirm `Repository checks` is green on the public repository before any publish.
5. I: Claim the name by publishing the first version by hand: `npm login` with the security key, then `npm publish ./lean-computer-use-0.1.0.tgz --access public` from the verified tarball. This publish carries no provenance.
6. R: Configure npm Trusted Publishing (npm 11.15 or newer; the package must already exist): `npm trust github lean-computer-use --file release.yml --repo aunysillyme/lean-computer-use --env release --allow-publish`. The configuration expires unless it completes one successful trusted publish within 2 days, so plan the next release (0.1.1) inside that window.
7. R: Add this package and the browser sibling to the canonical set source in the owner's `.github` repository.

## Publish and verify

After explicit owner approval, tag `vX.Y.Z` matching `package.json` and push the tag. A tag is I: it starts the release workflow.
The verification job tests the tagged source, checks generated files, packs once and smoke-installs that exact tarball.
The publish job alone receives identity-token permission, runs in the `release` environment (waiting for the reviewer) and publishes the downloaded tarball with provenance.
It uses Node 24 and exact npm 12.2.0 with no stored registry token.
When the version is already on the registry (the hand-published 0.1.0), the publish step reports it and exits without publishing, so tagging `v0.1.0` after step 5 records the release without a second publish.

Every workflow action is pinned to a full commit SHA, including `actions/setup-python` at v7.1.0.
The pinned workflow linter versions and digest were supplied by the template; their current upstream status is UNVERIFIED in this build.

Verify the registry after the workflow, rather than treating a green job as publication proof:

```sh
npm view lean-computer-use version --prefer-online
sh scripts/verify-registry.sh
```

Poll the registry after propagation, then inspect the published files and provenance and create the GitHub release notes.
Do not run the release workflow from a feature or build task.
