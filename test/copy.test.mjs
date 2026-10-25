import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { ROOT } from './support.mjs';
import { publicFiles, readText } from '../scripts/privacy.mjs';
import { payloadFiles } from '../src/paths.mjs';

test('public metadata and first-screen lead agree', () => {
  const facts = JSON.parse(readFileSync(ROOT + '/.repo-build/facts.json', 'utf8'));
  const pkg = JSON.parse(readFileSync(ROOT + '/package.json', 'utf8'));
  assert.equal(pkg.description, facts.description);
  assert.ok(readFileSync(ROOT + '/README.md', 'utf8').split('\n').slice(0, 10).includes(`**${facts.lead}**`));
  assert.ok(readFileSync(ROOT + '/llms.txt', 'utf8').includes(`> ${facts.lead}`));
  assert.ok(facts.topics.every(topic => pkg.keywords.includes(topic)));
});
test('relative prose links resolve in the repository or installed payload', () => {
  const failures = [];
  const installed = payloadFiles({ dir: ROOT, share: ROOT });
  for (const file of publicFiles(ROOT).filter(file => file.endsWith('.md'))) {
    for (const match of readText(ROOT, file).matchAll(/\[[^\]]+\]\(([^\s)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z]+:|^</i.test(target)) continue;
      const path = resolve(dirname(ROOT + '/' + file), target);
      if (!existsSync(path) && !installed.some(entry => entry.root === 'dir' && resolve(ROOT, entry.path) === path)) failures.push(`${file}: ${target}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('skill brief link resolves to the packaged template after installation', () => {
  const skill = readFileSync(ROOT + '/skills/lean-computer-use/SKILL.md', 'utf8');
  assert.match(skill, /\[brief template\]\(desk-brief\.md\)/);
  const installed = payloadFiles({ dir: ROOT, share: ROOT });
  const brief = installed.find(entry => entry.root === 'dir' && entry.path === 'skills/lean-computer-use/desk-brief.md');
  assert.ok(brief);
  assert.deepEqual(brief.content, readFileSync(ROOT + '/briefs/desk-brief.md'));
});
