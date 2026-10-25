import { content } from './content.mjs';

const page = (key, route, sources, tools = []) => ({ route, ...content.documents[key], sources, tools });

export const pages = [
  page('landing', '/', ['README.md', 'proof/results.json']),
  page('overview', '/docs/overview/', ['README.md']),
  page('how', '/docs/how-it-works/', ['docs/METHOD.md', 'agents/desk-runner.md'], ['runner']),
  page('guides', '/docs/guides/', [
    'skills/lean-computer-use/SKILL.md',
    'briefs/desk-brief.md',
    'skills/lean-computer-use/methods/desk-run.md',
    'skills/lean-computer-use/methods/same-app-chaining.md',
    'skills/lean-computer-use/methods/background-only.md',
    'skills/lean-computer-use/methods/filtered-reads.md',
    'skills/lean-computer-use/methods/cleanup-with-proof.md',
    'skills/lean-computer-use/methods/verify.md',
    'skills/lean-computer-use/methods/failure-modes.md',
    'skills/lean-computer-use/methods/cheap-helper-or-subagent.md',
  ], ['skill', 'brief']),
  page('commands', '/docs/commands/', ['desk/README.md', 'README.md'], ['desk', 'read', 'clean', 'measure', 'doctor', 'installer']),
  page('proof', '/docs/proof/', ['proof/results.json', 'README.md']),
  page('changelog', '/docs/changelog/', ['CHANGELOG.md']),
  page('install', '/docs/install/', ['docs/install.md', 'docs/cua-driver-install.md', 'docs/INSTALLER.md']),
  page('guarantees', '/docs/guarantees/', [
    'hooks/README.md',
    'agents/desk-runner.md',
    'skills/lean-computer-use/methods/background-only.md',
    'skills/lean-computer-use/methods/cleanup-with-proof.md',
    'skills/lean-computer-use/methods/failure-modes.md',
    'skills/lean-computer-use/methods/verify.md',
  ], ['retry', 'batch']),
];

export default pages;
