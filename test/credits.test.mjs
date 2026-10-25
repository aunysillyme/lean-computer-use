import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT } from './support.mjs';

test('upstream techniques are credited and linked from the front page', () => {
  const text = readFileSync(ROOT + '/CREDITS.md', 'utf8');
  for (const name of ['trycua/cua', 'Jev', 'Crawl4AI', 'rtk', 'Claude Code', 'lean-browser-use']) assert.ok(text.includes(name), name);
  assert.ok(readFileSync(ROOT + '/README.md', 'utf8').includes('CREDITS.md'));
  assert.ok(text.includes('Used for') && text.includes('Licence'));
});
