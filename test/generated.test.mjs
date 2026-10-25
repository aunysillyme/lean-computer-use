import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT } from './support.mjs';
import { build } from '../scripts/build.mjs';
import { termHashes } from '../scripts/privacy.mjs';

test('generated context and set blocks match their public inputs', async () => {
  await assert.doesNotReject(build(ROOT, ['--check']));
});
test('private-list hashing skips comments regex allows and deduplicates', () => {
  assert.deepEqual(termHashes('# comment\nre:sample.*\nallow:sample\nExample term\nEXAMPLE TERM\n'), termHashes('example term'));
  assert.match(readFileSync(ROOT + '/test/terms.private.sha256', 'utf8').trim(), /^[a-f0-9]{64}(?:\n[a-f0-9]{64})*$/);
});
