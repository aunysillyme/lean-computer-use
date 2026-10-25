# Repository settings

As of 2026-10-25: remote GitHub and npm settings are UNVERIFIED.
This is the expected configuration for the maintainer's dated read-back, not a record of settings applied.

| Setting | Expected value | Read-back |
|---|---|---|
| Visibility | Private until owner approval of the public flip | UNVERIFIED |
| About description | Token-lean native Mac app control with desk tools, a runner, guards and transcript measurement. | UNVERIFIED |
| Website | https://www.npmjs.com/package/lean-computer-use | UNVERIFIED |
| Topics | agent-skills, claude-code, computer-use, native-apps, macos, cua-driver, token-efficiency, subagents, accessibility, cli, npm, developer-tools | UNVERIFIED |
| Default branch | main | UNVERIFIED |
| Required status | Repository checks | UNVERIFIED |
| Branch protection | Review required; passing required check; no force pushes | UNVERIFIED |
| Private vulnerability reporting | Enabled for public repository | UNVERIFIED |
| Secret scanning and push protection | Enabled where supported | UNVERIFIED |
| Actions permissions | Read contents by default; publish identity only in publish job | UNVERIFIED |
| npm Trusted Publisher | aunysillyme / lean-computer-use / release.yml | UNVERIFIED |
| npm package ownership | lean-computer-use | UNVERIFIED |

The description and topics must match `package.json` and `.repo-build/facts.json`.
Record a date and actual observation after applying each setting.
The `actions/setup-python@v5` pin needs a verified full SHA before release automation is enabled.
The package lock must be generated and reviewed before `npm ci` can run in CI.
The canonical sibling set is maintained outside this repository; its row update is an owner step.
