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

test('proof runs the test suite before it writes any row, because the suite validates the saved rows', () => {
  const source = readFileSync(ROOT + '/scripts/proof.mjs', 'utf8');
  const suite = source.indexOf("run(process.execPath, ['--test'])");
  const firstSave = source.indexOf('saveRows(makeRows(');
  assert.ok(suite > 0 && firstSave > suite, 'saveRows must come after the test run');
});
