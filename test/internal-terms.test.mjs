import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOT } from './support.mjs';
import { scanTerms, tokens, digest } from '../scripts/privacy.mjs';

test('INTERNAL_TERMS: public paths, contents and commit messages pass hashed vocabulary', () => {
  assert.deepEqual(scanTerms(ROOT), []);
});
test('vocabulary tokens keep symbols, qualifiers and hyphens', () => {
  assert.notEqual(digest(tokens('Owner ♥').join(' ')), digest(tokens('Owner').join(' ')));
  assert.notDeepEqual(tokens('private-tool'), tokens('private tool'));
  assert.deepEqual(tokens('...Mixed... Words'), ['mixed', 'words']);
});
