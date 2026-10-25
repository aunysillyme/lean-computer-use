import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { ROOT, temp, write } from './support.mjs';
import { git, scanTerms, termHashes } from '../scripts/privacy.mjs';

test('runtime dependency, skill and help budgets hold', () => {
  const pkg = JSON.parse(readFileSync(ROOT + '/package.json', 'utf8'));
  assert.equal(Object.keys(pkg.dependencies || {}).length, 0);
  const folder = join(ROOT, 'skills/lean-computer-use');
  const skill = readFileSync(join(folder, 'SKILL.md'));
  assert.ok(skill.length <= 6144);
  assert.ok(skill.toString().split('\n').length <= 120);
  const methods = readdirSync(join(folder, 'methods')).map(name => statSync(join(folder, 'methods', name)).size);
  assert.ok(methods.every(size => size <= 8192));
  assert.ok(skill.length + methods.reduce((a, b) => a + b, 0) <= 204800);
  const start = performance.now();
  const help = spawnSync(process.execPath, ['bin/lean-computer-use.mjs', '--help'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.ok(performance.now() - start <= 300, 'Cold help must complete within 300 ms.');
});
test('offline privacy check scans a two-thousand-file repository within budget', t => {
  const root = temp(t);
  git(root, ['init', '-q']);
  write(root, '.gitignore', '*.local.txt\n');
  write(root, 'test/terms.private.sha256', termHashes('synthetic private phrase').join('\n') + '\n');
  for (let i = 0; i < 2000; i++) write(root, `files/item-${i}.txt`, 'Public example content.\n');
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=Example', '-c', `user.email=${['example', 'example.com'].join('@')}`, 'commit', '-qm', 'Example files']);
  const start = performance.now();
  assert.deepEqual(scanTerms(root), []);
  assert.ok(performance.now() - start < 2000);
});
