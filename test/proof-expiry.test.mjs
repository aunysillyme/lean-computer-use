import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProof } from '../scripts/proof-data.mjs';

const row = { id: 'sample', claim: 'Sample count', value: 1, unit: 'items', measured_at: '2026-01-01T00:00:00.000Z', expires_at: '2026-04-01T00:00:00.000Z', command: 'node example.mjs', package_version: '0.1.0' };
test('expired proof row fails the proof test', () => {
  assert.ok(validateProof([row], new Date('2026-04-02')).some(error => error.includes('expired')));
});
test('proof rejects missing fields and accepts a current 90 day row', () => {
  assert.deepEqual(validateProof([row], new Date('2026-01-02')), []);
  const broken = { ...row }; delete broken.command;
  assert.ok(validateProof([broken], new Date('2026-01-02')).some(error => error.includes('command')));
});
