import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ROOT } from './support.mjs';

const read = path => readFileSync(ROOT + '/' + path, 'utf8');
const pkg = JSON.parse(read('package.json'));
const project = 'https://github.com/aunysillyme/lean-computer-use/';
const pinned = `${project}blob/v${pkg.version}/`;

function headings(text) {
  const seen = new Map(), found = [];
  let fence = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    const match = fence ? null : line.match(/^#{1,6}\s+(.+?)(?:\s+#+)?\s*$/);
    if (!match) continue;
    const label = match[1];
    const base = label.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s/g, '-');
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    found.push({ label, slug: base + (count ? `-${count}` : ''), level: line.match(/^#+/)[0].length });
  }
  return found;
}

test('llms links use absolute HTTPS and tag-pinned tracked files with heading labels', t => {
  const text = read('llms.txt');
  const links = [...text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
  assert.ok(links.length > 0);
  const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0'));
  const external = [];
  let local = 0;
  for (const [, label, href] of links) {
    const url = new URL(href);
    assert.equal(url.protocol, 'https:', href);
    assert.equal(url.username + url.password + url.search, '', href);
    if (!href.startsWith(project)) { external.push(href); continue; }
    assert.ok(href.startsWith(pinned), href);
    const path = decodeURIComponent(url.pathname.slice(new URL(pinned).pathname.length));
    assert.ok(tracked.has(path), `Untracked target: ${path}`);
    assert.ok(statSync(ROOT + '/' + path).isFile(), `Missing target: ${path}`);
    const targets = headings(read(path));
    assert.equal(label, targets.find(heading => heading.level === 1)?.label, path);
    if (url.hash) assert.ok(targets.some(heading => heading.slug === decodeURIComponent(url.hash.slice(1))), href);
    local++;
  }
  assert.ok(local > 0);
  const set = JSON.parse(read('.repo-build/set.json'));
  const expected = [...set.rows.filter(row => row.name !== pkg.name).map(row => row.url), pkg.homepage];
  assert.deepEqual(external.sort(), expected.sort());
  for (const href of external) assert.match(href, /^https:\/\/(?:www\.npmjs\.com\/package\/[a-z0-9-]+|github\.com\/aunysillyme\/[a-z0-9-]+)$/);
  t.diagnostic(`External links (shape only): ${external.join(', ')}`);
  assert.match(text, /^Install: `npx lean-computer-use`$/m);
  assert.ok(text.indexOf('## Docs') < text.indexOf('## Reference'));
  assert.ok(text.indexOf('## Reference') < text.indexOf('<!-- set:start -->'));
  assert.ok(text.indexOf('<!-- set:end -->') < text.indexOf('## Optional'));
});

test('llms anchor matching handles punctuation duplicates and fenced examples', () => {
  const targets = headings('# Title\n## Check your app?\n## Check your app?\n```md\n## Example\n```\n');
  assert.deepEqual(targets.map(heading => heading.slug), ['title', 'check-your-app', 'check-your-app-1']);
  assert.ok(targets.some(heading => heading.slug === 'check-your-app'));
  assert.ok(!targets.some(heading => heading.slug === 'missing'));
});
