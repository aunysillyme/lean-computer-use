#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const message = 'Refresh deterministic package proof';
const branch = 'automation/refresh-proof';
const files = ['proof/results.json', 'README.md', 'website/mock/index.html'];

export async function refresh({ api, baseBranch, baseSha, content }) {
  const ref = async name => api(`/git/ref/heads/${encodeURIComponent(name)}`);
  const latest = await ref(baseBranch);
  if (latest.object.sha !== baseSha) throw Error('Default branch moved after measurement; retry the workflow.');
  const original = await api(`/git/commits/${baseSha}`);
  const changed = [];
  for (const path of files) {
    const source = await api(`/contents/${path}?ref=${baseSha}`);
    if (Buffer.from(source.content, 'base64').toString('utf8') !== content[path]) changed.push(path);
  }
  if (!changed.length) return { changed: false };
  const refs = await api(`/git/matching-refs/heads/${branch}`);
  const previous = refs.find(item => item.ref === `refs/heads/${branch}`)?.object.sha;
  if (previous && previous !== baseSha) {
    const comparison = await api(`/compare/${baseSha}...${previous}?per_page=100`);
    if (comparison.ahead_by !== comparison.commits.length || comparison.commits.some(item => item.commit.message !== message)) {
      throw Error('Proof branch contains non-automation commits or too many commits; preserve it for review.');
    }
    for (const item of comparison.commits) {
      const parents = item.parents || [];
      const changes = parents.length > 1
        ? await api(`/compare/${parents[1].sha}...${item.sha}`)
        : await api(`/commits/${item.sha}`);
      if (!Array.isArray(changes.files) || changes.files.some(file => !files.includes(file.filename))) {
        throw Error('Proof branch contains changes outside generated files; preserve it for review.');
      }
    }
  }
  const tree = await api('/git/trees', 'POST', {
    base_tree: original.tree.sha,
    tree: changed.map(path => ({ path, mode: '100644', type: 'blob', content: content[path] })),
  });
  const parents = previous && previous !== baseSha ? [previous, baseSha] : [baseSha];
  const commit = await api('/git/commits', 'POST', { message, tree: tree.sha, parents });
  if ((await ref(baseBranch)).object.sha !== baseSha) throw Error('Default branch moved before update; retry the workflow.');
  if (previous) await api(`/git/refs/heads/${branch}`, 'PATCH', { sha: commit.sha, force: false });
  else await api('/git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: commit.sha });
  return { changed: true, sha: commit.sha };
}

async function main() {
  const base = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}`;
  const headers = { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28', 'content-type': 'application/json' };
  async function api(endpoint, method = 'GET', body) {
    const response = await fetch(`${base}${endpoint}`, { method, headers,
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Object.assign(Error(`GitHub ${method} ${endpoint}: ${response.status} ${await response.text()}`), { status: response.status });
    return response.status === 204 ? null : response.json();
  }
  const repository = await api('');
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const content = Object.fromEntries(await Promise.all(files.map(async path => [path, await readFile(path, 'utf8')])));
  const result = await refresh({ api, baseBranch: repository.default_branch, baseSha, content });
  if (!result.changed) return;
  const owner = process.env.GITHUB_REPOSITORY.split('/')[0];
  const prs = await api(`/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`);
  if (!prs.length) {
    try {
      await api('/pulls', 'POST', { title: message, head: branch, base: repository.default_branch,
        body: 'Refresh package receipts, README proof and the saved website mock. Test receipts keep their dates.\n\nThe maintainer reviews and runs the required checks before merging.' });
    } catch (error) {
      if (error.status !== 403 || !/not permitted to create or approve pull requests/.test(error.message)) throw error;
      console.log(`::warning title=Proof refresh ready::Open a pull request from ${branch}: ${repository.html_url}/compare/${repository.default_branch}...${branch}`);
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
