import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { ROOT } from './support.mjs';
import { publicFiles, readText } from '../scripts/privacy.mjs';

test('public metadata and first-screen lead agree', () => {
  const facts = JSON.parse(readFileSync(ROOT + '/.repo-build/facts.json', 'utf8'));
  const pkg = JSON.parse(readFileSync(ROOT + '/package.json', 'utf8'));
  assert.equal(pkg.description, facts.description);
  assert.ok(readFileSync(ROOT + '/README.md', 'utf8').split('\n').slice(0, 10).includes(`**${facts.lead}**`));
  assert.ok(readFileSync(ROOT + '/llms.txt', 'utf8').includes(`> ${facts.lead}`));
  assert.ok(facts.topics.every(topic => pkg.keywords.includes(topic)));
});
test('relative prose links resolve inside the repository', () => {
  const failures = [];
  for (const file of publicFiles(ROOT).filter(file => file.endsWith('.md'))) {
    for (const match of readText(ROOT, file).matchAll(/\[[^\]]+\]\(([^\s)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z]+:|^</i.test(target)) continue;
      if (!existsSync(resolve(dirname(ROOT + '/' + file), target))) failures.push(`${file}: ${target}`);
    }
  }
  assert.deepEqual(failures, []);
});
