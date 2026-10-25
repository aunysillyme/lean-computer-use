import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { temp, write } from './support.mjs';
import { git, scanTerms, termHashes } from '../scripts/privacy.mjs';
const authorEmail = ['example', 'example.com'].join('@');

function fixture(t) {
  const root = temp(t);
  git(root, ['init', '-q']);
  write(root, '.gitignore', '*.local.txt\n');
  const term = ['hidden', 'seed', 'phrase'].join(' ');
  write(root, 'test/terms.private.sha256', termHashes(term).join('\n') + '\n');
  write(root, '.repo-build/private.local.txt', term + '\n');
  write(root, 'clean.txt', 'A public example.\n');
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=Example', '-c', `user.email=${authorEmail}`, 'commit', '-qm', 'Create example']);
  return { root, term };
}
test('internal term in body filename and commit message is caught', t => {
  const { root, term } = fixture(t);
  assert.deepEqual(scanTerms(root), []);
  write(root, 'body.txt', term);
  assert.ok(scanTerms(root).some(hit => hit.startsWith('body.txt:')));
  rmSync(root + '/body.txt');
  write(root, term + '.txt', 'Example');
  // The local substring scanner also catches terms next to a filename suffix.
  assert.ok(scanTerms(root).some(hit => hit.startsWith(term)));
  rmSync(root + '/' + term + '.txt');
  write(root, 'clean.txt', 'Another public example');
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=Example', '-c', `user.email=${authorEmail}`, 'commit', '-qm', term]);
  assert.ok(scanTerms(root).some(hit => hit.startsWith('commit messages:')));
});
test('hash-only CI catches body filename and commit vocabulary', t => {
  const { root, term } = fixture(t);
  rmSync(root + '/.repo-build/private.local.txt');
  write(root, 'body.txt', term);
  assert.ok(scanTerms(root).some(hit => hit.startsWith('body.txt:')));
  rmSync(root + '/body.txt');
  write(root, term, 'Example');
  assert.ok(scanTerms(root).some(hit => hit.startsWith(term)));
  rmSync(root + '/' + term);
  write(root, 'clean.txt', 'Changed');
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=Example', '-c', `user.email=${authorEmail}`, 'commit', '-qm', term]);
  assert.ok(scanTerms(root).some(hit => hit.startsWith('commit messages:')));
});
test('local regex and allow lines apply without publishing plaintext', t => {
  const { root } = fixture(t);
  write(root, '.repo-build/private.local.txt', 're:sample[0-9]+\nallow:sample12\n');
  write(root, 'body.txt', 'sample12');
  assert.deepEqual(scanTerms(root), []);
  write(root, 'body.txt', 'sample34');
  assert.ok(scanTerms(root).some(hit => hit.includes('local vocabulary')));
});
test('generic privacy classes reject synthetic paths addresses and credentials', t => {
  const { root } = fixture(t);
  const examples = [
    '/' + ['Us', 'ers'].join('') + '/example-person/document',
    ['person', 'private.example-company.com'].join('@'),
    ['gh', 'p_'].join('') + 'a'.repeat(36),
    ['192', '0', '2', '1'].join('.'),
  ];
  for (const value of examples) {
    write(root, 'body.txt', value);
    assert.ok(scanTerms(root).some(hit => hit.startsWith('body.txt:')));
  }
});
