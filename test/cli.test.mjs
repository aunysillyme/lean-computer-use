import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/cli.mjs';
import { join } from 'node:path';
import { temp } from './support.mjs';

test('CLI help and version run without installation', async () => {
  const lines = [];
  assert.equal(await main(['--help'], { write: value => lines.push(value) }), 0);
  assert.match(lines[0], /--with-hooks/);
  assert.equal(await main(['--version'], { write: value => lines.push(value) }), 0);
  assert.equal(lines[1], '0.1.0');
});

test('CLI rejects unknown commands and malformed command options', async () => {
  await assert.rejects(main(['unknown']), error => error.exitCode === 2);
  await assert.rejects(main(['doctor', '--unknown']), error => error.exitCode === 2);
  await assert.rejects(main(['measure', '--projects-dir']), error => error.exitCode === 2);
  await assert.rejects(main(['install', '--dir']), error => error.exitCode === 2);
  await assert.rejects(main(['--unknown']), error => error.exitCode === 2);
});

test('CLI uninstall alias reaches manifest validation', async t => {
  const root = temp(t);
  await assert.rejects(main(['--uninstall', '--dir', join(root, 'host'), '--share', join(root, 'share')], { write() {} }), /Install manifest not found/);
});
