# Repository settings

Security and protection settings were read back on 2026-11-10. Other observations retain their read-back dates.
The npm settings stay UNVERIFIED until the first publish and follow the order given in [RELEASING.md](RELEASING.md).

| Setting | Expected value | Read-back |
|---|---|---|
| Visibility | Public after owner approval of the flip | Public (read 2026-10-25) |
| About description | Background Mac computer control for AI agents: desk tools, a fresh runner subagent, retry guards and a transcript token meter, installed with one command | Matches, 153 characters (read 2026-10-25) |
| Website | https://www.npmjs.com/package/lean-computer-use | Matches (read 2026-10-25); resolves after the first publish |
| Topics | agent-skills, claude-code, computer-use, native-apps, macos, cua-driver, cua, token-efficiency, subagents, accessibility, cli, npm, developer-tools, ai-agents, macos-automation | Matches, 15 topics (read 2026-10-25) |
| Default branch | main | main (read 2026-10-25) |
| Required status | Repository checks | Required on main (read 2026-10-25); first run after the public flip, result recorded in the release log |
| Branch protection | Solo owner: required status check Repository checks; no force pushes; no deletions; no required pull-request reviews; admins may bypass | Read back 2026-11-10: force pushes and deletions blocked, admins exempt; checks Repository checks, pull-request reviews none (read 2026-10-25) |
| Private vulnerability reporting | Enabled | Enabled (read 2026-11-10) |
| Secret scanning and push protection | Enabled | Both enabled (read 2026-11-10) |
| Actions permissions | Read contents by default; publish identity only in publish job; require full-SHA action pins; do not allow Actions to approve pull requests | Default workflow token read-only; full-SHA pinning required; Actions cannot approve pull requests (read 2026-11-10); identity token held only by the publish job (`test/release-workflow.test.mjs`) |
| Release tag ruleset | Active `Protect release tags` ruleset on `refs/tags/v*`, blocking updates and deletions | Active and blocking updates and deletions (read 2026-11-10) |
| Release environment | Environment `release`: deployments from `v*` tags only, required reviewer aunysillyme | Read back 2026-10-25: reviewer aunysillyme, tag policy `v*` |
| Dependabot alerts and security updates | Enabled | Both enabled (read 2026-11-10) |
| Code scanning | CodeQL default setup | Configured (read 2026-11-10) |
| npm Trusted Publisher | aunysillyme / lean-computer-use / release.yml / environment `release` | UNVERIFIED: npm requires the package to exist first, so the first publish is manual and `npm trust github` follows (npm docs, read 2026-10-25) |
| npm package ownership | lean-computer-use | Name free on 2026-10-25 (`npm view` returned 404); ownership UNVERIFIED |

The description and topics must match `package.json` and `.repo-build/facts.json`.
Record a date and actual observation after applying each setting.
The canonical sibling set is maintained outside this repository; its row update is an owner step.
