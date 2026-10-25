# Repository settings

Read back on 2026-10-25 for every setting that can be read while the repository is private.
The rest stay UNVERIFIED until the public flip and are applied in the order given in [RELEASING.md](RELEASING.md).

| Setting | Expected value | Read-back |
|---|---|---|
| Visibility | Private until owner approval of the public flip | Private (read 2026-10-25) |
| About description | Token-lean computer use for AI agents on Mac: desk tools, a runner subagent, retry guards and a transcript token meter, installed with one command | Matches, 146 characters (read 2026-10-25) |
| Website | https://www.npmjs.com/package/lean-computer-use | Matches (read 2026-10-25); resolves after the first publish |
| Topics | agent-skills, claude-code, computer-use, native-apps, macos, cua-driver, cua, token-efficiency, subagents, accessibility, cli, npm, developer-tools, ai-agents, macos-automation | Matches, 15 topics (read 2026-10-25) |
| Default branch | main | main (read 2026-10-25) |
| Required status | Repository checks | UNVERIFIED: on 2026-10-25 the workflow jobs did not start because the account's Actions billing blocks private-repository runs |
| Branch protection | Review required; passing required check; no force pushes | UNVERIFIED: GitHub offers this only with Pro or on a public repository (API reply 2026-10-25) |
| Private vulnerability reporting | Enabled for public repository | UNVERIFIED until the public flip |
| Secret scanning and push protection | Enabled where supported | UNVERIFIED until the public flip |
| Actions permissions | Read contents by default; publish identity only in publish job | Default workflow permissions: read (read 2026-10-25); identity token held only by the publish job (`test/release-workflow.test.mjs`) |
| Release environment | Environment `release`: deployments from `v*` tags only, required reviewer aunysillyme | Created 2026-10-25 with the `v*` tag policy; the required reviewer is UNVERIFIED because GitHub rejected it on this plan while the repository is private (HTTP 422); add it after the public flip |
| npm Trusted Publisher | aunysillyme / lean-computer-use / release.yml / environment `release` | UNVERIFIED: npm requires the package to exist first, so the first publish is manual and `npm trust github` follows (npm docs, read 2026-10-25) |
| npm package ownership | lean-computer-use | Name free on 2026-10-25 (`npm view` returned 404); ownership UNVERIFIED |

The description and topics must match `package.json` and `.repo-build/facts.json`.
Record a date and actual observation after applying each setting.
The canonical sibling set is maintained outside this repository; its row update is an owner step.
