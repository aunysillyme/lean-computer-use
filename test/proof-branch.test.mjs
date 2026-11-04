import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refresh } from '../scripts/refresh-proof-branch.mjs';

const content = { 'proof/results.json': 'new proof', 'README.md': 'new readme', 'website/mock/index.html': 'new mock' };
function fixture({ moved = false, manual = false } = {}) {
  const calls = [];
  let refReads = 0;
  async function api(path, method = 'GET', body) {
    calls.push({ path, method, body });
    if (path === '/git/ref/heads/main') return { object: { sha: moved && ++refReads > 1 ? 'new-main' : 'main-sha' } };
    if (path === '/git/commits/main-sha') return { tree: { sha: 'main-tree' } };
    if (path.startsWith('/contents/')) return { content: Buffer.from('old').toString('base64') };
    if (path.startsWith('/git/matching-refs/')) return [{ ref: 'refs/heads/automation/refresh-proof', object: { sha: 'old-head' } }];
    if (path.startsWith('/compare/')) return { ahead_by: 1, commits: [{ sha: 'auto-commit', parents: [], commit: { message: manual ? 'Manual change' : 'Refresh deterministic package proof' } }] };
    if (path === '/commits/auto-commit') return { files: [{ filename: 'proof/results.json' }] };
    if (path === '/git/trees') return { sha: 'new-tree' };
    if (path === '/git/commits') return { sha: 'new-commit' };
    if (path === '/git/refs/heads/automation/refresh-proof') return {};
    throw Error(`Unexpected ${method} ${path}`);
  }
  return { api, calls };
}

test('refresh keeps the old branch as a parent and publishes all updated files atomically', async () => {
  const { api, calls } = fixture();
  const result = await refresh({ api, baseBranch: 'main', baseSha: 'main-sha', content });
  assert.deepEqual(result, { changed: true, sha: 'new-commit' });
  assert.deepEqual(calls.find(call => call.path === '/git/commits').body.parents, ['old-head', 'main-sha']);
  assert.deepEqual(calls.find(call => call.path === '/git/trees').body.tree.map(item => item.path), Object.keys(content));
  assert.deepEqual(calls.at(-1).body, { sha: 'new-commit', force: false });
});

test('refresh refuses a manual branch or a moved default branch without changing the ref', async () => {
  for (const options of [{ manual: true }, { moved: true }]) {
    const { api, calls } = fixture(options);
    await assert.rejects(refresh({ api, baseBranch: 'main', baseSha: 'main-sha', content }));
    assert.ok(!calls.some(call => call.path === '/git/refs/heads/automation/refresh-proof'));
  }
});
