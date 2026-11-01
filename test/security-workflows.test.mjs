import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './support.mjs';

function unpinnedActions(workflow) {
  return workflow.split('\n').filter(line => /^\s*(?:-\s*)?uses:/.test(line)
    && !/^\s*(?:-\s*)?uses: [\w./-]+@[a-f0-9]{40} # v\d+\.\d+\.\d+\s*$/.test(line));
}

test('workflow pin check rejects tags and accepts full commit pins', () => {
  const tag = '      - uses: actions/checkout@v4';
  assert.deepEqual(unpinnedActions(tag), [tag]);
  assert.deepEqual(unpinnedActions('        uses: actions/checkout@v4 # v4.0.0'), ['        uses: actions/checkout@v4 # v4.0.0']);
  assert.deepEqual(unpinnedActions('      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 # v4.0.0'), []);
});

test('every workflow action uses a full commit pin and version comment', () => {
  const directory = join(ROOT, '.github/workflows');
  const files = readdirSync(directory).filter(file => /\.ya?ml$/.test(file));
  assert.ok(files.length > 0);
  const failures = files.flatMap(file => unpinnedActions(readFileSync(join(directory, file), 'utf8'))
    .map(line => `${file}: ${line.trim()}`));
  assert.deepEqual(failures, []);
});

test('Dependabot checks root npm and Actions weekly with minor and patch groups', () => {
  const config = readFileSync(join(ROOT, '.github/dependabot.yml'), 'utf8');
  assert.match(config, /^version: 2\n/);
  const updates = config.split(/^  - package-ecosystem: /m).slice(1);
  assert.deepEqual(updates.map(update => update.split('\n')[0]).sort(), ['github-actions', 'npm']);
  for (const update of updates) {
    assert.match(update, /^    directory: \/\s*$/m);
    assert.match(update, /^    schedule:\n      interval: weekly\n/m);
    assert.match(update, /^    groups:\n      [\w-]+:\n        update-types: \[minor, patch\]\s*$/m);
  }
});
