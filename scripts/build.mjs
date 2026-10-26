#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { termHashes, digest } from './privacy.mjs';
import { checkSet } from './set-check.mjs';

export function firstHeading(source) {
  let fence = false;
  for (const line of source.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    const match = fence ? null : line.match(/^#\s+(.+?)(?:\s+#+)?\s*$/);
    if (match) return match[1];
  }
}

export function llmsSource(root) {
  const facts = JSON.parse(readFileSync(resolve(root, '.repo-build/facts.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const base = `https://github.com/aunysillyme/lean-computer-use/blob/v${pkg.version}/`;
  const link = (path, text) => {
    const source = readFileSync(resolve(root, path), 'utf8');
    const label = firstHeading(source);
    if (!label) throw Error(`Missing first heading: ${path}`);
    return `- [${label}](${base}${path}): ${text}`;
  };
  return ['# lean-computer-use', '', `> ${facts.lead}`, '', 'Install: `npx lean-computer-use`', '', 'Computer use for AI agents, with Claude Code as the supported host.', '', '## Docs', '',
    link('README.md', 'Start here.'), link('docs/README.md', 'Choose a guide.'),
    link('docs/install.md', 'Install and remove the package.'), link('docs/INSTALLER.md', 'Read options and file ownership.'), link('docs/cleanup.md', 'End leased processes after a run.'),
    link('docs/cua-driver-install.md', 'Prepare native app control.'), link('docs/METHOD.md', 'Follow the process.'), link('docs/STACK.md', 'Read the stack card.'), '',
    '## Reference', '', link('skills/lean-computer-use/SKILL.md', 'Activate the method.'),
    ...['desk-run', 'same-app-chaining', 'background-only', 'filtered-reads', 'cleanup-with-proof', 'verify', 'failure-modes', 'cheap-helper-or-subagent'].map(name => link(`skills/lean-computer-use/methods/${name}.md`, 'Read this method.')),
    link('AGENTS.md', 'Use and contribute.'), link('desk/README.md', 'Run and verify desk tools.'), '',
    '<!-- set:start -->', '<!-- set:end -->', '', '## Optional', '',
    link('CREDITS.md', 'See upstream sources.'), link('docs/PROVENANCE.md', 'Trace borrowed techniques.'), link('CONTRIBUTING.md', 'Improve the package.'),
    '- [npm package](https://www.npmjs.com/package/lean-computer-use): Package and command.', '',
  ].join('\n');
}
export async function build(root, args = []) {
  if (args.some(arg => !['--check', '--terms'].includes(arg)) || args.includes('--check') && args.includes('--terms')) throw Error('Usage: build [--check | --terms]');
  const check = args.includes('--check');
  if (args.includes('--terms') && !existsSync(resolve(root, '.repo-build/private.local.txt'))) throw Error('Owner-supplied local vocabulary is required; no file was created.');
  const target = resolve(root, 'llms.txt');
  const generated = llmsSource(root);
  const rendererBytes = readFileSync(resolve(root, '.repo-build/render-set.mjs'));
  const lock = JSON.parse(readFileSync(resolve(root, '.repo-build/set.lock.json'), 'utf8'));
  if (lock.renderer_sha256 !== digest(rendererBytes)) throw Error('Set renderer hash differs from lock.');
  const { renderSet } = await import(`data:text/javascript;base64,${rendererBytes.toString('base64')}`);
  // Compare the authored parts separately; the pinned renderer owns its block.
  const stripSet = text => text.replace(/<!-- set:start -->[\s\S]*?<!-- set:end -->/, '<!-- set:start -->\n<!-- set:end -->');
  if (check) {
    if (!existsSync(target) || stripSet(readFileSync(target, 'utf8')) !== generated) throw Error('DRIFT llms.txt');
    await checkSet(root);
  } else {
    writeFileSync(target, generated);
    const result = renderSet({ root, check: false });
    if (result.code) throw Error(result.message || 'Set render failed.');
  }
  if (args.includes('--terms')) {
    const input = resolve(root, '.repo-build/private.local.txt');
    if (!existsSync(input)) throw Error('Owner-supplied local vocabulary is required; no file was created.');
    const hashes = termHashes(readFileSync(input, 'utf8'));
    if (!hashes.length) throw Error('The local vocabulary contains no hashable terms.');
    mkdirSync(resolve(root, 'test'), { recursive: true });
    writeFileSync(resolve(root, 'test/terms.private.sha256'), hashes.join('\n') + '\n');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await build(resolve(fileURLToPath(new URL('..', import.meta.url))), process.argv.slice(2)); console.log('Generated files match.'); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
