#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from './privacy.mjs';

export async function checkSet(root) {
  const lock = JSON.parse(readFileSync(resolve(root, '.repo-build/set.lock.json'), 'utf8'));
  const renderer = readFileSync(resolve(root, '.repo-build/render-set.mjs'));
  const set = readFileSync(resolve(root, '.repo-build/set.json'));
  if (lock.renderer_sha256 !== digest(renderer) || lock.vendored_sha256 !== digest(set)) throw Error('Set inputs differ from their pinned hashes.');
  const { renderSet } = await import(`data:text/javascript;base64,${renderer.toString('base64')}`);
  const result = renderSet({ root, check: true });
  if (result.changed.length) throw Error(`Set blocks differ: ${result.changed.join(', ')}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await checkSet(resolve(fileURLToPath(new URL('..', import.meta.url)))); console.log('Set blocks match.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
