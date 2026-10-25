import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstHeading } from '../scripts/build.mjs';

test('first heading skips fenced comments and keeps a trailing hash in the title', () => {
  assert.equal(firstHeading('```sh\n# setup\n```\n# Guide\n'), 'Guide');
  assert.equal(firstHeading('# C#\n'), 'C#');
  assert.equal(firstHeading('# Title ##\n'), 'Title');
  assert.equal(firstHeading('no heading here\n'), undefined);
});
