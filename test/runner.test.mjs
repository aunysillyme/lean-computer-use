import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { payloadFiles } from '../src/paths.mjs';
import { temp } from './support.mjs';

test('installed runner DESK assignment resolves a folder with spaces and quotes', { skip: process.platform === 'win32' }, t => {
  const root = temp(t), roots = { dir: join(root, 'host'), share: join(root, "desk's files") };
  const agent = payloadFiles(roots).find(file => file.path === 'agents/desk-runner.md').content.toString();
  const assignment = agent.match(/Set `(DESK=[^`]+)`/)[1];
  const result = spawnSync('sh', ['-c', assignment + '; printf %s "$DESK"'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, join(roots.share, 'desk'));
});
