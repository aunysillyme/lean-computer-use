# Repository settings

Read back on 2026-10-25, after the public flip, for every setting the repository exposes.
The npm settings stay UNVERIFIED until the first publish and follow the order given in [RELEASING.md](RELEASING.md).

| Setting | Expected value | Read-back |
|---|---|---|
| Visibility | Public after owner approval of the flip | Public (read 2026-10-25) |
| About description | Background Mac computer control for AI agents: desk tools, a fresh runner subagent, retry guards and a transcript token meter, installed with one command | Matches, 153 characters (read 2026-10-25) |
| Website | https://www.npmjs.com/package/lean-computer-use | Matches (read 2026-10-25); resolves after the first publish |
| Topics | agent-skills, claude-code, computer-use, native-apps, macos, cua-driver, cua, token-efficiency, subagents, accessibility, cli, npm, developer-tools, ai-agents, macos-automation | Matches, 15 topics (read 2026-10-25) |
| Default branch | main | main (read 2026-10-25) |
| Required status | Repository checks | Required on main (read 2026-10-25); first run after the public flip, result recorded in the release log |
| Branch protection | Solo owner: required status check Repository checks; no force pushes; no deletions; no required pull-request reviews; admins may bypass | Applied and read back 2026-10-25: checks Repository checks, enforce_admins false, force pushes off, deletions off, pull-request reviews none |
| Private vulnerability reporting | Enabled | Enabled (read 2026-10-25) |
| Secret scanning and push protection | Enabled | Both enabled (read 2026-10-25) |
| Actions permissions | Read contents by default; publish identity only in publish job | Default workflow permissions: read (read 2026-10-25); identity token held only by the publish job (`test/release-workflow.test.mjs`) |
| Release environment | Environment `release`: deployments from `v*` tags only, required reviewer aunysillyme | Read back 2026-10-25: reviewer aunysillyme, tag policy `v*` |
| Dependabot alerts and security updates | Enabled | Both enabled (read 2026-10-25) |
| Code scanning | CodeQL default setup | Configured (read 2026-10-25); first scan queued |
| npm Trusted Publisher | aunysillyme / lean-computer-use / release.yml / environment `release` | UNVERIFIED: npm requires the package to exist first, so the first publish is manual and `npm trust github` follows (npm docs, read 2026-10-25) |
| npm package ownership | lean-computer-use | Name free on 2026-10-25 (`npm view` returned 404); ownership UNVERIFIED |

The description and topics must match `package.json` and `.repo-build/facts.json`.
Record a date and actual observation after applying each setting.
The canonical sibling set is maintained outside this repository; its row update is an owner step.
