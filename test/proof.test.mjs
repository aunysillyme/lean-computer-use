import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT } from './support.mjs';
import { validateProof } from '../scripts/proof-data.mjs';

test('package proof rows are current, reproducible and complete', () => {
  const rows = JSON.parse(readFileSync(ROOT + '/proof/results.json', 'utf8'));
  assert.deepEqual(validateProof(rows), []);
  for (const id of ['tarball-size', 'tarball-files', 'runtime-dependencies', 'node-tests', 'python-tests', 'measure-fixture', 'desk-exits']) assert.ok(rows.some(row => row.id === id), id);
  assert.ok(rows.every(row => row.subject === 'package' && row.package_version === '0.1.0'));
});
